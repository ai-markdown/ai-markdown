/**
 * LaTeX preprocessing pipeline.
 *
 * Normalizes raw markdown so that LaTeX expressions survive the remark/rehype
 * rendering pipeline intact. The main entry point is {@link preprocessLaTeX},
 * which splits content into protected regions (code blocks, inline code, HTML
 * tags) and applies a sequence of transformations to the unprotected text:
 *
 * 1. Escape mhchem commands (`\ce`, `\pu`)
 * 2. Escape currency dollar signs (e.g. `$100`, `$1,000.50`)
 * 3. Convert bracket delimiters (`\[...\]`, `\(...\)`) to dollar delimiters
 * 4. Escape pipes inside closed LaTeX blocks to prevent GFM table interference
 * 5. Escape pipes inside unclosed LaTeX blocks (streaming partial content)
 * 6. Escape underscores inside `\text{...}` commands
 * 7. Convert single-dollar delimiters to double-dollar delimiters
 * 8. Truncate trailing unclosed LaTeX blocks (streaming protection)
 *
 * Thanks to the implementations from the following repositories:
 * - https://github.com/lobehub/lobe-ui/blob/master/src/hooks/useMarkdown/latex.ts
 * - https://github.com/danny-avila/LibreChat/blob/main/client/src/utils/latex.ts
 *
 * @module preprocessors/latex
 */

/**
 * One lexed region of a slice. `text` segments are the analysed text; the
 * other four are PROTECTED — their bytes are never rewritten — and differ in
 * whether they also DELIMIT the analysed text (end a run):
 *
 * - `code` (fenced block, inline span) and `literal` (`<code>…</code>` and
 *   the other LITERAL_CONTENT_TAGS regions): hard boundaries. Treating code
 *   as a maskable atom was measured wrong twice; it stays a boundary.
 * - `multilineTag`: a whitelisted tag whose own bytes span a line ending
 *   (HTML_TAG_REGEX admits line endings between attributes and inside
 *   quoted values, though never a blank line). A hard boundary,
 *   because replacing it by one mask would delete line endings from the
 *   analysed text and break every per-line rule in `processSlice`.
 * - `tag`: a single-line whitelisted tag — a SOFT atom: masked, not a
 *   boundary, so `$x <br> y$` is one formula and not two unclosed halves.
 *
 * A discriminated union on purpose: one field, nothing to drift.
 */
export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'literal'; text: string }
  | { kind: 'multilineTag'; text: string }
  | { kind: 'tag'; text: string };

type ProtectedKind = Exclude<Segment['kind'], 'text'>;

/** Hard boundaries end the analysed text; soft atoms do not. */
function isHardBoundary(kind: Segment['kind']): boolean {
  return kind === 'code' || kind === 'literal' || kind === 'multilineTag';
}

function hasLineEnding(text: string): boolean {
  return text.includes('\n') || text.includes('\r');
}

type FenceMarker = '`' | '~';

function getRepeatedMarkerLength(content: string, start: number, marker: FenceMarker): number {
  let end = start;
  while (end < content.length && content[end] === marker) {
    end += 1;
  }
  return end - start;
}

const HTML_TAG_NAMES =
  'span|div|p|br|hr|img|a|em|strong|b|i|u|s|sub|sup|code|pre|table|tr|td|th|thead|tbody|tfoot|ul|ol|li|dl|dt|dd|h[1-6]|blockquote|details|summary|figure|figcaption|section|article|aside|nav|header|footer|main|mark|del|ins|small|abbr|cite|dfn|kbd|samp|var|ruby|rt|rp|bdo|wbr|input|button|select|textarea|label|fieldset|legend|output|iframe|video|audio|source|canvas|svg|math|time';

/**
 * One CommonMark attribute (spec 6.6, "open tag"): whitespace, a name, and
 * optionally `=` with an unquoted, single-quoted or double-quoted value.
 * Whitespace and quoted values may hold line endings — an inline tag can
 * span lines of its paragraph — but never a blank line; that bound is not
 * expressible here and is checked on the match (`crossesBlankLine`).
 *
 * Quoted values exclude `>` on purpose, though CommonMark admits one. No
 * part of a match may then hold a `>`, so a tag always ends at the FIRST
 * `>` after its `<` — which is what lets the incremental wrapper's cut rule
 * treat a `>` as settling a latent `<` for good (`findRawSafeCut`). Admitting
 * `>` in quotes broke that: `<span title="multi\n<b>$$x</b>\nline $5">` froze
 * its first lines as text and then re-read them as one tag once the closing
 * quote arrived. The old `[^>]*` form never admitted one either.
 */
const HTML_ATTRIBUTE =
  String.raw`\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:[^\s"'=<>` + '`' + String.raw`]+|'[^'>]*'|"[^">]*"))?`;

/**
 * Sticky regex for matching known HTML tags at a specific position.
 * The `y` (sticky) flag anchors the match at `lastIndex`, avoiding the need
 * to create a substring for each `<` character encountered during scanning.
 *
 * The attributes must parse as attributes. The old form, `(?:\s[^>]*)?`,
 * took ANYTHING up to the next `>`: `a<b we have $x^2$ and c>d` was one tag
 * and its formula was never converted, and a document holding many `<b`
 * with no `>` re-scanned to its end for each one (2000/4000/8000 lines of
 * `a <b x $1`: 31/114/405 ms — quadratic). A `$1` is not an attribute, so
 * the match now fails on the spot. Closing tags are matched by the same
 * form, as before (CommonMark allows only whitespace in them; being more
 * permissive there costs nothing).
 */
const HTML_TAG_REGEX = new RegExp(String.raw`<\/?(${HTML_TAG_NAMES})(?:${HTML_ATTRIBUTE})*\s*\/?>`, 'iy');

/** Does `text[from, to)` contain a blank line — a line ending, optional
 *  spaces/tabs, and another line ending? A tag cannot cross one: the
 *  paragraph it would be inline HTML of ends there. Same rule as
 *  `isBlankLineAt`, whose end-of-input caveat does not arise here (the
 *  range ends at the tag's `>`). */
function crossesBlankLine(text: string, from: number, to: number): boolean {
  let i = from;
  while (i < to) {
    const c = text[i];
    if (c !== '\n' && c !== '\r') {
      i += 1;
      continue;
    }
    let j = i + 1;
    if (c === '\r' && text[j] === '\n') j += 1;
    while (j < to && (text[j] === ' ' || text[j] === '\t')) j += 1;
    if (j < to && (text[j] === '\n' || text[j] === '\r')) return true;
    i = j;
  }
  return false;
}

/**
 * Tags whose inner text must be treated as literal (never processed as LaTeX).
 * For these, an opening tag triggers protection of the entire paired region
 * `<tag>...</tag>` rather than just the tag itself, so dollar signs and other
 * LaTeX-looking characters inside (e.g. `<code>$x^2$</code>`) survive untouched.
 */
const LITERAL_CONTENT_TAGS = new Set(['code', 'pre', 'kbd', 'samp', 'math', 'svg']);
const LITERAL_CONTENT_CLOSE_REGEX: Record<string, RegExp> = {
  code: /<\/code\s*>/gi,
  pre: /<\/pre\s*>/gi,
  kbd: /<\/kbd\s*>/gi,
  samp: /<\/samp\s*>/gi,
  math: /<\/math\s*>/gi,
  svg: /<\/svg\s*>/gi,
};

/** True when only spaces/tabs (and an optional `\r`) follow `pos` up to the
 *  next `\n` or EOF — CommonMark's closing-fence rule. Without it
 *  ` ``` not-a-closer ` closed the fence and inverted the open/close phase
 *  for the rest of the document (v2.4.1 review P2). */
function restOfLineIsBlank(content: string, pos: number): boolean {
  for (let i = pos; i < content.length; i++) {
    const c = content[i];
    if (c === '\n') return true;
    if (c !== ' ' && c !== '\t' && c !== '\r') return false;
  }
  return true;
}

/** A backtick fence's info string may not contain a backtick — such a line
 *  is a paragraph (possibly holding code spans), not an opener. */
function lineHasBacktick(content: string, pos: number): boolean {
  for (let i = pos; i < content.length && content[i] !== '\n'; i++) {
    if (content[i] === '`') return true;
  }
  return false;
}

/**
 * The run at `pos` is the first non-blank thing on its line. Any amount of
 * leading indentation is accepted: CommonMark's 0–3 space limit is measured
 * RELATIVE to the enclosing container, and this text-level pass has no
 * container model — a fence nested two list levels deep sits at column 4+
 * (v2.4.2 review P1-3: `- a\n  - b\n    ~~~\n    price = $100\n    ~~~`
 * had its `$` rewritten). Accepting a deeper-indented fence can only
 * OVER-protect (an indented code block that happens to hold a fence line
 * is treated as one), which is the safe direction for a preprocessor.
 */
function lineIndentBefore(content: string, pos: number): number {
  let i = pos - 1;
  let indent = 0;
  while (i >= 0 && (content[i] === ' ' || content[i] === '\t')) {
    indent += content[i] === '\t' ? 4 : 1;
    i--;
  }
  return i < 0 || content[i] === '\n' || content[i] === '\r' ? indent : -1;
}

/**
 * Find the next run of *exactly* `n` consecutive backticks at or after
 * `start`. Runs of any other length are skipped over. Returns the start
 * index of the matching run, or `-1` if no such run exists.
 *
 * Used to locate the closing delimiter of a CommonMark inline code span:
 * the closer must be a backtick run of the *same* length as the opener.
 */
function findClosingBacktickRun(content: string, start: number, n: number): number {
  let i = start;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '`') {
      const runLen = getRepeatedMarkerLength(content, i, '`');
      if (runLen === n) return i;
      i += runLen;
    } else if (ch === '\n' || ch === '\r') {
      // A code span cannot cross a blank line (it ends the paragraph): two
      // lone backticks in different paragraphs are literal, and pairing
      // them would shield every `$…$` in between from conversion
      // (2026-08-19 review P2-2 — inline sibling of the v2.4.1 fence fix).
      // Line endings are `\n`, `\r\n` and a lone `\r` (r2 P3): a blank line
      // is an ending, optional spaces/tabs, then another ending (or EOF).
      let j = i + 1;
      if (ch === '\r' && content[j] === '\n') j += 1;
      while (j < content.length && (content[j] === ' ' || content[j] === '\t')) j += 1;
      if (j >= content.length || content[j] === '\n' || content[j] === '\r') return -1;
      i += 1;
    } else {
      i += 1;
    }
  }
  return -1;
}

/**
 * Split content into alternating text and protected segments.
 * Protected segments (isCode: true) are excluded from LaTeX processing:
 * - fenced multiline code blocks: 3+ backticks or tildes at the *start of a
 *   line* (any indentation — container-relative limits are not modelled).
 *   Mid-line runs are never fence openers. INDENTED code blocks (4+ spaces
 *   after a blank line, outside any container) are NOT modelled: without a
 *   container model they cannot be told from a list item's continuation
 *   paragraph, and protecting them would silence math in nested lists.
 *   Known limitation — `$` inside an indented code block may be rewritten.
 * - inline code spans: a run of N backticks closed by another run of exactly
 *   N backticks. May span newlines. Multi-backtick forms (e.g. `` `` `x` ``)
 *   are supported so literal backtick characters can appear inside.
 * - HTML tags (e.g. `<span>$</span>` where `$` should not be treated as LaTeX).
 */
export function splitByProtectedRegions(content: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  let multilineStart = -1;
  let multilineFenceMarker: FenceMarker | null = null;
  let multilineFenceLength = 0;
  let multilineFenceIndent = 0;

  function pushProtected(start: number, end: number, kind: ProtectedKind) {
    if (start > lastIndex) {
      segments.push({ kind: 'text', text: content.substring(lastIndex, start) });
    }
    segments.push({ kind, text: content.substring(start, end) });
    lastIndex = end;
  }

  let i = 0;
  while (i < content.length) {
    const char = content[i];

    // Inside a fenced code block: only look for a closing fence line.
    if (multilineStart !== -1) {
      if (char === multilineFenceMarker) {
        const runLen = getRepeatedMarkerLength(content, i, multilineFenceMarker);
        // A closer may be indented at most 3 columns MORE than its opener
        // (CommonMark, container-relative): a `    ```` line inside a
        // column-0 fence is content, not a closer — accepting it closed the
        // block early and exposed its body (adversarial review of the
        // any-indent opener change).
        const closerIndent = lineIndentBefore(content, i);
        if (
          runLen >= multilineFenceLength &&
          closerIndent !== -1 &&
          closerIndent <= multilineFenceIndent + 3 &&
          restOfLineIsBlank(content, i + runLen)
        ) {
          pushProtected(multilineStart, i + runLen, 'code');
          multilineStart = -1;
          multilineFenceMarker = null;
          multilineFenceLength = 0;
          i += runLen;
          continue;
        }
        i += runLen;
        continue;
      }
      i += 1;
      continue;
    }

    // Outside code: check fence opener, inline code span, then HTML tag.
    if (char === '`' || char === '~') {
      const runLen = getRepeatedMarkerLength(content, i, char);

      // Fenced code block opener: ≥3 markers and at a valid line start.
      const openerIndent = lineIndentBefore(content, i);
      if (runLen >= 3 && openerIndent !== -1 && !(char === '`' && lineHasBacktick(content, i + runLen))) {
        multilineStart = i;
        multilineFenceMarker = char;
        multilineFenceLength = runLen;
        multilineFenceIndent = openerIndent;
        i += runLen;
        continue;
      }

      // Inline code span: only backticks (tildes are never inline delimiters).
      if (char === '`') {
        const closeIdx = findClosingBacktickRun(content, i + runLen, runLen);
        if (closeIdx !== -1) {
          pushProtected(i, closeIdx + runLen, 'code');
          i = closeIdx + runLen;
          continue;
        }
      }

      // Unmatched run — skip the whole run so we don't re-interpret its
      // individual backticks on subsequent iterations.
      i += runLen;
      continue;
    }

    if (char === '<') {
      // Only match known HTML tags to avoid false positives with angle brackets
      // in markdown links (<Slides Demo>), math comparisons ($a < b$), etc.
      // Use sticky regex to match at position i without creating a substring.
      HTML_TAG_REGEX.lastIndex = i;
      const tagMatch = HTML_TAG_REGEX.exec(content);
      if (tagMatch && !crossesBlankLine(content, i, i + tagMatch[0].length)) {
        let endIndex = i + tagMatch[0].length;
        // For literal-content tags (code/pre/math/...), protect the paired
        // <tag>...</tag> region so inner `$` never enters LaTeX processing.
        const tagName = tagMatch[1].toLowerCase();
        const isOpeningPairedTag =
          content[i + 1] !== '/' && !tagMatch[0].endsWith('/>') && LITERAL_CONTENT_TAGS.has(tagName);
        if (isOpeningPairedTag) {
          const closeRegex = LITERAL_CONTENT_CLOSE_REGEX[tagName];
          closeRegex.lastIndex = endIndex;
          const closeMatch = closeRegex.exec(content);
          if (closeMatch) {
            endIndex = closeMatch.index + closeMatch[0].length;
          } else {
            // Streaming: closing tag hasn't arrived yet. Protect everything
            // to the end of input so inner `$` etc. aren't mutated before
            // the closer shows up in a later chunk.
            endIndex = content.length;
          }
        }
        // Paired literal regions delimit; a tag spanning a line ending must
        // delimit too (one mask would swallow the line ending); every other
        // tag is a soft atom of the run it sits in.
        pushProtected(
          i,
          endIndex,
          isOpeningPairedTag ? 'literal' : hasLineEnding(content.substring(i, endIndex)) ? 'multilineTag' : 'tag'
        );
        i = endIndex;
        continue;
      }
    }

    i += 1;
  }

  if (multilineStart !== -1) {
    pushProtected(multilineStart, content.length, 'code');
  }

  // Push remaining text
  if (lastIndex < content.length) {
    segments.push({ kind: 'text', text: content.substring(lastIndex) });
  }

  return segments;
}

/**
 * Escape mhchem commands in LaTeX expressions to ensure proper rendering.
 *
 * @param text Input string containing LaTeX expressions with mhchem commands
 * @returns String with escaped mhchem commands
 * @from https://github.com/lobehub/lobe-ui/blob/master/src/hooks/useMarkdown/latex.ts
 */
function escapeMhchemCommands(text: string) {
  return text.replaceAll('$\\ce{', '$\\\\ce{').replaceAll('$\\pu{', '$\\\\pu{');
}

/** A `$` that reads as currency from what FOLLOWS it: `$5`, `$1,000.50`,
 *  `$4.2M`. Decided by the rest of its line (see escapeCurrencyDollarSigns). */
const CURRENCY_REGEX = /(?<![\\$])\$(?!\$)(?=\d+(?:,\d{3})*(?:\.\d+)?(?:[KMBkmb])?(?:\s|$|[^a-zA-Z\d]))/g;
/** A `$` that reads as currency from what PRECEDES it:
 *  - right after a number: `5$`, `1,000.50$`;
 *  - right after a one-to-three-letter uppercase currency code that starts
 *    a word: `US$`, `CA$`, `A$`, `HK$`, `NZ$`, `S$` (`xUS$` is not one);
 *  - after a number and one space, before a word: `5 $ now`.
 *  The first two take the trailing rule of CURRENCY_REGEX (whitespace, end
 *  or a non-alphanumeric next), so `US$5` and `5$6` stay CURRENCY_REGEX's
 *  and `5$x` is nobody's. Without this rule these `$` opened inline math:
 *  `costs 5$ and 10$` became `costs 5$$ and 10$$`, an inlineMath " and 10".
 *  Decided by the line BEFORE it: a `$` that closes an open inline span
 *  (`$x = 5$`, `$A$`) is a delimiter, not currency. */
const CURRENCY_SUFFIX_REGEX =
  /(?:(?<=\d)|(?<=(?:^|[^A-Za-z\d])[A-Z]{1,3}))\$(?!\$)(?=\s|$|[^A-Za-z\d])|(?<=\d )\$(?= [A-Za-z])/g;

interface CurrencyCandidate {
  index: number;
  /** CURRENCY_REGEX form (`$5`): decided by the rest of its line. Otherwise
   *  a CURRENCY_SUFFIX_REGEX form, decided by the line before it. */
  leading: boolean;
  /** Leading form only: where its rest-of-line count stops — the next
   *  leading candidate, or the end of the text. */
  restEnd: number;
}
// `convertLatexDelimiters` matches \[...\] and \(...\) as LaTeX delimiters,
// but excludes:
// - !\[...\] (markdown image)
// - \[...\]( (markdown link)
// It used to be this regex, which is still its specification (and the oracle
// of its differential test):
//   /(?<!!)\\\[([\S\s]*?[^\\])\\](?!\()|\\\((.*?)\\\)/g
// The lazy bodies made it quadratic: every unclosed `\(` rescanned to the
// end of its line and every unclosed `\[` to the end of the text, so 20k
// bare `\(` took 158 ms and 20k bare `\[` 310 ms, 4x that at 40k. The
// hand-written scan below finds closers with `indexOf` and remembers
// where a search failed: a later opener of the same kind searches a suffix
// of the failed range, so it fails too and is skipped.
const ARRAY_COL_SPEC_OR_PIPE_REGEX = /(\\begin\{(?:array|tabular[x*]?)\}\{[^}]*\})|(?<!\\)\|/g;
// Display $$ allows multiline (the blank-line bound on a mid-line opener is
// applied by the exec loop in escapeLatexPipes, not here); inline $ forbids
// newlines (consistent with SINGLE_DOLLAR_REGEX).
// Both display delimiters use EXACTLY the delimiter lexicon of
// findUnclosedDelimiter / isEscapedByBackslashRun: a `$$` preceded by
// an EVEN run of backslashes (zero included) is a delimiter, an odd run
// escapes it — nothing else matters, in particular not a preceding `$`
// (`$$$$` is an empty display, `\$$$x$$` opens at the second `$`). The
// incremental wrapper freezes on that lexicon's verdict, so any other rule
// here diverges from it: the old escape-blind opener let `Cost \$$x$ … |
// table |` pair with a `$$` far below and rewrite the table's pipes
// (2026-08-19 review r2 P1-1), and a `(?<![\\$])` guard disagreed on `$$$$`
// / `\$$$` (oracle re-check). Inline stays as it was (line-local; the cut is
// a line start, so it cannot pair across a freeze).
const EVEN_BACKSLASHES = String.raw`(?<=(?:^|[^\\])(?:\\\\)*)`;
const LATEX_BLOCK_REGEX = new RegExp(
  String.raw`${EVEN_BACKSLASHES}\$\$([\S\s]*?)${EVEN_BACKSLASHES}\$\$|(?<![\\$])\$(?!\$)((?:[^$\n]|\\\$)*?)(?<![\\` +
    '`' +
    String.raw`])\$(?!\$)`,
  'g'
);
const TEXT_COMMAND = '\\text{';
const SINGLE_DOLLAR_REGEX = /(?<![\\$])\$(?!\$)((?:[^$\n]|\\[$])+?)(?<!\\)(?<!`)\$(?!\$)/g;

/** Bare `$` count in `str[from, to)`: a `$` not preceded by `\\` or `$` and
 *  not followed by `$` (the old NO_ESCAPED_DOLLAR_REGEX rule), with the
 *  characters just outside the range supplied so a range can be counted in
 *  isolation and summed with its neighbours: `prev` stands in for
 *  `str[from - 1]`, `next` for `str[to]`. */
function countBareDollars(str: string, from: number, to: number, prev: string, next: string): number {
  let n = 0;
  for (let j = from; j < to; j++) {
    if (str.charCodeAt(j) !== 36 /* $ */) continue;
    const before = j > from ? str[j - 1] : prev;
    const after = j + 1 < to ? str[j + 1] : next;
    if (before !== '\\' && before !== '$' && after !== '$') n += 1;
  }
  return n;
}

/**
 * Escape currency dollar signs (e.g. $100, $1,000.50) so they are not
 * misinterpreted as LaTeX delimiters.
 *
 * The tricky part: a `$` followed by digits might still be inside a LaTeX
 * expression (e.g. `$8.29 \text{ B} \times 4$`). We detect this by checking
 * whether there is an odd number of unescaped `$` on the same line after the
 * current match — if so, the current `$` is a LaTeX opener, not currency.
 *
 * The trailing forms (`5$`, `US$`, `5 $ now`; CURRENCY_SUFFIX_REGEX) use
 * the mirror check: an odd number of bare `$` on the processed line BEFORE
 * them means an inline span is open and this `$` closes it. The leading
 * form's rest-of-line count stops at the next LEADING candidate, as it
 * always did — a trailing candidate in that stretch is still a bare `$` to
 * it, so `$8.29 \times 4$` keeps its opener unescaped and its `4$` reads
 * as the closer.
 */
function escapeCurrencyDollarSigns(text: string): string {
  const parts: string[] = [];
  let lastIndex = 0;
  const leading = Array.from(text.matchAll(CURRENCY_REGEX), (m) => m.index);
  const trailing = Array.from(text.matchAll(CURRENCY_SUFFIX_REGEX), (m) => m.index);
  // Both lists in text order, merged. The two regexes are disjoint by
  // their lookarounds; should a `$` ever satisfy both, the leading form
  // decides it.
  const candidates: CurrencyCandidate[] = [];
  let t = 0;
  for (let l = 0; l < leading.length; l++) {
    const index = leading[l];
    while (t < trailing.length && trailing[t] < index) {
      candidates.push({ index: trailing[t], leading: false, restEnd: 0 });
      t += 1;
    }
    if (t < trailing.length && trailing[t] === index) t += 1;
    candidates.push({ index, leading: true, restEnd: l + 1 < leading.length ? leading[l + 1] : text.length });
  }
  for (; t < trailing.length; t++) candidates.push({ index: trailing[t], leading: false, restEnd: 0 });

  // Track the processed content of the current line incrementally, as its
  // bare-`$` COUNT plus its last two characters: the parity check below used
  // to re-scan the whole processed line on every match, O(line²) for a line
  // with many currency hits (12 KB table row: 59 ms per frame; 8 KB: 243 ms
  // — 2026-08-19 review r2 P2-1). Appending a piece adds its own count plus
  // a seam correction (the previous last `$` loses its "not followed by `$`"
  // when the piece starts with `$`).
  //
  // The line's text itself is NOT kept. It was, as `currentLineProcessed +=
  // piece`, and only ever read for its last two characters — but reading
  // one character of a string V8 has just concatenated flattens the rope,
  // O(line) per match, so a 240 KB line holding 32k `$` spent 2.5 of its
  // 3.0 s here. The two characters are all the seam corrections need; `''`
  // stands for "no such character", as before.
  let lineLast = '';
  let lineBeforeLast = '';
  let currentLineDollars = 0;
  const appendToLine = (piece: string): void => {
    if (piece.length === 0) return;
    const prevLastCounted = lineLast === '$' && lineBeforeLast !== '\\' && lineBeforeLast !== '$';
    if (prevLastCounted && piece[0] === '$') currentLineDollars -= 1;
    currentLineDollars += countBareDollars(piece, 0, piece.length, lineLast, '');
    if (piece.length >= 2) {
      lineBeforeLast = piece[piece.length - 2];
      lineLast = piece[piece.length - 1];
    } else {
      lineBeforeLast = lineLast;
      lineLast = piece;
    }
  };
  const resetLine = (rest: string): void => {
    lineLast = '';
    lineBeforeLast = '';
    currentLineDollars = 0;
    appendToLine(rest);
  };

  for (const candidate of candidates) {
    const segment = text.substring(lastIndex, candidate.index);
    parts.push(segment);

    // Update the line state: keep only content after the last newline.
    const newlineIdx = Math.max(segment.lastIndexOf('\n'), segment.lastIndexOf('\r'));
    if (newlineIdx !== -1) {
      resetLine(segment.substring(newlineIdx + 1));
    } else {
      appendToLine(segment);
    }

    let needEscape = true;
    // Only the FIRST line after this match matters below; bound the slice
    // by the next line ending instead of splitting the whole remainder into
    // a line array on every match — O(remainder) per frame on the hot path
    // for the last match (2026-08-19 review).
    const restStart = candidate.index + 1;
    // A trailing form has no rest to count; its verdict comes from the
    // line before it, below.
    const restEnd = candidate.leading ? candidate.restEnd : restStart;
    let firstLineBeforeNextMatch = '';
    if (restEnd - restStart > 0) {
      let eol = restEnd;
      for (let k = restStart; k < restEnd; k++) {
        const c = text.charCodeAt(k);
        if (c === 10 /* \n */ || c === 13 /* \r */) {
          eol = k;
          break;
        }
      }
      firstLineBeforeNextMatch = text.substring(restStart, eol);
    }
    const restDollars = countBareDollars(firstLineBeforeNextMatch, 0, firstLineBeforeNextMatch.length, '', '');
    if (restDollars % 2 !== 0) {
      // Parity of `processed line + firstLineBeforeNextMatch` (the current
      // `$` itself excluded), summed from the two counts with the seam
      // corrected both ways.
      const lLastCounted = lineLast === '$' && lineBeforeLast !== '\\' && lineBeforeLast !== '$';
      const f0 = firstLineBeforeNextMatch[0];
      let whole = currentLineDollars + restDollars;
      // The line's last `$` is now followed by F's first char.
      if (lLastCounted && f0 === '$') whole -= 1;
      // F's first `$` was counted with an empty predecessor; the line
      // supplies one.
      if (f0 === '$' && (lineLast === '\\' || lineLast === '$') && firstLineBeforeNextMatch[1] !== '$') whole -= 1;
      if (whole % 2 !== 0) needEscape = false;
    }
    // Trailing form: currency unless the processed line has an inline span
    // open (odd bare-`$` count before this one), which this `$` closes.
    if (!candidate.leading) needEscape = currentLineDollars % 2 === 0;

    const replacement = needEscape ? '\\$' : '$';
    parts.push(replacement);
    // Append to the line state so subsequent parity checks on the same line
    // see the correct count of unescaped `$` (e.g. a left-as-`$` opener that
    // the next match's check must count).
    appendToLine(replacement);
    lastIndex = candidate.index + 1;
  }
  parts.push(text.substring(lastIndex));
  return parts.join('');
}

/** The line terminators a regex `.` does not match. */
const isLineTerminator = (c: number): boolean => c === 0x0a || c === 0x0d || c === 0x2028 || c === 0x2029;

/** The closer of a `\[` whose body starts at `bodyStart`: the first `\]` at
 *  or after `bodyStart + 1` (the body is at least one character) whose
 *  preceding character is not a backslash and which is not followed by `(`
 *  — the lazy `([\S\s]*?[^\\])\\](?!\()` of the specification. `-1` when
 *  there is none. */
function findSquareCloser(text: string, bodyStart: number): number {
  let from = bodyStart + 1;
  for (;;) {
    const e = text.indexOf('\\]', from);
    if (e === -1) return -1;
    if (text.charCodeAt(e - 1) !== 0x5c /* \ */ && text.charCodeAt(e + 2) !== 0x28 /* ( */) return e;
    from = e + 1;
  }
}

/**
 * Convert LaTeX bracket delimiters to dollar sign delimiters.
 * Converts \[...\] to $$...$$ and \(...\) to $...$
 *
 * Matches are found left to right and never overlap, exactly as the
 * specification regex quoted above ARRAY_COL_SPEC_OR_PIPE_REGEX would find
 * them. `\[` bodies may span lines; `\(` bodies may not. An
 * opener with no closer stays literal. Linear: a failed `\[` search marks
 * every later `\[` as failed (its range is a suffix of the failed one); a
 * failed `\(` search records the line terminator that stopped it, so every
 * `\(` up to that terminator is skipped, and the `\)` it found is reused
 * for the openers after the terminator.
 *
 * @param text Input string containing LaTeX expressions
 * @returns String with LaTeX bracket delimiters converted to dollar sign delimiters
 * @modified from https://github.com/lobehub/lobe-ui/blob/master/src/hooks/useMarkdown/latex.ts
 * @internal exported for tests only (module path — not on the package barrel).
 */
export function convertLatexDelimiters(text: string): string {
  const n = text.length;
  let out = '';
  let last = 0;
  // No `\[` at or after this point closes.
  let squareDead = false;
  // The first `\)` at or after some earlier point: -2 before the first
  // search, -1 when there is none (then there is none later either), else
  // its index, reusable by any opener whose body starts at or before it.
  let roundCloser = -2;
  // A line terminator that stopped a `\(` search: openers whose body starts
  // at or before it see the same terminator before the same `\)`.
  let roundDeadUntil = -1;
  let i = text.indexOf('\\');
  while (i !== -1 && i + 1 < n) {
    const next = text.charCodeAt(i + 1);
    if (next === 0x5b /* [ */) {
      // `![` is an image, not a delimiter.
      if (!squareDead && text.charCodeAt(i - 1) !== 0x21 /* ! */) {
        const e = findSquareCloser(text, i + 2);
        if (e === -1) {
          squareDead = true;
        } else {
          out += `${text.slice(last, i)}$$${text.slice(i + 2, e)}$$`;
          last = e + 2;
          i = text.indexOf('\\', e + 2);
          continue;
        }
      }
      // The `[` cannot start a delimiter; resume after it.
      i = text.indexOf('\\', i + 2);
      continue;
    }
    if (next === 0x28 /* ( */) {
      const bodyStart = i + 2;
      if (bodyStart > roundDeadUntil && roundCloser !== -1) {
        if (roundCloser < bodyStart) roundCloser = text.indexOf('\\)', bodyStart);
        if (roundCloser !== -1) {
          let terminator = -1;
          for (let k = bodyStart; k < roundCloser; k++) {
            if (isLineTerminator(text.charCodeAt(k))) {
              terminator = k;
              break;
            }
          }
          if (terminator === -1) {
            out += `${text.slice(last, i)}$${text.slice(bodyStart, roundCloser)}$`;
            last = roundCloser + 2;
            i = text.indexOf('\\', roundCloser + 2);
            continue;
          }
          roundDeadUntil = terminator;
        }
      }
      i = text.indexOf('\\', i + 2);
      continue;
    }
    // Any other `\` pair: the next character may itself start `\[` / `\(`.
    i = text.indexOf('\\', i + 1);
  }
  if (last === 0) return text;
  return out + text.slice(last);
}

/**
 * Helper function: replace unescaped pipes with \vert in LaTeX math fragments
 * @from https://github.com/lobehub/lobe-ui/blob/master/src/hooks/useMarkdown/latex.ts
 */
const replaceUnescapedPipes = (formula: string): string =>
  // Use \vert{} so the control sequence terminates before the next token.
  // Preserve `|` inside \begin{array}{...} / \begin{tabular}{...} column specifiers.
  formula.replaceAll(ARRAY_COL_SPEC_OR_PIPE_REGEX, (match, colSpec: string | undefined) =>
    colSpec !== undefined ? match : '\\vert{}'
  );
/**
 * Is the line ending at `pos` (`\n`, `\r`, or the `\r` of a CRLF) followed by
 * a blank line — optional spaces/tabs and then another line ending? The end
 * of input does NOT complete a blank line: the next line has not arrived,
 * and a verdict that settled on EOF would settle differently once it did
 * (the incremental wrapper freezes on these verdicts).
 */
function isBlankLineAt(text: string, pos: number): boolean {
  let j = pos + 1;
  if (text[pos] === '\r' && text[j] === '\n') j += 1;
  while (j < text.length && (text[j] === ' ' || text[j] === '\t')) j += 1;
  return j < text.length && (text[j] === '\n' || text[j] === '\r');
}

/** Does `text[from, to)` contain a line ending that starts a blank line? */
function hasBlankLineBetween(text: string, from: number, to: number): boolean {
  for (let i = from; i < to; i++) {
    const c = text[i];
    if ((c === '\n' || c === '\r') && isBlankLineAt(text, i)) return true;
  }
  return false;
}

/**
 * Escape pipes in LaTeX expressions to prevent them from being interpreted as
 * column separators in markdown tables.
 *
 * MATH-FLOW blocks (`opensMathFlow`: a `$$` at a line start, at most three
 * columns in) come from the unclosed scan, `findUnclosedDelimiter`, which
 * is the one walk that knows where a block ends: at a `$$` with no partner
 * on its line (a `$$…$$` line inside the block is content), at the end of
 * the list item holding it (`dedentEnds`), or nowhere yet. Everything in a
 * block is math and is escaped whole. The lazy pair regex used to be the
 * only entry into a block, and inside one it is out of phase with
 * remark-math: it paired the opener of `$$\n$$\int$$\n\n$$\n| a | b |` with
 * the first token of line 2, refused the next pair across the blank line
 * and took the real closer on line 4 as an opener, escaping the prose
 * pipes — stateless only, because the incremental path had frozen the
 * settled block and saw line 4 as a lone opener (release soak, latex leg,
 * seed 202719523). A dedent-ended block was entered only once some later
 * `$$` made a pair, so a block frozen on an earlier frame changed bytes
 * when the pair arrived. Both are gone with the scan as the sole source.
 *
 * Between blocks the pairs are lazy (`escapeLatexPairs`): inline `$…$`,
 * and mid-line `$$…$$`, which remark-math pairs inside its paragraph
 * alone. A paragraph ends at a blank line, so a mid-line `$$` whose
 * nearest `$$` lies past a blank line is literal text; the scan resumes
 * right after it so that `$$` can open the next pair — which it really is.
 * The price in `It costs $$100 …` used to pair with the opener of the
 * display block below it, and the block's own closer then read as an
 * unclosed opener. Same rule as `findUnclosedDelimiter`'s inline reset.
 *
 * @param text Input string containing LaTeX expressions
 * @param runStartsAtLineStart Virtual predecessor for `opensMathFlow` when
 *   an opener sits at offset 0 (see `transformRun`).
 * @param preceding The text before the run (see `listContentIndent`).
 * @returns String with pipes escaped in LaTeX expressions
 * @modified from https://github.com/lobehub/lobe-ui/blob/master/src/hooks/useMarkdown/latex.ts
 */
function escapeLatexPipes(text: string, runStartsAtLineStart: boolean, preceding: readonly string[]): string {
  // The flow blocks as the unclosed scan sees them, in text order (blocks
  // neither nest nor overlap, and the scan records each as it ends).
  // Every block is escaped whole, from the scan's verdict alone — never
  // from a regex pair, which would only exist once some later `$$` had
  // arrived and so could change a block frozen on an earlier frame.
  const blocks: FlowBlockEnd[] = [];
  if (text.includes('$$')) findUnclosedDelimiter(text, 'double-only', runStartsAtLineStart, preceding, blocks);
  let out = '';
  let pos = 0;
  for (const block of blocks) {
    out += escapeLatexPairs(text, pos, block.start, runStartsAtLineStart);
    if (block.by === 'open') {
      // A still-open block runs to the end of the run and is the tail
      // pass's (`escapeLatexPipesInUnclosed`).
      return out + text.slice(block.start);
    }
    const body = text.slice(block.start + 2, block.by === 'closer' ? block.end - 2 : block.end);
    out += `$$${replaceUnescapedPipes(body)}` + (block.by === 'closer' ? '$$' : '');
    pos = block.end;
  }
  return out + escapeLatexPairs(text, pos, text.length, runStartsAtLineStart);
}

/** The lazy-pair pass over `text[from, to)` — the gap between two flow
 *  blocks: inline `$…$` pairs and mid-line `$$…$$` pairs. A pair never
 *  reaches into a block: the scan closes an inline `$$` at the next `$$`
 *  whatever its column, so a line-start `$$` a pair could reach is not a
 *  block opener to the scan either. */
function escapeLatexPairs(text: string, from: number, to: number, runStartsAtLineStart: boolean): string {
  if (from >= to) return '';
  let out = '';
  let last = from;
  LATEX_BLOCK_REGEX.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = LATEX_BLOCK_REGEX.exec(text)) !== null && m.index + m[0].length <= to) {
    const match = m[0];
    const display = m[1];
    const inline = m[2];
    if (display !== undefined) {
      const bodyStart = m.index + 2;
      const bodyEnd = m.index + match.length - 2;
      if (flowIndent(text, m.index, runStartsAtLineStart) === -1 && hasBlankLineBetween(text, bodyStart, bodyEnd)) {
        // Mid-line opener across a blank line: literal here, and the
        // closer may be the real opener of the next pair.
        LATEX_BLOCK_REGEX.lastIndex = bodyStart;
        continue;
      }
      out += text.slice(last, m.index) + `$$${replaceUnescapedPipes(display)}$$`;
    } else if (inline !== undefined) {
      out += text.slice(last, m.index) + `$${replaceUnescapedPipes(inline)}$`;
    } else {
      out += text.slice(last, m.index) + match;
    }
    last = m.index + match.length;
  }
  return out + text.slice(last, to);
}

/**
 * Whether the character at position `pos` is escaped by the immediately
 * preceding backslash run. An even-count run (including zero) means the
 * `$` is unescaped; an odd count means it is escaped. Example: `\\$` has
 * two preceding backslashes — the `\` escapes the `\`, leaving `$` real.
 */
function isEscapedByBackslashRun(text: string, pos: number): boolean {
  let count = 0;
  let j = pos - 1;
  while (j >= 0 && text[j] === '\\') {
    count++;
    j--;
  }
  return count % 2 === 1;
}

/** The kind of an unclosed delimiter, as {@link findUnclosedDelimiter}
 *  reports it: a `$$` that opens a math FLOW (the block the truncation
 *  exists for), a `$$` that is inline math TEXT, or a single `$`. */
type UnclosedKind = 'flow' | 'inline' | 'single';

/** Where a flow block ends, as `findUnclosedDelimiter` reports it. */
interface FlowBlockEnd {
  /** Index of the opener's first `$`. */
  start: number;
  /** Index just past the closing `$$`, the line ending at which a list
   *  item ended the block, or the text length while the block is open. */
  end: number;
  /** What ended it: a closing `$$` (the body then stops before it), a
   *  list item's end (`dedent`), or nothing yet (`open`). */
  by: 'closer' | 'dedent' | 'open';
}

interface UnclosedDelimiter {
  /** Index of the opener's first `$`. */
  start: number;
  kind: UnclosedKind;
  /** For a flow opener inside a list item, the item's content indent
   *  (`listContentIndent`): a later line indented less ends the block. 0
   *  for a top-level flow opener and for the other kinds. */
  indent: number;
}

/** Index of the next unescaped `$$` token on the SAME line at or after
 *  `from`, or -1 when the line ends first. */
function nextDoubleDollarOnLine(text: string, from: number): number {
  for (let j = from; j + 1 < text.length; j++) {
    const c = text[j];
    if (c === '\n' || c === '\r') return -1;
    if (c === '$' && text[j + 1] === '$' && !isEscapedByBackslashRun(text, j)) return j;
  }
  return -1;
}

/**
 * Find the trailing unclosed delimiter — the last opener that was never
 * closed — or `null` when every delimiter is paired.
 *
 * The scan is KIND-AWARE, because the delimiters do not all pair the same
 * way and a plain open/close toggle over the whole `$` stream — which is
 * what this scan used to be — could not hold the rules below at once:
 *
 * - A `$$` opener is a FLOW opener (`opensMathFlow`: it starts its line, at
 *   most three columns in) or INLINE math text. A single `$` opener is
 *   inline too, and opens only in `'both'` mode. remark-math also refuses a
 *   flow fence whose info string holds a `$`; that refinement is NOT
 *   modelled, on purpose: a streaming `$$x^2$` (half its closer arrived)
 *   would read as inline for one frame and surface as literal text instead
 *   of staying truncated until the closer lands.
 * - A single `$` is LINE-LOCAL: inline math never spans a line ending
 *   anywhere in this file (both closed-pair regexes forbid `\n`, the
 *   currency parity is per line), so a `$` still open when its line ends is
 *   a stray character, not an opener, and the scan forgets it. It used to
 *   stay open: one `US$` in a sentence made every `|` of a table three
 *   paragraphs later a `\vert{}`. Only a `$` on the LAST line (no line
 *   ending after it — the streaming tail) is reported unclosed.
 * - An INLINE `$$` opener is PARAGRAPH-LOCAL: remark-math pairs it inside
 *   its paragraph only, so one still open at a blank line is literal and
 *   the scan forgets it — the `$$` after the blank is then the opener it
 *   really is. A FLOW opener runs on across blank lines to its closer, or
 *   to the end of input: that is the genuinely open trailing block the
 *   truncation exists for. (The end of input does not complete a blank
 *   line — see `isBlankLineAt`.)
 * - An INDENTED flow opener is CONTAINER-LOCAL: it sits inside a list item
 *   whenever there is one, and the item ends at the first non-blank line
 *   indented less than the opener, so such a line ends the block and the
 *   scan forgets it (`dedentEnds`; the container comes from the lines
 *   before the opener, see `flowIndent` and `listContentIndent`).
 *   `- Item\n\n  $$\n  x\n\nAfter the list.` used to be truncated to
 *   `- Item`. Each such line ending is pushed to `closures` when given, so
 *   `escapeLatexPipes` can refuse a pair crossing it.
 * - Inside an open `$$` a single `$` is content — the closed-pair regexes
 *   agree: a display pair is `$$…$$` whatever `$` it holds, and an inline
 *   `$…$` cannot hold a bare `$`. Conversely a `$$` arriving while a single
 *   `$` is open means the single was a stray; the `$$` opens.
 * - Inside an open FLOW block, `$$` tokens on the lines AFTER the opener's
 *   pair up per line and only a token with no partner on its line closes
 *   the block. This is what keeps the truncation scan right after
 *   `convertSingleToDoubleDollar`, which turns every `$x$` in the block
 *   into a `$$x$$` pair: the toggle used to "close" the block on the first
 *   of those and re-open a mid-line opener on the second, so an unclosed
 *   streaming block holding one `$x$` was never truncated. On the opener's
 *   OWN line the next `$$` closes, whatever follows it: `$$|a|$$ then …` is
 *   inline math that happens to start a line, and remark-math agrees (a
 *   fence's info string cannot hold a `$`). A closer is still any unpaired
 *   `$$`, not only a closing fence line — `E = mc^2 $$` closes, as it
 *   always did.
 *
 * @param text  Input string to scan.
 * @param mode  `'both'` tracks `$$` and `$`; `'double-only'` tracks only `$$`.
 * @param runStartsAtLineStart  Virtual predecessor for `opensMathFlow` when
 *   an opener sits at offset 0 (see `transformRun`).
 * @param preceding  The text before the run, for `listContentIndent`.
 * @param blocks  When given, receives every FLOW block in text order:
 *   its opener's index, where it ends (just past its closing `$$`, at the line ending
 *   where a list item ended it, or `text.length` while still open) and
 *   whether a closing `$$` ended it. `escapeLatexPipes` escapes such a
 *   block whole, so the two passes agree on the block's extent.
 */
function findUnclosedDelimiter(
  text: string,
  mode: 'both' | 'double-only',
  runStartsAtLineStart: boolean,
  preceding: readonly string[],
  blocks?: FlowBlockEnd[]
): UnclosedDelimiter | null {
  let open: UnclosedDelimiter | null = null;
  // Whether the scan has left the open FLOW opener's own line.
  let pastOpenerLine = false;
  // Container verdicts by opener line start, so the walks of one scan
  // share their work (see `listContentIndent`).
  const containers = new Map<number, ContainerVerdicts>();
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '$' && i + 1 < text.length && text[i + 1] === '$' && !isEscapedByBackslashRun(text, i)) {
      if (open === null || open.kind === 'single') {
        const indent = flowIndent(text, i, runStartsAtLineStart);
        // An indented opener may be list item content; the lines above
        // say whether it is, and at what content indent (0 = it is not).
        const container = indent > 0 ? listContentIndent(text, i - indent, preceding, indent, containers) : 0;
        open = indent === -1 ? { start: i, kind: 'inline', indent: 0 } : { start: i, kind: 'flow', indent: container };
        pastOpenerLine = false;
        i += 2;
      } else if (open.kind === 'flow' && pastOpenerLine) {
        const partner = nextDoubleDollarOnLine(text, i + 2);
        if (partner === -1) {
          blocks?.push({ start: open.start, end: i + 2, by: 'closer' });
          open = null;
          i += 2;
        } else {
          i = partner + 2;
        }
      } else {
        if (open.kind === 'flow') blocks?.push({ start: open.start, end: i + 2, by: 'closer' });
        open = null;
        i += 2;
      }
    } else if (
      mode === 'both' &&
      c === '$' &&
      !isEscapedByBackslashRun(text, i) &&
      (i + 1 >= text.length || text[i + 1] !== '$')
    ) {
      if (open === null) open = { start: i, kind: 'single', indent: 0 };
      else if (open.kind === 'single') open = null;
      i += 1;
    } else {
      if ((c === '\n' || c === '\r') && open !== null) {
        if (open.kind === 'single' || (open.kind === 'inline' && isBlankLineAt(text, i))) open = null;
        else if (open.kind === 'flow' && open.indent > 0 && dedentEnds(text, i, open.indent)) {
          blocks?.push({ start: open.start, end: i, by: 'dedent' });
          open = null;
        } else pastOpenerLine = true;
      }
      i += 1;
    }
  }
  if (open !== null && open.kind === 'flow') blocks?.push({ start: open.start, end: text.length, by: 'open' });
  return open;
}

function escapeLatexPipesInUnclosed(text: string, runStartsAtLineStart: boolean, preceding: readonly string[]): string {
  const unclosed = findUnclosedDelimiter(text, 'both', runStartsAtLineStart, preceding);
  if (unclosed === null) return text;

  // Escape pipes only in the unclosed tail
  const before = text.substring(0, unclosed.start);
  const delimLen = unclosed.kind === 'single' ? 1 : 2;
  const delim = text.substring(unclosed.start, unclosed.start + delimLen);
  const tail = text.substring(unclosed.start + delimLen);
  return before + delim + replaceUnescapedPipes(tail);
}

/**
 * Truncate trailing unclosed `$$` blocks (streaming protection).
 *
 * During streaming, an unclosed `$$` at the start of a line triggers
 * remarkMath's `mathFlow` tokenizer, which treats all subsequent content
 * as part of a display math block until a closing `$$` fence is found.
 * Since the closing fence hasn't arrived yet, the entire remainder of the
 * document is swallowed into one giant math node — producing a wall of
 * red KaTeX error text.
 *
 * This function detects the trailing unclosed `$$` and removes it
 * (including any preceding whitespace/newlines) so that remarkMath never
 * sees the incomplete delimiter.  Once the closing delimiter arrives in
 * a later streaming chunk, the complete block will render normally.
 *
 * Only tracks `$$` — single `$` does not trigger mathFlow and is harmless
 * when `singleDollarTextMath` is `false`.
 *
 * AND ONLY WHEN THE OPENER COULD ACTUALLY OPEN A MATH FLOW. The first
 * sentence above says "at the start of a line" and the implementation used to
 * ignore it, truncating on any unpaired `$$` anywhere. mathFlow is a LEAF
 * BLOCK construct: it only fires on a line whose first non-space character
 * starts the run, indented at most three spaces. An unpaired `$$` mid-line
 * swallows nothing, so removing the rest of the document to protect against
 * it removes content for no reason at all.
 *
 * Measured against remark-math 2026-09-01, with a heading and a paragraph
 * following each shape:
 *
 *   `The server costs $$100 per month.`   parses fine — nothing swallowed
 *   `Partial result: $$ P(A`              parses fine — nothing swallowed
 *   `$$\n\frac{a}{b}` at 0-3 spaces       swallowed to EOF
 *   the same at 4 spaces, or after a tab  becomes an indented code block
 *
 * The visible symptom was a finished, non-streaming document losing
 * everything after a price written `$$100`: the currency rule only escapes a
 * single `$`, so the doubled one read as an opener and the rest of the page
 * disappeared. Nothing errored, because a truncated document is perfectly
 * valid markdown — just not the one anyone wrote.
 *
 * The pairing that decides "unclosed" is paragraph-aware as well
 * (`findUnclosedDelimiter`): a mid-line `$$` still open at a blank line is
 * literal, so `It costs $$100 per month.` followed by a real display block
 * no longer "closes" at that block's opener and leaves its closer looking
 * like an unclosed opener — which truncated the block and every line after
 * it, in a finished document.
 *
 * The predicate is positional: a `$$` opening a line inside a list item
 * counts as a flow opener, and one after a blockquote's `>` does not. One
 * container fact IS modelled, because it decided whether a finished
 * document lost content: a flow opener inside a LIST ITEM is scoped to the
 * item, which ends at the first non-blank line indented less than the
 * item's content, blank line before it or not — remark-math agrees for
 * `- Item\n\n  $$\n  x\nAfter` and for the blank-line form. Such a line ends
 * the block for the unclosed scan (`dedentEnds` in `findUnclosedDelimiter`),
 * and the pair pass refuses a pair crossing that point (`escapeLatexPipes`).
 * Without this, `- Item\n\n  $$\n  x\n\nAfter the list.` truncated to
 * `- Item`: the item's math never swallows past the item, and the
 * paragraph after the list was lost.
 *
 * Whether the opener IS in a list item, and at what content indent, comes
 * from the lines before it (`listContentIndent`), never from the opener's
 * own indent: remark-math allows up to three spaces of optional indent on
 * a top-level fence whose body and closer sit at column 0, so an
 * indent-only rule ended `  $$\nx+y\n$$\n\nAfter` at `x+y`, read the real
 * closer as a new unclosed opener and truncated `After`. The walk back
 * needs the text before the run; the incremental wrapper passes the frozen
 * source prefix so both entry points read the same lines. Blockquotes stay
 * out of the model: `> $$` is not a flow opener here, so nothing after it
 * is ever truncated. A fence indented four or more columns (a nested
 * item's block) is not a flow opener either — the residual that remains.
 *
 * The function is `flowIndent`: the indent (0-3 spaces) of a `$$` at `pos`
 * that opens a math flow, or -1 when it does not open one. The comments
 * that call the predicate `opensMathFlow` mean `flowIndent(...) !== -1`.
 */
function flowIndent(text: string, pos: number, runStartsAtLineStart: boolean): number {
  // Walk back over the current line. A line ending settles it (`\n`, or `\r`
  // — CRLF is met at its `\n`; a lone `\r` is a line ending here exactly as
  // it is for the lexer's blank-line rule and the currency counter). Reaching
  // offset 0 without one means the line began BEFORE this run: the caller
  // knows whether that origin was a line start (a virtual predecessor, not a
  // run-wide veto — later lines of the run answer for themselves).
  let i = pos;
  let spaces = 0;
  while (i > 0) {
    const prev = text[i - 1];
    if (prev === '\n' || prev === '\r') return spaces;
    i -= 1;
    // A tab counts as four columns, which is already an indented code block,
    // and any other character means the run does not begin the line.
    if (text[i] !== ' ') return -1;
    spaces += 1;
    if (spaces > 3) return -1;
  }
  return runStartsAtLineStart ? spaces : -1;
}

/** A CommonMark list marker line: up to three spaces, `-`/`*`/`+` or up to
 *  nine digits with `.`/`)`, then the spaces before the content (or
 *  nothing more on the line). */
const LIST_MARKER_RE = /^( {0,3})([-*+]|\d{1,9}[.)])( *)/;

/** Leading columns of a line; a tab is four, so it is never a dedent. */
function lineIndent(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === ' ') n += 1;
  return n < line.length && line[n] === '\t' ? 4 : n;
}

/**
 * The content indent of the innermost list item whose content holds the
 * line starting at `lineStart` of `text`, or 0 when that line is not list
 * item content. `preceding` is the text before `text` (the slice before
 * the run, and the wrapper's frozen prefix before that), read only here
 * and only backwards: the walk stops at the first line at column 0 — a
 * marker line whose content indent fits (`<= indent`) means the line is
 * inside that item; anything else at column 0 means it is not. Indented
 * non-marker lines are item content or paragraph continuation and the
 * walk goes on past them; an indented marker line whose content indent is
 * deeper than `indent` is a nested item the line is not in, and the walk
 * goes on to the enclosing one. Blank lines are skipped.
 *
 * `cache` bounds the walk within one scan. Each walk settles the verdict
 * for every opener indent at once (1, 2 and 3 — the only indents that
 * open a flow) and records the triple under its own line start, and a
 * later walk that reaches a recorded line start takes over its verdicts:
 * the lines above it are the same lines. Without this, one list item
 * holding many `$$` lines made every opener re-read every line above it
 * (2000/4000/8000 openers in one item: 494 / 1972 / 7914 ms).
 */
function listContentIndent(
  text: string,
  lineStart: number,
  preceding: readonly string[],
  indent: number,
  cache: Map<number, ContainerVerdicts>
): number {
  const cached = cache.get(lineStart);
  if (cached !== undefined) return cached[indent - 1];
  const verdicts = walkToContainer(text, lineStart, preceding, cache);
  cache.set(lineStart, verdicts);
  return verdicts[indent - 1];
}

/** Content indent verdicts for an opener indented 1, 2 and 3 spaces; -1
 *  while a walk has not settled one yet. */
type ContainerVerdicts = [number, number, number];

function walkToContainer(
  text: string,
  lineStart: number,
  preceding: readonly string[],
  cache: Map<number, ContainerVerdicts>
): ContainerVerdicts {
  const verdicts: ContainerVerdicts = [-1, -1, -1];
  const settle = (from: ContainerVerdicts): void => {
    for (let t = 0; t < 3; t++) if (verdicts[t] === -1) verdicts[t] = from[t];
  };
  const settled = (): boolean => verdicts[0] !== -1 && verdicts[1] !== -1 && verdicts[2] !== -1;
  const chunks = preceding.length === 0 ? [text] : [...preceding, text];
  const last = chunks.length - 1;
  let ci = last;
  let pos = lineStart;
  let line = '';
  for (;;) {
    if (pos === 0) {
      if (ci === 0) break;
      ci -= 1;
      pos = chunks[ci].length;
      continue;
    }
    const chunk = chunks[ci];
    let j = pos - 1;
    while (j >= 0 && chunk[j] !== '\n' && chunk[j] !== '\r') j -= 1;
    line = chunk.slice(j + 1, pos) + line;
    if (j < 0) {
      pos = 0;
      continue;
    }
    const known = ci === last ? cache.get(j + 1) : undefined;
    if (known !== undefined) {
      // A line an earlier opener started: its walk covered everything
      // above, and the line itself is an indented `$$` line, no verdict.
      settle(known);
      return verdicts;
    }
    if (classifyLine(line, verdicts)) return verdicts;
    if (settled()) return verdicts;
    line = '';
    pos = chunk[j] === '\n' && j > 0 && chunk[j - 1] === '\r' ? j - 1 : j;
  }
  if (line !== '') classifyLine(line, verdicts);
  settle([0, 0, 0]);
  return verdicts;
}

/** Apply one line above the opener to the pending `verdicts`; `true` when
 *  the walk is over (a line at column 0 settles everything). */
function classifyLine(line: string, verdicts: ContainerVerdicts): boolean {
  if (line.trim() === '') return false;
  const marker = LIST_MARKER_RE.exec(line);
  if (marker !== null && !(marker[3].length === 0 && marker[0].length < line.length)) {
    // (`-x` / `1.x` are not markers and fall through to the indent test.)
    const spaces = marker[3].length;
    const afterSpaces = marker[0].length;
    // Content starts after one to four spaces; five or more, or nothing
    // more on the line, means the content begins one column past the
    // marker (CommonMark 5.2).
    const content =
      spaces >= 1 && spaces <= 4 && afterSpaces < line.length ? afterSpaces : marker[1].length + marker[2].length + 1;
    for (let t = 0; t < 3; t++) if (verdicts[t] === -1 && content <= t + 1) verdicts[t] = content;
    if (marker[1].length > 0) return false;
    // A column-0 marker is top-level: an opener its content does not
    // reach is in no list item at all.
    for (let t = 0; t < 3; t++) if (verdicts[t] === -1) verdicts[t] = 0;
    return true;
  }
  if (lineIndent(line) !== 0) return false;
  for (let t = 0; t < 3; t++) if (verdicts[t] === -1) verdicts[t] = 0;
  return true;
}

/**
 * Does the line after the line ending at `pos` end a container whose
 * content is indented `indent` columns — is it non-blank and indented less?
 * A blank line, or a line that has not finished arriving and holds only
 * spaces so far, is no verdict (the incremental wrapper freezes on these
 * verdicts, and a non-blank line's indent cannot change once its first ink
 * character is in); a tab is four columns, never a dedent.
 */
function dedentEnds(text: string, pos: number, indent: number): boolean {
  let j = pos + 1;
  if (text[pos] === '\r' && text[j] === '\n') j += 1;
  let spaces = 0;
  while (j < text.length && text[j] === ' ' && spaces < indent) {
    spaces += 1;
    j += 1;
  }
  if (spaces >= indent || j >= text.length) return false;
  const c = text[j];
  return c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r';
}

function truncateUnclosedLatexBlock(
  text: string,
  runStartsAtLineStart: boolean,
  preceding: readonly string[],
  unclosed = findUnclosedDelimiter(text, 'double-only', runStartsAtLineStart, preceding)
): string {
  // Only a FLOW opener swallows anything (the scan classified it with
  // `opensMathFlow`); an inline `$$` still open at the end is literal text.
  if (unclosed === null || unclosed.kind !== 'flow') return text;

  // Strip the unclosed $$ block and any trailing whitespace before it.
  return text.substring(0, unclosed.start).trimEnd();
}

/**
 * Escape unescaped underscores within `\text{...}` commands in LaTeX expressions.
 * For example, `\text{node_domain}` becomes `\text{node\_domain}`, but
 * `\text{node\_domain}` stays unchanged.
 *
 * The body scan is brace-aware: nested groups `\text{outer {inner}_x}`
 * are matched via a depth counter that respects `\{` / `\}` escapes and
 * the escape for `\\` itself, so the entire body (depth ≥ 0) is scanned
 * before we escape its underscores.  An unclosed `\text{` body (missing
 * closing brace, e.g. during streaming) is left untouched.
 *
 * @param text Input string that may contain LaTeX expressions
 * @returns String with unescaped underscores escaped within `\text{...}` commands
 */
function escapeTextUnderscores(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf(TEXT_COMMAND, i);
    if (start === -1) {
      out += text.substring(i);
      return out;
    }

    out += text.substring(i, start);
    const bodyStart = start + TEXT_COMMAND.length;
    let depth = 1;
    let j = bodyStart;
    while (j < text.length && depth > 0) {
      const c = text[j];
      if (c === '\\' && j + 1 < text.length) {
        // Skip the escaped character so `\{`, `\}`, `\\` don't affect depth.
        j += 2;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) break;
      }
      j++;
    }

    if (depth !== 0) {
      // Unclosed \text{ — leave the remainder as-is so a later streaming
      // chunk can complete it.
      out += text.substring(start);
      return out;
    }

    const body = text.substring(bodyStart, j);
    const escapedBody = body.replaceAll(/(?<!\\)_/g, '\\_');
    out += `\\text{${escapedBody}}`;
    i = j + 1; // past closing `}`
  }
  return out;
}

/**
 * Convert single dollar delimiters to double dollar delimiters.
 * e.g. $x^2$ → $$x^2$$
 */
function convertSingleToDoubleDollar(text: string): string {
  return text.replaceAll(SINGLE_DOLLAR_REGEX, (_match, content: string) => `$$${content}$$`);
}

/**
 * Main LaTeX preprocessor entry point.
 *
 * Splits the input into protected regions (code blocks, inline code, HTML tags)
 * and applies the full normalization pipeline to unprotected text segments.
 * Returns the input unchanged when no LaTeX-related characters (`$`, `\[`, `\(`)
 * are detected.
 *
 * @param str - Raw markdown string.
 * @returns The preprocessed string with normalized LaTeX delimiters.
 */
export function preprocessLaTeX(str: string): string {
  // Return early if no LaTeX patterns are found.
  if (!hasLatexTrigger(str)) return str;
  // The transform chain itself lives in `processSlice` — the incremental
  // preprocessor needs the same chain with quiescence probes, and until
  // 2.5.2 the two were written out separately and kept byte-equal BY HAND.
  // Byte-equality is a hard contract (the incremental wrapper freezes a
  // prefix of this function's output), so a chain that can drift is a defect
  // waiting to happen rather than a duplication to tolerate. The only thing
  // that was ever genuinely different is the whole-string early-exit above,
  // which a slice must not re-decide — see `processSlice`.
  // The whole-string identity return above comes FIRST: the legacy arm is
  // not identity-preserving for trigger-free input (`\text{a_b}` still
  // transforms there), so mask exhaustion must never be consulted before it.
  const mask = selectMask(str);
  return (mask === null ? processSlice(str, { legacy: true, probe: false }) : processSlice(str, { probe: false, mask }))
    .out;
}

// ─── Incremental (append-aware) wrapper ─────────────────────────────────────
//
// `preprocessLaTeX` is O(n) per call and runs on every revealed frame during
// smooth streaming. The wrapper below freezes the transformed output of the
// settled prefix and re-processes only the active tail, byte-identical to
// `preprocessLaTeX(full)` at every step — INCLUDING the whole-string
// early-exit's quirks (that equivalence, not idealized semantics, is the
// contract; pinned by the replay/property suites in latex.incremental.test.ts).
//
// Safe-cut rules (oracle-amended design, 2026-08-05 review):
// - a cut sits at a LINE START (preceding char strictly `\n`; lone-`\r`
//   documents never cut and gracefully degrade to full reprocessing),
// - inside a TEXT segment of the active region's own split (never inside a
//   fence / inline span / protected tag region),
// - with no dangling backtick run between the last blank line and it (an
//   unmatched run can pair with a run arriving later and re-segment the
//   past — but a code span cannot cross a blank line, so a blank settles
//   every run before it),
// - with no LATENT html tag before it — a viable `<`+letter start whose `>`
//   has not arrived: HTML_TAG_REGEX admits line endings in attributes, so
//   the match window spans lines and only a `>` after the `<` settles it
//   (B1 counterexample) — or a blank line, which no tag can cross,
// - and, decided on the TRANSFORMED slice (raw-text checks are unsound both
//   ways because currency escaping rewrites the `$` token stream — B5):
//   quiescence — no tail-sensitive transform engaged at slice end.

/** The original whole-string early-exit predicate (shared verbatim). */
function hasLatexTrigger(str: string): boolean {
  return str.includes('$') || str.includes('\\[') || str.includes('\\(');
}

/** Does `text` contain an unclosed `\text{` body? Mirrors the escape-aware
 *  brace walk of `escapeTextUnderscores`'s unclosed branch. */
function hasUnclosedTextCommand(text: string): boolean {
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf(TEXT_COMMAND, i);
    if (start === -1) return false;
    let depth = 1;
    let j = start + TEXT_COMMAND.length;
    while (j < text.length && depth > 0) {
      const c = text[j];
      if (c === '\\' && j + 1 < text.length) {
        j += 2;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      j++;
    }
    if (depth !== 0) return true;
    i = j;
  }
  return false;
}

/** A convertible (non-image) `\[` still present after delimiter conversion —
 *  its `\]` has not arrived, so a later append changes this segment. */
const RESIDUAL_OPEN_BRACKET_RE = /(?<!!)\\\[/;

/** Run (or legacy segment) whose first non-whitespace bytes are a `$$` —
 *  the only shape whose B3 seam flag can be set (see transformRun). */
const LEADING_DOUBLE_DOLLAR_RE = /^\s*\$\$/;

/** Why a slice fell back to the legacy path. `null` = it did not.
 *  `mask-exhausted` is a whole-call decision the CALLER records (every
 *  private-use code point occurs in the complete input); `restore-invariant`
 *  is an engine defect found while restoring atoms. Output is identical for
 *  both; only the diagnostic differs. */
export type DegradedReason = 'mask-exhausted' | 'restore-invariant' | null;

export interface SliceResult {
  out: string;
  /** No tail-sensitive transform engaged: safe to freeze this output. */
  quiescent: boolean;
  /** `truncateUnclosedLatexBlock` fired in the slice's FIRST run (a run that
   *  starts at slice offset 0, i.e. `segments[0]` is not a hard boundary)
   *  with only whitespace before the `$$` opener — the original's `trimEnd`
   *  would cross the seam into the frozen output (B3). */
  truncatedAtSeamStart: boolean;
  /** `degraded ≡ degradedReason !== null`; there is no separate boolean. */
  degradedReason: DegradedReason;
}

/**
 * The legacy arm ignores masks entirely and never re-enters selection or
 * fallback; the default arm requires a mask the caller selected from the
 * COMPLETE input of the public call (see {@link selectMask}). "Default
 * processing without a mask" is unrepresentable on purpose.
 */
export type ProcessSliceOptions = (
  { legacy: true; probe: boolean } | { legacy?: false; probe: boolean; mask: string }
) & {
  /** The source before `slice` — the incremental wrapper's frozen prefix.
   *  Read only backwards, by `listContentIndent`, to tell whether an
   *  indented `$$` opener is list item content; the stateless entry and
   *  the evidence harnesses pass nothing (the slice IS the document). */
  precedingText?: string;
};

// ─── Mask selection ─────────────────────────────────────────────────────────
//
// A soft atom is replaced in the analysed text by ONE private-use code unit.
// The mask must be absent from the input, and — this is the part that bit
// the first design — absent from the input of the whole PUBLIC call, not of
// the slice at hand: the incremental wrapper processes a freeze candidate
// and a tail as separate slices while the stateless path sees the document
// whole. If the alphabet were exhausted only across the union of the slices,
// each slice would still find a mask and produce soft-atom output while the
// stateless path had gone legacy — a byte divergence no per-slice check can
// see. So the public entries select, `processSlice` only consumes.

const PUA_START = 0xe000;
const PUA_END = 0xf8ff;
const PUA_SIZE = PUA_END - PUA_START + 1; // 6400

/** First private-use code point absent from `source`, or `null` when all
 *  6400 occur (then the call takes the legacy arm). Spelled as a code, never
 *  as a literal private-use character: it is invisible and formatters drop
 *  it. */
export function selectMask(source: string): string | null {
  const first = String.fromCharCode(PUA_START);
  if (source.indexOf(first) === -1) return first;
  const seen = new Uint8Array(PUA_SIZE);
  for (let i = 0; i < source.length; i++) {
    const c = source.charCodeAt(i);
    if (c >= PUA_START && c <= PUA_END) seen[c - PUA_START] = 1;
  }
  for (let k = 0; k < PUA_SIZE; k++) if (seen[k] === 0) return String.fromCharCode(PUA_START + k);
  return null;
}

/** The incremental wrapper's lineage-level presence set: which private-use
 *  code points the complete current source contains. Fed from appended
 *  bytes only, rebuilt on a non-append reset — no O(n) rescan per frame.
 *  The distinct count moves only on a 0 → 1 bit transition, so ten thousand
 *  repeats of one code point count once. */
class PuaPresence {
  private readonly bits = new Uint8Array(PUA_SIZE);
  private distinct = 0;

  reset(): void {
    this.bits.fill(0);
    this.distinct = 0;
  }

  add(text: string, from: number): void {
    for (let i = from; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c >= PUA_START && c <= PUA_END) {
        const k = c - PUA_START;
        if (this.bits[k] === 0) {
          this.bits[k] = 1;
          this.distinct += 1;
        }
      }
    }
  }

  select(): string | null {
    if (this.distinct === 0) return String.fromCharCode(PUA_START);
    if (this.distinct >= PUA_SIZE) return null;
    for (let k = 0; k < PUA_SIZE; k++) if (this.bits[k] === 0) return String.fromCharCode(PUA_START + k);
    return null;
  }
}

// ─── The transform chain, per run ───────────────────────────────────────────

interface RunTransform {
  out: string;
  /** A tail-sensitive transform engaged (today's `quiescent === false`). */
  tailSensitive: boolean;
  truncatedAtSeamStart: boolean;
}

/**
 * The eight steps, applied to one analysed text. `probe` adds the
 * quiescence flags and never touches `out`, so the two entry points cannot
 * diverge on output. `runStartsAtLineStart` is the virtual predecessor
 * `opensMathFlow` consults when its backward scan reaches offset 0;
 * `seamEligible` is whether this text is the slice's first run (only that
 * one can set the B3 seam flag, and only that one needs the fast-path scan
 * on the tail pass).
 */
function transformRun(
  input: string,
  probe: boolean,
  runStartsAtLineStart: boolean,
  seamEligible: boolean,
  preceding: readonly string[]
): RunTransform {
  let text = input;
  let tailSensitive = false;
  let truncatedAtSeamStart = false;
  text = escapeMhchemCommands(text);
  text = escapeCurrencyDollarSigns(text);
  text = convertLatexDelimiters(text);
  if (probe && RESIDUAL_OPEN_BRACKET_RE.test(text)) tailSensitive = true;
  text = escapeLatexPipes(text, runStartsAtLineStart, preceding);
  if (probe && findUnclosedDelimiter(text, 'both', runStartsAtLineStart, preceding) !== null) tailSensitive = true;
  text = escapeLatexPipesInUnclosed(text, runStartsAtLineStart, preceding);
  if (probe && hasUnclosedTextCommand(text)) tailSensitive = true;
  text = escapeTextUnderscores(text);
  text = convertSingleToDoubleDollar(text);
  // The tail pass (`probe: false`) only needs the FIRST run's flag, and that
  // flag needs the run's first non-blank bytes to be a `$$` opener — cheap
  // to rule out before the O(run) unclosed scan (plain prose is one run;
  // this scan was the last ~20% over stateless). The scan result feeds
  // truncateUnclosedLatexBlock too — one O(run) pass, not two (r2 P2-2).
  let unclosedDouble: UnclosedDelimiter | null | undefined;
  if (probe || (seamEligible && LEADING_DOUBLE_DOLLAR_RE.test(text))) {
    unclosedDouble = findUnclosedDelimiter(text, 'double-only', runStartsAtLineStart, preceding);
    if (unclosedDouble !== null) {
      tailSensitive = true;
      // The flag must track what truncation ACTUALLY does, not what an
      // unclosed `$$` used to imply: `truncateUnclosedLatexBlock` declines
      // on a delimiter that cannot open a math flow (indented four spaces,
      // after a tab, or mid-line), and a flag raised anyway made the
      // wrapper trim a newline the stateless path keeps (2026-09-02).
      if (seamEligible && unclosedDouble.kind === 'flow' && text.slice(0, unclosedDouble.start).trim() === '') {
        truncatedAtSeamStart = true;
      }
    }
  }
  text = truncateUnclosedLatexBlock(text, runStartsAtLineStart, preceding, unclosedDouble);
  return { out: text, tailSensitive, truncatedAtSeamStart };
}

// ─── Legacy arm: every protected segment a hard boundary ────────────────────

/** Today's per-segment loop, kept verbatim in behaviour: the reference the
 *  differential gate and the evidence harness compare against, and the
 *  fallback when the default arm cannot stand behind its output. A segment
 *  starts its own analysed text, so its start IS a line start for
 *  `opensMathFlow` — exactly what the old scan did by stopping at offset 0. */
function processSliceLegacy(slice: string, probe: boolean, precedingText: string): SliceResult {
  const segments = splitByProtectedRegions(slice);
  const parts: string[] = [];
  let quiescent = true;
  let truncatedAtSeamStart = false;
  let offset = 0;
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    const segmentStart = offset;
    offset += segment.text.length;
    if (segment.kind !== 'text') {
      parts.push(segment.text);
      continue;
    }
    const r = transformRun(segment.text, probe, true, index === 0, [precedingText, slice.slice(0, segmentStart)]);
    if (r.tailSensitive) quiescent = false;
    if (r.truncatedAtSeamStart) truncatedAtSeamStart = true;
    parts.push(r.out);
  }
  return { out: parts.join(''), quiescent, truncatedAtSeamStart, degradedReason: null };
}

// ─── Default arm: soft atoms and element scopes ─────────────────────────────
//
// Three concepts, from separating MASKING (these bytes must not be
// rewritten) from DELIMITING (these bytes end the analysed text):
//
//   hard boundary  code / literal / multilineTag — ends a run (unchanged)
//   soft atom      any other tag — one mask code unit in the run's text,
//                  restored in order after the chain ran
//   element scope  a soft opener and its closer on the same line of the
//                  same run — the inner text is its own run, processed
//                  recursively; the finished element is one atom outside
//
// Scopes are intervals of a tree, so pairing is top-of-stack only: a closer
// that does not match the top of the stack is an atom and searches nothing
// (`<b><i></b></i>` is not repaired); openers still open at the end of the
// line become atoms; past depth 8 an opener is pushed SUPPRESSED so its own
// closer is still consumed structurally and cannot steal an outer level's.
// Every rule is a function of the line's bytes alone, so both entry points
// compute the same structure for the same line — cuts sit at line starts,
// and a frozen line is complete.

type RunNode =
  | { type: 'text'; text: string }
  | { type: 'atom'; text: string }
  | { type: 'scope'; open: string; close: string; children: RunNode[] };

interface ScopeFrame {
  name: string;
  open: string;
  suppressed: boolean;
  children: RunNode[];
}

const SCOPE_DEPTH_CAP = 8;
const VOID_TAGS = new Set(['br', 'hr', 'img', 'wbr', 'input', 'source']);
const TAG_NAME_RE = /^<(\/?)([A-Za-z][A-Za-z0-9]*)/;

function tagInfo(tag: string): { name: string; closing: boolean; opensScope: boolean } {
  const m = TAG_NAME_RE.exec(tag);
  const closing = m?.[1] === '/';
  const name = (m?.[2] ?? '').toLowerCase();
  const opensScope = !closing && !tag.endsWith('/>') && !VOID_TAGS.has(name);
  return { name, closing, opensScope };
}

/** Structure pass: the run's segments → a tree of text, atoms and
 *  same-line scopes. Line endings (`\n`, `\r\n`, lone `\r`) close every
 *  open frame and are emitted as text at the root. */
function buildRunTree(segments: readonly Segment[]): RunNode[] {
  const root: RunNode[] = [];
  const stack: ScopeFrame[] = [];
  const current = (): RunNode[] => (stack.length > 0 ? stack[stack.length - 1].children : root);
  const unwind = (): void => {
    while (stack.length > 0) {
      const frame = stack.pop() as ScopeFrame;
      current().push({ type: 'atom', text: frame.open }, ...frame.children);
    }
  };
  for (const segment of segments) {
    if (segment.kind === 'tag') {
      const info = tagInfo(segment.text);
      if (info.closing) {
        const top = stack[stack.length - 1];
        if (top !== undefined && top.name === info.name) {
          stack.pop();
          const parent = current();
          if (top.suppressed) {
            parent.push({ type: 'atom', text: top.open }, ...top.children, { type: 'atom', text: segment.text });
          } else {
            parent.push({ type: 'scope', open: top.open, close: segment.text, children: top.children });
          }
        } else {
          current().push({ type: 'atom', text: segment.text });
        }
      } else if (info.opensScope) {
        stack.push({ name: info.name, open: segment.text, suppressed: stack.length >= SCOPE_DEPTH_CAP, children: [] });
      } else {
        current().push({ type: 'atom', text: segment.text });
      }
      continue;
    }
    // Text: split at line endings; each ending closes the line's frames.
    const t = segment.text;
    let start = 0;
    for (let i = 0; i < t.length; i++) {
      const c = t.charCodeAt(i);
      if (c !== 10 && c !== 13) continue;
      if (i > start) current().push({ type: 'text', text: t.slice(start, i) });
      const end = c === 13 && t.charCodeAt(i + 1) === 10 ? i + 2 : i + 1;
      unwind();
      root.push({ type: 'text', text: t.slice(i, end) });
      start = end;
      i = end - 1;
    }
    if (start < t.length) current().push({ type: 'text', text: t.slice(start) });
  }
  unwind();
  return root;
}

/** Test hook: make restoration report a violation for a run whose atoms
 *  satisfy the predicate. The only way to reach the restore-invariant path
 *  from a test; production never sets it. @internal */
let restoreFailureInjector: ((atoms: readonly string[]) => boolean) | null = null;
/** @internal */
export function __setRestoreFailureInjector(fn: ((atoms: readonly string[]) => boolean) | null): void {
  restoreFailureInjector = fn;
}

/**
 * Put the atoms back. Masks in the output are a prefix-ordered subsequence
 * of the atoms (six transforms only insert; `truncateUnclosedLatexBlock`
 * only deletes a suffix; nothing reorders or duplicates), so the k-th mask
 * is the k-th atom and a missing tail of atoms was truncated. More masks
 * than atoms is a violation: `null`.
 */
function restore(out: string, atoms: readonly string[], mask: string): string | null {
  if (restoreFailureInjector !== null && restoreFailureInjector(atoms)) return null;
  let result = '';
  let k = 0;
  let last = 0;
  for (;;) {
    const idx = out.indexOf(mask, last);
    if (idx === -1) break;
    if (k >= atoms.length) return null;
    result += out.slice(last, idx) + atoms[k];
    k += 1;
    last = idx + 1;
  }
  return result + out.slice(last);
}

interface EmittedRun {
  text: string;
  atoms: string[];
}

/** Emit pass: the tree → the masked analysed text plus its atoms in order.
 *  A scope's inner text is its own run: chain with probes off (its closer is
 *  present, so later appends cannot change its bytes), mid-line origin,
 *  restored, and wrapped by its tags into ONE atom of the enclosing run. */
function emitRun(nodes: readonly RunNode[], mask: string): EmittedRun | null {
  let text = '';
  const atoms: string[] = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      text += node.text;
    } else if (node.type === 'atom') {
      atoms.push(node.text);
      text += mask;
    } else {
      const inner = emitRun(node.children, mask);
      if (inner === null) return null;
      const transformed = transformRun(inner.text, false, false, false, []);
      const restored = restore(transformed.out, inner.atoms, mask);
      if (restored === null) return null;
      atoms.push(node.open + restored + node.close);
      text += mask;
    }
  }
  return { text, atoms };
}

function reportRestoreViolation(): void {
  if (process.env.NODE_ENV !== 'production') {
    console.error(
      '[ai-react-markdown] LaTeX preprocessor: atom restoration violated its invariant (more masks in the output than atoms); the slice was re-processed on the legacy path. This is an engine defect — please report it.'
    );
  }
}

function processSliceDefault(slice: string, probe: boolean, mask: string, precedingText: string): SliceResult {
  const segments = splitByProtectedRegions(slice);
  const parts: string[] = [];
  let quiescent = true;
  let truncatedAtSeamStart = false;
  let offset = 0;
  let i = 0;
  while (i < segments.length) {
    const segment = segments[i];
    if (isHardBoundary(segment.kind)) {
      parts.push(segment.text);
      offset += segment.text.length;
      i += 1;
      continue;
    }
    const runStart = offset;
    const runSegments: Segment[] = [];
    while (i < segments.length && !isHardBoundary(segments[i].kind)) {
      runSegments.push(segments[i]);
      offset += segments[i].text.length;
      i += 1;
    }
    const before = runStart === 0 ? -1 : slice.charCodeAt(runStart - 1);
    const runStartsAtLineStart = before === -1 || before === 10 || before === 13;
    // Only a run that starts at offset 0 can raise the seam flag (a slice
    // starting with a hard boundary never could, and still cannot).
    const seamEligible = runStart === 0;
    const emitted = emitRun(buildRunTree(runSegments), mask);
    if (emitted === null) {
      reportRestoreViolation();
      return { ...processSliceLegacy(slice, probe, precedingText), degradedReason: 'restore-invariant' };
    }
    const r = transformRun(emitted.text, probe, runStartsAtLineStart, seamEligible, [
      precedingText,
      slice.slice(0, runStart),
    ]);
    const restored = restore(r.out, emitted.atoms, mask);
    if (restored === null) {
      reportRestoreViolation();
      return { ...processSliceLegacy(slice, probe, precedingText), degradedReason: 'restore-invariant' };
    }
    if (r.tailSensitive) quiescent = false;
    if (r.truncatedAtSeamStart) truncatedAtSeamStart = true;
    parts.push(restored);
  }
  return { out: parts.join(''), quiescent, truncatedAtSeamStart, degradedReason: null };
}

/**
 * THE LaTeX transform chain over one slice — the single definition of it.
 * Both entry points come through here: {@link preprocessLaTeX} with
 * `probe: false`, the incremental preprocessor with probes on for the freeze
 * candidate. The whole-string early-exit stays OUT of here on purpose: a
 * slice must not re-decide it, because `\text{a_b}` in a trigger-free slice
 * still transforms when the FULL string carries a `$` elsewhere.
 *
 * The default arm falls back to the legacy arm, in the same call, when
 * restoration finds its invariant violated — the returned result then
 * carries `degradedReason: 'restore-invariant'` so the incremental wrapper
 * can poison its lineage. Exported for the differential gate and the
 * evidence harness only; not re-exported from the package root.
 *
 * @internal
 */
export function processSlice(slice: string, options: ProcessSliceOptions): SliceResult {
  const precedingText = options.precedingText ?? '';
  if (options.legacy === true) return processSliceLegacy(slice, options.probe, precedingText);
  return processSliceDefault(slice, options.probe, options.mask, precedingText);
}

/** A raw line holding only spaces / tabs / CR — a CommonMark blank line. */
function isBlankRawLine(text: string, from: number, to: number): boolean {
  for (let i = from; i < to; i++) {
    const c = text.charCodeAt(i);
    if (c !== 32 && c !== 9 && c !== 13) return false;
  }
  return true;
}

/**
 * Last raw-safe cut in `active`, or -1. Raw conditions only (line start
 * inside a text segment, no dangling backtick run and no latent `<` since
 * the last blank line); the transformed-output quiescence check happens on
 * the candidate slice afterwards.
 */
function findRawSafeCut(active: string): number {
  const segments = splitByProtectedRegions(active);
  let offset = 0;
  let lastCut = -1;
  let backtickHazard = false;
  let latentLt = false;
  for (const segment of segments) {
    if (segment.kind !== 'text') {
      // Protected regions contain no cuts; a matched tag/span/fence carries
      // no cross-append state. `>` inside one still discharges a latent `<`
      // (HTML_TAG_REGEX scans raw text, blind to our segmentation).
      if (segment.text.includes('>')) latentLt = false;
      offset += segment.text.length;
      continue;
    }
    const text = segment.text;
    // Whether the segment's first (possibly partial) line starts at a real
    // line start — only then may it count as a blank line below.
    let atLineStart = offset === 0 || active.charCodeAt(offset - 1) === 10;
    let lineStart = 0;
    while (lineStart <= text.length) {
      const nl = text.indexOf('\n', lineStart);
      const lineEnd = nl === -1 ? text.length : nl;
      // A dangling backtick run can only be re-segmented by a run arriving
      // later that PAIRS with it, and a code span cannot cross a blank line
      // (findClosingBacktickRun stops there; a mid-line run cannot become a
      // fence, which needs a line-start run of 3+). So a blank line settles
      // every backtick before it: the hazard latch releases and lines
      // after the blank are candidates again — instead of a lone backtick
      // freezing nothing for the rest of the stream (2026-08-19 review
      // P2-3; oracle-checked: the span search is the only segmentation
      // decision that looks past a finished line). The blank must be a
      // WHOLE raw line, exactly what findClosingBacktickRun stops at:
      // terminated by `\n` inside this segment, only spaces/tabs/CR, and
      // starting at a real line start — a segment's first partial line sits
      // after a protected span on the same line, and the remainder after
      // its last `\n` is the START of a line that continues in the next
      // segment (property-suite counterexample: an empty remainder released
      // the latch and a cut landed past a still-unpaired backtick).
      // The same blank line settles a latent `<`: a tag cannot cross it
      // (`crossesBlankLine` rejects the match), so no `>` arriving later
      // can complete one that opened before it.
      if (atLineStart && nl !== -1 && isBlankRawLine(text, lineStart, lineEnd)) {
        backtickHazard = false;
        latentLt = false;
      }
      for (let i = lineStart; i < lineEnd; i++) {
        const ch = text[i];
        if (ch === '`') backtickHazard = true;
        else if (ch === '>') latentLt = false;
        else if (ch === '<') {
          const next = text[i + 1];
          if (next !== undefined && (next === '/' || /[A-Za-z]/.test(next))) latentLt = true;
        }
      }
      if (nl === -1) break;
      if (!backtickHazard && !latentLt) lastCut = offset + nl + 1;
      lineStart = nl + 1;
      atLineStart = true;
    }
    offset += text.length;
  }
  return lastCut;
}

/** Only attempt a freeze once the unfrozen region exceeds this many chars —
 *  below it the extra pipeline pass costs more than it saves. */
const DEFAULT_FREEZE_ATTEMPT_THRESHOLD = 512;

/**
 * Append-aware `preprocessLaTeX`: one instance per streaming lineage (the
 * component holds it like the smooth-stream controller). Byte-identical to
 * `preprocessLaTeX(full)` on every call; non-append input resets all state;
 * identical input replays the cached output (StrictMode/idempotence).
 *
 * @param options.freezeThreshold Active-region size below which no freeze
 *   is attempted. Tests pass `0` so SHORT pinned counterexamples actually
 *   exercise the freeze path instead of passing vacuously through the
 *   full-reprocess fallback.
 * Public: exported from the package root and used by the React and Vue
 * adapters; keep one instance per append-only stream.
 */
/** @soak-entry latex-preprocessor */
export function createIncrementalLatexPreprocessor(options?: {
  freezeThreshold?: number;
  /** Failure backoff (default on). Tests that rely on `freezeThreshold: 0`
   *  to attempt a freeze on EVERY call turn it off, so 1-char chunkings keep
   *  exercising the cut rules instead of skipping most attempts; backoff
   *  can only freeze LESS, so passing without it implies passing with it.
   *  @internal */
  backoff?: boolean;
  /** Test hook: called once per freeze ATTEMPT (a scan of the active
   *  region) with the region's length and how many source bytes the
   *  attempt froze (0 = failed), so the backoff bound and freeze progress
   *  can be pinned. @internal */
  onAttempt?: (info: { activeLength: number; frozenBytes: number }) => void;
  /** Test hook: called when the lineage degrades to whole-source legacy
   *  processing, with the reason. @internal */
  onDegrade?: (reason: Exclude<DegradedReason, null>) => void;
}): (content: string) => string {
  const freezeThreshold = options?.freezeThreshold ?? DEFAULT_FREEZE_ATTEMPT_THRESHOLD;
  const onAttempt = options?.onAttempt;
  const backoff = options?.backoff ?? true;
  const onDegrade = options?.onDegrade;
  let prevSource = '';
  let prevOutput = '';
  let frozenSrcEnd = 0;
  let frozenOut = '';
  let triggered = false;
  // Failure backoff (2026-08-19 review P2-3): a candidate that is not
  // quiescent stays that way for as long as it is the candidate (its bytes
  // never change under append — an early stray `$` keeps parity odd for
  // every later slice), yet each frame paid a full active-region scan plus
  // a wasted candidate pass on top of the unavoidable tail pass (3× the
  // stateless cost on such documents). After a failed attempt the next one
  // waits until the active region has doubled; failed-attempt cost is then
  // a geometric series (≤ 4·O(n) over the whole stream). Freezing later
  // never changes output — every frame equals `preprocessLaTeX(full)`.
  let nextAttemptLen = 0;
  // Lineage degradation: once this lineage has gone legacy (mask alphabet
  // exhausted over the complete source, or a restore-invariant violation),
  // every later call is whole-source legacy — the stateless path would be
  // too, and composing a frozen soft-atom prefix with a legacy tail is not
  // byte-equal. Reset with the rest of the lineage state, nowhere else.
  let lineageDegraded = false;
  const presence = new PuaPresence();

  /** Every non-replay return commits the frame: a return that skipped this
   *  would leave the cache on the previous frame, so the next identical
   *  input would be classified as an append, presence accounting would run
   *  again and an injected restore failure would fire and log twice. */
  const commit = (source: string, out: string): string => {
    prevSource = source;
    prevOutput = out;
    return out;
  };
  const legacyWhole = (source: string): string => processSlice(source, { legacy: true, probe: false }).out;
  const degrade = (source: string, reason: Exclude<DegradedReason, null>): string => {
    lineageDegraded = true;
    frozenSrcEnd = 0;
    frozenOut = '';
    onDegrade?.(reason);
    return commit(source, legacyWhole(source));
  };

  return function incrementalPreprocessLaTeX(source: string): string {
    // (1) identical replay: nothing else runs, the bitmap is already right.
    if (source === prevSource) return prevOutput;
    // (2) lineage classification and reset.
    const isAppend = source.length > prevSource.length && source.startsWith(prevSource);
    if (!isAppend) {
      frozenSrcEnd = 0;
      frozenOut = '';
      triggered = false;
      nextAttemptLen = 0;
      lineageDegraded = false;
      presence.reset();
      presence.add(source, 0);
    } else {
      // (3) presence accounting on EVERY new source value, before the
      // trigger gate: a literal private-use character in a trigger-free
      // frame is still in the document when the first `$` arrives.
      presence.add(source, prevSource.length);
    }
    // (4) the monotone trigger gate — BEFORE any degradation decision: the
    // legacy arm is not identity-preserving for trigger-free input
    // (`\text{a_b}` still transforms there), so exhaustion consulted here
    // would rewrite bytes the stateless path returns untouched.
    if (!triggered) {
      // Monotone gate (B4): while the ACCUMULATED string has no trigger, the
      // original early-exits with the identity — freezing transformed output
      // in that regime would diverge the moment a later `$` arrives and the
      // full run starts transforming the prefix (`\text{a_b}` quirk). Only
      // the appended chunk plus one char of overlap needs checking (`\[` /
      // `\(` can straddle the seam).
      const checkFrom = isAppend ? Math.max(0, prevSource.length - 1) : 0;
      if (!hasLatexTrigger(source.slice(checkFrom))) return commit(source, source);
      triggered = true;
    }
    // (5) a triggered lineage: existing degradation, or exhaustion over the
    // complete current source, means whole-source legacy — the stateless
    // path's answer for this input.
    if (lineageDegraded) return commit(source, legacyWhole(source));
    const mask = presence.select();
    if (mask === null) return degrade(source, 'mask-exhausted');
    // (6) candidate and tail, both with the one mask selected for this call.
    let active = source.slice(frozenSrcEnd);
    if (active.length > freezeThreshold && active.length >= nextAttemptLen) {
      const activeLength = active.length;
      let advanced = false;
      let frozenBytes = 0;
      const freeze = (cut: number, slice: SliceResult) => {
        frozenOut += slice.out;
        frozenSrcEnd += cut;
        active = source.slice(frozenSrcEnd);
        advanced = true;
        frozenBytes = cut;
      };
      const cut = findRawSafeCut(active);
      if (cut > 0) {
        const candidate = processSlice(active.slice(0, cut), {
          probe: true,
          mask,
          precedingText: source.slice(0, frozenSrcEnd),
        });
        if (candidate.degradedReason !== null) {
          // The attempt happened; the instrumentation contract is one
          // callback per attempt whatever its outcome.
          onAttempt?.({ activeLength, frozenBytes: 0 });
          return degrade(source, candidate.degradedReason);
        }
        if (candidate.quiescent) freeze(cut, candidate);
      }
      // A shorter fallback cut (largest cut before the first non-quiescent
      // segment) was designed and rejected: quiescence is segment-granular
      // (plain prose is ONE segment) and, with the threshold, the unfrozen
      // prefix before trouble is < threshold bytes anyway — the backoff
      // alone brings a permanently-failing document to ≈ the stateless
      // cost (oracle review, 2026-08-19).
      nextAttemptLen = advanced || !backoff ? 0 : active.length * 2;
      onAttempt?.({ activeLength, frozenBytes });
    }
    // Tail pass: transforms only — its `quiescent` is never read, only the
    // first run's B3 flag, so the per-run probes are skipped (they were
    // ~40% on top of the stateless cost for a document whose freeze never
    // succeeds; the backoff had already removed the other 2×).
    const tail = processSlice(active, { probe: false, mask, precedingText: source.slice(0, frozenSrcEnd) });
    if (tail.degradedReason !== null) return degrade(source, tail.degradedReason);
    // B3 seam correction: the original's run-level `trimEnd` reaches back
    // across our cut when the truncated `$$` block's run starts with
    // nothing but whitespace. Applied at COMPOSE time only — the frozen
    // output itself stays untrimmed, because the block will close in a
    // later append and the untrimmed bytes become correct again.
    const head = tail.truncatedAtSeamStart ? frozenOut.replace(/\s+$/, '') : frozenOut;
    return commit(source, head + tail.out);
  };
}

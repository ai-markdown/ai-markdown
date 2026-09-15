/** Conservative HTML admission rules for joining independently parsed trees. */

/**
 * Cut the frozen prefix from the previous trees, drop injected-def nodes
 * from the tail, re-base the tail, synthesize the root-level `'\n'` seam
 * separator (mdast-util-to-hast's `wrap()` inserts one strictly BETWEEN
 * root children — the full parse has it at the prefix/tail junction, the
 * tail-only parse does not), and join into fresh root objects. Fresh roots
 * every frame keep blockMemo's node-identity assumptions intact while
 * never mutating the previous frame's roots.
 */
/** A tag NAME ends at whitespace, `/`, `>` or the end of the value — the
 *  HTML tag-name grammar, and the same terminator set the scanner's
 *  `TAG_OR_COMMENT_RE` / `isType7Line` use, so a custom element whose name
 *  merely starts with a table-part name (`<col-md-6>`, `<td-cell>`,
 *  `<caption-box>`) is not a table part here either. The regexes below
 *  used `\b`, which treats `-` as a boundary: the scanner granted such a
 *  document a boundary and the splice refused it every frame (measured:
 *  `<col-md-6>` + 400 paragraphs in 60 frames, 426 ms against 26 ms for
 *  `<section>`). End of value keeps the old `\b` behaviour for `<col` cut
 *  off at the end of a value. `detectorConsistency`'s guard-vs-scanner
 *  pin derives its corpus from the scanner's name lists so the two
 *  cannot drift apart again. */
const TAG_NAME_END = '(?=[\\s/>]|$)';

/** Table-part START tags whose appearance outside a table re-routes parse5's
 *  tree construction for the rest of the document. */
export const TABLE_PART_TAG_RE = new RegExp(`<(?:td|th|tr|tbody|thead|tfoot|caption|col|colgroup)${TAG_NAME_END}`, 'i');

/** Same scan, but positioned: `<table>` / `</table>` and every table part in
 *  one raw-HTML value, in order. */
const TABLE_TOKEN_RE = new RegExp(
  `<(\\/?)(table|td|th|tr|tbody|thead|tfoot|caption|col|colgroup)${TAG_NAME_END}`,
  'gi'
);

/**
 * Does any table part in `values` sit OUTSIDE a table? Only those re-route
 * parse5; a well-formed `<table><tr><td>a</td></tr></table>` does not, and
 * bailing on it cost every later frame a full parse (2026-08-20 B1 — the
 * scanner's TABLE_PART_NAMES poison had the same gap; keep the two in step).
 *
 * Depth runs across the whole sequence because `hast-util-raw` feeds every
 * raw value to ONE parse5 instance: a `<table>` opened in one html node is
 * still open in the next. Unbalanced `</table>` clamps at zero rather than
 * going negative, so a stray close cannot mask a later stray part.
 */
export function hasStrayTablePart(values: Iterable<string>): boolean {
  return scanTableParts(values, 0).stray;
}

/** The scan behind `hasStrayTablePart`, resumable: `depth` is the table
 *  depth left by the values already scanned, and the returned depth is the
 *  one to resume from. The splice cache scans only the html values the
 *  boundary advanced over since the last frame; the whole frozen prefix
 *  was scanned exactly once, in order, just as the one-shot form does. */
export function scanTableParts(values: Iterable<string>, depth: number): { stray: boolean; depth: number } {
  for (const value of values) {
    TABLE_TOKEN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TABLE_TOKEN_RE.exec(value)) !== null) {
      const closing = m[1] === '/';
      const tag = m[2].toLowerCase();
      if (tag === 'table') {
        depth = closing ? Math.max(0, depth - 1) : depth + 1;
        continue;
      }
      if (depth === 0) return { stray: true, depth };
    }
  }
  return { stray: false, depth };
}

/** `startTagInTemplate` routes these names to "in head" WITHOUT first popping
 *  the template insertion mode — unlike every other start tag, which pops,
 *  pushes "in body" and REPROCESSES. So when one of them opens a raw-text
 *  region, `originalInsertionMode` is captured as IN_TEMPLATE in a tail-only
 *  parse and as IN_BODY in the full one. On the first stray end tag parse5
 *  leaves TEXT mode and RESTORES that captured mode, and from there the two
 *  parses dispatch differently: `</p>` synthesizes an empty paragraph in
 *  "in body" and is ignored in "in template".
 *
 *  `a\n\n<title>\n\n*b*\n` — sixteen bytes — was a live under-block:
 *  boundary 3, and the full parse has an empty `<p>` the spliced tree lacks.
 *  Same for `<noframes>`, and for `<script>` when the double-escape keeps the
 *  raw-text region open past its apparent closer.
 *
 *  `textarea`/`iframe`/`noembed`/`xmp` take the default branch, pop first and
 *  capture the CONVERGED mode — measured safe, and left alone. */
const HEAD_ROUTED_NAMES = new Set([
  'base',
  'basefont',
  'bgsound',
  'link',
  'meta',
  'noframes',
  'script',
  'style',
  'template',
  'title',
]);

/** The head-routed names that open a raw-text region (RCDATA / RAWTEXT /
 *  script data) — the ones whose capture becomes observable. */
const HEAD_ROUTED_RAW_TEXT_RE = /<(script|style|title|noframes)(?=[\s/>])/i;

const ANY_START_TAG_RE = /<([a-z][a-z0-9-]*)(?=[\s/>])/gi;

/** True when the tail's leading html run opens one of those regions with the
 *  template mode still uncaptured, and does not honestly close it inside the
 *  run. The closer must be inside the RUN, not the child: `<title>` block,
 *  blank line, `</title>` block closes it and is measured safe. */
export function headRoutedCaptureUnclosed(values: readonly string[]): boolean {
  if (values.length === 0) return false;
  const joined = values.join('\n');
  const opener = HEAD_ROUTED_RAW_TEXT_RE.exec(joined);
  if (opener === null) return false;
  // Any NON-head-routed start tag before the opener already popped the
  // template mode, so both parses captured the same one and this is safe.
  // Deciding that needs to know which `<…>` are markup, and a raw construct
  // makes that undecidable by regex: parse5 ends a bogus comment at the FIRST
  // `>`, so whether the `<div>` in `<![CDATA[<div>data</div>]]>` is a start
  // tag depends on where that `>` landed. Refuse to conclude convergence at
  // all when one is present — over-blocks, and the alternative was a live
  // under-block (fuzz seed 20270403, a CDATA between the comment and the
  // `<title>`).
  const before = joined.slice(0, opener.index);
  if (/<[!?]/.test(before)) return true;
  ANY_START_TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ANY_START_TAG_RE.exec(before)) !== null) {
    if (!HEAD_ROUTED_NAMES.has(m[1].toLowerCase())) return false;
  }
  const name = opener[1].toLowerCase();
  const after = joined.slice(opener.index + opener[0].length);
  if (name === 'script') {
    const close = after.search(/<\/script(?=[\s/>])/i);
    // No closer, or a `<!--` before it: the escape states may keep the region
    // open past that tag, so the capture is still live. Over-blocks the
    // `<!-- … --> </script>` re-exit case, knowingly.
    return close === -1 || /<!--/.test(after.slice(0, close));
  }
  return !new RegExp(`</${name}(?=[\\s/>])`, 'i').test(after);
}

/** The two END tags HTML synthesizes (`<br>` / empty `<p>`) instead of
 *  dropping. Complete names only (see `TAG_NAME_END`): `</p-x>` is a
 *  custom element's end tag, which parse5 drops like any other. */
export const STRAY_SYNTHESIZED_END_TAG_RE = new RegExp(`<\\/(?:br|p)${TAG_NAME_END}`, 'i');

/** parse5 raw-text elements (RAWTEXT / RCDATA / script data / plaintext),
 *  matching the scanner's RAW_TEXT_ELEMENTS (`noscript` excluded —
 *  scriptingEnabled: false). */
const RAW_TEXT_OPEN_RE = /<(script|style|textarea|title|xmp|iframe|noembed|noframes|plaintext)(?=[\s/>])/gi;

/**
 * Does any frozen html block leave a parse5 raw-text REGION open at its own
 * end? Then the element crosses OUT of its micromark block — the wrap
 * separator between that block and the next becomes element text (stripped
 * with a `<script>`, swallowed into content otherwise), and the
 * separator-credit model below double-counts the gap (P3b batch 1's
 * measured counterexample: the F6 recovery granted boundary 60 on the
 * double-escape document and the spliced frame carried an extra root
 * `"\n"`). The scanner deliberately RELEASES such prefixes once the
 * element truly closes (the retired poison); the splice refuses them
 * instead — the system contract is scanner boundary PLUS splice guards.
 *
 * Script regions honour the escape ladder the way the scanner does: a
 * `<!--` with no `-->` before the apparent `</script>` keeps the region
 * open past it (double-escape may be live — over-refuses the harmless
 * single-escaped case where no nested `<script` follows, knowingly).
 * Openers inside comments or quoted attribute values over-match — every
 * false positive only refuses a splice (full-parse fallback).
 */
export function rawTextRegionCrossesOut(values: Iterable<string>): boolean {
  for (const value of values) {
    let pos = 0;
    for (;;) {
      RAW_TEXT_OPEN_RE.lastIndex = pos;
      const open = RAW_TEXT_OPEN_RE.exec(value);
      if (open === null) break;
      const name = open[1].toLowerCase();
      const bodyStart = open.index + open[0].length;
      const closeRe = new RegExp(`</${name}(?=[\\s/>])`, 'ig');
      closeRe.lastIndex = bodyStart;
      let close = closeRe.exec(value);
      if (name === 'script') {
        // Skip closers still inside a live escape: `<!--` before the
        // closer with no `-->` between them.
        while (close !== null) {
          const body = value.slice(bodyStart, close.index);
          const lastOpen = body.lastIndexOf('<!--');
          if (lastOpen === -1 || body.indexOf('-->', lastOpen + 4) !== -1) break;
          close = closeRe.exec(value);
        }
      }
      if (close === null) return true;
      pos = close.index + close[0].length;
    }
  }
  return false;
}

/** Single complete comment / PI / declaration / CDATA that begins with a
 *  construct parse5 turns into a NODE (a comment) — raw-time node
 *  guaranteed, sanitize strips it later, so its separator slots stay
 *  separate. `<!DOCTYPE …>` is the one declaration this is FALSE of:
 *  parse5's tokenizer recognizes it as a real doctype token, and fragment
 *  tree construction then DROPS it outright — no node ever exists, so the
 *  texts on either side MERGE at reparse time (release-gate finding B:
 *  classifying it "stripped ⇒ slots separate" split a seam text the full
 *  parse merges). Doctypes and anything unterminated or mixed → not
 *  classifiable here. Exported for the semantics pins. */
export function isSanitizeStrippedConstruct(value: string): boolean {
  const v = value.trim();
  return (
    (v.startsWith('<!--') && v.endsWith('-->')) ||
    (v.startsWith('<?') && v.endsWith('?>')) ||
    (v.startsWith('<![CDATA[') && v.endsWith(']]>')) ||
    (/^<![A-Za-z]/.test(v) && !/^<!doctype/i.test(v) && v.endsWith('>'))
  );
}

/** The trailing-slot rebuild's admission test — STRICTER than the seam
 *  classifier above, because the rebuild asserts the stripped child leaves
 *  EXACTLY one bare '\n' wrap slot and nothing else. The whole value must
 *  be ONE construct that parse5 tokenizes into a node and sanitize strips,
 *  covering the value EXACTLY: any surrounding bytes survive the strip as a
 *  text remnant that merges into a neighbouring slot, which the plain-'\n'
 *  rebuild cannot represent (`<!-- c --> </s>` leaves ` ` and the full
 *  parse's slot is `" \n"` — release-gate finding A). The construct ends
 *  are PARSE5's, not micromark's:
 *  - a comment also closes at `--!>` (micromark ignores it), so the first
 *    parse5 close must be the value's own terminal `-->`;
 *  - `<?…` / `<!x…` / `<![CDATA[…` in HTML content are ONE bogus comment
 *    running to the FIRST `>` — a `>` inside the micromark construct body
 *    ends the node early and leaves a remnant;
 *  - `<!doctype` never makes a node at all (see the seam classifier).
 *  Exported for the semantics pins. */
export function isExactSanitizeStrippedConstruct(value: string): boolean {
  if (value.startsWith('<!--')) {
    if (value.length < 7 || !value.endsWith('-->')) return false;
    // First close scanned from past the opener; an overlap-close empty
    // comment (`<!--->`) is refused — conservative, full parse instead.
    const close = value.indexOf('-->', 4);
    const bangClose = value.indexOf('--!>', 4);
    if (close !== value.length - 3) return false;
    return bangClose === -1 || bangClose > close;
  }
  if (/^<!doctype/i.test(value)) return false;
  if (value.startsWith('<?') || /^<!(?:[A-Za-z]|\[CDATA\[)/.test(value)) {
    return value.indexOf('>') === value.length - 1;
  }
  return false;
}

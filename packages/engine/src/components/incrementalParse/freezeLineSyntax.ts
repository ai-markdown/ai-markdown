/** Line grammar, HTML taxonomy and pure classification helpers. */
import { htmlBlockNames } from 'micromark-util-html-tag-name';
import { type MdBlock, type P5Tok, type TagAttrState } from './freezeScanState';
import { FOOTNOTE_DEF_RE } from './referenceTaint';

/** CommonMark type-6 block tag names (micromark's own list), lowercase. */
export const TYPE6_NAMES = new Set(htmlBlockNames);

/** Table-part tag names: a stray one outside a table re-routes how parse5
 *  builds every LATER GFM table (cell text foster-parented to the root —
 *  v2.4.2 review P1-2; the splice bails on any such tag in the frozen
 *  prefix). Poisoning candidates from the tag on at the scanner saves the
 *  per-frame scan + tail parse + splice attempt that the bail would throw
 *  away, and keeps the direction battery honest (soak 2026-08-19: a
 *  `<td>` prefix froze a table whose shape depended on the tail). Same
 *  list as spliceParse's TABLE_PART_TAG_RE. */
export const TABLE_PART_NAMES = new Set(['td', 'th', 'tr', 'tbody', 'thead', 'tfoot', 'caption', 'col', 'colgroup']);

/** parse5 tree-construction CONSUMES these tokens: `rehype-raw` parses in
 *  FRAGMENT mode with a `<template>` context, so the run starts in "in
 *  template" and `startTagInTemplate` routes these names onward to the modes
 *  that absorb them into document structure — they emit NO node into the
 *  fragment. Their bytes
 *  vanish and the text nodes on either side MERGE into one — a merge whose
 *  result STARTS BEFORE the construct. That is retroactive: a `<!DOCTYPE>`
 *  arriving later rewrites hast the scanner already froze (2026-08-20,
 *  16800-shape sweep: `` `\`\`\`\n\`\`\`\n\n<!DOCTYPE>\ne` `` — the text node at
 *  index 1 goes `"\n"` → `"\n\n"`). Every other line-model invariant here
 *  assumes a confirmed line only affects itself and what follows, so these
 *  names cannot be modelled — they poison the whole document instead.
 *
 *  Counter-intuitively an UNCLOSED `<body>` was already safe: it left
 *  `openTotal` at 1, which blocked candidates by accident. Only the
 *  BALANCED `<body>…</body>` form reaches zero and freezes across. */
const DOCUMENT_STRUCTURE_NAMES = new Set(['html', 'head', 'body', 'frameset']);

/** The RULE the four names above are one mechanism of, keyed on the
 *  consequence rather than on the route that produces it: **parse5 builds no
 *  element under this tag name**. `openStack` is a MODEL of parse5's
 *  open-element stack, so for these names every entry in it is a phantom —
 *  and the unbalanced form is safe only by the accident the note above
 *  records for `<body>`, while the BALANCED pair pops back to
 *  `openTotal === 0` and freezes across a merge parse5 already performed.
 *
 *  Three mechanisms, one consequence, which is why the list cannot be keyed
 *  on the mechanism:
 *   - `html`/`head`/`body`/`frameset` — routed out by "in template", above.
 *   - `frame` — parse5's insertion modes DISCARD the start tag outside a
 *     frameset. No element, no node, nothing to pop.
 *   - `image` — parse5 REWRITES it to `img`, so an element appears and
 *     `image` never does. `</image>` is then a stray end tag parse5 drops,
 *     merging the text on either side of it — F24's own hazard, reached
 *     through the one door F24's `idx === -1` branch cannot see, because the
 *     scanner's stack matched where parse5's would not have.
 *
 *  F28 (2026-08-29 review). `<frame>\n</frame>\n\n` froze all 18 bytes with
 *  the `\n` between the tags a live root text node (`7-8:text:"\n"` →
 *  `"\n\n"` on any append); `<image>` is the same 18 bytes. Both shipped from
 *  long before v2.6.0. Neither name occurs in `fuzzGenerators.ts`,
 *  `pinnedCorpus.ts` or anywhere else in this repo, so no past green run is
 *  invalidated — and nothing in the gate could have found them: the census
 *  alphabet's equivalence classes are the SCANNER's, so `frame` sat in one
 *  39-name class with `div`, and `image` is in no list at all.
 *
 *  Membership is MEASURED, not asserted — `measureBuildsElement` in
 *  `constructAxisProbe`, over a pool wider than this list and in both
 *  contexts the scanner distinguishes, so a missing name reds and not only an
 *  extra one. Table parts are not here: they build elements normally in this
 *  fragment context, and their own hazard is `strayTablePart`'s. */
export const NO_ELEMENT_NAMES = new Set([...DOCUMENT_STRUCTURE_NAMES, 'frame', 'image']);

/** The same retroactive constructs as literal openers, for the TRAILING
 *  PARTIAL line. That line is never confirmed and never enters the
 *  checkpoint, so `processConfirmedLine` cannot poison from it — yet the
 *  full parse the frozen prefix is checked against DOES see it, and a
 *  half-arrived `<!DOCTYPE html` already erases and merges (soak leg 1,
 *  shards 3 and 9: a snapshot cut mid-doctype froze at a boundary the
 *  arriving doctype then rewrote). */
const RETROACTIVE_TAG_NAMES = [...NO_ELEMENT_NAMES];

/** A tag-name terminator to parse5: whitespace, `/` or `>` (the tag-name
 *  state leaves on exactly these). Anything else continues the name, so
 *  `<header`, `<html-x`, `<bodyguard`, `<framework` and `<images` are
 *  other elements, not the retroactive ones. */
const isTagNameEnd = (c: number): boolean =>
  c === 32 || c === 9 || c === 10 || c === 12 || c === 13 || c === 47 /* / */ || c === 62; /* > */

/** Does a partial line already carry a retroactive construct? Matches
 *  COMPLETE openers only:
 *  - `<!doctype` needs no terminator (parse5's markup-declaration state
 *    recognizes the seven letters and emits a doctype token from there,
 *    even at end of input);
 *  - an element name (derived from `NO_ELEMENT_NAMES`, so this guard
 *    cannot drift from the poison confirmed lines get — it was transcribed
 *    until F28 and two names behind by then) must be followed by a
 *    name terminator. `<head` streamed as the start of `<header …>` is not
 *    a head tag, and a prefix match here poisoned every later frame of the
 *    stream, since every later frame still starts with those five bytes
 *    (37 of 41 frames full-parsed for `<header class="x">Title</header>`
 *    streamed byte by byte). A name that runs to the END of the partial
 *    line is not complete either: parse5 drops a tag cut off inside its
 *    name or attributes at end of input (eof-in-tag), so the full parse
 *    this frame is checked against sees no element there. `lineEndingFollows`
 *    is for callers that pass a CONFIRMED line (the line ending after it
 *    is a terminator to parse5, so `<head` at the end of such a line is a
 *    complete name).
 *  A "could still become one" arm was tried and reverted: every `<` is a
 *  prefix of every opener, so a stream cut right after a `<` dropped the
 *  boundary to 0 — and since the consumer takes
 *  `min(boundary, prev.stableBoundary)`, one transient dip disables
 *  freezing for the whole stream permanently. Frames that cut INSIDE an
 *  opener (`…<!DOCTYP`) need no suppression: the full parse they are
 *  checked against does not see a doctype there either, so the frozen
 *  prefix still matches. Suppresses the BOUNDARY only — nothing here may
 *  reach the checkpoint, since the tail is not confirmed. */
export function tailCarriesRetroactive(text: string, lineEndingFollows = false): boolean {
  const lower = text.toLowerCase();
  for (let i = lower.indexOf('<'); i !== -1; i = lower.indexOf('<', i + 1)) {
    if (lower.startsWith('<!doctype', i)) return true;
    const nameStart = lower.charCodeAt(i + 1) === 47 /* / */ ? i + 2 : i + 1;
    for (const name of RETROACTIVE_TAG_NAMES) {
      if (!lower.startsWith(name, nameStart)) continue;
      const after = nameStart + name.length;
      if (after === lower.length ? lineEndingFollows : isTagNameEnd(lower.charCodeAt(after))) return true;
    }
  }
  return false;
}

/** HTML start tags that BREAK OUT of foreign content (HTML spec "in foreign
 *  content": the svg/math is popped and the tag is processed as HTML). */
/** Elements whose CONTENT is parsed with HTML rules again inside svg/math. */
// `title` belongs here too: an SVG `title` is an HTML integration point, so
// its CONTENT is parsed with HTML rules (a `<g/>` inside it opens an element
// rather than honouring its self-closing flag). Adding the name is safe for
// the tokenizer question as well, because every call site asks BEFORE this
// tag's own `applyTag` counts it: while `<title>` itself is judged the count
// is still 0, so it does not switch to RCDATA — which is correct, a foreign
// `title` stays in the DATA state — and once it is open its children see
// HTML rules, which is also correct. `annotation-xml` is an HTML integration
// point only when its `encoding` is text/html or application/xhtml+xml;
// treating it as one unconditionally over-blocks, i.e. errs safe.
/** parse5 ignores an end tag whose element is not "in scope": the search walks
 *  DOWN the open-element stack and stops at a barrier. `<div><table></div>`
 *  therefore leaves the div OPEN — `</div>` is discarded, `</table>` pops only
 *  the table — and everything after it nests inside that div.
 *
 *  A name→count bag cannot see this: it decrements `div` because it counted a
 *  `div`, and reports balance. That is an UNDER-block, live since the scanner
 *  was written and found 2026-08-24 (`<div><table></div></table>` freezes at
 *  41 of 66 while the full parse nests the whole tail inside the div).
 *  `marquee`, `object`, `template` and `applet` are the same family.
 *
 *  That discard has a SECOND consequence, on end tags that are never in the
 *  source at all (F19, 2026-08-27). `hast-util-raw` serialises the whole mdast
 *  before re-parsing, so every markdown construct contributes a real tag pair
 *  to parse5's input: `>` becomes `<blockquote>…</blockquote>`, `#` becomes
 *  `<h1>…</h1>`, `*a*` becomes `<em>…</em>`. A barrier still OPEN when one of
 *  those GENERATED end tags fires discards it by the same scope walk — and the
 *  host then leaks, re-nesting everything after it (`><table>\n</table>` +
 *  blank + prose puts the tail paragraph INSIDE the blockquote; `# h <table>`
 *  inside the h1). For a formatting name the leak is worse: the element stays
 *  in the active-formatting-elements list and is RECONSTRUCTED around all
 *  following content, which is a live shipped divergence — `*<object>*\n
 *  </object>` + blank + prose wraps the tail in a top-level `<em>` that the
 *  incremental path never produces (23 bytes, every incremental frame).
 *  The closing walk below cannot see this: the barrier's own raw tags are
 *  BALANCED, and the tag that gets discarded was never scanned. So the second
 *  consequence needs its own guard — `scopeBarrierStraddlesHost`.
 *
 *  Per the HTML spec's "has an element in scope"; the MathML text integration
 *  points and the SVG ones are barriers too. */
export const SCOPE_BARRIER_NAMES = new Set([
  'applet',
  'caption',
  'html',
  'table',
  'td',
  'th',
  'marquee',
  'object',
  'template',
  'mi',
  'mo',
  'mn',
  'ms',
  'mtext',
  'annotation-xml',
  'foreignobject',
  'desc',
  'title',
]);

/** The two foreign-namespace roots markdown can reach. */
export const FOREIGN_ROOT_NAMES = ['svg', 'math'];

/** parse5's `SPECIAL_ELEMENTS`, all three namespaces flattened (7.3.0, the
 *  version behind `hast-util-raw`; `specialElementEndTag.test.ts` pins the
 *  set against the installed copy). Namespace is not tracked on
 *  `openStack`, so an SVG-only name (`desc`, `foreignobject`) counts as
 *  special in HTML content too. That over-claims, which only widens the
 *  discard below — the over-blocking side.
 *
 *  Why the scanner needs it (F29): parse5's "any other end tag" rule walks
 *  the open-element stack from the top and DISCARDS the token when a
 *  special element is met before the match. `<span>\n<div>\n</span>\n
 *  </div>` therefore leaves the span OPEN — `</span>` is dropped, `</div>`
 *  pops the div — and every later block nests inside it. The scope-barrier
 *  walk (F7) stops only at the barrier subset, so the bag read the pair as
 *  balanced and granted a boundary the full parse contradicts. */
export const P5_SPECIAL_NAMES = new Set([
  'address',
  'applet',
  'area',
  'article',
  'aside',
  'base',
  'basefont',
  'bgsound',
  'blockquote',
  'body',
  'br',
  'button',
  'caption',
  'center',
  'col',
  'colgroup',
  'dd',
  'details',
  'dir',
  'div',
  'dl',
  'dt',
  'embed',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'frame',
  'frameset',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hgroup',
  'hr',
  'html',
  'iframe',
  'img',
  'input',
  'li',
  'link',
  'listing',
  'main',
  'marquee',
  'menu',
  'meta',
  'nav',
  'noembed',
  'noframes',
  'noscript',
  'object',
  'ol',
  'p',
  'param',
  'plaintext',
  'pre',
  'script',
  'section',
  'select',
  'source',
  'style',
  'summary',
  'table',
  'tbody',
  'td',
  'template',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'title',
  'tr',
  'track',
  'ul',
  'wbr',
  'xmp',
  // MathML and SVG members.
  'mi',
  'mo',
  'mn',
  'ms',
  'mtext',
  'annotation-xml',
  'foreignobject',
  'desc',
]);

/** parse5's formatting names: their end tags run the adoption agency
 *  instead of the generic walk (`endTagInBody`, the first `case` group). */
export const P5_FORMATTING_NAMES = new Set([
  'a',
  'b',
  'big',
  'code',
  'em',
  'font',
  'i',
  'nobr',
  's',
  'small',
  'strike',
  'strong',
  'tt',
  'u',
]);

/** The other end-tag names `endTagInBody` handles by name that are NOT
 *  special: they take the address-like rule (in-scope walk, then pop
 *  through), never the generic one. Every remaining named case (`p`, `li`,
 *  `dd`, `dt`, `h1`-`h6`, `br`, `body`, `html`, `form`, `applet`,
 *  `object`, `marquee`, `template`, the block names) is special. */
const P5_NAMED_END_TAGS_NOT_SPECIAL = new Set(['dialog', 'search']);

/** True when parse5 resolves this end tag by the "any other end tag" rule:
 *  the stack walk stops at ANY special element, not only at a scope
 *  barrier. Special names are excluded even where parse5 would route some
 *  of them here (`</table>` in body mode): those names carry their own
 *  insertion-mode handling the line model does not have, and the
 *  `definitelyInsideTable` reader needs `table` to be popped exactly, not
 *  over-counted. */
export function takesGenericEndTagRule(name: string): boolean {
  return !P5_SPECIAL_NAMES.has(name) && !P5_FORMATTING_NAMES.has(name) && !P5_NAMED_END_TAGS_NOT_SPECIAL.has(name);
}

/** CommonMark type-1 block start names — start tags only. */
export const TYPE1_NAMES = new Set(['script', 'pre', 'style', 'textarea']);

/** parse5 elements whose CONTENT is text to the tokenizer (RAWTEXT /
 *  RCDATA / script data / plaintext): every `<…>` inside is text until the
 *  element's own end tag. Not the CommonMark type-1 list — `title`,
 *  `iframe`, `noframes`, `xmp`, `noembed` sit in the type-6 list, so their content is a normal html
 *  block to micromark yet text to parse5, and a `</div>` in there closed the
 *  outer div in the balance (2026-08-19 review r2 P1-4). `plaintext` never
 *  ends. */
export const RAW_TEXT_ELEMENTS = new Set([
  'script',
  'style',
  'textarea',
  'title',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  // NOT `noscript`: hast-util-raw constructs parse5 with
  // `scriptingEnabled: false`, under which `<noscript>` content is ordinary
  // HTML — modelling it as raw text ignored a `<b>` inside and under-blocked
  // (oracle review of the r2 batch; regression caught before release).
  'plaintext',
]);

/** Bytes parse5's DATA state acts on: `<` + letter / `!` / `/` / `?`.
 *  Everything else (a lone `<`, `< b`) is character data. Used by the
 *  `--!>` divergence-window check: a window containing none of these is
 *  text to BOTH grammars and may converge. */
export const P5_MARKUP_RE = /<[!/?A-Za-z]/;

/** Type-6 start: `<`/`</` + name + (whitespace | `>` | `/>` | EOL). */
export const TYPE6_START_RE = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?:[ \t\r]|\/?>|$)/;

/** Type-1 start: an OPEN tag of a raw-text name + (whitespace | `>` | EOL). */
export const TYPE1_START_RE = /^<(script|pre|style|textarea)(?:[ \t\r]|>|$)/i;

/** Type 1's end condition is a literal substring anywhere on the line —
 *  no attributes, no whitespace before `>` (CommonMark 4.6). */
export const TYPE1_CLOSE_RE = /<\/(?:script|pre|style|textarea)>/i;

/** Type-7 start, EXACT (§4.6 condition 7 + the §2.2 tag grammar): the whole
 *  line is one complete OPEN tag or one complete CLOSING tag, followed by
 *  whitespace only. Attribute values follow the spec grammar — a QUOTED
 *  value may contain `>` (`<span title="a>b">` alone on a line IS a type-7
 *  block), an unquoted value may not (`<span title=a>b>` is a paragraph),
 *  an attribute name is `[A-Za-z_:][A-Za-z0-9:._-]*`, an empty unquoted
 *  value (`<a href=>`) invalidates the tag, and `/` self-closing must sit
 *  directly before the `>` — every shape measured against micromark before
 *  the approximate `[^>]*` test this replaces was retired (it both missed
 *  the quoted-`>` class, which the retired `mayBeRawToMicromark` flag
 *  existed to cover, and
 *  over-accepted attribute garbage on non-type-6 names).
 *
 *  Closing tags take NO attributes (`</span a="b">` is a paragraph, and
 *  treating it as html flow made the scanner apply a close parse5 never
 *  sees: `<span>\n\n</span a="b">\n\ntail` froze past a still-open span —
 *  oracle re-check of the r2 batch. Type 6 is unaffected — its names are
 *  recognized on `</name` + whitespace regardless of what follows.) */
const isSpaceTab = (c: number): boolean => c === 32 || c === 9;

const isAsciiAlpha = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);

const isAlnum = (c: number): boolean => isAsciiAlpha(c) || (c >= 48 && c <= 57);

/** completeAttributeName continuation set: alphanumeric, `-` `.` `:` `_`. */
const isAttrNameRest = (c: number): boolean => isAlnum(c) || c === 45 || c === 46 || c === 58 || c === 95;

/** completeAttributeValueUnquoted EXIT set (the value may not contain
 *  these; note `=` exits into completeAttributeNameAfter, which happily
 *  consumes another `=` — so `<foo a=b=c>` IS a complete tag to micromark,
 *  looser than the spec's written grammar, measured and matched here). */
const isUnquotedExit = (c: number): boolean =>
  Number.isNaN(c) || c === 34 || c === 39 || c === 47 || c === 60 || c === 61 || c === 62 || c === 96 || isSpaceTab(c);

/** The attribute area + `>` of a complete OPEN tag, transcribed state for
 *  state from micromark's html-flow complete path (nameBefore / name /
 *  nameAfter / valueBefore / valueQuoted(+After) / valueUnquoted / end).
 *  Returns the index just past the closing `>`, or -1 where micromark
 *  reaches `nok`. */
const completeOpenTagRest = (t: string, from: number): number => {
  let i = from;
  for (;;) {
    // completeAttributeNameBefore
    const c = t.charCodeAt(i);
    if (c === 47 /* / */) {
      i += 1;
      break; // → completeEnd
    }
    if (isSpaceTab(c)) {
      i += 1;
      continue;
    }
    if (!(c === 58 || c === 95 || isAsciiAlpha(c))) break; // → completeEnd
    i += 1; // completeAttributeName
    while (isAttrNameRest(t.charCodeAt(i))) i += 1;
    // completeAttributeNameAfter — also re-entered after an unquoted value,
    // which is what makes `=` chains legal.
    for (;;) {
      while (isSpaceTab(t.charCodeAt(i))) i += 1;
      if (t.charCodeAt(i) !== 61 /* = */) break; // → completeAttributeNameBefore
      i += 1; // completeAttributeValueBefore
      while (isSpaceTab(t.charCodeAt(i))) i += 1;
      const v = t.charCodeAt(i);
      if (Number.isNaN(v) || v === 60 || v === 61 || v === 62 || v === 96) return -1;
      if (v === 34 || v === 39) {
        // completeAttributeValueQuoted: anything but the marker or EOL.
        i += 1;
        while (t.charCodeAt(i) !== v) {
          if (i >= t.length) return -1;
          i += 1;
        }
        i += 1;
        // completeAttributeValueQuotedAfter: `/`, `>` or whitespace only.
        const a = t.charCodeAt(i);
        if (!(a === 47 || a === 62 || isSpaceTab(a))) return -1;
        break; // → completeAttributeNameBefore
      }
      // completeAttributeValueUnquoted (possibly empty: `<a b=/>` is
      // complete — the `/` exits straight through nameAfter to the end).
      while (!isUnquotedExit(t.charCodeAt(i))) i += 1;
      // → completeAttributeNameAfter(code) — loop.
    }
  }
  // completeEnd
  return t.charCodeAt(i) === 62 /* > */ ? i + 1 : -1;
};

/** Whether a line (leading indent stripped) meets §4.6 condition 7 — one
 *  complete open or closing tag, whitespace only after — EXACTLY as
 *  micromark decides it, including its tagName dispatch:
 *  - a type-6 NAME never reaches condition 7 (`<div a="b>">` is type 6,
 *    `</div>` too — realT6 at the call site agrees);
 *  - an OPEN raw-text name is type 1 — UNLESS the name is followed by `/`
 *    (`<style/>` is a complete type-7 tag, measured);
 *  - a CLOSING tag takes no attributes but its name is unrestricted:
 *    `</style>` alone on a line IS type 7 (the earlier "paragraph as end
 *    tags" note in Table A was wrong, and harmless only while
 *    the retired `mayBeRawToMicromark` flag blanket-covered every
 *    `<`-starting line).
 *  A lone `\r` is a LINE ENDING to micromark, not tag whitespace — the
 *  classification runs on the segment before it (the rest of the physical
 *  line is the block's first content either way). */
export const isType7Line = (line: string): boolean => {
  const cr = line.indexOf('\r');
  const t = cr === -1 ? line : line.slice(0, cr);
  if (t.charCodeAt(0) !== 60 /* < */) return false;
  let i = 1;
  const closing = t.charCodeAt(i) === 47;
  if (closing) i += 1;
  if (!isAsciiAlpha(t.charCodeAt(i))) return false;
  const nameStart = i;
  i += 1;
  while (isAlnum(t.charCodeAt(i)) || t.charCodeAt(i) === 45) i += 1;
  const c = t.charCodeAt(i); // NaN at end of line
  // tagName exit set (EOL / `/` / `>` / whitespace); anything else is nok.
  if (!(Number.isNaN(c) || c === 47 || c === 62 || isSpaceTab(c))) return false;
  const name = t.slice(nameStart, i).toLowerCase();
  if (!closing && c !== 47 && TYPE1_NAMES.has(name)) return false; // type 1
  if (TYPE6_NAMES.has(name)) return false; // type 6 (or its basicSelfClosing)
  if (closing) {
    // completeClosingTagAfter: whitespace, then completeEnd's `>`.
    while (isSpaceTab(t.charCodeAt(i))) i += 1;
    if (t.charCodeAt(i) !== 62) return false;
    i += 1;
  } else {
    i = completeOpenTagRest(t, i);
    if (i === -1) return false;
  }
  // completeAfter: whitespace only to the end of (micromark's) line.
  while (isSpaceTab(t.charCodeAt(i))) i += 1;
  return i >= t.length;
};

export const mdHtml = (b: MdBlock, type: 1 | 2 | 3 | 4 | 5): boolean => b.kind === 'html' && b.type === type;

/** A type-1 block whose element is RAW TEXT to parse5 too — the state in
 *  which both grammars agree every byte up to the closer is content. The
 *  `pre` half of type 1 is deliberately excluded (F13). */
export const mdType1RawText = (b: MdBlock): boolean => b.kind === 'html' && b.type === 1 && b.raw;

/** Types 2-5 open: the interiors both grammars agree are raw content. */
export const mdHtml25 = (b: MdBlock): boolean => b.kind === 'html' && b.type >= 2 && b.type <= 5;

/** "Comment content" for the tag walk's markup decision — the union of the
 *  two grammars' comment states, so bytes are skipped as comment interior
 *  if EITHER grammar is still inside one (the divergence between them is
 *  poisoned at the point it opens; neither field alone may release the
 *  other's block). */
export const commentEitherOpen = (md: MdBlock, p5: P5Tok): boolean => mdHtml(md, 2) || p5.kind === 'comment';

/** The raw-text MASK predicate: while it holds, `applyTag` admits only the
 *  element's own end tag, so nothing reaches the balance — a raw-text state
 *  the model believes in but parse5 is not in makes candidates MORE likely
 *  to survive (the unsafe direction). BOTH kinds mask; every read site goes
 *  through this one predicate so no rewrite can drop the script kind. */
export const inRawTextTok = (t: P5Tok): t is Extract<P5Tok, { kind: 'rawText' | 'script' }> =>
  t.kind === 'rawText' || t.kind === 'script';

/** The open raw-text element's name, or null when none is open. */
export const rawTextElement = (t: P5Tok): string | null =>
  t.kind === 'rawText' ? t.element : t.kind === 'script' ? 'script' : null;

/** Elements parse5 inserts WITHOUT pushing them on the open-element stack.
 *  This is parse5's list, not the HTML spec's void-element list: the spec
 *  names fourteen, and parse5 additionally inserts `basefont`, `bgsound`
 *  and `keygen` as void (the first two through "in head", `keygen` through
 *  "in body"). Omitting the three counted them OPEN forever, which
 *  over-blocks — the safe direction, and why it survived; the dangerous
 *  direction (a name here that parse5 really keeps open) was measured
 *  empty. `frame` is deliberately NOT here — parse5 builds no element for
 *  it, which is a different fact from "void" — and it belongs to
 *  `NO_ELEMENT_NAMES` instead. It used to say the `frameset` poison covered
 *  it; that was a defence keyed on `frameset` against a hazard spelled
 *  `frame`, and it was wrong for as long as it was written (F28). */
export const VOID_TAGS = new Set([
  'area',
  'base',
  'basefont',
  'bgsound',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'keygen',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** CommonMark list markers at block indent (bullet or ordered), incl. bare `-`. */
export const LIST_MARKER_RE = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;

/** A line that OPENS a container holding content: a blockquote marker (a
 *  bare `>` counts — the quote is open either way) or a list marker WITH
 *  content on the same line. A BARE marker is excluded on purpose: an
 *  empty item holds no paragraph, so the next line at block indent is
 *  neither its content nor a lazy continuation, and the interrupt answer
 *  there is decided (the battery measures it as OPENING). Footnote
 *  definitions and def-list descriptions arm through their own regexes at
 *  the call site. Arms `containerMaybeOpen`. */
export const CONTAINER_MARKER_RE = /^ {0,3}(?:>|(?:[-*+]|\d{1,9}[.)])[ \t]+\S)/;

/** Line classes for the content-tracking decision table (the type-7
 *  interrupt input). All run on the TRIMMED line (indent ≤ 3 — the ≥ 4
 *  case is decided before them). Measured against micromark 2026-08-25:
 *  type 7 OPENS after each class below, and after html-block lines and
 *  fence/math lines; it stays REFUSED after paragraph, definition,
 *  footnote-definition, list-item-with-content and blockquote lines. */
export const ATX_HEADING_RE = /^#{1,6}(?:[ \t]|$)/;

export const THEMATIC_BREAK_RE = /^(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;

/** A BARE list marker (`-` / `*` / `+` / `1.` alone): opens an EMPTY item
 *  and closes any content — micromark opens type 7 on the next line. */
export const BARE_MARKER_RE = /^(?:[-*+]|\d{1,9}[.)])[ \t]*$/;

/** Setext-underline shapes not already claimed above: `=+`, and `--`
 *  (a lone `-` is BARE_MARKER, three+ are THEMATIC — same false answer).
 *  These CONSUME an open paragraph into a heading (content closes); with
 *  no paragraph open they ARE a paragraph (content opens). */
export const SETEXT_LEFTOVER_RE = /^(?:=+|--)[ \t]*$/;

/** Definition-list description marker (micromark-extension-definition-list). */
export const DEF_LIST_DD_RE = /^ {0,3}:[ \t]/;

/** A whole line that is one closing tag and nothing else (`</div>`,
 *  `</x-y>`, `</br>`). Such a line emits NO node through rehype-raw's
 *  fragment context, so it cannot pin the blocker-6 seam. */
export const CLOSE_TAG_ONLY_RE = /^[ \t]*<\/[A-Za-z][A-Za-z0-9-]*[ \t]*>[ \t\r]*$/;

export const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/** Leading dollar RUN at block indent — math flow fences carry a LENGTH
 *  like code fences (`$$$$` opens a fence only ≥4 dollars can close;
 *  K=4 census counterexample), and the meta after the run may not contain
 *  `$` (a rest with any `$` is inline math / literal text, NOT a flow
 *  open). */
export const MATH_RUN_RE = /^ {0,3}(\$\$+)/;

/** Opening/closing tags (name must be followed by attr/close syntax, which
 *  excludes autolinks like `<https://…>`), plus comment delimiters. */
export const TAG_OR_COMMENT_RE = /<(\/?)([A-Za-z][A-Za-z0-9-]*)(?=[\s/>])([^>]*)>|<!--|-->|--!>/g;

// Empty comments whose closer OVERLAPS the opener (`<!-->`, `<!--->`):
// CommonMark 0.31 (html flow AND text) and parse5 all close them on the
// spot. A `<!--` match followed by `>`/`->` must not open a comment — the
// scan would then skip REAL markup up to the next stray `-->` (2026-08
// project-review P1: `<!-->\n<details>\n-->` froze past a parse5-open
// `<details>`, the v1.5.1 swallow class). Handled inline in the token
// scan and in `floatingResidue`, which share the state machine.
/** A tag START whose `>` has not arrived on this line — `<div` at EOL, or
 *  `<div class="a"` with attributes continuing on the next line. Counted as
 *  an open (probe-confirmed hazard) and remembered as PENDING: a tag can
 *  carry attributes across line endings but never across a blank line, so
 *  a pending open that reaches the paragraph's blank line without a `>`
 *  was prose (`if x<y then`) and its phantom open is reverted there. Any
 *  later `>` before that confirms it (kept open — over-block at worst).
 *  Without the revert the phantom open lived forever and the whole rest of
 *  the stream lost the splice, not just that paragraph (2026-08 project
 *  review, eng-parse-06). */
export const TRUNCATED_TAG_RE = /<(\/?)([A-Za-z][A-Za-z0-9-]*)([^>]*)$/;

/** Anchor for the truncated-tag check: the LAST `<` that starts a tag name
 *  (`<x` / `</x`). Anchoring on the last `<` of any kind missed `<div a=<`
 *  (attribute bytes may hold `<`; parse5 keeps the div open) — oracle
 *  re-check of r2, pre-existing. */
export const TAG_START_LT_RE = /<\/?[A-Za-z]/g;

/** Advance the attribute-area state over `text[from, to)`; returns the
 *  index of the `>` that ENDS the tag, or -1 with the state carried in
 *  `out.state`. */
export function scanTagAttrs(text: string, from: number, to: number, out: { state: TagAttrState }): number {
  let st = out.state;
  for (let i = from; i < to; i++) {
    const c = text[i];
    if (st === '"' || st === "'") {
      if (c === st) st = 'outside';
      continue;
    }
    const ws = c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
    if (st === 'afterEq') {
      if (ws) continue;
      if (c === '"' || c === "'") st = c;
      else if (c === '>') return i;
      else st = 'unquoted';
      continue;
    }
    if (st === 'unquoted') {
      if (ws) st = 'outside';
      else if (c === '>') return i;
      continue;
    }
    // outside
    if (c === '=') st = 'afterEq';
    else if (c === '>') return i;
  }
  out.state = st;
  return -1;
}

const BACKTICK_RUN_RE = /`+/g;

export function computeIndent(text: string): number {
  let indent = 0;
  for (const ch of text) {
    if (ch === ' ') indent += 1;
    else if (ch === '\t') indent += 4 - (indent % 4);
    else break;
  }
  return indent;
}

/**
 * Blocker 4: can the (possibly partial) line ever match `^ {0,3}:[ \t]`
 * after future appends? Appends only extend the line rightward, so a line
 * is settled once its existing characters already contradict the pattern.
 */
export function canBecomeDdLine(text: string, confirmed: boolean): boolean {
  let i = 0;
  while (i < text.length && text[i] === ' ') i += 1;
  if (i > 3) return false; // indent too deep, regardless of future appends
  if (i === text.length) return !confirmed; // only spaces so far — a partial line may still grow a `:`
  if (text[i] !== ':') return false;
  if (i + 1 === text.length) return !confirmed; // trailing `:` — a partial line may still grow the space
  return text[i + 1] === ' ' || text[i + 1] === '\t';
}

/**
 * Same-line code-span masking (module docs). Returns the masked text, or
 * null when masking is unsafe for this line (an unpaired run here or
 * earlier in the paragraph). Masked spans are replaced by spaces of equal
 * length so every offset stays valid.
 */
export function maskIntraLineCodeSpans(text: string, carryOpen: boolean): { masked: string | null; unpaired: boolean } {
  BACKTICK_RUN_RE.lastIndex = 0;
  const runs: Array<{ index: number; length: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = BACKTICK_RUN_RE.exec(text)) !== null) runs.push({ index: m.index, length: m[0].length });
  if (runs.length === 0) return { masked: carryOpen ? null : text, unpaired: false };
  // Pair equal-length runs leftmost-first (micromark's rule, same line).
  const spans: Array<[number, number]> = [];
  let unpaired = false;
  for (let i = 0; i < runs.length; i++) {
    const opener = runs[i];
    let matched = -1;
    for (let j = i + 1; j < runs.length; j++) {
      if (runs[j].length === opener.length) {
        matched = j;
        break;
      }
    }
    if (matched === -1) {
      unpaired = true;
      continue;
    }
    spans.push([opener.index, runs[matched].index + runs[matched].length]);
    i = matched; // consume through the closer
  }
  if (carryOpen || unpaired) return { masked: null, unpaired };
  if (spans.length === 0) return { masked: text, unpaired: false };
  let out = '';
  let cursor = 0;
  for (const [from, to] of spans) {
    out += text.slice(cursor, from) + ' '.repeat(to - from);
    cursor = to;
  }
  out += text.slice(cursor);
  return { masked: out, unpaired: false };
}

/** Blocker-3 classification of a block-START line (raw text; markers are
 *  never inside code spans at block indent). Returns the new rolling
 *  verdict, or null when the line is ambiguous (verdict unchanged). */
export function classifyBlockStart(text: string, indent: number, defListEnabled: boolean): boolean | null {
  if (indent >= 4) return true; // indented code / item continuation merges across blanks (A1)
  if (LIST_MARKER_RE.test(text) || FOOTNOTE_DEF_RE.test(text)) return true;
  if (defListEnabled && DEF_LIST_DD_RE.test(text)) return true;
  if (indent === 0) return false; // column-0 non-marker block terminates any list context
  return null; // indent 1–3 non-marker: ambiguous
}

// The name lists this scanner keys decisions on are also tabulated by
// `scannerNameLists.ts` (test-only, never bundled) so a test can derive its
// corpus from the scanner's own taxonomy. Add a list there whenever the
// scanner starts keying a decision on a new set of names. Exported for that
// table only:
export { DOCUMENT_STRUCTURE_NAMES };

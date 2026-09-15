/**
 * TEST-ONLY generators for the fuzz arbiter (spliceFuzz.test.ts) and the
 * direction battery (boundaryDirection.test.ts).
 *
 * Documents are composed from BLOCK-LEVEL constructs, not random bytes: the
 * detector's hazards are all structural (raw HTML balance, math fences,
 * reference resolution, continuation contexts), so uniform noise would test
 * the trivial "everything blocked / nothing interesting" regimes. Generation
 * is deliberately biased toward the five documented detector approximations
 * (APPROX #1-#5 in computeFreezeBoundary's module docs) and the one accepted
 * under-count edge (same-line tag before an unclosed raw opener).
 *
 * Labels are drawn from one SMALL shared pool so that ref uses and defs
 * collide across independently-drawn blocks — late-definition reach-back
 * (H1) and unresolved-taint regimes emerge naturally without explicit
 * pairing machinery (and shrink well, since blocks stay independent).
 *
 * Anti-vacuity bias (adversarial-review finding): docs carry ≥4 blocks,
 * separators are mostly blank lines, and hazard constructs mostly SETTLE —
 * an unclosed container at the top of a doc keeps the boundary at 0 for
 * every later frame, so a corpus of unclosed docs would exercise nothing
 * but the full-parse fallback. `spliceFuzz.test.ts` asserts aggregate
 * incremental-engagement floors per family to keep this honest.
 *
 * Two axes joined 2026-09-15 after a byte census of the pinned corpus: it
 * held ZERO U+0009 (`tabIndentArb`, `tabBenignArb`) and no tag name sharing
 * a prefix with a table part, a raw-text name or a document-structure name
 * (`tagNamePrefixArb`). Both are places where a scanner keyed on a name
 * list or a column count can drift from micromark and parse5 without any
 * existing family noticing.
 */

import fc from 'fast-check';

/** Shared label pool — small on purpose (see module docs). */
const LABELS = ['a', 'b', 'spec', '注一'] as const;

const labelArb = fc.constantFrom(...LABELS);

// --- inline fragments ---------------------------------------------------------

const plainInline = fc.constantFrom(
  'plain prose keeps flowing here',
  'and **bold** with `code` mixed in',
  '一段中文散文,含有标点。',
  'trailing words settle the line',
  // Prose `<letter` at end of line: a line-truncated "tag" that never gets
  // its `>` — the scanner counts it, then reverts it at the paragraph's
  // blank line (eng-parse-06). Placed LAST in a paragraph often enough by
  // the joiner to end lines.
  'compare a<b',
  // Prose `</letter` at end of line: a line-truncated CLOSING "tag". Never
  // counted — a close tag cannot carry attributes and a line-start `>`
  // is a blockquote, so it can only be prose (2026-08-19 review P1: the
  // corpus had truncated opens only, and the on-the-spot decrement let a
  // boundary cross a still-open `<style>`).
  'closing </b'
);

/** APPROX #1 — prose brackets count as reference taint. */
const proseBracketInline = labelArb.map((l) => `see [${l}] maybe, or [${l}][${l}] even ![${l}]`);

/** Code-span masking paths: intra-line pairs (maskable), an unpaired run
 *  (masking disabled for the paragraph), and double-backtick pairing. */
const codeSpanInline = fc.constantFrom(
  'inline `<div>` stays code',
  'a ref `[x]` in a span',
  'footnote-ish `[^n]` span',
  'double ``tick ` inner`` run',
  'an `unpaired run starts here'
);

/** A REAL tag on the same line as a raw opener/terminator: before an
 *  unclosed `<!--` / `<?` (once an accepted under-count edge — the scanner
 *  now masks raw spans and counts tags around them, v2.4.0 review P1/P4),
 *  and a real tag whose closing `>` hides inside a code-span mask
 *  (`<div x="\`">b\``: micromark parses the tag first — review R2(a)). */
const underCountInline = fc.constantFrom(
  '<b>x</b> <!-- trailing opener',
  '<i>y</i> <?php',
  '<details> <?php',
  'a <div x="`">b`'
);

/**
 * Unicode whitespace that JS `trim()`/`\s` strips but micromark does NOT
 * treat as markdown space (only U+0020 / U+0009 are). A line holding only
 * U+3000 or U+00A0 is a paragraph lazy-continuation line for micromark, not
 * a blank line; a fence closer followed by NBSP is not a closer. Both were
 * invisible to every generator (v2.4.1 review P1).
 */
const unicodeBlankArb = fc.constantFrom(
  'foo line\n\u3000\n\u3000\nbar joins the paragraph',
  'nbsp line\n\u00a0\nstill one paragraph',
  '```\ncode\n```\u00a0\nstill inside the fence\n```',
  '$$\nx\n$$\u3000\nstill inside math\n$$',
  // A def rest ending in NBSP is a PARAGRAPH (`[a]` stays a live ref); a
  // U+3000 before a paragraph-inline `<!--` is text, so the comment never
  // closes inside the paragraph and the `<details>` below is a real open
  // block (adversarial review of the first fix).
  '[a]: /u "t"\u00a0',
  '\u3000<!-- c\n<details>\n\n-->'
);

/** A shortcut reference whose label spans a soft line break — micromark
 *  allows it (the label normalizes to `l l`), while a per-line bracket
 *  scan never sees `[…]` closed on one line (v2.4.1 review P1). Paired
 *  with `crossLineDefLabelArb` so a later definition can retarget it. */
const crossLineRefInline = labelArb.map((l) => `see [${l}\n${l}] end`);

/** `[label](bad url)`: the inline resource FAILS micromark's grammar (space
 *  in a bare destination), so `[label]` is a live shortcut reference a later
 *  def retargets — the `(`-follow skip must not release it (v2.4.1 review
 *  follow-up). `[label](/u "t")` is the well-formed control. */
const failedInlineLinkInline = fc
  .tuple(labelArb, fc.boolean())
  .map(([l, ok]) => (ok ? `see [${l}](/u "t") linked` : `see [${l}](bad url) not a link`));

const inlineArb = fc.oneof(
  { weight: 4, arbitrary: plainInline },
  { weight: 1, arbitrary: crossLineRefInline },
  { weight: 1, arbitrary: failedInlineLinkInline },
  { weight: 2, arbitrary: proseBracketInline },
  { weight: 2, arbitrary: codeSpanInline },
  { weight: 1, arbitrary: underCountInline }
);

// --- block constructs ---------------------------------------------------------

const paragraphArb = fc.array(inlineArb, { minLength: 1, maxLength: 3 }).map((parts) => parts.join(', '));

/** settled=true means the construct closes what it opens. The doc assembler
 *  biases toward settled (adversarial-review: unclosed-at-top keeps the
 *  boundary at 0 and starves the splice path). */
const fencedCodeArb = fc
  .tuple(fc.constantFrom('```', '```ts'), fc.boolean())
  .map(([open, settled]) => `${open}\nconst x = "[a]<div>";\n${settled ? '```' : ''}`);

/** APPROX #5 — indented-code content is still scanned for tags/refs. */
const indentedCodeArb = fc.constantFrom('    <details>[a] scanned literal', '    [^b]: not a real def');

/**
 * Tab axis. micromark expands a tab to the next 4-column stop and so does
 * the scanner (`computeIndent`), and most of its line regexes admit
 * `[ \t]` — but the corpus never carried a single tab, so none of those
 * arms had ever been exercised from fuzz. Every shape here is one where a
 * tab DECIDES block structure rather than merely sitting in text:
 *
 *  - a tab after a list marker, an ordered marker, a `>` or a `#`;
 *  - a tab-indented continuation line / nested item inside a list;
 *  - tab-indented code (column 4 from one byte), and mixed space+tab runs
 *    that reach column 4 only because the tab stop rounds up;
 *  - tabs inside GFM table cells and around the pipes;
 *  - a tab-only line, which IS a blank line to micromark;
 *  - a tab before a fence closer: column 4, so NOT a closer — the fence
 *    stays open until the real one, exactly like the NBSP shape in
 *    `unicodeBlankArb`.
 *
 *  - a tab-indented ``` line (`\t````): indented code at root, but a fence
 *    OPENER inside a footnote body. After `[^a]: body\n\n` it opens a fence
 *    the next column-0 line leaves unclosed; the splice replay used to give
 *    the footer a stale end position for that shape (F30 in
 *    GRAMMAR-COVERAGE, found by fresh seeds 20260916 / 20260917; the
 *    four-space form is the same defect). Fixed in buildInjectionPrefix and
 *    pinned in tabIndentAxis.test.ts; the shape is back here so fuzz keeps
 *    reaching it.
 *
 * The benign side keeps freezing and carries the sampling weight; the
 * hazard side re-runs existing hazards under a tab (APPROX #5 literals in
 * tab code, a def / footnote / def-list line whose whitespace is a tab, a
 * task-list box after a tab, which the task tracker can now certify once
 * its paragraph closes).
 */
const tabBenignArb = fc.constantFrom(
  '-\ttab after marker\n-\tsecond item',
  '- item\n\ttab continuation line',
  '- a\n\t- nested by tab\n\t\tdeep continuation',
  '1.\tordered\n2.\titems',
  '| a\t| b |\n| -\t| - |\n|\t1\t|\t2\t|',
  '>\tquoted with tab\n>\t\tcode inside quote',
  '\tcode indented by tab\n\tsecond code line',
  '  \tcode via space+tab\n \t- not a list item',
  '#\ttab heading',
  'para line\n\t\npara after a tab-only blank',
  '```\ncode\n\t```\nstill inside the fence\n```',
  '-\t-\t-',
  'Setext title\n===\t',
  '\t```\nnot a fence opener at root, a fence inside a footnote body\n\tcode'
);
const tabIndentArb = fc.oneof(
  { weight: 3, arbitrary: tabBenignArb },
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      '\t<details>[a] scanned literal',
      '\t[^b]: not a real def',
      '\t<td>s</td>\n\ntail para',
      '[a]:\t/u\t"t"',
      '[^a]:\tbody text\n\n\ttab continuation',
      'Term line\n:\tdescription body',
      '-\t[x] task after a tab',
      '- [x]\ttask before a tab',
      '- item\n\n\t<div>\n\tin tab code\n\t</div>',
      '> q\n>\t```\n>\tfence in quote\n>\t```'
    ),
  }
);

const mathArb = fc.boolean().map((settled) => `$$\ne = mc^2\n${settled ? '$$' : ''}`);

/**
 * Overlapping / divergent terminators (2026-08 project-review P1 family):
 * constructs whose CLOSER shares bytes with the opener (`<!-->`, `<!--->`,
 * `<?>` — CommonMark and parse5 both close them on the spot), plus shapes
 * where micromark's block terminator and parse5's tokenizer disagree
 * (`--!>` closes an HTML comment for parse5 but is not `-->` for
 * CommonMark; a bogus comment `<?x >` closes at the FIRST `>` for parse5
 * but needs `?>` for CommonMark). Each is glued to a REAL `<details>` and a
 * stray terminator line: a scanner that leaves the construct open skips
 * the container and freezes past a parse5-open element (swallow class).
 * The unsettled openers get their `</details>` closer from HTML_CLOSERS
 * with the usual settle bias.
 */
const OVERLAP_OPENERS = ['<!-->', '<!--->', '<?>', '<!--x--!>', '<?x >'] as const;
const overlapTerminatorArb = fc
  .constantFrom(...OVERLAP_OPENERS)
  .map((opener) => `${opener}\n<details>\n${opener.startsWith('<?') ? '?>' : '-->'}`);
/** Same constructs self-contained on one line (resync check: the scanner
 *  must treat them as CLOSED and keep scanning the rest of the line). */
const overlapSettledArb = fc.constantFrom(
  '<!--> after an empty comment',
  '<!---> after an empty comment',
  '<?> after an empty pi',
  '<!--x--!> after a bang-closed comment <b>x</b>',
  // v2.4.0 review shapes: a stray end tag leaving whitespace-only remnant
  // after a closed comment (P2); a tag right after a PI terminator (P1); a
  // stray end tag html block whose dropped-tag remnant merges with the
  // wrap separator (P3).
  '<!-- c --> </s>',
  '<?x?><details>x</details>',
  '</t>\ntext after a stray end tag'
);

/**
 * CommonMark type-1 raw-text blocks (`<script>`/`<style>`/`<textarea>`/
 * `<pre>`): micromark ends them only at the matching end tag; parse5 keeps
 * script/style/textarea content as TEXT (a `<details>` inside is not an
 * element) while `<pre>` is a normal container. The scanner counts tags
 * inside them literally — over-block only — but the family was absent from
 * every generator (2026-08 project review), so the arbiter never saw it.
 */
const rawTextBlockArb = fc.constantFrom(
  '<script>\nlet s = "<details>[a]";\n</script>',
  '<style>\n.x::before { content: "</details>"; }\n</style>',
  '<textarea>\n<!-- not a comment here\n</textarea>',
  '<pre>\n<div>pre content</div>\n</pre>',
  "<script>alert('<div>')</script> same-line close"
);
/** Type-1 block BOUNDARIES, which differ from every other html block:
 *  the block ends at the line holding the literal closer, and a blank line
 *  does NOT end it. Both halves were mismodelled until 2026-08-20 (see
 *  type1BlockFlow.test.ts). The corpus could reach these shapes only when
 *  `sepArb` happened to pick a single `\n` between a raw-text block and a
 *  paragraph, which is why 50k splice samples and 20k direction prefixes
 *  passed for releases on end — bake the shapes in instead of leaving them
 *  to separator luck. Invalid closers (`</script >`, `</script/>`) leave the
 *  block open to EOF and are the second half of the family. */
const type1BoundaryArb = fc.constantFrom(
  '<script>\nlet a = 1;\n</script>\np <div> x </div a="b"> y',
  '<pre>\ncode\n</pre>\np <div> x </div a="b"> y',
  '<style>\n.a{}\n</style>\np <div> x </div a="b"> y',
  '<textarea>\nt\n</textarea>\np <div> x </div a="b"> y',
  '<script>a</script>\np <div> y',
  '<script></script >\n\n```\n```',
  '<script>\nx\n</script/>\n\n<div>\nd\n</div>',
  '<pre>\nx\n</pre >\n\n```\ncode\n```',
  '<script>\nx\n</scripty>\n\n<!-- c -->'
);
/** B2/F13 — bogus-comment openers INSIDE a type-1 block. `pre` is html{1}
 *  to micromark and a DATA element to parse5 — the one `TYPE1_NAMES` member
 *  outside `RAW_TEXT_ELEMENTS` — so `<?x` / `<!y` / `<![CDATA[` / `</3` on
 *  its lines really open a bogus comment, which eats the `>` of the
 *  `</pre>` closer line and leaves the element open swallowing the rest of
 *  the document (F13, shipped; pinned in type1PreNotRawText.test.ts). The
 *  raw-text names are the control side: parse5 reads the same bytes as
 *  element TEXT, both grammars agree, and the doc keeps freezing. The
 *  pinned corpus had ZERO of these compositions when F13 shipped (6063
 *  entries, zero delta) — `rawTextBlockArb` carried the openers only under
 *  raw-text names, where they are inert. */
const preBogusOpenerArb = fc.oneof(
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      '<pre>\n<?x\n</pre>\n\ntail para',
      '<pre>\n<!y\n</pre>\n\ntail para',
      '<pre>\n<![CDATA[\n</pre>\n\ntail para',
      '<pre>\n</3\n</pre>\n\ntail para',
      '<pre> <?x\n</pre>\n\ntail para'
    ),
  },
  {
    // Controls: same openers under real raw-text names stay inert, and a
    // plain `<pre>` block closes cleanly — the family's freezable side.
    weight: 3,
    arbitrary: fc.constantFrom(
      '<style>\n<?x\n</style>\n\ntail para',
      '<script>\n<!y\n</script>\n\ntail para',
      '<textarea>\n<![CDATA[\n</textarea>\n\ntail para',
      '<pre>\nplain pre text\n</pre>\n\ntail para'
    ),
  }
);

/** parse5 RAWTEXT / RCDATA elements that sit in the CommonMark type-6 list
 *  (no hazardVerdict): their content is TEXT to parse5 — a `</div>` inside
 *  must not close anything (2026-08-19 review r2 P1-4). */
const rawTextElementArb = fc.constantFrom(
  '<div>\n<title>\n</div>\n</title>',
  '<div>\n<iframe>\n</div>\n</iframe>',
  '<div>\n<noframes>\n<!-- c -->\n</div>\n</noframes>',
  '<div>\n<xmp>\n</div>\n</xmp>',
  'para <title>x</div>y</title> z'
);

/**
 * parse5 tree-construction quirks no generator carried (v2.4.2 review P1):
 * a stray `</br>` / `</p>` end tag is SYNTHESIZED (`<br>` / empty `<p>`)
 * rather than dropped — the tail-only parse cannot reproduce that; a
 * stray `<td>` outside any table makes the following GFM table's cell text
 * foster-parent to the root and its skeleton vanish.
 */
const treeQuirkArb = fc.constantFrom(
  '</br>',
  '</p>',
  '</br>\ntext after a synthesized br',
  '<!-- c -->\n\n</br>',
  '<td>s</td>\n\n| a |\n| - |',
  '<td>s</td>\n\n| a | b |\n| - | - |\n| 1 | 2 |',
  '<td>s</td>\n\npara\n\n| a |\n| - |',
  '<col>',
  // 2026-08-26 review M5: a paragraph line ENDING in a truncated `<table`
  // is prose — parse5 discards the incomplete tag — yet the raw bag counted
  // it and `definitelyInsideTable()` suppressed the stray-part poison
  // (`compare a<table b\n<td>x</td>\n</table>` froze 59 of 63 bytes).
  // Pending truncated opens are subtracted now; pinned in
  // tablePartPoison.test.ts. The `>`-confirmed variant is the control: a
  // real table recovers the suppression on the spot.
  'compare a<table b\n<td>s</td>\n</table>\n\ntail para',
  'compare a<table b>\n<td>s</td>\n</table>\n\ntail para',
  'compare a<table b\n<col>\n\ntail para'
);

/** Cross-line tag garbage (oracle review of 2.4.4, pre-existing under-
 *  block): a line ending inside a tag leaves parse5's tokenizer in it, so a
 *  REAL-looking end tag on the next line is attribute garbage up to the
 *  first `>` — the outer element stays open. Open / close / void openers,
 *  a quoted `>`, and the completing `>` on its own line. */
const crossLineTagGarbageArb = fc.constantFrom(
  '<div>\n<div>\n</div\n</div>\n\ntail para',
  '<details>\n<summary>\n</summary\n</details>\n\ntail para',
  '<div>\n<br\n</div>\n\ntail para',
  '<div>\n</br\n</div>\n\ntail para',
  '<span>\n<div>\n</span\n</div\n>\n\ntail para',
  '<div>\ncontent\n</div\n>\n\ntail para',
  '<div>\n<b\ntitle=">"\n</div>\n\ntail para',
  '<div>\n<b class="x"\n</div>\n\ntail para',
  // NOT real html-flow starts (paragraphs): the next line's block is real.
  '</i\n<div>\n\ntail para',
  '<br\n<div>\n\ntail para',
  '</textarea\n<!-- c\n- li\n\ntail para',
  '</i\n<!-- c\n<div\n\ntail para',
  // De-indent out of a list item's html block: the `<div>` is real.
  '- a\n  </div\n<div>\n\ntail para'
);

/** Second review round (2026-08-19 r2): quotes and bogus comments across
 *  the line ending — its own family so the meters see enough of each. */
const danglingQuoteArb = fc.constantFrom(
  // Dangling OPEN quote at the line ending (r2 P1-2): the next line's `>`
  // is a value byte; the outer element stays open. Its own family so the
  // coverage meter clears its floor at any seed.
  '<div>\n<hr title="\n<p></div>\n\ntail para',
  '<div>\n<span class="\n</div>\n\ntail para',
  '<div>\n<b title="\n</div>\n\ntail para'
);
const crossLineQuoteBogusArb = fc.constantFrom(
  // Attributes on the next line with PAIRED quotes: ordinary (r2 P2-3).
  '<div\n  class="a" data-x=\'b\'>\ncontent\n</div>\n\ntail para',
  '<div\n  title=">"\n>\ncontent\n</div>\n\ntail para',
  // parse5 bogus comments (r2 P1-3): `<!` / `</` + non-letter eat to `>`.
  '<div>\n<!\n</div>\n\ntail para',
  '<div>\n<!-\n</div>\n\ntail para',
  '<div>\n</\n</div>\n\ntail para',
  '<div>\n<//\n</div>\n\ntail para',
  '<div>\n<! x > </div>\n\ntail para',
  // Quoted `>` on the tag's own line (close and open); noscript is HTML.
  '<div>\n</div a=">\n\ntail para',
  '<div a="x></div>">\n\ntail para',
  '<div title="a>b" class="c">x</div>\n\ntail para',
  'x <noscript> y <b> z </noscript> w\n\ntail para'
);
/** Type-4 declarations (`<!` + letter) whose `>` terminator lands on a
 *  LATER line, so `declOpen` has to survive the line boundary. The corpus
 *  had no `<!` + letter shape at all: every `<!` form was `<!--`, `<!-`,
 *  `<! x >` or `<![CDATA[`, so the declaration opener and its cross-line
 *  carry were unreachable from fuzz (verified 2026-08-20 by a drop-write
 *  mutant on the carry — it survived the whole 784-test engine suite).
 *  Tags in the body are DATA: counting them would open an element that
 *  reparents later siblings. */
const multiLineDeclArb = fc.constantFrom(
  '<!DOCTYPE\nhtml>\n\ntail para',
  '<div>\n<!ENTITY x\n<details>\n>\n</div>\n\ntail para',
  '<!ATTLIST a\nb "c>d"\n>\ntail para',
  '<div>\n<!NOTATION n\n</div>\n>\n\ntail para'
);
/** CDATA whose `]]>` lands on a LATER line. The only CDATA the corpus had
 *  was self-contained (`selfContainedCdataPi`), so the `c === -1` arm that
 *  carries `cdataOpen` past EOL was unreachable — same drop-write mutant
 *  result as the declaration family. Contrast `<?x >` in OVERLAP_OPENERS,
 *  which does carry `piOpen` across a line, so PI was already covered. */
const multiLineCdataArb = fc.constantFrom(
  '<![CDATA[\n<details>\n]]> trailing prose',
  '<div>\n<![CDATA[\ndata\n]]>\n</div>\n\ntail para',
  '<![CDATA[\na ]] b\n]]>\ntail para',
  '<div>\n<![CDATA[\n</div>\n]]>\n\ntail para'
);
/** parse5 CONSUMES the document-structure tokens — they emit no node and
 *  the text around them merges, which rewrites hast BEFORE the construct.
 *  The scanner poisons the whole document for these (see
 *  DOCUMENT_STRUCTURE_NAMES); the corpus had none of them, and the
 *  under-block that hid there shipped through v2.5.2. Indented and fenced
 *  variants are the control side: there parse5 sees code, not markup, so
 *  the poison must NOT fire. */
const documentStructureArb = fc.constantFrom(
  '<!DOCTYPE html>\n\ntail para',
  '<!doctype html>\n\ntail para',
  '<!DOCTYPE html PUBLIC "x">\n\ntail para',
  '<body>\nx\n</body>\n\ntail para',
  '<head>\nx\n</head>\n\ntail para',
  '<html>\nx\n</html>\n\ntail para',
  '<!DOCTYPE html>\n<html>\n<body>\nx\n</body>\n</html>\n\ntail para',
  '<BODY>\nx\n</BODY>\n\ntail para',
  '    <!DOCTYPE html>\n\ntail para',
  '```html\n<!DOCTYPE html>\n```\n\ntail para'
);
/** Paragraph context: a closing tag with attributes is literal text to
 *  micromark — the `<div>` stays open (own family for its meter). */
const paragraphCloseWithAttrsArb = fc.constantFrom(
  'p <div> x </div a="b"> y\n\ntail para',
  'p <title> x </title a> y\n\ntail para',
  'p <span> x </span class="c"> y\n\ntail para',
  // Alone on a line: not type 7 (a closing tag takes no attributes) and not
  // type 6 (span/b are not type-6 names) — paragraph text either way.
  '<span>\n\n</span a="b">\n\ntail para',
  '<b>\n\n</b a>\n\ntail para'
);

/** RAWTEXT/RCDATA elements parse5 LIFTS out of the flow (`title`,
 *  `noframes`, `iframe`), opened INLINE in a paragraph and spanning a line
 *  ending — the shape that rewrites an already-frozen paragraph. The corpus
 *  had these names only as block-level runs (`rawTextElementArb`), so the
 *  inline cross-line form went unsampled for releases on end. The attribute
 *  close (`</title a>`) is the second half: literal text to micromark, a
 *  real end tag to parse5's tokenizer. */
const inlineRawTextSpanArb = fc.constantFrom(
  'p<title>\n</title>',
  'p <title> x </title a> y\n\n<div>\n<title>\n</div>\n</title>',
  'p<iframe>\ninner\n</iframe>',
  'p<noframes>\n</noframes>',
  'prose <title>\nlifted\n</title> tail',
  'p<iframe> x </iframe a> y',
  // F17 — a retroactive construct BEHIND the mask the attribute-bearing
  // close leaves dangling: `</iframe a>` is literal text to micromark and a
  // REAL end tag to parse5's raw-text state, so parse5 is back in DATA
  // while the scanner still masks the construct scan. A doctype /
  // `<template>` / structure end tag in the masked region must poison
  // document-wide (its own poison never fires inside the mask); pinned in
  // computeFreezeBoundary.test.ts (seed 20293004). The attribute-free
  // close and the plain-line tail are the control side (DOWN guard:
  // candidates BEFORE the region survive).
  'p<iframe> x </iframe a> y\n\n<!DOCTYPE html>\n\ntail para',
  'p<iframe> x </iframe a> y\n\n<template>\n\ntail para',
  'p<title> x </title a> y\n\n</body>\n\ntail para',
  'p<iframe> x </iframe a> y\n\nplain z line\n\ntail para'
);

/** Foreign content (`<svg>` / `<math>`). The corpus carried NO svg or math
 *  element at all, so `inForeignContent()` never returned true under fuzz
 *  and both foreign branches — `honoursSelfClosing` and `htmlRulesApply` —
 *  were unreachable (2026-08-21 sweep). Two model deviations are proven
 *  observable in a full parse but produce no stream divergence today,
 *  because the deviating element ends up spanning the boundary and the
 *  block split refuses to freeze it. These shapes pin that:
 *
 *   - a breakout start tag POPS the svg off parse5's stack while
 *     `tagBalance` keeps counting it, so in `<svg><div></div><a/></svg>`
 *     parse5 IGNORES the self-closing flag and leaves `<a>` open (it then
 *     swallows the rest of the document) while the scanner skips the tag;
 *   - after the same pop, `<title>` / `<script>` DO switch the tokenizer to
 *     RCDATA / RAWTEXT, while the scanner still applies foreign rules and
 *     counts every tag inside them as markup.
 *
 *  `svg title` is an HTML integration point the list omits; `annotation-xml`
 *  is one only when `encoding` is text/html, and the scanner treats it as
 *  one unconditionally — both over-block, i.e. safe, and both are here so a
 *  future edit that flips their direction is caught. */
// Split by outcome, not by theme: the breakout shapes all end in a poison
// or a blocked candidate, and a family made only of those drags the corpus's
// incremental-engagement rate under its floor — the splice path then goes
// undertested for every OTHER family too. Freezable shapes carry the weight;
// the poisoning ones only need to appear.
const foreignContentArb = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      // Plain foreign content: the branch itself, never sampled before.
      '<svg><circle/></svg>',
      '<svg>\n<circle/>\n</svg>',
      '<math><mi>x</mi></math>',
      '<svg/>',
      '<svg><circle/>',
      'p <svg><circle/></svg> q'
    ),
  },
  {
    weight: 1,
    arbitrary: fc.constantFrom(
      // Breakout pops the root — the self-closing deviation. `a` / `del` /
      // `summary` are outside HTML_BREAKOUT_TAGS AND inside the sanitize
      // allowlist, so the open element survives into hast where it is visible.
      '<svg><div></div><a/></svg>',
      '<svg><span></span><del/></svg>',
      '<math><p></p><summary/></math>',
      '<svg><br><a/></svg>',
      // Breakout pops the root — the raw-text deviation.
      '<svg><div></div><title>\n</div>\n</title></svg>',
      '<svg><div></div><script>\n<div>\n</script></svg>',
      '<svg><b></b><textarea>\n</b>\n</textarea></svg>',
      // Integration points: the modelled one, the omitted one (svg title), and
      // the conditional one.
      '<svg><foreignObject><div/></foreignObject></svg>',
      '<svg><desc><g/></desc></svg>',
      '<svg><title><g/></title></svg>',
      '<math><annotation-xml encoding="text/html"><div/></annotation-xml></math>',
      '<math><annotation-xml><g/></annotation-xml></math>',
      '<svg><foreignObject><svg><circle/></svg></foreignObject></svg>',
      // Raw-text element started DIRECTLY inside foreign content, no
      // breakout first (P3a/B1): whether the tokenizer switches there is
      // the question the bag cannot answer — these must POISON, and an
      // over-claimed switch measurably RAISED the boundary before the
      // T3.3b wrapper pinned the direction.
      '<svg><title><div></title></svg>',
      '<svg><textarea><div></textarea></svg>',
      '<math><title>\n<div>\n</title></math>',
      // Foreign content crossed with constructs that have their own poison.
      '<svg><td/></svg>',
      '<div>\n<svg><circle/></svg>\n</div>',
      '<script><svg><circle/></script>'
    ),
  }
);

/** Insertion modes the fragment parser re-dispatches to. `rehype-raw`'s
 *  fragment context is a `<template>` element, so parse5 starts in "in
 *  template" and `startTagInTemplate` routes each start tag onward: head-ish
 *  names to "in head", table parts to "in table" / "in row" / "in table
 *  body" / "in column group", everything else to "in body". Two of those
 *  routes move nodes:
 *
 *   - a `<template>` in the CONTENT pushes another template insertion mode
 *     and its children land in a content fragment that never reaches hast;
 *   - text and non-table elements directly inside `<table>` are FOSTER
 *     PARENTED out in front of the table and MERGE with the text node
 *     already sitting there — the same retroactive shape as the
 *     document-structure family.
 *
 *  Neither name appeared in the corpus (`template` literally zero times).
 *  Both were swept clean on 2026-08-21: the foster merge is protected by
 *  `openTotal` — an open `<table>` blocks every candidate, so the boundary
 *  is already parked in front of the merge target by the time the fostered
 *  text arrives. That protection is a side effect of another blocker, which
 *  is exactly why these shapes are pinned here. */
const insertionModeArb = fc.constantFrom(
  '<template>x</template>',
  '<template>\n<div>x</div>\n</template>',
  '- a\n<template>\n<div>x</div>\n</template>',
  '> q\n<template>\n<div>x</div>\n</template>',
  '<template><td>x</td></template>',
  '<template>x',
  'p <template>x</template> q',
  '<table>foster</table>',
  '<table>foster<tr><td>c</td></tr></table>',
  '<table>\nfoster\n</table>',
  '<table><b>x</b></table>',
  '<table><div>d</div></table>',
  '<table><caption>cap</caption>foster</table>',
  '<table><colgroup><col></colgroup>foster</table>'
);

/** Script-data escape states. Inside `<script>` parse5 moves through
 *  "script data escaped" on `<!--` and "script data double escaped" on a
 *  nested `<script`, and in the double-escaped state a `</script>` does NOT
 *  end the element — it only steps back to escaped. CommonMark has no such
 *  notion: a type-1 block ends at the first line holding the literal
 *  `</script>`. So the two grammars disagree about which BYTES are raw,
 *  which is the shape every under-block so far has had.
 *
 *  Swept clean on 2026-08-21 (11 shapes × 2 prefixes × 3 schedules): the
 *  disagreement is real and visible — `<script>\n<!--<script>\n</script>`
 *  makes parse5 swallow the paragraph that follows — but STABLE, because
 *  a stream only ever appends: the byte that flips the state (`<script`
 *  completing inside the comment) always arrives before the `</script>`
 *  whose meaning it changes, so no already-frozen attribution is revised.
 *  Kept in the corpus so that reasoning is re-tested rather than trusted. */
const scriptEscapeArb = fc.oneof(
  // Escaped but never DOUBLE escaped — parse5 and CommonMark still agree on
  // where the block ends, so these stay freezable and keep the family from
  // starving the incremental path (see foreignContentArb).
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      '<script><!--x--></script>',
      '<script><!--</script>',
      '<script>\n<!--- x\n</script>',
      '<script>\n<!--\n</script>\n-->\n<div>d</div>',
      '<style><!--<style></style></style>',
      '<textarea><!--<textarea></textarea></textarea>'
    ),
  },
  // Double escaped: the grammars disagree, so these poison.
  {
    weight: 1,
    arbitrary: fc.constantFrom(
      '<script><!--<script></script></script>',
      '<script>\n<!--<script>\n</script>\n</script>',
      '<script>\n<!--<script>\n</script>\n<div>d</div>\n</script>',
      '<script>\n<!--<script>\n</script>'
    ),
  }
);

// Weights are a sampling budget, not a ranking: the coverage meters assert a
// floor of RUNS/60 hits per family, so a family at weight 1 in a pool this
// size lands under the floor on ordinary seed variation. Every family
// therefore sits at 2 or above; raise the whole pool rather than singling one
// out when a new family is added (2026-08-21: the pool went 38 → 49;
// 2026-08-27: 58 → 66 with the three composite families and two floor
// re-weights, then 66 → 68 with the container-remnant family — the
// measured density cost is in GRAMMAR-COVERAGE's corpus-composite note).
/** End tags parse5 DISCARDS because a scope barrier hides their element.
 *  `<div><table></div></table>` leaves the div OPEN — `</div>` is a parse
 *  error and is ignored, `</table>` pops only the table — so every later block
 *  nests inside the div. The scanner counted both tags balanced and froze; the
 *  bug shipped, because a name→count bag cannot represent what sits BETWEEN an
 *  open and its close (2026-08-24, found by sweeping the forward-independence
 *  identity over prefix/tail pairs rather than by fuzz).
 *
 *  Note the outer name must be a type-6 name: with `<b>` or `<a>` outside,
 *  micromark reads a paragraph and the synthesised `<p>` wrapper makes parse5
 *  close the construct cleanly, so the shape never reaches the scanner. */
const scopeBarrierArb = fc.oneof(
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      '<div><table></div></table>',
      '<div><marquee></div></marquee>',
      '<div><object></div></object>',
      '<div><template></div></template>',
      '<div><applet></div></applet>',
      '<section><table></section></table>',
      '<blockquote><object></blockquote></object>'
    ),
  },
  {
    // Controls: no barrier, so the end tag really closes and the document
    // must keep freezing. Without these the family only ever poisons.
    weight: 3,
    arbitrary: fc.constantFrom(
      '<div><span></div></span>',
      '<div><p></div></p>',
      '<div><table></table></div>',
      '<table><tr><td>c</td></tr></table>',
      '<div><em></div></em>'
    ),
  }
);

/** Head-routed raw-text openers whose region is still OPEN where a tail-only
 *  parse would begin. `startTagInTemplate` sends `title`/`noframes`/`script`/
 *  `style` to "in head" WITHOUT popping the template insertion mode, so
 *  `originalInsertionMode` is captured as IN_TEMPLATE in the tail and IN_BODY
 *  in the full parse; the first stray end tag afterwards restores different
 *  modes and `</p>` synthesizes a paragraph on one side only.
 *
 *  `a\n\n<title>\n\n*b*\n` — sixteen bytes — was a live under-block, found
 *  by a fresh-seed soak leg on 2026-08-24 and minimised from a 190-byte
 *  counterexample that only failed on a reversed chunk schedule. The emphasis
 *  in the trailing block is load-bearing: it takes a NESTED element for the
 *  divergence to become observable, because a single stray end tag is consumed
 *  by the mode restore itself. */
const headRoutedCaptureArb = fc.oneof(
  {
    weight: 1,
    arbitrary: fc.constantFrom(
      '<title>\n\n*b*',
      '<noframes>\n\n*b*',
      '<script>\n<!--<script>\n</script>\n\n*b*',
      '<title>\n\n[x](y)',
      '<noframes>\n\n**b**'
    ),
  },
  {
    // Converged or honestly closed: these must keep splicing, or the family
    // only ever measures the bail.
    weight: 2,
    arbitrary: fc.constantFrom(
      '<title>t</title>\n\n*b*',
      '<script>x</script>\n\n*b*',
      '<title>\n\n</title>\n\n*b*',
      '<textarea>\n\n*b*',
      '<iframe>\n\n*b*'
    ),
  }
);

/** Paragraph-inline raw constructs crossing the line ending, and block-level
 *  raw-text elements crossing a blank line — two shapes where a construct is
 *  interior to one grammar and structure to the other (2026-08-24, both live
 *  under-blocks; see rawConstructPhase.test.ts for the mechanism). The unsafe
 *  members poison to zero, so the safe members carry the sampling weight. */
const rawPhaseSplitArb = fc.oneof(
  {
    weight: 1,
    arbitrary: fc.constantFrom(
      'x <!D y\n<!DOCTYPE>',
      'x <?p y\n<!DOCTYPE ?>',
      'x <![CDATA[ y\n<!DOCTYPE ]]>',
      'x <!D y\n<div><table></div></table>',
      '<iframe>\n\n*b*\n<div>\n<iframe>\n</div>\n</iframe>',
      '<title>\n\n*b*\n</title>'
    ),
  },
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      'x <!D y>\nplain',
      'x <?p y?>\nplain',
      '<!ENTITY x\n<!DOCTYPE html>',
      '<iframe>x</iframe>',
      '<iframe>\ny\n</iframe>'
    ),
  }
);

/** F15/F16 — seal-release piercers: a FLOATING RAW REMNANT (blocker 6)
 *  followed by line classes that emit no top-level hast node, so the seam
 *  seal must hold PAST them. A link definition's continuation lines (title
 *  wrapping inside its quotes, title on its own line — F15) and a footnote
 *  definition's cross-blank ≥4-indent BODY continuations (F16) are exactly
 *  the classes the release enumeration missed, twice; the trailing `<!--`
 *  future is what makes a wrong release OBSERVABLE (the remnant's hast
 *  shape changes when `-->` completes). Both were fresh-seed soak finds
 *  with ZERO pinned-corpus delta: `linkDefArb` had the wrapped title and
 *  `footnoteDefArb` the cross-blank body, but never composed with a live
 *  remnant. Pinned in computeFreezeBoundary.test.ts (soak 20289117 / seed
 *  20293003). The F18 shapes joined 2026-08-27 (second batch): a resumed
 *  footnote body's LAZY continuation at indent 0/2 emits no node either —
 *  the F16 clause's `indent >= 4` conjunct read it as a releasing line
 *  (measured: the reproducer released at 72/59 on the unfixed v2.8.1
 *  tree; the withhold holds it at 0 since "a lazy continuation of a
 *  resumed footnote body is still the body"). */
const sealPiercerArb = fc.oneof(
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      '<!-- c --> </s>\n\n[^a]: body\n\n    cont\n\n[b]: /v\n\ntail para',
      '</details>\nr\n\n[b]: /b\n[b]: /b "t\nw"\n\n<!--',
      '</details>\nr\n\n[a]: /u\n"t"\n\n<!--',
      '<!-- c --> </s>\n\n[^a]: body text\n\n    indented continuation\n\n[a]: https://example.com/a\n\n- t',
      '<div>\n</div>\nfloating remnant\n\n[^a]: note\n\n    cont\nlazy tail\n\n[b]: /v\n\ntail para',
      '<!-- c --> </s>\n\n[^a]: note\n\n    cont\n  lazy two\n\n[b]: /v\n\ntail para'
    ),
  },
  {
    // Controls: a line that DOES emit a node pins the seam and the doc
    // keeps freezing — the family's engagement side. The third shape is
    // the fnDefResumable CLEAR: a ≤3-indent block-start def ends the
    // footnote body, so the later indented line is REAL code and releases.
    weight: 3,
    arbitrary: fc.constantFrom(
      '<!-- c --> </s>\n\n[^a]: body\n\npinning paragraph\n\ntail para',
      '</details>\nr\n\n[a]: /u\n\nreal paragraph\n\ntail para',
      '<!-- c --> </s>\n\n[^a]: body\n\n[a]: /u\n\n    code\n\n[b]: /v\n\ntail para',
      // The F18 clear: a ≤3-indent block start after the continuation is
      // the one line no body can lazily absorb — it interrupts AND
      // releases on its own merits.
      '<div>\n</div>\nfloating remnant\n\n[^a]: note\n\n    cont\n\npinning paragraph\n\ntail para'
    ),
  }
);

/** Container-held html remnants: the blocker-6 seal arm reads the FLOATING
 *  remnant at root, and every corpus shape so far put it there — a remnant
 *  INSIDE a blockquote or list item was never sampled (49-weight corpus,
 *  zero coverage). Measured 2026-08-27 on the fixed tree: the container
 *  forms release where the root form holds (`> …remnant` + def tail
 *  frees 46/47/28 against root 0), streamed equivalence green on every
 *  shape — absorbed today, and exactly the shapes the future derived
 *  seal-release swap (open question 1) must stay measured against. The
 *  comment-terminator remnant carries into containers unchanged (poisons
 *  to 0). */
const containerRemnantArb = fc.oneof(
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      '> <div>\n> </div>\n> floating remnant\n\n[a]: /u\n\nx marks it',
      '- <div>\n  </div>\n  remnant\n\ncol zero\n\n[a]: /u\n\nx marks it',
      '> <!-- c --> </s>\n\n[a]: /u\n\nx marks it',
      '> <div>\n> </div>\n> <!-- open\n> --> tail remnant\n\ntail para',
      '> <div>\n> </div>\n> remnant\n\n[^a]: note\n\n    cont\n\ntail para',
      // The UNCLOSED-element sub-shape: an element opened inline in the
      // container's paragraph and never closed — micromark's blockquote
      // ends at the blank while parse5's div/iframe stays open INSIDE it
      // and swallows what follows. Blocked today by the open count
      // (measured: 0 against 43/44 for the closed controls); the derived
      // seal-release must keep both sub-shapes blocked.
      '> text <div>\n> more\n\nfollowing para',
      '- item text <div>\n  more\n\nfollowing para',
      '> p <iframe>\n> in\n\nfollowing para'
    ),
  },
  {
    // Controls: pinned by prose inside the container, no remnant at all,
    // or the same inline element CLOSED on its line.
    weight: 2,
    arbitrary: fc.constantFrom(
      '> <div>x</div>\n> prose line\n\ntail para',
      '> <!-- c -->\n\ntail para',
      '- <div>x</div>\n- second item\n\ntail para',
      '> text <div></div>\n> more\n\nfollowing para',
      '> p <iframe></iframe>\n> in\n\nfollowing para'
    ),
  }
);

/** E7 — raw-text run-on compositions. micromark ends a type-1 block on the
 *  `</name` SUBSTRING while parse5 needs the appropriate end tag in full,
 *  so `</scripty>` / `</textareax>` close the block for one grammar and
 *  leave the element open for the other (scanner-side counterpart: the F10
 *  blank-line poison). The soak-scale E7 firings all rode compositions the
 *  pinned corpus never assembled — PI blocks, a synthesized `</br>`, math
 *  fences and CR line endings around the run-on — so the composition is
 *  baked in here rather than left to separator luck (the type1Boundary
 *  family carries the bare `</scripty>` under `\n` only). Proper closers
 *  are the control side: both grammars agree and the doc keeps freezing. */
const rawTextRunOnArb = fc.oneof(
  {
    weight: 1,
    arbitrary: fc.constantFrom(
      '<textarea>\rt\r</textareax>\r\r$$\re=mc^2\r$$\r\rtail para',
      '<script>\rs\r</scripty>\r\r<?i\r?>\r\r</br>\r\rtail para',
      '<?i\r</br>\r?>\r<textarea>\r<!-- not a comment\r</textarea>\r\r$$\rx\r$$',
      '<textarea>\r\nt\r\n</textareax>\r\n\r\n</br>\r\n\r\n$$\r\ne=mc^2\r\n$$'
    ),
  },
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      '<textarea>\rt\r</textarea>\r\r$$\re=mc^2\r$$\r\rtail para',
      '<script>\rs\r</script>\r\r</br>\r\rtail para',
      '<?i ?>\r</br>\r\r<textarea>x</textarea>\r\rtail para'
    ),
  }
);

/** See the pool comment: line-initial non-type-6 name with a quoted `>`,
 *  alone on its line, opening the run — paired with the follower shapes
 *  whose consumers the run flag guards (a fence, a backtick-span line, a
 *  truncated tag, a container form). */
const nonType6QuotedGtArb = fc.oneof(
  fc.constantFrom(
    '<span title="a>b">\n`<div>`\n</span>',
    '<img title="a>b">\n```\nx\n```',
    '<img title="a>b">\n<span',
    '<noscript title="a>b">\n$$\ne=mc^2\n$$',
    '- item\n  <img title="a>b">\n  ```\n  x\n  ```',
    '<span title="a>b" class="c">x</span>\nplain follower line',
    // Column-0 tag lines that LAZILY continue an open container — the two
    // shapes the B3 containerMaybeOpen fix exists for, and the family's standing hole: every
    // shape above either has no container or indents the tag INTO it, so
    // the corpus could not reach the undecidable case at all. Both should
    // poison now: a container line followed by a type-7-shaped tag line is
    // undecidable, so no candidate at or past it survives.
    '> q\n<span title="a>b">\n> `<div>`',
    '- item\n<img title="a>b">\n  `<div>`',
    // Container CLOSED by a non-paragraph last line — the OTHER B3 reading
    // (F14 sub-class ii): the heading closes the blockquote, so the
    // column-0 tag line opens a TOP-LEVEL multi-line block; still
    // undecidable to the content model, still poisons.
    '> # h\n<img title="a>b">\n`<div>` follower',
    // A footnote definition and a def-list description are container lines
    // too — each arms the same sticky marker.
    '[^a]: note body\n<img title="a>b">\n`<div>` body',
    'Term line\n:   desc body\n<img title="a>b">\n`<div>` body',
    // Control: the blank closed the container, the marker disarmed, and
    // the tag line's verdict is decided again — keeps freezing.
    '> q\n\n<img title="a>b">\nplain follower'
  ),
  fc.constantFrom('<img title="a>b">\n[a]: /u', '<span title="a>b">\n<!-- c -->'),
  // Exact-type-7 interrupt contexts: the SAME complete tag line is a real
  // type-7 block after a heading / break / terminator line and a paragraph
  // continuation after content — plus the classifier's other exact edges
  // (closing raw-text names ARE type 7; attribute garbage on a non-type-6
  // name is a paragraph; a pipe line before a tag line poisons).
  fc.constantFrom(
    '# h\n<span title="a>b">\n`<div>`\n</span>',
    'para line\n<span title="a>b">\n`<i>` stays inline\n</span>',
    '---\n<x-y>\n`<div>`\n</x-y>',
    '<!-- c -->\n<em>\n</em>\n`<b>` follower',
    '</style>\n`<div>` raw here',
    'para\n</style> paragraph continuation `<b>`',
    '<foo a=>\n`<i>` inline code\n$$\ne=mc^2\n$$',
    '| a | b |\n| - | - |\n<x-y/>\nrow follower',
    // The pipe-LESS continuation row (soak 20283008): a table continues
    // through any non-structural line, so the tag line sits after the
    // TABLE (type 7 opens) while the content model reads a paragraph.
    '| a | b |\n| - | - |\n| 1 | 2 |\nrow continuation prose\n<x-y/>\nfollower',
    'a | pipe paragraph\n<x-y/>\nfollower'
  )
);

/**
 * Tag-name prefix axis. Each name shares a PREFIX with a table part
 * (`col`, `td`, `tr`, `caption`), a document-structure name (`head`,
 * `html`, `body`), a no-element name (`image`, `frame`) or a raw-text /
 * type-1 name (`pre`, `style`, `script`, `textarea`), yet is an ordinary
 * unknown element to both grammars: not a CommonMark type-6 name (so alone
 * on a line it is a type-7 block that ends at the blank line, and inline it
 * is paragraph text), and not special, raw-text or void to parse5. A guard
 * keyed on `startsWith` or on `\b` misreads them — `\b` matches before `-`,
 * so `<td-cell>` is `<td` + boundary to `TABLE_PART_TAG_RE`. Sanitize strips
 * the unknown element and hoists its children, so a divergence surfaces as
 * a structure change around the name rather than as the tag itself.
 *
 * The self-closing forms are the poisoning side: HTML ignores the `/` on a
 * non-void element, so `<images/>` alone on a line stays OPEN and swallows
 * the rest of the document — inside a paragraph the synthesized `</p>`
 * closes it again. The real `<table>` / `<td>` / `<pre>` / `<script>` mixes
 * put the prefixed name where the real name's own hazard fires (foster
 * parenting in a row, the stray-part poison, raw text) so the two cannot be
 * confused by position either.
 */
const PREFIX_NAMES = [
  'col-md-6',
  'td-cell',
  'tr-row',
  'caption-box',
  'header',
  'html-x',
  'images',
  'framework',
  'body-x',
  'prefix',
  'styled',
  'scripted',
  'textareas',
] as const;
const prefixNameArb = fc.constantFrom(...PREFIX_NAMES);
const tagNamePrefixArb = fc.oneof(
  {
    weight: 4,
    arbitrary: fc
      .tuple(prefixNameArb, fc.constantFrom('block', 'inline', 'inline-self', 'close-only', 'attrs'))
      .map(([name, form]) =>
        form === 'block'
          ? `<${name}>\ninner prose\n</${name}>`
          : form === 'inline'
            ? `p <${name}>x</${name}> q`
            : form === 'inline-self'
              ? `p <${name}/> q`
              : form === 'close-only'
                ? `</${name}>\ntext after a stray prefixed end tag`
                : `<${name} class="c" data-x="a>b">\ninner prose\n</${name}>`
      ),
  },
  { weight: 1, arbitrary: prefixNameArb.map((name) => `<${name}/>`) },
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      '<table>\n<tr><td-cell>x</td-cell></tr>\n</table>',
      '<table>\n<tr-row><td>x</td></tr-row>\n</table>',
      '<table><caption-box>c</caption-box><tr><td>x</td></tr></table>',
      '<td>s</td>\n\n<td-cell>x</td-cell>',
      '<col-md-6>\n<col>\n</col-md-6>',
      'p <td-cell>x</td-cell> q\n\n| a | b |\n| - | - |\n| 1 | 2 |',
      '<tr-row/>\n\n| a | b |\n| - | - |',
      '<pre>\n<prefix>x</prefix>\n</pre>',
      '<prefix>\n<pre>\n</prefix>\n</pre>',
      '<script>\nlet s = "<scripted>";\n</script>',
      '<scripted>\n<script>x</script>\n</scripted>',
      '<styled>\n<style>.a{}</style>\n</styled>',
      '<textareas>\n<textarea>t</textarea>\n</textareas>',
      '<framework>\n<iframe>\n</framework>\n</iframe>',
      '<header>\n<h1>x</h1>\n</header>',
      '<body-x>\n<body>\n</body>\n</body-x>',
      '<html-x>\nx\n</html-x>\n\n<!DOCTYPE html>',
      '<images>\n<img src="x">\n</images>'
    ),
  }
);

const rawHtmlArb = fc.oneof(
  { weight: 2, arbitrary: treeQuirkArb },
  // 3: the family spans 13 names × 5 forms plus 18 mixes, and its marker
  // has to clear the RUNS/200 floor on fresh seeds (pool 68 → 71).
  { weight: 3, arbitrary: tagNamePrefixArb },
  { weight: 2, arbitrary: crossLineTagGarbageArb },
  // Weight tracks the pool size: each new family dilutes the others, and
  // this one carries the `quotedGtOnTagLine` meter, the first to starve
  // (3 → 4 when the foreign-content/insertion-mode/script-escape families
  // took the pool from 38 to 42).
  { weight: 4, arbitrary: crossLineQuoteBogusArb },
  // The once-was-a-hole class: a quoted `>` on the very line that opens a
  // run under a NON-type-6 name (span / img / noscript are not in
  // htmlBlockNames). Under the approximate classifier only the retired
  // `mayBeRawToMicromark` flag protected it (the old regex stopped at the
  // quoted `>`; the P4b-completion review measured four boundary rises
  // under a naive migration). Exact type 7 classifies these lines by the
  // member — this family keeps standing guard over exactly that claim.
  // 3, not 2: the B3 container shapes folded in here (2026-08-27) grew the
  // member pool and the family's marker landed exactly ON the floor at the
  // pinned seed — same starvation pattern as crossLineQuoteBogus at the
  // 38 → 42 growth.
  { weight: 3, arbitrary: nonType6QuotedGtArb },
  { weight: 2, arbitrary: multiLineDeclArb },
  { weight: 2, arbitrary: multiLineCdataArb },
  { weight: 2, arbitrary: documentStructureArb },
  { weight: 2, arbitrary: danglingQuoteArb },
  { weight: 2, arbitrary: paragraphCloseWithAttrsArb },
  { weight: 2, arbitrary: fc.constant('<details>\n<summary>t</summary>\nbody prose\n</details>') },
  // APPROX #2 — cross-line self-closing tag stays an over-blocking opener.
  { weight: 2, arbitrary: fc.constant('<embed\n  src="x"\n/>') },
  // APPROX #3 — tags inside a self-contained CDATA / PI still counted.
  { weight: 2, arbitrary: fc.constant('<![CDATA[<div>data</div>]]> trailing prose') },
  { weight: 2, arbitrary: fc.constant('<?instr <b> ?> after the pi') },
  { weight: 2, arbitrary: fc.constant('<!-- a closed comment -->') },
  { weight: 2, arbitrary: overlapSettledArb },
  { weight: 2, arbitrary: rawTextBlockArb },
  { weight: 2, arbitrary: type1BoundaryArb },
  { weight: 2, arbitrary: preBogusOpenerArb },
  { weight: 2, arbitrary: sealPiercerArb },
  { weight: 2, arbitrary: containerRemnantArb },
  { weight: 2, arbitrary: rawTextRunOnArb },
  { weight: 2, arbitrary: rawTextElementArb },
  { weight: 2, arbitrary: inlineRawTextSpanArb },
  { weight: 2, arbitrary: foreignContentArb },
  { weight: 2, arbitrary: insertionModeArb },
  { weight: 2, arbitrary: scriptEscapeArb },
  { weight: 2, arbitrary: scopeBarrierArb },
  { weight: 2, arbitrary: headRoutedCaptureArb },
  // 3, not 2: the 58 → 66 pool growth (2026-08-27) pushed this marker to 4
  // at the pinned seed, under the RUNS/60 floor of 5.
  { weight: 3, arbitrary: rawPhaseSplitArb },
  // Unsettled openers (the assembler may close them later or leave them).
  { weight: 4, arbitrary: fc.constantFrom('<details>', '<!--', '<div') },
  { weight: 2, arbitrary: overlapTerminatorArb }
);

const HTML_CLOSERS: Record<string, string> = {
  '<details>': '</details>',
  '\u3000<!-- c\n<details>\n\n-->': '</details>',
  '<!--': '-->',
  '<div': 'class="x">content</div>',
  ...Object.fromEntries(
    OVERLAP_OPENERS.map((opener) => [`${opener}\n<details>\n${opener.startsWith('<?') ? '?>' : '-->'}`, '</details>'])
  ),
};

/**
 * Link-definition destinations: the valid URL the corpus always had, plus
 * shapes micromark REJECTS (the def line is then a paragraph whose
 * `[label]` stays a live shortcut ref): a bare destination with unbalanced
 * parentheses, a stray `)` at balance zero, an angle destination containing
 * `<`, an unclosed angle destination, and no destination at all (a bare
 * `[label]:` with a quoted "title" after it is VALID — the quotes are the
 * destination). A scanner that registers any of these as a def releases reference
 * taint early (ghost def — 2026-08 project-review P1). `/u(x)y` is the
 * balanced control.
 */
// `/u\\ x`: a backslash escapes only `(`, `)`, `\\` — before a space it is a
// literal and the space ENDS the destination (garbage after → paragraph).
const INVALID_DESTS = ['/u(x', '/u)', '<u<v>', '<u', '/u\\ x', ''] as const;
/** Valid controls next to the invalid shapes: balanced parens, and an
 *  angle destination WITH whitespace (legal — only `<`, `>` and line
 *  endings are forbidden inside the brackets). */
const VALID_ODD_DESTS = ['/u(x)y', '<u v>'] as const;
const crossLineDefLabelArb = labelArb.map((l) => `${l} ${l}`);
const linkDefArb = fc
  .tuple(
    fc.oneof({ weight: 5, arbitrary: labelArb }, { weight: 1, arbitrary: crossLineDefLabelArb }),
    fc.oneof(
      { weight: 5, arbitrary: fc.constant(null) },
      { weight: 1, arbitrary: fc.constantFrom(...VALID_ODD_DESTS) },
      { weight: 3, arbitrary: fc.constantFrom(...INVALID_DESTS) }
    ),
    fc.constantFrom('', ' "title"', ' "title\nwraps"')
  )
  .map(
    // APPROX #4 (A2) — a multi-line title breaks the def-chain recognition.
    ([label, dest, title]) =>
      `[${label}]:${dest === null ? ` https://example.com/${label}` : dest ? ` ${dest}` : ''}${title}`
  );

const footnoteDefArb = fc
  .tuple(labelArb, fc.boolean())
  .map(([label, indented]) => `[^${label}]: body text${indented ? '\n\n    indented continuation' : ''}`);

const refUseArb = fc
  .tuple(labelArb, fc.constantFrom('shortcut', 'full', 'footnote'))
  .map(([label, kind]) =>
    kind === 'shortcut'
      ? `prose with [${label}] used`
      : kind === 'full'
        ? `prose [text][${label}] used`
        : `claim[^${label}] made`
  );

const listArb = fc.constantFrom('- tight one\n- tight two', '- loose one\n\n- loose two', '1. ordered\n2. items');

/**
 * GFM task-list items — the `gfmTaskListItems` scanner profile
 * (taskListContext.ts). Every `[x]` is a shortcut-reference candidate
 * whose label collides with the late `[x]:` definitions drawn below, so
 * the direction battery's late-definition futures and this pool decide
 * together whether a released box was really a task. Split by outcome:
 *
 *  - PROVABLE: root, quote and nested bullet/ordered items whose box is
 *    the first content and whose paragraph a later block closes — these
 *    must be released, or the family only pins the old over-block;
 *  - RECLAIMED: a setext underline at the item's content column (two
 *    spaces, a tab stop, a nested item), a lazy line before it, a GFM
 *    table delimiter row — the box becomes a reference again and the
 *    release must not have happened;
 *  - NOT A TASK: lazy ordered markers, a box past the first content, no
 *    whitespace after `]`, trailing whitespace on an empty marker line,
 *    a code-span or escaped box — each an ordinary reference the late
 *    definition retargets.
 */
const TASK_MARKERS = ['-', '*', '+', '1.', '1)', '12.'] as const;
const taskProvableArb = fc.oneof(
  {
    weight: 3,
    arbitrary: fc
      .tuple(
        fc.constantFrom(...TASK_MARKERS),
        fc.constantFrom('x', 'X'),
        fc.constantFrom(' done', '\tdone', ' done [x] again', '\n  next line', '\nlazy line', ' ')
      )
      .map(([marker, box, tail]) => `${marker} [${box}]${tail}`),
  },
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      '- parent\n  - [x] child',
      '- parent\n  1. [X] child',
      '> - [x] quoted',
      '> > - [X] deep',
      '> - parent\n>   - [x] nested',
      '1. [x] one\n2. [X] two',
      '- [x] a\n\n- [x] b',
      '-\n  [x] after an empty marker',
      '- [x] a\n  - [X] b\n    - [x] c\n  - d\n- e',
      '- [x] a\n  # heading closes it',
      '- [x] a\n  ***',
      '- [ ] open\n- [x] closed'
    ),
  }
);
const taskReclaimedArb = fc.constantFrom(
  '- [x] a\n  ===',
  '- [X] a\n  ---',
  '- [x] a\n  b\n  ===',
  '- [x] a\nlazy\n  ===',
  '-\t[x] a\n    ===',
  '> - [x] a\n>   ===',
  '- parent\n  - [x] a\n    ===',
  '- [x] a | b\n  --- | ---',
  '- [x] a\n  -|',
  '- [x] a\n  :--'
);
const taskNotTaskArb = fc.constantFrom(
  'para\n2. [x] b',
  '- a\n  2. [x] b',
  'para\n    - [x] b',
  '- item [x] a',
  '- first\n\n  [x] a',
  '- # first\n\n  [x] a',
  '- [x]',
  '- [x]text',
  '- [x] a',
  '- \n  [x] a',
  '-\n   [x] a',
  '- `[x]` code',
  '- \\[x] escaped'
);
const taskListArb = fc.oneof(
  { weight: 3, arbitrary: taskProvableArb },
  { weight: 2, arbitrary: taskReclaimedArb },
  { weight: 2, arbitrary: taskNotTaskArb }
);
/** The definition that retargets every reference-shaped box above; the
 *  valid forms settle, the invalid ones stay paragraphs. */
const lateBoxDefArb = fc.constantFrom('[x]: /late', '[X]: /late "t"', '[x]:', '[x]: /u(x');

/** Definition-list description line — only meaningful when the defList
 *  config axis is on; under other configs it is a plain paragraph, which is
 *  itself a useful divergence probe. */
const defListArb = fc.constant('Term line\n\n:   description body');

const miscBlockArb = fc.constantFrom(
  '> a quoted line',
  'Setext title\n===',
  '---',
  '| a | b |\n| - | - |\n| 1 | 2 |',
  '## heading'
);

const benignBlockArb = fc.oneof(
  { weight: 5, arbitrary: paragraphArb },
  { weight: 2, arbitrary: listArb },
  { weight: 2, arbitrary: miscBlockArb },
  { weight: 1, arbitrary: fencedCodeArb.filter((b) => b.endsWith('```')) },
  // Tabs that keep freezing: the benign family owns the engagement floor,
  // so only the settled shapes sit here (pool 10 → 11).
  { weight: 1, arbitrary: tabBenignArb },
  // Provable task lists keep freezing once the next root block lands
  // (pool 11 → 12); the reclaimed and non-task shapes sit in the hazard
  // family with the late definition that retargets them.
  { weight: 1, arbitrary: taskProvableArb }
);

const hazardBlockArb = fc.oneof(
  { weight: 3, arbitrary: rawHtmlArb },
  { weight: 2, arbitrary: linkDefArb },
  { weight: 2, arbitrary: footnoteDefArb },
  { weight: 2, arbitrary: refUseArb },
  { weight: 1, arbitrary: fencedCodeArb },
  { weight: 1, arbitrary: indentedCodeArb },
  { weight: 1, arbitrary: mathArb },
  { weight: 1, arbitrary: defListArb },
  { weight: 1, arbitrary: unicodeBlankArb },
  // 2 of 16: tabs compose with every other block through the separators,
  // and the marker (any `\t`) must clear the floor on fresh seeds.
  { weight: 2, arbitrary: tabIndentArb },
  // 3 of 19: task boxes and the `[x]:` definitions they collide with
  // (pool 16 → 19).
  { weight: 2, arbitrary: taskListArb },
  { weight: 1, arbitrary: lateBoxDefArb }
);

// --- document assembly ----------------------------------------------------------

// Lone `\r` and CRLF are line endings to micromark too (r2 P1-5: the
// scanner split on `\n` only and a fence opener after `a\r` hid inside a
// paragraph line) — a few of the seams carry them.
const sepArb = fc.constantFrom('\n\n', '\n\n', '\n\n', '\n\n\n', '\n', '\r\r', '\r\n\r\n', '\r', '\r\n');

/**
 * Assemble blocks into a document. Unsettled raw-HTML openers are CLOSED by
 * an appended closer with p≈0.8 (settle bias); unclosed fences/math are left
 * as-is only when they land in the final position (elsewhere they'd swallow
 * the rest of the doc into one giant block and starve the splice).
 */
function assembleDoc(blocks: string[], seps: string[], closeRoll: number[]): string {
  const parts: string[] = [];
  blocks.forEach((block, i) => {
    let text = block;
    const closer = HTML_CLOSERS[block];
    if (closer && (closeRoll[i] ?? 0) < 8) {
      text = block === '<div' ? `<div ${closer}` : `${block}\ninner prose\n${closer}`;
    }
    const unterminated = /^(```|\$\$)/.test(text) && !/(```|\$\$)$/.test(text.slice(3));
    if (unterminated && i < blocks.length - 1) {
      text += text.startsWith('```') ? '\n```' : '\n$$';
    }
    parts.push(text);
    if (i < blocks.length - 1) parts.push(seps[i] ?? '\n\n');
  });
  return `${parts.join('')}\n`;
}

export interface FuzzDoc {
  doc: string;
  /** Chunk sizes walked cyclically (code-point aligned) to build snapshots. */
  sizes: number[];
  /** Which CATALOG config to run (mod length at the call site). */
  configIndex: number;
}

const sizesArb = fc.array(
  fc.oneof({ weight: 5, arbitrary: fc.integer({ min: 4, max: 32 }) }, { weight: 1, arbitrary: fc.constant(1) }),
  { minLength: 8, maxLength: 24 }
);

/**
 * Document-leading byte order mark. micromark drops it before tokenizing,
 * so every parsed position is the string index minus one — the one input
 * class where the scanner's string-index boundaries and the trees' offsets
 * disagree. Stage A strips it in production; the engine must still refuse
 * to splice such a document when it arrives directly (the scanner grants no
 * boundary, the append gate treats the frame as a non-append), and the
 * arbiter proves every frame stays deep-equal to the full parse. Weighted
 * low: a BOM document never engages the splice path, so each one dilutes
 * the benign family's engagement ratio (floor 0.2 against a mean of about
 * 0.3 — one in twelve costs under three points of the mean).
 */
const leadingBomArb = fc.oneof(
  { weight: 11, arbitrary: fc.constant('') },
  { weight: 1, arbitrary: fc.constant('\uFEFF') }
);

function docFamily(blockArb: fc.Arbitrary<string>, minBlocks: number, maxBlocks: number): fc.Arbitrary<FuzzDoc> {
  return fc
    .tuple(
      leadingBomArb,
      fc.array(blockArb, { minLength: minBlocks, maxLength: maxBlocks }),
      fc.array(sepArb, { minLength: maxBlocks, maxLength: maxBlocks }),
      fc.array(fc.integer({ min: 0, max: 9 }), { minLength: maxBlocks, maxLength: maxBlocks }),
      sizesArb,
      fc.nat()
    )
    .map(([bom, blocks, seps, closeRoll, sizes, configIndex]) => ({
      doc: bom + assembleDoc(blocks, seps, closeRoll),
      sizes,
      configIndex,
    }));
}

/** Mostly-benign docs — must keep the splice path HOT (high engagement floor). */
export const benignDocArb: fc.Arbitrary<FuzzDoc> = docFamily(
  fc.oneof({ weight: 4, arbitrary: benignBlockArb }, { weight: 1, arbitrary: hazardBlockArb }),
  4,
  10
);

/** Hazard-dense docs — engagement is legitimately low; only equivalence matters. */
export const hazardDocArb: fc.Arbitrary<FuzzDoc> = docFamily(
  fc.oneof({ weight: 1, arbitrary: benignBlockArb }, { weight: 3, arbitrary: hazardBlockArb }),
  4,
  12
);

/** Cut a document into cumulative append-only snapshots, code-point aligned
 *  (never splits a surrogate pair — matching the production stream contract). */
export function scheduleSnapshots(doc: string, sizes: number[]): string[] {
  const snapshots: string[] = [];
  let offset = 0;
  let i = 0;
  while (offset < doc.length) {
    const take = Math.max(1, sizes[i % sizes.length] ?? 8);
    i += 1;
    let end = Math.min(doc.length, offset + take);
    const last = doc.charCodeAt(end - 1);
    if (end < doc.length && last >= 0xd800 && last <= 0xdbff) end += 1;
    snapshots.push(doc.slice(0, end));
    offset = end;
  }
  return snapshots;
}

/**
 * Generator-coverage meters (Phase 4c): each APPROX family's structural
 * marker, matched against the ASSEMBLED doc text. spliceFuzz asserts a
 * minimum hit count per family across the run, so a future generator edit
 * cannot silently hollow out the adversarial content.
 */
export const COVERAGE_MARKERS: Record<string, RegExp> = {
  proseBracketTaint: /\[(?:a|b|spec|注一)\]/,
  codeSpanMasking: /`(?:<div>|\[x\]|\[\^n\])`/,
  crossLineSelfClosing: /<embed\n/,
  selfContainedCdataPi: /<!\[CDATA\[|<\?instr/,
  multiLineDecl: /<!(?:DOCTYPE|ENTITY|ATTLIST|NOTATION)[^>\n]*\n/,
  multiLineCdata: /<!\[CDATA\[\n/,
  documentStructure: /<!(?:DOCTYPE|doctype)|<\/?(?:body|BODY|head|html)>/,
  multiLineDefTitle: /"title\nwraps"/,
  indentedCodeScanned: /^ {4}(?:<details>|\[\^b\])/m,
  underCountEdge: /<\/(?:b|i)> <(?:!--|\?php)/,
  unclosedRawOpener: /<details>(?![\s\S]*<\/details>)|<!--(?![\s\S]*-->)|<div\n/,
  overlappingTerminator: /<!-->|<!--->|<\?>|--!>|<\?x >/,
  invalidLinkDef: /\]:(?: \/u\(x| \/u\)| <u<v>| <u| \/u\\ x)(?:\n| "title)|\]:\n/,
  rawTextBlock: /<(?:script|style|textarea|pre)>/,
  type1Boundary: /<\/(?:script|pre|style|textarea)(?:>\n[a-z<]|[ /y])/,
  proseTruncatedTag: /a<b\n/,
  proseTruncatedClose: /<\/b\n/,
  crossLineTagGarbage:
    /<\/(?:div|summary|br|span)\n<\/(?:div|details)>|<br\n<\/div>|title=">"\n|class="x"\n<\/div>|<\/i\n<|<br\n<div>|<\/textarea\n<!--|- a\n {2}<\/div\n<div>/,
  danglingQuote: /<(?:hr title|span class|b title)="\n/,
  bogusComment: /<div>\n(?:<!|<!-|<\/|<\/\/)\n<\/div>|<! x > /,
  quotedGtOnTagLine: /<\/div a=">|a="x><\/div>"|title="a>b"|<noscript> y <b>/,
  nonType6QuotedGt: /<(?:span|img|noscript) title="a>b"/,
  closeWithAttrsInParagraph: /<\/(?:div a="b"|title a|span class="c")> y|\n<\/(?:span a="b"|b a)>/,
  rawTextElement: /<(?:title|iframe|noframes|xmp)>/,
  inlineRawTextSpan: /(?:^|[a-z ])<(?:title|iframe|noframes)>\n|<\/(?:title|iframe) a>/m,
  loneCr: /\r(?!\n)/,
  reviewShapes: /<!-- c --> <\/s>|<\?x\?><details>|<\/t>\ntext|<details> <\?php|x="`">b`/,
  treeQuirks: /<\/br>|<\/p>|<td>s<\/td>\n\n|<col>/,
  unicodeBlank: /\n[\u3000\u00a0]\n|```\u00a0\n|\$\$\u3000\n|"t"\u00a0|\u3000<!--/,
  failedInlineLink: /\]\(bad url\)/,
  crossLineRef: /see \[(?:a|b|spec|注一)\n(?:a|b|spec|注一)\] end/,
  foreignContent: /<svg|<math[>/ ]/,
  insertionMode: /<template>|<table>(?:foster|<b>|<div>|<caption>|<colgroup>)|<table>\n/,
  scriptEscape: /<script><!--|<script>\n<!--|<style><!--|<textarea><!--/,
  scopeBarrier: /<(?:div|section|blockquote)><(?:table|marquee|object|template|applet)>|<div><(?:span|p|em)><\/div>/,
  headRoutedCapture: /<(?:title|noframes)>\n\n|<(?:title|noframes)>[a-z]*<\/(?:title|noframes)>/,
  rawPhaseSplit: /x <(?:!D|\?p|!\[CDATA\[) y|<iframe>\n\n\*b\*|<iframe>x<\/iframe>/,
  preBogusOpener: /<pre>[\n ]<[?!/]|<(?:style|script|textarea)>\n<(?:\?x|!y|!\[)/,
  sealReleasePiercer: /<\/s>\n\n\[\^a\]|"t\nw"\n\n<!--|\n"t"\n\n<!--|<\/details>\nr\n|remnant\n\n\[\^a\]/,
  rawTextRunOn: /<\/(?:textareax|scripty)>|<\/textarea>\r\r|<\/script>\r\r|<\?i\r/,
  containerHeldRemnant:
    /> (?:floating |tail )?remnant|\n {2}remnant\n|> prose line|> <!-- c -->|- second item|(?:> text|item text|> p) <(?:div|iframe)>/,
  leadingBom: /^\uFEFF/,
  tabIndent: /\t/,
  tagNamePrefix:
    /<\/?(?:col-md-6|td-cell|tr-row|caption-box|header|html-x|images|framework|body-x|prefix|styled|scripted|textareas)[ />]/,
  // Task-list family (taskListContext.ts). The structural markers say the
  // shapes were drawn; `taskReleased` in spliceFuzz counts how many of the
  // provable ones the scanner actually released, which a regex cannot.
  taskBox: /^(?:[-*+]|\d{1,2}[.)])[ \t]\[[xX]\]/m,
  taskNested: /^(?:>|[-*+]|\d[.)]) (?:> )?(?:parent|- \[|> -)/m,
  taskSetextReclaim: /\[[xX]\][^\n]*\n(?:[^\n]*\n)? {2,4}(?:===|---)\n/,
  taskTableReclaim: /\[[xX]\][^\n]*\n {2}(?:--- \| ---|-\||:--)/,
  taskLazyMarker: /^para\n2\. \[x\]|^- a\n {2}2\. \[x\]|^para\n {4}- \[x\]/m,
  taskLateDef: /^\[[xX]\]:(?: \/late| \/u\(x|$)/m,
  taskEmptyMarker: /^-\n {2,3}\[x\]|^- \n {2}\[x\]/m,
};

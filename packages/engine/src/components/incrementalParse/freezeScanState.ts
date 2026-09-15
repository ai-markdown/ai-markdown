/** Checkpoint representation and initialization. Only confirmed lines mutate this state. */
import { type UnresolvedRef } from './referenceTaint';
import { freshTaskContext, type TaskContext } from './taskListContext';

export interface FreezeBoundaryOptions {
  /** Whether remark-definition-list is in the active plugin chain (the
   *  `enginePlugins` selection includes `definitionList`). Enables blockers 3b/4. */
  defListEnabled: boolean;
  /**
   * Whether `$$` flow math is in the grammar (remark-math). Three states:
   *
   * - `true` declares it. A `$$` region is verbatim math: no candidate
   *   inside it, its lines are not scanned for anything, and the task-list
   *   tracker may certify a box whose paragraph a `$$` opener closed. The
   *   adapters pass this (`buildCoreRemarkPlugins` always includes
   *   remark-math).
   * - `false` declares its absence. `$$` lines are ordinary paragraph text,
   *   scanned like any other line and never a fence. The def-label scanner
   *   runs this profile (its pinned remark-parse+gfm subset has no math).
   * - omitted means unknown, and the scanner takes the union of the two
   *   grammars: a `$$` opener still holds every candidate until its closer
   *   line (`MathHold`), AND every line of the region is scanned as text —
   *   references, html and raw-text state, fence openers, the task tracker
   *   — so nothing the no-math grammar would see is missed. Definitions
   *   inside the region register in neither reading, and state the two
   *   readings disagree about at the closer poisons the region. This is
   *   the safe choice for a caller that does not know its chain, and the
   *   slower one: a smaller boundary is always acceptable, a larger one
   *   never (2026-09-15 review of ab0042a: with the old "assume math"
   *   default a remark-gfm caller without remark-math had `$$\n[x]\n$$`
   *   frozen while the full parse later turned `[x]` into a reference).
   *
   * All three are distinct checkpoint profiles.
   */
  mathFlow?: boolean;
  /**
   * Whether blocker 5 (reference taint) applies. Default `true`: the
   * engine must reject candidates past an unresolved `[label]` because a
   * later definition retargets the reference's PARSE. The def-label
   * scanner only extracts definition IDENTITIES — a pure block-level fact
   * unaffected by how inline references resolve — and under taint a
   * streaming citation footer (defs with no settling blank line yet)
   * collapses the boundary to the body's first reference, zeroing the
   * caching this profile exists for. `false` skips ref tracking entirely.
   */
  referenceTaint?: boolean;
  /**
   * Whether the grammar has GFM task-list items (remark-gfm). Default
   * `false`: under plain CommonMark `- [x] a` is a paragraph whose `[x]` a
   * later `[x]:` definition retargets, so the scanner must keep the
   * reference taint. With `true`, a checked box that provably sits where
   * micromark's `tasklistCheck` consumes it — the first content of a list
   * item, its paragraph closed for good — is released from the taint by
   * exact source position (see `taskListContext.ts`). Callers that build
   * the engine's own chain (`buildCoreRemarkPlugins`) pass `true`; a
   * caller with an arbitrary chain must not, unless it knows the chain
   * has the construct. Certifying on a `$$` opener additionally requires
   * `mathFlow: true`. Part of the checkpoint profile: a checkpoint built
   * under one value is not resumable under the other.
   */
  gfmTaskListItems?: boolean;
}

export interface FreezeScanResult {
  /** Largest freeze-safe boundary, or 0 when nothing can be frozen. */
  boundary: number;
  /** Opaque resume state — pass back on the next APPEND-ONLY call to skip
   *  re-lexing the confirmed prefix. Single-consumer; see module docs. */
  checkpoint: FreezeScanCheckpoint;
}

export interface LineRec {
  start: number;
  end: number; // offset of the terminating \n, or text.length for the last line
  text: string; // line content WITHOUT the line ending (a CRLF's `\r` is stripped too)
  blank: boolean;
  indent: number; // leading whitespace width, tab = 4 (approximation)
}

export interface Candidate {
  /** Freeze boundary: start of the line after this blank line. */
  offset: number;
  /** Consecutive confirmed blank lines (outside fences/math) ending here. */
  blankRun: number;
  /** No unbalanced HTML container / comment / raw block before this point. */
  htmlBalanced: boolean;
  /** Rolling continuation-hazard verdict at emission (blocker 3). */
  hazard: boolean;
  /** Blocker-6: the run ending at this blank left balanced FLOATING raw
   *  remnant whose hast seam is tail-dependent; reject this candidate. */
  seamRisk: boolean;
  /** Blocker-4 settle verdict, decided by the NEXT confirmed line (`null`
   *  while that line hasn't confirmed — only the newest candidate can be
   *  pending). Storing the verdict instead of the line lets the checkpoint
   *  drop its lines array, which retained a full copy of the document
   *  (round-2 review: ~2-3× doc size per mounted instance). */
  defListSettled: boolean | null;
}

/** micromark's open VERBATIM flow construct at a line boundary (two-model
 *  P4a, first slice): fenced code and `$$` flow math — the members whose
 *  interiors are candidate-free and whose close is a marker line. The
 *  html-block types join this union in the next slice. `indent` is the
 *  opener line's indent (0-3): only a column-0 opener is provably
 *  top-level, so `pendingFenceCloser` suppresses the closer otherwise
 *  (v2.4.0 review R1). Members are REPLACED, never mutated (see P5Tok). */
export type MdBlock =
  | { kind: 'none' }
  | { kind: 'fence'; char: string; len: number; indent: number }
  | { kind: 'math'; len: number; indent: number }
  /** Type 1, the one html block whose four names do NOT share a parse5
   *  answer: `script`/`style`/`textarea` are raw-text elements, `pre` is
   *  not (it is absent from `RAW_TEXT_ELEMENTS`, and parse5 tokenizes its
   *  content in the DATA state). `raw` carries that fact ON the member,
   *  taken from the name at the claim site — the consumer that needs it
   *  asks about PARSE5's grammar, not micromark's, and inferring it from
   *  `p5Tok` there would read a field the same line sets one phase later.
   *
   *  `indent` is the opener line's indent, and carries the same meaning it
   *  does on `fence`/`math` above: only a column-0 opener is provably
   *  top-level. An html block opened at indent 1-3 may be a list item's
   *  content (`- a` then `  <table>`), and the F19 guard reads it for
   *  exactly that — a barrier inside a container-HELD html block still
   *  straddles the item's generated end tag. */
  | { kind: 'html'; type: 1; raw: boolean; indent: number }
  /** The rest of the CommonMark html blocks. Types 2-5 end by their own
   *  terminators; types 6/7 end at the blank. Type 7 is entered by the
   *  EXACT §4.6 test (`isType7Line`) since the exact-type-7 stage — the
   *  attribute-quote hole the approximate test had (and the retired
   *  `mayBeRawToMicromark` flag covered) is
   *  closed, which is what let the remaining run-flag consumers migrate
   *  to the member. */
  | { kind: 'html'; type: 2 | 3 | 4 | 5 | 6 | 7; indent: number };

/** parse5 tokenizer macro-state at a LINE BOUNDARY (two-model P3a, T3.1).
 *  A PARTITION of {data, rawText, script, bogus} — measured before the
 *  design was frozen: the within-tag attribute position co-exists with any
 *  of these (`<iframe>\n</iframe a="`), so it is the separate `pendingTag`
 *  overlay, NOT a member. `openedInline` is captured AT OPEN (the old
 *  `rawTextInline` latch — the run state is reset before the poison that
 *  reads it, so a live read would lose the poison). Members are REPLACED,
 *  never mutated: checkpoints are shared mutable state, and a module-level
 *  token constant would alias across mounted documents. */
export type P5Tok =
  | { kind: 'data' }
  /** RAWTEXT / RCDATA content: everything is text until `</element`. */
  | { kind: 'rawText'; element: string; openedInline: boolean }
  /** SCRIPT_DATA with the full escape ladder (P3b batch 1, the F6
   *  retirement): `escaped` = a `<!--` ran without its `-->`; `double` = a
   *  nested `<script` start tag arrived while escaped (implies `escaped`).
   *  While `double`, a `</script>` steps back to escaped and the ELEMENT
   *  STAYS OPEN (and stays counted on `openStack`); `-->` exits BOTH
   *  levels (double-escaped dash-dash on `>` goes straight to
   *  SCRIPT_DATA — parse5 tokenizer, verified in source). The old
   *  double-entry POISON is retired: the tangle sits identically in the
   *  prefix of every future parse, so candidates may release once the
   *  element truly closes — the splice side refuses these prefixes
   *  separately (rawTextRegionCrossesOut), because the element CROSSES
   *  micromark blocks and swallows their wrap separator. */
  | { kind: 'script'; escaped: boolean; double: boolean; openedInline: boolean }
  /** COMMENT state: `<!--` seen, closes at `-->` — or at `--!>`, which
   *  micromark does NOT accept; that split is why this is a separate
   *  field from `mdBlock` html{2} (P4b-completion, commit 1). Until the
   *  divergence actually opens, the two agree everywhere; where it opens,
   *  the relation poison has already fired. */
  | { kind: 'comment' }
  /** Bogus comment: eaten to the next `>`. */
  | { kind: 'bogus' };

/** Opaque resume token. Produced by one `computeFreezeBoundary` call and
 *  passed back on the next APPEND-ONLY call; the only supported operations
 *  are storing it and passing it back. The field set is an implementation
 *  detail of the scanner and changes between minor versions — the brand key
 *  (a structural string literal, safe across dual d.ts entries) is all that
 *  ships in the public type. */
export interface FreezeScanCheckpoint {
  readonly '~freezeScanCheckpoint'?: never;
}

/**
 * An open `$$` region under the UNKNOWN math capability (`mathFlow`
 * omitted). The scanner runs the text reading on every line of the region
 * and keeps this record for the math reading, then merges the two at the
 * closer line:
 *
 * - the text reading only ever adds blockers inside the region (references,
 *   open elements, poisons), so its state carries out unchanged, except
 *   that a closing tag may not pop an element opened BEFORE the region
 *   (`stackFloor`) — under the math reading that element is still open;
 * - the fields the math reading would have left untouched are OR-ed back
 *   in from the values captured at the opener (`hazardAtOpen`,
 *   `sealAtOpen`, `defBlockAtOpen`, `fnDefAtOpen`), so a verdict the text
 *   reading cleared inside the region still blocks;
 * - if the text reading is not back in the clean state at the closer (an
 *   html block, fence, comment, raw-text element or pending tag still
 *   open, or elements opened inside the region still on the stack), the
 *   two readings disagree about every later byte and the phase is poisoned
 *   from `start` (sticky, pure over-block: the boundary may still sit at
 *   the opener, and the region re-parses in the tail);
 * - `contentOpenUnknown` is armed for the lines after the closer.
 *
 * A region that never closes holds every later candidate, exactly like the
 * declared math member.
 */
export interface MathHold {
  /** Start offset of the opener line — where a poison from this region lands. */
  start: number;
  /** Length of the opening dollar run; a closer needs at least as many. */
  len: number;
  /** Indent of the opener line (only a column-0 opener is provably top-level). */
  indent: number;
  /** `openStack.length` at the opener, before the opener line's own tags. */
  stackFloor: number;
  /** `hazardVerdict` after the opener line, the math reading's value for
   *  the whole region. */
  hazardAtOpen: boolean;
  /** `p5SealPending` / `defBlockMaybeOpen` / `fnDefResumable` at the opener,
   *  which the math reading carries through the region unchanged. */
  sealAtOpen: boolean;
  defBlockAtOpen: boolean;
  fnDefAtOpen: boolean;
}

/** Mutable resume state — the real shape behind `FreezeScanCheckpoint`.
 *  Intra-package only (the scanner and its tests); not reachable from the
 *  public entry, so the shape stays out of `dist/index.d.ts`. All fields
 *  describe the scan strictly BEFORE the first unconfirmed character
 *  (`confirmedOffset`). */
export interface FreezeScanCheckpointInternal extends FreezeScanCheckpoint {
  defListEnabled: boolean;
  /** Grammar-profile switches baked at creation — a checkpoint is only
   *  resumable under the exact profile that built it. The two math
   *  booleans encode the option's three states: `mathFlow` is whether a
   *  `$$` opener blocks candidates at all (`true` and omitted), and
   *  `mathDeclared` is `FreezeBoundaryOptions.mathFlow === true` — the
   *  only state in which a `$$` region is verbatim and the task-list
   *  tracker may certify on its opener. `mathFlow && !mathDeclared` is
   *  the unknown state, tracked through `mathHold`. */
  mathFlow: boolean;
  mathDeclared: boolean;
  /** The undeclared-math union's blocker: a `$$` region open under the
   *  unknown capability (`mathFlow && !mathDeclared`). While set, the
   *  blank branch emits no candidate, closing tags may not pop elements
   *  opened before the region, and definitions do not register; the
   *  closer line clears it and merges the two readings (see `MathHold`).
   *  Null in the declared profiles, where the math member on `mdBlock`
   *  (declared) or nothing (absent) plays this role. */
  mathHold: MathHold | null;
  /** After the closer of an undeclared `$$` region micromark's content
   *  construct is closed under the math reading and open under the text
   *  reading (the closer is a paragraph line there). Neither answer is
   *  conservative for the type-7 interrupt gate or the seal release, so
   *  while this holds a type-7-shaped line poisons the phase and the seam
   *  release withholds. Cleared at the next blank line, where both
   *  readings agree content is closed. */
  contentOpenUnknown: boolean;
  referenceTaint: boolean;
  gfmTaskListItems: boolean;
  /** `referenceTaint && gfmTaskListItems`: the task-list tracker runs. The
   *  def-label scanner profile has no references to release, so it pays
   *  nothing for the tracker. */
  taskTracking: boolean;
  /** Container and paragraph state of the task-list tracker
   *  (`taskListContext.ts`); inert when `taskTracking` is false. */
  task: TaskContext;
  /** Box offsets the tracker certified since the last settle; consumed by
   *  `settleRefsAndEarliestUnresolved`, which drops the reference at each
   *  offset and empties the list. */
  taskCertified: number[];
  /** Start offset of the first line NOT yet baked into this checkpoint. */
  confirmedOffset: number;
  candidates: Candidate[];
  defs: Map<string, number>; // normalized label → def line end offset
  footnoteDefs: Map<string, number>;
  unresolvedRefs: UnresolvedRef[];
  tagBalance: Map<string, number>;
  openTotal: number;
  /** parse5's tokenizer macro-state (see `P5Tok`). Bogus comment (`<!` not
   *  followed by `--` / letter / `[CDATA[`, or `</` not followed by a
   *  letter — eaten up to the next `>`; micromark has no such construct),
   *  raw-text content, script data with its escape flag. */
  p5Tok: P5Tok;
  /** micromark's open verbatim flow construct (see `MdBlock`). */
  mdBlock: MdBlock;
  blankRun: number;
  lastBlankStart: number;
  /** Rolling blocker-3 verdict ("nearest decisive block start so far"). */
  hazardVerdict: boolean;
  /** Previous confirmed line was blank (block-start detection). */
  prevLineBlank: boolean;
  /** Previous confirmed line was a plain text line (def-chain detection). */
  prevLineWasText: boolean;
  /** Previous confirmed line registered a VALID definition (def chains). */
  prevLineWasValidDef: boolean;
  /** micromark's "content construct open" after the previous confirmed
   *  line — the EXACT interrupt input for §4.6 condition 7. micromark
   *  refuses type 7 while its CONTENT construct (paragraph or definition
   *  chain, including container-held paragraphs) is open; `prevLineWasText`
   *  ("any non-blank line") over-claims that, refusing after headings,
   *  thematic breaks, raw-construct terminator lines and fence closes —
   *  all measured as type-7-OPENING to micromark. The decision table at
   *  the end of the plain path derives this per line class; the one class
   *  a line model cannot settle (a pipe line: GFM table row, after which
   *  type 7 OPENS, vs pipe-bearing paragraph, after which it cannot) is
   *  poisoned at the refused tag line instead — see `tableMaybeOpen`. */
  prevLineOpenContent: boolean;
  /** A GFM table MAY be open: a pipe line was seen and every line since
   *  has been table-continuable. A table, once its header/delimiter pair
   *  formed, is continued by ANY non-blank line that is not another
   *  block-level structure — `| 1 | 2 |` then `see [a] prose` is TWO
   *  table rows to micromark, not a table and a paragraph (soak seed
   *  20283008: a tag line after such a pipe-less continuation row was
   *  refused as "after content" while micromark, whose table had just
   *  been broken by the html block, OPENED type 7 — the phantom closer
   *  then chased a math block that never existed). Sticky across
   *  content-class lines, cleared by every openContent=false class and
   *  at the usual reset points. Consumed only by the type-7 residual
   *  poison — over-claiming it only widens the poison (safe). */
  tableMaybeOpen: boolean;
  /** A CONTAINER may be open: a blockquote / list-item / footnote-def
   *  marker line was seen and every line since has been container-
   *  continuable. micromark's `tagName` carries a `!self.parser.lazy`
   *  exception the content model has no input for — a type-7-shaped line
   *  that LAZILY continues an open container opens a container-held html
   *  block (`> quoted` then `<x-y/>`), and a container whose last line was
   *  not a paragraph CLOSES instead, leaving the same line to open a
   *  top-level multi-line block (`> # h` then `<x-y/>`). Both readings say
   *  "opens" where `prevLineOpenContent` says "refused", and which one
   *  holds depends on container state a line model does not track (16 of
   *  21 container prefixes diverged, none poisoned — 2026-08-26 review).
   *  Sticky and reset exactly like `tableMaybeOpen`, and consumed by the
   *  same residual poison: over-claiming it only widens the poison. */
  containerMaybeOpen: boolean;
  /** An earlier line of the current paragraph left an unpaired backtick
   *  run — masking is disabled until the paragraph ends (safety gate). */
  /** A `[` left unclosed at the end of a paragraph line (code spans
   *  masked). micromark lets a reference label span soft line breaks, so
   *  the label may close on a LATER line where the per-line REF_RE never
   *  sees a `[…]` pair (v2.4.1 review P1: `see [foo\nbar] end` + a late
   *  `[foo bar]: /u` retargeted frozen output). Cleared wherever the
   *  paragraph ends. */
  openBracket: { offset: number; text: string } | null;
  paragraphHasUnpairedRun: boolean;
  /** Blocker-6 pending flag: a confirmed html-flow line left balanced
   *  floating raw remnant, and no later content line has pinned the seam
   *  yet. Persists across blank lines (every candidate emitted while set
   *  has the remnant as its last frozen child); cleared by the next
   *  non-blank line that starts OUTSIDE an html-flow run. */
  /* ^ P-seal, explicitly (two-model T3.2): of the four (P) conditions this
   *   is the genuinely retroactive one — the last root-level node the
   *   frozen prefix contributed can still be EXTENDED by later bytes
   *   (parse5's insertText appends to an existing trailing text node). */
  p5SealPending: boolean;
  /** A definition may still be OPEN: a def-shaped line was seen and no
   *  blank has ended it yet. A definition spans up to three lines (label,
   *  destination, title) and its title may wrap inside its quotes, and
   *  every line after the first emits NO hast node — so none of them can
   *  pin the blocker-6 seam, exactly like the def line itself. The seal
   *  release tested the line's own SHAPE, which caught only the first
   *  (soak 20289117, seed shard 17: `[b]: /b "t` + `w"` released the seam
   *  and the frozen remnant node went position-less to positioned under a
   *  `-->` future). Cleared at the blank, where a definition provably
   *  ends; read only by the seal release, where holding it over-blocks. */
  defBlockMaybeOpen: boolean;
  /** A FOOTNOTE definition may still be RESUMABLE: `[^…]:` was seen and no
   *  line since has definitively interrupted the block. Unlike a link
   *  definition (whose `defBlockMaybeOpen` a blank provably ends), a
   *  footnote body CONTINUES ACROSS blank lines via ≥4-indent lines — the
   *  list-item continuation rule — and a resumed body paragraph then takes
   *  LAZY continuation lines at ANY indent. None of those lines emits a
   *  top-level hast node (the body renders in the footer section), so none
   *  of them may release the blocker-6 seam. The seal release's first view
   *  classified a post-blank indented line as indented CODE and released a
   *  live seam (release-gate finding A, seed 20293003 — F16, the
   *  cross-blank sibling of F15); its second view kept an `indent >= 4`
   *  conjunct, which the lazy continuation refuted at indent 0 (F18, the
   *  adversarial review of the derived-release design). Armed by a
   *  footnote-def line; kept across blanks and every non-interrupting line;
   *  cleared by a confirmed non-blank BLOCK-START line at indent ≤ 3, the
   *  one shape no footnote body can resume past (blank above ⟹ not lazy).
   *  Read only by the seal release, where holding it over-blocks. */
  fnDefResumable: boolean;
  /** Offset of the first fence/math OPEN suppressed inside an html-flow
   *  run — the member gate since Migration B row 6 (Infinity = none). Whether the run really swallowed that line depends
   *  on container context the line scan cannot see (`<embed` inside a list
   *  item is a lazy paragraph line, and the glued `$$` a REAL math open —
   *  seed-20260757 under-block: the tracker's fence phase INVERTS from that
   *  line on, every later close reads as an open, and the corruption never
   *  resyncs). Candidates past this offset are rejected outright — sticky,
   *  pure over-block. Earlier candidates still require reference settlement
   *  using definitions before this offset; later definition-shaped text
   *  may belong to an uncertain HTML or math block. This field is the sticky
   *  phase-corruption backstop (the old rolling hazard poison for
   *  "ambiguous tag names" retired with exact type 7). */
  phasePoisonedAt: number;
  /** Tag names of line-truncated opens (`<div` at EOL) counted into
   *  tagBalance but not yet confirmed by a later `>` — reverted at the next
   *  blank line (a tag cannot span one). See TRUNCATED_TAG_RE. */
  pendingTruncatedTags: string[];
  /** Line-truncated CLOSING tags (`</div` + EOL, no `>`) inside an html-flow
   *  run, waiting for a `>` on a later line of the same run. Unlike opens
   *  they are NOT counted up front: a close tag cannot carry attributes, so
   *  `para </style` (prose to micromark, still-open element to parse5 —
   *  RAWTEXT waits for the `>`) must not zero the balance (2026-08-19
   *  review P1 — the boundary crossed an open `<style>`). Confirmed and
   *  applied only when a later line of the run brings the `>` (parse5
   *  completes the end tag; micromark's block ends at the blank anyway);
   *  dropped unapplied at the blank (element stays counted — over-block).
   *  Paragraph-context truncated closes are never pended: a `>` at block
   *  indent on the next line is a blockquote to micromark, and the one
   *  shape that would complete the inline close (`</b\n    >`, a 4+-space
   *  lazy continuation) is not modelled — the element stays counted,
   *  over-block. */
  pendingTruncatedCloses: string[];
  /** An html-flow line ended inside a tag (`<div`, `</div`, `<br` — open,
   *  close or void, with or without attributes): parse5's tokenizer is
   *  still in that tag, so on the following lines everything up to the
   *  FIRST `>` is attribute garbage — `</div>` there does NOT close
   *  anything (oracle review of 2.4.4: `<div>\n<div>\n</div\n</div>` froze
   *  past the still-open outer div; pre-existing, 1-char slices). While
   *  set: a line without `>` gets no tag scan at all; the line with the
   *  `>` completes the pending close (if any), then only its text after
   *  that `>` is scanned. Cleared there and at the blank line. */
  pendingTag: {
    /** parse5's position inside the tag's attribute area at the end of the
     *  last scanned line (see TagAttrState). A quoted value left open
     *  swallows `>` and line endings; a `>` while `outside` ends the tag. */
    attr: TagAttrState;
    /** Indent of the line that entered the tag. A following line that
     *  DE-INDENTS below it may have left the container (a list item's html
     *  block ends there; hast-util-raw resets the tokenizer at the li/ul
     *  boundary, so a `<div>` on that line is a real start tag, not
     *  garbage) — or may still be the same html block (root-level
     *  `  </div\n</div>`, still garbage). Unknowable here → poison. */
    indent: number;
  } | null;
  /** The open-element stack, in order. `tagBalance` and `openTotal` are
   *  derived views kept in step with it, but the STACK is the truth: an end
   *  tag's effect depends on what sits BETWEEN it and its match, which a
   *  name→count bag cannot represent (see SCOPE_BARRIER_NAMES). */
  openStack: string[];
  /**
   * parse5's `formElement` pointer, modelled as "may be non-null".
   *
   * The pointer is set by a `<form>` start tag and cleared ONLY by
   * `</form>`; a form closed implicitly (its container's end tag pops it)
   * leaves the pointer set, and a later `<form>` is then IGNORED. That is
   * the standing proof that enumerating (P) conditions cannot be made
   * complete — `<div><form></div>` ++ `<form>b</form>` diverges with every
   * enumerated condition clean (see `formElementLatent.test.ts`).
   *
   * It was latent without this field, and latent for a reason that had
   * nothing to do with forms: the end-tag walk removes only the MATCHED
   * element, so the implicitly-closed `<form>` stayed on `openStack` and
   * `openTotal > 0` refused every candidate. A defence that happens to
   * point at the hazard is the second-mechanism cover this ledger has now
   * recorded four times, and it came with a written note that implied-end-
   * tag modelling "must bring an explicit formElement field with it" —
   * a condition on a future change is not a guard, it is a hope with a
   * deadline nobody owns.
   *
   * So the rule is modelled directly. Cost measured at zero: every shape
   * this rejects, `openTotal` was already rejecting, so no boundary moves
   * (0 of 6060) — what changes is that the guarantee no longer depends on
   * an unrelated modelling choice staying unchanged.
   *
   * Direction: parse5 clears the pointer on `</form>` BEFORE the in-scope
   * check, so it clears at least as often as this does. Staying set longer
   * than parse5 over-blocks, which is the safe side.
   */
  formPointerMaybeSet: boolean;
}

/** parse5 tokenizer position inside a tag's attribute area, tracked across
 *  line endings for `pendingTag` (2026-08-19 review r2 P1-2 / P2-3):
 *  `outside` = before/in an attribute name (a `"` here starts a NAME, not a
 *  value); `afterEq` = just past `=`; `unquoted` = in an unquoted value
 *  (whitespace ends it); `"` / `'` = inside a quoted value — `>` and line
 *  endings are value bytes there, only the matching quote leaves it. */
export type TagAttrState = 'outside' | 'afterEq' | 'unquoted' | '"' | "'";

/** The grammar profile a checkpoint is built under (the switches
 *  `computeFreezeBoundary` derives from `FreezeBoundaryOptions`). */
export interface CheckpointProfile {
  defListEnabled: boolean;
  mathFlow: boolean;
  mathDeclared: boolean;
  referenceTaint: boolean;
  gfmTaskListItems: boolean;
}

export function freshCheckpoint(profile: CheckpointProfile): FreezeScanCheckpointInternal {
  const { defListEnabled, mathFlow, mathDeclared, referenceTaint, gfmTaskListItems } = profile;
  return {
    defListEnabled,
    mathFlow,
    mathDeclared,
    referenceTaint,
    gfmTaskListItems,
    taskTracking: referenceTaint && gfmTaskListItems,
    task: freshTaskContext(),
    taskCertified: [],
    confirmedOffset: 0,
    candidates: [],
    defs: new Map(),
    footnoteDefs: new Map(),
    unresolvedRefs: [],
    tagBalance: new Map(),
    openTotal: 0,
    p5Tok: { kind: 'data' },
    formPointerMaybeSet: false,
    openStack: [],
    mdBlock: { kind: 'none' },
    mathHold: null,
    contentOpenUnknown: false,
    blankRun: 0,
    lastBlankStart: -1,
    hazardVerdict: false,
    prevLineBlank: true, // doc start counts as a block start
    prevLineWasText: false,
    prevLineWasValidDef: false,
    prevLineOpenContent: false,
    tableMaybeOpen: false,
    containerMaybeOpen: false,
    paragraphHasUnpairedRun: false,
    openBracket: null,
    p5SealPending: false,
    defBlockMaybeOpen: false,
    fnDefResumable: false,
    phasePoisonedAt: Infinity,
    pendingTruncatedTags: [],
    pendingTruncatedCloses: [],
    pendingTag: null,
  };
}

/**
 * The closing line that would end the fence / flow-math block still open at
 * the checkpoint, or `''` when nothing provably closable is open. The whole
 * decision is scanner-domain, so it lives here rather than in the consumer:
 * a poisoned fence/math phase (blocker 7) means the "open" flags cannot be
 * trusted and a wrong closer would OPEN a block, and only a column-0 opener
 * is provably top-level (`openIndent` docs). `phantomSuffixCloser` prepends
 * its own newline handling; the returned text is the bare closer run.
 */
export function pendingFenceCloser(checkpoint: FreezeScanCheckpoint): string {
  const cp = checkpoint as FreezeScanCheckpointInternal;
  if (cp.phasePoisonedAt !== Infinity) return '';
  // An undeclared `$$` region takes precedence over anything the text
  // reading opened inside it: this consumer does not know the grammar
  // either, and the `$$` closer is what the unknown state produced before
  // the union (the shipped adapters all have remark-math). Under a chain
  // without it the closer is a paragraph line in the tail — a display
  // cost only, since the suffix is never frozen.
  if (cp.mathHold !== null) return cp.mathHold.indent === 0 ? '$'.repeat(cp.mathHold.len) : '';
  if (cp.mdBlock.kind === 'fence' && cp.mdBlock.indent === 0) return cp.mdBlock.char.repeat(cp.mdBlock.len);
  if (cp.mdBlock.kind === 'math' && cp.mdBlock.indent === 0) return '$'.repeat(cp.mdBlock.len);
  return '';
}

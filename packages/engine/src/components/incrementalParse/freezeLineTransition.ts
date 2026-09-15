/** Apply one confirmed line to the two grammar states. Transition order is intentional. */
import {
  TAG_OR_COMMENT_RE,
  TYPE1_START_RE,
  isType7Line,
  TYPE6_START_RE,
  TYPE6_NAMES,
  canBecomeDdLine,
  FOREIGN_ROOT_NAMES,
  inRawTextTok,
  rawTextElement,
  RAW_TEXT_ELEMENTS,
  NO_ELEMENT_NAMES,
  SCOPE_BARRIER_NAMES,
  P5_SPECIAL_NAMES,
  takesGenericEndTagRule,
  TABLE_PART_NAMES,
  commentEitherOpen,
  mdHtml,
  P5_MARKUP_RE,
  mdHtml25,
  FENCE_RE,
  classifyBlockStart,
  MATH_RUN_RE,
  LIST_MARKER_RE,
  DEF_LIST_DD_RE,
  maskIntraLineCodeSpans,
  mdType1RawText,
  tailCarriesRetroactive,
  scanTagAttrs,
  VOID_TAGS,
  TAG_START_LT_RE,
  TRUNCATED_TAG_RE,
  TYPE1_CLOSE_RE,
  ATX_HEADING_RE,
  THEMATIC_BREAK_RE,
  BARE_MARKER_RE,
  SETEXT_LEFTOVER_RE,
  CONTAINER_MARKER_RE,
  RAW_CONSTRUCT_START_RE,
} from './freezeLineSyntax';
import {
  type FreezeScanCheckpointInternal,
  type LineRec,
  type MathHold,
  type P5Tok,
  type TagAttrState,
} from './freezeScanState';
import { mdTrimStart, isMdBlank } from './mdLineText';
import { DEF_RE, FOOTNOTE_DEF_RE, collectRefLine } from './referenceTaint';
import { assertSealReleaseContained } from './sealReleaseContainment';
import { advanceTaskLine } from './taskListContext';

/**
 * Blocker-6 residue: the bytes of a line that are neither tags nor comment
 * tokens/content — floating raw text — computed with the SAME comment state
 * machine as the balance scan (`commentOpenAtStart` carried in from the
 * previous line; `<!-->`/`<!--->` close on the spot whether or not a comment
 * is open; `--!>` never closes for CommonMark; a stray `-->` outside a
 * comment is text). Raw-construct bytes must already be masked by the caller.
 */
function floatingResidue(text: string, commentOpenAtStart: boolean): string {
  let out = '';
  let open = commentOpenAtStart;
  let last = 0; // start of the not-yet-emitted text run
  TAG_OR_COMMENT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_OR_COMMENT_RE.exec(text)) !== null) {
    if (m[0] === '<!--') {
      const next = text.slice(m.index + 4, m.index + 6);
      const overlapLen = next.startsWith('>') ? 5 : next === '->' ? 6 : 0;
      if (open) {
        if (overlapLen) {
          open = false;
          last = m.index + overlapLen;
          TAG_OR_COMMENT_RE.lastIndex = last;
        }
        continue;
      }
      out += text.slice(last, m.index);
      if (overlapLen) {
        last = m.index + overlapLen;
        TAG_OR_COMMENT_RE.lastIndex = last;
        continue;
      }
      open = true; // content until `-->` is dropped
      continue;
    }
    if (m[0] === '-->') {
      if (open) {
        open = false;
        last = m.index + 3;
      }
      continue; // stray `-->` stays in the text run
    }
    if (m[0] === '--!>') continue; // content (open) or text (closed) either way
    if (open) continue;
    out += text.slice(last, m.index); // a tag: emit the text before it, drop the tag
    last = m.index + m[0].length;
  }
  if (!open) out += text.slice(last);
  return out;
}

/** Blocks a LATER line can continue without emitting a node of its own —
 *  the seal release's L1a input. A link definition takes destination and
 *  title lines; a footnote definition's body resumes across blank lines and
 *  the resumed paragraph then takes lazy continuations at any indent; a
 *  container (list item, blockquote, def-list description) holds content
 *  lines the same way. Membership is per BLOCK, never per line shape: the
 *  gate runs before the line is classified at all, because a line below a
 *  resumable block has no independent block identity to classify. */
const sealResumableAbove = (cp: FreezeScanCheckpointInternal): boolean =>
  cp.defBlockMaybeOpen || cp.fnDefResumable || cp.containerMaybeOpen;

/**
 * Blocker-6 seam release, DERIVED from parse5's own rule instead of
 * enumerated (design rev3 §2/§6).
 *
 * The rule at the token layer: a trailing text node is sealed by a NODE
 * being appended after it, at whatever insertion point is current —
 * `defaultTreeAdapter.insertText` extends the last child only while that
 * child is still a text node, and a root-level append is merely the most
 * common way to stop it. Lifted to lines:
 *
 *   > Release at the first confirmed line whose bytes cause at least one
 *   > node to be appended, at whatever insertion point is current, after
 *   > the remnant.
 *
 * A line does that iff all three of
 *
 *   L1  it STARTS a block (micromark) — not a blank, not the interior of an
 *       open leaf block, not a continuation of a resumable block above;
 *   L2  that block's type has to-hast output — `isWrapInvisible`
 *       (spliceParse) is the exact complement: `definition` and
 *       `footnoteDefinition` are the only invisible types;
 *   L3  that block's serialized output survives parse5 as ≥ 1 node.
 *
 * Every layer is positively decided and an unclassified line WITHHOLDS.
 * That default is the whole point. The enumeration this replaces listed the
 * node-less line classes and released everything it had not listed, so its
 * failure mode was an under-block, and it took one on four separate
 * occasions — def continuations (F15), whole-line stray closers (review
 * M6), cross-blank body continuations (F16), lazy continuations of a
 * resumed body (F18) — each fixed by adding one member to a list whose
 * complement has no enumeration.
 */
function shouldReleaseSeal(cp: FreezeScanCheckpointInternal, ln: LineRec, isBlockStart: boolean): boolean {
  // L1a — the resumable-context gate, ahead of every classification. The
  // only line that provably interrupts a resumable block is a BLOCK-START
  // line at ≤ 3 indent: blank above means it cannot be a lazy continuation,
  // ≤ 3 indent means no 4-indent-gated body can resume through it. Below
  // that interruption the rule is indent-INDEPENDENT, and every
  // indent-conditioned reading of it has been refuted (F16's `indent >= 4`
  // conjunct fell to a lazy continuation at indent 0 within hours of
  // landing). The escape stays sound for CONTAINERS by the general seal
  // rule above: a ≤3-indent line below an open list item either continues
  // the item — appending its paragraph INSIDE the item, after the remnant —
  // or closes the container, appending at the root after the whole list.
  if (sealResumableAbove(cp) && !(isBlockStart && ln.indent <= 3)) return false;
  // L1b — the line must START a block. `prevLineOpenContent` is micromark's
  // own "content construct open" answer, derived per line class by the
  // decision table at the end of this function; while it holds, this line
  // belongs to the block above and appends nothing of its own.
  if (cp.prevLineOpenContent) return false;
  // After an undeclared `$$` closer the two readings disagree about the
  // content construct until the next blank; UNKNOWN withholds.
  if (cp.contentOpenUnknown) return false;
  // The one class the line model cannot settle stays UNKNOWN, and UNKNOWN
  // withholds: after a pipe line, whether a GFM table is open decides
  // whether this line is another ROW (no node of its own) or a fresh block.
  if (cp.tableMaybeOpen) return false;
  // Both conjuncts above are the model speaking, not a measured guard, and
  // the difference is worth writing down: over the pinned corpus neither
  // decided a single verdict the enumeration would have decided otherwise
  // (every divergence was L3). They are unreachable through TODAY's arm site
  // — a line that arms the seam is html-owned, which closes content and
  // disarms both markers — so they cost nothing and hold the moment the arm
  // widens. Delete them only together with that argument.
  const head = mdTrimStart(ln.text);
  // L3 — parse5 survival, uniform across the whole html-flow class. The
  // class holds both node-emitting members (`<div>` opens an element) and
  // the parse5-DROPPED ones (a stray end tag, a doctype, a
  // document-structure name — no node, the remnant stays last), and the
  // enumeration leaked on that split twice: M6 for whole-line closers, and
  // again on doctype and `<html>`/`<head>` lines, which it released while
  // parse5 leaves no node for any of them (found by this migration's own
  // tripwire, inert only because the document-structure poison happened to
  // cover them). It also released a whole-line `<?instr ?>` while withholding
  // a whole-line `<!-- note -->` — same class, neither answer earned, and
  // that release is revoked here. Releasing the emitting half of the class is
  // a precision change with its own attribution, not part of this landing. The test runs at ANY indent: a
  // ≥4-indent html-shaped line is indented CODE and does emit, so
  // withholding it over-blocks rather than claims — and it keeps this
  // predicate at or inside the enumeration's releases, which the migration
  // asserts.
  if (RAW_CONSTRUCT_START_RE.test(head) || TYPE1_START_RE.test(head) || isType7Line(head)) return false;
  const t6 = TYPE6_START_RE.exec(head);
  if (t6 !== null && TYPE6_NAMES.has(t6[1].toLowerCase())) return false;
  // L2 — wrap visibility. A def-SHAPED but INVALID line does emit its
  // paragraph; withholding on the shape only over-blocks, and the shape is
  // all a line model has.
  if (DEF_RE.test(ln.text) || FOOTNOTE_DEF_RE.test(ln.text)) return false;
  // What is left starts a block whose to-hast output is an element —
  // paragraph, heading, thematic break, fence, flow math, list, blockquote,
  // table, indented code — and every one of them appends a node after the
  // remnant.
  return true;
}

/** The line is html-owned in one of the two grammars: an md html block is
 *  open, or parse5's tokenizer is inside a comment, bogus comment or
 *  raw-text element. Read before and after the scanner's transition so a
 *  block that opens or closes ON this line counts too. */
const htmlOwnedState = (cp: FreezeScanCheckpointInternal): boolean =>
  cp.mdBlock.kind === 'html' || cp.p5Tok.kind !== 'data';

/**
 * Bake one confirmed line into the checkpoint: the scanner's own
 * transition (`applyConfirmedLine`, which returns early from its fence,
 * math and blank branches), then the task-list tracker's, fed from the
 * scanner's state before and after so that every return path commits the
 * structural fact the tracker needs — a verbatim interior line, an
 * html-owned line, a fence or math open the scanner took — and the two
 * states can never disagree about which line was baked.
 */
export function processConfirmedLine(cp: FreezeScanCheckpointInternal, ln: LineRec, text: string): void {
  const verbatimBefore = cp.mdBlock.kind === 'fence' || cp.mdBlock.kind === 'math';
  const opaqueBefore = htmlOwnedState(cp);
  // An undeclared `$$` region closes on the math reading's own rule — a
  // dollar run at least as long as the opener with nothing after it — no
  // matter what the text reading makes of that line (it may be inside a
  // fence or an html block the text reading opened). Decided on the raw
  // line before the transition and applied after it, so the merge reads
  // the text reading's settled state for the line.
  const holdBefore = cp.mathHold;
  const closesHold = holdBefore !== null && isMathCloser(ln.text, holdBefore.len);
  applyConfirmedLine(cp, ln, text);
  const holdOpened = holdBefore === null && cp.mathHold !== null;
  if (holdOpened) {
    // The opener line's own block-start verdict is what the math reading
    // carries through the region (its interior never touches it).
    cp.mathHold!.hazardAtOpen = cp.hazardVerdict;
  } else if (closesHold) {
    closeMathHold(cp, holdBefore!);
  }
  // The task tracker cannot own a `$$` line whose grammar is unknown: the
  // opener may or may not have closed the paragraph, and the closer may
  // or may not be paragraph text. Both forget the context (root sync
  // required), exactly like an html-owned line.
  advanceTaskLine(cp, ln, verbatimBefore, opaqueBefore || htmlOwnedState(cp) || holdOpened || closesHold);
}

/** The math reading's closer test (`MATH_RUN_RE` at line start, at least
 *  `len` dollars, only whitespace after), shared by the declared member and
 *  the undeclared hold. */
function isMathCloser(lineText: string, len: number): boolean {
  const close = MATH_RUN_RE.exec(lineText);
  return close !== null && close[1].length >= len && isMdBlank(lineText.slice(close[0].length));
}

/**
 * The closer line of an undeclared `$$` region: merge the math reading
 * (captured in `hold`) back into the text reading's state. The rule is
 * written on `MathHold`.
 */
function closeMathHold(cp: FreezeScanCheckpointInternal, hold: MathHold): void {
  cp.mathHold = null;
  // The text reading must be back where the math reading is — nothing
  // open, nothing pending, no element opened inside the region still on
  // the stack (a phantom truncated open counts: it may still be completed
  // by a later line of the same paragraph under the text reading). Any
  // difference means the two readings assign every later byte to
  // different grammars, and no single line model can serve both: poison
  // from the opener, sticky. Candidates at or before the opener survive.
  const dirty =
    cp.mdBlock.kind !== 'none' ||
    cp.p5Tok.kind !== 'data' ||
    cp.pendingTag !== null ||
    cp.pendingTruncatedCloses.length > 0 ||
    cp.openStack.length !== hold.stackFloor;
  if (dirty) cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, hold.start);
  // Verdicts the text reading may have cleared inside the region and the
  // math reading kept: the union keeps them (each only rejects candidates
  // or withholds a release).
  cp.hazardVerdict = cp.hazardVerdict || hold.hazardAtOpen;
  cp.p5SealPending = cp.p5SealPending || hold.sealAtOpen;
  cp.defBlockMaybeOpen = cp.defBlockMaybeOpen || hold.defBlockAtOpen;
  cp.fnDefResumable = cp.fnDefResumable || hold.fnDefAtOpen;
  // Content closed (math) versus open (text) until the next blank line.
  cp.contentOpenUnknown = true;
}

function applyConfirmedLine(cp: FreezeScanCheckpointInternal, ln: LineRec, text: string): void {
  // Blocker-4 eager settle: this line is the "next confirmed line" of the
  // newest candidate. The verdict uses the RAW line exactly like the old
  // lines-array lookback did (fence/math state deliberately not consulted).
  const newest = cp.candidates[cp.candidates.length - 1];
  if (newest && newest.defListSettled === null) {
    newest.defListSettled = ln.blank ? true : !canBecomeDdLine(ln.text, true);
  }
  const isBlockStart = cp.prevLineBlank;
  // Blocker-6 seam release (see `shouldReleaseSeal` for the rule and its
  // three layers). The three conditions here are L1's leaf-block half,
  // answered from state rather than from the line: a blank line starts no
  // block, a line INSIDE an html-flow run or inside a still-open
  // comment/bogus-comment token is that construct's interior, and the run's
  // own blank keeps the flag so every candidate in the trailing blank run
  // stays rejected.
  //
  // Evaluation order is load-bearing: this runs BEFORE the line's own
  // construct effects (the raw-construct scan and the tag scan sit further
  // down), so the predicate answers from the previous line's state plus
  // this line's raw text.
  if (
    cp.p5SealPending &&
    !ln.blank &&
    cp.mdBlock.kind !== 'html' &&
    !(cp.p5Tok.kind === 'comment' || cp.p5Tok.kind === 'bogus')
  ) {
    if (shouldReleaseSeal(cp, ln, isBlockStart)) {
      cp.p5SealPending = false;
      // The migration's containment assertion, live for one release: the
      // derived predicate must release only where the retired enumeration
      // did (see `sealReleaseContainment.ts`). Dev builds only; the
      // production build folds this gate and drops the module.
      if (process.env.NODE_ENV !== 'production') {
        assertSealReleaseContained(cp, ln, isBlockStart);
      }
    }
  }
  /** Post-collapse (T3.4) this deliberately OVER-claims: parse5 pops the
   *  foreign root on a breakout tag, and no pop is modelled any more — the
   *  bag says "foreign" until the root's own end tag. Both consumers point
   *  the over-claim the safe way (self-closing tags stay counted; raw-text
   *  switches poison). */
  // T3.3 direction contract: every `tagBalance` read goes through a wrapper
  // whose NAME carries the safe direction of doubt. This one may OVER-claim
  // (saying "foreign" when parse5 left it keeps self-closing tags counted —
  // over-blocking); the table one below must UNDER-claim.
  const possiblyInsideForeign = (): boolean => FOREIGN_ROOT_NAMES.some((name) => (cp.tagBalance.get(name) ?? 0) > 0);
  /** A self-closing tag parse5 really closes on the spot. Post-collapse
   *  (two-model T3.4): ONLY the foreign roots themselves — foreign
   *  elements honour the flag in any context. Every other self-closing
   *  tag is counted OPEN: being exact needed the breakout and
   *  integration-point enumerations whose mis-claims were the F1/F2/F5
   *  family, and counting keeps `openTotal` at or above parse5's stack
   *  depth — the over-blocking side. The measured cost is that well-formed
   *  self-closed children (`<svg><circle/></svg>`) stay counted past the
   *  `</svg>` (its scope walk removes only the svg), which blocks freezing
   *  for the rest of the document — reported with the stage's diff. */
  const honoursSelfClosing = (tag: string): boolean => tag === 'svg' || tag === 'math';
  /** T3.3b, the third wrapper direction: whether the tokenizer SWITCHES
   *  for a raw-text element start tag near foreign content is unknowable
   *  to a name-count bag. OVER-claiming the switch opens the raw-text mask
   *  parse5 is not in — the mask suppresses the tag scan, so candidates
   *  get MORE likely to survive and the boundary RISES (measured:
   *  `<svg><title><div></title></svg>` is safe today only because the
   *  un-switched `<div>` sits on the open stack). UNDER-claiming keeps the
   *  mask shut where parse5 opens it — F2, the shipped under-block.
   *  Neither direction is safe, so the honest answer is a poison. */
  const foreignRawTextSwitchUnknowable = (): boolean => possiblyInsideForeign();
  /** This line carried an end tag parse5 DISCARDS (F24). Consumed by the
   *  blocker-6 arm below — see the `idx === -1` branch for the rule. */
  let discardedEndTag = false;
  /** `revert`: the blank-line undo of a phantom truncated open — the
   *  scanner's own bookkeeping, not a text-grammar close, so it may pop
   *  below an undeclared `$$` region's stack floor. */
  const applyTag = (tag: string, closing: boolean, revert = false): void => {
    // Inside a raw-text element only its own end tag is markup.
    if (inRawTextTok(cp.p5Tok)) {
      // "Script data double escaped" (F6, retired poison → exact ladder):
      // inside an escaped `<script>` a nested `<script` start tag makes
      // parse5 stop honouring `</script>` — the first one only steps back
      // to escaped, and the element runs on. CommonMark ends its type-1
      // block at the first literal closer line regardless, so the two
      // grammars diverge about which BYTES are raw for the length of the
      // window — during it the element stays counted (no release), and
      // the frozen-prefix consequences are the splice guard's job.
      if (cp.p5Tok.kind === 'script' && cp.p5Tok.escaped && !closing && tag === 'script') {
        cp.p5Tok = { ...cp.p5Tok, double: true };
      }
      if (!(closing && tag === rawTextElement(cp.p5Tok))) return;
      if (cp.p5Tok.kind === 'script' && cp.p5Tok.double) {
        // `</script>` while double-escaped: back to escaped, element open,
        // stack untouched — the early return skips the pop below.
        cp.p5Tok = { ...cp.p5Tok, double: false };
        return;
      }
      cp.p5Tok = { kind: 'data' };
    } else {
      if (!closing && RAW_TEXT_ELEMENTS.has(tag) && foreignRawTextSwitchUnknowable()) {
        cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
      } else if (!closing && RAW_TEXT_ELEMENTS.has(tag)) {
        // Migration collision rule (P3a): entering raw text while another
        // non-data state is live would silently drop that state's blocking
        // effect — poison instead, which can only lower the boundary.
        if (cp.p5Tok.kind !== 'data') cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
        // openedInline: paragraph context, i.e. micromark html-TEXT rather
        // than an html block — the regime where a lifted element rewrites
        // its paragraph. Captured HERE (latched: the run state is reset
        // before the blank-line poison that reads this). Migration A row
        // 1: the member answers "block context" — NARROWER than the old
        // flag by the in-comment promotion artifact, and inert there: a
        // paragraph-inline 3-5 opener poisons document-wide, and tags
        // inside a comment never reach applyTag at all.
        const openedInline = cp.mdBlock.kind !== 'html';
        cp.p5Tok =
          tag === 'script'
            ? { kind: 'script', escaped: false, double: false, openedInline }
            : { kind: 'rawText', element: tag, openedInline };
        // PLAINTEXT never ends (`</plaintext>` is text too): nothing after
        // it can be modelled — poison from here on.
        if (tag === 'plaintext') cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
      }
    }
    // Retroactive construct (see NO_ELEMENT_NAMES): parse5 builds no element
    // under this name, so it erases the tag and merges the text around it,
    // changing hast BEFORE this point. Poison from offset 0 — nothing in the
    // document is freeze-safe once one of these is confirmed, and the poison
    // is monotone so it stays that way. Sits past the raw-text guard on
    // purpose: a `<body>` inside `<script>` is text to parse5 too, and must
    // not poison.
    //
    // Keyed on the NAME rather than on the end tag's discard (F24) because
    // the merge here is RETROACTIVE: it extends a node that starts before the
    // construct, which is the one thing arming a forward seam cannot repair.
    // `<frame>` and `<image>` are not a wider reading of F24; they are the
    // same class as `<body>` and get its treatment.
    if (NO_ELEMENT_NAMES.has(tag)) cp.phasePoisonedAt = 0;
    // `<template>` is the second kind of erasure. Its children go into a
    // content FRAGMENT (`hast-util-from-parse5` hangs them off `.content`,
    // not `.children`), and the sanitize pass then drops the element — so a
    // template block vanishes whole, children and all, and the text around
    // it merges. Inside a container the damage is worse: the direction
    // battery measured a list item swallowing the rest of the document
    // (`- a\n<template>\n<div>x</div>\n</template>` + blank + prose — the
    // later paragraphs land INSIDE the li, and a one-character append
    // rewrites the frozen region via lazy continuation; blockquote form
    // identical; 2026-08-24, scaled soak leg 2). The top-level form measured
    // stable, but "measured harmless" has been refuted three times this
    // week, and erasure merges reach backward (the F9 lesson) — so the
    // poison is document-wide, same as the names above. An earlier sweep
    // recorded template as "swept clean"; that sweep sampled shapes with
    // blank lines around the block, which is exactly the layout where the
    // merge stays invisible.
    if (tag === 'template' && !closing) cp.phasePoisonedAt = 0;
    if (closing) {
      // Walk down for the match, stopping at a scope barrier. No match in
      // scope means parse5 DISCARDS this end tag and the element stays open —
      // so the counts must not move either.
      //
      // A name outside parse5's named end-tag cases takes the "any other
      // end tag" rule, whose walk stops at ANY special element, not only at
      // a barrier (F29): `<span>\n<div>\n</span>\n</div>` drops the
      // `</span>`, and the span swallows the rest of the document. The
      // special set is a superset of the barriers, so this only discards
      // more — the over-blocking side.
      const generic = takesGenericEndTagRule(tag);
      let idx = -1;
      for (let i = cp.openStack.length - 1; i >= 0; i--) {
        if (cp.openStack[i] === tag) {
          idx = i;
          break;
        }
        if (SCOPE_BARRIER_NAMES.has(cp.openStack[i]) || (generic && P5_SPECIAL_NAMES.has(cp.openStack[i]))) break;
      }
      // Inside an undeclared `$$` region a closing tag matching an element
      // opened BEFORE the region is the text reading's close only: under
      // the math reading the tag is math content and the element stays
      // open, so the two readings disagree about the rest of the document.
      // Keep the element (the over-blocking side) and poison from the
      // opener; the token is then treated as discarded below.
      if (idx !== -1 && !revert && cp.mathHold !== null && idx < cp.mathHold.stackFloor) {
        cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, cp.mathHold.start);
        idx = -1;
      }
      if (idx === -1) {
        // parse5's "any other end tag" rule reached its end: no element to
        // pop, so the token is DROPPED and the character data on either side
        // of it lands at one insertion point — one text node where the raw
        // bytes show two runs. That merge is RETROACTIVE, and the trailing
        // half of it can still grow when later bytes arrive, which is
        // blocker 6's own hazard: arm the seam and let the release predicate
        // decide when a node finally sits after it.
        //
        // F24, and the reason this is keyed on the RULE: the hazard used to
        // be covered by `DOCUMENT_STRUCTURE_NAMES` — four names, poisoning
        // the whole document — while parse5 discards end tags by the
        // thousand-name-wide rule above. `</address>\n</address>\n\n` is 23
        // bytes that froze all 23 while the `\n` between the two discarded
        // tags was a live trailing text node; `<area>\n</script >\n\n` is the
        // same shape whose FIRST construct is a void START tag, which is why
        // no reading of it as "stray end tags" closes the class. The four
        // names keep their document-wide poison: they also merge ATTRIBUTES
        // onto elements that already exist, which is an erasure this seam
        // does not model.
        discardedEndTag = true;
        return;
      }
      // Remove ONLY the matched element. What parse5 does with the elements
      // above it depends on which end tag this is: a block name generates
      // implied end tags and pops through, while a formatting name runs the
      // adoption agency, which re-parents rather than popping. Modelling the
      // first would under-count the second — measured, it re-opened four
      // fixtures as fresh under-blocks. Leaving them counted over-blocks,
      // which is the side this scanner is allowed to be wrong on.
      //
      // This rule USED to be the whole mitigation for the formElement latent
      // divergence (design §2.1) — keeping the implicitly-closed form on
      // `openStack` is what held `openTotal` positive and refused the
      // candidates. That cover is no longer load-bearing: the pointer is
      // modelled directly in `formPointerMaybeSet`, so implied-end-tag
      // modelling can land here without carrying a form guard in with it.
      // `formElementLatent.test.ts` pins both halves.
      cp.openStack.splice(idx, 1);
      // parse5 clears the pointer on `</form>`; a form popped by SOMETHING
      // ELSE'S end tag never reaches this line with `tag === 'form'`, which
      // is exactly the implicit close that leaves the pointer set.
      if (tag === 'form') cp.formPointerMaybeSet = false;
      const count = cp.tagBalance.get(tag) ?? 0;
      if (count > 0) {
        cp.tagBalance.set(tag, count - 1);
        cp.openTotal -= 1;
      }
    } else {
      // `<form>` sets parse5's form pointer (see `formPointerMaybeSet`). A
      // second `<form>` while the pointer is set is IGNORED by parse5 — not
      // modelled, and it does not need to be: the flag is already set, so
      // every candidate past it is already refused.
      if (tag === 'form') cp.formPointerMaybeSet = true;
      cp.openStack.push(tag);
      cp.tagBalance.set(tag, (cp.tagBalance.get(tag) ?? 0) + 1);
      cp.openTotal += 1;
    }
  };

  /** A table part only re-routes parse5 when it appears OUTSIDE a table —
   *  which is what TABLE_PART_NAMES has always meant, and what the poison
   *  never checked: a well-formed `<table><tr><td>a</td></tr></table>` killed
   *  freezing for the whole rest of the document (measured: boundary 0 from
   *  the table onwards, against 43 for the same prose without it).
   *  `tagBalance` is the open-element model the straddle bail already trusts,
   *  so this adds no new assumption — and it is read only to SUPPRESS a
   *  poison, so a `<table>` the scanner failed to count leaves the old,
   *  over-blocking behaviour in place (2026-08-20 B1). Every call site sits
   *  BEFORE this tag's own `applyTag`, so a `<table><td>` on one line has
   *  the table counted by the time the part is judged. */
  // UNDER-claiming by contract: this wrapper suppresses a poison, so doubt
  // must resolve to "not inside a table" (poison fires). The bag can only
  // over-count opens, and an over-counted `table` here would suppress a
  // poison wrongly — which is why the read is fenced into a named wrapper.
  //
  // PENDING TRUNCATED opens are subtracted for that reason, the same
  // phantom argument the seam check makes with `effectiveOpen`: a
  // paragraph-line `compare a<table b` is prose, parse5 discards the
  // incomplete tag, and nothing is inside a table when a later `<td>` is
  // judged — yet the bag counted it and suppressed the poison
  // (`compare a<table b\n<td>x</td>\n</table>` froze 59 of 63 bytes;
  // 2026-08-26 review M5, the one wrapper whose implementation contradicted
  // its name). The `>` that CONFIRMS the open clears the pending list, so a
  // real table recovers the suppression on the spot.
  const definitelyInsideTable = (): boolean =>
    (cp.tagBalance.get('table') ?? 0) > cp.pendingTruncatedTags.filter((t) => t === 'table').length;
  // P-tree, explicitly (two-model T3.2): a stray table part leaves parse5's
  // template insertion-mode stack at a table mode — a Parser field a fresh
  // parser does not share, permanently. The line model cannot watch that
  // stack, so the P-tree dimension is expressed as this poison rather than
  // as a checkpoint field: sticky, document-shaping, and cheap to test.
  const strayTablePart = (tag: string): boolean => TABLE_PART_NAMES.has(tag) && !definitelyInsideTable();

  // A type 2-5 raw construct (comment/PI/decl/CDATA) open at the START of
  // this line makes the whole line html-block content — the construct's
  // block ends WITH the line carrying its terminator, so even that line's
  // remainder is raw text. Gates fence/math opens, masking, and def
  // registration below, alongside the html-block member.
  const commentOpenAtLineStart = commentEitherOpen(cp.mdBlock, cp.p5Tok);
  // The two halves separately, for consumers that need the INTERSECTION
  // (floatingResidue) rather than the union — captured at line start like
  // the union itself.
  const bothCommentsOpenAtLineStart = mdHtml(cp.mdBlock, 2) && cp.p5Tok.kind === 'comment';
  // P3b batches 2/3, the divergence WINDOWS: micromark still inside its
  // comment (type 2) or PI/CDATA (type 3/5) block, parse5 already out
  // (`--!>` closed the comment; the construct's first `>` closed the
  // bogus comment). Window bytes are construct interior to one grammar
  // and live input to the other — safe exactly while parse5 reads them
  // as TEXT. The first line carrying a byte parse5 would act on poisons
  // the phase (sticky, over-block).
  const inDivergenceWindow =
    (mdHtml(cp.mdBlock, 2) && cp.p5Tok.kind !== 'comment') ||
    ((mdHtml(cp.mdBlock, 3) || mdHtml(cp.mdBlock, 5)) && cp.p5Tok.kind !== 'bogus');
  if (inDivergenceWindow && P5_MARKUP_RE.test(ln.text)) {
    cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
  }
  const rawOpenAtLineStart = mdHtml25(cp.mdBlock) || cp.p5Tok.kind === 'comment' || cp.p5Tok.kind === 'bogus';

  // --- fence state (interiors are candidate-free; paragraph resets) ---
  if (cp.mdBlock.kind === 'fence') {
    const close = FENCE_RE.exec(ln.text);
    if (
      close &&
      close[1][0] === cp.mdBlock.char &&
      close[1].length >= cp.mdBlock.len &&
      isMdBlank(ln.text.slice(close[0].length))
    ) {
      cp.mdBlock = { kind: 'none' };
    }
    cp.blankRun = 0;
    cp.paragraphHasUnpairedRun = false;
    cp.openBracket = null;
    cp.prevLineBlank = false;
    cp.prevLineWasText = false;
    cp.prevLineWasValidDef = false;
    cp.prevLineOpenContent = false;
    cp.tableMaybeOpen = false;
    cp.containerMaybeOpen = false;
    return;
  }
  if (cp.mdBlock.kind !== 'math' && !rawOpenAtLineStart) {
    const open = FENCE_RE.exec(ln.text);
    // A backtick fence's info string may not contain a backtick —
    // ```a``` b is a PARAGRAPH with a code span, not a fence open (A5).
    const bogusInfo =
      open !== null && open[1][0] === '`' && ln.text.slice(ln.text.indexOf(open[1]) + open[1].length).includes('`');
    if (open && !bogusInfo && cp.mdBlock.kind === 'html') {
      // Suppressed open (Migration B row 6, exact type 7): the gate is the
      // MEMBER — an html block open from previous lines owns this ``` line
      // as raw text. The retired proxy also suppressed after `<embed x`
      // paragraph openers, where the fence is REAL (fence interrupts a
      // paragraph) and suppression was the seed-20260757 phase-corruption
      // shape. The phasePoisonedAt backstop STAYS: the member itself is
      // container-blind (a run inside a list item can end at a de-indent
      // this line model cannot see), so whether the run really swallows
      // this line is still container-dependent. Poison the phase and fall
      // through so the line stays tag-scanned as raw text.
      cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
    } else if (open && !bogusInfo) {
      // The open line is a block start for blocker 3 (a column-0 fence
      // terminates a list context; an indented one is ambiguous/hazard).
      if (isBlockStart) {
        const verdict = classifyBlockStart(ln.text, ln.indent, cp.defListEnabled);
        if (verdict !== null) cp.hazardVerdict = verdict;
      }
      cp.mdBlock = { kind: 'fence', char: open[1][0], len: open[1].length, indent: ln.indent };
      cp.blankRun = 0;
      cp.paragraphHasUnpairedRun = false;
      cp.openBracket = null;
      cp.prevLineBlank = false;
      cp.prevLineWasText = false;
      cp.prevLineWasValidDef = false;
      cp.prevLineOpenContent = false;
      cp.tableMaybeOpen = false;
      cp.containerMaybeOpen = false;
      return;
    }
  }

  // --- $$ flow-math state (fence-like: no candidates, close at line start;
  // the closing run must be at least as long as the opening one, with
  // nothing but whitespace after) ---
  if (cp.mdBlock.kind === 'math') {
    const close = MATH_RUN_RE.exec(ln.text);
    if (close && close[1].length >= cp.mdBlock.len && isMdBlank(ln.text.slice(close[0].length))) {
      cp.mdBlock = { kind: 'none' };
    }
    cp.blankRun = 0;
    cp.paragraphHasUnpairedRun = false;
    cp.openBracket = null;
    cp.prevLineBlank = false;
    cp.prevLineWasText = false;
    cp.prevLineWasValidDef = false;
    cp.prevLineOpenContent = false;
    cp.tableMaybeOpen = false;
    cp.containerMaybeOpen = false;
    return;
  }
  // Fence/math OPENS are gated on the html-block MEMBER (matching the
  // fence branch above): inside an html flow run a ``` or $$ line is raw text —
  // entering fence state there would skip tag extraction on lines that
  // rehype-raw parses as REAL markup (fuzz counterexample: a fence glued
  // to `</details>` hiding a quoted `<div>`). Falling through to the
  // plain-text branch keeps those lines tag-scanned (over-block safe) —
  // but the suppression itself is only certainly right at top level, so it
  // ALSO poisons the phase (see phasePoisonedAt).
  // Under the declared-absent profile (mathFlow: false) `$$` is ordinary
  // paragraph text — no math state, no suppressed-open poison; the line
  // falls through to the plain-text path where its content stays
  // comment/tag-scanned. Under the UNKNOWN capability (mathFlow omitted)
  // the opener ALSO falls through, after recording a `MathHold`: the
  // region is scanned as text and held closed for candidates at once. A
  // `$$` line inside an open hold is text to that reading and interior to
  // the other, so no second hold opens; its closer is decided in
  // `processConfirmedLine`.
  const mathRun = cp.mathFlow && cp.mathHold === null && !rawOpenAtLineStart ? MATH_RUN_RE.exec(ln.text) : null;
  if (mathRun) {
    const rest = ln.text.slice(ln.text.indexOf(mathRun[1]) + mathRun[1].length);
    // A `$` anywhere in the rest disqualifies the flow open (meta may not
    // contain `$`): `$$x$$` is inline math, `$$x$` a plain paragraph —
    // both self-contained lines, no state either way.
    if (!rest.includes('$')) {
      if (cp.mdBlock.kind === 'html') {
        // Row 6, math half — same member gate, same kept backstop.
        cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
      } else if (!cp.mathDeclared) {
        // Unknown capability: hold the region, then scan this line as the
        // paragraph text it is under the other reading (its meta may carry
        // references or tags). `hazardAtOpen` is filled in after the line.
        cp.mathHold = {
          start: ln.start,
          len: mathRun[1].length,
          indent: ln.indent,
          stackFloor: cp.openStack.length,
          hazardAtOpen: false,
          sealAtOpen: cp.p5SealPending,
          defBlockAtOpen: cp.defBlockMaybeOpen,
          fnDefAtOpen: cp.fnDefResumable,
        };
      } else {
        if (isBlockStart) {
          const verdict = classifyBlockStart(ln.text, ln.indent, cp.defListEnabled);
          if (verdict !== null) cp.hazardVerdict = verdict;
        }
        cp.mdBlock = { kind: 'math', len: mathRun[1].length, indent: ln.indent };
        cp.blankRun = 0;
        cp.paragraphHasUnpairedRun = false;
        cp.openBracket = null;
        cp.prevLineBlank = false;
        cp.prevLineWasText = false;
        cp.prevLineWasValidDef = false;
        cp.prevLineOpenContent = false;
        cp.tableMaybeOpen = false;
        cp.containerMaybeOpen = false;
        return;
      }
    }
  }

  // --- blank line: candidate emission + paragraph reset ---
  if (ln.blank) {
    // Line-truncated tag opens that never got their `>` before this blank
    // were prose: revert their phantom opens BEFORE judging balance here.
    if (cp.pendingTruncatedTags.length > 0) {
      for (const tag of cp.pendingTruncatedTags) applyTag(tag, true, true);
      cp.pendingTruncatedTags = [];
    }
    // Truncated closes that never got their `>` stay UNAPPLIED (see the
    // field doc): the element remains counted — over-block, never under.
    cp.pendingTruncatedCloses = [];
    // Still inside a QUOTED attribute value at the blank: micromark ends the
    // html block here, but parse5's tokenizer stays in the value — the
    // paragraph text after the blank goes in as characters (not tokenized)
    // and the NEXT raw node's bytes are eaten up to the closing quote. Which
    // grammar wins where is not modelled: poison (over-block). `outside` /
    // unquoted at the blank keep the classic behaviour (the pending close is
    // dropped, the element stays counted).
    if (cp.pendingTag !== null && (cp.pendingTag.attr === '"' || cp.pendingTag.attr === "'")) {
      cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
    }
    cp.pendingTag = null;
    // Same for a bogus comment left open WITHOUT its md construct: the
    // block ended, the tokenizer has not — poison and reset. When an md
    // type 2-5 block is still open the two grammars CROSS the blank
    // together (`<?a\n\n?>` is one block and one bogus comment — batch 3
    // pairs the states, so the aligned crossing must not poison).
    if (cp.p5Tok.kind === 'bogus') {
      if (mdHtml25(cp.mdBlock)) {
        // aligned — both grammars still inside; state survives the blank.
      } else {
        cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
        cp.p5Tok = { kind: 'data' };
      }
    }
    // The THIRD state, and the one this branch did not have (F27). parse5
    // has exactly three non-data token states that can outlive micromark's
    // block across a blank: a raw-text element (poisoned below), a bogus
    // comment (right above), and a COMMENT — which had no alignment check
    // at all. A `<!--` inside an ALREADY-OPEN type-6 block is that block's
    // raw CONTENT to micromark, so no type-2 block ever opens for it; the
    // type-6 block then ends at this blank while parse5's comment runs to
    // end of document, and the candidate sailed through `htmlBalanced`
    // because that check excludes only `bogus`.
    // `<div><p></div></p>` + `<!--` + blank froze 25 of 36 bytes with the
    // whole rest of the document sitting inside a comment nothing closes.
    // The balanced tag pair on the first line is load-bearing in the
    // counterexample: `<div>` alone leaves the bag open and the candidate
    // dies of that instead, which is how the shape hides from minimisation.
    //
    // Poison ONLY — deliberately no `p5Tok` reset, unlike the bogus sibling
    // above. A bogus comment ends at the next `>`, so its state is
    // unrecoverable and resetting is the honest answer there; a real comment
    // runs to `-->`, and resetting would read later comment CONTENT as live
    // markup, which is the under-block direction. Do not tidy the asymmetry.
    if (cp.p5Tok.kind === 'comment' && !mdHtml(cp.mdBlock, 2)) {
      cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
    }
    // Types 6/7 end AT this blank — the member clears before the candidate
    // is judged, exactly when the block ends. (Type 1 survives the blank;
    // 2-5 run to their terminators.)
    if (cp.mdBlock.kind === 'html' && cp.mdBlock.type >= 6) cp.mdBlock = { kind: 'none' };
    cp.blankRun += 1;
    // Both readings of an undeclared `$$` closer agree here: the blank
    // closes content.
    cp.contentOpenUnknown = false;
    // Inside an undeclared `$$` region the blank is math interior under one
    // reading: no candidate, and no definition settles on it (a settled
    // definition releases reference taint, which the math reading would
    // not do here), though the text reading's state above and below still
    // advances.
    if (cp.mathHold === null) {
      cp.lastBlankStart = ln.start;
      cp.candidates.push({
        offset: Math.min(ln.end + 1, text.length),
        blankRun: cp.blankRun,
        // The html member covers types 1-5 in one check: an unterminated
        // type-1 block swallows this blank and everything after it as RAW
        // content (its tags are invisible to the balance scan — the raw-text
        // mask suppresses them — which is exactly why `openTotal` reads 0
        // and the candidate looked safe), and the 2-5 interiors are the
        // same construct to both grammars.
        htmlBalanced:
          cp.openTotal === 0 &&
          cp.mdBlock.kind !== 'html' &&
          (cp.p5Tok.kind as P5Tok['kind']) !== 'bogus' &&
          // A form pointer parse5 may still be holding makes a LATER `<form>`
          // in the tail vanish from the full parse while a split parse opens
          // it — forward independence fails with every other condition clean.
          // See the field doc.
          !cp.formPointerMaybeSet,
        hazard: cp.hazardVerdict,
        seamRisk: cp.p5SealPending,
        defListSettled: null,
      });
    }
    cp.paragraphHasUnpairedRun = false;
    cp.openBracket = null;
    // A type-1 block is the one html block a BLANK LINE does not end — its
    // only end condition is the literal closer, or end of document. While
    // one is open the run must survive the blank, or the scanner reads the
    // block's raw content as markup: `<script></script >` never closes
    // (CommonMark wants the literal `</script>`; the space makes it text),
    // so the ``` lines after the blank are raw text to micromark and a real
    // FENCE to the scanner — a candidate landed inside the html block
    // (2026-08-20 soak leg 2, third shape).
    if (!mdHtml(cp.mdBlock, 1)) {
      // A RAWTEXT/RCDATA element still open ACROSS this blank has just had
      // its micromark block end under it: a type-6 run ends at the blank,
      // while parse5's raw-text state runs on to the literal end tag. From
      // here every line lives in both grammars at once — micromark opens
      // fresh blocks whose ELEMENT nodes hast-util-raw pushes straight into
      // the tree, while the same bytes are raw TEXT to parse5, so their end
      // tags never close anything. `<iframe>` + blank + `*b*\n<div>…</div>
      // \n</iframe>` left the div OPEN swallowing the rest of the document
      // while the scanner, suppressing every tag under the raw-text mask, called
      // it balanced (63-byte live under-block, direction battery,
      // 2026-08-24). Document-wide poison, not from-here-on: the element is
      // sanitize-stripped and its lifted children merge with neighbouring
      // text — the fuzz4 lesson, same day. Type-1 blocks are exempt because
      // a blank does NOT end them: there the two grammars agree the content
      // is raw, which is the case the guard above already keeps alive.
      // (inline-opened spans have their own poison at the opening line.)
      if (inRawTextTok(cp.p5Tok) && !cp.p5Tok.openedInline) {
        cp.phasePoisonedAt = 0;
      }
    }
    cp.prevLineBlank = true;
    cp.prevLineWasText = false;
    cp.prevLineWasValidDef = false;
    // A definition cannot span a blank line — this is where one provably
    // ends, and the next content line pins the seam again.
    cp.defBlockMaybeOpen = false;
    cp.prevLineOpenContent = false;
    cp.tableMaybeOpen = false;
    cp.containerMaybeOpen = false;
    return;
  }

  // --- plain text line ---
  // Blocker 3 rolling verdict (raw text; block markers sit at line start
  // where a code span cannot precede them).
  if (isBlockStart) {
    const verdict = classifyBlockStart(ln.text, ln.indent, cp.defListEnabled);
    if (verdict !== null) cp.hazardVerdict = verdict;
  } else if (
    LIST_MARKER_RE.test(ln.text) ||
    FOOTNOTE_DEF_RE.test(ln.text) ||
    (cp.defListEnabled && DEF_LIST_DD_RE.test(ln.text)) ||
    ln.indent >= 4
  ) {
    // A marker line NOT sitting after a blank still begins a block: lists
    // interrupt paragraphs, and anything starts fresh after a just-closed
    // fence/math line. Without this, the verdict stays stale and a
    // candidate right after freezes HALF a loose list (fuzz-arbiter
    // counterexamples: paragraph + glued bullet, `$$` close + glued
    // ordered item). Inside an html flow run the marker is raw text and
    // no hazard exists — turning the verdict on anyway only over-blocks.
    //
    // indent >= 4 mirrors A1 at glued positions (seed-20260841): a
    // 4-indented line directly after a fence close starts an indented CODE
    // block that merges across later blanks — a stale verdict let a
    // candidate split it. A mid-paragraph indented line is only a lazy
    // continuation, so flagging it too is pure over-block (safe).
    cp.hazardVerdict = true;
  }

  // Masking is only valid where micromark parses INLINE content. A line
  // starting with a TAG at block indent (approximately) opens an html FLOW
  // block of type 1/6/7 — those run until a blank line with NO inline
  // parsing: backtick runs in it (and in its continuation lines) are
  // literal text, and masking them would hide REAL tags from the balance
  // scan. Sticky until the next blank, like the unpaired-run gate. `<!`/
  // `<?` starters (types 2-5) are NOT sticky — they end at their
  // terminator's line, which rawOpenAtLineStart already tracks; making
  // them sticky suppressed a REAL `$$` open right after `-->` and let a
  // candidate split the math block (fuzz counterexample).
  //
  // Tag names OUTSIDE the type-6 list used to poison the rolling hazard
  // verdict ("ambiguous starters") because classifying type 7 needed
  // attribute-quote parsing. Type 7 IS exact now — the line either opens a
  // block (the member) or is a paragraph, both micromark's own answer — so
  // the blanket hazard is retired with the ambiguity (exact-type-7 stage;
  // the one undecidable interrupt class, pipe lines, has its own sticky
  // poison at the refused tag line).
  const tagStart = ln.indent <= 3 ? /^<\/?([A-Za-z][A-Za-z0-9-]*)/.exec(mdTrimStart(ln.text)) : null;
  if (tagStart) {
    // Gate on the MEMBER, never on "did the run start here" — the retired
    // run flag was set by ANY `<tag` line start, an over-approximation:
    // `<embed` (not a type-6 name, not a complete
    // type-7 line) is a PARAGRAPH to micromark, yet it opened the run and
    // so hid the real type-1 block that followed it (2026-08-21 scaled
    // soak, shard 0). What matters is whether a real html block is already
    // open: type 1 may interrupt a paragraph, but a `<script>` nested
    // inside an open type-6 block does not start one. The member answers
    // MORE truly than the run flag it replaced (P4b-completion commit 6)
    // in one place — a type-1 line inside an open type 2-5 block
    // (`<?a\n<script>`): the flag was false there and a phantom type-1
    // opened inside the construct's content; the member is html{3-5} and
    // correctly refuses. Movements measured and pinned with this commit.
    const noRealBlockOpen = cp.mdBlock.kind !== 'html';
    const t1 = noRealBlockOpen ? TYPE1_START_RE.exec(mdTrimStart(ln.text)) : null;
    // `raw` is the parse5 half of the same line: three of the four type-1
    // names are raw-text elements, `pre` is not.
    if (t1) cp.mdBlock = { kind: 'html', type: 1, raw: RAW_TEXT_ELEMENTS.has(t1[1].toLowerCase()), indent: ln.indent };
    if (cp.mdBlock.kind !== 'html') {
      const t = mdTrimStart(ln.text);
      const t6 = TYPE6_START_RE.exec(t);
      const realT6 = t6 !== null && TYPE6_NAMES.has(t6[1].toLowerCase());
      const t1Line = TYPE1_START_RE.test(t);
      // The interrupt-SENSITIVE class: a line whose only reading as an html
      // block is condition 7. Types 1 and 6 may interrupt a paragraph, so
      // their answer never depends on what came before, and neither
      // undecidable-interrupt poison below applies to them.
      const type7Shaped = !realT6 && !t1Line && isType7Line(t);
      if (
        realT6 ||
        t1Line ||
        // Type 7 cannot interrupt CONTENT (micromark's paragraph/definition
        // construct — `prevLineOpenContent`, the exact interrupt input; the
        // old `prevLineWasText` gate refused after headings, terminator
        // lines and fence closes, where micromark measurably opens). The
        // classifier itself is exact too (isType7Line) — including closing
        // raw-text names (`</style>` alone is type 7, measured) and
        // quoted-`>` attribute values.
        (!cp.prevLineOpenContent && type7Shaped)
      ) {
        // The 6/7 member (type 1 wrote html{1} above; inside this branch
        // the member is provably 'none', the guard is shape only).
        if (cp.mdBlock.kind === 'none') cp.mdBlock = { kind: 'html', type: realT6 ? 6 : 7, indent: ln.indent };
      } else if (cp.prevLineOpenContent && cp.tableMaybeOpen && type7Shaped) {
        // The one interrupt class a line model cannot settle: after a GFM
        // TABLE row type 7 opens (a table is not content), after a
        // pipe-bearing PARAGRAPH line it cannot — and table-ness was
        // decided lines ago by a header/delimiter pair this scanner does
        // not model. The marker is STICKY (`tableMaybeOpen`), because a
        // table is continued by any non-blank non-structural line — the
        // pipe-less row `see prose` after `| 1 | 2 |` is still a row
        // (soak seed 20283008). Whichever way micromark went, the two
        // readings give this line to different grammars, so the phase is
        // poisoned from here — sticky over-block, the same treatment as
        // every other undecidable divergence.
        cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
      }
      // The SECOND undecidable interrupt class, same shape as the pipe one
      // and outside the if/else because it applies to the claim as well as
      // to the refusal. micromark's `tagName` refuses type 7 on
      // `self.interrupt && !self.parser.lazy[line]` — the lazy half is an
      // input the content model does not have. While a container may be
      // open this line is either its LAZY continuation (micromark opens a
      // container-held block) or the line after the container closed
      // (micromark opens a TOP-LEVEL multi-line block); the content model
      // reads the container line as open content and refuses. Both
      // readings give the line to a different grammar than the scanner's,
      // so poison rather than answer — sticky over-block, and the marker
      // disarms at the blank, where the container provably ended and the
      // plain verdict is right again.
      // The THIRD undecidable interrupt input, same treatment: after an
      // undeclared `$$` closer the content construct is closed under the
      // math reading and open under the text reading (see
      // `contentOpenUnknown`), and a type-7 line goes to a different
      // grammar under each.
      if (type7Shaped && (cp.containerMaybeOpen || cp.contentOpenUnknown)) {
        cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
      }
    }
  }
  // Migration B is COMPLETE: exact type 7 shipped (classifier + interrupt
  // commits), rows 4/6/7 plus the truncated-open and seam-set sites read
  // the member, and `mayBeRawToMicromark` is deleted. The nonType6QuotedGt
  // corpus family keeps standing guard over the once-was-a-hole class.
  // A type 2-5 html block (`<!--` / `<?` / `<!X` / `<![CDATA[`) STARTING on
  // this line at block indent. Not sticky (V9 — the block ends with its
  // terminator's line), and not `inRawText` unless the construct stays
  // open past EOL — but when it opens AND closes on this line, the bytes
  // after the closer are still this html block's raw content: floating
  // remnant with the blocker-6 tail-dependent seam (`<!-- c --> tail`
  // followed by a def line that a later append turns into a paragraph —
  // direction-battery counterexample surfaced by the overlapping-
  // terminator generator family, 2026-08). Feeds the blocker-6 check only.
  const rawFlowStart = ln.indent <= 3 && RAW_CONSTRUCT_START_RE.test(mdTrimStart(ln.text));
  // Whether this line's bytes belong to an html block / raw construct in
  // either grammar — captured HERE (after the tag-start pre-scan classified
  // the line, before the raw-construct machine may close a 2-5 member
  // mid-line) for the content-tracking table at the end of the plain path:
  // html-block lines close micromark's content construct (type 7 opens
  // after a terminator line, measured), and a mid-line INLINE opener does
  // not make the line any less a paragraph.
  const htmlOwnedLine = cp.mdBlock.kind === 'html' || rawOpenAtLineStart || rawFlowStart;

  // Same-line code-span masking for HTML/ref/footnote extraction. A null
  // mask means "unsafe to mask here" — scan the raw text (over-blocking).
  // Migration B row 4 (exact type 7): masking is valid exactly where
  // micromark parses INLINE content, and that is now the member's answer —
  // an open html block (any type, the pre-scan classified THIS line
  // already), a 2-5 construct open at line start or STARTING here
  // (`rawFlowStart` — the flag never covered those, `<?` fails its regex),
  // or parse5-side raw content. The proxy this replaces also suppressed
  // masking on every line after a `<embed x`-style PARAGRAPH opener until
  // the next blank — lines micromark measurably parses inline, where a
  // backticked tag IS a code span parse5 never sees (the boundary rises
  // there are this stage's payoff, verified by engine probe and pinned).
  const maskingSuppressed = htmlOwnedLine || inRawTextTok(cp.p5Tok);
  const { masked, unpaired } = maskingSuppressed
    ? { masked: null, unpaired: false }
    : maskIntraLineCodeSpans(ln.text, cp.paragraphHasUnpairedRun);
  if (unpaired) cp.paragraphHasUnpairedRun = true;
  const scanText = masked ?? ln.text;

  // Blocker 5 (reference taint) — moved to referenceTaint.ts as a pure
  // move (two-model plan P2); the module doc carries the rationale.
  // Migration B row 5 (P4b-completion): the def gate goes EXACT — "is a
  // def-shaped line raw to micromark" is answered by the member (an open
  // md html block) plus the parse5-side masks. The narrowing over the old
  // proxy is safe for a reason that must stay written down: the second
  // gate inside collectRefLine is `defLineStart`, and `prevLineWasText`
  // is set at the end of EVERY non-blank line — so on every narrowed
  // shape (a type-7-hole run line, a def line glued under a closed 2-5
  // block) the def is a paragraph-continuation line and stays
  // unregistered. Loosen `defLineStart` and this migration's safety
  // argument goes with it.
  // Deliberately NOT `htmlOwnedLine`: that one adds `rawFlowStart`, which
  // this gate has no use for. A line that STARTS a 2-5 construct begins
  // `<!--` / `<?` / `<!X` / `<![CDATA[` at block indent, and a def line
  // begins `[` (DEF_RE / FOOTNOTE_DEF_RE) — the two are mutually exclusive
  // at line start, so adding the term could not change a single verdict.
  // The asymmetry is intentional, not an oversight (2026-08-26 review).
  const defRawToMicromark = cp.mdBlock.kind === 'html' || rawOpenAtLineStart || inRawTextTok(cp.p5Tok);
  // Inside an undeclared `$$` region a definition exists under one reading
  // only, and a ghost definition releases reference taint early (the
  // unsafe direction) — so none registers there. References on the line
  // are still extracted, which only over-taints.
  const { validLinkDef } = collectRefLine(
    cp,
    ln.start,
    ln.end,
    scanText,
    ln.text,
    defRawToMicromark || cp.mathHold !== null,
    isBlockStart
  );

  // Blocker 1: raw-block (types 3–5) state machine, then tag balance.
  // `rawSpans` records the byte ranges this line contributes to raw
  // constructs (interiors, openers, terminators) — blocker 6's remnant
  // check below must not mistake construct-consumed bytes for floating
  // text (fixture: the `?>` terminator line of a PI block).
  const rawSpans: Array<[number, number]> = [];
  let pos = 0;
  // parse5 divergence (2026-08 project-review P1): CommonMark ends a `<?`
  // block at `?>` and a `<![CDATA[` block at `]]>`, but rehype-raw's HTML
  // tokenizer sees BOTH as bogus comments that end at the FIRST `>`. Every
  // byte between that `>` and the CommonMark terminator is raw text to
  // micromark yet REAL markup to parse5 (a `<details>` there is an open
  // element that reparents later siblings). This line model cannot serve
  // two grammars at once, so the moment a construct's first `>` is not its
  // CommonMark terminator, the phase is poisoned from this line on (sticky
  // over-block — the whole divergent region re-parses inside the tail);
  // the micromark model is kept for the scan itself.
  const poisonRawDivergence = (): void => {
    cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
  };
  /** A `<?` / `<!DECL` / `<![CDATA[` opened PARAGRAPH-INLINE on this line
   *  (or at code indent). Set only when the opener is not at a position that
   *  could start an html block — the block forms really do run to their
   *  terminator, but the inline forms are html-TEXT attempts that any
   *  block-interrupting next line retracts to literal text. */
  let inlineRawOpenerIdx = -1;
  while (pos < scanText.length) {
    if (mdHtml(cp.mdBlock, 3) || mdHtml(cp.mdBlock, 5)) {
      // P3b batch 3: micromark's type 3/5 block runs to `?>` / `]]>`;
      // parse5's BOGUS COMMENT (the p5 half of these constructs, tracked
      // on `p5Tok` since this batch) ends at the FIRST `>`. When the two
      // disagree, the window between parse5's `>` and micromark's
      // terminator is construct interior to one grammar and live input to
      // the other — poisoned ONLY if it can hold bytes parse5 acts on
      // (P5_MARKUP_RE), same rule as the `--!>` window. In window mode
      // (p5 already out) the bytes are parse5 TEXT: no rawSpans, so the
      // blocker-6 residue sees the remnant they become.
      const isPi = mdHtml(cp.mdBlock, 3);
      const term = isPi ? '?>' : ']]>';
      const c = scanText.indexOf(term, pos);
      const mdEnd = c === -1 ? scanText.length : c + term.length;
      if (cp.p5Tok.kind === 'bogus') {
        const gt = scanText.indexOf('>', pos);
        if (gt !== -1 && (c === -1 || gt !== c + term.length - 1)) {
          // parse5 closes here; the window to micromark's terminator (or
          // EOL — later window lines are checked at line start).
          cp.p5Tok = { kind: 'data' };
          rawSpans.push([pos, gt + 1]);
          if (P5_MARKUP_RE.test(scanText.slice(gt + 1, c === -1 ? scanText.length : c))) {
            poisonRawDivergence();
          }
        } else {
          rawSpans.push([pos, mdEnd]);
          if (c !== -1) cp.p5Tok = { kind: 'data' };
        }
      }
      // (p5 out already: window-mode bytes stay unmasked on purpose.)
      if (c === -1) break;
      cp.mdBlock = { kind: 'none' };
      pos = mdEnd;
      continue;
    }
    // The two first-`>` machines are de-fused (P4b-completion commit 1):
    // md type 4 is micromark's declaration block, `bogus` is parse5's
    // bogus comment. Their terminators coincide today, but they are
    // different grammars' states and each branch closes only its own.
    if (mdHtml(cp.mdBlock, 4)) {
      const c = scanText.indexOf('>', pos);
      if (c === -1) {
        rawSpans.push([pos, scanText.length]);
        break;
      }
      rawSpans.push([pos, c + 1]);
      cp.mdBlock = { kind: 'none' };
      if (cp.p5Tok.kind === 'bogus') cp.p5Tok = { kind: 'data' };
      pos = c + 1;
      continue;
    }
    if (cp.p5Tok.kind === 'bogus') {
      const c = scanText.indexOf('>', pos);
      if (c === -1) {
        rawSpans.push([pos, scanText.length]);
        break;
      }
      rawSpans.push([pos, c + 1]);
      cp.p5Tok = { kind: 'data' };
      pos = c + 1;
      continue;
    }
    // Openers below are TEXT to BOTH grammars while an outer text-consuming
    // construct is open — micromark: a comment/type-1 block owns every line
    // up to and including its end line; parse5: comment / RAW-TEXT content
    // runs to its own terminator, and where the two disagree about the
    // terminator the divergence poisons have already fired. The old code
    // let them open PHANTOM constructs inside those regions (measured:
    // `<!--\n<?x` held commentOpen AND piOpen at once — blocking-only
    // artifacts, but artifacts a single MdBlock cannot and should not
    // represent).
    //
    // The type-1 term asks the PARSE5 half (`mdType1RawText`), not "is a
    // type-1 block open": `pre` is a type-1 name that parse5 tokenizes in
    // the DATA state, so `<?x` inside `<pre>` really opens a bogus comment
    // that eats the `>` of the `</pre>` line and leaves the element open
    // (F13 — 20 divergent frames on `<pre>\n<?x\n</pre>` + tail; before the
    // gate existed the phantom opener's own first-`>` poison covered it by
    // accident, and the gate removed both).
    if (commentOpenAtLineStart || inRawTextTok(cp.p5Tok) || mdType1RawText(cp.mdBlock)) {
      // An INLINE-opened raw-text region is the one masked context whose
      // parse5 state is unknowable from here: micromark called the opener
      // paragraph text, and parse5's tokenizer may have CLOSED the region
      // already (`</iframe a>` — attributes make it literal text to
      // micromark and a real end tag to parse5's RCDATA/RAWTEXT states).
      // The from-here-on poison at the region's opening line covers
      // forward damage, but a RETROACTIVE construct inside the masked
      // bytes (`<!DOCTYPE …>`, document-structure tags, `<template>`)
      // erases and merges BACKWARD past candidates emitted long before the
      // region opened — this scan breaking here is exactly what kept the
      // doctype's own document-wide poison from firing (release-gate
      // finding B, seed 20293004 — F17). Whether parse5 really saw the
      // construct cannot be decided; poison document-wide, the erasure
      // standard.
      //
      // Block-opened regions were exempt here until F20 (2026-08-27), on the
      // stated ground that "their close is tracked exactly, attribute-bearing
      // end tags included". That is true of PARSE5's close and false of
      // micromark's, and the mask's third term asks micromark. `</script/>`
      // is a valid end tag to parse5 — the `/` is a bogus self-closing flag —
      // while CommonMark's type-1 end condition wants the LITERAL `</script>`,
      // so the block runs on and `mdType1RawText` keeps masking a region
      // parse5 has already left. `maskUnbacked` below is that desync.
      if (
        inRawTextTok(cp.p5Tok) &&
        cp.p5Tok.openedInline &&
        // Confirmed line: its line ending terminates a name at its end.
        (tailCarriesRetroactive(ln.text, true) || /<template(?![a-z0-9-])/i.test(ln.text))
      ) {
        cp.phasePoisonedAt = 0;
      }
      // The block-opened half is F20, guarded at the END of the line instead
      // (`maskUnbacked`): the desync it tests is a property of the line's
      // SETTLED state, and `mdBlock` is not settled here — a legitimate
      // `</script>` line still reads as type-1 open at this point in the scan.
      break;
    }
    const pi = scanText.indexOf('<?', pos);
    const cd = scanText.indexOf('<![CDATA[', pos);
    // `<!` + letter = declaration; `<!--` (third char '-') and
    // `<![CDATA[` (third char '[') never match this.
    const dm = scanText.slice(pos).search(/<![A-Za-z]/);
    const decl = dm === -1 ? -1 : pos + dm;
    // parse5 bogus comment openers — only where the bytes are raw to it (a
    // real html-flow run); in a paragraph `<!` / `</` are literal text that
    // never reaches the tokenizer. `<!` + letter is the declaration above
    // (same "until `>`" shape); `<!--` / `<![CDATA[` are their own constructs.
    // Migration A row 2 (P4b-completion): the question is "are these bytes
    // raw to parse5", and the exact answer is "an md html block is open" —
    // provably equal to the old run-flag read HERE: types 1/2 broke out of
    // the loop above, 3-5 were consumed by their own branches, and the
    // in-comment promotion artifact cannot reach this line (the comment
    // union breaks first). Types 6/7 are the member since commit 2.
    const bm =
      cp.mdBlock.kind === 'html' ? scanText.slice(pos).search(/<!(?!--|[A-Za-z]|\[CDATA\[)|<\/(?![A-Za-z])/) : -1;
    const bogus = bm === -1 ? -1 : pos + bm;
    const starts = [pi, cd, decl, bogus].filter((x) => x !== -1);
    if (starts.length === 0) break;
    const first = Math.min(...starts);
    if (first === bogus) {
      rawSpans.push([bogus, bogus + 2]);
      // Migration collision rule (P3a): a bogus opener while raw text is
      // open is TEXT to parse5 — the old model set a second flag anyway.
      // Poison instead of overwriting the raw-text state (only lowers).
      if (cp.p5Tok.kind === 'data') cp.p5Tok = { kind: 'bogus' };
      else cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
      pos = bogus + 2;
    } else if (first === cd) {
      rawSpans.push([cd, cd + 9]);
      // Claim the member only OUTSIDE a 6/7 run — inside one, micromark
      // opens nothing (the run owns every byte to the blank) and the old
      // unconditional write LOST the run's identity: `</t>` opened a
      // type-7 run, `<![CDATA[…]]>` overwrote the member and closed it at
      // `]]>`, and the `$$` after was mistaken for a REAL math open — the
      // phantom closer then broke output-neutrality (soak seed 20282500,
      // fuzz shard 0; latent behind the run flag until its deletion).
      // Same rule as `<!--` since P4b commit 1: the parse5 half lives on
      // the overlay regardless (`<![CDATA[` in fragment html is a bogus
      // comment to the first `>` — rev2 #4, measured).
      if (cp.mdBlock.kind === 'none') cp.mdBlock = { kind: 'html', type: 5, indent: ln.indent };
      if (cp.p5Tok.kind === 'data') cp.p5Tok = { kind: 'bogus' };
      if (!isMdBlank(scanText.slice(0, cd)) || ln.indent > 3) inlineRawOpenerIdx = cd;
      pos = cd + 9;
    } else if (first === pi) {
      if (scanText[pi + 2] === '>') {
        // `<?>` — the opener's `?` doubles as the closer's: micromark html
        // FLOW closes it on the spot (after `<?` it is already "at `?`,
        // searching for `>`") and parse5 closes its bogus comment at that
        // same `>`. Both agree → a closed 3-byte span, no state. In html
        // TEXT micromark wants a real `?>` after `<?` (paragraph-inline
        // `<?>` stays open to micromark, closed to parse5) — that
        // divergence is poisoned like the others.
        rawSpans.push([pi, pi + 3]);
        pos = pi + 3;
        if (!isMdBlank(scanText.slice(0, pi)) || ln.indent > 3) poisonRawDivergence();
        continue;
      }
      rawSpans.push([pi, pi + 2]);
      // Member only outside a 6/7 run (see the CDATA branch).
      if (cp.mdBlock.kind === 'none') cp.mdBlock = { kind: 'html', type: 3, indent: ln.indent };
      if (cp.p5Tok.kind === 'data') cp.p5Tok = { kind: 'bogus' };
      if (!isMdBlank(scanText.slice(0, pi)) || ln.indent > 3) inlineRawOpenerIdx = pi;
      pos = pi + 2;
    } else {
      rawSpans.push([decl, decl + 2]);
      // `<!DOCTYPE` is the one declaration parse5 tokenizes as a real
      // DOCTYPE rather than a bogus comment, so it is consumed and erased
      // (retroactive — see DOCUMENT_STRUCTURE_NAMES). `<!ENTITY` and every
      // other `<!` + letter becomes a comment node and is position-stable.
      // Gated on block indent only, not on position within the line: an
      // INLINE `<!DOCTYPE>` in prose measured safe, but proving how far
      // parse5's insertion modes can reach back is not worth the precision,
      // so any doctype on a line that could open an html block poisons.
      // At indent >= 4 the line is indented CODE (or a lazy paragraph
      // continuation, where the doctype is html-text) — parse5 never sees
      // markup there, and poisoning cost a boundary of 62 → 0 on a plain
      // `    <!DOCTYPE html>` block. Backticked mentions are masked out
      // before this scan and never reach here at all.
      if (ln.indent <= 3 && /^doctype/i.test(scanText.slice(decl + 2))) cp.phasePoisonedAt = 0;
      // Member only outside a 6/7 run (see the CDATA branch).
      if (cp.mdBlock.kind === 'none') cp.mdBlock = { kind: 'html', type: 4, indent: ln.indent };
      // md type 4 and the p5 bogus comment share their first-`>` end, so
      // no window can open — the pairing is still tracked for honesty.
      if (cp.p5Tok.kind === 'data') cp.p5Tok = { kind: 'bogus' };
      if (!isMdBlank(scanText.slice(0, decl)) || ln.indent > 3) inlineRawOpenerIdx = decl;
      pos = decl + 2;
    }
  }
  // Blocker 7, completed for the remaining inline raw constructs — and with
  // the DOCUMENT-WIDE poison, not the from-here-on one. Two stacked failure
  // modes, both measured 2026-08-24:
  //
  //  1. micromark's BLOCK scan can interrupt the paragraph at the next line,
  //     so the bytes this line model reads as construct interior are a fresh
  //     html block to micromark. `x <!D y` + newline + `<!DOCTYPE>`: type 4
  //     interrupts, parse5 erases the doctype — while this scanner read it as
  //     declaration interior, never ran its poison, and "closed" the
  //     declaration at the doctype's own `>` (30-byte live under-block).
  //  2. parse5 reads the whole cross-line construct as ONE bogus comment (to
  //     the first `>`), i.e. a node the sanitize pass REMOVES — and removing
  //     it merges the text nodes on either side. That merge reaches BACKWARD:
  //     in `see … linked\n\n[^a]: def\n<i>y</i> <?php …\n\n<!DOCTYPE html>…`
  //     the merged separator text sits at index 1 of the root, INSIDE a
  //     boundary at offset 24, forty bytes before the opener. A poison at the
  //     opener's own offset provably does not cover it. Erasure-by-sanitize
  //     is the DOCUMENT_STRUCTURE_NAMES semantics, and gets the same poison.
  //
  // (`<!--` has the same erasure shape but its own earlier machinery has kept
  // every measured variant safe — its poison is not widened here, and the
  // corpus carries the shapes that would catch it if that ever stops.)
  //
  // `type >= 3` also matches the 6/7 members, and has since the member
  // overwrite rule tightened (the two-soak-holes fix): a mid-line `<?…?>` or `<!X…>`
  // INSIDE an open type 6/7 run no longer takes the member, so the run's
  // own 6/7 survives to this test and the opener poisons document-wide.
  // That is KEPT deliberately, not an accident of the member surviving —
  // the run case is the same sanitize-erasure shape as the paragraph one,
  // and narrowing the predicate back to 3-5 would raise boundaries for
  // pure freeze-rate gain (2026-08-26 review min-1: measured, and declined
  // on the risk side of that trade).
  if (inlineRawOpenerIdx !== -1 && cp.mdBlock.kind === 'html' && cp.mdBlock.type >= 3) {
    cp.phasePoisonedAt = 0;
  }
  // Raw-construct bytes are data, not markup — mask them (offset-preserving)
  // and scan the REST of the line for tags. The old scan skipped the whole
  // line whenever a raw construct touched it, so a tag before a same-line
  // opener (`<details> <?php`) or after a terminator (`?><details>`) went
  // uncounted — an under-block past a parse5-open element (v2.4.0 review
  // P1/P4; the former was documented as an accepted edge, the latter not).
  let tagText = scanText;
  for (const [from, to] of rawSpans) {
    tagText = tagText.slice(0, from) + ' '.repeat(to - from) + tagText.slice(to);
  }
  // Inside a tag that started on an earlier line of this html-flow run (see
  // `pendingTag`): up to the first RAW `>` the bytes are attribute
  // garbage to parse5 — no tags, no comments, no truncation there.
  let skipTagScan = false;
  if (cp.pendingTag !== null) {
    // De-indent below the truncated line: possibly out of the container
    // (see `pendingTag.indent`) — over-block either way.
    if (ln.indent < cp.pendingTag.indent) poisonRawDivergence();
    // Walk the RAW line with parse5's attribute-area state: a `>` inside a
    // quoted value is a value byte (`<hr title="\n<p></div>` — r2 P1-2: the
    // first `>` used to end the tag and `</div>` closed the outer div), and
    // a value whose quotes pair on this line is ordinary (`<div\n
    // class="a">` — r2 P2-3: any quote before the `>` used to poison the
    // whole stream, freezing 0.4% of a document instead of 96%).
    const attrs = { state: cp.pendingTag.attr };
    const gt = scanTagAttrs(ln.text, 0, ln.text.length, attrs);
    if (gt === -1) {
      // Line ending: ends an unquoted value, is a byte inside a quoted one.
      scanTagAttrs('\n', 0, 1, attrs);
      cp.pendingTag = { attr: attrs.state, indent: cp.pendingTag.indent };
      skipTagScan = true;
    } else {
      // The `>` completes the pending truncated CLOSE (parse5 emits the end
      // tag there); a truncated OPEN was already counted at its line.
      for (const tag of cp.pendingTruncatedCloses) applyTag(tag, true);
      cp.pendingTruncatedCloses = [];
      cp.pendingTag = null;
      tagText = ' '.repeat(gt + 1) + tagText.slice(gt + 1);
    }
  }
  // Set when the tag scan itself found a tag that runs past the line end
  // (quoted attribute value left open): the anchor-on-last-`<` truncation
  // check below must not count it a second time.
  let tagHandledAsTruncated = false;
  if (!skipTagScan) {
    TAG_OR_COMMENT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    let lastCommentOpenerIdx = -1;
    while ((m = TAG_OR_COMMENT_RE.exec(tagText)) !== null) {
      // Raw-text element content: comment tokens are text too; tags go
      // through applyTag, which admits only the element's own end tag.
      if (inRawTextTok(cp.p5Tok) && (m[0] === '<!--' || m[0] === '-->' || m[0] === '--!>')) {
        // A `<!--` inside `<script>` puts parse5 in "script data escaped",
        // which is where the two grammars stop agreeing — see the poison in
        // `applyTag`.
        if (cp.p5Tok.kind === 'script') {
          if (m[0] === '<!--') cp.p5Tok = { ...cp.p5Tok, escaped: true };
          // `-->` leaves the escape ladder ENTIRELY: the single- and
          // double-escaped dash-dash states both switch to "script data"
          // on `>` (HTML §13.2.5.24/§13.2.5.30, verified in parse5's
          // tokenizer). `--!>` stays escaped (`!` falls to anything-else
          // in the dash-dash states).
          if (m[0] === '-->') cp.p5Tok = { ...cp.p5Tok, escaped: false, double: false };
        }
        continue;
      }
      if (m[0] === '<!--') {
        const next = tagText.slice(m.index + 4, m.index + 6);
        if (commentEitherOpen(cp.mdBlock, cp.p5Tok)) {
          // Inside an OPEN comment `<!--` is content — but the regex
          // consumed its `--`, which may be the start of the closer:
          // `<!-->` / `<!--->` carry a `-->` (closes for both grammars;
          // soak seed 20260759: `<!--\n\n<!-->\n<details>` left the
          // comment open and skipped the real `<details>`), `<!--!>` /
          // `<!---!>` carry a `--!>` (parse5-only closer → poison).
          if (next.startsWith('>') || next === '->') {
            // Close ONLY the comment member: with the union, an unguarded
            // clear here nukes whatever else holds the member — measured
            // regression: a stray closer while a type-1 block held html{1}
            // released every later candidate (soak leg 2, seed 20280501).
            if (mdHtml(cp.mdBlock, 2)) cp.mdBlock = { kind: 'none' };
            if (cp.p5Tok.kind === 'comment') cp.p5Tok = { kind: 'data' };
          } else if (next === '!>' || next === '-!') {
            // parse5-only closer inside the token: parse5 leaves the
            // comment, micromark does not. P3b batch 2: the divergence
            // WINDOW (from here to micromark's `-->`) is markup to parse5
            // and comment content to micromark — poison only if markup
            // bytes can appear in it on this line; later window lines are
            // checked at line start. A markup-free window is text to both
            // grammars and converges at `-->`.
            if (cp.p5Tok.kind === 'comment') cp.p5Tok = { kind: 'data' };
            if (mdHtml(cp.mdBlock, 2) && P5_MARKUP_RE.test(tagText.slice(m.index + m[0].length))) {
              poisonRawDivergence();
            }
          }
          continue;
        }
        if (next.startsWith('>') || next === '->') {
          // Empty comment with an overlapping closer (see the note above
          // TAG_OR_COMMENT_RE) — closed on the spot; the regex resumes after `<!--`,
          // where the leftover `>` / `->` matches nothing.
          continue;
        }
        // Inside an open type 6/7 block a `<!--` line is that block's
        // CONTENT — the member keeps the run's identity; parse5's comment
        // half lives on `p5Tok` (commit 1), and every comment read below
        // goes through the union.
        if (cp.mdBlock.kind === 'none') cp.mdBlock = { kind: 'html', type: 2, indent: ln.indent };
        if (cp.p5Tok.kind === 'data') cp.p5Tok = { kind: 'comment' };
        lastCommentOpenerIdx = m.index;
        continue;
      }
      if (m[0] === '-->') {
        // A STRAY `-->` (no comment open) is text to both grammars: the
        // old per-field `commentOpen = false` was a no-op there, and the
        // union must keep it one — an unguarded member clear released a
        // type-1 block's html{1} (soak leg 2, seed 20280501, `</script/>`
        // false closer upstream; regression pinned).
        if (mdHtml(cp.mdBlock, 2)) cp.mdBlock = { kind: 'none' };
        if (cp.p5Tok.kind === 'comment') cp.p5Tok = { kind: 'data' };
        continue;
      }
      if (m[0] === '--!>') {
        // parse5 accepts `--!>` as a comment closer; CommonMark does not
        // (`<!--x--!>\n<details>\n-->` is one html block to micromark
        // whose `<details>` is a REAL open element to parse5). P3b
        // batch 2 retires the unconditional poison: parse5's comment
        // CLOSES here, micromark's block runs on to `-->`, and the
        // window between them diverges only if it holds bytes parse5
        // would act on — `P5_MARKUP_RE` on the line remainder here, and
        // per line at the line-start check while the relation stays
        // split (md html{2} open, p5 out of comment). A markup-free
        // window is parse5 TEXT inside micromark's block: the grammars
        // converge at `-->` and the block's output is a text remnant the
        // blocker-6 seam machinery owns (floatingResidue runs on the
        // INTERSECTION of the two comment states for exactly this).
        // A p5-ONLY comment closing here (inside a type 6/7 run) never
        // diverged from micromark at all — no poison either.
        if (mdHtml(cp.mdBlock, 2) && P5_MARKUP_RE.test(tagText.slice(m.index + m[0].length))) {
          poisonRawDivergence();
        }
        if (cp.p5Tok.kind === 'comment') cp.p5Tok = { kind: 'data' };
        continue;
      }
      if (commentEitherOpen(cp.mdBlock, cp.p5Tok)) continue;
      const closing = m[1] === '/';
      const tag = m[2].toLowerCase();
      if (strayTablePart(tag)) cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start + m.index);
      let attrs = m[3] ?? '';
      // Migration A row 3: "may this tag continue across the line ending"
      // is a raw-stream question — an open md html block answers it. The
      // broadening over the old flag is types 3-5 interiors, and THAT is
      // safe only because a paragraph-inline 3-5 opener already poisons
      // document-wide (the F9 rule) — named dependency, do not remove one
      // without the other.
      if (cp.mdBlock.kind === 'html' && (!inRawTextTok(cp.p5Tok) || (closing && tag === rawTextElement(cp.p5Tok)))) {
        // The regex ends the tag at the first `>`, but in a real html-flow
        // run parse5 ends it at the first `>` OUTSIDE a quoted attribute
        // value (`</div a=">` eats the rest of the line and beyond — a
        // pre-existing under-block of the r2 P1-2 family, oracle review of
        // the batch). Walk the attribute area with parse5's state machine:
        // a later `>` moves the match end; no `>` on the line means the
        // tag continues on the next line — the truncated path below takes
        // it, with the quote state carried.
        const attrStart = m.index + 1 + (closing ? 1 : 0) + m[2].length;
        const st = { state: 'outside' as TagAttrState };
        const gt = scanTagAttrs(tagText, attrStart, tagText.length, st);
        if (gt === -1) {
          if (!VOID_TAGS.has(tag)) {
            if (closing) cp.pendingTruncatedCloses.push(tag);
            else applyTag(tag, false);
          }
          scanTagAttrs('\n', 0, 1, st);
          cp.pendingTag = { attr: st.state, indent: ln.indent };
          tagHandledAsTruncated = true;
          break;
        }
        if (gt + 1 !== m.index + m[0].length) {
          attrs = tagText.slice(attrStart, gt);
          TAG_OR_COMMENT_RE.lastIndex = gt + 1;
        }
      }
      // Paragraph context (micromark html-text / a non-real run): a CLOSING
      // tag is only `</name` + optional whitespace + `>` — `</div a="b">` is
      // literal text and parse5 never sees a close (oracle review of the r2
      // batch, pre-existing: `p <div> x </div a="b"> y` froze past the open
      // div). In a real html-flow run parse5 accepts end-tag attributes.
      if (closing && cp.mdBlock.kind !== 'html' && !/^\s*$/.test(attrs)) {
        // The match ran to the first `>`, swallowing whatever sat in the
        // "attributes". micromark does not: it backtracks the invalid
        // closing tag to literal text and re-scans from inside it, so
        // `</t <div a="">` is text `</t ` plus a REAL html-text `<div a="">`
        // that parse5 opens. Skipping the whole span left that div
        // uncounted — an under-block the direction battery caught once the
        // corpus reached the shape (2026-08-20 soak leg 2, minimised to
        // `</t <div a="">\n\r```\n```\n\n`, unstable under every future).
        // Rewinding past the NAME re-scans the swallowed bytes; the
        // documented `p <div> x </div a="b"> y` case is unaffected, its
        // attribute area holds no tag.
        TAG_OR_COMMENT_RE.lastIndex = m.index + 2 + m[2].length;
        continue;
      }
      const selfClosing = /\/\s*$/.test(attrs);
      if (VOID_TAGS.has(tag) || (selfClosing && honoursSelfClosing(tag))) continue;
      applyTag(tag, closing);
    }
    // A comment opener that is NOT the line's first token and fails to
    // close by end of line is PARAGRAPH-INLINE: micromark only recognizes
    // it as a comment if `-->` arrives before the paragraph ends, else the
    // `<!--` is literal text and everything this scan skipped as "comment
    // interior" until the next stray `-->` is REAL markup (seed-20260828
    // under-block: a real unclosed `<details>` went uncounted and the
    // boundary landed past it, where its raw-time element absorbs every
    // later sibling). Which way it resolves is paragraph-shape-dependent —
    // poison the candidates from the opener on (sticky, over-block), same
    // mechanism as the suppressed fence/math opens. Line-START openers are
    // html block type 2 (terminator semantics, tracked exactly) and raw/
    // flow-context openers follow parse5's comment state — neither poisons.
    // No `!inRawText` gate here, and the poison is document-wide — two
    // upgrades over the original, both bought by counterexamples:
    //
    //  - `inRawText` reads `mayBeRawToMicromark`, which ANY `<letter` line
    //    start sets. `<b>x</b> <!-- trailing…` is a PARAGRAPH (`b` is not a
    //    type-6 name), yet the `<b` start suppressed this poison entirely
    //    and the document froze at 173 of 200 (2026-08-24 scaled soak,
    //    direction battery). The line-start check below is the exact
    //    question the proxy was approximating.
    //  - a cross-line comment is a sanitize-REMOVED node, and removing it
    //    merges the text on either side — the merge reaches backward past
    //    the boundary, so an opener-offset poison has the same hole F9 had
    //    for `<?`/`<!`+letter. Same rule, same document-wide poison.
    if (commentEitherOpen(cp.mdBlock, cp.p5Tok) && lastCommentOpenerIdx !== -1) {
      if (!isMdBlank(tagText.slice(0, lastCommentOpenerIdx)) || ln.indent > 3) {
        cp.phasePoisonedAt = 0;
      }
    }
    // Tags whose `<` sits OUTSIDE every code-span mask but whose `>` sits
    // INSIDE one (`<div x="\`">b\``): micromark tries html-text at the `<`
    // before the later backtick can open a span, so the tag is REAL — but
    // the masked scan above never saw its `>` and counted nothing (v2.4.0
    // review, direction battery). Re-scan the raw line for exactly those
    // matches (raw-construct spans excluded — a `<b>` inside a PI is data).
    if (masked !== null && masked !== ln.text) {
      const inRaw = (i: number) => rawSpans.some(([from, to]) => i >= from && i < to);
      TAG_OR_COMMENT_RE.lastIndex = 0;
      let mr: RegExpExecArray | null;
      while ((mr = TAG_OR_COMMENT_RE.exec(ln.text)) !== null) {
        if (mr[0] === '<!--' || mr[0] === '-->' || mr[0] === '--!>') continue;
        const startMasked = masked[mr.index] !== ln.text[mr.index];
        const wholeVisible = masked.slice(mr.index, mr.index + mr[0].length) === mr[0];
        if (startMasked || wholeVisible || inRaw(mr.index) || commentEitherOpen(cp.mdBlock, cp.p5Tok)) continue;
        const closing = mr[1] === '/';
        const tag = mr[2].toLowerCase();
        if (strayTablePart(tag)) cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start + mr.index);
        // Same html-text rule: a closing tag with attributes is text.
        if (closing && mr[3] !== undefined && !/^\s*$/.test(mr[3])) continue;
        const selfClosing = mr[3] !== undefined && /\/\s*$/.test(mr[3]);
        if (VOID_TAGS.has(tag) || (selfClosing && honoursSelfClosing(tag))) continue;
        applyTag(tag, closing);
      }
    }
    // A `>` anywhere on this line confirms every pending truncated open
    // (attributes may wrap; the tag really is a tag — keep it counted).
    // Checked on the RAW line: a `>` inside a masked code span may still be
    // the tag's own closer (`<div x="\`">b\``: micromark parses the tag
    // first, the span never forms) — v2.4.0 review R2(a).
    if (cp.pendingTruncatedTags.length > 0 && ln.text.includes('>')) {
      // A confirmed pending table-part open (`<td` + attributes wrapping)
      // is a real stray table part: poison from here (see TABLE_PART_NAMES).
      if (cp.pendingTruncatedTags.some((t) => strayTablePart(t))) {
        cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
      }
      cp.pendingTruncatedTags = [];
    }
    // Line-truncated tag start — anchor on the LAST `<` of the line.
    if (!commentEitherOpen(cp.mdBlock, cp.p5Tok) && !tagHandledAsTruncated) {
      let lastLt = -1;
      TAG_START_LT_RE.lastIndex = 0;
      for (let ms = TAG_START_LT_RE.exec(tagText); ms !== null; ms = TAG_START_LT_RE.exec(tagText)) {
        lastLt = ms.index;
        TAG_START_LT_RE.lastIndex = ms.index + 1;
      }
      if (lastLt !== -1 && !tagText.includes('>', lastLt)) {
        const m2 = TRUNCATED_TAG_RE.exec(tagText.slice(lastLt));
        if (m2) {
          const closing = m2[1] === '/';
          const tag = m2[2].toLowerCase();
          // Table-part poison for a TRUNCATED shape only where it is markup
          // for sure (a real html-flow run); in paragraph context `compare
          // a<td b` may be prose — poison waits for the `>` that confirms the
          // pending open (r2 P3), otherwise the blank line reverts it.
          if (strayTablePart(tag) && cp.mdBlock.kind === 'html') {
            cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start + lastLt);
          }
          // In a REAL html-flow run parse5 stays inside this tag across the
          // line ending — open, close or void alike (`<br` + `</div>` on the
          // next line: the `</div>` is garbage). See `pendingTag`.
          if (cp.mdBlock.kind === 'html') {
            // Where parse5 stands after this line's attribute bytes + the
            // line ending (m2[3] holds them; no `>` in there by construction).
            const attrs = { state: 'outside' as TagAttrState };
            scanTagAttrs(m2[3] + '\n', 0, m2[3].length + 1, attrs);
            cp.pendingTag = { attr: attrs.state, indent: ln.indent };
          }
          if (closing) {
            // Never counted on the spot (2026-08-19 review P1: `para </style`
            // zeroed the balance while `<style>` was still open in BOTH
            // grammars — the fuzz corpus had truncated opens only). In an
            // html-flow run the `>` may still arrive on a later line of the
            // run — pend it; in paragraph context a block-indent `>` is a
            // blockquote (the 4+-space continuation shape is not modelled:
            // over-block), so it is treated as prose: nothing.
            if (!VOID_TAGS.has(tag) && cp.mdBlock.kind === 'html') cp.pendingTruncatedCloses.push(tag);
          } else if (!VOID_TAGS.has(tag)) {
            applyTag(tag, closing);
            // Only a PARAGRAPH-line truncation can turn out to be prose. In an
            // html-flow run the bytes are raw: parse5 keeps tokenizing the
            // dangling `<div` into whatever follows the block (fuzz
            // counterexample: `</details>\n<div\n\n` shortened the seam
            // separator), so there the open stays counted, unrevertable.
            // Likewise when the RAW line has a `>` after its last `<`: the
            // masked-away `>` may be the tag's real closer — keep it counted
            // rather than reverting a real tag (R2(a)).
            const rawLastLt = ln.text.lastIndexOf('<');
            const rawTruncated = rawLastLt !== -1 && !ln.text.includes('>', rawLastLt);
            // Migration B, truncated-open revertibility (exact type 7):
            // "paragraph-line truncation" is the member's complement. The
            // retired proxy kept `<embed x`-style PARAGRAPH truncations
            // counted forever; they are prose candidates like any other
            // paragraph truncation and revert at the blank.
            if (!closing && !(htmlOwnedLine || inRawTextTok(cp.p5Tok)) && rawTruncated) {
              cp.pendingTruncatedTags.push(tag);
            }
          }
        }
      }
    }
  }

  // Blocker-6 detection: this line is html-flow content, tag balance is
  // fully settled after it, and — after masking construct-consumed bytes
  // (raw spans, comment content) and stripping tag/comment tokens —
  // non-whitespace remains: balanced FLOATING remnant that parse5 will
  // attach at the root with a tail-dependent seam. `inRawText` scopes this
  // to html-flow runs; interior remnant (openTotal > 0) is contained inside
  // an element and stays position-stable, so it does not set the flag.
  // Deliberately NOT gated on raw constructs being closed at line END: a
  // settle line can carry remnant AND open a multi-line comment/PI/decl/
  // CDATA (`remnant <!-- c`), and the terminator line's scan only covers
  // its own bytes — requiring closure here would hide that remnant forever
  // (the under-block direction; review counterexample with an arbiter-level
  // hast mismatch). Unterminated construct bytes are masked (rawSpans /
  // comment-token strip); their interior text may over-flag, which is safe.
  // Pending truncated opens are PHANTOMS until confirmed: for the seam
  // question they must not count as "an element is open" (an open element
  // contains the remnant; a phantom does not) — otherwise a rawFlowStart
  // line ending in a truncated `<div` skips this check and, when the
  // phantom is reverted at the blank line, nobody re-runs it (v2.4.0
  // review R2(b)). Treating them as closed here only over-flags.
  const effectiveOpen = cp.openTotal - cp.pendingTruncatedTags.length;
  // Migration B row 7, the SET half (exact type 7): floating raw remnant
  // arises from RAW bytes — html-block content in either grammar
  // (`htmlOwnedLine` covers the member, line-start 2-5 state and
  // `rawFlowStart`; the p5 raw-text kinds ride along for completeness).
  // A `<embed x`-style paragraph line's text becomes a position-stable
  // paragraph node, never seam-owned remnant — the retired proxy set the
  // flag there anyway.
  if ((htmlOwnedLine || inRawTextTok(cp.p5Tok)) && effectiveOpen <= 0) {
    // Raw-construct bytes are DELETED (not blanked) here: the residue is
    // judged on `length`, not `trim()` — whitespace-only floating text
    // (`<!-- c --> </s>` leaves ` `) is seam-dependent too (v2.4.0 review
    // P2), and blanking spans would fake such whitespace.
    let masked = '';
    let cursor = 0;
    for (const [from, to] of rawSpans) {
      masked += scanText.slice(cursor, from);
      cursor = to;
    }
    masked += scanText.slice(cursor);
    // Comment content spanning lines is not covered by rawSpans (comments
    // are tracked by the token scan, not the raw state machine), so the
    // residue is taken by the SAME token walk the balance scan uses — the
    // comment-open state carried in from the line start, overlapping
    // closers (`<!-->` closing an open comment) and all. Regex masking
    // (`<!--…-->`, `<!--…$`) got the overlap case wrong: it erased the
    // `<!-->` before the "cut at `-->`" step could see it, hiding the real
    // remnant after it (adversarial review of 5074c4b, blocker-6 seam).
    // Comment state for the residue = the INTERSECTION of the two
    // grammars' comment states (P3b batch 2 / oracle rev2 #5): bytes are
    // construct interior only if BOTH grammars are inside a comment. In
    // the `--!>` window (md open, p5 closed) the bytes are parse5 TEXT —
    // real remnant with a tail-dependent seam; a p5-only comment inside a
    // type 6/7 run over-flags, which is the safe direction.
    if (floatingResidue(masked, bothCommentsOpenAtLineStart).length > 0 || discardedEndTag) {
      cp.p5SealPending = true;
    }
  }

  // The span reaches past this line ending. micromark and parse5 disagree
  // about where it ENDS — `</title a>` is literal paragraph text to
  // micromark (a closing tag takes no attributes) while parse5's RCDATA
  // tokenizer accepts it and closes the element — so from here the scanner
  // cannot model the span at all: it suppressed a `<div>` the real parse
  // leaves OPEN, which then grows with every append (2026-08-21 soak leg 2,
  // boundary 144 with the div at @86 extending to @161). Poison rather than
  // reject one candidate: the divergence outlives the span.
  if (inRawTextTok(cp.p5Tok) && cp.p5Tok.openedInline) {
    cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
  }

  // CommonMark type-1 end condition: the line CONTAINS the closer string,
  // and that line still belongs to the block — so this runs last, after the
  // line has been scanned as raw flow. The next line starts fresh.
  if (mdHtml(cp.mdBlock, 1) && TYPE1_CLOSE_RE.test(ln.text)) {
    cp.mdBlock = { kind: 'none' };
    // The type-1 block ends here for micromark — if parse5's raw-text
    // element SURVIVES this close (the double-escape held it open), the
    // element will swallow later md blocks and their wrap separators as
    // its own text, and sanitize stripping it then merges the survivors
    // BACKWARD past any earlier boundary (the F9/F11 erasure class — the
    // 20282605/10/11 direction-battery counterexamples: `<script>\n
    // <!--<script>\n</script>\n<div>d</div>\n</script>` froze at 56 and
    // a one-character append changed the frozen region's children).
    // Document-wide poison, the erasure standard; a tangle that resolves
    // on ONE line never reaches this branch with the element open, so
    // the single-line recovery (and the `-->` exact exit) survive.
    if (inRawTextTok(cp.p5Tok)) cp.phasePoisonedAt = 0;
  }

  cp.blankRun = 0;
  cp.prevLineBlank = false;
  cp.prevLineWasText = true;
  // ── content tracking: the decision table for `prevLineOpenContent` ──
  // Derives micromark's "content construct open" per line class, measured
  // 2026-08-25 (see the field doc). The DIRECTION stakes: claiming "open"
  // where micromark closed under-claims the html{7} member (the class the
  // run flag used to blanket — masking/bogus-tracking then miss real raw
  // bytes, blocked only by a DECAYING hazard verdict); claiming "closed"
  // where micromark kept content open over-claims the member and can
  // shadow a REAL type-1 open behind a phantom type-7 run. Neither side is
  // conservative, which is why the table is exact per class and the one
  // undecidable class (pipe lines) is poisoned at the consuming gate.
  {
    const tt = mdTrimStart(ln.text);
    let openContent: boolean;
    if (htmlOwnedLine) {
      // html-block content in either grammar — closes/never opens content.
      openContent = false;
    } else if (ln.indent >= 4) {
      // A ≥4-indent line is a LAZY CONTINUATION when content is open
      // (stays open) and INDENTED CODE when it is not (stays closed).
      openContent = cp.prevLineOpenContent;
    } else if (ATX_HEADING_RE.test(tt) || THEMATIC_BREAK_RE.test(tt)) {
      openContent = false;
    } else if (BARE_MARKER_RE.test(tt)) {
      // An EMPTY list item cannot interrupt a paragraph (CommonMark §5.2),
      // so while content is open micromark reads the marker line as a LAZY
      // CONTINUATION and content stays open — a blanket `false` here
      // OVER-claimed. It agreed for a lone `-` by accident: that is also a
      // valid setext underline, which closes content under both readings,
      // and the accident is now written down rather than relied on. At a
      // block start `prevLineOpenContent` is false anyway, which is what
      // the single-line battery rows pin.
      openContent = tt[0] === '-' ? false : cp.prevLineOpenContent;
    } else if (SETEXT_LEFTOVER_RE.test(tt)) {
      // `=+` / `--`: a setext underline when a paragraph is open (content
      // CONSUMED into a heading), a paragraph of its own when not — EXCEPT
      // inside a table, where the same bytes are just another ROW and the
      // table (with the content it holds) runs on. Flipping to false there
      // disarmed `tableMaybeOpen`, the next content line lost the marker,
      // and a later refused tag line went unpoisoned (2026-08-26 review
      // M3(a): a `<br/>` line after a `--` row froze 89 of 93 bytes while
      // micromark held a real html block inside the frozen region).
      openContent = cp.tableMaybeOpen && cp.prevLineOpenContent ? true : !cp.prevLineOpenContent;
    } else {
      // Paragraph, definition, footnote definition, list item content,
      // blockquote line — all leave content open for interrupt purposes
      // (each measured as type-7-REFUSING).
      openContent = true;
    }
    cp.prevLineOpenContent = openContent;
    // Table tracking (see the field doc): a pipe line arms it; any
    // content-class line carries it; every block-structure line (the
    // openContent=false classes) breaks the table and disarms it.
    // The arming half asks whether this line could be a table ROW at all —
    // a `|` inside an html comment or any other html-owned line is not a
    // cell separator, and arming from one poisoned documents holding no
    // table (2026-08-26 review min-2). Over-claiming the marker only
    // widens the poison, so the narrowing is the precision half: it RAISES
    // boundaries, attributed per sample in the commit that landed it.
    cp.tableMaybeOpen = (!htmlOwnedLine && ln.text.includes('|')) || (cp.tableMaybeOpen && openContent);
    // Container tracking, the same sticky shape: a container-marker line
    // arms it, any content-class line carries it (a lazy continuation and
    // an indented item line are both content), every block-structure line
    // breaks the container and disarms it. Both halves take `openContent`,
    // because the marker shapes overlap the structure ones — `- - -` is a
    // thematic break, not a list item, and the table above is what says so.
    const containerMarker =
      CONTAINER_MARKER_RE.test(ln.text) ||
      FOOTNOTE_DEF_RE.test(ln.text) ||
      (cp.defListEnabled && DEF_LIST_DD_RE.test(ln.text));
    cp.containerMaybeOpen = openContent && (containerMarker || cp.containerMaybeOpen);
  }
  // Def CHAINS (A2) are a link-definition affordance: one def line can be
  // followed directly by another. A FOOTNOTE def does NOT chain — its
  // unindented next line lazily continues the footnote BODY, so a
  // def-shaped line glued under it is literal body text and registering it
  // would be a ghost def (fuzz counterexample). Refs on that line stay
  // extracted (footnote bodies parse inline content).
  cp.prevLineWasValidDef = validLinkDef;
  // Sticky to the next blank: from a def-shaped line on, every line may be
  // that definition's destination or (wrapped) title, none of which emits a
  // node the blocker-6 seam can hang on. Carrying it across ordinary
  // paragraph lines too only delays the release to the blank — over-block.
  cp.defBlockMaybeOpen = cp.defBlockMaybeOpen || DEF_RE.test(ln.text) || FOOTNOTE_DEF_RE.test(ln.text);
  // Footnote-def resumability (F16): armed by the def line itself; a
  // non-blank BLOCK-START line at indent ≤ 3 definitively interrupts the
  // footnote block (no body line can resume past it), everything else —
  // lazy continuations (not block starts), ≥4-indent continuations, and the
  // blanks that never reach this function's non-blank tail — carries it.
  if (FOOTNOTE_DEF_RE.test(ln.text)) cp.fnDefResumable = true;
  else if (isBlockStart && ln.indent <= 3) cp.fnDefResumable = false;
  // F19, the barrier's second consequence (see SCOPE_BARRIER_NAMES): a barrier
  // left open at the end of a line whose content is HELD by a markdown
  // construct will swallow that construct's generated end tag. The scanner
  // cannot enumerate generated elements — it never sees them — so it answers
  // the only question that decides the case: is anything generated open around
  // this barrier? No, in exactly one position: an html BLOCK, whose raw text
  // becomes a root-level node with no wrapper. Every other position (a
  // container marker line, a heading line, a paragraph's inline html) has at
  // least one generated element around it, and which one is unknowable here.
  // "Top-level" takes the reading `pendingFenceCloser` already gives it: only
  // a column-0 opener is provably top-level, since an html block opened at
  // indent 1-3 may be a list item's own content (`- a` then `  <table>`, the
  // one family cell the block-vs-inline test alone left UNDER).
  //
  // Direction: writes the poison only, so both ways of being wrong LOWER the
  // boundary — an over-claimed barrier on the bag widens it, and so does
  // calling a top-level host non-top-level. `ln.start`, not 0: the re-nesting
  // reaches forward only (measured — every node before the host is unchanged).
  //
  // The accepted cost is the shapes where the barrier closes on a LATER line
  // inside the same host and never straddles anything (`> <table>\n> </table>`,
  // and the paragraph-inline `<table>` that parse5 foster-parents out of its
  // own way). Sparing those needs a per-host "did this construct end here"
  // model — a second grammar, for the shapes this one is already blind to.
  //
  // PENDING TRUNCATED opens are subtracted, the `effectiveOpen` argument: a
  // line-truncated `compare a<td b` leaves parse5's tokenizer INSIDE the tag,
  // so no element is open yet and no generated end tag can be discarded. This
  // is the one reading here that fires the poison LESS, and it is sound
  // because it only DEFERS: if a later line brings the `>`, the pending list
  // is cleared with the name still on `openStack`, and the check fires on that
  // line — still ahead of the blank where the paragraph's `</p>` is emitted.
  const isBarrier = (name: string): boolean => SCOPE_BARRIER_NAMES.has(name);
  const topLevelHtmlBlock = cp.mdBlock.kind === 'html' && cp.mdBlock.indent === 0;
  const confirmedBarriers = cp.openStack.filter(isBarrier).length - cp.pendingTruncatedTags.filter(isBarrier).length;
  if (!topLevelHtmlBlock && confirmedBarriers > 0) {
    cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
  }
  // F20 — the raw-text mask outliving the grammar that justifies it.
  //
  // The tag scan is suppressed while `mdType1RawText(cp.mdBlock)` holds, and
  // that member's contract is "the state in which BOTH grammars agree every
  // byte up to the closer is content". `</script/>` breaks the agreement: the
  // `/` is a bogus self-closing flag parse5 ignores, so the element closes for
  // parse5, while CommonMark's type-1 end condition wants the LITERAL
  // `</script>` and the block runs on. From there the mask hides tags parse5
  // really acts on — `<script>` + `</script/>` + `<pre>` + `</3` + `</pre>`
  // froze 39 of 41 bytes while the bogus comment ate the `>` of the `</pre>`
  // line and left the `pre` open swallowing the tail (100% of engaged frames
  // diverged on three of six configs; pre-existing through the 22.23.2 corpus regen). F17 fixed
  // the inline-opened case and exempted this one because "their close is
  // tracked exactly" — true of parse5's close, false of micromark's.
  //
  // Settled state only, which is why this sits at the end of the line and not
  // in the scan loop: mid-scan a legitimate `</script>` line still reads as
  // type-1 open, and testing there poisoned F13's own fixture.
  //
  // Forward damage (the tags the scan is not counting) takes the from-here
  // poison; backward damage takes the document-wide one on the same erasure
  // standard as the inline branch — a doctype inside the masked bytes merges
  // text across candidates emitted long before the region opened.
  const maskUnbacked = mdType1RawText(cp.mdBlock) && !inRawTextTok(cp.p5Tok);
  if (maskUnbacked) {
    cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
    // Confirmed line: its line ending terminates a name at its end.
    if (tailCarriesRetroactive(ln.text, true) || /<template(?![a-z0-9-])/i.test(ln.text)) {
      cp.phasePoisonedAt = 0;
    }
  }
}

/**
 * Freeze-boundary detector for incremental (prefix-freeze) parsing.
 *
 * Production port of the "L4" rule validated by the measurement study in
 * `src/experiments/prefixFreeze/` (see its README for the ablation ladder,
 * the falsification results, and the intentional two-way divergence note —
 * stricter blockers AND looser code-span masking; the corpus-scoped
 * directional pin lives in detectorConsistency.test.ts).
 *
 * The boundary is the largest source offset `b` such that, for ANY future
 * append to `text`, the markdown blocks that begin before `b` parse
 * byte-identically. Candidates are confirmed blank lines outside fenced
 * code and flow math; a candidate survives only if every blocker below
 * clears:
 *
 * 1. **Raw-HTML balance** — an unclosed container tag (or `<!--` comment)
 *    before the candidate lets rehype-raw reparent later top-level siblings
 *    into it (the v1.5.1 swallow bug, commit a8e89ec). Tag balance is
 *    tracked outside fences; while any tag, comment, or raw block
 *    (`<?…?>` / `<!DECL…>` / `<![CDATA[…]]>` — CommonMark html block types
 *    3–5) is open, candidates are blocked. Line-truncated tag starts
 *    (`<div` at EOL, attributes wrapping) count as opens. Closers that
 *    OVERLAP their opener (`<!-->`, `<!--->`, line-start `<?>`) close on
 *    the spot — CommonMark and parse5 agree — so the markup after them is
 *    scanned, not skipped as construct interior.
 * 2. **`$$` flow math** — remark-math's flow math swallows blank lines and
 *    runs to EOF when unclosed (verified empirically); its closing fence
 *    must sit at LINE START (a mid-line `$$` does not close it). Under a
 *    DECLARED `mathFlow: true` math interiors are treated exactly like
 *    fence interiors: no candidates, no scanning. Under `mathFlow: false`
 *    there is no math grammar and `$$` lines are paragraph text. With
 *    `mathFlow` omitted the capability is unknown and the scanner takes
 *    the union: the region holds candidates like a fence AND its lines
 *    are scanned as text, with the two readings merged at the closer
 *    (`MathHold` in freezeScanState.ts).
 * 3. **Continuation context** — CommonMark lists, footnote definitions, and
 *    indented code blocks are NOT terminated by blank lines; later indented
 *    lines can extend a block that "ended" before the candidate. With the
 *    definition-list extension enabled, `: description` bodies behave the
 *    same way.
 * 4. **Definition-list term claim** (`options.defListEnabled`) — the
 *    micromark definition-list extension scans BACKWARD across exactly one
 *    blank line to claim a preceding paragraph as a `<dt>`. A candidate
 *    whose blank run is 1 is only safe once the next line is confirmed to
 *    never match `^ {0,3}:[ \t]`; runs of ≥ 2 blanks are immune.
 * 5. **Reference taint** — micromark decides reference-ness at parse time,
 *    so a later `[label]:` definition retargets earlier literal `[text]`.
 *    Every reference-style candidate before the boundary must resolve
 *    against a SETTLED definition (one followed by a confirmed blank line).
 *    Labels are matched with micromark's own `normalizeIdentifier`
 *    (Unicode case folding — `toLowerCase` is the unsafe direction).
 *    Definitions must START a block (or chain a valid definition line) —
 *    a def-shaped paragraph continuation line is literal text. Under the
 *    `gfmTaskListItems` profile a checked task-list box (`- [x] text`) is
 *    released from the taint by exact position once `taskListContext.ts`
 *    has proved it sits where micromark's `tasklistCheck` consumes it and
 *    its paragraph can no longer become a heading or a table head. A `$$`
 *    opener counts as such a close only under a DECLARED `mathFlow: true`;
 *    under the unknown capability the tracker forgets the item at the
 *    opener and at the closer.
 * 6. **Raw-remnant seam** — an html FLOW run can swallow non-tag lines
 *    (e.g. a `$$` math fence glued under `</details>`); once tag balance
 *    returns to zero, that remnant becomes FLOATING text that parse5/
 *    rehype-raw attaches at the root, and its hast shape (position vs
 *    seam-owned position-less, trailing-newline ownership) depends on
 *    whether a sibling node FOLLOWS it. A tail block that flips between
 *    def (no hast output) and paragraph therefore reshapes the frozen
 *    region retroactively (2026-07-31 direction-battery counterexample,
 *    reproduced on v1.8.0). Every candidate emitted while the remnant is
 *    the last frozen child is rejected (they stay rejected for good); once
 *    a later confirmed content line pins the seam from the frozen side,
 *    the candidates AFTER that line are safe again. Dropping candidates
 *    only over-blocks (safe direction). Whitespace-only remnant counts.
 *    A type 2-5 block that opens AND closes on its first line owns the
 *    rest of that line as raw content too (`<!-- c --> tail`) — same seam.
 * 7. **Phase poison** (`phasePoisonedAt`) — points where this line-level
 *    model may have DIVERGED from micromark and provably cannot resync:
 *    a fence/math open suppressed inside an html-flow run (only certainly
 *    swallowed at top level — in a container it really opens and the
 *    open/close phase inverts permanently), and a paragraph-inline `<!--`
 *    that fails to close by end of line (literal text to micromark, but
 *    the comment scan would skip real markup as comment interior), and
 *    every point where CommonMark's terminator and parse5's tokenizer
 *    DISAGREE about where a raw construct ends (`--!>` closes a comment
 *    for parse5 only; a `<?…`/`<![CDATA[…` bogus comment ends at its
 *    first `>` for parse5 but at `?>`/`]]>` for CommonMark; a paragraph-
 *    inline `<?>` is open to micromark, closed to parse5) — the bytes in
 *    between are raw text to one grammar and real markup to the other, and
 *    the hast is parse5's. Every candidate past the first such point is
 *    rejected, sticky; candidates at or before it stay valid — the
 *    ambiguous region then re-parses inside the tail (pure over-block).
 *
 * ## Incremental scanning (checkpoint resume)
 *
 * The hot path calls this once per streamed frame. Appends leave every
 * previously-CONFIRMED line byte-identical, so the scan checkpoints its
 * entire per-line state after the last confirmed line (one whose
 * terminating `\n` exists) and, given `resume`, re-lexes only from there.
 * The trailing PARTIAL line is never baked into the checkpoint: it cannot
 * emit candidates (unconfirmed lines are never blank), its tag/ref effects
 * cannot affect candidates that all precede it, and the next frame re-lexes
 * it from scratch. Resume MUTATES the checkpoint monotonically and is
 * idempotent for identical input — but a checkpoint belongs to exactly one
 * advancing state lineage (advanceIncrementalParse's), never share it.
 *
 * Continuation hazards (blocker 3) are a forward-rolling verdict updated at
 * each decisive block start — equivalent to the previous per-candidate
 * upward walk ("nearest decisive block start above") at O(1) per candidate.
 * Reference taint (blocker 5) maintains defs and an unresolved-ref list
 * incrementally; settling is monotone, so resolved entries only ever leave.
 *
 * ## Inline code-span masking
 *
 * `` `<div>` ``, `` `[x]` `` and `` `[^n]` `` in prose are code, not
 * markup. Before HTML/ref/footnote extraction each line is masked using
 * micromark's own pairing rule (equal-length backtick runs, leftmost
 * first) — but ONLY when the pairing is provably intra-line: if any run on
 * a line is left unpaired, or an earlier line of the same paragraph left
 * one unpaired, masking is disabled for the rest of the paragraph. A
 * cross-line span can therefore never cause an unmask mismatch: every
 * masked span is one micromark would pair identically. Skipped masking
 * only over-blocks (safe direction).
 *
 * A line only counts as blank once its terminating newline exists: the
 * trailing partial line is UNCONFIRMED (the next chunk may append content
 * to it) and treating it as blank breaks boundary monotonicity.
 *
 * Footnote refs/defs participate in blockers 3 and 5 like their link
 * counterparts (separate label namespace); the engine splices across them
 * via injection replay (v2).
 */

import {
  type FreezeBoundaryOptions,
  type FreezeScanCheckpoint,
  type FreezeScanResult,
  type FreezeScanCheckpointInternal,
  freshCheckpoint,
  type LineRec,
  type Candidate,
} from './freezeScanState';
import { isMdBlank } from './mdLineText';
import { computeIndent, canBecomeDdLine, tailCarriesRetroactive } from './freezeLineSyntax';
import { processConfirmedLine } from './freezeLineTransition';
import { settleRefsAndEarliestUnresolved } from './referenceTaint';

export { isType7Line } from './freezeLineSyntax';

export type { FreezeBoundaryOptions } from './freezeScanState';

export type { FreezeScanResult } from './freezeScanState';

export type { FreezeScanCheckpoint } from './freezeScanState';

export type { FreezeScanCheckpointInternal } from './freezeScanState';

/**
 * @soak-entry freeze-scanner-resume
 * @soak-entry freeze-direction
 */
export function computeFreezeBoundary(
  text: string,
  options: FreezeBoundaryOptions,
  resume?: FreezeScanCheckpoint | null
): FreezeScanResult {
  // The option's three states, as two profile booleans (see the field
  // docs on `FreezeScanCheckpointInternal`): `mathFlow` is whether a `$$`
  // opener holds candidates at all (`true` and omitted), `mathDeclared`
  // whether the region is verbatim math (`true` only). Omitted is the
  // union of both grammars.
  const mathFlow = options.mathFlow ?? true;
  const mathDeclared = options.mathFlow === true;
  const referenceTaint = options.referenceTaint ?? true;
  const gfmTaskListItems = options.gfmTaskListItems ?? false;
  const prev = resume as FreezeScanCheckpointInternal | null | undefined;
  // A checkpoint encodes profile-dependent state (math phase, ref taint
  // tables, task-list ownership) — resuming under a DIFFERENT profile would
  // mix grammars, so every switch participates in the invalidation check.
  const cp =
    prev &&
    prev.defListEnabled === options.defListEnabled &&
    prev.mathFlow === mathFlow &&
    prev.mathDeclared === mathDeclared &&
    prev.referenceTaint === referenceTaint &&
    prev.gfmTaskListItems === gfmTaskListItems &&
    prev.confirmedOffset <= text.length
      ? prev
      : freshCheckpoint({
          defListEnabled: options.defListEnabled,
          mathFlow,
          mathDeclared,
          referenceTaint,
          gfmTaskListItems,
        });

  // ── advance the checkpoint over newly-CONFIRMED lines ──
  let start = cp.confirmedOffset;
  let tailLine: LineRec | null = null;
  while (start < text.length) {
    // Line endings are what micromark counts: `\n`, `\r\n` and a LONE `\r`
    // (2026-08-19 review r2 P1-5: splitting on `\n` only hid the fence /
    // math OPENER after `a\r` inside one scanner line, and a candidate
    // landed inside the open block). `end` is the LAST byte of the ending
    // (the `\n` of a CRLF), so `end + 1` is the next line start as before;
    // `lineText` excludes the ending. A lone `\r` as the very last byte is
    // NOT confirmed: the `\n` that may follow belongs to the same ending.
    let end = text.length;
    let textEnd = text.length;
    {
      const nl = text.indexOf('\n', start);
      const cr = text.indexOf('\r', start);
      if (cr !== -1 && (nl === -1 || cr < nl)) {
        textEnd = cr;
        end = text.charCodeAt(cr + 1) === 10 ? cr + 1 : cr;
      } else if (nl !== -1) {
        textEnd = nl;
        end = nl;
      }
    }
    const confirmed = end < text.length && !(end === text.length - 1 && text.charCodeAt(end) === 13);
    const lineText = text.slice(start, textEnd);
    const ln: LineRec = {
      start,
      end,
      text: lineText,
      blank: confirmed && isMdBlank(lineText),
      indent: computeIndent(lineText),
    };
    if (!confirmed) {
      // The partial line is never baked into the checkpoint: it emits no
      // candidates, and its tag/ref effects cannot reach candidates that
      // all precede it.
      tailLine = ln;
      break;
    }

    processConfirmedLine(cp, ln, text);
    cp.confirmedOffset = end + 1;
    start = end + 1;
  }

  // ── settle references (blocker 5 — referenceTaint.ts) ──
  const earliestUnresolved = settleRefsAndEarliestUnresolved(cp);

  // ── blocker 4: defList settled check (decided by the NEXT line) ──
  const defListSettled = (c: Candidate): boolean => {
    if (!options.defListEnabled || c.blankRun >= 2) return true;
    // Confirmed next lines settle candidates eagerly in processConfirmedLine;
    // only the newest candidate can still be pending here.
    if (c.defListSettled !== null) return c.defListSettled;
    if (tailLine) return !canBecomeDdLine(tailLine.text, false);
    return false; // no next line yet — a future `: desc` could still claim the block above
  };

  // ── pick the last surviving candidate ──
  // A retroactive construct on the UNCONFIRMED tail line suppresses every
  // candidate for this frame (see tailCarriesRetroactive). Checked here and
  // not in the scan so nothing about the partial line is ever baked in.
  const tailRetroactive = tailLine !== null && tailCarriesRetroactive(tailLine.text);
  // A document-leading byte order mark poisons every candidate. micromark
  // drops the character before tokenizing, so the parsed trees' offsets are
  // string indices minus one, while the boundary reported here is a string
  // index; no caller can pair the two. The scan itself still ran (the
  // checkpoint keeps its fence/math state for phantomSuffixCloser), but
  // nothing is granted. Callers that want a boundary for such a document
  // strip the BOM first — Stage A does, so production never gets here.
  const leadingBom = text.charCodeAt(0) === 0xfeff;
  let boundary = 0;
  for (let i = cp.candidates.length - 1; i >= 0 && !tailRetroactive && !leadingBom; i--) {
    const c = cp.candidates[i];
    if (!c.htmlBalanced || c.hazard || c.seamRisk) continue;
    // Fence/math phase untrusted past a suppressed open (phasePoisonedAt
    // docs) — a boundary AT the poisoned line start is still safe: the
    // whole ambiguous region lands in the tail re-parse.
    if (c.offset > cp.phasePoisonedAt) continue;
    if (c.offset > earliestUnresolved) continue;
    if (!defListSettled(c)) continue;
    boundary = c.offset;
    break;
  }

  return { boundary, checkpoint: cp };
}

export { pendingFenceCloser } from './freezeScanState';

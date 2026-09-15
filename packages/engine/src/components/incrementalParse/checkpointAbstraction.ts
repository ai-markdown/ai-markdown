/**
 * TEST-ONLY abstraction of the freeze scanner's resume state, and the
 * DECLARED domain of that abstraction.
 *
 * It exists for the state-directed search in `spliceExhaustive.test.ts`.
 * Surface enumeration is bounded by token granularity rather than by K —
 * F20's witness is eight line-tokens and 30^8 ≈ 6.6e11 is unreachable at
 * any fundable depth with any alphabet — so the search grows prefixes and
 * keeps a few representatives per NOVEL abstract state instead. Cost then
 * scales with reachable abstract states rather than exponentially with
 * depth.
 *
 * WHY THE DOMAIN LIVES HERE, in a separate file from the search. The whole
 * value of a coverage report is that it names states the corpus never
 * reached, and a search that decides for itself what it should have
 * covered reports 100% by construction. So `SIGNATURE_DOMAIN` is written
 * down independently — from the scanner's TYPE declarations, not from any
 * run — and the search is only allowed to fill it in. The search can
 * FALSIFY this file (observing a value not declared here fails the test)
 * but it can never widen it, which is the direction that matters.
 *
 * The licence for treating the checkpoint as sufficient scan state comes
 * from the census's P2, which asserts for every snapshot of every document
 * it sweeps that a scan resumed from a checkpoint produces the same
 * boundary as a fresh scan. Without that this abstraction would be a guess
 * about what the scanner remembers.
 *
 * That licence covers a LINEAR chain of snapshots and nothing more, which
 * is worth stating because the search initially exceeded it. A checkpoint
 * is CONSUMED by the call it is passed to — measured 2026-08-28,
 * `computeFreezeBoundary` returns the very object it was handed
 * (`parent.checkpoint === child.checkpoint`) with `confirmedOffset`
 * advanced in place. A stream has one successor per state and a search has
 * dozens, so the search scans every node fresh; see the note at its scan
 * step. Anyone tempted to make it faster by resuming needs to clone first,
 * and the shape to clone is documented as changing between minor versions.
 *
 * WHAT THIS IS NOT: soundness-preserving. Two prefixes with equal abstract
 * signatures can have different hast, so a property can hold on one and
 * fail on the other, and keeping only M representatives per signature can
 * therefore discard a witness. This is a DIRECTED SEARCH — it finds things
 * or it does not — never a proof that a state is safe.
 */

import type { FreezeScanCheckpointInternal } from './computeFreezeBoundary';

/** Bucket an unbounded count the way the review specified: 0, 1, 2, 3+. */
const depthBucket = (n: number): string => (n >= 3 ? '3+' : String(n));

/**
 * The abstraction, field by field. Each entry is one dimension of the
 * signature; `values` is its DECLARED domain, taken from the scanner's own
 * type declarations rather than from observation.
 *
 * Adding a field here widens the search's notion of novelty and therefore
 * the state space it explores; adding a VALUE that cannot occur shows up
 * as a permanently unreached cell, which is why the report cannot tell an
 * alphabet gap from an impossible state on its own. That limit is stated
 * in the report rather than papered over.
 */
export interface SignatureField {
  name: string;
  values: readonly string[];
  of: (cp: FreezeScanCheckpointInternal) => string;
}

/** `MdBlock`'s discriminated union, flattened — `html` carries its type,
 *  and type 1 additionally carries whether the element is raw text to
 *  parse5, which is the distinction F13 and F20 both turn on. */
const mdBlockOf = (cp: FreezeScanCheckpointInternal): string => {
  const b = cp.mdBlock as { kind: string; type?: number; raw?: boolean };
  if (b.kind !== 'html') return b.kind;
  if (b.type === 1) return b.raw === true ? 'html1raw' : 'html1data';
  return `html${b.type}`;
};

/** `P5Tok`'s union plus the flags that change what the tokenizer does
 *  next: whether a raw-text region was opened inline (mid-line), and the
 *  script escape ladder. */
const p5TokOf = (cp: FreezeScanCheckpointInternal): string => {
  const t = cp.p5Tok as { kind: string; openedInline?: boolean; escaped?: boolean; double?: boolean };
  if (t.kind === 'rawText') return t.openedInline === true ? 'rawText:inline' : 'rawText:block';
  if (t.kind === 'script') return `script:${t.escaped === true ? 'e' : '-'}${t.double === true ? 'd' : '-'}`;
  return t.kind;
};

/* Deliberately absent: `mathHold` and `contentOpenUnknown`, the two
 * fields of the undeclared-math union (freezeScanState.ts). The search
 * drives the declared profile (`scannerProfile`), under which both are
 * constant, so listing them would only add cells no run of this search
 * can reach. The undeclared profile has its own oracle in
 * mathCapabilityOracle.test.ts. */
export const SIGNATURE_DOMAIN: readonly SignatureField[] = [
  {
    name: 'mdBlock',
    values: ['none', 'fence', 'math', 'html1raw', 'html1data', 'html2', 'html3', 'html4', 'html5', 'html6', 'html7'],
    of: mdBlockOf,
  },
  {
    name: 'p5Tok',
    values: ['data', 'comment', 'bogus', 'rawText:inline', 'rawText:block', 'script:--', 'script:e-', 'script:ed'],
    of: p5TokOf,
  },
  { name: 'openStack', values: ['0', '1', '2', '3+'], of: (cp) => depthBucket(cp.openStack.length) },
  { name: 'tagBalance', values: ['0', '1', '2', '3+'], of: (cp) => depthBucket(cp.tagBalance.size) },
  { name: 'openTotal', values: ['0', '1', '2', '3+'], of: (cp) => depthBucket(cp.openTotal) },
  { name: 'blankRun', values: ['0', '1', '2', '3+'], of: (cp) => depthBucket(cp.blankRun) },
  { name: 'candidates', values: ['0', '1', '2', '3+'], of: (cp) => depthBucket(cp.candidates.length) },
  { name: 'defs', values: ['empty', 'some'], of: (cp) => (cp.defs.size === 0 ? 'empty' : 'some') },
  { name: 'footnoteDefs', values: ['empty', 'some'], of: (cp) => (cp.footnoteDefs.size === 0 ? 'empty' : 'some') },
  {
    name: 'unresolvedRefs',
    values: ['empty', 'some'],
    of: (cp) => (cp.unresolvedRefs.length === 0 ? 'empty' : 'some'),
  },
  { name: 'hazardVerdict', values: ['0', '1'], of: (cp) => (cp.hazardVerdict ? '1' : '0') },
  { name: 'prevLineBlank', values: ['0', '1'], of: (cp) => (cp.prevLineBlank ? '1' : '0') },
  { name: 'prevLineWasText', values: ['0', '1'], of: (cp) => (cp.prevLineWasText ? '1' : '0') },
  { name: 'prevLineWasValidDef', values: ['0', '1'], of: (cp) => (cp.prevLineWasValidDef ? '1' : '0') },
  { name: 'prevLineOpenContent', values: ['0', '1'], of: (cp) => (cp.prevLineOpenContent ? '1' : '0') },
  { name: 'tableMaybeOpen', values: ['0', '1'], of: (cp) => (cp.tableMaybeOpen ? '1' : '0') },
  { name: 'containerMaybeOpen', values: ['0', '1'], of: (cp) => (cp.containerMaybeOpen ? '1' : '0') },
  { name: 'paragraphUnpaired', values: ['0', '1'], of: (cp) => (cp.paragraphHasUnpairedRun ? '1' : '0') },
  { name: 'openBracket', values: ['0', '1'], of: (cp) => (cp.openBracket === null ? '0' : '1') },
  { name: 'p5SealPending', values: ['0', '1'], of: (cp) => (cp.p5SealPending ? '1' : '0') },
  { name: 'defBlockMaybeOpen', values: ['0', '1'], of: (cp) => (cp.defBlockMaybeOpen ? '1' : '0') },
  { name: 'fnDefResumable', values: ['0', '1'], of: (cp) => (cp.fnDefResumable ? '1' : '0') },
  {
    name: 'phasePoisoned',
    values: ['none', 'from0', 'fromN'],
    of: (cp) =>
      cp.phasePoisonedAt === Number.POSITIVE_INFINITY ? 'none' : cp.phasePoisonedAt === 0 ? 'from0' : 'fromN',
  },
  { name: 'pendingTag', values: ['0', '1'], of: (cp) => (cp.pendingTag === null ? '0' : '1') },
  {
    name: 'truncatedTags',
    values: ['0', '1'],
    of: (cp) => (cp.pendingTruncatedTags.length === 0 ? '0' : '1'),
  },
  {
    name: 'truncatedCloses',
    values: ['0', '1'],
    of: (cp) => (cp.pendingTruncatedCloses.length === 0 ? '0' : '1'),
  },
  // The task-list tracker (taskListContext.ts). Without these a prefix
  // holding a provable task box and one holding an ordinary `[x]`
  // reference share a signature, and the search would keep only one of
  // them. `off` is the profile without the tracker; every other value is
  // the tracker's own state. The stack is bucketed by depth and by the
  // innermost frame's kind; the innermost item's first-content phase is
  // what decides whether a paragraph opening next can carry a box.
  {
    name: 'taskMode',
    values: ['off', 'known', 'unknown'],
    of: (cp) => (!cp.taskTracking ? 'off' : cp.task.unknown ? 'unknown' : 'known'),
  },
  {
    name: 'taskStack',
    values: ['0', '1', '2', '3+'],
    of: (cp) => (cp.taskTracking ? depthBucket(cp.task.stack.length) : '0'),
  },
  {
    name: 'taskInner',
    values: ['root', 'quote', 'item:unseen', 'item:open', 'item:consumed'],
    of: (cp) => {
      const inner = cp.taskTracking ? cp.task.stack[cp.task.stack.length - 1] : undefined;
      if (inner === undefined) return 'root';
      return inner.kind === 'quote' ? 'quote' : `item:${inner.firstContent}`;
    },
  },
  // The innermost item's content column relative to the parent prefix
  // (`size`). A setext underline or a table delimiter row converts the
  // paragraph only at that column, so `- [x] a` and `-   [x] a` answer
  // the same `  ===` future differently and must not share a signature
  // (2026-09-15 review, section 4). Bullets start at 2, ordered items at
  // 3; marker width and marker whitespace push it up to 17, which the
  // bucket caps.
  {
    name: 'taskItemSize',
    values: ['none', '2', '3', '4', '5', '6+'],
    of: (cp) => {
      const inner = cp.taskTracking ? cp.task.stack[cp.task.stack.length - 1] : undefined;
      if (inner === undefined || inner.kind !== 'item') return 'none';
      return inner.size >= 6 ? '6+' : String(inner.size);
    },
  },
  {
    name: 'taskParagraph',
    values: ['none', 'open', 'await'],
    of: (cp) => (cp.taskTracking && cp.task.paragraph !== null ? cp.task.paragraph.phase : 'none'),
  },
  {
    name: 'taskBox',
    values: ['none', 'waiting', 'valid'],
    of: (cp) => {
      const box = cp.taskTracking ? cp.task.paragraph?.box : undefined;
      return box === undefined || box === null ? 'none' : box.suffix;
    },
  },
];

/** The signature string: one field per position, order fixed by the domain
 *  table so two runs of the same corpus produce identical keys. */
export function abstractSignature(cp: FreezeScanCheckpointInternal): string {
  return SIGNATURE_DOMAIN.map((f) => f.of(cp)).join('|');
}

/** The per-field values of one signature, for coverage accounting. */
export function signatureValues(cp: FreezeScanCheckpointInternal): string[] {
  return SIGNATURE_DOMAIN.map((f) => f.of(cp));
}

/**
 * F20's essential chain, as predicates over the abstraction rather than
 * over bytes — declared BEFORE the search runs, so "did it reach the
 * witness" is a question the search answers rather than one its results
 * define.
 *
 * F20 was a scanner member whose contract asserts the two grammars agree
 * while they do not: a type-1 raw-text block that micromark still has open
 * after parse5's tokenizer has left raw text. The fix (`maskUnbacked =
 * mdType1RawText(mdBlock) && !inRawTextTok(p5Tok)`) is a MEMBERSHIP test,
 * which is exactly why it is expressible here.
 *
 * Stage 3 was written as the state in which the scanner froze bytes
 * parse5 was still going to reinterpret: a bogus-comment opener while the
 * mask is unbacked. It is UNREACHABLE, and the reason is the point —
 * stage 3 describes the scanner BEFORE F20 was fixed.
 *
 * Measured 2026-08-28 by direct probe, independent of the search, because
 * "the search did not reach it" and "it cannot be reached" are different
 * claims and only the second is worth reporting. `<?` alone gives
 * `p5Tok=bogus`; the same `<?` line appended to
 * `"<script>\n</script/>\n"` gives `p5Tok=data` and
 * `phasePoisonedAt=9`. The mask going unbacked POISONS at the line where
 * it happens, so there is no later state to observe — every candidate
 * shape tested (`<?`, `<!x`, `</3`, after `script`/`style`/`textarea`,
 * with `/>`- and space-form closers) lands the same way, boundary 0.
 *
 * So the chain's value is not that it finds F20; it is that stages 1 and
 * 2 remaining reachable while stage 3 stays unreachable IS the fix
 * holding. If a change ever removes the `maskUnbacked` poison, stage 3
 * becomes reachable and this search will say so — which is why it is
 * reported on every run and deliberately not asserted either way.
 */
export const F20_CHAIN: readonly { id: string; hit: (v: Record<string, string>) => boolean }[] = [
  { id: '1:type1-rawtext-open', hit: (v) => v.mdBlock === 'html1raw' },
  {
    id: '2:mask-unbacked',
    hit: (v) =>
      v.mdBlock === 'html1raw' &&
      v.p5Tok !== 'rawText:inline' &&
      v.p5Tok !== 'rawText:block' &&
      !v.p5Tok.startsWith('script:'),
  },
  {
    id: '3:bogus-under-mask',
    hit: (v) => v.mdBlock === 'html1raw' && v.p5Tok === 'bogus',
  },
];

/**
 * TEST-ONLY conformance oracles (two-model plan P1). The layer oracles
 * judge the scanner's boundary DIRECTLY — `computeFreezeBoundary`'s
 * number — and the engine probe compares shipped output on EVERY frame,
 * never gated on `usedIncremental`; nothing here inherits the mask of
 * `spliceTrees` returning null and falling back to the full path
 * (lie-mode 3).
 *
 * The contract under test is the identity
 *
 *     raw(prefix ++ tail) === raw(prefix) ++ raw(tail)   for every tail
 *
 * with one structural caveat, measured while building this module: the
 * system's safety contract is the scanner's boundary PLUS the splice-side
 * guards in `spliceParse` (`headRoutedCaptureUnclosed`, the stray-tag
 * bail, blocker-6 seam synthesis). The bare node-list identity at the
 * scanner's boundary diverges for tails the splice legitimately REFUSES —
 * e.g. any `<td>` tail after any paragraph prefix, because a tail-alone
 * fragment parse still starts "in template" while the full parse popped to
 * "in body" (the F8 family). So the instruments split by authority:
 *
 * - **Engine probe (authoritative)** — stream `doc` then `doc + tail`
 *   through the real engine and deep-equal frame 2 against a fresh full
 *   parse, positions included. A mismatch here is a DEFECT: shipped output
 *   differs from a full parse. The comparison is never gated on
 *   `usedIncremental` (lie-mode 3); the flag is reported so fallback-only
 *   probes are visible as proving nothing.
 * - **(M) span oracle (attribution)** — for every line start inside the
 *   frozen region, the set of mdast spans covering it must survive the
 *   probe being appended. In sweeps it is SNAPSHOT-anchored —
 *   `parse(doc)` vs `parse(doc + probe)` — because the scanner grants a
 *   boundary given every confirmed line of the snapshot (see
 *   `mSpanDisagreement`'s doc for the bad-oracle finding that forced
 *   this). Spans, not node types: micromark emits `htmlFlow` without
 *   distinguishing types 1–7, and the safety condition cares about the
 *   division alone. Probe tails are load-bearing here, not optional: on
 *   exactly the constructs blockers 3/4/5 exist for, an oracle that never
 *   appends agrees with the scanner FOR THE SAME WRONG REASON
 *   (lie-mode 1).
 * - **(P) identity oracles (design instruments)** — DIFFERENTIAL, not
 *   introspective: the hast of `prefix ++ tail` versus the hast of
 *   `prefix` followed by the hast of `tail` rebased into document
 *   coordinates, at the raw() layer and at the final layer. No field list
 *   of parse5's `Parser` to get wrong (`formElement` is the standing
 *   proof that the field enumeration does not close); a field dump is
 *   diagnostic material for explaining a failure, never the pass/fail
 *   criterion. These state the PREFIX-ANCHORED ideal identity, which
 *   overclaims at evidence-dependent boundaries, so sweeps run them only
 *   behind `idealIdentity` (exploratory); their home ground is hand
 *   fixtures, where a firing is real and an engine-clean firing is
 *   classification material (refused tail, seam-absorbed,
 *   sanitize-masked).
 *
 * Furniture the identity legitimately excludes, and why each exclusion is
 * sound:
 *
 * - The GFM footnote section is hoisted to document end by remark-rehype,
 *   so its POSITION moves with every append by design. It is stripped from
 *   both sides: the snapshot gate does it by the DEFINITION'S SOURCE BYTES
 *   alone, the prefix-anchored instruments by the section wrapper. The
 *   split is not stylistic — a wrapper is a start tag parse5 can eat (F21)
 *   and an attribute a document can forge, so the gate states the exemption
 *   in bytes only; the machinery that keeps footnote CONTENT correct across
 *   the splice is injection replay, pinned by `assertStreamEquivalence`.
 *   Reference retargeting inside the body — the (R) dimension — is NOT
 *   stripped: an orphan `[^x]` flipping to a sup link is a body diff.
 * - remark-rehype separates root children with `\n` text nodes. The split
 *   side lacks exactly one, at the seam; the comparison inserts it. Everything
 *   else — including whitespace-only text nodes inside the prefix region,
 *   which is where the erasure families (F9/F11/F12) manifest — is
 *   compared strictly, positions included.
 *
 * One oracle limitation is structural and recorded here rather than fixed:
 * both oracles run over whatever corpus they are handed, and every corpus
 * this repo owns was selected by surviving ALL CLEAN runs. A green sweep
 * under-reports by construction (lie-mode 2); it is a regression net, not
 * a safety argument.
 *
 * @module components/incrementalParse/conformanceOracles
 */

import isEqual from 'lodash-es/isEqual';
import rehypeRaw from '@ai-markdown/rehype-raw';

import { parseStage, transformStage } from '../markdown';
import { runFull } from './spliceArbiterHarness';
import { buildAdvanceOptions, type CatalogConfig } from './testPluginCatalog';
import { computeFreezeBoundary } from './computeFreezeBoundary';
import { advanceIncrementalParse } from './advanceIncrementalParse';

interface PosPoint {
  line: number;
  column: number;
  offset?: number;
}

export interface NodeLike {
  type: string;
  value?: string;
  tagName?: string;
  children?: NodeLike[];
  position?: { start: PosPoint; end: PosPoint };
  properties?: Record<string, unknown>;
}

// ── (M) span oracle ─────────────────────────────────────────────────────

/** Every positioned span in the tree, any depth. Collecting everything is
 *  deliberate: a safe boundary means the prefix's parse is byte-for-byte
 *  stable, so extra depth adds sensitivity without false positives. */
function collectSpans(node: NodeLike, out: Array<[number, number]>): void {
  if (!node.children) return;
  for (const child of node.children) {
    const s = child.position?.start?.offset;
    const e = child.position?.end?.offset;
    if (s !== undefined && e !== undefined) out.push([s, e]);
    collectSpans(child, out);
  }
}

function spansCovering(spans: Array<[number, number]>, offset: number): string {
  const hit = spans.filter(([s, e]) => s <= offset && offset < e);
  hit.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return hit.map(([s, e]) => `${s}-${e}`).join(',');
}

function lineStarts(prefix: string): number[] {
  const starts = [0];
  for (let i = 0; i < prefix.length - 1; i++) {
    if (prefix.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

/**
 * (M): compare the covering-span set at every line start below `boundary`
 * between `parse(base)` and `parse(base + tail)`. Returns a description of
 * the first disagreement, or null.
 *
 * The anchoring matters (T1.5 bad-oracle finding, 2026-08-24): the scanner
 * grants a boundary GIVEN every confirmed line of the snapshot — blockers
 * 3/4 settle candidates on evidence PAST the boundary — and the engine
 * cuts the SNAPSHOT's parse at the boundary, never a parse of the bare
 * prefix. Sweeps must therefore pass `base = the whole snapshot` and
 * `boundary = the granted boundary`; passing `base = prefix` asserts a
 * strictly stronger claim the scanner never made, and fires uniformly on
 * every evidence-dependent boundary. The prefix-anchored form is still the
 * right instrument for HAND fixtures, where the pair is chosen so the
 * claim and the instrument coincide.
 */
export function mSpanDisagreement(
  base: string,
  tail: string,
  config: CatalogConfig,
  baseMdast?: NodeLike,
  boundary = base.length
): string | null {
  return compareSpans(
    base,
    boundary,
    baseMdast ?? (runFull(base, config).mdast as NodeLike),
    runFull(base + tail, config).mdast as NodeLike
  );
}

function compareSpans(base: string, boundary: number, mp: NodeLike, mf: NodeLike): string | null {
  const spansP: Array<[number, number]> = [];
  const spansF: Array<[number, number]> = [];
  collectSpans(mp, spansP);
  collectSpans(mf, spansF);
  for (const L of lineStarts(base.slice(0, boundary))) {
    const a = spansCovering(spansP, L);
    const b = spansCovering(spansF, L);
    if (a !== b) {
      return `M: line start ${L} covered by [${a || 'nothing'}] in parse(base) but [${b || 'nothing'}] in parse(base+tail)`;
    }
  }
  return null;
}

// ── (P) pipeline oracle ─────────────────────────────────────────────────

function isFootnoteSection(node: NodeLike): boolean {
  // `dataFootnotes` is `true` from mdast-util-to-hast but `''` once
  // rehype-raw has reserialized the attribute — presence is the signal.
  //
  // The POSITION conjunct is what makes the signal unforgeable. The footer
  // is synthesized by remark-rehype and carries no source offsets, on every
  // shape measured (24 documents × 6 configs, including footers reparented
  // into an element a tail left open): zero generated footers with a
  // position. An attribute, by contrast, is 24 bytes any document can
  // write, and `<section data-footnotes>` at column 0 becomes exactly this
  // element once rehype-raw reparses it — after which the strip removed the
  // author's own content from BOTH sides of every identity. Measured before
  // the conjunct: 24 source bytes reduced the snapshot gate to zero
  // compared nodes for the whole document, on all six configs, and a
  // planted under-block that fires without the wrapper went silent
  // (`a document cannot forge the footer exemption and silence the gate`
  // in `oracleConformance.test.ts` pins it, with nine baits).
  //
  // Same defect class as F21, from the other side: F21 was a real footer
  // the parser ATE, this is a fake footer the document FED it. A key that
  // only source bytes can produce is wrong in both directions.
  return (
    node.type === 'element' &&
    node.position === undefined &&
    node.properties !== undefined &&
    'dataFootnotes' in node.properties
  );
}

/** Is the footnote section anywhere below this node? Cheap enough to run
 *  per root child, and the answer is almost always no. */
function holdsFootnoteSection(node: NodeLike): boolean {
  for (const child of node.children ?? []) {
    if (isFootnoteSection(child) || holdsFootnoteSection(child)) return true;
  }
  return false;
}

/**
 * Drop the hoisted GFM footnote section (and the separator text node
 * remark-rehype put before it — furniture of the furniture) from a child
 * list, at ANY depth.
 *
 * Depth matters: the section is hoisted to document END, so a probe tail
 * that leaves an element OPEN makes rehype-raw reparent the section INSIDE
 * that element. A root-level-only strip then removes it from one side of
 * the identity and not the other, and the difference is reported as a
 * P-raw firing that says nothing about the scanner (measured: the whole
 * `htmlKeepOpen` bucket under ORACLE_RAW=1).
 */
function stripFurniture(children: NodeLike[]): NodeLike[] {
  const out: NodeLike[] = [];
  for (const child of children) {
    if (isFootnoteSection(child)) {
      const prev = out[out.length - 1];
      if (prev?.type === 'text' && /^\s*$/.test(prev.value ?? '')) out.pop();
      continue;
    }
    out.push(holdsFootnoteSection(child) ? { ...child, children: stripFurniture(child.children ?? []) } : child);
  }
  return out;
}

/**
 * Source ranges of every `footnoteDefinition`, from the mdast.
 *
 * The footer is the only place a definition's bytes render, and
 * remark-rehype copies the definition's POSITION onto the `<li>` it
 * builds — so those nodes sit at frozen offsets while living at document
 * end. `stripFurniture` normally removes them by the `data-footnotes`
 * marker, but that marker is only reachable while the section's START TAG
 * survives, and a start tag is exactly what parse5 drops in the "text"
 * insertion mode: any raw-text or escapable-raw-text element still OPEN
 * when the footer is emitted (`textarea`, `title`, `style`, `script`,
 * `xmp`, `iframe`, `noembed`) eats the `<section>` and `<h2>` opens, and
 * the `<ol>` resurfaces at the root with no marker on it. The strip then
 * removes the footer from the side whose region is CLOSED and keeps it on
 * the side whose region is open.
 *
 * So the exemption is stated in source bytes instead: a definition's bytes
 * are the domain fact, and the wrapper is one spelling of it that a
 * grammar collision can erase.
 *
 * Only the snapshot GATE consumes this, and since 2026-08-28 it is the
 * gate's whole footer exemption — `stripFurniture` no longer runs there.
 * The prefix-anchored instruments keep the wrapper strip alone,
 * deliberately: they gate nothing, they already fire on half the
 * engine-clean positions, and re-cutting their info stream would move the
 * classification buckets the ledger describes for no gain.
 */
function footnoteDefinitionRanges(mdast: NodeLike, out: Array<[number, number]> = []): Array<[number, number]> {
  for (const child of mdast.children ?? []) {
    const s = child.position?.start?.offset;
    const e = child.position?.end?.offset;
    if (child.type === 'footnoteDefinition' && s !== undefined && e !== undefined) out.push([s, e]);
    else footnoteDefinitionRanges(child, out);
  }
  return out;
}

function rebaseNode(node: NodeLike, byOffset: number, byLine: number): NodeLike {
  const clone: NodeLike = { ...node };
  if (node.position) {
    // Seam-adjacent raw text can carry PARTIAL positions (an `end` with no
    // `start` — measured); key presence must survive the rebase exactly,
    // because the comparison is a strict deep-equal.
    const shift = (p: PosPoint | undefined): PosPoint | undefined =>
      p === undefined || typeof p.line !== 'number'
        ? p
        : { ...p, line: p.line + byLine, ...(p.offset !== undefined ? { offset: p.offset + byOffset } : {}) };
    const rebased: Record<string, PosPoint | undefined> = {};
    if ('start' in node.position) rebased.start = shift(node.position.start);
    if ('end' in node.position) rebased.end = shift(node.position.end);
    clone.position = rebased as never;
  }
  if (node.children) {
    clone.children = node.children.map((c) => rebaseNode(c, byOffset, byLine));
  }
  return clone;
}

/** hast for `content` through the production chain truncated after
 *  `rehype-raw` — the raw() layer the identity is stated over. Everything
 *  before the truncation (remark chain, remark-rehype options, the
 *  `rehype-raw` config) is the production assembly, so a divergence here is
 *  a real parse5-layer divergence, merely one sanitize may later mask.
 *
 *  Exported because the assembly is the load-bearing part: a caller that
 *  rebuilds these four lines is not observing the same layer the moment
 *  production's plugin list or `rehype-raw` config moves, and the copy goes
 *  stale silently — it keeps parsing, just not the thing under test. One
 *  definition, one layer. */
export function runToRawLayer(content: string, config: CatalogConfig): NodeLike {
  const options = buildAdvanceOptions(config);
  const parsed = parseStage({
    children: content,
    remarkPlugins: options.remarkPlugins,
    rehypePlugins: [[rehypeRaw, { passThrough: [] }]] as never,
    remarkRehypeOptions: options.remarkRehypeOptions,
  });
  return transformStage(parsed) as unknown as NodeLike;
}

// ── (P) snapshot form: the raw-layer gate ───────────────────────────────

/**
 * Every POSITIONED node, any depth, lying entirely below `boundary`, as an
 * identity signature.
 *
 * Depth is not optional. The boundary is a byte offset and raw-layer root
 * children are far too coarse to bracket it: a root-children-only version
 * of this compared ZERO nodes at 439 of 797 measured probe positions — an
 * instrument that was mostly asserting nothing, found by measuring it
 * before trusting its verdict. At full depth the same battery compares
 * 7.2-7.6 nodes per position.
 */
function frozenSignatures(
  nodes: NodeLike[],
  boundary: number,
  footnoteBytes: Array<[number, number]>,
  out: string[] = []
): string[] {
  for (const node of nodes) {
    const start = node.position?.start?.offset;
    const end = node.position?.end?.offset;
    // Footer furniture, by the bytes it renders rather than by the wrapper
    // it usually hangs under — see `footnoteDefinitionRanges`.
    //
    // The exemption covers THIS node only, and the walk descends anyway.
    // Skipping the subtree was the wider claim — "everything under a footer
    // `<li>` carries offsets from inside the same definition" is true of
    // every footer measured, and it is a statement about what the children
    // happen to be rather than about what the exemption means. Each node is
    // asked for its own bytes instead. Measured free: identical signature
    // counts on 4,000 fuzz documents / ~17k probe positions.
    const rendersFooterBytes = start !== undefined && footnoteBytes.some(([s, e]) => start >= s && start < e);
    // `start <= end` rejects MALFORMED ranges. Seam-adjacent raw nodes can
    // carry an inverted one — measured `138-128` on a `<v>` element, which
    // is rehype-raw reserialization furniture, not a frozen-region fact.
    // It was this instrument's only false positive across ~346k probe
    // positions, so the guard is the difference between a gate that can
    // run and one that cries wolf once a corpus.
    //
    // `start < boundary` requires the node to OWN at least one frozen byte.
    // Under the other two conjuncts the only shape it excludes is a
    // ZERO-WIDTH node sitting exactly AT the boundary (start >= boundary ∧
    // end <= boundary ∧ start <= end ⇒ start = end = boundary): raw
    // furniture whose identity derives ENTIRELY from tail bytes — measured
    // `297-297:element:p` where the tail line `p<iframe> x </iframe a> y`
    // collapses its own paragraph element at the raw layer (281d oracle
    // leg, seed 20294308 #558; engine-clean on seven schedules × six
    // configs, so an instrument artifact). The scanner's claim covers
    // bytes [0, boundary) and says nothing about a node holding none.
    if (
      !rendersFooterBytes &&
      start !== undefined &&
      end !== undefined &&
      start <= end &&
      start < boundary &&
      end <= boundary
    ) {
      out.push(
        `${start}-${end}:${node.type}:${node.tagName ?? ''}:` +
          `${JSON.stringify(node.properties ?? null)}:${JSON.stringify(node.value ?? null)}`
      );
    }
    frozenSignatures(node.children ?? [], boundary, footnoteBytes, out);
  }
  return out;
}

interface SnapshotResult {
  /** Non-null when a node the scanner froze did not survive the append. */
  detail: string | null;
  /** Anti-vacuity readout: how many frozen nodes this position actually
   *  compared. Zero means the instrument said nothing here. */
  nodesCompared: number;
}

/**
 * (P) SNAPSHOT-anchored: append-stability of the FROZEN REGION at the
 * raw() layer — `raw(doc)` versus `raw(doc + tail)`, over every positioned
 * node ending at or before `boundary`.
 *
 * This states the scanner's ACTUAL claim: bytes `[0, boundary)` are
 * settled. It is the same re-anchoring the (M) span oracle received on
 * 2026-08-24 — the load-bearing bad-oracle finding in GRAMMAR-COVERAGE —
 * applied to the layer that never got it. Crucially there is no tail-alone
 * parse anywhere in it, so no firing here can be an artifact of
 * concatenating two independent parses. Every one of the E1-E7 families
 * is exactly such an artifact, which is why they all go to zero under it.
 */
export function snapshotRawDisagreement(
  doc: string,
  tail: string,
  boundary: number,
  config: CatalogConfig,
  docMdast?: NodeLike
): SnapshotResult {
  return prepareSnapshotRawCheck(doc, boundary, config, docMdast)(tail);
}

/** Prepare one document's immutable raw-layer baseline for its probe battery.
 *  Each tail still gets its own appended parse and multiset comparison. Only
 *  reference data is retained; no engine state or tree enters this closure. */
export function prepareSnapshotRawCheck(
  doc: string,
  boundary: number,
  config: CatalogConfig,
  docMdast?: NodeLike
): (tail: string) => SnapshotResult {
  return prepareRawCheck(doc, boundary, docMdast ?? (runFull(doc, config).mdast as NodeLike), (content) =>
    runToRawLayer(content, config)
  );
}

function prepareRawCheck(
  doc: string,
  boundary: number,
  docMdast: NodeLike,
  rawReference: (content: string) => NodeLike
): (tail: string) => SnapshotResult {
  // SCOPE LIMITS, measured and accepted rather than papered over:
  //  - 26.0% of provably-frozen nodes carry no position offsets and are
  //    invisible here (raw reserialization drops them). The direction
  //    battery and the engine probe cover those regions.
  //  - frozen footnote-DEFINITION content is exempt: the footer it renders
  //    into is hoisted to document end and rebuilt from the whole document
  //    every frame, so its shape is injection replay's contract, pinned by
  //    `assertStreamEquivalence`, not the boundary's.
  //
  // That definition-bytes exemption is the gate's ONLY footer carve-out.
  // `stripFurniture` used to run here too, and it is gone: measured over
  // 4,000 fuzz documents / ~17k probe positions it suppressed not one
  // signature that `footnoteDefinitionRanges` did not already suppress
  // (identical counts: 89,570 benign / 47,364 hazard), while removing the
  // BYTE exemption from the same run reproduced F21's false positive
  // immediately. An exemption with no firing that needs it is not a safety
  // margin, it is unaudited surface — and this one read a key any document
  // can spell (see `isFootnoteSection`). The prefix-anchored instruments
  // keep the wrapper strip, where its need IS measured (the `htmlKeepOpen`
  // bucket); they gate nothing.
  // The comparison is a MULTISET equality, not a subset check, and the
  // difference is the two gaps this used to record as theoretical.
  //
  // A `frozen ⊆ appended` test cannot see either half of a swap between
  // DUPLICATE signatures: with `frozen = [A, A]` and `appended = [A, B]`
  // the surviving A answers for both, so a frozen node really did change
  // and the gate stays quiet. Counting closes it. The same count, read in
  // the other direction, closes the second gap for free — an append that
  // ADDS a node wholly below the boundary is a frozen region that gained
  // something, which no subset check can express because the addition is
  // simply absent from `frozen`.
  //
  // WHAT IS AND IS NOT SHOWN, because the tightening is free and a free
  // tightening is the kind that gets believed without evidence. Measured
  // 2026-08-29: no verdict moves, on 2 x 1500 raw-mode documents (~110k
  // compared nodes per seed) or on the unit fixtures. The counting itself
  // is exercised — a changed frozen node now reports `(1 fewer)` — but no
  // document was found where the OLD subset check is quiet and this one
  // fires, and both gaps are the kind that may be genuinely unreachable
  // here: a definition retargets every reference alike, so duplicate
  // frozen siblings tend to change together, and an append that adds a
  // node wholly below the boundary without touching any existing one is
  // not a shape this domain produces readily.
  //
  // So this is a gap CODED AROUND rather than a gap WITNESSED, and that is
  // the honest claim. It is still the right direction: "unreachable in
  // this corpus" is a fact about the corpus, and the corpus is what gets
  // replaced every time the generators grow.
  //
  // The exempt ranges come from `doc` and are applied to BOTH sides. Taking
  // the appended side's own ranges would let a definition that GREW under
  // the tail exempt a node it did not own before, which is the direction
  // that hides things.
  const footnoteBytes = footnoteDefinitionRanges(docMdast);
  const frozen = frozenSignatures(rawReference(doc).children ?? [], boundary, footnoteBytes);
  return (tail) => {
    const appended = frozenSignatures(rawReference(doc + tail).children ?? [], boundary, footnoteBytes);
    const counts = new Map<string, number>();
    for (const signature of frozen) counts.set(signature, (counts.get(signature) ?? 0) + 1);
    for (const signature of appended) counts.set(signature, (counts.get(signature) ?? 0) - 1);
    for (const [signature, delta] of counts) {
      if (delta === 0) continue;
      const how =
        delta > 0
          ? `did not survive the append (${delta} fewer)`
          : `appeared below the boundary that the append added (${-delta} more)`;
      return {
        detail: `P-snap: frozen node ${signature.slice(0, 220)} ${how} (boundary ${boundary})`,
        nodesCompared: frozen.length,
      };
    }
    return { detail: null, nodesCompared: frozen.length };
  };
}

// ── raw-layer exemption families (the ORACLE_RAW allowlist) ─────────────

/**
 * Flatten a child list to the content it CARRIES, dropping every grouping
 * and position decision: elements become `tag{props}` plus their flattened
 * children, text becomes its whitespace-stripped value (empty entries are
 * dropped). The pieces are compared JOINED, because node grouping is
 * exactly what this must not see — one text node of `ab` and two of `a`,
 * `b` are the same content. Equal flattenings mean the two sides carry the
 * same bytes and differ only in how those bytes were grouped.
 */
function flattenContent(nodes: NodeLike[], out: string[], depth = 0): string[] {
  for (const node of nodes) {
    if (node.type === 'text') {
      const v = (node.value ?? '').replace(/\s+/g, '');
      if (v !== '') out.push(`t${depth}:${v}`);
      continue;
    }
    // DEPTH is part of the signature. Without it this cannot see nesting,
    // so two sibling `<p>` and one `<p>` that SWALLOWED the other flatten
    // identically, and E4 called a reparenting "values conserved" — false,
    // and the wording is load-bearing for whoever triages a real failure
    // (2026-08-26 adversarial pass; it is also why the F13 `<pre>` swallow
    // probe classified as E4).
    if (node.type === 'element') out.push(`e${depth}:${node.tagName ?? ''}${JSON.stringify(node.properties ?? {})}`);
    else if (node.value !== undefined) out.push(`${node.type}${depth}:${node.value}`);
    flattenContent(node.children ?? [], out, depth + 1);
  }
  return out;
}

/** The marker both sides of a RESOLVED reference collapse to. */
const REF = '\u0001';
/** Element marker for the ref-normalized flattening. It must be
 *  UNFORGEABLE by document content: spelling an element as `<div>` let a
 *  literal `<div>` sitting in a raw-text element's text compare equal to a
 *  real `<div>` element — which is exactly the F10 shape, and it
 *  mislabelled as E3 until the reordering made it visible (2026-08-26).
 *  Text pieces stay unprefixed so the comparison remains blind to node
 *  grouping. */
const EL = '\u0002';

/**
 * Flatten to text with reference RESOLUTION normalized away, so the two
 * sides of a definition that straddles the boundary compare equal:
 *
 * - a footnote superscript becomes `REF` and is not recursed into (the
 *   full side numbers it `1`, the split side still spells the label);
 * - `<a>` loses its element identity but keeps its link text (`[spec][]`
 *   on the split side reduces to `spec` once the brackets go);
 * - remaining text drops `[`/`]` and collapses any surviving `[^label]`.
 *
 * A pair that is equal under this is the (R) dimension and nothing else:
 * same characters, different reference markup.
 *
 * `sup`, `img` and `a` are tag names a document can WRITE, so a divergence
 * inside a hand-authored `<sup>` collapses to `REF` and reads as (R) here.
 * That is tolerable for exactly one reason and it should not be extended:
 * this function classifies, it does not gate. The 2026-08-28 audit removed
 * every forgeable key from the gate itself, which now exempts on one thing
 * only — a `footnoteDefinition`'s source bytes, read off the mdast, which
 * no rendered artifact can spell into existence.
 */
function flattenRefNormalized(nodes: NodeLike[], out: string[]): string[] {
  for (const node of nodes) {
    if (node.type === 'text') {
      const v = (node.value ?? '')
        .replace(/\s+/g, '')
        // An IMAGE reference renders as `<img>` with its label in an
        // attribute, so the split side's `![label]` collapses to the same
        // marker the element does.
        .replace(/!\[[^\]\n]*\](?:\[[^\]\n]*\])?/g, REF)
        .replace(/\[\^[^\]]*\]/g, REF)
        // A FULL reference (`[text][label]`) renders only its text, so the
        // label the split side still spells out has to go with the syntax.
        .replace(/\]\[[^\]\n]*\]/g, ']')
        .replace(/[[\]]/g, '');
      // Bare, NOT prefixed: the pieces are compared joined precisely so
      // that one text node of `ab` and two of `a`,`b` are the same
      // content. A per-node prefix here would reintroduce the grouping
      // sensitivity (measured: 253 E3 firings turn unclassified).
      if (v !== '') out.push(v);
      continue;
    }
    if (node.type === 'element') {
      const tag = node.tagName ?? '';
      if (tag === 'sup' || tag === 'img') {
        out.push(REF);
        continue;
      }
      if (tag !== 'a') out.push(`${EL}${tag}`);
    }
    flattenRefNormalized(node.children ?? [], out);
  }
  return out;
}

/**
 * The exemption families kept for `ORACLE_RAW=1` runs (GRAMMAR-COVERAGE's
 * classification ledger). Every direction here is refuse-or-absorb, never
 * an under-block — and for the refuse-direction families that is measured
 * per firing rather than asserted (see `spliced` below).
 *
 * These GATE NOTHING: the ORACLE_RAW gate is `snapshotRawDisagreement`, and
 * `rawFamily` is read by zero assertions. What a family buys is a label in
 * the info log, and what an unlabelled firing buys is a human's attention —
 * which is the whole reason a family must not be broader than its
 * mechanism. A bucket that absorbs a new mechanism costs exactly that
 * attention.
 *
 * Adversarial audit 2026-08-26: 0 engine divergences in ~50k probes /
 * 6,880 streamed documents. The predicates were nonetheless too broad,
 * and were head-anchored + refusal-gated as a result — benign today is
 * not the same claim as tight.
 *
 * Second audit 2026-08-28: **E2-gfmTable is gone**, and with it the last
 * key that named WHICH PROBE RAN rather than what diverged. `probeId ===
 * 'gfmTable'` classified unconditionally, ahead of the value-conserving
 * families, so any mechanism the GFM-table probe happened to trigger landed
 * in a known bucket unexamined — 147 benign / 139 hazard firings per
 * 800-document sweep, 21-27% of every classification made. Deleting it
 * left ZERO firings unclassified: all of them were E4-grouping and
 * E3-refResolution, decided by the trees, which E2 had been sitting above
 * and stealing. `probeId === 'tablePart'` went the same way in the same
 * measurement (E1 130/132 rather than 136/144; the difference is 6 benign
 * and 12 hazard firings that are really E6 and E5 by their own head
 * predicates). This is the E5 finding of 2026-08-26 repeated twice over:
 * a family placed above the tree-decided ones absorbs their firings and
 * reports a mechanism that was never measured.
 *
 * What the two keys had been absorbing, measured on the verification run
 * (ORACLE_RAW=1, ORACLE_RUNS=4000 × 12 shards, seeds 20400300+i): 133
 * firings of 78,293 now carry no label, 0.2%, and they concentrate in about
 * three documents per 4,000-document sweep — one document fires once per
 * probe id, so the battery multiplies a single artifact by ~15. By shape:
 * 74 are the footnote footer resurfacing at the root without its wrapper,
 * which is F21's mechanism reaching the PREFIX-ANCHORED instruments (they
 * keep the wrapper strip deliberately, so they carry that artifact by
 * choice — the gate does not); 10 are a seam separator that is one newline
 * on one side and two on the other; the rest are content reparented across
 * the seam, `<p>` against `<dl>` at the same root index.
 *
 * They are left UNLABELLED on purpose. Every one is engine-clean — a
 * divergence with an engine disagreement is severity `defect` and fails the
 * shard, and all 12 passed — and inventing a family to re-absorb them would
 * rebuild exactly the thing this audit removed. A label has to be earned by
 * a measured mechanism, and "the probe battery hit the same document
 * fifteen times" is not one.
 */
export type RawFamily =
  'E1-tablePart' | 'E3-refResolution' | 'E4-grouping' | 'E5-strayEndTag' | 'E6-defVsParagraph' | 'E7-rawTextRunOn';

/**
 * The shape families (E1/E5/E6) are HEAD-ANCHORED: the insertion-mode
 * asymmetry they name lives at the point the tail is dispatched from, and
 * nowhere else. Scanning the WHOLE remainder for the pattern was the
 * original form and it was far too generous — an adversarial audit
 * (2026-08-26) measured 81.8% of hazard-corpus probe positions already
 * matching E5 or E6 somewhere in the remainder, so a brand-new divergence
 * family would have been silently exempted roughly five times in six.
 * Four named real families (formElement, F10, F11, F8) flipped from
 * gate-fails to exempt by appending one irrelevant `</span>` or
 * `[zz]: /q` line, and F6/F7/F13's idiomatic shapes — which end with a
 * closer on its own line — needed no bait at all.
 *
 * Leading blank lines are stripped first: they are the seam, not content.
 */
const stripLeadingBlanks = (tail: string): string => tail.replace(/^(?:[ \t]*\r?\n)*/, '');

/** An HTML table part AT THE HEAD of the tail. The tail-alone fragment
 *  parse dispatches it from "in template" — to "in table" / "in row" / "in
 *  column group" — while the full parse had already popped to "in body",
 *  so the two sides disagree by construction (the F8 shape). */
const TABLE_PART_HEAD_RE = /^[ \t]*<\/?(?:table|caption|colgroup|col|thead|tbody|tfoot|tr|td|th)\b/i;

/** A stray end tag AT THE HEAD of the tail. Same insertion-mode asymmetry
 *  as E1 with a non-table name: `</p>` at "in body" synthesizes an empty
 *  `<p>` while the tail-alone parse starts "in template" and produces
 *  nothing (hazard #272), and `</br>` is rewritten to a `<br>` START tag
 *  whose placement depends on the same mode (hazard #401).
 *
 *  Owned by `STRAY_SYNTHESIZED_END_TAG_RE` in `spliceParse.ts` (two sites:
 *  the seam-child scan and the first-visible-node check), which refuses
 *  exactly these tails — NOT by `spliceStructuralBail.test.ts`, which
 *  carries no stray-end-tag sample. The refusal is asserted rather than
 *  assumed: see `spliced` below. */
const STRAY_END_TAG_HEAD_RE = /^[ \t]*<\/[A-Za-z][A-Za-z0-9-]*\s*>/;

/** A link-definition line AT THE HEAD of the tail. Whether such a line IS
 *  a definition (invisible in the output) or paragraph text (whose inline
 *  content becomes real nodes) depends on what precedes it, so the two
 *  sides differ by exactly the def's inline content — measured on hazard
 *  #3807, where `[spec spec]: <u v> "title"` contributes a `<u>` element
 *  on one side and nothing on the other.
 *
 *  Mirrors the ENGINE's own `DEF_RE` (referenceTaint.ts) rather than
 *  approximating it: the looser form accepted `[]:` and `[a[b]:`, which
 *  are not definitions to micromark, so the exemption covered shapes whose
 *  premise was false. */
const DEF_LINE_HEAD_RE = /^ {0,3}\[(?:[^[\]\\]|\\.)+\]:/;

/**
 * Interior forms of the shape families, classified by the DIVERGENCE
 * CONTENT rather than by where a pattern sits in the tail text.
 *
 * Head-anchoring (2026-08-26) was right about the amnesty and wrong about
 * the coverage: the same three mechanisms fire from tail-INTERIOR
 * positions, which the head predicates stopped matching. Leg 5's first
 * soak (ORACLE_RAW=1, ORACLE_RUNS=4000 x 12 fresh seeds) failed 9 of 12
 * shards on 120 firings — every one a known mechanism, every engine probe
 * clean. The fix is not to loosen the text predicates back out; it is to
 * ask what actually DIFFERS between the two trees.
 *
 * Every tag below earned its place with a measured firing. A tag with no
 * firing stays OUT, so a future soak that hits `<caption>` or `<title>`
 * fails loud and gets it added with its evidence — that lifecycle is the
 * point, and the sets are deliberately smaller than the HTML categories
 * they are drawn from.
 */

/** Foster-parented table structure. Evidence (seed 20289300+i, local
 *  replay): `table`/`thead`/`tr`/`td` shard 0 hazard#3465; `tbody` shard 7
 *  hazard#32 and shard 11; `col` shard 2 hazard#825. NOT caption /
 *  colgroup / tfoot / th — never observed. */
const E1_TABLE_TAGS = new Set(['table', 'tbody', 'thead', 'tr', 'td', 'col']);

/** Elements parse5 SYNTHESIZES from a stray closer. Evidence: `br` shard 0
 *  hazard#1114, shard 3 hazard#627, shard 7; `p` shard 8 hazard#3042.
 *  These are exactly the two names `STRAY_SYNTHESIZED_END_TAG_RE` in
 *  spliceParse.ts matches, which is not a coincidence — same mechanism,
 *  read from the other end. */
const E5_SYNTH_TAGS = new Set(['br', 'p']);

/** Raw-text elements observed running on. Evidence: `script` shard 1
 *  benign#1039 and shard 9; `textarea` shard 6 hazard#151/#1434, shard 8,
 *  shard 9 hazard#44, shard 11 hazard#71. NOT style / title / xmp /
 *  iframe / noembed / noframes / plaintext — all in the HTML raw-text
 *  category, none measured, so none admitted. Keeping `title` out also
 *  keeps the F8 smuggle shape failing. */
const E7_RAW_TEXT_TAGS = new Set(['script', 'textarea']);

/** Whitespace-stripped text at every depth, JOINED — grouping-blind, for
 *  the same reason `flattenRefNormalized` joins. */
function joinedText(nodes: NodeLike[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.type === 'text') {
      const v = (node.value ?? '').replace(/\s+/g, '');
      if (v !== '') out.push(v);
    }
    joinedText(node.children ?? [], out);
  }
  return out;
}

/** Element tag names whose COUNT differs between the two sides, any depth.
 *  An empty set means the two trees hold the same elements and differ only
 *  in text or grouping (which E4/E3 already own). */
function divergentTags(actual: NodeLike[], expected: NodeLike[]): Set<string> {
  const counts = new Map<string, number>();
  const walk = (nodes: NodeLike[], sign: number): void => {
    for (const node of nodes) {
      if (node.type === 'element') {
        const tag = node.tagName ?? '';
        counts.set(tag, (counts.get(tag) ?? 0) + sign);
      }
      walk(node.children ?? [], sign);
    }
  };
  walk(actual, 1);
  walk(expected, -1);
  return new Set([...counts.entries()].filter(([, n]) => n !== 0).map(([t]) => t));
}

/**
 * Does the FIRST divergence sit inside a raw-text element that both sides
 * agree on? Descends through element pairs that match by tag, so the
 * answer is "the two parses disagree about how much this `<script>` /
 * `<textarea>` swallowed", not "a script appears somewhere".
 *
 * Mechanism: micromark ends a type-1 block on the `</name` SUBSTRING,
 * while parse5's raw text needs the appropriate end tag in full — so
 * `</scripty>` closes the block for one grammar and not the other, and the
 * tail-alone parse re-opens the element and swallows a different amount.
 * The scanner-side counterpart is F10. Keying on the first divergence is
 * deliberate: a run-on absorbs everything after it, so trailing
 * differences are its consequence, not separate findings.
 */
function rawTextRunOn(actual: NodeLike[], expected: NodeLike[], inRawText = false): boolean {
  const max = Math.max(actual.length, expected.length);
  for (let i = 0; i < max; i++) {
    const a = actual[i];
    const b = expected[i];
    if (isEqual(a, b)) continue;
    if (a?.type === 'element' && b?.type === 'element' && a.tagName === b.tagName) {
      return rawTextRunOn(a.children ?? [], b.children ?? [], inRawText || E7_RAW_TEXT_TAGS.has(a.tagName ?? ''));
    }
    return inRawText;
  }
  return inRawText;
}

/**
 * Order matters and is not arbitrary. The VALUE-CONSERVING families
 * (E4/E3) are decided by the two trees — same bytes, same characters — so
 * they cannot be a text-pattern mislabel, and they go first. Running E5
 * ahead of them was the second audit finding: 328 of 350 E5 assignments
 * were really E3/E4, and E5's claimed "tail refused" direction was false
 * for 166 of them. E2 and E1's `probeId` keys were the same fault a level
 * up — they ran ahead of EVERYTHING and asked which probe had been used —
 * and both are gone (see `RawFamily`).
 *
 * Nothing in here reads a probe id any more. A family is decided by the
 * two trees, or by the tail's own SOURCE BYTES, and never by the harness's
 * name for the tail it appended: a name is not a mechanism, and a bucket
 * keyed on one absorbs mechanisms it was never measured against.
 *
 * `spliced` is the refusal conjunct. E1/E5/E6 all claim the direction
 * "tail refused → full path", and that claim is now MEASURED: if the
 * engine spliced this very probe, the tail was not refused, so a raw-layer
 * divergence on it is a new family by definition and the gate fires. This
 * deliberately couples the (P) instrument to an observation of the shipped
 * path — a change to the splice's bails now surfaces here as raw-gate
 * failures instead of silently widening the amnesty. It introduces no
 * parse5 field introspection: `usedIncremental` is an output of the engine
 * under test, not a peek inside its parser.
 */
function classifyRawFamily(tail: string, spliced: boolean, actual: NodeLike[], expected: NodeLike[]): RawFamily | null {
  // ── value-conserving, decided by the trees ──
  // E4: the same bytes, grouped into different nodes. Covers the seam
  // separator merge (adjacent root text nodes fuse on the full side but
  // not on the concatenated one) and the footnote section hoisted INTO an
  // element the probe left open, whose separator merges into that
  // element's text — both are furniture, values conserved.
  if (flattenContent(actual, []).join('') === flattenContent(expected, []).join('')) return 'E4-grouping';
  // E3: same characters, different reference markup — the tail-alone parse
  // sees orphans where the full parse resolved them against a definition
  // in the prefix. Owned by the phantom injection replay, which the raw()
  // identity is deliberately stated without.
  if (flattenRefNormalized(actual, []).join('') === flattenRefNormalized(expected, []).join('')) {
    return 'E3-refResolution';
  }
  // ── E7: a raw-text element swallowing differently. NOT refuse-direction
  //    — its claim is about content, like E3/E4, so the `spliced` conjunct
  //    does not apply (and must not: 15 of shard 6's textarea firings are
  //    on tails the engine DID splice, correctly). ──
  if (rawTextRunOn(actual, expected)) return 'E7-rawTextRunOn';

  // ── refuse-direction families. Head-anchored fast path first — it is
  //    correct wherever it matches — then the value-based interior form.
  //    Both require the tail to have ACTUALLY been refused. ──
  if (spliced) return null;
  const head = stripLeadingBlanks(tail);
  if (TABLE_PART_HEAD_RE.test(head)) return 'E1-tablePart';
  if (STRAY_END_TAG_HEAD_RE.test(head)) return 'E5-strayEndTag';
  if (DEF_LINE_HEAD_RE.test(head)) return 'E6-defVsParagraph';

  // Interior forms: the mechanism fires from inside the tail, where no
  // head predicate can see it. Admitted only when the divergence is
  // ENTIRELY a set of known element kinds appearing or disappearing and
  // the text is conserved — a real defect moves characters, not just
  // wrappers.
  if (joinedText(actual).join('') === joinedText(expected).join('')) {
    const tags = divergentTags(actual, expected);
    if (tags.size > 0) {
      if ([...tags].every((t) => E1_TABLE_TAGS.has(t))) return 'E1-tablePart';
      if ([...tags].every((t) => E5_SYNTH_TAGS.has(t))) return 'E5-strayEndTag';
    }
  }
  return null;
}

function identityDisagreement(
  layer: string,
  prefix: string,
  left: NodeLike,
  full: NodeLike,
  right: NodeLike,
  family?: { tail: string; spliced: boolean; value: RawFamily | null }
): string | null {
  // Count line ENDINGS the way micromark does (`\r\n`, `\n`, lone `\r`) —
  // the tail's line numbers shift by exactly this many.
  const prefixLines = (prefix.match(/\r\n|\r|\n/g) ?? []).length;

  const leftKids = stripFurniture(left.children ?? []);
  const rightKids = stripFurniture(right.children ?? []).map((k) => rebaseNode(k, prefix.length, prefixLines));
  const expected = [...leftKids];
  if (leftKids.length > 0 && rightKids.length > 0) {
    // remark-rehype's root-child separator; the only synthesized node.
    expected.push({ type: 'text', value: '\n' });
  }
  expected.push(...rightKids);
  const actual = stripFurniture(full.children ?? []);

  if (isEqual(actual, expected)) return null;
  if (family) family.value = classifyRawFamily(family.tail, family.spliced, actual, expected);
  const max = Math.max(actual.length, expected.length);
  for (let i = 0; i < max; i++) {
    if (!isEqual(actual[i], expected[i])) {
      return (
        `${layer}: root child ${i} of ${actual.length}/${expected.length} — ` +
        `full=${JSON.stringify(actual[i])?.slice(0, 240)} ` +
        `split=${JSON.stringify(expected[i])?.slice(0, 240)}`
      );
    }
  }
  return `${layer}: children equal pairwise but roots differ (length bookkeeping)`;
}

/**
 * (P) at the FINAL-hast layer: what a divergence would actually ship.
 * `prefix` must end with a newline (every scanner candidate sits just after
 * a blank line's ending, so this holds for all real boundaries — asserted,
 * because the line-offset rebase is only exact under it).
 */
export function pipelineIdentityDisagreement(
  prefix: string,
  tail: string,
  config: CatalogConfig,
  prefixHast?: NodeLike
): string | null {
  if (!/[\n\r]$/.test(prefix)) throw new Error('pipelineIdentityDisagreement: prefix must end at a line ending');
  const left = prefixHast ?? (runFull(prefix, config).hast as NodeLike);
  const full = runFull(prefix + tail, config).hast as NodeLike;
  const right = runFull(tail, config).hast as NodeLike;
  return identityDisagreement('P-final', prefix, left, full, right);
}

/**
 * (P) at the raw() layer, BEFORE sanitize: the layer the contract is stated
 * over. Sanitize masks real parse5 divergences — the `formElement`
 * counterexample survives to the final hast as equal output ONLY because
 * `form` is not in the default schema and its children are lifted, and
 * `sanitizeSchema` is a public prop — so a green final-hast check alone
 * proves less than it appears to.
 */
export function rawLayerIdentityDisagreement(
  prefix: string,
  tail: string,
  config: CatalogConfig,
  family?: { tail: string; spliced: boolean; value: RawFamily | null }
): string | null {
  return rawIdentityWithReference(prefix, tail, (content) => runToRawLayer(content, config), family);
}

function rawIdentityWithReference(
  prefix: string,
  tail: string,
  rawReference: (content: string) => NodeLike,
  family?: { tail: string; spliced: boolean; value: RawFamily | null }
): string | null {
  if (!/[\n\r]$/.test(prefix)) throw new Error('rawLayerIdentityDisagreement: prefix must end at a line ending');
  return identityDisagreement(
    'P-raw',
    prefix,
    rawReference(prefix),
    rawReference(prefix + tail),
    rawReference(tail),
    family
  );
}

// ── probe battery ───────────────────────────────────────────────────────

export interface ProbeTail {
  id: string;
  tail: string;
}

/**
 * The battery every boundary is tested against. Static entries cover the
 * plan's minimum (plain text, paragraph, `<form>`, a table part, a
 * definition, the empty tail) plus one probe per cross-blank construct
 * family in Table D; dynamic entries collide with material the prefix
 * actually contains — an element name it opened, a bracket label it used —
 * because collision is what the static battery cannot know in advance.
 */
export function probeTailsFor(prefix: string): ProbeTail[] {
  const tails: ProbeTail[] = [
    { id: 'empty', tail: '' },
    { id: 'plain', tail: 'probe tail text\n' },
    { id: 'paragraph', tail: 'probe para one\n\nprobe para two\n' },
    { id: 'form', tail: '<form>b</form>\n' },
    { id: 'tablePart', tail: '<td>cell</td>\n' },
    { id: 'gfmTable', tail: '| a | b |\n| - | - |\n| c | d |\n' },
    { id: 'definition', tail: '[zz-probe]: /probe\n' },
    { id: 'footnoteDef', tail: '[^zz-probe]: probe body\n' },
    { id: 'defListClaim', tail: ': probe description\n' },
    { id: 'setext', tail: '===\n' },
    { id: 'lazy', tail: ' lazy continuation line\n' },
    { id: 'indentedCode', tail: '    probe indented code\n' },
    { id: 'fence', tail: '```\nprobe\n```\n' },
    { id: 'htmlKeepOpen', tail: '<div>probe\n' },
  ];
  const lastTag = [...prefix.matchAll(/<\/?([A-Za-z][A-Za-z0-9-]*)/g)].at(-1)?.[1];
  if (lastTag) {
    tails.push({ id: `collideTag:${lastTag}`, tail: `<${lastTag}>probe</${lastTag}>\n` });
  }
  const label = /\[([^\]\n^][^\]\n]{0,30})\]/.exec(prefix)?.[1];
  if (label && !label.includes('[')) {
    tails.push({ id: `collideDef:${label}`, tail: `[${label}]: /probe\n` });
  }
  const fnLabel = /\[\^([^\]\n]{1,30})\]/.exec(prefix)?.[1];
  if (fnLabel) {
    tails.push({ id: `collideFootnote:${fnLabel}`, tail: `[^${fnLabel}]: probe body\n` });
  }
  return tails;
}

// ── two-frame engine probe (the authoritative shipped-behavior check) ───

/**
 * Stream `baseDoc` then `baseDoc + tail` through the REAL engine and
 * deep-equal frame 2's `{mdast, hast}` against a fresh full parse. The
 * comparison always runs — never gated on `usedIncremental` (lie-mode 3);
 * the flag is reported so a probe that only ever exercises the fallback is
 * visible as such rather than silently proving nothing.
 *
 * This is the authoritative (P) verdict because the system's safety
 * contract is scanner boundary PLUS the splice-side guards
 * (`headRoutedCaptureUnclosed`, the stray-tag bail, seam synthesis): a
 * bare node-list identity at the scanner's boundary diverges for tails the
 * splice legitimately refuses — measured: a `<td>` tail diverges after ANY
 * paragraph prefix, because the tail-alone fragment parse still starts "in
 * template" while the full parse popped to "in body" (the F8 family).
 */
export function engineProbe(
  baseDoc: string,
  tail: string,
  config: CatalogConfig
): { disagreement: string | null; usedIncremental: boolean } {
  return engineProbeWithReference(baseDoc, tail, config, (content) => runFull(content, config));
}

function engineProbeWithReference(
  baseDoc: string,
  tail: string,
  config: CatalogConfig,
  fullReference: (content: string) => ReturnType<typeof runFull>
): { disagreement: string | null; usedIncremental: boolean } {
  const options = buildAdvanceOptions(config);
  // THREE frames, not two. A two-frame probe starts at
  // `advance(null, baseDoc)`, which is not append-only and therefore
  // always takes the FULL path — so the probed frame spliced onto a tree
  // the full parser built, the checkpoint had been resumed exactly once,
  // and the monotone boundary clamp never mattered. A whole class of
  // state-carry faults was structurally unreachable. Measured against a
  // planted `noClamp` mutation (2026-08-26, adversarial pass): two-frame
  // recall 1.5%, three-frame 49.7%, for one extra advance per probe.
  //
  // The first cut is code-point aligned so a frame boundary never splits a
  // surrogate pair (the repo-wide rule `codePointSnapshots` encodes).
  const points = Array.from(baseDoc);
  const firstCut = points.slice(0, Math.max(1, Math.floor(points.length / 2))).join('');
  const f0 = advanceIncrementalParse(null, firstCut, options);
  const f1 = advanceIncrementalParse(f0.nextState, baseDoc, options);
  const second = advanceIncrementalParse(f1.nextState, baseDoc + tail, options);
  const expected = fullReference(baseDoc + tail);
  let disagreement: string | null = null;
  // The INTERMEDIATE frame is asserted too: it is the frame that first
  // splices onto a spliced tree, so a fault there is real even when the
  // final frame happens to converge.
  const midExpected = fullReference(baseDoc);
  if (!isEqual(f1.mdast, midExpected.mdast) || !isEqual(f1.hast, midExpected.hast)) {
    disagreement = `engine: mismatch at the INTERMEDIATE frame (boundary=${f1.boundary}, cut=${firstCut.length})`;
  } else if (!isEqual(second.mdast, expected.mdast)) {
    disagreement = `engine: mdast mismatch at the final frame (boundary=${second.boundary})`;
  } else if (!isEqual(second.hast, expected.hast)) {
    disagreement = `engine: hast mismatch at the final frame (boundary=${second.boundary})`;
  }
  return { disagreement, usedIncremental: second.usedIncremental };
}

// ── boundary-driven sweep ───────────────────────────────────────────────

export interface OracleFinding {
  probeId: string;
  boundary: number;
  /** `defect` = the shipped engine output differs from a full parse.
   *  `info` = a layer instrument fired while the engine stayed correct —
   *  T1.5 classification material (refused tail, seam-absorbed, or
   *  sanitize-masked), never a pass/fail signal by itself. */
  severity: 'defect' | 'info';
  detail: string;
  /** Raw-mode firings only: which exemption family this matched, or `null`
   *  for one no family claims. Read by no assertion — it is a label in the
   *  info log, for a human triaging. (It gated the sweep until 2026-08-26,
   *  and this comment still said so until the 2026-08-28 audit; the
   *  classifier had been demoted two days earlier when the gate moved to
   *  `snapshotRawDisagreement`.) */
  rawFamily?: RawFamily | null;
}

export interface OracleSweepStats {
  probesRun: number;
  /**
   * Probes whose tail is NON-EMPTY — the only ones whose engagement means
   * anything. `advanceIncrementalParse` reports `usedIncremental` for an
   * identical-content frame (a memo hit, no splice), and the battery always
   * carries two empty tails (`realTailOnly` and the `empty` probe) per
   * recursion level, so counting every probe put a structural floor of 4
   * per document under the anti-vacuity assertion — reachable with the
   * splice fully collapsed (2026-08-26 review, mutation-verified).
   */
  spliceableProbes: number;
  /** Of `spliceableProbes`, the ones the engine actually spliced. */
  incrementalProbes: number;
  /** Anti-vacuity readout for the (P) snapshot gate: frozen nodes compared
   *  across every probe position. A gate that compares nothing passes
   *  everything. Only accumulated under `idealIdentity`. */
  snapshotNodesCompared: number;
  /** Probe positions where the snapshot gate compared at least one node. */
  snapshotPositions: number;
  /**
   * Documents the sweep actually probed (boundary > 0), and of those, the
   * ones where the gate compared nothing ANYWHERE — not at a single probe
   * position, counting the zero-distance recursion too.
   *
   * These exist because the ratio floors above cannot see a document. They
   * are corpus-wide, so one blind document moves them by a millionth, and a
   * gate silently disabled on part of a corpus reads as healthy: the
   * measured `snapshotPositions / spliceableProbes` is 0.974 against a 0.5
   * threshold, so 48.7% of documents could be blind before the floor
   * noticed. F22 is what made that concrete: a forged footer wrapper took
   * a document's gate to zero compared nodes on all six configs while
   * every corpus-wide ratio stayed comfortable.
   *
   * The per-document counter is the right shape because blindness IS
   * per-document: measured over 1,263 probed documents, the count of
   * documents blind at EVERY position and the count blind at ANY position
   * are the same number (benign 4, hazard 24). Whether the gate can speak
   * is a property of the document, not of the probe — so a document is
   * either heard from or it is not, and counting the silent ones is the
   * whole instrument.
   *
   * Only accumulated under `idealIdentity`, at depth 0, so the recursion
   * does not double-count the document it was spawned from.
   *
   * Scope limit, stated because it is the obvious next question: a
   * document the scanner grants NO boundary is never probed and never
   * counted. That is correct — the gate cannot fail to check a claim that
   * was never made — but it means a blinding that ALSO suppresses the
   * boundary stays invisible to this counter.
   */
  documentsProbed: number;
  fullyBlindDocs: number;
}

/**
 * Probe one document's scanner claim from every side. Append-only is
 * respected throughout: probe tails are appended to the WHOLE document
 * (the scanner granted its boundary GIVEN the document's confirmed lines —
 * replacing the real continuation would test a stream the scanner never
 * approved, and blocker 4's next-line settle makes that a false positive
 * by construction). To also stress the boundary at zero distance, the
 * claimed prefix is recursed on once as a document of its own: whatever
 * boundary the scanner grants THERE has probes landing directly on it.
 *
 * Returns every finding; an empty array is "no disagreement on this
 * corpus", never "safe" (lie-mode 2).
 */
export function oracleCheckDoc(
  doc: string,
  config: CatalogConfig,
  stats?: OracleSweepStats,
  depth = 0,
  options?: { idealIdentity?: boolean }
): OracleFinding[] {
  // Scoped to this document and its one zero-distance recursion. The full
  // and raw reference parses are only READ by the instruments; the engine
  // still executes all three frames afresh for EVERY probe, including the
  // two empty tails. Nothing is shared with its trees or mutable checkpoint.
  return checkDocWithReferences(doc, config, stats, depth, options, {
    full: memoizeReference((content) => runFull(content, config)),
    raw: memoizeReference((content) => runToRawLayer(content, config)),
  });
}

function memoizeReference<T>(parse: (content: string) => T): (content: string) => T {
  const runs = new Map<string, T>();
  return (content) => {
    if (runs.has(content)) return runs.get(content)!;
    const result = parse(content);
    runs.set(content, result);
    return result;
  };
}

function checkDocWithReferences(
  doc: string,
  config: CatalogConfig,
  stats: OracleSweepStats | undefined,
  depth: number,
  options: { idealIdentity?: boolean } | undefined,
  references: { full: (content: string) => ReturnType<typeof runFull>; raw: (content: string) => NodeLike }
): OracleFinding[] {
  const { defListEnabled } = buildAdvanceOptions(config);
  const boundary = computeFreezeBoundary(doc, { defListEnabled }).boundary;
  if (boundary <= 0) return [];
  // Read BEFORE any probing, compared after the zero-distance recursion has
  // also had its say: a document counts as blind only if nothing anywhere
  // in it spoke.
  const positionsOnEntry = stats?.snapshotPositions ?? 0;
  const prefix = doc.slice(0, boundary);
  const realTail = doc.slice(boundary);
  const probes = probeTailsFor(prefix);
  const docRun = references.full(doc);
  const checkRaw = options?.idealIdentity
    ? prepareRawCheck(doc, boundary, docRun.mdast as NodeLike, references.raw)
    : undefined;
  const findings: OracleFinding[] = [];

  for (const probe of [{ id: 'realTailOnly', tail: '' }, ...probes]) {
    const engine = engineProbeWithReference(doc, probe.tail, config, references.full);
    if (stats) {
      stats.probesRun += 1;
      if (probe.tail !== '') {
        stats.spliceableProbes += 1;
        if (engine.usedIncremental) stats.incrementalProbes += 1;
      }
    }
    if (engine.disagreement !== null) {
      findings.push({ probeId: probe.id, boundary, severity: 'defect', detail: engine.disagreement });
    }
    // (M), snapshot-anchored: the frozen region's spans must survive the
    // probe being appended to the snapshot the boundary was granted on.
    const m = compareSpans(
      doc,
      boundary,
      docRun.mdast as NodeLike,
      references.full(doc + probe.tail).mdast as NodeLike
    );
    if (m !== null) {
      findings.push({
        probeId: probe.id,
        boundary,
        severity: engine.disagreement === null ? 'info' : 'defect',
        detail: m,
      });
    }
    if (options?.idealIdentity) {
      // The GATE (2026-08-26 re-anchor): snapshot-anchored append
      // stability of the frozen region. Any firing fails the sweep — it
      // needs no exemption list, because it has no tail-alone parse to
      // produce artifacts about.
      // An EMPTY tail compares `raw(doc)` against ITSELF — it cannot fire,
      // and counting it inflated the anti-vacuity floor with positions
      // that assert nothing. Measured: 12.4% of probe positions have an
      // empty tail and alone delivered 99.7% of the floor's budget, so a
      // TOTAL gate collapse would have dropped it by 0.3%. Exactly the
      // memo-hit bug the engagement floors had, repeated here and caught
      // by the same adversarial reading.
      if (probe.tail !== '') {
        const snap = checkRaw!(probe.tail);
        if (stats) {
          stats.snapshotNodesCompared += snap.nodesCompared;
          if (snap.nodesCompared > 0) stats.snapshotPositions += 1;
        }
        if (snap.detail !== null) {
          findings.push({ probeId: probe.id, boundary, severity: 'defect', detail: snap.detail });
        }
      }
      // The prefix-anchored form is retained as INFO-ONLY triage. It has
      // real recall (99.1% of planted under-blocks, against the snapshot
      // form's 31.5%) but fires on 50.8% of engine-clean positions, so it
      // cannot gate anything without the E1-E7 allowlist — and that
      // allowlist has now been refuted twice. Its recall is also redundant
      // with the engine probe, which is authoritative, always on, and
      // caught 100% of that same population by construction. Kept because
      // a human triaging a real failure wants the extra signal; the
      // classifier below is now its classification aid, not a gate.
      const family = {
        tail: realTail + probe.tail,
        // The refusal conjunct: an EMPTY tail cannot be "refused" (the
        // frame is identical content, a memo hit), so it never counts as
        // spliced evidence either way.
        spliced: engine.usedIncremental && probe.tail !== '',
        value: null as RawFamily | null,
      };
      const r = rawIdentityWithReference(prefix, family.tail, references.raw, family);
      if (r !== null) {
        findings.push({
          probeId: probe.id,
          boundary,
          severity: engine.disagreement === null ? 'info' : 'defect',
          detail: r,
          rawFamily: family.value,
        });
      }
    }
  }

  // Zero-distance variant: the claimed prefix as its own document.
  if (depth === 0 && prefix.length < doc.length) {
    findings.push(...checkDocWithReferences(prefix, config, stats, 1, options, references));
  }
  if (stats && options?.idealIdentity && depth === 0) {
    stats.documentsProbed += 1;
    if (stats.snapshotPositions === positionsOnEntry) stats.fullyBlindDocs += 1;
  }
  return findings;
}

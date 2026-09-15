/** Framework-neutral block planning and dependency fingerprints.
 * Cache ownership and conversion to framework nodes belong to adapters.
 * See apps/docs/content/guides/architecture.md and packages/core/README.md for the contract.
 */
import type { Element as HastElement, Root as HastRoot, RootContent as HastChild } from 'hast';
import type { Root as MdastRoot, RootContent as MdastContent, Nodes as MdastNodes } from 'mdast';
import { SKIP, visit } from 'unist-util-visit';
import { isFootnoteSection, normalizeId, type Registry } from '@ai-markdown/engine';

/**
 * mdast types whose presence in a block makes that block dependent on
 * cross-block syntax (footnote/link/image references and definitions).
 * Tainted blocks invalidate via the document `globalCtx` digest; non-tainted
 * blocks invalidate only on raw + position change.
 */
const TAINT_TYPES: ReadonlySet<string> = new Set([
  'footnoteReference',
  'footnoteDefinition',
  'linkReference',
  'imageReference',
  'definition',
]);

/**
 * mdast types that contribute to the document-wide `globalCtx` digest.
 * Currently identical to {@link TAINT_TYPES} — refs/defs are simultaneously
 * "things that make a block tainted" and "things that change a tainted
 * block's render output". Kept as a separate constant so the two roles can
 * diverge later (e.g. a future plugin that introduces a new node type which
 * is a ctx contributor but not a per-block taint source).
 */
const CTX_TYPES: ReadonlySet<string> = TAINT_TYPES;

/** Source-level identity of one renderable hast block. */
export interface BlockInfo {
  raw: string;
  startOffset: number;
  endOffset: number;
  /**
   * Line and column at the block's start. Tracked alongside `startOffset`
   * because two different source documents can produce the same byte offset
   * for the "same" content (`A\n\nB\n\nTarget` vs `ABCD\n\nTarget` — both
   * have `Target` starting at offset 6 but on different lines). Custom
   * components that read `node.position.start.line` would otherwise see
   * stale data from a false-positive cache hit.
   */
  startLine: number;
  startColumn: number;
  /** True if the block contains any TAINT_TYPES node — invalidate on globalCtx change. */
  hasReference: boolean;
  /**
   * Structural digest of the block's hast subtree, computed ONLY for blocks
   * that originate from raw HTML (mdast `html` nodes, or blocks resolved via
   * the range-containment fallback). Undefined for markdown-native blocks.
   *
   * Why it exists: rehype-raw applies the HTML parsing algorithm, so an
   * UNCLOSED container tag (`<details>` mid-stream, before its `</details>`
   * arrives) swallows every FOLLOWING top-level sibling into itself —
   * including the synthetic `<section data-footnotes>`. The block's mdast
   * identity (raw, position, ctx) is byte-identical across all those frames,
   * so without this digest the first swallowed snapshot would be a permanent
   * cache hit: content rendered inside the container freezes, and when the
   * close tag finally arrives the real nodes re-render at top level while the
   * stale copies stay trapped in the cached container (the "duplicate
   * footnote section inside <details>" bug).
   *
   * Digest composition — `maxEnd:descendantCount:hasFootnoteSection:swallowedHash`:
   * - max end offset over the subtree catches swallowed POSITIONED siblings
   *   (their offsets lie beyond the mdast node's own range);
   * - descendant count catches position-less synthetic content moving in or
   *   out (the footnote section's own element carries no position, and its
   *   li contents point BACK at the definitions' offsets, which can be
   *   smaller than the container's end — maxEnd alone misses that case);
   * - the explicit dataFootnotes bit closes the degenerate corner where a
   *   swallowed section and later real children tie on both numbers;
   * - a hash of the swallowed extent's SOURCE (`[ownEnd, maxEnd)`) quickly
   *   rejects most equal-length, equal-shape replacements. A matching hash
   *   still requires an exact {@link BlockInfo.swallowedSource} comparison.
   *
   * Markdown-native blocks (paragraph/list/math/code/…) never receive
   * reparented content — every hast descendant derives from their own mdast
   * source range — so they skip the subtree walk entirely. This keeps the
   * per-frame cost away from huge deterministic subtrees like KaTeX output.
   */
  hastDigest?: string;
  /**
   * Exact source in the swallowed interval `[ownEnd, maxEnd)` of a raw-HTML
   * block. The FNV-1a 32-bit hash in `hastDigest` can collide for different
   * equal-length contents, so a cache hit must compare this string too.
   * Empty when the block swallowed no source; absent for markdown-native
   * blocks. Optional to keep existing public block-plan producers compatible.
   */
  swallowedSource?: string;
  /** A raw-HTML container that swallowed the synthesized
   *  `<section data-footnotes>` (rehype-raw reparents the following siblings
   *  into an unclosed `<details>` / `<div>` mid-stream). The footer is then
   *  NOT a top-level plan item, so coordinated mode's "skip the local
   *  footer, the aggregate renders it" rule never fired and the document
   *  showed two `<section data-footnotes>` with colliding li ids (2026-08-19
   *  review r2 P2-9). Coordinated renders strip it from this block's subtree;
   *  standalone renders keep it exactly where the full parse puts it. */
  containsFootnoteSection?: boolean;
  /** TAINT-block 专属：按节点类型分桶的 label set。Normalized 形态（uppercase）。
   *  Undefined when hasReference === false. */
  taintLabels?: {
    footnoteRefLabels: string[];
    linkRefLabels: string[];
    imageRefLabels: string[];
    footnoteDefLabels: string[];
    /** Chunk-local footnote state the engine baked into this block's
     *  `footnote-sup` placeholders (`localOccurrence` / `localNumber` come
     *  from a per-chunk counter over all PRECEDING refs, customMdastHandlers):
     *  per ref label, refs-before-this-block count and first-appearance
     *  rank. Same raw + same registry answers but a different prefix (an
     *  in-place `[^x]`→`[^w]` edit upstream) must miss the cache, or the
     *  stale occurrence resolves to a null global occurrence and the mark
     *  vanishes (2026-08-19 review P2-4). Absent when the block has no refs. */
    footnoteRefLocalCtx?: string;
    /** Baked `localUrl` / `localTitle` of swallowed `cross-chunk-link` /
     *  `-image` placeholders, as `[[label, url, title|null]…]` (JSON). The
     *  render falls back to these when the registry has no canonical def,
     *  where the fingerprint's `lr:`/`ir:` part is the constant `null` —
     *  see scanSwallowedSubtree. Absent when nothing was swallowed. */
    swallowedDefCtx?: string;
  };
}

/**
 * Slice the source string for the given mdast node's position. mdast nodes
 * produced by remark-parse always carry `position`; the empty-string fallback
 * is purely defensive.
 */
function extractRaw(node: MdastNodes, source: string): string {
  if (!node.position) return '';
  return source.slice(node.position.start.offset, node.position.end.offset);
}

// isFootnoteSection lives in the engine now (boundary action ①): the
// incremental-parse engine's attributeHastChildren needs it too, and
// engine→core imports are forbidden. Re-exported so this module's export
// surface (and its tests) stay unchanged.
export { isFootnoteSection };

/** Dev invariant: every block hast child must retain its mdast `position`. */
export function hasMdastSource(node: HastElement): boolean {
  return node.position !== undefined;
}

/**
 * Compute {@link BlockInfo.hastDigest} for a raw-HTML block: iterative walk
 * over the hast subtree collecting (max end offset, descendant count,
 * contains-footnote-section). See the field's JSDoc for why each component
 * is load-bearing. Exported for tests.
 */
export function computeHtmlBlockDigest(el: HastElement, source?: string, ownEnd?: number): string {
  return computeHtmlBlockDigestWithExtent(el, source, ownEnd).digest;
}

/** {@link computeHtmlBlockDigest} plus the subtree's max end offset — the end
 *  of the SWALLOWED extent, which callers need to ask what fell inside.
 *
 *  Both position sources here are HAST offsets, and every use of the extent
 *  is unsafe in the SHORT direction (too small and a swallowed reference
 *  escapes the taint test, so an edit to a definition outside the container
 *  leaves a stale href in the cache). They are redundant on purpose: the
 *  container's own end already reaches past the swallowed blocks, because
 *  `rehype-raw` reparses the raw string and closes the element wherever
 *  parse5 does — NOT where the mdast `html` node ends, which is just the
 *  opening tag. The descendant walk covers it a second time. Verified in
 *  2026-08-20 A1 across 162 container/tail shapes: destroying either source
 *  alone changes nothing, destroying both under-taints 130 of them. */
export function computeHtmlBlockDigestWithExtent(
  el: HastElement,
  source?: string,
  ownEnd?: number
): { digest: string; maxEnd: number } {
  let maxEnd = el.position?.end?.offset ?? 0;
  let count = 0;
  let hasFootnoteSection = false;
  const stack: HastElement['children'][number][] = [...el.children];
  while (stack.length > 0) {
    const node = stack.pop()!;
    count++;
    const end = node.position?.end?.offset;
    if (end !== undefined && end > maxEnd) {
      maxEnd = end;
    }
    if (node.type === 'element') {
      if (isFootnoteSection(node)) {
        hasFootnoteSection = true;
      }
      for (const child of node.children) {
        stack.push(child);
      }
    }
  }
  // Swallowed SOURCE hash: `maxEnd:count` are blind to an equal-length,
  // equal-shape replacement of the swallowed siblings (`Answer: 42` →
  // `Answer: 43` inside an unclosed <details>, single-frame — v2.4.2 review
  // P2-1); the container's own `raw` is unchanged, so the cache hit kept
  // rendering the old text. The hash is a fast rejection; buildBlocks also
  // retains the exact swallowed source for collision-safe cache validation.
  const swallowed = source !== undefined && ownEnd !== undefined && maxEnd > ownEnd ? source.slice(ownEnd, maxEnd) : '';
  return { digest: `${maxEnd}:${count}:${hasFootnoteSection ? 1 : 0}:${fnv1a(swallowed)}`, maxEnd };
}

/** FNV-1a 32-bit over UTF-16 code units — cheap, no allocation. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * One step of the document render plan, in source order.
 *
 * The plan covers EVERY top-level hast child so that the adapter’s block cache
 * can preserve react-markdown's byte-equivalent output — including the whitespace
 * `text` nodes that `mdast-util-to-hast` inserts between block elements.
 *
 * - `block`: a hast element with an mdast counterpart, eligible for caching by
 *   `(raw, occurrence index, ctx, startOffset)`.
 * - `inline`: a non-element top-level child (whitespace text, comment, …) or
 *   an element that has no mdast counterpart but is still safe to render.
 *   These are rendered every frame without caching — they are typically
 *   single whitespace characters.
 * - `synthetic`: the synthesized footnote `<section data-footnotes>`, cached
 *   in a single slot keyed by `globalCtx`.
 */
export type RenderItem =
  | { kind: 'block'; el: HastElement; key: string; info: BlockInfo }
  | { kind: 'inline'; el: HastChild; key: string }
  | { kind: 'synthetic'; el: HastElement; key: string };

const EMPTY_LABELS: ReadonlySet<string> = new Set<string>();

/** Extra render-time facts {@link buildBlocks} cannot read off the trees. */
export interface BuildBlocksOptions {
  /** Full document when planning only a tail. Its ordered reference and
   * definition context seeds numbering and invalidation for tail blocks. */
  contextMdast?: MdastRoot;
  /**
   * Labels this chunk phantom-injected because another chunk defines them
   * (already normalized). The coordinated handlers keep these out of
   * `state.footnoteOrder`, so the cache key's rank must keep them out too —
   * see the note in the rank pass. Empty / omitted in standalone mode, where
   * no phantom injection happened.
   */
  phantomFootnoteLabels?: ReadonlySet<string>;
}

/** Result of {@link buildBlocks}. */
export interface BuildBlocksResult {
  /** Render plan in document order — drives the adapter’s block cache. */
  plan: RenderItem[];
  /** JSON-stringified ordered list of TAINT-typed nodes in document order. */
  globalCtx: string;
  // ── Derived views (kept for tests and convenience) ─────────────────────
  /** Flat list of `BlockInfo` for cacheable blocks, in document order. */
  blocks: BlockInfo[];
  /** 1:1 with `blocks` — the hast Element each BlockInfo refers to. */
  blockHasts: HastElement[];
  /** Synthesized footnote section, if present. */
  synthetic?: HastElement;
}

const FOOTNOTE_SECTION_KEY = '__footnote_section__';

/**
 * Build the document render plan + ctx digest from a parsed mdast and its
 * rendered hast.
 *
 * Plan construction is driven by `hast.children` (NOT `mdast.children`):
 * pipeline transformers like `remarkSqueezeParagraphs` and
 * `remarkRemoveComments` drop blocks, so the rendered hast may have fewer
 * top-level children than the parsed mdast. Driving by hast guarantees the
 * plan covers exactly what will be rendered.
 *
 * Each hast top-level child becomes one plan item:
 * - `<section data-footnotes>` → `synthetic` (cached in a single slot)
 * - element with mdast counterpart → `block` (cacheable by raw + occurrence + ctx + offset)
 * - text / comment / element-without-counterpart → `inline` (rendered fresh every frame)
 *
 * The mdast counterpart of a block element is found by source offset using
 * a two-tier lookup: an exact-offset Map (mdast-util-to-hast's default 1:1
 * propagation), then range-containment `findLast` fallback for cases like
 * `rehype-raw` splitting one mdast `html` node into multiple hast siblings
 * (e.g. `   <div>Hi</div>` — leading spaces shift the `<div>` offset
 * inside the parent html node's source range).
 *
 * In dev, a hast block whose offset matches no mdast counterpart at all
 * throws — that means a rehype plugin synthesized positions outside the
 * source range, which is a bug worth surfacing. In production it falls
 * through to an `inline` plan item so user content is never silently lost.
 *
 * `globalCtx` walks the full mdast for footnote/link/image refs and
 * definitions in document order (no dedupe — order matters for footnote
 * numbering), then JSON-stringifies the collected tuples. That string is the
 * invalidation key for tainted blocks and the synthetic footnote section.
 */
export function buildBlocks(
  mdast: MdastRoot,
  hast: HastRoot,
  source: string,
  options: BuildBlocksOptions = {}
): BuildBlocksResult {
  const phantomFootnotes = options.phantomFootnoteLabels ?? EMPTY_LABELS;
  const mdastByOffset = new Map<number, MdastContent>();
  // Sorted [start, end, node] table for the range-containment fallback used
  // when a hast block's offset is INSIDE an mdast node's source range
  // (`rehype-raw` splitting one mdast `html` node into multiple hast
  // siblings is the canonical case). Pre-sorted because mdast children come
  // out of remark-parse in source order; we collect positioned ones in
  // place, preserving order. Binary search at lookup time replaces the
  // previous O(N) `findLast` — without it, M hast blocks × N mdast children
  // degrades to O(N×M) on pathological streams with many splits.
  type Range = { start: number; end: number; node: MdastContent };
  const mdastRanges: Range[] = [];
  for (const child of mdast.children) {
    const off = child.position?.start.offset;
    const endOff = child.position?.end.offset;
    if (off !== undefined) {
      mdastByOffset.set(off, child);
    }
    if (off !== undefined && endOff !== undefined) {
      mdastRanges.push({ start: off, end: endOff, node: child });
    }
  }
  if (process.env.NODE_ENV !== 'production') {
    for (let i = 1; i < mdastRanges.length; i++) {
      if (mdastRanges[i].start < mdastRanges[i - 1].start) {
        // Should never trip: mdast.children is source-order. If it does
        // trip, the binary search below is wrong — surface it loudly so
        // we sort defensively rather than silently misroute hast blocks.
        throw new Error(
          'block-memo: mdast.children not sorted by source offset — ' +
            'a remark plugin is reordering top-level children.'
        );
      }
    }
  }
  function findContainingMdast(offset: number): MdastContent | undefined {
    // Upper-bound binary search: find first index where range.start > offset.
    // The candidate is the immediate predecessor (largest start <= offset).
    let lo = 0;
    let hi = mdastRanges.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (mdastRanges[mid].start <= offset) lo = mid + 1;
      else hi = mid;
    }
    const idx = lo - 1;
    if (idx < 0) return undefined;
    const r = mdastRanges[idx];
    // Top-level mdast children have non-overlapping source ranges, so the
    // single largest-start candidate is the unique container (if any).
    return offset < r.end ? r.node : undefined;
  }

  const ctxParts: unknown[] = [];
  // Start offsets of every taint node, in document order — used to tell
  // whether a raw-HTML container swallowed a reference whose RENDERING
  // depends on a definition outside it (see the isRawHtmlBlock branch).
  const taintOffsets: number[] = [];
  /** First index in `taintOffsets` at or after `offset`. The offsets are
   *  pushed by a document-order `visit`, so the array is already sorted —
   *  the same property `findContainingMdast` above relies on. */
  const firstTaintAtOrAfter = (offset: number): number => {
    let lo = 0;
    let hi = taintOffsets.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (taintOffsets[mid] < offset) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  visit(options.contextMdast ?? mdast, (n) => {
    if (!CTX_TYPES.has(n.type)) return;
    const at = n.position?.start?.offset;
    if (at !== undefined) taintOffsets.push(at);
    if (n.type === 'footnoteReference') ctxParts.push(['fr', n.identifier]);
    else if (n.type === 'footnoteDefinition') ctxParts.push(['fd', n.identifier, extractRaw(n, source)]);
    else if (n.type === 'linkReference') ctxParts.push(['lr', n.identifier]);
    else if (n.type === 'imageReference') ctxParts.push(['ir', n.identifier]);
    else if (n.type === 'definition') ctxParts.push(['d', n.identifier, n.url, n.title ?? null]);
  });
  if (process.env.NODE_ENV !== 'production') {
    // A preorder walk yields non-decreasing start offsets on any well-formed
    // tree, and `firstTaintAtOrAfter` is a binary search over exactly that.
    // Same guard, same reason, and the same shape as the one on
    // `mdastRanges`: the env read stays OUT of the per-node path, which cost
    // more than the search saved when it was inside it.
    for (let i = 1; i < taintOffsets.length; i++) {
      if (taintOffsets[i] < taintOffsets[i - 1]) {
        throw new Error(
          'block-memo: taint node start offsets are not source-ordered — ' +
            'a remark plugin is reordering nodes or emitting bad positions.'
        );
      }
    }
  }
  const globalCtx = JSON.stringify(ctxParts);

  const plan: RenderItem[] = [];
  const blocks: BlockInfo[] = [];
  const blockHasts: HastElement[] = [];
  let synthetic: HastElement | undefined;
  // Mirror of the engine's per-chunk footnote counter (customMdastHandlers:
  // one bump per footnoteReference in mdast-util-to-hast's preorder walk):
  // computed ONCE over the mdast in document order, per ref NODE, so the
  // hast-driven block loop below cannot skew it — a range-fallback block
  // resolves several hast siblings to one mdast node (its refs would be
  // counted twice), and refs inside a footnote definition are rendered by
  // the footer AFTER every body ref (never in a body block) — skipped.
  const refLocalCtx = new Map<MdastNodes, readonly [prior: number, rank: number]>();
  {
    const counts = new Map<string, number>();
    const ranks = new Map<string, number>();
    const rankOf = (id: string): number => {
      // A PHANTOM label never enters the engine's footnoteOrder — the
      // coordinated handlers return early for both its definition and its
      // references, and its `footnote-sup` gets no `localNumber` at all. It
      // must not take a rank here either, or the model drifts from the value
      // actually baked into the placeholder: with `[^A]` cross-chunk and
      // `[^B]` local, B's baked number is 1 while A is phantom and 2 once A's
      // definition arrives — and B's rank, counting A both times, stayed 1.
      // Same raw, same position, same rank: the cache served a superscript
      // reading 1 under a footer numbering it 2 (2026-08-20 B2).
      if (phantomFootnotes.has(id)) return -1;
      let rank = ranks.get(id);
      if (rank === undefined) {
        rank = ranks.size;
        ranks.set(id, rank);
      }
      return rank;
    };
    visit(options.contextMdast ?? mdast, (n) => {
      if (n.type === 'footnoteDefinition') {
        // A definition met before the label's first ref can enter the
        // engine's footnoteOrder first (preserveOrphan) — it takes part in
        // the first-appearance rank; its body refs are footer-rendered.
        //
        // Modelled as `preserveOrphan: true` unconditionally, which is not
        // always what the engine does. Deliberate: with orphan protection
        // OFF the two orderings can disagree, but they disagree the SAME way
        // in every frame, and the flag only changes by a prop change — which
        // re-parses the whole pipeline anyway. Phantom status is different:
        // it flips mid-stream, which is what made it a stale-cache bug.
        rankOf(normalizeId(String(n.identifier)));
        return SKIP;
      }
      if (n.type !== 'footnoteReference') return;
      const id = normalizeId(String(n.identifier));
      const prior = counts.get(id) ?? 0;
      refLocalCtx.set(n, [prior, rankOf(id)]);
      counts.set(id, prior + 1);
    });
  }

  for (let i = 0; i < hast.children.length; i++) {
    const hastChild = hast.children[i];

    if (hastChild.type !== 'element') {
      // Top-level non-element child (whitespace text inserted by
      // mdast-util-to-hast between block elements, sanitized comment, …).
      // Render inline without caching to preserve byte-equivalent output.
      const off = hastChild.position?.start.offset;
      const key = off !== undefined ? `inline-${off}` : `inline-i${i}`;
      plan.push({ kind: 'inline', el: hastChild, key });
      continue;
    }

    const el = hastChild;

    if (isFootnoteSection(el)) {
      synthetic = el;
      plan.push({ kind: 'synthetic', el, key: FOOTNOTE_SECTION_KEY });
      continue;
    }
    const hastOffset = el.position?.start.offset;
    if (hastOffset === undefined) {
      // Element without position (synthesized by some plugin) — preserve in
      // document order, rendered as inline (no cache key available).
      plan.push({ kind: 'inline', el, key: `inline-i${i}` });
      continue;
    }

    let mdastNode = mdastByOffset.get(hastOffset);
    let viaRangeFallback = false;

    if (!mdastNode) {
      mdastNode = findContainingMdast(hastOffset);
      viaRangeFallback = mdastNode !== undefined;
    }

    if (!mdastNode) {
      if (process.env.NODE_ENV !== 'production') {
        throw new Error(
          `block-memo: hast block at offset ${hastOffset} has no mdast counterpart. ` +
            `A rehype plugin may have synthesized positions outside source. tagName=${el.tagName}`
        );
      }
      // Production fallback: render inline, no cache.
      plan.push({ kind: 'inline', el, key: `inline-${hastOffset}` });
      continue;
    }

    if (mdastNode.type === 'footnoteDefinition') {
      // Footnote definitions are hoisted into the synthetic section by
      // mdast-util-to-hast — they should not appear as top-level hast blocks
      // in any current plugin chain. If the range fallback ever resolves an
      // unrelated hast block to a footnoteDefinition's mdast source range,
      // preserve it as `inline` rather than silently dropping it (defensive
      // parity with the other no-counterpart fallbacks above).
      plan.push({ kind: 'inline', el, key: `inline-${hastOffset}` });
      continue;
    }

    // Only a raw-HTML block can have foreign content reparented into it by
    // rehype-raw (an unclosed container tag mid-stream); markdown-native
    // blocks derive their whole subtree from their own source range.
    const isRawHtmlBlock = mdastNode.type === 'html' || viaRangeFallback;
    let hasReference = false;
    const swallowed = isRawHtmlBlock ? scanSwallowedSubtree(el) : null;
    const footnoteRefLabels: string[] = [];
    const linkRefLabels: string[] = [];
    const imageRefLabels: string[] = [];
    const footnoteDefLabels: string[] = [];
    const local: [string, number, number][] = [];
    visit(mdastNode, (n) => {
      if (!TAINT_TYPES.has(n.type)) return;
      hasReference = true;
      const id = 'identifier' in n ? normalizeId(String(n.identifier)) : null;
      if (id === null) return;
      if (n.type === 'footnoteReference') {
        footnoteRefLabels.push(id);
        // Refs inside a nested footnote definition have no entry (footer-
        // rendered, not part of this block's output).
        const ctx = refLocalCtx.get(n);
        if (ctx) local.push([id, ctx[0], ctx[1]]);
      } else if (n.type === 'linkReference') linkRefLabels.push(id);
      else if (n.type === 'imageReference') imageRefLabels.push(id);
      else if (n.type === 'footnoteDefinition') footnoteDefLabels.push(id);
      // 'definition' nodes don't carry per-block fingerprint significance
      // (they're metadata, not visible); intentionally not bucketed.
    });
    // Merge what the container swallowed (see scanSwallowedSubtree): the
    // mdast walk above saw only the empty `html` node.
    if (swallowed !== null && swallowed.hasReference) {
      hasReference = true;
      footnoteRefLabels.push(...swallowed.refLabels);
      linkRefLabels.push(...swallowed.linkLabels);
      imageRefLabels.push(...swallowed.imageLabels);
      local.push(...swallowed.local);
    }
    // JSON-encoded: labels may hold any separator character.
    const footnoteRefLocalCtx = local.length > 0 ? JSON.stringify(local) : undefined;
    const swallowedDefCtx =
      swallowed !== null && swallowed.bakedDefs.length > 0 ? JSON.stringify(swallowed.bakedDefs) : undefined;

    const mdastPos = mdastNode.position;
    if (!mdastPos || mdastPos.start?.offset === undefined || mdastPos.end?.offset === undefined) {
      // A third-party remark plugin emitting a half-built position: the
      // block cannot be cached, but the user's content is never silently
      // lost — render it uncached like the other no-counterpart fallbacks
      // above (v2.4.1 review: this path used to drop the hast element).
      plan.push({ kind: 'inline', el, key: `inline-${hastOffset}` });
      continue;
    }

    // Raw-HTML blocks are the only ones rehype-raw can reparent following
    // siblings into (unclosed container tags mid-stream). Two origins:
    // a top-level mdast `html` node, or a block resolved via the
    // range-containment fallback (raw HTML embedded in another node, split
    // into extra hast siblings). Digest their subtree so the cache
    // invalidates when the swallowed extent changes; markdown-native blocks
    // skip the walk (their subtrees derive purely from their own source
    // range, already covered by `raw` + position).
    let hastDigest: string | undefined;
    let swallowedSource: string | undefined;
    let swallowedTaint = false;
    if (isRawHtmlBlock) {
      const d = computeHtmlBlockDigestWithExtent(el, source, mdastPos.end.offset);
      hastDigest = d.digest;
      swallowedSource = source.slice(mdastPos.end.offset, d.maxEnd);
      // Did the container swallow a reference or definition? The hast scan
      // above sees coordinated placeholders and standalone footnote marks,
      // but a STANDALONE link/image reference renders as a plain `<a href>` /
      // `<img src>` — indistinguishable from an inline link. Ask the mdast
      // instead: any taint node whose source offset lies inside the swallowed
      // extent. Without this a definition sitting BEFORE the container (thus
      // outside the digest's `[ownEnd, maxEnd)` hash) could change the
      // rendered href while every cache-key component stayed equal.
      //
      // What this buys, per mode: in STANDALONE mode the flag switches the
      // key to `globalCtx`, which encodes every definition's url/title —
      // strictly stronger. In COORDINATED mode the labels come from the
      // placeholder scan above (every resolvable reference becomes a
      // `cross-chunk-*` element), so this test is belt-and-braces there.
      // `[ownEnd, maxEnd)` mixes offset systems on purpose: `ownEnd` is the
      // MDAST end (where the opening tag stops), `maxEnd` the HAST end
      // (where parse5 closed the element, past everything it swallowed).
      // Half-open at the low end because anything below `ownEnd` is already
      // covered by `raw`, and `maxEnd` erring high only over-taints.
      // Binary search, not a scan: the linear form was O(taint nodes ×
      // raw-HTML blocks) on the streaming hot path, and the sortedness it
      // needs is the same one `findContainingMdast` already assumes
      // (2026-08-20 B5 — measured at 14% of buildBlocks on a document with
      // 200 definitions and 120 containers).
      const first = firstTaintAtOrAfter(mdastPos.end.offset);
      swallowedTaint = first < taintOffsets.length && taintOffsets[first] < d.maxEnd;
    }

    // A standalone link/image reference renders as a plain `<a href>` /
    // `<img src>`, so only the mdast range test above can see it — fold that
    // in now that the extent is known.
    if (swallowedTaint) hasReference = true;

    const info: BlockInfo = {
      raw: extractRaw(mdastNode, source),
      startOffset: mdastPos.start.offset,
      endOffset: mdastPos.end.offset,
      startLine: mdastPos.start.line,
      startColumn: mdastPos.start.column,
      hasReference,
      ...(hastDigest !== undefined ? { hastDigest } : {}),
      ...(swallowedSource !== undefined ? { swallowedSource } : {}),
      ...(swallowed?.hasFootnoteSection ? { containsFootnoteSection: true } : {}),
      ...(hasReference
        ? {
            taintLabels: {
              footnoteRefLabels,
              linkRefLabels,
              imageRefLabels,
              footnoteDefLabels,
              ...(footnoteRefLocalCtx !== undefined ? { footnoteRefLocalCtx } : {}),
              ...(swallowedDefCtx !== undefined ? { swallowedDefCtx } : {}),
            },
          }
        : {}),
    };
    blocks.push(info);
    blockHasts.push(el);
    // render key is keyed off the HAST element's source offset (not the mdast
    // node's), because multi-root raw HTML produces multiple hast siblings
    // that share one mdast `html` node — same `mdastPos.start.offset` for
    // both, which would collide as a render key. Hast positions are unique
    // per element in the rendered tree.
    plan.push({ kind: 'block', el, info, key: `block-${hastOffset}` });
  }

  return { plan, globalCtx, blocks, blockHasts, synthetic };
}

/**
 * Compute a per-block cache fingerprint from the registry slice this block
 * actually depends on (footnote/link/image refs and footnote defs). Two blocks
 * with the same fingerprint render byte-equal output; if any encoded value
 * differs, the block must re-render.
 *
 * Encoding format (deterministic, stable across versions):
 *   `<clobberPrefix>|fn:<L>=<globalNumber>|fl:<[[L,prior,rank]…]>|lr:<L>=<url>|<title>|ir:<L>=<url>|fd:<L>=<canonical>/<refCount>`
 *
 * @param taintLabels - Per-block label dependency footprint (from BlockInfo.taintLabels).
 * @param registry    - Shared cross-chunk registry.
 * @param thisChunkSym- The Symbol of the chunk this rendering belongs to (for canonical-vs-this comparison).
 * @param clobberPrefix - The documentId-derived id prefix; included so href/id changes invalidate.
 */
export function computeBlockFingerprint(
  taintLabels: NonNullable<BlockInfo['taintLabels']>,
  registry: Registry,
  thisChunkSym: symbol,
  clobberPrefix: string
): string {
  const parts: string[] = [clobberPrefix];
  for (const label of taintLabels.footnoteRefLabels) {
    parts.push(`fn:${label}=${registry.globalNumber(label) ?? 'null'}`);
  }
  // Chunk-local occurrence/rank baked into the placeholders (P2-4) — see
  // buildBlocks; JSON-encoded there, so label bytes cannot collide with `|`.
  if (taintLabels.footnoteRefLocalCtx !== undefined) parts.push(`fl:${taintLabels.footnoteRefLocalCtx}`);
  if (taintLabels.swallowedDefCtx !== undefined) parts.push(`sd:${taintLabels.swallowedDefCtx}`);
  // url/title are JSON-encoded so a `|` inside them cannot collide with the
  // part separator (url `a|b` + no title ≡ url `a` + title `b` would be a
  // stale cache hit — v2.4.1 review).
  for (const label of taintLabels.linkRefLabels) {
    const def = registry.resolveLinkDef(label);
    parts.push(`lr:${label}=${def ? JSON.stringify([def.url, def.title ?? null]) : 'null'}`);
  }
  for (const label of taintLabels.imageRefLabels) {
    const def = registry.resolveLinkDef(label);
    parts.push(`ir:${label}=${def ? JSON.stringify([def.url, def.title ?? null]) : 'null'}`);
  }
  for (const label of taintLabels.footnoteDefLabels) {
    const isCanonical = registry.canonicalFootnoteFor(label) === thisChunkSym ? 1 : 0;
    parts.push(`fd:${label}=${isCanonical}/${registry.getRefsForLabel(label)}`);
  }
  return parts.join('|');
}

const PLACEHOLDER_TAGS = new Set(['footnote-sup', 'cross-chunk-link', 'cross-chunk-image']);

/**
 * What a raw-HTML container swallowed, read from the HAST subtree rather
 * than from the container's mdast node — that node is an empty `html` node
 * whose own range says nothing about the reparented siblings, so every
 * mdast-derived taint fact came out empty and the block fell back to the
 * un-fingerprinted cache key (2026-08-19 review r2 P2-8: an equal-length
 * edit BEFORE the container changed a `localOccurrence` baked inside it and
 * the stale subtree stayed cached).
 *
 * Reads what is actually baked into the cached render output: the placeholders'
 * `label` / `localOccurrence` (coordinated), the standalone footnote marks
 * (`a[data-footnote-ref]`), and whether the synthesized footnote section
 * landed inside (see {@link BlockInfo.containsFootnoteSection}).
 */
function scanSwallowedSubtree(el: HastElement): {
  hasReference: boolean;
  refLabels: string[];
  linkLabels: string[];
  imageLabels: string[];
  local: [string, number, number][];
  bakedDefs: [string, string, string | null][];
  hasFootnoteSection: boolean;
} {
  const refLabels: string[] = [];
  const linkLabels: string[] = [];
  const imageLabels: string[] = [];
  const local: [string, number, number][] = [];
  const bakedDefs: [string, string, string | null][] = [];
  let hasReference = false;
  let hasFootnoteSection = false;
  visit(el, 'element', (node: HastElement) => {
    if (isFootnoteSection(node)) {
      hasFootnoteSection = true;
      hasReference = true;
      return;
    }
    const props = (node.properties ?? {}) as Record<string, unknown>;
    if (PLACEHOLDER_TAGS.has(node.tagName)) {
      hasReference = true;
      const identifier = props.identifier ?? props.label;
      const label = identifier === undefined ? null : normalizeId(String(identifier));
      if (label === null) return;
      if (node.tagName === 'footnote-sup') {
        refLabels.push(label);
        // Chunk-local occurrence as BAKED into this placeholder — the exact
        // value a stale cache hit would keep serving.
        const occ = Number(props.localOccurrence);
        const num = Number(props.localNumber);
        local.push([label, Number.isFinite(occ) ? occ : -1, Number.isFinite(num) ? num : -1]);
        return;
      }
      if (node.tagName === 'cross-chunk-link') linkLabels.push(label);
      else imageLabels.push(label);
      // `resolveDef` falls back to the placeholder's BAKED `localUrl` /
      // `localTitle` when the registry has no canonical def — and the
      // fingerprint writes `lr:LABEL=null` in exactly that case, a constant,
      // so the rendered href could change while the key did not. Carry the
      // baked pair SEPARATELY (never folded into the label, which must stay
      // resolvable by `resolveLinkDef` so a canonical change is still
      // tracked) — the same argument that put `footnote-sup`'s occurrence in
      // the footprint; link/image were left asymmetric (oracle review, 2.5.0).
      if (typeof props.localUrl === 'string') {
        bakedDefs.push([label, props.localUrl, typeof props.localTitle === 'string' ? props.localTitle : null]);
      }
      return;
    }
    // Standalone mode bakes footnote numbering into plain marks; their ctx
    // is the whole-document globalCtx, so the flag alone is enough.
    if (node.tagName === 'a' && props.dataFootnoteRef !== undefined) hasReference = true;
  });
  return { hasReference, refLabels, linkLabels, imageLabels, local, bakedDefs, hasFootnoteSection };
}

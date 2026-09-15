/** React node caching for the framework-neutral runtime block plan.
 * Planning and fingerprints are shared; ReactNode ownership and JSX conversion
 * remain local to each renderer. See packages/core/README.md.
 */
import type { Element as HastElement } from 'hast';
import type { ReactNode } from 'react';
import type { Registry } from '@ai-markdown/engine';
import { renderHastSubtree, type Options } from './markdown';
import { isFootnoteSection, hasMdastSource, computeBlockFingerprint, type RenderItem } from '@ai-markdown/core';
export {
  buildBlocks,
  isFootnoteSection,
  hasMdastSource,
  computeHtmlBlockDigest,
  computeHtmlBlockDigestWithExtent,
  computeBlockFingerprint,
} from '@ai-markdown/core';
export type { BlockInfo, RenderItem, BuildBlocksOptions, BuildBlocksResult } from '@ai-markdown/core';

/**
 * Subset of {@link Options} consumed by per-block rendering — i.e. everything
 * except the pipeline plugins (those have already run by the time we reach
 * `renderHastSubtree`). Marked Readonly to discourage callers from mutating
 * the captured options reference between frames.
 */
export interface PostOptions extends Readonly<Options> {
  /** Required for cross-chunk coordination. Provided by AIMarkdownContent
   *  when wrapped in <AIMarkdownDocuments>; undefined in standalone mode. */
  registry?: Registry;
  /** Required when registry is set. Per-chunk Symbol; used by fingerprint
   *  to encode canonical-vs-this comparison. */
  thisChunkSymbol?: symbol;
  /** Required when registry is set. From the document context; entered
   *  into fingerprint so id/href prefix changes invalidate the cache. */
  clobberPrefix?: string;
}

/** Cache entry for one rendered block. */
export interface BlockCacheEntry {
  node: ReactNode;
  /** `globalCtx` digest if the block is tainted, '' otherwise. Sentinel collapses both code paths. */
  ctx: string;
  /** Position triple — must all match for the cached node to be valid. */
  startOffset: number;
  startLine: number;
  startColumn: number;
  /** Mirrors {@link BlockInfo.hastDigest} — must match for raw-HTML blocks
   *  (undefined === undefined for markdown-native blocks). */
  hastDigest?: string;
  /** Exact source from {@link BlockInfo.swallowedSource}; matching hashes
   *  alone cannot establish a raw-HTML block's cache identity. */
  swallowedSource?: string;
  /** Whether the cached node was rendered with the swallowed footnote
   *  section STRIPPED (coordinated mode). Without it in the key the strip
   *  decision is only correct by accident — it happens to co-vary with
   *  `blockCtx` today through a three-link chain (section ⇒ hasReference ⇒
   *  fingerprint path, and a non-empty clobberPrefix). Break any link and a
   *  cached unstripped node would serve after registration: two
   *  `<section data-footnotes>` with colliding li ids (oracle review, 2.5.0). */
  strippedFootnoteSection?: boolean;
}

/** Cache entry for the synthesized footnote section (single slot, keyed by globalCtx). */
export interface FootnoteSectionEntry {
  ctx: string;
  node: ReactNode;
}

/**
 * Per-instance memo state.
 *
 * ## Memory characteristics
 *
 * The cache holds one `ReactNode` reference per live block in the current
 * document plus an optional single slot for the synthesized footnote
 * section. Memory therefore scales linearly with document size, NOT with
 * session duration: every frame's render produces a fresh `next` Cache, and
 * the previous frame's Cache is atomically replaced (orphaned for GC).
 * Blocks that disappear between frames are dropped from the cache the same
 * frame they vanish from the document.
 *
 * For typical AI chat (≤ 1000 blocks per response, individual ReactNode
 * trees in the low-KB range), per-instance memory stays comfortably below
 * ~10 MB. If you build a UI that keeps very long single-document instances
 * alive indefinitely (≥ 10k live blocks), consider mounting on a virtual
 * scroll boundary so blocks above the fold can unmount and release their
 * cached subtrees.
 */
export interface Cache {
  /** raw → bucket of entries indexed by occurrence within the document. */
  blocks: Map<string, BlockCacheEntry[]>;
  /** Synthesized footnote section, if the previous frame produced one. */
  footnoteSection?: FootnoteSectionEntry;
}

/** Build a fresh, empty Cache. */
export function createCache(): Cache {
  return { blocks: new Map() };
}

/** A single rendered output item with its stable React key. */
export interface RenderedItem {
  node: ReactNode;
  key: string;
}

/** A shallow-cloned copy of `el` with any `<section data-footnotes>` in its
 *  subtree removed (see {@link BlockInfo.containsFootnoteSection}). Only the
 *  spine down to each removed node is cloned; every other child keeps its
 *  identity so untouched subtrees stay reference-equal. */
function withoutFootnoteSection(el: HastElement): HastElement {
  const prune = (node: HastElement): HastElement => {
    const kids = node.children;
    let changed = false;
    const next: typeof kids = [];
    for (const child of kids) {
      if (child.type === 'element') {
        if (isFootnoteSection(child)) {
          changed = true;
          continue;
        }
        const pruned = prune(child);
        if (pruned !== child) changed = true;
        next.push(pruned);
        continue;
      }
      next.push(child);
    }
    // `data` must be SHARED with the original, not left undefined on the
    // clone: `buildTransform` stashes the pre-transform URL on
    // `element.data.originalUrls` and recomputes from it, which is what makes
    // urlTransform convergent across re-renders (see the contract note in
    // markdown/Markdown.tsx). With a plain `{...node}` the `data ??= {}` lands
    // on the throwaway clone, the stash dies with it, and the next frame reads
    // the ALREADY-transformed value as the original — a non-idempotent
    // transform compounds (`/x` → `/x?t` → `/x?t?t`). Oracle review of 2.5.0.
    return changed ? { ...node, data: (node.data ??= {}), children: next } : node;
  };
  return prune(el);
}

/** Placeholder tags the coordinated pipeline bakes chunk-local facts into. */
/**
 * Render the document plan with cache lookup + atomic Cache replacement.
 *
 * Cache identity for a `block` item is `(raw, occurrence index within bucket,
 * ctx, position triple, hastDigest, swallowedSource)`. ctx == globalCtx for
 * tainted blocks, '' otherwise (sentinel collapses both paths into one validation). hastDigest
 * is undefined for markdown-native blocks (undefined === undefined passes)
 * and a subtree digest for raw-HTML blocks, so containers that swallowed
 * following siblings mid-stream re-render when the swallowed extent changes.
 * Exact swallowedSource equality prevents a digest collision from reusing
 * stale content; it is checked only after the digest matches.
 *
 * The synthesized footnote section is a single-slot cache keyed by globalCtx.
 * Atomic Cache replacement (`cacheRef.current = next`) ensures stale slots
 * cannot leak across frames: when synthetic disappears in frame T2,
 * `next.footnoteSection` is left undefined and the old node is orphaned with
 * the rest of the previous Cache for GC.
 *
 * `inline` items (top-level whitespace text, sanitized comments, etc.) are
 * rendered every frame without caching — they are typically a single
 * character and would not benefit from memoization.
 */
export function renderBlocksWithCache(
  cacheRef: { current: Cache },
  plan: RenderItem[],
  globalCtx: string,
  postOptions: PostOptions
): RenderedItem[] {
  const prev = cacheRef.current;
  const next: Cache = { blocks: new Map() };
  const rendered: RenderedItem[] = [];

  if (process.env.NODE_ENV !== 'production') {
    for (const item of plan) {
      if (item.kind === 'block' && !hasMdastSource(item.el)) {
        throw new Error(
          'block-memo: block hast child has no position. Did a rehype plugin strip it? ' +
            '(Run positionPropagation.test.ts to verify.)'
        );
      }
    }
  }

  for (const item of plan) {
    if (item.kind === 'inline') {
      rendered.push({
        node: item.el.type === 'text' ? item.el.value : renderHastSubtree(item.el, postOptions),
        key: item.key,
      });
      continue;
    }

    if (item.kind === 'synthetic') {
      // Cross-chunk coordination: in coordinated mode (registry AND this chunk's
      // Symbol registered) the per-chunk local `<section data-footnotes>` is
      // replaced by `<AggregateFootnotesIfLast>` mounted at the end of each
      // document's last chunk. Skip the local synthetic to avoid duplicate
      // footers across chunks.
      //
      // The thisChunkSymbol guard preserves SSR semantics: during
      // `renderToStaticMarkup` useEffect doesn't fire, so the chunk hasn't
      // registered with the registry yet (`thisChunkSymbol` undefined). Falling
      // back to the local footer keeps each chunk's defs visible in the static
      // output — and the placeholders fall back to the same standalone facts
      // (local footnote number, own link def) in exactly this state, so the
      // static output of a wrapped chunk is byte-identical to its standalone
      // render (pinned in `byteEquivalence.test.tsx`), which is what users
      // doing SSR-without-hydration expect.
      if (postOptions.registry && postOptions.thisChunkSymbol) {
        continue;
      }
      // Standalone mode (or SSR pre-registration): cache the local section by
      // globalCtx and render it.
      const cached = prev.footnoteSection;
      let node: ReactNode;
      if (cached && cached.ctx === globalCtx) {
        node = cached.node;
      } else {
        node = renderHastSubtree(item.el, postOptions);
      }
      next.footnoteSection = { ctx: globalCtx, node };
      rendered.push({ node, key: item.key });
      continue;
    }

    // kind === 'block'
    const block = item.info;
    let bucket = next.blocks.get(block.raw);
    if (!bucket) {
      bucket = [];
      next.blocks.set(block.raw, bucket);
    }
    const occ = bucket.length;

    // Same coordinated-mode test as the top-level synthetic skip above
    // (registry + a registered chunk Symbol): under SSR the chunk has not
    // registered yet and the local footer is the right output.
    const stripSection = Boolean(block.containsFootnoteSection && postOptions.registry && postOptions.thisChunkSymbol);

    if (block.hasReference) {
      const useFingerprint =
        postOptions.registry &&
        block.taintLabels &&
        postOptions.thisChunkSymbol &&
        postOptions.clobberPrefix !== undefined;
      const blockCtx = useFingerprint
        ? computeBlockFingerprint(
            block.taintLabels!,
            postOptions.registry!,
            postOptions.thisChunkSymbol!,
            postOptions.clobberPrefix!
          )
        : globalCtx; // fallback: standalone mode pre-v6 behavior

      const entry = prev.blocks.get(block.raw)?.[occ];
      const valid =
        entry !== undefined &&
        entry.ctx === blockCtx &&
        entry.startOffset === block.startOffset &&
        entry.startLine === block.startLine &&
        entry.startColumn === block.startColumn &&
        entry.hastDigest === block.hastDigest &&
        entry.swallowedSource === block.swallowedSource &&
        Boolean(entry.strippedFootnoteSection) === stripSection;

      let node: ReactNode;
      if (valid) {
        node = entry.node; // cache hit: skip everything
      } else {
        // The aggregate footer (AggregateFootnotesIfLast) reconstructs the
        // footnote section from registry state, and the synthetic plan item
        // for a TOP-LEVEL `<section data-footnotes>` is skipped earlier in
        // this loop. A raw-HTML container that swallowed the section is the
        // one case where it is not top level — strip it here, or the
        // document renders the local footer inside the container AND the
        // aggregate one (colliding li ids; r2 P2-9). Standalone renders keep
        // it where the full parse puts it.
        node = renderHastSubtree(stripSection ? withoutFootnoteSection(item.el) : item.el, postOptions);
      }

      bucket.push({
        node,
        ctx: blockCtx,
        startOffset: block.startOffset,
        startLine: block.startLine,
        startColumn: block.startColumn,
        hastDigest: block.hastDigest,
        swallowedSource: block.swallowedSource,
        strippedFootnoteSection: stripSection,
      });
      rendered.push({ node, key: item.key });
      continue;
    }

    // Non-TAINT block: existing cache-by-(raw, occurrence, '', position) path
    {
      const entry = prev.blocks.get(block.raw)?.[occ];
      const valid =
        entry !== undefined &&
        entry.ctx === '' &&
        entry.startOffset === block.startOffset &&
        entry.startLine === block.startLine &&
        entry.startColumn === block.startColumn &&
        entry.hastDigest === block.hastDigest &&
        entry.swallowedSource === block.swallowedSource &&
        Boolean(entry.strippedFootnoteSection) === stripSection;
      const node = valid ? entry.node : renderHastSubtree(item.el, postOptions);
      bucket.push({
        node,
        ctx: '',
        startOffset: block.startOffset,
        startLine: block.startLine,
        startColumn: block.startColumn,
        hastDigest: block.hastDigest,
        swallowedSource: block.swallowedSource,
        strippedFootnoteSection: stripSection,
      });
      rendered.push({ node, key: item.key });
    }
  }

  cacheRef.current = next;
  return rendered;
}

/**
 * Core markdown rendering component.
 *
 * Wraps the local `Markdown` (a vendored fork of react-markdown — see
 * `./markdown/`) with a curated set of remark and rehype plugins for GFM,
 * math/LaTeX, emoji, CJK support, and selectable extra syntax extensions
 * and display optimizations. Plugin selection is driven by the resolved
 * `enginePlugins` internal prop (sealed plugin objects).
 *
 * ## Render strategy
 *
 * Two render paths gated by the resolved `blockMemo` value (default `true`):
 *
 * - **Block-memo path** (`BlockMemoizedRenderer`): the rendered hast is cut
 *   into per-block units and memoized across frames by source identity
 *   (`raw + occurrence + ctx + position triple`). Streaming append where
 *   prior blocks are unchanged skips `toJsxRuntime` + React reconcile for
 *   those blocks.
 *
 * - **Legacy path** (`LegacyRenderer`): the vendored `<Markdown>` is called
 *   directly with no cache. Every render runs the full pipeline; output is
 *   byte-identical to the block-memo path (locked in by
 *   `byteEquivalence.test.tsx`).
 *
 * The branch is at the component-tree level: only one of the two child
 * renderers is mounted at a time, so the disabled path pays no `useRef` /
 * `useMemo` cost from block-memo's bookkeeping. Toggling the option at
 * runtime unmounts one and mounts the other (the discarded path's cache
 * is GC'd).
 *
 * ## Performance contract — block-level memoization
 *
 * For the cache to be effective, props that influence rendered output must
 * be referentially stable across renders. This component stabilizes its own
 * plugin arrays via `useMemo`. The outer `<AIMarkdown>` stabilizes
 * `customComponents` at its stability firewall. If you wire
 * `<AIMarkdownContent>` directly, ensure `customComponents` is memoized at
 * the call site.
 *
 * @module components/MarkdownContent
 */

import { Fragment, memo, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Markdown, { defaultUrlTransform, type Options as MarkdownOptions } from './markdown';

type RemarkPlugins = NonNullable<MarkdownOptions['remarkPlugins']>;
type RehypePlugins = NonNullable<MarkdownOptions['rehypePlugins']>;
type RemarkRehypeOptions = NonNullable<MarkdownOptions['remarkRehypeOptions']>;
import { sanitizeSchema } from '@ai-markdown/engine';
import { createBlockPlanner } from './blockPlanner';
import { createCache, renderBlocksWithCache, type Cache, type PostOptions } from './blockMemo';
import { buildCoreRehypePlugins, buildCoreRemarkPlugins, buildCoreRemarkRehypeOptions } from '@ai-markdown/engine';
import {
  createPipelineSession,
  derivePhantomTargets,
  deriveCoordinationPolicy,
  buildContributionChain,
  type CoordinationPolicy,
} from '@ai-markdown/core';
import { measureStage } from '@ai-markdown/engine';
import { useAIMarkdownDocument, useAIMarkdownState } from '../context';
import { useProvenanceCredential } from './provenance';
import { deriveTailSignal } from './streamingCursor/tailSignal';
import { AIMarkdownCustomComponents } from '../defs';
import type { AIMarkdownEnginePlugin } from '@ai-markdown/engine';
import { collectDefLabels, createDefLabelScanner, type DefLabelScanner } from '@ai-markdown/engine';
import { useDocumentRegistry, usePreserveOrphanReferences } from './AIMarkdownDocuments';
import type { RegistryController } from '@ai-markdown/engine';
import type { SanitizeSchema } from '@ai-markdown/engine';
import { crossChunkComponents, isHydratingServerHtml } from './crossChunkPlaceholders';
import { CrossChunkUrlContext, type CrossChunkUrlPolicy } from './crossChunkUrlContext';
import { AggregateFootnotesIfLast } from './aggregateFootnotesIfLast';
import { ChunkSymbolContext } from './chunkSymbolContext';
import { useRegistryContribution } from './useRegistryContribution';

/** Server snapshot of the registry-version store. A live registry's
 *  `version` counts up from 0, so this value is observed only without a
 *  registry (standalone mode, where the client snapshot returns it too so
 *  hydration needs no extra re-render), on the server, and during the
 *  hydration render of server HTML. The hydration case is the reason the
 *  value is inspected rather than ignored: see `isHydratingServerHtml` in
 *  crossChunkPlaceholders.tsx. Hoisted to module level so the getter's
 *  identity is stable across renders. */
const REGISTRY_SERVER_VERSION = -1;
const getRegistryServerVersion = () => REGISTRY_SERVER_VERSION;

/** Stable empty object to avoid unnecessary re-renders when no custom components are given. */
const DefaultCustomComponents: AIMarkdownCustomComponents = {};

/** Stable empty result for the PASS 0 def-label scan in standalone mode
 *  (no registry). One shared frozen instance so `ownLabels` keeps the same
 *  identity across every render — downstream effects and memos that list it
 *  as a dep never churn while uncoordinated. */
const EMPTY_DEF_LABELS: ReturnType<typeof collectDefLabels> = Object.freeze({
  footnoteLabels: new Set<string>(),
  linkLabels: new Set<string>(),
});

interface AIMarkdownContentProps {
  /** Preprocessed markdown string to render. */
  content: string;
  /** Optional react-markdown component overrides (e.g. custom code block renderer). */
  customComponents?: AIMarkdownCustomComponents;
  /** This chunk's position in the document — see the `documentIndex` prop
   *  on `<AIMarkdown>`. Undefined keeps registration in mount order. */
  documentIndex?: number;
  /**
   * Optional URL transform applied during the hast pipeline. When omitted,
   * the vendored Markdown wrapper falls back to its built-in
   * `defaultUrlTransform` (https/mailto/etc. allowlist).
   */
  urlTransform?: MarkdownOptions['urlTransform'];
  /**
   * Optional `rehype-sanitize` schema. When omitted, the library default
   * is used (not publicly exported as a value — see
   * {@link extendSanitizeSchema}). Callers should produce this via
   * {@link extendSanitizeSchema} to avoid silently dropping the cross-chunk
   * tag allowlist.
   */
  sanitizeSchema?: SanitizeSchema;
  // ── Resolved engine values ──
  // Passed field-by-field from `<AIMarkdown>`'s single resolution point.
  /** Renderer dispatch: block-memo path (`true`) vs legacy path (`false`). */
  blockMemo: boolean;
  /** Incremental (prefix-freeze) parse gate. */
  incrementalParse: boolean;
  /** Orphan-reference policy (standalone mode; `<AIMarkdownDocuments>` overrides via its own chain). */
  preserveOrphanReferences: boolean;
  /** Resolved sealed-plugin selection (sanitized; absent prop already defaulted upstream). */
  enginePlugins: readonly AIMarkdownEnginePlugin[];
}

interface RendererProps {
  content: string;
  /** This chunk's position in the document — see the `documentIndex` prop
   *  on `<AIMarkdown>`. Undefined keeps registration in mount order. */
  documentIndex?: number;
  usedComponents: AIMarkdownCustomComponents;
  remarkPlugins: RemarkPlugins;
  rehypePlugins: RehypePlugins;
  remarkRehypeOptions: RemarkRehypeOptions;
  urlTransform: MarkdownOptions['urlTransform'];
  /** Incremental-parse gate (resolved). */
  incrementalParse: boolean;
  /** Resolved orphan-reference policy (standalone tier of the override chain). */
  preserveOrphanReferences: boolean;
  /**
   * Whether the definition-list plugin is in the active chain. Feeds the
   * boundary scanner's syntax awareness (`computeFreezeBoundary`'s
   * `defListEnabled`) — the scanner must know the boundary rules of every
   * active multiline construct.
   */
  defListEnabled: boolean;
  /** Resolved sanitize schema. Propagated to cross-chunk placeholders via
   *  {@link CrossChunkUrlContext} so they can apply the same `protocols.*`
   *  allowlist that `rehype-sanitize` applies to in-tree `<a>`/`<img>` —
   *  see `crossChunkUrlSanitize.ts` for why this must happen at render
   *  time rather than at contribute time. */
  sanitizeSchema: SanitizeSchema;
  /** Per-instance provenance credential (see `./provenance`). Stamped by the
   *  cross-chunk handlers through the remark-rehype options and checked by
   *  the verifier `buildCoreRehypePlugins` installed with the same value. */
  provenance: string;
}

/**
 * Block-memo render path. Mounted when the resolved `blockMemo` is `true`.
 * Encapsulates the `useRef`-backed cache, G3 sync flush, and the three-stage
 * unified pipeline (parse → transform → buildBlocks → renderBlocksWithCache).
 */
const BlockMemoizedRenderer = memo(
  ({
    content,
    documentIndex,
    usedComponents,
    remarkPlugins,
    rehypePlugins,
    remarkRehypeOptions,
    urlTransform,
    sanitizeSchema: usedSanitizeSchema,
    incrementalParse,
    preserveOrphanReferences,
    defListEnabled,
    provenance,
  }: RendererProps) => {
    // Vendored Markdown options that AIMarkdown does not currently expose. They
    // are tracked in the G3 flush below so the cache stays correct if any of
    // these are ever surfaced upstream. `urlTransform` is now a real prop —
    // the remaining five are still internal `undefined`.
    const allowedElements: MarkdownOptions['allowedElements'] = undefined;
    const disallowedElements: MarkdownOptions['disallowedElements'] = undefined;
    const allowElement: MarkdownOptions['allowElement'] = undefined;
    const skipHtml: MarkdownOptions['skipHtml'] = undefined;
    const unwrapDisallowed: MarkdownOptions['unwrapDisallowed'] = undefined;

    // ─── Cross-chunk coordination wiring (Phase 11) ──────────────────────────
    // All effects below are NO-OP when `registry === null` (standalone mode
    // without `<AIMarkdownDocuments>`): the gating is on `registry` truthiness.
    const { documentId, documentIdExplicit, clobberPrefix } = useAIMarkdownDocument();
    const reactId = useId();
    // The runtime value behind `useDocumentRegistry` is always a
    // `RegistryController` (see `createRegistry`); the public hook narrows
    // the return type to `Registry` so external consumers don't see the
    // mutator methods. Here — the canonical internal coordinator — we
    // widen back to `RegistryController` once at the top so subsequent
    // mutator calls (`registerChunk`, `releaseSymbol`, `contributeChunkData`)
    // type-check without scattered `as` casts.
    const registry = useDocumentRegistry(documentId, documentIdExplicit) as RegistryController | null;
    // Allocate-and-publish state: the Symbol for THIS chunk PAIRED with the
    // registry it was allocated from. Modelling as state — instead of a
    // ref — makes both fields real deps for downstream effects, so React's
    // dep system (not microtask FIFO) enforces "allocate before contribute"
    // ordering.
    //
    // Why the registry is bundled with sym: a parent that re-renders with a
    // different `documentId` (read from context) causes `registry` to flip
    // to a NEW Registry instance on the next render. React retains state
    // across that render, so `sym` still holds the OLD registry's Symbol
    // until Effect 1's cleanup runs and clears it. If Effect 2 reads `sym`
    // directly during that gap, it contributes the stale Symbol into the
    // NEW registry — polluting `chunkData` with an unowned entry that
    // `onEmpty`'s `chunkData.size === 0` check never sees as gone, leaking
    // the registry. Storing the registry alongside the sym lets Effect 2
    // gate on `allocation.registry === registry` and skip the stale tick.
    const [allocation, setAllocation] = useState<{ registry: RegistryController; sym: symbol } | null>(null);
    const sym = allocation && allocation.registry === registry ? allocation.sym : null;

    // Subscribe to registry version changes. Without this, useMemo deps that
    // include the registry version would never re-evaluate — useMemo only re-
    // runs when its component re-renders, and a version bump from another
    // chunk's contribute step doesn't trigger our re-render on its own.
    // useSyncExternalStore's subscribe handle does the wake-up: when any
    // chunk calls registry._notify, every subscribed renderer re-renders,
    // PASS 0.5 picks up new labelSet entries, PASS 1 augments + re-parses,
    // placeholder hast tags emerge, and the placeholder components (which
    // also useSyncExternalStore) resolve their numbers/URLs.
    // Subscribe identity must be stable across renders — useSyncExternalStore
    // resubscribes whenever `subscribe` changes identity, so an inline
    // `(cb) => ...` would trigger unsubscribe+resubscribe on every render.
    // For N coordinated chunks each waking on every notify, that's O(N²)
    // subscriber-list churn during initial mount.
    const subscribeRegistry = useCallback(
      (cb: () => void) => (registry ? registry.subscribe(cb) : () => {}),
      [registry]
    );
    const getRegistryVersion = useCallback(() => (registry ? registry.version : REGISTRY_SERVER_VERSION), [registry]);
    // The returned snapshot, not `registry.version`, is what this render may
    // act on: during hydration it is the server value even though the live
    // counter has moved on (see REGISTRY_SERVER_VERSION).
    const registryVersion = useSyncExternalStore(subscribeRegistry, getRegistryVersion, getRegistryServerVersion);
    // Registry state readable in this render: null while hydrating server
    // HTML, so a late-hydrating boundary parses with the same (absent)
    // phantom targets the server had. `registry` itself stays the
    // coordination switch (handlers, registration, contribution) so the
    // hydration render still emits the same placeholder tags as the server.
    const readableRegistry = isHydratingServerHtml(registryVersion === REGISTRY_SERVER_VERSION) ? null : registry;

    // PASS 0: def-label scan, then publish to registry.labelSet.
    //
    // Coordinated mode ONLY. Despite the "lightweight" framing in
    // collectDefLabels' docs, it is a full second remark-parse of the
    // content (def-only pipeline, but parsing is parsing), and every
    // consumer of `ownLabels` — the register effect below, targetPhantoms,
    // the contribute effect — no-ops without a registry. Running it in
    // standalone mode doubles the per-token parse cost of a streaming
    // render for output nobody reads (measured at ~1/3 of total commit
    // time on the BlockMemoCompare story). Skip it entirely and hand back
    // a stable empty result so downstream deps never churn.
    //
    // Coordinated mode goes through an append-aware scanner: while a token
    // stream appends prose that can't contain a definition, the previous
    // result is returned by REFERENCE — no re-parse, and the register
    // effect below (which lists `ownLabels` as a dep) stops re-registering
    // the chunk on every token. When a definition MAY be present, the
    // scanner freezes the settled prefix at an engine-verified boundary and
    // re-parses only the live tail. It stays convergent — equal to a full
    // parse at every step, with non-append input resetting all cached
    // state — so StrictMode double-invokes and aborted renders can't
    // poison it.
    const defScannerRef = useRef<DefLabelScanner | null>(null);
    const ownLabels = useMemo(() => {
      if (!registry) return EMPTY_DEF_LABELS;
      const scanner = (defScannerRef.current ??= createDefLabelScanner({ math: true }));
      return scanner.scan(content ?? '');
    }, [content, registry]);

    useEffect(() => {
      if (!registry) return;
      const s = registry.registerChunk(reactId, ownLabels.footnoteLabels, ownLabels.linkLabels, documentIndex);
      setAllocation({ registry, sym: s });
      return () => {
        registry.releaseSymbol(reactId);
        setAllocation(null);
      };
    }, [reactId, registry, ownLabels, documentIndex]);

    // G3 — synchronous deps-diff flush. Discards the per-block cache when any
    // option that affects rendered output (but not parse output) changes
    // identity. The check runs synchronously at the top of render: an
    // `useEffect` would only fire after commit, by which time the current
    // render has already read from the (now stale) cache and emitted incorrect
    // output. The cache is best-effort memoization across renders, not state
    // the UI depends on for correctness — concurrent render aborts are safe
    // because (a) cache hits return identical node references, and (b) cache
    // misses always recompute from inputs that are themselves pure.
    //
    // Cache-memoization pattern documented above is an established exception
    // to the React Compiler purity check (rule renamed across react-hooks
    // plugin versions, so the previous block disable no longer suppresses
    // anything in v7+). See design `/tmp/phase5-block-memo-decisions.md` §4.
    // Every stage measurement in this component MUST carry this instance's
    // documentId — a stageInstanceId-scoped subscriber silently drops
    // unattributed emissions (the panel then shows "0 ms ×0", which reads
    // as "stage never ran"). The bound wrapper makes forgetting impossible
    // at call sites; do not call the bare measureStage here.
    const measureHere = useCallback(
      <T,>(stage: Parameters<typeof measureStage>[0], fn: () => T): T => measureStage(stage, fn, documentId),
      [documentId]
    );

    const cacheRef = useRef<Cache>(createCache());
    const [planBlocks] = useState(createBlockPlanner);
    // Incremental-parse state (previous frame's content + post-transform
    // trees + verified freeze boundary). Render-phase ref mutation, same
    // pattern as `defScannerRef`/`cacheRef`. Cleared by the G3 flush below
    // (belt-and-suspenders — the engine's own depsKey gate, which covers
    // MORE inputs than G3's 12 fields, is the primary invalidation).
    const [pipelineSession] = useState(createPipelineSession);
    const depsRef = useRef<{
      usedComponents: typeof usedComponents;
      remarkPlugins: typeof remarkPlugins;
      rehypePlugins: typeof rehypePlugins;
      remarkRehypeOptions: typeof remarkRehypeOptions;
      urlTransform: typeof urlTransform;
      allowedElements: typeof allowedElements;
      disallowedElements: typeof disallowedElements;
      allowElement: typeof allowElement;
      skipHtml: typeof skipHtml;
      unwrapDisallowed: typeof unwrapDisallowed;
      registry: RegistryController | null;
      symbol: symbol | null;
    }>({
      usedComponents,
      remarkPlugins,
      rehypePlugins,
      remarkRehypeOptions,
      urlTransform,
      allowedElements,
      disallowedElements,
      allowElement,
      skipHtml,
      unwrapDisallowed,
      registry,
      symbol: sym,
    });
    if (
      depsRef.current.usedComponents !== usedComponents ||
      depsRef.current.remarkPlugins !== remarkPlugins ||
      depsRef.current.rehypePlugins !== rehypePlugins ||
      depsRef.current.remarkRehypeOptions !== remarkRehypeOptions ||
      depsRef.current.urlTransform !== urlTransform ||
      depsRef.current.allowedElements !== allowedElements ||
      depsRef.current.disallowedElements !== disallowedElements ||
      depsRef.current.allowElement !== allowElement ||
      depsRef.current.skipHtml !== skipHtml ||
      depsRef.current.unwrapDisallowed !== unwrapDisallowed ||
      depsRef.current.registry !== registry ||
      depsRef.current.symbol !== sym
    ) {
      cacheRef.current = createCache();
      pipelineSession.reset();
      depsRef.current = {
        usedComponents,
        remarkPlugins,
        rehypePlugins,
        remarkRehypeOptions,
        urlTransform,
        allowedElements,
        disallowedElements,
        allowElement,
        skipHtml,
        unwrapDisallowed,
        registry,
        symbol: sym,
      };
    }

    // PASS 0.5: which labels does this chunk reference that are defined
    // elsewhere? Substring over-approximation: normalize content (resolve \X +
    // ws-collapse + uppercase) and check against the registry's union labelSet.
    // labelSet entries are already normalized; any standard ref form contains
    // the label as substring after normalization. False-positive (wasted
    // reparse) acceptable; false-negative for backslash-escaped / multi-line
    // whitespace labels accepted as v1 limit.
    //
    // Stable reference: every `registry._notify` (3× per chunk on mount: alloc,
    // contributeLabels, contributeChunkData) bumps `registry.version`, which
    // reaches this memo as the `registryVersion` snapshot dep. Without ref-
    // stability, every bump produces fresh Set instances → `pipeline` useMemo
    // invalidates → full re-parse runs. With N chunks coordinating, that's
    // O(N²) parses at mount and a visible white screen for 30+ chunks. We
    // compare the freshly-computed Sets to the previous result via a ref and
    // return the previous reference when the contents are identical —
    // collapsing the cascade to one parse per chunk.
    //
    // `labels` comes from `readableRegistry`: null while hydrating, so that
    // render parses with no phantoms exactly like the server did, whatever
    // the live registry already holds.
    const targetPhantomsRef = useRef<{ missingFootnotes: Set<string>; missingLinks: Set<string> }>({
      missingFootnotes: new Set<string>(),
      missingLinks: new Set<string>(),
    });
    const targetPhantoms = useMemo(() => {
      const next = derivePhantomTargets(
        { content: content ?? '', ownLabels, labels: readableRegistry?.labelSet ?? null },
        targetPhantomsRef.current
      );
      targetPhantomsRef.current = next;
      return next;
      // registryVersion is the freshness anchor (subscribe in placeholder components handles re-render)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [readableRegistry, registryVersion, content, ownLabels]);

    const effectivePreserveOrphan = usePreserveOrphanReferences(preserveOrphanReferences);
    // In coordinated client renders, def-only chunks may be referenced by
    // other chunks even when visible orphan rendering is disabled. Once this
    // chunk has a Symbol, keep real defs in the synthetic footer so
    // extractDefBodiesFromHast can harvest their post-pipeline bodyHast; the
    // aggregate footer below still uses effectivePreserveOrphan to decide
    // whether unreferenced defs are visible.
    const previousPolicy = useRef<CoordinationPolicy | undefined>(undefined);
    const { handlers, preserveForBodyHarvest } = useMemo(() => {
      const next = deriveCoordinationPolicy(
        { coordinated: Boolean(registry), registered: Boolean(sym), preserveOrphanReferences: effectivePreserveOrphan },
        previousPolicy.current
      );
      previousPolicy.current = next;
      return next;
    }, [registry, sym, effectivePreserveOrphan]);
    // G3 supplement: the orphan policy is a to-hast input (footnote handler +
    // `preserveOrphan` option) that changes footer membership AND body sup
    // numbering without touching the mdast the block-memo ctx is derived
    // from — so a runtime flip left the synthetic footer slot (keyed by
    // globalCtx alone) and reference-bearing blocks serving stale nodes
    // (2026-08 project review, core-render-03). Flush the block cache when
    // it flips; the incremental engine's own depsKey already covers it.
    // Render-phase ref mutation, same pattern as the G3 block above.
    const preserveOrphanDepRef = useRef(preserveForBodyHarvest);
    if (preserveOrphanDepRef.current !== preserveForBodyHarvest) {
      cacheRef.current = createCache();
      preserveOrphanDepRef.current = preserveForBodyHarvest;
    }

    // Runtime selects coordinated handlers, orphan-only handling or normal
    // standalone semantics. React owns policy memoization and commit timing.

    // Stage 1 + 2: parse → run remark/rehype pipeline, as ONE memo returning
    // `{ mdast, hast }`. Merged (formerly separate `parsed`/`hast` memos)
    // because the incremental-parse engine owns both stages: on a splice it
    // reuses the frozen prefix of the previous frame's post-transform trees
    // and runs parse+transform over the tail only.
    const pipeline = useMemo(
      () =>
        pipelineSession.parse({
          content: content ?? '',
          targetPhantoms,
          remarkPlugins,
          rehypePlugins,
          remarkRehypeOptions,
          handlers,
          preserveForBodyHarvest,
          documentId,
          provenance,
          incrementalParse: incrementalParse && typeof window !== 'undefined',
          defListEnabled,
          measure: measureHere,
        }),
      [
        pipelineSession,
        content,
        targetPhantoms,
        remarkPlugins,
        rehypePlugins,
        remarkRehypeOptions,
        handlers,
        preserveForBodyHarvest,
        documentId,
        provenance,
        incrementalParse,
        defListEnabled,
        measureHere,
      ]
    );

    // Cut hast into per-block units indexed back to mdast for cache identity,
    // and compute the document-wide ctx digest for cross-block invalidation.
    const built = useMemo(
      () =>
        measureHere('build', () =>
          planBlocks(pipeline.mdast, pipeline.hast, content ?? '', {
            // The block cache's footnote rank models `state.footnoteOrder`,
            // which phantom labels never enter (2026-08-20 B2). Identity is
            // stable across renders whose phantom sets match, so this does
            // not defeat the memo.
            phantomFootnoteLabels: targetPhantoms.missingFootnotes,
          })
        ),
      [pipeline, content, measureHere, targetPhantoms, planBlocks]
    );

    // Streaming-cursor tail signal: classify whether the source tail sits
    // inside a (footnote / link-reference) definition — derived from the
    // SAME mdast this render draws, with phantom-suffix nodes filtered by
    // offset against the preprocessed content. Only computed while
    // streaming: the marker it drives must not exist in static documents
    // (see the marker's own comment in the render tail). The legacy
    // (blockMemo:false) path has no pipeline mdast and renders no marker —
    // the cursor keeps today's body-tail behavior there.
    const { streaming } = useAIMarkdownState();
    const tailSignal = useMemo(
      () => (streaming ? deriveTailSignal(pipeline.mdast, (content ?? '').length) : null),
      [streaming, pipeline, content]
    );

    const postOptions = useMemo<PostOptions>(
      () => ({
        components: { ...crossChunkComponents, ...usedComponents },
        urlTransform,
        allowedElements,
        disallowedElements,
        allowElement,
        skipHtml,
        unwrapDisallowed,
        // v6 fingerprint cache fields:
        registry: registry ?? undefined,
        thisChunkSymbol: sym ?? undefined,
        clobberPrefix,
      }),
      // `sym` is now real state (setSym after allocateSymbol), so it's a
      // proper dep and postOptions refreshes when allocation completes.
      // `registryVersion` stays in deps so the per-block fingerprint cache
      // path sees the latest registry version on every coordinated update.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [
        usedComponents,
        urlTransform,
        allowedElements,
        disallowedElements,
        allowElement,
        skipHtml,
        unwrapDisallowed,
        registry,
        registryVersion,
        sym,
        clobberPrefix,
      ]
    );

    const contributionChain = useMemo(
      () =>
        buildContributionChain({
          remarkPlugins,
          rehypePlugins,
          remarkRehypeOptions,
          handlers,
          preserveForBodyHarvest,
          clobberPrefix,
          documentId,
          provenance,
        }),
      [
        remarkPlugins,
        rehypePlugins,
        remarkRehypeOptions,
        handlers,
        preserveForBodyHarvest,
        clobberPrefix,
        documentId,
        provenance,
      ]
    );
    useRegistryContribution({
      pipeline,
      ownLabels,
      registry,
      targetPhantoms,
      sym,
      clobberPrefix,
      chain: contributionChain,
    });

    // Intentional cache memoization via cacheRef; see G3 comment above.
    // Unlike the three memoized stages above, this runs on EVERY render —
    // its 'render' measures therefore include the cheap all-cache-hit
    // re-renders, which is the honest shape of what block-memo saves.
    const rendered = measureHere('render', () =>
      renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, postOptions)
    );

    // Cross-chunk URL sanitization policy — read by `CrossChunkLink` and
    // `CrossChunkImage` at render time to apply schema, hash rebasing and
    // urlTransform in the order that the standalone in-tree pass
    // applies. Resolved here so the same `defaultUrlTransform` /
    // `sanitizeSchema` fallbacks the rest of the pipeline uses are honored
    // — no chance of drift between standalone and cross-chunk paths.
    const crossChunkUrlPolicy = useMemo<CrossChunkUrlPolicy>(
      () => ({
        urlTransform: urlTransform || defaultUrlTransform,
        sanitizeSchema: usedSanitizeSchema,
        components: usedComponents,
      }),
      [urlTransform, usedSanitizeSchema, usedComponents]
    );

    // React keys come from buildBlocks:
    //   - `block-${hastOffset}` for cacheable blocks (the hast element's own
    //     source offset, NOT the mdast offset — this is what makes multi-root
    //     raw HTML produce unique keys when two hast siblings share one mdast
    //     html node)
    //   - `__footnote_section__` for the synthetic footnote section (fixed
    //     literal lets its fiber state survive toggle T1→T2→T3)
    //   - `inline-${offset}` for top-level whitespace / sanitized comments,
    //     falling back to `inline-i${planIndex}` if the inline has no position
    // In coordinated mode, the per-chunk synthetic `<section data-footnotes>`
    // is suppressed by renderBlocksWithCache (postOptions.registry present).
    // Render the aggregate footer here so it sits at the end of the LAST
    // chunk's output. The component is a no-op when this chunk is not last.
    return (
      <CrossChunkUrlContext.Provider value={crossChunkUrlPolicy}>
        <ChunkSymbolContext.Provider value={sym}>
          {rendered.map(({ node, key }) => (
            <Fragment key={key}>{node}</Fragment>
          ))}
          {registry && sym ? (
            <AggregateFootnotesIfLast
              registry={registry}
              thisChunkSym={sym}
              clobberPrefix={clobberPrefix}
              postOptions={postOptions}
              preserveOrphanReferences={effectivePreserveOrphan}
            />
          ) : null}
          {tailSignal ? (
            // Streaming-cursor tail marker: tells the cursor shell (same
            // commit as the content DOM it will measure — no React timing
            // skew) that the source tail is inside a definition, and which
            // footer <li> the text is streaming into. Rendered ONLY while
            // streaming with a definition tail: a permanent marker would
            // re-break the `:last-child` margin-trim fallbacks the SCSS
            // keeps for pre-Baseline-2023 engines (the modern rulesets
            // exclude it explicitly, same as the cursor wrapper). display:
            // none keeps it out of layout; the anchor walk skips it by
            // attribute. Mount/unmount on signal flips doubles as the
            // childList mutation that wakes the shell's observer.
            <span
              data-aimd-tail-kind={tailSignal.kind}
              data-aimd-tail-label={tailSignal.kind === 'footnote-def' ? tailSignal.identifier : undefined}
              data-aimd-clobber-prefix={tailSignal.kind === 'footnote-def' ? clobberPrefix : undefined}
              style={{ display: 'none' }}
            />
          ) : null}
        </ChunkSymbolContext.Provider>
      </CrossChunkUrlContext.Provider>
    );
  }
);
BlockMemoizedRenderer.displayName = 'BlockMemoizedRenderer';

/**
 * Legacy render path. Mounted when the resolved `blockMemo` is `false`.
 * Calls the vendored `<Markdown>` directly — every render runs the full
 * pipeline end-to-end with no cross-frame reuse. Output is byte-identical
 * to the block-memo path in standalone mode (validated by
 * `byteEquivalence.test.tsx`), INCLUDING the orphan-reference policy: the
 * standalone `footnoteDefinition` handler is merged here exactly as the
 * block-memo path does it, so `blockMemo` stays output-invariant (it was
 * not — a def arriving before its reference vanished from the footer only
 * on this path; 2026-08 project review, core-render-04).
 *
 * **Cross-chunk coordination (Phase 11) is NOT wired through this path.**
 * Wrapping `<AIMarkdown>` with `<AIMarkdownDocuments>` while keeping
 * `blockMemo: false` silently runs without coordination — refs across
 * chunks don't resolve (orphan defs ARE still protected, per the wrapper/
 * prop/default override chain). If you need cross-chunk behavior, keep
 * `blockMemo: true` (the default).
 */
const LegacyRenderer = memo(
  // `sanitizeSchema` is accepted (and ignored) here purely for prop-shape
  // parity with `BlockMemoizedRenderer` — legacy mode skips cross-chunk
  // coordination entirely, so there's no placeholder needing the schema.
  // Rebind to an underscore-prefixed local so the project's
  // no-unused-vars rule (which allows `_`-prefixed names) accepts it.
  ({
    content,
    usedComponents,
    remarkPlugins,
    rehypePlugins,
    remarkRehypeOptions,
    urlTransform,
    preserveOrphanReferences,
    sanitizeSchema: _sanitizeSchema,
    provenance,
  }: RendererProps) => {
    const effectivePreserveOrphan = usePreserveOrphanReferences(preserveOrphanReferences);
    const { documentId } = useAIMarkdownDocument();
    // Same merge as the block-memo path's standalone branch: only the
    // footnoteDefinition handler (the other three depend on a registry and
    // would emit placeholders that render nothing here); phantom sets are
    // empty so the handler's phantom check is always false.
    const mergedRemarkRehypeOptions = useMemo<RemarkRehypeOptions>(() => {
      if (!effectivePreserveOrphan) return remarkRehypeOptions;
      const { handlers } = deriveCoordinationPolicy({
        coordinated: false,
        registered: false,
        preserveOrphanReferences: true,
      });
      return {
        ...remarkRehypeOptions,
        handlers: { ...(remarkRehypeOptions?.handlers ?? {}), ...handlers },
        phantomFootnoteLabels: new Set<string>(),
        phantomLinkLabels: new Set<string>(),
        preserveOrphan: true,
        documentId,
        provenance,
      } as RemarkRehypeOptions;
    }, [remarkRehypeOptions, effectivePreserveOrphan, documentId, provenance]);
    return (
      <Markdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        remarkRehypeOptions={mergedRemarkRehypeOptions}
        components={usedComponents}
        urlTransform={urlTransform}
      >
        {content}
      </Markdown>
    );
  }
);
LegacyRenderer.displayName = 'LegacyRenderer';

/**
 * Internal component that assembles the remark/rehype plugin chain based on
 * the resolved engine values (received as internal props from
 * `<AIMarkdown>`'s single resolution point), then dispatches to either the
 * block-memo renderer or the legacy renderer based on `blockMemo`.
 */
const AIMarkdownContent = memo(
  ({
    content,
    documentIndex,
    customComponents,
    urlTransform,
    sanitizeSchema: customSanitizeSchema,
    blockMemo,
    incrementalParse,
    preserveOrphanReferences,
    enginePlugins,
  }: AIMarkdownContentProps) => {
    const { clobberPrefix } = useAIMarkdownDocument();
    // One provenance credential per mounted instance (see ./provenance for
    // why it is a lazy state initialiser and not a ref or a memo).
    const provenance = useProvenanceCredential().value;
    // Dev-mode flip probes live in the parent `<AIMarkdown>`'s stability
    // firewall (`useStableRecord`, `./../index.tsx`) — the DEEP_EQUAL policy
    // there both warns on identity churn and restores the previous reference.
    // Don't add a duplicate probe here.
    // Resolve schema: caller-provided override (from `extendSanitizeSchema(...)`
    // or a hand-rolled Schema) wins; otherwise the library default. Reference
    // identity is preserved by the parent's firewall, so this picks one of two
    // stable references rather than minting a new object every render —
    // important for the rehypePlugins memo below.
    const usedSanitizeSchema = customSanitizeSchema ?? sanitizeSchema;

    const enableDefinitionList = enginePlugins.some((plugin) => plugin.name === 'definitionList');

    const usedComponents = useMemo(() => {
      return customComponents ? { ...DefaultCustomComponents, ...customComponents } : DefaultCustomComponents;
    }, [customComponents]);

    // Stable plugin/options arrays so this component's React.memo wrapper can
    // skip re-renders when only the parent re-rendered. The vendored
    // `parseStage` rebuilds the unified processor on every call regardless —
    // there is no internal processor cache to feed.
    // Chain assembly lives in pluginChain.ts — the single source shared with
    // the splice-equivalence arbiter and the prefixFreeze experiment harness,
    // so verification suites can never drift from the shipped order.
    const remarkPlugins = useMemo<RemarkPlugins>(() => buildCoreRemarkPlugins(enginePlugins), [enginePlugins]);

    const rehypePlugins = useMemo<RehypePlugins>(
      () => buildCoreRehypePlugins(usedSanitizeSchema, clobberPrefix, { provenance }),
      [clobberPrefix, usedSanitizeSchema, provenance]
    );

    const remarkRehypeOptions = useMemo<RemarkRehypeOptions>(
      () => buildCoreRemarkRehypeOptions(enableDefinitionList),
      [enableDefinitionList]
    );

    const Renderer = blockMemo ? BlockMemoizedRenderer : LegacyRenderer;
    return (
      <Renderer
        content={content}
        documentIndex={documentIndex}
        usedComponents={usedComponents}
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        remarkRehypeOptions={remarkRehypeOptions}
        urlTransform={urlTransform}
        sanitizeSchema={usedSanitizeSchema}
        incrementalParse={incrementalParse}
        preserveOrphanReferences={preserveOrphanReferences}
        defListEnabled={enableDefinitionList}
        provenance={provenance}
      />
    );
  }
);

AIMarkdownContent.displayName = 'AIMarkdownContent';

export default AIMarkdownContent;

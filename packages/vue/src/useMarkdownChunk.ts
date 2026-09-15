import { computed, onMounted, onUnmounted, shallowRef, useId, watch, watchPostEffect } from 'vue';
import { visit } from 'unist-util-visit';
import {
  buildCoreRemarkPlugins,
  buildCoreRehypePlugins,
  buildCoreRemarkRehypeOptions,
  createDefLabelScanner,
  sanitizeSchema,
  type AIMarkdownEnginePlugin,
  type SanitizeSchema,
  type RegistryController,
} from '@ai-markdown/engine';
import {
  createPipelineSession,
  createContributionSession,
  derivePhantomTargets,
  deriveCoordinationPolicy,
  buildContributionChain,
  buildAggregateTree,
  type PhantomTargets,
  type CoordinationPolicy,
} from '@ai-markdown/core';

export interface ChunkInput {
  /** Already preprocessed, accumulated source. */
  content: string;
  documentId: string;
  registry: RegistryController | null;
  /** Per-chunk policy. Vue has no document-level override: the renderer's
   * own prop decides, and `AIMarkdownDocuments` takes no such prop. */
  preserveOrphanReferences: boolean;
  incrementalParse: boolean;
  clobberPrefix: string;
  documentIndex?: number;
  /** Identity-stable: the plugin chain and the engine's retained parse
   * state are keyed by these references. `AIMarkdown` deep-equal
   * stabilizes them at the prop boundary; a direct caller must hold them. */
  enginePlugins: readonly AIMarkdownEnginePlugin[];
  sanitizeSchema: SanitizeSchema;
}

/** Diagnostic for the provenance fallback path. Same wording as the React
 * adapter so both packages report the degraded credential the same way. */
export const PROVENANCE_FALLBACK_MESSAGE =
  'Web Crypto (globalThis.crypto.getRandomValues) is unavailable; the cross-chunk placeholder credential is unique but not secret. Forged placeholders are still unwrapped by the property-name channel.';

let fallbackCounter = 0;

/** Stable empty label result for standalone chunks (no registry). */
const EMPTY_DEF_LABELS: ReturnType<ReturnType<typeof createDefLabelScanner>['scan']> = Object.freeze({
  footnoteLabels: new Set<string>(),
  linkLabels: new Set<string>(),
});

function hex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

/** Placeholder credential for one chunk: 128 random bits from Web Crypto.
 * `crypto.randomUUID` is deliberately not used. Browsers expose it only in
 * secure contexts, so on a plain http:// origin other than localhost every
 * chunk would throw during setup. `getRandomValues` has no such restriction.
 * Without Web Crypto at all the value degrades to unique but not secret, and
 * the verifier's property-name channel keeps unwrapping forged placeholders.
 * Never throws; never returns an empty value.
 */
export function createProvenance(): string {
  // `globalThis.crypto`, not a bare `crypto` identifier: absence must be a
  // detectable `undefined`, not a `ReferenceError`.
  const webCrypto = globalThis.crypto as { getRandomValues?: (a: Uint8Array) => Uint8Array } | undefined;
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    webCrypto.getRandomValues(bytes);
    return hex(bytes);
  }
  fallbackCounter += 1;
  if (process.env.NODE_ENV !== 'production') {
    console.error(`[ai-markdown/vue] ${PROVENANCE_FALLBACK_MESSAGE}`);
  }
  return `fallback-${fallbackCounter}-${Date.now().toString(36)}`;
}

/** Vue lifecycle binding for one mounted chunk.
 * Engine trees/registries stay outside deep reactive proxies. Vue tracks only
 * source inputs, allocation and the monotonic registry notification signal.
 *
 * There is no block planner here. The plan exists to key a per-block render
 * cache, and React's block memo is the consumer; Vue converts the whole
 * frame to VNodes on every render and lets Vue's patcher diff the result,
 * so a plan would be computed every frame and read by nobody.
 *
 * The notification signal is fanned out through two identity-stable
 * computeds rather than read by the pipeline directly. Every publish in the
 * document notifies every chunk; if the pipeline computed depended on the
 * raw counter, one append would re-run parse and VNode conversion for every
 * chunk in the document. `phantomTargets` keeps its object identity while
 * the missing-label sets are unchanged, so `prepared` (the parse) only
 * re-runs for chunks whose targets actually moved; `resolution` folds the
 * registry facts the renderer reads for this chunk's placeholders into one
 * string, so the render only re-runs when a number, occurrence or
 * destination it shows has changed. This mirrors React, where the pipeline
 * memo is keyed on the ref-stable targets and placeholders subscribe per
 * label.
 */
export function useMarkdownChunk(input: () => ChunkInput) {
  const pipeline = createPipelineSession();
  const publisher = createContributionSession();
  const scanner = createDefLabelScanner({ math: true });
  const provenance = createProvenance();
  // The registry keys allocations by this string and uses it as the Symbol
  // description. It only has to be unique per instance within one app, and
  // a registry never outlives its AIMarkdownDocuments provider, so Vue's
  // app-local counter id is enough; no randomness is needed here.
  const chunkId = useId();
  const allocation = shallowRef<{ registry: RegistryController; sym: symbol } | null>(null);
  const version = shallowRef(0);
  let targets: PhantomTargets | undefined;
  let policy: CoordinationPolicy | undefined;
  // Coordinated mode only. The label scan is a second parse of the content,
  // and every reader of its result (registration, phantom targets, the
  // contribution commit) does nothing without a registry. Standalone chunks
  // get one shared empty result so nothing downstream churns on it. The
  // scanner stays convergent on non-append input, so a chunk that acquires a
  // registry later starts from a full scan of the content it has then.
  const ownLabels = computed(() => (input().registry ? scanner.scan(input().content) : EMPTY_DEF_LABELS));
  const selectedPlugins = computed(() => input().enginePlugins);
  const selectedSchema = computed(() => input().sanitizeSchema);
  const prefix = computed(() => input().clobberPrefix);
  const stablePlugins = computed(() => ({
    remarkPlugins: buildCoreRemarkPlugins(selectedPlugins.value),
    rehypePlugins: buildCoreRehypePlugins(selectedSchema.value ?? sanitizeSchema, prefix.value, { provenance }),
    remarkRehypeOptions: buildCoreRemarkRehypeOptions(
      selectedPlugins.value.some((plugin) => plugin.name === 'definitionList')
    ),
  }));
  // Depends on the registry counter so a newly published label is seen;
  // returns the previous object when the derived sets are equal, which is
  // what keeps `prepared` from re-running on unrelated notifications.
  const phantomTargets = computed(() => {
    void version.value;
    const current = input();
    targets = derivePhantomTargets(
      { content: current.content, ownLabels: ownLabels.value, labels: current.registry?.labelSet ?? null },
      targets
    );
    return targets;
  });
  const prepared = computed(() => {
    const current = input();
    const sym = allocation.value?.registry === current.registry ? (allocation.value?.sym ?? null) : null;
    const targets = phantomTargets.value;
    policy = deriveCoordinationPolicy(
      {
        coordinated: !!current.registry,
        registered: !!sym,
        preserveOrphanReferences: current.preserveOrphanReferences,
      },
      policy
    );
    const frameOptions = {
      ...stablePlugins.value,
      ...policy,
      content: current.content,
      targetPhantoms: targets,
      documentId: current.documentId,
      provenance,
      incrementalParse: current.incrementalParse,
      defListEnabled: current.enginePlugins.some((plugin) => plugin.name === 'definitionList'),
    };
    const trees = pipeline.parse(frameOptions);
    return {
      trees,
      targets,
      sym,
      registry: current.registry,
      clobberPrefix: current.clobberPrefix,
      ownLabels: ownLabels.value,
      chain: buildContributionChain({ ...frameOptions, clobberPrefix: current.clobberPrefix }),
    };
  });
  let stopRegistration: (() => void) | undefined;
  let stopPublishing: (() => void) | undefined;
  onMounted(() => {
    // Registration runs synchronously with the change that requires it (a
    // new registry, a changed label set, a new index), before the render
    // that follows. `prepared` reads the allocation: its policy differs
    // between an unregistered and a registered chunk, so a post-flush
    // registration made every registry switch parse twice, once without
    // the symbol and once with it. Publication of the parsed contribution
    // stays post-flush below; only the allocation moves ahead of the
    // render.
    stopRegistration = watch(
      [() => input().registry, ownLabels, () => input().documentIndex],
      ([registry, labels], _old, cleanup) => {
        if (!registry) {
          allocation.value = null;
          return;
        }
        const unsubscribe = registry.subscribe(() => {
          version.value++;
        });
        const sym = registry.registerChunk(chunkId, labels.footnoteLabels, labels.linkLabels, input().documentIndex);
        allocation.value = { registry, sym };
        cleanup(() => {
          unsubscribe();
          registry.releaseSymbol(chunkId);
          allocation.value = null;
        });
      },
      { immediate: true, flush: 'sync' }
    );
    stopPublishing = watchPostEffect(() => {
      const frame = prepared.value;
      publisher.commit({
        pipeline: frame.trees,
        ownLabels: frame.ownLabels,
        registry: frame.registry,
        targetPhantoms: frame.targets,
        sym: frame.sym,
        clobberPrefix: frame.clobberPrefix,
        chain: frame.chain,
      });
    });
  });
  onUnmounted(() => {
    stopPublishing?.();
    stopRegistration?.();
  });
  const aggregate = computed(() => {
    void version.value;
    const frame = prepared.value;
    if (!frame.registry || !frame.sym || frame.registry.chunkOrder.at(-1) !== frame.sym) return null;
    return buildAggregateTree(frame.registry, frame.clobberPrefix, input().preserveOrphanReferences);
  });
  // Everything render.ts asks the registry while converting this frame's
  // placeholders (footnote number and occurrence, link/image destination),
  // as one string. Equal string, equal render: the renderer must read this
  // so a definition published by another chunk still re-renders the
  // reference here, and only here. The walk includes the local footnote
  // section that a registered chunk does not render; that over-approximates
  // and never misses a dependency.
  //
  // The snapshot is JSON over one tuple per placeholder, never values joined
  // with a separator: `<https://example.com/a b> "c"` and
  // `<https://example.com/a> "b c"` joined by a space are the same string,
  // and the reference kept the stale destination. JSON keeps every field
  // in its own slot and keeps the states the renderer treats differently
  // apart: an unresolved label is `null`, a resolved one is `[url, title]`
  // with a missing title as `null` and an empty title as `""`; a footnote
  // number or occurrence is a number or `null`.
  const resolution = computed(() => {
    void version.value;
    const frame = prepared.value;
    const registry = frame.registry;
    if (!registry) return '';
    const parts: unknown[] = [];
    visit(frame.trees.hast, 'element', (node) => {
      const p = node.properties;
      if (node.tagName === 'footnote-sup') {
        const label = String(p.label ?? '');
        const number = registry.globalNumber(label);
        const local = Number(p.localOccurrence);
        const occurrence =
          number !== null && frame.sym && Number.isFinite(local)
            ? registry.globalOccurrenceForRef(frame.sym, label, local)
            : null;
        parts.push(['footnote', label, number, occurrence]);
      } else if (node.tagName === 'cross-chunk-link' || node.tagName === 'cross-chunk-image') {
        const identifier = String(p.identifier ?? p.label ?? '');
        const def = registry.resolveLinkDef(identifier);
        parts.push(['link', identifier, def ? [def.url, def.title ?? null] : null]);
      }
    });
    return JSON.stringify(parts);
  });
  return { prepared, aggregate, resolution, provenance };
}

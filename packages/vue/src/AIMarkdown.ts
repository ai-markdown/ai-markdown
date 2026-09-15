import { computed, defineComponent, h, onMounted, shallowRef, useId, type DefineComponent, type PropType } from 'vue';
import {
  isEnginePlugin,
  createIncrementalLatexPreprocessor,
  preprocessAIMDContent,
  defaultEnginePlugins,
  defaultUrlTransform,
  sanitizeSchema,
  shortenDocumentId,
  isFootnoteSection,
  type RegistryController,
} from '@ai-markdown/engine';
import { useDocumentScope } from './documents';
import { useMarkdownChunk } from './useMarkdownChunk';
import { deriveTailSignal } from '@ai-markdown/core';
import { AIMarkdownStreamingCursor } from './cursor';
import { renderTree } from './render';
import { stableComputed } from './stable';
import type { AIMarkdownProps } from './types';

export const markdownProps = {
  content: { type: String, required: true },
  documentId: String,
  documentIndex: Number,
  streaming: Boolean,
  incrementalParse: { type: Boolean, default: true },
  // `default: undefined` keeps an absent prop distinguishable from `false`;
  // Vue's Boolean casting would otherwise hand the wrapper's policy no
  // chance to apply. See the resolution in setup.
  preserveOrphanReferences: { type: Boolean, default: undefined },
  enginePlugins: { type: Array as PropType<AIMarkdownProps['enginePlugins']>, default: () => defaultEnginePlugins },
  contentPreprocessors: { type: Array as PropType<AIMarkdownProps['contentPreprocessors']>, default: () => [] },
  sanitizeSchema: {
    type: Object as PropType<AIMarkdownProps['sanitizeSchema']>,
    default: (): NonNullable<AIMarkdownProps['sanitizeSchema']> => sanitizeSchema,
  },
  urlTransform: { type: Function as PropType<AIMarkdownProps['urlTransform']>, default: defaultUrlTransform },
  components: { type: Object as PropType<AIMarkdownProps['components']>, default: () => ({}) },
  metadata: null,
  streamingCursor: { type: Boolean, default: true },
} as const;

export const AIMarkdown = defineComponent({
  name: 'AIMarkdown',
  props: markdownProps,
  setup(props, { slots }) {
    const scope = useDocumentScope();
    const id = useId();
    const documentId = computed(() => props.documentId ?? id);
    const clobberPrefix = computed(() => `aimd-${encodeURIComponent(shortenDocumentId(documentId.value))}-`);
    // Whether a next frame can follow this one. A server render is one
    // shot, so it takes the full pipeline and retains no incremental state;
    // a client mount seeds the retained prefix from its first frame. Decided
    // here rather than after mount: gating on a mounted flag parsed every
    // client mount twice (fully, then again incrementally once the flag
    // flipped), and hydration rebuilds from empty state either way.
    const client = typeof window !== 'undefined';
    // Prop boundary for the two parse inputs whose identity keys the engine's
    // retained state (the depsKey of the incremental parser and the
    // remark/rehype chain built from them). A parent passing an inline
    // `[...]` or `{...}` literal hands a new reference every render; the
    // stabilizers return the previous value when the new one is deep-equal,
    // so the chunk's computeds never see a change and no re-parse happens.
    // Below this boundary reference equality is trusted outright, as in the
    // React adapter's stability firewall.
    const plugins = stableComputed(() => (props.enginePlugins ?? defaultEnginePlugins).filter(isEnginePlugin));
    const schema = stableComputed(() => props.sanitizeSchema ?? sanitizeSchema);
    const latex = createIncrementalLatexPreprocessor();
    const content = computed(() => preprocessAIMDContent(props.content, props.contentPreprocessors, latex));
    // The registry is a computed over the same `documentId` that drives
    // `clobberPrefix`, so both change in the same reactive step and no frame
    // pairs the old registry with the new prefix. A post-mount watcher did
    // that: one documentId switch parsed with the old registry and the new
    // prefix, again with the new registry, and a third time once the
    // registration watcher ran. Acquisition still starts after mount: a
    // server render and hydration's first render write nothing to the
    // registry, and a discarded setup cannot leave an empty document shell.
    // The scope evicts a registry when its last chunk releases its symbol
    // (useMarkdownChunk's registration cleanup), so nothing is released
    // here; a chunk that never registered never acquired.
    const mounted = shallowRef(false);
    onMounted(() => {
      mounted.value = true;
    });
    const registry = computed<RegistryController | null>(() =>
      mounted.value && scope && props.documentId !== undefined ? scope.acquire(props.documentId) : null
    );
    const chunk = useMarkdownChunk(() => ({
      content: content.value,
      documentId: documentId.value,
      documentIndex: props.documentIndex,
      clobberPrefix: clobberPrefix.value,
      registry: registry.value,
      // Inside a documents wrapper its policy (default true) wins over the
      // chunk's own prop, as in React; the chunk prop applies standalone,
      // where it defaults to false.
      preserveOrphanReferences: scope?.preserveOrphanReferences.value ?? props.preserveOrphanReferences ?? false,
      incrementalParse: client && (props.incrementalParse ?? true),
      enginePlugins: plugins.value,
      sanitizeSchema: schema.value,
    }));
    return () => {
      const frame = chunk.prepared.value;
      // Registry facts behind this frame's placeholders; see useMarkdownChunk.
      void chunk.resolution.value;
      const options = {
        registry: frame.registry,
        sym: frame.sym,
        clobberPrefix: frame.clobberPrefix,
        sanitizeSchema: schema.value,
        urlTransform: props.urlTransform ?? defaultUrlTransform,
        // Not stabilized: the map is only read here, per element, and the
        // patcher compares the component values it yields, not the map.
        // An equal map with the same component references keeps every
        // instance either way; a deep compare would only add cost.
        components: props.components ?? {},
        slots,
        streaming: props.streaming ?? false,
        metadata: props.metadata,
      };
      const tree =
        frame.registry && frame.sym
          ? {
              ...frame.trees.hast,
              children: frame.trees.hast.children.filter(
                (node) => !(node.type === 'element' && isFootnoteSection(node))
              ),
            }
          : frame.trees.hast;
      const children = renderTree(tree, options);
      if (chunk.aggregate.value)
        children.push(...renderTree({ type: 'root', children: [chunk.aggregate.value] }, options));
      const cursor = props.streaming && props.streamingCursor;
      // Tail marker for the cursor shell: says whether the source tail sits
      // inside an invisible definition or a footnote definition, and which
      // footer item the text is streaming into. Only the cursor reads it, so
      // it exists only while the cursor does; a static document, SSR output
      // of a finished answer, or a stream with the cursor disabled renders
      // none. A permanent marker would also break `:last-child` styling of
      // the real last block.
      const tail = cursor ? deriveTailSignal(frame.trees.mdast, content.value.length) : null;
      if (tail)
        children.push(
          h('span', {
            'data-aimd-tail-kind': tail.kind,
            'data-aimd-tail-label': tail.kind === 'footnote-def' ? tail.identifier : undefined,
            'data-aimd-clobber-prefix': frame.clobberPrefix,
            style: { display: 'none' },
          })
        );
      if (cursor)
        children.push(
          h(
            AIMarkdownStreamingCursor,
            null,
            slots.cursor ? { default: () => slots.cursor!({ streaming: true }) } : undefined
          )
        );
      return h(
        'div',
        { class: 'aimd-vue', style: { position: 'relative' }, 'aria-busy': props.streaming ? 'true' : undefined },
        children
      );
    };
  },
}) as DefineComponent<AIMarkdownProps>;

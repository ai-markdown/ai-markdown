import { createApp, defineComponent, h, nextTick, shallowRef, type PropType } from 'vue';
import { AIMarkdown, AIMarkdownDocuments, useDocumentSmoothStream, defaultUrlTransform } from '@ai-markdown/vue';
import { installInteractionProbe, type StreamChunk } from '../../../../benchmarks/streaming/contract';
import '@ai-markdown/vue/styles.css';

const params = new URLSearchParams(location.search);
const plain = params.get('mode') === 'plain';
const coordinated = params.get('mode') === 'coordinated';
// Same URL policy, with a custom callback to exercise the uncached public
// rendering path. The scale document contains no links, so callback work is zero.
const urlTransform = params.has('uncached')
  ? (...args: Parameters<typeof defaultUrlTransform>) => defaultUrlTransform(...args)
  : defaultUrlTransform;
const chunks = shallowRef<StreamChunk[]>(
  Array.from({ length: coordinated ? 2 : 1 }, () => ({ content: '', streaming: true }))
);
const SmoothChunk = defineComponent({
  props: { chunk: { type: Object as PropType<StreamChunk>, required: true }, index: { type: Number, required: true } },
  setup(props) {
    const smooth = useDocumentSmoothStream(() => ({
      ...props.chunk,
      documentId: coordinated ? 'benchmark' : undefined,
    }));
    return () =>
      h(
        'article',
        {
          'data-chunk': props.index,
          'data-visible': smooth.content.value.length,
          'data-active': smooth.streaming.value,
        },
        [
          h(AIMarkdown, {
            content: smooth.content.value,
            streaming: smooth.streaming.value,
            documentId: coordinated ? 'benchmark' : undefined,
          }),
        ]
      );
  },
});
createApp({
  render: () =>
    h(AIMarkdownDocuments, null, {
      default: () =>
        chunks.value.map((chunk, index) =>
          plain
            ? h(
                'article',
                {
                  key: index,
                  'data-chunk': index,
                  'data-visible': chunk.content.length,
                  'data-active': chunk.streaming,
                },
                [h(AIMarkdown, { ...chunk, urlTransform })]
              )
            : h(SmoothChunk, { key: index, chunk, index })
        ),
    }),
}).mount('#root');
installInteractionProbe();
window.streamingProbe = {
  update: async (next) => {
    chunks.value = next;
    await nextTick();
  },
};

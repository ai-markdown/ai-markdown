import { startVueStress } from './stress.fixture';
import { createApp, createSSRApp, defineComponent, h, nextTick, reactive } from 'vue';
import type { MarkdownElementContext } from '../types';
import { AIMarkdown, AIMarkdownDocuments, AIMarkdownSmoothStream } from '../index';

startVueStress();
const initial = '# Hydration\n\n**bold** $x^2$\n\nlocal[^x]\n\n[^x]: body';
const hydration = createSSRApp({ render: () => h(AIMarkdown, { content: initial }) });
hydration.mount('#hydration');
const state = reactive({
  doc: 'doc',
  reference: '[**label**][url] ![pic][url] note[^x]',
  definition: '[url]: https://example.com/one\n\n[^x]: footnote body',
  show: true,
  streaming: true,
  code: '```ts\nfirst\n```',
  smooth: 'seed',
  producing: true,
  first: '',
  second: '',
  firstDone: false,
  secondDone: false,
  cursor: 'cursor target',
  // Deep raw-HTML probe: the runner swaps in thousands of nested <div> tags
  // (stack exhaustion inside the engine's raw-HTML step) and then a healthy
  // frame, checking the plain-text degrade and the recovery in every browser.
  deep: 'shallow start',
});
const Code = defineComponent({
  props: ['streaming'],
  setup:
    (props, { slots }) =>
    () =>
      h('output', { 'data-streaming': String(props.streaming) }, slots.default?.()),
});
const app = createApp({
  render: () =>
    h('main', [
      h(AIMarkdownDocuments, null, {
        default: () => [
          h(
            AIMarkdown,
            {
              content: state.reference,
              documentId: state.doc,
              documentIndex: 0,
              id: 'reference',
              urlTransform: (url: string) => (url.startsWith('#') ? '/reader' + url : url),
              components: {
                sup: defineComponent({
                  setup:
                    (_props, { slots }) =>
                    () =>
                      h('sup', { 'data-custom': 'yes' }, slots.default?.()),
                }),
              },
            },
            {
              a: ({ properties, children }: MarkdownElementContext) =>
                h('a', { ...properties, 'data-slot': 'yes' }, children),
            }
          ),
          state.show
            ? h(AIMarkdown, { content: state.definition, documentId: state.doc, documentIndex: 1, id: 'definition' })
            : null,
          h(AIMarkdown, { content: '[label][url]', documentId: 'isolated', id: 'isolated' }),
        ],
      }),
      h(AIMarkdown, { content: state.code, streaming: state.streaming, components: { code: Code }, id: 'custom' }),
      h(AIMarkdown, { content: state.cursor, streaming: true, id: 'cursor-probe' }),
      ...(['ltr', 'rtl', 'scaled'] as const).map((mode) =>
        h(AIMarkdown, {
          content: mode === 'rtl' ? 'مرحبا بالعالم' : 'border cursor target',
          streaming: true,
          id: `cursor-border-${mode}`,
          style: {
            width: '280px',
            padding: '12px',
            border: '7px solid black',
            borderLeftWidth: '11px',
            borderTopWidth: '9px',
            direction: mode === 'rtl' ? 'rtl' : 'ltr',
            transform: mode === 'scaled' ? 'scale(0.75)' : undefined,
            transformOrigin: 'top left',
          },
        })
      ),
      ...(
        [
          ['math-link', '$$\nx\n$$\n[x]: https://example.com/math', '[link][x]'],
          ['math-ghost', '$$\n\n[^a]: note\n\n$$', 'body[^a]'],
        ] as const
      ).map(([id, definition, reference]) =>
        h(AIMarkdownDocuments, null, {
          default: () => [
            h(AIMarkdown, { documentId: id, content: definition }),
            h(AIMarkdown, { documentId: id, content: reference, id }),
          ],
        })
      ),
      h(AIMarkdown, { content: state.deep, id: 'deep' }),
      h(AIMarkdownDocuments, null, {
        default: () => [
          h(AIMarkdownSmoothStream, {
            content: state.first,
            streaming: !state.firstDone,
            documentId: 'queue',
            id: 'queue-first',
          }),
          h(
            AIMarkdownSmoothStream,
            { content: state.second, streaming: !state.secondDone, documentId: 'queue', id: 'queue-second' },
            { waiting: () => h('em', 'waiting turn') }
          ),
        ],
      }),
      h(AIMarkdownSmoothStream, {
        content: state.smooth,
        streaming: state.producing,
        pacing: 'responsive',
        id: 'smooth',
      }),
    ]),
});
app.mount('#app');
declare global {
  interface Window {
    vueProbe: { update: (patch: Partial<typeof state>) => Promise<void>; unmount: () => void };
  }
}
window.vueProbe = {
  update: async (patch) => {
    Object.assign(state, patch);
    await nextTick();
  },
  unmount: () => {
    app.unmount();
    hydration.unmount();
  },
};

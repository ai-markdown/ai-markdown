import React, { StrictMode, useState } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { createSSRApp, defineComponent, h, ref } from 'vue';
import AIMarkdown from '@ai-markdown/react';
import { MantineProvider } from '@mantine/core';
import { MarkdownImage as MantineImage } from '@ai-markdown/react-mantine/components';
import '@mantine/core/styles.css';
import { AIMarkdown as VueMarkdown } from '@ai-markdown/vue';
import {
  MarkdownCodeBlock,
  MarkdownImage,
  MarkdownTable,
  createMarkdownCodeBlock,
} from '@ai-markdown/react/components';
import {
  MarkdownCodeBlock as VueCode,
  MarkdownImage as VueImage,
  MarkdownTable as VueTable,
  createMarkdownCodeBlock as createVueCode,
} from '@ai-markdown/vue/components';
import '@ai-markdown/react/components/styles.css';
const sample: string = window.initialSource;
const custom = createMarkdownCodeBlock({
  renderers: {
    ' Mermaid ': ({ code, streaming, active }) => (
      <output data-custom data-streaming={String(streaming)} data-active={String(active)}>
        {code}
      </output>
    ),
  },
});
const vCustom = createVueCode({
  renderers: {
    mermaid: defineComponent({
      props: ['code', 'streaming', 'active'],
      setup: (props) => () =>
        h(
          'output',
          { 'data-custom': '', 'data-streaming': String(props.streaming), 'data-active': String(props.active) },
          props.code
        ),
    }),
  },
});
const disabled = createMarkdownCodeBlock({ renderers: { mermaid: false } });
const vDisabled = createVueCode({ renderers: { mermaid: false } });
const rComponents = {
  pre: MarkdownCodeBlock,
  img: MarkdownImage,
  table: MarkdownTable,
  td: ({ node: _node, children, ...props }) => (
    <td {...props}>
      {children}
      <span data-ui>UI-only</span>
    </td>
  ),
};
const vComponents = {
  pre: VueCode,
  img: VueImage,
  table: VueTable,
  td: defineComponent({
    setup:
      (_, { attrs, slots }) =>
      () =>
        h('td', attrs, [slots.default?.(), h('span', { 'data-ui': '' }, 'UI-only')]),
  }),
};
function ReactFixture() {
  const [content, setContent] = useState(sample),
    [streaming, setStreaming] = useState(false);
  const [mode, setMode] = useState('default');
  Object.assign(window, {
    updateReact: (next: string, stream = false) => {
      setContent(next);
      setStreaming(stream);
    },
    modeReact: setMode,
  });
  return (
    <StrictMode>
      <AIMarkdown
        content={content}
        streaming={streaming}
        documentId="react-rich"
        customComponents={{
          ...rComponents,
          pre: mode === 'custom' ? custom : mode === 'disabled' ? disabled : MarkdownCodeBlock,
        }}
      />
    </StrictMode>
  );
}
const vContent = ref(sample),
  vStreaming = ref(false),
  vMode = ref('default');
Object.assign(window, {
  updateVue: (next: string, stream = false) => {
    vContent.value = next;
    vStreaming.value = stream;
  },
  modeVue: (mode: string) => {
    vMode.value = mode;
  },
  sample,
});
hydrateRoot(document.querySelector('#react')!, <ReactFixture />);
createSSRApp({
  setup: () => () =>
    h(VueMarkdown, {
      content: vContent.value,
      streaming: vStreaming.value,
      documentId: 'vue-rich',
      components: {
        ...vComponents,
        pre: vMode.value === 'custom' ? vCustom : vMode.value === 'disabled' ? vDisabled : VueCode,
      },
    }),
}).mount('#vue');

createRoot(document.querySelector('#mantine')!).render(
  <MantineProvider>
    <AIMarkdown content="Inline ![mantine](/image.svg) image." customComponents={{ img: MantineImage }} />
  </MantineProvider>
);

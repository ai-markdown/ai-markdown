import { createApp, h, shallowRef, nextTick } from 'vue';
import { AIMarkdown, AIMarkdownDocuments } from '@ai-markdown/vue';
import '@ai-markdown/vue/styles.css';
import { install } from './workload.mjs';

const frame = shallowRef({ content: '', definitions: '' });
createApp({
  setup() {
    return () => {
      const { content, definitions } = frame.value;
      const body = () => h(AIMarkdown, { content, documentId: 'bench', documentIndex: 0 });
      return definitions
        ? h(AIMarkdownDocuments, null, {
            default: () => [body(), h(AIMarkdown, { content: definitions, documentId: 'bench', documentIndex: 1 })],
          })
        : body();
    };
  },
}).mount('#root');
install(async (content, definitions) => {
  frame.value = { content, definitions };
  await nextTick();
});

/* global document */
import { createElement as h } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import AIMarkdown, { AIMarkdownDocuments } from '@ai-markdown/react';
import '@ai-markdown/react/typography/default.css';
import { install } from './workload.mjs';

const root = createRoot(document.getElementById('root'));
install((content, definitions) => {
  const body = h(AIMarkdown, { content, documentId: 'bench', documentIndex: 0 });
  flushSync(() =>
    root.render(
      definitions
        ? h(
            AIMarkdownDocuments,
            null,
            body,
            h(AIMarkdown, { content: definitions, documentId: 'bench', documentIndex: 1 })
          )
        : body
    )
  );
});

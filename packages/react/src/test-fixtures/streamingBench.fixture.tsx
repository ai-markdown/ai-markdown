import { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import AIMarkdown, { AIMarkdownDocuments, useDocumentSmoothStream } from '@ai-markdown/react';
import '@ai-markdown/react/typography/default.css';
import { installInteractionProbe, type StreamChunk } from '../../../../benchmarks/streaming/contract';

const mode = new URLSearchParams(location.search).get('mode');
const coordinated = mode === 'coordinated';
const initial = Array.from({ length: coordinated ? 2 : 1 }, () => ({ content: '', streaming: true }));
let committed: (() => void) | undefined;

function SmoothChunk({ chunk, index }: { chunk: StreamChunk; index: number }) {
  const smooth = useDocumentSmoothStream({ ...chunk, documentId: coordinated ? 'benchmark' : undefined });
  return (
    <article data-chunk={index} data-visible={smooth.content.length} data-active={smooth.streaming}>
      <AIMarkdown {...smooth} documentId={coordinated ? 'benchmark' : undefined} />
    </article>
  );
}
function App() {
  const [chunks, setChunks] = useState(initial);
  useLayoutEffect(() => {
    window.streamingProbe = {
      update: (next) =>
        new Promise<void>((resolve) => {
          committed = resolve;
          setChunks(next);
        }),
    };
    committed?.();
    committed = undefined;
  });
  return (
    <AIMarkdownDocuments>
      {chunks.map((chunk, index) => (
        <SmoothChunk key={index} chunk={chunk} index={index} />
      ))}
    </AIMarkdownDocuments>
  );
}
installInteractionProbe();
createRoot(document.getElementById('root')!).render(<App />);

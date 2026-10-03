import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import AIMarkdown, { AIMarkdownDocuments, useDocumentSmoothStream } from '../../src/index';
import { sanitizeSchema } from '@ai-markdown/engine';

const meta: Meta = {
  title: 'QA/Reference and queue regressions',
  tags: ['qa'],
  parameters: { a11y: { test: 'off' } },
};
export default meta;

const restricted = { ...sanitizeSchema, attributes: { ...sanitizeSchema.attributes, a: [], '*': [] } };
export const ReferencePolicies: StoryObj = {
  render: () => (
    <>
      <div data-case="hash">
        <AIMarkdownDocuments>
          <AIMarkdown documentId="hash" content={'<span id="target">Target</span>\n\n[go][ref]\n\n[ref]: #target'} />
        </AIMarkdownDocuments>
      </div>
      <div data-case="escaped">
        <AIMarkdownDocuments>
          <AIMarkdown documentId="escaped" content={'[go][a\\*b]'} />
          <AIMarkdown documentId="escaped" content={'[a\\*b]: /expected'} />
        </AIMarkdownDocuments>
      </div>
      <div data-case="restricted">
        <AIMarkdownDocuments>
          <AIMarkdown documentId="restricted" content={'[go][ref]\n\n[ref]: /expected'} sanitizeSchema={restricted} />
        </AIMarkdownDocuments>
      </div>
    </>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelector('[data-case="hash"] a')?.getAttribute('href')).toBe(
        '#hash-user-content-target'
      );
      expect(canvasElement.querySelector('[data-case="escaped"] a')?.getAttribute('href')).toBe('/expected');
      expect(canvasElement.querySelector('[data-case="restricted"] a')?.hasAttribute('href')).toBe(false);
    });
  },
};

const referenceForms = [
  '[full][a\\*b]',
  '[a\\*b][]',
  '[a\\*b]',
  '![full][a\\*b]',
  '![a\\*b][]',
  '![a\\*b]',
  '[entity][a&amp;b]',
  '![entity][a&amp;b]',
];
const escapedImage = 'https://picsum.photos/seed/ai-markdown-escaped/200/300';
const entityImage = 'https://picsum.photos/seed/ai-markdown-entity/200/300';
export const ReferenceIdentifiers: StoryObj = {
  render: () => (
    <>
      {referenceForms.map((content, i) => (
        <div data-ref={i} key={content}>
          <AIMarkdownDocuments>
            <AIMarkdown documentId={`ref-${i}`} content={content} />
            <AIMarkdown documentId={`ref-${i}`} content={`[a\\*b]: ${escapedImage}\n\n[a&amp;b]: ${entityImage}`} />
          </AIMarkdownDocuments>
        </div>
      ))}
    </>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      referenceForms.forEach((source, i) => {
        const image = source.startsWith('!');
        const element = canvasElement.querySelector(`[data-ref="${i}"] ${image ? 'img' : 'a'}`);
        expect(element?.getAttribute(image ? 'src' : 'href')).toBe(i < 6 ? escapedImage : entityImage);
      })
    );
  },
};

function QueueChunk({
  name,
  content,
  streaming,
  waiting,
}: {
  name: string;
  content: string;
  streaming: boolean;
  waiting: boolean;
}) {
  const smooth = useDocumentSmoothStream({ documentId: 'waiting', content, streaming, waiting });
  return (
    <output data-name={name} data-streaming={String(smooth.streaming)}>
      {smooth.content}
    </output>
  );
}
function WaitingQueue({ empty = false }: { empty?: boolean }) {
  const [phase, setPhase] = useState(0);
  return (
    <>
      <button onClick={() => setPhase((p) => p + 1)}>advance</button>
      <AIMarkdownDocuments>
        <QueueChunk
          name="a"
          content={phase > 0 && !empty ? 'first stream '.repeat(80) : ''}
          waiting={phase === 0}
          streaming={!empty && phase === 1}
        />
        <QueueChunk
          name="b"
          content={phase > 0 ? 'second stream '.repeat(80) : ''}
          waiting={phase === 0}
          streaming={phase > 0 && phase < 3}
        />
      </AIMarkdownDocuments>
    </>
  );
}

export const WaitingBeforeInput: StoryObj = {
  render: () => <WaitingQueue />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(canvasElement.querySelector('[data-name="a"]')?.getAttribute('data-streaming')).toBe('false')
    );
    await userEvent.click(canvas.getByRole('button', { name: 'advance' }));
    await waitFor(() => expect(canvasElement.querySelector('[data-name="a"]')?.textContent?.length).toBeGreaterThan(0));
    expect(canvasElement.querySelector('[data-name="b"]')?.textContent).toBe('');
    await userEvent.click(canvas.getByRole('button', { name: 'advance' }));
    await waitFor(() => expect(canvasElement.querySelector('[data-name="b"]')?.textContent?.length).toBeGreaterThan(0));
    await userEvent.click(canvas.getByRole('button', { name: 'advance' }));
    await waitFor(() =>
      expect(canvasElement.querySelector('[data-name="b"]')?.getAttribute('data-streaming')).toBe('false')
    );
  },
};
export const EmptyResultReleases: StoryObj = {
  render: () => <WaitingQueue empty />,
  play: async ({ canvasElement }) => {
    const next = within(canvasElement).getByRole('button', { name: 'advance' });
    await userEvent.click(next);
    await waitFor(() => expect(canvasElement.querySelector('[data-name="b"]')?.textContent?.length).toBeGreaterThan(0));
    expect(canvasElement.querySelector('[data-name="a"]')?.textContent).toBe('');
    await userEvent.click(next);
    await userEvent.click(next);
  },
};

// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AIMarkdown, { AIMarkdownDocuments } from '../index';

let container: HTMLDivElement;
let root: Root;
const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let previousActEnvironment: boolean | undefined;
beforeEach(() => {
  previousActEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  environment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

async function renderChunks(definition: string, reference: string) {
  await act(async () => {
    root.render(
      <AIMarkdownDocuments>
        <div data-definition>
          <AIMarkdown documentId="math" content={definition} />
        </div>
        <div data-reference>
          <AIMarkdown documentId="math" content={reference} />
        </div>
      </AIMarkdownDocuments>
    );
  });
  return container.querySelector('[data-reference]')!;
}

test('streaming a link definition immediately after display math resolves a sibling reference', async () => {
  await renderChunks('$$\nx', '[link][x]');
  const reference = await renderChunks('$$\nx\n$$\n[x]: https://example.com', '[link][x]');
  expect(reference.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
  expect(reference.textContent).toBe('link');
});

test('math contents never advertise ghost footnotes and replacement can introduce a real definition', async () => {
  const reference = await renderChunks('$$\n\n[^a]: note\n\n$$', 'body[^a]');
  expect(reference.textContent).toBe('body[^a]');
  expect(reference.querySelector('[data-footnote-ref]')).toBeNull();
  const replaced = await renderChunks('[^a]: real note', 'body[^a]');
  const mark = replaced.querySelector('[data-footnote-ref]');
  expect(mark?.textContent).toBe('1');
  const targetId = mark!.getAttribute('href')!.slice(1);
  expect(document.getElementById(targetId)?.textContent).toContain('real note');
});

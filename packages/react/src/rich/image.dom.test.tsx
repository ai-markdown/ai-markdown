// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
// Imported by package name, like the component itself, so both share one React context.
import { AIMarkdown } from '@ai-markdown/react';
import { MarkdownImage } from './image';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLElement | undefined;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

const images = (count: number) =>
  Array.from({ length: count }, (_, i) => `![photo ${i}](https://example.test/p/photo-${i}.png)\n\n`).join('');

const mount = async (content: string) => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const render = (next: string) =>
    act(async () => {
      root!.render(<AIMarkdown content={next} customComponents={{ img: MarkdownImage }} />);
    });
  await render(content);
  return { render, container };
};

const loadAll = async (scope: HTMLElement) => {
  for (const img of scope.querySelectorAll('img')) {
    if (!img.dataset.loaded) {
      img.dataset.loaded = '1';
      await act(async () => img.dispatchEvent(new Event('load')));
    }
  }
};

const counter = () => document.body.textContent?.match(/\d+ \/ \d+/)?.[0] ?? null;

describe('image preview', () => {
  // Pins the host guard: the host must refresh while its selection is non-null, even when that
  // selection names another image after navigation. A guard of "selection is this element" fails here.
  test('the open preview keeps counting after navigating to another image and adding one', async () => {
    const { render, container: scope } = await mount(images(3));
    await loadAll(scope);
    await act(async () => (scope.querySelectorAll('button.aimd-image-trigger')[0] as HTMLButtonElement).click());
    await act(async () => (document.querySelector('.aimd-image-preview-switch-next') as HTMLElement).click());
    expect(counter()).toBe('2 / 3');
    await render(images(4));
    await loadAll(scope);
    expect(counter()).toBe('2 / 4');
  });
});

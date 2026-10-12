// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
// Imported by package name, like the component itself, so both share one React context.
import { AIMarkdown, AIMarkdownDocuments } from '@ai-markdown/react';
import type { ReactNode } from 'react';
import { MarkdownImage, createMarkdownImage } from './image';

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

describe('image groups', () => {
  const show = async (ui: ReactNode) => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const render = (next: ReactNode) => act(async () => root!.render(next));
    await render(ui);
    await loadAll(container);
    return { render, scope: container };
  };
  /** One entry per image: whether it offers a gallery or a single preview. */
  const kinds = (scope: HTMLElement) =>
    [...scope.querySelectorAll('.aimd-image-cover [data-image-icon]')].map((icon) =>
      icon.getAttribute('data-image-icon')
    );
  const one = (name: string) => `![${name}](https://example.test/p/${name}.png)`;
  const components = { img: MarkdownImage };

  test('renderers that share a document id inside the wrapper form one gallery', async () => {
    const { scope } = await show(
      <AIMarkdownDocuments>
        <AIMarkdown documentId="answer" content={one('a')} customComponents={components} />
        <AIMarkdown documentId="answer" content={one('b')} customComponents={components} />
        <AIMarkdown documentId="other" content={one('c')} customComponents={components} />
      </AIMarkdownDocuments>
    );
    expect(kinds(scope)).toEqual(['gallery', 'gallery', 'preview']);
    await act(async () => (scope.querySelectorAll('button.aimd-image-trigger')[1] as HTMLButtonElement).click());
    expect(counter()).toBe('2 / 2');
  });

  test('standalone renderers stay separate, with or without an explicit id', async () => {
    const { scope } = await show(
      <>
        <AIMarkdown content={one('a')} customComponents={components} />
        <AIMarkdown content={one('b')} customComponents={components} />
        <AIMarkdown documentId="same" content={one('c')} customComponents={components} />
        <AIMarkdown documentId="same" content={one('d')} customComponents={components} />
      </>
    );
    expect(kinds(scope)).toEqual(['preview', 'preview', 'preview', 'preview']);
  });

  test('a custom typography root needs no marker to group its images', async () => {
    const Plain = ({ children }: { children?: ReactNode }) => <article>{children}</article>;
    const { scope } = await show(
      <AIMarkdown content={`${one('a')}\n\n${one('b')}`} Typography={Plain} customComponents={components} />
    );
    expect(kinds(scope)).toEqual(['gallery', 'gallery']);
  });

  test('an image follows its renderer to another document', async () => {
    const tree = (second: string) => (
      <AIMarkdownDocuments>
        <AIMarkdown documentId="first" content={one('a')} customComponents={components} />
        <AIMarkdown documentId={second} content={one('b')} customComponents={components} />
      </AIMarkdownDocuments>
    );
    const { render, scope } = await show(tree('second'));
    expect(kinds(scope)).toEqual(['preview', 'preview']);
    await render(tree('first'));
    expect(kinds(scope)).toEqual(['gallery', 'gallery']);
    await render(tree('second'));
    expect(kinds(scope)).toEqual(['preview', 'preview']);
  });

  test('group: false and a selector override the document', async () => {
    const Single = createMarkdownImage({ group: false });
    const Album = createMarkdownImage({ group: '[data-album]' });
    const two = `${one('a')}\n\n${one('b')}`;
    const { scope } = await show(
      <>
        <AIMarkdown content={two} customComponents={{ img: Single }} />
        <div data-album>
          <AIMarkdown content={one('c')} customComponents={{ img: Album }} />
          <AIMarkdown content={one('d')} customComponents={{ img: Album }} />
        </div>
      </>
    );
    expect(kinds(scope)).toEqual(['preview', 'preview', 'gallery', 'gallery']);
  });
});

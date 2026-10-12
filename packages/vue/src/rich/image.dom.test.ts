// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { createApp, h, nextTick, ref, type App, type VNode } from 'vue';
import { AIMarkdown } from '../AIMarkdown';
import { AIMarkdownDocuments } from '../documents';
import { MarkdownImage, createMarkdownImage } from './image';

let app: App | undefined;
let container: HTMLElement | undefined;

afterEach(() => {
  app?.unmount();
  container?.remove();
  app = undefined;
  container = undefined;
});

const one = (name: string) => `![${name}](https://example.test/p/${name}.png)`;
const components = { img: MarkdownImage };
const markdown = (content: string, props: Record<string, unknown> = {}) =>
  h(AIMarkdown, { content, streamingCursor: false, components, ...props });

const show = async (render: () => VNode | VNode[]) => {
  const scope = (container = document.createElement('div'));
  document.body.append(scope);
  app = createApp({ render });
  app.mount(scope);
  const settle = async () => {
    await nextTick();
    for (const img of scope.querySelectorAll('img')) {
      if (!img.dataset.loaded) {
        img.dataset.loaded = '1';
        img.dispatchEvent(new Event('load'));
      }
    }
    await nextTick();
    await nextTick();
  };
  await settle();
  return { scope, settle };
};

/** One entry per image: whether it offers a gallery or a single preview. */
const kinds = (scope: HTMLElement) =>
  [...scope.querySelectorAll('.aimd-image-cover [data-image-icon]')].map((icon) =>
    icon.getAttribute('data-image-icon')
  );

describe('image groups', () => {
  test('renderers that share a document id inside the wrapper form one gallery', async () => {
    const { scope } = await show(() =>
      h(AIMarkdownDocuments, null, () => [
        markdown(one('a'), { documentId: 'answer' }),
        markdown(one('b'), { documentId: 'answer' }),
        markdown(one('c'), { documentId: 'other' }),
      ])
    );
    expect(kinds(scope)).toEqual(['gallery', 'gallery', 'preview']);
  });

  test('standalone renderers stay separate, with or without an explicit id', async () => {
    const { scope } = await show(() => [
      markdown(one('a')),
      markdown(one('b')),
      markdown(one('c'), { documentId: 'same' }),
      markdown(one('d'), { documentId: 'same' }),
    ]);
    expect(kinds(scope)).toEqual(['preview', 'preview', 'preview', 'preview']);
  });

  test('images of one renderer form a gallery', async () => {
    const { scope } = await show(() => markdown(`${one('a')}\n\n${one('b')}`));
    expect(kinds(scope)).toEqual(['gallery', 'gallery']);
  });

  test('an image follows its renderer to another document', async () => {
    const second = ref('second');
    const { scope, settle } = await show(() =>
      h(AIMarkdownDocuments, null, () => [
        markdown(one('a'), { documentId: 'first' }),
        markdown(one('b'), { documentId: second.value }),
      ])
    );
    expect(kinds(scope)).toEqual(['preview', 'preview']);
    second.value = 'first';
    await settle();
    expect(kinds(scope)).toEqual(['gallery', 'gallery']);
    second.value = 'second';
    await settle();
    expect(kinds(scope)).toEqual(['preview', 'preview']);
  });

  test('group: false and a selector override the document', async () => {
    const Single = createMarkdownImage({ group: false });
    const Album = createMarkdownImage({ group: '[data-album]' });
    const { scope } = await show(() => [
      markdown(`${one('a')}\n\n${one('b')}`, { components: { img: Single } }),
      h('div', { 'data-album': '' }, [
        markdown(one('c'), { components: { img: Album } }),
        markdown(one('d'), { components: { img: Album } }),
      ]),
    ]);
    expect(kinds(scope)).toEqual(['preview', 'preview', 'gallery', 'gallery']);
  });
});

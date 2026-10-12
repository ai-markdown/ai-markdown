// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createApp, h, nextTick, ref, type App, type VNode } from 'vue';
import { AIMarkdown } from '../AIMarkdown';
import { AIMarkdownDocuments } from '../documents';
import { MarkdownImage, createMarkdownImage } from './image';

// jsdom has the dialog element but not its modal methods.
HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
  this.removeAttribute('open');
};

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

describe('preview dialog', () => {
  // The user prefers reduced motion: closing does not wait for a transition.
  beforeEach(() => {
    window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;
  });
  const dialog = () => document.querySelector('dialog.aimd-image-preview') as HTMLDialogElement | null;
  const shown = () => dialog()?.querySelector('img.aimd-image-preview-img') as HTMLImageElement;
  const counter = () => dialog()?.querySelector('.aimd-image-preview-progress')?.textContent ?? null;
  const frames = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))).then(() => nextTick());
  const open = async (scope: HTMLElement, index = 0) => {
    (scope.querySelectorAll('button.aimd-image-trigger')[index] as HTMLButtonElement).click();
    await nextTick();
    // Two frames take the preview out of its opening phase.
    await frames();
    shown().dispatchEvent(new Event('load'));
    await nextTick();
  };
  const pointer = (type: string, x: number, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    return event;
  };
  const three = [one('a'), one('b'), one('c')].join('\n\n');

  test('opens as a modal dialog on the image that was activated', async () => {
    const { scope } = await show(() => markdown(three));
    expect(dialog()).toBeNull();
    await open(scope, 1);
    expect(dialog()?.open).toBe(true);
    expect(dialog()?.getAttribute('data-phase')).toBe('open');
    expect(dialog()?.getAttribute('aria-label')).toBe('b');
    expect(shown().src).toContain('/b.png');
    expect(counter()).toBe('2 / 3');
    expect(document.body.style.overflow).toBe('hidden');
  });

  test('it grows out of the activated thumbnail and shrinks back into the thumbnail of the image shown', async () => {
    // Closing takes its 300 ms here, so the leaving state can be observed.
    window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
    const { scope } = await show(() => markdown([one('a'), one('b')].join('\n\n')));
    // jsdom lays nothing out: give the two thumbnails a place on the page.
    const place = (img: Element, left: number, top: number) => {
      img.getBoundingClientRect = () => ({ left, top, width: 100, height: 60 }) as DOMRect;
    };
    const [first, second] = scope.querySelectorAll('.aimd-image img');
    place(first, 20, 40);
    place(second, 300, 400);
    const body = () => dialog()!.querySelector('.aimd-image-preview-body') as HTMLElement;
    await open(scope, 0);
    expect(body().style.transformOrigin).toBe('70px 70px');
    dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await nextTick();
    (dialog()!.querySelector('.aimd-image-preview-close') as HTMLElement).click();
    await nextTick();
    expect(dialog()!.getAttribute('data-phase')).toBe('closing');
    expect(body().style.transformOrigin).toBe('350px 430px');
    await new Promise((resolve) => setTimeout(resolve, 320));
    await nextTick();
    expect(dialog()).toBeNull();
  });

  test('arrow keys move through the gallery, and it follows images added while it is open', async () => {
    const content = ref([one('a'), one('b')].join('\n\n'));
    const { scope, settle } = await show(() => markdown(content.value));
    await open(scope, 0);
    const previous = () => dialog()!.querySelector('.aimd-image-preview-switch-prev') as HTMLButtonElement;
    expect(previous().disabled).toBe(true);
    dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await nextTick();
    expect(counter()).toBe('2 / 2');
    expect(shown().src).toContain('/b.png');
    expect((dialog()!.querySelector('.aimd-image-preview-switch-next') as HTMLButtonElement).disabled).toBe(true);
    content.value = three;
    await settle();
    expect(counter()).toBe('2 / 3');
  });

  test('Escape, the mask and the close button close it, and focus returns to the trigger', async () => {
    const { scope } = await show(() => markdown(three));
    const trigger = scope.querySelectorAll('button.aimd-image-trigger')[1] as HTMLButtonElement;
    for (const close of [
      () => dialog()!.dispatchEvent(new Event('cancel', { cancelable: true })),
      () => (dialog()!.querySelector('.aimd-image-preview-mask') as HTMLElement).click(),
      () => (dialog()!.querySelector('.aimd-image-preview-close') as HTMLElement).click(),
    ]) {
      await open(scope, 1);
      expect(dialog()).not.toBeNull();
      close();
      await nextTick();
      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(trigger);
      expect(document.body.style.overflow).toBe('');
    }
  });

  test('a drag moves the image without a transition, and the toolbar transforms it', async () => {
    const { scope } = await show(() => markdown(one('a')));
    await open(scope);
    shown().dispatchEvent(pointer('pointerdown', 100, 100));
    await nextTick();
    expect(dialog()!.className).toContain('aimd-image-preview-moving');
    shown().dispatchEvent(pointer('pointermove', 130, 120));
    await frames();
    expect(shown().style.transform).toContain('translate3d(30px, 20px, 0)');
    shown().dispatchEvent(pointer('pointerup', 130, 120));
    await nextTick();
    expect(dialog()!.className).not.toContain('aimd-image-preview-moving');
    // jsdom lays nothing out, so the image "fits" and returns to the centre.
    expect(shown().style.transform).toContain('translate3d(0px, 0px, 0)');
    (dialog()!.querySelector('.aimd-image-preview-actions-action-rotateRight') as HTMLElement).click();
    (dialog()!.querySelector('.aimd-image-preview-actions-action-flipX') as HTMLElement).click();
    await nextTick();
    expect(shown().style.transform).toContain('scale3d(-1, 1, 1) rotate(90deg)');
    expect((dialog()!.querySelector('.aimd-image-preview-actions-action-zoomOut') as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  test('focus returns to the dialog when the focused toolbar button becomes disabled', async () => {
    const { scope } = await show(() => markdown(one('a')));
    await open(scope);
    const zoomOut = dialog()!.querySelector('.aimd-image-preview-actions-action-zoomOut') as HTMLButtonElement;
    (dialog()!.querySelector('.aimd-image-preview-actions-action-zoomIn') as HTMLElement).click();
    await nextTick();
    zoomOut.focus();
    expect(document.activeElement).toBe(zoomOut);
    // Back at the natural size the button is disabled, and a disabled button receives no keys.
    zoomOut.click();
    await nextTick();
    expect(zoomOut.disabled).toBe(true);
    expect(document.activeElement).toBe(dialog());
  });

  test('preview options reach the controller: limits, switches and callbacks', async () => {
    const log: string[] = [];
    const Image = createMarkdownImage({
      preview: {
        scaleStep: 1,
        maxScale: 2,
        movable: false,
        onOpenChange: (open, info) => log.push(`open:${open}:${info.current}`),
        afterOpenChange: (open) => log.push(`after:${open}`),
        onChange: (current, previous) => log.push(`change:${previous}->${current}`),
        onTransform: ({ transform, action }) => log.push(`${action}:${transform.scale}`),
      },
    });
    const { scope } = await show(() => markdown([one('a'), one('b')].join('\n\n'), { components: { img: Image } }));
    await open(scope, 0);
    expect(log).toEqual(['open:true:0', 'after:true']);
    // Not movable: no grab cursor class, and a press starts nothing.
    expect(dialog()!.className).not.toContain('aimd-image-preview-movable');
    shown().dispatchEvent(pointer('pointerdown', 100, 100));
    await nextTick();
    expect(dialog()!.className).not.toContain('aimd-image-preview-moving');
    const zoomIn = () => dialog()!.querySelector('.aimd-image-preview-actions-action-zoomIn') as HTMLButtonElement;
    zoomIn().click();
    await nextTick();
    expect(shown().style.transform).toContain('scale3d(2, 2, 1)');
    expect(zoomIn().disabled).toBe(true);
    dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await nextTick();
    (dialog()!.querySelector('.aimd-image-preview-close') as HTMLElement).click();
    await nextTick();
    expect(log.slice(2)).toEqual(['zoomIn:2', 'next:1', 'change:0->1', 'open:false:1', 'after:false']);
  });

  test('the page behind cannot scroll: the root and the body are locked, and stray wheels are cancelled', async () => {
    const { scope } = await show(() => markdown(one('a')));
    document.documentElement.style.overflow = 'scroll';
    await open(scope);
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(document.body.style.overflow).toBe('hidden');
    // A wheel or a touch move over the mask is not the image's, and must not scroll the page either.
    for (const type of ['wheel', 'touchmove']) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      dialog()!.querySelector('.aimd-image-preview-mask')!.dispatchEvent(event);
      expect(event.defaultPrevented, type).toBe(true);
    }
    (dialog()!.querySelector('.aimd-image-preview-close') as HTMLElement).click();
    await nextTick();
    expect(document.documentElement.style.overflow).toBe('scroll');
    expect(document.body.style.overflow).toBe('');
    document.documentElement.style.overflow = '';
  });

  test('the preview closes when the source of its image changes', async () => {
    const content = ref(one('a'));
    const { scope, settle } = await show(() => markdown(content.value));
    await open(scope);
    content.value = one('other');
    await settle();
    expect(dialog()).toBeNull();
  });

  test('the toolbar is disabled until the previewed image has loaded, and a failure is reported', async () => {
    const { scope } = await show(() => markdown(one('a')));
    (scope.querySelector('button.aimd-image-trigger') as HTMLButtonElement).click();
    await nextTick();
    const zoomIn = () => dialog()!.querySelector('.aimd-image-preview-actions-action-zoomIn') as HTMLButtonElement;
    expect(zoomIn().disabled).toBe(true);
    expect(dialog()!.querySelector('.aimd-image-feedback')?.textContent).toBe('Loading image…');
    shown().dispatchEvent(new Event('error'));
    await nextTick();
    expect(dialog()!.querySelector('.aimd-image-feedback[role="alert"]')?.textContent).toBe(
      'Image could not be loaded.'
    );
    expect(zoomIn().disabled).toBe(true);
  });
});

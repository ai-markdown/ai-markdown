// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
// Imported by package name, like the component itself, so both share one React context.
import { AIMarkdown, AIMarkdownDocuments } from '@ai-markdown/react';
import type { ReactNode } from 'react';
import { MarkdownImage, createMarkdownImage } from './image';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has the dialog element but not its modal methods.
HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
  this.removeAttribute('open');
};

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

describe('preview dialog', () => {
  // The user prefers reduced motion: closing does not wait for a transition.
  beforeEach(() => {
    window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;
  });
  const dialog = () => document.querySelector('dialog.aimd-image-preview') as HTMLDialogElement | null;
  const shown = () => dialog()?.querySelector('img.aimd-image-preview-img') as HTMLImageElement;
  const open = async (scope: HTMLElement, index = 0) => {
    await act(async () => (scope.querySelectorAll('button.aimd-image-trigger')[index] as HTMLButtonElement).click());
    // Two frames take the preview out of its opening phase.
    await act(
      async () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    );
    await act(async () => shown().dispatchEvent(new Event('load')));
  };
  const pointer = (type: string, x: number, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    return event;
  };

  test('opens as a modal dialog on the image that was activated', async () => {
    const { container: scope } = await mount(images(3));
    await loadAll(scope);
    expect(dialog()).toBeNull();
    await open(scope, 1);
    expect(dialog()?.open).toBe(true);
    expect(dialog()?.getAttribute('data-phase')).toBe('open');
    expect(dialog()?.getAttribute('aria-label')).toBe('photo 1');
    expect(shown().src).toContain('photo-1.png');
    expect(counter()).toBe('2 / 3');
    // The page behind it does not scroll.
    expect(document.body.style.overflow).toBe('hidden');
  });

  test('it grows out of the activated thumbnail and shrinks back into the thumbnail of the image shown', async () => {
    // Closing takes its 300 ms here, so the leaving state can be observed.
    window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
    const { container: scope } = await mount(images(2));
    await loadAll(scope);
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
    await act(async () => dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    await act(async () => (dialog()!.querySelector('.aimd-image-preview-close') as HTMLElement).click());
    expect(dialog()!.getAttribute('data-phase')).toBe('closing');
    expect(body().style.transformOrigin).toBe('350px 430px');
    await act(async () => new Promise((resolve) => setTimeout(resolve, 320)));
    expect(dialog()).toBeNull();
  });

  test('arrow keys move through the gallery and the buttons at the ends are disabled', async () => {
    const { container: scope } = await mount(images(2));
    await loadAll(scope);
    await open(scope, 0);
    const previous = () => dialog()!.querySelector('.aimd-image-preview-switch-prev') as HTMLButtonElement;
    expect(previous().disabled).toBe(true);
    await act(async () => dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(counter()).toBe('2 / 2');
    expect(shown().src).toContain('photo-1.png');
    expect(previous().disabled).toBe(false);
    expect((dialog()!.querySelector('.aimd-image-preview-switch-next') as HTMLButtonElement).disabled).toBe(true);
  });

  test('Escape, the mask and the close button close it, and focus returns to the trigger', async () => {
    const { container: scope } = await mount(images(2));
    await loadAll(scope);
    const trigger = scope.querySelectorAll('button.aimd-image-trigger')[1] as HTMLButtonElement;
    for (const close of [
      () => dialog()!.dispatchEvent(new Event('cancel', { cancelable: true })),
      () => (dialog()!.querySelector('.aimd-image-preview-mask') as HTMLElement).click(),
      () => (dialog()!.querySelector('.aimd-image-preview-close') as HTMLElement).click(),
    ]) {
      await open(scope, 1);
      expect(dialog()).not.toBeNull();
      await act(async () => void close());
      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(trigger);
      expect(document.body.style.overflow).toBe('');
    }
  });

  test('a drag moves the image without a transition, and the toolbar transforms it', async () => {
    const { container: scope } = await mount(images(1));
    await loadAll(scope);
    await open(scope);
    await act(async () => void shown().dispatchEvent(pointer('pointerdown', 100, 100)));
    expect(dialog()!.className).toContain('aimd-image-preview-moving');
    await act(async () => {
      shown().dispatchEvent(pointer('pointermove', 130, 120));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(shown().style.transform).toContain('translate3d(30px, 20px, 0)');
    await act(async () => void shown().dispatchEvent(pointer('pointerup', 130, 120)));
    expect(dialog()!.className).not.toContain('aimd-image-preview-moving');
    // jsdom lays nothing out, so the image "fits" and returns to the centre.
    expect(shown().style.transform).toContain('translate3d(0px, 0px, 0)');
    await act(async () =>
      (dialog()!.querySelector('.aimd-image-preview-actions-action-rotateRight') as HTMLElement).click()
    );
    await act(async () => (dialog()!.querySelector('.aimd-image-preview-actions-action-flipX') as HTMLElement).click());
    expect(shown().style.transform).toContain('scale3d(-1, 1, 1) rotate(90deg)');
    expect((dialog()!.querySelector('.aimd-image-preview-actions-action-zoomOut') as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  test('focus returns to the dialog when the focused toolbar button becomes disabled', async () => {
    const { container: scope } = await mount(images(1));
    await loadAll(scope);
    await open(scope);
    const zoomOut = dialog()!.querySelector('.aimd-image-preview-actions-action-zoomOut') as HTMLButtonElement;
    await act(async () =>
      (dialog()!.querySelector('.aimd-image-preview-actions-action-zoomIn') as HTMLElement).click()
    );
    zoomOut.focus();
    expect(document.activeElement).toBe(zoomOut);
    // Back at the natural size the button is disabled, and a disabled button receives no keys.
    await act(async () => zoomOut.click());
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
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root!.render(<AIMarkdown content={images(2)} customComponents={{ img: Image }} />));
    await loadAll(container);
    await open(container, 0);
    expect(log).toEqual(['open:true:0', 'after:true']);
    // Not movable: no grab cursor class, and a press starts nothing.
    expect(dialog()!.className).not.toContain('aimd-image-preview-movable');
    await act(async () => void shown().dispatchEvent(pointer('pointerdown', 100, 100)));
    expect(dialog()!.className).not.toContain('aimd-image-preview-moving');
    const zoomIn = () => dialog()!.querySelector('.aimd-image-preview-actions-action-zoomIn') as HTMLButtonElement;
    await act(async () => zoomIn().click());
    expect(shown().style.transform).toContain('scale3d(2, 2, 1)');
    expect(zoomIn().disabled).toBe(true);
    await act(async () => dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    await act(async () => (dialog()!.querySelector('.aimd-image-preview-close') as HTMLElement).click());
    expect(log.slice(2)).toEqual(['zoomIn:2', 'next:1', 'change:0->1', 'open:false:1', 'after:false']);
  });

  test('the page behind cannot scroll: the root and the body are locked, and stray wheels are cancelled', async () => {
    const { container: scope } = await mount(images(1));
    await loadAll(scope);
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
    await act(async () => (dialog()!.querySelector('.aimd-image-preview-close') as HTMLElement).click());
    expect(document.documentElement.style.overflow).toBe('scroll');
    expect(document.body.style.overflow).toBe('');
    document.documentElement.style.overflow = '';
  });

  test('the preview closes when the source of its image changes', async () => {
    const { render, container: scope } = await mount(images(1));
    await loadAll(scope);
    await open(scope);
    await render('![photo 0](https://example.test/p/other.png)\n\n');
    expect(dialog()).toBeNull();
  });

  test('the toolbar is disabled until the previewed image has loaded, and a failure is reported', async () => {
    const { container: scope } = await mount(images(1));
    await loadAll(scope);
    await act(async () => (scope.querySelector('button.aimd-image-trigger') as HTMLButtonElement).click());
    const zoomIn = () => dialog()!.querySelector('.aimd-image-preview-actions-action-zoomIn') as HTMLButtonElement;
    expect(zoomIn().disabled).toBe(true);
    expect(dialog()!.querySelector('.aimd-image-feedback')?.textContent).toBe('Loading image…');
    await act(async () => shown().dispatchEvent(new Event('error')));
    expect(dialog()!.querySelector('.aimd-image-feedback[role="alert"]')?.textContent).toBe(
      'Image could not be loaded.'
    );
    expect(zoomIn().disabled).toBe(true);
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

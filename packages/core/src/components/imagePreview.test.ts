import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getImageGallery, type ImageGalleryItem } from './image';
import { createImagePreviewController, type ImagePreviewOptions, type ImagePreviewState } from './imagePreview';
import type { ImageGeometry } from './imageTransform';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A 600x400 image centred in a 1000x800 viewport. */
const BOX: ImageGeometry = { width: 600, height: 400, left: 200, top: 200, viewportWidth: 1000, viewportHeight: 800 };

/** A page: a gallery of images in insertion order, a frame queue run by hand, and the states published. */
function page(count = 3, closeDuration?: number | (() => number), options: ImagePreviewOptions = {}) {
  const order: object[] = [];
  const gallery = getImageGallery({});
  const add = (name: string): ImageGalleryItem => {
    const id = { name };
    order.push(id);
    const item = {
      id,
      src: `${name}.png`,
      alt: name,
      precedes: (other: object) => order.indexOf(id) < order.indexOf(other),
    };
    gallery.set(item);
    return item;
  };
  const images = Array.from({ length: count }, (_, i) => add(`image-${i}`));
  let frames: Array<() => void> = [];
  const states: ImagePreviewState[] = [];
  let geometry: ImageGeometry | undefined = BOX;
  const anchors = new Map<object, { x: number; y: number }>();
  const controller = createImagePreviewController(
    {
      geometry: () => geometry,
      anchor: (id) => anchors.get(id),
      frame: (callback) => {
        frames.push(callback);
        return () => {
          frames = frames.filter((entry) => entry !== callback);
        };
      },
    },
    (state) => states.push(state),
    { closeDuration, ...options }
  );
  /** Runs the frames queued so far; frames they queue wait for the next call. */
  const frame = () => {
    const due = frames;
    frames = [];
    due.forEach((callback) => callback());
  };
  /** Opens on an image, lets the opening frames pass and reports the image as loaded. */
  const show = (index = 0) => {
    controller.open(gallery, images[index].id);
    frame();
    frame();
    controller.loaded();
  };
  return {
    controller,
    gallery,
    images,
    add,
    anchors,
    states,
    frame,
    show,
    pending: () => frames.length,
    state: () => controller.state(),
    setGeometry: (next: ImageGeometry | undefined) => (geometry = next),
  };
}

describe('opening and closing', () => {
  test('a preview opens through a starting phase and closes through a leaving one', () => {
    const { controller, gallery, images, states, frame, state } = page();
    expect(state().phase).toBe('closed');
    expect(controller.open(gallery, images[1].id)).toBe(true);
    expect(state()).toMatchObject({ phase: 'opening', current: 1, status: 'loading' });
    frame();
    expect(state().phase).toBe('opening');
    frame();
    expect(state().phase).toBe('open');
    controller.close();
    expect(state().phase).toBe('closing');
    // The image stays up while it leaves.
    expect(state().item).toBe(images[1]);
    vi.advanceTimersByTime(299);
    expect(state().phase).toBe('closing');
    vi.advanceTimersByTime(1);
    expect(state()).toMatchObject({ phase: 'closed', current: -1, items: [] });
    expect(states.map((entry) => entry.phase)).toEqual(['opening', 'open', 'closing', 'closed']);
  });

  test('it opens from the anchor of its image and closes into the anchor of the image then shown', () => {
    const { controller, gallery, images, frame, state, anchors } = page(3);
    anchors.set(images[0].id, { x: 120, y: 340 });
    anchors.set(images[1].id, { x: 500, y: 90 });
    controller.open(gallery, images[0].id);
    expect(state().origin).toEqual({ x: 120, y: 340 });
    frame();
    frame();
    // Navigation keeps the point: nothing scales while the preview is open.
    controller.go(1);
    expect(state().origin).toEqual({ x: 120, y: 340 });
    controller.close();
    expect(state()).toMatchObject({ phase: 'closing', origin: { x: 500, y: 90 } });
    vi.advanceTimersByTime(300);
    expect(state().origin).toBeUndefined();
  });

  test('an image with no anchor, or one that is not a number, uses the centre', () => {
    const { controller, gallery, images, frame, state, anchors } = page(2, 0);
    controller.open(gallery, images[0].id);
    expect(state().origin).toBeUndefined();
    controller.close();
    anchors.set(images[0].id, { x: Number.NaN, y: 10 });
    controller.open(gallery, images[0].id);
    expect(state().origin).toBeUndefined();
    frame();
    frame();
    // The thumbnail scrolled into view meanwhile: closing can go back into it.
    anchors.set(images[0].id, { x: 40, y: 60 });
    controller.go(0);
    controller.close();
    expect(state().phase).toBe('closed');
  });

  test('an id the gallery does not have opens nothing', () => {
    const { controller, gallery, states } = page();
    expect(controller.open(gallery, {})).toBe(false);
    expect(states).toEqual([]);
  });

  test('a zero close duration closes at once, and a function is read at each close', () => {
    let duration = 0;
    const view = page(1, () => duration);
    view.show();
    view.controller.close();
    expect(view.state().phase).toBe('closed');
    duration = 120;
    view.show();
    view.controller.close();
    expect(view.state().phase).toBe('closing');
    vi.advanceTimersByTime(120);
    expect(view.state().phase).toBe('closed');
  });

  test('opening again while the preview is leaving cancels the close', () => {
    const { controller, gallery, images, frame, state } = page();
    controller.open(gallery, images[0].id);
    frame();
    frame();
    controller.close();
    controller.open(gallery, images[2].id);
    vi.advanceTimersByTime(1000);
    frame();
    frame();
    expect(state()).toMatchObject({ phase: 'open', current: 2 });
  });

  test('opening on another image while still opening restarts the opening and completes it', () => {
    const { controller, gallery, images, frame, state, pending } = page();
    controller.open(gallery, images[0].id);
    frame();
    controller.open(gallery, images[1].id);
    expect(state()).toMatchObject({ phase: 'opening', current: 1 });
    frame();
    frame();
    expect(state().phase).toBe('open');
    expect(pending()).toBe(0);
    // Open already: switching images does not go through the starting style again.
    controller.open(gallery, images[2].id);
    expect(state()).toMatchObject({ phase: 'open', current: 2 });
  });

  test('closing before the opening frames have run leaves no frame behind', () => {
    const { controller, gallery, images, frame, state, pending } = page(1, 0);
    controller.open(gallery, images[0].id);
    controller.close();
    expect(pending()).toBe(0);
    frame();
    expect(state().phase).toBe('closed');
  });

  test('dispose stops the timers and the gallery subscription', () => {
    const { controller, gallery, images, add, states, state } = page();
    controller.open(gallery, images[0].id);
    controller.close();
    controller.dispose();
    const published = states.length;
    vi.advanceTimersByTime(1000);
    add('late');
    expect(states.length).toBe(published);
    expect(state().phase).toBe('closed');
  });
});

describe('gallery', () => {
  test('arrow keys and the toolbar move through the images and stop at the ends', () => {
    const { controller, show, state } = page();
    show(0);
    expect(state()).toMatchObject({ canPrevious: false, canNext: true });
    expect(controller.key('ArrowLeft')).toBe(true);
    expect(state().current).toBe(0);
    expect(controller.key('ArrowRight')).toBe(true);
    controller.action('next');
    expect(state()).toMatchObject({ current: 2, canPrevious: true, canNext: false });
    controller.go(1);
    expect(state().current).toBe(2);
    controller.action('prev');
    expect(state().current).toBe(1);
    expect(controller.key('Enter')).toBe(false);
  });

  test('a single image has no navigation keys', () => {
    const { controller, show } = page(1);
    show();
    expect(controller.key('ArrowRight')).toBe(false);
  });

  test('switching images starts from a clean view', () => {
    const { controller, show, state } = page();
    show(0);
    controller.action('zoomIn');
    controller.action('rotateRight');
    controller.go(1);
    expect(state()).toMatchObject({ status: 'loading', transform: { scale: 1, rotate: 0, x: 0, y: 0 } });
  });

  test('images added or removed while open keep the same image selected', () => {
    const { controller, gallery, images, add, show, state } = page();
    show(1);
    controller.go(1);
    add('image-3');
    expect(state()).toMatchObject({ current: 2, canNext: true });
    expect(state().items).toHaveLength(4);
    gallery.remove(images[0].id);
    expect(state()).toMatchObject({ current: 1, item: images[2] });
    expect(state().items).toHaveLength(3);
  });

  test('the preview closes when the image shown leaves the gallery', () => {
    const { gallery, images, show, state } = page();
    show(1);
    gallery.remove(images[1].id);
    expect(state().phase).toBe('closing');
  });

  test('a new source for the image shown resets its view', () => {
    const { controller, gallery, images, show, state } = page();
    show(0);
    controller.action('zoomIn');
    gallery.set({ ...images[0], src: 'other.png' });
    expect(state()).toMatchObject({ status: 'loading', transform: { scale: 1 }, item: { src: 'other.png' } });
  });

  test('a closed preview no longer follows the gallery', () => {
    const { controller, add, show, states } = page(1, 0);
    show();
    controller.close();
    const published = states.length;
    add('later');
    expect(states.length).toBe(published);
  });
});

describe('toolbar', () => {
  test('zoom steps by 1.5 between 1 and 50, and the buttons follow', () => {
    const { controller, show, state } = page();
    show();
    expect(state()).toMatchObject({ canZoomIn: true, canZoomOut: false });
    controller.action('zoomIn');
    expect(state().transform.scale).toBe(1.5);
    expect(state().canZoomOut).toBe(true);
    for (let i = 0; i < 20; i++) controller.action('zoomIn');
    expect(state().transform.scale).toBe(50);
    expect(state().canZoomIn).toBe(false);
    for (let i = 0; i < 20; i++) controller.action('zoomOut');
    expect(state().transform).toMatchObject({ scale: 1, x: 0, y: 0 });
  });

  test('rotate and flip change only their own part of the transform', () => {
    const { controller, show, state } = page();
    show();
    controller.action('rotateRight');
    controller.action('rotateRight');
    controller.action('rotateLeft');
    controller.action('flipX');
    controller.action('flipY');
    controller.action('flipY');
    expect(state().transform).toEqual({ x: 0, y: 0, scale: 1, rotate: 90, flipX: true, flipY: false });
  });

  test('nothing transforms an image that has not loaded, or one that failed', () => {
    const { controller, gallery, images, frame, state } = page();
    controller.open(gallery, images[0].id);
    frame();
    frame();
    controller.action('zoomIn');
    controller.action('rotateRight');
    expect(controller.pointerDown({ id: 1, x: 500, y: 400, button: 0 })).toBe(false);
    expect(controller.wheel({ deltaY: -100, x: 500, y: 400 })).toBe(false);
    controller.failed();
    controller.action('flipX');
    expect(state()).toMatchObject({
      status: 'error',
      canZoomIn: false,
      transform: { scale: 1, rotate: 0, flipX: false },
    });
    // Navigation and close still work.
    controller.action('next');
    expect(state().current).toBe(1);
  });
});

describe('pointer', () => {
  test('one pointer drags, and the image follows at most once per frame', () => {
    const { controller, show, states, frame, state } = page();
    show();
    controller.action('zoomIn');
    controller.action('zoomIn');
    controller.action('zoomIn');
    expect(controller.pointerDown({ id: 1, x: 500, y: 400, button: 0 })).toBe(true);
    expect(state().moving).toBe(true);
    const published = states.length;
    controller.pointerMove({ id: 1, x: 520, y: 400 });
    controller.pointerMove({ id: 1, x: 540, y: 410 });
    controller.pointerMove({ id: 1, x: 560, y: 430 });
    // Nothing is published before the frame, and the frame has every move applied.
    expect(states.length).toBe(published);
    frame();
    expect(states.length).toBe(published + 1);
    expect(state().transform).toMatchObject({ x: 60, y: 30 });
    controller.pointerUp(1);
    expect(state().moving).toBe(false);
  });

  test('only the main button starts a drag, and an unknown pointer does nothing', () => {
    const { controller, show, states } = page();
    show();
    expect(controller.pointerDown({ id: 1, x: 500, y: 400, button: 2 })).toBe(false);
    const published = states.length;
    controller.pointerMove({ id: 7, x: 1, y: 1 });
    controller.pointerUp(7);
    expect(states.length).toBe(published);
  });

  test('a drag along one axis is put back in bounds too', () => {
    const { controller, show, state } = page();
    show();
    // The image fits the viewport, so any displacement returns to the centre.
    controller.pointerDown({ id: 1, x: 500, y: 400, button: 0 });
    controller.pointerMove({ id: 1, x: 620, y: 400 });
    expect(state().transform.x).toBe(120);
    controller.pointerUp(1);
    expect(state().transform).toMatchObject({ x: 0, y: 0 });
    controller.pointerDown({ id: 1, x: 500, y: 400, button: 0 });
    controller.pointerMove({ id: 1, x: 500, y: 300 });
    controller.pointerUp(1);
    expect(state().transform).toMatchObject({ x: 0, y: 0 });
  });

  test('a press without movement leaves the image where it is', () => {
    const { controller, show, state } = page();
    show();
    controller.action('zoomIn');
    controller.action('zoomIn');
    controller.pointerDown({ id: 1, x: 500, y: 400, button: 0 });
    controller.pointerMove({ id: 1, x: 300, y: 400 });
    controller.pointerUp(1);
    const rested = state().transform;
    controller.pointerDown({ id: 1, x: 500, y: 400, button: 0 });
    controller.pointerUp(1);
    expect(state().transform).toEqual(rested);
  });

  test('a large image stops at the viewport edges', () => {
    const { controller, show, state } = page();
    show();
    // 4x: 2400x1600 in a 1000x800 viewport.
    for (const scale of [2, 2]) {
      void scale;
      controller.wheel({ deltaY: -100, x: 500, y: 400 });
      controller.wheel({ deltaY: -100, x: 500, y: 400 });
    }
    const { scale } = state().transform;
    const limitX = (BOX.width * scale - BOX.viewportWidth) / 2;
    const limitY = (BOX.height * scale - BOX.viewportHeight) / 2;
    controller.pointerDown({ id: 1, x: 500, y: 400, button: 0 });
    controller.pointerMove({ id: 1, x: 500 + 5000, y: 400 + 5000 });
    controller.pointerUp(1);
    expect(state().transform.x).toBeCloseTo(limitX, 9);
    expect(state().transform.y).toBeCloseTo(limitY, 9);
    controller.pointerDown({ id: 1, x: 500, y: 400, button: 0 });
    controller.pointerMove({ id: 1, x: 500 - 9000, y: 400 - 9000 });
    controller.pointerUp(1);
    expect(state().transform.x).toBeCloseTo(-limitX, 9);
    expect(state().transform.y).toBeCloseTo(-limitY, 9);
  });

  test('a quarter turn swaps the sides the bounds are measured with', () => {
    const { controller, show, state } = page();
    show();
    controller.action('rotateRight');
    for (let i = 0; i < 3; i++) controller.wheel({ deltaY: -100, x: 500, y: 400 });
    const { scale } = state().transform;
    // Turned, the 400 side lies along the viewport width.
    const limitX = (BOX.height * scale - BOX.viewportWidth) / 2;
    controller.pointerDown({ id: 1, x: 500, y: 400, button: 0 });
    controller.pointerMove({ id: 1, x: 500 + 5000, y: 400 });
    controller.pointerUp(1);
    expect(state().transform.x).toBeCloseTo(limitX, 9);
  });

  test('two pointers pinch about their centre and may go below the natural size until they lift', () => {
    const { controller, show, state } = page();
    show();
    controller.pointerDown({ id: 1, x: 400, y: 400, button: 0 });
    controller.pointerDown({ id: 2, x: 600, y: 400, button: 0 });
    controller.pointerMove({ id: 2, x: 700, y: 400 });
    expect(state().transform.scale).toBeCloseTo(1.5, 12);
    // Only the second finger moved, so the first one is the fixed point.
    expect(state().transform.x).toBeCloseTo(50, 9);
    controller.pointerMove({ id: 2, x: 460, y: 400 });
    expect(state().transform.scale).toBeLessThan(1);
    controller.pointerUp(2);
    // One finger is still down: the image keeps its size and follows that finger.
    expect(state().transform.scale).toBeLessThan(1);
    expect(state().moving).toBe(true);
    controller.pointerMove({ id: 1, x: 420, y: 400 });
    controller.pointerUp(1);
    expect(state().transform).toMatchObject({ scale: 1, x: 0, y: 0 });
    expect(state().moving).toBe(false);
  });

  test('an image pinched below its natural size returns to it even when it can no longer be measured', () => {
    const { controller, show, state, setGeometry } = page();
    show();
    controller.pointerDown({ id: 1, x: 400, y: 400, button: 0 });
    controller.pointerDown({ id: 2, x: 600, y: 400, button: 0 });
    controller.pointerMove({ id: 2, x: 460, y: 400 });
    expect(state().transform.scale).toBeLessThan(1);
    setGeometry(undefined);
    controller.pointerUp(1);
    controller.pointerUp(2);
    expect(state().transform).toMatchObject({ scale: 1, x: 0, y: 0 });
  });

  test('a third pointer does not join a pinch', () => {
    const { controller, show } = page();
    show();
    controller.pointerDown({ id: 1, x: 400, y: 400, button: 0 });
    controller.pointerDown({ id: 2, x: 600, y: 400, button: 0 });
    expect(controller.pointerDown({ id: 3, x: 500, y: 500, button: 0 })).toBe(false);
  });

  test('closing or switching in the middle of a drag ends the drag', () => {
    const { controller, show, state } = page();
    show();
    controller.pointerDown({ id: 1, x: 500, y: 400, button: 0 });
    controller.go(1);
    expect(state().moving).toBe(false);
    controller.loaded();
    controller.pointerMove({ id: 1, x: 900, y: 400 });
    expect(state().transform.x).toBe(0);
  });
});

describe('wheel and double click', () => {
  test('the wheel zooms about the pointer and reports that it was used', () => {
    const { controller, show, frame, state } = page();
    show();
    expect(controller.wheel({ deltaY: -100, x: 700, y: 500 })).toBe(true);
    frame();
    // The image point under (700, 500) stays there: see imageTransform.test.ts.
    expect(state().transform).toMatchObject({ scale: 1.5, x: -100, y: -50 });
    expect(controller.wheel({ deltaY: 0, x: 700, y: 500 })).toBe(false);
  });

  test('line deltas and a trackpad pinch are scaled sensibly', () => {
    const { controller, show, state } = page();
    show();
    controller.wheel({ deltaY: -3, mode: 1, x: 500, y: 400 });
    expect(state().transform.scale).toBe(1.5);
    controller.wheel({ deltaY: -10, pinch: true, x: 500, y: 400 });
    expect(state().transform.scale).toBeCloseTo(1.5 * Math.exp(0.1), 12);
  });

  test('a double click zooms one step about the point, then returns to the natural size', () => {
    const { controller, show, state } = page();
    show();
    controller.doubleClick(700, 500);
    expect(state().transform).toMatchObject({ scale: 1.5, x: -100, y: -50 });
    controller.doubleClick(100, 100);
    expect(state().transform).toMatchObject({ scale: 1, x: 0, y: 0 });
  });

  test('without a measured image nothing zooms', () => {
    const { controller, show, state, setGeometry } = page();
    show();
    setGeometry(undefined);
    controller.action('zoomIn');
    controller.wheel({ deltaY: -100, x: 1, y: 1 });
    expect(state().transform.scale).toBe(1);
  });
});

describe('options', () => {
  test('scaleStep sets the step of the toolbar, the double click and a wheel notch', () => {
    const { controller, show, state } = page(1, 0, { scaleStep: 1 });
    show();
    controller.action('zoomIn');
    expect(state().transform.scale).toBe(2);
    controller.action('zoomOut');
    expect(state().transform.scale).toBe(1);
    controller.wheel({ deltaY: -100, x: 500, y: 400 });
    expect(state().transform.scale).toBe(2);
    controller.doubleClick(500, 400);
    controller.doubleClick(500, 400);
    expect(state().transform.scale).toBe(2);
  });

  test('minScale and maxScale bound the zoom, the buttons, and where a pinch returns to', () => {
    const { controller, show, state } = page(1, 0, { minScale: 0.5, maxScale: 3 });
    show();
    expect(state()).toMatchObject({ canZoomOut: true, canZoomIn: true });
    controller.action('zoomOut');
    controller.action('zoomOut');
    expect(state().transform.scale).toBe(0.5);
    expect(state().canZoomOut).toBe(false);
    for (let i = 0; i < 9; i++) controller.action('zoomIn');
    expect(state().transform.scale).toBe(3);
    expect(state().canZoomIn).toBe(false);
    controller.pointerDown({ id: 1, x: 400, y: 400, button: 0 });
    controller.pointerDown({ id: 2, x: 600, y: 400, button: 0 });
    controller.pointerMove({ id: 2, x: 410, y: 400 });
    expect(state().transform.scale).toBeLessThan(0.5);
    controller.pointerUp(1);
    controller.pointerUp(2);
    expect(state().transform).toMatchObject({ scale: 0.5, x: 0, y: 0 });
  });

  test('values that are not positive numbers fall back to the defaults', () => {
    const { controller, show, state } = page(1, 0, { scaleStep: 0, minScale: -2, maxScale: Number.NaN });
    show();
    controller.action('zoomIn');
    expect(state().transform.scale).toBe(1.5);
    expect(state().canZoomOut).toBe(true);
    for (let i = 0; i < 20; i++) controller.action('zoomIn');
    expect(state().transform.scale).toBe(50);
  });

  test('movable: false ignores pointers; wheel: false ignores the wheel; the toolbar still works', () => {
    const { controller, show, state } = page(1, 0, { movable: false, wheel: false });
    show();
    expect(state().movable).toBe(false);
    expect(controller.pointerDown({ id: 1, x: 500, y: 400, button: 0 })).toBe(false);
    controller.pointerMove({ id: 1, x: 600, y: 400 });
    expect(controller.wheel({ deltaY: -100, x: 500, y: 400 })).toBe(false);
    expect(state()).toMatchObject({ moving: false, transform: { x: 0, scale: 1 } });
    controller.action('zoomIn');
    controller.doubleClick(500, 400);
    expect(state().transform.scale).toBe(1);
  });
});

describe('events', () => {
  const recorder = () => {
    const log: string[] = [];
    const options: ImagePreviewOptions = {
      onOpenChange: (open, info) => log.push(`open:${open}:${info.current}:${info.item?.alt}`),
      afterOpenChange: (open) => log.push(`after:${open}`),
      onChange: (current, previous) => log.push(`change:${previous}->${current}`),
      onTransform: ({ transform, action }) =>
        log.push(`${action}:${transform.scale}:${transform.x}:${transform.rotate}`),
    };
    return { log, options };
  };

  test('opening, navigating and closing are reported in order, after the state shows them', () => {
    const { log, options } = recorder();
    const view = page(3, undefined, options);
    view.controller.open(view.gallery, view.images[1].id);
    expect(log).toEqual(['open:true:1:image-1']);
    view.frame();
    view.frame();
    expect(log.at(-1)).toBe('after:true');
    view.controller.loaded();
    view.controller.go(1);
    view.controller.go(1);
    expect(log.slice(2)).toEqual(['change:1->2']);
    view.controller.close();
    expect(log.at(-1)).toBe('open:false:2:image-2');
    vi.advanceTimersByTime(300);
    expect(log.at(-1)).toBe('after:false');
    // Each report came after a published state.
    expect(view.states.at(-1)?.phase).toBe('closed');
  });

  test('opening again while opening is one opening', () => {
    const { log, options } = recorder();
    const view = page(3, 0, options);
    view.controller.open(view.gallery, view.images[0].id);
    view.frame();
    view.controller.open(view.gallery, view.images[1].id);
    view.frame();
    view.frame();
    expect(log).toEqual(['open:true:0:image-0', 'after:true']);
  });

  test('each discrete action reports its transform once; an unchanged transform reports nothing', () => {
    const { log, options } = recorder();
    const view = page(2, 0, options);
    view.show();
    log.length = 0;
    view.controller.action('zoomIn');
    view.controller.action('rotateRight');
    view.controller.action('zoomOut');
    // Already at the smallest scale: nothing changes, nothing is reported.
    view.controller.action('zoomOut');
    view.controller.doubleClick(500, 400);
    expect(log).toEqual(['zoomIn:1.5:0:0', 'rotateRight:1.5:0:90', 'zoomOut:1:0:90', 'doubleClick:1.5:0:90']);
  });

  test('a drag and a wheel burst report once per frame, then the rebound and the reset on navigation', () => {
    const { log, options } = recorder();
    const view = page(2, 0, options);
    view.show();
    log.length = 0;
    view.controller.pointerDown({ id: 1, x: 500, y: 400, button: 0 });
    view.controller.pointerMove({ id: 1, x: 510, y: 400 });
    view.controller.pointerMove({ id: 1, x: 540, y: 400 });
    expect(log).toEqual([]);
    view.frame();
    expect(log).toEqual(['move:1:40:0']);
    view.controller.pointerUp(1);
    expect(log.at(-1)).toBe('rebound:1:0:0');
    view.controller.wheel({ deltaY: -100, x: 500, y: 400 });
    view.controller.wheel({ deltaY: -100, x: 500, y: 400 });
    view.frame();
    expect(log.at(-1)).toBe('wheel:2.25:0:0');
    log.length = 0;
    view.controller.go(1);
    expect(log).toEqual(['next:1:0:0', 'change:0->1']);
    // The new image is already clean, so going back reports the change of image only.
    view.controller.go(-1);
    expect(log.slice(2)).toEqual(['change:1->0']);
  });
});

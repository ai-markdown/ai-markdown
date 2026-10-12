/** The image preview as state and rules, with no framework and no DOM.
 * Interaction rules adapted from @rc-component/image 1.10.0 (MIT, Copyright (c) 2019-present react-component; see LICENSE). */
import type { ImageActionIconName, ImageGallery, ImageGalleryItem, ImageLoadStatus } from './image';
import {
  imagePinchCenter,
  imageWheelRatio,
  initialImageTransform,
  reboundImage,
  zoomImage,
  type ImageGeometry,
  type ImageTransform,
} from './imageTransform';

/**
 * - `closed`: nothing to render.
 * - `opening`: rendered in its starting style, for the frames a transition needs to start from.
 * - `open`: the resting state.
 * - `closing`: still rendered, in its leaving style, until the close duration has passed.
 */
export type ImagePreviewPhase = 'closed' | 'opening' | 'open' | 'closing';

export interface ImagePreviewState {
  phase: ImagePreviewPhase;
  /** The gallery in document order. It follows the gallery while the preview is open. */
  items: readonly ImageGalleryItem[];
  /** Index of the image shown, or -1 while closed. */
  current: number;
  item: ImageGalleryItem | undefined;
  transform: ImageTransform;
  /** Load state of the image shown. */
  status: ImageLoadStatus;
  /** A drag or a pinch is in progress: the image follows the pointer without a transition. */
  moving: boolean;
  canPrevious: boolean;
  canNext: boolean;
  canZoomIn: boolean;
  canZoomOut: boolean;
}

/** What the controller needs from the page. */
export interface ImagePreviewHost {
  /** Layout box of the image shown, before its transform, and the viewport. Undefined while there is no image. */
  geometry(): ImageGeometry | undefined;
  /** Runs the callback before the next paint and returns a cancel function. `requestAnimationFrame` in a browser. */
  frame(callback: () => void): () => void;
}

export interface ImagePreviewOptions {
  /** How long the leaving style stays up, in milliseconds. Zero closes at once. A function is read at each close,
   * so a host can answer zero while the user prefers reduced motion. Default 300. */
  closeDuration?: number | (() => number);
}

export interface ImagePointer {
  /** Pointer id: one drag, or one finger of a pinch. */
  id: number;
  x: number;
  y: number;
  /** `PointerEvent.button`. Only the main button starts a gesture. */
  button?: number;
}

const ZOOM_STEP = 1.5;
const MAX_SCALE = 50;
const CLOSE_MS = 300;

const closedState: ImagePreviewState = Object.freeze({
  phase: 'closed',
  items: Object.freeze([]),
  current: -1,
  item: undefined,
  transform: initialImageTransform(),
  status: 'loading',
  moving: false,
  canPrevious: false,
  canNext: false,
  canZoomIn: false,
  canZoomOut: false,
});

/**
 * One image preview: which image of a gallery is shown, how it is transformed,
 * and where it is in opening and closing. The host forwards its events as plain
 * numbers and draws each state it is given.
 *
 * - `open(gallery, id)` shows the image registered under `id` and follows the
 *   gallery from then on: images added or removed while the preview is open
 *   update the list, and the preview closes when the image shown leaves it.
 * - Pointer input is one model for mouse, pen and touch. One pointer drags.
 *   Two pointers pinch, around a centre weighted by how far each one moved. A
 *   pinch may shrink the image below its natural size; when the last pointer
 *   lifts the image snaps back inside the viewport. The host should capture
 *   the pointer when `pointerDown` returns true, so a drag that leaves the
 *   window or its frame still ends.
 * - Drag and wheel updates reach `publish` at most once per frame; everything
 *   else is published at once. Each update is applied to the current state, so
 *   several in one frame add up.
 * - Switching images resets the transform. Zoom is limited to 1x to 50x in
 *   1.5x steps, about the pointer for the wheel and a double click, about the
 *   viewport centre for the toolbar.
 */
export function createImagePreviewController(
  host: ImagePreviewHost,
  publish: (state: ImagePreviewState) => void,
  options: ImagePreviewOptions = {}
) {
  let phase: ImagePreviewPhase = 'closed';
  let items: readonly ImageGalleryItem[] = [];
  let selected: object | undefined;
  let current = -1;
  let transform = initialImageTransform();
  let status: ImageLoadStatus = 'loading';
  let moving = false;

  let unsubscribe: (() => void) | undefined;
  let cancelPublish: (() => void) | undefined;
  let cancelOpening: (() => void) | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  /** Pointers that are down, in the order they arrived. */
  const pointers = new Map<number, { x: number; y: number }>();
  /** Offset between the dragging pointer and the image position. */
  let grip: { x: number; y: number } | undefined;
  /** The gesture moved or scaled the image, so it has to be put back in bounds when it ends. */
  let displaced = false;

  const snapshot = (): ImagePreviewState => {
    if (phase === 'closed') return closedState;
    const ready = status === 'ready';
    return {
      phase,
      items,
      current,
      item: items[current],
      transform,
      status,
      moving,
      canPrevious: current > 0,
      canNext: current < items.length - 1,
      canZoomIn: ready && transform.scale < MAX_SCALE,
      canZoomOut: ready && transform.scale > 1,
    };
  };
  const emit = () => {
    cancelPublish?.();
    cancelPublish = undefined;
    publish(snapshot());
  };
  const emitNextFrame = () => {
    cancelPublish ??= host.frame(() => {
      cancelPublish = undefined;
      publish(snapshot());
    });
  };
  const endGesture = () => {
    pointers.clear();
    grip = undefined;
    displaced = false;
    moving = false;
  };
  /** A new image, or the same image with another source: start from a clean view. */
  const startImage = () => {
    transform = initialImageTransform();
    status = 'loading';
    endGesture();
  };
  const zoom = (ratio: number, x?: number, y?: number, touch = false) => {
    const box = host.geometry();
    if (box && status === 'ready') transform = zoomImage(transform, ratio, box, x, y, touch);
  };
  /** Where the transformed image sits, from the numbers alone: the page may not have drawn the latest transform yet. */
  const rebound = () => {
    // Below the natural size the image goes back to it, measured or not.
    if (transform.scale < 1) {
      transform = { ...transform, x: 0, y: 0, scale: 1 };
      return;
    }
    const box = host.geometry();
    if (!box) return;
    const turned = transform.rotate % 180 !== 0;
    const width = (turned ? box.height : box.width) * transform.scale;
    const height = (turned ? box.width : box.height) * transform.scale;
    transform = reboundImage(transform, box, {
      left: box.left + box.width / 2 + transform.x - width / 2,
      top: box.top + box.height / 2 + transform.y - height / 2,
    });
  };
  const finishClosing = () => {
    closeTimer = undefined;
    phase = 'closed';
    items = [];
    selected = undefined;
    current = -1;
    emit();
  };
  const close = () => {
    if (phase === 'closed' || phase === 'closing') return;
    cancelOpening?.();
    cancelOpening = undefined;
    unsubscribe?.();
    unsubscribe = undefined;
    endGesture();
    phase = 'closing';
    const duration =
      typeof options.closeDuration === 'function' ? options.closeDuration() : (options.closeDuration ?? CLOSE_MS);
    if (duration > 0) {
      emit();
      closeTimer = setTimeout(finishClosing, duration);
    } else finishClosing();
  };
  const go = (delta: number) => {
    const target = current + delta;
    if (phase === 'closed' || phase === 'closing' || target < 0 || target >= items.length || target === current) return;
    current = target;
    selected = items[target].id;
    startImage();
    emit();
  };
  /** The gallery changed: keep showing the same image at its new index, or close when it is gone. */
  const follow = (gallery: ImageGallery) => {
    const next = gallery.items();
    const index = next.findIndex((item) => item.id === selected);
    if (index < 0) return close();
    if (next[index].src !== items[current]?.src) startImage();
    items = next;
    current = index;
    emit();
  };

  return {
    state: snapshot,
    /** Shows the image registered under `id`. False when the gallery has no such image. */
    open(gallery: ImageGallery, id: object): boolean {
      const list = gallery.items();
      const index = list.findIndex((item) => item.id === id);
      if (index < 0) return false;
      if (closeTimer !== undefined) clearTimeout(closeTimer);
      closeTimer = undefined;
      unsubscribe?.();
      cancelOpening?.();
      items = list;
      current = index;
      selected = id;
      startImage();
      unsubscribe = gallery.subscribe(() => follow(gallery));
      // Already open on another image: nothing to open from. Any other phase starts, or restarts, the opening.
      if (phase === 'open') {
        emit();
        return true;
      }
      cancelOpening = undefined;
      phase = 'opening';
      emit();
      // Two frames: the first paints the starting style, the second may leave it.
      cancelOpening = host.frame(() => {
        cancelOpening = host.frame(() => {
          cancelOpening = undefined;
          phase = 'open';
          emit();
        });
      });
      return true;
    },
    close,
    /** Moves by `delta` images. Does nothing at either end of the gallery. */
    go,
    /** A toolbar action. */
    action(name: ImageActionIconName): void {
      if (phase === 'closed' || phase === 'closing') return;
      if (name === 'close') return close();
      if (name === 'prev') return go(-1);
      if (name === 'next') return go(1);
      if (status !== 'ready') return;
      if (name === 'zoomIn') zoom(ZOOM_STEP);
      else if (name === 'zoomOut') zoom(1 / ZOOM_STEP);
      else if (name === 'rotateLeft') transform = { ...transform, rotate: transform.rotate - 90 };
      else if (name === 'rotateRight') transform = { ...transform, rotate: transform.rotate + 90 };
      else if (name === 'flipX') transform = { ...transform, flipX: !transform.flipX };
      else if (name === 'flipY') transform = { ...transform, flipY: !transform.flipY };
      emit();
    },
    /** The image shown finished loading, or failed to. */
    loaded(): void {
      if (phase === 'closed' || status === 'ready') return;
      status = 'ready';
      emit();
    },
    failed(): void {
      if (phase === 'closed' || status === 'error') return;
      status = 'error';
      endGesture();
      emit();
    },
    /** True when the pointer now takes part in a gesture: capture it and prevent the default action. */
    pointerDown(pointer: ImagePointer): boolean {
      if ((phase !== 'open' && phase !== 'opening') || status !== 'ready') return false;
      if (pointer.button !== undefined && pointer.button !== 0) return false;
      // A third finger is ignored: the pinch stays with the first two.
      if (pointers.size >= 2 && !pointers.has(pointer.id)) return false;
      pointers.set(pointer.id, { x: pointer.x, y: pointer.y });
      grip = pointers.size === 1 ? { x: pointer.x - transform.x, y: pointer.y - transform.y } : undefined;
      moving = true;
      emit();
      return true;
    },
    pointerMove(pointer: ImagePointer): void {
      const previous = pointers.get(pointer.id);
      if (!previous || (previous.x === pointer.x && previous.y === pointer.y)) return;
      const before = [...pointers.values()];
      pointers.set(pointer.id, { x: pointer.x, y: pointer.y });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const span = Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y);
        const center = imagePinchCenter(before[0], before[1], a, b);
        if (span > 0) zoom(Math.hypot(a.x - b.x, a.y - b.y) / span, center.x, center.y, true);
      } else if (grip) transform = { ...transform, x: pointer.x - grip.x, y: pointer.y - grip.y };
      displaced = true;
      emitNextFrame();
    },
    /** A pointer lifted or was cancelled. */
    pointerUp(id: number): void {
      if (!pointers.delete(id)) return;
      const [remaining] = pointers.values();
      if (remaining) {
        // One finger of a pinch lifted: the other one carries on as a drag from where the image is.
        grip = { x: remaining.x - transform.x, y: remaining.y - transform.y };
        return;
      }
      const settle = displaced;
      endGesture();
      if (settle) rebound();
      emit();
    },
    /** True when the wheel zoomed: prevent the default action. `mode` is `WheelEvent.deltaMode`; `pinch` is a
     * trackpad pinch, which browsers report as a wheel event with the control key set. */
    wheel(input: { deltaY: number; x: number; y: number; mode?: number; pinch?: boolean }): boolean {
      if (phase !== 'open' || status !== 'ready' || !input.deltaY) return false;
      zoom(imageWheelRatio(input.deltaY, input.mode, input.pinch), input.x, input.y);
      emitNextFrame();
      return true;
    },
    /** Returns to the natural size, or zooms one step about the point when already there. */
    doubleClick(x: number, y: number): void {
      if (phase !== 'open' || status !== 'ready') return;
      if (transform.scale !== 1) transform = { ...transform, x: 0, y: 0, scale: 1 };
      else zoom(ZOOM_STEP, x, y);
      emit();
    },
    /** True when the key was used: prevent the default action. Left and right move through a gallery. */
    key(key: string): boolean {
      if ((phase !== 'open' && phase !== 'opening') || items.length < 2) return false;
      if (key !== 'ArrowLeft' && key !== 'ArrowRight') return false;
      go(key === 'ArrowLeft' ? -1 : 1);
      return true;
    },
    /** Stops every timer and subscription. The controller can be opened again afterwards. */
    dispose(): void {
      if (closeTimer !== undefined) clearTimeout(closeTimer);
      closeTimer = undefined;
      cancelPublish?.();
      cancelOpening?.();
      unsubscribe?.();
      cancelPublish = cancelOpening = unsubscribe = undefined;
      endGesture();
      phase = 'closed';
      items = [];
      selected = undefined;
      current = -1;
    },
  };
}

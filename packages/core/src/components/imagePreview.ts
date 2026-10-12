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
  /** The image can be dragged and pinched (the `movable` option). */
  movable: boolean;
  /** Viewport point the preview grows out of and shrinks back into: the anchor of the image shown when it opened,
   * then of the image shown when it closes. Undefined means the centre of the viewport. */
  origin: { x: number; y: number } | undefined;
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
  /** Where the image registered under `id` sits on the page, as a viewport point: the centre of its thumbnail.
   * Undefined when it has none or it is out of view. Asked when the preview opens and again when it closes. */
  anchor?(id: object): { x: number; y: number } | undefined;
}

export interface ImagePreviewOptions {
  /** How long the leaving style stays up, in milliseconds. Zero closes at once. A function is read at each close,
   * so a host can answer zero while the user prefers reduced motion. Default 300. */
  closeDuration?: number | (() => number);
  /** What one zoom step adds to the scale factor: the toolbar, a double click and a full wheel notch multiply or
   * divide by `1 + scaleStep`. Default 0.5. */
  scaleStep?: number;
  /** Smallest scale the toolbar and the wheel reach, and the one a pinch returns to. Default 1. */
  minScale?: number;
  /** Largest scale. Default 50. */
  maxScale?: number;
  /** Whether the image can be dragged and pinched. Default true. */
  movable?: boolean;
  /** Whether the wheel and a trackpad pinch zoom. Default true. */
  wheel?: boolean;
  /** The preview started to open (true) or to close (false). */
  onOpenChange?(open: boolean, info: { current: number; item: ImageGalleryItem | undefined }): void;
  /** An opening or a closing ran to its end. One that was interrupted, by reopening while it closed or by
   * `dispose`, reports nothing. */
  afterOpenChange?(open: boolean): void;
  /** The user moved to another image of the gallery. */
  onChange?(current: number, previous: number): void;
  /** The transform changed. A drag or a wheel burst reports once per frame, with the last action. */
  onTransform?(info: { transform: ImageTransform; action: ImagePreviewAction }): void;
}

/** What changed the transform, as reported to `onTransform`. */
export type ImagePreviewAction =
  | 'zoomIn'
  | 'zoomOut'
  | 'rotateLeft'
  | 'rotateRight'
  | 'flipX'
  | 'flipY'
  | 'wheel'
  | 'doubleClick'
  | 'move'
  | 'pinch'
  | 'rebound'
  | 'prev'
  | 'next';

export interface ImagePointer {
  /** Pointer id: one drag, or one finger of a pinch. */
  id: number;
  x: number;
  y: number;
  /** `PointerEvent.button`. Only the main button starts a gesture. */
  button?: number;
}

const CLOSE_MS = 300;
const positive = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;

const closedState: ImagePreviewState = Object.freeze({
  phase: 'closed',
  items: Object.freeze([]),
  current: -1,
  item: undefined,
  transform: initialImageTransform(),
  status: 'loading',
  moving: false,
  movable: true,
  origin: undefined,
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
 *   1.5x steps unless the options say otherwise, about the pointer for the
 *   wheel and a double click, about the viewport centre for the toolbar.
 * - The `on…` options report what the user did; they are called after the
 *   state that reflects it has been published.
 */
export function createImagePreviewController(
  host: ImagePreviewHost,
  publish: (state: ImagePreviewState) => void,
  options: ImagePreviewOptions = {}
) {
  const limits = { min: positive(options.minScale, 1), max: 0 };
  limits.max = Math.max(limits.min, positive(options.maxScale, 50));
  /** The natural size, or the nearest scale the limits allow: where an image starts and what a double click returns to. */
  const baseScale = Math.min(limits.max, Math.max(limits.min, 1));
  const scaleStep = positive(options.scaleStep, 0.5);
  const movable = options.movable ?? true;
  const wheelZoom = options.wheel ?? true;

  let phase: ImagePreviewPhase = 'closed';
  let items: readonly ImageGalleryItem[] = [];
  let selected: object | undefined;
  let current = -1;
  let transform = { ...initialImageTransform(), scale: baseScale };
  let status: ImageLoadStatus = 'loading';
  let moving = false;
  let origin: { x: number; y: number } | undefined;

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
      movable,
      origin,
      canPrevious: current > 0,
      canNext: current < items.length - 1,
      canZoomIn: ready && transform.scale < limits.max,
      canZoomOut: ready && transform.scale > limits.min,
    };
  };
  /** The action behind a transform change that has not been reported yet. */
  let reported: ImagePreviewAction | undefined;
  /** Publishes, then tells the listener about a transform the state now shows. */
  const flush = () => {
    publish(snapshot());
    const action = reported;
    reported = undefined;
    if (action) options.onTransform?.({ transform, action });
  };
  const emit = () => {
    cancelPublish?.();
    cancelPublish = undefined;
    flush();
  };
  const emitNextFrame = () => {
    cancelPublish ??= host.frame(() => {
      cancelPublish = undefined;
      flush();
    });
  };
  /** Sets the transform for a user action. An equal transform is not a change and is not reported. */
  const apply = (next: ImageTransform, action: ImagePreviewAction) => {
    const same =
      next.x === transform.x &&
      next.y === transform.y &&
      next.scale === transform.scale &&
      next.rotate === transform.rotate &&
      next.flipX === transform.flipX &&
      next.flipY === transform.flipY;
    if (same) return;
    transform = next;
    reported = action;
  };
  const endGesture = () => {
    pointers.clear();
    grip = undefined;
    displaced = false;
    moving = false;
  };
  /** A new image, or the same image with another source: start from a clean view. */
  const startImage = () => {
    transform = { ...initialImageTransform(), scale: baseScale };
    // A change that was waiting for its frame belonged to the view that is gone.
    reported = undefined;
    status = 'loading';
    endGesture();
  };
  const zoom = (action: ImagePreviewAction, ratio: number, x?: number, y?: number, touch = false) => {
    const box = host.geometry();
    if (box && status === 'ready') apply(zoomImage(transform, ratio, box, x, y, touch, limits), action);
  };
  /** Where the transformed image sits, from the numbers alone: the page may not have drawn the latest transform yet. */
  const rebound = () => {
    // Below the smallest size the image goes back to it, measured or not.
    if (transform.scale < limits.min) {
      apply({ ...transform, x: 0, y: 0, scale: limits.min }, 'rebound');
      return;
    }
    const box = host.geometry();
    if (!box) return;
    const turned = transform.rotate % 180 !== 0;
    const width = (turned ? box.height : box.width) * transform.scale;
    const height = (turned ? box.width : box.height) * transform.scale;
    apply(
      reboundImage(
        transform,
        box,
        {
          left: box.left + box.width / 2 + transform.x - width / 2,
          top: box.top + box.height / 2 + transform.y - height / 2,
        },
        limits.min
      ),
      'rebound'
    );
  };
  const anchorOf = (id: object) => {
    const point = host.anchor?.(id);
    return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? { x: point.x, y: point.y } : undefined;
  };
  const finishClosing = () => {
    closeTimer = undefined;
    phase = 'closed';
    items = [];
    selected = undefined;
    origin = undefined;
    current = -1;
    reported = undefined;
    emit();
    options.afterOpenChange?.(false);
  };
  const close = () => {
    if (phase === 'closed' || phase === 'closing') return;
    cancelOpening?.();
    cancelOpening = undefined;
    unsubscribe?.();
    unsubscribe = undefined;
    endGesture();
    // A drag that was waiting for its frame is not reported once the preview is leaving.
    reported = undefined;
    // Back into the thumbnail of the image on screen now, which may not be the one that opened the preview.
    origin = selected ? anchorOf(selected) : undefined;
    phase = 'closing';
    const info = { current, item: items[current] };
    const duration =
      typeof options.closeDuration === 'function' ? options.closeDuration() : (options.closeDuration ?? CLOSE_MS);
    // The closing is fully under way before the listener hears of it: one that throws cannot leave it half done.
    if (duration > 0) {
      emit();
      closeTimer = setTimeout(finishClosing, duration);
      options.onOpenChange?.(false, info);
    } else {
      try {
        options.onOpenChange?.(false, info);
      } finally {
        if (phase === 'closing') finishClosing();
      }
    }
  };
  const go = (delta: number) => {
    const target = current + delta;
    if (phase === 'closed' || phase === 'closing' || target < 0 || target >= items.length || target === current) return;
    const previous = current;
    const { x, y, scale, rotate, flipX, flipY } = transform;
    const transformed = x !== 0 || y !== 0 || scale !== baseScale || rotate !== 0 || flipX || flipY;
    current = target;
    selected = items[target].id;
    startImage();
    // The new image starts from a clean view; that is a transform change when the old one was not clean.
    if (transformed) reported = delta < 0 ? 'prev' : 'next';
    emit();
    options.onChange?.(current, previous);
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
      origin = anchorOf(id);
      startImage();
      unsubscribe = gallery.subscribe(() => follow(gallery));
      // Already open on another image: nothing to open from. Any other phase starts, or restarts, the opening.
      if (phase === 'open') {
        emit();
        return true;
      }
      cancelOpening = undefined;
      // Restarting an opening that is under way is not a second opening.
      const starting = phase !== 'opening';
      phase = 'opening';
      emit();
      // Two frames: the first paints the starting style, the second may leave it.
      cancelOpening = host.frame(() => {
        // The host has drawn and locked the page by now, which can move the thumbnail by a scrollbar's width.
        // Nothing has scaled yet, so the point can still be corrected.
        const measured = selected ? anchorOf(selected) : undefined;
        if (measured?.x !== origin?.x || measured?.y !== origin?.y) {
          origin = measured;
          emit();
        }
        cancelOpening = host.frame(() => {
          cancelOpening = undefined;
          phase = 'open';
          emit();
          options.afterOpenChange?.(true);
        });
      });
      // Last, so a listener that closes or reopens finds the opening complete and can cancel it.
      if (starting) options.onOpenChange?.(true, { current, item: items[current] });
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
      if (name === 'zoomIn') zoom(name, 1 + scaleStep);
      else if (name === 'zoomOut') zoom(name, 1 / (1 + scaleStep));
      else if (name === 'rotateLeft') apply({ ...transform, rotate: transform.rotate - 90 }, name);
      else if (name === 'rotateRight') apply({ ...transform, rotate: transform.rotate + 90 }, name);
      else if (name === 'flipX') apply({ ...transform, flipX: !transform.flipX }, name);
      else if (name === 'flipY') apply({ ...transform, flipY: !transform.flipY }, name);
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
      if (!movable || (phase !== 'open' && phase !== 'opening') || status !== 'ready') return false;
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
        if (span > 0) zoom('pinch', Math.hypot(a.x - b.x, a.y - b.y) / span, center.x, center.y, true);
      } else if (grip) apply({ ...transform, x: pointer.x - grip.x, y: pointer.y - grip.y }, 'move');
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
      if (!wheelZoom || phase !== 'open' || status !== 'ready' || !input.deltaY) return false;
      zoom('wheel', imageWheelRatio(input.deltaY, input.mode, input.pinch, scaleStep), input.x, input.y);
      emitNextFrame();
      return true;
    },
    /** Returns to the starting size, or zooms one step about the point when already there. */
    doubleClick(x: number, y: number): void {
      if (phase !== 'open' || status !== 'ready') return;
      if (transform.scale !== baseScale) apply({ ...transform, x: 0, y: 0, scale: baseScale }, 'doubleClick');
      else zoom('doubleClick', 1 + scaleStep, x, y);
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
      origin = undefined;
      current = -1;
      reported = undefined;
    },
  };
}

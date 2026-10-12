import { h, onBeforeUnmount, ref, shallowRef, Teleport, watch, type VNode, type VNodeChild } from 'vue';
import {
  createImagePreviewController,
  imageTransformStyle,
  lockImagePreviewScroll,
  type ImageActionIconName,
  type ImageGallery,
  type ImageIconName,
  type ImageLabels,
  type ImagePreviewState,
} from '@ai-markdown/core/components';

const prefix = 'aimd-image-preview';
/** Focus is outside the dialog, or on a button that has just been disabled, which receives no key events. */
const lostFocus = (dialog: HTMLElement | undefined | null) => {
  const active = document.activeElement;
  return !dialog?.contains(active) || Boolean(active?.matches(':disabled'));
};
const TOOLBAR = ['flipY', 'flipX', 'rotateLeft', 'rotateRight', 'zoomOut', 'zoomIn'] as const;

/**
 * The preview of one image component: a native modal dialog drawn from core's
 * `createImagePreviewController`. The controller owns the state and the
 * rules; this file forwards events to it and renders what it publishes.
 * Call during setup.
 */
export function useImagePreview(options: {
  renderIcon: (name: ImageIconName) => VNodeChild;
  labels: () => ImageLabels;
  /** The dialog is gone: return focus to what opened it. */
  onClosed: () => void;
}) {
  const dialog = ref<HTMLDialogElement>(),
    image = ref<HTMLImageElement>();
  const state = shallowRef<ImagePreviewState>(undefined as never);
  const controller = createImagePreviewController(
    {
      geometry: () => {
        const img = image.value;
        if (!img) return;
        return {
          width: img.width,
          height: img.height,
          left: img.offsetLeft,
          top: img.offsetTop,
          viewportWidth: document.documentElement.clientWidth,
          viewportHeight: document.documentElement.clientHeight,
        };
      },
      frame: (callback) => {
        const id = requestAnimationFrame(callback);
        return () => cancelAnimationFrame(id);
      },
    },
    (next) => {
      state.value = next;
    },
    // No leaving transition to wait for when the user asked for less motion.
    { closeDuration: () => (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 300) }
  );
  state.value = controller.state();
  let release: (() => void) | undefined;
  watch(
    () => state.value.phase,
    (phase, previous) => {
      const modal = dialog.value;
      if (phase === 'opening' && modal) {
        if (!modal.open) modal.showModal();
        release ??= lockImagePreviewScroll(document.body, window.innerWidth - document.documentElement.clientWidth);
        modal.focus();
      } else if (phase === 'closed' && previous !== 'closed') {
        release?.();
        release = undefined;
        options.onClosed();
      }
    },
    { flush: 'post' }
  );
  // After every state: a button that has focus can become disabled at either end of the gallery or of the zoom.
  watch(
    state,
    () => {
      if (state.value.phase !== 'closed' && lostFocus(dialog.value)) dialog.value?.focus();
    },
    { flush: 'post' }
  );
  // A cached image is complete before its load listener exists.
  watch(
    () => [state.value.item?.id, state.value.item?.src, state.value.phase !== 'closed'],
    () => {
      const img = image.value;
      if (state.value.phase === 'closed' || !img?.complete) return;
      if (img.naturalWidth) controller.loaded();
      else controller.failed();
    },
    { flush: 'post' }
  );
  onBeforeUnmount(() => {
    controller.dispose();
    release?.();
    release = undefined;
  });
  const button = (name: ImageActionIconName, className: string, disabled = false) => {
    const labels = options.labels();
    return h(
      'button',
      {
        type: 'button',
        class: [className, disabled && `${className.split(' ')[0]}-disabled`],
        disabled,
        'aria-label': labels[name],
        title: labels[name],
        onClick: () => controller.action(name),
      },
      [options.renderIcon(name)]
    );
  };
  const render = (): VNode | null => {
    const { phase, item, items, current, transform, status, moving } = state.value;
    const labels = options.labels();
    const content =
      phase !== 'closed' && item
        ? h(
            'dialog',
            {
              ref: dialog,
              class: [prefix, `${prefix}-movable`, moving && `${prefix}-moving`],
              'data-phase': phase,
              'aria-label': item.alt || labels.preview,
              'aria-modal': 'true',
              role: 'dialog',
              tabindex: -1,
              // Escape: the controller closes, so the leaving style gets its time.
              onCancel: (event: Event) => {
                event.preventDefault();
                controller.close();
              },
              onKeydown: (event: KeyboardEvent) => {
                if (controller.key(event.key)) event.preventDefault();
              },
            },
            [
              h('div', { class: `${prefix}-mask`, onClick: () => controller.close() }),
              h('div', { class: `${prefix}-body` }, [
                h('img', {
                  ref: image,
                  key: item.src + current,
                  class: `${prefix}-img`,
                  src: item.src,
                  alt: item.alt,
                  draggable: false,
                  style: {
                    transform: imageTransformStyle(transform),
                    visibility: status === 'ready' ? 'visible' : 'hidden',
                  },
                  onLoad: () => controller.loaded(),
                  onError: () => controller.failed(),
                  onPointerdown: (event: PointerEvent) => {
                    if (
                      !controller.pointerDown({
                        id: event.pointerId,
                        x: event.clientX,
                        y: event.clientY,
                        button: event.button,
                      })
                    )
                      return;
                    event.preventDefault();
                    event.stopPropagation();
                    // Captured, the pointer keeps reporting to the image outside the window or its frame.
                    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
                  },
                  onPointermove: (event: PointerEvent) =>
                    controller.pointerMove({ id: event.pointerId, x: event.clientX, y: event.clientY }),
                  onPointerup: (event: PointerEvent) => controller.pointerUp(event.pointerId),
                  onPointercancel: (event: PointerEvent) => controller.pointerUp(event.pointerId),
                  onLostpointercapture: (event: PointerEvent) => controller.pointerUp(event.pointerId),
                  onWheel: (event: WheelEvent) => {
                    if (
                      controller.wheel({
                        deltaY: event.deltaY,
                        mode: event.deltaMode,
                        pinch: event.ctrlKey,
                        x: event.clientX,
                        y: event.clientY,
                      })
                    )
                      event.preventDefault();
                  },
                  onDblclick: (event: MouseEvent) => controller.doubleClick(event.clientX, event.clientY),
                }),
                status !== 'ready' &&
                  h('span', { class: 'aimd-image-feedback', role: status === 'error' ? 'alert' : 'status' }, [
                    options.renderIcon(status === 'error' ? 'error' : 'placeholder'),
                    h('span', status === 'error' ? labels.loadFailed : labels.loading),
                  ]),
              ]),
              button('close', `${prefix}-close`),
              items.length > 1 && [
                button('prev', `${prefix}-switch ${prefix}-switch-prev`, !state.value.canPrevious),
                button('next', `${prefix}-switch ${prefix}-switch-next`, !state.value.canNext),
              ],
              h('div', { class: `${prefix}-footer` }, [
                items.length > 1 &&
                  h('div', { class: `${prefix}-progress`, role: 'status' }, `${current + 1} / ${items.length}`),
                h(
                  'div',
                  { class: `${prefix}-actions`, role: 'group', 'aria-label': labels.actions },
                  TOOLBAR.map((name) =>
                    button(
                      name,
                      `${prefix}-actions-action ${prefix}-actions-action-${name}`,
                      status !== 'ready' ||
                        (name === 'zoomOut' && !state.value.canZoomOut) ||
                        (name === 'zoomIn' && !state.value.canZoomIn)
                    )
                  )
                ),
              ]),
            ]
          )
        : null;
    // Nothing at all while closed: a server render has no teleport to hydrate.
    return content && h(Teleport, { to: 'body' }, [content]);
  };
  return {
    /** Shows the image registered under `id` in the gallery. */
    open: (gallery: ImageGallery, id: object) => controller.open(gallery, id),
    close: () => controller.close(),
    render,
  };
}

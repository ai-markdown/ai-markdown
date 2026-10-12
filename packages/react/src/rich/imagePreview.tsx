'use client';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
/** Centre of a thumbnail in the viewport, or nothing when it is detached, hidden or out of view. */
const thumbnailAnchor = (id: object) => {
  if (!(id instanceof Element) || !id.isConnected) return;
  const box = id.getBoundingClientRect();
  const x = box.left + box.width / 2,
    y = box.top + box.height / 2;
  if (!box.width || !box.height || x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return;
  return { x, y };
};
/** Focus is outside the dialog, or on a button that has just been disabled, which receives no key events. */
const lostFocus = (dialog: HTMLElement | null) => {
  const active = document.activeElement;
  return !dialog?.contains(active) || Boolean(active?.matches(':disabled'));
};
const TOOLBAR = ['flipY', 'flipX', 'rotateLeft', 'rotateRight', 'zoomOut', 'zoomIn'] as const;

/**
 * The preview of one image component: a native modal dialog drawn from core's
 * `createImagePreviewController`. The controller owns the state and the
 * rules; this hook forwards events to it and renders what it publishes.
 */
export function useImagePreview(options: {
  renderIcon: (name: ImageIconName) => ReactNode;
  labels: ImageLabels;
  /** The dialog is gone: return focus to what opened it. */
  onClosed: () => void;
}): { open(gallery: ImageGallery, id: object): boolean; close(): void; element: ReactNode } {
  const dialog = useRef<HTMLDialogElement>(null),
    image = useRef<HTMLImageElement>(null);
  const [published, setState] = useState<ImagePreviewState>();
  const [controller] = useState(() =>
    createImagePreviewController(
      {
        geometry: () => {
          const img = image.current;
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
        anchor: thumbnailAnchor,
      },
      setState,
      // No leaving transition to wait for when the user asked for less motion.
      { closeDuration: () => (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 300) }
    )
  );
  const state = published ?? controller.state();
  const { phase, item, items, current, transform, status, moving } = state;
  const rendered = phase !== 'closed' && Boolean(item);

  const onClosed = useRef(options.onClosed);
  useEffect(() => {
    onClosed.current = options.onClosed;
  });
  // The dialog becomes modal as soon as it is in the document, and the page stops scrolling behind it.
  useLayoutEffect(() => {
    const modal = dialog.current;
    if (!rendered || !modal) return;
    if (!modal.open) modal.showModal();
    modal.focus();
    const release = lockImagePreviewScroll(document.body, window.innerWidth - document.documentElement.clientWidth);
    return () => {
      release();
      onClosed.current();
    };
  }, [rendered]);
  // A cached image is complete before its load listener exists.
  useEffect(() => {
    const img = image.current;
    if (!rendered || !img?.complete) return;
    if (img.naturalWidth) controller.loaded();
    else controller.failed();
  }, [controller, rendered, item?.id, item?.src]);
  // After every state: a button that has focus can become disabled at either end of the gallery or of the zoom.
  useEffect(() => {
    if (rendered && lostFocus(dialog.current)) dialog.current?.focus();
  }, [rendered, state]);
  // React listens to the wheel passively, so the page would scroll along with the zoom.
  useEffect(() => {
    const img = image.current;
    if (!rendered || !img) return;
    const onWheel = (event: WheelEvent) => {
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
    };
    img.addEventListener('wheel', onWheel, { passive: false });
    return () => img.removeEventListener('wheel', onWheel);
  }, [controller, rendered, item?.src, current]);
  useEffect(() => () => controller.dispose(), [controller]);

  const button = (name: ImageActionIconName, className: string, disabled = false) => (
    <button
      type="button"
      className={`${className}${disabled ? ` ${className.split(' ')[0]}-disabled` : ''}`}
      disabled={disabled}
      aria-label={options.labels[name]}
      title={options.labels[name]}
      onClick={() => controller.action(name)}
    >
      {options.renderIcon(name)}
    </button>
  );
  const element =
    rendered && item
      ? createPortal(
          <dialog
            ref={dialog}
            className={`${prefix} ${prefix}-movable${moving ? ` ${prefix}-moving` : ''}`}
            data-phase={phase}
            aria-label={item.alt || options.labels.preview}
            aria-modal="true"
            tabIndex={-1}
            // Escape: the controller closes, so the leaving style gets its time.
            onCancel={(event) => {
              event.preventDefault();
              controller.close();
            }}
            onKeyDown={(event) => {
              if (controller.key(event.key)) event.preventDefault();
            }}
          >
            <div className={`${prefix}-mask`} onClick={() => controller.close()} />
            <div
              className={`${prefix}-body`}
              // The preview grows out of its thumbnail and shrinks back into it.
              style={state.origin ? { transformOrigin: `${state.origin.x}px ${state.origin.y}px` } : undefined}
            >
              <img
                ref={image}
                key={item.src + current}
                className={`${prefix}-img`}
                src={item.src}
                alt={item.alt}
                draggable={false}
                style={{
                  transform: imageTransformStyle(transform),
                  visibility: status === 'ready' ? 'visible' : 'hidden',
                }}
                onLoad={() => controller.loaded()}
                onError={() => controller.failed()}
                onPointerDown={(event) => {
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
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                }}
                onPointerMove={(event) =>
                  controller.pointerMove({ id: event.pointerId, x: event.clientX, y: event.clientY })
                }
                onPointerUp={(event) => controller.pointerUp(event.pointerId)}
                onPointerCancel={(event) => controller.pointerUp(event.pointerId)}
                onLostPointerCapture={(event) => controller.pointerUp(event.pointerId)}
                onDoubleClick={(event) => controller.doubleClick(event.clientX, event.clientY)}
              />
              {status !== 'ready' && (
                <span className="aimd-image-feedback" role={status === 'error' ? 'alert' : 'status'}>
                  {options.renderIcon(status === 'error' ? 'error' : 'placeholder')}
                  <span>{status === 'error' ? options.labels.loadFailed : options.labels.loading}</span>
                </span>
              )}
            </div>
            {button('close', `${prefix}-close`)}
            {items.length > 1 && (
              <>
                {button('prev', `${prefix}-switch ${prefix}-switch-prev`, !state.canPrevious)}
                {button('next', `${prefix}-switch ${prefix}-switch-next`, !state.canNext)}
              </>
            )}
            <div className={`${prefix}-footer`}>
              {items.length > 1 && (
                <div className={`${prefix}-progress`} role="status">
                  {`${current + 1} / ${items.length}`}
                </div>
              )}
              <div className={`${prefix}-actions`} role="group" aria-label={options.labels.actions}>
                {TOOLBAR.map((name) => (
                  <span key={name} style={{ display: 'contents' }}>
                    {button(
                      name,
                      `${prefix}-actions-action ${prefix}-actions-action-${name}`,
                      status !== 'ready' ||
                        (name === 'zoomOut' && !state.canZoomOut) ||
                        (name === 'zoomIn' && !state.canZoomIn)
                    )}
                  </span>
                ))}
              </div>
            </div>
          </dialog>,
          document.body
        )
      : null;
  return { open: controller.open, close: controller.close, element };
}

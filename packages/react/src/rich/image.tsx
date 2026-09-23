'use client';
import {
  createElement,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ComponentType,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { Element as HastElement } from 'hast';
import {
  getImageGallery,
  imageGroupSelector,
  imageIconPaths,
  lockImagePreviewScroll,
  type ImageGalleryItem,
  type ImageIconName,
  type ImageLoadStatus,
} from '@ai-markdown/core/components';
export type { ImageIconName } from '@ai-markdown/core/components';
export type MarkdownImageProps = ComponentPropsWithoutRef<'img'> & { node?: HastElement };
export interface ImagePreviewDialogProps {
  open: boolean;
  label: string;
  onClose: () => void;
  children: ReactNode;
}
export interface ImageIconProps {
  className?: string;
  'aria-hidden'?: boolean;
}
export type MarkdownImageIcon = ReactNode | ComponentType<ImageIconProps>;
export interface MarkdownImageOptions {
  icons?: Partial<Record<ImageIconName, MarkdownImageIcon>>;
  /** Nearest ancestor selector; defaults to the Markdown root. false disables grouping. */
  group?: string | false;
  preview?: boolean;
  Dialog?: ComponentType<ImagePreviewDialogProps>;
}
function ImageIcon({ name, icons }: { name: ImageIconName; icons?: MarkdownImageOptions['icons'] }) {
  const custom = icons?.[name];
  return (
    <span className="aimd-image-icon" aria-hidden="true" data-image-icon={name}>
      {custom !== undefined ? (
        typeof custom === 'function' ||
        (typeof custom === 'object' &&
          custom !== null &&
          '$$typeof' in custom &&
          [Symbol.for('react.memo'), Symbol.for('react.forward_ref'), Symbol.for('react.lazy')].includes(
            custom.$$typeof as symbol
          )) ? (
          createElement(custom as ComponentType<ImageIconProps>, { 'aria-hidden': true })
        ) : (
          (custom as ReactNode)
        )
      ) : (
        <svg
          viewBox="0 0 24 24"
          width="24"
          height="24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          focusable="false"
        >
          {imageIconPaths[name].map((d, i) => (
            <path key={i} d={d} />
          ))}
        </svg>
      )}
    </span>
  );
}
function NativeImageDialog({ open, label, onClose, children }: ImagePreviewDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) dialog.current.showModal();
    else if (!open) dialog.current?.close();
    if (open) return lockImagePreviewScroll(document.body);
  }, [open]);
  return createPortal(
    <dialog
      ref={dialog}
      className="aimd-image-dialog"
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </dialog>,
    document.body
  );
}
function ImagePreviewContent({
  item,
  close,
  icons,
  previous,
  next,
  position,
}: {
  item: ImageGalleryItem;
  close: () => void;
  icons?: MarkdownImageOptions['icons'];
  previous?: () => void;
  next?: () => void;
  position?: string;
}) {
  const [original, setOriginal] = useState(false),
    [zoom, setZoom] = useState(1),
    [rotation, setRotation] = useState(0),
    [status, setStatus] = useState<ImageLoadStatus>('loading');
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    content.current?.focus();
  }, []);
  return (
    <div
      className="aimd-image-preview"
      ref={content}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.key === 'ArrowLeft' && previous) {
          event.preventDefault();
          previous();
        }
        if (event.key === 'ArrowRight' && next) {
          event.preventDefault();
          next();
        }
      }}
    >
      <div className="aimd-toolbar" role="group" aria-label="Image preview actions">
        <button type="button" autoFocus onClick={close}>
          Close preview
        </button>
        {position && (
          <>
            <button type="button" disabled={!previous} onClick={previous}>
              Previous image
            </button>
            <span role="status">{position}</span>
            <button type="button" disabled={!next} onClick={next}>
              Next image
            </button>
          </>
        )}
        <button
          type="button"
          aria-pressed={original}
          onClick={() => {
            setOriginal((value) => !value);
            setZoom(1);
          }}
        >
          {original ? 'Fit image' : 'Original size'}
        </button>
        <button type="button" disabled={zoom <= 0.5} onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}>
          Zoom out
        </button>
        <button type="button" disabled={zoom >= 3} onClick={() => setZoom((value) => Math.min(3, value + 0.25))}>
          Zoom in
        </button>
        <button type="button" onClick={() => setRotation((value) => (value + 90) % 360)}>
          Rotate image
        </button>
      </div>
      {status !== 'ready' && (
        <p className="aimd-image-feedback" role={status === 'error' ? 'alert' : 'status'}>
          <ImageIcon name={status === 'error' ? 'error' : 'placeholder'} icons={icons} />
          {status === 'error' ? 'Image could not be loaded.' : 'Loading image…'}
        </p>
      )}
      <div className="aimd-image-viewport" style={{ overflow: 'auto', maxWidth: '90vw', maxHeight: '80vh' }}>
        <img
          src={item.src}
          alt={item.alt}
          style={{
            visibility: status === 'ready' ? 'visible' : 'hidden',
            maxWidth: original ? 'none' : '85vw',
            maxHeight: original ? 'none' : '75vh',
            transform: `rotate(${rotation}deg) scale(${zoom})`,
            transformOrigin: 'center',
          }}
          onLoad={() => setStatus('ready')}
          onError={() => setStatus('error')}
        />
      </div>
    </div>
  );
}
/** Configure once, then register the result directly as customComponents.img. */
export function createMarkdownImage({
  Dialog = NativeImageDialog,
  icons,
  group,
  preview: allowPreview = true,
}: MarkdownImageOptions = {}) {
  return function MarkdownImage({ node: _node, ...props }: MarkdownImageProps) {
    const image = useRef<HTMLImageElement>(null),
      trigger = useRef<HTMLButtonElement>(null);
    const [enabled, setEnabled] = useState(false),
      [selected, setSelected] = useState<object | null>(null),
      [status, setStatus] = useState<ImageLoadStatus>('loading'),
      [loadedSource, setLoadedSource] = useState(''),
      [items, setItems] = useState<readonly ImageGalleryItem[]>([]);
    const [source, setSource] = useState({ src: props.src, srcSet: props.srcSet });
    if (source.src !== props.src || source.srcSet !== props.srcSet) {
      setSource({ src: props.src, srcSet: props.srcSet });
      setSelected(null);
      setStatus('loading');
    }
    useEffect(() => {
      const update = () => {
        const parent = image.current?.closest('.aimd-image');
        const allowed =
          allowPreview &&
          Boolean(props.src || props.srcSet) &&
          !parent?.closest('a,button,[role="link"],[role="button"]');
        setEnabled(allowed);
        if (!allowed) setSelected(null);
      };
      update();
      const observer = new MutationObserver(update);
      let parent = image.current?.closest('.aimd-image');
      while (parent) {
        observer.observe(parent, { attributes: true, attributeFilter: ['role', 'href'] });
        parent = parent.parentElement;
      }
      return () => observer.disconnect();
    }, [props.src, props.srcSet]);
    useEffect(() => {
      const element = image.current;
      if (element?.complete && (props.src || props.srcSet)) setStatus(element.naturalWidth > 0 ? 'ready' : 'error');
    }, [props.src, props.srcSet, enabled]);
    useEffect(() => {
      const element = image.current;
      if (!element || !enabled || status !== 'ready') {
        setItems([]);
        return;
      }
      const scope = group === false ? element : (element.closest(group ?? imageGroupSelector) ?? element);
      const gallery = getImageGallery(scope);
      const refresh = () => setItems(gallery.items());
      const unsubscribe = gallery.subscribe(refresh);
      gallery.set({
        id: element,
        src: element.currentSrc || props.src || '',
        alt: props.alt ?? '',
        precedes: (other) => Boolean(element.compareDocumentPosition(other as Node) & 4),
      });
      refresh();
      return () => {
        unsubscribe();
        gallery.remove(element);
      };
    }, [enabled, status, props.src, props.srcSet, props.alt, loadedSource]);
    const close = () => {
      setSelected(null);
      trigger.current?.focus();
    };
    const index = items.findIndex((item) => item.id === selected),
      item = items[index];
    useEffect(() => {
      if (selected && !item) {
        setSelected(null);
        trigger.current?.focus();
      }
    }, [selected, item]);
    const img = (
      <img
        {...props}
        ref={image}
        style={{ ...props.style, ...(status !== 'ready' ? { opacity: 0 } : {}) }}
        onLoad={(event) => {
          setStatus('ready');
          setLoadedSource(event.currentTarget.currentSrc);
          if (selected && item?.src !== event.currentTarget.currentSrc && selected === image.current) close();
          props.onLoad?.(event);
        }}
        onError={(event) => {
          setStatus('error');
          close();
          props.onError?.(event);
        }}
      />
    );
    const feedback = status !== 'ready' && (
      <span className="aimd-image-feedback" role={status === 'error' ? 'alert' : 'status'}>
        <ImageIcon name={status === 'error' ? 'error' : 'placeholder'} icons={icons} />
        <span>
          {status === 'error' ? 'Image could not be loaded.' : 'Loading image…'}
          {status === 'error' && props.alt ? ` ${props.alt}` : ''}
        </span>
      </span>
    );
    const contents = (
      <>
        {img}
        {feedback}
        {enabled && status === 'ready' && (
          <span className="aimd-image-cover">
            <ImageIcon name={items.length > 1 ? 'gallery' : 'preview'} icons={icons} />
          </span>
        )}
      </>
    );
    return (
      <>
        <span className="aimd-image" data-status={status}>
          {enabled ? (
            <button
              className="aimd-image-trigger"
              type="button"
              ref={trigger}
              disabled={status !== 'ready'}
              aria-label={`Preview image${props.alt ? `: ${props.alt}` : ''}`}
              onClick={() => setSelected(image.current)}
            >
              {contents}
            </button>
          ) : (
            contents
          )}
        </span>
        {enabled && (
          <Dialog open={Boolean(item)} label={item?.alt || 'Image preview'} onClose={close}>
            {item && (
              <ImagePreviewContent
                key={item.src + index}
                item={item}
                icons={icons}
                close={close}
                position={items.length > 1 ? `${index + 1} / ${items.length}` : undefined}
                previous={index > 0 ? () => setSelected(items[index - 1].id) : undefined}
                next={index < items.length - 1 ? () => setSelected(items[index + 1].id) : undefined}
              />
            )}
          </Dialog>
        )}
      </>
    );
  };
}
export const MarkdownImage = createMarkdownImage();

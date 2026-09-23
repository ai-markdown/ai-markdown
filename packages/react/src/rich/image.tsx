'use client';
import { useEffect, useRef, useState, type ComponentPropsWithoutRef, type ComponentType, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Element as HastElement } from 'hast';
import { lockImagePreviewScroll } from '@ai-markdown/core/components';
export type MarkdownImageProps = ComponentPropsWithoutRef<'img'> & { node?: HastElement };
export interface ImagePreviewDialogProps {
  open: boolean;
  label: string;
  onClose: () => void;
  children: ReactNode;
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
function ImagePreviewContent({ src, alt, close }: { src: string; alt: string; close: () => void }) {
  const [original, setOriginal] = useState(false),
    [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  return (
    <>
      <div className="aimd-toolbar">
        <button type="button" autoFocus onClick={close}>
          Close preview
        </button>
        <button type="button" aria-pressed={original} onClick={() => setOriginal((value) => !value)}>
          {original ? 'Fit image' : 'Original size'}
        </button>
      </div>
      {status === 'loading' && <p role="status">Loading image…</p>}
      {status === 'error' && <p role="alert">Image could not be loaded.</p>}
      <div className="aimd-image-viewport" style={{ overflow: 'auto', maxWidth: '90vw', maxHeight: '80vh' }}>
        <img
          src={src}
          alt={alt}
          style={{ maxWidth: original ? 'none' : '85vw', maxHeight: original ? 'none' : '75vh' }}
          onLoad={() => setStatus('ready')}
          onError={() => setStatus('error')}
        />
      </div>
    </>
  );
}
/** A project skin may replace only the dialog owner (e.g. Mantine Modal).
 * Source selection, image lifecycle and actions remain shared. */
export function createMarkdownImage({
  Dialog = NativeImageDialog,
}: { Dialog?: ComponentType<ImagePreviewDialogProps> } = {}) {
  return function MarkdownImage({ node: _node, ...props }: MarkdownImageProps) {
    const image = useRef<HTMLImageElement>(null),
      trigger = useRef<HTMLButtonElement>(null);
    const [enabled, setEnabled] = useState(false),
      [preview, setPreview] = useState(''),
      [failed, setFailed] = useState(false);
    const [source, setSource] = useState({ src: props.src, srcSet: props.srcSet });
    if (source.src !== props.src || source.srcSet !== props.srcSet) {
      setSource({ src: props.src, srcSet: props.srcSet });
      setPreview('');
      setFailed(false);
    }
    useEffect(() => {
      const update = () => {
        const parent =
          image.current?.parentElement === trigger.current
            ? trigger.current?.parentElement
            : image.current?.parentElement;
        const allowed =
          Boolean(props.src || props.srcSet) && !parent?.closest('a,button,[role="link"],[role="button"]');
        setEnabled(allowed);
        if (!allowed) setPreview('');
      };
      update();
      const observer = new MutationObserver(update);
      let parent = image.current?.parentElement;
      while (parent) {
        observer.observe(parent, { attributes: true, attributeFilter: ['role', 'href'] });
        parent = parent.parentElement;
      }
      return () => observer.disconnect();
    }, [props.src, props.srcSet, enabled]);
    const close = () => {
      setPreview('');
      trigger.current?.focus();
    };
    const img = (
      <img
        {...props}
        ref={image}
        onLoad={(event) => {
          setFailed(false);
          if (preview && preview !== event.currentTarget.currentSrc) close();
          props.onLoad?.(event);
        }}
        onError={(event) => {
          setFailed(true);
          close();
          props.onError?.(event);
        }}
      />
    );
    if (!enabled) return img;
    return (
      <>
        <button
          className="aimd-image-trigger"
          type="button"
          ref={trigger}
          disabled={failed}
          aria-label={`Preview image${props.alt ? `: ${props.alt}` : ''}`}
          onClick={() => setPreview(image.current?.currentSrc || props.src || '')}
        >
          {img}
        </button>
        <Dialog open={Boolean(preview)} label={props.alt || 'Image preview'} onClose={close}>
          {preview && <ImagePreviewContent key={preview} src={preview} alt={props.alt ?? ''} close={close} />}
        </Dialog>
      </>
    );
  };
}
export const MarkdownImage = createMarkdownImage();

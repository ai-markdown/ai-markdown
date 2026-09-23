'use client';
import {
  createElement,
  cloneElement,
  Children,
  isValidElement,
  type ReactElement,
  useEffect,
  useCallback,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ComponentType,
  type ReactNode,
} from 'react';
import RcImageImport from '@rc-component/image';
// Native ESM consumers receive the CommonJS namespace; bundlers unwrap it.
const RcImage =
  'PreviewGroup' in RcImageImport
    ? RcImageImport
    : (RcImageImport as unknown as { default: typeof RcImageImport }).default;
import type { Element as HastElement } from 'hast';
import {
  getImageGallery,
  imageGroupSelector,
  imageIconPaths,
  imageActionLabels,
  type ImageActionIconName,
  type ImageGalleryItem,
  type ImageIconName,
  type ImageLoadStatus,
} from '@ai-markdown/core/components';
export type { ImageIconName } from '@ai-markdown/core/components';
export type MarkdownImageProps = ComponentPropsWithoutRef<'img'> & { node?: HastElement };
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
function PreviewSurface({
  original,
  src,
  icons,
}: {
  original: ReactElement;
  src: string;
  icons?: MarkdownImageOptions['icons'];
}) {
  const [status, setStatus] = useState<ImageLoadStatus>('loading');
  const surface = useCallback((node: HTMLSpanElement | null) => {
    const img = node?.querySelector('img');
    if (img?.complete) setStatus(img.naturalWidth ? 'ready' : 'error');
  }, []);
  const element = original as ReactElement<{ style?: React.CSSProperties }>;
  return (
    <span
      ref={surface}
      className="aimd-image-preview-surface"
      onLoadCapture={() => setStatus('ready')}
      onErrorCapture={() => setStatus('error')}
    >
      {cloneElement(element, {
        style: { ...element.props.style, visibility: status === 'ready' ? 'visible' : 'hidden' },
      })}
      {status !== 'ready' && (
        <span className="aimd-image-feedback" role={status === 'error' ? 'alert' : 'status'} data-source={src}>
          <ImageIcon name={status === 'error' ? 'error' : 'placeholder'} icons={icons} />
          <span>{status === 'error' ? 'Image could not be loaded.' : 'Loading image…'}</span>
        </span>
      )}
    </span>
  );
}
function actionIcon(name: ImageActionIconName, icons?: MarkdownImageOptions['icons']) {
  return (
    <>
      <ImageIcon name={name} icons={icons} />
      <span className="aimd-image-sr-only">{imageActionLabels[name]}</span>
    </>
  );
}
/** Configure once, then register the result directly as customComponents.img. */
export function createMarkdownImage({ icons, group, preview: allowPreview = true }: MarkdownImageOptions = {}) {
  return function MarkdownImage({ node: _node, ...props }: MarkdownImageProps) {
    const image = useRef<HTMLImageElement>(null),
      trigger = useRef<HTMLButtonElement>(null);
    const [enabled, setEnabled] = useState(false),
      [selected, setSelected] = useState<object | null>(null),
      [previewIndex, setPreviewIndex] = useState(0),
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
              onClick={() => {
                setPreviewIndex(items.findIndex((entry) => entry.id === image.current));
                setSelected(image.current);
              }}
            >
              {contents}
            </button>
          ) : (
            contents
          )}
        </span>
        {enabled && (
          <RcImage.PreviewGroup
            previewPrefixCls="aimd-image-preview"
            items={items.map(({ src, alt }) => ({ src, alt }))}
            icons={Object.fromEntries(
              (Object.keys(imageActionLabels) as ImageActionIconName[]).map((name) => [name, actionIcon(name, icons)])
            )}
            preview={{
              open: Boolean(item),
              current: index >= 0 ? index : previewIndex,
              alt: items[index >= 0 ? index : previewIndex]?.alt || 'Image preview',
              motionName: 'aimd-image-fade',
              onOpenChange: (open) => {
                if (!open) setSelected(null);
              },
              afterOpenChange: (open) => {
                if (!open) trigger.current?.focus();
              },
              onChange: (next) => {
                setPreviewIndex(next);
                setSelected(items[next]?.id ?? null);
              },
              countRender: (current, total) => (total > 1 ? `${current} / ${total}` : null),
              imageRender: (original, info) => (
                <PreviewSurface
                  key={info.image.url + (index >= 0 ? index : previewIndex)}
                  original={original}
                  src={info.image.url}
                  icons={icons}
                />
              ),
              actionsRender: (original) =>
                cloneElement(
                  original as ReactElement<{ children?: ReactNode }>,
                  {},
                  Children.map((original.props as { children?: ReactNode }).children, (child) => {
                    if (!isValidElement(child)) return child;
                    const label = (child.props as { 'aria-label'?: ImageActionIconName })['aria-label'];
                    return cloneElement(child as ReactElement<{ 'aria-label'?: string; title?: string }>, {
                      'aria-label': label ? imageActionLabels[label] : undefined,
                      title: label ? imageActionLabels[label] : undefined,
                    });
                  })
                ),
            }}
          />
        )}
      </>
    );
  };
}
export const MarkdownImage = createMarkdownImage();

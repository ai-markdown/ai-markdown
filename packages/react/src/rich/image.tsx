'use client';
import {
  createElement,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentPropsWithoutRef,
  type ComponentType,
  type ReactNode,
} from 'react';
import { useAIMarkdownDocument, useAIMarkdownTheme } from '@ai-markdown/react';
import { useImagePreview } from './imagePreview';
const subscribeClient = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;
import type { Element as HastElement } from 'hast';
import {
  getImageGallery,
  imageIconPaths,
  defaultImageLabels,
  resolveLabels,
  type ImageGallery,
  type ImageIconName,
  type ImageLabels,
  type LabelsOption,
  type ImageLoadStatus,
} from '@ai-markdown/core/components';
export type { ImageIconName, ImageLabels, LabelsOption } from '@ai-markdown/core/components';
export type MarkdownImageProps = ComponentPropsWithoutRef<'img'> & { node?: HastElement };
export interface ImageIconProps {
  className?: string;
  'aria-hidden'?: boolean;
}
export type MarkdownImageIcon = ReactNode | ComponentType<ImageIconProps>;
export interface MarkdownImageOptions {
  icons?: Partial<Record<ImageIconName, MarkdownImageIcon>>;
  /** Images of one document form a gallery. A selector groups by the nearest matching ancestor instead; false disables grouping. */
  group?: string | false;
  preview?: boolean;
  /** Text of the thumbnail and the preview, as overrides of the English defaults. A function is called at a fixed place in every render, so it may call hooks. */
  labels?: LabelsOption<ImageLabels>;
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
/** Configure once, then register the result directly as customComponents.img. */
export function createMarkdownImage({
  icons,
  group,
  preview: allowPreview = true,
  labels: configuredLabels,
}: MarkdownImageOptions = {}) {
  return function MarkdownImage({ node: _node, ...props }: MarkdownImageProps) {
    const mounted = useSyncExternalStore(subscribeClient, clientSnapshot, serverSnapshot);
    const { colorScheme } = useAIMarkdownTheme();
    const { scope: documentScope } = useAIMarkdownDocument();
    const labels = resolveLabels(defaultImageLabels, configuredLabels);
    const image = useRef<HTMLImageElement>(null),
      trigger = useRef<HTMLButtonElement>(null);
    const [enabled, setEnabled] = useState(false),
      [status, setStatus] = useState<ImageLoadStatus>('loading'),
      [loadedSource, setLoadedSource] = useState(''),
      [multi, setMulti] = useState(false);
    const galleryRef = useRef<ImageGallery | undefined>(undefined);
    // The preview follows the gallery by itself; it closes when its image leaves it.
    const preview = useImagePreview({
      renderIcon: (name) => <ImageIcon name={name} icons={icons} />,
      labels,
      onClosed: () => trigger.current?.focus(),
    });
    const closePreview = preview.close;
    const [source, setSource] = useState({ src: props.src, srcSet: props.srcSet });
    if (source.src !== props.src || source.srcSet !== props.srcSet) {
      setSource({ src: props.src, srcSet: props.srcSet });
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
        if (!allowed) closePreview();
      };
      update();
      const observer = new MutationObserver(update);
      let parent = image.current?.closest('.aimd-image');
      while (parent) {
        observer.observe(parent, { attributes: true, attributeFilter: ['role', 'href'] });
        parent = parent.parentElement;
      }
      return () => observer.disconnect();
    }, [props.src, props.srcSet, closePreview]);
    useEffect(() => {
      const element = image.current;
      if (element?.complete && (props.src || props.srcSet)) setStatus(element.naturalWidth > 0 ? 'ready' : 'error');
    }, [props.src, props.srcSet, enabled]);
    useEffect(() => {
      const element = image.current;
      if (!element || !enabled || status !== 'ready') {
        setMulti(false);
        return;
      }
      const scope =
        group === undefined ? documentScope : group === false ? element : (element.closest(group) ?? element);
      const gallery = getImageGallery(scope);
      // Every ready image hears each change; none of them sorts the list for it.
      const sync = () => setMulti(gallery.size() > 1);
      const unsubscribe = gallery.subscribe(sync);
      galleryRef.current = gallery;
      gallery.set({
        id: element,
        src: element.currentSrc || props.src || '',
        alt: props.alt ?? '',
        precedes: (other) => Boolean(element.compareDocumentPosition(other as Node) & 4),
      });
      sync();
      return () => {
        unsubscribe();
        gallery.remove(element);
        if (galleryRef.current === gallery) galleryRef.current = undefined;
      };
    }, [enabled, status, props.src, props.srcSet, props.alt, loadedSource, documentScope]);
    const img = (
      <img
        {...props}
        ref={image}
        style={{ ...props.style, ...(mounted && status !== 'ready' ? { opacity: 0 } : {}) }}
        onLoad={(event) => {
          setStatus('ready');
          setLoadedSource(event.currentTarget.currentSrc);
          props.onLoad?.(event);
        }}
        onError={(event) => {
          setStatus('error');
          props.onError?.(event);
        }}
      />
    );
    const feedback = mounted && status !== 'ready' && (
      <span className="aimd-image-feedback" role={status === 'error' ? 'alert' : 'status'}>
        <ImageIcon name={status === 'error' ? 'error' : 'placeholder'} icons={icons} />
        <span>
          {status === 'error' ? labels.loadFailed : labels.loading}
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
            <ImageIcon name={multi ? 'gallery' : 'preview'} icons={icons} />
          </span>
        )}
      </>
    );
    return (
      <>
        <span className="aimd-image" data-color-scheme={colorScheme} data-status={mounted ? status : undefined}>
          {enabled ? (
            <button
              className="aimd-image-trigger"
              type="button"
              ref={trigger}
              disabled={status !== 'ready'}
              aria-label={labels.open(props.alt ?? '')}
              onClick={() => {
                if (galleryRef.current && image.current) preview.open(galleryRef.current, image.current);
              }}
            >
              {contents}
            </button>
          ) : (
            contents
          )}
        </span>
        {preview.element}
      </>
    );
  };
}
export const MarkdownImage = createMarkdownImage();

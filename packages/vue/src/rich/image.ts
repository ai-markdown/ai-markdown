import { useImagePreview } from './imagePreview';
import {
  defineComponent,
  h,
  isVNode,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  nextTick,
  type Component,
  type DefineComponent,
  type PropType,
  type VNodeChild,
} from 'vue';
import type { Element } from 'hast';
import type { MarkdownComponentProps } from './types';
import { useOptionalAIMarkdownDocument } from '../documents';
import {
  getImageGallery,
  imageIconPaths,
  type ImageGallery,
  type ImageIconName,
  type ImageLabels,
  type ImageLoadStatus,
  type LabelsOption,
  defaultImageLabels,
  resolveLabels,
} from '@ai-markdown/core/components';
export type { ImageIconName, ImageLabels, LabelsOption } from '@ai-markdown/core/components';
export type MarkdownImageIcon = VNodeChild | Component;
export interface MarkdownImageOptions {
  icons?: Partial<Record<ImageIconName, MarkdownImageIcon>>;
  /** Images of one document form a gallery. A selector groups by the nearest matching ancestor instead; false disables grouping. */
  group?: string | false;
  preview?: boolean;
  /** Text of the thumbnail and the preview, as overrides of the English defaults. A function is read on every render. */
  labels?: LabelsOption<ImageLabels>;
}
function icon(name: ImageIconName, icons?: MarkdownImageOptions['icons']) {
  const custom = icons?.[name];
  return h('span', { class: 'aimd-image-icon', 'aria-hidden': 'true', 'data-image-icon': name }, [
    custom !== undefined
      ? typeof custom === 'function' ||
        (typeof custom === 'object' && custom !== null && !isVNode(custom) && !Array.isArray(custom))
        ? h(custom as Component, { 'aria-hidden': true })
        : (custom as VNodeChild)
      : h(
          'svg',
          {
            viewBox: '0 0 24 24',
            width: 24,
            height: 24,
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': 2,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
            focusable: 'false',
          },
          imageIconPaths[name].map((d) => h('path', { d }))
        ),
  ]);
}
/** Configure once, then register the result directly as components.img. */
export function createMarkdownImage({
  icons,
  group,
  preview: allowPreview = true,
  labels: configuredLabels,
}: MarkdownImageOptions = {}): DefineComponent<MarkdownComponentProps> {
  return defineComponent({
    name: 'MarkdownImage',
    inheritAttrs: false,
    props: { node: Object as PropType<Element>, streaming: Boolean, metadata: null },
    setup(_, { attrs }) {
      const markdownDocument = useOptionalAIMarkdownDocument();
      const image = ref<HTMLImageElement>(),
        trigger = ref<HTMLButtonElement>();
      const mounted = ref(false);
      const enabled = ref(false),
        multi = ref(false),
        status = ref<ImageLoadStatus>('loading'),
        loadedSource = ref('');
      let currentGallery: ImageGallery | undefined;
      // The preview follows the gallery by itself; it closes when its image leaves it.
      const preview = useImagePreview({
        renderIcon: (name) => icon(name, icons),
        labels: () => resolveLabels(defaultImageLabels, configuredLabels),
        onClosed: () => trigger.value?.focus(),
      });
      let observer: MutationObserver | undefined;
      const update = () => {
        const parent = image.value?.closest('.aimd-image');
        enabled.value =
          allowPreview &&
          Boolean(attrs.src || attrs.srcset || attrs.srcSet) &&
          !parent?.closest('a,button,[role="link"],[role="button"]');
        if (!enabled.value) preview.close();
      };
      const observe = () => {
        observer?.disconnect();
        update();
        observer = new MutationObserver(update);
        let parent = image.value?.closest('.aimd-image');
        while (parent) {
          observer.observe(parent, { attributes: true, attributeFilter: ['role', 'href'] });
          parent = parent.parentElement;
        }
      };
      const syncCached = () => {
        const element = image.value;
        if (element?.complete && (attrs.src || attrs.srcset || attrs.srcSet))
          status.value = element.naturalWidth > 0 ? 'ready' : 'error';
      };
      onMounted(() => {
        mounted.value = true;
        observe();
        syncCached();
      });
      watch(enabled, () => {
        void nextTick(syncCached);
      });
      watch(
        () => [attrs.src, attrs.srcset, attrs.srcSet],
        () => {
          preview.close();
          status.value = 'loading';
          void nextTick(() => {
            observe();
            syncCached();
          });
        }
      );
      watch(
        () => [
          enabled.value,
          status.value,
          attrs.src,
          attrs.srcset,
          attrs.srcSet,
          attrs.alt,
          loadedSource.value,
          markdownDocument?.scope.value,
        ],
        (_, __, onCleanup) => {
          const element = image.value;
          if (!element || !enabled.value || status.value !== 'ready') {
            multi.value = false;
            return;
          }
          const scope =
            group === undefined
              ? (markdownDocument?.scope.value ?? element)
              : group === false
                ? element
                : (element.closest(group) ?? element);
          const gallery = getImageGallery(scope);
          // Every ready image hears each change; none of them sorts the list for it.
          const sync = () => {
            multi.value = gallery.size() > 1;
          };
          const unsubscribe = gallery.subscribe(sync);
          currentGallery = gallery;
          gallery.set({
            id: element,
            src: element.currentSrc || String(attrs.src ?? ''),
            alt: String(attrs.alt ?? ''),
            precedes: (other) => Boolean(element.compareDocumentPosition(other as Node) & 4),
          });
          sync();
          onCleanup(() => {
            unsubscribe();
            gallery.remove(element);
            if (currentGallery === gallery) currentGallery = undefined;
          });
        },
        { flush: 'post' }
      );
      onBeforeUnmount(() => observer?.disconnect());
      return () => {
        const labels = resolveLabels(defaultImageLabels, configuredLabels);
        const feedback = (state: ImageLoadStatus, alt = '') =>
          mounted.value &&
          state !== 'ready' &&
          h('span', { class: 'aimd-image-feedback', role: state === 'error' ? 'alert' : 'status' }, [
            icon(state === 'error' ? 'error' : 'placeholder', icons),
            h('span', state === 'error' ? `${labels.loadFailed}${alt ? ` ${alt}` : ''}` : labels.loading),
          ]);
        const img = h('img', {
          ...attrs,
          ref: image,
          style: [attrs.style, mounted.value && status.value !== 'ready' ? { opacity: 0 } : undefined],
          onLoad: [
            attrs.onLoad,
            (event: Event) => {
              status.value = 'ready';
              loadedSource.value = (event.currentTarget as HTMLImageElement).currentSrc;
            },
          ],
          onError: [
            attrs.onError,
            () => {
              status.value = 'error';
            },
          ],
        });
        const content = [
          img,
          feedback(status.value, String(attrs.alt ?? '')),
          enabled.value &&
            status.value === 'ready' &&
            h('span', { class: 'aimd-image-cover' }, [icon(multi.value ? 'gallery' : 'preview', icons)]),
        ];
        return [
          h(
            'span',
            { class: 'aimd-image', 'data-status': mounted.value ? status.value : undefined },
            enabled.value
              ? [
                  h(
                    'button',
                    {
                      ref: trigger,
                      type: 'button',
                      disabled: status.value !== 'ready',
                      class: 'aimd-image-trigger',
                      'aria-label': labels.open(String(attrs.alt ?? '')),
                      onClick: () => {
                        if (currentGallery && image.value) preview.open(currentGallery, image.value);
                      },
                    },
                    content
                  ),
                ]
              : content
          ),
          preview.render(),
        ];
      };
    },
  }) as DefineComponent<MarkdownComponentProps>;
}
export const MarkdownImage = createMarkdownImage();

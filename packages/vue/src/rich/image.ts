import { ImagePreview } from './imagePreview';
import {
  defineComponent,
  h,
  isVNode,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  nextTick,
  type Component,
  type DefineComponent,
  type PropType,
  type VNodeChild,
} from 'vue';
import type { Element } from 'hast';
import type { MarkdownComponentProps } from './types';
import {
  getImageGallery,
  imageGroupSelector,
  imageIconPaths,
  type ImageGalleryItem,
  type ImageIconName,
  type ImageLoadStatus,
} from '@ai-markdown/core/components';
export type { ImageIconName } from '@ai-markdown/core/components';
export type MarkdownImageIcon = VNodeChild | Component;
export interface MarkdownImageOptions {
  icons?: Partial<Record<ImageIconName, MarkdownImageIcon>>;
  /** Nearest ancestor selector; defaults to the Markdown root. false disables grouping. */
  group?: string | false;
  preview?: boolean;
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
}: MarkdownImageOptions = {}): DefineComponent<MarkdownComponentProps> {
  return defineComponent({
    name: 'MarkdownImage',
    inheritAttrs: false,
    props: { node: Object as PropType<Element>, streaming: Boolean, metadata: null },
    setup(_, { attrs }) {
      const image = ref<HTMLImageElement>(),
        trigger = ref<HTMLButtonElement>();
      const enabled = ref(false),
        selected = shallowRef<object | null>(null),
        items = shallowRef<readonly ImageGalleryItem[]>([]),
        status = ref<ImageLoadStatus>('loading'),
        loadedSource = ref('');
      let observer: MutationObserver | undefined;
      const update = () => {
        const parent = image.value?.closest('.aimd-image');
        enabled.value =
          allowPreview &&
          Boolean(attrs.src || attrs.srcset || attrs.srcSet) &&
          !parent?.closest('a,button,[role="link"],[role="button"]');
        if (!enabled.value) selected.value = null;
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
        observe();
        syncCached();
      });
      watch(enabled, () => {
        void nextTick(syncCached);
      });
      watch(
        () => [attrs.src, attrs.srcset, attrs.srcSet],
        () => {
          selected.value = null;
          status.value = 'loading';
          void nextTick(() => {
            observe();
            syncCached();
          });
        }
      );
      watch(
        () => [enabled.value, status.value, attrs.src, attrs.srcset, attrs.srcSet, attrs.alt, loadedSource.value],
        (_, __, onCleanup) => {
          const element = image.value;
          if (!element || !enabled.value || status.value !== 'ready') {
            items.value = [];
            return;
          }
          const scope = group === false ? element : (element.closest(group ?? imageGroupSelector) ?? element);
          const gallery = getImageGallery(scope);
          const refresh = () => {
            items.value = gallery.items();
          };
          const unsubscribe = gallery.subscribe(refresh);
          gallery.set({
            id: element,
            src: element.currentSrc || String(attrs.src ?? ''),
            alt: String(attrs.alt ?? ''),
            precedes: (other) => Boolean(element.compareDocumentPosition(other as Node) & 4),
          });
          refresh();
          onCleanup(() => {
            unsubscribe();
            gallery.remove(element);
          });
        },
        { flush: 'post' }
      );
      const close = () => {
        selected.value = null;
      };
      const current = () => items.value.find((item) => item.id === selected.value);
      watch(
        () => current(),
        (item) => {
          if (selected.value && !item) close();
        }
      );
      onBeforeUnmount(() => observer?.disconnect());
      return () => {
        const item = current(),
          index = items.value.findIndex((entry) => entry.id === selected.value);
        const feedback = (state: ImageLoadStatus, alt = '') =>
          state !== 'ready' &&
          h('span', { class: 'aimd-image-feedback', role: state === 'error' ? 'alert' : 'status' }, [
            icon(state === 'error' ? 'error' : 'placeholder', icons),
            h('span', state === 'error' ? `Image could not be loaded.${alt ? ` ${alt}` : ''}` : 'Loading image…'),
          ]);
        const img = h('img', {
          ...attrs,
          ref: image,
          style: [attrs.style, status.value !== 'ready' ? { opacity: 0 } : undefined],
          onLoad: [
            attrs.onLoad,
            (event: Event) => {
              status.value = 'ready';
              loadedSource.value = (event.currentTarget as HTMLImageElement).currentSrc;
              if (selected.value === image.value && item?.src !== (event.currentTarget as HTMLImageElement).currentSrc)
                close();
            },
          ],
          onError: [
            attrs.onError,
            () => {
              status.value = 'error';
              close();
            },
          ],
        });
        const content = [
          img,
          feedback(status.value, String(attrs.alt ?? '')),
          enabled.value &&
            status.value === 'ready' &&
            h('span', { class: 'aimd-image-cover' }, [icon(items.value.length > 1 ? 'gallery' : 'preview', icons)]),
        ];
        return [
          h(
            'span',
            { class: 'aimd-image', 'data-status': status.value },
            enabled.value
              ? [
                  h(
                    'button',
                    {
                      ref: trigger,
                      type: 'button',
                      disabled: status.value !== 'ready',
                      class: 'aimd-image-trigger',
                      'aria-label': `Preview image${attrs.alt ? `: ${attrs.alt}` : ''}`,
                      onClick: () => {
                        selected.value = image.value ?? null;
                      },
                    },
                    content
                  ),
                ]
              : content
          ),
          enabled.value &&
            h(ImagePreview, {
              open: Boolean(item),
              items: items.value,
              current: index,
              renderIcon: (name: ImageIconName) => icon(name, icons),
              onCurrentChange: (next: number) => {
                selected.value = items.value[next]?.id ?? null;
              },
              onClose: close,
              afterClose: () => trigger.value?.focus(),
            }),
        ];
      };
    },
  }) as DefineComponent<MarkdownComponentProps>;
}
export const MarkdownImage = createMarkdownImage();

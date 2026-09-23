import type { DefineComponent } from 'vue';
import type { MarkdownComponentProps } from './types';
import { defineComponent, h, onBeforeUnmount, onMounted, ref, Teleport, watch, nextTick, type PropType } from 'vue';
import type { Element } from 'hast';
import { lockImagePreviewScroll } from '@ai-markdown/core/components';
export const MarkdownImage = defineComponent({
  name: 'MarkdownImage',
  inheritAttrs: false,
  props: { node: Object as PropType<Element>, streaming: Boolean, metadata: null },
  setup(_, { attrs }) {
    const image = ref<HTMLImageElement>(),
      trigger = ref<HTMLButtonElement>(),
      dialog = ref<HTMLDialogElement>();
    const enabled = ref(false),
      preview = ref(''),
      failed = ref(false),
      original = ref(false),
      status = ref<'loading' | 'ready' | 'error'>('loading');
    let observer: MutationObserver | undefined;
    const update = () => {
      const parent =
        image.value?.parentElement === trigger.value ? trigger.value?.parentElement : image.value?.parentElement;
      enabled.value =
        Boolean(attrs.src || attrs.srcset || attrs.srcSet) &&
        !parent?.closest('a,button,[role="link"],[role="button"]');
      if (!enabled.value) preview.value = '';
    };
    const observe = () => {
      observer?.disconnect();
      update();
      observer = new MutationObserver(update);
      let parent = image.value?.parentElement;
      while (parent) {
        observer.observe(parent, { attributes: true, attributeFilter: ['role', 'href'] });
        parent = parent.parentElement;
      }
    };
    onMounted(observe);
    watch(enabled, () => {
      void nextTick(observe);
    });
    watch(
      () => [attrs.src, attrs.srcset, attrs.srcSet],
      () => {
        preview.value = '';
        failed.value = false;
        void nextTick(observe);
      }
    );
    watch(
      preview,
      (_, __, onCleanup) => {
        original.value = false;
        status.value = 'loading';
        if (preview.value) onCleanup(lockImagePreviewScroll(document.body));
        if (preview.value && dialog.value && !dialog.value.open) dialog.value.showModal();
        else if (!preview.value) dialog.value?.close();
      },
      { flush: 'post' }
    );
    onBeforeUnmount(() => observer?.disconnect());
    return () => {
      const img = h('img', {
        ...attrs,
        ref: image,
        onLoad: [
          attrs.onLoad,
          (event: Event) => {
            failed.value = false;
            if (preview.value && preview.value !== (event.currentTarget as HTMLImageElement).currentSrc)
              preview.value = '';
          },
        ],
        onError: [
          attrs.onError,
          () => {
            failed.value = true;
            preview.value = '';
          },
        ],
      });
      const selectedSource = preview.value;
      if (!enabled.value) return img;
      return [
        h(
          'button',
          {
            ref: trigger,
            type: 'button',
            disabled: failed.value,
            class: 'aimd-image-trigger',
            'aria-label': `Preview image${attrs.alt ? `: ${attrs.alt}` : ''}`,
            onClick: () => {
              preview.value = image.value?.currentSrc || String(attrs.src ?? '');
            },
          },
          [img]
        ),
        h(
          Teleport,
          { to: 'body' },
          h(
            'dialog',
            {
              ref: dialog,
              class: 'aimd-image-dialog',
              'aria-label': attrs.alt || 'Image preview',
              onCancel: () => {
                preview.value = '';
              },
              onClose: () => {
                preview.value = '';
                trigger.value?.focus();
              },
              onClick: (event: MouseEvent) => {
                if (event.target === event.currentTarget) preview.value = '';
              },
            },
            [
              h(
                'button',
                {
                  type: 'button',
                  autofocus: true,
                  onClick: () => {
                    preview.value = '';
                  },
                },
                'Close preview'
              ),
              h(
                'button',
                {
                  type: 'button',
                  'aria-pressed': original.value,
                  onClick: () => {
                    original.value = !original.value;
                  },
                },
                original.value ? 'Fit image' : 'Original size'
              ),
              selectedSource && status.value === 'loading' && h('p', { role: 'status' }, 'Loading image…'),
              selectedSource && status.value === 'error' && h('p', { role: 'alert' }, 'Image could not be loaded.'),
              selectedSource &&
                h(
                  'div',
                  { class: 'aimd-image-viewport', style: { overflow: 'auto', maxWidth: '90vw', maxHeight: '80vh' } },
                  [
                    h('img', {
                      key: selectedSource,
                      src: selectedSource,
                      alt: attrs.alt ?? '',
                      style: {
                        maxWidth: original.value ? 'none' : '85vw',
                        maxHeight: original.value ? 'none' : '75vh',
                      },
                      onLoad: () => {
                        if (preview.value === selectedSource) status.value = 'ready';
                      },
                      onError: () => {
                        if (preview.value === selectedSource) status.value = 'error';
                      },
                    }),
                  ]
                ),
            ]
          )
        ),
      ];
    };
  },
}) as DefineComponent<MarkdownComponentProps>;

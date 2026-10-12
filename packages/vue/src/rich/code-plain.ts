import type { DefineComponent } from 'vue';
import type { MarkdownComponentProps } from './types';
import { useOptionalAIMarkdownDocument } from '../documents';
import {
  computed,
  defineComponent,
  h,
  onBeforeUnmount,
  onErrorCaptured,
  onMounted,
  ref,
  watch,
  type Component,
  type PropType,
  type VNodeChild,
} from 'vue';
import type { Element } from 'hast';
import {
  extractCode,
  normalizeRenderers,
  createCodeBlockSession,
  defaultCodeBlockLabels,
  resolveLabels,
  type CodeBlockInput,
  type CodeBlockLabels,
  type LabelsOption,
  type CodeRendererInput,
  type CodeBlockOptions,
} from '@ai-markdown/core/components';
import { normalizeHighlightJsLanguage } from '@ai-markdown/code-language-detector';
export type { CodeRendererInput, CodeBlockOptions, CodeBlockLabels, LabelsOption } from '@ai-markdown/core/components';
export interface MarkdownCodeBlockOptions extends CodeBlockOptions {
  renderers?: Readonly<Record<string, Component | false>>;
  colorScheme?: 'light' | 'dark' | (() => 'light' | 'dark');
  highlight?: (code: string, language: string) => VNodeChild;
}
const RendererBoundary = defineComponent({
  setup(_, { slots }) {
    const failed = ref(false);
    onErrorCaptured(() => {
      failed.value = true;
      return false;
    });
    return () => (failed.value ? slots.fallback?.() : slots.default?.());
  },
});
/** Synchronous outer component: Markdown passes context as declared props,
 * element attributes as attrs, and rendered children in the default slot. */
export function createMarkdownCodeBlock(
  options: MarkdownCodeBlockOptions = {}
): DefineComponent<MarkdownComponentProps> {
  const renderers = normalizeRenderers(options.renderers ?? {});
  const interval =
    Number.isFinite(options.highlightIntervalMs) && options.highlightIntervalMs! >= 0
      ? options.highlightIntervalMs!
      : 50;
  return defineComponent({
    name: 'MarkdownCodeBlock',
    inheritAttrs: false,
    props: { node: Object as PropType<Element>, streaming: Boolean, metadata: null },
    setup(props, { attrs, slots }) {
      const markdownDocument = useOptionalAIMarkdownDocument();
      const parsed = computed(() => extractCode(props.node));
      const code = computed(() => parsed.value?.code ?? '');
      const language = computed(() => parsed.value?.language ?? '');
      const mounted = ref(false),
        source = ref(false),
        expanded = ref(options.defaultExpanded ?? true),
        feedback = ref<'' | 'copied' | 'copyFailed'>('');
      // The policy is core's session. `changes` makes the snapshot read again when a timer moves it.
      const changes = ref(0);
      const session = createCodeBlockSession(() => {
        changes.value++;
      });
      const input = computed<CodeBlockInput>(() => ({
        code: code.value,
        language: language.value,
        // Another document at the same position is another block, even when its text continues this one.
        identity: `${markdownDocument?.documentId.value ?? ''}:${props.node?.position?.start.offset ?? ''}`,
        streaming: Boolean(props.streaming),
        autoDetect: options.autoDetectUnknownLanguage ?? true,
        formatJson: options.formatJson ?? false,
        expandNestedJson: options.expandNestedJson ?? false,
        highlightIntervalMs: interval,
      }));
      const block = computed(() => {
        void changes.value;
        return session.read(input.value);
      });
      watch(
        () => block.value.generation,
        () => {
          source.value = false;
          feedback.value = '';
        },
        { flush: 'sync' }
      );
      // Committed after the render, and only on the client: a server render starts no timer.
      watch(
        [input, mounted],
        ([next, onClient]) => {
          if (onClient) session.commit(next);
        },
        { flush: 'post' }
      );
      onBeforeUnmount(() => session.dispose());
      onMounted(() => {
        mounted.value = true;
      });
      const detected = computed(() => block.value.language);
      const formatted = computed(() => block.value.text);
      const highlighted = computed(() => {
        try {
          return options.highlight?.(formatted.value, normalizeHighlightJsLanguage(detected.value)) ?? formatted.value;
        } catch {
          return formatted.value;
        }
      });
      const copy = async () => {
        const snapshot = code.value;
        try {
          await navigator.clipboard.writeText(snapshot);
          feedback.value = 'copied';
        } catch {
          feedback.value = 'copyFailed';
        }
      };
      return () => {
        if (!parsed.value) return h('pre', attrs, slots.default?.());
        const Renderer = renderers[language.value];
        const labels = resolveLabels(defaultCodeBlockLabels, options.labels);
        const colorScheme =
          typeof options.colorScheme === 'function' ? options.colorScheme() : (options.colorScheme ?? 'light');
        const original = () =>
          h('pre', attrs, [
            h('code', { class: language.value ? `language-${language.value}` : undefined }, highlighted.value),
          ]);
        const resetKey = `${props.node?.position?.start.offset ?? ''}:${language.value}:${block.value.generation}`;
        return h('section', { class: 'aimd-code', 'data-language': language.value, 'data-color-scheme': colorScheme }, [
          h('div', { class: 'aimd-toolbar', role: 'group', 'aria-label': labels.actions }, [
            h('span', detected.value || labels.plainText),
            h('button', { type: 'button', onClick: copy }, labels.copy),
            Renderer &&
              h(
                'button',
                {
                  type: 'button',
                  'aria-pressed': source.value,
                  onClick: () => {
                    source.value = !source.value;
                  },
                },
                source.value ? labels.showPreview : labels.showSource
              ),
            h(
              'button',
              {
                type: 'button',
                'aria-expanded': expanded.value,
                onClick: () => {
                  expanded.value = !expanded.value;
                },
              },
              expanded.value ? labels.collapse : labels.expand
            ),
            h('span', { role: 'status' }, feedback.value && labels[feedback.value]),
          ]),
          h(
            'div',
            {
              class: 'aimd-code-content',
              'data-collapsed': !expanded.value,
              style: !expanded.value ? { maxHeight: '320px', overflow: 'auto' } : undefined,
            },
            [
              (!mounted.value || source.value || !Renderer) && original(),
              mounted.value &&
                Renderer &&
                h('div', { hidden: source.value }, [
                  h(
                    RendererBoundary,
                    { key: resetKey },
                    {
                      default: () =>
                        h(Renderer, {
                          code: code.value,
                          language: language.value,
                          streaming: Boolean(props.streaming),
                          colorScheme,
                          active: !source.value && expanded.value,
                          resetKey,
                        } satisfies CodeRendererInput),
                      fallback: () => [h('p', { role: 'alert' }, labels.previewFailed), original()],
                    }
                  ),
                ]),
            ]
          ),
        ]);
      };
    },
  }) as DefineComponent<MarkdownComponentProps>;
}
export const MarkdownCodeBlock = createMarkdownCodeBlock();

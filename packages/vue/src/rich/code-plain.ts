import type { DefineComponent } from 'vue';
import type { MarkdownComponentProps } from './types';
import { useOptionalAIMarkdownDocument } from '../documents';
import {
  computed,
  defineComponent,
  h,
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
  defaultCodeBlockLabels,
  resolveLabels,
  type CodeBlockInput,
  type CodeRendererInput,
  type CodeBlockOptions,
} from '@ai-markdown/core/components';
import { resolveCodeHighlightLanguage, resolveCodeBlockPolicy } from '@ai-markdown/core/components';
import { useCodeBlock } from './useCodeBlock';
import { useCodeHighlight } from './useCodeHighlight';
export { useCodeBlock } from './useCodeBlock';
export { useCodeHighlight } from './useCodeHighlight';
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
  const config = resolveCodeBlockPolicy(options);
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
        expanded = ref(config.defaultExpanded),
        feedback = ref<'' | 'copied' | 'copyFailed'>('');
      const input = computed<CodeBlockInput>(() => ({
        code: code.value,
        language: language.value,
        // Another document at the same position is another block, even when its text continues this one.
        identity: `${markdownDocument?.documentId.value ?? ''}:${props.node?.position?.start.offset ?? ''}`,
        streaming: Boolean(props.streaming),
        autoDetect: config.autoDetectUnknownLanguage,
        formatJson: config.formatJson,
        expandNestedJson: config.expandNestedJson,
        highlightIntervalMs: config.highlightIntervalMs,
      }));
      const block = useCodeBlock(input);
      watch(
        () => block.value.generation,
        () => {
          source.value = false;
          feedback.value = '';
        },
        { flush: 'sync' }
      );
      onMounted(() => {
        mounted.value = true;
      });
      const detected = computed(() => block.value.language);
      const formatted = computed(() => block.value.text);
      const scheme = computed(() =>
        typeof options.colorScheme === 'function' ? options.colorScheme() : (options.colorScheme ?? 'light')
      );
      const { result: highlightState } = useCodeHighlight(
        computed(() => ({
          adapter: options.highlighter,
          streaming: Boolean(props.streaming),
          code: formatted.value,
          language: detected.value,
          colorScheme: scheme.value,
          generation: block.value.generation,
          active: !(renderers[language.value] && mounted.value && !source.value),
        }))
      );
      const highlighted = computed(() => {
        if (options.highlighter) {
          const result = highlightState.value.result;
          if (!result) return formatted.value;
          if ('html' in result) return h('span', { innerHTML: result.html });
          return result.tokens.map((token) =>
            h(
              'span',
              {
                style: {
                  color: token.color,
                  backgroundColor: token.backgroundColor,
                  fontStyle: (token.fontStyle ?? 0) & 1 ? 'italic' : undefined,
                  fontWeight: (token.fontStyle ?? 0) & 2 ? 'bold' : undefined,
                  textDecoration: (token.fontStyle ?? 0) & 4 ? 'underline' : undefined,
                },
              },
              token.text
            )
          );
        }
        try {
          return (
            options.highlight?.(
              formatted.value,
              resolveCodeHighlightLanguage(detected.value, options.languageFormat)
            ) ?? formatted.value
          );
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
            h(
              'code',
              {
                'data-highlight-status': options.highlighter
                  ? highlightState.value.status
                  : options.highlight
                    ? 'callback'
                    : 'plain',
                'data-highlight-language': options.highlighter ? highlightState.value.language : undefined,
                class: language.value ? `language-${language.value}` : undefined,
              },
              highlighted.value
            ),
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

export {
  CodeLanguageFormat,
  resolveCodeHighlightLanguage,
  createPierreHighlightAdapter,
} from '@ai-markdown/core/components';
export type {
  CodeHighlightAdapter,
  CodeHighlightResult,
  CodeHighlightRequest,
  CodeHighlightToken,
  CodeLanguageResolver,
} from '@ai-markdown/core/components';

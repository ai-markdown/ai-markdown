import type { DefineComponent } from 'vue';
import type { MarkdownComponentProps } from './types';
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
  createCodeFrame,
  prettyPrintJson,
  jsonLooksComplete,
  type CodeRendererInput,
  type CodeBlockOptions,
} from '@ai-markdown/core/components';
import { detectLanguage, normalizeHighlightJsLanguage } from '@ai-markdown/code-language-detector';
export type { CodeRendererInput, CodeBlockOptions } from '@ai-markdown/core/components';
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
      const parsed = computed(() => extractCode(props.node));
      const code = computed(() => parsed.value?.code ?? '');
      const language = computed(() => parsed.value?.language ?? '');
      const mounted = ref(false),
        source = ref(false),
        expanded = ref(options.defaultExpanded ?? true),
        feedback = ref('');
      const generation = ref(0);
      const frame = ref(code.value);
      const controller = createCodeFrame({ code: code.value, language: language.value }, (value) => {
        frame.value = value.code;
      });
      watch(
        [code, language, () => props.streaming],
        ([next, lang, streaming], previous) => {
          if (previous && (lang !== previous[1] || !next.startsWith(previous[0]))) {
            generation.value++;
            source.value = false;
            feedback.value = '';
          }
          controller.update({ code: next, language: lang }, Boolean(streaming), interval);
        },
        { flush: 'sync' }
      );
      onBeforeUnmount(() => controller.dispose());
      onMounted(() => {
        mounted.value = true;
      });
      const displayed = computed(() =>
        !props.streaming || !code.value.startsWith(frame.value) || interval === 0 ? code.value : frame.value
      );
      const detected = computed(
        () =>
          language.value ||
          ((options.autoDetectUnknownLanguage ?? true) ? (detectLanguage(displayed.value).language ?? '') : '')
      );
      const formatted = computed(() =>
        options.formatJson && detected.value === 'json' && (!props.streaming || jsonLooksComplete(displayed.value))
          ? prettyPrintJson(displayed.value, options.expandNestedJson ?? false)
          : displayed.value
      );
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
          feedback.value = 'Copied';
        } catch {
          feedback.value = 'Copy failed';
        }
      };
      return () => {
        if (!parsed.value) return h('pre', attrs, slots.default?.());
        const Renderer = renderers[language.value];
        const colorScheme =
          typeof options.colorScheme === 'function' ? options.colorScheme() : (options.colorScheme ?? 'light');
        const original = () =>
          h('pre', attrs, [
            h('code', { class: language.value ? `language-${language.value}` : undefined }, highlighted.value),
          ]);
        const resetKey = `${props.node?.position?.start.offset ?? ''}:${language.value}:${generation.value}`;
        return h('section', { class: 'aimd-code', 'data-language': language.value, 'data-color-scheme': colorScheme }, [
          h('div', { class: 'aimd-toolbar', role: 'group', 'aria-label': 'Code block actions' }, [
            h('span', detected.value || 'text'),
            h('button', { type: 'button', onClick: copy }, 'Copy code'),
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
                source.value ? 'Show preview' : 'Show source'
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
              expanded.value ? 'Collapse' : 'Expand'
            ),
            h('span', { role: 'status' }, feedback.value),
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
                      fallback: () => [
                        h('p', { role: 'alert' }, 'Preview failed. Source is available below.'),
                        original(),
                      ],
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

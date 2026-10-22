import { computed, defineComponent, h, onBeforeUnmount, ref, watch, type PropType, type VNodeChild } from 'vue';
import { CodeLanguageFormat, resolveCodeHighlightLanguage } from '@ai-markdown/core/components';
import {
  behaviorDocument,
  createDemoHighlighter,
  fence,
  languageDocument,
  rendererDocument,
  samples,
  scenarioText,
  type DemoEngine,
  type DemoScenario,
} from '../common/codeHighlighting';
import type { HighlightDemoState } from '../common/codeHighlighting';
export const CodeHighlightingDemo = defineComponent({
  props: {
    initialEngine: { type: String as PropType<DemoEngine> },
    scenario: { type: String as PropType<DemoScenario>, required: true },
    renderDocument: { type: Function as PropType<(state: HighlightDemoState) => VNodeChild>, required: true },
  },
  setup(props) {
    const engine = ref<DemoEngine>(props.initialEngine ?? (props.scenario === 'legacy' ? 'Legacy' : 'Shiki'));
    const colorScheme = ref<'light' | 'dark'>('light'),
      language = ref('tsx');
    const count = ref(samples.tsx.length),
      running = ref(false),
      streaming = ref(false),
      document = ref(0),
      attempt = ref(0),
      replacement = ref(false);
    const highlighter = computed(() => {
      void attempt.value;
      return createDemoHighlighter(
        engine.value,
        ['loading', 'failure', 'theme'].includes(props.scenario) ? 800 : 0,
        props.scenario === 'failure' && attempt.value === 0
      );
    });
    const code = computed(() =>
      replacement.value ? 'export const replacement: string = "new document";' : samples[language.value]
    );
    let timer: ReturnType<typeof setInterval> | undefined;
    watch(running, (on) => {
      clearInterval(timer);
      if (on)
        timer = setInterval(() => {
          count.value = Math.min(count.value + 3, code.value.length);
          if (count.value >= code.value.length) {
            running.value = false;
            streaming.value = false;
          }
        }, 60);
    });
    onBeforeUnmount(() => clearInterval(timer));
    const button = (label: string, onClick: () => void) => h('button', { onClick }, label);
    const select = (label: string, value: string, values: string[], change: (value: string) => void) =>
      h('label', [
        label + ' ',
        h(
          'select',
          { value, onChange: (event: Event) => change((event.target as HTMLSelectElement).value) },
          values.map((v) => h('option', v))
        ),
      ]);
    return () => {
      const content =
        props.scenario === 'languages'
          ? languageDocument
          : props.scenario === 'behaviors'
            ? behaviorDocument
            : props.scenario === 'renderers'
              ? rendererDocument
              : fence(language.value, code.value.slice(0, count.value));
      return h(
        'div',
        {
          class: 'aimd-highlight-demo',
          style: {
            padding: '16px',
            background: colorScheme.value === 'dark' ? '#0d1117' : '#fff',
            color: colorScheme.value === 'dark' ? '#e6edf3' : '#24292f',
          },
        },
        [
          h('p', scenarioText[props.scenario]),
          h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' } }, [
            select(
              'Engine',
              engine.value,
              ['highlight.js', 'Shiki', 'Pierre', 'Pierre (full frame)', 'Plain', 'Legacy'],
              (value) => {
                engine.value = value as DemoEngine;
              }
            ),
            select('Language', language.value, ['tsx', 'jsx', 'vue', 'svelte', 'objc', 'txt', 'unknown'], (value) => {
              language.value = value;
              count.value = 10000;
            }),
            button('Toggle theme', () => {
              colorScheme.value = colorScheme.value === 'dark' ? 'light' : 'dark';
            }),
            button('Start stream', () => {
              count.value = 0;
              streaming.value = true;
              running.value = true;
            }),
            button('Pause / resume', () => {
              running.value = !running.value;
              streaming.value = true;
            }),
            button('Finish', () => {
              running.value = false;
              streaming.value = false;
              count.value = code.value.length;
            }),
            button('Replace code', () => {
              replacement.value = !replacement.value;
              count.value = 10000;
            }),
            button('Switch document', () => {
              document.value++;
            }),
            button('Retry / reload engine', () => {
              attempt.value++;
            }),
          ]),
          h(
            'output',
            `Engine: ${engine.value}; theme: ${colorScheme.value}; streaming: ${streaming.value}; document: ${document.value}`
          ),
          props.scenario === 'languages' &&
            h('table', [
              h(
                'thead',
                h(
                  'tr',
                  ['Fence / effective', 'highlight.js', 'Shiki', 'Pierre'].map((s) => h('th', s))
                )
              ),
              h(
                'tbody',
                ['tsx', 'jsx', 'vue', 'svelte', 'objc', 'txt'].map((name) =>
                  h(
                    'tr',
                    [
                      name,
                      resolveCodeHighlightLanguage(name),
                      resolveCodeHighlightLanguage(name, CodeLanguageFormat.Shiki),
                      resolveCodeHighlightLanguage(name, CodeLanguageFormat.Pierre),
                    ].map((s) => h('td', s))
                  )
                )
              ),
            ]),
          props.renderDocument({
            content,
            streaming: streaming.value,
            colorScheme: colorScheme.value,
            engine: engine.value,
            highlighter: highlighter.value,
            document: document.value,
            scenario: props.scenario,
          }),
        ]
      );
    };
  },
});

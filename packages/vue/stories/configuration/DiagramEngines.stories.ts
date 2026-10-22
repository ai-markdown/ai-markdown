import { computed, defineComponent, h, ref, onMounted, onBeforeUnmount, type PropType } from 'vue';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { AIMarkdown } from '@ai-markdown/vue';
import { createMarkdownCodeBlock } from '@ai-markdown/vue/components/code';
import {
  diagramEngines,
  diagramLoader,
  diagramSources,
  diagramFence,
  failingDiagramLoader,
  type DiagramDemoEngine,
  type DiagramDemoScenario,
} from '@ai-markdown/storybook-kit/common/diagramEngines';
import type { DiagramEngineLoader } from '@ai-markdown/core/components';
import { expect, waitFor, within, userEvent } from 'storybook/test';
import '@ai-markdown/vue/components/styles.css';
const Demo = defineComponent({
  props: {
    initialEngine: { type: String as PropType<DiagramDemoEngine>, default: 'Pele' },
    scenario: { type: String as PropType<DiagramDemoScenario>, default: 'static' },
  },
  setup(props) {
    const engine = ref(props.initialEngine),
      type = ref<keyof typeof diagramSources>('flowchart'),
      dark = ref(false),
      fallback = ref(true),
      document = ref(0),
      length = ref(12);
    const failure = failingDiagramLoader(diagramLoader('Pele') as DiagramEngineLoader);
    const source = computed(() => (props.scenario === 'invalid' ? diagramSources.invalid : diagramSources[type.value]));
    const streaming = computed(() => props.scenario === 'streaming' && length.value < source.value.length);
    let timer: ReturnType<typeof setInterval>;
    onMounted(() => {
      timer = setInterval(() => {
        if (streaming.value) length.value += 6;
      }, 180);
    });
    onBeforeUnmount(() => clearInterval(timer));
    const Block = computed(() =>
      createMarkdownCodeBlock({
        mermaidEngine: props.scenario === 'failure' ? failure.load : diagramLoader(engine.value),
        mermaidFallback: fallback.value,
        colorScheme: () => (dark.value ? 'dark' : 'light'),
      })
    );
    return () =>
      h(
        'section',
        {
          style: { padding: '20px', background: dark.value ? '#202020' : '#fff', color: dark.value ? '#eee' : '#111' },
        },
        [
          h('label', [
            'Engine ',
            h(
              'select',
              {
                'aria-label': 'Diagram engine',
                value: engine.value,
                onChange: (e: Event) => {
                  engine.value = (e.target as HTMLSelectElement).value as DiagramDemoEngine;
                },
              },
              diagramEngines.map((name) => h('option', name))
            ),
          ]),
          h('label', [
            'Type ',
            h(
              'select',
              {
                'aria-label': 'Diagram type',
                value: type.value,
                onChange: (e: Event) => {
                  type.value = (e.target as HTMLSelectElement).value as keyof typeof diagramSources;
                },
              },
              Object.keys(diagramSources).map((name) => h('option', name))
            ),
          ]),
          h(
            'button',
            {
              onClick: () => {
                dark.value = !dark.value;
              },
            },
            'Toggle theme'
          ),
          h('button', { onClick: () => document.value++ }, 'New document'),
          h('label', [
            h('input', {
              type: 'checkbox',
              checked: fallback.value,
              onChange: (e: Event) => {
                fallback.value = (e.target as HTMLInputElement).checked;
              },
            }),
            'Unsupported type fallback',
          ]),
          props.scenario === 'failure' &&
            h('button', { onClick: failure.repair }, 'Restore connection, then retry diagram'),
          h(
            'p',
            'Each engine keeps its own layout. Native mount/zoom and server SVG rendering are outside this integration.'
          ),
          h(AIMarkdown, {
            key: document.value,
            content: diagramFence(streaming.value ? source.value.slice(0, length.value) : source.value),
            streaming: streaming.value,
            streamingCursor: false,
            components: { pre: Block.value },
          }),
        ]
      );
  },
});
export default { title: 'Customization/Diagram Engines', component: Demo, tags: ['autodocs'] } satisfies Meta<
  typeof Demo
>;
type Story = StoryObj<typeof Demo>;
const rendered = async (canvas: HTMLElement) => {
  await waitFor(() => expect(canvas.querySelector('.aimd-diagram-viewport svg')).not.toBeNull(), { timeout: 20000 });
};
export const Mermaid: Story = {
  args: { initialEngine: 'Mermaid' },
  play: ({ canvasElement }) => rendered(canvasElement),
};
export const Pele: Story = { args: { initialEngine: 'Pele' }, play: ({ canvasElement }) => rendered(canvasElement) };
export const Ondine: Story = {
  args: { initialEngine: 'Ondine' },
  play: ({ canvasElement }) => rendered(canvasElement),
};
export const Streaming: Story = {
  args: { initialEngine: 'Ondine', scenario: 'streaming' },
  play: ({ canvasElement }) => rendered(canvasElement),
};
export const FinalError: Story = {
  args: { scenario: 'invalid' },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('[role="alert"]')).not.toBeNull());
  },
};
export const FailureAndRetry: Story = {
  args: { scenario: 'failure' },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('[role="alert"]')).not.toBeNull(), { timeout: 15000 });
    const c = within(canvasElement);
    await userEvent.click(c.getByText('Restore connection, then retry diagram'));
    await userEvent.click(c.getByText('Retry diagram'));
    await rendered(canvasElement);
  },
};
export const UnsupportedFallback: Story = {
  args: { initialEngine: 'Ondine flowchart only' },
  play: async ({ canvasElement }) => {
    await rendered(canvasElement);
    await userEvent.selectOptions(within(canvasElement).getByLabelText('Diagram type'), 'sequence');
    await waitFor(
      () => {
        const svg = canvasElement.querySelector('.aimd-diagram-viewport svg');
        expect(svg).not.toBeNull();
        expect(svg?.classList.contains('ondine')).toBe(false);
      },
      { timeout: 20000 }
    );
  },
};
export const Disabled: Story = {
  args: { initialEngine: 'Disabled' },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('.aimd-diagram')).toBeNull();
    await expect(canvasElement.textContent).toContain('A[Source]');
  },
};

export const ThemesAndDocuments: Story = {
  args: { initialEngine: 'Pele' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const engine of ['Pele', 'Ondine']) {
      await userEvent.selectOptions(canvas.getByLabelText('Diagram engine'), engine);
      const prefix = engine.toLowerCase();
      await waitFor(
        () => expect(canvasElement.querySelector('.aimd-diagram-viewport svg')?.classList.contains(prefix)).toBe(true),
        { timeout: 20000 }
      );
      await userEvent.click(canvas.getByText('Toggle theme'));
      await waitFor(() =>
        expect(
          (canvasElement.querySelector('.aimd-diagram-viewport svg') as SVGElement)?.style.getPropertyValue(
            `--${prefix}-bg`
          )
        ).toBe('#242424')
      );
      await userEvent.click(canvas.getByText('New document'));
      await waitFor(() => expect(canvasElement.querySelector('.aimd-diagram-viewport svg')).not.toBeNull());
      await userEvent.click(canvas.getByText('Toggle theme'));
      await waitFor(() =>
        expect(
          (canvasElement.querySelector('.aimd-diagram-viewport svg') as SVGElement)?.style.getPropertyValue(
            `--${prefix}-bg`
          )
        ).toBe('#ffffff')
      );
    }
  },
};

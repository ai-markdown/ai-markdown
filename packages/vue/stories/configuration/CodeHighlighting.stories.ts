import {
  checkStreaming,
  checkLoading,
  checkTheme,
  checkLanguages,
  checkPierreSourceIntegrity,
  checkPierreIncremental,
  checkPierreMarkdownFrames,
} from '@ai-markdown/storybook-kit/common/codeHighlightingChecks';
import { computed, defineComponent, h, type PropType } from 'vue';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { AIMarkdown } from '@ai-markdown/vue';
import { createMarkdownCodeBlock } from '@ai-markdown/vue/components/code/plain';
import { CodeHighlightingDemo } from '@ai-markdown/storybook-kit/vue/codeHighlighting';
import type { HighlightDemoState } from '@ai-markdown/storybook-kit/common/codeHighlighting';
import {
  highlightLegacy,
  type DemoScenario,
  type DemoEngine,
} from '@ai-markdown/storybook-kit/common/codeHighlighting';
import '@ai-markdown/vue/components/styles.css';
import '@ai-markdown/storybook-kit/common/highlight.css';
import { expect, userEvent, waitFor, within } from 'storybook/test';
const Broken = defineComponent({
  setup() {
    return () => {
      throw new Error('Intentional preview failure');
    };
  },
});
const Document = defineComponent({
  props: { state: { type: Object as PropType<HighlightDemoState>, required: true } },
  setup(props) {
    const selected = computed(() => props.state.highlighter);
    const legacyMode = computed(() => props.state.engine === 'Legacy');
    const Block = computed(() => {
      const highlighter = selected.value,
        legacy = legacyMode.value;
      return createMarkdownCodeBlock({
        highlighter,
        colorScheme: () => props.state.colorScheme,
        formatJson: true,
        expandNestedJson: true,
        renderers: {
          demo: defineComponent({ render: () => h('output', 'Custom preview') }),
          broken: Broken,
          mermaid: false,
        },
        highlight: legacy
          ? (code, language) => {
              const html = highlightLegacy(code, language);
              return html === undefined ? code : h('span', { innerHTML: html });
            }
          : undefined,
      });
    });
    return () =>
      h(AIMarkdown, {
        key: props.state.document,
        content: props.state.content,
        streaming: props.state.streaming,
        streamingCursor: false,
        components: { pre: Block.value },
      });
  },
});
const Demo = defineComponent({
  props: {
    scenario: { type: String as PropType<DemoScenario>, required: true },
    initialEngine: { type: String as PropType<DemoEngine> },
  },
  setup: (props) => () =>
    h(CodeHighlightingDemo, {
      scenario: props.scenario,
      initialEngine: props.initialEngine,
      renderDocument: (state) => h(Document, { state }),
    }),
});
export default { title: 'Customization/Code Highlighting', component: Demo, tags: ['autodocs'] } satisfies Meta<
  typeof Demo
>;
type Story = StoryObj<typeof Demo>;
export const Engines: Story = {
  args: { scenario: 'engines' },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('[data-highlight-status="ready"]')).not.toBeNull(), {
      timeout: 15000,
    });
    const canvas = within(canvasElement);
    await userEvent.selectOptions(canvas.getByLabelText('Engine'), 'Plain');
    await waitFor(() => expect(canvasElement.querySelector('[data-highlight-status="plain"]')).not.toBeNull());
    await userEvent.selectOptions(canvas.getByLabelText('Engine'), 'highlight.js');
    await waitFor(() => expect(canvasElement.querySelector('.hljs-keyword')).not.toBeNull());
  },
};
export const LanguageMapping: Story = {
  args: { scenario: 'languages' },
  play: async ({ canvasElement }) => checkLanguages(canvasElement),
};
export const Streaming: Story = {
  args: { scenario: 'streaming' },
  play: async ({ canvasElement }) => checkStreaming(canvasElement),
};
export const AsyncLoading: Story = {
  args: { scenario: 'loading' },
  play: async ({ canvasElement }) => checkLoading(canvasElement),
};
export const FailureAndRetry: Story = {
  args: { scenario: 'failure' },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('[data-highlight-status="error"]')).not.toBeNull(), {
      timeout: 10000,
    });
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Retry / reload engine' }));
    await waitFor(() => expect(canvasElement.querySelector('[data-highlight-status="ready"]')).not.toBeNull(), {
      timeout: 15000,
    });
  },
};
export const ThemeChanges: Story = {
  args: { scenario: 'theme' },
  play: async ({ canvasElement }) => checkTheme(canvasElement),
};
export const CodeBehaviors: Story = { args: { scenario: 'behaviors' } };
export const CustomRenderers: Story = {
  args: { scenario: 'renderers' },
  parameters: { test: { dangerouslyIgnoreUnhandledErrors: true } },
};
export const LegacyCallback: Story = { args: { scenario: 'legacy' } };

export const PierreLanguages: Story = {
  args: { scenario: 'languages', initialEngine: 'Pierre' },
  play: async ({ canvasElement }) => {
    await checkLanguages(canvasElement);
    await checkPierreSourceIntegrity();
    await checkPierreIncremental();
    await checkPierreMarkdownFrames();
  },
};
export const PierreStreaming: Story = {
  args: { scenario: 'streaming', initialEngine: 'Pierre' },
  play: async ({ canvasElement }) => {
    await checkStreaming(canvasElement);
    await waitFor(() => expect(canvasElement.querySelector('[data-highlight-status="ready"]')).not.toBeNull());
  },
};
export const PierreTheme: Story = {
  args: { scenario: 'theme', initialEngine: 'Pierre' },
  play: async ({ canvasElement }) => {
    await checkTheme(canvasElement);
  },
};
export const PierreLoading: Story = {
  args: { scenario: 'loading', initialEngine: 'Pierre' },
  play: async ({ canvasElement }) => {
    await checkLoading(canvasElement);
  },
};

export const PierreFailureRetry: Story = {
  args: { scenario: 'failure', initialEngine: 'Pierre' },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('[data-highlight-status="error"]')).not.toBeNull());
    expect(canvasElement.querySelector('code')?.textContent).toContain('export');
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Retry / reload engine' }));
    await waitFor(() => expect(canvasElement.querySelector('[data-highlight-status="ready"]')).not.toBeNull(), {
      timeout: 15000,
    });
  },
};

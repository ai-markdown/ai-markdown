import {
  checkStreaming,
  checkLoading,
  checkTheme,
  checkLanguages,
  checkPierreSourceIntegrity,
  checkPierreIncremental,
  checkPierreMarkdownFrames,
} from '@ai-markdown/storybook-kit/common/codeHighlightingChecks';
import { useMemo } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import AIMarkdown from '@ai-markdown/react';
import { createMarkdownCodeBlock } from '@ai-markdown/react/components/code/plain';
import { CodeHighlightingDemo, type HighlightDemoState } from '@ai-markdown/storybook-kit/react/codeHighlighting';
import {
  highlightLegacy,
  type DemoScenario,
  type DemoEngine,
} from '@ai-markdown/storybook-kit/common/codeHighlighting';
import '@ai-markdown/react/components/styles.css';
import '@ai-markdown/storybook-kit/common/highlight.css';
import { expect, userEvent, waitFor, within } from 'storybook/test';
const Broken = () => {
  throw new Error('Intentional preview failure');
};
function Document(state: HighlightDemoState) {
  const Block = useMemo(
    () =>
      createMarkdownCodeBlock({
        highlighter: state.highlighter,
        formatJson: true,
        expandNestedJson: true,
        renderers: { demo: () => <output>Custom preview</output>, broken: Broken, mermaid: false },
        highlight:
          state.engine === 'Legacy'
            ? (code, language) => {
                const html = highlightLegacy(code, language);
                return html === undefined ? code : <span dangerouslySetInnerHTML={{ __html: html }} />;
              }
            : undefined,
      }),
    [state.highlighter, state.engine]
  );
  return (
    <AIMarkdown
      key={state.document}
      content={state.content}
      streaming={state.streaming}
      colorScheme={state.colorScheme}
      customComponents={{ pre: Block }}
    />
  );
}
function Demo({ scenario, initialEngine }: { scenario: DemoScenario; initialEngine?: DemoEngine }) {
  return (
    <CodeHighlightingDemo
      initialEngine={initialEngine}
      scenario={scenario}
      renderDocument={(state) => <Document {...state} />}
    />
  );
}
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

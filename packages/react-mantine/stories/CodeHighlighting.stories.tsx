import {
  checkStreaming,
  checkLoading,
  checkTheme,
  checkLanguages,
  checkPierreSourceIntegrity,
  checkPierreIncremental,
  checkPierreMarkdownFrames,
} from '@ai-markdown/storybook-kit/common/codeHighlightingChecks';
import { useMemo, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { MantineProvider } from '@mantine/core';
import {
  CodeHighlightAdapterProvider,
  createHighlightJsAdapter,
  createShikiAdapter,
  plainTextAdapter,
  type CodeHighlightAdapter,
} from '@mantine/code-highlight';
import hljs from 'highlight.js';
import MantineAIMarkdown, { MantineLanguageFormat } from '../src/index';
import { createMarkdownCodeBlock } from '../src/rich/code';
import { CodeHighlightingDemo, type HighlightDemoState } from '@ai-markdown/storybook-kit/react/codeHighlighting';
import {
  loadDemoShiki,
  fence,
  type DemoScenario,
  type DemoEngine,
} from '@ai-markdown/storybook-kit/common/codeHighlighting';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import '@ai-markdown/storybook-kit/common/highlight.css';
import '@mantine/core/styles.css';
import '@mantine/code-highlight/styles.css';
import '@ai-markdown/react/components/styles.css';
const escape = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
/** Demo bridge: the Mantine Provider remains the only owner of preparation. */
function providerAdapter(state: Pick<HighlightDemoState, 'engine' | 'highlighter'>): CodeHighlightAdapter {
  if (state.engine === 'Legacy') return createHighlightJsAdapter(hljs);
  const engine = state.highlighter;
  if (!engine) return plainTextAdapter;
  const loaded = new Set<string>(),
    failed = new Set<string>();
  return {
    loadLanguage: (_context, language) => {
      if (engine.supports?.(language) === false) return;
      return Promise.all(
        (['light', 'dark'] as const).map((colorScheme) => engine.prepare?.({ code: '', language, colorScheme }))
      ).then(
        () => {
          loaded.add(language);
        },
        () => {
          failed.add(language);
        }
      );
    },
    getHighlighter:
      () =>
      ({ code, language = '', colorScheme }) => {
        const request = {
          code,
          language,
          colorScheme: colorScheme === 'dark' ? ('dark' as const) : ('light' as const),
        };
        const supported = engine.supports?.(language) !== false;
        const status = !supported
          ? 'plain'
          : failed.has(language)
            ? 'error'
            : !engine.prepare || loaded.has(language)
              ? 'ready'
              : 'loading';
        const result = status === 'ready' ? engine.highlight(request) : undefined;
        const html = !result
          ? escape(code)
          : 'html' in result
            ? result.html
            : result.tokens
                .map(
                  (token) =>
                    `<span style="color:${escape(token.color ?? 'inherit')};font-style:${(token.fontStyle ?? 0) & 1 ? 'italic' : 'normal'}">${escape(token.text)}</span>`
                )
                .join('');
        return {
          isHighlighted: true,
          highlightedCode: `<span data-highlight-status="${status}" data-highlight-language="${escape(language)}">${html}</span>`,
        };
      },
  };
}
const Broken = () => {
  throw new Error('Intentional preview failure');
};
const Block = createMarkdownCodeBlock({
  renderers: { demo: () => <output>Custom preview</output>, broken: Broken, mermaid: false },
});
function Document(state: HighlightDemoState) {
  const adapter = useMemo(
    () => providerAdapter({ highlighter: state.highlighter, engine: state.engine }),
    [state.highlighter, state.engine]
  );
  return (
    <MantineProvider forceColorScheme={state.colorScheme}>
      <CodeHighlightAdapterProvider adapter={adapter}>
        <MantineAIMarkdown
          key={state.document}
          content={state.content}
          streaming={state.streaming}
          customComponents={{ pre: Block }}
          codeBlock={{
            highlighter: state.engine.startsWith('Pierre') ? state.highlighter : undefined,
            languageFormat: state.highlighter?.languageFormat ?? MantineLanguageFormat.HighlightJs,
            formatJson: true,
            expandNestedJson: true,
          }}
        />
      </CodeHighlightAdapterProvider>
    </MantineProvider>
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
export default { title: 'Mantine/Code Highlighting', component: Demo, tags: ['autodocs'] } satisfies Meta<typeof Demo>;
type Story = StoryObj<typeof Demo>;
export const Engines: Story = {
  args: { scenario: 'engines' },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('[data-highlight-status="ready"]')).not.toBeNull(), {
      timeout: 15000,
    });
    await userEvent.selectOptions(within(canvasElement).getByLabelText('Engine'), 'Legacy');
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
export const ExistingProvider: Story = { args: { scenario: 'legacy' } };

function NativeShikiProviderDemo() {
  const [scheme, setScheme] = useState<'light' | 'dark'>('light');
  const adapter = useMemo(
    () =>
      createShikiAdapter(loadDemoShiki, {
        forceColorScheme: scheme === 'dark' ? 'github-dark-high-contrast' : 'github-light-high-contrast',
        resolveLanguage: (language) => (['tsx', 'vue'].includes(language) ? language : undefined),
      }),
    [scheme]
  );
  return (
    <MantineProvider forceColorScheme={scheme}>
      <button onClick={() => setScheme((value) => (value === 'light' ? 'dark' : 'light'))}>Toggle native theme</button>
      <CodeHighlightAdapterProvider adapter={adapter}>
        <MantineAIMarkdown
          content={fence('tsx') + '\n\n' + fence('vue')}
          codeBlock={{ languageFormat: MantineLanguageFormat.Shiki }}
        />
      </CodeHighlightAdapterProvider>
    </MantineProvider>
  );
}
export const NativeShikiProvider: Story = {
  render: () => <NativeShikiProviderDemo />,
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelectorAll('code span[style]').length).toBeGreaterThan(5), {
      timeout: 15000,
    });
    const before = canvasElement.querySelector('code span[style]')?.getAttribute('style');
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Toggle native theme' }));
    await waitFor(() => {
      const after = canvasElement.querySelector('code span[style]')?.getAttribute('style');
      expect(after).toBeTruthy();
      expect(after).not.toBe(before);
    });
  },
};

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

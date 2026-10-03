import { ComparisonPanel } from '@ai-markdown/storybook-kit/vue/layouts';
import { SMARTYPANTS_DOC, CJK_MIXED_DOC, COMMENTS_DOC } from '@ai-markdown/storybook-kit/common/fixtures';
import { smartypants, pangu, removeComments, type AIMarkdownEnginePlugin } from '../../src';
import type { AIMarkdownProps } from '../../src';
import { DEFINITION_LIST_DOC, MARK_HIGHLIGHT_DOC } from '@ai-markdown/storybook-kit/common/fixtures';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { h, ref } from 'vue';
import AIMarkdown, { defaultEnginePlugins, highlight } from '../../src';
const meta: Meta = {
  title: 'Basics/Engine Plugins',
  tags: ['autodocs'],
  component: AIMarkdown,
  render: (args) => ({ setup: () => () => h(AIMarkdown, { ...args, content: args.content ?? '' }) }),
  argTypes: { content: { control: 'text' } },
  parameters: {
    docs: {
      description: {
        component:
          'enginePlugins replaces the default list rather than extending it. Compare defaults, highlight-only and an empty selection on the same mounted renderer. The syntax fixtures match React Basics/Engine Plugins.',
      },
    },
  },
};
export default meta;
type Story = StoryObj<Partial<AIMarkdownProps> & { selection?: 'defaults' | 'highlight only' | 'none' }>;
export const Highlight: Story = {
  args: { content: MARK_HIGHLIGHT_DOC },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('mark')).not.toBeNull());
  },
};
export const PluginsDisabled: Story = {
  args: { content: MARK_HIGHLIGHT_DOC, enginePlugins: [] },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.textContent).toContain('=='));
    expect(canvasElement.querySelector('mark')).toBeNull();
  },
};
export const ReactiveSelection: Story = {
  args: { selection: 'defaults' },
  argTypes: { selection: { control: 'select', options: ['defaults', 'highlight only', 'none'] } },
  parameters: {
    docs: {
      description: {
        story:
          'Choose a selection in Controls, or use the buttons to change it on the mounted component. Highlight-only retains mark elements but removes semantic definition lists. An empty array removes both plugins; Markdown text remains readable. Reset to Controls resumes the externally selected value.',
      },
    },
  },
  render: (args) => ({
    setup() {
      const override = ref<string>();
      return () => {
        const selection = override.value ?? args.selection;
        return h('section', [
          ...['defaults', 'highlight only', 'none'].map((value) =>
            h(
              'button',
              {
                onClick: () => {
                  override.value = value;
                },
              },
              value
            )
          ),
          h(
            'button',
            {
              onClick: () => {
                override.value = undefined;
              },
            },
            'Reset to Controls'
          ),
          h('output', selection),
          h(AIMarkdown, {
            content: `${MARK_HIGHLIGHT_DOC}\n\n${DEFINITION_LIST_DOC}`,
            enginePlugins:
              selection === 'defaults' ? defaultEnginePlugins : selection === 'highlight only' ? [highlight] : [],
          }),
        ]);
      };
    },
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvasElement.querySelector('dl')).not.toBeNull());
    expect(canvasElement.querySelector('mark')).not.toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'highlight only' }));
    await waitFor(() => expect(canvasElement.querySelector('dl')).toBeNull());
    expect(canvasElement.querySelector('mark')).not.toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'none' }));
    await waitFor(() => expect(canvasElement.querySelector('mark')).toBeNull());
    expect(canvasElement.textContent).toContain('==');
    await userEvent.click(canvas.getByRole('button', { name: 'Reset to Controls' }));
    await waitFor(() => expect(canvasElement.querySelector('dl')).not.toBeNull());
    expect(canvasElement.querySelector('mark')).not.toBeNull();
  },
};

function comparePlugin(content: () => string, omitted: AIMarkdownEnginePlugin) {
  return {
    setup: () => () =>
      h('div', { class: 'aim-comparison' }, [
        h(
          ComparisonPanel,
          { label: 'Default plugins' },
          { default: () => h(AIMarkdown, { content: content(), 'data-plugin-panel': 'enabled' }) }
        ),
        h(
          ComparisonPanel,
          { label: 'Without this plugin' },
          {
            default: () =>
              h(AIMarkdown, {
                content: content(),
                enginePlugins: defaultEnginePlugins.filter((plugin) => plugin !== omitted),
                'data-plugin-panel': 'disabled',
              }),
          }
        ),
      ]),
  };
}
export const Smartypants: Story = {
  args: { content: SMARTYPANTS_DOC },
  parameters: {
    docs: {
      description: {
        story:
          'Compare typographic punctuation with straight source punctuation using the same fixture as React. Quotes and ellipses change in prose; inline and fenced code preserve their literal characters. The disabled panel retains the other default plugins.',
      },
    },
  },
  render: (args) => comparePlugin(() => args.content ?? SMARTYPANTS_DOC, smartypants),
  play: async ({ canvasElement }) => {
    const enabled = () => canvasElement.querySelector('[data-plugin-panel="enabled"]')!;
    const disabled = () => canvasElement.querySelector('[data-plugin-panel="disabled"]')!;
    await waitFor(() => expect(enabled()).toHaveTextContent('“the renderer handles this”'));
    expect(disabled()).toHaveTextContent('"the renderer handles this"');
    expect(enabled().querySelector('code')).toHaveTextContent('"quoted" -- and...');
    expect(enabled().querySelector('pre code')?.textContent).toBe(disabled().querySelector('pre code')?.textContent);
  },
};
export const Pangu: Story = {
  args: { content: CJK_MIXED_DOC },
  parameters: {
    docs: {
      description: {
        story:
          'Pangu inserts spacing at supported CJK/Latin boundaries. The shared fixture intentionally includes Han, kana and Hangul. The Korean paragraph remains unchanged; leaving Hangul untouched is the specified behavior, not a failure. Fixture mentions of React are literal typography test data.',
      },
    },
  },
  render: (args) => comparePlugin(() => args.content ?? CJK_MIXED_DOC, pangu),
  play: async ({ canvasElement }) => {
    const enabled = () => canvasElement.querySelector('[data-plugin-panel="enabled"]')!;
    const disabled = () => canvasElement.querySelector('[data-plugin-panel="disabled"]')!;
    await waitFor(() => expect(enabled()).toHaveTextContent('用 React18 写'));
    expect(disabled()).toHaveTextContent('用React18写');
    const korean = (root: Element) =>
      Array.from(root.querySelectorAll('p')).find((node) => node.textContent?.startsWith('이 라이브러리는'))
        ?.textContent;
    expect(korean(enabled())).toBeTruthy();
    expect(korean(enabled())).toBe(korean(disabled()));
  },
};
export const RemoveComments: Story = {
  args: { content: COMMENTS_DOC },
  parameters: {
    docs: {
      description: {
        story:
          'Both panels hide prose HTML comments: this plugin removes them early, while the default sanitization pipeline also prevents them from reaching the page. Comments inside code fences remain code. This comparison does not present the plugin as the only security boundary.',
      },
    },
  },
  render: (args) => comparePlugin(() => args.content ?? COMMENTS_DOC, removeComments),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelectorAll('[data-plugin-panel] pre code')).toHaveLength(2));
    for (const panel of canvasElement.querySelectorAll('[data-plugin-panel]')) {
      expect(panel.textContent).not.toContain('Reviewer:');
      expect(panel.textContent).not.toContain('A multi-line comment.');
      expect(panel.querySelector('pre code')).toHaveTextContent('<!-- this one is source code, so it renders -->');
    }
  },
};

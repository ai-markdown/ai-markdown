import { ComparisonPanel } from '@ai-markdown/storybook-kit/vue/layouts';
import { h, ref } from 'vue';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, userEvent, within, waitFor } from 'storybook/test';
import AIMarkdown, { createRemendPreprocessor } from '../../src';
import { BROKEN_TAIL_FRAME } from '@ai-markdown/storybook-kit/common/fixtures';
import { EMPHASIS } from '@ai-markdown/storybook-kit/common/corpus';
const repair = [createRemendPreprocessor()];
const meta: Meta = {
  title: 'Streaming/Error Recovery',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Opt-in remend repairs incomplete Markdown tails before parsing. Compare the same broken-tail fixture as React with and without repair, then replace it with a complete corpus excerpt. Keep the preprocessor identity stable. This repairs syntax; transport errors, retries and cancellation remain application responsibilities.',
      },
    },
  },
};
export default meta;
export const BrokenTailComparison: StoryObj = {
  render: () => ({
    setup() {
      const complete = ref(false);
      return () =>
        h('section', [
          h(
            'button',
            {
              onClick: () => {
                complete.value = !complete.value;
              },
            },
            complete.value ? 'Restore broken tail' : 'Load completed corpus'
          ),
          h(
            'div',
            { class: 'aim-comparison' },
            [false, true].map((enabled) =>
              h(
                ComparisonPanel,
                { label: enabled ? 'With repair' : 'Without repair' },
                {
                  default: () =>
                    h(AIMarkdown, {
                      content: complete.value ? EMPHASIS : BROKEN_TAIL_FRAME,
                      contentPreprocessors: enabled ? repair : [],
                      streaming: !complete.value,
                      'data-repair': String(enabled),
                    }),
                }
              )
            )
          ),
        ]);
    },
  }),
  play: async ({ canvasElement }) => {
    const repaired = () => canvasElement.querySelector('[data-repair="true"]')!;
    const raw = () => canvasElement.querySelector('[data-repair="false"]')!;
    await waitFor(() => expect(repaired().querySelector('strong')).not.toBeNull());
    expect(raw().querySelector('strong')).toBeNull();
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Load completed corpus' }));
    await waitFor(() => expect(repaired().textContent).toBe(raw().textContent));
    expect(repaired().querySelector('strong')).not.toBeNull();
    expect(repaired().textContent).not.toContain('Rate limiting');
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Restore broken tail' }));
    await waitFor(() => expect(raw().querySelector('strong')).toBeNull());
    expect(repaired().querySelector('strong')).not.toBeNull();
  },
};

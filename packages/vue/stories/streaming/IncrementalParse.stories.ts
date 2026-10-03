import { ComparisonPanel } from '@ai-markdown/storybook-kit/vue/layouts';
import { h, ref } from 'vue';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, userEvent, within, waitFor } from 'storybook/test';
import AIMarkdown from '../../src';
import { STREAMING_SAMPLE, QUOTES } from '@ai-markdown/storybook-kit/common/corpus';
const meta: Meta = {
  title: 'Streaming/Incremental Parsing',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'incrementalParse is an output-invariant optimization, separate from the streaming UI flag. Advance through accumulated corpus snapshots and compare the incremental and full-parse renderers. Replacement must discard stale output. This is a DOM comparison, not a throughput benchmark or an engine soak.',
      },
    },
  },
};
export default meta;
export const SnapshotComparison: StoryObj = {
  render: () => ({
    setup() {
      const source = ref('');
      const frame = ref(0);
      return () =>
        h('section', [
          h(
            'button',
            {
              onClick: () => {
                frame.value = Math.min(frame.value + 1, 4);
                source.value = STREAMING_SAMPLE.slice(0, Math.ceil((STREAMING_SAMPLE.length * frame.value) / 4));
              },
            },
            'Append next snapshot'
          ),
          h(
            'button',
            {
              onClick: () => {
                frame.value = 0;
                source.value = QUOTES;
              },
            },
            'Replace answer'
          ),
          h(
            'div',
            { class: 'aim-comparison' },
            [true, false].map((incrementalParse) =>
              h(
                ComparisonPanel,
                { label: incrementalParse ? 'Incremental parser' : 'Full parser' },
                {
                  default: () =>
                    h(AIMarkdown, {
                      content: source.value,
                      incrementalParse,
                      streaming: false,
                      'data-parser': incrementalParse ? 'incremental' : 'full',
                    }),
                }
              )
            )
          ),
        ]);
    },
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const incremental = () => canvasElement.querySelector('[data-parser="incremental"]')!;
    const full = () => canvasElement.querySelector('[data-parser="full"]')!;
    const equal = () =>
      waitFor(() => {
        expect(incremental().textContent).toBe(full().textContent);
        for (const selector of ['table', 'pre code', '.katex', 'strong', 'blockquote']) {
          expect(incremental().querySelectorAll(selector).length).toBe(full().querySelectorAll(selector).length);
        }
      });
    for (let i = 0; i < 4; i++) {
      await userEvent.click(canvas.getByRole('button', { name: 'Append next snapshot' }));
      await equal();
    }
    expect(incremental().querySelector('table')).not.toBeNull();
    expect(incremental().querySelector('.katex')).not.toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Replace answer' }));
    await waitFor(() => expect(incremental().querySelector('table')).toBeNull());
    expect(incremental().querySelector('blockquote')).not.toBeNull();
    await equal();
  },
};

import { h, ref } from 'vue';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, userEvent, within, waitFor } from 'storybook/test';
import AIMarkdown from '../../src';
import { REFERENCE_SCENARIO } from '@ai-markdown/storybook-kit/common/scenarios';
const meta: Meta = {
  title: 'Customization/Orphan References',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'An orphan footnote definition has no reader yet. preserveOrphanReferences determines whether its footer remains visible. A standalone Vue renderer defaults to false; inside AIMarkdownDocuments the wrapper prop of the same name (default true) wins over each chunk prop, as in React. Compare both policies on identical standalone renderers, then add the missing citation. The fixture is deliberately split to model an unfinished document.',
      },
    },
  },
};
export default meta;
export const PausedStreamComparison: StoryObj = {
  render: () => ({
    setup() {
      const cited = ref(false);
      return () =>
        h('section', [
          h(
            'button',
            {
              onClick: () => {
                cited.value = !cited.value;
              },
            },
            cited.value ? 'Remove citation' : 'Add citation'
          ),
          ...[true, false].map((preserveOrphanReferences) =>
            h('section', [
              h('h3', preserveOrphanReferences ? 'Preserve orphan definitions' : 'Hide orphan definitions'),
              h(AIMarkdown, {
                content: `${REFERENCE_SCENARIO.definition}${cited.value ? '\n\n' + REFERENCE_SCENARIO.reader : ''}`,
                preserveOrphanReferences,
                'data-preserve': String(preserveOrphanReferences),
              }),
            ])
          ),
        ]);
    },
  }),
  play: async ({ canvasElement }) => {
    const preserved = () => canvasElement.querySelector('[data-preserve="true"]')!;
    const hidden = () => canvasElement.querySelector('[data-preserve="false"]')!;
    await waitFor(() => expect(preserved().querySelector('[data-footnotes]')).not.toBeNull());
    expect(hidden().querySelector('[data-footnotes]')).toBeNull();
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Add citation' }));
    await waitFor(() => expect(hidden().querySelector('[data-footnote-ref]')).not.toBeNull());
    expect(hidden().querySelector('[data-footnotes]')).not.toBeNull();
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Remove citation' }));
    await waitFor(() => expect(hidden().querySelector('[data-footnotes]')).toBeNull());
    expect(preserved().querySelector('[data-footnotes]')).not.toBeNull();
  },
};

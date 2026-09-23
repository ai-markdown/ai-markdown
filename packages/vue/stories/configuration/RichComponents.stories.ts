import { h } from 'vue';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, waitFor } from 'storybook/test';
import { AIMarkdown } from '@ai-markdown/vue';
import { MarkdownCodeBlock, MarkdownImage, MarkdownTable } from '@ai-markdown/vue/components';
import '@ai-markdown/vue/components/styles.css';
import { RICH_COMPONENTS_EXAMPLE } from '@ai-markdown/storybook-kit/common/richComponents';
const components = { pre: MarkdownCodeBlock, img: MarkdownImage, table: MarkdownTable };
const meta: Meta<typeof AIMarkdown> = {
  title: 'Customization/Rich Components',
  component: AIMarkdown,
  tags: ['autodocs'],
  args: { content: RICH_COMPONENTS_EXAMPLE, components },
  render: (args) => ({ setup: () => () => h(AIMarkdown, args) }),
  parameters: {
    docs: {
      description: {
        component:
          'Register pre/img/table through components without a slot adapter. Mermaid is built into the code component; neutral styles are optional.',
      },
    },
  },
};
export default meta;
export const DirectRegistration: StoryObj<typeof AIMarkdown> = {
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('.aimd-diagram svg')).not.toBeNull());
    expect(canvasElement.querySelectorAll('.aimd-code')).toHaveLength(2);
    expect(canvasElement.querySelector('.aimd-image-trigger')).not.toBeNull();
    expect(canvasElement.querySelector('.aimd-table-scroll table')).not.toBeNull();
  },
};

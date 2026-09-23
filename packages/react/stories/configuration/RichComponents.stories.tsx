import AIMarkdown from '@ai-markdown/react';
import { MarkdownCodeBlock, MarkdownImage, MarkdownTable } from '@ai-markdown/react/components';
import '@ai-markdown/react/components/styles.css';
import { WithScheme } from '@ai-markdown/storybook-kit/react/colorScheme';
import { expect, waitFor } from 'storybook/test';
import { RICH_COMPONENTS_EXAMPLE } from '@ai-markdown/storybook-kit/common/richComponents';
import { baseReactMeta, type ReactMeta, type ReactStory } from '../_shared/meta';
const components = { pre: MarkdownCodeBlock, img: MarkdownImage, table: MarkdownTable };
const meta: ReactMeta = {
  ...baseReactMeta,
  title: 'Customization/Rich Components',
  component: AIMarkdown,
  tags: ['autodocs'],
  render: (args) => <WithScheme>{(colorScheme) => <AIMarkdown {...args} colorScheme={colorScheme} />}</WithScheme>,
  args: { content: RICH_COMPONENTS_EXAMPLE, customComponents: components },
  parameters: {
    docs: {
      description: {
        component:
          'Register pre/img/table directly. Mermaid is built into the code component. The optional neutral stylesheet provides the controls; syntax highlighting is an optional factory driver.',
      },
    },
  },
};
export default meta;
export const DirectRegistration: ReactStory = {
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('.aimd-diagram svg')).not.toBeNull());
    expect(canvasElement.querySelectorAll('.aimd-code')).toHaveLength(2);
    expect(canvasElement.querySelector('.aimd-image-trigger')).not.toBeNull();
    expect(canvasElement.querySelector('.aimd-table-scroll table')).not.toBeNull();
  },
};

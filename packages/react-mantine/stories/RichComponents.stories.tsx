import { MarkdownCodeBlock, MarkdownImage, MarkdownTable } from '@ai-markdown/react-mantine/components';
import '@ai-markdown/react/components/styles.css';
import { expect, waitFor } from 'storybook/test';
import { RICH_COMPONENTS_EXAMPLE, IMAGE_GALLERY_EXAMPLE } from '@ai-markdown/storybook-kit/common/richComponents';
import { baseMantineMeta, type MantineMeta, type MantineStory } from './_shared/meta';
const meta: MantineMeta = {
  ...baseMantineMeta,
  title: 'Integrations/Mantine/Rich Components',
  tags: ['autodocs'],
  args: {
    content: RICH_COMPONENTS_EXAMPLE,
    customComponents: { pre: MarkdownCodeBlock, img: MarkdownImage, table: MarkdownTable },
  },
  parameters: {
    docs: {
      description: {
        component:
          'Register pre/img/table directly on MantineAIMarkdown. Code keeps the Mantine highlighter; images share the rc-image preview. Tables and image feedback follow the resolved Mantine theme.',
      },
    },
  },
};
export default meta;
export const DirectRegistration: MantineStory = {
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('.aim-mantine-mermaid-code pre svg')).not.toBeNull(), {
      timeout: 15000,
    });
    expect(canvasElement.querySelector('.aimd-image')).not.toBeNull();
    expect(canvasElement.querySelector('.aimd-table table')).not.toBeNull();
  },
};
export const Dark: MantineStory = {
  globals: { theme: 'dark' },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const table = canvasElement.querySelector('.aimd-table');
      expect(table).not.toBeNull();
      expect(table?.getAttribute('data-color-scheme')).toBe('dark');
      expect(getComputedStyle(table!).color).toBe('rgb(237, 240, 245)');
    });
  },
};
export const ImageGallery: MantineStory = { args: { content: IMAGE_GALLERY_EXAMPLE } };

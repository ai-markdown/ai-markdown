import { h } from 'vue';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, waitFor } from 'storybook/test';
import { AIMarkdown } from '@ai-markdown/vue';
import { MarkdownCodeBlock, MarkdownImage, MarkdownTable, createMarkdownImage } from '@ai-markdown/vue/components';
import '@ai-markdown/vue/components/styles.css';
import { RICH_COMPONENTS_EXAMPLE, IMAGE_GALLERY_EXAMPLE } from '@ai-markdown/storybook-kit/common/richComponents';
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
    await waitFor(() => expect(canvasElement.querySelector('.aimd-diagram svg')).not.toBeNull(), { timeout: 15000 });
    expect(canvasElement.querySelectorAll('.aimd-code')).toHaveLength(2);
    expect(canvasElement.querySelector('.aimd-image-trigger')).not.toBeNull();
    expect(canvasElement.querySelector('.aimd-table-scroll table')).not.toBeNull();
  },
};

export const ImageGallery: StoryObj<typeof AIMarkdown> = {
  args: { content: IMAGE_GALLERY_EXAMPLE },
};
const BusinessImage = createMarkdownImage({
  icons: {
    placeholder: h('span', '◌'),
    error: () => h('span', '!'),
    preview: () => h('span', 'View photo'),
    gallery: h('span', 'Open album'),
    zoomIn: () => h('span', '+'),
    zoomOut: h('span', '−'),
  },
});
export const CustomImageIcons: StoryObj<typeof AIMarkdown> = {
  args: { content: IMAGE_GALLERY_EXAMPLE, components: { ...components, img: BusinessImage } },
};

export const ImageLoadError: StoryObj<typeof AIMarkdown> = {
  args: { content: '![Unavailable photo](https://picsum.photos/id/does-not-exist/480/320)' },
  parameters: {
    docs: {
      description: { story: 'An intentionally unavailable image demonstrates the error icon and accessible fallback.' },
    },
  },
};

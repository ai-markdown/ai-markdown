import { h, toRaw } from 'vue';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { AIMarkdown } from '@ai-markdown/vue';
import {
  MarkdownCodeBlock,
  MarkdownImage,
  MarkdownTable,
  createMarkdownImage,
  createMarkdownCodeBlock,
} from '@ai-markdown/vue/components';
import '@ai-markdown/vue/components/styles.css';
import '@ai-markdown/storybook-kit/common/highlight.css';
import { highlightHtml } from '@ai-markdown/storybook-kit/common/highlight';
import {
  CODE_EXPAND_COLLAPSE_EXAMPLE,
  CODE_HIGHLIGHT_EXAMPLE,
  RICH_COMPONENTS_EXAMPLE,
  IMAGE_GALLERY_EXAMPLE,
} from '@ai-markdown/storybook-kit/common/richComponents';
const components = { pre: MarkdownCodeBlock, img: MarkdownImage, table: MarkdownTable };
const meta: Meta<typeof AIMarkdown> = {
  title: 'Customization/Rich Components',
  component: AIMarkdown,
  tags: ['autodocs'],
  args: { content: RICH_COMPONENTS_EXAMPLE, components },
  render: (args, { globals }) => ({
    setup() {
      const themedCode = createMarkdownCodeBlock({ colorScheme: () => (globals.theme === 'dark' ? 'dark' : 'light') });
      return () =>
        h(AIMarkdown, {
          ...args,
          components: {
            ...args.components,
            ...(toRaw(args.components?.pre) === MarkdownCodeBlock ? { pre: themedCode } : {}),
          },
        });
    },
  }),
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

/**
 * The Collapse button of the code block, on a block where it has an effect and
 * on one where it has none. Both start expanded, which is the default.
 *
 * Collapsing the long block cuts it to 320px and lets it scroll. Collapsing the
 * short block leaves its height as it is: the collapsed state is a maximum
 * height, and the block is already under it, so only the label of the button
 * changes. The button is shown on every block; the component does not measure
 * its content.
 */
export const CodeExpandAndCollapse: StoryObj<typeof AIMarkdown> = {
  args: { content: CODE_EXPAND_COLLAPSE_EXAMPLE },
  play: async ({ canvasElement }) => {
    const blocks = await waitFor(() => {
      const found = [...canvasElement.querySelectorAll<HTMLElement>('.aimd-code')];
      expect(found).toHaveLength(2);
      return found;
    });
    for (const [index, block] of blocks.entries()) {
      const content = block.querySelector('.aimd-code-content') as HTMLElement;
      const height = () => content.getBoundingClientRect().height;
      const full = height();
      await userEvent.click(within(block).getByRole('button', { name: 'Collapse' }));
      const expand = await within(block).findByRole('button', { name: 'Expand' });
      // The short block keeps its height; the long one is cut to the cap.
      if (index === 0) expect(height()).toBe(full);
      else await waitFor(() => expect(height()).toBe(320));
      await userEvent.click(expand);
      await waitFor(() => expect(height()).toBe(full));
    }
  },
};

/**
 * Syntax highlighting is an option of the code block factory. The adapter
 * packages ship no highlighter, so `MarkdownCodeBlock` as exported shows plain
 * text, which is what the other stories on this page render.
 *
 * Here `createMarkdownCodeBlock({ highlight })` is given highlight.js: the
 * callback receives the code and its language and returns what to draw. The
 * token colors come from a stylesheet of the application; this one follows the
 * color scheme of the block. A fence with no language is highlighted in the
 * language the block detects.
 */
export const CodeSyntaxHighlighting: StoryObj<typeof AIMarkdown> = {
  args: { content: CODE_HIGHLIGHT_EXAMPLE },
  render: (args, { globals }) => ({
    setup() {
      const highlightedCode = createMarkdownCodeBlock({
        colorScheme: () => (globals.theme === 'dark' ? 'dark' : 'light'),
        highlight(code, language) {
          const html = highlightHtml(code, language);
          return html === undefined ? code : h('span', { innerHTML: html });
        },
      });
      return () => h(AIMarkdown, { ...args, components: { ...args.components, pre: highlightedCode } });
    },
  }),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelectorAll('.aimd-code')).toHaveLength(4));
    // Every block has tokens, the one without a fence language once it is detected.
    await waitFor(() =>
      canvasElement
        .querySelectorAll('.aimd-code')
        .forEach((block) => expect(block.querySelector('[class^="hljs-"]')).not.toBeNull())
    );
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

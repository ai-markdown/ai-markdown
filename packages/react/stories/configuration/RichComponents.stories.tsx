import AIMarkdown from '@ai-markdown/react';
import {
  MarkdownCodeBlock,
  MarkdownImage,
  MarkdownTable,
  createMarkdownCodeBlock,
  createMarkdownImage,
} from '@ai-markdown/react/components';
import '@ai-markdown/react/components/styles.css';
import { WithScheme } from '@ai-markdown/storybook-kit/react/colorScheme';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import '@ai-markdown/storybook-kit/common/highlight.css';
import { highlightHtml } from '@ai-markdown/storybook-kit/common/highlight';
import {
  CODE_EXPAND_COLLAPSE_EXAMPLE,
  CODE_HIGHLIGHT_EXAMPLE,
  RICH_COMPONENTS_EXAMPLE,
  IMAGE_GALLERY_EXAMPLE,
} from '@ai-markdown/storybook-kit/common/richComponents';
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
export const CodeExpandAndCollapse: ReactStory = {
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

const HighlightedCode = createMarkdownCodeBlock({
  highlight(code, language) {
    const html = highlightHtml(code, language);
    return html === undefined ? code : <span dangerouslySetInnerHTML={{ __html: html }} />;
  },
});
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
export const CodeSyntaxHighlighting: ReactStory = {
  args: { content: CODE_HIGHLIGHT_EXAMPLE, customComponents: { ...components, pre: HighlightedCode } },
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

export const ImageGallery: ReactStory = {
  args: { content: IMAGE_GALLERY_EXAMPLE },
};
const BusinessImage = createMarkdownImage({
  icons: {
    placeholder: <span>◌</span>,
    error: () => <span>!</span>,
    preview: () => <span>View photo</span>,
    gallery: <span>Open album</span>,
    zoomIn: () => <span>+</span>,
    zoomOut: <span>−</span>,
  },
});
export const CustomImageIcons: ReactStory = {
  args: { content: IMAGE_GALLERY_EXAMPLE, customComponents: { ...components, img: BusinessImage } },
};

export const ImageLoadError: ReactStory = {
  args: { content: '![Unavailable photo](https://picsum.photos/id/does-not-exist/480/320)' },
  parameters: {
    docs: {
      description: { story: 'An intentionally unavailable image demonstrates the error icon and accessible fallback.' },
    },
  },
};

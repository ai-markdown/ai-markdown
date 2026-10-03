import '../../src/components/typography/variants/all.scss';
import AIMarkdown from '../../src/index';
import { baseReactMeta, type ReactMeta, type ReactStory } from '../_shared/meta';
import { docsLink } from '@ai-markdown/storybook-kit/common/docsLinks';
import { GFM_BASICS, TABLES_DOC, TASK_LIST_DOC } from '@ai-markdown/storybook-kit/common/fixtures';

/**
 * The GFM baseline every other feature builds on.
 */
const meta: ReactMeta = {
  ...baseReactMeta,
  title: 'Basics/Markdown Basics',
  tags: ['autodocs'],
  component: AIMarkdown,
  parameters: {
    a11y: { test: 'error' },
    controls: { include: ['content'] },
    docs: {
      description: {
        component: [
          'Everything GitHub Flavored Markdown covers, rendered with no configuration:',
          'headings, emphasis, ordered and unordered lists, task items, tables with',
          'per-column alignment, blockquotes, autolinks, strikethrough, inline code,',
          'fenced code, and thematic breaks.',
          '',
          'Code fences are emitted as `<pre><code class="language-…">` and left',
          'unhighlighted — the React renderer ships no tokenizer, so the class name is',
          'the hook your own highlighter (or the Mantine package, which substitutes a',
          'highlighting code block) attaches to. See',
          `${docsLink('architecture', 'the architecture guide')} for the full pipeline.`,
        ].join('\n'),
      },
    },
  },
};

export default meta;

/**
 * One short document touching every syntax a reader expects to work before
 * they look at anything else. Paste your own markdown into the `content`
 * control to render it here.
 */
export const Overview: ReactStory = {
  args: {
    content: GFM_BASICS,
  },
};

/**
 * The delimiter row under the header decides each column's alignment: a
 * leading colon means left, colons on both ends mean center, a trailing colon
 * means right, and a bare run of dashes leaves the column at its default. The
 * alignment lands as an inline `text-align` on every cell of the column, so it
 * survives whatever stylesheet the host application applies.
 *
 * Cells carry inline formatting, but not block content — a fenced code block
 * cannot live inside a table cell.
 */
export const Tables: ReactStory = {
  args: {
    content: TABLES_DOC,
  },
};

/**
 * Task list items render as checkboxes, checked from the `[x]` in the source
 * and always `disabled`: the markdown is describing state, not offering an
 * input. Task items nest, and they mix freely with ordinary list items in the
 * same list.
 *
 * Each checkbox takes its accessible name from its own item text, excluding
 * nested task items.
 */
export const TaskLists: ReactStory = {
  args: {
    content: TASK_LIST_DOC,
  },
};

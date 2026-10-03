import { docsLink } from '@ai-markdown/storybook-kit/common/docsLinks';
import 'katex/dist/katex.min.css';
import '../../src/components/typography/variants/all.scss';
import AIMarkdown from '../../src/index';
import { expect, waitFor } from 'storybook/test';
import { baseReactMeta, type ReactMeta, type ReactStory } from '../_shared/meta';
import { CJK_EMPHASIS_REGRESSION, CJK_MIXED_DOC, RTL_DOC } from '@ai-markdown/storybook-kit/common/fixtures';

/**
 * CJK and other non-Latin scripts, where the CommonMark emphasis rules and
 * real-world text disagree.
 */
const meta: ReactMeta = {
  ...baseReactMeta,
  title: 'Basics/CJK & International Text',
  tags: ['autodocs'],
  component: AIMarkdown,
  parameters: {
    a11y: { test: 'error' },
    controls: { include: ['content'] },
    docs: {
      description: {
        component: [
          "CommonMark's emphasis rules depend on the punctuation and whitespace beside each delimiter. In mixed CJK text, a form such as `**\u201c\u4f1a\u5f15\u8d77\u201d**\u6e32\u67d3\u9519\u8bef` can leave the asterisks literal even when the author intended emphasis.",
          '',
          "The engine's CJK parsing extensions recognize supported emphasis and strikethrough forms around that punctuation. Separately, the optional `pangu` plugin adds spacing at supported mixed-script boundaries; it is enabled by default.",
          '',
          `See ${docsLink('cjk-typography', 'CJK typography')} for delimiter rules, spacing and source line-break behavior.`,
        ].join('\n'),
      },
    },
  },
};

export default meta;

/**
 * The reported bug, one line per script. Every `**…**` pair here sits against
 * CJK punctuation — a full-width quote, a Japanese 。, a Korean parenthesis —
 * and every one of them must render as emphasis rather than as literal
 * asterisks. The last three repeat the set with `~~` strikethrough nested
 * inside, which is where the naive fix breaks.
 */
export const EmphasisPunctuationFix: ReactStory = {
  args: {
    content: CJK_EMPHASIS_REGRESSION,
  },
  // Regression guard shared with the Mantine wrapper's QA story: nine
  // emphasis pairs, three strikethroughs, and exactly one literal `**` (the
  // escaped `\*\*` in the first line).
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelectorAll('strong')).toHaveLength(9));
    expect(canvasElement.querySelectorAll('del')).toHaveLength(3);
    expect((canvasElement.textContent?.match(/\*\*/g) ?? []).length).toBe(1);
  },
};

/**
 * Chinese, Japanese, and Korean prose in one document, plus a table with CJK
 * headers and cells.
 *
 * The Latin words are written without surrounding spaces, the way they arrive
 * from a model. What you see rendered is the `pangu` plugin's work: it opens
 * a space on each side of `React18`, `Vite`, `TypeScript`, and the rest. The
 * Korean section keeps its Latin runs tight against the Hangul, and that is
 * correct rather than a miss — the spacing rule is defined for Han characters
 * and kana, and Hangul is left alone.
 */
export const MixedCJK: ReactStory = {
  args: {
    content: CJK_MIXED_DOC,
  },
};

/**
 * A right-to-left document. Nothing in the markdown declares a direction: the
 * browser derives it from the characters themselves through the Unicode
 * bidirectional algorithm, so the paragraphs, the list markers, and the
 * blockquote rule all flip without a `dir` attribute anywhere.
 *
 * The third list item is the interesting one — an inline `code` span holding a
 * Latin word sits inside an Arabic sentence, and the neutral characters around
 * it have to resolve against the paragraph direction rather than against the
 * code span.
 */
export const RTL: ReactStory = {
  args: {
    content: RTL_DOC,
  },
};

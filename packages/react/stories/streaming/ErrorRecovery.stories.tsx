import React from 'react';
import '../../src/components/typography/variants/all.scss';
import AIMarkdown, { createRemendPreprocessor, type AIMDContentPreprocessor } from '../../src/index';
import { ThemedAIMarkdown } from '../_shared/ThemedAIMarkdown';
import { SideBySide } from '@ai-markdown/storybook-kit/react/layouts';
import { baseReactMeta, type ReactMeta, type ReactStory } from '../_shared/meta';
import { docsLink } from '@ai-markdown/storybook-kit/common/docsLinks';
import { BROKEN_TAIL_FRAME } from '@ai-markdown/storybook-kit/common/fixtures';

/**
 * Repairing the half-written tail of a streaming frame.
 */
const meta: ReactMeta = {
  ...baseReactMeta,
  title: 'Streaming/Error Recovery',
  tags: ['autodocs'],
  component: AIMarkdown,
  parameters: {
    a11y: { test: 'error' },
    controls: { include: ['content'] },
    docs: {
      description: {
        component: [
          'Every frame of a stream ends mid-something. Markdown has no opinion about that',
          '— an unclosed `**` is not an error, it is two literal asterisks — so the default',
          'pipeline renders the tail exactly as written and the asterisks sit on screen',
          'until the closing bytes arrive. Correct, and visibly ugly, several times a',
          'second.',
          '',
          '`createRemendPreprocessor()` closes those constructs before parsing, so the',
          'frame renders as the sentence it is turning into rather than as its punctuation.',
          'Its use is opt-in. Whether unused code is removed from the bundle depends on',
          'the package output and consumer bundler:',
          '',
          '```tsx',
          "import AIMarkdown, { createRemendPreprocessor } from '@ai-markdown/react';",
          '',
          '// Module scope. A fresh factory call per render is a new function identity,',
          '// which discards the block-memo cache for the whole document every frame.',
          'const REPAIR = [createRemendPreprocessor()];',
          '',
          '<AIMarkdown content={frame} streaming contentPreprocessors={REPAIR} />',
          '```',
          '',
          'The preprocessor receives only text; it cannot know whether the producer has',
          'finished. Complete, well-formed samples generally need no repair, but a final',
          'document with intentionally unfinished syntax can still be changed. Choose',
          'whether to retain repair after completion based on your content policy.',
          '',
          `It runs through ${docsLink('content-preprocessors', 'the content preprocessor slot')}, after`,
          'the built-in LaTeX pass, which is why its math repair is turned off: two writers',
          'on the same `$` delimiters would fight.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/** Module scope — see the note about identity in the description above. */
const REPAIR_PREPROCESSORS: AIMDContentPreprocessor[] = [createRemendPreprocessor()];

/**
 * One frame, frozen. Nothing animates and no timer runs, so the comparison is
 * the same every time you open the page — a live stream shows this difference
 * for a fraction of a second at a time, dozens of times, which is exactly what
 * makes it hard to look at.
 *
 * The document is well-formed until the last paragraph, whose tail is caught
 * inside an unclosed `**` run and inside a link whose URL is still arriving.
 *
 * **Left, unrepaired.** Two literal asterisks, then the link's raw markdown:
 * `[the retry guidance](https://example.test/re`, brackets, parenthesis, half a
 * URL and all. This is not a rendering failure; it is what that text means.
 * Note that the half-typed URL even becomes a live autolink, because GFM
 * autolinking sees a bare `https://…` and does its job — so the frame offers
 * the reader a link to a truncated address.
 *
 * **Right, repaired.** The bold run closes at the tail, and the unfinished link
 * renders as its label alone — no `<a>`, because there is no destination to
 * point at yet. That last choice is this library's, not remend's default: the
 * upstream default substitutes a placeholder URL, which the sanitizer would
 * then strip, leaving a link that looks clickable and is not. Plain text for
 * the duration is the honest render.
 *
 * Look at the code fence in both panels. `2 ** attempt` keeps its asterisks:
 * repair operates on the streaming tail and respects fenced blocks, so code
 * samples do not acquire emphasis on their way through.
 *
 * One limit worth knowing: **an unterminated fence is left alone**. Markdown
 * already treats end-of-input as closing a code block, so a half-written fence
 * renders as a code block either way and there is nothing to repair.
 */
export const RemendComparison: ReactStory = {
  args: { content: BROKEN_TAIL_FRAME },
  render: (args) => (
    <SideBySide
      leftLabel="default — tail rendered literally"
      rightLabel="contentPreprocessors={[createRemendPreprocessor()]}"
      left={<ThemedAIMarkdown content={args.content ?? ''} streaming />}
      right={<ThemedAIMarkdown content={args.content ?? ''} streaming contentPreprocessors={REPAIR_PREPROCESSORS} />}
    />
  ),
};

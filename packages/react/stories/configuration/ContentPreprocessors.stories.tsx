import React from 'react';
import '../../src/components/typography/variants/all.scss';
import AIMarkdown, { type AIMDContentPreprocessor } from '../../src/index';
import { ThemedAIMarkdown } from '../_shared/ThemedAIMarkdown';
import { SideBySide } from '@ai-markdown/storybook-kit/react/layouts';
import { baseReactMeta, type ReactMeta, type ReactStory } from '../_shared/meta';
import { docsLink } from '@ai-markdown/storybook-kit/common/docsLinks';
import { SECRETS_DOC } from '@ai-markdown/storybook-kit/common/fixtures';

/**
 * A hook into the markdown source, before anything parses it.
 */
const meta: ReactMeta = {
  ...baseReactMeta,
  title: 'Customization/Content Preprocessors',
  tags: ['autodocs'],
  component: AIMarkdown,
  parameters: {
    a11y: { test: 'error' },
    controls: { include: ['content'] },
    docs: {
      description: {
        component: [
          '`contentPreprocessors` takes an array of `(content: string) => string` functions',
          'and runs them over the raw markdown before the parser sees it. It is the',
          'earliest extension point there is, and the only one that operates on text',
          'rather than on a tree.',
          '',
          '```tsx',
          'const REDACT = (content: string) => content.replace(SECRET, MASK);',
          '',
          '<AIMarkdown content={answer} contentPreprocessors={[REDACT]} />',
          '```',
          '',
          '### Ordering',
          '',
          'Yours run **after** the built-in LaTeX preprocessor, in array order. That',
          'matters in one direction specifically: by the time your function is called, `$…$`',
          'spans have already been rewritten into the display form the parser expects. Do',
          'not try to own `$` handling from here — the LaTeX pass already did, and two',
          'writers on the same delimiters will fight.',
          '',
          '### Reference stability',
          '',
          'The array goes through the stability firewall as `WARN_ONLY`: functions cannot',
          'be meaningfully deep-compared, so a fresh closure per render discards the',
          'block-memo cache for the whole document, every render. Define preprocessors at',
          'module scope, and if one needs configuration, build it once with `useMemo`.',
          'Development builds warn when they catch a new identity.',
          '',
          '### What ships in the box',
          '',
          '`createRemendPreprocessor()` — a streaming tail-repair pass that closes',
          'unterminated `**`, backticks, and links so a half-typed frame renders styled',
          'rather than literal. Its use is opt-in; whether unused code is removed from the',
          'bundle depends on the package output and bundler. The Error Recovery story shows it',
          'working; do not apply it to static content, where an intentionally trailing `*`',
          'would get closed against your wishes.',
          '',
          `See ${docsLink('content-preprocessors', 'content preprocessors')} for the full stage order and`,
          'the interaction notes with incremental parsing.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/**
 * A redaction pass. Module scope, so its identity never changes.
 *
 * The pattern is deliberately narrow — a literal prefix plus a bounded run of
 * key characters, anchored on a word boundary. A greedy `.*` would eat the
 * rest of the line, including the closing backtick of an inline code span, and
 * turn the mask into a syntax error.
 */
const SECRET_PATTERN = /\bsk-[A-Za-z0-9]{8,}/g;

const redactSecrets: AIMDContentPreprocessor = (content) => content.replace(SECRET_PATTERN, 'sk-••••••••REDACTED');

const REDACTION_PREPROCESSORS: AIMDContentPreprocessor[] = [redactSecrets];

/**
 * The same answer with and without a one-line redaction pass. Models paste
 * keys back at you — out of the prompt, out of a config file they were shown,
 * out of an error message — and the fix belongs here rather than in a custom
 * component.
 *
 * **Left: raw.** Three live-looking keys, in prose, in an inline code span,
 * and inside a fenced block.
 *
 * **Right: preprocessed.** All three are masked, including the one inside the
 * fence — which is the argument for doing this at the text stage. A rehype
 * plugin or a custom `code` component would have to be taught about every
 * element type a key might land in; a string replacement does not care, because
 * at that point there are no elements yet.
 *
 * Two limits worth stating plainly. Text-stage rewriting is **blind to
 * markdown structure**, so a pattern loose enough to match real-world garbage
 * is also loose enough to corrupt syntax — keep it anchored and bounded, as
 * `SECRET_PATTERN` is. And during streaming your function is called on every
 * frame with a truncated document, so a key split across a chunk boundary is
 * briefly half-masked before the next frame completes it. For redaction that
 * is acceptable; for anything where a partial match is worse than no match,
 * gate on `streaming` upstream and let the final frame do the work.
 */
export const RedactionPreprocessor: ReactStory = {
  args: { content: SECRETS_DOC },
  render: (args) => (
    <SideBySide
      leftLabel="no preprocessor — keys rendered verbatim"
      rightLabel="contentPreprocessors={[redactSecrets]}"
      left={<ThemedAIMarkdown content={args.content ?? ''} />}
      right={<ThemedAIMarkdown content={args.content ?? ''} contentPreprocessors={REDACTION_PREPROCESSORS} />}
    />
  ),
};

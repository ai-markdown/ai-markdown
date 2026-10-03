import React from 'react';
import { Button } from '@mantine/core';
import MantineAIMarkdown from '../src/index';
import 'katex/dist/katex.min.css';
import { baseMantineMeta, type MantineMeta, type MantineStory } from './_shared/meta';
import { MANTINE_SHOWCASE } from './_shared/fixtures';
import { StreamingReplay } from '@ai-markdown/storybook-kit/react/streaming';
import { docsLink } from '@ai-markdown/storybook-kit/common/docsLinks';

/**
 * Everything the Mantine package renders, in one answer.
 */
const meta: MantineMeta = {
  ...baseMantineMeta,
  title: 'Integrations/Mantine/Kitchen Sink',
  tags: ['autodocs'],
  component: MantineAIMarkdown,
  parameters: {
    a11y: { test: 'error' },
    controls: { include: ['content', 'codeBlock', 'fontSize'] },
    docs: {
      description: {
        component: [
          'One document that touches every renderer this package substitutes — three',
          'highlighted languages, a mermaid flowchart, a minified JSON payload, KaTeX',
          'math, a GFM table, a footnote, and a CJK paragraph — first as a live stream and',
          'then as a finished page.',
          '',
          'It is a front door rather than a test: this is what a consumer sees after',
          'wrapping their app in `MantineProvider` and `CodeHighlightAdapterProvider` and',
          'passing a model response straight through. Everything on screen comes from the',
          'defaults; no story here configures anything.',
          '',
          'The shared showcase fixture combines these features in one document so you',
          'can compare the streaming and completed presentations.',
          '',
          `The streaming machinery underneath is core's — see ${docsLink('streaming-and-performance', 'streaming & performance')}`,
          'for how partial markdown is parsed without re-rendering the whole answer.',
        ].join('\n'),
      },
    },
  },
  render: (args) => <MantineAIMarkdown {...args} />,
};

export default meta;

/**
 * The showcase document arriving token by token, followed by its completed state.
 *
 * Worth watching, in the order it happens:
 *
 * - The **mermaid flowchart** shows its raw source until enough of the diagram
 *   has arrived to render, then swaps to the SVG. Later attempts are throttled.
 *   Ordinary parse failures during streaming are suppressed; size-limit
 *   errors can appear immediately.
 * - The **JSON block** is reformatted only once it is complete enough to
 *   parse; before that it renders as the raw text that has arrived so far.
 * - **Code fences re-highlight** as lines land, and the collapse cap applies
 *   from the moment a block outgrows it.
 * - The **footnote reference** in the cost-model section resolves the moment
 *   its definition arrives at the very bottom — the reference is rendered long
 *   before the definition exists.
 * - The **table** renders row by row rather than waiting for the closing row.
 *
 * The replay button is Mantine's own `Button`, not the plain restart control
 * the core stories use. That is a small deliberate inconsistency: the Mantine
 * branch demonstrates a Mantine application, so its chrome is Mantine's.
 */
export const RichStreaming: MantineStory = {
  args: {
    content: MANTINE_SHOWCASE,
    fontSize: '',
  },
  render: (args) => (
    <StreamingReplay
      text={args.content ?? ''}
      renderButton={(streaming, restart) => (
        <Button size="xs" color="blue.8" variant={streaming ? 'default' : 'filled'} onClick={restart} mb={12}>
          {streaming ? 'Streaming…' : 'Restart'}
        </Button>
      )}
    >
      {(content, streaming) => <MantineAIMarkdown {...args} content={content} streaming={streaming} />}
    </StreamingReplay>
  ),
};

/**
 * The same document with the stream already finished — the settled output, and
 * the one to read if you want to judge the typography rather than the
 * behaviour.
 *
 * Everything that had to resolve has resolved: both diagrams are SVG, the JSON
 * is formatted, the footnote link round-trips to its definition and back, and
 * the math is typeset. Flip the toolbar theme here to see the whole page
 * follow the provider, diagrams included.
 */
export const Full: MantineStory = {
  args: {
    content: MANTINE_SHOWCASE,
    streaming: false,
  },
  parameters: {
    a11y: { test: 'error' },
  },
};

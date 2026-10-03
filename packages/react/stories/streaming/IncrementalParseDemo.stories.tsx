import React from 'react';
import type { StoryObj } from '@storybook/react-vite';
import AIMarkdown from '../../src/index';
import 'katex/dist/katex.min.css';
import '../../src/components/typography/variants/all.scss';
import { WithScheme } from '@ai-markdown/storybook-kit/react/colorScheme';
import type { ReactMeta } from '../_shared/meta';
import { docsLink } from '@ai-markdown/storybook-kit/common/docsLinks';
import { IncrementalParsePlayground } from './IncrementalParsePlayground';
import { DEFAULT_PAYLOAD, withDefs } from './scenarios';

/**
 * `incrementalParse` in the open: what the engine freezes, what it re-parses,
 * and proof that the two paths produce the same DOM.
 */
const meta: ReactMeta = {
  title: 'Streaming/Incremental Parsing',
  tags: ['autodocs'],
  component: AIMarkdown,
  parameters: {
    a11y: { test: 'error' },
    // A live DOM-comparison harness — mid-stream markup is nondeterministic.
    chromatic: { disableSnapshot: true },
    docs: {
      description: {
        component: [
          'Re-parsing a whole document on every token gets expensive as the document',
          'grows. With `incrementalParse` (on by default) the engine finds a point below',
          'which nothing can still change — no open fence, no unresolved reference, no',
          'half-written table — parses that prefix once, and re-parses only the tail.',
          '',
          'The bar in the story shows the split live: green is the frozen prefix, amber is',
          'the active tail, and the empty track is content that has not streamed yet.',
          'Watch the boundary hold below an unresolved `[^ref]` until its definition',
          'lands.',
          '',
          'The mismatch counter is the honest part. Both panes render the same content,',
          'one with the flag on and one with it off, and their live DOM is compared every',
          'frame. The optimization is only worth having if that counter stays at zero —',
          'paste a payload you suspect into `content` and watch it.',
          '',
          `See ${docsLink('streaming-and-performance', 'streaming & performance')} for the freeze-boundary rules and`,
          `${docsLink('benchmark', 'the benchmark')} for what it buys.`,
        ].join('\n'),
      },
    },
  },
};

export default meta;

/**
 * Streams a payload into a flag-on / flag-off pair. Paste your own markdown
 * into `content`, adjust the chunk size and tick interval, and read the two
 * numbers that matter: the frozen percentage (how much work is being skipped)
 * and the mismatch count (whether skipping it is safe).
 */
export const Playground: StoryObj<typeof IncrementalParsePlayground> = {
  args: {
    content: withDefs(DEFAULT_PAYLOAD),
    chunkSize: 16,
    intervalMs: 30,
  },
  argTypes: {
    content: { control: 'text', description: 'Markdown streamed into both panes. Paste suspicious payloads here.' },
    chunkSize: { control: { type: 'number', min: 1, max: 200 }, description: 'Code points appended per tick.' },
    intervalMs: { control: { type: 'number', min: 5, max: 500 }, description: 'Milliseconds between ticks.' },
    colorScheme: { table: { disable: true } },
  },
  parameters: { layout: 'fullscreen' },
  render: (args) => (
    <WithScheme>
      {(colorScheme) => (
        <IncrementalParsePlayground
          content={args.content ?? DEFAULT_PAYLOAD}
          chunkSize={args.chunkSize ?? 16}
          intervalMs={args.intervalMs ?? 30}
          colorScheme={colorScheme}
        />
      )}
    </WithScheme>
  ),
};

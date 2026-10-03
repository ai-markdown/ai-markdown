import { docsLink } from '@ai-markdown/storybook-kit/common/docsLinks';
import type { StoryObj } from '@storybook/react-vite';
import 'katex/dist/katex.min.css';
import '../../src/components/typography/variants/all.scss';
import AIMarkdown, { AIMarkdownStreamingCursor } from '../../src/index';
import { WithScheme, type StoryColorScheme } from '@ai-markdown/storybook-kit/react/colorScheme';
import type { ReactMeta } from '../_shared/meta';
import {
  StreamingReplay,
  ThemedReplayButton,
  STREAMING_DEMO_CONTENT,
} from '@ai-markdown/storybook-kit/react/streaming';
import { getStreamingTheme } from '@ai-markdown/storybook-kit/react/theme';

/**
 * The entry point for everything under Streaming: one prop, a growing string,
 * and a document that holds its shape while it is still half-written.
 */
const meta: ReactMeta = {
  title: 'Streaming/Streaming Basics',
  tags: ['autodocs'],
  component: AIMarkdown,
  parameters: {
    // Streaming stories never trial 'error': axe samples the DOM at whatever
    // instant it happens to run, and a heading caught half-typed reports
    // `empty-heading` at random.
    a11y: { test: 'todo' },
    // Mid-stream markup is nondeterministic by construction.
    chromatic: { disableSnapshot: true },
    docs: {
      description: {
        component: [
          'Pass the complete accumulated text as `content`, and set `streaming` while the producer is active.',
          '',
          '```tsx',
          '<AIMarkdown content={accumulated} streaming={!done} />',
          '```',
          '',
          "The application owns transport framing, retries and cancellation. Replacing `content` is supported. `streaming` informs custom components and cursor presentation; it does not enable incremental parsing or change the parser's interpretation of an incomplete fence or formula.",
          '',
          'Incremental parsing and block memoization are enabled by default. A verified prefix can be reused when the input and configuration permit it; other frames use a full parse. Cached React blocks still respond to child state and context changes. Cross-chunk coordination requires `blockMemo` to remain enabled.',
          '',
          `Continue with the cursor, smooth reveal and incremental comparison examples. See ${docsLink('streaming-and-performance', 'streaming and performance')} and the ${docsLink('streaming-chat-example', 'complete chat recipe')}.`,
        ].join('\n'),
      },
    },
  },
};

export default meta;

/**
 * The replay shell as a real component, so the story's `render` slot stays a
 * plain function and the pacing args have somewhere typed to land.
 */
const StreamingBasicsDemo = ({
  content,
  chunkSizeMin,
  chunkSizeMax,
  chunkDelayMin,
  chunkDelayMax,
  cursor,
  colorScheme,
}: {
  content: string;
  chunkSizeMin: number;
  chunkSizeMax: number;
  chunkDelayMin: number;
  chunkDelayMax: number;
  cursor: boolean;
  colorScheme: StoryColorScheme;
}) => (
  <StreamingReplay
    text={content}
    options={{ chunkSizeMin, chunkSizeMax, chunkDelayMin, chunkDelayMax }}
    style={{ color: getStreamingTheme(colorScheme).text }}
    renderButton={(streaming, restart) => <ThemedReplayButton streaming={streaming} onRestart={restart} />}
  >
    {(streamed, streaming) => (
      <AIMarkdown
        content={streamed}
        streaming={streaming}
        colorScheme={colorScheme}
        streamingCursor={cursor ? AIMarkdownStreamingCursor : undefined}
      />
    )}
  </StreamingReplay>
);

/**
 * A document that arrives a few characters at a time. The payload is chosen
 * for the shapes that break naive renderers: inline and block math, a fenced
 * code block, a table, and a blockquote — each one spends several seconds
 * being an incomplete token.
 *
 * Drive the cadence from the controls. Small chunks with long gaps read like a
 * slow model and make the incomplete-token handling easy to watch; large
 * chunks with short gaps read like a fast one. The arrival pattern is
 * generated from a seeded PRNG rather than `Math.random()`, so replaying the
 * same settings replays the same stream — if something looks wrong, you can
 * look at it twice.
 *
 * `streaming` is what the shell passes down while text is still arriving; it
 * flips to `false` on the last chunk, which is also what unmounts the cursor.
 */
export const Demo: StoryObj<typeof StreamingBasicsDemo> = {
  args: {
    content: STREAMING_DEMO_CONTENT,
    chunkSizeMin: 2,
    chunkSizeMax: 8,
    chunkDelayMin: 15,
    chunkDelayMax: 60,
    cursor: true,
  },
  argTypes: {
    content: { control: 'text', description: 'The full document to stream. Paste your own.' },
    chunkSizeMin: { control: { type: 'number', min: 1, max: 200 }, description: 'Smallest chunk, in characters.' },
    chunkSizeMax: { control: { type: 'number', min: 1, max: 200 }, description: 'Largest chunk, in characters.' },
    chunkDelayMin: { control: { type: 'number', min: 0, max: 2000 }, description: 'Shortest gap between chunks (ms).' },
    chunkDelayMax: { control: { type: 'number', min: 0, max: 2000 }, description: 'Longest gap between chunks (ms).' },
    cursor: { control: 'boolean', description: 'Mount the built-in streaming cursor.' },
    colorScheme: { table: { disable: true } },
  },
  render: (args) => (
    <WithScheme>
      {(colorScheme) => (
        <StreamingBasicsDemo
          content={args.content ?? STREAMING_DEMO_CONTENT}
          chunkSizeMin={args.chunkSizeMin ?? 2}
          chunkSizeMax={args.chunkSizeMax ?? 8}
          chunkDelayMin={args.chunkDelayMin ?? 15}
          chunkDelayMax={args.chunkDelayMax ?? 60}
          cursor={args.cursor ?? true}
          colorScheme={colorScheme}
        />
      )}
    </WithScheme>
  ),
};

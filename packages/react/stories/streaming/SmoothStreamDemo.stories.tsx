import React, { useCallback, useState } from 'react';
import type { StoryObj } from '@storybook/react-vite';
import AIMarkdown, {
  AIMarkdownSmoothStream,
  AIMarkdownStreamingCursor,
  type SmoothStreamPacing,
} from '../../src/index';
import 'katex/dist/katex.min.css';
import '../../src/components/typography/variants/all.scss';
import { WithScheme, type StoryColorScheme } from '@ai-markdown/storybook-kit/react/colorScheme';
import type { ReactMeta, ReactStory } from '../_shared/meta';
import { docsLink } from '@ai-markdown/storybook-kit/common/docsLinks';
import {
  StreamingReplay,
  ThemedReplayButton,
  STREAMING_DEMO_CONTENT,
} from '@ai-markdown/storybook-kit/react/streaming';
import { getStreamingTheme } from '@ai-markdown/storybook-kit/react/theme';

/**
 * Typewriter pacing: `<AIMarkdownSmoothStream>` accepts the same bursty chunks
 * a model actually emits and reveals them grapheme by grapheme at a steady
 * cadence.
 */
const meta: ReactMeta = {
  title: 'Streaming/Smooth Streaming',
  tags: ['autodocs'],
  component: AIMarkdown,
  parameters: {
    a11y: { test: 'error' },
    // Mid-reveal markup is nondeterministic by construction.
    chromatic: { disableSnapshot: true },
    docs: {
      description: {
        component: [
          'Servers flush text in clumps: forty characters, then nothing for 300ms, then',
          'ninety more. Rendered straight through, that reads as stuttering. The smooth',
          'stream shell buffers the source and pays it out at a rate it estimates from',
          'the arrival pattern, so the reader sees a steady typewriter regardless of how',
          'the bytes arrived.',
          '',
          'It is an adaptive jitter buffer, not a fixed delay — a fast model is not held',
          'at a constant lag, and a slow one is not outrun into a stall-and-pop rhythm.',
          'Three presets (`smooth` / `balanced` / `responsive`) cover the tuning surface.',
          '',
          `See ${docsLink('smooth-streaming', 'smooth streaming')} for the pacing law and the hook API.`,
        ].join('\n'),
      },
    },
  },
};

export default meta;

/**
 * Large, bursty chunks in; steady cadence out. The contrast is the point —
 * watch the reveal stay even while the source arrives in clumps up to 96
 * characters separated by gaps of up to 400ms.
 */
export const Demo: ReactStory = {
  render: () => (
    <WithScheme>
      {(colorScheme) => (
        <StreamingReplay
          text={STREAMING_DEMO_CONTENT}
          // Feed large, bursty chunks: the typewriter smoothing is what keeps
          // the visual cadence steady anyway — that contrast is the demo.
          options={{ chunkSizeMin: 24, chunkSizeMax: 96, chunkDelayMin: 40, chunkDelayMax: 400 }}
          style={{ color: getStreamingTheme(colorScheme).text }}
          renderButton={(streaming, restart) => <ThemedReplayButton streaming={streaming} onRestart={restart} />}
        >
          {(content, streaming) => (
            <AIMarkdownSmoothStream
              content={content}
              streaming={streaming}
              colorScheme={colorScheme}
              streamingCursor={AIMarkdownStreamingCursor}
            />
          )}
        </StreamingReplay>
      )}
    </WithScheme>
  ),
};

/**
 * The preset demo as a real component: the drain counter needs state, and a
 * story `render` slot is a plain function.
 */
const PacingPresetDemo = ({ pacing, colorScheme }: { pacing: SmoothStreamPacing; colorScheme: StoryColorScheme }) => {
  const theme = getStreamingTheme(colorScheme);
  const [drains, setDrains] = useState(0);
  // Stable across renders: `setDrains` is itself stable and the updater is a
  // pure function of the previous count, so the empty dep list is honest.
  // `onSmoothDrained` is read through a latest-ref internally, so an inline
  // arrow would still FIRE correctly — it would just break the shell's `memo`
  // on every parent render, which during a stream is every frame.
  const onDrained = useCallback(() => setDrains((count) => count + 1), []);
  return (
    <StreamingReplay
      key={pacing}
      text={STREAMING_DEMO_CONTENT}
      // Server-buffer-shaped arrivals: big clumps separated by irregular
      // multi-hundred-millisecond gaps. This is the pattern the adaptive law
      // exists to absorb, and the one where the presets differ visibly.
      options={{ chunkSizeMin: 40, chunkSizeMax: 120, chunkDelayMin: 150, chunkDelayMax: 450 }}
      style={{ color: theme.text }}
      renderButton={(streaming, restart) => <ThemedReplayButton streaming={streaming} onRestart={restart} />}
    >
      {(content, streaming) => (
        <div>
          <div
            style={{
              color: theme.textMuted,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              fontSize: 12,
              marginBottom: 12,
            }}
          >
            pacing: {pacing} · source {streaming ? 'streaming' : 'ended'} · onSmoothDrained fired {drains}×
          </div>
          <AIMarkdownSmoothStream
            content={content}
            streaming={streaming}
            smoothPacing={pacing}
            onSmoothDrained={onDrained}
            colorScheme={colorScheme}
            streamingCursor={AIMarkdownStreamingCursor}
          />
        </div>
      )}
    </StreamingReplay>
  );
};

/**
 * One stream, one preset at a time — switch `pacing` in the controls and
 * replay to feel the difference.
 *
 * - **`smooth`** holds the largest buffer. The typewriter almost never runs
 *   dry between server flushes, at the cost of trailing further behind.
 * - **`balanced`** (the default) keeps the smallest buffer that still bridges
 *   a typical burst gap.
 * - **`responsive`** keeps the lowest lag and accepts the occasional visible
 *   pause when a flush arrives late.
 *
 * None of the three is a fixed speed. The reveal rate is derived from the
 * source's measured arrival cadence, so a preset chooses how much backlog to
 * carry, not how fast to type — which is why there are no characters-per-second
 * props here. (Numeric overrides do exist, on `createSmoothStreamController`,
 * for the rare case that needs them.)
 *
 * The counter tracks `onSmoothDrained`, which fires once per stream round when
 * the reveal has caught up with everything the source sent. Note *when* it
 * fires: the source reports "ended" first, and the callback follows some
 * moments later, once the buffered tail has finished being typed out. That gap
 * is the whole feature — it is also why the component keeps reporting
 * `streaming` to its children (and keeps the cursor mounted) after the network
 * has gone quiet.
 */
export const PacingPresets: StoryObj<typeof PacingPresetDemo> = {
  args: { pacing: 'balanced' },
  argTypes: {
    pacing: {
      control: 'select',
      options: ['smooth', 'balanced', 'responsive'],
      description: 'Buffer depth preset. The reveal rate itself stays adaptive.',
    },
    colorScheme: { table: { disable: true } },
  },
  render: (args) => (
    <WithScheme>
      {(colorScheme) => <PacingPresetDemo pacing={args.pacing ?? 'balanced'} colorScheme={colorScheme} />}
    </WithScheme>
  ),
};

import React, { useEffect, useState } from 'react';
import AIMarkdown, { AIMarkdownStreamingCursor, type AIMarkdownStreamingIndicatorProps } from '../../src/index';
import 'katex/dist/katex.min.css';
import '../../src/components/typography/variants/all.scss';
import { WithScheme } from '@ai-markdown/storybook-kit/react/colorScheme';
import type { ReactMeta, ReactStory } from '../_shared/meta';
import { docsLink } from '@ai-markdown/storybook-kit/common/docsLinks';
import {
  StreamingReplay,
  ThemedReplayButton,
  STREAMING_DEMO_CONTENT,
} from '@ai-markdown/storybook-kit/react/streaming';
import { getStreamingTheme } from '@ai-markdown/storybook-kit/react/theme';

/**
 * The blinking cursor that trails a streaming response — and follows it into
 * places a naive "last text node" anchor would miss.
 */
const meta: ReactMeta = {
  title: 'Streaming/Streaming Cursor',
  tags: ['autodocs'],
  component: AIMarkdown,
  parameters: {
    a11y: { test: 'error' },
    // The cursor blinks and the tail moves; a screenshot of either is noise.
    chromatic: { disableSnapshot: true },
    docs: {
      description: {
        component: [
          'Pass `streamingCursor={AIMarkdownStreamingCursor}` and an indicator follows the',
          'end of the rendered output while `streaming` is true. The hard part is that the',
          'end of the output is not always the end of the prose: when a model writes',
          'footnote definitions, the text still arriving belongs in the footer at the',
          'bottom of the document, and when it writes a link-reference definition, the text',
          'arriving renders nothing at all.',
          '',
          'The cursor handles all three cases — body tail, footer entry, and nothing to',
          'point at (where it hides rather than blinking at prose that stopped growing).',
          '',
          `See ${docsLink('streaming-cursor', 'streaming cursor')} for the tail-signal derivation.`,
        ].join('\n'),
      },
    },
  },
};

export default meta;

const CITATION_DOC = `## Research summary

Recent work on adaptive buffering shows measurable gains in perceived latency[^smith2024]. Follow-up studies confirmed the effect across device classes[^lee2025], though replication in embedded contexts remains an open question[^embedded].

The consensus recommendation is to hold roughly one burst of content in the buffer[^smith2024], trading a bounded delay for a steady cadence.

[^smith2024]: Smith, A. et al. (2024). *Adaptive jitter buffering for text streams.* Journal of Interface Latency, 12(3), 45–67. https://example.com/smith2024
[^lee2025]: Lee, B. (2025). *Typewriter pacing in production chat systems.* Proceedings of the Streaming UI Workshop. https://example.com/lee2025
[^embedded]: Preliminary results only — see the workshop notes at https://example.com/embedded-notes for raw data and the replication checklist.
`;

/**
 * THE reported scenario, live: a citation-heavy document streamed token by
 * token, ending in a run of footnote definitions. Watch the cursor follow
 * the body prose, then drop into the footnote footer and track each
 * definition's entry in turn as the model writes it (before the fix it
 * stayed blinking at the body tail throughout the footer stream). Replay
 * with the restart button. No assertions — this is the eyeball story; the
 * geometry pins live in the sibling stories.
 */
export const Demo: ReactStory = {
  render: () => (
    <WithScheme>
      {(colorScheme) => (
        <StreamingReplay
          text={CITATION_DOC}
          // Small tokens, brisk cadence: slow enough to watch the cursor jump
          // between footer entries, fast enough to replay comfortably.
          options={{ chunkSizeMin: 3, chunkSizeMax: 14, chunkDelayMin: 25, chunkDelayMax: 90 }}
          style={{ color: getStreamingTheme(colorScheme).text }}
          renderButton={(streaming, restart) => <ThemedReplayButton streaming={streaming} onRestart={restart} />}
        >
          {(content, streaming) => (
            <AIMarkdown
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
 * The ordinary case, and the one worth watching first: a mixed document with
 * headings, a fenced code block, a table, and math. The cursor tracks the last
 * rendered character wherever it lands, so it grows with the heading it is
 * writing, sits inside the code block while the fence fills, and steps through
 * the table cell by cell.
 *
 * What it never does is move in the React tree. The shell renders once, as a
 * zero-height sibling of the content, and repositions the indicator by
 * measuring the last character with the Range API and translating an
 * absolutely-positioned holder onto it. Pixels move, DOM nodes do not — which
 * is why selecting the paragraph and copying it never picks the cursor up.
 *
 * The repositioning runs inside a `MutationObserver` callback, i.e. as a
 * microtask before paint, so the move lands in the same frame as the text it
 * follows and there is no trailing lag to see.
 */
export const ProseFollowDemo: ReactStory = {
  render: () => (
    <WithScheme>
      {(colorScheme) => (
        <StreamingReplay
          text={STREAMING_DEMO_CONTENT}
          options={{ chunkSizeMin: 3, chunkSizeMax: 12, chunkDelayMin: 20, chunkDelayMax: 70 }}
          style={{ color: getStreamingTheme(colorScheme).text }}
          renderButton={(streaming, restart) => <ThemedReplayButton streaming={streaming} onRestart={restart} />}
        >
          {(content, streaming) => (
            <AIMarkdown
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
 * A replacement indicator: a pill that reports how long it has been since the
 * content last changed, fading as the silence grows.
 *
 * The three props are the entire contract. `height` and `width` are the
 * measured size of the last character — use `height` to match the current
 * line's text size, `width` if you want to cover the character cell like a
 * block cursor. `lastMutationAt` is a `performance.now()` timestamp, updated
 * once per mutation batch; deriving elapsed time from it is the indicator's
 * own job, which is why this one runs a modest interval rather than expecting
 * the library to re-render it 60 times a second.
 *
 * Note what "mutation" means here: any DOM change under the content root, not
 * strictly "new tokens arrived". A diagram repainting or a coordinated footer
 * re-rendering counts as the message being alive.
 */
const ElapsedPill = ({ height, lastMutationAt }: AIMarkdownStreamingIndicatorProps) => {
  // The clock is local state; the elapsed value is derived. Ticking `now`
  // rather than writing an `elapsed` state keeps the prop change and the
  // timer independent — a fresh `lastMutationAt` shortens the reading on the
  // very next render without any state write to synchronize.
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(id);
  }, []);
  const elapsed = Math.max(0, Math.round(now - lastMutationAt));
  return (
    <span
      style={{
        border: '1px solid currentColor',
        borderRadius: 999,
        display: 'inline-block',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: Math.max(9, Math.round(height * 0.5)),
        lineHeight: 1.6,
        // Fades out over the first two seconds of silence, then holds.
        opacity: Math.max(0.3, 1 - elapsed / 2000),
        padding: '0 5px',
        whiteSpace: 'nowrap',
      }}
    >
      {elapsed}ms
    </span>
  );
};

/**
 * The shell with a custom indicator bound, at module scope. This wrapper is
 * the required shape: `streamingCursor` takes a component with no props, so
 * the indicator is bound by wrapping the shell rather than by passing it
 * through `<AIMarkdown>`. Defining the wrapper inline in render would hand the
 * memo wrapper a new component type every frame.
 */
const ElapsedCursor = () => <AIMarkdownStreamingCursor indicator={ElapsedPill} />;

/**
 * The same stream as the demos above, with the blinking dot replaced by the
 * pill. Watch the number reset toward zero on every chunk and start climbing
 * whenever the stream pauses — that is `lastMutationAt` doing its one job.
 *
 * The default indicator uses the same signal for its own stall behavior: after
 * five seconds of silence it cross-fades from a blinking dot into a spinning
 * ring. That threshold is an internal detail of the default indicator, not
 * part of the API — a custom indicator picks its own, as this one does with
 * its two-second fade.
 */
export const CustomIndicator: ReactStory = {
  render: () => (
    <WithScheme>
      {(colorScheme) => (
        <StreamingReplay
          text={CITATION_DOC}
          options={{ chunkSizeMin: 3, chunkSizeMax: 14, chunkDelayMin: 25, chunkDelayMax: 120 }}
          style={{ color: getStreamingTheme(colorScheme).text }}
          renderButton={(streaming, restart) => <ThemedReplayButton streaming={streaming} onRestart={restart} />}
        >
          {(content, streaming) => (
            <AIMarkdown
              content={content}
              streaming={streaming}
              colorScheme={colorScheme}
              streamingCursor={ElapsedCursor}
            />
          )}
        </StreamingReplay>
      )}
    </WithScheme>
  ),
};

import { docsLink } from '@ai-markdown/storybook-kit/common/docsLinks';
import React, { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import AIMarkdown, { AIMarkdownDocuments, AIMarkdownStreamingCursor, useDocumentSmoothStream } from '../../src/index';
import '../../src/components/typography/variants/all.scss';
import { useStoryColorScheme, PAGE_PALETTE } from '@ai-markdown/storybook-kit/react/colorScheme';
import { ThemedReplayButton } from '@ai-markdown/storybook-kit/react/streaming';
import { getStreamingTheme } from '@ai-markdown/storybook-kit/react/theme';

import { EMPHASIS as FIRST, QUOTES as SECOND } from '@ai-markdown/storybook-kit/common/corpus';

/** The scripted arrival of one answer split into two chat messages. */
interface Phase {
  content: string;
  streaming: boolean;
}

const INITIAL: Phase[] = [
  { content: '', streaming: true },
  { content: '', streaming: true },
];

/**
 * The script. Both messages' *sources* run concurrently, and the second one
 * finishes producing text before the first one is done — which is exactly the
 * situation turn-taking exists for, and exactly what a naive renderer would
 * show out of order.
 */
const SCRIPT: readonly (readonly [number, number, Phase])[] = [
  [60, 0, { content: FIRST.slice(0, 34), streaming: true }],
  [420, 0, { content: FIRST, streaming: true }],
  [900, 0, { content: FIRST, streaming: false }],
  [200, 1, { content: SECOND.slice(0, 40), streaming: true }],
  [520, 1, { content: SECOND, streaming: true }],
  [700, 1, { content: SECOND, streaming: false }],
];

const Bubble = ({ label, children }: { label: string; children: React.ReactNode }) => {
  const scheme = useStoryColorScheme();
  const theme = getStreamingTheme(scheme);
  const style: CSSProperties = {
    border: `1px solid ${theme.panelBorder}`,
    borderRadius: 10,
    color: PAGE_PALETTE[scheme].text,
    marginBottom: 12,
    minHeight: '3em',
    padding: '10px 14px',
  };
  return (
    <div>
      <div
        style={{
          color: theme.textMuted,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontSize: 12,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div style={style}>{children}</div>
    </div>
  );
};

/** One chat message, revealed through the document-level smooth stream. */
const Message = ({ phase, colorScheme }: { phase: Phase; colorScheme: 'light' | 'dark' }) => {
  const smooth = useDocumentSmoothStream({
    documentId: 'turn-taking-demo',
    content: phase.content,
    streaming: phase.streaming,
  });
  return (
    <AIMarkdown
      {...smooth}
      documentId="turn-taking-demo"
      colorScheme={colorScheme}
      streamingCursor={AIMarkdownStreamingCursor}
    />
  );
};

const TurnTakingChat = () => {
  const colorScheme = useStoryColorScheme();
  const [phases, setPhases] = useState<Phase[]>(INITIAL);
  const [run, setRun] = useState(0);
  const timers = useRef<number[]>([]);

  const restart = useCallback(() => {
    setPhases(INITIAL);
    setRun((n) => n + 1);
  }, []);

  useEffect(() => {
    timers.current = SCRIPT.map(([at, index, phase]) =>
      window.setTimeout(() => setPhases((prev) => prev.map((p, k) => (k === index ? phase : p))), at)
    );
    const ids = timers.current;
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [run]);

  const sourcesDone = phases.every((p) => !p.streaming);

  return (
    <div>
      <ThemedReplayButton streaming={!sourcesDone} onRestart={restart} />
      {/* Remounting on replay resets the coordinator queue along with the
          messages — a fresh run rather than a rewind of a half-finished one. */}
      <AIMarkdownDocuments key={run}>
        <Bubble label="message 1 — source streaming">
          <Message phase={phases[0]} colorScheme={colorScheme} />
        </Bubble>
        <Bubble label="message 2 — source finishes early, reveal waits its turn">
          <Message phase={phases[1]} colorScheme={colorScheme} />
        </Bubble>
      </AIMarkdownDocuments>
    </div>
  );
};

/**
 * Two chat bubbles, one answer, revealed in order.
 */
const meta: Meta<typeof TurnTakingChat> = {
  title: 'Streaming/Turn Taking',
  tags: ['autodocs'],
  component: TurnTakingChat,
  parameters: {
    // Always 'todo' for streaming stories: axe samples whatever the reveal had
    // produced at that instant, and a partially typed line is a legitimately
    // different DOM every run.
    a11y: { test: 'todo' },
    chromatic: { disableSnapshot: true },
    docs: {
      description: {
        component: [
          'Turn-taking controls reveal order while the application continues receiving each source independently. Inside `AIMarkdownDocuments`, empty-mounted smooth components with the same explicit `documentId` wait for earlier registered participants to finish producing and revealing.',
          '',
          '```tsx',
          '<AIMarkdownDocuments>',
          '  {messages.map((m) => (',
          '    <AIMarkdownSmoothStream',
          '      key={m.id}',
          '      documentId="answer-42"',
          '      content={m.text}',
          '      streaming={m.streaming}',
          '      smoothWaiting={m.awaitingFirstInput}',
          '    />',
          '  ))}',
          '</AIMarkdownDocuments>',
          '```',
          '',
          'Import both components from `@ai-markdown/react`. Clear `smoothWaiting` when input starts or an empty result completes. Initial nonempty content is shown immediately; mount empty if later appends should animate. The queue follows registration order, independently of `documentIndex`, which orders references. Different document IDs have separate queues.',
          '',
          `See ${docsLink('smooth-streaming', 'smooth streaming')} for hooks, completion and opt-out controls, and ${docsLink('cross-chunk-coordination', 'document coordination')} for shared references.`,
        ].join('\n'),
      },
    },
  },
};

export default meta;

/**
 * Press Restart and watch the second bubble.
 *
 * Its source completes at 700ms — before the first message's source ends at
 * 900ms — so by the time the first bubble is still typing, the second already
 * has its full text in hand. It stays empty anyway. Only once the first bubble
 * has finished revealing does the second begin, and when it does it types out
 * at the normal pace instead of appearing all at once.
 *
 * The streaming cursor is the other thing to watch: there is never more than
 * one on screen. A waiting message is not "streaming" from the reader's point
 * of view, so it shows nothing at all — no cursor, no placeholder, no empty
 * bubble flicker.
 *
 * What this does **not** do is slow the network down. Both sources ran
 * concurrently the whole time; the only thing that waited was the reveal.
 */
export const TwoChunkTurnTaking: StoryObj<typeof TurnTakingChat> = {};

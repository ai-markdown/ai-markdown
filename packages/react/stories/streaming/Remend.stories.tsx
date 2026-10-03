import { ThemedAIMarkdown as AIMarkdown } from '../_shared/ThemedAIMarkdown';
/**
 * Stateful integration smoke for `createRemendPreprocessor`.
 *
 * The unit suite (`preprocessors/remend.test.ts`) proves the string-level
 * contract; this story proves the REACT wiring: streaming a payload full of
 * inline constructs into a repaired and an unrepaired `<AIMarkdown>` pair
 * must (a) diverge on at least one mid-stream frame — remend visibly closing
 * the tail is its entire job, and a zero-divergence run would make the final
 * assertion vacuous — and (b) reconverge to byte-identical DOM on the final
 * frame, because remend is a no-op on well-formed text.
 */

import React, { useEffect, useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';

import { createRemendPreprocessor } from '../../src/index';
import 'katex/dist/katex.min.css';
import '../../src/components/typography/variants/all.scss';
import { codePointSnapshots } from '../../../engine/src/components/incrementalParse/codePointSnapshots';

const SMOKE_DOCUMENT_ID = 'remend-smoke';
const CHUNK_CODE_POINTS = 7;
const FRAME_INTERVAL_MS = 15;

/** Module-scope: a per-render factory call would break the stable-value
 *  memoization of `contentPreprocessors` and re-run the pipeline per frame. */
const REMEND_PREPROCESSORS = [createRemendPreprocessor()];

/** Inline-construct-dense payload: with 7-code-point chunks the stream is
 *  guaranteed to sit mid-`**`/mid-backtick/mid-link on many frames. */
const PAYLOAD = [
  'Streaming **bold emphasis** and `inline code` and ~~a strikethrough~~ run.',
  '',
  'A [markdown link](https://example.com/docs) followed by *italic text* here.',
  '',
  '```ts',
  'const notRepaired = "**this fence protects its contents**";',
  '```',
  '',
  'Closing prose with `one more span` and **a final bold**.',
].join('\n');

interface SmokeStats {
  frames: number;
  divergedFrames: number;
  finalEqual: boolean;
}

function RemendSmoke() {
  const [content, setContent] = useState('');
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<SmokeStats | null>(null);
  const repairedRef = useRef<HTMLDivElement>(null);
  const plainRef = useRef<HTMLDivElement>(null);
  const runRef = useRef({ frames: 0, divergedFrames: 0 });

  useEffect(() => {
    const snapshots = codePointSnapshots(PAYLOAD, CHUNK_CODE_POINTS);
    let idx = 0;
    const timer = setInterval(() => {
      setContent(snapshots[idx]);
      if (idx === snapshots.length - 1) {
        setDone(true);
        clearInterval(timer);
      }
      idx += 1;
    }, FRAME_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  // Per-frame comparison AFTER paint (layout effects would read pre-commit
  // DOM). Unlike the incremental smoke, mid-stream divergence is EXPECTED —
  // it is counted, not failed.
  useEffect(() => {
    if (!repairedRef.current || !plainRef.current) return;
    const equal = repairedRef.current.innerHTML === plainRef.current.innerHTML;
    runRef.current.frames += 1;
    if (!equal) runRef.current.divergedFrames += 1;
    if (done) setFinalStats({ ...runRef.current, finalEqual: equal });
  }, [content, done]);

  return (
    <div>
      <div
        data-testid="remend-smoke-summary"
        data-done={finalStats ? 'true' : 'false'}
        data-frames={finalStats?.frames ?? 0}
        data-diverged-frames={finalStats?.divergedFrames ?? 0}
        data-final-equal={finalStats?.finalEqual ? 'true' : 'false'}
        style={{ fontFamily: 'monospace', fontSize: 12, marginBottom: 12 }}
      >
        {finalStats
          ? `done — frames=${finalStats.frames} diverged=${finalStats.divergedFrames} finalEqual=${finalStats.finalEqual}`
          : `streaming… ${content.length}/${PAYLOAD.length}`}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div ref={repairedRef} data-testid="remend-smoke-repaired">
          <AIMarkdown
            content={content}
            streaming={!done}
            documentId={SMOKE_DOCUMENT_ID}
            contentPreprocessors={REMEND_PREPROCESSORS}
          />
        </div>
        <div ref={plainRef} data-testid="remend-smoke-plain">
          <AIMarkdown content={content} streaming={!done} documentId={SMOKE_DOCUMENT_ID} />
        </div>
      </div>
    </div>
  );
}

const meta: Meta<typeof RemendSmoke> = {
  title: 'QA/Remend',
  tags: ['qa'],
  component: RemendSmoke,
  parameters: {
    // Live streaming comparison — mid-stream markup is unstable by design.
    chromatic: { disableSnapshot: true },
  },
};
export default meta;

type Story = StoryObj<typeof RemendSmoke>;

export const StreamingSmoke: Story = {
  render: () => <RemendSmoke />,
  play: async ({ canvasElement }) => {
    const summary = await waitFor(
      () => {
        const el = canvasElement.querySelector('[data-testid="remend-smoke-summary"]');
        if (!el || el.getAttribute('data-done') !== 'true') throw new Error('streaming not finished yet');
        return el;
      },
      { timeout: 20_000 }
    );
    // Final frame: complete document → remend no-op → identical DOM.
    expect(summary.getAttribute('data-final-equal'), 'repaired side must equal plain side on the final frame').toBe(
      'true'
    );
    // Anti-vacuous: remend must have visibly repaired at least one frame.
    expect(Number(summary.getAttribute('data-diverged-frames'))).toBeGreaterThan(0);
    expect(Number(summary.getAttribute('data-frames'))).toBeGreaterThan(10);
  },
};

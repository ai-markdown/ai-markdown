import { ThemedAIMarkdown as AIMarkdown } from '../_shared/ThemedAIMarkdown';
/**
 * Browser smoke for the streaming cursor (`streamingCursor` slot +
 * `AIMarkdownStreamingCursor` shell).
 *
 * The unit suite (`components/streamingCursor/*.test.*`) proves the anchor
 * walk and the SSR/slot gating; these stories prove what needs a real
 * layout engine: Range measurement produces a positioned, visible
 * indicator that follows streamed prose (LTR and RTL), hides on an
 * un-anchorable tail, reappears when a text tail returns, and switches to
 * (and recovers from) the stalled spinner.
 *
 * Anti-vacuity: the harness records `data-indicator-seen` the first time
 * the indicator mounts, and in `finish` mode refuses to flip `done` until
 * the indicator has been seen — a cursor that never appears fails loudly
 * in the play function instead of passing by absence (same discipline as
 * Remend's diverged-frames counter).
 */

import React, { useEffect, useRef, useState, type ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';

import {
  AIMarkdownStreamingCursor,
  type AIMarkdownProps,
  type AIMarkdownStreamingIndicatorComponent,
} from '../../src/index';
import 'katex/dist/katex.min.css';
import '../../src/components/typography/variants/all.scss';
import { sleep } from './scenarios';
import { codePointSnapshots } from '../../../engine/src/components/incrementalParse/codePointSnapshots';

const CHUNK_CODE_POINTS = 7;
const FRAME_INTERVAL_MS = 15;

const PROSE_PAYLOAD = [
  'Streaming **bold emphasis** and regular prose across several blocks.',
  '',
  '## A heading mid-stream',
  '',
  '- list item one',
  '- list item two with *italic tail*',
  '',
  'Closing paragraph so the cursor ends anchored to plain text.',
].join('\n');

/** Ends inside an unclosed fence: the tail block is `<pre>` for good — the
 *  cursor must hide and stay hidden while streaming continues. */
const CODE_TAIL_PAYLOAD = ['A short intro paragraph.', '', '```ts', 'const x = 1;', 'const y = 2;'].join('\n');

/** Fence opens AND closes mid-stream, then prose resumes: exercises the
 *  hide→reshow imperative path (fresh `measure` after a real `hide`). */
const RESHOW_PAYLOAD = [
  'Intro paragraph.',
  '',
  '```ts',
  'const x = 1;',
  '```',
  '',
  'Trailing prose after the fence.',
].join('\n');

const RTL_PAYLOAD = 'مرحبا بالعالم، هذا نص تجريبي يتدفق كلمة كلمة لاختبار المؤشر.';

/** Flat prose (uniform font size) so the recorded indicator heights must be
 *  constant — see IncrementalParseRegression. Blank lines give the
 *  prefix-freeze engine boundaries to settle on. */
const INCREMENTAL_PAYLOAD = [
  'First paragraph of plain prose streaming with the incremental engine on.',
  '',
  'Second paragraph so the prefix-freeze boundary has blank lines to settle on.',
  '',
  'Third paragraph keeps appending tokens to the tail of the document.',
].join('\n');

const INCREMENTAL_CONFIG: Pick<AIMarkdownProps, 'incrementalParse'> = { incrementalParse: true };

/** Captured `height` props across indicator renders (module scope — reset by
 *  the harness on mount). */
const recordedHeights: number[] = [];
const RecordingIndicator: AIMarkdownStreamingIndicatorComponent = ({ height }) => {
  recordedHeights.push(height);
  // The shell top-aligns the holder to the character box; a sub-height
  // visual must center itself within `height` (same rule as the default
  // indicator) or it visibly hugs the top of the line.
  const size = 6;
  return (
    <span
      data-aimd-streaming-indicator=""
      style={{
        display: 'block',
        width: size,
        height: size,
        marginTop: Math.round((height - size) / 2),
        borderRadius: '50%',
        backgroundColor: 'currentColor',
      }}
    />
  );
};
const RecordingCursor = () => <AIMarkdownStreamingCursor indicator={RecordingIndicator} />;

interface CursorSmokeProps {
  payload: string;
  /** Flip `streaming` to false after the last frame — gated on the
   *  indicator having been SEEN, so a broken cursor can't sneak a pass —
   *  or hold the stream open forever to observe stall behavior (false). */
  finish: boolean;
  /** Append one extra chunk N ms after the indicator first reports
   *  `data-stalled` (stall recovery). Reactive rather than wall-clock —
   *  scheduling from stream end raced the 5 s stall timer under load. */
  appendAfterStallMs?: number;
  /** Text direction of the content container. */
  dir?: 'ltr' | 'rtl';
  /** Engine flat-prop overrides (e.g. `incrementalParse`). */
  config?: Pick<AIMarkdownProps, 'incrementalParse' | 'blockMemo'>;
  /** Cursor component for the slot; defaults to the library shell. */
  cursor?: ComponentType;
  /** Count `ai-markdown:stage:scan` performance measures (dev-build stage
   *  telemetry emitted only when the incremental engine handles a frame)
   *  into `data-scan-count`. The observer attaches BEFORE streaming starts —
   *  a play-function observer could miss a fast stream entirely. */
  collectScan?: boolean;
}

function CursorSmoke({
  payload,
  finish,
  appendAfterStallMs,
  dir = 'ltr',
  config,
  cursor = AIMarkdownStreamingCursor,
  collectScan = false,
}: CursorSmokeProps) {
  const [content, setContent] = useState('');
  const [streamed, setStreamed] = useState(false);
  const [seen, setSeen] = useState(false);
  const [scanCount, setScanCount] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  // Handshake, derived rather than set: `done` flips only after the payload
  // streamed AND the indicator was seen, so the play function can never
  // miss the visible window to a fast stream or a throttled tab.
  const done = finish && streamed && seen;

  useEffect(() => {
    recordedHeights.length = 0;
    let observer: PerformanceObserver | null = null;
    if (collectScan && typeof PerformanceObserver !== 'undefined') {
      let count = 0;
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === 'ai-markdown:stage:scan') count += 1;
        }
        if (count > 0) setScanCount(count);
      });
      observer.observe({ entryTypes: ['measure'] });
    }
    const snapshots = codePointSnapshots(payload, CHUNK_CODE_POINTS);
    let idx = 0;
    const timer = setInterval(() => {
      setContent(snapshots[idx]);
      if (idx === snapshots.length - 1) {
        clearInterval(timer);
        setStreamed(true);
      }
      idx += 1;
    }, FRAME_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      observer?.disconnect();
    };
  }, [payload, collectScan]);

  // Record the first indicator mount. MutationObserver rather than polling:
  // the indicator can be short-lived relative to any poll interval. The
  // initial check runs in a microtask (never synchronously in the effect
  // body) to satisfy react-hooks/set-state-in-effect.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let active = true;
    const check = () => {
      if (active && host.querySelector('[data-aimd-streaming-indicator]')) setSeen(true);
    };
    queueMicrotask(check);
    const observer = new MutationObserver(check);
    observer.observe(host, { childList: true, subtree: true });
    return () => {
      active = false;
      observer.disconnect();
    };
  }, []);

  const appendedRef = useRef(false);
  useEffect(() => {
    if (appendAfterStallMs === undefined) return;
    const host = hostRef.current;
    if (!host) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new MutationObserver(() => {
      if (appendedRef.current || timer) return;
      if (host.querySelector('[data-aimd-streaming-indicator][data-stalled]')) {
        timer = setTimeout(() => {
          appendedRef.current = true;
          setContent((c) => `${c} resumed tail.`);
        }, appendAfterStallMs);
      }
    });
    observer.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-stalled'] });
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [appendAfterStallMs]);

  return (
    <div
      ref={hostRef}
      data-testid="cursor-smoke"
      data-streamed={streamed ? 'true' : 'false'}
      data-done={done ? 'true' : 'false'}
      data-indicator-seen={seen ? 'true' : 'false'}
      data-scan-count={scanCount}
      dir={dir}
    >
      <AIMarkdown
        content={content}
        streaming={!done}
        documentId="streaming-cursor-smoke"
        {...config}
        streamingCursor={cursor}
      />
    </div>
  );
}

const meta: Meta<typeof CursorSmoke> = {
  title: 'QA/Streaming Cursor',
  tags: ['qa'],
  component: CursorSmoke,
  parameters: {
    // Live streaming — mid-stream markup is unstable by design.
    chromatic: { disableSnapshot: true },
  },
};
export default meta;

type Story = StoryObj<typeof CursorSmoke>;

const indicatorIn = (canvasElement: HTMLElement) =>
  canvasElement.querySelector<HTMLElement>('[data-aimd-streaming-indicator]');

const smokeIn = (canvasElement: HTMLElement) => canvasElement.querySelector('[data-testid="cursor-smoke"]');

export const ProseFollow: Story = {
  args: { payload: PROSE_PAYLOAD, finish: true },
  play: async ({ canvasElement }) => {
    // The harness only flips `done` after the indicator was seen, so this
    // wait proves the cursor appeared mid-stream (anti-vacuous by design).
    await waitFor(
      () => {
        const smoke = smokeIn(canvasElement);
        if (smoke?.getAttribute('data-done') !== 'true') throw new Error('stream not finished yet');
      },
      { timeout: 10_000 }
    );
    expect(smokeIn(canvasElement)?.getAttribute('data-indicator-seen')).toBe('true');
    // Stream end: `streaming` flips false, the slot unmounts, indicator gone.
    await waitFor(
      () => {
        if (indicatorIn(canvasElement)) throw new Error('indicator still mounted after done');
      },
      { timeout: 5_000 }
    );
  },
};

export const CodeTailHides: Story = {
  args: { payload: CODE_TAIL_PAYLOAD, finish: false },
  play: async ({ canvasElement }) => {
    await waitFor(
      () => {
        const smoke = smokeIn(canvasElement);
        if (smoke?.getAttribute('data-streamed') !== 'true') throw new Error('payload not fully streamed yet');
      },
      { timeout: 10_000 }
    );
    // Anti-vacuity: the cursor must have been visible during the intro
    // prose before the fence swallowed the tail.
    expect(smokeIn(canvasElement)?.getAttribute('data-indicator-seen')).toBe('true');
    // "Stays hidden" needs a real window, not a single instant — late
    // re-measures (fonts.ready, ResizeObserver) must not re-show it while
    // the tail block is still <pre>. Deliberately wall-clock: the thing under
    // test is browser-scheduled work that no fake timer would advance, and a
    // negative assertion has to outlast it to mean anything.
    await sleep(600);
    expect(indicatorIn(canvasElement)).toBeNull();
  },
};

export const HideThenReshow: Story = {
  args: { payload: RESHOW_PAYLOAD, finish: false },
  play: async ({ canvasElement }) => {
    await waitFor(
      () => {
        const smoke = smokeIn(canvasElement);
        if (smoke?.getAttribute('data-streamed') !== 'true') throw new Error('payload not fully streamed yet');
      },
      { timeout: 10_000 }
    );
    // The tail is prose again after the fence closed — the cursor must have
    // come back through the hide→reshow path (fresh measure after a hide).
    await waitFor(
      () => {
        if (!indicatorIn(canvasElement)) throw new Error('indicator did not reappear after the fence closed');
      },
      { timeout: 5_000 }
    );
  },
};

export const StallShape: Story = {
  args: { payload: 'A single short paragraph that then goes silent.', finish: false },
  play: async ({ canvasElement }) => {
    const indicator = await waitFor(
      () => {
        const el = indicatorIn(canvasElement);
        if (!el) throw new Error('indicator not visible yet');
        return el;
      },
      { timeout: 10_000 }
    );
    // Positioning sanity: the holder was imperatively placed.
    const holder = indicator.closest('[data-aimd-streaming-cursor]')!.firstElementChild as HTMLElement;
    expect(holder.style.display).toBe('block');
    expect(holder.style.transform).toContain('translate(');
    // After 5 s of silence the stalled shape MUST be on: the dot
    // cross-fades into a rotating ring. Re-query per poll — the indicator
    // may unmount/remount across the window.
    await waitFor(
      () => {
        const el = indicatorIn(canvasElement);
        if (!el?.hasAttribute('data-stalled')) throw new Error('not stalled yet');
      },
      { timeout: 12_000 }
    );
    const stalledIndicator = indicatorIn(canvasElement)!;
    const ring = stalledIndicator.querySelector<HTMLElement>('[data-aimd-streaming-indicator-ring]');
    expect(ring).not.toBeNull();
    expect(ring!.style.animation).toContain('spin');
    // Fade and scale live on the ring GROUP (the parent), so the top
    // segment's spin never competes for `transform`.
    const ringGroup = ring!.parentElement as HTMLElement;
    expect(ringGroup.style.opacity).toBe('1');
    expect(ringGroup.style.transform).toBe('scale(1)');
  },
};

export const StallRecovery: Story = {
  // One extra chunk 700 ms AFTER the stall is observed (reactive handshake):
  // stall at ~5 s, recovery shortly after. Exercises the derived un-stall
  // (no state write on recovery).
  args: { payload: 'A short paragraph, then silence, then one more chunk.', finish: false, appendAfterStallMs: 700 },
  play: async ({ canvasElement }) => {
    await waitFor(
      () => {
        const el = indicatorIn(canvasElement);
        if (!el?.hasAttribute('data-stalled')) throw new Error('not stalled yet');
      },
      { timeout: 12_000 }
    );
    await waitFor(
      () => {
        const el = indicatorIn(canvasElement);
        if (!el) throw new Error('indicator disappeared during recovery');
        if (el.hasAttribute('data-stalled')) throw new Error('still stalled after content resumed');
      },
      { timeout: 5_000 }
    );
  },
};

export const RtlFollow: Story = {
  args: { payload: RTL_PAYLOAD, finish: false, dir: 'rtl' },
  play: async ({ canvasElement }) => {
    const indicator = await waitFor(
      () => {
        const el = indicatorIn(canvasElement);
        if (!el) throw new Error('indicator not visible yet');
        return el;
      },
      { timeout: 10_000 }
    );
    // RTL text ends at its LEFT edge; the indicator must sit fully to the
    // left of the last glyph, never on top of it. Measure the real last
    // character with the same Range technique the shell uses.
    const paragraphs = canvasElement.querySelectorAll('[data-testid="cursor-smoke"] p');
    const lastParagraph = paragraphs[paragraphs.length - 1];
    let lastText: Text | null = null;
    const walker = document.createTreeWalker(lastParagraph, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (/\S/.test(node.data)) lastText = node;
    }
    expect(lastText).not.toBeNull();
    const range = document.createRange();
    const len = lastText!.data.replace(/\s+$/, '').length;
    range.setStart(lastText!, len - 1);
    range.setEnd(lastText!, len);
    const charRect = range.getClientRects()[0];
    const indicatorRect = indicator.getBoundingClientRect();
    expect(indicatorRect.right).toBeLessThanOrEqual(charRect.left + 1);
  },
};

export const StyleDedup: Story = {
  // Three concurrent instances must share ONE injected keyframes tag in
  // document.head (useInsertionEffect dedup) — previously each indicator
  // rendered its own inline <style> duplicate.
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
      <CursorSmoke payload="First instance streaming plain prose." finish={false} />
      <CursorSmoke payload="Second instance with a bit more text to stream." finish={false} />
      <CursorSmoke payload="Third instance, also held open while streaming." finish={false} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(
      () => {
        const count = canvasElement.querySelectorAll('[data-aimd-streaming-indicator]').length;
        if (count < 3) throw new Error(`only ${count}/3 indicators visible yet`);
      },
      { timeout: 10_000 }
    );
    const styleTags = document.head.querySelectorAll('style[data-aimd-streaming-cursor-style]');
    expect(styleTags.length).toBe(1);
    // And none of the instances renders an inline duplicate anymore.
    expect(canvasElement.querySelectorAll('style[data-aimd-streaming-cursor-style]').length).toBe(0);
  },
};

export const IncrementalParseRegression: Story = {
  // Pins the proposal's founding motivation: unlike the old `content + '▍'`
  // hack, the cursor must coexist with the incremental (prefix-freeze)
  // engine. The slot receives no content by construction, so the append
  // gate CANNOT see the cursor; this story asserts the observable half —
  // the engine actually handles frames while the cursor tracks them.
  args: {
    payload: INCREMENTAL_PAYLOAD,
    finish: false,
    config: INCREMENTAL_CONFIG,
    cursor: RecordingCursor,
    collectScan: true,
  },
  play: async ({ canvasElement }) => {
    await waitFor(
      () => {
        const smoke = smokeIn(canvasElement);
        if (smoke?.getAttribute('data-streamed') !== 'true') throw new Error('payload not fully streamed yet');
      },
      { timeout: 10_000 }
    );
    await waitFor(
      () => {
        if (!indicatorIn(canvasElement)) throw new Error('indicator not visible with incremental engine on');
      },
      { timeout: 5_000 }
    );
    // Engine engaged: the scan stage measure is emitted ONLY when
    // `incrementalParse` routes a frame through the incremental
    // engine (dev-build stage telemetry).
    const scanCount = Number(smokeIn(canvasElement)?.getAttribute('data-scan-count'));
    expect(scanCount).toBeGreaterThan(0);
    // Flat-prose payload → the height the indicator observes must be
    // constant across every recorded render. A content-string cursor hack
    // would perturb the parse (and the measured tail) frame to frame.
    expect(recordedHeights.length).toBeGreaterThan(0);
    expect(new Set(recordedHeights.map(Math.round)).size).toBe(1);
  },
};

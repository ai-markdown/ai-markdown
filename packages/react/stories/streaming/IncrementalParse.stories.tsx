/**
 * Stateful integration smoke for the `incrementalParse` flat prop.
 *
 * The splice-equivalence arbiter (`incrementalParse/spliceEquivalence.test.ts`)
 * exhaustively proves parse-level output equality, and byteEquivalence proves
 * one-shot SSR is unperturbed — but neither exercises the REACT wiring
 * (render-phase state ref across rerenders, StrictMode double-invocation, G3
 * interplay). This story streams the benchmark payload into two `<AIMarkdown>`
 * instances that differ ONLY in the flag and asserts, in a real browser via
 * the vitest Storybook project, that their live DOM stays byte-identical on
 * every frame — and that the incremental engine actually engaged (counted via
 * the dev-only `scan` stage channel) rather than silently falling back.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';

import { ThemedAIMarkdown as AIMarkdown } from '../_shared/ThemedAIMarkdown';
import { AIMarkdownDocuments } from '../../src/components/AIMarkdownDocuments';
import { subscribeStageTimings } from '@ai-markdown/engine';
import { buildChunkSources, sliceChunkContents } from './crossChunkFixtures';
import 'katex/dist/katex.min.css';
import '../../src/components/typography/variants/all.scss';
import { DEFAULT_PAYLOAD, withDefs } from '../../../engine/src/fixtures/scenarios';
import { codePointSnapshots } from '../../../engine/src/components/incrementalParse/codePointSnapshots';
import { normalizeClobberPrefix, useDomEqualityStats } from './useDomEqualityStats';

/** Shared documentId so both sides emit identical clobber-prefixed ids. */
const SMOKE_DOCUMENT_ID = 'ip-smoke';
const CHUNK_CODE_POINTS = 24;
const FRAME_INTERVAL_MS = 15;

const INCREMENTAL_ON = { incrementalParse: true } as const;
const INCREMENTAL_OFF = { incrementalParse: false } as const;

interface SmokeStats {
  frames: number;
  mismatches: number;
  scans: number;
  firstMismatchLength: number;
}

function IncrementalParseSmoke({ payload }: { payload: string }) {
  const [content, setContent] = useState('');
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<SmokeStats | null>(null);
  const onRef = useRef<HTMLDivElement>(null);
  const offRef = useRef<HTMLDivElement>(null);
  const scansRef = useRef(0);
  const { statsRef } = useDomEqualityStats(onRef, offRef, content);

  // Count `scan` stage emissions — the incremental engine is the only
  // caller, so scans > 0 proves the flag-on side routed through it.
  useEffect(
    () =>
      subscribeStageTimings((stage) => {
        if (stage === 'scan') scansRef.current += 1;
      }),
    []
  );

  useEffect(() => {
    const snapshots = codePointSnapshots(payload, CHUNK_CODE_POINTS);
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
  }, [payload]);

  // Final mirror only — the play assertion reads the data attributes.
  useEffect(() => {
    if (done) setFinalStats({ ...statsRef.current, scans: scansRef.current });
  }, [content, done, statsRef]);

  return (
    <div>
      <div
        data-testid="ip-smoke-summary"
        data-done={finalStats ? 'true' : 'false'}
        data-frames={finalStats?.frames ?? 0}
        data-mismatches={finalStats?.mismatches ?? 0}
        data-scans={finalStats?.scans ?? 0}
        data-first-mismatch-length={finalStats?.firstMismatchLength ?? -1}
        style={{ fontFamily: 'monospace', fontSize: 12, marginBottom: 12 }}
      >
        {finalStats
          ? `done — frames=${finalStats.frames} mismatches=${finalStats.mismatches} scans=${finalStats.scans}`
          : `streaming… ${content.length}/${payload.length}`}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div ref={onRef} data-testid="ip-smoke-on">
          <AIMarkdown content={content} streaming={!done} documentId={SMOKE_DOCUMENT_ID} {...INCREMENTAL_ON} />
        </div>
        <div ref={offRef} data-testid="ip-smoke-off">
          <AIMarkdown content={content} streaming={!done} documentId={SMOKE_DOCUMENT_ID} {...INCREMENTAL_OFF} />
        </div>
      </div>
    </div>
  );
}

/** Coordinated (cross-chunk) smoke: each side is an `<AIMarkdownDocuments>`
 *  document of three sequentially-filled chunks sharing one documentId —
 *  chunks 2/3 cross-reference chunk 1's defs, so the flag-on side streams
 *  through phantom-suffix churn, registry version bumps, and the aggregate
 *  footer. The sides intentionally use DIFFERENT documentIds (stage-channel
 *  scoping), so the DOM comparison normalizes the clobber prefixes with the
 *  same derivation as `IncrementalParseComparison`. */
const XCK_ON_ID = 'xck-smoke-on';
const XCK_OFF_ID = 'xck-smoke-off';

function CrossChunkSmoke({ payload }: { payload: string }) {
  const [content, setContent] = useState('');
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<SmokeStats | null>(null);
  const onRef = useRef<HTMLDivElement>(null);
  const offRef = useRef<HTMLDivElement>(null);
  const scansRef = useRef(0);
  const chunkSources = useMemo(() => buildChunkSources(payload), [payload]);
  const fullDocument = useMemo(() => chunkSources.join(''), [chunkSources]);
  const normalize = useMemo(
    () => (html: string, side: 'on' | 'off') => normalizeClobberPrefix(html, side === 'on' ? XCK_ON_ID : XCK_OFF_ID),
    []
  );
  const { statsRef } = useDomEqualityStats(onRef, offRef, content, normalize);

  useEffect(
    () =>
      subscribeStageTimings((stage, _ms, instanceId) => {
        if (stage === 'scan' && instanceId === XCK_ON_ID) scansRef.current += 1;
      }),
    []
  );

  useEffect(() => {
    const snapshots = codePointSnapshots(fullDocument, CHUNK_CODE_POINTS);
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
  }, [fullDocument]);

  useEffect(() => {
    if (done) setFinalStats({ ...statsRef.current, scans: scansRef.current });
  }, [content, done, statsRef]);

  const chunkContents = useMemo(() => sliceChunkContents(chunkSources, content.length), [chunkSources, content.length]);

  const side = (docId: string, config: typeof INCREMENTAL_ON | typeof INCREMENTAL_OFF) => (
    <AIMarkdownDocuments>
      {chunkContents.map((chunk, i) => (
        <AIMarkdown key={i} content={chunk} streaming={!done} documentId={docId} {...config} />
      ))}
    </AIMarkdownDocuments>
  );

  return (
    <div>
      <div
        data-testid="xck-smoke-summary"
        data-done={finalStats ? 'true' : 'false'}
        data-frames={finalStats?.frames ?? 0}
        data-mismatches={finalStats?.mismatches ?? 0}
        data-scans={finalStats?.scans ?? 0}
        data-first-mismatch-length={finalStats?.firstMismatchLength ?? -1}
        style={{ fontFamily: 'monospace', fontSize: 12, marginBottom: 12 }}
      >
        {finalStats
          ? `done — frames=${finalStats.frames} mismatches=${finalStats.mismatches} scans=${finalStats.scans}`
          : `streaming… ${content.length}/${fullDocument.length}`}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div ref={onRef} data-testid="xck-smoke-on">
          {side(XCK_ON_ID, INCREMENTAL_ON)}
        </div>
        <div ref={offRef} data-testid="xck-smoke-off">
          {side(XCK_OFF_ID, INCREMENTAL_OFF)}
        </div>
      </div>
    </div>
  );
}

const meta: Meta<typeof IncrementalParseSmoke> = {
  title: 'QA/Incremental Parse',
  tags: ['qa'],
  component: IncrementalParseSmoke,
  parameters: {
    // Live DOM comparison harness — snapshotting the mid-stream markup is
    // meaningless and flaky by construction.
    chromatic: { disableSnapshot: true },
    // The byte-equivalence fixture intentionally duplicates complete documents,
    // including identical footnote region labels. Other a11y rules still gate.
    a11y: { config: { rules: [{ id: 'landmark-unique', enabled: false }] } },
  },
};
export default meta;

type Story = StoryObj<typeof IncrementalParseSmoke>;

/** One assertion set for every smoke variant (final-review R4 — a
 *  re-inlined copy had already appeared): equality must hold, AND the
 *  engine must have engaged (frames/scans guards keep the mismatch
 *  assertion from passing vacuously on a silent permanent fallback). */
const makeSmokePlay =
  (testId: string, timeout: number): Story['play'] =>
  async ({ canvasElement }) => {
    const summary = await waitFor(
      () => {
        const el = canvasElement.querySelector(`[data-testid="${testId}"]`);
        if (!el || el.getAttribute('data-done') !== 'true') throw new Error('streaming not finished yet');
        return el;
      },
      { timeout }
    );
    const frames = Number(summary.getAttribute('data-frames'));
    const mismatches = Number(summary.getAttribute('data-mismatches'));
    const scans = Number(summary.getAttribute('data-scans'));
    expect(
      mismatches,
      `flag-on DOM diverged from flag-off (first at content length ${summary.getAttribute('data-first-mismatch-length')})`
    ).toBe(0);
    expect(frames).toBeGreaterThan(10);
    expect(scans).toBeGreaterThan(0);
  };

const smokePlay = makeSmokePlay('ip-smoke-summary', 20_000);

export const StreamingSmoke: Story = {
  render: () => <IncrementalParseSmoke payload={DEFAULT_PAYLOAD} />,
  play: smokePlay,
};

/** Footnote-bearing payload through the REACT wiring — the v2 injection
 *  replay's footer regeneration, clobber-prefixed fn/fnref ids, and backref
 *  counts must all survive StrictMode double-render and the G3 interplay,
 *  not just the node-level arbiter. */
export const StreamingSmokeWithFootnotes: Story = {
  render: () => <IncrementalParseSmoke payload={withDefs(DEFAULT_PAYLOAD)} />,
  play: smokePlay,
};

/** Coordinated documents through the REACT wiring: phantom-suffix churn,
 *  registry bumps, aggregate footer, contribute/harvest — the whole
 *  cross-chunk machinery with the flag on vs off must stay byte-identical
 *  per frame (prefix-normalized). */
export const CrossChunkStreamingSmoke: StoryObj<typeof CrossChunkSmoke> = {
  render: () => <CrossChunkSmoke payload={withDefs(DEFAULT_PAYLOAD)} />,
  play: makeSmokePlay('xck-smoke-summary', 30_000),
};

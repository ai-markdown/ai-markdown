/**
 * FUZZ ARBITER — property-based generalization of spliceEquivalence.test.ts.
 *
 * Every generated document × append schedule × plugin config must satisfy,
 * on every frame:
 *   P1  splice ≡ fresh full parse (hast+mdast deep-equal, positions
 *       included) — via the shared arbiter harness;
 *   P2  checkpoint-resumed boundary scan ≡ fresh scan (boundary values
 *       only; checkpoints legitimately differ internally). The differential
 *       runs its OWN scan lineage — checkpoints are single-consumer mutable
 *       state, and sharing the engine's would corrupt both.
 * Cross-chunk samples additionally splice under churning phantom suffixes
 * (oracle: full parse of content+suffix, same options).
 *
 * Two document families with separate engagement floors: benign-biased docs
 * must keep the incremental path HOT (aggregate floor asserted — a fuzz
 * suite that only exercises the full-parse fallback proves nothing), while
 * hazard-dense docs legitimately splice less and only owe equivalence.
 * Generator coverage meters (COVERAGE_MARKERS) assert the adversarial
 * constructs actually occur, so a generator edit can't hollow the corpus.
 *
 * Determinism: fixed default seed; override scale/seed via env for soak —
 *   FUZZ_RUNS=50000 FUZZ_SEED=42 pnpm --filter @ai-markdown/react fuzz:splice
 * On failure fast-check prints the SHRUNK minimal counterexample + seed;
 * copy the shrunk doc/schedule into spliceEquivalence.test.ts as a fixed
 * regression fixture (that suite is the permanent record, this one hunts).
 */

import { describe, expect, test } from 'vitest';
import fc from 'fast-check';

import { computeFreezeBoundary, type FreezeScanCheckpoint } from './computeFreezeBoundary';
import { buildCrossChunkAdvanceOptions, CATALOG, scannerProfile } from './testPluginCatalog';
import type { FreezeBoundaryOptions, FreezeScanCheckpointInternal } from './computeFreezeBoundary';
import {
  assertStreamEquivalence,
  fallbackOracleSampleFromEnv,
  runCrossChunk,
  testEnv,
  type FramePair,
} from './spliceArbiterHarness';
import { benignDocArb, hazardDocArb, scheduleSnapshots, COVERAGE_MARKERS, type FuzzDoc } from './fuzzGenerators';
import { soakBeat } from './soakHeartbeat';

// The default is what CI and `pnpm preflight` run; the soak overrides it.
// 300 is kept for CI cost. At this size the coverage floor below can only
// detect a generator family disappearing: the thinnest family
// (`headRoutedCapture`, weight 2 of 81 in the hazard pool) appears in about
// 2.3% of documents, 6.9 per 300 on average, so the floor is set well under
// that. See coverageFloor.evidence.ts for the measured distribution.
const RUNS = Number(testEnv('FUZZ_RUNS') ?? 300);
const SEED = Number(testEnv('FUZZ_SEED') ?? 20260717);
/** ~30-40ms per sample (2 schedules × ~25 frames × oracle+engine) plus slack. */
const TIMEOUT_MS = Math.max(300_000, RUNS * 300);

/** Fallback-frame oracle sample denominator; 1 unless FALLBACK_ORACLE_SAMPLE
 *  is set (the soak passes 20). See the harness header. */
const FALLBACK_SAMPLE = fallbackOracleSampleFromEnv();

const FC_PARAMS = { numRuns: RUNS, seed: SEED } as const;

/** The all-defaults-on config, the shape a standalone consumer actually
 *  ships: highlight + def-list + the three display plugins. */
const DEFAULTS_ALL_ON = CATALOG.find((c) => c.label === 'defaults-all-on')!;

interface Totals {
  frames: number;
  incrementalFrames: number;
  markerHits: Record<string, number>;
  /** Documents whose FIRST task box the scanner released from the
   *  reference taint (its candidate present under the conservative
   *  profile, gone under the production one). A structural marker only
   *  proves the shape was drawn; this proves the certification path ran,
   *  so a tracker that silently fell back to "unknown" on every sample
   *  cannot pass on equivalence alone. */
  taskReleased: number;
}

const newTotals = (): Totals => ({ frames: 0, incrementalFrames: 0, markerHits: {}, taskReleased: 0 });

function meterMarkers(doc: string, totals: Totals): void {
  for (const [name, pattern] of Object.entries(COVERAGE_MARKERS)) {
    if (pattern.test(doc)) totals.markerHits[name] = (totals.markerHits[name] ?? 0) + 1;
  }
}

function meterTaskRelease(doc: string, profile: FreezeBoundaryOptions, totals: Totals): void {
  const box = COVERAGE_MARKERS.taskBox.exec(doc);
  if (box === null) return;
  const offset = box.index + box[0].indexOf('[');
  const tainted = (options: FreezeBoundaryOptions): boolean =>
    (computeFreezeBoundary(doc, options).checkpoint as FreezeScanCheckpointInternal).unresolvedRefs.some(
      (ref) => ref.offset === offset
    );
  // The box's own candidate, not the document boundary (which the other
  // generated references block on their own): live under the conservative
  // profile — otherwise the sample never exercised the release — and gone
  // under the production one.
  if (tainted({ ...profile, gfmTaskListItems: false }) && !tainted(profile)) totals.taskReleased += 1;
}

/** The engagement numbers on the real stream (`console.*` is intercepted
 *  and dropped on a passing run; same cast as boundaryDiff.test.ts). */
function emitTotals(family: string, totals: Totals): void {
  (process as unknown as { stdout?: { write(text: string): void } }).stdout?.write(
    `[spliceFuzz] ${family}: frames=${totals.frames} incremental=${totals.incrementalFrames} ` +
      `taskBoxDocs=${totals.markerHits.taskBox ?? 0} taskReleased=${totals.taskReleased}\n`
  );
}

/** Drive one sample through P1+P2 on two schedules (forward + reversed
 *  chunk sizes — extra splice-path coverage, same oracle). */
function driveSample(fuzz: FuzzDoc, tag: string, totals: Totals): void {
  const config = CATALOG[fuzz.configIndex % CATALOG.length];
  const profile = scannerProfile(config);
  meterMarkers(fuzz.doc, totals);
  meterTaskRelease(fuzz.doc, profile, totals);

  for (const sizes of [fuzz.sizes, [...fuzz.sizes].reverse()]) {
    const snapshots = scheduleSnapshots(fuzz.doc, sizes);

    // P1 — per-frame splice ≡ full parse. The engagement floor is an
    // AGGREGATE here (asserted per family below): an individual generated
    // document may legitimately poison to boundary 0 on every frame.
    const stats = assertStreamEquivalence(tag, snapshots, config, {
      minIncrementalFrames: 0,
      fallbackOracleSample: FALLBACK_SAMPLE,
    });
    totals.frames += stats.frames;
    totals.incrementalFrames += stats.incrementalFrames;

    // P2 — resumed scan ≡ fresh scan, own lineage, boundary values only.
    //
    // WHAT P2 DOES NOT LICENSE. This loop is LINEAR: one checkpoint, one
    // successor, the shape a stream has. A checkpoint is CONSUMED by the
    // call it is passed to — `computeFreezeBoundary` returns the very
    // object it was handed, with `confirmedOffset` advanced in place — so
    // handing one checkpoint to two calls resumes the second from a state
    // the first already moved. P2 says nothing about that, and "resumed
    // equals fresh" without the word LINEAR invites the reading that it
    // does. A state-directed SEARCH is the counterexample: one node, many
    // children, one checkpoint.
    //
    // Audited 2026-08-28 across the repo — every other resume is a linear
    // loop, `engineProbe` builds a fresh chain per probe rather than
    // sharing one, and `MarkdownContent`'s catch already nulls its state
    // ref for this exact reason. The same paragraph sits at the census
    // leg's P2 in `spliceExhaustive.test.ts`; two identical loops with the
    // warning on only one of them is how a local fix hides a global
    // hazard.
    let checkpoint: FreezeScanCheckpoint | null = null;
    for (const snapshot of snapshots) {
      const fresh = computeFreezeBoundary(snapshot, profile);
      const resumed = computeFreezeBoundary(snapshot, profile, checkpoint);
      if (resumed.boundary !== fresh.boundary) {
        expect.fail(
          `${tag} resume/fresh boundary divergence at len=${snapshot.length}: resumed=${resumed.boundary} fresh=${fresh.boundary} doc=${JSON.stringify(snapshot)}`
        );
      }
      checkpoint = resumed.checkpoint;
    }
  }
}

describe(`splice fuzz arbiter (runs=${RUNS} seed=${SEED} fallbackOracleSample=${FALLBACK_SAMPLE})`, () => {
  test('benign-biased family: equivalence + hot splice path', { timeout: TIMEOUT_MS }, () => {
    const totals = newTotals();
    const beat = soakBeat('benign', RUNS);
    fc.assert(
      fc.property(benignDocArb, (fuzz) => {
        beat.tick();
        driveSample(fuzz, 'fuzz-benign', totals);
      }),
      FC_PARAMS
    );
    beat.finish();
    // Anti-vacuity floor: aggregate engagement across the family. The floor
    // exists to catch the path COLLAPSING — a change that makes the splice
    // stop engaging — not to track a few points of drift.
    //
    // It was 0.3, which sat ON the mean rather than under it: measured
    // 2026-08-21 across twelve seeds at 300 samples each, the ratio lands
    // between 0.29 and 0.32, so three of twelve seeds failed at 0.292-0.295.
    // Raising the sample count does not help — that IS the converged value.
    // A floor sitting on the mean fails half the time by construction, and
    // the soak deliberately runs FRESH seeds, so it would teach everyone
    // to ignore a red leg. 0.2 keeps a collapse unmissable with real margin.
    emitTotals('benign', totals);
    expect(totals.frames).toBeGreaterThan(0);
    expect(totals.incrementalFrames / totals.frames).toBeGreaterThan(0.2);
    // The task-list release must engage on the benign family too, where
    // the provable shapes live; the same RUNS/200 floor as the markers.
    expect(totals.taskReleased, 'task boxes released').toBeGreaterThanOrEqual(Math.max(1, Math.floor(RUNS / 200)));
  });

  test('hazard-dense family: equivalence + generator coverage meters', { timeout: TIMEOUT_MS }, () => {
    const totals = newTotals();
    const beat = soakBeat('hazard', RUNS);
    fc.assert(
      fc.property(hazardDocArb, (fuzz) => {
        beat.tick();
        driveSample(fuzz, 'fuzz-hazard', totals);
      }),
      FC_PARAMS
    );
    beat.finish();
    emitTotals('hazard', totals);
    // Hazard docs legitimately splice less — only demand the path is alive.
    expect(totals.incrementalFrames).toBeGreaterThan(0);
    // Every adversarial construct family must occur. The floor is RUNS/200,
    // about a third of the thinnest family's mean rate (2.3%), so it catches
    // a family disappearing from the generator without failing on ordinary
    // seed variance. At RUNS/60 the floor sat near that mean and 36% of fresh
    // seeds failed at 300 runs (measured 2026-09-03 over 300 seeds; 0% at
    // /200 for 300 and 1000 runs). At the soak's 12500 runs the floor is 62
    // against a mean of 279. Measurement: coverageFloor.evidence.ts.
    const floor = Math.max(1, Math.floor(RUNS / 200));
    for (const name of Object.keys(COVERAGE_MARKERS)) {
      expect(totals.markerHits[name] ?? 0, `generator coverage: ${name}`).toBeGreaterThanOrEqual(floor);
    }
    // Engagement floor for the task-list release (see Totals.taskReleased).
    expect(totals.taskReleased, 'task boxes released').toBeGreaterThanOrEqual(floor);
  });

  test('cross-chunk family: phantom-suffix churn under fuzzed docs', { timeout: TIMEOUT_MS }, () => {
    let incremental = 0;
    const beat = soakBeat('cross-chunk', Math.max(20, Math.floor(RUNS / 4)));
    fc.assert(
      fc.property(
        benignDocArb,
        fc.integer({ min: 1, max: 8 }),
        fc.subarray(['A1', 'A2', 'B7'] as string[], { minLength: 1 }),
        fc.subarray(['SPEC', 'GFM'] as string[]),
        (fuzz, churnDenom, footPool, linkPool) => {
          beat.tick();
          // Refs to phantom labels make the suffix load-bearing, not inert.
          const doc = `${fuzz.doc}\ncross refs [^${footPool[0]}] and [${linkPool[0] ?? 'SPEC'}] appear.\n`;
          const snapshots = scheduleSnapshots(doc, fuzz.sizes);
          const churnAt = Math.max(1, Math.floor(snapshots.length / churnDenom));
          const frames: FramePair[] = snapshots.map((content, i) => ({
            content,
            footnotes: i < churnAt ? footPool.slice(0, 1) : footPool,
            links: i < churnAt ? [] : linkPool,
          }));
          const stats = runCrossChunk('fuzz-cross-chunk', frames, (f) =>
            buildCrossChunkAdvanceOptions(new Set(f.footnotes), new Set(f.links))
          );
          incremental += stats.incrementalFrames;
          // The PRODUCTION-reachable cell (review M-xchunk): the sole
          // production caller runs the user's plugin selection and
          // defListEnabled ALONGSIDE the phantom suffix, while this
          // property drove the no-plugin, defList-off cell only. def-list
          // is the load-bearing axis — its `: desc` claim reaches BACKWARD
          // across a blank, which is exactly what an injected suffix
          // appends past.
          const withPlugins = runCrossChunk('fuzz-cross-chunk-defaults', frames, (f) =>
            buildCrossChunkAdvanceOptions(new Set(f.footnotes), new Set(f.links), DEFAULTS_ALL_ON)
          );
          incremental += withPlugins.incrementalFrames;
        }
      ),
      { ...FC_PARAMS, numRuns: Math.max(20, Math.floor(RUNS / 4)) }
    );
    beat.finish();
    expect(incremental).toBeGreaterThan(0);
  });
});

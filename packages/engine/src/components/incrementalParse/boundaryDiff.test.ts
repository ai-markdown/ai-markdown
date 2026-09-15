/**
 * §2.3 boundary-diff harness: per-sample scanner boundaries over the pinned
 * corpus (17 realistic documents + 2000 pinned fuzz samples), compared
 * against the committed baseline on every test run.
 *
 * Red line encoded here: the boundary may move DOWN freely (each decrease
 * is reported in a histogram, never failed on); it may move UP only where a
 * stage fixes a confirmed under-block — so every increase fails the test
 * until the baseline is deliberately regenerated alongside that stage's
 * ledger entry.
 *
 * The two halves of that rule do NOT share a channel, and the difference is
 * why the decrease histogram is written to the real stream rather than
 * through `console.log` (see `emit` below and the note in
 * `vitest.config.ts`). Increases FAIL, so their rows ride out in an
 * assertion message and always surface. Decreases are allowed, so the
 * histogram is the only record they ever had — and through `console.log` it
 * printed nothing on a passing run, which is every run in which decreases
 * are the whole story.
 *
 * Consequence worth stating rather than quietly repairing: the ledger's
 * decrease counts from before 2026-08-28 (F19's "3 of 6060 move DOWN, zero
 * UP", F20's "2 of 6060") came through that silent channel. They are
 * probably right — someone recorded them, so someone saw them — but they
 * are not reproducible by re-running this file today, and no attempt is made
 * here to re-derive them. From this commit forward the histogram prints.
 *
 * Baseline lifecycle:
 *   BOUNDARY_BASELINE_WRITE=1 vitest --run boundaryDiff  → rewrite the file
 *   (then `prettier --write` it: the write path emits 1-space JSON and the
 *   committed file is prettier's 2-space — pre-existing quirk.)
 * The stored fingerprint covers the full corpus (ids, bytes, configs). A
 * mismatch means the corpus itself changed. RULE: any edit to
 * fuzzGenerators.ts or pinnedCorpus.ts shifts the pinned-seed sample stream
 * deterministically — on ANY node version — so it must regenerate
 * boundaryBaseline.json in the SAME commit, with the resulting increases
 * attributed in that commit's message. (The v2.8.0 release run failed
 * exactly here: the type-7 sticky-residue fix grew a generator without regenerating; the drift
 * was misread as node V8 behaviour. A fast-check upgrade is the other
 * trigger.)
 *
 * The fingerprint is a REGEN TRIGGER, not an escape hatch — v-4 of the
 * 2026-08-26 review: it used to be asserted BEFORE the increases check, so
 * any generator edit tripped regeneration and the red line was never
 * evaluated (the type-7 attribute corpus family absorbed 645 unattributed increases that way). It no
 * longer disables the net. Each sample carries its own content hash, so on
 * a fingerprint mismatch the BYTE-UNCHANGED subset is still diffed and
 * still fails on increases; only genuinely new or changed samples are
 * exempt, and those are reported as corpus-composition changes that the
 * regen commit must attribute.
 *
 * This tool is a REGRESSION net: a clean diff is never a safety argument
 * (only fresh-seed soak is), and it was not trusted until it had failed on
 * purpose — the §2.3 mutation check (blankRun off-by-one, dropped blocker,
 * flipped poison, dropped defs registration) is recorded in
 * GRAMMAR-COVERAGE.md's P1 section.
 *
 * Boundaries are recorded per production lineage, because the three
 * consumers run the scanner under different grammar profiles and a
 * regression can hide in the one your diff did not compute:
 *   e  engine   (advanceIncrementalParse) — defList per config
 *   s  scanner  (collectDefLabels)        — defList off, math off, taint off
 *   p  phantom  (remarkInjectPhantomDefs) — defList off, taint off
 *
 * The `p` lineage nets the OBSERVABLE, not the boundary: the phantom
 * consumer destructures only the checkpoint and reads it through
 * `pendingFenceCloser` — it never looks at the number. `p` therefore
 * records the closer's LENGTH (0 = no closer, n = an n-character fence or
 * math closer), which is what a phantom-side regression would move. The
 * boundary under that profile is still covered by `s`, whose profile
 * differs only in `mathFlow`.
 */

import { describe, expect, test } from 'vitest';

import { computeFreezeBoundary, pendingFenceCloser, type FreezeBoundaryOptions } from './computeFreezeBoundary';
import { CATALOG, scannerProfile } from './testPluginCatalog';
import { REALISTIC_DOCS, pinnedFuzzDocs, corpusFingerprint, type PinnedDoc } from './pinnedCorpus';
import { testEnv } from './spliceArbiterHarness';

// The package deliberately ships no node types (browser-shippable code must
// not grow env deps — see the ambient `process` shim note in
// spliceArbiterHarness), so this node-only test file loads fs through a
// COMPUTED dynamic import (not type-checked) against a minimal local
// interface, and derives the baseline path as a URL to avoid node:path.
interface NodeFsLike {
  readFileSync(p: URL, encoding: 'utf8'): string;
  writeFileSync(p: URL, data: string): void;
  existsSync(p: URL): boolean;
}
const fs = (await import('node' + ':fs')) as unknown as NodeFsLike;

/**
 * Diagnostics on the real stream, because `console.*` is intercepted here and
 * a PASSING test's output is dropped — the exact case this file's decrease
 * histogram lives in. The cast mirrors `spliceExhaustive.test.ts`: the engine
 * package takes no `@types/node`, and its `process` shim deliberately exposes
 * only `env`, so widening the shim would hand production code a Node global
 * the package is built not to have.
 */
const emit = (line: string): void => {
  (process as unknown as { stdout?: { write(text: string): void } }).stdout?.write(line);
};

const BASELINE_URL = new URL('./boundaryBaseline.json', import.meta.url);

interface Baseline {
  fingerprint: string;
  /** Per-sample content hash, keyed by doc id — the byte-level identity
   *  that survives a corpus-composition change and keeps the increases net
   *  armed for every sample that did not actually move. */
  hashes: Record<string, string>;
  boundaries: Record<string, number>;
}

function lineages(doc: PinnedDoc): Array<[string, FreezeBoundaryOptions]> {
  const config = CATALOG[doc.configIndex % CATALOG.length];
  return [
    // The engine lineage carries the adapters' grammar capability
    // (`gfmTaskListItems`), as production does since the task-list
    // release landed.
    ['e', scannerProfile(config)],
    ['s', { defListEnabled: false, mathFlow: false, referenceTaint: false }],
    ['p', { defListEnabled: false, referenceTaint: false }],
  ];
}

/** The netted number for a lineage: the boundary, except for `p`, whose
 *  production consumer reads only `pendingFenceCloser(checkpoint)`. */
function observable(lineage: string, doc: string, options: FreezeBoundaryOptions): number {
  const result = computeFreezeBoundary(doc, options);
  return lineage === 'p' ? pendingFenceCloser(result.checkpoint).length : result.boundary;
}

function computeAll(): Omit<Baseline, never> {
  const corpus = [...REALISTIC_DOCS, ...pinnedFuzzDocs()];
  const hashes: Record<string, string> = {};
  const boundaries: Record<string, number> = {};
  for (const doc of corpus) {
    hashes[doc.id] = corpusFingerprint([doc]);
    for (const [lineage, options] of lineages(doc)) {
      boundaries[`${doc.id}:${lineage}`] = observable(lineage, doc.doc, options);
    }
  }
  return { fingerprint: corpusFingerprint(corpus), hashes, boundaries };
}

describe('boundary diff against the committed baseline', () => {
  test('every boundary is at or below its baseline', () => {
    const current = computeAll();

    if (testEnv('BOUNDARY_BASELINE_WRITE') === '1') {
      fs.writeFileSync(BASELINE_URL, `${JSON.stringify(current, null, 1)}\n`);
      emit(`[boundaryDiff] baseline rewritten: ${Object.keys(current.boundaries).length} entries\n`);
      return;
    }

    expect(fs.existsSync(BASELINE_URL), 'no committed baseline — run with BOUNDARY_BASELINE_WRITE=1').toBe(true);
    const baseline = JSON.parse(fs.readFileSync(BASELINE_URL, 'utf8')) as Baseline;

    expect(baseline.hashes, 'baseline predates the per-sample hashes — regenerate it').toBeDefined();

    // A composition change does NOT disarm the net; it only narrows it to
    // the samples whose bytes are unchanged.
    const composition: string[] = [];
    const increases: string[] = [];
    const decreaseHistogram = new Map<string, number>();
    let decreases = 0;
    let compared = 0;

    for (const [id, baseHash] of Object.entries(baseline.hashes)) {
      const nowHash = current.hashes[id];
      if (nowHash === undefined) composition.push(`${id}: dropped from the corpus`);
      else if (nowHash !== baseHash) composition.push(`${id}: content changed (${baseHash} → ${nowHash})`);
    }
    for (const id of Object.keys(current.hashes)) {
      if (baseline.hashes[id] === undefined) composition.push(`${id}: new sample`);
    }

    for (const [key, base] of Object.entries(baseline.boundaries)) {
      const id = key.slice(0, key.lastIndexOf(':'));
      // Byte-changed and new samples are exempt — their numbers are not
      // comparable — but everything else is netted exactly as before.
      if (current.hashes[id] === undefined || current.hashes[id] !== baseline.hashes[id]) continue;
      const now = current.boundaries[key];
      expect(now, `sample ${key} vanished while its bytes are unchanged`).toBeDefined();
      compared += 1;
      if (now > base) increases.push(`${key}: ${base} → ${now} (+${now - base})`);
      if (now < base) {
        decreases += 1;
        const bucket = String(Math.min(9, Math.floor(Math.log2(base - now + 1))));
        decreaseHistogram.set(bucket, (decreaseHistogram.get(bucket) ?? 0) + 1);
      }
    }

    // UNCONDITIONAL, including the zero cases. A line that appears only when
    // there is something to say cannot be told apart from a channel that is
    // broken — which is precisely how this histogram spent its silent months
    // looking normal.
    //
    // `compared` rides along because the assertion below only speaks once the
    // net has ALREADY been narrowed to nothing. Seeing the count on a green
    // run is what shows it shrinking on the way there: a gate reports the
    // breach, a gauge reports the approach, and this file wants both.
    const rows = [...decreaseHistogram.entries()].sort().map(([b, n]) => `2^${b}≈${n}`);
    emit(
      `[boundaryDiff] compared=${compared} increases=${increases.length} decreases=${decreases}` +
        `${decreases > 0 ? ` histogram: ${rows.join(' ')}` : ''}` +
        `${composition.length > 0 ? ` composition-exempt=${composition.length}` : ''}\n`
    );
    // Increases first: this check is the red line, and it must be evaluated
    // whether or not the corpus composition moved (2026-08-26 review v-4).
    expect(
      increases,
      `boundary INCREASES on BYTE-UNCHANGED samples need a ledger entry naming the fixed under-block, then a deliberate baseline regen:\n${increases
        .slice(0, 40)
        .join('\n')}`
    ).toEqual([]);
    // The net must not have been narrowed to nothing.
    expect(compared, 'no byte-unchanged sample was comparable — the whole corpus changed').toBeGreaterThan(0);
    expect(
      composition,
      `corpus COMPOSITION changed — regenerate boundaryBaseline.json in the SAME commit and attribute the ` +
        `new samples' boundaries in its message (${compared} byte-unchanged samples were still netted above):\n` +
        `${composition.slice(0, 40).join('\n')}${composition.length > 40 ? `\n… and ${composition.length - 40} more` : ''}`
    ).toEqual([]);
    expect(current.fingerprint, 'corpus fingerprint drifted while every sample hash matched').toBe(
      baseline.fingerprint
    );
  });
});

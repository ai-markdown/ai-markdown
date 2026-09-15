/**
 * DIRECTION BATTERY — turns the detector's "over-block only" claim from a
 * comment into a tested property.
 *
 * The freeze contract: for a boundary b on prefix P, the top-level hast
 * children attributed before b must be UNCHANGED under ANY future append.
 * The five documented APPROX approximations are all argued to err toward
 * smaller b (over-block, performance-only); the one accepted under-count
 * edge ("same-line tag before an unclosed raw opener") is argued harmless.
 * This suite bombards both arguments: for fuzz-generated prefixes it takes
 * the detector's boundary and appends every known hazard-class future —
 * late definitions (link + footnote), closing tags for swallow reparenting,
 * raw-construct terminators, def-list claims, indented continuations, math
 * closers, list items, glue text — asserting the frozen region's output is
 * byte-stable (positions included) against a fresh full parse of P+future.
 *
 * This is boundary-level verification, independent of the splice machinery
 * (spliceFuzz covers that); a failure here is a DETECTOR under-block.
 *
 * Deterministic; scale via FUZZ_RUNS/FUZZ_SEED like spliceFuzz.
 */

import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import isEqual from 'lodash-es/isEqual';

import { attributeHastChildren } from './attributeHastChildren';
import { abstractSignature } from './checkpointAbstraction';
import { computeFreezeBoundary, type FreezeScanCheckpointInternal } from './computeFreezeBoundary';
import { CATALOG, scannerProfile } from './testPluginCatalog';
import { runFull, testEnv } from './spliceArbiterHarness';
import { benignDocArb, hazardDocArb, type FuzzDoc } from './fuzzGenerators';
import { soakBeat } from './soakHeartbeat';

const RUNS = Number(testEnv('FUZZ_RUNS') ?? 80);
const SEED = Number(testEnv('FUZZ_SEED') ?? 20260717);
const TIMEOUT_MS = Math.max(300_000, RUNS * 600);

/** Hazard-class futures, including RAW GLUE (no leading newline) so the
 *  append lands mid-line — the regime the trailing-partial-line rules are
 *  about. Labels intentionally collide with the generator's pool. */
const FUTURES = [
  'x',
  ' tail prose',
  '\nglued line\n',
  '\n\nnew paragraph\n',
  '[a]: /retarget\n',
  '\n[a]: /retarget "title"\n',
  '\n\n[a]: /retarget\n',
  '[^a]: late body\n',
  '\n\n[^a]: late body\n',
  '</details>\n',
  '</div>\n',
  '-->\n',
  '?>\n',
  ']]>\n',
  '\n:   late description\n',
  '\n    indented continuation\n',
  '$$\n',
  '`\n',
  '\n- item\n',
  '\n===\n',
  // Task-list back-claims (taskListContext.ts): a setext underline at the
  // content column of a two-space item, of a tab-indented item and of a
  // nested item; a GFM table delimiter row; the late definition for the
  // box label in both cases and glued; and sibling / lazy markers whose
  // box is a task in one container stack and a reference in another.
  '\n  ===\n',
  '\n  ---\n',
  '\n    ===\n',
  '\n  --- | ---\n',
  '\n\n[x]: /late\n',
  '\n[X]: /late "t"\n',
  '[x]: /late\n',
  '\n2. [x] b\n',
  '\n  - [x] b\n',
  '\r\n  ===\r\n',
] as const;

interface Frozen {
  count: number;
  children: unknown[];
}

function frozenRegion(doc: string, boundary: number, config: (typeof CATALOG)[number]): Frozen {
  const { mdast, hast } = runFull(doc, config) as never as {
    mdast: Parameters<typeof attributeHastChildren>[0];
    hast: Parameters<typeof attributeHastChildren>[1];
  };
  const attrs = attributeHastChildren(mdast, hast, boundary);
  const children: Array<{ position?: unknown }> = [];
  for (let i = 0; i < hast.children.length && attrs[i] < boundary; i++) {
    children.push(hast.children[i] as { position?: unknown });
  }
  // TRAILING position-less nodes (wrap separators, merged literal seams)
  // are SEAM-owned: the splice rebuilds them per-frame from the current
  // tail, and their existence legitimately depends on what follows the
  // boundary. The freeze contract covers everything before them.
  while (children.length > 0 && children[children.length - 1].position === undefined) {
    children.pop();
  }
  return { count: children.length, children };
}

describe(`boundary direction battery (runs=${RUNS} seed=${SEED}, futures=${FUTURES.length})`, () => {
  test('frozen output is stable under every hazard future', { timeout: TIMEOUT_MS }, () => {
    let boundaries = 0;
    const beat = soakBeat('futures', RUNS);
    fc.assert(
      fc.property(fc.oneof(benignDocArb, hazardDocArb), fc.integer({ min: 1, max: 7 }), (fuzz: FuzzDoc, cutDenom) => {
        beat.tick();
        const config = CATALOG[fuzz.configIndex % CATALOG.length];
        // A prefix mid-stream (not just the finished doc) — cut at a
        // code-point-safe offset.
        let cut = Math.max(1, Math.floor(fuzz.doc.length / cutDenom));
        const cc = fuzz.doc.charCodeAt(cut - 1);
        if (cc >= 0xd800 && cc <= 0xdbff) cut += 1;
        const prefix = fuzz.doc.slice(0, cut);

        const boundary = computeFreezeBoundary(prefix, scannerProfile(config)).boundary;
        if (boundary === 0) return;
        boundaries += 1;

        const base = frozenRegion(prefix, boundary, config);
        for (const future of FUTURES) {
          const extended = frozenRegion(prefix + future, boundary, config);
          if (extended.count !== base.count || !isEqual(extended.children, base.children)) {
            expect.fail(
              `UNDER-BLOCK: boundary=${boundary} prefix=${JSON.stringify(prefix)} future=${JSON.stringify(future)} — frozen region changed (${base.count} → ${extended.count} children)`
            );
          }
        }
      }),
      { numRuns: RUNS, seed: SEED }
    );
    beat.finish();
    // The battery must have tested real boundaries, not skipped everything.
    expect(boundaries).toBeGreaterThan(RUNS / 8);
  });
});

/**
 * Two list items the checkpoint abstraction used to merge (2026-09-15
 * review, section 4): `- [x] a` (content column 2) and `-   [x] a`
 * (content column 4). A two-column setext underline reaches the first
 * paragraph and turns its box into a reference; under the second it is
 * lazy text, the box stays a task and the boundary clears the list. The
 * second's frozen region must then hold under the late-definition futures
 * — the direction claim the abstraction's `taskItemSize` field keeps
 * searchable.
 */
describe('task-list content column', () => {
  test('`- [x] a` and `-   [x] a` are distinct states and answer a two-column setext future differently', () => {
    const config = CATALOG[0];
    const profile = scannerProfile(config);
    const future = '  ===\n\noutside\n\nnext\n\n';
    const narrow = '- [x] a\n';
    const wide = '-   [x] a\n';
    const signature = (doc: string): string =>
      abstractSignature(computeFreezeBoundary(doc, profile).checkpoint as FreezeScanCheckpointInternal);
    expect(signature(narrow)).not.toBe(signature(wide));

    expect(computeFreezeBoundary(narrow + future, profile).boundary).toBe(0);
    const boundary = computeFreezeBoundary(wide + future, profile).boundary;
    expect(boundary).toBeGreaterThan((wide + future).indexOf('outside'));

    const base = frozenRegion(wide + future, boundary, config);
    expect(base.count).toBeGreaterThan(0);
    for (const late of ['[x]: /late\n', '\n[X]: /late "t"\n', '\n\n[x]: /late\n', '  ===\n']) {
      const extended = frozenRegion(wide + future + late, boundary, config);
      expect(extended.count, late).toBe(base.count);
      expect(isEqual(extended.children, base.children), late).toBe(true);
    }
  });
});

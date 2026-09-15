/**
 * The seal-release migration's containment net (design rev3 §8).
 *
 * The derived release predicate replaced an ENUMERATION of node-less line
 * classes, and the swap was landed under one asserted relation: the derived
 * predicate releases only where the enumeration released — tighter or equal,
 * never wider. The enumeration stays in `computeFreezeBoundary.ts` for one
 * release as a dev-build assertion of exactly that, and this file is what
 * makes the assertion speak: it drives the whole pinned corpus through the
 * scanner under all three production lineages and fails if the assertion
 * ever fires.
 *
 * Direction, because only one of the two quadrants is a defect: the derived
 * side releasing where the enumeration held would be the derived side going
 * UP, which is the under-block direction the whole track exists to close.
 * The other quadrant — the enumeration releasing where the derived predicate
 * holds — is this change's PURPOSE and is silent here; it was measured
 * during the migration (29 distinct line shapes over this corpus, all of
 * them html-flow lines, three of 6060 boundary entries moving DOWN) and its
 * triage lives in the GRAMMAR-COVERAGE blocker-6 row.
 *
 * Vacuity, stated rather than assumed: the assertion is evaluated only on a
 * line where the derived predicate RELEASES a pending seam, so a corpus that
 * never seals anything would pass this test while checking nothing. Two
 * things answer that, and they fail on different days:
 *
 *  - the second test pins a boundary only a release can produce, which
 *    catches the release path going dead GLOBALLY;
 *  - the first test counts the evaluations this corpus actually drove and
 *    holds them over a floor, which catches THIS CORPUS drifting away from a
 *    release path that is still perfectly alive elsewhere. The pin cannot see
 *    that, and it is the likelier of the two: a corpus regeneration or a
 *    guard moving earlier does it silently.
 *
 * Stating the risk and then answering it with an instrument that cannot see
 * the case you stated is how this campaign's other blind spots were built, so
 * the count is asserted rather than described.
 */

import { describe, expect, test, vi } from 'vitest';

import { computeFreezeBoundary, type FreezeBoundaryOptions } from './computeFreezeBoundary';
import { readSealReleaseEvaluations } from './sealReleaseContainment';
import { CATALOG, buildAdvanceOptions } from './testPluginCatalog';
import { REALISTIC_DOCS, pinnedFuzzDocs, type PinnedDoc } from './pinnedCorpus';

const OFF = { defListEnabled: false };

function lineages(doc: PinnedDoc): FreezeBoundaryOptions[] {
  const { defListEnabled } = buildAdvanceOptions(CATALOG[doc.configIndex % CATALOG.length]);
  return [
    { defListEnabled },
    { defListEnabled: false, mathFlow: false, referenceTaint: false },
    { defListEnabled: false, referenceTaint: false },
  ];
}

describe('seal release: derived ⊆ enumerated', () => {
  test('the containment assertion stays silent over the whole pinned corpus', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const before = readSealReleaseEvaluations();
    try {
      for (const doc of [...REALISTIC_DOCS, ...pinnedFuzzDocs()]) {
        for (const options of lineages(doc)) computeFreezeBoundary(doc.doc, options);
      }
      expect(
        spy.mock.calls.map((c) => String(c[0])),
        'the derived predicate released a seam the enumeration withheld — that is the under-block direction'
      ).toEqual([]);
    } finally {
      spy.mockRestore();
    }
    // The floor is what makes the silence above mean something. Measured 862
    // over 6,060 scans on 2026-08-29; 400 is a wide margin under it, because
    // this is a total-collapse guard and not a drift gauge — a corpus edit
    // that moves the count by a third is a fine thing to happen quietly, and
    // one that takes it to single digits is not. Raise it only alongside a
    // measurement, never to "tighten" it.
    const evaluated = readSealReleaseEvaluations() - before;
    expect(
      evaluated,
      `the sweep drove ${evaluated} releases — the containment assertion above was checking almost nothing`
    ).toBeGreaterThan(400);
  });

  test('anti-vacuity: the release path the assertion rides on is live', () => {
    // Boundary 32 here is reachable only by RELEASING the seam the comment
    // line's floating remnant armed: the candidate after `plain prose` is
    // rejected outright while the seal is pending.
    const text = '<!-- c --> remnant\nplain prose\n\ntail paragraph';
    expect(computeFreezeBoundary(text, OFF).boundary).toBe(text.indexOf('tail paragraph'));
  });
});

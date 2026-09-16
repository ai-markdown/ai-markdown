import { describe, expect, it } from 'vitest';
import { detectLanguage } from '../detector';
import { allFixtures } from './fixtures';

/**
 * Accuracy gate over the synthetic fixtures, in the order of priority the
 * detector is designed for: false positive rate first, then precision, then
 * coverage. "Better to say we don't know than to guess wrong" means a rule
 * change may trade coverage away, but never precision or silence.
 */
describe('fixture metrics', () => {
  const rows = allFixtures.map((fixture) => {
    const result = detectLanguage(fixture.code);
    return { name: fixture.name, expected: fixture.expected, actual: result.language };
  });
  const asserted = rows.filter((row) => row.actual !== null);
  const shouldBeSilent = rows.filter((row) => row.expected === null);

  it('false positive rate is 0: no sample that should stay silent names a language', () => {
    const falsePositives = shouldBeSilent.filter((row) => row.actual !== null);
    expect(shouldBeSilent.length).toBeGreaterThan(0);
    expect(falsePositives.map((row) => `${row.name} → ${row.actual}`)).toEqual([]);
  });

  it('precision is 100%: every named language is the expected one', () => {
    const wrong = asserted.filter((row) => row.actual !== row.expected);
    expect(wrong.map((row) => `${row.name}: expected ${row.expected}, got ${row.actual}`)).toEqual([]);
  });

  it('coverage does not drop below the measured baseline', () => {
    // Measured when the package was ported: 58 of 78 samples name a language
    // (74.4%). Raise this number when a change detects more; a drop means a
    // rule change lost coverage.
    expect(asserted.length).toBeGreaterThanOrEqual(58);
  });
});

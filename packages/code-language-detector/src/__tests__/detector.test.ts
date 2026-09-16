import { describe, expect, it } from 'vitest';
import { detectLanguage } from '../detector';
import { ambiguous, negatives, newLanguageConfusions, positives } from './fixtures';

describe('positive cases', () => {
  for (const fixture of positives) {
    it(fixture.name, () => {
      const result = detectLanguage(fixture.code);
      expect(
        result.language,
        `expected ${fixture.expected}, got ${result.language} (confidence ${result.confidence}, evidence ${result.evidence.join(',')})`
      ).toBe(fixture.expected);
      if (fixture.minConfidence !== undefined) {
        expect(
          result.confidence,
          `confidence ${result.confidence} is below the required ${fixture.minConfidence}`
        ).toBeGreaterThanOrEqual(fixture.minConfidence);
      }
    });
  }
});

describe('new languages and existing languages do not steal each other’s scores', () => {
  for (const fixture of newLanguageConfusions) {
    it(fixture.name, () => {
      const result = detectLanguage(fixture.code);
      expect(
        result.language,
        `expected ${fixture.expected}, got ${result.language} (confidence ${result.confidence}, evidence ${result.evidence.join(',')})`
      ).toBe(fixture.expected);
      if (fixture.minConfidence !== undefined) {
        expect(result.confidence, `confidence ${result.confidence} is too low`).toBeGreaterThanOrEqual(
          fixture.minConfidence
        );
      }
    });
  }
});

describe('ambiguous cases', () => {
  for (const fixture of ambiguous) {
    it(fixture.name, () => {
      const result = detectLanguage(fixture.code);
      expect(
        result.language,
        `expected ${fixture.expected}, got ${result.language} (confidence ${result.confidence}, candidates ${result.candidates.join(',')})`
      ).toBe(fixture.expected);
      if (fixture.maxConfidence !== undefined) {
        expect(
          result.confidence,
          `confidence ${result.confidence} is above the allowed ${fixture.maxConfidence}`
        ).toBeLessThan(fixture.maxConfidence);
      }
      if (fixture.acceptableCandidates) {
        expect(result.candidates.length, 'an ambiguous sample should still yield candidates').toBeGreaterThan(0);
        for (const candidate of result.candidates) {
          expect(
            fixture.acceptableCandidates,
            `candidate ${candidate} is outside the allowed set ${fixture.acceptableCandidates.join(',')}`
          ).toContain(candidate);
        }
      }
    });
  }
});

describe('negative cases (natural language must not be detected as code)', () => {
  for (const fixture of negatives) {
    it(fixture.name, () => {
      const result = detectLanguage(fixture.code);
      expect(result.language, `should not name a language, got ${result.language}`).toBe(null);
      expect(result.confidence, `confidence ${result.confidence} is too high`).toBeLessThan(
        fixture.maxConfidence ?? 0.5
      );
    });
  }
});

describe('edge cases', () => {
  it('empty input returns unknown', () => {
    const result = detectLanguage('');
    expect(result.language).toBe(null);
    expect(result.confidence).toBe(0);
    expect(result.candidates).toEqual([]);
    expect(result.evidence).toEqual([]);
  });

  it('whitespace-only input returns unknown', () => {
    const result = detectLanguage('   \n\n  \t ');
    expect(result.language).toBe(null);
    expect(result.candidates).toEqual([]);
  });

  it('JSON primitives are not detected as json', () => {
    for (const code of ['123', 'true', '"hello"', 'null']) {
      const result = detectLanguage(code);
      expect(result.language, `${code} should not be detected as json`).not.toBe('json');
    }
  });

  it('a JSON array is detected as json', () => {
    const result = detectLanguage('[1, 2, 3]');
    expect(result.language).toBe('json');
  });

  it('oversized input is truncated but still detected', () => {
    const filler = '// padding line\n'.repeat(3000);
    const result = detectLanguage(`interface Foo { a: string }\n${filler}const x: number = 1\n`);
    expect(result.language).toBe('typescript');
  });
});

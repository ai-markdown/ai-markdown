import { describe, expect, it } from 'vitest';
import { CodeLanguage } from '../language';
import { MAX_DETECTION_LENGTH } from '../normalize';
import { POPULARITY } from '../popularity';
import { ALL_RULES } from '../rules/index';

describe('rule hygiene', () => {
  it('rule ids are unique', () => {
    const seen = new Set<string>();
    for (const rule of ALL_RULES) {
      expect(seen.has(rule.id), `duplicate rule id: ${rule.id}`).toBe(false);
      seen.add(rule.id);
    }
  });

  it('no g / y flags (they make lastIndex drift between rules)', () => {
    for (const rule of ALL_RULES) {
      expect(rule.pattern.global || rule.pattern.sticky, `${rule.id} must not carry the g or y flag`).toBe(false);
    }
  });

  it('no obvious catastrophic-backtracking constructs', () => {
    // Nested quantifiers such as (a+)+ / (a*)* and consecutive .*.* are the
    // classic sources of backtracking blow-ups.
    const nestedQuantifier = /\([^)]*[+*]\)[+*]|\.\*[^|]*\.\*/;
    for (const rule of ALL_RULES) {
      expect(
        nestedQuantifier.test(rule.pattern.source),
        `${rule.id} looks like it has a nested quantifier: ${rule.pattern.source}`
      ).toBe(false);
    }
  });

  it('every rule affects at least one language', () => {
    for (const rule of ALL_RULES) {
      expect(Object.keys(rule.scores).length, `${rule.id} has no scores`).toBeGreaterThan(0);
    }
  });

  it('excludes is only used on rules that describe the structure at the start of the snippet', () => {
    // excludes removes languages from the ranking outright, which is much
    // harsher than a negative score. Restricting it to "anchored at the start
    // of the snippet, no m flag" keeps it off features of an arbitrary line in
    // the middle of a snippet.
    for (const rule of ALL_RULES) {
      if (!rule.excludes) continue;
      expect(rule.pattern.source.startsWith('^'), `${rule.id} has excludes, so its pattern must start with ^`).toBe(
        true
      );
      expect(
        rule.pattern.multiline,
        `${rule.id} has excludes, so its pattern must not carry the m flag (^ would match at any line start)`
      ).toBe(false);
      for (const language of rule.excludes) {
        expect((rule.scores[language] ?? 0) > 0, `${rule.id} both excludes ${language} and adds points to it`).toBe(
          false
        );
      }
    }
  });

  it('a definitive rule gives its language a positive score', () => {
    for (const rule of ALL_RULES) {
      if (!rule.definitive) continue;
      const score = rule.scores[rule.definitive] ?? 0;
      expect(
        score,
        `${rule.id} is marked definitive: ${rule.definitive} but gives it no positive score`
      ).toBeGreaterThan(0);
    }
  });

  it('every language has a popularity value for tie-breaking', () => {
    const languages = Object.values(CodeLanguage);
    expect(languages).toHaveLength(42);
    expect(Object.keys(POPULARITY).sort()).toEqual([...languages].sort());
  });

  it('does not hang on pathological input', () => {
    // Lengths on the order of MAX_DETECTION_LENGTH: an unbounded greedy
    // quantifier (such as [\w-]+ followed by a required character) looks fine
    // on short input and degrades to O(n²) on a single 20,000-character line.
    const pathological = [
      'a'.repeat(MAX_DETECTION_LENGTH),
      '('.repeat(MAX_DETECTION_LENGTH / 2),
      `${'<'.repeat(5000)}foo${'>'.repeat(5000)}`,
      '{'.repeat(10_000),
      '$'.repeat(10_000),
      'a_b-c '.repeat(3000),
      `${'x'.repeat(10_000)}: ${'y'.repeat(10_000)}`,
      // A shape found in review: selector + { + a long stretch without a
      // semicolon, which makes the lazy quantifier in css-rule-block expand
      // character by character. None of the inputs above reach that path.
      `${'h1{'}${'a'.repeat(399)}`.repeat(50),
      `.cls{${'value '.repeat(300)}`,
      `${'div{'.repeat(200)}${'x'.repeat(2000)}`,
    ];
    // Best of three per rule and input: a single sub-millisecond measurement
    // moves with a GC pause or a shared CI core, and the minimum is the reading
    // that noise cannot inflate. Catastrophic backtracking on these inputs costs
    // seconds, far past the bound.
    const time = (pattern: RegExp, input: string): number => {
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < 3; i += 1) {
        pattern.lastIndex = 0;
        const started = performance.now();
        pattern.test(input);
        best = Math.min(best, performance.now() - started);
      }
      return best;
    };
    for (const input of pathological) {
      for (const rule of ALL_RULES) {
        const elapsed = time(rule.pattern, input);
        expect(
          elapsed,
          `rule ${rule.id} took ${elapsed.toFixed(1)}ms on a ${input.length}-character pathological input; ` +
            'check for unbounded greedy quantifiers'
        ).toBeLessThan(50);
      }
    }
  });
});

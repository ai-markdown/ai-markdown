import type { LanguageId } from './language';
import { comparePopularity } from './popularity';
import type { CandidateScore, DetectionRule } from './types';

export interface ScoringResult {
  /** Sorted from highest to lowest score; only languages scoring above 0 */
  ranked: CandidateScore[];
  /**
   * The languages of the definitive rules that fired, deduplicated, in firing
   * order. Taking only the first one is not enough: which language got the
   * boost would then depend on the order the rules are concatenated in
   * ALL_RULES.
   */
  definitives: LanguageId[];
  /** Ids of every rule that fired, for debugging */
  firedRules: string[];
}

/**
 * Evaluates every rule once and adds its scores to each language.
 * The cost is O(rules × code length): no nested loops, and no rule is executed
 * repeatedly against the same input.
 */
export function scoreCode(code: string, rules: readonly DetectionRule[]): ScoringResult {
  const table = new Map<LanguageId, CandidateScore>();
  const firedRules: string[] = [];
  const definitives: LanguageId[] = [];
  const excluded = new Set<LanguageId>();

  const entryFor = (language: LanguageId): CandidateScore => {
    let entry = table.get(language);
    if (!entry) {
      entry = { language, score: 0, evidenceCount: 0, evidence: [] };
      table.set(language, entry);
    }
    return entry;
  };

  for (const rule of rules) {
    // Defensive reset: a regex with the g/y flag keeps lastIndex, which would
    // make the same rule drift between inputs.
    rule.pattern.lastIndex = 0;
    if (!rule.pattern.test(code)) continue;

    firedRules.push(rule.id);
    if (rule.definitive && !definitives.includes(rule.definitive)) {
      definitives.push(rule.definitive);
    }
    if (rule.excludes) for (const language of rule.excludes) excluded.add(language);

    for (const [language, delta] of Object.entries(rule.scores) as [LanguageId, number][]) {
      const entry = entryFor(language);
      entry.score += delta;
      if (delta > 0) {
        // Only a positive hit counts as one independent piece of evidence;
        // counter-evidence lowers the score but must not make a language look
        // more trustworthy.
        entry.evidenceCount += 1;
        entry.evidence.push(rule.id);
      } else {
        entry.evidence.push(`-${rule.id}`);
      }
    }
  }

  const ranked = [...table.values()]
    .filter((entry) => entry.score > 0 && !excluded.has(entry.language))
    // Three sort keys: score → independent evidence count → popularity.
    // Popularity only matters when the first two are exactly tied. It picks the
    // more common of two lookalike languages the evidence cannot separate (JS
    // before TS, C before C++); it never lets a common language outweigh
    // evidence.
    .sort(
      (a, b) => b.score - a.score || b.evidenceCount - a.evidenceCount || comparePopularity(a.language, b.language)
    );

  return { ranked, definitives, firedRules };
}

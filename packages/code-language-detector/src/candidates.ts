import type { LanguageId } from './language';
import type { CandidateScore } from './types';

/** Upper bound on the candidate list: any longer and it stops narrowing anything down */
const MAX_CANDIDATES = 4;
/** Languages scoring below this fraction of the best score stay out of the candidates */
const RELATIVE_FLOOR = 0.4;
/**
 * Absolute score floor for a candidate. A relative floor alone is not enough:
 * the 1–2 points one rule adds to a language in passing can clear the relative
 * floor when the total scores are low.
 */
const MIN_CANDIDATE_SCORE = 3;

/**
 * Picks the candidate list from the ranking. This is the heuristic layer's
 * second most important output: even without a verdict, narrowing hundreds of
 * grammars down to 2–4 languages lets the caller decide cheaply.
 */
export function pickCandidates(ranked: readonly CandidateScore[]): LanguageId[] {
  if (ranked.length === 0) return [];

  const best = ranked[0].score;
  const floor = best * RELATIVE_FLOOR;

  return ranked
    .filter((entry) => entry.score >= floor && entry.score >= MIN_CANDIDATE_SCORE)
    .slice(0, MAX_CANDIDATES)
    .map((entry) => entry.language);
}

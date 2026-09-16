import type { CandidateScore } from './types';

/** The confidence a result needs before a language is named; below it only candidates are returned */
export const HIGH_CONFIDENCE = 0.8;
/** Confidence floor once a definitive rule has fired */
export const DEFINITIVE_CONFIDENCE = 0.95;

/** Reference score at which the score term saturates */
const SCORE_SATURATION = 14;
/** Reference margin over the runner-up at which the margin term saturates */
const MARGIN_SATURATION = 6;
/** Snippets shorter than this are discounted as a whole: in a few dozen characters even strong evidence can be a coincidence */
const SHORT_CODE_LENGTH = 30;
/** Confidence cap when there is only a single piece of evidence, however high its score */
const SINGLE_EVIDENCE_CAP = 0.72;

const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1);

/**
 * Confidence is not a linear mapping of the score but a weighted sum of three
 * things: how high the score is (0.55), the margin over the runner-up (0.30),
 * and how spread out the evidence is (0.15).
 * The score and margin terms are compressed with a square root, so that "just
 * past the threshold" already earns a reasonable medium confidence instead of
 * requiring a very high score before anything counts.
 */
export function calculateConfidence(
  best: CandidateScore | undefined,
  second: CandidateScore | undefined,
  codeLength: number,
  hasDefinitive = false
): number {
  if (!best) return 0;

  const margin = best.score - (second?.score ?? 0);

  const scorePart = Math.sqrt(clamp01(best.score / SCORE_SATURATION)) * 0.55;
  const marginPart = Math.sqrt(clamp01(margin / MARGIN_SATURATION)) * 0.3;
  const evidencePart = ((Math.min(best.evidenceCount, 3) - 1) / 2) * 0.15;

  let confidence = scorePart + marginPart + evidencePart;

  if (best.evidenceCount <= 1) confidence = Math.min(confidence, SINGLE_EVIDENCE_CAP);
  if (codeLength < SHORT_CODE_LENGTH) confidence *= 0.8;

  if (hasDefinitive) confidence = Math.max(confidence, DEFINITIVE_CONFIDENCE);

  return Math.round(clamp01(confidence) * 100) / 100;
}

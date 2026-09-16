import type { CodeLanguage, LanguageId } from './language';

/**
 * One evidence rule. The detector has exactly one rule type: a so-called
 * "definitive rule" is an ordinary rule with a high enough weight that is also
 * marked `definitive`. With a single code path there is never a case of "a
 * strong rule fired but the scores point the other way" that would need a
 * separate arbitration step.
 */
export interface DetectionRule {
  /** Stable rule identifier. It appears in `evidence`, which makes misdetections traceable */
  id: string;
  /** Must not carry the g/y flags: the engine evaluates every rule exactly once */
  pattern: RegExp;
  /** Points added to or removed from each language on a match; a negative score is counter-evidence */
  scores: Partial<Record<LanguageId, number>>;
  /** The language a match settles. Reserved for the few signatures that cannot occur in any other language */
  definitive?: LanguageId;
  /**
   * On a match, the snippet **structurally cannot be** any of these languages,
   * so they are removed from the ranking outright.
   *
   * A negative score expresses a tendency, and enough positive evidence adds up
   * past it. Some relations are logical instead: a snippet that starts with a
   * `<script>` tag cannot be a JS / TS file itself, even when the TS code inside
   * the script block fires a dozen TS rules. Any negative score in that
   * situation is a bet on the number being large enough.
   *
   * Only valid on rules that describe the structure of the whole snippet: the
   * rule hygiene test requires the pattern to start with `^` and to have no m
   * flag.
   */
  excludes?: readonly LanguageId[];
  description?: string;
}

export interface CandidateScore {
  language: LanguageId;
  score: number;
  /** Number of positive rules that fired. At equal scores, more independent evidence is more trustworthy */
  evidenceCount: number;
  /** Ids of the rules that touched this language, in rule order; counter-evidence is prefixed with `-` */
  evidence: string[];
}

/** What every detection entry point returns. */
export interface LanguageDetectionResult {
  /**
   * The detected language, or `null` when the evidence is not strong enough.
   * `null` is a valid result, not a failure: render the block as plain text.
   */
  language: CodeLanguage | null;
  /** Between 0 and 1. `language` is only set at 0.8 and above. */
  confidence: number;
  /**
   * The short list of languages the evidence points to, best first (at most
   * four). Present even when `language` is `null`, so a caller with its own
   * tie-breaker (a file name, a user preference) can choose among them.
   *
   * Readonly: one result object is cached and returned by reference to many
   * callers.
   */
  candidates: readonly CodeLanguage[];
  /**
   * Ids of the rules that touched the best-ranked language, in rule order; a
   * leading `-` marks counter-evidence. Meant for debugging misdetections, not for
   * branching on. Empty when nothing matched.
   */
  evidence: readonly string[];
}

import { pickCandidates } from './candidates';
import { calculateConfidence, HIGH_CONFIDENCE } from './confidence';
import type { LanguageId } from './language';
import { tieBreakFamily } from './families';
import { normalize } from './normalize';
import { ALL_RULES } from './rules/index';
import { scoreCode } from './scoring';
import type { LanguageDetectionResult } from './types';

/** Size limit for JSON.parse: past this size, parsing just to detect the language is not worth it */
const MAX_JSON_PARSE_LENGTH = 2_000_000;

// Frozen: this object is returned by reference to every caller, so a push or a
// write anywhere would leak into every other caller.
export const UNKNOWN: LanguageDetectionResult = Object.freeze({
  language: null,
  confidence: 0,
  candidates: Object.freeze([]),
  evidence: Object.freeze([]),
});

/**
 * The only conversion from the internal spelling to the public enum. The enum
 * values are exactly the `LanguageId` literals, so this is a type-level cast
 * with no runtime work.
 */
function toPublic(
  language: LanguageId | null,
  confidence: number,
  candidates: readonly LanguageId[],
  evidence: readonly string[]
): LanguageDetectionResult {
  return { language, confidence, candidates, evidence } as LanguageDetectionResult;
}

/**
 * Blanks the content lines of fenced code blocks (``` or ~~~, closed or still
 * open at the end), keeping the fence lines themselves.
 *
 * The code inside a fence belongs to the fence's language, not to the snippet:
 * a Markdown document full of TypeScript examples is still Markdown, and a
 * prompt template inside a Python file does not make the file JSON. This is the
 * same principle as not counting code inside comments and strings. The fence
 * lines stay, so the Markdown rules still see them.
 */
export function maskFencedCode(code: string): string {
  if (!code.includes('```') && !code.includes('~~~')) return code;
  const lines = code.split('\n');
  let fence: { char: string; length: number } | null = null;
  let masked = false;
  for (let i = 0; i < lines.length; i += 1) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (fence === null) {
      // A backtick fence's info string cannot contain a backtick (CommonMark), which also keeps inline code out
      if (marker && !(marker[1][0] === '`' && marker[2].includes('`'))) {
        fence = { char: marker[1][0], length: marker[1].length };
      }
    } else if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) {
      fence = null;
    } else {
      lines[i] = '';
      masked = true;
    }
  }
  return masked ? lines.join('\n') : code;
}

/**
 * JSON special case: parsing is more accurate than any regex.
 * Only objects and arrays count. `123`, `true`, `"hello"` and `null` are valid
 * JSON, but a code fence that holds one of them is almost never a JSON snippet.
 */
function tryJson(code: string): LanguageDetectionResult | null {
  const first = code[0];
  if (first !== '{' && first !== '[') return null;
  if (code.length > MAX_JSON_PARSE_LENGTH) return null;

  try {
    const parsed: unknown = JSON.parse(code);
    if (parsed === null || typeof parsed !== 'object') return null;
    return toPublic('json', 0.98, ['json'], ['json-parse']);
  } catch {
    return null;
  }
}

/**
 * Detects the language of one code block.
 *
 * Synchronous and dependency-free. When the evidence is not strong enough the
 * result has `language: null`. That is a normal result: render the block as
 * plain text, or choose among `candidates` with information the detector does
 * not have.
 *
 * Pass the whole block. Inputs longer than 20,000 characters are inspected by
 * their first and last 10,000 characters.
 */
export function detectLanguage(code: string): LanguageDetectionResult {
  const trimmed = code.trim();
  if (trimmed.length === 0) return UNKNOWN;

  // JSON must be parsed from the untruncated text: normalize joins the head and
  // the tail, which breaks the structure, so a large JSON document would never
  // parse; and once minified onto one line the JSON rules' line anchors no
  // longer match either.
  const json = tryJson(trimmed);
  if (json) return json;

  const { code: inspected, originalLength } = normalize(maskFencedCode(trimmed));
  const { ranked, definitives } = scoreCode(inspected, ALL_RULES);
  if (ranked.length === 0) return UNKNOWN;

  const [best, second] = ranked;
  // A definitive rule only boosts when it is unique: strong signatures of two
  // languages at once (a Python file holding an SQL string, Rust's `std::` also
  // matching C++) mean the evidence contradicts itself, and "better to say we
  // don't know" rules out 0.95. A definitive language pushed below zero by
  // negative scores is not a conflict: counter-evidence has already ruled that
  // signature out.
  const live = definitives.filter((lang) => ranked.some((entry) => entry.language === lang));
  const hasDefinitive = live.length === 1 && live[0] === best.language;
  const confidence = calculateConfidence(best, second, originalLength, hasDefinitive);
  const candidates = pickCandidates(ranked);
  if (confidence >= HIGH_CONFIDENCE) return toPublic(best.language, confidence, candidates, best.evidence);

  // No verdict for the language itself. When the runner-up is a close relative that highlights almost the same way
  // (C and C++, JavaScript and TypeScript, CSS and SCSS), measure the evidence against the best language outside
  // that family instead. If the family clears the line, name its best member (the ranking already broke the tie by
  // evidence and then popularity) at exactly HIGH_CONFIDENCE: sure of the family, not of the member, and below the
  // streaming lock, so specific evidence arriving later can still refine it.
  if (tieBreakFamily(best.language, second?.language ?? best.language)) {
    const rival = ranked.find((entry) => !tieBreakFamily(entry.language, best.language));
    if (calculateConfidence(best, rival, originalLength, hasDefinitive) >= HIGH_CONFIDENCE) {
      return toPublic(best.language, HIGH_CONFIDENCE, candidates, best.evidence);
    }
  }
  return toPublic(null, confidence, candidates, best.evidence);
}

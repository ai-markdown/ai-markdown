import { detectLanguage, UNKNOWN } from './detector';
import { sameFamily } from './families';
import type { LanguageDetectionResult } from './types';

/** Tuning knobs for {@link StreamingLanguageDetector}. Every field is optional. */
export interface StreamingLanguageDetectorOptions {
  /**
   * Once the result reaches this confidence it is locked: appended content is
   * not re-detected (`finalize` still re-detects). Default `0.9`.
   */
  lockConfidence?: number;
  /** Look at the text again only after it has grown by at least this fraction since the last checkpoint. Default `0.5`. */
  growthRatio?: number;
  /**
   * Look at the text again only after it has grown by at least this many characters since the last checkpoint,
   * so single tokens never trigger work. Default `80`.
   */
  minGrowthChars?: number;
  /**
   * A switch to a language in a different family must beat the current
   * confidence by this much, and `finalize` is no exception. When two verdicts
   * both clear the high-confidence line but point at different families, the
   * evidence contradicts itself, and keeping the current verdict is steadier
   * than switching back and forth. Default `0.1`.
   */
  familySwitchMargin?: number;
}

/**
 * How many trailing characters of the previous input every `update` compares.
 * Constant work per call; see the class comment.
 */
const TAIL_CHECK_CHARS = 64;

const DEFAULTS: Required<StreamingLanguageDetectorOptions> = {
  lockConfidence: 0.9,
  growthRatio: 0.5,
  minGrowthChars: 80,
  familySwitchMargin: 0.1,
};

/**
 * djb2 and FNV-1a, two independent 32-bit hashes, joined into one key together
 * with the length. Cache keys use this instead of the code itself so large
 * strings are not kept alive in memory. A single 32-bit hash rarely collides
 * among a few hundred entries, but a collision would return the wrong language
 * forever, and the second hash is one more line of arithmetic in the same pass.
 */
export function hashCode(text: string): string {
  let djb2 = 5381;
  let fnv = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    djb2 = ((djb2 << 5) + djb2 + c) | 0;
    fnv = Math.imul(fnv ^ c, 0x01000193);
  }
  return `${djb2 >>> 0}:${fnv >>> 0}:${text.length}`;
}

/**
 * Language detection for a code block that arrives while it is being written.
 *
 * Agent output arrives token by token. Calling `detectLanguage` on every token
 * has two problems:
 *   1. Repeated cost: the same block is detected dozens or hundreds of times.
 *   2. Verdict flips: the first 3 lines look like JS, a type annotation on line
 *      8 turns it into TS, and the highlighting flickers.
 * This class addresses both: it caches the result, re-detects only when the
 * evidence may have changed, and never lowers the confidence.
 *
 * **The detector follows one growing text.** Pass the whole text accumulated so
 * far, not the latest delta. An input that does not extend the text the
 * detector has been following is a different text: the state is reset and
 * detection starts over. That covers a caller reusing the detector for another
 * code block, content that was rolled back, and a block regenerated with a
 * different text.
 *
 * Comparing the whole text costs time proportional to its length, so it is not
 * done on every call: per token, that would make a stream quadratic (a 200 KB
 * block fed in 4-character steps took seconds instead of milliseconds). Every
 * `update` instead checks that the last 64 characters of the previous input
 * are still in place, which is constant work and catches a replacement on the
 * call where it arrives unless the new text happens to repeat those exact
 * characters at the same offset. The whole text is compared at the growth
 * checkpoints below, when the input is not longer than the followed text, and
 * in `finalize`, so even that coincidence is caught by the next checkpoint.
 *
 * The four streaming strategies:
 *   - **Confidence only goes up**: a result with lower confidence than the
 *     current one is ignored, so diluted evidence never flips the verdict back.
 *   - **Switching families costs a margin**: see `familySwitchMargin`. A
 *     refinement within a family (`typescript → tsx`) is not restricted.
 *   - **Locking**: once confidence reaches `lockConfidence`, appended content is
 *     no longer re-detected.
 *   - **Growth threshold**: until the text has grown by `minGrowthChars`
 *     characters and by `growthRatio` since the last checkpoint, the cached
 *     result is returned without looking at the text. Checkpoints grow
 *     geometrically, so their total cost over a stream stays linear.
 */
export class StreamingLanguageDetector {
  #options: Required<StreamingLanguageDetectorOptions>;
  #result: LanguageDetectionResult = UNKNOWN;
  /** The text this detector follows: the input of the last checkpoint or `finalize` */
  #text = '';
  /** The input of the last `update` or `finalize`, for the per-call tail check */
  #lastInput = '';
  #locked = false;
  #finalized = false;

  constructor(options: StreamingLanguageDetectorOptions = {}) {
    this.#options = { ...DEFAULTS, ...options };
  }

  /** The current result, without triggering detection */
  get current(): LanguageDetectionResult {
    return this.#result;
  }

  /**
   * Feeds the complete text accumulated so far (not a delta). The detector
   * decides whether this call actually re-detects.
   *
   * After `finalize`: the same text again returns the cached result without
   * detecting (a renderer re-rendering a closed block); a text that extends it
   * continues under the normal streaming rules and keeps the current result (a
   * stream that resumed); any other text starts over.
   */
  update(code: string): LanguageDetectionResult {
    if (this.#finalized) {
      if (code === this.#text) return this.#result;
      if (code.length > this.#text.length && code.startsWith(this.#text)) this.#finalized = false;
      else this.reset();
    } else if (code.length <= this.#text.length) {
      if (code === this.#text) return this.#result;
      // Not a continuation of the text so far: the caller switched to another
      // code block without finalizing, rolled the content back, or regenerated
      // it. The old verdict rests on content that no longer exists and has to
      // go; kept, it would stick, because the growth check measures lengths.
      this.reset();
    } else if (!this.#keepsTailOfLastInput(code)) {
      // Longer than the followed text but not a continuation of the last input:
      // the same replacement, caught before the next checkpoint.
      this.reset();
    }
    this.#lastInput = code;

    if (!this.#atCheckpoint(code)) return this.#result;
    if (!code.startsWith(this.#text)) this.reset();
    this.#text = code;
    if (this.#locked) return this.#result;
    return this.#detect(code);
  }

  /**
   * Call when the code fence closes. The content is complete, so detection is
   * forced once more, but the new result is **not adopted unconditionally**: a
   * GitHub Actions file whose first 30 lines were steadily detected as yaml can
   * accumulate more bash evidence from the shell in its `run: |` blocks by the
   * end. If finalize simply overwrote the verdict, the highlighting would jump
   * from YAML to bash at the moment the fence closes, which is exactly the
   * flicker the streaming strategies exist to prevent.
   *
   * Adoption rules at close: no verdict yet, adopt; the complete text yields no
   * language, keep the current verdict; same family (`typescript → tsx`),
   * adopt; another family, adopt only when the confidence beats the current one
   * by `familySwitchMargin`.
   *
   * Calling `finalize` again with the text it already finalized returns the
   * cached result without detecting, so renderers may call it on every render.
   * A text that does not extend the followed text starts over first, and its
   * own verdict is adopted.
   */
  finalize(code: string): LanguageDetectionResult {
    if (this.#finalized && code === this.#text) return this.#result;
    if (!code.startsWith(this.#text)) this.reset();
    this.#text = code;
    this.#lastInput = code;
    this.#locked = false;
    const result = this.#detect(code, true);
    this.#finalized = true;
    return result;
  }

  /** Forgets the followed text and the verdict. */
  reset(): void {
    this.#result = UNKNOWN;
    this.#text = '';
    this.#lastInput = '';
    this.#locked = false;
    this.#finalized = false;
  }

  /**
   * Whether the last {@link TAIL_CHECK_CHARS} characters of the previous input
   * sit at the same offset in `code`. A cheap necessary condition for `code`
   * extending that input, not a sufficient one; the checkpoints do the exact
   * comparison.
   */
  #keepsTailOfLastInput(code: string): boolean {
    const last = this.#lastInput;
    if (code.length < last.length) return false;
    const start = Math.max(0, last.length - TAIL_CHECK_CHARS);
    return code.startsWith(last.slice(start), start);
  }

  /** Whether `code` has grown enough past the followed text to look at it again */
  #atCheckpoint(code: string): boolean {
    if (this.#text.length === 0) return true;
    const grown = code.length - this.#text.length;
    if (grown < this.#options.minGrowthChars) return false;
    return grown / this.#text.length >= this.#options.growthRatio;
  }

  #detect(code: string, isFinal = false): LanguageDetectionResult {
    const next = detectLanguage(code);

    if (isFinal ? this.#acceptsFinal(next) : this.#accepts(next)) this.#result = next;

    if (this.#result.confidence >= this.#options.lockConfidence) this.#locked = true;
    return this.#result;
  }

  /**
   * While streaming, only a "more certain" result is accepted. Otherwise, when
   * the evidence is diluted halfway through a block, the verdict drops from
   * typescript back to null and the renderer shows the highlighting flicker.
   * A refinement within a family (typescript → tsx) counts as an ordinary
   * upgrade; a switch across families has to pay `familySwitchMargin` on top.
   */
  #accepts(next: LanguageDetectionResult): boolean {
    const current = this.#result;
    if (next.confidence < current.confidence) return false;
    if (current.language !== null && next.language !== null && !sameFamily(current.language, next.language)) {
      return next.confidence >= current.confidence + this.#options.familySwitchMargin;
    }
    return true;
  }

  /**
   * Adoption rules at close. Slightly looser than while streaming, but the
   * cross-family line still holds:
   *   - The complete content yields no language: keep the verdict already given
   *     while streaming instead of falling back to unknown at close.
   *   - No verdict yet: adopt.
   *   - Refinement within a family (typescript → tsx): adopt. The JSX visible in
   *     the complete content is more accurate than the prefix, even at a
   *     slightly lower confidence.
   *   - Switch across families: as while streaming, it must beat the current
   *     confidence by `familySwitchMargin`.
   */
  #acceptsFinal(next: LanguageDetectionResult): boolean {
    const current = this.#result;
    if (current.language === null) return true;
    if (next.language === null) return false;
    if (sameFamily(current.language, next.language)) return true;
    return next.confidence >= current.confidence + this.#options.familySwitchMargin;
  }
}

/**
 * A result cache shared across components and renders. React re-renders and
 * virtualized lists scrolling back ask about the same code over and over; this
 * layer makes sure the same content is detected only once.
 *
 * Least-recently-used eviction; entries are keyed by a content hash, so large
 * code strings are not retained.
 */
export class DetectionCache {
  #map = new Map<string, LanguageDetectionResult>();
  #limit: number;

  /** @param limit Maximum number of cached results. Default `500`. */
  constructor(limit = 500) {
    this.#limit = limit;
  }

  /** Number of cached results */
  get size(): number {
    return this.#map.size;
  }

  /** Same as `detectLanguage`, but returns the cached result object for content it has seen. */
  detect(code: string): LanguageDetectionResult {
    const key = hashCode(code);
    const hit = this.#map.get(key);
    if (hit) {
      // Map keeps insertion order: deleting and re-inserting on a hit is an LRU
      // with no bookkeeping.
      this.#map.delete(key);
      this.#map.set(key, hit);
      return hit;
    }

    const result = detectLanguage(code);
    if (this.#map.size >= this.#limit) {
      const oldest = this.#map.keys().next().value;
      if (oldest !== undefined) this.#map.delete(oldest);
    }
    this.#map.set(key, result);
    return result;
  }

  /** Drops every cached result */
  clear(): void {
    this.#map.clear();
  }
}

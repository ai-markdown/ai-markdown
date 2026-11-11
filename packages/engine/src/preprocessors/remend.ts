/**
 * Optional streaming tail-repair preprocessor built on `remend` (the
 * markdown-termination engine extracted from Vercel's Streamdown).
 *
 * While a response streams, the tail of the markdown source is frequently
 * mid-construct — `**bold` without its closer, an unterminated `` `code ``
 * span, a half-typed `[link](url`. The stock pipeline renders those frames
 * literally (asterisks and all) until the closing bytes arrive. Wrapping the
 * content with this preprocessor completes the unterminated syntax so every
 * frame renders styled.
 *
 * NOT enabled by default — opt in per instance:
 *
 * ```tsx
 * const remend = createRemendPreprocessor();
 * <AIMarkdown content={content} contentPreprocessors={[remend]} />
 * ```
 *
 * Create the preprocessor ONCE (module scope or `useMemo`) — a fresh function
 * identity per render would defeat `contentPreprocessors`' stable-value
 * memoization and re-run the whole pipeline every frame.
 *
 * Interactions (see apps/docs/content/guides/content-preprocessors.md for the full discussion):
 *
 * - **block-memo**: zero conflict. Repairs only append/adjust the tail;
 *   earlier blocks' bytes are untouched, so their hast digests still hit.
 * - **incremental parse** (`incrementalParse`): frames whose tail was
 *   repaired are not byte-appends of the previous frame, so the engine's
 *   append gate falls back to a full parse for exactly those frames (not
 *   sticky — splicing resumes once the construct closes in the real bytes).
 * - **`preprocessLaTeX`**: user preprocessors run AFTER the built-in LaTeX
 *   pass. Math repair is therefore disabled here (`katex`/`inlineKatex`
 *   forced off) — the LaTeX preprocessor already owns `$` handling,
 *   including truncating unclosed `$$` tails.
 * - **complete documents**: on well-formed text remend is a no-op, so the
 *   final frame renders identically with or without it. A document that
 *   legitimately ends inside an unterminated marker (a trailing lone `*`)
 *   will get it closed — acceptable for streaming UIs, but don't apply this
 *   preprocessor to static content.
 *
 * @module preprocessors/remend
 */

// Keep remend pinned to 1.3.1 until incomplete-image placeholders are supported.
// 1.4 emits streamdown:incomplete-image instead of dropping unfinished images;
// our URL sanitizer rejects that protocol, leaving a broken image while streaming.
import remend, { type RemendOptions } from 'remend';
import type { AIMDContentPreprocessor } from './defs';

/** Options accepted by {@link createRemendPreprocessor} — everything remend
 *  supports except the math toggles, which this pipeline reserves for the
 *  built-in LaTeX preprocessor. */
export type RemendPreprocessorOptions = Omit<RemendOptions, 'katex' | 'inlineKatex'>;

/**
 * Build an {@link AIMDContentPreprocessor} that completes unterminated
 * markdown syntax at the streaming tail.
 *
 * Deviations from remend's own defaults:
 *
 * - `linkMode: 'text-only'` (overridable) — remend's default (`'protocol'`)
 *   substitutes a `streamdown:incomplete-link` placeholder URL, but this
 *   pipeline's URL sanitizer strips unknown protocols, which would leave a
 *   dead `<a>` for the duration of the stream. Rendering the link text
 *   plainly until the real URL arrives looks better under our sanitize
 *   defaults.
 * - `katex`/`inlineKatex` forced off (NOT overridable — removed from the
 *   option type) — the built-in LaTeX preprocessor (which runs first)
 *   already rewrites and truncates `$`/`$$` constructs; two writers on the
 *   same delimiters would fight.
 */
export function createRemendPreprocessor(options?: RemendPreprocessorOptions): AIMDContentPreprocessor {
  return (content) =>
    remend(content, {
      linkMode: 'text-only',
      ...options,
      katex: false,
      inlineKatex: false,
    });
}

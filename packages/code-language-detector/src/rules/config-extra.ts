import type { DetectionRule } from '../types';

/**
 * TOML and Less share a lot of syntax with INI and CSS/SCSS respectively,
 * so every rule picks a form unique to its language and gives a negative score to the language most likely
 * to steal the points.
 */
export const configExtraRules: DetectionRule[] = [
  // ── TOML ────────────────────────────────────────────────────────
  {
    id: 'toml-array-of-tables',
    // [[table]] double brackets are TOML-only; INI has no such concept
    pattern: /^[ \t]*\[\[[\w.$-]{1,60}\]\][ \t]*$/m,
    scores: { toml: 12, ini: -4 },
    definitive: 'toml',
  },
  {
    id: 'toml-dotted-section',
    pattern: /^[ \t]*\[[\w-]{1,40}(?:\.[\w-]{1,40})+\][ \t]*$/m,
    scores: { toml: 8, ini: -2 },
  },
  {
    id: 'toml-quoted-value',
    // TOML strings must be quoted; INI values are usually bare
    pattern: /^[ \t]*[\w.-]{1,60}\s*=\s*"[^"\n]{0,120}"[ \t]*$/m,
    scores: { toml: 7, ini: -2 },
  },
  {
    id: 'toml-typed-value',
    pattern: /^[ \t]*[\w.-]{1,60}\s*=\s*(?:true|false|\d{4}-\d{2}-\d{2}|\[|\{)/m,
    scores: { toml: 6, ini: -1 },
  },
  {
    id: 'toml-cargo-pyproject',
    // The most common TOML in agent output is Cargo.toml / pyproject.toml
    pattern: /^[ \t]*\[(?:package|dependencies|dev-dependencies|build-system|tool\.[\w-]+|workspace)\][ \t]*$/m,
    scores: { toml: 10, ini: -3 },
  },
  {
    id: 'ini-semicolon-comment',
    // Semicolon comments are the INI convention; TOML only uses #
    pattern: /^[ \t]*;[^\n]{0,120}$/m,
    // Assembly line comments also start with a semicolon, so the identical form must be split equally;
    // TOML only uses #, hence the counter-evidence for toml
    scores: { ini: 4, asm: 4, toml: -3 },
  },

  // ── Less ────────────────────────────────────────────────────────
  {
    id: 'less-variable',
    // @var: value; the CSS at-rules such as @media/@import have to be excluded,
    // otherwise every @media would count as a Less variable
    pattern:
      /^[ \t]*@(?!media\b|import\b|charset\b|supports\b|keyframes\b|font-face\b|use\b|forward\b|mixin\b|include\b|extend\b|tailwind\b|apply\b)[\w-]{1,40}\s*:\s*[^;\n]{1,120};/m,
    scores: { less: 11, css: -4, scss: -3 },
    definitive: 'less',
  },
  {
    id: 'less-mixin-call',
    pattern: /^[ \t]*[.#][\w-]{1,40}\([^)\n]{0,80}\)\s*;/m,
    scores: { less: 9, css: -3 },
  },
  {
    id: 'less-guard-or-escape',
    pattern: /\bwhen\s*\([^)\n]{1,60}\)\s*\{|~["'][^"'\n]{1,80}["']/,
    scores: { less: 8 },
  },
  {
    id: 'less-extend',
    pattern: /&:extend\(|\.[\w-]{1,40}\s*!important\s*;/,
    scores: { less: 7, scss: -2 },
  },
];

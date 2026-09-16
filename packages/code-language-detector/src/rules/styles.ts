import type { DetectionRule } from '../types';

export const stylesRules: DetectionRule[] = [
  {
    id: 'css-rule-block',
    // A selector plus at least one `property: value;`
    // Three constraints, all of them required:
    //   ^…/m restricts the start to a line start (selectors are written there anyway); otherwise a
    //        20,000-character single line offers 20,000 start positions, each trying every selector length;
    //   {1,60} caps the greedy quantifier;
    //   [^{};] excludes semicolons, so the match cannot cross a declaration boundary.
    pattern:
      /^[ \t]*[.#]?[\w-]{1,60}(?:\s*[>+~]\s*[\w.#-]{1,60})?\s*\{[^{};]{0,200}[\w-]{1,40}\s*:\s*[^;{}\n]{1,120};/m,
    scores: { css: 8, scss: 5 },
  },
  {
    id: 'css-at-rule',
    pattern: /^[ \t]*@(?:media|import|charset|font-face|keyframes|supports)\b/m,
    scores: { css: 7, scss: 4 },
  },
  {
    id: 'css-property-names',
    pattern:
      /^[ \t]*(?:color|background|margin|padding|display|font-size|border-radius|flex|grid-template-columns)\s*:/m,
    scores: { css: 6, scss: 4 },
  },
  {
    id: 'scss-variable',
    pattern: /^[ \t]*\$[\w-]+\s*:\s*[^;\n]{1,120};/m,
    scores: { scss: 10, css: -4 },
  },
  {
    id: 'scss-mixin',
    pattern: /^[ \t]*@(?:mixin|include|extend|use|forward)\b/m,
    scores: { scss: 11, css: -4 },
    definitive: 'scss',
  },
  {
    id: 'scss-parent-selector',
    pattern: /^[ \t]*&[\s.:[&>+~]/m,
    scores: { scss: 9, css: -3 },
  },
];

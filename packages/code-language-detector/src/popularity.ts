import type { LanguageId } from './language';

/**
 * Language popularity, used only to order languages whose **evidence is
 * exactly tied**.
 *
 * The ranked values are the raw shares from the TIOBE Index
 * (https://www.tiobe.com/tiobe-index/, retrieved 2026-09). For ties between
 * lookalike languages they point the right way:
 *   JavaScript 2.76 > TypeScript 0.43  → without type evidence, javascript; the more conservative choice
 *   C 10.28 > C++ 8.67                 → a bare #include is c
 *   Java 7.54 > Kotlin 0.67            → a lone class keyword is java
 *
 * Mind the limits: TIOBE counts search engine results, which differ a lot from
 * the distribution of code fences in agent output. TypeScript ranks below
 * Visual Basic on TIOBE, and bash / JSON / YAML / HTML, the most common formats
 * in code fences, are not ranked at all.
 *
 * The 18 unranked languages (markup, configuration, stylesheets, SFCs, shell)
 * therefore use **values estimated from how common they are in code fences**,
 * not TIOBE data; they are listed separately below. These values only affect
 * ties: changing them cannot change any verdict that has evidence behind it.
 */

/** Raw TIOBE Index shares (2026-09) */
const TIOBE: Partial<Record<LanguageId, number>> = {
  python: 17.76,
  c: 10.28,
  cpp: 8.67,
  java: 7.54,
  csharp: 4.22,
  javascript: 2.76,
  vb: 2.55,
  sql: 2.16,
  rust: 1.34,
  go: 1.1,
  php: 1.04,
  asm: 0.89,
  swift: 0.83,
  'objective-c': 0.81,
  julia: 0.74,
  ruby: 0.73,
  kotlin: 0.67,
  matlab: 0.61,
  lua: 0.57,
  powershell: 0.49,
  typescript: 0.43,
  zig: 0.43,
  dart: 0.43,
  scala: 0.39,
};

/**
 * Languages TIOBE does not rank: estimates, not official data.
 * They are based on how often each appears in Markdown code fences (TIOBE does
 * not cover markup, configuration formats or shells), and scaled to the same
 * magnitude as the TIOBE values so the two tables compare directly.
 */
const ESTIMATED: Partial<Record<LanguageId, number>> = {
  bash: 3.0, // one of the most common non-program contents of a code fence
  json: 2.5,
  html: 2.0,
  yaml: 1.5,
  markdown: 1.0,
  css: 1.0,
  xml: 0.8,
  tsx: 0.5, // same magnitude as typescript, slightly above jsx
  jsx: 0.4,
  dockerfile: 0.4,
  scss: 0.35,
  toml: 0.3,
  vue: 0.3,
  ini: 0.25,
  groovy: 0.2,
  less: 0.2,
  svelte: 0.2,
  applescript: 0.05,
};

export const POPULARITY: Readonly<Record<LanguageId, number>> = {
  ...TIOBE,
  ...ESTIMATED,
} as Record<LanguageId, number>;

/**
 * Tie-break comparator: the more popular language sorts first.
 * It must only ever be the **last** sort key, after score and evidence count:
 * its job is "at equal evidence, pick the more common language", not letting a
 * common language outweigh evidence.
 */
export function comparePopularity(a: LanguageId, b: LanguageId): number {
  return (POPULARITY[b] ?? 0) - (POPULARITY[a] ?? 0);
}

import type { CodeLanguage, LanguageId } from './language';

/**
 * The Shiki language id for a detected language.
 *
 * Every `CodeLanguage` value already is a Shiki language id, so this is the
 * identity; it exists so call sites state which highlighter they target.
 * Whether the language is available still depends on what the highlighter
 * instance has loaded.
 */
export function toShikiLanguage(language: CodeLanguage): string {
  return language;
}

/** highlight.js names that differ from the `CodeLanguage` value. */
const HIGHLIGHT_JS_NAMES: Partial<Record<LanguageId, string>> = {
  'objective-c': 'objectivec',
  vb: 'vbnet',
  asm: 'x86asm',
  // highlight.js has no separate HTML grammar: `html` is an alias of `xml`.
  html: 'xml',
  // highlight.js has no Vue or Svelte grammar. Its `xml` grammar highlights
  // `<script>` content as JavaScript and `<style>` content as CSS
  // sub-languages, so a single-file component comes out right. `javascript`
  // would mangle the `<template>` markup.
  vue: 'xml',
  svelte: 'xml',
  // highlight.js registers `jsx` / `tsx` as aliases of these grammars; the
  // names are spelled out so the result does not depend on alias registration.
  jsx: 'javascript',
  tsx: 'typescript',
};

/**
 * The highlight.js language name for a detected language.
 *
 * Differs from the `CodeLanguage` value for `objective-c` (`objectivec`), `vb`
 * (`vbnet`), `asm` (`x86asm`), `jsx` / `tsx` (`javascript` / `typescript`), and
 * `html`, `vue` and `svelte`, which all map to `xml`: highlight.js has no Vue or
 * Svelte grammar, and its `xml` grammar highlights `<script>` and `<style>`
 * blocks as JavaScript and CSS sub-languages, which renders a single-file
 * component correctly where `javascript` would mangle its template.
 *
 * `zig` maps to `zig` even though highlight.js ships no Zig grammar: third-party
 * grammar packages register it under that name. Look the name up with
 * `hljs.getLanguage(name)` before highlighting, and fall back to plain text when
 * the grammar is not registered.
 */
export function toHighlightJsLanguage(language: CodeLanguage): string {
  return HIGHLIGHT_JS_NAMES[language] ?? language;
}

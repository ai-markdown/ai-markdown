import type { LanguageId } from './language';

/**
 * Language families: confusion within a family barely affects highlighting.
 *
 * The concept is used in two places:
 *   - The stability standard for streaming: a refinement within a family such
 *     as typescript → tsx is the normal result of growing evidence and does not
 *     count as a verdict flip; Swift detected as Python, across families, does.
 *   - The loose metric of the benchmarks: a slice of a .ts file without type
 *     annotations detected as javascript is correct behaviour given the
 *     evidence.
 */
export const LANGUAGE_FAMILIES: readonly (readonly LanguageId[])[] = [
  ['javascript', 'typescript', 'jsx', 'tsx'],
  ['c', 'cpp', 'objective-c'],
  // Vue / Svelte single-file components are an HTML shell, so detecting one as
  // html does not wreck the highlighting.
  ['html', 'xml', 'vue', 'svelte'],
  ['css', 'scss', 'less'],
  ['json', 'yaml', 'toml', 'ini'],
  ['bash', 'powershell'],
  ['java', 'kotlin', 'groovy', 'scala'],
  // Both are array-first scientific computing languages with a very similar
  // surface syntax.
  ['matlab', 'julia'],
];

/** Whether two languages belong to the same family; a language is in its own family */
export function sameFamily(a: LanguageId, b: LanguageId): boolean {
  if (a === b) return true;
  return LANGUAGE_FAMILIES.some((family) => family.includes(a) && family.includes(b));
}

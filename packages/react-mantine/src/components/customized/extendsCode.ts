/** Exact prefix equality. On V8, string equality can compare contiguous
 * ranges much faster than startsWith's character loop. Still O(prefix):
 * full-string inputs cannot prove arbitrary replacements in constant time. */
export function extendsCode(next: string, previous: string): boolean {
  return next.length >= previous.length && next.slice(0, previous.length) === previous;
}

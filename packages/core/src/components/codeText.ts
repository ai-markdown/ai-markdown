/** hast code text ends with one newline that the Markdown source does not
 * have, so a mid-line append turns `ab\n` into `abc\n` and a plain prefix
 * test reports a replacement. These helpers work on the text without it. */
export function codeBody(code: string): string {
  return code.endsWith('\n') ? code.slice(0, -1) : code;
}

/** While a document streams, an unlabelled block whose text has been still
 * this long is judged as complete. The streaming flag describes the document
 * and does not say when one fence has closed. */
export const CODE_LANGUAGE_SETTLE_MS = 300;

/** Exact prefix test. On V8, string equality compares contiguous ranges much
 * faster than startsWith's character loop. It is still O(prefix): full-string
 * inputs cannot prove an arbitrary replacement in constant time. */
export function startsWithText(text: string, prefix: string): boolean {
  return text.length >= prefix.length && text.slice(0, prefix.length) === prefix;
}

/** Whether `next` is `previous` with nothing or more appended. */
export function extendsCode(next: string, previous: string): boolean {
  return startsWithText(next, codeBody(previous));
}

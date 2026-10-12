import { codeBody, startsWithText } from './codeText';

/** Bracket-balance gate, not a JSON validator. Retain quote/escape state
 * across append seams so growing JSON does not rescan its whole body when
 * each nested object closes. Replacements start a fresh lineage. The final
 * newline of hast code text is left unscanned: it is whitespace, and it moves
 * on every append. */
export function createJsonCompletenessScanner() {
  let previous = '';
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let invalid = false;
  let last = '';
  return (text: string): boolean => {
    const body = codeBody(text);
    let from = previous.length;
    if (!startsWithText(body, previous)) {
      from = 0;
      depth = 0;
      quoted = escaped = invalid = false;
      last = '';
    }
    previous = body;
    for (let i = from; i < body.length; i++) {
      const c = body[i];
      if (!/\s/.test(c)) last = c;
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') {
        depth--;
        if (depth < 0) invalid = true;
      }
    }
    return !invalid && !quoted && depth === 0 && (last === '}' || last === ']');
  };
}

export function jsonLooksComplete(text: string): boolean {
  return createJsonCompletenessScanner()(text);
}

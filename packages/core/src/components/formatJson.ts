/** Validate with the native parser, but format lexical tokens so numbers,
 * duplicate keys and key order never pass through JavaScript's value model.
 * Nested JSON expansion is optional and only applies to string values. */
export function prettyPrintJson(text: string, expandNested = true): string {
  try {
    return format(text, expandNested, 0);
  } catch {
    return text;
  }
}

function format(text: string, expandNested: boolean, baseIndent: number): string {
  JSON.parse(text);
  const tokens =
    text.match(/"(?:\\[\s\S]|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}[\],:]/g) ?? [];
  const out: string[] = [];
  let indent = baseIndent;
  const newline = () => out.push('\n', '  '.repeat(indent));
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '{' || token === '[') {
      out.push(token);
      if (tokens[i + 1] !== (token === '{' ? '}' : ']')) {
        indent++;
        newline();
      }
    } else if (token === '}' || token === ']') {
      if (tokens[i - 1] !== (token === '}' ? '{' : '[')) {
        indent--;
        newline();
      }
      out.push(token);
    } else if (token === ',') {
      out.push(',');
      newline();
    } else if (token === ':') {
      out.push(': ');
    } else if (token.startsWith('"')) {
      const value = JSON.parse(token) as string;
      const trimmed = value.trim();
      if (expandNested && tokens[i + 1] !== ':' && /^[{[]/.test(trimmed) && indent < 100) {
        try {
          out.push(format(trimmed, true, indent));
          continue;
        } catch {
          /* Keep non-JSON strings. */
        }
      }
      out.push(JSON.stringify(value));
    } else {
      out.push(token);
    }
  }
  return out.join('');
}

import { describe, expect, test } from 'vitest';
import { createJsonCompletenessScanner, jsonLooksComplete } from './jsonCompleteness';

// Independent full-scan oracle, including a terminal escape at a frame seam.
function fullScan(text: string) {
  if (!/[}\]]\s*$/.test(text)) return false;
  let depth = 0,
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '\\') i++;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      if (--depth < 0) return false;
    }
  }
  return depth === 0 && !quoted;
}

test('append and replacement frames match the full-scan oracle', () => {
  const scan = createJsonCompletenessScanner();
  const sources = [
    JSON.stringify({ a: 'escaped"}', b: [{ c: 1 }] }),
    '[]',
    '',
    '][',
    JSON.stringify({ x: String.fromCharCode(92) }),
    '{}\u00a0',
  ];
  let seed = 42;
  const alphabet = '{}[]"\\ \n:x';
  for (let n = 0; n < 100; n++) {
    let text = '';
    for (let i = 0; i < 80; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      text += alphabet[seed % alphabet.length];
    }
    sources.push(text);
  }
  for (const source of sources) {
    for (let i = 0; i <= source.length; i++) {
      const text = source.slice(0, i);
      expect(scan(text), JSON.stringify(text)).toBe(fullScan(text));
    }
  }
});

describe('jsonLooksComplete, the pretty-print gate', () => {
  test('balanced values pass', () => {
    expect(jsonLooksComplete('{"a":{"b":1}}')).toBe(true);
    expect(jsonLooksComplete('[1, [2, 3]]\n')).toBe(true);
    expect(jsonLooksComplete('{\n  "a": {\n    "b": 1\n  }\n}')).toBe(true);
  });
  test('an in-progress pretty-printed prefix ending on a closing bracket does not pass', () => {
    expect(jsonLooksComplete('{\n  "a": {\n    "b": 1\n  }')).toBe(false);
    expect(jsonLooksComplete('{\n  "items": [\n    {"x": 1}')).toBe(false);
  });
  test('brackets inside strings are ignored; unterminated strings fail', () => {
    expect(jsonLooksComplete('{"a": "}"}')).toBe(true);
    expect(jsonLooksComplete('{"a": "\\"}"}')).toBe(true);
    expect(jsonLooksComplete('{"a": "}')).toBe(false);
  });
  test('shapes without a closing bracket at the end never pass', () => {
    expect(jsonLooksComplete('{"a": 1')).toBe(false);
    expect(jsonLooksComplete('42')).toBe(false);
    expect(jsonLooksComplete('')).toBe(false);
  });
});

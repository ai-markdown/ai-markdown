// Edges of `prettyPrintJson`: input that is not JSON, nesting of strings
// that hold JSON, the `expandNested` switch and the indent guard.
import { describe, expect, test } from 'vitest';
import { prettyPrintJson } from './formatJson';

describe('malformed input', () => {
  test.each([
    '',
    ' ',
    '{',
    '[1,',
    'nope',
    '{"a":}',
    '"unterminated',
    '{"a":1}}',
    '{"a":1} {"b":2}',
    '['.repeat(50),
    ']'.repeat(50),
    '{"a":"\\u12"}',
    'NaN',
    '{a:1}',
    "{'a':1}",
    String.fromCharCode(0),
  ])('returns %j unchanged instead of throwing', (input) => {
    expect(prettyPrintJson(input)).toBe(input);
    expect(prettyPrintJson(input, false)).toBe(input);
  });
});

describe('nested strings', () => {
  /** `depth` levels of JSON-in-a-string around an innermost object. */
  const nest = (depth: number) => {
    let inner = '{"leaf":9007199254740993}';
    for (let i = 0; i < depth; i++) inner = JSON.stringify({ [`level${depth - i}`]: inner });
    return inner;
  };
  test('every level of a deeply nested string expands, each one indented one step further', () => {
    const out = prettyPrintJson(nest(5));
    expect(out).toContain(
      '"level1": {\n    "level2": {\n      "level3": {\n        "level4": {\n          "level5": {'
    );
    expect(out).toContain('            "leaf": 9007199254740993');
    expect(out).not.toContain('\\"');
    // The expansion is text-level: the big integer is not rounded.
    expect(out).not.toContain('9007199254740992');
  });
  test('expandNested false keeps every string value as the literal the model wrote', () => {
    const input = nest(3);
    const out = prettyPrintJson(input, false);
    expect(out).toBe(`{\n  "level1": ${JSON.stringify(JSON.parse(input).level1)}\n}`);
    expect(out).toContain('\\"');
    // Only string values are candidates: a key that looks like JSON is
    // never expanded, and neither is a string that only starts like JSON.
    expect(prettyPrintJson('{"{\\"k\\":1}":"[1]"}')).toBe('{\n  "{\\"k\\":1}": [\n    1\n  ]\n}');
    expect(prettyPrintJson('{"a":"{not json"}')).toBe('{\n  "a": "{not json"\n}');
    expect(prettyPrintJson('{"a":"  [1, 2]  "}')).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
  });
  test('an empty or primitive-looking string stays a string either way', () => {
    for (const expand of [true, false]) {
      expect(prettyPrintJson('{"a":"","b":"true","c":"12","d":"null","e":" "}', expand)).toBe(
        '{\n  "a": "",\n  "b": "true",\n  "c": "12",\n  "d": "null",\n  "e": " "\n}'
      );
    }
  });
});

describe('indent bounds', () => {
  const arrays = (depth: number, inner: string) => '['.repeat(depth) + inner + ']'.repeat(depth);
  test('deep structural nesting formats with two spaces per level', () => {
    const out = prettyPrintJson(arrays(120, '1'));
    expect(out.split('\n')).toHaveLength(241);
    expect(out).toContain('\n' + '  '.repeat(120) + '1\n');
    expect(JSON.parse(out)).toEqual(JSON.parse(arrays(120, '1')));
  });
  test('a nested string is expanded below indent 100 and left alone at or above it', () => {
    const literal = JSON.stringify('{"a":1}');
    const below = prettyPrintJson(arrays(99, literal));
    expect(below).toContain('"a": 1');
    expect(below).not.toContain('\\"');
    const at = prettyPrintJson(arrays(100, literal));
    expect(at).toContain(literal);
    expect(at).not.toContain('"a": 1');
    expect(JSON.parse(at)).toEqual(JSON.parse(arrays(100, literal)));
  });
  test('empty containers stay on one line at every depth', () => {
    expect(prettyPrintJson('{"a":{},"b":[],"c":[{}],"d":{"e":[[]]}}')).toBe(
      '{\n  "a": {},\n  "b": [],\n  "c": [\n    {}\n  ],\n  "d": {\n    "e": [\n      []\n    ]\n  }\n}'
    );
  });
});

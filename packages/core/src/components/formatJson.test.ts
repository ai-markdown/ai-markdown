import { expect, test } from 'vitest';
import { prettyPrintJson } from './formatJson';

test('formats lexical numbers without rounding, reordering or dropping duplicate keys', () => {
  expect(prettyPrintJson('{"9":9007199254740993,"1":1e400,"9":-0,"d":0.1234567890123456789}')).toBe(
    '{\n  "9": 9007199254740993,\n  "1": 1e400,\n  "9": -0,\n  "d": 0.1234567890123456789\n}'
  );
});

test('expands nested JSON optionally and preserves numbers inside it', () => {
  const input = '{"data":"{\\"id\\":9007199254740993}","flag":"true"}';
  expect(prettyPrintJson(input)).toBe('{\n  "data": {\n    "id": 9007199254740993\n  },\n  "flag": "true"\n}');
  expect(prettyPrintJson(input, false)).toContain('"data": "{\\"id\\":9007199254740993}"');
  expect(prettyPrintJson('{"bad":')).toBe('{"bad":');
  expect(prettyPrintJson('{"empty":[],"object":{},"string":"{invalid}"}')).toContain('"empty": []');
});

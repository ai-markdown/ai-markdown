import { afterEach, describe, expect, test, vi } from 'vitest';
import { codeBody, extendsCode } from './codeText';
import { createCodeFrame, nextCodeFrame } from './codeFrame';
import { createJsonCompletenessScanner, jsonLooksComplete } from './jsonCompleteness';

afterEach(() => vi.useRealTimers());

// hast code text always ends with a newline. Every frame below has that shape.
describe('append detection on hast code text', () => {
  test('a mid-line append extends the previous text; a rewrite does not', () => {
    expect(codeBody('ab\n')).toBe('ab');
    expect(codeBody('ab')).toBe('ab');
    expect(codeBody('ab\n\n')).toBe('ab\n');
    expect(extendsCode('abc\n', 'ab\n')).toBe(true);
    expect(extendsCode('ab\ncd\n', 'ab\n')).toBe(true);
    expect(extendsCode('ab\n', 'ab\n')).toBe(true);
    expect(extendsCode('abc', 'ab')).toBe(true);
    expect(extendsCode('ax\n', 'ab\n')).toBe(false);
    expect(extendsCode('a\n', 'ab\n')).toBe(false);
    // A blank line in the source is part of the text, not the final newline.
    expect(extendsCode('abc\n', 'ab\n\n')).toBe(false);
  });

  test('the code frame throttles mid-line appends and flushes a rewrite at once', () => {
    vi.useFakeTimers();
    const published: string[] = [];
    let current = nextCodeFrame(undefined, 'a\n', '');
    const frame = createCodeFrame(current, (next) => published.push(next.code));
    const feed = (code: string) => frame.update((current = nextCodeFrame(current, code, '')), true, 50);
    feed('ab\n');
    feed('abc\n');
    expect(published).toEqual([]);
    vi.advanceTimersByTime(50);
    expect(published).toEqual(['abc\n']);
    feed('x\n');
    expect(published).toEqual(['abc\n', 'x\n']);
    frame.dispose();
  });

  test('the JSON scanner gives the same answer as a fresh scan on every appended frame', () => {
    const source = '{"a":"x\\"y\\\\","b":[1,{"c":"]}"}],"d":"\\n"}';
    const scan = createJsonCompletenessScanner();
    for (let end = 1; end <= source.length; end++) {
      const frame = `${source.slice(0, end)}\n`;
      expect(scan(frame), `frame of ${end} characters`).toBe(jsonLooksComplete(frame));
    }
    expect(scan(`${source}\n`)).toBe(true);
    // A rewrite starts over.
    expect(scan('[1,2\n')).toBe(false);
    expect(scan('[1,2]\n')).toBe(true);
  });
});

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createCodeBlockSession, type CodeBlockInput } from './codeBlock';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const base: CodeBlockInput = {
  code: '',
  language: 'js',
  streaming: true,
  autoDetect: true,
  formatJson: false,
  expandNestedJson: false,
  highlightIntervalMs: 50,
};
/** A host: reads, then commits what it read, as a render followed by its effect. */
function host(defaults: Partial<CodeBlockInput> = {}) {
  let changes = 0;
  const session = createCodeBlockSession(() => changes++);
  let input = { ...base, ...defaults };
  const read = (next: Partial<CodeBlockInput> = {}) => session.read((input = { ...input, ...next }));
  const show = (next: Partial<CodeBlockInput> = {}) => {
    const snapshot = read(next);
    session.commit(input);
    return snapshot;
  };
  return { session, read, show, again: () => session.read(input), changes: () => changes };
}

const PYTHON = ['import os', 'import sys', '', 'def main(argv):', '    for path in argv:', '        print(path)'].join(
  '\n'
);

describe('generation', () => {
  test('an append keeps it; a rewrite, another language and another identity advance it', () => {
    const block = host({ code: 'ab\n', identity: 'one' });
    expect(block.show().generation).toBe(0);
    // hast text ends with a newline, so a mid-line append is not a plain prefix.
    expect(block.show({ code: 'abc\n' }).generation).toBe(0);
    expect(block.show({ code: 'abc\ndef\n' }).generation).toBe(0);
    expect(block.show({ code: 'x\n' }).generation).toBe(1);
    expect(block.show({ language: 'ts' }).generation).toBe(2);
    expect(block.show({ identity: 'two' }).generation).toBe(3);
    expect(block.show({ code: 'x\ny\n' }).generation).toBe(3);
  });

  test('a read that is never committed does not move it', () => {
    const block = host({ code: 'ab\n' });
    block.show();
    expect(block.read({ code: 'rewritten\n' }).generation).toBe(1);
    expect(block.read({ code: 'again\n' }).generation).toBe(1);
    // The abandoned reads are gone: the next append continues generation 0.
    expect(block.show({ code: 'abc\n' }).generation).toBe(0);
  });

  test('equal input reads equal output, before and after a commit', () => {
    const block = host({ code: '{"a":1}\n', language: 'json', formatJson: true, streaming: false });
    const first = block.read();
    expect(block.again()).toEqual(first);
    block.show();
    expect(block.again()).toEqual(first);
  });
});

describe('displayed text', () => {
  test('a host that never commits always reads the current text', () => {
    const block = host({ code: 'a\n' });
    expect(block.read().text).toBe('a\n');
    expect(block.read({ code: 'ab\n' }).text).toBe('ab\n');
    expect(vi.getTimerCount()).toBe(0);
  });

  test('streamed appends share one frame per interval, measured from the first pending append', () => {
    const block = host({ code: 'a\n' });
    expect(block.show().text).toBe('a\n');
    expect(block.show({ code: 'ab\n' }).text).toBe('a\n');
    vi.advanceTimersByTime(10);
    expect(block.show({ code: 'abc\n' }).text).toBe('a\n');
    expect(block.changes()).toBe(0);
    vi.advanceTimersByTime(39);
    expect(block.again().text).toBe('a\n');
    vi.advanceTimersByTime(1);
    expect(block.changes()).toBe(1);
    expect(block.again().text).toBe('abc\n');
    expect(vi.getTimerCount()).toBe(0);
  });

  test('a rewrite, a language change, a static update and the end of the stream show at once', () => {
    const block = host({ code: 'abc\n' });
    block.show();
    expect(block.show({ code: 'abcd\n' }).text).toBe('abc\n');
    expect(block.show({ code: 'abX\n' }).text).toBe('abX\n');
    expect(vi.getTimerCount()).toBe(0);
    expect(block.show({ code: 'abXY\n' }).text).toBe('abX\n');
    expect(block.show({ language: 'python' }).text).toBe('abXY\n');
    expect(block.show({ code: 'abXYZ\n' }).text).toBe('abXY\n');
    expect(block.show({ code: 'abXYZ!\n', streaming: false }).text).toBe('abXYZ!\n');
    expect(vi.getTimerCount()).toBe(0);
    // None of these needed a second read: the first one already had the text.
    expect(block.changes()).toBe(0);
    vi.advanceTimersByTime(200);
    expect(block.changes()).toBe(0);
  });

  test('a zero interval shows every update with no timer', () => {
    const block = host({ code: 'a\n', highlightIntervalMs: 0 });
    block.show();
    expect(block.show({ code: 'ab\n' }).text).toBe('ab\n');
    expect(vi.getTimerCount()).toBe(0);
  });

  test('the same text under a new identity is throttled again afterwards', () => {
    const block = host({ code: 'a\n', identity: 'one' });
    block.show();
    expect(block.show({ identity: 'two' }).text).toBe('a\n');
    expect(block.show({ code: 'ab\n' }).text).toBe('a\n');
    vi.advanceTimersByTime(50);
    expect(block.again().text).toBe('ab\n');
  });

  test('dispose cancels the pending frame, and a later commit schedules it again', () => {
    const block = host({ code: 'a\n' });
    block.show();
    block.show({ code: 'ab\n' });
    expect(vi.getTimerCount()).toBe(1);
    block.session.dispose();
    expect(vi.getTimerCount()).toBe(0);
    block.show();
    vi.advanceTimersByTime(50);
    expect(block.again().text).toBe('ab\n');
  });
});

describe('language', () => {
  test('the fence language wins and nothing is detected', () => {
    const block = host({ code: `${PYTHON}\n`, language: 'text', streaming: false });
    expect(block.show().language).toBe('text');
    expect(vi.getTimerCount()).toBe(0);
  });

  test('an unlabelled block is detected; with detection off it stays empty', () => {
    expect(host({ code: `${PYTHON}\n`, language: '', streaming: false }).show().language).toBe('python');
    expect(host({ code: `${PYTHON}\n`, language: '', streaming: false, autoDetect: false }).show().language).toBe('');
  });

  // Streams the block four characters at a time; the detector looks once early and not again in so short a text.
  const SHORT = 'def add(a, b):\n    return a + b\n\nprint(add(1, 2))\n';
  const streamShort = (block: ReturnType<typeof host>) => {
    let last = block.show({ code: `${SHORT.slice(0, 4)}\n`, language: '' });
    for (let end = 8; end < SHORT.length + 4; end += 4) {
      last = block.show({ code: `${SHORT.slice(0, Math.min(end, SHORT.length - 1))}\n` });
      vi.advanceTimersByTime(60);
    }
    return last;
  };

  test('a short streaming block is labelled once its text has been still', () => {
    const block = host({ language: '' });
    expect(streamShort(block).language).toBe('');
    const before = block.changes();
    vi.advanceTimersByTime(300);
    expect(block.changes()).toBe(before + 1);
    expect(block.again().language).toBe('python');
  });

  test('a language that settles mid-stream shows the current text at once', () => {
    const block = host({ language: '', highlightIntervalMs: 5000 });
    streamShort(block);
    // The throttle is still holding an older frame.
    expect(block.again().text).not.toBe(SHORT);
    vi.advanceTimersByTime(300);
    const settled = block.again();
    expect(settled.language).toBe('python');
    expect(settled.text).toBe(SHORT);
  });
});

describe('a read that is never committed', () => {
  // A lineage whose streamed verdict differs from what a fresh look at the whole text says:
  // it settles on JavaScript early, and the TypeScript that follows does not move it.
  const JS =
    "const fs = require('fs');\nfunction load(file) {\n  return fs.readFileSync(file, 'utf8');\n}\nmodule.exports = { load };\n";
  const TS =
    'export interface Options {\n  readonly path: string;\n  retries?: number;\n}\nexport type Loader = (o: Options) => Promise<string>;\n';
  const FULL = JS + JS + TS + TS;
  const streamed = () => {
    const block = host({ language: '' });
    for (let end = 4; end < FULL.length + 4; end += 4) block.show({ code: FULL.slice(0, Math.min(end, FULL.length)) });
    return block;
  };
  const next = (block: ReturnType<typeof host>) => block.show({ code: `${FULL}// end\n` }).language;

  test('leaves the language verdict of the committed text alone', () => {
    const control = streamed();
    const verdict = control.again().language;
    expect(verdict).not.toBe('');

    const rewritten = streamed();
    rewritten.session.read({ ...base, language: '', code: 'SELECT id, name FROM users WHERE id = 1;\n' });
    expect(rewritten.again().language).toBe(verdict);

    const older = streamed();
    older.session.read({ ...base, language: '', code: FULL.slice(0, -8) });
    expect(older.again().language).toBe(verdict);

    // The lineages continue identically.
    const expected = next(control);
    expect(next(rewritten)).toBe(expected);
    expect(next(older)).toBe(expected);
  });

  test('gets the verdict of its own text, not the committed one', () => {
    const block = streamed();
    const other = block.session.read({
      ...base,
      language: '',
      streaming: false,
      code: 'SELECT id, name FROM users WHERE id = 1;\n',
    });
    expect(other.language).toBe('sql');
    expect(other.generation).toBe(1);
  });
});

describe('a verdict that moves when the text is committed', () => {
  test('is reported through onChange, and the next read has it', () => {
    const block = host({ language: '', code: 'x\n' });
    block.show();
    const before = block.changes();
    // The read is ahead of the detector, which has only seen the committed text.
    expect(block.show({ code: `x\n${PYTHON}\n`, streaming: false }).language).toBe('');
    expect(block.changes()).toBe(before + 1);
    expect(block.again().language).toBe('python');
  });
});

describe('JSON', () => {
  const json = { language: 'json', formatJson: true };

  test('a static block is pretty-printed; with the option off it is left alone', () => {
    expect(host({ ...json, code: '{"a":1}\n', streaming: false }).show().text).toBe('{\n  "a": 1\n}');
    expect(host({ ...json, formatJson: false, code: '{"a":1}\n', streaming: false }).show().text).toBe('{"a":1}\n');
  });

  test('a streaming block is pretty-printed as soon as the displayed text is balanced', () => {
    const block = host({ ...json, code: '{"a":[1,\n', highlightIntervalMs: 0 });
    expect(block.show().text).toBe('{"a":[1,\n');
    expect(block.show({ code: '{"a":[1,2]\n' }).text).toBe('{"a":[1,2]\n');
    expect(block.show({ code: '{"a":[1,2]}\n' }).text).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
  });

  test('formatting follows the throttled frame, not the latest text', () => {
    const block = host({ ...json, code: '{"a":1\n' });
    block.show();
    expect(block.show({ code: '{"a":1}\n' }).text).toBe('{"a":1\n');
    vi.advanceTimersByTime(50);
    expect(block.again().text).toBe('{\n  "a": 1\n}');
  });

  test('an unlabelled block detected as JSON is formatted too', () => {
    const code = `${JSON.stringify({ name: 'demo', version: '1.0.0', private: true, scripts: { build: 'tsc' } })}\n`;
    const block = host({ code, language: '', formatJson: true, streaming: false });
    const snapshot = block.show();
    expect(snapshot.language).toBe('json');
    expect(snapshot.text).toContain('\n  "name": "demo"');
  });
});

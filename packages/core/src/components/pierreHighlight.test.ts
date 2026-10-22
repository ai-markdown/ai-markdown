import { describe, expect, it, vi } from 'vitest';
import { createPierreHighlightAdapter } from './pierreHighlight';
import { CodeLanguageFormat, createCodeHighlightSession, resolveCodeHighlightLanguage } from './codeHighlight';

const request = { code: '😀\r\nconst 中文 = 1;\r\n\r\n', language: 'typescript', colorScheme: 'light' as const };
function runtime() {
  return {
    isSupportedLanguage: (language: string) => language === 'typescript',
    themes: { light: 'light-theme', dark: 'dark-theme' },
    codeToTokens: vi.fn(() => ({
      fg: '#123456',
      tokens: [
        [{ content: '😀', offset: 0 }],
        [{ content: 'const 中文 = 1;', offset: 4, color: '#abcdef', bgColor: '#ffffff', fontStyle: 3 }],
      ],
    })),
  };
}
describe('Pierre highlight adapter', () => {
  it('preserves language dialects and maps aliases without highlight.js degradation', () => {
    for (const name of ['tsx', 'jsx', 'vue', 'svelte'])
      expect(resolveCodeHighlightLanguage(name, CodeLanguageFormat.Pierre)).toBe(name);
    expect(resolveCodeHighlightLanguage('objc', CodeLanguageFormat.Pierre)).toBe('objective-c');
    expect(resolveCodeHighlightLanguage('common-lisp', CodeLanguageFormat.Pierre)).toBe('lisp');
  });
  it('loads once across blocks and themes, preserves UTF-16 source gaps and token styles', async () => {
    const engine = runtime();
    const load = vi.fn(async () => engine);
    const adapter = createPierreHighlightAdapter({ load });
    expect(load).not.toHaveBeenCalled();
    expect(adapter.supports?.('text')).toBe(false);
    await Promise.all([adapter.prepare?.(request), adapter.prepare?.({ ...request, colorScheme: 'dark' })]);
    expect(load).toHaveBeenCalledTimes(1);
    const result = adapter.highlight(request);
    expect(result && 'tokens' in result && result.tokens.map((token) => token.text).join('')).toBe(request.code);
    expect(result && 'tokens' in result && result.tokens[2]).toMatchObject({
      color: '#abcdef',
      backgroundColor: '#ffffff',
      fontStyle: 3,
    });
    adapter.highlight({ ...request, colorScheme: 'dark' });
    expect(engine.codeToTokens).toHaveBeenLastCalledWith(request.code, { lang: 'typescript', theme: 'dark-theme' });
    expect(adapter.supports?.('unknown')).toBe(false);
    expect(adapter.highlight({ ...request, language: 'unknown' })).toBeUndefined();
  });
  it('allows retry after a rejected load', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(runtime());
    const adapter = createPierreHighlightAdapter({ load });
    await expect(adapter.prepare?.(request)).rejects.toThrow('network');
    expect(adapter.isReady?.(request)).toBe(false);
    await adapter.prepare?.(request);
    expect(adapter.isReady?.(request)).toBe(true);
  });
});

it('uses incremental edits only while streaming and releases WASM on finish', async () => {
  const disposed = vi.fn(),
    edits = vi.fn();
  let constructions = 0;
  class Live {
    lineCount = 1;
    text: string;
    constructor({ code }: { code: string }) {
      this.text = code;
      constructions++;
    }
    getLineLength() {
      return this.text.length;
    }
    getLineTokens() {
      return { tokens: [{ content: this.text, offset: 0 }] };
    }
    applyEdits(changes: readonly { newText: string }[]) {
      edits(changes);
      this.text += changes[0].newText;
      return { lineChanges: [{ oldStartLine: 0, oldEndLine: 1, newStartLine: 0, newEndLine: 1 }] };
    }
    dispose = disposed;
  }
  const engine = { ...runtime(), LiveTokenizer: Live };
  const adapter = createPierreHighlightAdapter({ load: async () => engine });
  await adapter.prepare?.(request);
  const backend = adapter.createSession!();
  backend.highlight({ ...request, code: 'a', streaming: false });
  expect(constructions).toBe(0);
  backend.highlight({ ...request, code: 'a', streaming: true });
  backend.highlight({ ...request, code: 'abc', streaming: true });
  expect(constructions).toBe(1);
  expect(edits).toHaveBeenLastCalledWith([
    { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 1 } }, newText: 'bc' },
  ]);
  backend.highlight({ ...request, code: 'abc', streaming: false });
  expect(disposed).toHaveBeenCalledTimes(1);
  backend.dispose();
  expect(disposed).toHaveBeenCalledTimes(1);
  const full = createPierreHighlightAdapter({ load: async () => engine, incremental: false });
  expect(full.createSession).toBeUndefined();
});

it.each(['\n', '\r\n'])('keeps one native instance for Markdown frames ending with %j', async (newline) => {
  const constructed = vi.fn(),
    edits = vi.fn();
  class Live {
    code: string;
    constructor({ code }: { code: string }) {
      this.code = code;
      constructed();
    }
    get lines() {
      return this.code.split(/\r\n|\r|\n/);
    }
    get lineCount() {
      return this.lines.length;
    }
    getLineLength(line: number) {
      return this.lines[line].length;
    }
    getLineTokens(line: number) {
      return { tokens: [{ content: this.lines[line], offset: 0 }] };
    }
    applyEdits(
      changes: readonly {
        range: { start: { line: number; character: number }; end: { line: number; character: number } };
        newText: string;
      }[]
    ) {
      edits(changes);
      const oldEndLine = this.lineCount;
      const starts = [0];
      for (const match of this.code.matchAll(/\r\n|\r|\n/g)) starts.push(match.index! + match[0].length);
      const { range, newText } = changes[0];
      this.code =
        this.code.slice(0, starts[range.start.line] + range.start.character) +
        newText +
        this.code.slice(starts[range.end.line] + range.end.character);
      return { lineChanges: [{ oldStartLine: 0, oldEndLine, newStartLine: 0, newEndLine: this.lineCount }] };
    }
    dispose() {}
  }
  const adapter = createPierreHighlightAdapter({ load: async () => ({ ...runtime(), LiveTokenizer: Live }) });
  await adapter.prepare?.(request);
  const backend = adapter.createSession!();
  for (const body of ['a', 'ab', `ab${newline}c`, `ab${newline}cd`]) {
    const code = body + newline;
    const result = backend.highlight({ ...request, code, streaming: true });
    expect(result && 'tokens' in result && result.tokens.map((token) => token.text).join('')).toBe(code);
  }
  expect(constructed).toHaveBeenCalledTimes(1);
  expect(edits).toHaveBeenCalledTimes(3);
  expect(edits.mock.calls[0][0][0].newText).toBe('b' + newline);
  expect(edits.mock.calls[2][0][0].range.start).toEqual({ line: 1, character: 1 });
  backend.dispose();
});

it('does not download WASM while an unfenced language remains undetected', async () => {
  const load = vi.fn(async () => runtime());
  const adapter = createPierreHighlightAdapter({ load });
  const session = createCodeHighlightSession(() => {});
  const input = { adapter, code: 'some plain prose', language: '', colorScheme: 'light' as const, generation: 0 };
  session.commit(input);
  await Promise.resolve();
  expect(load).not.toHaveBeenCalled();
  expect(session.read(input).status).toBe('plain');
  session.dispose();
});

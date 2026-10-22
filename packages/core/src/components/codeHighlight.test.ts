import { describe, expect, test, vi } from 'vitest';
import {
  CodeLanguageFormat,
  createCodeHighlightSession,
  resolveCodeHighlightLanguage,
  type CodeHighlightAdapter,
  type CodeHighlightInput,
} from './codeHighlight';
const input = (adapter?: CodeHighlightAdapter, rest: Partial<CodeHighlightInput> = {}): CodeHighlightInput => ({
  adapter,
  code: '<Widget />',
  language: 'tsx',
  colorScheme: 'light',
  generation: 0,
  ...rest,
});
const tick = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};
describe('shared highlighter contract', () => {
  test.each([
    ['tsx', 'typescript', 'tsx'],
    ['jsx', 'javascript', 'jsx'],
    ['vue', 'xml', 'vue'],
    ['svelte', 'xml', 'svelte'],
    ['objc', 'objectivec', 'objective-c'],
    ['txt', 'plaintext', 'text'],
  ])('preserves %s until the target is chosen', (name, hljs, shiki) => {
    expect(resolveCodeHighlightLanguage(name)).toBe(hljs);
    expect(resolveCodeHighlightLanguage(name, CodeLanguageFormat.Shiki)).toBe(shiki);
  });
  test('sync engines work on the server; identical frames are cached and theme/generation invalidate', () => {
    const highlight = vi.fn(({ code }) => ({ tokens: [{ text: code }] }));
    const adapter = { languageFormat: CodeLanguageFormat.Shiki, highlight };
    const session = createCodeHighlightSession(vi.fn());
    expect(session.read(input(adapter)).status).toBe('ready');
    session.read(input(adapter));
    expect(highlight).toHaveBeenCalledTimes(1);
    expect(highlight.mock.calls[0][0].language).toBe('tsx');
    session.read(input(adapter, { colorScheme: 'dark' }));
    session.read(input(adapter, { colorScheme: 'dark', generation: 1 }));
    expect(highlight).toHaveBeenCalledTimes(3);
  });
  test('loading starts on commit only and highlights the latest accumulated text', async () => {
    let done!: () => void;
    const prepare = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          done = resolve;
        })
    );
    const highlight = vi.fn(({ code }) => ({ tokens: [{ text: code }] }));
    const session = createCodeHighlightSession(vi.fn());
    const adapter = { languageFormat: CodeLanguageFormat.Shiki, prepare, highlight };
    expect(session.read(input(adapter)).status).toBe('loading');
    expect(prepare).not.toHaveBeenCalled();
    session.commit(input(adapter));
    await tick();
    session.commit(input(adapter, { code: '<Widget name="latest" />' }));
    done();
    await tick();
    const latest = session.read(input(adapter, { code: '<Widget name="latest" />' }));
    expect(latest.result).toEqual({ tokens: [{ text: '<Widget name="latest" />' }] });
    expect(prepare).toHaveBeenCalledTimes(1);
  });
  test('stale preparations, failures and disposal cannot overwrite another language', async () => {
    const pending: Array<() => void> = [];
    const adapter: CodeHighlightAdapter = {
      languageFormat: CodeLanguageFormat.Shiki,
      prepare: () => new Promise<void>((resolve) => pending.push(resolve)),
      highlight: ({ code }) => ({ tokens: [{ text: code }] }),
    };
    const notify = vi.fn(),
      session = createCodeHighlightSession(notify);
    session.commit(input(adapter));
    await tick();
    session.commit(input(adapter, { language: 'vue' }));
    await tick();
    pending[0]();
    await tick();
    expect(notify).not.toHaveBeenCalled();
    expect(session.read(input(adapter, { language: 'vue' })).status).toBe('loading');
    session.dispose();
    pending[1]();
    await tick();
    expect(notify).not.toHaveBeenCalled();
    session.commit(input(adapter));
    await tick();
    pending[2]();
    await tick();
    expect(session.read(input(adapter)).status).toBe('ready');
  });
  test('failed preparation falls back, does not spin, and can be retried', async () => {
    const prepare = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    const adapter: CodeHighlightAdapter = {
      languageFormat: CodeLanguageFormat.Shiki,
      prepare,
      highlight: ({ code }) => ({ tokens: [{ text: code }] }),
    };
    const session = createCodeHighlightSession(vi.fn());
    session.commit(input(adapter));
    await tick();
    expect(session.read(input(adapter)).status).toBe('error');
    session.commit(input(adapter));
    await tick();
    expect(prepare).toHaveBeenCalledTimes(1);
    session.retry();
    session.commit(input(adapter));
    await tick();
    expect(session.read(input(adapter)).status).toBe('ready');
  });
  test('unsupported languages and disabled adapters remain plaintext', () => {
    const highlight = vi.fn();
    const adapter = { languageFormat: CodeLanguageFormat.Shiki, supports: () => false, highlight };
    const session = createCodeHighlightSession(vi.fn());
    expect(session.read(input(adapter)).status).toBe('plain');
    expect(session.read(input(adapter, { active: false })).status).toBe('plain');
    expect(session.read(input()).status).toBe('plain');
    expect(highlight).not.toHaveBeenCalled();
  });
});

describe('incremental backend ownership', () => {
  test('render/SSR never allocate; commits isolate blocks, cache frames and release on invalidation', () => {
    const instances: { highlight: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[] = [];
    const adapter: CodeHighlightAdapter = {
      languageFormat: CodeLanguageFormat.Pierre,
      highlight: vi.fn(),
      createSession: vi.fn(() => {
        const instance = { highlight: vi.fn(({ code }) => ({ tokens: [{ text: code }] })), dispose: vi.fn() };
        instances.push(instance);
        return instance;
      }),
    };
    const a = createCodeHighlightSession(vi.fn()),
      b = createCodeHighlightSession(vi.fn());
    a.read(input(adapter));
    a.read(input(adapter, { code: 'abandoned' }));
    expect(adapter.createSession).not.toHaveBeenCalled();
    a.commit(input(adapter));
    b.commit(input(adapter, { code: 'other block' }));
    expect(instances).toHaveLength(2);
    expect(a.read(input(adapter)).result).toEqual({ tokens: [{ text: '<Widget />' }] });
    a.commit(input(adapter));
    expect(instances[0].highlight).toHaveBeenCalledTimes(1);
    a.commit(input(adapter, { code: '<Widget />\nnext' }));
    expect(instances[0].highlight).toHaveBeenCalledTimes(2);
    a.commit(input(adapter, { generation: 1 }));
    expect(instances[0].dispose).toHaveBeenCalledTimes(1);
    a.commit(input(adapter, { generation: 1, colorScheme: 'dark' }));
    expect(instances[2].dispose).toHaveBeenCalledTimes(1);
    a.commit(input(adapter, { active: false }));
    expect(instances[3].dispose).toHaveBeenCalledTimes(1);
    b.dispose();
    expect(instances[1].dispose).toHaveBeenCalledTimes(1);
    a.commit(input(adapter)); // React StrictMode effect re-setup
    a.dispose();
    expect(instances[4].dispose).toHaveBeenCalledTimes(1);
    expect(adapter.highlight).not.toHaveBeenCalled();
  });
  test('backend errors are contained without retry loops and retry releases state', () => {
    const dispose = vi.fn();
    const highlight = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('lexer');
      })
      .mockReturnValue({ tokens: [] });
    const adapter: CodeHighlightAdapter = {
      languageFormat: CodeLanguageFormat.Pierre,
      highlight: vi.fn(),
      createSession: () => ({ highlight, dispose }),
    };
    const session = createCodeHighlightSession(vi.fn());
    session.commit(input(adapter));
    expect(session.read(input(adapter)).status).toBe('error');
    expect(dispose).toHaveBeenCalledTimes(1);
    session.commit(input(adapter));
    expect(highlight).toHaveBeenCalledTimes(1);
    session.retry();
    session.commit(input(adapter));
    expect(session.read(input(adapter)).status).toBe('ready');
    session.retry();
    expect(dispose).toHaveBeenCalledTimes(2);
  });
});

test('cleanup failures cannot strand a new theme in loading or interrupt unmount/retry', () => {
  const dispose = vi.fn(() => {
    throw new Error('third-party cleanup failure');
  });
  const adapter: CodeHighlightAdapter = {
    languageFormat: CodeLanguageFormat.Pierre,
    highlight: vi.fn(),
    createSession: () => ({ highlight: ({ code }) => ({ tokens: [{ text: code }] }), dispose }),
  };
  const session = createCodeHighlightSession(vi.fn());
  session.commit(input(adapter));
  const dark = input(adapter, { colorScheme: 'dark' });
  session.commit(dark);
  expect(session.read(dark).status).toBe('ready');
  expect(() => session.retry()).not.toThrow();
  session.commit(dark);
  expect(() => session.commit({ ...dark, active: false })).not.toThrow();
  session.commit(dark);
  expect(() => session.dispose()).not.toThrow();
  expect(dispose).toHaveBeenCalledTimes(4);
});

test('commit-time adapter failures release the old backend, publish once and recover on retry', async () => {
  const dispose = vi.fn(),
    notify = vi.fn();
  const old: CodeHighlightAdapter = {
    languageFormat: CodeLanguageFormat.Pierre,
    highlight: vi.fn(),
    createSession: () => ({ highlight: ({ code }) => ({ tokens: [{ text: code }] }), dispose }),
  };
  const session = createCodeHighlightSession(notify);
  session.commit(input(old));
  notify.mockClear();
  let broken = true;
  const prepare = vi.fn(async () => {});
  const next: CodeHighlightAdapter = {
    languageFormat: (language) => {
      if (broken) throw new Error('resolver');
      return language;
    },
    prepare,
    highlight: ({ code }) => ({ tokens: [{ text: code }] }),
  };
  session.commit(input(next));
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(notify).toHaveBeenCalledTimes(1);
  session.commit(input(next));
  expect(notify).toHaveBeenCalledTimes(1);
  broken = false;
  expect(session.read(input(next)).status).toBe('error');
  session.retry();
  session.commit(input(next));
  await tick();
  expect(session.read(input(next)).status).toBe('ready');
  expect(prepare).toHaveBeenCalledTimes(1);
});

test('a readiness exception during commit invalidates pending initialization', async () => {
  let broken = false,
    finish!: () => void;
  const notify = vi.fn();
  const adapter: CodeHighlightAdapter = {
    languageFormat: CodeLanguageFormat.Pierre,
    isReady: () => {
      if (broken) throw new Error('readiness');
      return false;
    },
    prepare: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    highlight: ({ code }) => ({ tokens: [{ text: code }] }),
  };
  const session = createCodeHighlightSession(notify);
  session.commit(input(adapter));
  await tick();
  broken = true;
  session.commit(input(adapter));
  expect(session.read(input(adapter)).status).toBe('error');
  expect(notify).toHaveBeenCalledTimes(1);
  finish();
  await tick();
  expect(notify).toHaveBeenCalledTimes(1);
});

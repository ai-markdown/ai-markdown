// @vitest-environment jsdom
//
// Client-side (react-dom/client) counterpart of the SSR smoke tests in
// MantineAIMarkdown.test.tsx. These cases need effects: Mantine's
// CodeHighlight asks the nearest CodeHighlightAdapterProvider to load a
// language grammar from a `useEffect`, and highlights again once the
// provider reports the language loaded. renderToString runs neither, so an
// adapter that loads grammars on demand (the `createShikiAdapter` shape:
// `loadContext` + `loadLanguage`) can only be exercised in a DOM
// environment. jsdom resolves through vitest's optional peer, which the
// workspace already installs.
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { act } from 'react';
import { createHighlightJsAdapter, type CodeHighlightAdapter } from '@mantine/code-highlight';
import hljs from 'highlight.js';
import MantineAIMarkdown from '../../MantineAIMarkdown';
import { createMarkdownCodeBlock } from '../../rich/code';
import { MantineLanguageFormat } from '../../defs';
import { createMountHarness, flushEffects, installMantineDomStubs } from './domTestHarness';

/** Module constant: the group is compared by value. */
const SHIKI_FORMAT = { languageFormat: MantineLanguageFormat.Shiki };

const harness = createMountHarness();
beforeAll(installMantineDomStubs);
afterEach(async () => {
  await harness.cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('JSON formatting follows displayed frames; replacement and completion bypass throttling', async () => {
  vi.useFakeTimers();
  const adapter: CodeHighlightAdapter = {
    getHighlighter:
      () =>
      ({ code }) => ({ highlightedCode: code, isHighlighted: false }),
  };
  const codeBlock = { highlightIntervalMs: 100, formatJson: true };
  const view = (body: string, streaming = true) => (
    <MantineAIMarkdown content={'```json\n' + body + '\n```'} streaming={streaming} codeBlock={codeBlock} />
  );
  // The formatter runs inside core's session, so the test reads its effect from the rendered code.
  const shown = () => container.querySelector('code')?.textContent;
  const container = await harness.mount(view('{"a":1'), adapter);
  for (const body of ['{"a":1,', '{"a":1,"b":2', '{"a":1,"b":2}']) await harness.update(view(body));
  // Still the first frame: the completed value is waiting for the interval.
  expect(shown()).toBe('{"a":1');
  await act(async () => vi.advanceTimersByTime(100));
  expect(shown()).toContain('"b": 2');
  await harness.update(view('{"replacement":2}'));
  expect(container.querySelector('code')?.textContent).toContain('"replacement": 2');
  await harness.update(view('{"final":3}', false));
  expect(container.querySelector('code')?.textContent).toContain('"final": 3');
});

/**
 * A recording stand-in for a grammar-on-demand adapter. It highlights only
 * once `loadLanguage` has been asked for the language, so a highlighted
 * output proves the provider both requested the grammar and re-ran the
 * highlighter after the promise resolved.
 */
function createRecordingAdapter() {
  const loadLanguageCalls: string[] = [];
  const loaded = new Set<string>();
  const ctx = { name: 'recording-ctx' };
  const adapter: CodeHighlightAdapter = {
    loadContext: () => Promise.resolve(ctx),
    loadLanguage: (_ctx, language) => {
      loadLanguageCalls.push(language);
      loaded.add(language);
      return Promise.resolve();
    },
    getHighlighter: (highlighterCtx) => {
      if (!highlighterCtx) return ({ code }) => ({ highlightedCode: code, isHighlighted: false });
      return ({ code, language }) => {
        if (!language || !loaded.has(language)) return { highlightedCode: code, isHighlighted: false };
        return {
          highlightedCode: `<span class="recording-hl" data-lang="${language}">${code}</span>`,
          isHighlighted: true,
        };
      };
    },
  };
  return { adapter, loadLanguageCalls };
}

describe('code fences and grammar-on-demand adapters (client render)', () => {
  test('a ```ts fence asks the consumer adapter to load its Shiki name and is highlighted once it resolves', async () => {
    const { adapter, loadLanguageCalls } = createRecordingAdapter();
    const container = await harness.mount(
      <MantineAIMarkdown content={'```ts\nconst answer = 42;\n```'} codeBlock={SHIKI_FORMAT} />,
      adapter
    );
    // One flush for loadContext to resolve, one for loadLanguage.
    await flushEffects();
    await flushEffects();
    expect(loadLanguageCalls).toContain('typescript');
    const highlighted = container.querySelector('.recording-hl');
    expect(highlighted, 'the code element should carry the adapter markup').not.toBeNull();
    expect(highlighted?.getAttribute('data-lang')).toBe('typescript');
    expect(highlighted?.textContent).toContain('const answer = 42;');
  });

  test('the synchronous highlight.js adapter still highlights on the client', async () => {
    const container = await harness.mount(
      <MantineAIMarkdown content={'```typescript\nconst answer = 42;\n```'} />,
      createHighlightJsAdapter(hljs)
    );
    await flushEffects();
    const code = container.querySelector('code.hljs');
    expect(code).not.toBeNull();
    expect(code?.querySelector('.hljs-keyword')?.textContent).toBe('const');
    expect(code?.textContent).toContain('const answer = 42;');
  });
});

/** Module constants: the group is compared by value, and a factory is created once. */
const LABELLED = { labels: { copy: '复制代码', copyTooltip: '复制', collapse: '收起代码', showSource: '显示源码' } };
const WithDemo = createMarkdownCodeBlock({ renderers: { demo: () => <output>preview</output> } });
test('codeBlock.labels names the copy control', async () => {
  const container = await harness.mount(
    <MantineAIMarkdown content={'```typescript\nconst answer = 42;\n```'} codeBlock={LABELLED} />,
    createHighlightJsAdapter(hljs)
  );
  await flushEffects();
  expect(container.querySelector('[aria-label="复制代码"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Copy code"]')).toBeNull();
  // Mantine's own expand control takes its name from the same labels.
  expect(container.querySelector('[aria-label="收起代码"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Collapse code"]')).toBeNull();
});

test('without labels the Mantine controls keep the names they had', async () => {
  const container = await harness.mount(
    <MantineAIMarkdown content={'```typescript\nconst answer = 42;\n```'} />,
    createHighlightJsAdapter(hljs)
  );
  await flushEffects();
  expect(container.querySelector('[aria-label="Copy code"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Collapse code"]')).not.toBeNull();
});

test('codeBlock.labels also reaches the shell around a custom language renderer', async () => {
  const container = await harness.mount(
    <MantineAIMarkdown content={'```demo\nx\n```'} codeBlock={LABELLED} customComponents={{ pre: WithDemo }} />,
    createHighlightJsAdapter(hljs)
  );
  await flushEffects();
  const buttons = [...container.querySelectorAll('.aimd-toolbar button')].map((button) => button.textContent);
  expect(buttons).toEqual(['复制代码', '显示源码', '收起代码']);
});

const PYTHON = ['import os', 'import sys', '', 'def main(argv):', '    for path in argv:', '        print(path)'].join(
  '\n'
);
const RUST = ['fn main() {', '    let mut total = 0;', '    println!("{}", total);', '}'].join('\n');
/** The tab's file-name element (static class; `-fileIcon` and `-files` are siblings). */
const TAB_LABEL = '.mantine-CodeHighlightTabs-file';
const tabLabel = (container: HTMLElement) => container.querySelector(TAB_LABEL)?.textContent ?? null;
/** Group values are module constants so their identity is stable across renders. */
const AUTODETECT = { autoDetectUnknownLanguage: true };
const fence = (body: string) => '```\n' + body + '\n```';

describe('language auto-detection across a stream (client render)', () => {
  test('the label appears mid-stream and survives the end of the stream', async () => {
    const container = await harness.mount(
      <MantineAIMarkdown content={fence(PYTHON)} codeBlock={AUTODETECT} streaming />,
      createHighlightJsAdapter(hljs)
    );
    expect(tabLabel(container)).toBe('python');
    await harness.update(<MantineAIMarkdown content={fence(PYTHON + '\n\nmain(sys.argv)')} codeBlock={AUTODETECT} />);
    expect(tabLabel(container)).toBe('python');
  });

  test('a regenerated block is detected afresh, even across language families', async () => {
    const container = await harness.mount(
      <MantineAIMarkdown content={fence(PYTHON)} codeBlock={AUTODETECT} streaming />,
      createHighlightJsAdapter(hljs)
    );
    expect(tabLabel(container)).toBe('python');
    // Same block position, different text: the detector must not hold the
    // Python verdict against the new block.
    await harness.update(<MantineAIMarkdown content={fence(RUST)} codeBlock={AUTODETECT} streaming />);
    expect(tabLabel(container)).toBe('rust');
    await harness.update(<MantineAIMarkdown content={fence(RUST)} codeBlock={AUTODETECT} />);
    expect(tabLabel(container)).toBe('rust');
  });
});

// hast code text ends with a newline, so a chunk that stops in the middle of a line is an append
// only when that newline is ignored. A plain prefix test read it as a replacement and flushed.
test('another document at the same position starts over, even when its text continues', async () => {
  vi.useFakeTimers();
  const adapter: CodeHighlightAdapter = {
    getHighlighter:
      () =>
      ({ code }) => ({ highlightedCode: code, isHighlighted: false }),
  };
  const codeBlock = { highlightIntervalMs: 60_000 };
  const view = (documentId: string, body: string) => (
    <MantineAIMarkdown documentId={documentId} content={'```ts\n' + body} streaming codeBlock={codeBlock} />
  );
  const container = await harness.mount(view('first', 'const a = 1;'), adapter);
  const shown = () => container.querySelector('code')?.textContent;
  // The same document growing is throttled: the first frame stays up.
  await harness.update(view('first', 'const a = 1;\nconst b = 2;'));
  expect(shown()).not.toContain('const b');
  // Another message is not an append to this one, so its text shows at once.
  await harness.update(view('second', 'const a = 1;\nconst b = 2;\nconst c = 3;'));
  expect(shown()).toContain('const c = 3;');
});

test('mid-line chunks are throttled like any other append', async () => {
  let calls = 0;
  const adapter: CodeHighlightAdapter = {
    getHighlighter:
      () =>
      ({ code }) => (calls++, { highlightedCode: code, isHighlighted: false }),
  };
  const codeBlock = { highlightIntervalMs: 60_000 };
  const full = '```js\n' + Array.from({ length: 12 }, (_, i) => `const value${i} = compute(${i});\n`).join('');
  const view = (content: string) => <MantineAIMarkdown content={content} streaming codeBlock={codeBlock} />;
  await harness.mount(view(full.slice(0, 10)), adapter);
  const before = calls;
  let frames = 0;
  for (let end = 14; end < full.length + 4; end += 4, frames++) {
    await harness.update(view(full.slice(0, Math.min(end, full.length))));
  }
  expect(frames).toBeGreaterThan(60);
  expect(calls - before).toBeLessThan(3);
});

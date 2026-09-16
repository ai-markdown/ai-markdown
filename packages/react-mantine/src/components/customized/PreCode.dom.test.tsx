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
import { createHighlightJsAdapter, type CodeHighlightAdapter } from '@mantine/code-highlight';
import hljs from 'highlight.js';
import MantineAIMarkdown from '../../MantineAIMarkdown';
import { MantineLanguageFormat } from '../../defs';
import { createMountHarness, flushEffects, installMantineDomStubs } from './domTestHarness';

/** Module constant: the group is compared by value. */
const SHIKI_FORMAT = { languageFormat: MantineLanguageFormat.Shiki };

const harness = createMountHarness();
beforeAll(installMantineDomStubs);
afterEach(async () => {
  await harness.cleanup();
  vi.restoreAllMocks();
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

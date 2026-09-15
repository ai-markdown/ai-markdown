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
import type { MantineHighlightJsSource } from '../../defs';
import { createMountHarness, flushEffects, installMantineDomStubs } from './domTestHarness';

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
  test('a ```ts fence asks the consumer adapter to load "ts" and is highlighted once it resolves', async () => {
    const { adapter, loadLanguageCalls } = createRecordingAdapter();
    const container = await harness.mount(<MantineAIMarkdown content={'```ts\nconst answer = 42;\n```'} />, adapter);
    // One flush for loadContext to resolve, one for loadLanguage.
    await flushEffects();
    await flushEffects();
    expect(loadLanguageCalls).toContain('ts');
    const highlighted = container.querySelector('.recording-hl');
    expect(highlighted, 'the code element should carry the adapter markup').not.toBeNull();
    expect(highlighted?.getAttribute('data-lang')).toBe('ts');
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

// Unlabelled Python, well above the 32-character detection minimum.
const PY_BODY = ['import os', 'import sys', '', 'def main(argv):', '    for path in argv:', '        print(path)'].join(
  '\n'
);
const UNLABELLED = '```\n' + PY_BODY + '\n```';
/** What the real highlight.js calls this text; the label must agree with it. */
const EXPECTED_LABEL = hljs.highlightAuto(PY_BODY).language ?? '';
/** The tab's file-name element (static class; `-fileIcon` and `-files` are siblings). */
const TAB_LABEL = '.mantine-CodeHighlightTabs-file';
const tabLabel = (container: HTMLElement) => container.querySelector(TAB_LABEL)?.textContent ?? null;
/** Group values are module constants so their identity is stable across renders. */
const WITH_INSTANCE = { autoDetectUnknownLanguage: true, highlightJs: hljs };
const WITHOUT_SOURCE = { autoDetectUnknownLanguage: true };

describe('language auto-detection takes highlight.js from codeBlock.highlightJs (client render)', () => {
  test('an injected instance labels an unlabelled block', async () => {
    expect(EXPECTED_LABEL).not.toBe('');
    const container = await harness.mount(
      <MantineAIMarkdown content={UNLABELLED} codeBlock={WITH_INSTANCE} />,
      createHighlightJsAdapter(hljs)
    );
    await flushEffects();
    await flushEffects();
    expect(tabLabel(container)).toBe(EXPECTED_LABEL);
  });

  test('a loader is called once for the page and its module namespace is unwrapped', async () => {
    const loader = vi.fn(() => Promise.resolve({ default: hljs }));
    const group: { autoDetectUnknownLanguage: boolean; highlightJs: MantineHighlightJsSource } = {
      autoDetectUnknownLanguage: true,
      highlightJs: loader,
    };
    const container = await harness.mount(
      <MantineAIMarkdown content={UNLABELLED + '\n\n' + UNLABELLED} codeBlock={group} />,
      createHighlightJsAdapter(hljs)
    );
    await flushEffects();
    await flushEffects();
    const labels = Array.from(container.querySelectorAll(TAB_LABEL)).map((el) => el.textContent);
    expect(labels).toEqual([EXPECTED_LABEL, EXPECTED_LABEL]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test('without a source the option is inert: the block stays "unknown" and one warning is logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const container = await harness.mount(
      <MantineAIMarkdown content={UNLABELLED + '\n\n' + UNLABELLED} codeBlock={WITHOUT_SOURCE} />,
      createHighlightJsAdapter(hljs)
    );
    await flushEffects();
    await flushEffects();
    // No tab strip at all: "unknown" blocks render through plain CodeHighlight.
    expect(container.querySelector(TAB_LABEL)).toBeNull();
    expect(container.querySelectorAll('code').length).toBe(2);
    const messages = warn.mock.calls.filter((call) => String(call[0]).includes('codeBlock.highlightJs'));
    expect(messages).toHaveLength(1);
  });
});

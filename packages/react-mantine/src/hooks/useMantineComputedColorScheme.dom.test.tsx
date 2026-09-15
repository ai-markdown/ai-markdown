// @vitest-environment jsdom
//
// The wrapper's automatic color scheme under a MantineProvider on `auto`:
// the FIRST client frame must already carry the system scheme (no light
// frame that flips to dark in an effect), a system change must be followed
// live, and hydrating server markup (always light) must not produce a
// mismatch.
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { MantineProvider } from '@mantine/core';
import { CodeHighlightAdapterProvider, createHighlightJsAdapter } from '@mantine/code-highlight';
import hljs from 'highlight.js';
import { useAIMarkdownTheme } from '@ai-markdown/react';
import MantineAIMarkdown from '../MantineAIMarkdown';
import { createMountHarness, flushEffects, installMantineDomStubs } from '../components/customized/domTestHarness';

/** A controllable `(prefers-color-scheme: dark)` query. */
const system = {
  dark: false,
  listeners: new Set<(event: { matches: boolean }) => void>(),
  set(dark: boolean) {
    system.dark = dark;
    for (const listener of system.listeners) listener({ matches: dark });
  },
};

const harness = createMountHarness();
const adapter = createHighlightJsAdapter(hljs);
const seen: string[] = [];
/** Records the scheme every render sees; `customComponents` must be a stable object. */
const Probe = () => {
  const { colorScheme } = useAIMarkdownTheme();
  seen.push(colorScheme);
  return <em data-scheme={colorScheme} />;
};
const COMPONENTS = { em: Probe };

beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({
      get matches() {
        return system.dark;
      },
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => {
        system.listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => {
        system.listeners.delete(listener);
      },
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
  installMantineDomStubs();
});
afterEach(async () => {
  await harness.cleanup();
  seen.length = 0;
  system.listeners.clear();
  system.dark = false;
  window.localStorage.clear();
});

describe('useMantineComputedColorScheme', () => {
  test('under auto with a dark system, the first client frame is already dark', async () => {
    system.set(true);
    const container = await harness.mount(
      <MantineAIMarkdown content="*probe*" customComponents={COMPONENTS} />,
      adapter,
      { defaultColorScheme: 'auto' }
    );
    await flushEffects();
    expect(container.querySelector('em')?.getAttribute('data-scheme')).toBe('dark');
    expect(seen[0]).toBe('dark');
    expect(seen).not.toContain('light');
  });

  test('a system scheme change is followed live', async () => {
    system.set(true);
    const container = await harness.mount(
      <MantineAIMarkdown content="*probe*" customComponents={COMPONENTS} />,
      adapter,
      { defaultColorScheme: 'auto' }
    );
    await act(async () => {
      system.set(false);
    });
    expect(container.querySelector('em')?.getAttribute('data-scheme')).toBe('light');
  });

  test('an explicit provider scheme wins over the system query', async () => {
    system.set(true);
    const container = await harness.mount(
      <MantineAIMarkdown content="*probe*" customComponents={COMPONENTS} />,
      adapter,
      { forceColorScheme: 'light' }
    );
    expect(container.querySelector('em')?.getAttribute('data-scheme')).toBe('light');
  });

  test('server markup is light and hydrates on a dark system without a mismatch', async () => {
    const tree = (
      <MantineProvider defaultColorScheme="auto">
        <CodeHighlightAdapterProvider adapter={adapter}>
          <MantineAIMarkdown content="*probe*" customComponents={COMPONENTS} />
        </CodeHighlightAdapterProvider>
      </MantineProvider>
    );
    const html = renderToString(tree);
    expect(html).toContain('data-scheme="light"');
    seen.length = 0;

    system.set(true);
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const root = await act(async () => hydrateRoot(container, tree));
      await flushEffects();
      expect(container.querySelector('em')?.getAttribute('data-scheme')).toBe('dark');
      // The hydration pass renders the server snapshot (light); React then
      // re-renders with the client value — no "did not match" report.
      const reported = errors.mock.calls.map((call) => call.map(String).join(' '));
      expect(reported.filter((text) => /hydrat|did not match|Text content/i.test(text))).toEqual([]);
      expect(seen[0]).toBe('light');
      expect(seen.at(-1)).toBe('dark');
      await act(async () => root.unmount());
    } finally {
      errors.mockRestore();
      container.remove();
    }
  });
});

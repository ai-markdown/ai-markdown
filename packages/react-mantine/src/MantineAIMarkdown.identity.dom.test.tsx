// @vitest-environment jsdom
//
// What MantineAIMarkdown hands to <AIMarkdown> across re-renders: the
// merged `customComponents` object and the `codeBlock` behavior group
// must keep their identity when the caller passes equal but freshly built
// props, otherwise the core block cache is invalidated on every render.
// The core component is wrapped through the module mock to record the
// props it receives; the real component renders underneath.
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { CodeHighlightAdapterProvider, createHighlightJsAdapter } from '@mantine/code-highlight';
import hljs from 'highlight.js';
import { useAIMarkdownBehaviors, useAIMarkdownState } from '@ai-markdown/react';
import type AIMarkdownType from '@ai-markdown/react';
import MantineAIMarkdown from './MantineAIMarkdown';
import { useMantineCodeBlockOptions } from './hooks/useMantineCodeBlockOptions';

const recorded = vi.hoisted(() => ({ customComponents: [] as unknown[] }));
vi.mock('@ai-markdown/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ai-markdown/react')>();
  const Recording = (props: ComponentProps<typeof AIMarkdownType>) => {
    recorded.customComponents.push(props.customComponents);
    return createElement(actual.default, props);
  };
  return { ...actual, default: Recording };
});

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia ??= (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
});

const adapter = createHighlightJsAdapter(hljs);
/** The `codeBlock` group and the resolved options, one entry per probe
 * render. The block cache keeps the probe's element across renders whose
 * inputs did not change, so the probe also subscribes to `streaming` and
 * the test flips it to force a render. */
const groups: unknown[] = [];
const resolved: unknown[] = [];
const Probe = () => {
  useAIMarkdownState();
  groups.push(useAIMarkdownBehaviors().codeBlock);
  resolved.push(useMantineCodeBlockOptions());
  return <em data-probe="" />;
};

let root: Root | undefined;
async function render(props: Omit<ComponentProps<typeof MantineAIMarkdown>, 'content'>) {
  if (!root) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  }
  await act(async () => {
    root!.render(
      <MantineProvider>
        <CodeHighlightAdapterProvider adapter={adapter}>
          <MantineAIMarkdown content="*probe*" {...props} />
        </CodeHighlightAdapterProvider>
      </MantineProvider>
    );
  });
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = '';
  recorded.customComponents.length = 0;
  groups.length = 0;
  resolved.length = 0;
});

test('an equal but new customComponents object keeps the merged components identity', async () => {
  await render({ customComponents: { em: Probe } });
  await render({ customComponents: { em: Probe } });
  await render({ customComponents: { em: Probe } });
  expect(recorded.customComponents.length).toBeGreaterThanOrEqual(3);
  const [first, ...rest] = recorded.customComponents;
  expect(first).toMatchObject({ em: Probe });
  expect((first as { pre?: unknown }).pre).toBeTypeOf('function');
  for (const later of rest) expect(later).toBe(first);
  // A real change (a different override) is a new object.
  const Other = () => <em data-other="" />;
  await render({ customComponents: { em: Other } });
  expect(recorded.customComponents.at(-1)).not.toBe(first);
  expect(recorded.customComponents.at(-1)).toMatchObject({ em: Other });
});

test('without customComponents the shipped defaults object is passed every time', async () => {
  await render({});
  await render({ streaming: true });
  await render({ streaming: false });
  const [first, ...rest] = recorded.customComponents;
  expect((first as { pre?: unknown }).pre).toBeTypeOf('function');
  for (const later of rest) expect(later).toBe(first);
});

test('an equal but new codeBlock object keeps the behavior group and the resolved options identity', async () => {
  const em = { em: Probe };
  await render({ customComponents: em, codeBlock: { defaultExpanded: false, highlightIntervalMs: 20 } });
  await render({
    customComponents: em,
    streaming: true,
    codeBlock: { defaultExpanded: false, highlightIntervalMs: 20 },
  });
  await render({ customComponents: em, codeBlock: { highlightIntervalMs: 20, defaultExpanded: false } });
  expect(groups.length).toBeGreaterThanOrEqual(3);
  const [group, ...laterGroups] = groups;
  expect(group).toEqual({ defaultExpanded: false, highlightIntervalMs: 20 });
  for (const later of laterGroups) expect(later).toBe(group);
  const [options, ...laterOptions] = resolved;
  expect(options).toMatchObject({ defaultExpanded: false, highlightIntervalMs: 20, mermaidIntervalMs: 300 });
  for (const later of laterOptions) expect(later).toBe(options);
  // A changed field is a new group and new resolved options.
  await render({ customComponents: { em: Probe }, codeBlock: { defaultExpanded: true, highlightIntervalMs: 20 } });
  expect(groups.at(-1)).not.toBe(group);
  expect(groups.at(-1)).toEqual({ defaultExpanded: true, highlightIntervalMs: 20 });
  expect(resolved.at(-1)).not.toBe(options);
});

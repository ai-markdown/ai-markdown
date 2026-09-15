// @vitest-environment jsdom
//
// The on-demand mermaid import and its bounded retry. The renderer caches
// the import promise at module level and vitest caches the mock per
// module registry, so this file's first test is the only place the cold
// download can fail: the first two imports reject, the third resolves.
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { act } from 'react';
import { createHighlightJsAdapter } from '@mantine/code-highlight';
import hljs from 'highlight.js';
import MantineAIMarkdown from '../../../MantineAIMarkdown';
import { createMountHarness, flushEffects, installMantineDomStubs } from '../domTestHarness';

const mermaidMock = vi.hoisted(() => ({
  renders: [] as string[],
  parses: [] as string[],
  /** How many more module imports must fail. */
  loadFailures: 2,
  /** How many times the module factory ran. */
  imports: 0,
}));

vi.mock('mermaid', () => {
  mermaidMock.imports += 1;
  if (mermaidMock.loadFailures > 0) {
    mermaidMock.loadFailures -= 1;
    throw new Error('mermaid download failed');
  }
  const siteConfig = () => ({ securityLevel: 'strict', theme: 'base', darkMode: false, suppressErrorRendering: true });
  return {
    default: {
      initialize: () => {},
      parse: (code: string) => {
        mermaidMock.parses.push(code);
        return Promise.resolve(true);
      },
      render: (_id: string, code: string) => {
        mermaidMock.renders.push(code);
        return Promise.resolve({ svg: '<svg data-mock-diagram="1"></svg>', diagramType: 'flowchart' });
      },
      mermaidAPI: { getSiteConfig: siteConfig, getConfig: siteConfig },
    },
  };
});

const harness = createMountHarness();
const adapter = createHighlightJsAdapter(hljs);
beforeAll(installMantineDomStubs);
afterEach(async () => {
  await harness.cleanup();
  vi.useRealTimers();
});

const BASE = 'graph TD;\nA-->B;';
const fence = (body: string) => '```mermaid\n' + body + '\n```';
const src = (body: string) => body + '\n';
const settle = async () => {
  for (let i = 0; i < 3; i++) await flushEffects();
};
const RETRY_MS = 1500;

test('a failed mermaid import keeps the source view without an error and retries until the download succeeds', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const container = await harness.mount(<MantineAIMarkdown content={fence(BASE)} />, adapter);
  await settle();
  const host = container.querySelector('.aim-mantine-mermaid-code') as HTMLElement;
  // First attempt: the download failed. Nothing parsed, source view up, no error tab.
  expect(mermaidMock.imports).toBe(1);
  expect(mermaidMock.parses).toEqual([]);
  expect(host.style.display).toBe('none');
  expect(container.textContent).not.toContain('Mermaid Render Error');
  expect(container.querySelector('.aim-mantine-mermaid-error')).toBeNull();
  expect(vi.getTimerCount()).toBe(1);
  // The retry is not early.
  await act(async () => {
    vi.advanceTimersByTime(RETRY_MS - 1);
  });
  await settle();
  expect(mermaidMock.imports).toBe(1);
  // Second attempt fails the same way and arms another retry.
  await act(async () => {
    vi.advanceTimersByTime(1);
  });
  await settle();
  expect(mermaidMock.imports).toBe(2);
  expect(mermaidMock.parses).toEqual([]);
  expect(container.textContent).not.toContain('Mermaid Render Error');
  expect(vi.getTimerCount()).toBe(1);
  // Third attempt loads; the diagram renders from the unchanged source.
  await act(async () => {
    vi.advanceTimersByTime(RETRY_MS);
  });
  await settle();
  expect(mermaidMock.imports).toBe(3);
  expect(mermaidMock.parses).toEqual([src(BASE)]);
  expect(mermaidMock.renders).toEqual([src(BASE)]);
  expect(container.querySelector('[data-mock-diagram]')).not.toBeNull();
  expect(host.style.display).toBe('');
  expect(vi.getTimerCount()).toBe(0);
});

test('once loaded, the module is not imported again', async () => {
  await harness.mount(<MantineAIMarkdown content={fence(BASE)} />, adapter);
  await settle();
  expect(mermaidMock.imports).toBe(3);
  expect(mermaidMock.renders).toEqual([src(BASE), src(BASE)]);
});

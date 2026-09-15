// @vitest-environment jsdom
//
// The mermaid renderer's streaming throttle (`codeBlock.mermaidIntervalMs`)
// and its size gate (`maxTextSize`). mermaid itself is mocked: jsdom cannot
// lay out SVG text, and what is under test is how often the renderer asks
// mermaid to work and what it does with oversized input. Timers are faked
// so the throttle is measured against a clock, not wall time.
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { act } from 'react';
import { createHighlightJsAdapter } from '@mantine/code-highlight';
import hljs from 'highlight.js';
import MantineAIMarkdown from '../../../MantineAIMarkdown';
import { createMountHarness, flushEffects, installMantineDomStubs } from '../domTestHarness';

const mermaidMock = vi.hoisted(() => ({
  /** Source text of every `mermaid.render` call, in order. */
  renders: [] as string[],
  parses: 0,
  /** Site config `maxTextSize`; undefined means "not configured". */
  maxTextSize: undefined as number | undefined,
}));

vi.mock('mermaid', () => {
  const siteConfig = () => ({
    securityLevel: 'strict',
    theme: 'base',
    darkMode: false,
    suppressErrorRendering: true,
    maxTextSize: mermaidMock.maxTextSize,
  });
  return {
    default: {
      initialize: () => {},
      parse: () => {
        mermaidMock.parses += 1;
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
  mermaidMock.renders.length = 0;
  mermaidMock.parses = 0;
  mermaidMock.maxTextSize = undefined;
});

const INTERVAL = 100;
/** Module constant so the group identity is stable across re-renders. */
const CODE_BLOCK = { mermaidIntervalMs: INTERVAL };
const fence = (body: string) => '```mermaid\n' + body + '\n```';
/** The code text the renderer receives keeps the newline before the closing fence. */
const src = (body: string) => body + '\n';
const BASE = 'graph TD;\nA-->B;';
/** The stream after `i` appended edges: each step is a strict extension of the previous one. */
const step = (i: number) => BASE + Array.from({ length: i }, (_, k) => `\nN${k + 1}-->N${k + 2};`).join('');

/** Let the render queue, the mocked promises and React's state updates settle. */
const settle = async () => {
  for (let i = 0; i < 3; i++) await flushEffects();
};

describe('mermaid streaming throttle', () => {
  test('rapid streamed updates render at most ceil(duration / interval) + 1 times; the final source renders', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await harness.mount(<MantineAIMarkdown content={fence(BASE)} streaming codeBlock={CODE_BLOCK} />, adapter);
    await settle();
    expect(mermaidMock.renders).toEqual([src(BASE)]);

    // 20 appends, 10 ms apart: 200 ms of streaming against a 100 ms interval.
    const updates = 20;
    const gapMs = 10;
    let latest = BASE;
    for (let i = 1; i <= updates; i++) {
      latest = step(i);
      await harness.update(<MantineAIMarkdown content={fence(latest)} streaming codeBlock={CODE_BLOCK} />);
      await act(async () => {
        vi.advanceTimersByTime(gapMs);
      });
    }
    await settle();
    const duration = updates * gapMs;
    expect(mermaidMock.renders.length).toBeLessThanOrEqual(Math.ceil(duration / INTERVAL) + 1);
    // The throttle lets frames through mid-stream (trailing edge), not only at the end.
    expect(mermaidMock.renders.length).toBeGreaterThanOrEqual(2);
    // A frame that went through is always a real prefix of the stream.
    for (const rendered of mermaidMock.renders) expect(src(latest).startsWith(rendered)).toBe(true);

    // End of stream: the corrective pass sees the final source without waiting for a timer.
    await harness.update(<MantineAIMarkdown content={fence(latest)} streaming={false} codeBlock={CODE_BLOCK} />);
    await settle();
    expect(mermaidMock.renders.at(-1)).toBe(src(latest));
    // No timer is left behind by the throttle once the stream has ended.
    expect(vi.getTimerCount()).toBe(0);
  });

  test('a non-streaming update renders immediately, with no timer involved', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await harness.mount(<MantineAIMarkdown content={fence(BASE)} codeBlock={CODE_BLOCK} />, adapter);
    await settle();
    expect(mermaidMock.renders).toEqual([src(BASE)]);
    const next = step(1);
    await harness.update(<MantineAIMarkdown content={fence(next)} codeBlock={CODE_BLOCK} />);
    await settle();
    expect(mermaidMock.renders).toEqual([src(BASE), src(next)]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('a zero interval attempts every streamed update', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const every = { mermaidIntervalMs: 0 };
    await harness.mount(<MantineAIMarkdown content={fence(BASE)} streaming codeBlock={every} />, adapter);
    await settle();
    for (let i = 1; i <= 3; i++) {
      await harness.update(<MantineAIMarkdown content={fence(step(i))} streaming codeBlock={every} />);
      await settle();
    }
    expect(mermaidMock.renders).toEqual([src(BASE), src(step(1)), src(step(2)), src(step(3))]);
  });
});

describe('mermaid maxTextSize gate', () => {
  test('input above the configured maxTextSize is neither parsed nor rendered and shows a plain-text error', async () => {
    mermaidMock.maxTextSize = 20;
    const oversized = 'graph TD;\nA-->B;\nB-->C;\nC-->D;';
    expect(src(oversized).length).toBeGreaterThan(20);
    const container = await harness.mount(<MantineAIMarkdown content={fence(oversized)} />, adapter);
    await settle();
    expect(mermaidMock.parses).toBe(0);
    expect(mermaidMock.renders).toEqual([]);
    expect(container.querySelector('[data-mock-diagram]')).toBeNull();
    expect(container.textContent).toContain('Mermaid Render Error');
    const message = container.querySelector('.aim-mantine-mermaid-error');
    expect(message?.textContent).toBe(
      `Diagram source is ${src(oversized).length} characters, above mermaid's maxTextSize of 20.`
    );
  });

  test('input within the limit renders as before', async () => {
    mermaidMock.maxTextSize = 20;
    const small = 'graph TD;\nA-->B;';
    expect(src(small).length).toBeLessThanOrEqual(20);
    const container = await harness.mount(<MantineAIMarkdown content={fence(small)} />, adapter);
    await settle();
    expect(mermaidMock.renders).toEqual([src(small)]);
    expect(container.querySelector('[data-mock-diagram]')).not.toBeNull();
  });
});

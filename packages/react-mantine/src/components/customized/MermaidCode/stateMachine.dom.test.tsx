// @vitest-environment jsdom
//
// The mermaid renderer's view state machine: streaming edges, the
// same-input skip, the error tab and an unmount with a render in flight.
// mermaid itself is mocked, as in streaming.dom.test.tsx; here the mock
// also rejects parses of chosen sources and can hold a render open.
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { act } from 'react';
import { createHighlightJsAdapter } from '@mantine/code-highlight';
import hljs from 'highlight.js';
import MantineAIMarkdown from '../../../MantineAIMarkdown';
import { clickByLabel, createMountHarness, flushEffects, installMantineDomStubs } from '../domTestHarness';

const mermaidMock = vi.hoisted(() => ({
  /** Source text of every `mermaid.render` call, in order. */
  renders: [] as string[],
  /** Source text of every `mermaid.parse` call, in order. */
  parses: [] as string[],
  /** The rejection message for a source, or null when it parses. */
  rejects: (_code: string): string | null => null,
  /** While true, `render` stays pending until `release` is called. */
  hold: false,
  release: null as null | (() => void),
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
      parse: (code: string) => {
        mermaidMock.parses.push(code);
        const reason = mermaidMock.rejects(code);
        return reason === null ? Promise.resolve(true) : Promise.reject(new Error(reason));
      },
      render: (_id: string, code: string) => {
        mermaidMock.renders.push(code);
        const result = {
          svg: `<svg data-mock-diagram="${mermaidMock.renders.length}"></svg>`,
          diagramType: 'flowchart',
        };
        if (!mermaidMock.hold) return Promise.resolve(result);
        return new Promise<typeof result>((resolve) => {
          mermaidMock.release = () => resolve(result);
        });
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
  vi.restoreAllMocks();
  mermaidMock.renders.length = 0;
  mermaidMock.parses.length = 0;
  mermaidMock.rejects = () => null;
  mermaidMock.hold = false;
  mermaidMock.release = null;
  mermaidMock.maxTextSize = undefined;
});

const INTERVAL = 100;
const CODE_BLOCK = { mermaidIntervalMs: INTERVAL };
const fence = (body: string) => '```mermaid\n' + body + '\n```';
/** The code text the renderer receives keeps the newline before the closing fence. */
const src = (body: string) => body + '\n';
const BASE = 'graph TD;\nA-->B;';
const PREFIX = 'graph TD;\nA--';
const step = (i: number) => BASE + Array.from({ length: i }, (_, k) => `\nN${k + 1}-->N${k + 2};`).join('');
const settle = async () => {
  for (let i = 0; i < 3; i++) await flushEffects();
};

const diagram = (container: HTMLElement) => container.querySelector('[data-mock-diagram]');
const errorText = (container: HTMLElement) => container.querySelector('.aim-mantine-mermaid-error')?.textContent;
/** The diagram host is hidden while the source tabs show. */
const hostHidden = (container: HTMLElement) =>
  (container.querySelector('.aim-mantine-mermaid-code') as HTMLElement).style.display === 'none';

describe('streaming edges', () => {
  test('rising edge: a new generation on the same instance shows its source, never an error, while the prefix fails', async () => {
    mermaidMock.rejects = (code) => (code === src(PREFIX) ? 'Parse error on line 2' : null);
    const container = await harness.mount(<MantineAIMarkdown content={fence(BASE)} codeBlock={CODE_BLOCK} />, adapter);
    await settle();
    expect(diagram(container)).not.toBeNull();
    expect(hostHidden(container)).toBe(false);

    // Regenerate: streaming flips on with a prefix that does not parse.
    await harness.update(<MantineAIMarkdown content={fence(PREFIX)} streaming codeBlock={CODE_BLOCK} />);
    await settle();
    expect(mermaidMock.parses).toEqual([src(BASE), src(PREFIX)]);
    expect(mermaidMock.renders).toEqual([src(BASE)]);
    // The previous generation's SVG is gone and the source shows, with no error tab.
    expect(diagram(container)).toBeNull();
    expect(hostHidden(container)).toBe(true);
    expect(container.textContent).not.toContain('Mermaid Render Error');
    expect(errorText(container)).toBeUndefined();

    // More bytes complete the diagram again.
    await harness.update(<MantineAIMarkdown content={fence(step(1))} streaming codeBlock={CODE_BLOCK} />);
    await settle();
    expect(mermaidMock.renders).toEqual([src(BASE), src(step(1))]);
    expect(diagram(container)).not.toBeNull();
    expect(hostHidden(container)).toBe(false);
  });

  test('falling edge: the corrective pass renders the final source exactly once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await harness.mount(<MantineAIMarkdown content={fence(BASE)} streaming codeBlock={CODE_BLOCK} />, adapter);
    await settle();
    expect(mermaidMock.renders).toEqual([src(BASE)]);
    // An append inside the interval waits in the throttle.
    await harness.update(<MantineAIMarkdown content={fence(step(1))} streaming codeBlock={CODE_BLOCK} />);
    await settle();
    expect(mermaidMock.renders).toEqual([src(BASE)]);
    // End of stream on the same source: the frame flushes and one render runs.
    await harness.update(<MantineAIMarkdown content={fence(step(1))} streaming={false} codeBlock={CODE_BLOCK} />);
    await settle();
    expect(mermaidMock.renders).toEqual([src(BASE), src(step(1))]);
    // Nothing is left to fire, and a repeated static render of the same
    // source adds no attempt.
    await act(async () => {
      vi.advanceTimersByTime(INTERVAL * 5);
    });
    await settle();
    await harness.update(<MantineAIMarkdown content={fence(step(1))} streaming={false} codeBlock={CODE_BLOCK} />);
    await settle();
    expect(mermaidMock.renders).toEqual([src(BASE), src(step(1))]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('falling edge on a source that no longer parses surfaces the error over the mid-stream diagram', async () => {
    const container = await harness.mount(<MantineAIMarkdown content={fence(BASE)} streaming />, adapter);
    await settle();
    expect(diagram(container)).not.toBeNull();
    // The final bytes break the diagram; mid-stream the failure is quiet.
    const broken = BASE + '\nB-->';
    mermaidMock.rejects = (code) => (code === src(broken) ? 'Parse error on line 3:\n...B-->\nExpecting NODE' : null);
    await harness.update(<MantineAIMarkdown content={fence(broken)} streaming />);
    await settle();
    expect(errorText(container)).toBeUndefined();
    expect(diagram(container)).not.toBeNull();
    await harness.update(<MantineAIMarkdown content={fence(broken)} streaming={false} />);
    await settle();
    expect(container.textContent).toContain('Mermaid Render Error');
    expect(errorText(container)).toBe('Parse error on line 3:\n...B-->\nExpecting NODE');
    expect(hostHidden(container)).toBe(true);
  });
});

describe('same-input skip', () => {
  test('returning from the source view with the same source and theme re-renders nothing; a theme change does', async () => {
    const container = await harness.mount(<MantineAIMarkdown content={fence(BASE)} />, adapter);
    await settle();
    expect(mermaidMock.renders).toEqual([src(BASE)]);
    await clickByLabel(container, 'Show Mermaid code');
    await settle();
    expect(hostHidden(container)).toBe(true);
    await clickByLabel(container, 'Render Mermaid diagram');
    await settle();
    expect(hostHidden(container)).toBe(false);
    expect(diagram(container)).not.toBeNull();
    expect(mermaidMock.parses).toEqual([src(BASE)]);
    expect(mermaidMock.renders).toEqual([src(BASE)]);
    // The theme is part of the key: the same source renders again in dark.
    await harness.update(<MantineAIMarkdown content={fence(BASE)} colorScheme="dark" />);
    await settle();
    expect(mermaidMock.renders).toEqual([src(BASE), src(BASE)]);
    expect(container.querySelector('.aim-mantine-mermaid-code.dark')).not.toBeNull();
  });
});

// The module download retry lives in loadRetry.dom.test.tsx: the import is
// cached per module registry, so it needs a file where nothing loaded
// mermaid before.

describe('error tab', () => {
  test('a static failure shows the message text and keeps the source in the tab', async () => {
    const message = 'Parse error on line 2:\ngraph TD; A-->\n--------------^\nExpecting NODE_STRING';
    mermaidMock.rejects = () => message;
    const container = await harness.mount(<MantineAIMarkdown content={fence(BASE)} />, adapter);
    await settle();
    expect(container.textContent).toContain('Mermaid Render Error');
    const status = container.querySelector('.aim-mantine-mermaid-error');
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.textContent).toBe(message);
    // The message is a text node, not markup.
    expect(status?.children.length).toBe(0);
    expect(container.textContent?.replace(/\s+/g, '')).toContain('A-->B;');
    expect(diagram(container)).toBeNull();
    expect(mermaidMock.renders).toEqual([]);
  });

  test('a source above maxTextSize is quiet while streaming and reported at the falling edge', async () => {
    mermaidMock.maxTextSize = 20;
    const oversized = 'graph TD;\nA-->B;\nB-->C;\nC-->D;';
    const container = await harness.mount(<MantineAIMarkdown content={fence(oversized)} streaming />, adapter);
    await settle();
    expect(errorText(container)).toBeUndefined();
    expect(hostHidden(container)).toBe(true);
    await harness.update(<MantineAIMarkdown content={fence(oversized)} streaming={false} />);
    await settle();
    expect(errorText(container)).toBe(
      `Diagram source is ${src(oversized).length} characters, above mermaid's maxTextSize of 20.`
    );
    expect(mermaidMock.parses).toEqual([]);
    expect(mermaidMock.renders).toEqual([]);
  });
});

describe('unmount', () => {
  test('a render that completes after unmount applies nothing and logs nothing', async () => {
    mermaidMock.hold = true;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const container = await harness.mount(<MantineAIMarkdown content={fence(BASE)} />, adapter);
    await settle();
    expect(mermaidMock.renders).toEqual([src(BASE)]);
    expect(mermaidMock.release).not.toBeNull();
    expect(diagram(container)).toBeNull();
    await harness.cleanup();
    mermaidMock.release!();
    await settle();
    expect(document.querySelector('[data-mock-diagram]')).toBeNull();
    expect(error).not.toHaveBeenCalled();
  });
});

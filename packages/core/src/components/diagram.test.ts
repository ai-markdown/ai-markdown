import { afterEach, describe, expect, test, vi } from 'vitest';
import { createDiagramController, type DiagramEngine, type DiagramRequest, type DiagramState } from './diagram';

afterEach(() => vi.useRealTimers());

const request = (code: string, rest: Partial<DiagramRequest> = {}): DiagramRequest => ({
  code,
  dark: false,
  streaming: false,
  active: true,
  interval: 300,
  ...rest,
});
const tick = async () => {
  for (let i = 0; i < 16; i++) await Promise.resolve();
};
/** An engine that renders the source as its own SVG and rejects the sources `broken` names. */
const fakeEngine = (broken: (code: string) => string | null = () => null, maxTextSize?: number) => {
  const config = () => ({
    securityLevel: 'strict',
    theme: 'base',
    darkMode: false,
    suppressErrorRendering: true,
    maxTextSize,
  });
  const engine = {
    initialize() {},
    parse: vi.fn((code: string) => {
      const reason = broken(code);
      return reason === null ? Promise.resolve(true) : Promise.reject(new Error(reason));
    }),
    render: vi.fn(async (_: string, code: string) => ({ svg: code, diagramType: 'flowchart' })),
    mermaidAPI: { getSiteConfig: config, getConfig: config },
  };
  return engine satisfies DiagramEngine;
};
const mount = (engine: DiagramEngine | (() => Promise<DiagramEngine>)) => {
  const states: DiagramState[] = [];
  const load = typeof engine === 'function' ? engine : async () => engine;
  const controller = createDiagramController(load, (state) => states.push(state));
  return { controller, states, view: () => states.at(-1)?.view };
};
const rendered = (engine: { render: { mock: { calls: unknown[][] } } }) =>
  engine.render.mock.calls.map((call) => call[1]);

// hast code text ends with a newline, so the sources below do too.
const BASE = 'graph TD;\nA-->B;\n';
const PREFIX = 'graph TD;\nA--\n';
const MORE = 'graph TD;\nA-->B;\nB-->C;\n';

describe('attempts', () => {
  test('a static source renders at once and publishes the diagram with its chart type', async () => {
    const engine = fakeEngine();
    const { controller, view } = mount(engine);
    controller.update(request(BASE));
    await tick();
    expect(view()).toMatchObject({ kind: 'diagram', svg: BASE, chartType: 'flowchart' });
    controller.dispose();
  });

  test('a superseded render publishes nothing, and diagrams take turns with the engine', async () => {
    let release!: (value: { svg: string }) => void;
    const engine = fakeEngine();
    engine.render
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve as typeof release)))
      .mockImplementation(async (_: string, code: string) => ({ svg: code, diagramType: 'flowchart' }));
    const first = mount(engine),
      second = mount(engine);
    first.controller.update(request(BASE));
    await tick();
    first.controller.update(request(MORE));
    second.controller.update(request('graph LR;\nX-->Y;\n', { dark: true }));
    await tick();
    expect(engine.render).toHaveBeenCalledTimes(1);
    release({ svg: 'obsolete' });
    await tick();
    expect(first.states.some((state) => state.view.kind === 'diagram' && state.view.svg === 'obsolete')).toBe(false);
    expect(first.view()).toMatchObject({ kind: 'diagram', svg: MORE });
    expect(second.view()).toMatchObject({ kind: 'diagram', svg: 'graph LR;\nX-->Y;\n' });
    first.controller.dispose();
    second.controller.dispose();
  });

  test('the same source and theme are not rendered again; a theme change is', async () => {
    const engine = fakeEngine();
    const { controller } = mount(engine);
    controller.update(request(BASE));
    await tick();
    // The host shows something else and comes back.
    controller.update(request(BASE, { active: false }));
    controller.update(request(BASE));
    await tick();
    expect(engine.render).toHaveBeenCalledTimes(1);
    controller.update(request(BASE, { dark: true }));
    await tick();
    expect(engine.render).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  test('nothing is attempted while inactive, and nothing is published after dispose', async () => {
    const engine = fakeEngine();
    const { controller, states } = mount(engine);
    controller.update(request(BASE, { active: false }));
    await tick();
    expect(engine.parse).not.toHaveBeenCalled();
    controller.update(request(BASE));
    controller.dispose();
    await tick();
    expect(states).toEqual([]);
    // Cancellation is reversible, as a replayed effect needs.
    controller.update(request(BASE));
    await tick();
    expect(states.at(-1)?.view.kind).toBe('diagram');
    controller.dispose();
  });
});

describe('streaming', () => {
  test('mid-line appends share one deadline and render the latest source', async () => {
    vi.useFakeTimers();
    const engine = fakeEngine();
    const { controller, view } = mount(engine);
    controller.update(request('graph TD;\n', { streaming: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(rendered(engine)).toEqual(['graph TD;\n']);
    controller.update(request('graph TD;\nA--\n', { streaming: true }));
    await vi.advanceTimersByTimeAsync(200);
    controller.update(request('graph TD;\nA-->B;\n', { streaming: true }));
    await vi.advanceTimersByTimeAsync(99);
    expect(rendered(engine)).toEqual(['graph TD;\n']);
    await vi.advanceTimersByTimeAsync(1);
    // The first deadline stood, and it rendered the text that had arrived by then.
    expect(rendered(engine)).toEqual(['graph TD;\n', 'graph TD;\nA-->B;\n']);
    expect(view()).toMatchObject({ kind: 'diagram', svg: 'graph TD;\nA-->B;\n' });
    controller.dispose();
  });

  test('a zero interval attempts every update, and a non-streaming update needs no timer', async () => {
    vi.useFakeTimers();
    const engine = fakeEngine();
    const { controller } = mount(engine);
    controller.update(request(PREFIX, { streaming: true, interval: 0 }));
    await vi.advanceTimersByTimeAsync(0);
    controller.update(request(BASE, { streaming: true, interval: 0 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(rendered(engine)).toEqual([PREFIX, BASE]);
    controller.update(request(MORE));
    await vi.advanceTimersByTimeAsync(0);
    expect(rendered(engine)).toEqual([PREFIX, BASE, MORE]);
    expect(vi.getTimerCount()).toBe(0);
    controller.dispose();
  });

  test('a prefix that fails keeps the view: source before the first diagram, the last diagram after', async () => {
    const engine = fakeEngine((code) => (code === PREFIX ? 'Parse error on line 2' : null));
    const { controller, states, view } = mount(engine);
    controller.update(request(PREFIX, { streaming: true, interval: 0 }));
    await tick();
    expect(states).toEqual([]);
    controller.update(request(BASE, { streaming: true, interval: 0 }));
    await tick();
    expect(view()).toMatchObject({ kind: 'diagram', svg: BASE });
    const published = states.length;
    // A rewrite to the failing prefix: still streaming, so the diagram stays.
    controller.update(request(PREFIX, { streaming: true, interval: 0 }));
    await tick();
    expect(states.length).toBe(published);
    controller.dispose();
  });

  test('a new stream on the same instance drops the previous diagram and shows the source', async () => {
    const engine = fakeEngine((code) => (code === PREFIX ? 'Parse error on line 2' : null));
    const { controller, view } = mount(engine);
    controller.update(request(BASE));
    await tick();
    expect(view()?.kind).toBe('diagram');
    controller.update(request(PREFIX, { streaming: true }));
    await tick();
    expect(view()).toEqual({ kind: 'source' });
    expect(engine.parse.mock.calls.map((call) => call[0])).toEqual([BASE, PREFIX]);
    controller.dispose();
  });

  test('the end of a stream renders the final source once, and not at all if it is already on screen', async () => {
    const engine = fakeEngine();
    const { controller } = mount(engine);
    controller.update(request(BASE, { streaming: true, interval: 0 }));
    await tick();
    controller.update(request(BASE));
    await tick();
    expect(rendered(engine)).toEqual([BASE]);
    controller.dispose();

    const late = fakeEngine();
    const other = mount(late);
    vi.useFakeTimers();
    other.controller.update(request(PREFIX, { streaming: true }));
    await vi.advanceTimersByTimeAsync(0);
    other.controller.update(request(BASE, { streaming: true }));
    // The stream ends before the interval: the final source passes through at once.
    other.controller.update(request(BASE));
    await vi.advanceTimersByTimeAsync(0);
    expect(rendered(late)).toEqual([PREFIX, BASE]);
    expect(vi.getTimerCount()).toBe(0);
    other.controller.dispose();
  });

  test('a final source that no longer parses replaces the mid-stream diagram with the error, once', async () => {
    const engine = fakeEngine((code) => (code === MORE ? 'Parse error on line 3' : null));
    const { controller, states, view } = mount(engine);
    controller.update(request(BASE, { streaming: true, interval: 0 }));
    await tick();
    expect(view()?.kind).toBe('diagram');
    controller.update(request(MORE));
    await tick();
    expect(view()).toEqual({ kind: 'error', message: 'Parse error on line 3' });
    // The obligation is spent: a later failure follows the static rule and changes nothing.
    const published = states.length;
    controller.update(request(MORE, { dark: true }));
    await tick();
    expect(states.length).toBe(published);
    controller.dispose();
  });
});

describe('static failures', () => {
  test('a failure is published while nothing has rendered, with a capped plain message', async () => {
    const engine = fakeEngine(() => `Parse error\r\n${'x'.repeat(600)}`);
    const { controller, view } = mount(engine);
    controller.update(request(BASE));
    await tick();
    const shown = view();
    expect(shown?.kind).toBe('error');
    expect(shown?.kind === 'error' && shown.message.startsWith('Parse error\nxxx')).toBe(true);
    expect(shown?.kind === 'error' && shown.message.length).toBe(501);
    controller.dispose();
  });

  test('a failure keeps the diagram that is up', async () => {
    const engine = fakeEngine((code) => (code === PREFIX ? 'Parse error on line 2' : null));
    const { controller, view } = mount(engine);
    controller.update(request(BASE));
    await tick();
    controller.update(request(PREFIX));
    await tick();
    expect(view()).toMatchObject({ kind: 'diagram', svg: BASE });
    controller.dispose();
  });

  test('a source above maxTextSize is not parsed; it is quiet while streaming and reported when the stream ends', async () => {
    const engine = fakeEngine(() => null, 12);
    const { controller, states, view } = mount(engine);
    controller.update(request(MORE, { streaming: true, interval: 0 }));
    await tick();
    expect(states).toEqual([]);
    controller.update(request(MORE));
    await tick();
    expect(engine.parse).not.toHaveBeenCalled();
    expect(view()).toEqual({
      kind: 'error',
      message: `Diagram source is ${MORE.length} characters, above mermaid's maxTextSize of 12.`,
    });
    controller.dispose();
  });
});

describe('engine download', () => {
  test('a failed download keeps the view, retries three times, then reports; retry() starts over', async () => {
    vi.useFakeTimers();
    const engine = fakeEngine();
    let failures = 4;
    const load = vi.fn(() => (failures-- > 0 ? Promise.reject(new Error('offline')) : Promise.resolve(engine)));
    const { controller, states, view } = mount(load);
    controller.update(request(BASE));
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    expect(states).toEqual([]);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1499);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3000);
    // The original attempt and three retries have failed.
    expect(load).toHaveBeenCalledTimes(4);
    expect(states.at(-1)).toEqual({ view: { kind: 'source' }, loadFailed: true });
    expect(vi.getTimerCount()).toBe(0);
    controller.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(5);
    expect(states.at(-1)).toEqual({ view: view(), loadFailed: false });
    expect(view()).toMatchObject({ kind: 'diagram', svg: BASE });
    controller.dispose();
  });
});

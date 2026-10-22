import { expect, test, vi } from 'vitest';
import { createOndineLoader, createPeleLoader } from './diagramEngines';
import { createDiagramController, type DiagramState } from './diagram';

const tick = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};

test.each([createPeleLoader, createOndineLoader])('optional loader is lazy, shared and retryable', async (create) => {
  const render = vi.fn(() => ({ svg: '<svg/>', type: 'flowchart' }));
  const download = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ render });
  const load = create(download);
  expect(download).not.toHaveBeenCalled();
  await expect(load()).rejects.toThrow('offline');
  const [a, b] = await Promise.all([load(), load()]);
  expect(a).toBe(b);
  expect(download).toHaveBeenCalledTimes(2);
  await expect(a.render('unique-id', 'graph LR; A-->B', false)).resolves.toEqual({
    svg: '<svg/>',
    diagramType: 'flowchart',
  });
  expect(render).toHaveBeenCalledWith('graph LR; A-->B', { idPrefix: 'unique-id', limit: 50_000 });
});

test('SVG engines preserve streaming corrections, size limits and unique IDs without Mermaid initialization', async () => {
  const render = vi.fn((source: string) => {
    if (source === 'broken') throw new Error('invalid diagram');
    return { svg: '<svg/>', type: 'flowchart' };
  });
  const load = createPeleLoader(async () => ({ render }));
  const states: DiagramState[] = [];
  const controller = createDiagramController(load, (state) => states.push(state));
  const update = (code: string, streaming = true) =>
    controller.update({ code, streaming, dark: false, active: true, interval: 0 });
  update('valid');
  await tick();
  expect(states.at(-1)?.view.kind).toBe('diagram');
  update('broken');
  await tick();
  expect(states.at(-1)?.view.kind).toBe('diagram');
  update('broken', false);
  await tick();
  expect(states.at(-1)?.view).toMatchObject({ kind: 'error', reason: 'render', message: 'invalid diagram' });
  update('x'.repeat(50_001), false);
  await tick();
  expect(states.at(-1)?.view).toMatchObject({ kind: 'error', reason: 'tooLarge' });
  expect(render).toHaveBeenCalledTimes(3);
  controller.dispose();
});

test('native adapter options survive while IDs stay unique and limits are enforced', async () => {
  const render = vi.fn((_code: string, _options?: { fontSize?: number; limit?: number; idPrefix?: string }) => ({
    svg: '<svg/>',
  }));
  const engine = await createPeleLoader(async () => ({ render }), { renderOptions: { fontSize: 20, limit: 12 } })();
  await engine.render('owned-id', 'valid', false);
  expect(render).toHaveBeenCalledWith('valid', { fontSize: 20, limit: 12, idPrefix: 'owned-id' });
  expect(engine).toMatchObject({ maxTextSize: 12, palette: 'pele' });
});

test('only known unsupported types trigger a single fallback; syntax, unknown prefixes and limits do not', async () => {
  const fallbackRender = vi.fn(async () => ({ svg: '<svg data-fallback="true"/>' }));
  const fallback = vi.fn(async () => ({ kind: 'svg' as const, render: fallbackRender }));
  for (const diagnostic of [
    { code: 'syntax', type: 'flowchart' },
    { code: 'unsupported-diagram', type: null },
    { code: 'limit', type: 'flowchart' },
    { code: 'unsupported-diagram', type: 'sequence' },
  ]) {
    const load = createOndineLoader(async () => ({
      render() {
        throw diagnostic;
      },
    }));
    const states: DiagramState[] = [];
    const controller = createDiagramController(load, (s) => states.push(s), fallback);
    controller.update({ code: 'diagram', dark: false, active: true, streaming: false, interval: 0 });
    await tick();
    expect(states.at(-1)?.view.kind).toBe(diagnostic.type === 'sequence' ? 'diagram' : 'error');
    controller.dispose();
  }
  expect(fallback).toHaveBeenCalledTimes(1);
  expect(fallbackRender).toHaveBeenCalledTimes(1);
});

test('fallback import failures use the bounded load retry budget and manual retry can recover', async () => {
  vi.useFakeTimers();
  const load = createPeleLoader(async () => ({
    render() {
      throw { code: 'unsupported-diagram', type: 'sequence' };
    },
  }));
  let offline = true;
  const fallback = vi.fn(async () => {
    if (offline) throw new Error('offline');
    return { kind: 'svg' as const, render: async () => ({ svg: '<svg/>' }) };
  });
  const states: DiagramState[] = [];
  const controller = createDiagramController(load, (s) => states.push(s), fallback);
  controller.update({ code: 'sequenceDiagram', dark: false, active: true, streaming: false, interval: 0 });
  await tick();
  for (let i = 0; i < 3; i++) {
    await vi.advanceTimersByTimeAsync(1500);
    await tick();
  }
  expect(states.at(-1)?.loadFailed).toBe(true);
  expect(fallback).toHaveBeenCalledTimes(4);
  offline = false;
  controller.retry();
  await tick();
  expect(states.at(-1)?.view.kind).toBe('diagram');
  expect(states.at(-1)?.loadFailed).toBe(false);
  controller.dispose();
  vi.useRealTimers();
});

test('a current SVG can report binding errors after pause/resume, but a replaced SVG cannot', async () => {
  const states: DiagramState[] = [];
  const controller = createDiagramController(
    createPeleLoader(async () => ({ render: () => ({ svg: '<svg/>' }) })),
    (s) => states.push(s)
  );
  const request = { code: 'A', dark: false, streaming: false, active: true, interval: 0 };
  controller.update(request);
  await tick();
  const first = states.at(-1)!.view;
  controller.dispose();
  controller.update(request);
  await tick();
  if (first.kind !== 'diagram') throw new Error('expected diagram');
  first.onBindError?.(new Error('rebind failed'));
  expect(states.at(-1)?.view).toMatchObject({ kind: 'error', message: 'rebind failed' });
  controller.retry();
  await tick();
  first.onBindError?.(new Error('stale binding'));
  expect(states.at(-1)?.view.kind).toBe('diagram');
  controller.dispose();
});

test('clearing the final source removes the streamed SVG and allows the same source to render again', async () => {
  const render = vi.fn(async () => ({ svg: '<svg/>' }));
  const states: DiagramState[] = [];
  const controller = createDiagramController(
    async () => ({ kind: 'svg', render }),
    (s) => states.push(s)
  );
  const request = { code: 'A', dark: false, streaming: true, active: true, interval: 0 };
  controller.update(request);
  await tick();
  expect(states.at(-1)?.view.kind).toBe('diagram');
  controller.update({ ...request, code: '', streaming: false });
  await tick();
  expect(states.at(-1)).toEqual({ view: { kind: 'source' }, loadFailed: false });
  expect(render).toHaveBeenCalledTimes(1);
  controller.update({ ...request, streaming: false });
  await tick();
  expect(states.at(-1)?.view.kind).toBe('diagram');
  expect(render).toHaveBeenCalledTimes(2);
  controller.dispose();
});

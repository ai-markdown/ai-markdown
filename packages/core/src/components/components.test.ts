import { describe, expect, test, vi, afterEach } from 'vitest';
import type { Element } from 'hast';
import { extractCode, projectTable, serializeTable, normalizeRenderers } from './nodes';
import { createDiagramController, type DiagramEngine, type DiagramRequest, type DiagramState } from './diagram';
const el = (tagName: string, children: Element['children'] = [], properties: Element['properties'] = {}): Element => ({
  type: 'element',
  tagName,
  properties,
  children,
});
const text = (value: string) => ({ type: 'text' as const, value });
afterEach(() => vi.useRealTimers());
describe('component contracts', () => {
  test('strict fence extraction keeps fragmented raw text and rejects extra semantics', () => {
    const node = el('pre', [el('code', [text('a'), text('\nb')], { className: ['language- Mermaid '] })]);
    expect(extractCode(node)).toEqual({ code: 'a\nb', language: 'mermaid' });
    expect(extractCode({ ...node, properties: { id: 'preserve' } })).toBeNull();
    expect(extractCode(el('pre', [el('code', [el('b')])]))).toBeNull();
    expect(extractCode(el('pre', [el('code', [text('x')], { className: ['special'] })]))).toBeNull();
    expect(normalizeRenderers({ ' Mermaid ': false })).toEqual({ mermaid: false });
    expect(() => normalizeRenderers({ Mermaid: false, mermaid: true })).toThrow('Duplicate');
  });
  test('table projection preserves semantic text, empty cells, math once and line breaks', () => {
    const math = el(
      'span',
      [
        el('math', [el('annotation', [text('x^2')], { encoding: 'application/x-tex' })]),
        el('span', [text('visual duplicate')]),
      ],
      { className: ['katex'] }
    );
    const node = el('table', [
      el('tbody', [
        el('tr', [
          el('td', [el('a', [text('Label')]), el('br'), el('img', [], { alt: 'image' })]),
          el('td', [math]),
          el('td'),
        ]),
      ]),
    ]);
    expect(projectTable(node)).toEqual({ rows: [['Label\nimage', 'x^2', '']] });
    expect(projectTable(el('table', [el('tr', [el('td', [], { colSpan: 2 })])]))).toHaveProperty('reason');
    expect(projectTable(el('table', [el('tr', [el('td', [el('table')])])]))).toHaveProperty('reason');
    expect(projectTable(el('table', [el('tr', [el('td')]), el('tr', [el('td'), el('td')])]))).toHaveProperty('reason');
  });
  test('spreadsheet escaping and formula protection are separate', () => {
    expect(serializeTable([['=cmd()', '+SUM(A1)', '@x', '-SUM(A1)', '-1.5e2', 'a,"b', '', 'x\ny']])).toBe(
      '\'=cmd(),\'+SUM(A1),\'@x,\'-SUM(A1),-1.5e2,"a,""b",,"x\ny"'
    );
    expect(serializeTable([['a', 'b\tc', '']], '\t')).toBe('a\t"b\tc"\t');
  });
});
const request = (code: string, rest: Partial<DiagramRequest> = {}): DiagramRequest => ({
  code,
  dark: false,
  streaming: false,
  active: true,
  resetKey: 'one',
  interval: 300,
  ...rest,
});
const tick = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const fakeEngine = (): DiagramEngine => ({
  initialize() {},
  parse: async () => true,
  render: async (_, code) => ({ svg: code }),
});
test('a slow obsolete render cannot publish; shared owners serialize engine access', async () => {
  let release!: (value: { svg: string }) => void;
  const engine = fakeEngine();
  engine.render = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    )
    .mockImplementation(async (_, code: string) => ({ svg: code }));
  const a: DiagramState[] = [],
    b: DiagramState[] = [];
  const first = createDiagramController(
    async () => engine,
    (state) => a.push(state)
  );
  const second = createDiagramController(
    async () => engine,
    (state) => b.push(state)
  );
  first.update(request('old'));
  await tick();
  first.update(request('new', { resetKey: 'two' }));
  second.update(request('other', { dark: true }));
  await tick();
  expect(engine.render).toHaveBeenCalledTimes(1);
  release({ svg: 'obsolete' });
  await tick();
  expect(a.some((s) => s.svg === 'obsolete')).toBe(false);
  expect(a.at(-1)?.svg).toBe('new');
  expect(b.at(-1)?.svg).toBe('other');
  first.dispose();
  second.dispose();
});
test('stream throttles without starvation; final-only update flushes, hidden/unmount cancels', async () => {
  vi.useFakeTimers();
  const engine = fakeEngine();
  engine.render = vi.fn(engine.render);
  const controller = createDiagramController(
    async () => engine,
    () => {}
  );
  controller.update(request('a', { streaming: true }));
  await vi.advanceTimersByTimeAsync(200);
  controller.update(request('ab', { streaming: true }));
  await vi.advanceTimersByTimeAsync(100);
  expect(engine.render).toHaveBeenLastCalledWith(expect.any(String), 'ab');
  controller.update(request('abc', { streaming: true }));
  controller.update(request('abc'));
  await tick();
  expect(engine.render).toHaveBeenLastCalledWith(expect.any(String), 'abc');
  controller.update(request('abcd', { streaming: true }));
  controller.update(request('abcd', { active: false }));
  await vi.runAllTimersAsync();
  expect(engine.render).toHaveBeenCalledTimes(2);
  controller.update(request('abcde', { streaming: true }));
  controller.dispose();
  await vi.runAllTimersAsync();
  expect(engine.render).toHaveBeenCalledTimes(2);
});
test('parse failures retain the last diagram during append, report final errors, and retry', async () => {
  const engine = fakeEngine(),
    states: DiagramState[] = [];
  engine.parse = vi
    .fn()
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true);
  const controller = createDiagramController(
    async () => engine,
    (value) => states.push(value)
  );
  controller.update(request('a'));
  await tick();
  controller.update(request('ab', { streaming: true, interval: 0 }));
  await tick();
  expect(states.at(-1)).toMatchObject({ status: 'loading', svg: 'a' });
  controller.update(request('ab'));
  await tick();
  expect(states.at(-1)).toMatchObject({ status: 'error', svg: 'a' });
  controller.update(request('ab'));
  await tick();
  expect(states.at(-1)).toMatchObject({ status: 'ready', svg: 'ab' });
  controller.dispose();
});

test('image scroll locks are shared and released once per owner', async () => {
  const { lockImagePreviewScroll } = await import('./scroll');
  const body = { style: { overflow: 'auto' } };
  const first = lockImagePreviewScroll(body),
    second = lockImagePreviewScroll(body);
  expect(body.style.overflow).toBe('hidden');
  first();
  first();
  expect(body.style.overflow).toBe('hidden');
  second();
  expect(body.style.overflow).toBe('auto');
});

test('engine load failure is actionable while streaming and retries without stale publication', async () => {
  const states: DiagramState[] = [];
  const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(fakeEngine());
  const controller = createDiagramController(load, (value) => states.push(value));
  controller.update(request('a', { streaming: true, interval: 0 }));
  await tick();
  expect(states.at(-1)).toMatchObject({ status: 'error', error: 'Diagram engine could not load: offline' });
  controller.update(request('a'));
  await tick();
  expect(states.at(-1)).toMatchObject({ status: 'ready', svg: 'a' });
  controller.dispose();
});

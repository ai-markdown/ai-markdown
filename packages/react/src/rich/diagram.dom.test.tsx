// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { useDiagram, DiagramViewport, type DiagramInput, type DiagramView } from './diagram';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  host?.remove();
});
const input = (load: DiagramInput['load'], resetKey = 'one'): DiagramInput => ({
  load,
  resetKey,
  code: 'A',
  colorScheme: 'light',
  streaming: false,
  active: true,
  intervalMs: 0,
});
function View({ value }: { value: DiagramInput }) {
  const { state, retry } = useDiagram(value);
  return (
    <>
      <output>{state.view.kind}</output>
      <DiagramViewport view={state.view} />
      <button onClick={retry}>Retry</button>
    </>
  );
}
const settle = async () => {
  for (let i = 0; i < 5; i++) await act(async () => {});
};
const mount = async (value: DiagramInput) => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <StrictMode>
        <View value={value} />
      </StrictMode>
    )
  );
  await settle();
};
test('SSR does not load; StrictMode restores the session after effect cleanup', async () => {
  const load = vi.fn(async () => ({ kind: 'svg' as const, render: async () => ({ svg: '<svg data-engine="one"/>' }) }));
  expect(renderToString(<View value={input(load)} />)).toContain('source');
  expect(load).not.toHaveBeenCalled();
  await mount(input(load));
  expect(host.querySelector('svg')).not.toBeNull();
});
test('loader/reset identity starts with source and isolates an old pending render', async () => {
  let release!: (result: { svg: string }) => void;
  const slow = async () => ({
    kind: 'svg' as const,
    render: () =>
      new Promise<{ svg: string }>((resolve) => {
        release = resolve;
      }),
  });
  const fast = async () => ({ kind: 'svg' as const, render: async () => ({ svg: '<svg data-engine="new"/>' }) });
  await mount(input(slow));
  await act(async () =>
    root!.render(
      <StrictMode>
        <View value={input(fast, 'two')} />
      </StrictMode>
    )
  );
  expect(host.querySelector('output')?.textContent).toBe('source');
  await act(async () => release({ svg: '<svg data-engine="old"/>' }));
  await settle();
  expect(host.querySelector('svg')?.getAttribute('data-engine')).toBe('new');
});
test('viewport binds once per installation and cleans external listeners on replacement and unmount', async () => {
  const clean = vi.fn(),
    bind = vi.fn(() => clean);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const view: DiagramView = { kind: 'diagram', svg: '<svg/>', chartType: 'flowchart', bind };
  await act(async () => root!.render(<DiagramViewport view={view} />));
  expect(bind).toHaveBeenCalledTimes(1);
  await act(async () => root!.render(<DiagramViewport view={{ kind: 'source' }} />));
  expect(clean).toHaveBeenCalledTimes(1);
  await act(async () => root!.render(<DiagramViewport view={view} />));
  await act(async () => root!.unmount());
  root = undefined;
  expect(clean).toHaveBeenCalledTimes(2);
});
test('binding failure becomes a retryable diagram error and removes partial SVG', async () => {
  let broken = true;
  const load = async () => ({
    kind: 'svg' as const,
    render: async () => ({
      svg: '<svg/>',
      bindFunctions() {
        if (broken) throw new Error('bind failed');
      },
    }),
  });
  await mount(input(load));
  expect(host.querySelector('output')?.textContent).toBe('error');
  expect(host.querySelector('svg')).toBeNull();
  broken = false;
  await act(async () => host.querySelector('button')!.click());
  await settle();
  expect(host.querySelector('svg')).not.toBeNull();
});

test('native palette overrides win, dark defaults follow input, and cloned SVG retains colors', async () => {
  const { createPeleLoader } = await import('./diagram');
  const load = createPeleLoader(async () => ({
    render: () => ({ svg: '<svg class="pele"><text>hello</text></svg>' }),
  }));
  await mount(input(load));
  expect(host.querySelector('svg')?.style.getPropertyValue('--pele-bg')).toBe('#ffffff');
  await act(async () => root!.render(<View value={{ ...input(load), colorScheme: 'dark' }} />));
  await settle();
  const svg = host.querySelector('svg')!;
  expect(svg.style.getPropertyValue('--pele-bg')).toBe('#242424');
  expect((svg.cloneNode(true) as SVGElement).style.getPropertyValue('--pele-fg')).toBe('#eeeeee');
});

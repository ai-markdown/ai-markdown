// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { act, memo, startTransition, useContext, useEffect, useLayoutEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AIMarkdownDocuments } from '../AIMarkdownDocuments';
import { SmoothCoordinatorContext, type SmoothCoordinator } from './coordinator';
import { useDocumentSmoothStream } from './useDocumentSmoothStream';

// Real scheduler tasks are essential: act alone flushes away this interleaving.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
const created: SmoothCoordinator[] = [];
const events: string[] = [];
vi.mock('./coordinator', async (original) => {
  const mod = await original<typeof import('./coordinator')>();
  return {
    ...mod,
    createSmoothCoordinator: (onEmpty?: () => void) => {
      const index = created.length + 1;
      const scope = mod.createSmoothCoordinator(() => {
        events.push(`empty ${index}`);
        onEmpty?.();
      });
      const register = scope.register.bind(scope);
      scope.register = (id) => {
        events.push(`register ${index}`);
        register(id);
      };
      const release = scope.release.bind(scope);
      scope.release = (id) => {
        events.push(`release ${index}`);
        release(id);
      };
      created.push(scope);
      return scope;
    },
  };
});

const handle = { phase: (_: number) => {}, content: (_: string) => {} };
const commits: Record<string, number> = {};
const Chunk = memo(function Chunk({ name }: { name: string }) {
  const ctx = useContext(SmoothCoordinatorContext)!;
  events.push(`resolve ${created.indexOf(ctx.getCoordinator('doc')) + 1}`);
  useLayoutEffect(() => {
    commits[name] = (commits[name] ?? 0) + 1;
  });
  const [content, setContent] = useState(name === 'C' ? '' : name);
  useEffect(() => {
    if (name === 'C') handle.content = setContent;
  }, [name]);
  const output = useDocumentSmoothStream({ documentId: 'doc', content, streaming: name !== 'C' || content === '' });
  return <span data-chunk={name}>{output.content}</span>;
});
function ScheduleB() {
  useLayoutEffect(() => {
    startTransition(() => handle.phase(2));
  }, []);
  return null;
}
function Harness() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    handle.phase = setPhase;
  }, []);
  return (
    <AIMarkdownDocuments>
      {phase === 0 && <Chunk name="A" />}
      {phase === 1 && <ScheduleB />}
      {phase >= 2 && <Chunk name="B" />}
      {phase >= 3 && <Chunk name="C" />}
    </AIMarkdownDocuments>
  );
}
const settle = async (predicate: () => boolean) => {
  const deadline = Date.now() + 5000;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  expect(predicate(), events.join(' | ')).toBe(true);
};
let root: Root | undefined;
let container: HTMLElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
});

test('eviction between render and effects preserves one queue and successor gating', { timeout: 15000 }, async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<Harness />));
  expect(created).toHaveLength(1);
  handle.phase(1);
  await settle(() => container!.textContent === 'B' && events.includes('empty 1'));
  const release = events.indexOf('release 1');
  const doomedRender = events.indexOf('resolve 1', release);
  expect(release).toBeGreaterThanOrEqual(0);
  expect(doomedRender, events.join(' | ')).toBeGreaterThan(release);
  expect(events.indexOf('empty 1'), events.join(' | ')).toBeGreaterThan(doomedRender);

  handle.phase(3);
  await settle(() => container!.querySelector('[data-chunk="C"]') !== null);
  await act(async () => handle.content('C must wait'));
  const live = created.filter((scope) => scope.order.length > 0);
  expect(live, events.join(' | ')).toHaveLength(1);
  expect(live[0]).toBe(created.at(-1));
  expect(live[0].order).toHaveLength(2);
  expect(container.querySelector('[data-chunk="C"]')!.textContent).toBe('');

  // Ordinary queue activity must not force a commit of the settled predecessor.
  const before = commits.B;
  await act(async () => {
    live[0].markDone(live[0].order[0]);
  });
  await settle(() => container!.querySelector('[data-chunk="C"]')!.textContent === 'C must wait');
  expect(commits.B).toBe(before);
});

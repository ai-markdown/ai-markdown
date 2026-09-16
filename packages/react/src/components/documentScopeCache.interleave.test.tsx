// @vitest-environment jsdom
/**
 * Attempted reproduction of the scope-cache eviction race (2026-09-11
 * review conjecture) against the REAL React scheduler:
 *
 *   1. chunk A's passive cleanup releases the last symbol of registry R1
 *      (`releaseSymbol` queues the empty check as a microtask);
 *   2. in the SAME scheduler task, a transition render mounts chunk B,
 *      whose render resolves `getRegistry(id)` to the still-cached R1;
 *   3. the task ends (or yields) before B's passive effects run; the
 *      microtask fires `onEmpty`, evicting R1 from the cache;
 *   4. B's registration effect registers into the evicted R1, and a later
 *      chunk C resolves `getRegistry(id)` to a fresh R2 — a split document.
 *
 * Steps 1 and 2 share a task by construction in React 19:
 * `performWorkOnRootViaSchedulerTask` flushes pending passive effects
 * first and then renders the pending lanes. The transition that mounts B
 * is started from a layout effect of the commit that unmounts A, so it is
 * pending exactly when that task runs. Nothing is mocked but the registry
 * factory (wrapped to trace events); the test waits on real macrotasks
 * between steps.
 *
 * RESULT (documented attempt): steps 1-3 happen exactly as conjectured —
 * the trace shows `release R1`, then B's render resolving R1, then
 * `onEmpty R1` — but step 4 does not. The release cleanup bumps R1's
 * `version` in the same microtask, before `onEmpty`, and every chunk reads
 * its registry's version through `useSyncExternalStore`. React then
 * guarantees a synchronous re-render of B before any commit can be
 * observed with the stale scope: if the bump lands while the concurrent
 * render is still in progress, the consistency check at the end of the
 * render phase (`isRenderConsistentWithExternalStores`) discards the
 * render and re-renders synchronously; if it lands after commit but before
 * B's passive effects, the subscribe effect re-reads the snapshot
 * (`subscribeToStore` → `checkIfSnapshotChanged` → `forceStoreRerender`)
 * and the sync re-render is flushed at the end of that same passive flush.
 * Either way B re-resolves `getRegistry(id)` to the fresh registry before
 * another task can mount C. See the invariant paragraph in
 * documentScopeCache.ts.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  act,
  memo,
  startTransition,
  useEffect,
  useLayoutEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { RegistryController } from '@ai-markdown/engine';
import AIMarkdown, { AIMarkdownDocuments } from '..';

// Updates outside `act` must go through the real scheduler; the act
// environment flag would only add warnings for what this test does on
// purpose.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

type Created = RegistryController & { chunkOrder: symbol[] };
const created: Created[] = [];
/** Event trace — the proof that the interleaving actually happened. */
const events: string[] = [];
vi.mock('@ai-markdown/engine', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@ai-markdown/engine')>();
  return {
    ...mod,
    createRegistry: (onEmpty?: () => void) => {
      const index = created.length + 1;
      const registry = mod.createRegistry(() => {
        events.push(`onEmpty R${index}`);
        onEmpty?.();
      }) as Created;
      const registerChunk = registry.registerChunk.bind(registry);
      registry.registerChunk = (reactId, footnotes, links, documentIndex) => {
        events.push(`register R${index} chunk=${documentIndex}`);
        return registerChunk(reactId, footnotes, links, documentIndex);
      };
      const releaseSymbol = registry.releaseSymbol.bind(registry);
      registry.releaseSymbol = (reactId) => {
        events.push(`release R${index}`);
        releaseSymbol(reactId);
      };
      created.push(registry);
      return registry;
    },
  };
});
/** Every chunk's render resolves its registry through this hook; the
 *  wrapper records WHICH registry a render got. */
vi.mock('./AIMarkdownDocuments', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./AIMarkdownDocuments')>();
  return {
    ...mod,
    useDocumentRegistry: (documentId: string | undefined, explicit?: boolean) => {
      const registry = mod.useDocumentRegistry(documentId, explicit);
      if (registry) events.push(`resolve R${created.indexOf(registry as Created) + 1}`);
      return registry;
    },
  };
});

const CHUNK_A = 'Alpha.';
const CHUNK_B = 'Beta.\n\n[^n]: Body';
const CHUNK_C = 'See[^n].';

/** Real macrotasks (the scheduler's MessageChannel work loop) and the
 *  microtasks queued between them. */
const tick = (ms = 40) => new Promise<void>((resolve) => setTimeout(resolve, ms));
// The scheduler runs for real here (no act environment), and how long a
// transition render plus its passive effects take depends on the machine:
// a fixed 40 ms wait was enough locally and came up empty on a shared CI
// core. Poll for the rendered text instead; the interleaving the test is
// about is checked on the event trace, not on the wait.
const settled = async (predicate: () => boolean, deadlineMs = 5000): Promise<void> => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > deadlineMs) return;
    await tick(20);
  }
};

/** Starts the transition that mounts chunk B from INSIDE the commit that
 *  unmounts chunk A, so the transition is the pending lane when the next
 *  scheduler task flushes A's passive cleanup. */
function ScheduleB({ setPhase }: { setPhase: Dispatch<SetStateAction<number>> }) {
  useLayoutEffect(() => {
    startTransition(() => setPhase(2));
  }, [setPhase]);
  return null;
}

// B must not re-render when C mounts, or it would re-resolve the scope on
// that render and hide a split by migrating itself.
const ChunkB = memo(function ChunkB() {
  return <AIMarkdown content={CHUNK_B} documentId="doc" documentIndex={1} />;
});

/** The test drives the phase through this handle; it is assigned from an
 *  effect, never during render. */
const handle: { setPhase: Dispatch<SetStateAction<number>> } = { setPhase: () => {} };

function Harness() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    handle.setPhase = setPhase;
  }, []);
  return (
    <AIMarkdownDocuments>
      {phase === 0 && <AIMarkdown content={CHUNK_A} documentId="doc" documentIndex={0} />}
      {phase === 1 && <ScheduleB setPhase={setPhase} />}
      {phase >= 2 && <ChunkB />}
      {phase >= 3 && <AIMarkdown content={CHUNK_C} documentId="doc" documentIndex={2} />}
    </AIMarkdownDocuments>
  );
}

describe('document scope cache: release / transition-render / onEmpty interleaving', () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    created.length = 0;
    events.length = 0;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  test('a chunk rendered in the task that released the previous registry does not split the document', async () => {
    root = createRoot(container);
    await act(async () => root.render(<Harness />));
    expect(created).toHaveLength(1);
    expect(created[0].chunkOrder).toHaveLength(1);

    // Step 1: a default-lane update unmounts A. Its passive cleanup is not
    // flushed synchronously (not a sync lane) — it is pending for the next
    // scheduler task, which the layout effect above has just given a
    // transition to render.
    handle.setPhase(1);
    await settled(() => container.textContent?.includes('Beta.') === true);
    expect(container.textContent).toContain('Beta.');

    // Anti-vacuity: the interleaving the conjecture needs did happen —
    // R1 was released, THEN B's render resolved the still-cached R1, THEN
    // onEmpty evicted it. (Without this the test would compare a happy
    // path against itself.)
    const trace = events.join(' | ');
    const release = events.indexOf('release R1');
    const doomedRender = events.indexOf('resolve R1', release);
    const evicted = events.indexOf('onEmpty R1');
    expect(release, trace).toBeGreaterThanOrEqual(0);
    expect(doomedRender, trace).toBeGreaterThan(release);
    expect(evicted, trace).toBeGreaterThan(doomedRender);

    // Mount C without re-rendering B.
    handle.setPhase(3);
    await settled(() => container.querySelector('sup a[data-footnote-ref]') !== null);
    expect(container.textContent).toContain('See');

    // Step 4 must not hold: every chunk alive is registered in ONE
    // registry — the one the cache hands out now — and B's definition
    // resolves C's reference.
    const evidence = `${created.map((r, i) => `R${i + 1}:${r.chunkOrder.length}`).join(' ')} — ${events.join(' | ')}`;
    const live = created.filter((r) => r.chunkOrder.length > 0);
    expect(live, evidence).toHaveLength(1);
    expect(live[0], evidence).toBe(created[created.length - 1]);
    expect(live[0].chunkOrder, evidence).toHaveLength(2);
    expect(container.querySelector('sup a[data-footnote-ref]'), evidence).not.toBeNull();
  });
});

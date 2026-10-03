/** Synchronous scope identity without owning abandoned render allocations.
 * Mounted consumers and pending renders keep their scopes alive. The cache
 * only observes them; otherwise a render that never commits cannot run the
 * registration cleanup needed to release a strongly cached scope.
 *
 * Eviction and in-flight renders (2026-09-11 review). `onEmpty` fires from
 * the registry's deferred `releaseSymbol` cleanup — a microtask — so a
 * render can resolve a scope that is evicted before that render's effects
 * run: chunk A's passive cleanup releases the last symbol, the SAME
 * scheduler task then renders chunk B (React 19 flushes pending passive
 * effects at the start of `performWorkOnRootViaSchedulerTask` and renders
 * the pending lanes right after), B's render gets the still-cached scope,
 * and the microtask evicts it before B's registration effect. What keeps
 * this from splitting a document — B registered in the evicted scope, a
 * later chunk C in a fresh one — is not this cache but the pair of
 * guarantees a consumer relies on:
 *
 *   - The registry bumps `version` in the same microtask, BEFORE calling
 *     `onEmpty` (documentRegistry.ts, the ordering note in `releaseSymbol`).
 *   - Every chunk reads that version through `useSyncExternalStore`. React
 *     re-renders synchronously whenever a store changed under a render:
 *     if the bump lands while the concurrent render is in progress, the
 *     tearing check at the end of the render phase
 *     (`isRenderConsistentWithExternalStores`) discards the render and
 *     re-renders synchronously; if it lands after the commit but before
 *     the passive effects, the subscribe effect re-reads the snapshot
 *     (`subscribeToStore` → `checkIfSnapshotChanged` → `forceStoreRerender`)
 *     and that sync re-render is flushed at the end of the same passive
 *     flush. In both cases the chunk re-resolves `get(id)` — a miss now —
 *     and registers into the fresh scope before another task can mount a
 *     sibling; a registration that did land in the evicted scope is undone
 *     by the allocation effect's cleanup on the same re-render.
 *
 * So the invariant for the registry scope is: a scope handed out by
 * `get()` is either still the cached one when the consumer's effects run,
 * or its version has changed and the consumer is already scheduled to
 * re-render before those effects can be observed.
 * `documentScopeCache.interleave.test.tsx` drives the exact interleaving
 * above against the real scheduler and records the trace (`release R1`,
 * `resolve R1`, `onEmpty R1`, `resolve R2`, `register R2`).
 *
 * The smooth-coordinator consumer also uses `useSyncExternalStore`, reading
 * the cached scope identity. Empty-release notifies subscribers after cache
 * eviction, and React's pre-subscription consistency check covers an eviction
 * between render and effects. Queue mutations that retain the scope do not
 * cause extra renders. `useDocumentSmoothStream.interleave.test.tsx` exercises
 * the real scheduler interleaving and verifies successor gating. New scope
 * types need equivalent protection against registering an evicted scope.
 */
/** A cache of per-document scopes keyed by id. */
export interface DocumentScopeCache<T extends object> {
  get(id: string): T;
}

/** Strong-reference fallback for runtimes without `WeakRef` /
 *  `FinalizationRegistry` (ES2021). The Map owns every scope it hands out,
 *  so a render that resolves a scope and never commits leaves that scope in
 *  the cache until a committed consumer registers into it and later runs
 *  the release that fires `onEmpty` — there is no GC-based eviction here.
 *  What still works: scope identity per id, and eviction by refcount
 *  through `onEmpty`, which is the path every mounted consumer takes. The
 *  cost is bounded by the number of distinct ids resolved without a
 *  commit, which for a document wrapper is the number of documents whose
 *  first chunk suspended or was discarded before mounting. */
function createStrongScopeCache<T extends object>(create: (onEmpty: () => void) => T): DocumentScopeCache<T> {
  const entries = new Map<string, T>();
  return {
    get(id: string): T {
      const existing = entries.get(id);
      if (existing) return existing;
      const scope = create(() => {
        // A release from an evicted scope must not evict its replacement.
        if (entries.get(id) === scope) entries.delete(id);
      });
      entries.set(id, scope);
      return scope;
    },
  };
}

export function createDocumentScopeCache<T extends object>(create: (onEmpty: () => void) => T): DocumentScopeCache<T> {
  // Detected per cache, not per module, so a runtime that installs the
  // globals late (or a test that removes them) is observed at mount time.
  if (typeof WeakRef !== 'function' || typeof FinalizationRegistry !== 'function') {
    return createStrongScopeCache(create);
  }
  const entries = new Map<string, WeakRef<T>>();
  const collected = new FinalizationRegistry<{ id: string; ref: WeakRef<T> }>(({ id, ref }) => {
    // Collection can arrive after onEmpty and a new allocation of this id.
    if (entries.get(id) === ref) entries.delete(id);
  });
  return {
    get(id: string): T {
      const existing = entries.get(id)?.deref();
      if (existing) return existing;
      const scope = create(() => {
        if (entries.get(id) === ref) entries.delete(id);
        collected.unregister(ref);
      });
      const ref = new WeakRef(scope);
      entries.set(id, ref);
      // Holdings must never contain scope: that would keep the target alive.
      collected.register(scope, { id, ref }, ref);
      return scope;
    },
  };
}

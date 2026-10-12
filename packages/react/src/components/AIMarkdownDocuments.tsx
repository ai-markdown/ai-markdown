/**
 * Optional outer wrapper enabling cross-chunk coordination for any
 * `<AIMarkdown>` instances rendered as descendants. Each unique
 * `documentId` partitions its own Registry.
 *
 * Without this wrapper, `<AIMarkdown>` instances render independently
 * (current behavior). With it, multiple chunks sharing a `documentId`
 * coordinate footnote numbering, linkReference/imageReference resolution,
 * and anchor jumps across chunks.
 *
 * @module components/AIMarkdownDocuments
 */
import { createContext, useContext, useMemo, useState, type PropsWithChildren, type FC } from 'react';
import { createRegistry, type Registry, type RegistryController } from '@ai-markdown/engine';
import { createDocumentScopeCache } from './documentScopeCache';
import {
  createSmoothCoordinator,
  SmoothCoordinatorContext,
  type SmoothCoordinatorContextValue,
} from './smoothStream/coordinator';

interface AIMarkdownDocumentsContextValue {
  /** Returns the registry for a given documentId. Holds the internal
   *  (mutator-bearing) shape; {@link useDocumentRegistry} narrows the
   *  return type to the public read-only {@link Registry} surface so
   *  external consumers can't drive the registry directly. Internal
   *  callers (`MarkdownContent`, tests via `__internalGetContext`) keep
   *  the wider view. */
  getRegistry: (documentId: string) => RegistryController;
  /** Identity token of a document in this wrapper; see `AIMarkdownDocumentInfo.scope`. */
  getScope: (documentId: string) => object;
  preserveOrphanReferences: boolean;
}

const AIMarkdownDocumentsContext = createContext<AIMarkdownDocumentsContextValue | null>(null);

export interface AIMarkdownDocumentsProps extends PropsWithChildren {
  /**
   * Default `true`. Unconditionally controls orphan-reference protection
   * for all chunks under this wrapper, overriding each chunk's own
   * `preserveOrphanReferences` prop. Does not control cross-chunk
   * coordination itself (that's gated by wrapper presence + `documentId`).
   */
  preserveOrphanReferences?: boolean;
  /**
   * Default `true`. Turn-taking for smooth-streaming chunks: chunks that
   * share a `documentId` and stream from empty reveal sequentially (chunk
   * N fully revealed before chunk N+1 starts — one typewriter, one
   * cursor). `false` disables coordination wholesale; every
   * `AIMarkdownSmoothStream` / `useDocumentSmoothStream` under this
   * wrapper then behaves like plain `useSmoothStream`. Per-chunk opt-out
   * exists too (`smoothCoordination={false}` on the shell). Has no effect
   * on chunks that don't smooth-stream.
   */
  smoothTurnTaking?: boolean;
}

/** Message body for the "nested wrapper" misuse error / warning. Centralised
 *  so dev and prod paths emit the exact same text — easier to grep in user
 *  bug reports. */
const NESTED_WRAPPER_MESSAGE =
  '<AIMarkdownDocuments> must not be nested inside another <AIMarkdownDocuments>. Use a single top-level wrapper per coordinated scope.';

/**
 * The "happy path" implementation: allocates per-instance scope caches
 * and Provider value. Split out from `AIMarkdownDocuments` so the parent
 * component's pre-hook nesting gate (which may early-return) doesn't put
 * the hooks below behind a conditional — rules-of-hooks is then trivially
 * satisfied because every render of THIS inner component goes through all
 * the hooks in the same order.
 */
const AIMarkdownDocumentsRoot: FC<
  Required<Pick<AIMarkdownDocumentsProps, 'preserveOrphanReferences' | 'smoothTurnTaking'>> & PropsWithChildren
> = ({ preserveOrphanReferences, smoothTurnTaking, children }) => {
  // Weak entries preserve synchronous identity while a render or mounted
  // consumer owns the scope, without retaining objects from aborted renders.
  // onEmpty still evicts promptly after the final committed registration.
  const [registries] = useState(() => createDocumentScopeCache(createRegistry));
  const [coordinators] = useState(() => createDocumentScopeCache(createSmoothCoordinator));
  // A token has no registrations to count, so it never reports itself empty:
  // it is dropped when the last renderer holding it is collected.
  const [scopes] = useState(() => createDocumentScopeCache<object>(() => ({})));

  const smoothValue = useMemo<SmoothCoordinatorContextValue | null>(
    () => (smoothTurnTaking ? { getCoordinator: coordinators.get } : null),
    [smoothTurnTaking, coordinators]
  );
  const value = useMemo<AIMarkdownDocumentsContextValue>(
    () => ({ preserveOrphanReferences, getRegistry: registries.get, getScope: scopes.get }),
    [preserveOrphanReferences, registries, scopes]
  );

  return (
    <AIMarkdownDocumentsContext.Provider value={value}>
      <SmoothCoordinatorContext.Provider value={smoothValue}>{children}</SmoothCoordinatorContext.Provider>
    </AIMarkdownDocumentsContext.Provider>
  );
};

export const AIMarkdownDocuments: FC<AIMarkdownDocumentsProps> = ({
  preserveOrphanReferences = true,
  smoothTurnTaking = true,
  children,
}) => {
  const parent = useContext(AIMarkdownDocumentsContext);
  if (parent !== null) {
    // Dev: fail fast. The error makes the misuse obvious in any non-
    // production environment and prevents subtle bugs (the inner wrapper's
    // children would silently see the outer wrapper's registry / preserve-
    // orphan policy, which is almost never what a nested wrapper was
    // attempting to express).
    //
    // Prod: degrade gracefully. AI chat / document UIs that wire
    // `<AIMarkdownDocuments>` deep inside dynamic composition (RSC, portals,
    // third-party layout libs) can hit the nested-wrapper case via an
    // upstream bug — crashing the entire conversation pane is worse user
    // experience than silently rendering the inner subtree against the outer
    // wrapper. Emit a `console.error` (visible to ops dashboards / Sentry)
    // and render `children` as-is so the existing outer Provider continues
    // to apply.
    //
    // Hooks-rules note: the outer component only calls `useContext` before
    // the early return; the hooks that allocate state (`useState`, `useMemo`)
    // live in `AIMarkdownDocumentsRoot`, which is only mounted on the
    // non-nested branch. Whichever branch this instance takes, it takes
    // for its entire lifetime — React's per-instance hook order stays
    // stable and ESLint's `react-hooks/rules-of-hooks` is happy.
    //
    // The dev/prod split mirrors React's own invariant-vs-warning pattern.
    if (process.env.NODE_ENV !== 'production') {
      throw new Error(NESTED_WRAPPER_MESSAGE);
    }
    console.error(
      `[ai-react-markdown] ${NESTED_WRAPPER_MESSAGE} Falling back to the outer wrapper; the inner wrapper is a no-op.`
    );
    return <>{children}</>;
  }
  return (
    <AIMarkdownDocumentsRoot preserveOrphanReferences={preserveOrphanReferences} smoothTurnTaking={smoothTurnTaking}>
      {children}
    </AIMarkdownDocumentsRoot>
  );
};

/**
 * Returns the registry for the given `documentId`, or `null` if:
 *  - `<AIMarkdown>` is not inside an `<AIMarkdownDocuments>` wrapper, OR
 *  - `documentId` is undefined / empty string, OR
 *  - `documentIdExplicit` is `false` — i.e. the id was auto-generated rather
 *    than supplied by the consumer.
 *
 * The `documentIdExplicit` gate is the crux of the standalone-vs-coordinated
 * decision. An auto-generated id (`useId()` fallback) is non-empty and unique
 * by construction, so a chunk carrying one has nothing to coordinate with even
 * inside the wrapper — it must run standalone. Without this gate, the mere
 * presence of `<AIMarkdownDocuments>` would drag every uncoordinated chunk
 * onto the cross-chunk registry path (subscribe / allocate / evict overhead)
 * for no behavioral gain. The flag defaults to `true` so external callers who
 * pass an id directly are treated as explicit (passing an id IS the intent to
 * coordinate); the internal renderer threads through `state.documentIdExplicit`.
 *
 * Callers should treat `null` as "no coordination; run standalone path."
 */
export function useDocumentRegistry(documentId: string | undefined, documentIdExplicit = true): Registry | null {
  const ctx = useContext(AIMarkdownDocumentsContext);
  if (!ctx || !documentId || !documentIdExplicit) return null;
  return ctx.getRegistry(documentId);
}

/** The identity token shared by the renderers of one coordinated document, or
 *  null where a renderer stands alone (same rule as {@link useDocumentRegistry}). */
export function useDocumentScope(documentId: string, documentIdExplicit: boolean): object | null {
  const ctx = useContext(AIMarkdownDocumentsContext);
  if (!ctx || !documentIdExplicit) return null;
  return ctx.getScope(documentId);
}

/** Returns the effective preserveOrphanReferences for this position in the tree:
 *  the wrapper's prop value if inside one, otherwise the supplied fallback
 *  (typically the chunk's resolved `preserveOrphanReferences` prop). */
export function usePreserveOrphanReferences(fallback: boolean): boolean {
  const ctx = useContext(AIMarkdownDocumentsContext);
  return ctx?.preserveOrphanReferences ?? fallback;
}

/** @internal — for tests only. */
export function __internalGetContext(): AIMarkdownDocumentsContextValue | null {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useContext(AIMarkdownDocumentsContext);
}

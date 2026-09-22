/**
 * `useSmoothStream` with document-level turn-taking.
 *
 * Inside `<AIMarkdownDocuments>`, chunks sharing a `documentId` should read
 * as ONE typewriter: chunk N reveals completely before chunk N+1 starts,
 * with a single cursor throughout. This hook wraps an UNCHANGED
 * `useSmoothStream` with that gate:
 *
 * - A chunk that mounts with EMPTY content queues behind its earlier-mounted
 *   siblings and renders nothing (no cursor) until every one of them is
 *   done (source stopped AND reveal drained).
 * - A chunk that mounts with non-empty content passes through ungated —
 *   the mount snap presents it instantly, exactly like `useSmoothStream`
 *   (hydration, virtualization scroll-back, and mid-stream remounts must
 *   not blank out or replay; see the gate note below). It still occupies
 *   its queue slot, so later empty-mounted chunks wait for it.
 * - Without a `documentId`, or outside `<AIMarkdownDocuments>` (or with
 *   `smoothTurnTaking={false}` on the wrapper), behavior is identical to
 *   `useSmoothStream`.
 *
 * The result is props-shaped and spreads into `<AIMarkdown>` or any
 * wrapper, same as `useSmoothStream`. `documentId` must match the one the
 * rendered component receives (the hook cannot cross-check; a mismatch
 * silently loses coordination) and must be mount-stable.
 *
 * Contract shifts relative to `useSmoothStream`, both gate-inherent:
 * `onDrained` fires after the chunk's TURN completes — potentially long
 * after its source stream ended — and a content replacement that happens
 * entirely while gated DOES fire it (the reveal only ever saw empty →
 * final text, so the finally-revealed message genuinely completed).
 * `flush()` while gated is a no-op: nothing is playing yet, and skipping
 * the whole document's queue is deliberately not a per-chunk power.
 *
 * @module components/smoothStream/useDocumentSmoothStream
 */

import { useCallback, useContext, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { useSmoothStream, type UseSmoothStreamOptions, type UseSmoothStreamResult } from './useSmoothStream';
import { evaluateGateWarn, SmoothCoordinatorContext, type SmoothCoordinator } from './coordinator';

export interface UseDocumentSmoothStreamOptions extends UseSmoothStreamOptions {
  /**
   * The document this chunk belongs to — the same value the rendered
   * `<AIMarkdown>` receives. Coordination engages only when this is a
   * non-empty string AND the component sits under `<AIMarkdownDocuments>`
   * with turn-taking enabled; otherwise the hook degrades to plain
   * `useSmoothStream`. Must be mount-stable: changing it mid-life is
   * undefined behavior.
   */
  documentId?: string;
  /** Hold this queue slot before input starts, without showing a streaming
   * cursor. Clear when input starts OR when an empty result completes.
   * `streaming: false` alone still means a completed source. */
  waiting?: boolean;
}

/** Dev-only stuck-flag warning threshold (§ ordering failure modes in the
 *  turn-taking plan): a chunk pending longer than this while its earliest
 *  blocker shows no reveal progress for as long triggers a console.warn. */
const GATE_WARN_THRESHOLD_MS = 10_000;

export const useDocumentSmoothStream = ({
  documentId,
  content,
  streaming = false,
  waiting = false,
  pacing,
  onDrained,
  now,
  schedule,
}: UseDocumentSmoothStreamOptions): UseSmoothStreamResult => {
  const ctx = useContext(SmoothCoordinatorContext);
  const getCoordinator = useCallback(
    (): SmoothCoordinator | null => (ctx && documentId ? ctx.getCoordinator(documentId) : null),
    [ctx, documentId]
  );
  const resolved = getCoordinator();
  const subscribe = useCallback((notify: () => void) => resolved?.subscribe(notify) ?? (() => {}), [resolved]);
  // Observe scope identity, not every queue mutation. React rechecks it between
  // render and subscription, so eviction cannot strand this chunk in an old
  // queue. The resolved dependency also moves the subscription to the new scope.
  // Progress/done notifications with unchanged identity do not rerender siblings.
  const coordinator = useSyncExternalStore(subscribe, getCoordinator, getCoordinator);
  const reactId = useId();

  // ── Gate decision: FIRST MOUNT RENDER, before any effect ─────────────────
  // Captured in a useState initializer so the very first client render (and
  // the whole server render) already sees the verdict. Deciding in an effect
  // would feed '' to the inner hook for one frame on non-empty mounts —
  // a hydration mismatch (the server renders full text) and a visible
  // flash-then-blank on remounts. Only empty-content mounts queue.
  const [participates] = useState(() => coordinator !== null && content === '');

  // Released is sticky: predecessors' done is sticky and unmounts only
  // shrink the blocker set, so once true it can never flip back.
  const [released, setReleased] = useState(!participates);
  // Two-beat release handshake, beat 1: force streaming=true for exactly one
  // commit so the inner reaction effect enters via the append/update branch.
  // Releasing directly with the user's streaming=false would take the
  // snap branch (false→false in the inner effect) and flash the whole
  // backlog — precisely on the main scenario (source finished while queued).
  const [forcedStreaming, setForcedStreaming] = useState(false);

  // Latest content for the release check below. A ref (synced in an
  // every-render effect, declared BEFORE the watcher so it is fresh within
  // the same commit) because the watcher effect must not re-subscribe on
  // every token append.
  const contentRef = useRef(content);
  useEffect(() => {
    contentRef.current = content;
  });

  // ── Registration (effect time; refcounted for Strict Mode) ───────────────
  useEffect(() => {
    if (!coordinator) return;
    coordinator.register(reactId);
    return () => coordinator.release(reactId);
  }, [coordinator, reactId]);

  // ── Release watcher ──────────────────────────────────────────────────────
  useEffect(() => {
    if (released) return;
    if (!coordinator) {
      // Coordination withdrawn while gated (`smoothCoordination` /
      // `smoothTurnTaking` flipped false, the documented escape hatch for a
      // wedged queue): release unconditionally. Without this branch the
      // chunk is stuck at ''/false forever — nobody else can flip
      // `released`. Sticky release (not a render-time `gatedPending &&
      // coordinator` guard) so re-enabling coordination later can never
      // re-hide visible text. No forced beat: with no coordinator there is
      // no queue to protect, and the plain snap/update degradation is
      // exactly what "coordination off" means.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot sticky latch
      setReleased(true);
      return;
    }
    const check = () => {
      if (coordinator.isReleased(reactId)) {
        // Both set in one callback → one batched commit = beat 1. The
        // forced beat exists to protect a non-empty backlog from the snap
        // branch; an EMPTY chunk has nothing to protect, and forcing it
        // would render one frame of cursor on a chunk whose source already
        // ended (content that arrives later takes the normal update/snap
        // paths regardless).
        setReleased(true);
        if (contentRef.current !== '') setForcedStreaming(true);
      }
    };
    check();
    return coordinator.subscribe(check);
  }, [coordinator, released, reactId]);

  // ── Feed the inner hook ──────────────────────────────────────────────────
  const gatedPending = participates && !released;
  const innerContent = gatedPending ? '' : content;
  const innerStreaming = gatedPending ? false : forcedStreaming || streaming;
  // The inner hook is called unconditionally exactly once. It MUST be
  // called before the handshake-clearing effect below is declared: within a
  // commit, effects run in hook-call order, so the inner reaction effect
  // (beat 1's update, which flips its prevStreamingRef to true) is
  // guaranteed to run before the effect that schedules beat 2.
  const inner = useSmoothStream({ content: innerContent, streaming: innerStreaming, pacing, onDrained, now, schedule });

  // Beat 2: clear the forced flag in its own effect, keyed on the flag.
  // Clearing it anywhere earlier (same callback, same microtask) lets React
  // batch both beats into one render — the inner effect would then run once
  // with (full, false) and take the snap branch.
  useEffect(() => {
    // The setState-in-effect is the MECHANISM here, not an accident: the
    // flag must be cleared in a separate commit (beat 2), and an effect
    // keyed on the flag is the only primitive that guarantees it. It runs
    // at most once per release — no cascading-render risk.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (forcedStreaming) setForcedStreaming(false);
  }, [forcedStreaming]);

  // ── Done reporting: value-derived, sticky at the coordinator ─────────────
  // Derived from values the wrapper can see on every relevant commit — never
  // from notify/onDrained edges: a released chunk whose content is still ''
  // produces zero controller notifies, and edge-driven reporting would
  // never mark it done, wedging every successor. The `released` guard is
  // load-bearing: a QUEUED chunk whose source completed while gated
  // (streaming=false, inner sees ''/false) must not report done — that
  // would release its successors ahead of it.
  useEffect(() => {
    if (!coordinator || !released) return;
    if (!waiting && !streaming && !forcedStreaming && !inner.streaming) coordinator.markDone(reactId);
  }, [coordinator, released, reactId, waiting, streaming, forcedStreaming, inner.streaming]);

  // ── Reveal-progress heartbeat (feeds the dev-only warning below) ─────────
  // `now` is the @internal test-clock seam; identity-stable in practice, so
  // listing it as a dep is free and keeps the effect lint-clean.
  useEffect(() => {
    if (!coordinator) return;
    coordinator.stampProgress(reactId, (now ?? Date.now)());
  }, [coordinator, reactId, inner.content, now]);

  // ── Dev-only stuck-flag warning ──────────────────────────────────────────
  // The coordinator fanout cannot drive this: the stuck scenario is exactly
  // the one with zero state changes. A pending chunk arms a timer instead
  // and reads the blocker's heartbeat on demand; progress re-arms silently.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    if (!coordinator || !gatedPending) return;
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      timer = setTimeout(() => {
        // The warn/re-arm/clear decision lives in a pure function
        // (unit-tested in node); this timer body only wires it up.
        const verdict = evaluateGateWarn(coordinator, reactId, (now ?? Date.now)(), GATE_WARN_THRESHOLD_MS);
        if (verdict === 'clear') return; // release is propagating
        if (verdict === 'rearm') {
          arm(); // blocker is still revealing — a slow model, not a stuck flag
          return;
        }
        console.warn(
          '[ai-react-markdown] A smooth-stream chunk has been gated for a while behind a predecessor ' +
            'that shows no reveal progress. A predecessor chunk may have a stuck `streaming` flag ' +
            '(it must flip to false when its stream ends), which blocks every later chunk in this document.'
        );
      }, GATE_WARN_THRESHOLD_MS);
    };
    arm();
    return () => clearTimeout(timer);
  }, [coordinator, gatedPending, reactId, now]);

  if (gatedPending) {
    // Pending presentation: nothing renders, no cursor. The inner hook is
    // fed ''/false, so inner.content is '' and inner.streaming is false —
    // returning `inner` directly would be equivalent; being explicit keeps
    // the contract visible (flush stays the inner one: a no-op while empty).
    return { content: '', streaming: false, flush: inner.flush };
  }
  return inner;
};

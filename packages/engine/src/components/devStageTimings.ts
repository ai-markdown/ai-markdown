/**
 * Dev-only pipeline stage timing.
 *
 * The block-memo render path runs four distinct stages per content change
 * (parse → transform → build → render). Which one dominates depends on the
 * workload — plugin mix, document length, math density — and every
 * optimization decision should start from that split, not from a guess.
 *
 * Two delivery channels, deliberately separate:
 *
 * - **Programmatic consumers** (the BlockMemoCompare story's profiler)
 *   use {@link subscribeStageTimings} — a private, direct callback
 *   channel. It must NOT go through the User Timing API: React 19 dev
 *   builds emit one `performance.measure` per component render
 *   ("component tracks"), so a page-global 'measure' observer receives a
 *   flood of foreign entries it has to filter, and — measured — anything
 *   that scans or clears the buffer becomes O(buffer) with MILLIONS of
 *   entries in a long session.
 * - **DevTools timeline visibility**: {@link measureStage} still emits
 *   one `performance.measure` per stage, named
 *   `ai-markdown:stage:<stage>`. Emission is an append — cheap. It does
 *   NOT clear per name afterwards: Chromium's `clearMeasures(name)` scans
 *   the whole buffer, and under the React-dev flood that per-call scan
 *   cost ~35% of main-thread time ON THE INSTRUMENTED SIDE ONLY —
 *   inverting the very benchmark this instrumentation serves. Our own
 *   growth is ~4 entries per streamed token; the benchmark harness
 *   bulk-clears the buffer between runs (see useRenderProfiler.reset).
 *
 * Production builds fold {@link ENABLED} to `false`: the dual dev/prod
 * build resolves `process.env.NODE_ENV` at build time (tsdown `env`), so
 * the published dist carries no env read at all; in-repo src consumers
 * (storybook, vitest) run under Vite/Node where the text is substituted
 * or `process` exists. The whole thing costs one boolean check per stage.
 *
 * @module components/devStageTimings
 */

/** The stages of the block-memo render pipeline, in execution order.
 *  Single source of truth: the union type, the emitted measure names, and
 *  any display ordering (ProfilerPanel) all derive from this tuple.
 *  `scan` is the incremental-parse boundary detector (emitted only when
 *  `incrementalParse` routes through the incremental engine);
 *  when incremental parsing splices, `parse`/`transform` cover the
 *  TAIL-ONLY work — the honest per-frame cost, not the full-document one. */
export const PIPELINE_STAGES = ['scan', 'parse', 'transform', 'build', 'render'] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Prefix for the emitted `performance.measure` entry names. */
export const STAGE_MEASURE_PREFIX = 'ai-markdown:stage:';

/** Hoisted name table — measure names are shared constants, not a fresh
 *  template-literal allocation per call. */
const STAGE_NAMES = Object.fromEntries(
  PIPELINE_STAGES.map((stage) => [stage, `${STAGE_MEASURE_PREFIX}${stage}`])
) as Record<PipelineStage, string>;

/**
 * One-time capability gate. Beyond the DEV check, probes the exact call
 * {@link measureStage} makes — the options-object `measure` overload — by
 * performing it once. Environments that expose `performance.measure` but
 * only support the legacy mark-name overloads (older jsdom, partial
 * polyfills) fail the probe and are gated off permanently, instead of
 * paying a thrown-and-swallowed exception per stage per token for the
 * whole session.
 */
const ENABLED: boolean =
  process.env.NODE_ENV !== 'production' &&
  (() => {
    if (typeof performance === 'undefined' || typeof performance.measure !== 'function') {
      return false;
    }
    try {
      const probe = `${STAGE_MEASURE_PREFIX}probe`;
      performance.measure(probe, { start: 0, end: 0 });
      performance.clearMeasures?.(probe);
      return true;
    } catch {
      return false;
    }
  })();

/** `instanceId` is the emitting `<AIMarkdown>`'s documentId — listeners on a
 *  page with several instances (e.g. an A/B comparison where BOTH sides run
 *  the block-memo path) filter by it; a page-wide aggregate ignores it. */
type StageListener = (stage: PipelineStage, durationMs: number, instanceId?: string) => void;
const stageListeners = new Set<StageListener>();

/**
 * Subscribe to stage timings over the private callback channel (dev-only;
 * in production builds {@link measureStage} never emits, so listeners
 * simply stay silent). Returns an unsubscribe function.
 *
 * This exists so the benchmark profiler does NOT have to observe the
 * page-global 'measure' entry type: React 19 dev floods that channel with
 * one measure per component render, which would have to be filtered per
 * batch — and the module-level listener set is still page-scoped, so the
 * one-consumer-per-page discipline from the story docs continues to apply.
 */
export function subscribeStageTimings(listener: StageListener): () => void {
  stageListeners.add(listener);
  return () => {
    stageListeners.delete(listener);
  };
}

/**
 * Run `fn` as the named pipeline stage. In dev: notifies
 * {@link subscribeStageTimings} listeners and emits one
 * `performance.measure` for DevTools timeline visibility. The
 * single-callable shape (instead of a start/end pair) makes the stage
 * name a typed argument and the pairing unforgettable: a call site cannot
 * mismatch or drop an end call. If `fn` throws, nothing is emitted for
 * the aborted stage.
 *
 * NOTE: emission is append-only — never clear per name from here. See the
 * module docs: `clearMeasures(name)` is O(page buffer), and React 19
 * dev's component tracks grow that buffer without bound.
 */
export function measureStage<T>(stage: PipelineStage, fn: () => T, instanceId?: string): T {
  if (!ENABLED) return fn();
  const start = performance.now();
  const result = fn();
  const end = performance.now();
  for (const listener of stageListeners) listener(stage, end - start, instanceId);
  // Probe-verified call — no per-call try/catch needed.
  performance.measure(STAGE_NAMES[stage], { start, end });
  return result;
}

import { createCodeFrame, nextCodeFrame, type CodeFrame } from './codeFrame';
import { mermaidRenderQueue } from './renderQueue';
import { ensureMermaidInitialized, getMermaidMaxTextSize, type MermaidInitTarget } from './mermaid';

export interface DiagramEngine extends MermaidInitTarget {
  /** Resolves truthy for a source that parses; rejects, or resolves falsy, for one that does not. */
  parse(code: string): Promise<unknown>;
  render(
    id: string,
    code: string
  ): Promise<{ svg: string; diagramType?: string; bindFunctions?(element: object): void }>;
}

/**
 * What the host shows. One value instead of separate flags whose combinations
 * had to be kept coherent by hand:
 * - `source`: nothing has rendered in this generation (warm-up, server render).
 * - `diagram`: the last successful render.
 * - `error`: only a failed corrective pass after a stream, or a static failure
 *   with no diagram up, enters this state.
 */
export type DiagramView =
  | { kind: 'source' }
  | { kind: 'diagram'; svg: string; chartType: string; bind?: (element: object) => void }
  | { kind: 'error'; message: string };

export interface DiagramState {
  view: DiagramView;
  /** The engine module could not be loaded and the automatic retries are spent. `retry()` starts over. */
  loadFailed: boolean;
}

export interface DiagramRequest {
  code: string;
  dark: boolean;
  /** Document streaming state. Its edges mark the start and the end of a generation. */
  streaming: boolean;
  /** False while the host shows something else, such as the source. No attempt runs. */
  active: boolean;
  /** Minimum time between attempts while streaming. Zero attempts every update. */
  interval: number;
}

/** Longest error text published. A parse error is a few lines; anything longer is noise. */
const ERROR_MESSAGE_MAX_CHARS = 500;
/** Bounded automatic retries of a failed engine download, per generation. */
const LOAD_RETRIES = 3;
const LOAD_RETRY_MS = 1500;

/** The failure reason as plain text. Hosts render it as a text node, never as HTML. */
function describeRenderError(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const text = raw.replace(/\r\n?/g, '\n').trim();
  if (!text) return 'Mermaid could not render this diagram.';
  return text.length > ERROR_MESSAGE_MAX_CHARS ? `${text.slice(0, ERROR_MESSAGE_MAX_CHARS)}…` : text;
}

/** A timestamp and a random suffix: unique across diagrams and across copies of this module. */
const diagramId = () => `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * The render state machine for one diagram. The host passes every change of
 * its inputs to `update` and draws what `publish` receives.
 *
 * ## While `streaming` is true
 *
 * The source is usually a truncated prefix, so a parse failure is expected:
 * - Before the first success the view stays `source`, never `error`.
 * - After a success the last diagram stays up; each attempt replaces it only
 *   when it succeeds.
 * - Attempts are throttled by `interval` with the same trailing throttle as
 *   code display: appends inside an interval replace one pending frame without
 *   moving its deadline. A rewrite, a non-streaming update and the end of the
 *   stream pass through at once.
 * - When streaming ends, one corrective pass runs on the final source. Its
 *   failure is published even over a diagram, because that diagram no longer
 *   matches the source. Only that one pass may do so.
 * - When streaming starts, a new generation begins on the same instance (a
 *   regenerated answer keeps its block position). Everything from the previous
 *   generation is dropped and the view returns to `source`.
 *
 * ## While `streaming` stays false
 *
 * A failure is published only while no diagram is up. Once one is, a later
 * failure (a theme change, an incomplete source from a host that does not pass
 * `streaming`) keeps it.
 *
 * ## Always
 *
 * - An attempt whose source and theme match the diagram on screen is skipped.
 * - A source above the engine's `maxTextSize` is an error, not a render.
 * - A failed engine download is not a diagram error. It keeps the view, keeps a
 *   pending corrective pass, and is retried a bounded number of times.
 * - An attempt that has been superseded publishes nothing.
 */
export function createDiagramController(load: () => Promise<DiagramEngine>, publish: (state: DiagramState) => void) {
  const owner = {};
  let request: DiagramRequest | undefined;
  /** The latest source and its lineage, and the throttled frame attempts read. */
  let current: CodeFrame | undefined;
  let shown: CodeFrame | undefined;
  let frames: ReturnType<typeof createCodeFrame> | undefined;
  let updating = false;

  let view: DiagramView = { kind: 'source' };
  let loadFailed = false;
  let previousStreaming = false;
  /** Armed when streaming ends; consumed by the next attempt that completes. */
  let needsCorrective = false;
  /** Inputs of the diagram on screen. */
  let lastSuccess: { code: string; dark: boolean } | undefined;
  let loadFailures = 0;
  /** Bumped to run again on unchanged inputs: a load retry, or `retry()`. */
  let nonce = 0;
  /** Inputs of the last run. A run with the same inputs does nothing. */
  let ran: { code: string; dark: boolean; active: boolean; streaming: boolean; nonce: number } | undefined;
  let epoch = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const emit = () => publish({ view, loadFailed });
  /** Drops a view that repeats the one on screen. A diagram is always new: the host has to draw it. */
  const show = (next: DiagramView) => {
    if (next.kind === 'source' && view.kind === 'source') return;
    if (next.kind === 'error' && view.kind === 'error' && next.message === view.message) return;
    view = next;
    emit();
  };
  const cancel = () => {
    epoch++;
    mermaidRenderQueue.cancel(owner);
    if (retryTimer !== undefined) clearTimeout(retryTimer);
    retryTimer = undefined;
  };

  const attempt = async (code: string, dark: boolean, streaming: boolean, generation: number) => {
    const stale = () => generation !== epoch;
    let engine: DiagramEngine;
    try {
      engine = await load();
    } catch {
      if (stale()) return;
      if (loadFailures < LOAD_RETRIES) {
        loadFailures += 1;
        retryTimer = setTimeout(() => {
          retryTimer = undefined;
          nonce++;
          run();
        }, LOAD_RETRY_MS);
      } else if (!loadFailed) {
        loadFailed = true;
        emit();
      }
      return;
    }
    loadFailures = 0;
    try {
      if (stale()) return;
      // Initialization, parsing and rendering share one queued task, so another
      // diagram cannot change the theme in between.
      ensureMermaidInitialized(engine, dark);
      // The engine would resolve an oversized render with a placeholder diagram.
      // The raw length is compared; the engine measures the text after stripping
      // front matter and directives, so a source within a few bytes of the limit
      // can be refused here that it would still have rendered.
      const maxTextSize = getMermaidMaxTextSize(engine);
      if (code.length > maxTextSize) {
        throw new Error(`Diagram source is ${code.length} characters, above mermaid's maxTextSize of ${maxTextSize}.`);
      }
      if (!(await engine.parse(code))) throw new Error('Failed to parse mermaid code');
      if (stale()) return;
      const { svg, bindFunctions, diagramType } = await engine.render(diagramId(), code);
      if (stale()) return;
      needsCorrective = false;
      lastSuccess = { code, dark };
      loadFailed = false;
      show({ kind: 'diagram', svg, chartType: diagramType ?? '', bind: bindFunctions });
    } catch (error) {
      if (stale()) return;
      // Expected while the source is still arriving. The corrective pass reports real errors.
      if (streaming) return;
      const message = describeRenderError(error);
      if (needsCorrective) {
        needsCorrective = false;
        show({ kind: 'error', message });
        return;
      }
      if (view.kind === 'diagram') return;
      show({ kind: 'error', message });
    }
  };

  function run() {
    if (!request || !current || !shown) return;
    const { dark, active, streaming, interval } = request;
    const code = !streaming || interval === 0 || current.generation !== shown.generation ? request.code : shown.code;
    if (
      ran &&
      ran.code === code &&
      ran.dark === dark &&
      ran.active === active &&
      ran.streaming === streaming &&
      ran.nonce === nonce
    )
      return;
    ran = { code, dark, active, streaming, nonce };
    cancel();
    // Edges come before any early return: the first chunk of a new stream can arrive with an empty source.
    if (streaming && !previousStreaming) {
      needsCorrective = false;
      lastSuccess = undefined;
      loadFailures = 0;
      if (view.kind !== 'source' || loadFailed) {
        loadFailed = false;
        view = { kind: 'source' };
        emit();
      }
    } else if (!streaming && previousStreaming) {
      needsCorrective = true;
    }
    previousStreaming = streaming;
    if (!code || !active) return;
    // The diagram on screen came from exactly this source and theme. That render
    // is also the verdict a pending corrective pass was waiting for.
    if (lastSuccess?.code === code && lastSuccess.dark === dark) {
      needsCorrective = false;
      return;
    }
    const generation = epoch;
    void mermaidRenderQueue.enqueue(owner, () => attempt(code, dark, streaming, generation));
  }

  return {
    update(next: DiagramRequest) {
      request = next;
      updating = true;
      try {
        if (!frames || !current) {
          current = shown = nextCodeFrame(undefined, next.code, '');
          frames = createCodeFrame(current, (frame) => {
            shown = frame;
            if (!updating) run();
          });
        } else {
          current = nextCodeFrame(current, next.code, '');
        }
        frames.update(current, next.streaming, next.interval);
      } finally {
        updating = false;
      }
      run();
    },
    /** Attempts again on unchanged inputs, with a fresh download budget. */
    retry() {
      loadFailures = 0;
      if (loadFailed) {
        loadFailed = false;
        emit();
      }
      nonce++;
      run();
    },
    // Cancellation is reversible: the next update runs again, even on unchanged inputs.
    dispose() {
      cancel();
      frames?.dispose();
      ran = undefined;
    },
  };
}

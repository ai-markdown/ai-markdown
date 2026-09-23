import { mermaidRenderQueue } from './renderQueue';
import { ensureMermaidInitialized, getMermaidMaxTextSize, type MermaidInitTarget } from './mermaid';

export interface DiagramEngine extends MermaidInitTarget {
  parse(code: string, options: { suppressErrors: true }): Promise<unknown>;
  render(id: string, code: string): Promise<{ svg: string; bindFunctions?(element: object): void }>;
}
export type DiagramState = {
  status: 'loading' | 'ready' | 'error';
  svg: string;
  error?: string;
  bind?: (element: object) => void;
};
export interface DiagramRequest {
  code: string;
  dark: boolean;
  streaming: boolean;
  active: boolean;
  resetKey: string;
  interval: number;
}
let nextId = 0;
/** Owns cancellation and retries across both UI adapters. In-flight Mermaid
 * cannot be aborted, but obsolete work never publishes or starts a render. */
export function createDiagramController(load: () => Promise<DiagramEngine>, publish: (state: DiagramState) => void) {
  const owner = {};
  let epoch = 0;
  let previous: DiagramRequest | undefined;
  let svg = '';
  let bind: DiagramState['bind'];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    epoch++;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    mermaidRenderQueue.cancel(owner);
  };
  return {
    update(request: DiagramRequest) {
      const replaced =
        !previous ||
        previous.resetKey !== request.resetKey ||
        previous.dark !== request.dark ||
        !request.code.startsWith(previous.code);
      const pending = timer !== undefined;
      // Append bursts retain their deadline; every request invalidates work
      // already running, including completion-only and active-only changes.
      epoch++;
      mermaidRenderQueue.cancel(owner);
      if (replaced) {
        svg = '';
        bind = undefined;
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
      }
      previous = request;
      if (!request.active) {
        cancel();
        return;
      }
      publish({ status: 'loading', svg, bind });
      const attempt = () => {
        timer = undefined;
        const current = previous!;
        const generation = epoch;
        const valid = () => generation === epoch;
        let phase: 'load' | 'render' = 'load';
        void load()
          .then((engine) => {
            phase = 'render';
            if (!valid()) return;
            return mermaidRenderQueue.enqueue(owner, async () => {
              if (!valid()) return;
              ensureMermaidInitialized(engine, current.dark);
              if (current.code.length > getMermaidMaxTextSize(engine))
                throw new Error('Diagram exceeds Mermaid’s maximum text size');
              const parsed = await engine.parse(current.code, { suppressErrors: true });
              if (!valid()) return;
              if (parsed === false) throw new Error('Diagram syntax is incomplete or invalid');
              const result = await engine.render(`aimd-diagram-${++nextId}`, current.code);
              if (!valid()) return;
              svg = result.svg;
              bind = result.bindFunctions;
              publish({ status: 'ready', svg, bind });
            });
          })
          .catch((error) => {
            if (valid())
              publish({
                status: current.streaming && phase === 'render' ? 'loading' : 'error',
                svg,
                bind,
                error:
                  (phase === 'load' ? 'Diagram engine could not load: ' : '') +
                  (error instanceof Error ? error.message : String(error)).slice(0, 500),
              });
          });
      };
      if (!request.streaming || request.interval <= 0) {
        if (timer !== undefined) clearTimeout(timer);
        attempt();
      } else if (!pending || replaced) timer = setTimeout(attempt, request.interval);
    },
    dispose: cancel,
  };
}

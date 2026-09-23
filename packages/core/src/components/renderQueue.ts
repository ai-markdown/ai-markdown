/** Mermaid owns global configuration and a global renderer. Keep initialize,
 * parse and render in one serialized task. Each mounted diagram retains at
 * most one pending task; superseded frames never enter Mermaid. */
export function createRenderQueue() {
  type Job = { run: () => Promise<void>; resolve: () => void; reject: (error: unknown) => void };
  const pending = new Map<object, Job>();
  let running = false;
  async function drain() {
    if (running) return;
    running = true;
    try {
      while (pending.size) {
        const [owner, job] = pending.entries().next().value!;
        pending.delete(owner);
        try {
          await job.run();
          job.resolve();
        } catch (error) {
          job.reject(error);
        }
      }
    } finally {
      running = false;
    }
  }
  return {
    enqueue(owner: object, run: () => Promise<void>): Promise<void> {
      pending.get(owner)?.resolve();
      const promise = new Promise<void>((resolve, reject) => pending.set(owner, { run, resolve, reject }));
      void drain();
      return promise;
    },
    cancel(owner: object) {
      pending.get(owner)?.resolve();
      pending.delete(owner);
    },
  };
}

export const mermaidRenderQueue = createRenderQueue();

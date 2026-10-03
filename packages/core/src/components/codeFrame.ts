export interface CodeFrame {
  code: string;
  language: string;
}

/** A trailing throttle: append bursts replace one pending frame without
 * moving its deadline. Replacements and completion bypass the timer. */
export function createCodeFrame(initial: CodeFrame, publish: (frame: CodeFrame) => void) {
  let shown = initial;
  let latest = initial;
  let delay = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const flush = () => {
    cancel();
    if (shown.code === latest.code && shown.language === latest.language) return;
    shown = latest;
    publish(shown);
  };
  return {
    update(next: CodeFrame, streaming: boolean, interval: number) {
      const replaced = next.language !== latest.language || !next.code.startsWith(latest.code);
      latest = next;
      if (delay !== interval) cancel();
      delay = interval;
      if (!streaming || interval === 0 || replaced) return flush();
      if (shown.code === next.code && shown.language === next.language) return cancel();
      timer ??= setTimeout(flush, interval);
    },
    // Cancellation is reversible: Strict Mode replays the update effect.
    dispose: cancel,
  };
}

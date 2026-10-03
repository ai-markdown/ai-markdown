import { connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createProcessSupervisor } from '../../scripts/storybook-processes.mjs';

/** A listening port is occupied even if its HTTP response is an error or hangs. */
export function portInUse(port, host = 'localhost') {
  return new Promise((resolve, reject) => {
    const socket = connect({ port, host });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', (error) => {
      if (error.code === 'ECONNREFUSED') resolve(false);
      else reject(error);
    });
    socket.setTimeout(1500, () => socket.destroy(new Error(`port ${port}: connection timed out`)));
  });
}

/** Own resources from acquisition, including failed readiness/browser launch.
 * Reuse the process supervisor's cross-platform descendant cleanup. */
export async function withBenchmarkResources(run, { launch = () => chromium.launch({ headless: true }) } = {}) {
  const cleanups = [];
  const failures = [];
  let value;
  try {
    value = await run({
      defer(close) {
        cleanups.push(close);
      },
      async browser() {
        const browser = await launch();
        cleanups.push(() => browser.close());
        return browser;
      },
      async serve(
        app,
        { cwd, timeoutMs = 60_000, command = 'pnpm', args = ['--filter', `./${app.dir}`, 'run', 'preview'] } = {}
      ) {
        if (await portInUse(app.port)) throw new Error(`port ${app.port} is already in use`);
        const supervisor = createProcessSupervisor();
        let ended = false;
        let failure;
        const child = supervisor.run('benchmark preview', command, args, { cwd, stdio: 'ignore' }).then(
          () => {
            ended = true;
          },
          (error) => {
            ended = true;
            failure = error;
          }
        );
        let stopped;
        const stop = () =>
          (stopped ??= (async () => {
            await supervisor.stop();
            await child;
            if (await portInUse(app.port)) throw new Error(`preview cleanup left port ${app.port} occupied`);
          })());
        cleanups.push(stop);
        const deadline = Date.now() + timeoutMs;
        const url = `http://localhost:${app.port}/`;
        for (;;) {
          if (ended) throw failure ?? new Error('preview exited before becoming ready');
          const remaining = deadline - Date.now();
          if (remaining <= 0) throw new Error(`preview never came up on ${app.port}`);
          try {
            const response = await fetch(url, { signal: AbortSignal.timeout(Math.min(1000, remaining)) });
            await response.body?.cancel();
            if (response.ok && !ended) return { url, stop };
          } catch {
            /* Retry within the overall deadline. */
          }
          await delay(Math.min(100, Math.max(0, deadline - Date.now())));
        }
      },
    });
  } catch (error) {
    failures.push(error);
  } finally {
    // One rejected close must not skip the remaining resources.
    const results = await Promise.allSettled(cleanups.reverse().map((close) => Promise.resolve().then(close)));
    failures.push(...results.filter((result) => result.status === 'rejected').map((result) => result.reason));
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, 'Benchmark run or cleanup failed');
  return value;
}

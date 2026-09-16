/* eslint-disable no-undef */
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

/** Own process groups until their descendants have exited, not just their leader. */
export function createProcessSupervisor({ graceMs = 3000 } = {}) {
  const records = new Set();
  let stopping = false;
  let shutdown;
  function alive(record) {
    if (process.platform === 'win32') return record.child.exitCode === null && record.child.signalCode === null;
    try {
      process.kill(-record.child.pid, 0);
      record.exiting = false;
      return true;
    } catch (error) {
      if (error.code === 'ESRCH') return false;
      // macOS answers EPERM for a group whose last members are still exiting in
      // the kernel: `ps` lists none of them, and the probe turns into ESRCH
      // about a hundred milliseconds later (seen after a Storybook build's
      // esbuild children). Keep polling; the grace and force deadlines in
      // retire() bound the wait even if the answer never changes.
      if (error.code === 'EPERM') {
        record.exiting = true;
        return true;
      }
      throw error;
    }
  }
  async function signal(record, force) {
    if (!alive(record)) return;
    if (process.platform === 'win32') {
      // taskkill targets the owned process tree rather than other Node processes.
      await new Promise((resolve) => {
        const killer = spawn('taskkill', ['/pid', String(record.child.pid), '/T', ...(force ? ['/F'] : [])], {
          stdio: 'ignore',
        });
        killer.once('error', resolve);
        killer.once('exit', resolve);
      });
    } else {
      try {
        process.kill(-record.child.pid, force ? 'SIGKILL' : 'SIGTERM');
      } catch (error) {
        // EPERM: only exiting members are left, and they cannot take a signal.
        if (error.code !== 'ESRCH' && error.code !== 'EPERM') throw error;
      }
    }
  }
  function retire(record) {
    return (record.cleanup ??= (async () => {
      await signal(record, false);
      const deadline = Date.now() + graceMs;
      while (alive(record) && Date.now() < deadline) await delay(50);
      if (alive(record)) {
        console.log(
          record.exiting
            ? `[storybook] Still waiting for exiting ${record.label} processes`
            : `[storybook] Force-stopping remaining ${record.label} processes`
        );
        await signal(record, true);
        // A killed descendant can briefly remain a zombie until its parent reaps it.
        const forcedDeadline = Date.now() + 1000;
        while (alive(record) && Date.now() < forcedDeadline) await delay(50);
      }
      records.delete(record);
    })());
  }
  return {
    get stopping() {
      return stopping;
    },
    run(label, executable, args, options = {}) {
      if (stopping) throw new Error('Storybook command interrupted');
      const child = spawn(executable, args, { ...options, detached: process.platform !== 'win32' });
      const record = { child, label };
      if (child.pid) records.add(record);
      return new Promise((resolve, reject) => {
        child.once('error', (error) => {
          records.delete(record);
          reject(error);
        });
        child.once('exit', (code, signal) => {
          // Keep the group registered while wrappers exit ahead of their children.
          retire(record).then(() => {
            if (code === 0 || stopping) resolve();
            else reject(new Error(`${label} exited ${code ?? signal}`));
          }, reject);
        });
      });
    },
    stop() {
      stopping = true;
      return (shutdown ??= Promise.all([...records].map(retire)));
    },
  };
}

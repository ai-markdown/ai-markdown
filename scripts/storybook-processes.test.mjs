/* eslint-disable no-undef */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createProcessSupervisor } from './storybook-processes.mjs';

async function waitForFile(path) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch {
      await delay(20);
    }
  }
  throw new Error('Fixture failed to open its listener');
}
async function assertPortFree(port) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  await new Promise((resolve) => server.close(resolve));
}
for (const leaderExits of [false, true]) {
  test(
    `reap a SIGTERM-resistant descendant when its wrapper ${leaderExits ? 'exits first' : 'is interrupted'}`,
    { skip: process.platform === 'win32', timeout: 10000 },
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'storybook-process-test-'));
      const readyFile = join(dir, 'ready.json');
      const supervisor = createProcessSupervisor({ graceMs: 100 });
      const serverCode = `
      const {createServer} = require('node:net');
      process.on('SIGTERM', () => {});
      const server = createServer();
      server.listen(0, '127.0.0.1', () => {
        require('node:fs').writeFileSync(${JSON.stringify(readyFile)}, JSON.stringify({ port: server.address().port }));
        if (process.send) process.send('ready');
      });`;
      const wrapperCode = `
      const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(serverCode)}], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      child.on('message', () => { ${leaderExits ? 'process.exit(0)' : ''} });`;
      const run = supervisor.run('wrapper fixture', process.execPath, ['-e', wrapperCode], { stdio: 'ignore' });
      try {
        const { port } = await waitForFile(readyFile);
        if (!leaderExits) await Promise.all([supervisor.stop(), supervisor.stop()]);
        await run;
        await assertPortFree(port);
      } finally {
        await supervisor.stop();
        await rm(dir, { recursive: true, force: true });
      }
    }
  );
}
for (const [name, epermProbes] of [
  ['a transient EPERM while the group exits', 3],
  ['an EPERM that never clears', Number.POSITIVE_INFINITY],
]) {
  test(`cleanup finishes on ${name}`, { skip: process.platform === 'win32', timeout: 10000 }, async () => {
    const originalKill = process.kill;
    let probes = 0;
    // Group probes and group signals answer EPERM like macOS does for a group whose members are still exiting.
    process.kill = (pid, signal) => {
      if (pid < 0 && probes < epermProbes) {
        probes += 1;
        const error = new Error('kill EPERM');
        error.code = 'EPERM';
        throw error;
      }
      return originalKill.call(process, pid, signal);
    };
    try {
      const supervisor = createProcessSupervisor({ graceMs: 100 });
      const started = Date.now();
      await supervisor.run('exiting fixture', process.execPath, ['-e', '0'], { stdio: 'ignore' });
      assert(probes > 0, 'the fixture must exercise the EPERM path');
      assert(Date.now() - started < 5000, 'cleanup stays bounded');
    } finally {
      process.kill = originalKill;
    }
  });
}

test('interruption blocks additional commands and preserves bounded cleanup', async () => {
  const supervisor = createProcessSupervisor({ graceMs: 100 });
  const run = supervisor.run('startup fixture', process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  });
  await supervisor.stop();
  await run;
  assert.throws(() => supervisor.run('late process', process.execPath, []), /interrupted/);
});

test('failed commands reject and leave no additional work running', async () => {
  const supervisor = createProcessSupervisor({ graceMs: 100 });
  await assert.rejects(
    supervisor.run('failed fixture', process.execPath, ['-e', 'process.exit(7)'], { stdio: 'ignore' }),
    /failed fixture exited 7/
  );
  await supervisor.stop();
});

test('spawn failures remain safe to shut down', async () => {
  const supervisor = createProcessSupervisor({ graceMs: 100 });
  await assert.rejects(supervisor.run('missing command', '/nonexistent-storybook-command', []), { code: 'ENOENT' });
  await supervisor.stop();
});

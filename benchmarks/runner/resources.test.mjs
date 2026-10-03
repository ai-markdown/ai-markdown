import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { portInUse, withBenchmarkResources } from './resources.mjs';

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

// The launcher exits when signalled, while its child deliberately ignores
// SIGTERM. Cleanup must own the process group, not just this launcher.
const previewArgs = (port, hangs = false) => [
  '-e',
  `
  const {spawn} = require('node:child_process');
  spawn(process.execPath, ['-e', ${JSON.stringify(`
    process.on('SIGTERM', () => {});
    require('node:http').createServer((req,res) => { ${hangs ? '' : "res.end('ready')"} }).listen(${port});
  `)}], {stdio:'ignore'});
  setInterval(() => {}, 1000);
`,
];

test('browser launch failure releases the preview and its descendants', async () => {
  const port = await freePort();
  await assert.rejects(
    withBenchmarkResources(
      async (resources) => {
        await resources.serve({ port }, { command: process.execPath, args: previewArgs(port) });
        await resources.browser();
      },
      {
        launch: async () => {
          throw new Error('browser unavailable');
        },
      }
    ),
    /browser unavailable/
  );
  assert.equal(await portInUse(port), false);
});

test('a hanging readiness request is bounded and cleaned up', async () => {
  const port = await freePort();
  await assert.rejects(
    withBenchmarkResources(async (resources) => {
      await resources.serve({ port }, { command: process.execPath, args: previewArgs(port, true), timeoutMs: 300 });
    }),
    /preview never came up/
  );
  assert.equal(await portInUse(port), false);
});

test('spawn errors and early exit report their cause', async () => {
  const port = await freePort();
  await assert.rejects(
    withBenchmarkResources((resources) =>
      resources.serve({ port }, { command: '/missing/benchmark-command', args: [] })
    ),
    /ENOENT/
  );
  await assert.rejects(
    withBenchmarkResources((resources) =>
      resources.serve({ port }, { command: process.execPath, args: ['-e', 'process.exit(7)'] })
    ),
    /exited 7/
  );
});

test('a failed browser close still releases the preview', async () => {
  const port = await freePort();
  await assert.rejects(
    withBenchmarkResources(
      async (resources) => {
        await resources.serve({ port }, { command: process.execPath, args: previewArgs(port) });
        await resources.browser();
      },
      {
        launch: async () => ({
          close: () => {
            throw new Error('close failed');
          },
        }),
      }
    ),
    /close failed/
  );
  assert.equal(await portInUse(port), false);
});

test('refuses an occupied port without stopping its owner', async () => {
  const server = createServer((socket) => socket.end());
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  try {
    await assert.rejects(
      withBenchmarkResources((resources) => resources.serve({ port })),
      /already in use/
    );
    assert.equal(await portInUse(port), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a stopped preview can release its port for another preview in the same scope', async () => {
  const port = await freePort();
  const options = {
    command: process.execPath,
    args: ['-e', `require('node:http').createServer((q,s) => s.end('ready')).listen(${port})`],
  };
  await withBenchmarkResources(async (resources) => {
    const first = await resources.serve({ port }, options);
    await first.stop();
    await resources.serve({ port }, options);
    await first.stop();
    assert.equal(await portInUse(port), true);
  });
  assert.equal(await portInUse(port), false);
});

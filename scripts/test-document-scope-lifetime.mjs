/* global console, window, document */
/** Real concurrent React + GC regression. Runs with the browser gate, after
 * Chromium installation; node-only package tests do not require a browser. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

// The root manifest pins the one esbuild version every script here uses.
const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const directory = await mkdtemp(join(tmpdir(), 'aimd-document-lifetime-'));
const bundle = join(directory, 'bundle.js');
let browser;
let server;
try {
  await build({
    entryPoints: ['packages/react/src/test-fixtures/documentScopeLifetime.fixture.tsx'],
    outfile: bundle,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    nodePaths: [resolve('packages/react/node_modules')],
    define: { 'process.env.NODE_ENV': '"development"' },
    logLevel: 'silent',
  });
  const source = await readFile(bundle);
  server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');
    res.end(
      req.url === '/bundle.js' ? source : '<div id="root"></div><script type="module" src="/bundle.js"></script>'
    );
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => document.getElementById('committed')?.textContent === 'initial');
  for (let i = 0; i < 3; i++) {
    await page.evaluate((i) => window.scopeProbe.change(`abandoned-${i}`), i);
    await page.waitForFunction((i) => window.scopeProbe.attempted.includes(`abandoned-${i}`), i);
    await page.evaluate((i) => window.scopeProbe.change(`settled-${i}`), i);
    await page.waitForFunction((i) => document.getElementById('committed')?.textContent === `settled-${i}`, i);
  }
  // Separate protocol calls allow the JS job's WeakRef keep-alive to end.
  // GC is requested explicitly; no assertion depends on finalizer timing.
  for (let i = 0; i < 5; i++) await page.requestGC();
  const observed = await page.evaluate(() => ({
    alive: Object.fromEntries(
      Object.entries(window.scopeProbe.observed).map(([id, refs]) => [id, refs.map((ref) => !!ref.deref())])
    ),
    identityErrors: window.scopeProbe.identityErrors,
  }));
  assert.deepEqual(errors, []);
  assert.deepEqual(observed.identityErrors, [], 'same-document siblings must share both scopes');
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(observed.alive[`abandoned-${i}`], [false, false], 'aborted renders must not retain either scope');
  }
  assert.deepEqual(observed.alive['settled-2'], [true, true], 'committed consumers must keep both scopes alive');
  await page.evaluate(() => window.scopeProbe.unmount());
  for (let i = 0; i < 5; i++) await page.requestGC();
  assert.equal(
    await page.evaluate(() =>
      Object.values(window.scopeProbe.observed).every((refs) => refs.every((ref) => !ref.deref()))
    ),
    true,
    'unmount releases all scopes'
  );
  console.log(
    'Document scope lifetime: PASS (StrictMode, Suspense aborts, sibling identity, active ownership, unmount)'
  );
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}

/* global process, console, window, setTimeout, clearTimeout */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { cpus, platform, arch } from 'node:os';
import { chromium } from 'playwright';
import { SCENARIOS, STEPS } from './workload.mjs';
import { compare } from './compare.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const args = process.argv.slice(2);
const index = args.indexOf('--baseline');
assert(index === 0 && args.length === 2, 'Usage: pnpm bench:sentinel --baseline <built repository>');
const revisions = { baseline: realpathSync(args[1]), candidate: root };
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('tsup'))('esbuild');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const output = resolve(root, `benchmarks/results/sentinel-${Date.now()}.json`);
const report = {
  schemaVersion: 1,
  status: 'running',
  environment: {
    node: process.version,
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    cpus: cpus().length,
    viewport: { width: 1280, height: 900 },
    throttle: 1,
  },
  policy: {
    repeats: 6,
    warmup: 1,
    steps: STEPS,
    timingRelative: 0.3,
    timingAbsoluteMs: 30,
    heapRelative: 0.5,
    heapAbsoluteBytes: 1048576,
    noiseMultiplier: 2,
    deadlineMinutes: 12,
  },
  revisions: Object.fromEntries(
    Object.entries(revisions).map(([name, path]) => [
      name,
      { commit: git(path, 'rev-parse', 'HEAD'), dirty: !!git(path, 'status', '--porcelain'), path },
    ])
  ),
  harnessHash: hash(
    ['workload.mjs', 'react.mjs', 'vue.mjs', 'compare.mjs', 'run.mjs']
      .map((f) => readFileSync(resolve(here, f)))
      .join('\n')
  ),
  bundles: {},
  sensitivity: [],
  cells: [],
};
mkdirSync(dirname(output), { recursive: true });
const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
let server, browser;
// Hard bound includes building, browser startup and stalled evaluations. The
// artifact survives failures; finally closes the browser and HTTP listener.
const deadline = setTimeout(
  async () => {
    report.status = 'failed';
    report.error = 'Performance check exceeded 12 minutes';
    save();
    await browser?.close();
    server?.closeAllConnections();
    process.exit(1);
  },
  12 * 60 * 1000
);
try {
  const assets = new Map();
  for (const [revision, path] of Object.entries(revisions)) {
    for (const adapter of ['react', 'vue']) {
      const packageDir = resolve(path, `packages/${adapter}`);
      const manifest = JSON.parse(readFileSync(resolve(packageDir, 'package.json')));
      const style = adapter === 'react' ? 'typography/default.css' : 'styles.css';
      const result = await build({
        entryPoints: [resolve(here, `${adapter}.mjs`)],
        bundle: true,
        minify: true,
        write: false,
        metafile: true,
        outfile: 'bundle.js',
        format: 'esm',
        platform: 'browser',
        target: 'es2022',
        nodePaths: [resolve(packageDir, 'node_modules')],
        alias: {
          [`@ai-markdown/${adapter}`]: resolve(packageDir, manifest.exports['.'].import),
          [`@ai-markdown/${adapter}/${style}`]: resolve(packageDir, `dist/${style}`),
        },
        define: {
          'process.env.NODE_ENV': '"production"',
          __VUE_OPTIONS_API__: 'true',
          __VUE_PROD_DEVTOOLS__: 'false',
          __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
        },
        loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' },
      });
      // Keep the actual bundle hash and package inputs, not just a dirty flag.
      report.bundles[`${revision}/${adapter}`] = {
        packageVersion: manifest.version,
        files: result.outputFiles.map((f) => ({ name: f.path, sha256: hash(f.contents) })),
        inputs: Object.keys(result.metafile.inputs),
      };
      for (const file of result.outputFiles) {
        const extension = file.path.endsWith('.css') ? 'css' : 'js';
        assets.set(`/${revision}/${adapter}.${extension}`, {
          body: file.contents,
          type: extension === 'css' ? 'text/css' : 'text/javascript',
        });
      }
      assets.set(`/${revision}/${adapter}`, {
        type: 'text/html',
        body: `<meta charset="utf-8"><link rel="stylesheet" href="/${revision}/${adapter}.css"><div id="root"></div><script type="module" src="/${revision}/${adapter}.js"></script>`,
      });
    }
  }
  server = createServer((req, res) => {
    const asset = assets.get(req.url);
    res.writeHead(asset ? 200 : 404, { 'content-type': asset?.type ?? 'text/plain' });
    res.end(asset?.body ?? 'Not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true });
  report.environment.chromium = browser.version();
  const sample = async (revision, adapter, scenario, handicap = 0) => {
    const context = await browser.newContext({ viewport: report.environment.viewport });
    const page = await context.newPage();
    const errors = [];
    let sampleTimeout;
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/${revision}/${adapter}`, { waitUntil: 'load' });
      await page.waitForFunction(() => typeof window.__sentinel === 'function');
      const metrics = await Promise.race([
        page.evaluate(([scenario, handicap]) => window.__sentinel(scenario, handicap), [scenario, handicap]),
        new Promise((_, reject) => {
          sampleTimeout = setTimeout(() => reject(new Error('Sample exceeded 30 seconds')), 30000);
        }),
      ]);
      assert.deepEqual(errors, [], `${revision}/${adapter}/${scenario}: browser errors`);
      assert.equal(metrics.steps, STEPS);
      assert(metrics.nodes > 0 && metrics.text.length > 0, 'Empty render');
      const cdp = await context.newCDPSession(page);
      await cdp.send('HeapProfiler.collectGarbage');
      const heap = await cdp.send('Runtime.getHeapUsage');
      return { ...metrics, text: undefined, textHash: hash(metrics.text), heapBytes: heap.usedSize };
    } finally {
      clearTimeout(sampleTimeout);
      await context.close();
    }
  };

  // Sensitivity uses the SAME observer, delivery loop, and decision function.
  // It must detect injected work without changing output or update count.
  for (const adapter of ['react', 'vue']) {
    const normal = [],
      delayed = [];
    const sensitivity = { adapter, normal, delayed };
    report.sensitivity.push(sensitivity);
    for (let i = 0; i < 6; i++) {
      const order = i % 2 ? [true, false] : [false, true];
      for (const slow of order)
        (slow ? delayed : normal).push(await sample('candidate', adapter, 'append-medium', slow ? 5 : 0));
    }
    assert(
      normal.concat(delayed).every((m) => m.textHash === normal[0].textHash && m.nodes === normal[0].nodes),
      'Sensitivity changed output'
    );
    const timing = compare(normal, delayed);
    sensitivity.timing = timing;
    save();
    assert(
      timing.regression && timing.candidate - timing.baseline > STEPS * 5 * 0.6,
      `${adapter}: instrument missed injected work`
    );
  }

  for (const adapter of ['react', 'vue']) {
    for (const scenario of SCENARIOS) {
      const samples = { baseline: [], candidate: [] };
      // Retain partial evidence even if a later sample or output check fails.
      const cell = { adapter, scenario, samples };
      report.cells.push(cell);
      // Alternate AB/BA to avoid always measuring one revision first. Warmup
      // is discarded; every observation uses a fresh page and an equal workload.
      for (let round = -1; round < 6; round++) {
        const order = round % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
        for (const revision of order) {
          const result = await sample(revision, adapter, scenario);
          if (round >= 0) samples[revision].push(result);
        }
      }
      const all = [...samples.baseline, ...samples.candidate];
      assert(
        all.every((m) => m.textHash === all[0].textHash && m.bytes === all[0].bytes && m.steps === all[0].steps),
        `${adapter}/${scenario}: output or work differs`
      );
      const timing = compare(samples.baseline, samples.candidate);
      const heap = compare(samples.baseline, samples.candidate, 'heapBytes');
      Object.assign(cell, { timing, heap });
      save();
      console.log(
        `${adapter}/${scenario}: ${timing.baseline.toFixed(0)} → ${timing.candidate.toFixed(0)} ms; heap ${(heap.baseline / 1048576).toFixed(2)} → ${(heap.candidate / 1048576).toFixed(2)} MiB`
      );
    }
  }
  const regressions = report.cells.filter((c) => c.timing.regression || c.heap.regression);
  assert.equal(
    regressions.length,
    0,
    `Performance regression: ${regressions.map((c) => `${c.adapter}/${c.scenario}`).join(', ')}`
  );
  const inconclusive = report.cells.filter((c) => c.timing.inconclusive || c.heap.inconclusive);
  assert.equal(
    inconclusive.length,
    0,
    `Noise obscures a possible regression; rerun on an idle machine: ${inconclusive.map((c) => `${c.adapter}/${c.scenario}`).join(', ')}`
  );
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await browser?.close();
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  save();
  console.log(`Performance evidence: ${output}`);
}

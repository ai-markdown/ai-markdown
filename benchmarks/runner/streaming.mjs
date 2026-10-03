/** Focused production-browser measurements. Run after pnpm build.
 * DOM commit latency is measured, not raster/paint completion. */
/* global requestAnimationFrame, MutationObserver, performance */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { withBenchmarkResources } from './resources.mjs';

const { values } = parseArgs({
  options: {
    repeats: { type: 'string', default: '3' },
    throttle: { type: 'string', default: '1' },
    sizes: { type: 'string', default: '100,500,1000' },
  },
});
const repeats = Number(values.repeats),
  throttle = Number(values.throttle);
const sizes = values.sizes.split(',').map(Number);
assert(Number.isSafeInteger(repeats) && repeats > 0 && repeats <= 20, 'repeats must be 1–20');
assert(Number.isFinite(throttle) && throttle >= 1 && throttle <= 20, 'throttle must be 1–20');
assert(sizes.length > 0 && sizes.every((n) => Number.isSafeInteger(n) && n > 0 && n <= 10000), 'invalid sizes');
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('tsup'))('esbuild');
const percentile = (xs, fraction) =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * fraction))];

await withBenchmarkResources(async (resources) => {
  const directory = await mkdtemp(join(tmpdir(), 'aimd-streaming-bench-'));
  resources.defer(() => rm(directory, { recursive: true, force: true }));
  const assets = new Map();
  for (const framework of ['react', 'vue']) {
    const outfile = join(directory, `${framework}.js`);
    await build({
      entryPoints: [
        `packages/${framework}/src/test-fixtures/streamingBench.fixture.${framework === 'react' ? 'tsx' : 'ts'}`,
      ],
      outfile,
      bundle: true,
      minify: true,
      format: 'esm',
      platform: 'browser',
      define: { 'process.env.NODE_ENV': '"production"', __VUE_OPTIONS_API__: 'true', __VUE_PROD_DEVTOOLS__: 'false' },
      logLevel: 'silent',
    });
    assets.set(`/${framework}.js`, await readFile(outfile));
    assets.set(`/${framework}.css`, await readFile(outfile.replace(/\.js$/, '.css')));
  }
  const server = createServer((req, res) => {
    const asset = assets.get(req.url);
    res.setHeader(
      'Content-Type',
      asset ? (req.url.endsWith('.css') ? 'text/css' : 'text/javascript') : 'text/html; charset=utf-8'
    );
    const framework = req.url.startsWith('/vue') ? 'vue' : 'react';
    res.end(
      asset ??
        `<link rel="stylesheet" href="/${framework}.css"><div id="root"></div><script type="module" src="/${framework}.js"></script>`
    );
  });
  resources.defer(
    () =>
      new Promise((done) => {
        server.close(done);
        server.closeAllConnections();
      })
  );
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const browser = await resources.browser();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const rows = [];
  async function measure(framework, mode, extra = '', run) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      if (throttle > 1)
        await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: throttle });
      await page.goto(`${origin}/${framework}?mode=${mode}${extra}`);
      await page.waitForFunction(() => !!window.streamingProbe);
      // Let registration effects and their microtask notifications settle.
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      const result = await run(page);
      assert.deepEqual(errors, [], `${framework}: browser errors`);
      return result;
    } finally {
      await context.close();
    }
  }
  // Alternate the two arms so warm-up/thermal drift does not consistently
  // favour the cache. Both use the same built package and Markdown source.
  for (const blocks of sizes) {
    for (let repeat = 0; repeat <= repeats; repeat++) {
      for (const cached of repeat % 2 ? [false, true] : [true, false]) {
        const sample = await measure('vue', 'plain', cached ? '' : '&uncached=1', (page) =>
          page.evaluate(async (blocks) => {
            const prefix = 'A **finished** paragraph with some text.\n\n'.repeat(blocks);
            await window.streamingProbe.update([{ content: prefix + 'tail', streaming: true }]);
            const first = document.querySelector('article p');
            const start = performance.now();
            for (let i = 1; i <= 50; i++) {
              await window.streamingProbe.update([{ content: prefix + 'tail' + ' next'.repeat(i), streaming: true }]);
            }
            const elapsedMs = performance.now() - start;
            if (document.querySelector('article p') !== first) throw new Error('retained paragraph was remounted');
            if (!document.querySelector('article')?.textContent?.includes('tail' + ' next'.repeat(50)))
              throw new Error('stale tail');
            return { elapsedMs, chars: prefix.length + 254, updates: 50 };
          }, blocks)
        );
        if (repeat > 0) rows.push({ framework: 'vue', mode: 'scale', blocks, cached, repeat, ...sample });
      }
    }
    const arms = [true, false].map((cached) => ({
      cached,
      medianMs: percentile(
        rows.filter((r) => r.blocks === blocks && r.cached === cached).map((r) => r.elapsedMs),
        0.5
      ),
    }));
    console.log(JSON.stringify({ mode: 'vue-scale', blocks, arms }));
  }
  for (const framework of ['react', 'vue'])
    for (const mode of ['smooth', 'coordinated']) {
      for (let repeat = 0; repeat <= repeats; repeat++) {
        const sample = await measure(framework, mode, '', async (page) => {
          const stream = page.evaluate(async (coordinated) => {
            const steps = 24;
            const source = 'streaming words '.repeat(96);
            const second = coordinated ? 'second chunk '.repeat(30) : '';
            const milestones = [];
            let lastVisible = [0, 0];
            let failure;
            const inspect = () => {
              const nodes = [...document.querySelectorAll('[data-chunk]')];
              const visible = nodes.map((node) => Number(node.getAttribute('data-visible')));
              if (visible.some((n, i) => n < lastVisible[i])) failure = 'visible prefix shrank';
              if (coordinated && visible[1] > 0 && visible[0] < source.length)
                failure = 'successor overtook predecessor';
              lastVisible = visible;
              const now = performance.now();
              for (const milestone of milestones)
                if (milestone.at === undefined && visible[0] >= milestone.length) milestone.at = now;
            };
            const observer = new MutationObserver(inspect);
            observer.observe(document.getElementById('root'), {
              attributes: true,
              childList: true,
              subtree: true,
              characterData: true,
            });
            const chunks = (content, streaming) => [
              { content, streaming },
              ...(coordinated ? [{ content: second, streaming: false }] : []),
            ];
            const start = performance.now();
            try {
              for (let i = 1; i <= steps; i++) {
                const content = source.slice(0, Math.floor((source.length * i) / steps));
                milestones.push({ length: content.length, arrived: performance.now() });
                await window.streamingProbe.update(chunks(content, true));
                await new Promise((done) => setTimeout(done, 16));
              }
              const stoppedAt = performance.now();
              await window.streamingProbe.update(chunks(source, false));
              const deadline = performance.now() + 10000;
              while (performance.now() < deadline) {
                inspect();
                if (
                  lastVisible[0] === source.length &&
                  (!coordinated || lastVisible[1] === second.length) &&
                  !document.querySelector('[data-active="true"]')
                )
                  break;
                await new Promise((done) => requestAnimationFrame(done));
              }
              inspect();
              if (failure) throw new Error(failure);
              if (
                lastVisible[0] !== source.length ||
                (coordinated && lastVisible[1] !== second.length) ||
                document.querySelector('[data-active="true"]')
              )
                throw new Error('stream did not drain');
              return {
                elapsedMs: performance.now() - start,
                drainMs: performance.now() - stoppedAt,
                latencies: milestones.map((m) => {
                  if (m.at === undefined) throw new Error('unobserved input');
                  return m.at - m.arrived;
                }),
              };
            } finally {
              observer.disconnect();
            }
          }, mode === 'coordinated');
          // Playwright dispatches real browser input while the page's producer runs.
          // Always settle both operations before closing their shared page.
          const [streamResult, inputResult] = await Promise.allSettled([
            stream,
            (async () => {
              await page.waitForFunction(
                () => Number(document.querySelector('[data-chunk="0"]')?.getAttribute('data-visible')) > 0
              );
              await page.locator('#interaction').click();
              assert.equal(
                await page.locator('#interaction').getAttribute('data-streaming-at-click'),
                'true',
                'interaction missed the stream'
              );
              await page.waitForFunction(() => !!document.querySelector('#interaction')?.getAttribute('data-latency'));
              return Number(await page.locator('#interaction').getAttribute('data-latency'));
            })(),
          ]);
          if (streamResult.status === 'rejected') throw streamResult.reason;
          if (inputResult.status === 'rejected') throw inputResult.reason;
          return {
            elapsedMs: streamResult.value.elapsedMs,
            drainMs: streamResult.value.drainMs,
            inputToDomP95Ms: percentile(streamResult.value.latencies, 0.95),
            interactionToFrameMs: inputResult.value,
          };
        });
        if (repeat > 0) rows.push({ framework, mode, repeat, ...sample });
      }
      const samples = rows.filter((row) => row.framework === framework && row.mode === mode);
      console.log(
        JSON.stringify({
          framework,
          mode,
          drainMedianMs: percentile(
            samples.map((r) => r.drainMs),
            0.5
          ),
          inputToDomP95MedianMs: percentile(
            samples.map((r) => r.inputToDomP95Ms),
            0.5
          ),
          interactionToFrameMedianMs: percentile(
            samples.map((r) => r.interactionToFrameMs),
            0.5
          ),
        })
      );
    }
  await mkdir('benchmarks/results', { recursive: true });
  const output = `benchmarks/results/streaming-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  await writeFile(
    output,
    JSON.stringify(
      {
        commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        dirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '',
        node: process.version,
        browser: browser.version(),
        platform: process.platform,
        arch: process.arch,
        throttle,
        repeats,
        warmup: 1,
        rows,
      },
      null,
      2
    ) + '\n'
  );
  console.log(`wrote ${resolve(output)}`);
});

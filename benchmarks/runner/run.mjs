#!/usr/bin/env node
/**
 * The benchmark driver.
 *
 * Builds each app, serves the production bundle, and walks every
 * (app x scenario) cell with Playwright, collecting what the in-page harness
 * measured. Output is one JSON file per run under `benchmarks/results/`.
 *
 * IT GATES NOTHING, AND THAT IS DELIBERATE FOR NOW. The recorded trap from
 * the plan: a performance budget wired into CI before anyone knows the noise
 * band goes red on the third honest run and is muted by the fifth. So this
 * records baselines and prints a table; comparing two runs is a separate,
 * later decision that needs several versions of data first.
 *
 * WHY A FRESH PAGE PER CELL. LCP, first paint and long-task counts are
 * per-document facts. Driving several scenarios in one page would leave the
 * second one measuring a warm renderer, a populated DOM and a JIT that has
 * already seen the code — every number would improve down the list and none
 * of them would mean anything.
 *
 * WHY REPEATS. A single sample on a laptop that is also running a browser is
 * not a measurement. Each cell runs `--repeats` times (default 3) and the
 * MEDIAN is reported, with the spread kept alongside: a cell whose spread is
 * wider than the difference you are chasing has not measured that difference.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { withBenchmarkResources } from './resources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

const APPS = [
  // `react-null` is the CONTROL, not a competitor: it runs the same harness
  // over the same scenarios and renders into a `<pre>`. Its row is the cost
  // of everything that is not the renderer — string slicing, dispatch,
  // React's commit for one text node, the browser's rendering pipeline —
  // and the `throughput-*` numbers are only readable against it.
  { name: 'react-null', dir: 'benchmarks/react-null', port: 4319, control: true },
  { name: 'react-core', dir: 'benchmarks/react-core', port: 4317 },
  { name: 'react-mantine', dir: 'benchmarks/react-mantine', port: 4318 },
];

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
/**
 * Kept samples per cell. Five, not three: the shortest cells vary by ~5%
 * after warm-up, and a 3-sample median over that is itself unstable. Five is
 * where the median stops moving between runs on the measurements above.
 */
const REPEATS = Number(flag('repeats', '5'));
/**
 * Samples taken and DISCARDED before the ones that count.
 *
 * MEASURED rather than assumed, and the effect is smaller and narrower than
 * the folklore. Twelve consecutive runs per cell:
 *
 *   throughput-code   341 331 318 317 329 324 318 316 320 314 318 315
 *                     all 12: spread 8%   dropping 4: spread 5%
 *   throughput-long   649 648 665 654 664 649 642 645 669 660 670 649
 *                     all 12: spread 4%   dropping 4: spread 4%  (no gain)
 *   burst-code        10422 10423 10424 ... spread 0% either way
 *
 * Only the SHORTEST cell warms up, and only for about two runs — 341 and 331
 * against a steady ~317. `throughput-long` gains nothing from discarding
 * because its 4% is genuine run-to-run noise, not warm-up, and the
 * frame-paced cells are pinned to the refresh rate and do not vary at all.
 *
 * So the default is 2, not the 3 an earlier draft of this comment claimed
 * from a smaller sample. Discarding is not free — a dropped sample costs the
 * same wall clock as a kept one, and on a 10 s cell that is 20 s of nothing.
 */
const WARMUP = Number(flag('warmup', '2'));
/**
 * Quiet time between samples, ms.
 *
 * The tail of one run — the page context closing, its GC, the renderer's
 * teardown — lands inside the next one otherwise. Cheap insurance against a
 * class of contamination that shows up as unexplained variance rather than
 * as an obvious failure.
 */
const SETTLE_BETWEEN_MS = Number(flag('settle-between', '400'));
const ONLY_APP = flag('app', null);
const ONLY_SCENARIO = flag('scenario', null);
const HEADED = args.includes('--headed');
/**
 * CPU throttling multiplier, applied per page through CDP.
 *
 * The default of 1 measures the machine running the benchmark, and on a fast
 * laptop that machine is not a user: this suite's first baseline came back
 * with zero long tasks and zero blocking time in 12 of 14 cells, every frame
 * p95 within a millisecond of the display's floor. Those are honest numbers
 * with almost no discriminating power — a renderer could get 3x slower and
 * most of the table would not move.
 *
 * `--throttle 4` is the setting to compare releases on. It does not simulate
 * any particular device, and pretending otherwise would be worse than not
 * throttling; what it does is push the work far enough above the frame budget
 * that the metrics have room to differ. Baselines taken at different
 * multipliers are not comparable, so the value is recorded in every row.
 */
const THROTTLE = Number(flag('throttle', '1'));

const sh = (cmd, cmdArgs, opts = {}) =>
  new Promise((res, rej) => {
    const p = spawn(cmd, cmdArgs, { cwd: ROOT, stdio: 'inherit', ...opts });
    p.once('error', rej);
    p.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${cmd} ${cmdArgs.join(' ')} → ${code}`))));
  });

const median = (xs) => {
  const s = xs.filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
  if (s.length === 0) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const spread = (xs) => {
  const s = xs.filter((x) => x !== null && x !== undefined);
  return s.length === 0 ? null : Math.max(...s) - Math.min(...s);
};

async function main() {
  return withBenchmarkResources(
    async (resources) => {
      const apps = ONLY_APP ? APPS.filter((a) => a.name === ONLY_APP) : APPS;

      for (const app of apps) {
        process.stdout.write(`\n[bench] building ${app.name}\n`);
        await sh('pnpm', ['--filter', `./${app.dir}`, 'run', 'build']);
      }

      const browser = await resources.browser();
      const rows = [];

      for (const app of apps) {
        const server = await resources.serve(app, { cwd: ROOT });
        try {
          // The scenario list comes from the BUILT APP, never from a copy kept
          // here. A mirrored list is a second definition, and a second
          // definition of anything in this repo has drifted at least once —
          // this one would drift silently, by quietly not running a scenario.
          const indexPage = await browser.newPage();
          await indexPage.goto(`http://localhost:${app.port}/`, { waitUntil: 'load' });
          const available = await indexPage.evaluate(() => window.__benchScenarios ?? []);
          await indexPage.close();
          if (available.length === 0) throw new Error(`${app.name}: app exposed no scenarios`);
          const wanted = ONLY_SCENARIO ? available.filter((s) => s === ONLY_SCENARIO) : available;
          if (wanted.length === 0) throw new Error(`no such scenario: ${ONLY_SCENARIO}`);

          for (const scenario of wanted) {
            const samples = [];
            // Warm-up rounds run identically and are thrown away — see `WARMUP`.
            for (let i = 0; i < WARMUP + REPEATS; i++) {
              if (i > 0 && SETTLE_BETWEEN_MS > 0) await new Promise((r) => setTimeout(r, SETTLE_BETWEEN_MS));
              const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
              const page = await context.newPage();
              if (THROTTLE > 1) {
                // Before navigation, so the app's own startup is throttled too.
                const cdp = await context.newCDPSession(page);
                await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
              }
              await page.goto(`http://localhost:${app.port}/?scenario=${scenario}`, { waitUntil: 'load' });
              const m = await page.evaluate(async () => {
                const deadline = Date.now() + 120_000;
                while (!window.__bench && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
                if (!window.__bench) throw new Error('harness never installed');
                return await window.__bench.result();
              });
              // A run that rendered nothing is a FAILED run, not a fast one.
              // Every timing here rewards doing less work, so this is the one
              // shape that would post record numbers while being worthless — and
              // the control app is the only row allowed to be near-empty.
              if (m.renderedNodes === null || m.renderedNodes === 0) {
                throw new Error(
                  `${app.name}/${scenario}: rendered ${m.renderedNodes === null ? 'no container' : '0 nodes'} — ` +
                    'refusing to record timings for a page that produced nothing'
                );
              }
              await context.close();
              if (i >= WARMUP) samples.push(m);
            }
            const pick = (k) => median(samples.map((s) => s[k]));
            // Per-metric spread. The first version banded every metric with the
            // spread of `settleMs`, which has a one-frame floor and wobbles by
            // where the drain landed relative to vsync — so a 15 s cell was
            // compared with a +-5 ms band (0.03% called a regression) while a
            // cell whose settle happened to jitter absorbed real 15 ms changes.
            // A metric's own repeat-to-repeat range is the only honest band for
            // it.
            const spreadOf = (k) => spread(samples.map((s) => s[k]));
            const row = {
              app: app.name,
              scenario,
              repeats: REPEATS,
              warmup: WARMUP,
              // Recorded per row, not just in the file header: a row is what gets
              // quoted, and a number from a 4x run quoted beside an unthrottled
              // one is a false comparison that nothing else here would catch.
              throttle: THROTTLE,
              // Not a median: an outcome is categorical, and the WORST one in a
              // cell is what the reader needs. Three settled runs and one that
              // timed out is not a settled cell.
              outcome: samples.some((x) => x.outcome === 'stream-timeout')
                ? 'stream-timeout'
                : samples.some((x) => x.outcome === 'settle-timeout')
                  ? 'settle-timeout'
                  : 'settled',
              foreignNodes: Math.max(...samples.map((x) => x.foreignNodes)),
              frames: pick('frames'),
              commits: pick('commits'),
              chunks: pick('chunks'),
              // Below 1.0 means React coalesced deliveries: `streamMs` is then a
              // per-COMMIT cost, not per-chunk, and dividing by chunks
              // under-states the per-update work. The ratio falls as the
              // renderer slows, so a suite that ignored it would under-report
              // large regressions specifically.
              commitRatio: pick('chunks') > 0 ? pick('commits') / pick('chunks') : null,
              streamMs: pick('streamMs'),
              settleMs: pick('settleMs'),
              settleSpreadMs: spreadOf('settleMs'),
              spreads: {
                streamMs: spreadOf('streamMs'),
                settleMs: spreadOf('settleMs'),
                rafP95Ms: spreadOf('rafP95Ms'),
                totalBlockingMs: spreadOf('totalBlockingMs'),
                longTasks: spreadOf('longTasks'),
                renderedNodes: spreadOf('renderedNodes'),
              },
              rafP95Ms: pick('rafP95Ms'),
              longTasks: pick('longTasks'),
              longestTaskMs: pick('longestTaskMs'),
              totalBlockingMs: pick('totalBlockingMs'),
              // Named for what it measures: the shell's paint, which is the
              // same in every cell because streamed content grows below the
              // fold. Not a streaming metric; see its field doc.
              shellPaintMs: pick('shellPaintMs'),
              cls: pick('cls'),
              domNodes: pick('domNodes'),
              renderedNodes: pick('renderedNodes'),
              anchorDriftPx: pick('anchorDriftPx'),
              // Any repeat detaching taints the cell: a detached run stops
              // measuring, so its zero is an absence rather than a result.
              anchorDetached: samples.some((x) => x.anchorDetached === true),
              anchorMaxJumpPx: pick('anchorMaxJumpPx'),
              scrollJankFrames: pick('scrollJankFrames'),
              scrollDriftPx: pick('scrollDriftPx'),
              heapBytes: pick('heapBytes'),
            };
            rows.push(row);
            const ms = (v) => (v === null || v === undefined ? '   n/a' : `${Math.round(v)}`.padStart(6));
            process.stdout.write(
              `[bench] ${app.name.padEnd(14)} ${scenario.padEnd(19)}` +
                ` stream=${ms(row.streamMs)}ms settle=${ms(row.settleMs)}ms(±${Math.round(row.settleSpreadMs ?? 0)})` +
                ` rafP95=${row.rafP95Ms === null ? '  n/a  ' : `${row.rafP95Ms.toFixed(1)}ms`}/${row.frames}f` +
                ` LT=${row.longTasks} TBT=${ms(row.totalBlockingMs)}ms nodes=${row.renderedNodes}` +
                ` commits=${row.commits}/${row.chunks}` +
                `${row.anchorDriftPx === null ? '' : ` drift=${row.anchorDriftPx}px/max${row.anchorMaxJumpPx}${row.anchorDetached ? '⚠detached' : ''}`}` +
                `${row.outcome === 'settled' ? '' : `  ⚠ ${row.outcome}`}` +
                `${row.foreignNodes > 0 ? `  ⚠ ${row.foreignNodes} foreign nodes — extension contamination` : ''}\n`
            );
          }
        } finally {
          await server.stop();
        }
      }

      mkdirSync(resolve(ROOT, 'benchmarks/results'), { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const out = resolve(ROOT, `benchmarks/results/${stamp}.json`);
      writeFileSync(
        out,
        `${JSON.stringify({ stamp, throttle: THROTTLE, repeats: REPEATS, warmup: WARMUP, rows }, null, 2)}\n`
      );
      process.stdout.write(`\n[bench] wrote ${out}\n`);
    },
    { launch: () => chromium.launch({ headless: !HEADED }) }
  );
}

main().catch((e) => {
  process.stderr.write(`${e.stack ?? e}\n`);
  process.exit(1);
});

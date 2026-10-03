#!/usr/bin/env node
/**
 * Is the renderer's cost linear in document length?
 *
 * Four readings do not answer that; a slope does. This runs one scale family
 * and fits log(bytes) against log(streamMs + settleMs), which turns the set
 * into one number — the growth exponent:
 *
 *   ~1.0  linear. Twice the document costs twice the time.
 *   ~1.5  superlinear. Tolerable at chat sizes, painful at document sizes.
 *   ~2.0  quadratic. Fine at 30 KB, unusable at 300 KB.
 *
 * WHICH FAMILY, AND WHY IT IS A `--prefix`. The same four documents are
 * delivered three ways, and the exponent means something different in each:
 *
 *   --prefix cold-    one update.        Cost of rendering N bytes, once.
 *   --prefix steps-   exactly 100.       Cost of ONE update as N grows.
 *   --prefix scale-   one per 24 chars.  Both at once — count follows N.
 *
 * Only `scale-*` resembles a token stream, so it is the default; but on its
 * own it cannot say which of the two costs it measured, and reading it alone
 * produced a wrong headline once. Run at least `cold-` beside it.
 *
 * WHY THIS DESERVES ITS OWN TOOL. Every other cell in the suite is between
 * 11 KB and 36 KB — one size wearing several names — so a quadratic renderer
 * would post healthy numbers everywhere and the suite would agree. Scale is
 * the one axis on which a defect hides completely rather than partially, and
 * the exponent is the one output that cannot be read off any single cell.
 *
 * WHAT THE NUMBER IS NOT. It is a fit over four points on one machine, so it
 * carries every caveat the rest of the suite does plus sampling error at the
 * ends. Treat a move from 1.0 to 1.9 as a finding and a move from 1.05 to
 * 1.12 as nothing. The per-KB column beside it is the honest raw form and
 * should be read first.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { withBenchmarkResources } from './resources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const APP_NAME = flag('app', 'react-core');
const REPEATS = Number(flag('repeats', '3'));
const THROTTLE = Number(flag('throttle', '1'));
/** Which scenario family to fit. `scale-` is incremental delivery, `cold-`
 *  is the same content in one chunk — see the note in `scenarios.ts`. */
const PREFIX = flag('prefix', 'scale-');

const APPS = {
  'react-null': { dir: 'benchmarks/react-null', port: 4319 },
  'react-core': { dir: 'benchmarks/react-core', port: 4317 },
  'react-mantine': { dir: 'benchmarks/react-mantine', port: 4318 },
};
if (!Number.isSafeInteger(REPEATS) || REPEATS < 1) throw new Error('--repeats must be a positive integer');
if (!Number.isFinite(THROTTLE) || THROTTLE < 1) throw new Error('--throttle must be at least 1');
if (typeof PREFIX !== 'string' || !PREFIX) throw new Error('--prefix must be nonempty');
const app = APPS[APP_NAME];
if (app === undefined) {
  process.stderr.write(`unknown app: ${APP_NAME}\n`);
  process.exit(2);
}

const sh = (cmd, cmdArgs) =>
  new Promise((res, rej) => {
    const p = spawn(cmd, cmdArgs, { cwd: ROOT, stdio: 'inherit' });
    p.once('error', rej);
    p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`${cmd} → ${c}`))));
  });

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Least-squares slope of log(y) on log(x). */
function logSlope(points) {
  const xs = points.map((p) => Math.log(p.bytes));
  const ys = points.map((p) => Math.log(p.ms));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return num / den;
}

async function main() {
  return withBenchmarkResources(async (resources) => {
    await sh('pnpm', ['--filter', `./${app.dir}`, 'run', 'build']);
    await resources.serve(app, { cwd: ROOT });
    const browser = await resources.browser();
    const points = [];
    const timedOut = [];
    {
      const index = await browser.newPage();
      await index.goto(`http://localhost:${app.port}/`, { waitUntil: 'load' });
      const all = await index.evaluate(() => window.__benchScenarios ?? []);
      await index.close();
      const cells = all.filter((s) => s.startsWith(PREFIX));
      if (cells.length < 3) throw new Error(`need at least three ${PREFIX}* scenarios to fit a slope`);

      for (const scenario of cells) {
        const samples = [];
        let bytes = 0;
        // One warm-up, then the kept samples — same discipline as `run.mjs`,
        // and it matters more here because the small cell is the fastest one
        // in the suite and warms up the most.
        for (let i = 0; i < REPEATS + 1; i++) {
          const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
          const page = await ctx.newPage();
          if (THROTTLE > 1) {
            const cdp = await ctx.newCDPSession(page);
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
          }
          await page.goto(`http://localhost:${app.port}/?scenario=${scenario}`, { waitUntil: 'load' });
          const m = await page.evaluate(async () => {
            const deadline = Date.now() + 600_000;
            while (!window.__bench && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
            if (!window.__bench) throw new Error('harness never installed');
            return await window.__bench.result();
          });
          bytes = await page.evaluate(() => window.__benchBytes ?? 0);
          await ctx.close();
          if (i > 0) samples.push(m);
        }
        // Stream PLUS settle: the two families put the cost in different
        // columns. A paced cell spends it during delivery; a cold cell
        // delivers instantly and spends it settling, so `streamMs` alone
        // would report every cold cell as free.
        const ms = median(samples.map((s) => s.streamMs + (s.settleMs ?? 0)));
        const nodes = median(samples.map((s) => s.renderedNodes));
        // A cell that timed out did not produce a duration, it produced a
        // deadline. Feeding one into the fit reports the harness's own
        // `STREAM_TIMEOUT_MS` as if it were the renderer's cost — measured
        // exactly once, at 180024 ms against a 180000 ms cap, and it dragged a
        // fitted exponent to 1.31 that the surviving points do not support.
        // `outcome` exists for this; the first version of this file did not
        // read it.
        const outcome = samples.some((x) => x.outcome !== 'settled')
          ? (samples.find((x) => x.outcome !== 'settled')?.outcome ?? 'unknown')
          : 'settled';
        process.stdout.write(
          `[scale] ${scenario.padEnd(14)} ${(bytes / 1024).toFixed(1).padStart(8)}KB ` +
            `${Math.round(ms).toString().padStart(8)}ms  ${(ms / (bytes / 1024)).toFixed(2).padStart(7)} ms/KB  ` +
            `nodes=${nodes}${outcome === 'settled' ? '' : `  ⚠ ${outcome} — excluded from the fit`}\n`
        );
        if (outcome === 'settled') points.push({ scenario, bytes, ms, nodes, perKb: ms / (bytes / 1024) });
        else timedOut.push({ scenario, bytes, capMs: ms });
      }
    }

    if (timedOut.length > 0) {
      process.stdout.write(
        `\n[scale] ${timedOut.length} cell(s) never finished and are not in the fit:\n` +
          timedOut
            .map(
              (t) => `[scale]   ${t.scenario} (${(t.bytes / 1024).toFixed(0)}KB) hit the ${Math.round(t.capMs)}ms cap\n`
            )
            .join('') +
          `[scale] That IS the headline: at that size the renderer does not finish, ` +
          `so the exponent below describes only the sizes that did.\n`
      );
    }
    if (points.length < 3) {
      process.stdout.write(`\n[scale] only ${points.length} cell(s) completed — not enough to fit a slope\n`);
      return;
    }

    const slope = logSlope(points);
    const first = points[0];
    const last = points[points.length - 1];
    // Adjacent-pair slopes, printed BEFORE the fit, because the fit can lie in
    // a specific way that this suite has already been caught by. Every cell
    // carries the same fixed cost — mount, stylesheet, first paint — and on the
    // smallest cell that fixed cost IS most of the reading. A constant added to
    // a linear curve looks sublinear in log-log, so the small cell drags the
    // least-squares slope down and can report "linear" over a set whose top end
    // is clearly not. Measured once: the cold family fitted 0.85 globally while
    // its last interval ran at 1.49.
    //
    // The local slopes have the opposite weakness — two points each, so they
    // carry the full run-to-run noise of both. Read them as shape, not as
    // values, and trust the last interval most: it is the one where fixed costs
    // have amortised away.
    const locals = points.slice(1).map((p, i) => {
      const prev = points[i];
      return { from: prev, to: p, slope: Math.log(p.ms / prev.ms) / Math.log(p.bytes / prev.bytes) };
    });
    process.stdout.write(
      `\n[scale] local slope between adjacent sizes (fixed costs dominate the first):\n` +
        locals
          .map((l) => `[scale]   ${l.from.scenario.padEnd(14)} -> ${l.to.scenario.padEnd(14)} ${l.slope.toFixed(2)}\n`)
          .join('')
    );
    const top = locals[locals.length - 1];
    process.stdout.write(
      `\n[scale] ${APP_NAME} @ ${THROTTLE}x (${PREFIX}*) — growth exponent ${slope.toFixed(2)}` +
        ` over ${(last.bytes / first.bytes).toFixed(0)}x of document size\n` +
        `[scale] cost per KB went ${first.perKb.toFixed(2)} -> ${last.perKb.toFixed(2)} ms/KB` +
        ` (${(last.perKb / first.perKb).toFixed(1)}x)\n` +
        `[scale] ${slope < 1.15 ? 'linear' : slope < 1.6 ? 'SUPERLINEAR — cost per token grows with the document' : 'QUADRATIC or worse'}` +
        ` overall; ${top.slope.toFixed(2)} across the largest interval` +
        `${top.slope > slope + 0.25 ? ' — the fit understates the top end, believe the interval' : ''}\n`
    );
  });
}

main().catch((e) => {
  process.stderr.write(`${e.stack ?? e}\n`);
  process.exit(1);
});

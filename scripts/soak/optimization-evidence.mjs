/* global process, console */
/**
 * Compare the reference-work optimizations against a committed baseline.
 * Run from any directory:
 *   node scripts/soak/optimization-evidence.mjs <baseline-commit>
 *
 * Fixed diagnostic slices, never release evidence. Each slice runs baseline,
 * current, current, baseline in separate workers with the same dependencies.
 * Only the two target sources are overlaid; all other inputs use the current tree.
 * Full diagnostic readouts and test identities must agree; new P2 execution
 * counters are retained separately. Source overlays live only in a temporary
 * directory, and transform caching is disabled for both versions.
 */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const revision = process.argv[2];
if (!revision || process.argv.length !== 3) {
  throw new Error('Usage: node scripts/soak/optimization-evidence.mjs <baseline-commit>');
}
const baselineCommit = execFileSync('git', ['rev-parse', '--verify', `${revision}^{commit}`], {
  cwd: root,
  encoding: 'utf8',
}).trim();
const runtime = {
  nodeVersion: process.version,
  lockfileSha256: createHash('sha256')
    .update(readFileSync(resolve(root, 'pnpm-lock.yaml')))
    .digest('hex'),
};
const directory = mkdtempSync(join(tmpdir(), 'soak-optimization-'));
const files = [
  'packages/engine/src/components/incrementalParse/conformanceOracles.ts',
  'packages/engine/src/components/incrementalParse/spliceExhaustive.test.ts',
];
const sources = Object.fromEntries(
  ['baseline', 'current'].map((variant) => [
    variant,
    Object.fromEntries(
      files.map((file) => [
        resolve(root, file),
        variant === 'baseline'
          ? execFileSync('git', ['show', `${baselineCommit}:${file}`], { cwd: root, encoding: 'utf8' })
          : readFileSync(resolve(root, file), 'utf8'),
      ])
    ),
  ])
);
for (const [variant, contents] of Object.entries(sources)) {
  writeFileSync(join(directory, `${variant}.json`), JSON.stringify(contents));
  writeFileSync(
    join(directory, `${variant}.config.mjs`),
    `import { readFileSync } from 'node:fs';
const sources = JSON.parse(readFileSync(new URL('./${variant}.json', import.meta.url), 'utf8'));
export default {
  plugins: [{ name: 'soak-source-comparison', enforce: 'pre', transform(code, id) {
    const file = id.split('?')[0];
    if (!(file in sources)) return;
    process.stdout.write('[evidence-source] ' + file + '\\n');
    return { code: sources[file], map: null };
  }}],
  test: { name: 'evidence', environment: 'node', fsModuleCache: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'] }
};
`
  );
}

const env = { ...process.env, FORCE_COLOR: '0' };
for (const key of Object.keys(env)) {
  if (/^(EXHAUSTIVE_|FUZZ_|ORACLE_|SOAK_|VITEST_)/.test(key) || key === 'NODE_OPTIONS') delete env[key];
}
Object.assign(env, {
  EXHAUSTIVE_STRIDE: '1',
  EXHAUSTIVE_NAME_STRIDE: '1',
  EXHAUSTIVE_CONFIG_MODE: 'cross',
  EXHAUSTIVE_RAW_FROZEN: '1',
  EXHAUSTIVE_BFS_DEPTH: '0',
  EXHAUSTIVE_ROTATE_SALT: '0',
  FALLBACK_ORACLE_SAMPLE: '20',
});
const scenarios = [
  {
    name: 'fragment-cross',
    file: 'spliceExhaustive.test.ts',
    pattern: 'all sequences',
    env: { EXHAUSTIVE_K: '4', EXHAUSTIVE_NAME_K: '0', EXHAUSTIVE_SHARD: '0/1024' },
    passed: 1,
    skipped: 2,
  },
  {
    name: 'name-cross',
    file: 'spliceExhaustive.test.ts',
    pattern: 'name-class census',
    env: { EXHAUSTIVE_K: '0', EXHAUSTIVE_NAME_K: '3', EXHAUSTIVE_SHARD: '0/512' },
    passed: 1,
    skipped: 2,
  },
  {
    name: 'rotate',
    file: 'spliceExhaustive.test.ts',
    env: {
      EXHAUSTIVE_K: '2',
      EXHAUSTIVE_NAME_K: '2',
      EXHAUSTIVE_SHARD: '0/1',
      EXHAUSTIVE_CONFIG_MODE: 'rotate',
      EXHAUSTIVE_ROTATE_SALT: '2',
    },
    passed: 2,
    skipped: 1,
  },
  {
    name: 'oracle-raw',
    file: 'oracleConformance.test.ts',
    env: { ORACLE_RAW: '1', ORACLE_RUNS: '800', ORACLE_SEED: '9210800' },
    passed: 39,
    skipped: 0,
  },
];

async function runSlice(id, args, environment) {
  const child = spawn(process.execPath, args, {
    cwd: resolve(root, 'packages/engine'),
    env: environment,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const errors = [];
  const chunks = { stdout: [], stderr: [] };
  const limit = 16 * 1024 * 1024;
  let bytes = 0;
  let killTimer;
  let stopping = false;
  let settle;
  const done = new Promise((resolveDone) => {
    settle = resolveDone;
  });
  const signalChild = (signal) => {
    if (!child.pid) return;
    try {
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code === 'ESRCH') return;
      const failure = new Error(`${id}: could not send ${signal} to worker group ${child.pid}`, { cause: error });
      errors.push(failure);
      console.error(`${failure.message}: ${error.message}`);
      try {
        child.kill(signal);
      } catch (fallbackError) {
        errors.push(fallbackError);
      }
    }
  };
  const stop = (error) => {
    if (stopping) return;
    stopping = true;
    errors.push(error);
    signalChild('SIGTERM');
    killTimer = setTimeout(() => {
      signalChild('SIGKILL');
      // Even a denied group kill must fail explicitly instead of waiting forever
      // on descendants that still hold the output pipes open.
      settle({ status: null, signal: 'SIGKILL' });
    }, 5000);
  };
  const handlers = Object.fromEntries(
    ['SIGINT', 'SIGTERM'].map((signal) => [signal, () => stop(new Error(`${id}: interrupted by ${signal}`))])
  );
  for (const [signal, handler] of Object.entries(handlers)) process.on(signal, handler);
  const timeout = setTimeout(() => stop(new Error(`${id}: exceeded 240 second timeout`)), 240_000);
  for (const stream of ['stdout', 'stderr'])
    child[stream].on('data', (chunk) => {
      const remaining = Math.max(0, limit - bytes);
      if (remaining) chunks[stream].push(chunk.subarray(0, remaining));
      bytes += chunk.length;
      if (bytes > limit) stop(new Error(`${id}: exceeded 16 MiB output limit`));
    });
  child.once('error', (error) => {
    errors.push(error);
    settle({ status: null, signal: null });
  });
  child.once('close', (status, signal) => settle({ status, signal }));
  let outcome;
  let output;
  try {
    outcome = await done;
  } finally {
    clearTimeout(timeout);
    clearTimeout(killTimer);
    for (const [signal, handler] of Object.entries(handlers)) process.off(signal, handler);
    signalChild('SIGKILL');
    child.stdout.destroy();
    child.stderr.destroy();
    child.unref();
    output = Buffer.concat(chunks.stdout).toString('utf8') + Buffer.concat(chunks.stderr).toString('utf8');
    writeFileSync(
      join(directory, `${id}.log`),
      output + errors.map((error) => `\n[evidence-launcher] ${error.message}`).join('')
    );
  }
  if (errors.length) throw new AggregateError(errors, `${id} failed; see ${directory}`);
  assert.equal(outcome.status, 0, `${id} failed: ${outcome.signal ?? ''}; see ${directory}`);
  return output;
}

const results = [];
console.log(`Diagnostic evidence: ${directory}\nBaseline: ${baselineCommit}`);
for (const scenario of scenarios) {
  let expected;
  for (const [index, variant] of ['baseline', 'current', 'current', 'baseline'].entries()) {
    const id = `${scenario.name}-${index}-${variant}`;
    console.log(`Running ${id}`);
    const reportFile = join(directory, `${id}.vitest.json`);
    const started = performance.now();
    const output = await runSlice(
      id,
      [
        resolve(root, 'node_modules/vitest/vitest.mjs'),
        'run',
        `src/components/incrementalParse/${scenario.file}`,
        '--config',
        join(directory, `${variant}.config.mjs`),
        '--maxWorkers=1',
        '--reporter=default',
        '--reporter=json',
        `--outputFile.json=${reportFile}`,
        ...(scenario.pattern ? [`--testNamePattern=${scenario.pattern}`] : []),
      ],
      { ...env, ...scenario.env }
    );
    const seconds = (performance.now() - started) / 1000;
    for (const file of files.filter((file) => scenario.file.includes('Exhaustive') || file.includes('Oracles'))) {
      assert(output.includes(`[evidence-source] ${resolve(root, file)}`), `${id}: missing source overlay ${file}`);
    }
    const report = JSON.parse(readFileSync(reportFile, 'utf8'));
    assert.equal(report.success, true, id);
    assert.equal(report.numFailedTests, 0, id);
    assert.equal(report.numTodoTests, 0, id);
    assert.equal(report.numPendingTests, scenario.skipped, id);
    assert.equal(report.numPassedTests, scenario.passed, id);
    assert.equal(report.numTotalTests, scenario.passed + scenario.skipped, id);
    assert.equal(report.testResults.length, 1, `${id}: expected exactly one test file`);
    const suite = report.testResults[0];
    assert.equal(suite.status, 'passed', id);
    assert.equal(
      suite.name.replaceAll('\\', '/'),
      resolve(root, `packages/engine/src/components/incrementalParse/${scenario.file}`).replaceAll('\\', '/'),
      id
    );
    assert.equal(suite.assertionResults.length, report.numTotalTests, `${id}: incomplete assertion results`);
    assert.equal(suite.assertionResults.filter((test) => test.status === 'passed').length, scenario.passed, id);
    assert.equal(suite.assertionResults.filter((test) => test.status === 'skipped').length, scenario.skipped, id);
    for (const test of suite.assertionResults) {
      assert.equal(test.failureMessages.length, 0, id);
      assert.equal(typeof test.fullName, 'string', id);
      assert(test.fullName.length > 0, `${id}: missing test identity`);
    }
    const diagnostics = output
      .split('\n')
      .filter((line) => /^(\[census:|\[oracle | {2}[PM][^ ]*\/| {4}doc#)/.test(line))
      .filter((line) => !/^\[census:[^\]]+\] P2 /.test(line));
    assert(diagnostics.length > 0, `${id}: missing coverage readout`);
    const evidence = {
      diagnostics,
      tests: report.testResults.flatMap((suite) =>
        suite.assertionResults.map(({ fullName, status }) => ({ fullName, status }))
      ),
    };
    if (expected) assert.deepEqual(evidence, expected, `${id}: coverage, diagnostics or test identities changed`);
    else expected = evidence;
    const result = { id, scenario: scenario.name, variant, seconds, evidence };
    results.push(result);
    writeFileSync(join(directory, 'results.json'), JSON.stringify({ baselineCommit, results }, null, 2));
    console.log(`${id}: ${seconds.toFixed(2)}s; matching evidence`);
  }
}
const summary = scenarios.map(({ name }) => {
  const average = (variant) => {
    const runs = results.filter((run) => run.scenario === name && run.variant === variant);
    return runs.reduce((sum, run) => sum + run.seconds, 0) / runs.length;
  };
  const baseline = average('baseline');
  const current = average('current');
  return {
    scenario: name,
    baselineSeconds: baseline,
    currentSeconds: current,
    reductionPercent: 100 * (1 - current / baseline),
  };
});
writeFileSync(
  join(directory, 'summary.json'),
  JSON.stringify(
    {
      baselineCommit,
      runtime,
      sourceHashes: Object.fromEntries(
        Object.entries(sources).map(([variant, contents]) => [
          variant,
          Object.fromEntries(
            Object.entries(contents).map(([file, code]) => [file, createHash('sha256').update(code).digest('hex')])
          ),
        ])
      ),
      summary,
    },
    null,
    2
  )
);
console.table(summary);
console.log(`Matching diagnostic evidence saved in ${directory}. Not release-profile evidence.`);

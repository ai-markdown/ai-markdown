import process from 'node:process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { spawnSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LEGS, TASK_FILES, seedOverlap, taskEnvironment, expectedTests } from './soak-contract.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const script = (name) => resolve(root, `scripts/soak/${name}.mjs`);
const temp = (t) => {
  const dir = mkdtempSync(resolve(tmpdir(), 'aimd-soak-control-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const put = (path, data) => writeFileSync(path, JSON.stringify(data));
const parameters = {
  fuzz1: 12500,
  fuzz2: 30000,
  fuzz3: 8000,
  fuzz4: 40000,
  oracle: 4000,
  censusK: 4,
  censusStride: 1,
  censusNameK: 3,
  censusNameStride: 1,
  censusConfigMode: 'cross',
  fallbackOracleSample: 20,
};
function fixture(dir) {
  const m = {
    schemaVersion: 2,
    runId: 'fixture',
    mode: 'full',
    runKind: 'fresh',
    profile: 'release',
    failFast: true,
    repository: { commit: 'fixture', dirty: false },
    seedBase: 1000,
    legs: LEGS,
    shards: 14,
    workers: 2,
    parameters,
  };
  const r = {
    ...m,
    status: 'passed',
    repositoryChanged: false,
    legs: Object.fromEntries(LEGS.map((leg) => [leg, { status: 'passed', expectedShards: 14, completedShards: 14 }])),
  };
  put(`${dir}/manifest.json`, m);
  put(`${dir}/result.json`, r);
  for (const leg of LEGS)
    for (let shard = 0; shard < 14; shard++) {
      const id = `${leg}-${shard}`;
      const names = expectedTests(m, leg, shard);
      writeFileSync(`${dir}/${id}.log`, 'Tests  1 passed (1)\n');
      put(`${dir}/${id}.task.json`, { id, runId: m.runId, exitCode: 0, signal: null, status: 'passed' });
      put(`${dir}/${id}.vitest.json`, {
        success: true,
        numTotalTests: names.length,
        numPassedTests: names.length,
        numFailedTests: 0,
        numPendingTests: 0,
        numTodoTests: 0,
        testResults: [
          {
            name: `/fixture/src/${TASK_FILES[leg]}`,
            status: 'passed',
            assertionResults: names.map((path) => ({
              ancestorTitles: path.slice(0, -1),
              title: path.at(-1),
              status: 'passed',
              failureMessages: [],
            })),
          },
        ],
      });
      put(`${dir}/${id}.runtime.json`, { id, runId: m.runId, environment: taskEnvironment(m, leg, shard) });
    }
  return { m, r };
}
const aggregate = (dir) => spawnSync('node', [script('soak-aggregate'), dir], { encoding: 'utf8' });

test('accepts complete structured evidence', (t) => {
  const dir = temp(t);
  fixture(dir);
  assert.equal(aggregate(dir).status, 0);
});
for (const failedHeading of [null, 'Tests', 'Test Files']) {
  test(`colored verdicts ${failedHeading ? `reject failed ${failedHeading}` : 'accept passed tests'}`, (t) => {
    const dir = temp(t);
    fixture(dir);
    const passed = '\u001b[2m Tests \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m (1)\n';
    const failed = failedHeading
      ? `\u001b[2m ${failedHeading} \u001b[22m \u001b[31m1 failed\u001b[39m | 1 passed\n`
      : '';
    writeFileSync(`${dir}/fuzz-0.log`, failed + passed);
    const result = aggregate(dir);
    if (failedHeading) {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /missing clean Vitest verdict/);
    } else assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(`${dir}/fuzz-0.log`, 'utf8'), failed + passed);
  });
}

for (const fault of [
  'zero',
  'missing',
  'failed',
  'skipped',
  'environment',
  'exit',
  'count',
  'log',
  'wrong-file',
  'empty-assertions',
  'failed-assertion',
  'omitted-test',
  'duplicate-test',
  'wrong-test',
  'wrong-suite',
]) {
  test(`rejects ${fault} evidence`, (t) => {
    const dir = temp(t);
    const { r } = fixture(dir);
    const edit = (suffix, change) => {
      const path = `${dir}/fuzz-0.${suffix}.json`;
      const data = JSON.parse(readFileSync(path));
      change(data);
      put(path, data);
    };
    if (fault === 'zero') {
      r.legs.fuzz.expectedShards = 0;
      put(`${dir}/result.json`, r);
    }
    if (fault === 'count') {
      r.legs.fuzz.expectedShards = 1;
      put(`${dir}/result.json`, r);
    }
    if (fault === 'missing') rmSync(`${dir}/fuzz-0.vitest.json`);
    if (fault === 'failed')
      edit('vitest', (d) => {
        d.numFailedTests = 1;
      });
    if (fault === 'skipped')
      edit('vitest', (d) => {
        d.numPendingTests = 1;
      });
    if (fault === 'environment')
      edit('runtime', (d) => {
        d.environment.FUZZ_RUNS = '1';
      });
    if (fault === 'exit')
      edit('task', (d) => {
        d.exitCode = 1;
      });
    if (fault === 'wrong-file')
      edit('vitest', (d) => {
        d.testResults[0].name = '/wrong.test.ts';
      });
    if (fault === 'empty-assertions')
      edit('vitest', (d) => {
        d.testResults[0].assertionResults = [];
      });
    if (fault === 'failed-assertion')
      edit('vitest', (d) => {
        d.testResults[0].assertionResults = [{ status: 'failed' }];
      });
    if (['omitted-test', 'duplicate-test', 'wrong-test', 'wrong-suite'].includes(fault))
      edit('vitest', (d) => {
        const assertions = d.testResults[0].assertionResults;
        if (fault === 'omitted-test') {
          assertions.pop();
          d.numTotalTests = d.numPassedTests = assertions.length;
        }
        if (fault === 'duplicate-test') assertions[1] = assertions[0];
        if (fault === 'wrong-test') assertions[0].title = 'unexpected passing test';
        if (fault === 'wrong-suite') assertions[0].ancestorTitles = ['unexpected suite'];
      });
    if (fault === 'log') writeFileSync(`${dir}/fuzz-0.log`, 'Tests 1 failed | 1 passed\nTests 1 passed\n');
    assert.notEqual(aggregate(dir).status, 0);
  });
}

test('seed overlap respects logical streams and conservatively handles old ledgers', () => {
  const a = { seedBase: 800000, legs: ['fuzz'], shards: 14 };
  assert.equal(seedOverlap(a, { ...a, seedBase: 800001 }), true);
  assert.equal(seedOverlap(a, { ...a, seedBase: 800014 }), false);
  assert.equal(seedOverlap(a, { ...a, legs: ['oracle'] }), false);
  assert.equal(seedOverlap(a, { seedBase: 799910, legs: ['fuzz'] }), true);
});

function createArgs(dir, seed) {
  return [
    script('soak-metadata'),
    'create',
    '--run-dir',
    `${dir}/run-${seed}`,
    '--run-id',
    `run-${seed}`,
    '--label',
    'test',
    '--mode',
    'subset',
    '--run-kind',
    'fresh',
    '--seed',
    String(seed),
    '--legs',
    'fuzz',
    '--shards',
    '14',
    '--workers',
    '1',
    '--fail-fast',
    '1',
    '--cores',
    '2',
    '--profile',
    'smoke',
    '--parameters',
    JSON.stringify(parameters),
    '--state-dir',
    `${dir}/state`,
  ];
}
test('metadata rejects overlapping seeds and accepts disjoint ranges', (t) => {
  const dir = temp(t);
  assert.equal(spawnSync('node', createArgs(dir, 800000)).status, 0);
  assert.notEqual(spawnSync('node', createArgs(dir, 800001)).status, 0);
  assert.equal(spawnSync('node', createArgs(dir, 800014)).status, 0);
});
test('concurrent overlapping seed reservations cannot both succeed', async (t) => {
  const dir = temp(t);
  mkdirSync(`${dir}/state`);
  const outcomes = await Promise.allSettled(
    [800000, 800001].map((seed) => promisify(execFile)('node', createArgs(dir, seed)))
  );
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
});

// Use quick subprocesses to exercise cross-leg scheduling without running the
// fuzz/census workloads. Real Vitest setup and reporting are exercised below.
for (const scenario of [
  {
    name: 'full run prioritizes short checks and oracle',
    legs: LEGS,
    order: ['dir', 'scanner', 'oracle', 'latex', 'fuzz', 'census'],
  },
  {
    name: 'subset preserves selection with execution priority',
    legs: ['fuzz', 'scanner', 'oracle'],
    order: ['scanner', 'oracle', 'fuzz'],
  },
  {
    name: 'fail-fast leaves later legs unstarted',
    legs: ['fuzz', 'dir', 'oracle'],
    order: ['dir'],
    failure: true,
    failFast: true,
  },
  {
    name: 'collect mode continues into later legs',
    legs: ['fuzz', 'dir', 'oracle'],
    order: ['dir', 'oracle', 'fuzz'],
    failure: true,
    failFast: false,
  },
]) {
  test(scenario.name, (t) => {
    const dir = temp(t);
    const fixtureRoot = `${dir}/fixture`;
    const run = `${dir}/run`;
    for (const path of ['scripts/soak', 'packages/engine', 'node_modules/vitest'])
      mkdirSync(`${fixtureRoot}/${path}`, { recursive: true });
    mkdirSync(run);
    for (const file of ['soak-runner', 'soak-contract', 'soak-metadata'])
      copyFileSync(script(file), `${fixtureRoot}/scripts/soak/${file}.mjs`);
    copyFileSync(resolve(root, 'scripts/soak/test-inventory.json'), `${fixtureRoot}/scripts/soak/test-inventory.json`);
    writeFileSync(
      `${fixtureRoot}/node_modules/vitest/vitest.mjs`,
      `import process from 'node:process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { expectedTests } from '../../scripts/soak/soak-contract.mjs';
import { dirname, resolve } from 'node:path';
const task = JSON.parse(process.env.SOAK_TASK);
appendFileSync(resolve(dirname(task.output), 'started.jsonl'), JSON.stringify(task) + '\\n');
writeFileSync(task.output, JSON.stringify({ ...task, environment: task.environment }));
const failed = task.id === process.env.CONTROL_FAILED_TASK;
const manifest = JSON.parse(readFileSync(resolve(dirname(task.output), 'manifest.json')));
const [leg, shard] = task.id.split('-');
const names = expectedTests(manifest, leg, Number(shard));
const report = {
  success: !failed, numTotalTests: names.length, numPassedTests: failed ? 0 : names.length,
  numFailedTests: failed ? 1 : 0, numPendingTests: 0, numTodoTests: 0,
  testResults: [{ name: resolve(process.argv[3]), status: failed ? 'failed' : 'passed',
    assertionResults: names.map((path) => ({ ancestorTitles: path.slice(0, -1), title: path.at(-1), status: failed ? 'failed' : 'passed', failureMessages: [] })) }],
};
writeFileSync(process.argv.find((arg) => arg.startsWith('--outputFile.json=')).slice('--outputFile.json='.length), JSON.stringify(report));
process.stdout.write(failed ? 'Tests 1 failed\\n' : 'Tests 1 passed\\n');
process.exitCode = failed ? 1 : 0;
`
    );
    const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.trim();
    const m = {
      schemaVersion: 2,
      runId: 'scheduling',
      label: 'scheduling',
      mode: scenario.legs.length === LEGS.length ? 'full' : 'subset',
      runKind: 'replay',
      profile: 'smoke',
      repository: { commit: git('rev-parse', 'HEAD'), dirty: !!git('status', '--porcelain') },
      startedAt: new Date().toISOString(),
      seedBase: 700001,
      legs: scenario.legs,
      shards: 2,
      workers: 1,
      failFast: scenario.failFast ?? true,
      parameters,
    };
    put(`${run}/manifest.json`, m);
    const outcome = spawnSync(process.execPath, [`${fixtureRoot}/scripts/soak/soak-runner.mjs`, run], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, CONTROL_FAILED_TASK: scenario.failure ? 'dir-0' : '' },
    });
    assert.ifError(outcome.error);
    assert.equal(outcome.status, scenario.failure ? 1 : 0, outcome.stderr);
    assert.deepEqual(JSON.parse(readFileSync(`${run}/manifest.json`)), m);
    const result = JSON.parse(readFileSync(`${run}/result.json`));
    assert.equal(result.status, scenario.failure ? 'failed' : 'passed');
    assert.deepEqual(Object.keys(result.legs), scenario.order);
    const started = readFileSync(`${run}/started.jsonl`, 'utf8').trim().split('\n').map(JSON.parse);
    const expectedIds = scenario.order.flatMap((leg) =>
      Array.from({ length: scenario.failure && m.failFast ? 1 : m.shards }, (_, i) => `${leg}-${i}`)
    );
    assert.deepEqual(
      started.map((task) => task.id),
      expectedIds
    );
    for (const task of started) {
      const [leg, shard] = task.id.split('-');
      assert.deepEqual(task.environment, taskEnvironment(m, leg, Number(shard)));
    }
    if (!scenario.failure && m.mode === 'full') {
      const aggregated = spawnSync(process.execPath, [script('soak-aggregate'), '--profile', 'smoke', run], {
        encoding: 'utf8',
      });
      assert.equal(aggregated.status, 0, aggregated.stderr);
    }
  });
}

// Exercise the actual Vitest subprocess and its setup/reporting boundary.
async function realRun(t, workers, interrupt = false, fault = false, failFast = true, denyGroupKill = false) {
  const { spawn } = await import('node:child_process');
  const { setTimeout: delay } = await import('node:timers/promises');
  const dir = temp(t);
  const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.trim();
  const m = {
    schemaVersion: 2,
    runId: 'integration',
    label: 'integration',
    mode: 'subset',
    runKind: 'replay',
    profile: 'smoke',
    repository: { commit: git('rev-parse', 'HEAD'), dirty: !!git('status', '--porcelain') },
    startedAt: new Date().toISOString(),
    seedBase: 700001,
    legs: ['dir'],
    shards: 2,
    workers,
    failFast,
    parameters: { ...parameters, fuzz2: interrupt ? 100000000 : 100 },
  };
  put(`${dir}/manifest.json`, m);
  if (fault) mkdirSync(`${dir}/dir-0.runtime.json`);
  const env = { ...process.env };
  if (denyGroupKill) {
    const hook = `${dir}/deny-group-kill.mjs`;
    writeFileSync(
      hook,
      `import process from 'node:process';
      const kill = process.kill.bind(process);
      process.kill = (pid, signal) => {
        if (pid < 0) throw Object.assign(new Error('injected group kill denial'), { code: 'EPERM' });
        return kill(pid, signal);
      };`
    );
    env.NODE_OPTIONS = `--import=${JSON.stringify(hook)}`;
  }
  const child = spawn('node', [script('soak-runner'), dir], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const done = new Promise((resolveDone) => child.once('exit', (code) => resolveDone(code)));
  t.after(() => child.kill('SIGTERM'));
  if (interrupt) {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        ready = readFileSync(`${dir}/dir-0.log`, 'utf8').includes('RUN');
      } catch {
        /* Not started yet. */
      }
      if (ready) break;
      await delay(50);
    }
    assert.equal(ready, true);
    child.kill('SIGTERM');
  }
  const code = await done;
  let result;
  try {
    result = JSON.parse(readFileSync(`${dir}/result.json`));
  } catch (error) {
    throw new Error(`runner exited ${code}: ${output}`, { cause: error });
  }
  if (interrupt) {
    assert.notEqual(code, 0);
    assert.equal(result.status, 'interrupted');
    assert.equal(result.legs.dir.status, 'failed');
    if (denyGroupKill) assert.ok(JSON.parse(readFileSync(`${dir}/cleanup-errors.json`)).length > 0);
  } else if (fault) {
    assert.notEqual(code, 0);
    assert.equal(result.status, 'failed');
    assert.equal(result.legs.dir.completedShards, failFast ? 1 : 2);
  } else {
    assert.equal(code, 0);
    assert.equal(result.status, 'passed');
    for (let i = 0; i < 2; i++) {
      const runtime = JSON.parse(readFileSync(`${dir}/dir-${i}.runtime.json`));
      assert.deepEqual(runtime.environment, taskEnvironment(m, 'dir', i));
      assert.ok(runtime.maxRssKiB > 0);
    }
  }
}
test('one worker executes every logical shard', { timeout: 20000 }, (t) => realRun(t, 1));
test('two workers preserve the same logical streams', { timeout: 20000 }, (t) => realRun(t, 2));
test('interruption terminates workers and persists a non-passing result', { timeout: 20000 }, (t) =>
  realRun(t, 2, true)
);

test('fail-fast leaves unstarted shards unclaimed', { timeout: 20000 }, (t) => realRun(t, 1, false, true));
test('collect mode runs remaining shards after failure', { timeout: 20000 }, (t) => realRun(t, 1, false, true, false));

test('a previously replayed stream cannot become fresh evidence', (t) => {
  const dir = temp(t);
  const args = createArgs(dir, 900000);
  args[args.indexOf('fresh')] = 'replay';
  assert.equal(spawnSync('node', args).status, 0);
  assert.notEqual(spawnSync('node', createArgs(dir, 900001)).status, 0);
});

test('process-group denial still persists interruption and cleans other workers', { timeout: 20000 }, (t) =>
  realRun(t, 2, true, false, true, true)
);

test(
  'bounded smoke pins every budget and propagates launcher and evidence failures',
  { skip: process.platform === 'win32' },
  (t) => {
    const dir = temp(t);
    const log = resolve(dir, 'environment.json');
    writeFileSync(
      resolve(dir, 'bash'),
      `#!${process.execPath}
require('node:fs').writeFileSync(process.env.SMOKE_TEST_LOG, JSON.stringify(process.env));
process.exit(Number(process.env.SMOKE_TEST_EXIT));
`,
      { mode: 0o755 }
    );
    for (const status of [7, 0]) {
      const result = spawnSync(process.execPath, [script('smoke')], {
        encoding: 'utf8',
        timeout: 15000,
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          SMOKE_TEST_LOG: log,
          SMOKE_TEST_EXIT: String(status),
          SOAK_PROFILE: 'release',
          RUN_KIND: 'fresh',
          LEGS: 'latex',
          SHARDS: '99',
          WORKERS: '99',
          FUZZ1: '1',
          FUZZ2: '1',
          FUZZ3: '1',
          FUZZ4: '1',
          ORACLE: '1',
          CENSUS_K: '4',
          CENSUS_NAME_K: '4',
          CENSUS_STRIDE: '99',
          CENSUS_NAME_STRIDE: '99',
          FALLBACK_ORACLE_SAMPLE: '999',
          FAIL_FAST: '0',
        },
      });
      assert.ifError(result.error);
      assert.equal(result.status, status || 1, result.stderr);
      if (status === 0) assert.match(result.stderr, /missing manifest.json|missing result.json/);
      const env = JSON.parse(readFileSync(log, 'utf8'));
      for (const [key, value] of Object.entries({
        SOAK_PROFILE: 'smoke',
        RUN_KIND: 'replay',
        LEGS: LEGS.join(','),
        SHARDS: '2',
        WORKERS: '2',
        FUZZ1: '1000',
        FUZZ2: '1000',
        FUZZ3: '1000',
        FUZZ4: '1000',
        ORACLE: '100',
        CENSUS_K: '2',
        CENSUS_NAME_K: '2',
        CENSUS_STRIDE: '1',
        CENSUS_NAME_STRIDE: '1',
        FALLBACK_ORACLE_SAMPLE: '20',
        FAIL_FAST: '1',
      }))
        assert.equal(env[key], value, key);
    }
  }
);

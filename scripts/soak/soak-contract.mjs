import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

export const LEGS = ['fuzz', 'dir', 'scanner', 'census', 'oracle', 'latex'];
export const TASK_FILES = {
  fuzz: 'components/incrementalParse/spliceFuzz.test.ts',
  dir: 'components/incrementalParse/boundaryDirection.test.ts',
  scanner: 'components/collectDefLabels.fuzz.test.ts',
  census: 'components/incrementalParse/spliceExhaustive.test.ts',
  oracle: 'components/incrementalParse/oracleConformance.test.ts',
  latex: 'preprocessors/latexEntryEquivalence.fuzz.test.ts',
};

export const OFFSETS = { fuzz: 0, dir: 100, scanner: 200, oracle: 300, latex: 400 };
export const integer = (value, min = 1, max = 100) => Number.isInteger(value) && value >= min && value <= max;

// Independent, reviewed inventory: never derive the expected set from the
// report being validated. Suite parameters are expanded from the manifest;
// JSON tuples preserve suite boundaries without relying on reporter separators.
const inventory = JSON.parse(readFileSync(new URL('./test-inventory.json', import.meta.url), 'utf8'));
export function expectedTests(m, leg, shard) {
  const env = taskEnvironment(m, leg, shard);
  const values = {
    ...m.parameters,
    runs: env.FUZZ_RUNS,
    seed: env.FUZZ_SEED,
  };
  return inventory[leg].map((names) =>
    names.map((name) =>
      name.replace(/\{(\w+)\}/g, (_, key) => {
        if (values[key] === undefined) throw new Error(`Unknown inventory parameter ${key}`);
        return String(values[key]);
      })
    )
  );
}

export function seedOverlap(a, b) {
  return a.legs.some((leg) => {
    if (!b.legs.includes(leg)) return false;
    if (leg === 'census') return a.seedBase === b.seedBase;
    // Old ledgers did not store shard counts. Reserve their entire seed band.
    return a.seedBase <= b.seedBase + (b.shards ?? 100) - 1 && b.seedBase <= a.seedBase + (a.shards ?? 100) - 1;
  });
}

export function taskEnvironment(m, leg, shard) {
  const p = m.parameters;
  const env = { FALLBACK_ORACLE_SAMPLE: String(p.fallbackOracleSample), SOAK_HEARTBEAT: '30' };
  if (leg === 'census')
    Object.assign(env, {
      EXHAUSTIVE_K: String(p.censusK),
      EXHAUSTIVE_STRIDE: String(p.censusStride),
      EXHAUSTIVE_NAME_K: String(p.censusNameK),
      EXHAUSTIVE_NAME_STRIDE: String(p.censusNameStride),
      EXHAUSTIVE_CONFIG_MODE: p.censusConfigMode,
      EXHAUSTIVE_SHARD: `${shard}/${m.shards}`,
      EXHAUSTIVE_RAW_FROZEN: '1',
      EXHAUSTIVE_BFS_DEPTH: '2',
      EXHAUSTIVE_BFS_KEEP: '3',
      EXHAUSTIVE_BFS_MAX_FRONTIER: '120000',
      EXHAUSTIVE_ROTATE_SALT: '0',
    });
  else if (leg === 'oracle')
    Object.assign(env, {
      ORACLE_RAW: '1',
      ORACLE_RUNS: String(p.oracle),
      ORACLE_SEED: String(m.seedBase + OFFSETS[leg] + shard),
    });
  else
    Object.assign(env, {
      FUZZ_RUNS: String(p[{ fuzz: 'fuzz1', dir: 'fuzz2', scanner: 'fuzz3', latex: 'fuzz4' }[leg]]),
      FUZZ_SEED: String(m.seedBase + OFFSETS[leg] + shard),
    });
  return env;
}

export function validateTask(dir, m, leg, shard) {
  const id = `${leg}-${shard}`;
  const read = (suffix) => JSON.parse(readFileSync(`${dir}/${id}.${suffix}.json`, 'utf8'));
  const task = read('task');
  const report = read('vitest');
  const runtime = read('runtime');
  if (
    task.id !== id ||
    task.runId !== m.runId ||
    task.exitCode !== 0 ||
    task.signal !== null ||
    task.status !== 'passed'
  )
    throw new Error(`${id}: unsuccessful task`);
  if (
    report.success !== true ||
    !integer(report.numTotalTests, 1, 1000000) ||
    report.numPassedTests !== report.numTotalTests ||
    report.numFailedTests !== 0 ||
    report.numPendingTests !== 0 ||
    report.numTodoTests !== 0 ||
    report.testResults?.length !== 1 ||
    report.testResults.some((r) => r.status !== 'passed')
  )
    throw new Error(`${id}: incomplete or failed Vitest report`);
  const suite = report.testResults[0];
  if (
    typeof suite.name !== 'string' ||
    !suite.name.replaceAll('\\', '/').endsWith(`/src/${TASK_FILES[leg]}`) ||
    !Array.isArray(suite.assertionResults) ||
    suite.assertionResults.length !== report.numTotalTests ||
    suite.assertionResults.some((a) => a.status !== 'passed' || (a.failureMessages?.length ?? 0) > 0)
  )
    throw new Error(`${id}: wrong test file or inconsistent assertion results`);
  const names = suite.assertionResults.map((a) => JSON.stringify([...(a.ancestorTitles ?? []), a.title])).sort();
  const expectedNames = expectedTests(m, leg, shard)
    .map((names) => JSON.stringify(names))
    .sort();
  if (JSON.stringify(names) !== JSON.stringify(expectedNames))
    throw new Error(`${id}: test inventory differs (missing, duplicate or unexpected test)`);
  const expected = taskEnvironment(m, leg, shard);
  if (
    runtime.runId !== m.runId ||
    runtime.id !== id ||
    JSON.stringify(runtime.environment) !== JSON.stringify(expected)
  )
    throw new Error(`${id}: effective environment differs`);
  return task;
}

export function validateManifest(m) {
  if (
    m.schemaVersion !== 2 ||
    !integer(m.shards) ||
    !integer(m.workers) ||
    !integer(m.seedBase, 0, 2147483148) ||
    !['release', 'smoke'].includes(m.profile) ||
    !['fresh', 'replay'].includes(m.runKind) ||
    typeof m.failFast !== 'boolean' ||
    !Array.isArray(m.legs) ||
    m.legs.length === 0 ||
    new Set(m.legs).size !== m.legs.length ||
    m.legs.some((leg) => !LEGS.includes(leg)) ||
    m.mode !== (m.legs.length === LEGS.length ? 'full' : 'subset')
  )
    throw new Error('invalid manifest identity or work budget');
  const p = m.parameters;
  for (const key of [
    'fuzz1',
    'fuzz2',
    'fuzz3',
    'fuzz4',
    'oracle',
    'censusK',
    'censusStride',
    'censusNameK',
    'censusNameStride',
    'fallbackOracleSample',
  ]) {
    if (!integer(p[key], 1, 2147483647)) throw new Error(`invalid parameter ${key}`);
  }
  if (p.censusConfigMode !== 'cross') throw new Error('census must cross all configurations');
  if (m.profile === 'release') {
    if (m.runKind !== 'fresh' || m.repository.dirty !== false || m.shards < 14)
      throw new Error('release requires fresh seeds, a clean tree and at least 14 logical shards');
    const profile = JSON.parse(readFileSync(new URL('./profiles/release.json', import.meta.url), 'utf8'));
    for (const [key, rule] of Object.entries(profile.parameters)) {
      if (
        ('equals' in rule && p[key] !== rule.equals) ||
        ('minimum' in rule && p[key] < rule.minimum) ||
        ('maximum' in rule && p[key] > rule.maximum)
      )
        throw new Error(`release parameter ${key} violates profile`);
    }
  }
}

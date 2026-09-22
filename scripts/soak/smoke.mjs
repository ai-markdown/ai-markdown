/* global process, console */
import { execFileSync } from 'node:child_process';
import { URL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { LEGS } from './soak-contract.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const runId = `toolchain-smoke-${Date.now()}-${process.pid}`;
// Fixed replay budgets test execution, isolation and structured evidence, not
// fresh random coverage. Inherited diagnostic settings cannot drop a leg or
// accidentally turn this into a release campaign. K=2 and 1,000 samples retain
// the existing anti-vacuity floors; no test assertion is relaxed for smoke.
try {
  execFileSync('bash', [resolve(root, 'scripts/soak/soak.sh'), '9210500', 'toolchain-smoke'], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      SOAK_PROFILE: 'smoke',
      RUN_KIND: 'replay',
      RUN_ID: runId,
      LEGS: LEGS.join(','),
      SHARDS: '2',
      WORKERS: '2',
      FAIL_FAST: '1',
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
      SOAK_HEARTBEAT: '30',
    },
  });
  execFileSync(
    process.execPath,
    [resolve(root, 'scripts/soak/soak-aggregate.mjs'), '--profile', 'smoke', resolve(root, '.soak-logs', runId)],
    { cwd: root, stdio: 'inherit' }
  );
  console.log('Soak toolchain smoke passed. This is not release-profile evidence.');
} catch (error) {
  process.exitCode = error.status || 1;
}

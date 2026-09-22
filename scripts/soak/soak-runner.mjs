#!/usr/bin/env node
/* global process, console, setTimeout, clearTimeout */
import { spawn, execFileSync } from 'node:child_process';
import { openSync, closeSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { TASK_FILES, taskEnvironment, validateTask, validateManifest } from './soak-contract.mjs';

const dir = resolve(process.argv[2]);
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const m = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8'));
validateManifest(m);

// Surface short-leg and oracle failures before the long fuzz/census campaign.
// Execution priority does not change the manifest, logical shards or seeds.
const EXECUTION_ORDER = ['dir', 'scanner', 'oracle', 'latex', 'fuzz', 'census'];
const orderedLegs = [...m.legs].sort((a, b) => EXECUTION_ORDER.indexOf(a) - EXECUTION_ORDER.indexOf(b));

const active = new Set();
let stopped = false;
let interrupted = false;
let failed = false;
const cleanupErrors = [];
const write = (path, data) => {
  writeFileSync(`${path}.tmp`, JSON.stringify(data, null, 2) + '\n');
  renameSync(`${path}.tmp`, path);
};
const signalChild = (child, signal) => {
  try {
    if (!child.pid) return;
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code === 'ESRCH') return;
    // Cleanup errors must not abort delivery to the remaining workers or
    // prevent the non-passing result from being persisted.
    failed = true;
    cleanupErrors.push({ pid: child.pid, signal, error: error.message });
    console.error(`soak cleanup: ${error.message}`);
    try {
      child.kill(signal);
    } catch (fallbackError) {
      cleanupErrors.push({ pid: child.pid, signal, error: fallbackError.message });
    }
  }
};
const stop = () => {
  stopped = true;
  for (const child of active) {
    signalChild(child, 'SIGTERM');
    child.soakKillTimer ??= setTimeout(() => signalChild(child, 'SIGKILL'), 5000);
  }
};
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    interrupted = true;
    stop();
  });

async function task(leg, shard) {
  const id = `${leg}-${shard}`;
  const environment = taskEnvironment(m, leg, shard);
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(EXHAUSTIVE_|FUZZ_|ORACLE_|SOAK_|FALLBACK_ORACLE_SAMPLE$|NODE_OPTIONS$)/.test(key)) delete env[key];
  }
  Object.assign(env, environment, {
    SOAK_TASK: JSON.stringify({
      id,
      runId: m.runId,
      environment,
      output: `${dir}/${id}.runtime.json`,
    }),
  });
  const started = Date.now();
  const fd = openSync(`${dir}/${id}.log`, 'w');
  const child = spawn(
    process.execPath,
    [
      resolve(root, 'node_modules/vitest/vitest.mjs'),
      'run',
      `src/${TASK_FILES[leg]}`,
      '--maxWorkers=1',
      '--reporter=default',
      '--reporter=json',
      `--outputFile.json=${dir}/${id}.vitest.json`,
    ],
    { cwd: resolve(root, 'packages/engine'), env, detached: process.platform !== 'win32', stdio: ['ignore', fd, fd] }
  );
  closeSync(fd);
  active.add(child);
  write(`${dir}/${id}.task.json`, {
    id,
    runId: m.runId,
    pid: child.pid,
    status: 'running',
    startedAt: new Date(started).toISOString(),
  });
  const outcome = await new Promise((resolveOutcome) => {
    child.once('error', (error) => resolveOutcome({ exitCode: null, signal: null, error: error.message }));
    child.once('close', (exitCode, signal) => resolveOutcome({ exitCode, signal }));
  });
  active.delete(child);
  // A launcher may exit before a descendant handles termination. Reap the
  // remaining process group before cancelling the escalation timer.
  if (process.platform !== 'win32') signalChild(child, 'SIGKILL');
  clearTimeout(child.soakKillTimer);
  const result = {
    id,
    runId: m.runId,
    ...outcome,
    status: outcome.exitCode === 0 ? 'passed' : 'failed',
    startedAt: new Date(started).toISOString(),
    durationSeconds: (Date.now() - started) / 1000,
  };
  write(`${dir}/${id}.task.json`, result);
  try {
    validateTask(dir, m, leg, shard);
  } catch (error) {
    result.status = stopped ? 'cancelled' : 'failed';
    result.error = error.message;
    write(`${dir}/${id}.task.json`, result);
    failed = true;
    if (m.failFast) stop();
  }
  return result;
}

const legs = {};
try {
  for (const leg of orderedLegs) {
    const start = Date.now();
    const completed = [];
    let next = 0;
    console.log(`[${m.label}] ${leg} (${m.shards} tasks, ${m.workers} workers)`);
    await Promise.all(
      Array.from({ length: Math.min(m.workers, m.shards) }, async () => {
        while (!stopped && next < m.shards) completed.push(await task(leg, next++));
      })
    );
    legs[leg] = {
      status: completed.length === m.shards && completed.every((r) => r.status === 'passed') ? 'passed' : 'failed',
      expectedShards: m.shards,
      completedShards: completed.length,
      durationSeconds: (Date.now() - start) / 1000,
    };
    if (legs[leg].status !== 'passed') failed = true;
    console.log(`[${m.label}] ${leg} ${legs[leg].status} (${legs[leg].durationSeconds.toFixed(1)}s)`);
    if (stopped) break;
  }
} catch (error) {
  failed = true;
  stop();
  console.error(error);
}
if (cleanupErrors.length) write(`${dir}/cleanup-errors.json`, cleanupErrors);
const status = interrupted ? 'interrupted' : failed ? 'failed' : 'passed';
try {
  execFileSync(
    process.execPath,
    [
      resolve(root, 'scripts/soak/soak-metadata.mjs'),
      'finish',
      '--run-dir',
      dir,
      '--run-id',
      m.runId,
      '--mode',
      m.mode,
      '--run-kind',
      m.runKind,
      '--status',
      status,
      '--started-at',
      m.startedAt,
      '--legs-json',
      JSON.stringify(legs),
    ],
    { stdio: 'inherit' }
  );
} catch {
  failed = true;
}
if (failed || interrupted) process.exitCode = 1;
else console.log(m.mode === 'full' ? 'ALL CLEAN' : 'SUBSET CLEAN — not a complete release gate');

/* global process, console */

/**
 * Fails the build if any executable dist artifact still references
 * `process.env`. Same invariant as core (see core/scripts/assert-dist-clean.mjs
 * for the full rationale): the dual dev/prod build must fold NODE_ENV at
 * build time — an unresolved reference would throw at import time in
 * no-bundler runtimes. Source maps are exempt: they embed original source
 * text and are never executed.
 *
 * Additionally load-bearing for THIS package: the engine is
 * framework-agnostic and runtime-agnostic by contract (plan §5) — a
 * `process` reference in dist would also break non-Node JS runtimes
 * (Hermes without polyfill, QuickJS).
 */
import { readdirSync, readFileSync } from 'node:fs';

const offenders = readdirSync('dist', { recursive: true })
  .map(String)
  .filter((f) => f.endsWith('.js') || f.endsWith('.cjs'))
  .filter((f) => readFileSync(`dist/${f}`, 'utf8').includes('process.env'));

if (offenders.length > 0) {
  console.error(
    `assert-dist-clean: process.env leaked into ${offenders.join(', ')} — ` +
      'check that every tsdown config still sets env: { NODE_ENV }.'
  );
  process.exit(1);
}

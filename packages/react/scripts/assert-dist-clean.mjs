/* global process, console */

/**
 * Fails the build if any executable dist artifact still references
 * `process.env`. The dual dev/prod build must fold NODE_ENV at build time —
 * `env: { NODE_ENV }` on BOTH tsup configs is load-bearing (see
 * CONTRIBUTING.md, "Dev-only gates") — because an unresolved reference
 * would throw `ReferenceError: process is not defined` at import time in
 * no-bundler runtimes (browser native ESM/CDN, Deno). Source maps are
 * exempt: they embed original source text and are never executed.
 */
import { readdirSync, readFileSync } from 'node:fs';

// Recursive: subpath entries (e.g. dist/plugins/) must satisfy the same
// invariant as the root entry.
const offenders = readdirSync('dist', { recursive: true })
  .map(String)
  .filter((f) => f.endsWith('.js') || f.endsWith('.cjs'))
  .filter((f) => readFileSync(`dist/${f}`, 'utf8').includes('process.env'));

if (offenders.length > 0) {
  console.error(
    `assert-dist-clean: process.env leaked into ${offenders.join(', ')} — ` +
      'check that both tsup configs still set env: { NODE_ENV }.'
  );
  process.exit(1);
}

// Engine must never be inlined into core's bundle: engine holds module-level
// state (documentRegistry etc.), and an inlined copy coexisting with the
// external dependency means double instantiation — a correctness bug that
// only surfaces in real distribution, never in the workspace. Guard: once
// core source imports the engine package, every executable dist entry that
// mentions engine symbols must reach them through the bare specifier.
const ENGINE_SPECIFIER = '@ai-markdown/engine';
const srcImportsEngine = readdirSync('src', { recursive: true })
  .map(String)
  .filter((f) => (f.endsWith('.ts') || f.endsWith('.tsx')) && !f.includes('.test.'))
  .some((f) => readFileSync(`src/${f}`, 'utf8').includes(ENGINE_SPECIFIER));

if (srcImportsEngine) {
  const inlined = readdirSync('dist', { recursive: true })
    .map(String)
    // Engine-bearing entries only (component subentries intentionally omit it): `dist/plugins/index.js`
    // is `plugins/index.js` from readdirSync — a `startsWith('index')`
    // filter skipped it (2026-08-19 review r2 P3). Chunk files (if tsup ever
    // splits) are excluded by name; entries are the `index.*` files.
    .filter((f) => (f.endsWith('.js') || f.endsWith('.cjs')) && /^(?:plugins\/)?index(?:\.dev)?\.(js|cjs)$/.test(f))
    .filter((f) => !readFileSync(`dist/${f}`, 'utf8').includes(ENGINE_SPECIFIER));

  if (inlined.length > 0) {
    console.error(
      `assert-dist-clean: ${inlined.join(', ')} does not reference "${ENGINE_SPECIFIER}" ` +
        'while src imports it — engine code was likely inlined (check tsup external/noExternal).'
    );
    process.exit(1);
  }
}

// Shared core must resolve as a real external dependency in every root build.
for (const entry of ['index.js', 'index.cjs', 'index.dev.js', 'index.dev.cjs']) {
  if (!readFileSync(`dist/${entry}`, 'utf8').includes('@ai-markdown/core')) {
    throw new Error(`${entry}: shared core was inlined or omitted`);
  }
}

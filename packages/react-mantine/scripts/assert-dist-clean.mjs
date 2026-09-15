/* global process, console */

/**
 * Fails the build if any executable dist artifact references `process.env`.
 * Same invariant as core/engine (see core/scripts/assert-dist-clean.mjs for
 * the full rationale): an unresolved reference throws at import time in
 * no-bundler runtimes (CDN ESM, Deno). mantine has no dev/prod dual build
 * today because nothing in its source reads the environment — this check
 * makes that an ENFORCED invariant rather than a happy accident: the first
 * dev-only gate added here must come with `env: { NODE_ENV }` folding in
 * tsup (and a `development` exports condition), or the build fails right
 * here instead of in a consumer's browser (2026-08 project review,
 * infra-10). Source maps are exempt: they embed original source text.
 */
import { readdirSync, readFileSync } from 'node:fs';

const offenders = readdirSync('dist', { recursive: true })
  .map(String)
  .filter((f) => f.endsWith('.js') || f.endsWith('.cjs'))
  .filter((f) => readFileSync(`dist/${f}`, 'utf8').includes('process.env'));

if (offenders.length > 0) {
  console.error(
    `assert-dist-clean: process.env leaked into ${offenders.join(', ')} — ` +
      'mantine has no NODE_ENV folding — add env: { NODE_ENV } dual builds to tsup before shipping a dev-only gate.'
  );
  process.exit(1);
}

// Both dist entries must open with the `'use client'` directive. Every
// export here uses hooks and context, so an RSC consumer that imports the
// package from a server component needs the boundary marked in the bundle
// itself. esbuild keeps a directive only from the entry file (src/index.tsx)
// and drops the ones in nested modules, which is how 3.0.2 shipped without
// it. The check reads the directive prologue: the leading run of
// string-literal statements (the CJS build puts "use strict" first), with
// blank lines and `//` comments skipped.
const DIRECTIVE = /^["']use client["'];?$/;
const missingDirective = ['index.js', 'index.cjs'].filter((f) => {
  const lines = readFileSync(`dist/${f}`, 'utf8').split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (t === '' || t.startsWith('//')) continue;
    if (DIRECTIVE.test(t)) return false;
    if (!/^["'][^"']*["'];?$/.test(t)) return true;
  }
  return true;
});

if (missingDirective.length > 0) {
  console.error(
    `assert-dist-clean: 'use client' directive missing from ${missingDirective.join(', ')} — ` +
      'the directive must be the first statement of src/index.tsx, and tsup must not enable `treeshake` (it strips directives).'
  );
  process.exit(1);
}

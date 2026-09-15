import { defineConfig, type Options } from 'tsup';

// Typed so misspelled/renamed keys fail the config typecheck — spread-in
// properties bypass excess-property checking at the use sites below.
//
// NOTE: no `external: ['react', ...]` here and none may ever be added —
// this package is framework-agnostic by contract. React must not appear in
// dependencies, peerDependencies, or the bundle. The typecheck enforces it
// (react types are simply not resolvable from this package).
const shared: Options = {
  format: ['cjs', 'esm'],
  sourcemap: true,
  noExternal: ['lodash-es'],
  // The rollup treeshake pass is what turns the build-time NODE_ENV fold
  // into removed code: esbuild alone leaves every `if (false) { ... }` body
  // in place (it only drops them under minifySyntax), so dev-only
  // invariants, the seal-release containment module and other test hooks
  // shipped in the production bundle. With the pass on, the production
  // ESM build went from 230,560 to 225,472 bytes (2026-09-15, together
  // with moving the test-only modules out of the import graph), every
  // `if (false)` body is gone, and the export list is unchanged.
  //
  // Known cost of the pass: it strips module-level directives such as
  // 'use client' (verified in core). This package has none and must not
  // grow one; core, which is the adapters' boundary, keeps the pass off.
  treeshake: true,
};

/**
 * Dual dev/prod build, selected by the `development` exports condition in
 * package.json — same regime as core (see core/tsup.config.ts for the full
 * rationale): both builds fold `process.env.NODE_ENV` at BUILD time so no
 * published file contains a `process` reference, which would throw in
 * no-bundler runtimes (browser native ESM/CDN, Deno).
 */
const builds: Options[] = [
  // Production build. `clean` must stay FALSE on both configs: tsup builds
  // array configs concurrently, so a clean here races the other config's
  // file writes. The build script rm -rf's dist BEFORE tsup starts instead.
  {
    ...shared,
    entry: { index: 'src/index.ts' },
    dts: true,
    clean: false,
    env: { NODE_ENV: 'production' },
  },
  // Development build: gates fold to true — dev invariants always on.
  {
    ...shared,
    entry: { 'index.dev': 'src/index.ts' },
    dts: false,
    clean: false, // see above — never clean from inside the array
    env: { NODE_ENV: 'development' },
  },
];

export default defineConfig(
  builds.flatMap((config) =>
    (['esm', 'cjs'] as const).map((format) => ({
      ...config,
      format: [format],
      dts: config.dts,
      // Keep ESM imports external as before; only CJS needs default-export
      // adaptation. remark-pangu is CommonJS and must keep its own visit
      // dependency, rather than binding to the engine's newer visit API.
      noExternal:
        format === 'cjs'
          ? ['lodash-es', 'remend', /^remark-(?!pangu$)/, /^rehype-/, '@ai-markdown/rehype-raw']
          : ['lodash-es'],
    }))
  )
);

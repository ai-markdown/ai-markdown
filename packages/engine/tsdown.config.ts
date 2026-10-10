import { defineConfig, type UserConfig } from 'tsdown';

// Typed so misspelled/renamed keys fail the config typecheck — spread-in
// properties bypass excess-property checking at the use sites below.
//
// NOTE: no `deps.neverBundle: ['react', ...]` here and none may ever be
// added — this package is framework-agnostic by contract. React must not
// appear in dependencies, peerDependencies, or the bundle. The typecheck
// enforces it (react types are simply not resolvable from this package).
const shared: UserConfig = {
  sourcemap: true,
  // `clean` must stay FALSE on every config: they all write to one dist. The
  // build script removes dist before tsdown starts instead.
  clean: false,
  // Published names are index.js / index.cjs / index.d.ts / index.d.cts;
  // the default for a node-platform build is .mjs / .d.mts.
  fixedExtension: false,
  // No syntax lowering. The default derives a target from `engines.node`.
  target: 'esnext',
  // Keep `exports.default` in CJS rather than `module.exports = default`.
  cjsDefault: false,
  // Tree shaking (on by default) is what turns the build-time NODE_ENV fold
  // into removed code: dev-only invariants, the seal-release containment
  // module and other test hooks are absent from the production bundle.
  // Dual CJS output is deliberate; every other warning fails the build.
  checks: { legacyCjs: false },
  failOnWarn: true,
  // Omit the `//#region` module markers from the output.
  inputOptions: { experimental: { attachDebugInfo: 'none' } },
  outputOptions: {
    // Source modules are ESM and therefore strict; without this the CJS
    // build would run the same code in sloppy mode.
    strict: true,
    // Mark every CJS entry as a transpiled ES module, with or without a
    // default export, so interop helpers read named exports the same way.
    esModule: true,
    // No `Symbol.toStringTag` on the exports object. Besides matching the
    // previously published shape, the generated prelude would read `Symbol`
    // before a bundled module's own top-level `var Symbol` is assigned
    // (lodash declares one), which throws on load.
    generatedCode: { symbols: false },
    // JSDoc stays in the declarations, not in the runtime files. Legal
    // comments of bundled dependencies are kept.
    comments: { legal: true, annotation: true, jsdoc: false },
  },
};

/**
 * Dual dev/prod build, selected by the `development` exports condition in
 * package.json — same regime as core (see core/tsdown.config.ts for the full
 * rationale): both builds fold `process.env.NODE_ENV` at BUILD time so no
 * published file contains a `process` reference, which would throw in
 * no-bundler runtimes (browser native ESM/CDN, Deno).
 */
const builds: UserConfig[] = [
  // Production build.
  {
    ...shared,
    entry: { index: 'src/index.ts' },
    dts: true,
    env: { NODE_ENV: 'production' },
  },
  // Development build: gates fold to true — dev invariants always on.
  {
    ...shared,
    entry: { 'index.dev': 'src/index.ts' },
    dts: false,
    env: { NODE_ENV: 'development' },
  },
];

export default defineConfig(
  builds.flatMap((config) =>
    (['esm', 'cjs'] as const).map((format): UserConfig => ({
      ...config,
      format: [format],
      // Import cycles in the engine's own modules fail the build. Checked
      // on the one config that sees only those: the declaration graph
      // counts type-only cycles (freezeScanState <-> taskListContext), and
      // the CJS graph includes the inlined parsing chain, which has cycles
      // of its own.
      checks: { ...shared.checks, circularDependency: format === 'esm' && config.dts === false },
      deps:
        format === 'cjs'
          ? {
              // Only CJS needs default-export adaptation, so the ESM-only
              // parsing chain is inlined there. remark-pangu is CommonJS
              // and must keep its own visit dependency, rather than
              // binding to the engine's newer visit API.
              alwaysBundle: ['lodash-es', 'remend', /^remark-(?!pangu$)/, /^rehype-/, '@ai-markdown/rehype-raw'],
              // The inlined set follows the parsing chain's own dependency
              // tree; collect-bundled-licenses.mjs reads it back from the
              // source maps and fails on a package without a license.
              onlyBundle: false,
              // Declarations import the chain's types in both formats;
              // without this index.d.cts would inline them and drift from
              // index.d.ts.
              dts: { alwaysBundle: [] },
            }
          : {
              // ESM keeps every dependency external. lodash-es is the one
              // dev-only package allowed inside the bundle; an import of
              // any other undeclared package fails the build.
              alwaysBundle: ['lodash-es'],
              onlyBundle: ['lodash-es'],
            },
    }))
  )
);

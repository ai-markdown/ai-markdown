import { defineConfig } from 'tsdown';

// Plain dual build: this package has no dev-only gates, so there is no dev/prod
// split (unlike core). CJS ships next to ESM so bare Node `require()` consumers
// work without a bundler.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  // The build script removes dist before tsdown starts.
  clean: false,
  // Published names are index.js / index.cjs / index.d.ts / index.d.cts;
  // the default for a node-platform build is .mjs / .d.mts.
  fixedExtension: false,
  // No syntax lowering. The default derives a target from `engines.node`.
  target: 'esnext',
  // Keep `exports.default` in CJS rather than `module.exports = default`.
  cjsDefault: false,
  // Nothing may be inlined: an import of an undeclared or dev-only package
  // fails the build instead of being bundled.
  deps: { onlyBundle: [] },
  // Dual CJS output is deliberate; every other warning fails the build,
  // import cycles included.
  checks: { legacyCjs: false, circularDependency: true },
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
    // JSDoc stays in the declarations, not in the runtime files.
    comments: { legal: true, annotation: true, jsdoc: false },
  },
});

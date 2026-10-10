import { defineConfig, type UserConfig } from 'tsdown';

// Typed so misspelled/renamed keys fail the config typecheck — spread-in
// properties bypass excess-property checking at the use sites below.
const shared: UserConfig = {
  format: ['esm', 'cjs'],
  sourcemap: true,
  // Both configs write to one dist, so neither may clean it. The build script
  // removes dist before tsdown starts.
  clean: false,
  // Published names are index.js / index.cjs / index.d.ts / index.d.cts;
  // the default for a node-platform build is .mjs / .d.mts.
  fixedExtension: false,
  // No syntax lowering. The default derives a target from `engines.node`.
  target: 'esnext',
  // Keep `exports.default` in CJS rather than `module.exports = default`.
  cjsDefault: false,
  deps: {
    // Keep the engine external: its registry state must have a single owner.
    neverBundle: ['@ai-markdown/engine'],
    // Nothing may be inlined: an import of an undeclared or dev-only package
    // fails the build instead of being bundled.
    onlyBundle: [],
  },
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
    // Chunks export under their source names, not single letters.
    minifyInternalExports: false,
  },
};

// Both builds fold `process.env.NODE_ENV` at build time and drop the branches
// that become unreachable, so no published file references `process`.
export default defineConfig([
  {
    ...shared,
    entry: { index: 'src/index.ts', 'components/index': 'src/components/index.ts' },
    dts: true,
    env: { NODE_ENV: 'production' },
  },
  {
    ...shared,
    entry: { 'index.dev': 'src/index.ts' },
    dts: false,
    env: { NODE_ENV: 'development' },
  },
]);

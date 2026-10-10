import { defineConfig, type UserConfig } from 'tsdown';

// Typed so misspelled/renamed keys fail the config typecheck — spread-in
// properties bypass excess-property checking at the use sites below.
const shared: UserConfig = {
  format: ['cjs', 'esm'],
  sourcemap: true,
  // `clean` must stay FALSE on both configs: they write to one dist. The
  // build:js script removes dist before tsdown starts instead.
  clean: false,
  // Published names are index.js / index.cjs / index.d.ts / index.d.cts;
  // the default for a node-platform build is .mjs / .d.mts.
  fixedExtension: false,
  // No syntax lowering. The default derives a target from `engines.node`.
  target: 'esnext',
  // Keep `exports.default` in CJS rather than `module.exports = default`.
  cjsDefault: false,
  deps: {
    // `@ai-markdown/engine` is external as a drift guard, not because
    // tsdown would otherwise inline it (dependencies are external by
    // default): if a future alwaysBundle pattern ever catches it, engine's
    // module-level state (documentRegistry etc.) would be double-instantiated
    // — a correctness bug that only surfaces in real distribution, never in
    // the workspace. assert-dist-clean.mjs holds the matching dist-side
    // assertion.
    neverBundle: ['react', 'react-dom', '@ai-markdown/engine', '@ai-markdown/core', '@ai-markdown/react', 'mermaid'],
    alwaysBundle: ['lodash-es'],
    // The complete list of packages allowed inside the bundle. An import of
    // any other undeclared or dev-only package fails the build.
    // tsdown prints an "entries not used" hint for this list although
    // lodash-es is inlined; with an empty list the build fails on it.
    onlyBundle: ['lodash-es'],
  },
  checks: {
    // Dual CJS output is deliberate.
    legacyCjs: false,
    // The root entry has a default export next to named ones; CJS consumers
    // read it as `.default`, which the packed-consumer tests cover.
    mixedExports: false,
    // The bundler keeps "use client" from entry files only and reports the
    // ones in other modules. Every client entry carries its own directive.
    moduleLevelDirective: false,
  },
  // Every other warning fails the build.
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

/**
 * Dual dev/prod build (react/redux-style), selected by the `development`
 * exports condition in package.json.
 *
 * Source keeps writing bare `process.env.NODE_ENV` gates everywhere; both
 * builds resolve them at BUILD time and drop the branches that become
 * unreachable, so neither published file contains a `process` reference.
 * That kills an entire crash class: in a no-bundler runtime (browser native
 * ESM / CDN import, Deno) evaluating a bare gate throws
 * `ReferenceError: process is not defined` — and resolvers that don't know
 * the `development` condition fall through to the production build, making
 * "safe" the default for unknown consumers.
 */
export default defineConfig([
  // Production build: gates fold to false and dev-only branches are removed.
  // This is what `import`/`require` (and the top-level main/module fields)
  // point at.
  {
    ...shared,
    entry: {
      index: 'src/index.tsx',
      'plugins/index': 'src/plugins/index.ts',
      'components/index': 'src/rich/index.ts',
      'components/code': 'src/rich/code.ts',
      'components/code/plain': 'src/rich/code-plain.tsx',
      'components/image': 'src/rich/image.tsx',
      'components/table': 'src/rich/table.tsx',
    },
    dts: true,
    env: { NODE_ENV: 'production' },
  },
  // Development build: gates fold to true — warnings and dev invariants
  // always on. Picked up by resolvers that know the `development`
  // condition (Vite dev, webpack/Next in development mode).
  {
    ...shared,
    entry: { 'index.dev': 'src/index.tsx', 'plugins/index.dev': 'src/plugins/index.ts' },
    dts: false,
    env: { NODE_ENV: 'development' },
    // Import cycles fail the build. Checked here because this config emits
    // no declarations: the declaration graph counts `import type` edges, and
    // define.ts <-> index.tsx is a type-only cycle with no runtime effect.
    checks: { ...shared.checks, circularDependency: true },
  },
]);

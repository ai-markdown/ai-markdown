import { defineConfig, type Options } from 'tsup';

// Typed so misspelled/renamed keys fail the config typecheck — spread-in
// properties bypass excess-property checking at the use sites below.
const shared: Options = {
  format: ['cjs', 'esm'],
  sourcemap: true,
  // `@ai-markdown/engine` is external as a drift guard, not because
  // tsup would otherwise inline it (deps are auto-externalized): if a future
  // noExternal pattern ever catches it, engine's module-level state
  // (documentRegistry etc.) would be double-instantiated — a correctness
  // bug that only surfaces in real distribution, never in the workspace.
  // assert-dist-clean.mjs holds the matching dist-side assertion.
  external: ['react', 'react-dom', '@ai-markdown/engine', '@ai-markdown/core', '@ai-markdown/react', 'mermaid'],
  noExternal: ['lodash-es'],
  // NO `treeshake: true` here: tsup's rollup treeshake pass strips the
  // module-level "use client" directive (verified), which would break RSC
  // consumers. The cost is that env replacement leaves inert `if (false)`
  // bodies in the output — a few KB that never execute and that any
  // consumer minifier removes; safety doesn't depend on them being gone.
};

/**
 * Dual dev/prod build (react/redux-style), selected by the `development`
 * exports condition in package.json.
 *
 * Source keeps writing bare `process.env.NODE_ENV` gates everywhere; both
 * builds resolve them at BUILD time, so neither published file contains a
 * `process` reference. That kills an entire crash class: in a no-bundler
 * runtime (browser native ESM / CDN import, Deno) evaluating a bare gate
 * throws `ReferenceError: process is not defined` — and resolvers that
 * don't know the `development` condition fall through to the production
 * build, making "safe" the default for unknown consumers.
 */
export default defineConfig([
  // Production build: gates fold to false, dev-only branches are
  // dead-code-eliminated. This is what `import`/`require` (and the
  // top-level main/module fields) point at.
  //
  // `clean` must stay FALSE on both configs: tsup builds array configs
  // concurrently (Promise.all), so a clean here races the other config's
  // file writes and can silently delete its freshly-emitted output — a
  // published package whose `development` condition points at nothing.
  // The build:js script rm -rf's dist BEFORE tsup starts instead.
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
    clean: false,
    env: { NODE_ENV: 'production' },
  },
  // Development build: gates fold to true — warnings and dev invariants
  // always on. Picked up by resolvers that know the `development`
  // condition (Vite dev, webpack/Next in development mode).
  {
    ...shared,
    entry: { 'index.dev': 'src/index.tsx', 'plugins/index.dev': 'src/plugins/index.ts' },
    dts: false,
    clean: false, // see above — never clean from inside the array
    env: { NODE_ENV: 'development' },
  },
]);

import { defineConfig } from 'tsdown';
import autoprefixer from 'autoprefixer';
import type { Plugin } from 'postcss';

// Sass keeps `/* */` comments and prefixes each compiled file with its own
// `@charset` once a comment holds a non-ASCII character. The files are
// concatenated, so the second `@charset` would land mid-sheet, where it is
// invalid. Neither belongs in the published stylesheet; with the comments
// gone the rules are plain ASCII and need no `@charset` at all.
const publishedCss: Plugin = {
  postcssPlugin: 'published-css',
  Comment: (comment) => {
    comment.remove();
  },
  AtRule: {
    charset: (rule) => {
      rule.remove();
    },
  },
};

export default defineConfig({
  entry: {
    independent: 'src/independent.tsx',
    index: 'src/index.tsx',
    components: 'src/components.tsx',
    'components/code/independent': 'src/rich/code-independent.tsx',
  },
  dts: true,
  format: ['cjs', 'esm'],
  sourcemap: true,
  clean: true,
  // Published names are index.js / index.cjs / index.d.ts / index.d.cts;
  // the default for a node-platform build is .mjs / .d.mts.
  fixedExtension: false,
  // No syntax lowering. The default derives a target from `engines.node`.
  target: 'esnext',
  // Keep `exports.default` in CJS rather than `module.exports = default`.
  cjsDefault: false,
  deps: {
    neverBundle: ['react', 'react-dom', '@mantine/core', '@ai-markdown/react'],
    // Nothing may be inlined: an import of an undeclared or dev-only package
    // fails the build instead of being bundled.
    onlyBundle: [],
  },
  checks: {
    // Dual CJS output is deliberate.
    legacyCjs: false,
    // Import cycles fail the build.
    circularDependency: true,
    // The root entry has a default export next to named ones; CJS consumers
    // read it as `.default`.
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
  // Both entries' Sass imports compile into the one published stylesheet,
  // `dist/index.css` (the `./styles.css` export).
  css: {
    fileName: 'index.css',
    transformer: 'postcss',
    postcss: { plugins: [autoprefixer, publishedCss] },
  },
});

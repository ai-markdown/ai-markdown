import { defineConfig } from 'tsup';

// Plain dual build: this package has no dev-only gates, so there is no dev/prod
// split (unlike core). CJS ships next to ESM so bare Node `require()` consumers
// work without a bundler.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: false,
});

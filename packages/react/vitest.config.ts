/**
 * Per-package vitest config for `@ai-markdown/react`.
 *
 * Self-contained — does NOT extend `../../vitest.config.ts`. The root config
 * registers the `@storybook/addon-vitest` plugin, whose indexer walks from
 * cwd to find Storybook configuration. Running `vitest` inside this package
 * subdir would invoke the indexer at the wrong root and fail config
 * resolution before any unit test runs.
 *
 * Duplicating the relevant fields here is cleaner than overriding the
 * storybook plugin out of an extended root config. The repo-wide
 * `pnpm test` (from the workspace root) still uses `../../vitest.config.ts`
 * and gets both the unit project AND the storybook browser project.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fsModuleCache: true,
    name: 'unit',
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    benchmark: {
      include: ['src/**/*.bench.{ts,tsx}'],
    },
  },
});

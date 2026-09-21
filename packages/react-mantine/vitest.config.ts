/**
 * Per-package vitest config for `@ai-markdown/react-mantine`.
 *
 * Self-contained — does NOT extend `../../vitest.config.ts`, for the same
 * reason as the core package's config: the root config registers the
 * `@storybook/addon-vitest` plugin, whose indexer walks from cwd and fails
 * config resolution when invoked from a package subdir.
 *
 * The repo-wide `pnpm vitest run` (from the workspace root) still picks these
 * tests up via the root config's `packages/*` include glob.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fsModuleCache: true,
    name: 'unit',
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});

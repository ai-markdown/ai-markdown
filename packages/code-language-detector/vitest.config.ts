/**
 * Per-package vitest config — self-contained for the same reason as
 * `packages/react/vitest.config.ts`: the root config registers the Storybook
 * plugin, whose indexer walks from cwd and breaks when invoked from a
 * package subdirectory. The repo-wide `pnpm vitest run` (workspace root)
 * still picks these tests up through the root unit project.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'unit',
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});

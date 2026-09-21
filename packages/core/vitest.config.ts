import { defineConfig } from 'vitest/config';

// pnpm -r test runs from the package directory. Keep this entry independent
// of the root Storybook project while the root unit project also finds it.
export default defineConfig({
  test: {
    fsModuleCache: true,
    name: 'unit',
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});

import path from 'node:path';

import { defineConfig } from 'vitest/config';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';

import { playwright } from '@vitest/browser-playwright';

const dirname = import.meta.dirname;

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
  test: {
    fsModuleCache: true,
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['packages/*/src/**/*.{test,spec}.{ts,tsx}', 'prototypes/*/src/**/*.test.ts'],
          benchmark: {
            include: ['packages/*/src/**/*.bench.{ts,tsx}'],
          },
        },
      },
      ...(['react', 'vue'] as const).map((framework) => ({
        plugins: [
          // The plugin will run tests for the stories defined in your Storybook config
          // See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
          storybookTest({
            configDir: path.join(dirname, `apps/storybook-${framework}/.storybook`),
            // The benchmark harnesses stream on mount in dev and in the static
            // build (they are the Performance Lab). Under test nobody watches
            // them, so they render their idle UI instead of burning rAF and
            // long-task budget for the whole run. The stories still mount and
            // still assert — only the auto-start is off.
            initialGlobals: { autoStart: 'off' },
          }),
        ],
        test: {
          name: `storybook-${framework}`,
          dir: dirname,
          root: dirname,
          // Streaming smokes legitimately wait through multi-second windows
          // (e.g. the streaming cursor's 5 s stall threshold plus recovery).
          // The browser-mode default of 15 s would kill those runs with an
          // opaque runner timeout instead of the failing waitFor's message.
          // 45 s leaves margin over the longest in-story wait — the 30 s
          // `waitFor` in streaming/IncrementalParse.stories.tsx — so that a
          // slow machine reports the failing assertion rather than a bare
          // runner timeout.
          testTimeout: 45_000,
          browser: {
            enabled: true,
            headless: true,
            // Preserve the measured v4 Storybook viewport; v5 otherwise runs
            // these desktop stories at its default mobile size (414x896).
            viewport: { width: 1200, height: 900 },
            provider: playwright({}),
            instances: [{ browser: 'chromium' as const }],
          },
          // No `setupFiles`: since Storybook 10.3 `@storybook/addon-vitest`
          // applies the preview and a11y-addon annotations itself, and a
          // hand-written `setProjectAnnotations` call makes it skip that
          // automatic provisioning instead of adding to it.
          // Don't run benchmarks in the browser project — they're CPU-bound
          // and run under node in the `unit` project.
          benchmark: {
            include: [],
          },
        },
      })),
    ],
  },
});

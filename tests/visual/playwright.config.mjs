/* global process */
import { defineConfig } from 'playwright/test';

// Both local runs and CI execute this configuration in the pinned Linux image.
if (process.platform !== 'linux' || process.arch !== 'x64') {
  throw new Error('Use pnpm test:storybook:visual (the pinned Linux amd64 container).');
}
export default defineConfig({
  testDir: '.',
  forbidOnly: true,
  updateSnapshots: 'none',
  testMatch: '*.spec.mjs',
  snapshotPathTemplate: '{testDir}/baselines/{arg}{ext}',
  outputDir: '../../test-results/storybook-visual',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45000,
  expect: { toHaveScreenshot: { maxDiffPixels: 0, threshold: 0.1, animations: 'disabled' } },
  use: {
    browserName: 'chromium',
    headless: true,
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
  },
  webServer: {
    command: 'node scripts/storybook-static-server.mjs',
    cwd: '../..',
    url: 'http://127.0.0.1:6108/preview/storybook/',
    reuseExistingServer: false,
  },
});

/**
 * Config for the EVIDENCE harnesses (`src/**\/*.evidence.ts`): the accuracy
 * and streaming measurements over the GitHub corpus. They are not tests and
 * sit outside the default `include`, so they never enter the test count or
 * preflight, and they need a corpus fetched with
 * `node scripts/fetch-github-corpus.mjs` first. Run them with
 * `pnpm --filter @ai-markdown/code-language-detector evidence`.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fsModuleCache: true,
    name: 'evidence',
    environment: 'node',
    include: ['src/**/*.evidence.ts'],
    // Explicit, because these harnesses exist to PRINT. They write through
    // `process.stdout.write` rather than `console.*`: vitest 4 drops console
    // output from passing tests unless a reporter is named.
    reporters: ['default'],
    testTimeout: 600_000,
  },
});

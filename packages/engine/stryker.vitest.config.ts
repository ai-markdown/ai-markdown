import { defineConfig } from 'vitest/config';

/**
 * Vitest config used ONLY by the Stryker mutation audit (stryker.conf.json):
 * the KILLER suite is the fast arbiter set — the fixture arbiter, the
 * scanner unit tests, the engine unit tests, and the direction battery at
 * its default scale. The fuzz/exhaustive suites are excluded (they would
 * multiply every mutant's run by minutes without adding much killing power
 * over the fixture corpus, which now embeds every fuzz-found regression).
 */
export default defineConfig({
  test: {
    // Stryker changes the instrumented program between runs.
    fsModuleCache: false,
    environment: 'node',
    include: [
      'src/components/incrementalParse/spliceEquivalence.test.ts',
      'src/components/incrementalParse/computeFreezeBoundary.test.ts',
      'src/components/incrementalParse/advanceIncrementalParse.test.ts',
      'src/components/incrementalParse/detectorConsistency.test.ts',
      'src/components/incrementalParse/boundaryDirection.test.ts',
    ],
  },
});

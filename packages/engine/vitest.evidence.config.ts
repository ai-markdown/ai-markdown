/**
 * Config for the EVIDENCE harnesses (`src/**\/*.evidence.ts`), which are not
 * tests and are deliberately outside the default `include`
 * (`src/**\/*.{test,spec}.{ts,tsx}`) so they cannot enter the test count or
 * redden preflight. Nothing runs them but `scripts/soak/gate-evidence.sh`.
 *
 * A harness holds the COMPARATIVE measurements that justify a gate — the
 * numbers that cannot be assertions because they compare current behaviour
 * against a version of itself that no longer exists. Committing them here
 * is what stops them decaying when the scratch file that produced them is
 * deleted before commit, which is the hygiene rule they used to collide
 * with.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fsModuleCache: true,
    name: 'evidence',
    environment: 'node',
    include: ['src/**/*.evidence.ts'],
    // Explicit, because these harnesses exist to PRINT. They write through
    // `process.stdout.write` rather than `console.*` for the same reason —
    // vitest 4 drops console output from passing tests unless a reporter is
    // named, and that is how four readouts in this repo went mute.
    reporters: ['default'],
  },
});

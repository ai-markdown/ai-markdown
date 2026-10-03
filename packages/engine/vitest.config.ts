/**
 * Per-package vitest config — self-contained for the same reason as the
 * other packages: the root config registers the Storybook plugin, whose
 * indexer walks from cwd and breaks when invoked from a package
 * subdirectory. The repo-wide `pnpm vitest run` (workspace root) still
 * picks these tests up through the root unit project.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Soak shards run in separate processes. Reuse transforms on disk while
    // keeping each shard's environment, module evaluation and tests isolated.
    fsModuleCache: true,
    name: 'unit',
    setupFiles: process.env.SOAK_TASK ? ['../../scripts/soak/task-setup.mjs'] : [],
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});

/**
 * DIAGNOSTIC CHANNEL — read this before adding a `console.log` to a test in
 * this package, because it will not print.
 *
 * vitest 4 intercepts `console.*` here and drops the output of tests that
 * PASS. Measured 2026-08-28 across log/error/warn/info/table: a failing
 * test's console output survives, a passing test's does not, and under a TTY
 * neither does. The switch is whether a reporter is passed EXPLICITLY —
 * `--reporter=default` prints, plain `vitest run` does not — and nothing in
 * this repo passes one (`package.json` `test`, CI's `pnpm -r test`, and all
 * soak legs in `scripts/soak/soak.sh` use bare `--run`). So the drop
 * is global, and it cost this package four silent diagnostics.
 *
 * Setting `reporters` here would restore them, and it was measured rather
 * than assumed: it costs nothing on a leg with no diagnostics (the direction
 * leg stays at 396 B) and takes an oracle shard from 247 B to 106 KB, which
 * is 1.2 MB for the 12-shard leg — affordable. It is NOT done, for a reason
 * that outweighs the size: it would rest the visibility of every gate
 * diagnostic on a surprising vitest behaviour (an explicit `--reporter=default`
 * behaving differently from no flag at all), and if a future version drops
 * that quirk the diagnostics go silent again with no signal. This campaign
 * has spent a week on instruments that could not notice they had stopped
 * working; the fix must not be one of them.
 *
 * So the rule is per-channel and explicit:
 *
 * - A number that GATES something goes in `expect(value, message)` or
 *   `expect.fail(message)`. Assertion messages are part of the failure
 *   report and always surface, whatever the reporter does.
 * - A number that must be READABLE ON A PASSING RUN goes to
 *   `process.stdout.write`, which is never intercepted. A diagnostic that
 *   only speaks when the test passes has no other survivable channel.
 * - `console.*` is for nothing that matters.
 *
 * The trap in one sentence: a test passed, so its log was dropped — and it
 * was precisely the kind of test that only has something to say when it
 * passes.
 */

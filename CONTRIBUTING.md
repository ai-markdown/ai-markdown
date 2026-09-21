# Contributing to ai-markdown

Thanks for your interest in contributing. This file covers the practical "how" — for "what" and "why", see [`README.md`](./README.md) and the topic docs under [documentation](https://ai-markdown.github.io/docs/guides/).

## Quick orientation

This is a **pnpm monorepo** with seven public packages:

- [`packages/engine`](./packages/engine) — the Markdown engine: incremental parsing, LaTeX preprocessing, the definition/footnote machinery, and the unified plugin pipeline. No React anywhere in its tree.
- [`packages/core`](./packages/core) — shared framework-independent sessions, planning and coordination.
- [`packages/react`](./packages/react) — the React renderer built on the engine (the public entry point most users install).
- [`packages/vue`](./packages/vue) — the Vue 3.5+ renderer built on the shared core.
- [`packages/react-mantine`](./packages/react-mantine) — Mantine UI integration (lives on top of the React adapter).
- [`packages/remark-mark-highlight`](./packages/remark-mark-highlight) — standalone `==highlight==` remark plugin, published on its own semver track.
- [`packages/code-language-detector`](./packages/code-language-detector) — dependency-free heuristic language detection for unlabelled code blocks, used by react-mantine and published on its own semver track.

The engine/core/adapter boundary is where most orientation mistakes happen. **Anything that turns Markdown text into a hast tree belongs in the engine; anything that turns a hast tree into React belongs in the React adapter.** If a change needs `useState`, a context, or a DOM node, it is adapter-side by construction. `core` depends on `engine` at an exact version (pnpm rewrites `workspace:*` to the published version), so the two always ship in lockstep.

Source of truth for the public API surface, sanitization model, cross-chunk coordination, and block-level memoization invariants is in [documentation](https://ai-markdown.github.io/docs/guides/). If you're touching internals, **read [`apps/docs/content/guides/architecture.md`](https://ai-markdown.github.io/docs/guides/architecture/) first** — its module-layout tree shows which package owns which file.

## Setup

```bash
git clone https://github.com/ai-markdown/ai-markdown.git
cd ai-markdown
pnpm install
pnpm build
```

You'll need:

- The Node version pinned in CI (currently 22.23.2) for reproducible validation. Vitest 5 requires Node `^22.12.0 || ^24.0.0 || >=26.0.0`; the published packages' consumer support is separate.
- pnpm 11.x (this repo pins the exact version via the `packageManager` field — Corepack, or pnpm itself, will fetch it)

> pnpm settings live in `pnpm-workspace.yaml`, not in a `pnpm` field in `package.json` — pnpm 11 ignores that field. `pnpm check:overrides` fails the build if one reappears, or if the lockfile no longer matches the declared overrides.

## Daily workflow

```bash
# Run Storybook for interactive development
pnpm storybook

# Run all workspace unit tests, or target one package
pnpm test:unit
pnpm --filter @ai-markdown/react test
pnpm --filter @ai-markdown/engine test

# Typecheck workspaces and Storybook (requires built packages)
pnpm typecheck

# Lint / format
pnpm lint
pnpm format:check
pnpm format          # auto-fix

# Full local validation, including browser checks (requires Chromium)
pnpm preflight
```

CI runs static checks, package and browser tests, build/export validation and soak-impact reporting on every PR. See the [development command reference](https://ai-markdown.github.io/docs/guides/development-commands/) for prerequisites, focused checks and compatibility aliases. `preflight` does not run a long soak or validate release approval.

Vitest 5 caches transformed Node test modules on disk (`fsModuleCache`), including across soak shard processes. Tests still evaluate in isolated workers with their own seed and environment. To discard the cache, run `pnpm exec vitest --clearCache`; `--fsModuleCache=false` disables it for a diagnostic test run. Browser tests use their own Vite cache.

Storybook 10.6.0's peer ranges predate Vitest 5. The workspace allows only the tested 5.0.1 combination and explicitly preserves the previous 1200×900 browser viewport. Mutation testing disables the disk module cache and carries a pnpm patch for Stryker 9.6.1: both its coverage IDs and test-name filters must use Vitest 5's `>` suite separator, otherwise mutants silently run zero tests.

### Changing the shared core

`packages/core` is public and framework-independent. React declares it as a normal exact-version dependency; it is external in both JavaScript and declarations. Build before running its distribution tests (`pnpm exec vitest run --project unit packages/core/src/runtime.test.ts`): these execute actual ESM/CJS artifacts in Node without a framework or DOM. Its build checks source import boundaries, and the React build checks external core/engine references. See the [core README](./packages/core/README.md) and [transition guide](https://ai-markdown.github.io/docs/guides/framework-transition/) before moving lifecycle work across packages.

### Changing the incremental-parse engine

`packages/engine` carries its own falsification suites on top of the unit tests, because the splice path's contract (a spliced tree is deep-equal, positions included, to a full parse of the same content) cannot be covered by examples alone. Run these when you touch `spliceParse`, the boundary scanner, or the definition machinery:

```bash
# Fast feedback: the splice fuzz suite on its own
pnpm --filter @ai-markdown/engine fuzz:splice

# Release gate: the six-leg soak (fuzz + direction battery + def-label scanner
# + bounded-exhaustive census + P1 conformance under ORACLE_RAW=1 + LaTeX
# preprocessor entry-point equivalence). The seed base
# is REQUIRED and must be fresh — an old seed re-walks a space that already
# passed. The script re-execs itself under `caffeinate`; note that caffeinate
# does not survive a lid close.
./scripts/soak/soak.sh <fresh-seed-base> [label]

# While it runs: a read-only progress view over the shard logs. Each leg
# beats every 30s with a real percentage and a timestamp; a shard whose
# beat has aged out is flagged STALE, which is the difference between
# "slow" and "wedged" that a bare log cannot show.
./scripts/soak/soak-watch.sh [label] -n 30
```

The work budget and execution concurrency are separate: `SHARDS` defaults to 14
logical shards, while `WORKERS` defaults to detected cores minus two. Use
`WORKERS=8 ./scripts/soak/soak.sh <fresh-seed-base>` to reduce CPU pressure without
reducing coverage. Release runs require at least 14 logical shards. `FAIL_FAST=1`
is the default; use `FAIL_FAST=0` to collect failures across all legs.

Each task writes a log, a Vitest JSON report, a task exit record and a runtime
record of effective test parameters and worker CPU/peak RSS. Aggregate completed
runs with `node scripts/soak/soak-aggregate.mjs .soak-logs/<run-id>`. Schema 2
requires these records; older schema 1 reports remain historical evidence and
are not accepted by the new gate. `SIGINT`/`SIGTERM` stops worker groups and writes
an interrupted result. An interrupted run cannot be resumed as fresh evidence;
use replay for diagnosis and a new seed range for the release gate.

For small scheduling experiments, use `SOAK_PROFILE=smoke RUN_KIND=replay`, fixed
`SHARDS` and seed, and vary only `WORKERS`. `CENSUS_K=2 CENSUS_NAME_K=2` reduces the
smoke census; release always requires K=4 and name K>=3, all six configurations,
raw-frozen checks and state-directed search. Arbitrary `EXHAUSTIVE_*`, `FUZZ_*`
and `ORACLE_*` variables from the invoking shell do not override task settings.
The seed ledger rejects overlapping streams, not just equal seed bases. Old
ledger entries without shard counts conservatively reserve 100 seeds per leg.
A reservation lock left by an abruptly killed metadata process fails closed;
confirm that no metadata writer is active before removing that stale lock.

A green soak is an **engine-impacting release** gate, not a per-PR one; CI does not execute the full campaign. `pnpm check:soak-impact` determines whether the committed candidate needs it. Validate local evidence with `pnpm check:release-soak --evidence <run-dir>...`; release CI waits for `soak-approval` when required. See [soak coverage](https://ai-markdown.github.io/docs/guides/soak-coverage/) for trigger rules, evidence reuse, and reviewer responsibilities. If your PR changes engine behavior, say in the description whether you ran it and what the result was.

#### Where a number goes

Tightening one of these instruments produces two kinds of number, and they need different homes:

| the number                                                                                                        | where it goes                                               | why                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **gates** — a threshold, a floor, a must-fire shape                                                               | an `expect(value, message)`                                 | an assertion carries its own evidence forever and re-proves itself on every run                         |
| **justifies a gate** — "this exemption suppresses nothing", "the tightening lost no recall", a calibration spread | a committed script under `scripts/`                         | it compares the code against a version of itself that no longer exists, so it can never be an assertion |
| anything that matters                                                                                             | **not** a deleted scratch file, and **not** a `console.log` | both are silent by default; see below                                                                   |

The middle row is the one that used to go wrong. "Delete every scratch file before committing" is a real rule — leftover probes have reddened preflight more than once, and one of them failed _by design_ — but the harness that proves "no recall lost" is exactly the artifact that rule deletes, and its numbers then survive only as prose in a comment. Commit it as a script instead: reproducible, outside the test count, invisible to preflight. `scripts/soak/gate-evidence.sh` is the worked example, re-running the two comparative measurements behind the raw-mode gate's exemption set.

Two traps worth knowing before you write the readout:

- **`console.log` in a passing test is discarded.** Vitest 4 drops `console.*` from passing tests unless a reporter is named explicitly, and no soak leg names one. Use `process.stdout.write` in anything whose purpose is to print.
- **An assertion message is a gate, not a gauge.** The numbers in a failure message appear only once the threshold is already crossed, and stay mute on every passing run — which is precisely when you would want to watch a ratio drift toward its limit. If you want early warning, print it on the passing path too.

## Branching & PRs

- Branch off `main`. Name your branch `<type>/<short-desc>` — e.g. `fix/cross-chunk-orphan-defs`, `docs/typescript-generics-example`.
- Keep PRs small and focused. If you find yourself doing two unrelated changes, that's usually two PRs.
- Use [Conventional Commits](https://www.conventionalcommits.org/)-style messages where reasonable: `fix(core): …`, `feat(mantine): …`, `docs: …`, `chore: …`. We're not strict — clarity over format.

### Never cite a commit by hash

**In a comment, a doc, or a commit message, cite a commit by its SUBJECT LINE — or by a tag when you mean "the state before this landed".** This history has been rewritten three times (twice to remove documents, once to collapse timestamps), and every rewrite orphans every hash written down before it. Subject lines and tags survive; hashes do not.

The failure is quiet, which is the reason for the rule rather than a habit. After a rewrite the pre-rewrite objects are still in the local object store, dangling, so `git log <hash>` and `git cat-file` keep answering for the person who just ran the rewrite. The citation only dies at the next `git gc`, on a fresh clone, and for everyone else. **A reviewer who checks it that day gets a valid commit back and reasonably says nothing.**

So the check has to test reachability, not resolvability:

```bash
# Every tracked file, every 7+ hex string that is really a commit, tested
# against HEAD. Anything printed ORPHAN is a dead citation, however well
# `git log` answers for it right now.
git ls-files -z | xargs -0 grep -hoE '\b[0-9a-f]{7,40}\b' | sort -u \
  | git cat-file --batch-check 2>/dev/null | awk '$2=="commit"{print $1}' \
  | while read -r h; do
      git merge-base --is-ancestor "$h" HEAD 2>/dev/null \
        || echo "ORPHAN $h  $(git log -1 --format=%s "$h")"
    done
```

Run it after any history rewrite. Grepping for the hashes you rewrote is not enough — it misses citations TO commits outside the range and citations ADDED by commits inside it, which is how six of them survived the 2026-08-28 collapse.

This rule was learned once before, recorded in a commit named for it, and then not followed — the commit teaching it was itself cited by hash a few lines away. Writing a lesson down is not the same as adopting it.

## What makes a good PR

- **Test coverage for behavior changes.** New behavior gets new tests; bug fixes get regression tests. The `byteEquivalence.test.tsx` harness exists to catch silent drift between code paths — leverage it.
- **Reference stability discipline.** Anything that participates in the block-memo cache (`customComponents`, `urlTransform`, `sanitizeSchema`, `contentPreprocessors`, `config`) must be safe under inline / module-scope / `useMemo`. See [`apps/docs/content/guides/streaming-and-performance.md`](https://ai-markdown.github.io/docs/guides/streaming-and-performance/).
- **Docs updates.** If your PR changes public API or visible behavior, update the relevant doc(s):
  - Props / config → the canonical adapter reference under `apps/docs/content/reference/` + relevant task guide + JSDoc. Update a package README when its installation or minimal example changes; core/engine/plugin references still originate in their package READMEs.
  - Mechanism / invariant → relevant file under `apps/docs/content/guides/`.
  - Notable release-level changes → `apps/docs/content/guides/release-highlights.md`.
- **No new dependencies without a reason.** Each `package.json` dep adds bundle weight and supply-chain surface. Justify them in the PR description.

## Style

- We use Prettier + ESLint configured at the repo root. Run `pnpm format` before pushing.
- TypeScript strict mode is on. Don't loosen it locally to make a PR pass.
- No emojis in source or docs unless explicitly requested.
- For JSDoc on public API, include a `Why` / `Recommended pattern` / `Footguns` triplet when the surface is non-trivial — this is the convention readers expect.

## Dev-only gates (warnings, invariant checks)

Write the **bare** text — `if (process.env.NODE_ENV !== 'production') { ... }` —
at module scope or in function bodies alike. Never wrap it in a
`typeof process !== 'undefined'` guard: Vite substitutes only the bare text, so
the guard evaluates `'undefined'` in bundler browser dev and silently disables
the gate exactly where it matters (this bug shipped once; see the history note
in `useReferenceFlipWarning.ts`).

What makes the bare text safe everywhere: `process.env.NODE_ENV` is resolved at
**build time**. Both entries of the React adapter's `tsup.config.ts` — and both entries of
engine's, which repeats the arrangement for the same reason — carry
`env: { NODE_ENV: ... }`. Those keys are **load-bearing**; removing any of them
would ship a dist that evaluates `process.env` at import and crashes no-bundler
consumers (browser native ESM/CDN, Deno). The build fails if that ever regresses:
each package's `scripts/assert-dist-clean.mjs` greps its emitted artifacts for
`process.env` after every build.

## Larger changes

For anything that touches the rendering pipeline, sanitization model, or cross-chunk registry: **open a Discussion or Issue first**. These areas have walked-through design constraints (documented at the top of each implementation file); a quick design sync saves a lot of rework.

The `apps/docs/content/guides/architecture.md` overview is the orientation; the file-level JSDoc explains _why_ each constraint exists.

## Code of Conduct

By participating in this project you agree to abide by the [Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md).

## Releasing (maintainer-only)

Releases publish from CI via [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC) with provenance attached automatically. Every package that already exists on npm must have its trusted publisher configured for `ai-markdown/ai-markdown` and `release.yml`; the scope registration does not configure it. A package that does not exist on npm yet has no publisher to configure, so its first version bootstraps with the `FIRST_PUBLISH_NPM_TOKEN` secret: `@ai-markdown/code-language-detector` is first published from its own `code-language-detector-v1.0.0` tag. A train tag does not receive the bootstrap token, so push that package tag before the first train tag that includes the detector, then configure the detector's trusted publisher: later tags publish it through OIDC only. Pushing a `v*` tag triggers `.github/workflows/release.yml`, which re-runs the full quality gate (lint, format, typecheck, tests, build), verifies the tag matches `package.json`, and publishes missing versions in dependency order: the independent packages first, then engine, core, react, react-mantine, vue. The registry is checked between steps. The independent packages are listed once, in `scripts/release-packages.mjs` — currently `remark-mark-highlight` and `code-language-detector`. Each either rides the train tag when its version was bumped, or is released alone via a `<directory>-vX.Y.Z` tag such as `code-language-detector-vX.Y.Z`:

```bash
# Sync versions across the monorepo (also rewrites README version refs)
pnpm version-packages X.Y.Z && pnpm install

git commit -am "chore(release): vX.Y.Z"
git tag vX.Y.Z
git push origin main vX.Y.Z
```

Stable versions of the five main packages use npm `latest` and a non-prerelease GitHub release; beta/RC versions use their corresponding npm channel and a GitHub prerelease. The independent highlight plugin and code language detector stay on their own stable 1.x lines.

Run `pnpm preflight` before tagging to catch gate failures locally — it is the same check suite the workflow runs, minus the publish. There is deliberately no local publish path: a local `npm publish` cannot attach provenance, so publishing happens only via the tag flow.

The workflow also creates the GitHub release, with notes taken from the version's section in `apps/docs/content/guides/release-highlights.md` — write that section before tagging (it falls back to auto-generated notes otherwise).

## Questions?

- Usage / how-do-I → [Discussions / Q&A](https://github.com/ai-markdown/ai-markdown/discussions/categories/q-a)
- Ideas / proposals → [Discussions / Ideas](https://github.com/ai-markdown/ai-markdown/discussions/categories/ideas)
- Bugs → [Issues](https://github.com/ai-markdown/ai-markdown/issues/new/choose)
- Security → [Private advisory](https://github.com/ai-markdown/ai-markdown/security/advisories/new)

### Vue adapter and public API review

Vue requires 3.5+ within the Vue 3 major line. Its production implementation and lifecycle tests live in `packages/vue`; the earlier prototype directory is an archive pointer. Run `pnpm test:vue-browser` after building for Chromium hydration, references, customization, smooth turn-taking, cursor layout and forced-GC lifecycle checks. `pnpm test:vue-browser:compat` runs the functional paths in Firefox and WebKit. CI and release workflows include both gates.

The engine/core/React/React-plugins/Mantine/Vue public declarations are checked with `pnpm check:public-api`. Review contract changes against `apps/docs/content/guides/api/core-engine-contracts.md`, then intentionally regenerate snapshots with `node scripts/check-public-api.mjs --update`. Updating the snapshot alone does not establish behavioral compatibility.

Vue and the other existing packages have completed publication through their configured trusted publishers. Leave `bootstrap_vue` disabled for subsequent releases. The maintainer retains the bootstrap secret for future first publications; it is not needed for the current packages. Recovery must use the intended release tag and preserve source/tag equivalence and all release gates.

## Documentation language and scope

Commit reader-facing documentation in English, including READMEs, usage/API references, architecture explanations, and contributor/testing guides. Use English for explanatory code comments and PR descriptions as well. Preserve non-English strings when they are meaningful CJK examples, test fixtures, or source data; explain their behavior in English.

Keep internal planning matrices, agent instructions and scratch notes, execution/status logs, and review-process records local. Do not commit them under `apps/docs/content/guides/` or elsewhere in the repository. Use the ignored `.local-notes/` directory for local material. Extract durable contracts or contributor instructions into the appropriate public guide without carrying over the internal work log. Test fixtures, API snapshots, and license notices are repository assets with their own purposes, not internal planning documents.

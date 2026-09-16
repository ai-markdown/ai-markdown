# Development commands

Run these commands from the repository root after `pnpm install --frozen-lockfile`. Public packages live under `packages/*`; Storybook apps, shared tooling, corpus and benchmark workspaces are private. Scripts are grouped by purpose in the root `package.json`.

## Everyday development

| Command                                       | Scope and prerequisites                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm storybook`                              | Start React, Vue and the composition entry using workspace source. No package build required.                                        |
| `pnpm storybook:react` / `pnpm storybook:vue` | Start one renderer catalog.                                                                                                          |
| `pnpm build`                                  | Build all seven public packages and execute their distribution assertions. Excludes Storybook and benchmark applications.            |
| `pnpm lint` / `pnpm lint:fix`                 | Check ESLint rules / apply available fixes.                                                                                          |
| `pnpm format:check` / `pnpm format`           | Check formatting / rewrite files with Prettier.                                                                                      |
| `pnpm typecheck`                              | Run both workspace and Storybook typechecks. Build packages first.                                                                   |
| `pnpm typecheck:packages`                     | Recursive workspace typechecks, including public packages, corpus and benchmark applications.                                        |
| `pnpm typecheck:storybook`                    | Storybook configuration, stories, shared tooling and root Vitest configuration.                                                      |
| `pnpm test:unit`                              | Recursive workspace unit suites using each package's own configuration. Build packages first. Does not run Storybook browser suites. |

`test:unit` clears `CORE_SEQUENCE_SEED`, `CORE_SEQUENCE_PATH` and `CORE_SEQUENCE_RUNS` so aggregate gates use the committed core sequence budget. For a targeted replay, use the core package test directly as described in [core testing](core-testing.md). The root Vitest configuration remains available for focused runs, but CI and preflight use `test:unit` followed by the separate Storybook suites.

## Focused validation

| Command                       | What it validates                                                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check:overrides`        | Workspace dependency override configuration.                                                                                                                                                |
| `pnpm check:public-api`       | Built engine, core and Vue public declaration snapshots and boundary rules. Requires a build; `--update` rewrites snapshots for review. This is not an API snapshot gate for every package. |
| `pnpm test:core-contracts`    | Standalone core gate: build its dependency closure, check types and run all core tests with protected sequence settings.                                                                    |
| `pnpm test:command-control`   | Preflight fail-fast behavior, build reuse and protected unit-test settings.                                                                                                                 |
| `pnpm test:soak-control`      | Soak runner control logic and change-impact classification. Does not start soak.                                                                                                            |
| `pnpm test:release-control`   | Release authentication and publishing control logic. Does not publish packages.                                                                                                             |
| `pnpm packcheck`              | attw and publint checks for all public package distributions. Requires a build.                                                                                                             |
| `pnpm test:packed-consumers`  | Pack and install packages into an isolated consumer, then validate runtime and type entry points. Requires a build and dependency installation access.                                      |
| `pnpm test:document-lifetime` | React concurrent document ownership and garbage-collection regression in Chromium.                                                                                                          |
| `pnpm test:vue-browser`       | Vue SSR, hydration and browser adapter regressions in Chromium.                                                                                                                             |

Install the browser with `pnpm exec playwright install chromium` before browser checks. Adapter browser checks require built package dependencies; the Vue check also reads its generated CSS.

## Storybook validation and export

| Command                                                 | What it runs                                                                                                                                                                                         |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test:storybook`                                   | React/Mantine and Vue browser story suites, sequentially.                                                                                                                                            |
| `pnpm test:storybook:react` / `pnpm test:storybook:vue` | One renderer's browser story suite.                                                                                                                                                                  |
| `pnpm test:storybook:dev`                               | Process-supervisor regressions, development composition, source/CSS updates and shutdown checks. Ports 6006–6008 must be free. Temporarily edits and restores source files; run in an idle checkout. |
| `pnpm build:storybook`                                  | Build public packages, then generate the composed static site.                                                                                                                                       |
| `pnpm build:storybook --skip-build`                     | Reuse packages already built from the current source. Only skips the package build, not the site build. Do not use with stale or missing distributions.                                              |
| `pnpm test:storybook:site`                              | Verify an existing static export under a nested deployment path, including navigation, Controls and isolated iframes.                                                                                |

For a public documentation export, use `STORYBOOK_DOCS_EXPORT=1 pnpm build:storybook`. See [Storybook](storybook.md) for catalog structure and deployment details.

## Full local preflight

```bash
pnpm preflight
```

Preflight stops at the first failed step. It checks configuration, lint and formatting; builds public packages once; checks all types and public API snapshots; runs control and unit tests; validates packed distributions and external consumers; runs browser stories; exports and verifies the static site; verifies development mode; and runs the React lifetime and Vue browser regressions.

The build, workspace typecheck and unit steps cover the same core checks as the standalone core gate without rebuilding and rerunning core. CI retains a separate core-only job to verify that this package can be validated independently. Release validation uses the shared unit and typecheck commands too.

Preflight requires installed Chromium, free Storybook ports and an idle checkout. It does not install dependencies, change versions, publish packages, run performance benchmarks or start a long soak. It is not a substitute for the release workflow's soak decision and approval.

## Engine soak

| Command                                            | Purpose                                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `pnpm check:soak-coverage`                         | Validate the soak coverage map.                                                                                     |
| `pnpm check:soak-impact`                           | Report whether changes since the preceding train tag require soak; accepts `--base` and `--head` for custom audits. |
| `pnpm check:release-soak --evidence <run-dir>...`  | Validate the clean release candidate and, when required, local release-profile evidence.                            |
| `pnpm --filter @ai-markdown/engine soak`           | Start the engine soak runner.                                                                                       |
| `pnpm --filter @ai-markdown/engine soak:watch`     | Read soak progress.                                                                                                 |
| `pnpm --filter @ai-markdown/engine soak:aggregate` | Aggregate and validate run results.                                                                                 |
| `pnpm --filter @ai-markdown/engine fuzz:splice`    | Run the focused splice fuzz test.                                                                                   |

Use [soak coverage](soak-coverage.md) for profiles and evidence requirements. Engine's `soak:coverage` is a package-local entry for the coverage-map check.

## Performance and versions

| Command                           | Purpose                                                                                                                                                                                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm bench:unit`                 | Vitest microbenchmarks; currently the LaTeX preprocessor.                                                                                                                                                                           |
| `pnpm bench:web`                  | Production browser benchmark scenarios.                                                                                                                                                                                             |
| `pnpm bench:web:selftest`         | Validate the browser benchmark harness itself.                                                                                                                                                                                      |
| `pnpm bench:web:scale`            | Document-size scaling with delivery every 24 characters.                                                                                                                                                                            |
| `pnpm bench:web:scale:cold`       | Document-size scaling with one complete update.                                                                                                                                                                                     |
| `pnpm bench:web:scale:steps`      | Document-size scaling with exactly 100 updates.                                                                                                                                                                                     |
| `pnpm version-packages <version>` | Rewrite the root and five release-train package versions and related references. The highlight plugin and code language detector remain independently versioned. Does not publish; follow with lockfile synchronization and review. |

See the [browser benchmark guide](../../../../benchmarks/README.md) before interpreting performance results. Actual npm publication belongs to the release workflow.

## Compatibility aliases

Existing commands remain supported. New documentation and CI use these canonical names:

| Existing command      | Canonical command     |
| --------------------- | --------------------- |
| `build-storybook`     | `build:storybook`     |
| `test:storybook-dev`  | `test:storybook:dev`  |
| `test:storybook-site` | `test:storybook:site` |
| `bench`               | `bench:unit`          |

`typecheck` now covers both workspaces and Storybook. Use `typecheck:storybook` for the old narrower scope. No ambiguous root `test` alias is provided: choose unit, Storybook, adapter or full preflight explicitly.

## Stable v3 compatibility

`pnpm test:vue-browser:compat` runs the Vue hydration, reference, customization, smooth-stream, cursor and unmount contracts in Firefox and WebKit. Install them with `pnpm exec playwright install firefox webkit --with-deps`. The Chromium command retains its additional forced-GC stress checks. Both CI and Release also run packed consumers on Node 20.19.0, 22.12.0 and 24.20.0; the first two are the declared runtime lower bounds. These jobs use actual tarballs outside the workspace.

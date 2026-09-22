# Soak coverage map

The release soak compares stateful and incremental implementations with simpler, stateless oracles. A passing equality assertion is useful only if the optimized path actually ran. Each entry therefore records both the oracle and an anti-vacuity condition: a measurable requirement for engagement with the path being tested.

The machine-readable source is [`scripts/soak/coverage-map.json`](../../../../scripts/soak/coverage-map.json). Its validator, [`assert-coverage-map.mjs`](../../../../scripts/soak/assert-coverage-map.mjs), checks that referenced source and tests exist and that every release leg has an owner.

## Coverage by optimization

| Entry                    | Stateless oracle                | Release legs     | Anti-vacuity requirement                            |
| ------------------------ | ------------------------------- | ---------------- | --------------------------------------------------- |
| Incremental parse        | Fresh full parse                | `fuzz`           | Incremental-frame ratio and generator-family floors |
| Resumed freeze scan      | Fresh boundary scan             | `fuzz`, `census` | Non-zero engagement and exhaustive P3               |
| Freeze direction         | Full parse after hazard futures | `dir`, `oracle`  | Boundary and document-probe floors                  |
| Definition-label scanner | Full `collectDefLabels` parse   | `scanner`        | Hazard and benign streams at every snapshot         |
| LaTeX preprocessor       | Stateless `preprocessLaTeX`     | `latex`          | Per-config freeze, rewind, and composed-seam floors |

The six leg names are runner identifiers, not interchangeable test categories. For example, the resumed scanner is exercised by both randomized splice streams and the bounded-exhaustive census; the definition scanner has its own leg because its configuration and output contract differ from the render parser.

## Adding or changing an entry

Every stateful or incremental entry must name its stateless oracle, CI test, release-soak leg, and anti-vacuity condition. Add the mapping when introducing the optimization, then confirm that the corresponding test compares outputs at the intermediate snapshots where a stale state could matter.

A new entry is incomplete until a planted fault makes its property or engagement assertion fail. Equality against an oracle alone can stay green if the implementation silently falls back on every frame. Conversely, a coverage counter alone cannot establish correctness. Preserve both checks and record a regression fixture when a failure identifies a new input family.

## Run profiles and evidence

Development runs use `SOAK_PROFILE=smoke`. A diagnostic rerun using a previously observed seed additionally uses `RUN_KIND=replay`. These runs help investigate failures; they must not be presented as a fresh release campaign.

Only a complete release profile can produce a release PASS. The runner writes `.soak-logs/<run-id>/manifest.json` and `result.json`, which record the run identity and result needed by the aggregator. Full and split results are checked from the repository root with:

```sh
pnpm --filter @ai-markdown/engine soak:aggregate -- \
  .soak-logs/<main-run-id> .soak-logs/<census-run-id>
```

Replace the placeholder directories with the actual run directories. Do not infer release success from a subset of green logs: the aggregator checks the evidence across the required legs and split runs. A replay that diagnoses one failing seed does not replace a complete, fresh-seed release profile.

## Related records

The [prefix-freeze experiment](../../../../packages/engine/src/experiments/prefixFreeze/README.md) explains the boundary study and the evolution of the verification stack. The [architecture guide](architecture.md) identifies the production pipeline. Historical soak sizes in release notes describe those releases; the current coverage map and runner define the present release contract.

## When a release needs engine soak

The six legs execute engine tests. They do not directly validate core state management or framework adapters. Changes confined to core, React, Vue, Mantine, documentation, or package version metadata use their corresponding CI gates and do not by themselves require another engine campaign.

`pnpm check:soak-impact` compares the committed candidate with the nearest preceding train tag. Use `--base <commit-or-tag> --head <commit>` for an explicit ancestor range. PR CI assesses the checked-out merge candidate cumulatively; release CI reassesses the final candidate. The report separates **full campaign reasons** from **bounded smoke reasons**:

| Change                                                                                                                                                                                   | Required verification                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Engine/highlight implementation, runtime exports, generators, oracles, six leg files, fuzz suites, corpus inputs, build configuration/dependencies, sampling budgets or release contract | Full local release-profile soak and release approval |
| Vitest and its resolved execution dependencies, package manager/install mechanics, verification Node runtime, runner/report tooling, or literal cache/worker/timeout settings            | Automated six-leg smoke (`pnpm test:soak-smoke`)     |
| Core/adapters/UI/docs, ordinary unit tests, benchmarks, standalone evidence, Stryker tooling, impact/approval policy and their control tests                                             | Corresponding normal CI gates                        |

A test framework upgrade alone does not invalidate the engine's broad random/exhaustive coverage. It must still prove that the actual six legs execute correctly under the new tools. Smoke uses two shards and two workers, a fixed replay seed, 1,000 samples for each fuzz leg, 100 oracle samples and K=2 census/name bands. It keeps existing assertions and anti-vacuity floors and validates test counts, effective environments and structured reports. It cannot substitute for a fresh release campaign. Both CI and release verification run smoke automatically when requested; failure blocks verification. When both kinds of change occur, smoke runs in CI and the full release gate still applies.

Dependency impact follows the historical lockfile, including transitive and linked workspace dependencies. Runtime and generator dependencies take priority even if also used by tools. Only known dev-only test tools and `@types/*` are excluded from the full graph; unknown engine dev dependencies remain significant. Stryker-only patches and unrelated overrides do not trigger soak. Patches affecting the engine/build graph still require full soak; patches affecting execution tools require smoke. Resolution policies are judged by the frozen lockfile's resolved graph. Excluding an engine workspace or failing to resolve dependency impact requires full soak. Linked generator source changes are tracked even outside `packages/engine`. `corpus/documents` remains verification input, not documentation.

The six legs use `packages/engine/vitest.config.ts`. Only literal cache, worker, parallelism and timeout knobs qualify for smoke alone. Setup hooks, aliases, test selection, computed settings and unknown configuration changes still require full soak. Root/Storybook, highlight unit-test, benchmark, mutation and standalone-evidence configurations use their own CI gates. Control tests enforce that engine/plugin modules do not import excluded test/benchmark/evidence entries. Comments and erased TypeScript types do not require a campaign.

Policy and control-test changes are checked by `pnpm test:soak-control`, rather than by running an algorithm campaign that does not exercise them. Runner, metadata and aggregation changes additionally require smoke. Sampling scripts, the shared soak contract, release profile and unknown soak scripts remain full-campaign inputs. Node pins are compared per engine verification job (including matrix pins); unrelated documentation jobs do not trigger smoke. Removed or renamed verification jobs require compatibility verification.

CI displays **FULL required before release**, **SMOKE verified**, or **NOT REQUIRED**. Failed assessment or smoke fails the check. A successful assessment is not full-soak evidence. Missing prior train tags require an initial full campaign; invalid Git ranges fail the check. Publication still requires the existing human approval only when full soak is required.

Validate the committed release candidate and local full-campaign evidence:

```sh
pnpm check:release-soak --evidence .soak-logs/<run-id>
```

Release validation always uses the clean checked-out `HEAD` and its preceding train tag; it does not accept custom baseline or candidate overrides. Use `check:soak-impact` for exploratory range comparisons. Multiple directories may follow `--evidence` for split campaigns. The command checks the release profile and requires each tested commit to be an ancestor of the candidate with no intervening engine-impacting changes. Documentation, adapter and tool-only follow-ups can reuse valid full-campaign evidence; tool changes additionally run the bounded smoke. New engine-impacting changes require a new campaign. The local release validator also runs smoke when requested by the classifier. Keep the manifests and reports available to the release reviewer. They are generated evidence, not source documents to commit.

## Manual release approval

The release workflow first completes its automated quality checks and reports the comparison baseline, candidate SHA, and soak trigger reasons in the workflow summary. If soak is required, a separate job waits for approval of the `soak-approval` GitHub environment. Publication depends on successful verification and, when required, successful approval. Rejected, cancelled, or missing approval cannot publish. Releases without engine impact skip this approval job.

Before approving, the reviewer must confirm that `pnpm check:release-soak` passed for the candidate and that the complete fresh campaign passed all required legs. Include the tested SHA, run identifiers, and a report location or result summary in the approval comment. Approval attests that the evidence was reviewed; CI does not independently inspect files kept only on the developer's machine. If evidence fails, reject the job and fix the candidate before starting another release run.

Repository administrators must configure **Settings → Environments → soak-approval → Required reviewers**. Merely referencing an environment in YAML does not enable required review. The current maintenance model permits the release initiator to approve their own run; administrator bypass is disabled. The approval job is separate from the npm publishing job, so it does not add an environment requirement to existing npm trusted publisher configurations. Manual release recovery follows the same gate.

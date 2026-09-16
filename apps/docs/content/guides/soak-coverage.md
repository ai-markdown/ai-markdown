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

PR and main-branch CI include an **Assess engine soak impact** check and a dependent check named **⚠ Engine soak REQUIRED before release** or **✓ Engine soak NOT REQUIRED**. If assessment fails, the dependent check reports **UNAVAILABLE** and fails. The decision is visible directly in the PR check list and Actions job list. GitHub may still show the workflow as successful when soak is required: the full campaign is a release gate, not a PR gate. The assessment annotation and job summary state `REQUIRED` or `NOT REQUIRED`, the baseline SHA, the candidate SHA, and trigger reasons. A green check means the assessment succeeded; it does not mean soak is unnecessary or has passed. PR CI assesses the checked-out merge candidate cumulatively since the preceding train tag, rather than only the latest push. Release CI reassesses the final candidate. PR checks never wait for release approval.

Run `pnpm check:soak-impact` to compare the committed candidate with its nearest preceding train tag. Use `--base <commit-or-tag> --head <commit>` to inspect an explicit ancestor range. Engine and highlight runtime changes, runtime exports, the six leg files and every fuzz suite, engine test helpers and build configuration, relevant transitive lockfile dependencies, shared toolchain changes, and changes to the soak mechanism require verification. Comments and erased TypeScript types are ignored, and so are two changes no leg executes: an engine or highlight unit test that is neither a leg file nor a fuzz suite (it remains a CI gate, and a control test asserts that no engine module imports a test file), and a type declaration package (`@types/*`) in an engine or highlight manifest or in the lockfile graph, including the peer suffixes it adds to other entries. The rest of the test and build toolchain, such as `vitest`, `tsup`, `yaml` or a Playwright peer, still requires verification. Unresolvable dependency impact or a missing prior train tag requires soak; an invalid Git range fails the check.

The six soak legs start Vitest in `packages/engine` and use that package's configuration. Root `vitest.config.ts` changes belong to the normal unit/Storybook gates and do not invalidate engine soak evidence. Changes to `packages/engine/vitest.config.ts`, engine build settings, or the actual soak runner still do.

Workspace declarations are compared by effective inclusion of engine verification workspaces, using the historical lockfile's local dependency closure. Adding private app or tooling globs is harmless when those inputs stay included and installation settings are unchanged. Excluding engine inputs, changing overrides or install options, or failing to resolve the configuration requires soak. `corpus/documents` files are executable inputs read by engine differential verification, so changing them is not treated as a documentation-only edit. Changes to the impact classifier and evidence gate themselves remain mechanism changes; a fix to the classifier is not exempt from its own rule.

Every non-Markdown file under `scripts/soak/` counts as mechanism, the `node:test` suites included. A control test can carry a mechanism change on its own, for example an assertion rewritten to accept a looser gate, so the rule fails closed rather than trying to tell a fixture rename from a relaxed threshold. The cost is that editing `impact.test.mjs` or `soak-control.test.mjs` requires a soak campaign for that range even when the scripts themselves did not change.

The CI and release workflows are compared by the Node pin of each job (`with.runtime` steps and `strategy.matrix.node` entries). A job present in both versions must keep its pins; swapping the pins of two jobs is a runtime change even though the set of pins is not. Any removed job that carried a pin is a runtime change, a pure rename included: a removed job's identity cannot prove that the verification it ran still runs elsewhere, and a rename combined with an upgrade keeps every pin present somewhere. The only exempt shape is a new job on a pin the base already runs while every existing job is unchanged; a new job on a new pin requires soak.

Full campaigns run on developer equipment. After committing a clean candidate, run `SOAK_PROFILE=release scripts/soak/soak.sh <fresh-seed-base> <label>` with a fresh seed. The default six legs and 14 logical shards define 84 tasks; `WORKERS` changes concurrency without reducing the logical budget. Validate the resulting evidence against the release candidate with:

```sh
pnpm check:release-soak --evidence .soak-logs/<run-id>
```

Release validation always uses the clean checked-out `HEAD` and its preceding train tag; it does not accept custom baseline or candidate overrides. Use `check:soak-impact` for exploratory range comparisons. Multiple directories may follow `--evidence` for split campaigns. The command checks the release profile and requires each tested commit to be an ancestor of the candidate with no intervening engine-impacting changes. Documentation or adapter follow-ups can reuse valid evidence; new engine-impacting changes require a new campaign. Keep the manifests and reports available to the release reviewer. They are generated evidence, not source documents to commit.

## Manual release approval

The release workflow first completes its automated quality checks and reports the comparison baseline, candidate SHA, and soak trigger reasons in the workflow summary. If soak is required, a separate job waits for approval of the `soak-approval` GitHub environment. Publication depends on successful verification and, when required, successful approval. Rejected, cancelled, or missing approval cannot publish. Releases without engine impact skip this approval job.

Before approving, the reviewer must confirm that `pnpm check:release-soak` passed for the candidate and that the complete fresh campaign passed all required legs. Include the tested SHA, run identifiers, and a report location or result summary in the approval comment. Approval attests that the evidence was reviewed; CI does not independently inspect files kept only on the developer's machine. If evidence fails, reject the job and fix the candidate before starting another release run.

Repository administrators must configure **Settings → Environments → soak-approval → Required reviewers**. Merely referencing an environment in YAML does not enable required review. The current maintenance model permits the release initiator to approve their own run; administrator bypass is disabled. The approval job is separate from the npm publishing job, so it does not add an environment requirement to existing npm trusted publisher configurations. Manual release recovery follows the same gate.

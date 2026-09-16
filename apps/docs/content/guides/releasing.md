# Releasing

This guide describes the current release workflow. For the original stable promotion and its narrowly scoped review exception, see the [3.0 acceptance record](releasing-3.0.md). Historical exceptions do not authorize future releases.

## Prepare a version

Choose the next version, set `NEXT_VERSION`, then update the manifests and lockfile:

```bash
pnpm version-packages "${NEXT_VERSION:?Set NEXT_VERSION to the intended release version}"
pnpm install
```

Review the complete diff, including package peer ranges and current documentation. Add the release notes under a `### <version>` heading in `release-highlights.md`: the publishing workflow extracts that section until the next level-three heading. Preserve historical version descriptions when updating current guidance.

## Candidate acceptance

Use a new version and tag for every release. Update the package train, lockfile and current documentation before validating the candidate; published versions and tags are immutable.

1. Run `pnpm preflight` on the final source. It covers builds, lint, formatting, declarations, unit and control tests, tarballs, consumer integration, Storybook and browser/lifetime checks.
2. Require CI, including the packed consumer Node matrix and core contract job, to pass.
3. Commit a clean candidate and run `pnpm check:soak-impact`. Follow [soak coverage and approval](soak-coverage.md) when engine impact requires a campaign, and validate its evidence with `pnpm check:release-soak --evidence .soak-logs/<run-id>`. The current release profile covers all six legs and 84 logical tasks.
4. Tag the verified version. The release workflow must pass automated verification and, when required, human `soak-approval` review. Retain the reviewed evidence.
5. Use trusted publishing for existing packages. Prereleases use their corresponding `beta` or `rc` channel; stable releases use `latest`. The independently versioned packages listed in `scripts/release-packages.mjs` (`remark-mark-highlight`, `code-language-detector`) follow their own versions and channels; a train tag publishes them before engine, core, react, react-mantine and vue. A package that does not exist on npm yet bootstraps its first version with `FIRST_PUBLISH_NPM_TOKEN` (`code-language-detector-v1.0.0` for the language detector); configure its trusted publisher after that publication. Leave bootstrap authentication disabled for existing packages.
6. Require post-publication registry and consumer verification. The workflow archives its report before creating the GitHub release; the read-only verification workflow can check an existing release again.

A local green run does not replace remote CI, published-artifact verification or required human review. Record actual run URLs and evidence identifiers after they exist.

## Promote a candidate

Install the published candidate in representative React, Mantine and Vue applications, record the runtime versions and SSR/hydration and streaming results, and allow a feedback period. Resolve candidate regressions first, choose a new stable version, update the train and integration peer ranges, and validate the resulting tarballs. Reassess soak impact for the final committed candidate. Stable releases use npm `latest` and a non-prerelease GitHub release. Preserve existing tags and artifacts; correct published defects with a new patch or candidate.

## Repeatable published-artifact verification

After publication, the release workflow runs `pnpm test:published-release "$RELEASE_TAG"`
before creating the GitHub release. It downloads npm artifacts and installs them outside
the workspace, reusing the packed-consumer probes for ESM/CJS, development conditions,
React/Mantine/Vue SSR, CSS, declarations, private API boundaries and Vue 3.5.0.
Stable train verification additionally installs all packages without version pins and
checks that npm selects the expected release versions. RC verification uses exact
artifacts and checks the prerelease channel without changing `latest`.

Set `RELEASE_TAG` to an existing tag whose expected npm channel still points to that release, then run:

```bash
pnpm test:published-release "${RELEASE_TAG:?Set RELEASE_TAG to an existing release tag}" .local-notes/published-release
```

An independent package release checks its own metadata/provenance and exercises it alongside the train versions recorded at that tag.

Use an existing tag and a checkout containing its full Git history. No workspace build
or dependency installation is required for these registry checks. The Node version
must satisfy the package engine range; `npm`, `pnpm`, `git` and `tar` must be available.
An independent package's version comes from the tag's manifest, not a hardcoded version.
The `Verify published release` GitHub workflow provides the same read-only check for
an existing tag, without publishing or requiring a soak approval.

Verification checks npm channels, dependency and engine metadata, tarball SHA-512,
and provenance repository, workflow, source tag, commit and tarball subject. This is
provenance **content and source consistency** verification, not cryptographic Sigstore
signature verification. Reused independent-package versions and publication retries retain their
original provenance invocation; the original source must be an ancestor with unchanged
package implementation sources. The independently versioned packages permit top-level README-only drift when reusing an existing artifact; implementation changes still require a new version. Train packages additionally require unchanged package/lockfile inputs.
Do not require a reused artifact to name the current workflow run.

Registry visibility checks retry for up to 12 attempts, with 5 seconds between attempts
and a 30-second timeout per request. Persistent mismatches fail verification. The JSON
report records the target SHA, Node version, source invocations, hashes and results,
including partial results on failure. CI archives it as `published-release-verification`.
A retry can verify existing uploads and leave an existing published GitHub release intact.
When recovering an incomplete upload, run the release workflow from the release tag so
new provenance records that tag; never move a tag or overwrite an npm version.
Historical audits require the expected channel to still point at that version; once a
newer release advances the channel, the older audit intentionally fails its channel check.

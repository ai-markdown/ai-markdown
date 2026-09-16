/* global process, console, fetch, setTimeout, AbortSignal */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { releaseDirectories } from './release-packages.mjs';

const releaseTag = process.argv[2];
execFileSync(process.execPath, ['scripts/check-release.mjs', releaseTag], { stdio: 'inherit' });
const directories = releaseDirectories(releaseTag);
const registry = 'https://registry.npmjs.org';

// Provenance records the workflow ref that ran the upload, and
// scripts/check-published-release.mjs accepts only refs/tags/<release tag>.
// A workflow_dispatch run started from a branch would publish a tarball whose
// attestation names refs/heads/<branch>, which that check rejects only after
// the upload is already irreversible. Fail here, before the first upload.
// Runs that only skip already-published versions never reach this check, so
// a recovery run that has nothing left to upload still completes.
function assertProvenanceRef() {
  if (!process.env.GITHUB_ACTIONS) return;
  const expected = `refs/tags/${releaseTag}`;
  assert.equal(
    process.env.GITHUB_REF,
    expected,
    `Refusing to upload from ${process.env.GITHUB_REF}: provenance must reference the release tag (${expected}). ` +
      'Run the release workflow from the tag ref; refs/heads/* is rejected by scripts/check-published-release.mjs.'
  );
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function metadata(path, install = false) {
  const response = await fetch(`${registry}/${path}`, {
    headers: { Accept: install ? 'application/vnd.npm.install-v1+json' : 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  if (response.status === 404) return null;
  assert(response.ok, `Registry metadata failed: ${response.status} ${path}`);
  return response.json();
}

for (const directory of directories) {
  const pkg = JSON.parse(readFileSync(`packages/${directory}/package.json`, 'utf8'));
  const { name, version } = pkg;
  assert(!pkg.private && name === `@ai-markdown/${directory}`);
  const escaped = name.replace('/', '%2f');
  const tag = version.includes('-') ? version.split('-')[1].split('.')[0] : 'latest';
  // Exact-version metadata and the install packument remain usable while
  // npm's full packument may return 404 for a newly created prerelease package.
  let published = await metadata(`${escaped}/${version}`);
  if (!published) published = (await metadata(escaped, true))?.versions?.[version];
  if (published) {
    assert.equal(published.name, name);
    assert.equal(published.version, version);
    console.log(`Already published: ${name}@${version}`);
  } else {
    assertProvenanceRef();
    if (
      process.env.FIRST_PUBLISH_NPM_TOKEN &&
      (!process.env.FIRST_PUBLISH_PACKAGE || process.env.FIRST_PUBLISH_PACKAGE === name)
    ) {
      const destination = join(process.env.RUNNER_TEMP, 'first-publish-packs');
      mkdirSync(destination, { recursive: true });
      execFileSync('pnpm', ['--filter', `./packages/${directory}`, 'pack', '--pack-destination', destination], {
        stdio: 'inherit',
      });
      const archive = join(destination, `${name.slice(1).replace('/', '-')}-${version}.tgz`);
      const userconfig = join(destination, 'first-publish.npmrc');
      // Only the selected first-publish subprocess sees this auth config.
      // Existing packages continue through trusted publishing.
      writeFileSync(userconfig, '//registry.npmjs.org/:_authToken=${FIRST_PUBLISH_NPM_TOKEN}\n', { mode: 0o600 });
      try {
        execFileSync('npm', ['publish', archive, '--access', 'public', '--provenance', '--tag', tag], {
          stdio: 'inherit',
          env: { ...process.env, NPM_CONFIG_USERCONFIG: userconfig },
        });
      } finally {
        unlinkSync(userconfig);
      }
    } else {
      execFileSync(
        'pnpm',
        ['--filter', `./packages/${directory}`, 'publish', '--access', 'public', '--no-git-checks', '--tag', tag],
        { stdio: 'inherit' }
      );
    }
  }
  let visible = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const packument = await metadata(escaped, true);
    const manifest = packument?.versions?.[version];
    if (manifest?.name === name && manifest.version === version && manifest.dist?.tarball) {
      visible = true;
      break;
    }
    await delay(5000);
  }
  assert(visible, `Published dependency is not visible to installers: ${name}@${version}`);
  const tags = await metadata(`-/package/${escaped}/dist-tags`);
  assert.equal(tags?.[tag], version, `${name}: expected ${tag}=${version}`);
  console.log(`Verified installer metadata and ${tag} tag: ${name}@${version}`);
}

// Complete the authorized uploads before checking release-wide tag state.
// Some first-publish credentials cannot remove dist-tags. Report the exact
// packages requiring maintainer cleanup instead of attempting a forbidden write
// or leaving downstream packages unpublished after an unrelated tag failure.
const unexpectedLatest = [];
for (const directory of directories) {
  const { name, version } = JSON.parse(readFileSync(`packages/${directory}/package.json`, 'utf8'));
  if (!version.includes('-')) continue;
  const tags = await metadata(`-/package/${name.replace('/', '%2f')}/dist-tags`);
  if (tags?.latest === version) {
    // Maintainer-approved exception for Vue's first publication only.
    // Later prereleases and every other package retain strict tag checks.
    if (name === '@ai-markdown/vue' && version === '3.0.0-beta.2') {
      console.log(`Retaining approved first-publication latest tag: ${name}@${version}`);
    } else unexpectedLatest.push(name);
  }
}
assert.equal(
  unexpectedLatest.length,
  0,
  `Uploads complete; remove the unintended latest dist-tag with authorized maintainer credentials, then resume: ${unexpectedLatest.join(', ')}`
);

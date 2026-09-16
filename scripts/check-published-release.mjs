/* global process, console, fetch, Buffer, AbortSignal, setTimeout */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { URL, pathToFileURL } from 'node:url';
import { INDEPENDENT, RELEASE_TAG_PATTERN, releaseDirectories, releaseVersion } from './release-packages.mjs';

export function channel(version) {
  return version.includes('-') ? version.split('-')[1].split('.')[0] : 'latest';
}
export function verifyStatement(statement, bytes) {
  const definition = statement.predicate.buildDefinition;
  assert.equal(statement.predicateType, 'https://slsa.dev/provenance/v1');
  assert.equal(definition.externalParameters.workflow.repository, 'https://github.com/ai-markdown/ai-markdown');
  assert.equal(definition.externalParameters.workflow.path, '.github/workflows/release.yml');
  const ref = definition.externalParameters.workflow.ref;
  assert(
    ref.startsWith('refs/tags/') && RELEASE_TAG_PATTERN.test(ref.slice('refs/tags/'.length)),
    'Provenance must reference a release tag'
  );
  const source = definition.resolvedDependencies.find((d) =>
    d.uri?.startsWith('git+https://github.com/ai-markdown/ai-markdown@')
  );
  assert(source && /^[a-f0-9]{40}$/.test(source.digest.gitCommit), 'Missing repository source digest');
  assert.equal(
    source.uri,
    `git+https://github.com/ai-markdown/ai-markdown@${ref}`,
    'Provenance source ref differs from workflow ref'
  );
  const digest = createHash('sha512').update(bytes).digest('hex');
  assert(
    statement.subject.some((s) => s.digest.sha512 === digest),
    'Provenance subject does not match tarball'
  );
  const invocation = statement.predicate.runDetails.metadata.invocationId;
  assert(
    /^https:\/\/github.com\/ai-markdown\/ai-markdown\/actions\/runs\/\d+(?:\/attempts\/\d+)?$/.test(invocation),
    'Unexpected provenance invocation'
  );
  return { ref, commit: source.digest.gitCommit, invocation };
}
const root = resolve(import.meta.dirname, '..');
const git = (args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
// An independently versioned package can keep its published version when only
// its README links or its development dependencies change. Its existing tarball
// and README are still checked against the original provenance; all other
// package files must stay identical, and so must every other manifest field.
// devDependencies never reach a consumer's install, so a routine update there
// does not call for a new version of an unchanged package.
export function verifyPackageSources(directory, source, target, cwd = root) {
  const diff = (paths) =>
    execFileSync('git', ['diff', '--exit-code', source, target, '--', ...paths], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  if (!INDEPENDENT.includes(directory)) {
    diff(['packages', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json']);
    return;
  }
  const manifest = `packages/${directory}/package.json`;
  diff([`packages/${directory}`, `:(exclude)packages/${directory}/README.md`, `:(exclude)${manifest}`]);
  const withoutDevDependencies = (commit) => {
    const parsed = JSON.parse(
      execFileSync('git', ['show', `${commit}:${manifest}`], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    );
    delete parsed.devDependencies;
    return parsed;
  };
  assert.deepEqual(
    withoutDevDependencies(target),
    withoutDevDependencies(source),
    `${manifest} changed outside devDependencies`
  );
}
async function get(url, binary = false) {
  assert.equal(new URL(url).protocol, 'https:');
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  assert(response.ok, `${url}: HTTP ${response.status}`);
  return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
}
async function audit(tag, reportDirectory) {
  assert(RELEASE_TAG_PATTERN.test(tag ?? ''), 'Usage: check-published-release.mjs <release-tag> [report-directory]');
  const target = git(['rev-parse', '--verify', `${tag}^{commit}`]);
  const version = releaseVersion(tag);
  const directories = releaseDirectories(tag);
  const report = {
    tag,
    target,
    node: process.version,
    checkedAt: new Date().toISOString(),
    packages: [],
    success: false,
  };
  mkdirSync(reportDirectory, { recursive: true });
  try {
    for (const directory of directories) {
      const expected = JSON.parse(git(['show', `${target}:packages/${directory}/package.json`]));
      assert.equal(expected.name, `@ai-markdown/${directory}`);
      assert(!expected.private);
      if (!INDEPENDENT.includes(directory) || !tag.startsWith('v'))
        assert.equal(expected.version, version, 'Tag differs from package version');
      let record, failure;
      // Registry metadata, attestation and CDN visibility can lag the upload.
      // Bound retries; a mismatch still fails the release rather than being ignored.
      for (let attempt = 0; attempt < 12; attempt++) {
        try {
          const metadata = await get(`https://registry.npmjs.org/${encodeURIComponent(expected.name)}`);
          const manifest = metadata.versions[expected.version];
          assert(manifest, `${expected.name}@${expected.version} is not visible`);
          assert.equal(manifest.name, expected.name);
          assert.equal(manifest.version, expected.version);
          assert.equal(
            metadata['dist-tags'][channel(expected.version)],
            expected.version,
            `${expected.name}: wrong dist-tag`
          );
          if (expected.version.includes('-'))
            assert.notEqual(metadata['dist-tags'].latest, expected.version, 'Prerelease occupies latest');
          assert.deepEqual(manifest.engines, expected.engines);
          for (const field of ['dependencies', 'peerDependencies']) {
            for (const [name, value] of Object.entries(manifest[field] ?? {})) {
              assert(
                !name.startsWith('@ai-react-markdown/') && !value.startsWith('workspace:'),
                'Legacy or workspace dependency'
              );
            }
          }
          if (['core', 'react', 'vue'].includes(directory))
            assert.equal(manifest.dependencies['@ai-markdown/engine'], expected.version);
          if (['react', 'vue'].includes(directory))
            assert.equal(manifest.dependencies['@ai-markdown/core'], expected.version);
          if (directory === 'react-mantine') {
            assert.equal(
              manifest.peerDependencies['@ai-markdown/react'],
              expected.peerDependencies['@ai-markdown/react']
            );
            const detector = JSON.parse(git(['show', `${target}:packages/code-language-detector/package.json`]));
            assert.equal(manifest.dependencies['@ai-markdown/code-language-detector'], `^${detector.version}`);
          }
          const bytes = await get(manifest.dist.tarball, true);
          assert.equal(manifest.dist.integrity, 'sha512-' + createHash('sha512').update(bytes).digest('base64'));
          const attestations = await get(manifest.dist.attestations.url);
          const provenance = attestations.attestations.find(
            (a) => a.predicateType === 'https://slsa.dev/provenance/v1'
          );
          assert(provenance, 'Missing provenance');
          const statement = JSON.parse(Buffer.from(provenance.bundle.dsseEnvelope.payload, 'base64').toString());
          const source = verifyStatement(statement, bytes);
          assert.equal(
            git(['rev-parse', '--verify', `${source.ref}^{commit}`]),
            source.commit,
            'Source tag does not match provenance'
          );
          git(['merge-base', '--is-ancestor', source.commit, target]);
          // Reused independent versions and retries retain their original provenance.
          // Compare package inputs, never the current workflow invocation ID.
          verifyPackageSources(directory, source.commit, target);
          record = {
            name: expected.name,
            version: expected.version,
            channel: channel(expected.version),
            integrity: manifest.dist.integrity,
            tarball: manifest.dist.tarball,
            source,
          };
          break;
        } catch (error) {
          failure = error;
          if (attempt < 11) await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }
      if (!record) throw failure;
      report.packages.push(record);
      console.log(`${record.name}@${record.version}: registry, integrity and provenance source passed`);
    }
    execFileSync(process.execPath, ['scripts/check-packed-consumers.mjs', '--release', tag], {
      cwd: root,
      stdio: 'inherit',
    });
    report.exactConsumers = true;
    if (tag.startsWith('v') && !tag.slice(1).includes('-')) {
      execFileSync(process.execPath, ['scripts/check-packed-consumers.mjs', '--release', tag, '--default-install'], {
        cwd: root,
        stdio: 'inherit',
      });
      report.defaultConsumers = true;
    }
    report.success = true;
  } catch (error) {
    report.error = error.message;
    throw error;
  } finally {
    writeFileSync(join(reportDirectory, 'published-release.json'), JSON.stringify(report, null, 2) + '\n');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await audit(process.argv[2], resolve(process.argv[3] ?? '.local-notes/published-release'));

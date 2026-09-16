/* global process, console */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { INDEPENDENT, RELEASE_TAG_PATTERN, TRAIN, releaseDirectories, releaseVersion } from './release-packages.mjs';

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const tag = process.argv[2];
assert(
  RELEASE_TAG_PATTERN.test(tag ?? ''),
  `Invalid release tag: ${tag} (package tags are only for ${INDEPENDENT.join(', ')})`
);
const isTrain = tag.startsWith('v');
const version = releaseVersion(tag);
const root = read(isTrain ? 'package.json' : `packages/${releaseDirectories(tag)[0]}/package.json`);
assert.equal(root.version, version, 'Tag must match package version');
if (isTrain) {
  for (const name of TRAIN) {
    const pkg = read(`packages/${name}/package.json`);
    assert.equal(pkg.name, `@ai-markdown/${name}`);
    assert.equal(pkg.version, version, `${name}: incomplete release train`);
    assert(!pkg.private);
  }
  for (const [name, dependencies] of [
    ['core', ['engine']],
    ['react', ['core', 'engine']],
    ['vue', ['core', 'engine']],
  ]) {
    const pkg = read(`packages/${name}/package.json`);
    for (const dependency of dependencies) assert.equal(pkg.dependencies[`@ai-markdown/${dependency}`], 'workspace:*');
  }
  assert.equal(
    read('packages/react-mantine/package.json').peerDependencies['@ai-markdown/react'],
    version.includes('-') ? version : `^${version}`
  );
  // Independent packages are depended on by caret range, so a train release
  // does not pin them to the version current at the time.
  assert.equal(read('packages/engine/package.json').dependencies['@ai-markdown/remark-mark-highlight'], 'workspace:^');
  assert.equal(
    read('packages/react-mantine/package.json').dependencies['@ai-markdown/code-language-detector'],
    'workspace:^'
  );
}
console.log(`Verified ${tag}; npm tag: ${version.includes('-') ? version.split('-')[1].split('.')[0] : 'latest'}`);

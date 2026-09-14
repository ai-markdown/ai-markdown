/* global process */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

// A miniature repository: the release-train manifests, the READMEs and the
// guides the version script may or may not rewrite. Every document carries
// both reference shapes (a peer snippet and an inline `pkg@version`) so the
// test proves the ALLOWLIST decides, not the absence of a match. Only the
// React package's references are ever rewritten; the Vue sentence stands in
// for the architecture guide's "stable @ai-markdown/vue@3.0.0 adapter".
const peer = (range) => `{\n  "peerDependencies": {\n    "@ai-markdown/react": "${range}"\n  }\n}\n`;
const inline = (version) =>
  `Install \`@ai-markdown/react@${version}\`. The stable \`@ai-markdown/vue@3.0.0\` adapter.\n`;
const document = (range, version) => peer(range) + inline(version);

function fixture(version = '3.0.0') {
  const root = mkdtempSync(join(tmpdir(), 'aimd-version-packages-'));
  mkdirSync(join(root, 'scripts'));
  copyFileSync(resolve('scripts', 'version-packages.mjs'), join(root, 'scripts', 'version-packages.mjs'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'ai-markdown', version }));
  writeFileSync(join(root, 'README.md'), document(`^${version}`, version));
  const manifests = {
    react: { name: '@ai-markdown/react', version },
    'react-mantine': {
      name: '@ai-markdown/react-mantine',
      version,
      peerDependencies: { '@ai-markdown/react': `^${version}` },
    },
    'remark-mark-highlight': { name: '@ai-markdown/remark-mark-highlight', version: '1.0.2' },
  };
  for (const [directory, manifest] of Object.entries(manifests)) {
    mkdirSync(join(root, 'packages', directory), { recursive: true });
    writeFileSync(join(root, 'packages', directory, 'package.json'), JSON.stringify(manifest));
  }
  // The Mantine README once lost its caret after a pre-release bump.
  writeFileSync(join(root, 'packages', 'react-mantine', 'README.md'), document(version, version));
  writeFileSync(join(root, 'packages', 'remark-mark-highlight', 'README.md'), document(`^${version}`, version));
  const guides = join(root, 'apps', 'docs', 'content', 'guides');
  mkdirSync(guides, { recursive: true });
  for (const name of [
    'index.md',
    'api-conventions.md',
    'extending-via-subpackage.md',
    'release-highlights.md',
    'migrating-to-v2.md',
    'framework-transition.md',
    'releasing-3.0.md',
    'architecture.md',
    'getting-started.md',
  ])
    writeFileSync(join(guides, name), document(`^${version}`, version));
  const references = join(root, 'apps', 'docs', 'content', 'reference');
  mkdirSync(references, { recursive: true });
  for (const name of ['react', 'vue', 'react-mantine'])
    writeFileSync(join(references, `${name}.md`), document(`^${version}`, version));
  return root;
}

const run = (root, version) =>
  execFileSync(process.execPath, [join(root, 'scripts', 'version-packages.mjs'), version], {
    cwd: root,
    encoding: 'utf8',
  });
const read = (root, ...segments) => readFileSync(join(root, ...segments), 'utf8');

test('the READMEs and the allowlisted guides follow the train version; historical guides never move', () => {
  const root = fixture();
  try {
    run(root, '3.1.0');
    const rewritten = document('^3.1.0', '3.1.0');
    for (const file of [
      ['README.md'],
      ['packages', 'react-mantine', 'README.md'],
      ['packages', 'remark-mark-highlight', 'README.md'],
      ['apps', 'docs', 'content', 'reference', 'react.md'],
      ['apps', 'docs', 'content', 'reference', 'vue.md'],
      ['apps', 'docs', 'content', 'reference', 'react-mantine.md'],
      ['apps', 'docs', 'content', 'guides', 'getting-started.md'],
      ['apps', 'docs', 'content', 'guides', 'extending-via-subpackage.md'],
    ])
      assert.equal(read(root, ...file), rewritten, file.join('/'));
    const historical = document('^3.0.0', '3.0.0');
    for (const name of [
      'index.md',
      'api-conventions.md',
      'release-highlights.md',
      'migrating-to-v2.md',
      'framework-transition.md',
      'releasing-3.0.md',
      'architecture.md',
    ])
      assert.equal(read(root, 'apps', 'docs', 'content', 'guides', name), historical, name);
    assert.equal(JSON.parse(read(root, 'package.json')).version, '3.1.0');
    assert.equal(JSON.parse(read(root, 'packages', 'react', 'package.json')).version, '3.1.0');
    const mantine = JSON.parse(read(root, 'packages', 'react-mantine', 'package.json'));
    assert.equal(mantine.version, '3.1.0');
    assert.equal(mantine.peerDependencies['@ai-markdown/react'], '^3.1.0');
    assert.equal(JSON.parse(read(root, 'packages', 'remark-mark-highlight', 'package.json')).version, '1.0.2');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a pre-release writes an exact peer range and the next stable bump restores the caret', () => {
  const root = fixture();
  try {
    run(root, '3.1.0-beta.1');
    const exact = document('3.1.0-beta.1', '3.1.0-beta.1');
    assert.equal(read(root, 'packages', 'react-mantine', 'README.md'), exact);
    assert.equal(read(root, 'apps', 'docs', 'content', 'guides', 'extending-via-subpackage.md'), exact);
    assert.equal(
      JSON.parse(read(root, 'packages', 'react-mantine', 'package.json')).peerDependencies['@ai-markdown/react'],
      '3.1.0-beta.1'
    );
    run(root, '3.1.0');
    const caret = document('^3.1.0', '3.1.0');
    assert.equal(read(root, 'packages', 'react-mantine', 'README.md'), caret);
    assert.equal(read(root, 'apps', 'docs', 'content', 'guides', 'extending-via-subpackage.md'), caret);
    assert.equal(read(root, 'apps', 'docs', 'content', 'guides', 'release-highlights.md'), document('^3.0.0', '3.0.0'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the allowlist names the guides that carry a current-release snippet in this repository', () => {
  // A guide added to the allowlist without such a snippet, or a snippet added
  // to a guide outside it, drifts silently; keep the two in step.
  const source = readFileSync(resolve('scripts', 'version-packages.mjs'), 'utf8');
  const [, list] = source.match(/const TRACKING_GUIDES = \[([^\]]*)\]/);
  const listed = [...list.matchAll(/'([^']+)'/g)].map(([, name]) => name);
  assert.deepEqual(listed.sort(), ['extending-via-subpackage.md', 'getting-started.md']);
  for (const name of listed)
    assert.match(read(resolve('apps', 'docs', 'content', 'guides'), name), /@ai-markdown\/react/);
});

test('the real requirements page follows candidate and stable bumps without rewriting history', () => {
  const root = fixture();
  try {
    const guidePath = ['apps', 'docs', 'content', 'guides', 'getting-started.md'];
    const currentGuide = read(resolve('.'), ...guidePath);
    const currentVersion = JSON.parse(read(resolve('.'), 'package.json')).version;
    assert.ok(currentGuide.includes('This guide targets the `' + currentVersion + '` package train.'));
    writeFileSync(join(root, ...guidePath), currentGuide);
    const historyPath = ['apps', 'docs', 'content', 'guides', 'release-highlights.md'];
    const history = read(resolve('.'), ...historyPath);
    writeFileSync(join(root, ...historyPath), history);
    for (const version of ['3.1.0-rc.1', '3.1.0']) {
      run(root, version);
      assert.equal(
        read(root, ...guidePath),
        currentGuide.replace(
          'This guide targets the `' + currentVersion + '` package train.',
          'This guide targets the `' + version + '` package train.'
        )
      );
      assert.equal(read(root, ...historyPath), history);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('current integration peer snippets match the Mantine manifest', () => {
  const expected = JSON.parse(read(resolve('.'), 'packages', 'react-mantine', 'package.json')).peerDependencies[
    '@ai-markdown/react'
  ];
  for (const path of [
    ['apps', 'docs', 'content', 'reference', 'react-mantine.md'],
    ['apps', 'docs', 'content', 'guides', 'extending-via-subpackage.md'],
    ['apps', 'docs', 'content', 'translations', 'zh-cn', 'apps', 'docs', 'content', 'reference', 'react-mantine.md'],
    [
      'apps',
      'docs',
      'content',
      'translations',
      'zh-cn',
      'apps',
      'docs',
      'content',
      'guides',
      'extending-via-subpackage.md',
    ],
  ]) {
    const ranges = [...read(resolve('.'), ...path).matchAll(/"@ai-markdown\/react":\s*"([^"]+)"/g)].map(
      ([, range]) => range
    );
    assert.ok(ranges.length > 0, path.join('/'));
    for (const range of ranges) assert.equal(range, expected, path.join('/'));
  }
});

test('Chinese current snippets follow candidate and stable versions while translated history stays fixed', () => {
  const root = fixture();
  try {
    const translated = join(root, 'apps', 'docs', 'content', 'translations', 'zh-cn', 'apps', 'docs', 'content');
    const currentPaths = [
      'guides/getting-started.md',
      'guides/extending-via-subpackage.md',
      'reference/react.md',
      'reference/vue.md',
      'reference/react-mantine.md',
    ];
    const historicalPaths = [
      'guides/index.md',
      'guides/api-conventions.md',
      'guides/release-highlights.md',
      'guides/migrating-to-v2.md',
      'guides/architecture.md',
    ];
    for (const file of [...currentPaths, ...historicalPaths]) {
      mkdirSync(join(translated, file.split('/')[0]), { recursive: true });
      writeFileSync(join(translated, file), document('^3.0.0', '3.0.0'));
    }
    for (const [version, range] of [
      ['3.1.0-rc.1', '3.1.0-rc.1'],
      ['3.1.0', '^3.1.0'],
    ]) {
      run(root, version);
      for (const file of currentPaths) assert.equal(read(translated, file), document(range, version), file);
      for (const file of historicalPaths) assert.equal(read(translated, file), document('^3.0.0', '3.0.0'), file);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* global Buffer */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { channel, verifyStatement, verifyPackageSources } from './check-published-release.mjs';

const bytes = Buffer.from('actual downloaded tarball');
const statement = () => ({
  predicateType: 'https://slsa.dev/provenance/v1',
  subject: [{ digest: { sha512: createHash('sha512').update(bytes).digest('hex') } }],
  predicate: {
    buildDefinition: {
      externalParameters: {
        workflow: {
          repository: 'https://github.com/ai-markdown/ai-markdown',
          path: '.github/workflows/release.yml',
          ref: 'refs/tags/v3.0.0-rc.1',
        },
      },
      resolvedDependencies: [
        {
          uri: 'git+https://github.com/ai-markdown/ai-markdown@refs/tags/v3.0.0-rc.1',
          digest: { gitCommit: 'a'.repeat(40) },
        },
      ],
    },
    runDetails: {
      metadata: { invocationId: 'https://github.com/ai-markdown/ai-markdown/actions/runs/123/attempts/1' },
    },
  },
});
test('release channels support beta, RC, stable and independent versions', () => {
  assert.equal(channel('3.0.0-beta.2'), 'beta');
  assert.equal(channel('3.0.0-rc.1'), 'rc');
  assert.equal(channel('3.0.0'), 'latest');
  assert.equal(channel('1.0.2'), 'latest');
});
test('retry preserves original publication invocation', () => {
  const source = verifyStatement(statement(), bytes);
  assert.equal(source.invocation, 'https://github.com/ai-markdown/ai-markdown/actions/runs/123/attempts/1');
});
for (const [name, mutate] of [
  [
    'other repository',
    (s) => {
      s.predicate.buildDefinition.externalParameters.workflow.repository += '-fork';
    },
  ],
  [
    'other workflow',
    (s) => {
      s.predicate.buildDefinition.externalParameters.workflow.path = '.github/workflows/untrusted.yml';
    },
  ],
  [
    'branch source',
    (s) => {
      s.predicate.buildDefinition.externalParameters.workflow.ref = 'refs/heads/main';
    },
  ],
  [
    'missing source',
    (s) => {
      s.predicate.buildDefinition.resolvedDependencies = [];
    },
  ],
  [
    'other invocation',
    (s) => {
      s.predicate.runDetails.metadata.invocationId = 'https://github.com/other/repo/actions/runs/123';
    },
  ],
])
  test(`reject ${name}`, () => {
    const s = statement();
    mutate(s);
    assert.throws(() => verifyStatement(s, bytes));
  });
test('reject tarball bytes differing from provenance subject', () => {
  assert.throws(() => verifyStatement(statement(), Buffer.from('different tarball')));
});

for (const [name, change, allowed] of [
  ['a devDependencies update', (manifest) => (manifest.devDependencies['@types/node'] = '^25.9.6'), true],
  ['a dependencies change', (manifest) => (manifest.dependencies.unified = '^12.0.0'), false],
  ['a version change', (manifest) => (manifest.version = '1.0.3'), false],
  ['an exports change', (manifest) => (manifest.exports = './dist/other.js'), false],
]) {
  test(`source equivalence: an independent manifest with ${name} is ${allowed ? 'allowed' : 'rejected'}`, (t) => {
    const cwd = mkdtempSync(join(tmpdir(), 'published-manifest-test-'));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const run = (...args) =>
      execFileSync('git', ['-c', 'user.name=Release test', '-c', 'user.email=test@example.com', ...args], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    run('init');
    const packageRoot = join(cwd, 'packages', 'remark-mark-highlight');
    mkdirSync(packageRoot, { recursive: true });
    const manifest = {
      name: '@ai-markdown/remark-mark-highlight',
      version: '1.0.2',
      exports: './dist/index.js',
      dependencies: { unified: '^11.0.5' },
      devDependencies: { '@types/node': '^25.9.5' },
    };
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify(manifest, null, 2));
    run('add', '.');
    run('commit', '-m', 'Original published package');
    const source = run('rev-parse', 'HEAD').toString().trim();
    change(manifest);
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify(manifest, null, 2));
    run('add', '.');
    run('commit', '-m', 'Later candidate');
    const verify = () => verifyPackageSources('remark-mark-highlight', source, 'HEAD', cwd);
    if (allowed) assert.doesNotThrow(verify);
    else assert.throws(verify);
  });
}

for (const [directory, file, allowed] of [
  ['remark-mark-highlight', 'README.md', true],
  ['remark-mark-highlight', 'src/index.ts', false],
  ['remark-mark-highlight', 'LICENSE', false],
  ['remark-mark-highlight', 'src/README.md', false],
  ['code-language-detector', 'README.md', true],
  ['code-language-detector', 'src/index.ts', false],
  ['engine', 'README.md', false],
]) {
  test(`source equivalence: ${directory}/${file} is ${allowed ? 'allowed' : 'rejected'}`, (t) => {
    const cwd = mkdtempSync(join(tmpdir(), 'published-source-test-'));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const run = (...args) =>
      execFileSync('git', ['-c', 'user.name=Release test', '-c', 'user.email=test@example.com', ...args], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    run('init');
    const packageRoot = join(cwd, 'packages', directory);
    mkdirSync(join(packageRoot, 'src'), { recursive: true });
    // Every published package has a manifest; the independent-package check compares it field by field.
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: `@ai-markdown/${directory}` }));
    const target = join(packageRoot, file);
    writeFileSync(target, 'original package file\n');
    run('add', '.');
    run('commit', '-m', 'Original published package');
    const source = run('rev-parse', 'HEAD').toString().trim();
    writeFileSync(target, 'changed package file\n');
    run('add', '.');
    run('commit', '-m', 'Later candidate');
    const verify = () => verifyPackageSources(directory, source, 'HEAD', cwd);
    if (allowed) assert.doesNotThrow(verify);
    else assert.throws(verify);
  });
}

/* global process, structuredClone */
import { URL } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { classify, dependencyGraph } from './impact.mjs';
import { TASK_FILES } from './soak-contract.mjs';
import ts from 'typescript';
const assess = (file, a, b) =>
  classify(
    [file],
    (name) => (name === file ? a : ''),
    (name) => (name === file ? b : '')
  );
const check = (file, a, b) => assess(file, a, b).required;
const level = (result) => (result.required ? 'full' : result.smokeRequired ? 'smoke' : 'none');
const changed = (oldFiles, newFiles) =>
  classify(
    [...new Set([...Object.keys(oldFiles), ...Object.keys(newFiles)])],
    (file) => oldFiles[file] ?? '',
    (file) => newFiles[file] ?? ''
  );
test('adapter, core, documentation, version and type-only changes do not require engine soak', () => {
  for (const p of [
    'packages/vue/src/render.ts',
    'packages/core/src/contribution.ts',
    'apps/docs/content/guides/architecture.md',
    'packages/react/src/index.ts',
  ])
    assert.equal(check(p, 'a', 'b'), false);
  assert.equal(check('packages/engine/package.json', '{"version":"1"}', '{"version":"2"}'), false);
  assert.equal(
    check('packages/engine/src/index.ts', 'export type { A } from "./x";', 'export type { B } from "./x";'),
    false
  );
  assert.equal(
    check(
      'packages/engine/src/x.ts',
      'export function x(a: string) { return a; }',
      'export function x(a: unknown) { return a; }'
    ),
    false
  );
});
test('algorithm, plugin, build and verification changes require soak', () => {
  for (const p of [
    'packages/engine/src/x.ts',
    'packages/remark-mark-highlight/src/index.ts',
    'packages/engine/tsup.config.ts',
    'scripts/soak/profiles/release.json',
    'pnpm-workspace.yaml',
  ])
    assert.equal(check(p, 'const a=1;', 'const a=2;'), true);
  assert.equal(check('packages/engine/package.json', '{"dependencies":{"x":"1"}}', '{"dependencies":{"x":"2"}}'), true);
  assert.equal(level(assess('package.json', '{"packageManager":"pnpm@1"}', '{"packageManager":"pnpm@2"}')), 'smoke');
});
const lock = (engineVersion = '1', unrelated = '1', transitive = '1') =>
  JSON.stringify({
    importers: {
      'packages/engine': { dependencies: { a: { specifier: engineVersion, version: engineVersion } } },
      'packages/core': { devDependencies: { unused: { version: unrelated } } },
    },
    snapshots: { [`a@${engineVersion}`]: { dependencies: { child: transitive } }, [`child@${transitive}`]: {} },
    packages: {
      [`a@${engineVersion}`]: { resolution: { integrity: 'parent' } },
      [`child@${transitive}`]: { resolution: { integrity: `child-${transitive}` } },
    },
  });
test('lockfile impact follows engine transitive dependencies, not unrelated importers', () => {
  assert.equal(dependencyGraph(lock()), dependencyGraph(lock('1', '2')));
  assert.equal(check('pnpm-lock.yaml', lock(), lock('1', '2')), false);
  assert.equal(check('pnpm-lock.yaml', lock(), lock('2')), true);
  assert.equal(check('pnpm-lock.yaml', lock(), lock('1', '1', '2')), true);
  assert.equal(check('pnpm-lock.yaml', lock(), '{}'), true);
});

const typedLock = (typesVersion, toolVersion = '1') =>
  JSON.stringify({
    importers: {
      'packages/engine': {
        devDependencies: {
          '@types/node': { specifier: typesVersion, version: typesVersion },
          tool: { specifier: toolVersion, version: `${toolVersion}(@types/node@${typesVersion})` },
        },
      },
    },
    snapshots: {
      [`@types/node@${typesVersion}`]: { dependencies: { 'undici-types': typesVersion } },
      [`undici-types@${typesVersion}`]: {},
      [`tool@${toolVersion}(@types/node@${typesVersion})`]: {
        dependencies: { helper: `1(@types/node@${typesVersion})` },
        transitivePeerDependencies: ['@types/node'],
      },
      [`helper@1(@types/node@${typesVersion})`]: {},
    },
    packages: {
      [`@types/node@${typesVersion}`]: { resolution: { integrity: `types-${typesVersion}` } },
      [`undici-types@${typesVersion}`]: { resolution: { integrity: `undici-${typesVersion}` } },
      [`tool@${toolVersion}`]: { resolution: { integrity: `tool-${toolVersion}` } },
      'helper@1': { resolution: { integrity: 'helper' } },
    },
  });
test('type declaration packages do not require soak, in the lockfile or an engine manifest', () => {
  // A bump shows up as the package itself and as peer suffixes on everything that resolved against it.
  assert.equal(check('pnpm-lock.yaml', typedLock('25.9.5'), typedLock('25.9.6')), false);
  assert.equal(check('pnpm-lock.yaml', typedLock('25.9.5'), typedLock('25.9.6', '2')), true);
  for (const manifest of ['packages/engine/package.json', 'packages/remark-mark-highlight/package.json']) {
    assert.equal(
      check(manifest, '{"devDependencies":{"@types/node":"^25.9.5"}}', '{"devDependencies":{"@types/node":"^25.9.6"}}'),
      false,
      manifest
    );
    assert.equal(
      level(assess(manifest, '{"devDependencies":{"vitest":"^4.1.10"}}', '{"devDependencies":{"vitest":"^4.1.11"}}')),
      'smoke',
      manifest
    );
  }
});

test('unit tests outside the soak legs are CI gates; legs and fuzz suites still require soak', () => {
  for (const file of [
    'packages/engine/src/preprocessors/latex.test.ts',
    'packages/engine/src/components/rehypeRebaseHashLinks.test.tsx',
    'packages/remark-mark-highlight/src/index.test.ts',
  ])
    assert.equal(check(file, 'const a=1;', 'const a=2;'), false, file);
  for (const leg of Object.values(TASK_FILES))
    assert.equal(check(`packages/engine/src/${leg}`, 'const a=1;', 'const a=2;'), true, leg);
  for (const file of [
    'packages/engine/src/components/incrementalParse/someOther.fuzz.test.ts',
    'packages/engine/src/components/incrementalParse/testPluginCatalog.ts',
    'packages/engine/vitest.config.ts',
  ])
    assert.equal(check(file, 'const a=1;', 'const a=2;'), true, file);
});

test('engine and plugin modules never import the excluded test/benchmark/evidence entries', () => {
  for (const directory of ['engine', 'remark-mark-highlight']) {
    const root = new URL(`../../packages/${directory}/src/`, import.meta.url);
    const offenders = readdirSync(root, { recursive: true })
      .map(String)
      .filter(
        (file) =>
          /\.[cm]?[jt]sx?$/.test(file) &&
          (!/\.(test|spec|bench|evidence)\.[cm]?[jt]sx?$/.test(file) ||
            /\.fuzz\.(test|spec)\./.test(file) ||
            (directory === 'engine' && Object.values(TASK_FILES).includes(file.replaceAll('\\', '/'))))
      )
      .flatMap((file) =>
        ts
          .preProcessFile(readFileSync(new URL(file, root), 'utf8'), true, true)
          .importedFiles.filter(
            ({ fileName }) =>
              /\.(test|spec|bench|evidence)(\.[cm]?[jt]sx?)?$/.test(fileName) ||
              /^(?:@stryker-mutator\/|@vitest\/(?:browser|coverage))/.test(fileName)
          )
          .map(({ fileName }) => `${file} -> ${fileName}`)
      );
    assert.deepEqual(offenders, [], directory);
  }
});

test('runtime exports require full soak; verification Node upgrades require smoke', () => {
  assert.equal(check('packages/engine/src/index.ts', 'export * from "./x";', 'export * from "./y";'), true);
  assert.equal(
    level(
      assess(
        '.github/workflows/release.yml',
        'jobs: {verify: {steps: [{with: {runtime: node@22}}]}}',
        'jobs: {verify: {steps: [{with: {runtime: node@24}}]}}'
      )
    ),
    'smoke'
  );
});

test('publication fails closed for failed checks, missing impact, rejected or cancelled approval', async () => {
  const { readFileSync } = await import('node:fs');
  const { parse } = await import('yaml');
  const { runInNewContext } = await import('node:vm');
  const workflow = parse(readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8'));
  const { verify, release, 'soak-approval': approval } = workflow.jobs;
  assert.equal(approval.environment, 'soak-approval');
  assert.equal(approval.needs, 'verify');
  assert.equal(approval.if, "needs.verify.outputs.soak_required == 'true'");
  assert.deepEqual(release.needs, ['verify', 'consumer-compat', 'soak-approval']);
  assert(!verify.steps.some((step) => step.run?.includes('publish-packages.mjs')));
  assert(release.steps.some((step) => step.run?.includes('publish-packages.mjs')));
  assert.equal(release.steps[0].with.ref, '${{ github.sha }}');
  for (const required of ['true', 'false', '']) {
    for (const verified of ['success', 'failure', 'cancelled', 'skipped']) {
      for (const compatible of ['success', 'failure', 'cancelled', 'skipped']) {
        for (const reviewed of ['success', 'failure', 'cancelled', 'skipped']) {
          for (const cancelled of [false, true]) {
            const expression = release.if
              .replaceAll('always()', 'true')
              .replaceAll('cancelled()', String(cancelled))
              .replaceAll('needs.verify.outputs.soak_required', JSON.stringify(required))
              .replaceAll('needs.verify.result', JSON.stringify(verified))
              .replaceAll('needs.consumer-compat.result', JSON.stringify(compatible))
              .replaceAll('needs.soak-approval.result', JSON.stringify(reviewed));
            const expected =
              !cancelled &&
              verified === 'success' &&
              compatible === 'success' &&
              ((required === 'true' && reviewed === 'success') || (required === 'false' && reviewed === 'skipped'));
            assert.equal(
              runInNewContext(expression),
              expected,
              JSON.stringify({ required, verified, compatible, reviewed, cancelled })
            );
          }
        }
      }
    }
  }
});

test('Git evidence ranges allow adapter follow-ups but invalidate engine changes', async () => {
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { inspect } = await import('./impact.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'aimd-impact-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = () => {
    git('add', '.');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  try {
    git('init');
    mkdirSync(join(dir, 'packages/engine/src'), { recursive: true });
    writeFileSync(join(dir, 'packages/engine/src/x.ts'), 'export const x = 1;');
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), workspace());
    writeFileSync(join(dir, 'pnpm-lock.yaml'), toolLock());
    const tested = commit();
    assert.equal(inspect(undefined, tested, dir).required, true);
    git('tag', 'v1.0.0');
    writeFileSync(join(dir, 'README.md'), 'Reader documentation');
    const docs = commit();
    assert.equal(inspect(undefined, docs, dir).required, false);
    writeFileSync(
      join(dir, 'pnpm-workspace.yaml'),
      workspace(['packages/*', 'corpus', 'apps/storybook-*', 'tooling/storybook-kit'])
    );
    writeFileSync(join(dir, 'vitest.config.ts'), 'export default { browserCatalogs: ["react", "vue"] };');
    const catalogs = commit();
    assert.equal(inspect(tested, catalogs, dir).required, false);
    assert.equal(inspect(undefined, catalogs, dir).required, false);
    writeFileSync(join(dir, 'pnpm-lock.yaml'), toolLock('5'));
    const toolUpgrade = commit();
    assert.equal(level(inspect(tested, toolUpgrade, dir)), 'smoke');
    assert.equal(level(inspect(undefined, toolUpgrade, dir)), 'smoke');
    writeFileSync(join(dir, 'packages/engine/src/x.ts'), 'export const x = 2;');
    const changed = commit();
    assert.equal(inspect(tested, changed, dir).required, true);
    assert.throws(() => inspect(changed, tested, dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const workflowJobs = (jobs) =>
  JSON.stringify({
    jobs: Object.fromEntries(Object.entries(jobs).map(([id, runtime]) => [id, { steps: [{ with: { runtime } }] }])),
  });
const workflowLevel = (before, after) =>
  level(assess('.github/workflows/ci.yml', workflowJobs(before), workflowJobs(after)));
test('only engine verification jobs affect runtime compatibility', () => {
  assert.equal(workflowLevel({ ci: 'node@22' }, { ci: 'node@22', docs: 'node@24' }), 'none');
  assert.equal(workflowLevel({ ci: 'node@22', docs: 'node@22' }, { ci: 'node@22', docs: 'node@24' }), 'none');
  assert.equal(workflowLevel({ ci: 'node@22', docs: 'node@22' }, { ci: 'node@22' }), 'none');
  assert.equal(workflowLevel({ ci: 'node@22' }, { ci: 'node@22', 'soak-smoke': 'node@22' }), 'none');
  assert.equal(workflowLevel({ ci: 'node@22' }, { ci: 'node@24' }), 'smoke');
  assert.equal(workflowLevel({ ci: 'node@22' }, { ci: 'node@22', 'soak-smoke': 'node@24' }), 'smoke');
  assert.equal(workflowLevel({ ci: 'node@22' }, { renamed: 'node@22' }), 'smoke');
  assert.equal(workflowLevel({ ci: 'node@22', verify: 'node@24' }, { ci: 'node@24', verify: 'node@22' }), 'smoke');
  assert.equal(workflowLevel({ ci: 'node@22', verify: 'node@24' }, { verify: 'node@24' }), 'smoke');
  assert.equal(
    level(
      assess(
        '.github/workflows/ci.yml',
        'jobs: {}',
        'jobs: {custom: {steps: [{with: {runtime: node@24}}, {run: "pnpm test:unit"}]}}'
      )
    ),
    'smoke'
  );
  assert.equal(
    level(
      assess(
        '.github/workflows/ci.yml',
        'jobs: {ci: {strategy: {matrix: {node: [22.23.2]}}}}',
        'jobs: {ci: {strategy: {matrix: {node: [24.20.0]}}}}'
      )
    ),
    'smoke'
  );
});

test('policy/control tests use CI, execution tools use smoke, sampling contracts stay full', () => {
  for (const file of [
    'impact.mjs',
    'impact.test.mjs',
    'soak-control.test.mjs',
    'check-release.mjs',
    'soak-watch.sh',
    'optimization-evidence.mjs',
    'coverage-map.json',
    'README.md',
  ])
    assert.equal(level(assess(`scripts/soak/${file}`, 'const a=1;', 'const a=2;')), 'none', file);
  for (const file of [
    'smoke.mjs',
    'soak-runner.mjs',
    'soak-metadata.mjs',
    'soak-aggregate.mjs',
    'task-setup.mjs',
    'profiles/smoke.json',
  ])
    assert.equal(level(assess(`scripts/soak/${file}`, 'const a=1;', 'const a=2;')), 'smoke', file);
  for (const file of ['soak.sh', 'soak-contract.mjs', 'profiles/release.json', 'unknown-new-runner.mjs'])
    assert.equal(level(assess(`scripts/soak/${file}`, 'const a=1;', 'const a=2;')), 'full', file);
});

test('release validation rejects custom baselines before evidence inspection', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./check-release.mjs', import.meta.url)), '--base', 'HEAD'],
    { encoding: 'utf8' }
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /always checks HEAD against the preceding train tag/);
});

const workspace = (packages = ['packages/*', 'corpus'], options = {}) => JSON.stringify({ packages, ...options });
const workspaceCheck = (a, b, lockfile = lock()) =>
  classify(
    ['pnpm-workspace.yaml'],
    (file) => (file === 'pnpm-lock.yaml' ? lockfile : a),
    (file) => (file === 'pnpm-lock.yaml' ? lockfile : b)
  );

test('private app/tooling workspace additions and equivalent globs do not invalidate engine evidence', () => {
  const base = workspace();
  assert.equal(level(workspaceCheck(base, workspace(undefined, { allowBuilds: { unrelated: true } }))), 'none');
  assert.equal(
    workspaceCheck(base, workspace(['packages/*', 'corpus', 'apps/storybook-*', 'tooling/storybook-kit'])).required,
    false
  );
  assert.equal(
    workspaceCheck(base, workspace(['corpus', 'packages/{engine,remark-mark-highlight}', 'packages/vue'])).required,
    false
  );
  assert.equal(workspaceCheck(base, workspace(['packages/*', 'corpus', '!apps/**'])).required, false);
  assert.equal(workspaceCheck(base, base + '\n# Reader comment\n').required, false);
});

test('workspace exclusions, missing dependency context and install policy changes remain fail closed', () => {
  const base = workspace();
  for (const packages of [
    [],
    ['packages/*'],
    ['corpus', 'packages/vue'],
    ['packages/*', 'corpus', '!packages/engine'],
    ['packages/*', 'corpus', '!packages/remark-mark-highlight'],
  ])
    assert.equal(workspaceCheck(base, workspace(packages)).required, true, JSON.stringify(packages));
  for (const options of [
    { overrides: { unused: '2' } },
    { catalog: { unused: '2' } },
    { peerDependencyRules: { allowedVersions: { 'storybook>vitest': '5' } } },
  ])
    assert.equal(level(workspaceCheck(base, workspace(undefined, options))), 'none');
  for (const options of [{ allowBuilds: { a: true } }, { nodeLinker: 'hoisted' }])
    assert.equal(level(workspaceCheck(base, workspace(undefined, options))), 'smoke');
  for (const invalid of ['', 'null', 'packages: [', 'packages: invalid', 'packages: [1]'])
    assert.equal(workspaceCheck(base, invalid).required, true);
  assert.equal(workspaceCheck(base, workspace(['packages/*', 'corpus', 'apps/*']), '{}').required, true);
});

test('workspace membership follows linked engine verification dependencies', () => {
  const data = JSON.parse(lock());
  data.importers['packages/engine'].devDependencies = { generator: { version: 'link:../../tooling/generator' } };
  data.importers['tooling/generator'] = {};
  const lockfile = JSON.stringify(data);
  const base = workspace(['packages/*', 'corpus', 'tooling/*']);
  assert.equal(
    workspaceCheck(base, workspace(['packages/*', 'corpus', 'tooling/*', 'apps/*']), lockfile).required,
    false
  );
  assert.equal(workspaceCheck(base, workspace(), lockfile).required, true);
});

test('root browser configuration is separate from actual engine verification inputs', () => {
  assert.equal(check('vitest.config.ts', 'React catalog', 'React and Vue catalogs'), false);
  assert.equal(check('apps/storybook-vue/.storybook/main.ts', 'a', 'b'), false);
  assert.equal(check('tooling/storybook-kit/common/corpus.ts', 'a', 'b'), false);
  for (const file of [
    'packages/engine/vitest.config.ts',
    'tsconfig.base.json',
    'corpus/documents/math.md',
    'corpus/documents/new-case.md',
  ])
    assert.equal(check(file, 'const a=1;', 'const a=2;'), true, file);
  assert.equal(check('corpus/documents/math.md', 'input', ''), true);
  assert.equal(
    check(
      'packages/engine/package.json',
      '{"devDependencies":{"fast-check":"1"}}',
      '{"devDependencies":{"fast-check":"2"}}'
    ),
    true
  );
});

const toolLock = (version = '4', child = '1', mutation = '1') => {
  const data = JSON.parse(lock());
  data.importers['.'] = { devDependencies: { vitest: { specifier: version, version } } };
  data.importers['packages/engine'].devDependencies = { '@stryker-mutator/core': { version: mutation } };
  Object.assign(data.snapshots, {
    [`vitest@${version}`]: { dependencies: { runner: child } },
    [`runner@${child}`]: {},
    [`@stryker-mutator/core@${mutation}`]: {},
  });
  Object.assign(data.packages, {
    [`vitest@${version}`]: { resolution: { integrity: version } },
    [`runner@${child}`]: { resolution: { integrity: child } },
  });
  return JSON.stringify(data);
};
test('Vitest and its transitive helpers need smoke; mutation-only changes need no soak', () => {
  assert.equal(level(assess('pnpm-lock.yaml', toolLock(), toolLock('5'))), 'smoke');
  assert.equal(level(assess('pnpm-lock.yaml', toolLock(), toolLock('4', '2'))), 'smoke');
  assert.equal(level(assess('pnpm-lock.yaml', toolLock(), toolLock('4', '1', '2'))), 'none');
  const data = JSON.parse(toolLock());
  data.importers['packages/engine'].dependencies.vitest = { version: '4' };
  const next = structuredClone(data);
  next.snapshots['vitest@4'].dependencies.runner = '2';
  next.snapshots['runner@2'] = {};
  assert.equal(
    level(assess('pnpm-lock.yaml', JSON.stringify(data), JSON.stringify(next))),
    'full',
    'runtime edges are never excluded by tool names'
  );
});
test('shared tool/runtime dependencies and build tools retain full priority', () => {
  const data = JSON.parse(toolLock());
  data.snapshots['a@1'].dependencies.runner = '1';
  const next = structuredClone(data);
  next.packages['runner@1'].resolution.integrity = 'changed-bytes';
  const result = assess('pnpm-lock.yaml', JSON.stringify(data), JSON.stringify(next));
  assert(result.required && result.smokeRequired);
  for (const name of ['tsup', 'typescript']) {
    const old = JSON.parse(toolLock());
    old.importers['.'].devDependencies[name] = { version: '1' };
    old.snapshots[`${name}@1`] = {};
    const newer = structuredClone(old);
    newer.importers['.'].devDependencies[name].version = '2';
    newer.snapshots[`${name}@2`] = {};
    assert.equal(level(assess('pnpm-lock.yaml', JSON.stringify(old), JSON.stringify(newer))), 'full');
  }
});
test('unresolved or removed dependency graphs never downgrade to smoke or none', () => {
  for (const invalid of ['', '{}', 'invalid: ['])
    assert.equal(level(assess('pnpm-lock.yaml', toolLock(), invalid)), 'full');
  const data = JSON.parse(toolLock());
  delete data.snapshots['runner@1'];
  assert.equal(level(assess('pnpm-lock.yaml', toolLock(), JSON.stringify(data))), 'full');
});
test('requested ranges and unrelated resolution policies do not change executed code', () => {
  const data = JSON.parse(lock());
  const next = structuredClone(data);
  next.importers['packages/engine'].dependencies.a.specifier = '^1';
  next.overrides = { unrelated: '2' };
  next.patchedDependencies = { 'unrelated@1': 'hash' };
  assert.equal(level(assess('pnpm-lock.yaml', JSON.stringify(data), JSON.stringify(next))), 'none');
});
test('patch content and hashes follow the affected dependency closure, including removals', () => {
  for (const [selector, expected] of [
    ['a@1', 'full'],
    ['vitest@4', 'smoke'],
    ['@stryker-mutator/core@1', 'none'],
  ]) {
    const file = 'patches/fix.patch';
    const files = {
      'pnpm-lock.yaml': toolLock(),
      'pnpm-workspace.yaml': workspace(undefined, { patchedDependencies: { [selector]: file } }),
      [file]: 'old',
    };
    assert.equal(level(changed(files, { ...files, [file]: 'new' })), expected, selector);
    assert.equal(level(changed(files, { ...files, [file]: '' })), expected, selector);
    const data = JSON.parse(toolLock());
    data.patchedDependencies = { [selector]: 'old' };
    const next = structuredClone(data);
    next.patchedDependencies[selector] = 'new';
    assert.equal(level(assess('pnpm-lock.yaml', JSON.stringify(data), JSON.stringify(next))), expected, selector);
  }
});
test('linked workspace source changes cannot escape the engine closure', () => {
  const data = JSON.parse(lock());
  data.importers['packages/engine'].devDependencies = { generator: { version: 'link:../../tooling/generator' } };
  data.importers['tooling/generator'] = {};
  const files = { 'pnpm-lock.yaml': JSON.stringify(data), 'tooling/generator/src/index.ts': 'export const n = 1;' };
  assert.equal(level(changed(files, { ...files, 'tooling/generator/src/index.ts': 'export const n = 2;' })), 'full');
  assert.equal(level(changed(files, { ...files, 'tooling/unrelated/src/index.ts': 'export const n = 2;' })), 'none');
});
test('cache/worker literals need smoke; setup, selection, aliases and computed settings stay full', () => {
  const file = 'packages/engine/vitest.config.ts';
  const config = (testOptions, extra = '') =>
    `import { defineConfig } from 'vitest/config'; export default defineConfig({test: { environment: 'node', ${testOptions} }, ${extra}});`;
  for (const knobs of ['fsModuleCache: true', 'maxWorkers: 2', 'fileParallelism: false', 'testTimeout: 30000'])
    assert.equal(level(assess(file, config(''), config(knobs))), 'smoke', knobs);
  for (const options of [
    "setupFiles: ['mock.ts']",
    "include: ['one.test.ts']",
    'globals: true',
    'fsModuleCache: modifyInputs()',
  ])
    assert.equal(level(assess(file, config(''), config(options))), 'full', options);
  assert.equal(
    level(assess(file, config(''), config('fsModuleCache: true', "resolve: { alias: { engine: './stub' } }"))),
    'full'
  );
  assert.equal(level(assess(file, config(''), config('') + '// comment')), 'none');
  assert.equal(level(assess(file, config(''), 'export default getConfig();')), 'full');
});
test('benchmarks, standalone evidence and mutation config remain ordinary CI inputs', () => {
  for (const file of [
    'packages/engine/src/preprocessors/latex.bench.ts',
    'packages/engine/src/probe.evidence.ts',
    'packages/engine/stryker.vitest.config.ts',
    'packages/engine/stryker.conf.json',
    'packages/engine/vitest.evidence.config.ts',
    'packages/remark-mark-highlight/vitest.config.ts',
  ])
    assert.equal(level(assess(file, 'const n=1;', 'const n=2;')), 'none', file);
  assert.equal(level(assess('packages/engine/src/strykerRuntime.ts', 'const n=1;', 'const n=2;')), 'full');
});
test('CI and release both enforce requested smoke, and policy commands cannot silently bypass assessment', async () => {
  const { parse } = await import('yaml');
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.scripts['check:soak-impact'], 'node scripts/soak/impact.mjs');
  assert.equal(manifest.scripts['test:soak-smoke'], 'node scripts/soak/smoke.mjs');
  for (const [file, jobId, stepId] of [
    ['ci.yml', 'soak-impact', 'impact'],
    ['release.yml', 'verify', 'soak'],
  ]) {
    const workflow = parse(readFileSync(new URL(`../../.github/workflows/${file}`, import.meta.url), 'utf8'));
    const steps = workflow.jobs[jobId].steps;
    assert.equal(steps.find((step) => step.id === stepId).run, 'pnpm check:soak-impact');
    const smoke = steps.find((step) => step.run === 'pnpm test:soak-smoke');
    assert.equal(smoke.if, `steps.${stepId}.outputs.smoke_required == 'true'`);
    assert(!smoke['continue-on-error']);
    assert.equal(steps.find((step) => step.uses === 'actions/upload-artifact@v7').with['include-hidden-files'], true);
    const build = steps.findIndex((step) => /(?:engine\.\.\.'|pnpm) build/.test(step.run ?? ''));
    assert(build >= 0 && build < steps.indexOf(smoke));
  }
});

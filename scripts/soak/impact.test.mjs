/* global process */
import { URL } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { classify, dependencyGraph } from './impact.mjs';
import { TASK_FILES } from './soak-contract.mjs';
const check = (file, a, b) =>
  classify(
    [file],
    () => a,
    () => b
  ).required;
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
    'scripts/soak/coverage-map.json',
    'pnpm-workspace.yaml',
  ])
    assert.equal(check(p, 'const a=1;', 'const a=2;'), true);
  assert.equal(check('packages/engine/package.json', '{"dependencies":{"x":"1"}}', '{"dependencies":{"x":"2"}}'), true);
  assert.equal(check('package.json', '{"packageManager":"pnpm@1"}', '{"packageManager":"pnpm@2"}'), true);
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
      check(manifest, '{"devDependencies":{"vitest":"^4.1.10"}}', '{"devDependencies":{"vitest":"^4.1.11"}}'),
      true,
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

test('no engine module imports a test file, so a non-leg test cannot change what a leg runs', () => {
  const root = new URL('../../packages/engine/src/', import.meta.url);
  const offenders = readdirSync(root, { recursive: true })
    .map(String)
    .filter((file) => /\.[cm]?[jt]sx?$/.test(file))
    .filter((file) =>
      /from\s+['"][^'"]*\.(test|spec)(\.[cm]?[jt]sx?)?['"]/.test(readFileSync(new URL(file, root), 'utf8'))
    );
  assert.deepEqual(offenders, []);
});

test('runtime exports and release Node changes require soak', () => {
  assert.equal(check('packages/engine/src/index.ts', 'export * from "./x";', 'export * from "./y";'), true);
  assert.equal(
    check(
      '.github/workflows/release.yml',
      'jobs: {build: {steps: [{with: {runtime: node@22}}]}}',
      'jobs: {build: {steps: [{with: {runtime: node@24}}]}}'
    ),
    true
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
    writeFileSync(join(dir, 'pnpm-lock.yaml'), lock());
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
    writeFileSync(join(dir, 'packages/engine/src/x.ts'), 'export const x = 2;');
    const changed = commit();
    assert.equal(inspect(tested, changed, dir).required, true);
    assert.throws(() => inspect(changed, tested, dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Workflow Node pins are compared PER JOB for jobs present in both versions.
// Any removed job that carried pins is a runtime change: a removed job's
// identity cannot prove the engine verification it ran is still running
// elsewhere (a rename plus an upgrade keeps every pin present somewhere).
// A new job is exempt only when its pins are already present and every
// existing job is unchanged. Comparing the bare set of pins loses the
// mapping: swapping two jobs' pins keeps the set identical.
const workflowJobs = (jobs) =>
  `jobs: {${Object.entries(jobs)
    .map(([id, pin]) => `${id}: {steps: [{with: {runtime: ${pin}}}]}`)
    .join(', ')}}`;
const workflowChanged = (before, after) => check('.github/workflows/ci.yml', workflowJobs(before), workflowJobs(after));

test('a new job on a Node pin the base already runs is not a runtime change', () => {
  // The PR that added the `docs` CI job on the existing 22.23.2 pin.
  assert.equal(workflowChanged({ ci: 'node@22.23.2' }, { docs: 'node@22.23.2', ci: 'node@22.23.2' }), false);
  assert.equal(
    check(
      '.github/workflows/release.yml',
      'jobs: {a: {strategy: {matrix: {node: [22.23.2]}}}}',
      'jobs: {a: {strategy: {matrix: {node: [22.23.2]}}}, b: {strategy: {matrix: {node: [22.23.2]}}}}'
    ),
    false
  );
});

test('a new job on a Node pin the base never ran is a runtime change', () => {
  assert.equal(workflowChanged({ ci: 'node@22.23.2' }, { docs: 'node@24.20.0', ci: 'node@22.23.2' }), true);
});

test('a changed pin on an existing job is a runtime change', () => {
  assert.equal(workflowChanged({ ci: 'node@22.23.2' }, { ci: 'node@24.20.0' }), true);
  assert.equal(
    workflowChanged({ verify: 'node@22.23.2', docs: 'node@22.23.2' }, { verify: 'node@24.20.0', docs: 'node@22.23.2' }),
    true
  );
});

test('swapping the pins of two existing jobs is a runtime change even though the pin set is unchanged', () => {
  // The reviewer's reproduction: verify 22 + docs 24 -> verify 24 + docs 22
  // kept the set {22, 24} and was reported as no change.
  assert.equal(
    workflowChanged({ verify: 'node@22.23.2', docs: 'node@24.20.0' }, { verify: 'node@24.20.0', docs: 'node@22.23.2' }),
    true
  );
});

test('removing any job that carried a pin is a runtime change, whether or not the pin survives elsewhere', () => {
  assert.equal(workflowChanged({ ci: 'node@22.23.2', legacy: 'node@20.19.0' }, { ci: 'node@22.23.2' }), true);
  assert.equal(workflowChanged({ ci: 'node@22.23.2', docs: 'node@22.23.2' }, { ci: 'node@22.23.2' }), true);
  // A removed job without any pin says nothing about the runtime.
  assert.equal(
    check(
      '.github/workflows/ci.yml',
      'jobs: {ci: {steps: [{with: {runtime: node@22.23.2}}]}, lint: {steps: [{run: pnpm lint}]}}',
      'jobs: {ci: {steps: [{with: {runtime: node@22.23.2}}]}}'
    ),
    false
  );
});

test('a pure rename of a pinned job is a runtime change', () => {
  assert.equal(workflowChanged({ ci: 'node@22.23.2' }, { renamed: 'node@22.23.2' }), true);
});

test('a renamed and upgraded verification job is a runtime change even when every pin survives elsewhere', () => {
  // The reviewer's reproduction: verify=22, docs=22, compat=24 ->
  // verifyNew=24, docs=22, compat=24. Every removed and added pin exists on
  // the other side, yet the engine is no longer verified on 22 by that job.
  assert.equal(
    workflowChanged(
      { verify: 'node@22.23.2', docs: 'node@22.23.2', compat: 'node@24.20.0' },
      { verifyNew: 'node@24.20.0', docs: 'node@22.23.2', compat: 'node@24.20.0' }
    ),
    true
  );
});

test('every file under scripts/soak/ except Markdown is soak mechanism, tests included', () => {
  // A control test can express a mechanism change on its own (a gate
  // rewritten to accept looser evidence), so the rule fails closed; the
  // cost is that a fixture rename in impact.test.mjs also requires soak.
  for (const file of [
    'scripts/soak/impact.test.mjs',
    'scripts/soak/soak-control.test.mjs',
    'scripts/soak/soak-runner.mjs',
    'scripts/soak/impact.mjs',
    'scripts/soak/soak.sh',
  ])
    assert.equal(check(file, 'const a=1;', 'const a=2;'), true, file);
  assert.equal(check('scripts/soak/README.md', 'a', 'b'), false);
});

test('matrix Node upgrades require new verification', () => {
  assert.equal(
    check(
      '.github/workflows/ci.yml',
      'jobs: {ci: {strategy: {matrix: {node: [22.23.2]}}}}',
      'jobs: {ci: {strategy: {matrix: {node: [24.20.0]}}}}'
    ),
    true
  );
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
    { overrides: { x: '2' } },
    { allowBuilds: { esbuild: true } },
    { nodeLinker: 'hoisted' },
    { catalog: { x: '2' } },
  ])
    assert.equal(workspaceCheck(base, workspace(undefined, options)).required, true);
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
    'packages/engine/vitest.evidence.config.ts',
    'tsconfig.base.json',
    'scripts/soak/soak-runner.mjs',
    'scripts/soak/impact.mjs',
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

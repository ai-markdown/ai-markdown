/* global process, console */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import { parse } from 'yaml';
import { TASK_FILES } from './soak-contract.mjs';

const canonical = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item
  );
/** Declaration packages carry no executable code. */
const isTypesPackage = (name) => name.startsWith('@types/');
/** pnpm peer suffixes name the @types versions a package resolved against, e.g.
 * `vite@8.2.1(@types/node@25.9.6)(esbuild@0.28.2)`. */
const withoutTypesPeers = (spec) => {
  let current = spec;
  for (let previous; previous !== current;) {
    previous = current;
    current = current.replace(/\(@types\/[^()]*\)/g, '');
  }
  return current;
};
// Only dev-only tooling is excluded from the full graph. A dependency reached
// through runtime dependencies is NEVER filtered by its name. Unknown engine
// dev dependencies stay significant (generators/oracles often live there).
const TEST_TOOLS = new Set([
  'vitest',
  '@vitest/browser',
  '@vitest/browser-playwright',
  '@vitest/coverage-v8',
  '@stryker-mutator/core',
  '@stryker-mutator/vitest-runner',
]);
const isTestTool = (name) => TEST_TOOLS.has(name);
const fullDevDependencies = (deps) =>
  Object.fromEntries(Object.entries(deps ?? {}).filter(([name]) => !isTestTool(name) && !isTypesPackage(name)));
const TOOL_ROOTS = ['vitest', 'yaml'];
const BUILD_ROOTS = ['typescript', 'tsup'];
const CONTROL_FILES = new Set([
  'scripts/soak/impact.mjs',
  'scripts/soak/check-release.mjs',
  'scripts/soak/assert-coverage-map.mjs',
  'scripts/soak/coverage-map.json',
  'scripts/soak/soak-watch.sh',
  'scripts/soak/gate-evidence.sh',
  'scripts/soak/optimization-evidence.mjs',
]);
const SMOKE_FILES = new Set([
  'scripts/soak/smoke.mjs',
  'scripts/soak/soak-runner.mjs',
  'scripts/soak/soak-metadata.mjs',
  'scripts/soak/soak-aggregate.mjs',
  'scripts/soak/task-setup.mjs',
  'scripts/soak/profiles/smoke.json',
]);
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
];
const withoutTypesPackages = (map) =>
  map && Object.fromEntries(Object.entries(map).filter(([name]) => !isTypesPackage(name)));
/** A changed unit test is gated by CI, not by the soak: the campaign runs only
 * the six leg files. Fuzz suites stay significant, since they share the legs'
 * generators and a leg can move to one. */
const SOAK_LEG_FILES = new Set(Object.values(TASK_FILES).map((file) => `packages/engine/src/${file}`));
const isNonLegUnitTest = (file) =>
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) && !/\.fuzz\.(test|spec)\./.test(file) && !SOAK_LEG_FILES.has(file);
const manifestInputs = (text) => {
  const p = JSON.parse(text);
  return canonical(
    Object.fromEntries(
      [...DEPENDENCY_FIELDS, 'scripts', 'engines', 'type', 'exports', 'main', 'module', 'sideEffects'].map((key) => [
        key,
        key === 'devDependencies'
          ? fullDevDependencies(p[key])
          : key === 'scripts'
            ? Object.fromEntries(
                Object.entries(p.scripts ?? {}).filter(([name]) =>
                  /^(prebuild|build|postbuild|preinstall|install|postinstall)$/.test(name)
                )
              )
            : DEPENDENCY_FIELDS.includes(key)
              ? withoutTypesPackages(p[key])
              : p[key],
      ])
    )
  );
};
function executable(text) {
  // Compare emitted JavaScript: comments and erased types cannot affect runtime.
  // Runtime re-exports remain significant because they may load different modules.
  const source = text;
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true },
  }).outputText;
}
function typesFreeSnapshot(snap) {
  const copy = { ...snap };
  for (const field of ['dependencies', 'optionalDependencies'])
    if (copy[field])
      copy[field] = Object.fromEntries(
        Object.entries(withoutTypesPackages(copy[field])).map(([name, version]) => [name, withoutTypesPeers(version)])
      );
  if (copy.transitivePeerDependencies)
    copy.transitivePeerDependencies = copy.transitivePeerDependencies.filter((name) => !isTypesPackage(name));
  return copy;
}
export function dependencyGraph(lockText, kind = 'full') {
  const lock = parse(lockText),
    visited = new Set(),
    result = {};
  if (!lock?.importers?.['packages/engine']) throw new Error('Missing engine importer');
  function snapshot(name, version, importer) {
    if (isTypesPackage(name)) return;
    if (version.startsWith('link:')) {
      workspace(path.posix.normalize(path.posix.join(importer, version.slice(5))));
      return;
    }
    const key = [`${name}@${version}`, version.replace(/^npm:/, '')].find((candidate) => lock.snapshots?.[candidate]);
    if (!key) throw new Error(`Unresolved dependency ${name}@${version}`);
    if (visited.has(key)) return;
    visited.add(key);
    const snap = lock.snapshots[key];
    result[withoutTypesPeers(key)] = { snapshot: typesFreeSnapshot(snap), package: lock.packages?.[key.split('(')[0]] };
    for (const [child, v] of Object.entries({ ...snap.dependencies, ...snap.optionalDependencies }))
      snapshot(child, v, importer);
  }
  function workspace(importer) {
    const key = `workspace:${importer}`;
    if (visited.has(key)) return;
    visited.add(key);
    const item = lock.importers?.[importer];
    if (!item) throw new Error(`Missing importer ${importer}`);
    const deps = withoutTypesPackages({
      ...fullDevDependencies(item.devDependencies),
      ...item.dependencies,
      ...item.optionalDependencies,
    });
    // The resolved version, not the requested range, determines executed code.
    result[key] = Object.fromEntries(
      Object.entries(deps).map(([name, data]) => [name, withoutTypesPeers(data.version)])
    );
    for (const [name, data] of Object.entries(deps)) snapshot(name, data.version, importer);
  }
  if (kind === 'full') workspace('packages/engine');
  const roots = kind === 'full' ? BUILD_ROOTS : TOOL_ROOTS;
  for (const importer of ['.', 'packages/engine', 'packages/remark-mark-highlight']) {
    const item = lock.importers?.[importer];
    for (const name of roots) {
      const dep = item?.devDependencies?.[name] ?? item?.dependencies?.[name];
      if (dep) {
        result[`tool:${importer}:${name}`] = withoutTypesPeers(dep.version);
        snapshot(name, dep.version, importer);
      }
    }
  }
  // Global override/patch tables include unrelated UI and mutation tools.
  // Resolved snapshots capture overrides; only patches reaching this graph matter.
  for (const [selector, hash] of Object.entries(lock.patchedDependencies ?? {}))
    if (patchReaches(selector, result)) result[`patch:${selector}`] = hash;
  return canonical(result);
}
function patchReaches(selector, graph) {
  const name = selector.match(/^(?:@[^/]+\/)?[^@]+/)[0];
  const version = selector.slice(name.length + 1);
  return Object.keys(graph).some((key) =>
    /^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version) ? key.split('(')[0] === `${name}@${version}` : key.startsWith(`${name}@`)
  );
}
function relevantPatches(workspaceText, graph) {
  const config = parse(workspaceText);
  if (!config || typeof config !== 'object') throw new Error('Missing workspace config');
  return Object.fromEntries(
    Object.entries(config.patchedDependencies ?? {}).filter(([selector]) => patchReaches(selector, graph))
  );
}
/** Compare effective membership and installation mechanics. Resolution policy is
 * represented by the frozen lockfile graph, not by unrelated global overrides.
 * Never consult the currently installed node_modules for a historical range. */
export function workspaceInputs(text, lockText) {
  const config = parse(text);
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid workspace config');
  const {
    packages = ['**'],
    overrides: _overrides,
    catalog: _catalog,
    catalogs: _catalogs,
    patchedDependencies: _patches,
    peerDependencyRules: _peers,
    minimumReleaseAge: _age,
    minimumReleaseAgeExclude: _ageExclude,
    ...options
  } = config;
  if (!Array.isArray(packages) || !packages.every((pattern) => typeof pattern === 'string' && pattern.length > 0))
    throw new Error('Invalid workspace patterns');
  const graph = { ...JSON.parse(dependencyGraph(lockText)), ...JSON.parse(dependencyGraph(lockText, 'smoke')) };
  options.allowBuilds = Object.fromEntries(
    Object.entries(options.allowBuilds ?? {}).filter(
      ([selector]) => selector.includes('*') || patchReaches(selector, graph)
    )
  );
  const inputs = [
    ...new Set([
      'packages/engine',
      'packages/remark-mark-highlight',
      'corpus',
      ...Object.keys(graph)
        .filter((key) => key.startsWith('workspace:'))
        .map((key) => key.slice('workspace:'.length)),
    ]),
  ].sort();
  const positive = packages.filter((pattern) => !pattern.startsWith('!'));
  const negative = packages.filter((pattern) => pattern.startsWith('!')).map((pattern) => pattern.slice(1));
  const included = inputs.map((directory) => [
    directory,
    positive.some((pattern) => path.posix.matchesGlob(directory, pattern)) &&
      !negative.some((pattern) => path.posix.matchesGlob(directory, pattern)),
  ]);
  if (included.some(([, present]) => !present)) throw new Error('Engine verification workspace is excluded');
  return canonical({ options, included, patches: relevantPatches(text, graph) });
}
/** Job id → sorted Node pins (`node@x.y.z`) from `with.runtime` steps and
 *  `strategy.matrix.node` entries of a CI or release workflow. */
export function jobRuntimes(text) {
  const workflow = parse(text) ?? {};
  return new Map(
    Object.entries(workflow.jobs ?? {})
      .filter(
        ([id, job]) =>
          ['ci', 'verify', 'release', 'soak-impact', 'soak-smoke'].includes(id) ||
          (job.steps ?? []).some((step) =>
            /\bpnpm (?:run )?(?:build|test:unit|test:soak-smoke)(?:\s|$)/.test(step.run ?? '')
          )
      )
      .map(([id, job]) => [
        id,
        [
          ...(job.steps ?? []).filter((step) => step.with?.runtime).map((step) => String(step.with.runtime)),
          ...(job.strategy?.matrix?.node ?? []).map((node) => `node@${node}`),
        ].sort(),
      ])
  );
}
export function workflowRuntimeChanged(before, after) {
  const beforePins = new Set([...before.values()].flat());
  for (const [id, was] of before) {
    const now = after.get(id);
    // A removed job's identity cannot prove its verification still runs
    // elsewhere (a rename plus an upgrade keeps every pin present somewhere),
    // so any removed job that carried a pin is a change, a pure rename too.
    if (now ? canonical(was) !== canonical(now) : was.length > 0) return true;
  }
  for (const [id, now] of after) if (!before.has(id) && now.some((pin) => !beforePins.has(pin))) return true;
  return false;
}
// Removing only literal execution knobs lets cache/parallelism migrations use
// smoke, while aliases, setup hooks, test selection and unknown config stay full.
function configBehavior(text) {
  const source = ts.createSourceFile('vitest.config.ts', text, ts.ScriptTarget.Latest, true);
  const knobs = new Set([
    'fsModuleCache',
    'maxWorkers',
    'fileParallelism',
    'testTimeout',
    'hookTimeout',
    'teardownTimeout',
  ]);
  const transformed = ts.transform(source, [
    (context) => (root) => {
      const visit = (node) => {
        if (
          ts.isExportAssignment(node) &&
          ts.isCallExpression(node.expression) &&
          node.expression.expression.getText(source) === 'defineConfig'
        ) {
          const call = node.expression;
          const config = call.arguments[0];
          if (call.arguments.length === 1 && ts.isObjectLiteralExpression(config)) {
            const properties = config.properties.map((property) => {
              if (
                !ts.isPropertyAssignment(property) ||
                property.name.getText(source) !== 'test' ||
                !ts.isObjectLiteralExpression(property.initializer)
              )
                return property;
              const kept = property.initializer.properties.filter(
                (option) =>
                  !(
                    ts.isPropertyAssignment(option) &&
                    knobs.has(option.name.getText(source)) &&
                    (ts.isNumericLiteral(option.initializer) ||
                      [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(option.initializer.kind))
                  )
              );
              return ts.factory.updatePropertyAssignment(
                property,
                property.name,
                ts.factory.updateObjectLiteralExpression(property.initializer, kept)
              );
            });
            return ts.factory.updateExportAssignment(
              node,
              node.modifiers,
              ts.factory.updateCallExpression(call, call.expression, call.typeArguments, [
                ts.factory.updateObjectLiteralExpression(config, properties),
              ])
            );
          }
        }
        return ts.visitEachChild(node, visit, context);
      };
      return ts.visitNode(root, visit);
    },
  ]);
  try {
    return executable(ts.createPrinter().printFile(transformed.transformed[0]));
  } finally {
    transformed.dispose();
  }
}
function decision(reasons, smokeReasons = []) {
  return { required: reasons.length > 0, smokeRequired: smokeReasons.length > 0, reasons, smokeReasons };
}
export function classify(paths, before, after) {
  const reasons = [],
    smokeReasons = [];
  const graphs = new Map();
  const graph = (read, kind) => {
    if (!graphs.has(read)) graphs.set(read, {});
    return (graphs.get(read)[kind] ??= JSON.parse(dependencyGraph(read('pnpm-lock.yaml'), kind)));
  };
  for (const file of paths) {
    const a = before(file),
      b = after(file);
    if (a === b) continue;
    if (file === 'pnpm-lock.yaml') {
      try {
        if (canonical(graph(before, 'full')) !== canonical(graph(after, 'full')))
          reasons.push(`${file}: engine, generator or build dependency graph changed`);
        if (canonical(graph(before, 'smoke')) !== canonical(graph(after, 'smoke')))
          smokeReasons.push(`${file}: soak execution toolchain changed`);
      } catch {
        reasons.push(`${file}: dependency impact could not be resolved`);
      }
    } else if (file === 'pnpm-workspace.yaml') {
      try {
        if (workspaceInputs(a, before('pnpm-lock.yaml')) !== workspaceInputs(b, after('pnpm-lock.yaml')))
          smokeReasons.push(`${file}: engine workspace installation changed`);
      } catch {
        reasons.push(`${file}: engine workspace impact could not be resolved`);
      }
    } else if (file.startsWith('patches/')) {
      if (file.endsWith('.md')) continue;
      try {
        for (const [kind, target] of [
          ['full', reasons],
          ['smoke', smokeReasons],
        ])
          if (
            [before, after].some((read) =>
              Object.values(relevantPatches(read('pnpm-workspace.yaml'), graph(read, kind))).includes(file)
            )
          )
            target.push(
              `${file}: patch reaches the ${kind === 'full' ? 'engine/generator/build' : 'soak tool'} dependency graph`
            );
      } catch {
        reasons.push(`${file}: patch impact could not be resolved`);
      }
    } else if (file === 'package.json') {
      const inputs = (text) => {
        const manifest = JSON.parse(text || '{}');
        return canonical({
          packageManager: manifest.packageManager,
          scripts: Object.fromEntries(
            Object.entries(manifest.scripts ?? {}).filter(([name]) => name === 'test:soak-smoke')
          ),
        });
      };
      if (inputs(a) !== inputs(b)) smokeReasons.push(`${file}: package manager or smoke entry point changed`);
    } else if (/^\.github\/workflows\/(release|ci)\.yml$/.test(file)) {
      if (workflowRuntimeChanged(jobRuntimes(a), jobRuntimes(b)))
        smokeReasons.push(`${file}: verification Node runtime changed`);
    } else if (/^packages\/(engine|remark-mark-highlight)\/package.json$/.test(file)) {
      if (!a || !b || manifestInputs(a) !== manifestInputs(b))
        reasons.push(`${file}: runtime, generator or build contract changed`);
      const tools = (text) => {
        const manifest = JSON.parse(text || '{}');
        return canonical(
          Object.fromEntries(
            Object.entries(manifest.devDependencies ?? {}).filter(([name]) => TOOL_ROOTS.includes(name))
          )
        );
      };
      if (tools(a) !== tools(b)) smokeReasons.push(`${file}: soak execution dependencies changed`);
    } else if (/^packages\/(engine|remark-mark-highlight)\//.test(file)) {
      if (
        /\.(md|txt)$|\/LICENSE$/.test(file) ||
        isNonLegUnitTest(file) ||
        /\.(bench|evidence)\.[cm]?[jt]sx?$/.test(file)
      )
        continue;
      if (
        /^packages\/(engine|remark-mark-highlight)\/(stryker\.conf\.json|stryker\.vitest\.config\.ts|vitest\.evidence\.config\.ts)$/.test(
          file
        ) ||
        file === 'packages/remark-mark-highlight/vitest.config.ts'
      )
        continue;
      if (/\.[cm]?[jt]sx?$/.test(file) && a && b && executable(a) === executable(b)) continue;
      if (file === 'packages/engine/vitest.config.ts' && a && b && configBehavior(a) === configBehavior(b))
        smokeReasons.push(`${file}: test execution settings changed`);
      else reasons.push(`${file}: engine/plugin implementation or verification changed`);
    } else if (/^corpus\/documents\//.test(file)) {
      reasons.push(`${file}: engine differential verification input changed`);
    } else if (file.startsWith('scripts/soak/')) {
      if (file.endsWith('.md') || file.endsWith('.test.mjs') || CONTROL_FILES.has(file)) continue;
      if (/\.[cm]?js$/.test(file) && a && b && executable(a) === executable(b)) continue;
      (SMOKE_FILES.has(file) ? smokeReasons : reasons).push(
        `${file}: soak ${SMOKE_FILES.has(file) ? 'execution/evidence tooling' : 'sampling or verification contract'} changed`
      );
    } else if (file === 'tsconfig.base.json') {
      reasons.push(`${file}: shared compiler configuration changed`);
    } else if (before('pnpm-lock.yaml') || after('pnpm-lock.yaml')) {
      // Linked generator/build packages can live outside packages/engine.
      try {
        for (const kind of ['full', 'smoke']) {
          if (
            [before, after].some((read) =>
              Object.keys(graph(read, kind)).some(
                (key) => key.startsWith('workspace:') && file.startsWith(`${key.slice(10)}/`)
              )
            )
          ) {
            if (/\.(md|txt)$/.test(file) || isNonLegUnitTest(file)) continue;
            if (/\.[cm]?[jt]sx?$/.test(file) && a && b && executable(a) === executable(b)) continue;
            (kind === 'full' ? reasons : smokeReasons).push(
              `${file}: linked ${kind === 'full' ? 'engine' : 'tool'} workspace input changed`
            );
          }
        }
      } catch {
        reasons.push(`${file}: linked workspace impact could not be resolved`);
      }
    }
  }
  return decision(reasons, smokeReasons);
}
export function inspect(base, head = 'HEAD', cwd = process.cwd()) {
  const git = (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const target = git(['rev-parse', '--verify', `${head}^{commit}`]);
  if (!base) {
    try {
      base = git(['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', `${target}^`]);
    } catch {
      return {
        base: null,
        head: target,
        ...decision(['No preceding train tag; initial verification is required']),
      };
    }
  }
  base = git(['rev-parse', '--verify', `${base}^{commit}`]);
  git(['merge-base', '--is-ancestor', base, target]);
  const paths = git(['diff', '--name-only', '--no-renames', base, target]).split('\n').filter(Boolean);
  const read = (ref) => (file) => {
    try {
      return git(['show', `${ref}:${file}`]);
    } catch {
      return '';
    }
  };
  return { base, head: target, ...classify(paths, read(base), read(target)) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const value = (flag) => {
    const i = process.argv.indexOf(flag);
    return i < 0 ? undefined : process.argv[i + 1];
  };
  const result = inspect(value('--base'), value('--head'));
  console.log(JSON.stringify(result, null, 2));
  const label = result.required
    ? 'FULL soak required before publication'
    : result.smokeRequired
      ? 'SMOKE verification required; full soak not required'
      : 'No soak required';
  if (process.env.GITHUB_ACTIONS === 'true')
    console.log(`::notice title=Engine soak impact::${label}. See the job summary for the baseline and reasons.`);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `required=${result.required}\nsmoke_required=${result.smokeRequired}\nhead=${result.head}\n`
    );
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Engine soak impact\n\nDecision: **${label}**\n\nBase: \`${result.base}\`\nCandidate: \`${result.head}\`\n\n### Full campaign reasons\n\n${result.reasons.map((r) => `- ${r}`).join('\n') || 'None.'}\n\n### Bounded smoke reasons\n\n${result.smokeReasons.map((r) => `- ${r}`).join('\n') || 'None.'}\n\nThis report is informational, not passing evidence. CI and release verification run the bounded smoke when requested. Full campaigns remain a local release gate. The range is cumulative since the preceding train tag; release CI reassesses the final candidate.\n`
    );
}

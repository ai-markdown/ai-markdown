/* global process, console */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { INDEPENDENT, RELEASE_TAG_PATTERN, TRAIN } from './release-packages.mjs';

// Install actual tarballs outside the workspace. No source aliases or symlinks
// can hide missing dependencies, declaration leaks or broken CSS subpaths.
const root = resolve(import.meta.dirname, '..');
const releaseIndex = process.argv.indexOf('--release');
const releaseTag = releaseIndex < 0 ? null : process.argv[releaseIndex + 1];
assert(releaseIndex < 0 || RELEASE_TAG_PATTERN.test(releaseTag ?? ''), 'Expected --release <tag>');
const defaultInstall = process.argv.includes('--default-install');
assert(!defaultInstall || releaseTag, '--default-install requires --release');
const manifestFor = (dir) =>
  JSON.parse(
    releaseTag
      ? execFileSync('git', ['show', `${releaseTag}:packages/${dir}/package.json`], { cwd: root, encoding: 'utf8' })
      : readFileSync(join(root, 'packages', dir, 'package.json'), 'utf8')
  );
const out = mkdtempSync(join(tmpdir(), 'ai-markdown-consumers-'));
const packages = [...INDEPENDENT, ...TRAIN];
const dependencies = {};
for (const dir of packages) {
  const manifest = manifestFor(dir);
  if (releaseTag) {
    execFileSync(
      'npm',
      [
        'pack',
        `${manifest.name}@${manifest.version}`,
        '--registry=https://registry.npmjs.org',
        '--pack-destination',
        out,
        '--ignore-scripts',
      ],
      { cwd: out, stdio: 'pipe', encoding: 'utf8' }
    );
  } else {
    execFileSync('pnpm', ['--filter', `./packages/${dir}`, 'pack', '--pack-destination', out], {
      cwd: root,
      stdio: 'pipe',
      encoding: 'utf8',
    });
  }
  const file = `${manifest.name.slice(1).replace('/', '-')}-${manifest.version}.tgz`;
  dependencies[manifest.name] = defaultInstall ? '*' : `file:${join(out, file)}`;
  const packed = JSON.parse(
    execFileSync('tar', ['-xOf', join(out, file), 'package/package.json'], { encoding: 'utf8' })
  );
  assert.equal(packed.name, manifest.name);
  assert.equal(packed.version, manifest.version);
  assert.equal(packed.private, undefined);
  for (const field of ['dependencies', 'peerDependencies']) {
    for (const [name, version] of Object.entries(packed[field] ?? {})) {
      assert(!name.startsWith('@ai-react-markdown/'), `${dir}: legacy dependency`);
      assert(!version.startsWith('workspace:'), `${dir}: unpublished workspace specifier`);
    }
  }
  if (dir === 'core' || dir === 'react' || dir === 'vue')
    assert.equal(packed.dependencies['@ai-markdown/engine'], manifest.version);
  if (dir === 'react' || dir === 'vue') assert.equal(packed.dependencies['@ai-markdown/core'], manifest.version);
}
Object.assign(dependencies, {
  vue: '^3.5.0',
  '@vue/server-renderer': '^3.5.0',
  react: '^19.2.7',
  'react-dom': '^19.2.7',
  '@types/react': '^19.2.18',
  '@types/react-dom': '^19.2.7',
  ...Object.fromEntries(
    ['core', 'hooks', 'code-highlight'].map((name) => [
      `@mantine/${name}`,
      manifestFor('react-mantine').devDependencies[`@mantine/${name}`],
    ])
  ),
  'highlight.js': '^11.11.2',
  katex: '^0.17.0',
  typescript: '^6.0.3',
});
// Local checks use the exact installed host versions; registry checks need no workspace build.
if (!releaseTag) {
  for (const [dir, names] of [
    ['react', ['react', 'react-dom']],
    ['vue', ['vue', '@vue/server-renderer']],
    ['react-mantine', ['@mantine/core', '@mantine/hooks', '@mantine/code-highlight']],
  ])
    for (const name of names)
      dependencies[name] = JSON.parse(
        readFileSync(join(root, 'packages', dir, 'node_modules', name, 'package.json'), 'utf8')
      ).version;
}
writeFileSync(
  join(out, 'package.json'),
  JSON.stringify({ name: 'packed-consumer', private: true, type: 'module', dependencies }, null, 2)
);
execFileSync(
  'npm',
  ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org'],
  {
    cwd: out,
    stdio: 'pipe',
    encoding: 'utf8',
  }
);
for (const dir of packages) {
  const installed = JSON.parse(readFileSync(join(out, 'node_modules/@ai-markdown', dir, 'package.json'), 'utf8'));
  assert.equal(installed.version, manifestFor(dir).version, `${dir}: installed version differs from release`);
}
const probe = `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const react = await import('@ai-markdown/react');
const core = await import('@ai-markdown/core');
const engine = await import('@ai-markdown/engine');
const Vue = await import('vue');
const adapter = await import('@ai-markdown/vue');
const vueServer = await import('@vue/server-renderer');
assert((await vueServer.renderToString(Vue.createSSRApp({ render: () => Vue.h(adapter.AIMarkdown, { content: '**Vue packed**' }) }))).includes('<strong>Vue packed</strong>'));
const cjsVue = require('@ai-markdown/vue');
assert((await require('@vue/server-renderer').renderToString(require('vue').createSSRApp({ render: () => require('vue').h(cjsVue.AIMarkdown, { content: '**Vue CJS**' }) }))).includes('<strong>Vue CJS</strong>'));
const React = await import('react');
const { renderToString } = await import('react-dom/server');
const html = renderToString(React.createElement(react.default, { content: '**Packed** [safe](https://example.com)' }));
assert(html.includes('<strong>Packed</strong>'));
assert(html.includes('https://example.com'));
const { MantineProvider } = await import('@mantine/core');
const { default: MantineMarkdown } = await import('@ai-markdown/react-mantine');
assert(renderToString(React.createElement(MantineProvider, {}, React.createElement(MantineMarkdown, { content: '**Mantine packed**' }))).includes('<strong>Mantine packed</strong>'));
// Importability alone misses CJS default interop failures inside the wrapper.
const CjsReact = require('react');
assert(require('react-dom/server').renderToString(CjsReact.createElement(require('@mantine/core').MantineProvider, {}, CjsReact.createElement(require('@ai-markdown/react-mantine').default, { content: '**Mantine CJS packed**' }))).includes('<strong>Mantine CJS packed</strong>'));
// Auto-detection resolves the packed detector dependency during server rendering. A detector package tag verifies
// against the train already on npm, which may predate react-mantine's use of the detector.
if (require('@ai-markdown/react-mantine/package.json').dependencies?.['@ai-markdown/code-language-detector']) assert(renderToString(React.createElement(MantineProvider, {}, React.createElement(MantineMarkdown, { content: '\`\`\`\\nfn main() {\\n    let mut total = 0;\\n    println!("{}", total);\\n}\\n\`\`\`', codeBlock: { autoDetectUnknownLanguage: true } }))).includes('>rust<'));
assert.equal(typeof core.createPipelineSession, 'function');
assert.equal(typeof engine.createRegistry, 'function');
assert(!('DEFAULT_PAYLOAD' in engine));
for (const name of ['@ai-markdown/remark-mark-highlight', '@ai-markdown/code-language-detector', '@ai-markdown/core', '@ai-markdown/engine', '@ai-markdown/react', '@ai-markdown/react/plugins', '@ai-markdown/react-mantine', '@ai-markdown/vue']) {
  assert(require(name));
  assert(await import(name));
}
for (const name of ['@ai-markdown/react/typography/default.css', '@ai-markdown/react/typography/all.css', '@ai-markdown/react-mantine/styles.css', '@ai-markdown/vue/styles.css']) assert(require.resolve(name).endsWith('.css'));
assert.equal(typeof require('@ai-markdown/core').createPipelineSession, 'function');
const detector = require('@ai-markdown/code-language-detector');
assert.equal(detector.detectLanguage('fn main() {\\n    let mut total = 0;\\n    println!("{}", total);\\n}').language, detector.CodeLanguage.Rust);
`;
const hasComponents = Boolean(manifestFor('react').exports['./components']);
const componentsProbe = `
for (const suffix of ['components', 'components/code', 'components/code/plain', 'components/image', 'components/table']) {
  assert(await import('@ai-markdown/react/' + suffix)); assert(require('@ai-markdown/react/' + suffix));
  assert(await import('@ai-markdown/vue/' + suffix)); assert(require('@ai-markdown/vue/' + suffix));
}
for (const format of ['esm', 'cjs']) {
  const load = name => format === 'esm' ? import(name) : Promise.resolve(require(name));
  const adapter = await load('@ai-markdown/react');
  const rich = await load('@ai-markdown/react/components');
  const fence = String.fromCharCode(96).repeat(3);
  const markdown = [fence + 'mermaid', 'graph TD; A-->B', fence, '', 'text ![alt](https://example.com/image.png)', '', '| A | B |', '| - | - |', '| =SUM(A1) | -1 |'].join('\\n');
  const html = renderToString(React.createElement(adapter.default, { content: markdown, streaming: true, colorScheme: 'dark', customComponents: { pre: rich.MarkdownCodeBlock, img: rich.MarkdownImage, table: rich.MarkdownTable } }));
  assert(html.includes('data-color-scheme="dark"')); assert(html.includes('graph TD;')); assert(html.includes('Copy table')); assert(!html.includes('<dialog')); assert(!html.includes('Preview image'));
  const v = await load('@ai-markdown/vue'); const vr = await load('@ai-markdown/vue/components');
  const vh = await vueServer.renderToString(Vue.createSSRApp({ render: () => Vue.h(v.AIMarkdown, { content: markdown, components: { pre: vr.MarkdownCodeBlock, img: vr.MarkdownImage, table: vr.MarkdownTable } }) }));
  assert(vh.includes('graph TD;')); assert(vh.includes('Copy table')); assert(!vh.includes('<dialog'));
  const m = await load('@ai-markdown/react-mantine/components');
  const mantine = await load('@mantine/core');
  assert(renderToString(React.createElement(mantine.MantineProvider, {}, React.createElement(adapter.default, { content: markdown, customComponents: { pre: m.MarkdownCodeBlock, img: m.MarkdownImage, table: m.MarkdownTable } }))).includes('Copy table'));
}
for (const name of ['@ai-markdown/react/components/styles.css', '@ai-markdown/vue/components/styles.css']) assert(require.resolve(name).endsWith('.css'));
`;
writeFileSync(join(out, 'probe.mjs'), probe + (hasComponents ? componentsProbe : ''));
for (const conditions of [[], ['--conditions=development']])
  execFileSync(process.execPath, [...conditions, 'probe.mjs'], { cwd: out, stdio: 'pipe', encoding: 'utf8' });
const types = `
import { createElement } from 'react';
import { h } from 'vue';
import VueMarkdown, { useSmoothStream as useVueSmooth, type AIMarkdownProps as VueProps } from '@ai-markdown/vue';
const vueProps: VueProps = { content: 'Vue consumer' };
h(VueMarkdown, vueProps); void useVueSmooth;
import AIMarkdown, { AIMarkdownDocuments, createRemendPreprocessor, type AIMarkdownProps } from '@ai-markdown/react';
import MantineAIMarkdown from '@ai-markdown/react-mantine';
import { createPipelineSession, createSmoothCoordinator, createContributionSession } from '@ai-markdown/core';
import { createRegistry } from '@ai-markdown/engine';
import { CodeLanguage, StreamingLanguageDetector, detectLanguage, toHighlightJsLanguage, type LanguageDetectionResult } from '@ai-markdown/code-language-detector';
const detected: LanguageDetectionResult = new StreamingLanguageDetector().finalize('x');
const language: CodeLanguage | null = detected.language ?? detectLanguage('x').language;
if (language) toHighlightJsLanguage(language);
import * as plugins from '@ai-markdown/react/plugins';
const props: AIMarkdownProps = { content: 'Example[^x].\\n\\n[^x]: Footnote', contentPreprocessors: [createRemendPreprocessor()], documentId: 'doc' };
createElement(AIMarkdownDocuments, {}, createElement(AIMarkdown, props));
createElement(MantineAIMarkdown, props);
createPipelineSession(); createContributionSession(); void plugins;
const registry = createRegistry();
registry.registerChunk('chunk', new Set(), new Set());
// @ts-expect-error private registry implementation is not an adapter contract
registry._subscribers;
// @ts-expect-error private coordinator implementation is not an adapter contract
createSmoothCoordinator()._refcounts;
`;
const componentsTypes = `
import { MarkdownCodeBlock as Code, MarkdownImage as Image, MarkdownTable as Table, createMarkdownCodeBlock, type CodeRendererInput } from '@ai-markdown/react/components';
createElement(AIMarkdown, { content: '', customComponents: { pre: Code, img: Image, table: Table } });
const CustomCode = createMarkdownCodeBlock({ renderers: { mermaid: false, custom: (props: CodeRendererInput) => createElement('span', {}, props.code) } });
createElement(AIMarkdown, { content: '', customComponents: { pre: CustomCode } });
import { MarkdownCodeBlock as VueCode, MarkdownImage as VueImage, MarkdownTable as VueTable } from '@ai-markdown/vue/components';
h(VueMarkdown, { content: '', components: { pre: VueCode, img: VueImage, table: VueTable } });
import { MarkdownCodeBlock as MantineCode } from '@ai-markdown/react-mantine/components';
createElement(MantineAIMarkdown, { content: '', customComponents: { pre: MantineCode } });
`;
for (const ext of ['mts', 'cts']) {
  writeFileSync(join(out, `consumer.${ext}`), types + (hasComponents ? componentsTypes : ''));
  execFileSync(
    process.execPath,
    [
      join(out, 'node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      'false',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--target',
      'ES2022',
      `consumer.${ext}`,
    ],
    { cwd: out, stdio: 'pipe', encoding: 'utf8' }
  );
}
// Exercise the documented lower bound with the actual packed adapter too.
execFileSync(
  'npm',
  ['install', '--ignore-scripts', '--no-audit', '--no-fund', 'vue@3.5.0', '@vue/server-renderer@3.5.0'],
  { cwd: out, stdio: 'pipe', encoding: 'utf8' }
);
for (const conditions of [[], ['--conditions=development']])
  execFileSync(process.execPath, [...conditions, 'probe.mjs'], { cwd: out, stdio: 'pipe', encoding: 'utf8' });
for (const ext of ['mts', 'cts'])
  execFileSync(
    process.execPath,
    [
      join(out, 'node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      'false',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--target',
      'ES2022',
      `consumer.${ext}`,
    ],
    { cwd: out, stdio: 'pipe', encoding: 'utf8' }
  );
for (const dir of ['engine', 'core']) {
  const dist = join(out, 'node_modules/@ai-markdown', dir, 'dist');
  for (const file of readdirSync(dist).filter((name) => /\.d\.(ts|cts)$/.test(name))) {
    assert(
      !/RegistryInternal|SmoothCoordinatorInternal|_refcounts|_reactIdMap/.test(readFileSync(join(dist, file), 'utf8')),
      `${dir}/${file}: private type leaked`
    );
  }
}
console.log(`Packed ESM/CJS, development, SSR, CSS, plugin, TypeScript and Vue 3.5.0 consumers passed: ${out}`);

if (process.argv.includes('--browser')) {
  assert(hasComponents, 'Component browser verification requires component exports');
  execFileSync(process.execPath, [join(root, 'scripts/test-rich-components.mjs'), out], {
    cwd: root,
    stdio: 'inherit',
  });
}

if (hasComponents)
  execFileSync(process.execPath, [join(root, 'scripts/check-component-bundles.mjs'), out], {
    cwd: root,
    stdio: 'inherit',
  });

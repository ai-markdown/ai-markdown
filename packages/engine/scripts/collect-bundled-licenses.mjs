/* global console */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Source maps identify the actual packages included in either format. Keep
// third-party notices next to the bundles, including licenses omitted by
// upstream workspace tarballs (vendored verbatim from their repositories).
const packages = new Map();
for (const mapFile of readdirSync('dist').filter((name) => /\.(?:js|cjs)\.map$/.test(name))) {
  for (const source of JSON.parse(readFileSync(`dist/${mapFile}`, 'utf8')).sources) {
    const file = resolve('dist', source);
    if (!file.includes('/node_modules/')) continue;
    // The nearest manifest can be a nameless module-type marker inside a
    // package's build output (`dist/esm/package.json`); the package root is
    // the nearest one that carries a name.
    let root = dirname(file);
    let pkg;
    for (; dirname(root) !== root; root = dirname(root)) {
      if (!existsSync(`${root}/package.json`)) continue;
      pkg = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'));
      if (pkg.name) break;
    }
    if (!pkg?.name || !root.includes('/node_modules/'))
      throw new Error(`Cannot identify bundled dependency: ${source}`);
    packages.set(`${pkg.name}@${pkg.version}`, { root, pkg });
  }
}
const fallback = {
  'remark-math': 'remark-math',
  'rehype-katex': 'remark-math',
  retext: 'retext',
  'retext-latin': 'retext',
  'retext-stringify': 'retext',
};
// Code ported into the engine's own source tree rather than bundled from
// node_modules. Source maps cannot identify it, so it is listed here and its
// notice ships with the bundles like any other third-party license.
const vendored = [
  {
    name: 'react-markdown',
    license: 'MIT',
    notice: 'react-markdown',
    files: [
      'src/components/markdown/transform.ts',
      'src/components/markdown/processor.ts',
      'src/components/markdown/types.ts',
    ],
  },
];
const sections = ['Third-party code bundled in @ai-markdown/engine.\nThe engine project itself remains MIT licensed.'];
for (const [name, { root, pkg }] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  const files = readdirSync(root, { withFileTypes: true })
    .filter((file) => file.isFile() && /^(licen[cs]e|copying|notice)/i.test(file.name))
    .map((file) => file.name)
    .sort();
  let text;
  if (files.length) text = files.map((file) => readFileSync(`${root}/${file}`, 'utf8')).join('\n\n');
  else if (fallback[pkg.name]) text = readFileSync(`licenses/${fallback[pkg.name]}.txt`, 'utf8');
  else throw new Error(`Missing bundled dependency license: ${name}`);
  sections.push(`${name} (${pkg.license ?? 'see license below'})\n\n${text.trim()}`);
}
for (const { name, license, notice, files } of vendored) {
  const missing = files.filter((file) => !existsSync(file));
  if (missing.length) throw new Error(`Vendored ${name} files no longer exist: ${missing.join(', ')}`);
  const text = readFileSync(`licenses/${notice}.txt`, 'utf8');
  sections.push(`${name} (${license}), ported into ${files.join(', ')}\n\n${text.trim()}`);
}
writeFileSync('dist/THIRD_PARTY_LICENSES.txt', sections.join('\n\n' + '='.repeat(72) + '\n\n') + '\n');
console.log(`Bundled license notices: ${packages.size} dependencies`);

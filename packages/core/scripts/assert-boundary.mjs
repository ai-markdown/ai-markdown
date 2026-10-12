/* global console */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import ts from 'typescript';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (pkg.private || pkg.name !== '@ai-markdown/core') throw new Error('Shared core must be public.');
const allowed = new Set([
  '@ai-markdown/code-language-detector',
  '@ai-markdown/engine',
  '@types/hast',
  '@types/mdast',
  'unist-util-visit',
]);
for (const name of Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies })) {
  if (!allowed.has(name)) throw new Error(`Unreviewed runtime dependency: ${name}`);
}
// Source imports, including type-only imports, cannot bypass the package
// boundary through a relative core path or an undeclared framework package.
const sourceRoot = resolve('src');
for (const file of readdirSync('src', { recursive: true }).map(String)) {
  if (!file.endsWith('.ts') || /\.(test|spec)\.ts$/.test(file)) continue;
  const path = resolve('src', file);
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const check = (node) => {
    const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier;
    if (specifier && ts.isStringLiteral(specifier)) {
      const name = specifier.text;
      if (name.startsWith('.')) {
        if (!resolve(path, '..', name).startsWith(sourceRoot + sep))
          throw new Error(`${file}: escaped source boundary`);
      } else if (
        !['@ai-markdown/code-language-detector', '@ai-markdown/engine', 'unist-util-visit', 'hast', 'mdast'].includes(
          name
        )
      ) {
        throw new Error(`${file}: forbidden import ${name}`);
      }
    }
    ts.forEachChild(node, check);
  };
  check(source);
}
for (const file of readdirSync('dist')
  .map(String)
  .filter((f) => /\.(js|cjs)$/.test(f))) {
  if (readFileSync(`dist/${file}`, 'utf8').includes('process.env')) {
    throw new Error(`${file}: runtime build did not fold environment gates`);
  }
}
console.log('core boundary: public, framework-free source; environment gates folded');

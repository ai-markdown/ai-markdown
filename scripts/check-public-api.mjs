/* global process, console */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import ts from 'typescript';
import { dirname, resolve, relative } from 'node:path';
const update = process.argv.includes('--update');
mkdirSync('tooling/api-reports', { recursive: true });
const surfaces = [
  { name: 'engine', directory: 'engine', entry: 'src/index.ts', shared: true },
  { name: 'core', directory: 'core', entry: 'src/index.ts', shared: true },
  { name: 'code-language-detector', directory: 'code-language-detector', entry: 'src/index.ts', shared: true },
  { name: 'react', directory: 'react', entry: 'src/index.tsx' },
  { name: 'react-plugins', directory: 'react', entry: 'src/plugins/index.ts', declaration: 'dist/plugins/index.d.ts' },
  { name: 'react-mantine', directory: 'react-mantine', entry: 'src/index.tsx' },
  { name: 'vue', directory: 'vue', entry: 'src/index.ts' },
  {
    name: 'core-components',
    directory: 'core',
    entry: 'src/components/index.ts',
    declaration: 'dist/components/index.d.ts',
    shared: true,
  },
  {
    name: 'react-components',
    directory: 'react',
    entry: 'src/rich/index.ts',
    declaration: 'dist/components/index.d.ts',
  },
  { name: 'vue-components', directory: 'vue', entry: 'src/rich/index.ts', declaration: 'dist/components/index.d.ts' },
  {
    name: 'mantine-components',
    directory: 'react-mantine',
    entry: 'src/components.tsx',
    declaration: 'dist/components.d.ts',
  },
  ...['react', 'vue'].flatMap((directory) =>
    ['code/plain', 'image', 'table'].map((subpath) => ({
      name: `${directory}-component-${subpath.replace('/', '-')}`,
      directory,
      entry: `src/rich/${subpath === 'code/plain' ? 'code-plain' : subpath}.${directory === 'react' ? 'tsx' : 'ts'}`,
      declaration: `dist/components/${subpath}.d.ts`,
    }))
  ),
];
// Multi-entry builds may move public types into relative declaration chunks.
// Snapshot the reachable declarations, not just the entry's re-export names.
function declarationSurface(root, entry) {
  const seen = new Set();
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
  const stableNames = (text) => text.replace(/-[A-Za-z0-9_-]{8}(?=\.(?:d\.)?(?:js|ts)\b)/g, '-chunk');
  function visit(file, initial = false) {
    if (seen.has(file)) return '';
    seen.add(file);
    const declaration = readFileSync(file, 'utf8');
    const ast = ts.createSourceFile(file, declaration, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let text =
      (initial ? '' : `\n// Relative declaration: ${stableNames(relative(root, file))}\n`) +
      stableNames(printer.printFile(ast));
    for (const statement of ast.statements) {
      if (
        (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) ||
        !statement.moduleSpecifier ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      )
        continue;
      const specifier = statement.moduleSpecifier.text;
      if (specifier.startsWith('.')) text += visit(resolve(dirname(file), specifier.replace(/\.js$/, '.d.ts')));
    }
    return text;
  }
  return visit(resolve(root, entry), true);
}
for (const { name, directory, entry, shared, declaration: declarationPath = 'dist/index.d.ts' } of surfaces) {
  const printed = declarationSurface(resolve(`packages/${directory}`), declarationPath);
  const snapshot = `// Generated from the built public declaration. Review changes before updating.\n${printed}`;
  const file = `tooling/api-reports/${name}.api.txt`;
  assert(
    !/RegistryInternal|SmoothCoordinatorInternal|_refcounts|_subscribers|node_modules\//.test(snapshot),
    `${name}: implementation storage or local path in public declarations`
  );
  if (shared) assert(!/from ['"](?:vue|react|react-dom)['"]/.test(snapshot), `${name}: framework dependency`);
  const source = readFileSync(`packages/${directory}/${entry}`, 'utf8');
  assert(!/export\s+(?:type\s+)?\*\s+from/.test(source), `${name}: public entry requires explicit exports`);
  if (update) writeFileSync(file, snapshot);
  else
    assert.equal(readFileSync(file, 'utf8'), snapshot, `${name}: public declaration changed; review and run --update`);
  console.log(`${name}: public API ${update ? 'snapshot written' : 'verified'}`);
}

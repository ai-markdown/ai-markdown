/* global process, console */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import ts from 'typescript';
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
];
for (const { name, directory, entry, shared, declaration: declarationPath = 'dist/index.d.ts' } of surfaces) {
  const declaration = readFileSync(`packages/${directory}/${declarationPath}`, 'utf8');
  const ast = ts.createSourceFile(`${name}.d.ts`, declaration, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const printed = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed }).printFile(ast);
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

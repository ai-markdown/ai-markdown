import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { frameworkAliases } from './framework-aliases.mjs';

test('baseline libraries and candidate harness share the baseline framework, including subpaths', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'sentinel-framework-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const revision of ['baseline', 'candidate']) {
    const dir = join(root, revision);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{}');
    for (const framework of ['react', 'react-dom', 'vue']) {
      const pkg = join(dir, 'node_modules', framework);
      mkdirSync(pkg, { recursive: true });
      writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: framework, main: 'index.js' }));
      writeFileSync(join(pkg, 'index.js'), `export const instance = { revision: '${revision}' };`);
      writeFileSync(join(pkg, 'client.js'), 'export { instance } from "./index.js";');
    }
  }
  for (const adapter of ['react', 'vue']) {
    const extra = adapter === 'react' ? `import {instance as client} from 'react-dom/client';` : '';
    const exports = adapter === 'react' ? ', client' : '';
    writeFileSync(
      join(root, 'baseline', 'library.js'),
      `import {instance} from '${adapter}'; ${extra} export {instance${exports}};`
    );
    const result = await build({
      stdin: {
        contents: `import {instance as harness} from '${adapter}'; import {instance as library${exports}} from '../baseline/library.js'; export const result = [harness === library, library.revision${adapter === 'react' ? ', client.revision' : ''}];`,
        resolveDir: join(root, 'candidate'),
      },
      bundle: true,
      write: false,
      format: 'esm',
      alias: frameworkAliases(join(root, 'baseline'), adapter),
    });
    const { result: actual } = await import(
      `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
    );
    assert.deepEqual(actual, adapter === 'react' ? [true, 'baseline', 'baseline'] : [true, 'baseline']);
  }
});

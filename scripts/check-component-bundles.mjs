/* global process, console */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const consumer = resolve(process.argv[2]);
const mermaid = join(consumer, 'node_modules/mermaid');
const unavailable = join(consumer, 'node_modules/.mermaid-disabled');
const installed = existsSync(mermaid);
if (installed) renameSync(mermaid, unavailable);
try {
  for (const framework of ['react', 'vue']) {
    const manifest = JSON.parse(
      readFileSync(join(consumer, `node_modules/@ai-markdown/${framework}/package.json`), 'utf8')
    );
    const suffixes = ['', '/components/code/plain', '/components/image', '/components/table'];
    for (const suffix of ['/components/diagram', '/components/code/independent']) {
      if (manifest.exports?.[`.${suffix}`]) suffixes.push(suffix);
    }
    for (const suffix of suffixes) {
      const entry = `@ai-markdown/${framework}${suffix}`;
      const result = await build({
        stdin: { contents: `import * as component from '${entry}'; console.log(component);`, resolveDir: consumer },
        bundle: true,
        write: false,
        platform: 'browser',
        format: 'esm',
        metafile: true,
        logLevel: 'silent',
      });
      assert(
        !Object.keys(result.metafile.inputs).some((path) => /(?:mermaid|react-mantine)/.test(path)),
        `${entry}: unwanted diagram/skin dependency`
      );
    }
    await assert.rejects(
      build({
        stdin: {
          contents: `import { MarkdownCodeBlock } from '@ai-markdown/${framework}/components/code'; console.log(MarkdownCodeBlock);`,
          resolveDir: consumer,
        },
        bundle: true,
        write: false,
        platform: 'browser',
        format: 'esm',
        logLevel: 'silent',
      }),
      /mermaid/,
      'default code needs the documented optional peer'
    );
  }
  const mantineManifest = JSON.parse(
    readFileSync(join(consumer, 'node_modules/@ai-markdown/react-mantine/package.json'), 'utf8')
  );
  for (const suffix of ['/components/code/independent', '/independent']) {
    if (!mantineManifest.exports?.[`.${suffix}`]) continue;
    const entry = `@ai-markdown/react-mantine${suffix}`;
    const result = await build({
      stdin: { contents: `import * as component from '${entry}'; console.log(component);`, resolveDir: consumer },
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'esm',
      metafile: true,
      outfile: join(consumer, 'component-bundle.js'),
      logLevel: 'silent',
    });
    assert(
      !Object.keys(result.metafile.inputs).some((path) => /node_modules\/mermaid\//.test(path)),
      `${entry}: unwanted Mermaid dependency`
    );
  }
  console.log(
    'Component bundles: base/plain/image/table and available independent entries resolve without Mermaid; default code requires the documented peer.'
  );
} finally {
  if (installed) renameSync(unavailable, mermaid);
}

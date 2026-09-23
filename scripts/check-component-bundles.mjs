/* global process, console */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('tsup'))('esbuild');
const consumer = resolve(process.argv[2]);
const mermaid = join(consumer, 'node_modules/mermaid');
const unavailable = join(consumer, 'node_modules/.mermaid-disabled');
renameSync(mermaid, unavailable);
try {
  for (const framework of ['react', 'vue']) {
    for (const suffix of ['', '/components/code/plain', '/components/image', '/components/table']) {
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
  console.log(
    'Component bundles: base/plain/image/table resolve without Mermaid; default code requires the documented peer.'
  );
} finally {
  renameSync(unavailable, mermaid);
}

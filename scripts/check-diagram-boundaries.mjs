/* global console */
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const entries = [
  'react/dist/components/diagram.js',
  'react/dist/components/code/independent.js',
  'vue/dist/components/diagram.js',
  'vue/dist/components/code/independent.js',
  'react-mantine/dist/components/code/independent.js',
  'react-mantine/dist/independent.js',
];
for (const entry of entries) {
  const result = await build({
    entryPoints: [`packages/${entry}`],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'esm',
    plugins: [
      {
        name: 'diagram-dependency-boundary',
        setup(builder) {
          builder.onResolve({ filter: /^[^./]/ }, (args) => {
            if (args.path === 'mermaid' || args.path === 'pele' || args.path.startsWith('ondine'))
              throw new Error(`${entry} imports optional engine ${args.path}`);
            if (!/^@ai-markdown\/(core|react|vue|react-mantine)(\/|$)/.test(args.path))
              return { path: args.path, external: true };
          });
        },
      },
    ],
  });
  assert(result.outputFiles.length > 0);
  console.log(`${entry}: no optional engine imports`);
}

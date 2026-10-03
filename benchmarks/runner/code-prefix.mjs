/** Source-level microbenchmark; no DOM or end-to-end speed claim. */
import { createRequire } from 'node:module';
import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('tsup'))('esbuild');
const { outputFiles } = await build({
  entryPoints: ['packages/react-mantine/src/components/customized/jsonCompleteness.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});
const { createJsonCompletenessScanner } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);
const median = (samples) => [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)];
for (const chars of [50000, 100000, 200000]) {
  const samples = [];
  for (let repeat = 0; repeat < 4; repeat++) {
    let source = '["';
    const scan = createJsonCompletenessScanner();
    const start = performance.now();
    for (let length = 0; length < chars; length += 4) {
      source += 'abcd';
      scan(source);
    }
    if (!scan(source + '"]')) throw new Error('complete JSON was not detected');
    if (repeat > 0) samples.push(performance.now() - start);
  }
  console.log(JSON.stringify({ node: process.version, chars, step: 4, medianMs: median(samples), samples }));
}

/** Run after building core: node scripts/bench-pierre-highlight.mjs [lineCount] */
import process from 'node:process';
import console from 'node:console';
import { URL } from 'node:url';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { createPierreHighlightAdapter } from '../packages/core/dist/components/index.js';
const require = createRequire(new URL('../tooling/storybook-kit/package.json', import.meta.url));
const runtime = await import(require.resolve('@pierre/highlights'));
const { default: theme } = await import(require.resolve('@pierre/highlights/themes/github-light-high-contrast'));
const lineCount = Number(process.argv[2] ?? 600);
if (!Number.isInteger(lineCount) || lineCount < 1) throw new Error('lineCount must be a positive integer');
const source = Array.from({ length: lineCount }, (_, i) => `export const value${i}: string = "中文 😀 ${i}";\n`).join(
  ''
);
const frames = [];
for (let end = 40; end < source.length; end += 40) frames.push(source.slice(0, end) + '\n');
frames.push(source + '\n');
let instances = 0;
class MeasuredLiveTokenizer extends runtime.LiveTokenizer {
  constructor(options) {
    super(options);
    instances++;
  }
}
const adapter = createPierreHighlightAdapter({
  load: async () => ({ ...runtime, LiveTokenizer: MeasuredLiveTokenizer, themes: { light: theme, dark: theme } }),
});
await adapter.prepare({ code: '', language: 'typescript', colorScheme: 'light', streaming: true });
function run(incremental) {
  const backend = incremental ? adapter.createSession() : adapter;
  let result;
  instances = 0;
  const start = performance.now();
  try {
    for (const code of frames)
      result = backend.highlight({ code, language: 'typescript', colorScheme: 'light', streaming: true });
    const elapsed = performance.now() - start;
    if (result.tokens.map((token) => token.text).join('') !== source + '\n') throw new Error('Source mismatch');
    if (incremental && instances !== 1) throw new Error(`Expected one incremental instance, got ${instances}`);
    return elapsed;
  } finally {
    if (incremental) backend.dispose();
  }
}
run(false);
run(true); // Warm both paths; medians reduce GC/order noise.
const full = [],
  incremental = [];
for (let i = 0; i < 5; i++) {
  if (i % 2) {
    incremental.push(run(true));
    full.push(run(false));
  } else {
    full.push(run(false));
    incremental.push(run(true));
  }
}
const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
console.log(
  JSON.stringify(
    {
      workload: 'Markdown frames including HAST synthetic trailing newline',
      incrementalInstancesPerRun: 1,
      lines: lineCount,
      frames: frames.length,
      utf16Length: source.length,
      fullFrameMs: +median(full).toFixed(2),
      incrementalMs: +median(incremental).toFixed(2),
      speedup: +(median(full) / median(incremental)).toFixed(2),
      scope: 'Tokenization and token conversion, including initialization; excludes framework/DOM rendering.',
    },
    null,
    2
  )
);

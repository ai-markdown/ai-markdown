/**
 * Per-frame fixed cost of a splice must not grow with the number of frozen
 * blocks. Before the splice cache (2026-09-15) every splice frame re-walked
 * the whole frozen prefix — prefix cut, hast attribution, html-value
 * guards, alignment loop, newline count, injection-plan ordering scan —
 * and appending one token to a 64,000-paragraph document cost 28.8 ms
 * (node 24, 1,000 paragraphs: 1.2 ms; 8,000: 2.0 ms) while the tail parse
 * itself took under 0.5 ms. With the cache the same frame measured 4.6 ms
 * (1,000: 0.54 ms; 8,000: 0.67 ms), the remainder being the array copies
 * that build the fresh roots and the append check on a 1.4 MB string.
 *
 * The bound is 4x the cached measurement under vitest (4.8 ms), rounded up
 * — loose enough for a CI runner half as fast, and still under the uncached
 * cost on the measuring machine, so a return of any prefix-wide walk fails
 * it. Timing assertion, so it reports the measurement on failure and
 * writes it to stdout on success (the package's console interception drops
 * passing tests' console output).
 */
import { expect, test } from 'vitest';

import { advanceIncrementalParse } from './advanceIncrementalParse';
import { buildAdvanceOptions, CATALOG } from './testPluginCatalog';

const BLOCKS = 64_000;
const FRAMES = 20;
const BOUND_MS = 20;

test('appending a token to a 64,000-block document splices in bounded time', () => {
  let doc = '';
  for (let i = 0; i < BLOCKS; i++) doc += `para ${i} text here.\n\n`;
  doc += 'tail paragraph';
  const options = buildAdvanceOptions(CATALOG[0]);
  let state = advanceIncrementalParse(null, doc, options).nextState;
  // First append pays the one-time plan walk and builds the cache.
  doc += ' warm';
  state = advanceIncrementalParse(state, doc, options).nextState;

  const samples: number[] = [];
  for (let k = 0; k < FRAMES; k++) {
    doc += ` word${k}`;
    const t = performance.now();
    const result = advanceIncrementalParse(state, doc, options);
    samples.push(performance.now() - t);
    expect(result.usedIncremental, `frame ${k} spliced`).toBe(true);
    state = result.nextState;
  }
  samples.sort((a, b) => a - b);
  const median = samples[samples.length >> 1];
  // Test-only stdout access; the package's ambient `process` shim types only `env`.
  (process as unknown as { stdout?: { write(text: string): void } }).stdout?.write(
    `[splice cache] ${BLOCKS} blocks: median ${median.toFixed(2)} ms per appended token\n`
  );
  expect(median, `median per-frame splice cost at ${BLOCKS} blocks (ms)`).toBeLessThan(BOUND_MS);
}, 120_000);

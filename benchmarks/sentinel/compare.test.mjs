import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare } from './compare.mjs';
const samples = (values) => values.map((workMs) => ({ workMs }));
test('detects a consistent slowdown, tolerates noise, and refuses incomplete evidence', () => {
  const baseline = samples([99, 100, 100, 101, 99, 101]);
  assert.equal(compare(baseline, samples([149, 150, 151, 149, 150, 151])).regression, true);
  assert.equal(compare(baseline, samples([110, 99, 108, 101, 102, 98])).regression, false);
  assert.equal(compare(baseline, samples([110, 130, 150, 170, 190, 220])).regression, false);
  assert.equal(compare(baseline, samples([110, 130, 150, 170, 190, 220])).inconclusive, true);
  assert.throws(() => compare(baseline, samples([200])), /Incomplete/);
  assert.throws(() => compare(baseline, samples([100, 100, 100, 100, 100, 100, 100])), /Incomplete/);
  assert.throws(() => compare(baseline, samples([200, 200, NaN, 200, 200, 200])), /Incomplete/);
});

test('heap policy detects retained growth and respects its absolute floor', () => {
  const heap = (n) => Array.from({ length: 6 }, () => ({ heapBytes: n }));
  assert.equal(compare(heap(4e6), heap(7e6), 'heapBytes').regression, true);
  assert.equal(compare(heap(1e6), heap(1.6e6), 'heapBytes').regression, false);
});

import { expect, test } from 'vitest';
import { resolveCodeBlockPolicy } from './codeBlockOptions';
test('factory options override inherited policy; undefined preserves integration defaults', () => {
  expect(
    resolveCodeBlockPolicy(
      { formatJson: false, highlightIntervalMs: undefined },
      { formatJson: true, highlightIntervalMs: 75 },
      { defaultExpanded: false, expandNestedJson: true }
    )
  ).toEqual({
    defaultExpanded: false,
    autoDetectUnknownLanguage: true,
    formatJson: false,
    expandNestedJson: true,
    highlightIntervalMs: 75,
  });
});
test('invalid timing falls back to integration defaults; zero disables coalescing', () => {
  for (const highlightIntervalMs of [-1, Infinity, NaN])
    expect(
      resolveCodeBlockPolicy({ highlightIntervalMs }, undefined, { highlightIntervalMs: 80 }).highlightIntervalMs
    ).toBe(80);
  expect(resolveCodeBlockPolicy({ highlightIntervalMs: 0 }).highlightIntervalMs).toBe(0);
});

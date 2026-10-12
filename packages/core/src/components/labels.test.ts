import { expect, test } from 'vitest';
import { defaultCodeBlockLabels, defaultImageLabels, defaultTableLabels, resolveLabels } from './labels';
import { imageActionNames } from './image';
import type { TableExportReason } from './labels';

test('an override replaces only the entries it names; undefined keeps the default', () => {
  expect(resolveLabels(defaultCodeBlockLabels)).toBe(defaultCodeBlockLabels);
  const labels = resolveLabels(defaultCodeBlockLabels, { copy: '复制代码', copied: undefined });
  expect(labels.copy).toBe('复制代码');
  expect(labels.copied).toBe('Copied');
  expect(labels.expand).toBe('Expand');
  // The defaults are shared and frozen; an override never writes to them.
  expect(defaultCodeBlockLabels.copy).toBe('Copy code');
  expect(Object.isFrozen(defaultCodeBlockLabels)).toBe(true);
});

test('a function is read on every call, so it can follow a language switch', () => {
  let language = 'en';
  const option = () => (language === 'zh' ? { copy: '复制表格' } : {});
  expect(resolveLabels(defaultTableLabels, option).copy).toBe('Copy table');
  language = 'zh';
  expect(resolveLabels(defaultTableLabels, option).copy).toBe('复制表格');
});

test('every toolbar action and every export refusal has a default', () => {
  for (const name of imageActionNames) expect(defaultImageLabels[name]).toBeTruthy();
  const reasons: TableExportReason[] = [
    'mergedCells',
    'notRectangular',
    'unsupportedStructure',
    'unsupportedContent',
    'unavailable',
  ];
  for (const reason of reasons) expect(defaultTableLabels[reason]).toBeTruthy();
  expect(defaultImageLabels.open('')).toBe('Preview image');
  expect(defaultImageLabels.open('a cat')).toBe('Preview image: a cat');
});

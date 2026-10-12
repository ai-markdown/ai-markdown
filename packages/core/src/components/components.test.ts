import { describe, expect, test, vi, afterEach } from 'vitest';
import type { Element } from 'hast';
import { extractCode, projectTable, serializeTable, normalizeRenderers } from './nodes';
const el = (tagName: string, children: Element['children'] = [], properties: Element['properties'] = {}): Element => ({
  type: 'element',
  tagName,
  properties,
  children,
});
const text = (value: string) => ({ type: 'text' as const, value });
afterEach(() => vi.useRealTimers());
describe('component contracts', () => {
  test('strict fence extraction keeps fragmented raw text and rejects extra semantics', () => {
    const node = el('pre', [el('code', [text('a'), text('\nb')], { className: ['language- Mermaid '] })]);
    expect(extractCode(node)).toEqual({ code: 'a\nb', language: 'mermaid' });
    expect(extractCode({ ...node, properties: { id: 'preserve' } })).toBeNull();
    expect(extractCode(el('pre', [el('code', [el('b')])]))).toBeNull();
    expect(extractCode(el('pre', [el('code', [text('x')], { className: ['special'] })]))).toBeNull();
    expect(normalizeRenderers({ ' Mermaid ': false })).toEqual({ mermaid: false });
    expect(() => normalizeRenderers({ Mermaid: false, mermaid: true })).toThrow('Duplicate');
  });
  test('table projection preserves semantic text, empty cells, math once and line breaks', () => {
    const math = el(
      'span',
      [
        el('math', [el('annotation', [text('x^2')], { encoding: 'application/x-tex' })]),
        el('span', [text('visual duplicate')]),
      ],
      { className: ['katex'] }
    );
    const node = el('table', [
      el('tbody', [
        el('tr', [
          el('td', [el('a', [text('Label')]), el('br'), el('img', [], { alt: 'image' })]),
          el('td', [math]),
          el('td'),
        ]),
      ]),
    ]);
    expect(projectTable(node)).toEqual({ rows: [['Label\nimage', 'x^2', '']] });
    // A refusal is a code, never a sentence: the component that shows it owns the text.
    expect(projectTable(el('table', [el('tr', [el('td', [], { colSpan: 2 })])]))).toEqual({ reason: 'mergedCells' });
    expect(projectTable(el('table', [el('tr', [el('td')]), el('tr', [el('td'), el('td')])]))).toEqual({
      reason: 'notRectangular',
    });
    expect(projectTable(el('table', [el('caption')]))).toEqual({ reason: 'unsupportedStructure' });
    expect(projectTable(el('table', [{ type: 'comment', value: '' } as never]))).toEqual({
      reason: 'unsupportedContent',
    });
    expect(projectTable(el('div'))).toEqual({ reason: 'unavailable' });
    expect(projectTable()).toEqual({ reason: 'unavailable' });
  });
  test('spreadsheet escaping and formula protection are separate', () => {
    expect(serializeTable([['=cmd()', '+SUM(A1)', '@x', '-SUM(A1)', '-1.5e2', 'a,"b', '', 'x\ny']])).toBe(
      '\'=cmd(),\'+SUM(A1),\'@x,\'-SUM(A1),-1.5e2,"a,""b",,"x\ny"'
    );
    expect(serializeTable([['a', 'b\tc', '']], '\t')).toBe('a\t"b\tc"\t');
  });
});
test('image scroll locks are shared and released once per owner', async () => {
  const { lockImagePreviewScroll } = await import('./scroll');
  const body = { style: { overflow: 'auto' } };
  const first = lockImagePreviewScroll(body),
    second = lockImagePreviewScroll(body);
  expect(body.style.overflow).toBe('hidden');
  first();
  first();
  expect(body.style.overflow).toBe('hidden');
  second();
  expect(body.style.overflow).toBe('auto');
});
test('a scroll lock pads the page by the scrollbar it removes, and restores what was there', async () => {
  const { lockImagePreviewScroll } = await import('./scroll');
  const body = { style: { overflow: '', paddingRight: '' } };
  const first = lockImagePreviewScroll(body, 15);
  expect(body.style).toEqual({ overflow: 'hidden', paddingRight: '15px' });
  // A second owner does not pad again.
  const second = lockImagePreviewScroll(body, 15);
  expect(body.style.paddingRight).toBe('15px');
  first();
  expect(body.style.paddingRight).toBe('15px');
  second();
  expect(body.style).toEqual({ overflow: '', paddingRight: '' });
  const padded = { style: { overflow: 'auto', paddingRight: '8px' } };
  const release = lockImagePreviewScroll(padded, 15);
  expect(padded.style.paddingRight).toBe('calc(8px + 15px)');
  release();
  expect(padded.style).toEqual({ overflow: 'auto', paddingRight: '8px' });
  // No scrollbar width: the padding is not touched.
  const plain = { style: { overflow: '', paddingRight: '' } };
  lockImagePreviewScroll(plain)();
  expect(plain.style.paddingRight).toBe('');
});

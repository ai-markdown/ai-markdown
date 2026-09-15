// Attribute mapping of the Vue renderer: hast property names go through
// property-information to the attribute names `h()` receives, so SSR emits
// the same attributes React does for the same markdown. Each SSR case
// renders the markdown through both adapters and compares the attribute
// maps of the element under test; the client cases inspect the VNode props
// `renderTree` builds.
import { describe, it, expect } from 'vitest';
import { createSSRApp, h, type VNode } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactAIMarkdown from '@ai-markdown/react';
import { defaultUrlTransform, sanitizeSchema } from '@ai-markdown/engine';
import type { Root } from 'hast';
import { renderTree } from './render';
import { AIMarkdown, extendSanitizeSchema } from './index';

/** The default schema plus what the raw-HTML cases below need: inline svg,
 * `area` (for `coords`), `srcSet` on images, `style` everywhere and a few
 * global attributes on `div`. */
const broad = extendSanitizeSchema((draft) => {
  draft.tagNames = [...(draft.tagNames ?? []), 'svg', 'path', 'area'];
  draft.attributes = {
    ...draft.attributes,
    svg: ['viewBox', 'width', 'height'],
    path: ['d'],
    img: [...(draft.attributes?.img ?? []), 'srcSet', 'sizes'],
    div: ['className', 'ariaHidden', 'dataFooBar'],
    '*': [...(draft.attributes?.['*'] ?? []), 'style'],
  };
});

const vueSSR = (content: string, extra: Record<string, unknown> = {}) =>
  renderToString(createSSRApp({ render: () => h(AIMarkdown, { content, documentId: 'd', ...extra }) }));
const reactSSR = (content: string, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(ReactAIMarkdown, { content, documentId: 'd', ...extra }));

/** Attributes of the first `<tag>` in `html`, order-independent. HTML
 * attribute names are case-insensitive (React emits `srcSet`, Vue
 * `srcset`), so they are lowercased except inside svg, where case is
 * significant and `viewBox` must survive as such. A bare boolean attribute
 * (Vue) and an empty-valued one (React) are the same thing. `id` carries
 * each adapter's own clobber prefix and is left out. A trailing `;` in a
 * style string is serializer noise. */
function attributes(html: string, tag: string, index = 0): Record<string, string> {
  const match = [...html.matchAll(new RegExp(`<${tag}\\b([^>]*?)\\s*/?>`, 'g'))][index];
  if (!match) throw new Error(`no <${tag}> #${index} in ${html}`);
  const svg = tag === 'svg' || tag === 'path';
  const out: Record<string, string> = {};
  for (const [, name, value] of match[1].matchAll(/([^\s=/"]+)(?:="([^"]*)")?/g)) {
    if (name === 'id') continue;
    out[svg ? name : name.toLowerCase()] = (value ?? '').replace(/;\s*$/, '');
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** Both adapters render `content`; the first `<tag>` must carry the same
 * attributes. Each adapter's root element is a `div`, so a `div` case
 * compares the second one. */
async function same(content: string, tag: string, extra: Record<string, unknown> = {}) {
  const index = tag === 'div' ? 1 : 0;
  const vue = attributes(await vueSSR(content, extra), tag, index);
  const react = attributes(reactSSR(content, extra), tag, index);
  expect(vue).toEqual(react);
  return vue;
}

describe('SSR attribute mapping matches the React adapter', () => {
  it('renders GFM task-list checkboxes as bare boolean attributes', async () => {
    const html = await vueSSR('- [x] done\n- [ ] todo');
    expect(html).toContain('<input type="checkbox" checked disabled>');
    expect(html).toContain('<input type="checkbox" disabled>');
    expect(html).not.toContain('checked="');
    expect(await same('- [x] done', 'input')).toEqual({ checked: '', disabled: '', type: 'checkbox' });
  });
  it('keeps the camelCase viewBox name on an inline svg', async () => {
    const source = '<svg viewBox="0 0 10 10" width="10" height="10"><path d="M0 0"/></svg>';
    const svg = await same(source, 'svg', { sanitizeSchema: broad });
    expect(svg).toEqual({ height: '10', viewBox: '0 0 10 10', width: '10' });
    expect(await same(source, 'path', { sanitizeSchema: broad })).toEqual({ d: 'M0 0' });
    // Case is what is under test: `viewbox` would be a different attribute
    // and a lowercased one is what browsers refuse to honour.
    expect(await vueSSR(source, { sanitizeSchema: broad })).toContain(' viewBox="0 0 10 10"');
  });
  it('drops srcset by default and maps srcSet to srcset when the schema allows it', async () => {
    const source = '<img src="a.png" srcset="a.png 1x, b.png 2x" sizes="100vw" alt="x">';
    const closed = await same(source, 'img');
    expect(closed).toEqual({ alt: 'x', src: 'a.png' });
    expect(await vueSSR(source)).not.toMatch(/srcset/i);
    const open = await same(source, 'img', { sanitizeSchema: broad });
    expect(open).toEqual({ alt: 'x', sizes: '100vw', src: 'a.png', srcset: 'a.png 1x, b.png 2x' });
    expect(await vueSSR(source, { sanitizeSchema: broad })).toContain(' srcset="a.png 1x, b.png 2x"');
  });
  it('joins comma-separated list properties with ", " (accept, coords)', async () => {
    // rehype-sanitize forces `type="checkbox"` on every input; `accept`
    // survives as a global attribute.
    expect(await same('<input type="file" accept=".png,.jpg">', 'input')).toEqual({
      accept: '.png, .jpg',
      disabled: '',
      type: 'checkbox',
    });
    expect(
      await same('<area shape="rect" coords="0,0,10,10" href="https://e.com" alt="a">', 'area', {
        sanitizeSchema: broad,
      })
    ).toEqual({ alt: 'a', coords: '0, 0, 10, 10', shape: 'rect' });
  });
  it('joins space-separated class lists with " "', async () => {
    expect(await same('- [x] done', 'ul')).toEqual({ class: 'contains-task-list' });
    expect(await same('- [x] done', 'li')).toEqual({ class: 'task-list-item' });
    expect(await same('<div class="a b">t</div>', 'div', { sanitizeSchema: broad })).toEqual({ class: 'a b' });
  });
  it('maps aria-* and data-* names back to their hyphenated forms', async () => {
    expect(await same('<img src="a.png" alt="x" aria-label="picture">', 'img')).toEqual({
      alt: 'x',
      'aria-label': 'picture',
      src: 'a.png',
    });
    expect(await same('<div aria-hidden="true" data-foo-bar="baz">t</div>', 'div', { sanitizeSchema: broad })).toEqual({
      'aria-hidden': 'true',
      'data-foo-bar': 'baz',
    });
  });
  it('passes a style string through, lowercases tabIndex and keeps numeric colSpan/rowSpan', async () => {
    expect(await same('<input tabindex="2" style="color: red">', 'input', { sanitizeSchema: broad })).toEqual({
      disabled: '',
      style: 'color:red',
      tabindex: '2',
      type: 'checkbox',
    });
    const table = '<table><tr><td colspan="2" rowspan="3">x</td></tr></table>';
    expect(await same(table, 'td')).toEqual({ colspan: '2', rowspan: '3' });
    expect(await vueSSR(table)).toContain('<td colspan="2" rowspan="3">');
  });
});

describe('client VNode props', () => {
  const options = {
    registry: null,
    sym: null,
    clobberPrefix: 'c-',
    sanitizeSchema,
    urlTransform: defaultUrlTransform,
    components: {},
    slots: {},
    streaming: false,
    metadata: undefined,
  };
  const props = (tree: Root) => {
    const { key: _key, ...rest } = (renderTree(tree, options)[0] as VNode).props!;
    return rest;
  };
  it('keeps booleans and numbers typed and joins list properties by their separator', () => {
    expect(
      props({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'input',
            properties: {
              type: 'checkbox',
              checked: true,
              disabled: true,
              tabIndex: 2,
              accept: ['.png', '.jpg'],
              className: ['a', 'b'],
              ariaLabel: 'pick',
              dataFooBar: 'baz',
              style: 'color: red',
            },
            children: [],
          },
        ],
      })
    ).toEqual({
      type: 'checkbox',
      checked: true,
      disabled: true,
      tabindex: 2,
      accept: '.png, .jpg',
      class: 'a b',
      'aria-label': 'pick',
      'data-foo-bar': 'baz',
      // The string reaches `h()` untouched; `h()` itself normalizes a style
      // string into the object form the patcher works with.
      style: { color: 'red' },
    });
    expect(
      props({
        type: 'root',
        children: [{ type: 'element', tagName: 'td', properties: { colSpan: 2, rowSpan: 3 }, children: [] }],
      })
    ).toEqual({ colspan: 2, rowspan: 3 });
    // property-information keeps `srcSet` as one string (its entries carry
    // spaces of their own), so the value passes through unchanged.
    expect(
      props({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'img',
            properties: { src: 'a.png', srcSet: 'a.png 1x, b.png 2x', sizes: '100vw' },
            children: [],
          },
        ],
      })
    ).toEqual({ src: 'a.png', srcset: 'a.png 1x, b.png 2x', sizes: '100vw' });
  });
  it('uses the svg attribute table inside <svg> and the html one again inside foreignObject', () => {
    const svg = renderTree(
      {
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'svg',
            properties: { viewBox: '0 0 10 10', strokeWidth: '2', className: ['icon'] },
            children: [
              { type: 'element', tagName: 'path', properties: { d: 'M0 0', strokeLinecap: 'round' }, children: [] },
              {
                type: 'element',
                tagName: 'foreignObject',
                properties: {},
                children: [
                  { type: 'element', tagName: 'div', properties: { className: ['x'], tabIndex: 1 }, children: [] },
                ],
              },
            ],
          },
        ],
      },
      options
    )[0] as VNode;
    const { key: _key, ...root } = svg.props!;
    expect(root).toEqual({ viewBox: '0 0 10 10', 'stroke-width': '2', class: 'icon' });
    const [path, foreign] = svg.children as VNode[];
    expect(path.props).toEqual({ d: 'M0 0', 'stroke-linecap': 'round' });
    const [div] = foreign.children as VNode[];
    expect(div.props).toEqual({ class: 'x', tabindex: 1 });
  });
});

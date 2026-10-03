import { describe, expect, test, vi } from 'vitest';
import { createSSRApp, h, type VNode } from 'vue';
import { renderToString } from '@vue/server-renderer';
import type { Root, Element } from 'hast';
import {
  buildCoreRemarkPlugins,
  buildCoreRehypePlugins,
  buildCoreRemarkRehypeOptions,
  defaultUrlTransform,
  createRegistry,
  sanitizeSchema,
} from '@ai-markdown/engine';
import { createPipelineSession, type PipelineFrameOptions } from '@ai-markdown/core';
import { createTreeRenderer, renderTree } from './render';

const options = {
  registry: null,
  sym: null,
  clobberPrefix: 'cache-',
  sanitizeSchema,
  urlTransform: defaultUrlTransform,
  components: {},
  slots: {},
  streaming: true,
  metadata: undefined,
};
const paragraph = (value: string): Element => ({
  type: 'element',
  tagName: 'p',
  properties: {},
  children: [{ type: 'text', value }],
});
const root = (...children: Element[]): Root => ({ type: 'root', children });
const html = (children: ReturnType<typeof renderTree>) =>
  renderToString(createSSRApp({ render: () => h('div', children) }));

describe('default Vue render cache', () => {
  test('keeps raw-node removal and the following positionless keys identical to uncached rendering', async () => {
    const tree: Root = { type: 'root', children: [{ type: 'raw', value: '<b>raw</b>' }, paragraph('safe')] };
    const cached = createTreeRenderer()(tree, options);
    const uncached = renderTree(tree, options);
    expect(cached.length).toBe(uncached.length);
    expect((cached[0] as VNode).key).toBe((uncached[0] as VNode).key);
    expect(await html(cached)).toBe(await html(uncached));
  });

  test('inherited and non-enumerable component overrides retain their render behavior', () => {
    const tree = root(paragraph('text'));
    const Strong = () => h('strong');
    const Em = () => h('em');
    for (const components of [
      Object.create({ p: Strong }),
      Object.defineProperty({}, 'p', { value: Strong, writable: true }),
    ]) {
      const render = createTreeRenderer();
      const context = { ...options, components };
      expect((render(tree, context)[0] as VNode).type).toBe(Strong);
      components.p = Em;
      expect((render(tree, context)[0] as VNode).type).toBe(Em);
    }
  });

  test('a registry publication refreshes a cached reference without changing its HAST', async () => {
    const registry = createRegistry();
    const sym = registry.registerChunk('definition', new Set(), new Set(['X']));
    const publish = (url: string) =>
      registry.contributeChunkData(sym, {
        refs: [],
        defs: new Map(),
        linkDefs: new Map([['X', { identifier: 'X', url }]]),
        ownFootnoteLabels: new Set(),
        ownLinkLabels: new Set(['X']),
      });
    const tree = root({
      type: 'element',
      tagName: 'cross-chunk-link',
      properties: { identifier: 'X', label: 'X' },
      children: [{ type: 'text', value: 'link' }],
    });
    const render = createTreeRenderer();
    const context = { ...options, registry, sym };
    publish('https://example.com/first');
    expect(await html(render(tree, context))).toContain('href="https://example.com/first"');
    publish('https://example.com/second');
    expect(await html(render(tree, context))).toContain('href="https://example.com/second"');
    registry.releaseSymbol('definition');
    await Promise.resolve();
    expect(await html(render(tree, context))).not.toContain('href=');
  });
  test('reuses retained blocks, updates the tail, and evicts removed blocks', async () => {
    const render = createTreeRenderer();
    const first = paragraph('stable'),
      tail = paragraph('tail');
    const before = render(root(first, tail), options);
    const tree = root(first, paragraph('changed'));
    const after = render(tree, options);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(await html(after)).toBe(await html(renderTree(tree, options)));
    render(root(), options);
    expect(render(root(first), options)[0]).not.toBe(before[0]);
  });

  test('invalidates render context and never shares VNodes across instances', () => {
    const render = createTreeRenderer();
    const tree = root(paragraph('stable'));
    const first = render(tree, options)[0];
    expect(createTreeRenderer()(tree, options)[0]).not.toBe(first);
    const second = render(tree, { ...options, streaming: false })[0];
    expect(second).not.toBe(first);
    expect(render(tree, { ...options, streaming: false, clobberPrefix: 'other-' })[0]).not.toBe(second);
  });

  test('custom URL callbacks and slots are executed on every frame, even with stable identities', async () => {
    const render = createTreeRenderer();
    const tree = root({ type: 'element', tagName: 'a', properties: { href: '/original' }, children: [] });
    let destination = '/first';
    const urlTransform = vi.fn(() => destination);
    const custom = { ...options, urlTransform };
    await html(render(tree, custom));
    destination = '/second';
    expect(await html(render(tree, custom))).toContain('/second');
    expect(urlTransform).toHaveBeenCalledTimes(2);
    let label = 'first';
    const slot = vi.fn(() => [h('b', label)]);
    const slotted = { ...options, slots: { a: slot } };
    await html(render(tree, slotted));
    label = 'second';
    expect(await html(render(tree, slotted))).toContain('<b>second</b>');
    expect(slot).toHaveBeenCalledTimes(2);
  });

  test('real incremental frames reuse converted prefixes and match uncached output through rewrites', async () => {
    const session = createPipelineSession();
    const parseOptions: PipelineFrameOptions = {
      content: '',
      targetPhantoms: { missingFootnotes: new Set(), missingLinks: new Set() },
      remarkPlugins: buildCoreRemarkPlugins([]),
      rehypePlugins: buildCoreRehypePlugins(sanitizeSchema, options.clobberPrefix),
      remarkRehypeOptions: buildCoreRemarkRehypeOptions(false),
      preserveForBodyHarvest: false,
      documentId: 'cache',
      provenance: 'test',
      incrementalParse: true,
      defListEnabled: false,
    };
    const render = createTreeRenderer();
    let previous: ReturnType<typeof render> = [];
    let reused = 0;
    const prefix = '# Title\n\n' + 'A **finished** paragraph.\n\n'.repeat(10);
    const sources = Array.from({ length: 20 }, (_, i) => prefix + 'tail '.repeat(i + 1));
    sources.push('Replacement\n\n[link](https://example.com)', '', prefix);
    for (const content of sources) {
      const tree = session.parse({ ...parseOptions, content }).hast;
      const cached = render(tree, options);
      if (previous[0] && cached[0] === previous[0]) reused++;
      expect(await html(cached)).toBe(await html(renderTree(tree, options)));
      previous = cached;
    }
    expect(reused).toBeGreaterThanOrEqual(18);
  });

  test('index keys remain correct when a positionless node moves', () => {
    const render = createTreeRenderer();
    const first = paragraph('first'),
      second = paragraph('second');
    render(root(first, second), options);
    const [moved] = render(root(second), options) as VNode[];
    expect(moved.key).toBe('inline-i0');
  });
});

import {
  sanitizeSchema,
  defaultEnginePlugins,
  extendSanitizeSchema,
  type AIMarkdownEnginePlugin,
  type SanitizeSchema,
} from '@ai-markdown/engine';
import { createRegistry } from '../../engine/src/components/documentRegistry';
import { createRenderer, createSSRApp, defineComponent, h, nextTick, shallowRef } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { useMarkdownChunk, type ChunkInput } from './useMarkdownChunk';
import { AIMarkdown } from './AIMarkdown';
import { AIMarkdownDocuments } from './documents';

/** Pipeline runs per session, in session creation (= chunk setup) order,
 * and block-plan runs in total. The wrappers are transparent; they only
 * count calls. */
const parseCounts: number[] = [];
/** `incrementalParse` of every parse call, in call order. */
const parseModes: boolean[] = [];
let planCount = 0;
vi.mock('@ai-markdown/core', async (importOriginal) => {
  const core = await importOriginal<typeof import('@ai-markdown/core')>();
  return {
    ...core,
    createBlockPlanner: () => {
      const planner = core.createBlockPlanner();
      return (...args: Parameters<typeof planner>) => {
        planCount += 1;
        return planner(...args);
      };
    },
    createPipelineSession: () => {
      const session = core.createPipelineSession();
      const index = parseCounts.push(0) - 1;
      return {
        reset: () => session.reset(),
        parse: (options: Parameters<typeof session.parse>[0]) => {
          parseCounts[index] += 1;
          parseModes.push(options.incrementalParse);
          return session.parse(options);
        },
      };
    },
  };
});

interface HostNode {
  parent: HostNode | null;
  children: HostNode[];
  text: string;
  tag?: string;
  props: Record<string, unknown>;
}
const node = (text = ''): HostNode => ({ parent: null, children: [], text, props: {} });
const host = createRenderer<HostNode, HostNode>({
  createElement: (tag) => ({ ...node(), tag }),
  createText: node,
  createComment: node,
  setText: (n, text) => {
    n.text = text;
  },
  setElementText: (n, text) => {
    n.text = text;
    n.children = [];
  },
  patchProp: (n, key, _prev, next) => {
    n.props[key] = next;
  },
  parentNode: (n) => n.parent,
  nextSibling: (n) => n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
  insert(n, parent, anchor) {
    if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
    n.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : parent.children.length;
    parent.children.splice(index, 0, n);
  },
  remove(n) {
    if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
    n.parent = null;
  },
});
const anchors = (n: HostNode): HostNode[] => [...(n.tag === 'a' ? [n] : []), ...n.children.flatMap(anchors)];
async function settle() {
  for (let i = 0; i < 8; i++) {
    await nextTick();
    await Promise.resolve();
  }
}

test('Vue post-commit publication coordinates two chunks, updates definitions and releases switched documents', async () => {
  const first = createRegistry();
  const second = createRegistry();
  const inputs = shallowRef<ChunkInput[]>([
    {
      content: 'Claim[^n] and [site][u].',
      documentId: 'doc',
      registry: first,
      preserveOrphanReferences: false,
      incrementalParse: true,
      clobberPrefix: 'doc-',
      enginePlugins: [],
      sanitizeSchema,
    },
    {
      content: '[^n]: Shared **body**\n\n[u]: https://example.com',
      documentId: 'doc',
      registry: first,
      preserveOrphanReferences: false,
      incrementalParse: true,
      clobberPrefix: 'doc-',
      enginePlugins: [],
      sanitizeSchema,
    },
  ]);
  const chunks: ReturnType<typeof useMarkdownChunk>[] = [];
  const Probe = defineComponent({
    props: { index: { type: Number, required: true } },
    setup(props) {
      const chunk = useMarkdownChunk(() => inputs.value[props.index]);
      chunks[props.index] = chunk;
      // Preparation during setup must neither register nor publish.
      void chunk.prepared.value;
      expect(first.chunkOrder).toHaveLength(0);
      return () => h('output', JSON.stringify([chunk.prepared.value.trees.hast, chunk.aggregate.value]));
    },
  });
  const app = host.createApp({ render: () => h('main', [h(Probe, { index: 0 }), h(Probe, { index: 1 })]) });
  try {
    app.mount(node());
    await settle();
    expect(first.chunkOrder).toHaveLength(2);
    expect(first.globalNumber('N')).toBe(1);
    expect(first.resolveLinkDef('U')?.url).toBe('https://example.com');
    expect(JSON.stringify(chunks[1].aggregate.value)).toContain('Shared ');
    expect(chunks[0].prepared.value.targets.missingFootnotes.has('N')).toBe(true);
    const unchangedTrees = chunks[0].prepared.value.trees;
    inputs.value = inputs.value.map((input, i) =>
      i === 1 ? { ...input, content: '[^n]: Changed body\n\n[u]: https://example.org' } : input
    );
    await settle();
    expect(first.resolveLinkDef('U')?.url).toBe('https://example.org');
    expect(JSON.stringify(chunks[1].aggregate.value)).toContain('Changed body');
    expect(chunks[0].prepared.value.trees.mdast).toBe(unchangedTrees.mdast);
    inputs.value = inputs.value.map((input) => ({ ...input, documentId: 'other', registry: second }));
    await settle();
    expect(first.chunkData.size).toBe(0);
    expect(second.chunkOrder).toHaveLength(2);
    expect(second.globalNumber('N')).toBe(1);
    for (const chunk of chunks) expect(chunk.prepared.value.registry).toBe(second);
  } finally {
    app.unmount();
  }
  await settle();
  expect(second.chunkData.size).toBe(0);
  expect(first._subscribers.size).toBe(0);
  expect(second._subscribers.size).toBe(0);
});

test('Vue SSR prepares local footnotes without publishing or allocating a chunk', async () => {
  const registry = createRegistry();
  const App = defineComponent({
    setup() {
      const chunk = useMarkdownChunk(() => ({
        content: 'Claim[^n].\n\n[^n]: Local body',
        documentId: 'ssr',
        registry,
        preserveOrphanReferences: true,
        incrementalParse: false,
        clobberPrefix: 'ssr-',
        enginePlugins: [],
        sanitizeSchema,
      }));
      return () => h('pre', JSON.stringify(chunk.prepared.value.trees.hast));
    },
  });
  const html = await renderToString(createSSRApp(App));
  expect(html).toContain('Local body');
  expect(html).toContain('dataFootnotes');
  expect(registry.chunkOrder).toHaveLength(0);
  expect(registry.chunkData.size).toBe(0);
  expect(registry._subscribers.size).toBe(0);
});

test('standalone chunks skip the definition-label scan until a registry is supplied', async () => {
  const registry = createRegistry();
  const input = shallowRef<ChunkInput>({
    content: 'Claim[^n] and [site][u].\n\n[^n]: body\n\n[u]: https://example.com',
    documentId: 'doc',
    registry: null,
    preserveOrphanReferences: false,
    incrementalParse: true,
    clobberPrefix: 'doc-',
    enginePlugins: [],
    sanitizeSchema,
  });
  let chunk!: ReturnType<typeof useMarkdownChunk>;
  const Probe = defineComponent({
    setup() {
      chunk = useMarkdownChunk(() => input.value);
      return () => h('pre', JSON.stringify(chunk.prepared.value.trees.hast));
    },
  });
  const app = host.createApp({ render: () => h(Probe) });
  try {
    app.mount(node());
    await settle();
    // Nobody reads the labels without a registry, so the second parse that
    // produces them is skipped and the frame carries stable empty sets.
    expect(chunk.prepared.value.ownLabels.footnoteLabels.size).toBe(0);
    expect(chunk.prepared.value.ownLabels.linkLabels.size).toBe(0);
    expect(JSON.stringify(chunk.prepared.value.trees.hast)).toContain('body');
    const standaloneLabels = chunk.prepared.value.ownLabels;
    input.value = { ...input.value, content: input.value.content + '\n\nMore prose.' };
    await settle();
    expect(chunk.prepared.value.ownLabels).toBe(standaloneLabels);
    // Coordinating later scans the full current content and registers it.
    input.value = { ...input.value, registry };
    await settle();
    expect(chunk.prepared.value.ownLabels.footnoteLabels.has('N')).toBe(true);
    expect(chunk.prepared.value.ownLabels.linkLabels.has('U')).toBe(true);
    expect(registry.chunkOrder).toHaveLength(1);
    expect(registry.globalNumber('N')).toBe(1);
    expect(registry.resolveLinkDef('U')?.url).toBe('https://example.com');
    input.value = { ...input.value, registry: null };
    await settle();
    expect(registry.chunkData.size).toBe(0);
    expect(chunk.prepared.value.ownLabels.footnoteLabels.size).toBe(0);
  } finally {
    app.unmount();
  }
  await settle();
  expect(registry._subscribers.size).toBe(0);
});

describe('chunk identity without crypto.randomUUID', () => {
  const realCrypto = globalThis.crypto;
  const setCrypto = (value: unknown) =>
    Object.defineProperty(globalThis, 'crypto', { value, configurable: true, writable: true });
  afterEach(() => {
    setCrypto(realCrypto);
    vi.restoreAllMocks();
  });
  const standalone = (): ChunkInput => ({
    content: 'Claim[^n] and [site][u].',
    documentId: 'doc',
    registry: null,
    preserveOrphanReferences: false,
    incrementalParse: false,
    clobberPrefix: 'doc-',
    enginePlugins: [],
    sanitizeSchema,
  });
  const Probe = defineComponent({
    props: { sink: { type: Array as () => string[], required: true } },
    setup(props) {
      const chunk = useMarkdownChunk(standalone);
      props.sink.push(chunk.provenance);
      return () => h('pre', JSON.stringify(chunk.prepared.value.trees.hast));
    },
  });

  test('a non-secure browser context (getRandomValues without randomUUID) mounts and SSR-renders', async () => {
    setCrypto({ getRandomValues: realCrypto.getRandomValues.bind(realCrypto) });
    expect((globalThis.crypto as { randomUUID?: unknown }).randomUUID).toBeUndefined();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mounted: string[] = [];
    const app = host.createApp({ render: () => h('main', [h(Probe, { sink: mounted }), h(Probe, { sink: mounted })]) });
    expect(() => app.mount(node())).not.toThrow();
    await settle();
    app.unmount();
    const server: string[] = [];
    const html = await renderToString(createSSRApp({ render: () => h(Probe, { sink: server }) }));
    expect(html).toContain('Claim');
    expect(mounted).toHaveLength(2);
    expect(mounted[0]).not.toBe(mounted[1]);
    for (const value of [...mounted, ...server]) expect(value).toMatch(/^[0-9a-f]{32}$/);
    expect(error).not.toHaveBeenCalled();
  });

  test('a runtime without Web Crypto falls back to a unique value and reports it once per instance', async () => {
    setCrypto(undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mounted: string[] = [];
    const app = host.createApp({ render: () => h('main', [h(Probe, { sink: mounted }), h(Probe, { sink: mounted })]) });
    expect(() => app.mount(node())).not.toThrow();
    await settle();
    app.unmount();
    expect(mounted).toHaveLength(2);
    expect(mounted[0]).not.toBe(mounted[1]);
    expect(error).toHaveBeenCalledTimes(2);
    expect(String(error.mock.calls[0][0])).toContain('getRandomValues');
  });

  test('registry registrations stay distinct per instance without randomUUID', async () => {
    setCrypto(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const registry = createRegistry();
    const Chunk = defineComponent({
      setup() {
        const chunk = useMarkdownChunk(() => ({ ...standalone(), registry }));
        return () => h('pre', JSON.stringify(chunk.prepared.value.trees.hast));
      },
    });
    const app = host.createApp({ render: () => h('main', [h(Chunk), h(Chunk)]) });
    app.mount(node());
    await settle();
    expect(registry.chunkOrder).toHaveLength(2);
    expect(registry.chunkOrder[0]).not.toBe(registry.chunkOrder[1]);
    app.unmount();
    await settle();
    expect(registry.chunkData.size).toBe(0);
    expect(registry._subscribers.size).toBe(0);
  });
});

describe('registry notifications do not re-run unaffected chunk pipelines', () => {
  for (const incrementalParse of [true, false]) {
    test(`incrementalParse=${incrementalParse}: one append runs only the appended chunk`, async () => {
      parseCounts.length = 0;
      planCount = 0;
      const chunks = shallowRef([
        'Intro with a [site][u] link and a claim[^n].',
        'Second section, plain prose.',
        'Third section, plain prose.',
        '[^n]: Shared footnote body',
        'Tail with a claim[^n].',
      ]);
      // Render-function executions per chunk: the vnode update hook fires
      // once per re-render of the component. Hooks and slot objects are
      // created once and the slots marked stable; otherwise every parent
      // render would force every child to update and hide what the registry
      // alone triggers.
      const renders: number[] = chunks.value.map(() => 0);
      const updated = chunks.value.map((_, index) => () => {
        renders[index] += 1;
      });
      const slots = chunks.value.map(() => ({ $stable: true }));
      const app = host.createApp({
        render: () =>
          h(AIMarkdownDocuments, null, {
            $stable: true,
            default: () =>
              chunks.value.map((content, index) =>
                h(
                  AIMarkdown,
                  {
                    key: index,
                    content,
                    documentId: 'doc',
                    documentIndex: index,
                    incrementalParse,
                    onVnodeUpdated: updated[index],
                  },
                  slots[index]
                )
              ),
          }),
      });
      const delta = (now: number[], before: number[]) => now.map((n, i) => n - before[i]);
      const root = node();
      try {
        app.mount(root);
        await settle();
        expect(anchors(root).map((a) => a.props.href)).not.toContain('https://example.com');
        const parsesAtMount = [...parseCounts];
        const rendersAtMount = [...renders];
        expect(parsesAtMount).toHaveLength(5);
        // A second reference appended to the last chunk changes its
        // contribution (ordered refs), so it publishes and the registry
        // notifies every chunk. No label changes anywhere: every other
        // chunk's phantom targets stay identity-stable and its frame is
        // kept, so only the appended chunk's session parses again.
        chunks.value = chunks.value.map((c, i) => (i === 4 ? c + ' And again[^n].' : c));
        await settle();
        expect(delta(parseCounts, parsesAtMount)).toEqual([0, 0, 0, 0, 1]);
        // The notification carries a new occurrence for [^n] in the last
        // chunk only; chunks whose resolved references did not change are
        // not re-rendered either. The last chunk renders for its append and
        // once more for the notification, which rebuilds the aggregate
        // footer it owns.
        expect(delta(renders, rendersAtMount)).toEqual([0, 0, 0, 0, 2]);
        const parsesBeforeDef = [...parseCounts];
        const rendersBeforeDef = [...renders];
        // A definition appended to the last chunk resolves chunk 0's link.
        // Chunk 0 legitimately parses again: its phantom targets change (the
        // label is no longer missing), so its frame must be rebuilt. The
        // last chunk's label set changes and it re-registers under a fresh
        // symbol; registration is synchronous with the change, so the one
        // parse for the append already carries the new symbol. Chunks 1-3
        // reference nothing and stay untouched.
        chunks.value = chunks.value.map((c, i) => (i === 4 ? c + '\n\n[u]: https://example.com' : c));
        await settle();
        expect(delta(parseCounts, parsesBeforeDef)).toEqual([1, 0, 0, 0, 1]);
        // Chunk 0 re-renders once with the resolved link. The last chunk
        // re-renders for the append, the re-registration and each
        // notification of that churn, which rebuilds the footer it owns.
        const rendersAfterDef = delta(renders, rendersBeforeDef);
        expect(rendersAfterDef.slice(0, 4)).toEqual([1, 0, 0, 0]);
        expect(rendersAfterDef[4]).toBeGreaterThanOrEqual(2);
        expect(anchors(root).map((a) => a.props.href)).toContain('https://example.com');
        const parsesBeforeMove = [...parseCounts];
        const rendersBeforeMove = [...renders];
        // Moving the destination changes no label set, so no phantom target
        // moves and nobody but the edited chunk parses. Chunk 0 still shows
        // the destination, so the notification must re-render it (and only
        // it) with the new href.
        chunks.value = chunks.value.map((c) => c.replace('https://example.com', 'https://example.org'));
        await settle();

        expect(delta(parseCounts, parsesBeforeMove)).toEqual([0, 0, 0, 0, 1]);
        expect(delta(renders, rendersBeforeMove).slice(0, 4)).toEqual([1, 0, 0, 0]);
        expect(anchors(root).map((a) => a.props.href)).toContain('https://example.org');
        // Vue converts the whole frame to VNodes on every render and keeps
        // no per-block cache that a plan could key. Nothing reads a plan, so
        // no frame may pay for one.
        expect(planCount).toBe(0);
      } finally {
        app.unmount();
      }
    });
  }
});

describe('a standalone AIMarkdown parses its first frame once', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const reset = () => {
    parseCounts.length = 0;
    parseModes.length = 0;
  };

  test('a client mount parses once, through the incremental path', async () => {
    // The node test environment has no `window`; a browser does. The
    // adapter decides at setup whether a next frame can follow, so a client
    // mount must not parse fully first and again incrementally after mount.
    vi.stubGlobal('window', {});
    reset();
    const app = host.createApp({ render: () => h(AIMarkdown, { content: 'Claim[^n].\n\n[^n]: body' }) });
    try {
      app.mount(node());
      await settle();
      expect(parseCounts).toEqual([1]);
      expect(parseModes).toEqual([true]);
    } finally {
      app.unmount();
    }
  });

  test('a server render parses once, fully, and retains no incremental state', async () => {
    expect(typeof window).toBe('undefined');
    reset();
    const html = await renderToString(
      createSSRApp({ render: () => h(AIMarkdown, { content: 'Claim[^n].\n\n[^n]: body' }) })
    );
    expect(html).toContain('body');
    expect(parseCounts).toEqual([1]);
    // A one-shot server render has no next frame; the full pipeline keeps
    // the session's retained state empty instead of seeding a checkpoint.
    expect(parseModes).toEqual([false]);
  });
});

describe('the resolution snapshot separates url, title and absence', () => {
  // Three chunks: the reference chunk is neither the definition owner nor
  // the aggregate owner, so only the resolution snapshot can re-render it.
  const mountWithDefinition = async (initial: string) => {
    const def = shallowRef(initial);
    const app = host.createApp({
      render: () =>
        h(AIMarkdownDocuments, null, {
          $stable: true,
          default: () => [
            h(AIMarkdown, { key: 'ref', documentId: 'doc', content: '[Link][x]' }),
            h(AIMarkdown, { key: 'def', documentId: 'doc', content: def.value }),
            h(AIMarkdown, { key: 'tail', documentId: 'doc', content: 'Tail' }),
          ],
        }),
    });
    const root = node();
    app.mount(root);
    await settle();
    const link = () => {
      const [anchor] = anchors(root);
      return anchor ? { href: anchor.props.href, title: anchor.props.title } : null;
    };
    return {
      link,
      async replace(next: string) {
        def.value = next;
        await settle();
      },
      unmount: () => app.unmount(),
    };
  };

  test('a url/title boundary move re-renders the reference', async () => {
    const doc = await mountWithDefinition('[x]: <https://example.com/a b> "c"');
    try {
      expect(doc.link()).toEqual({ href: 'https://example.com/a%20b', title: 'c' });
      // Same characters, different split: a joined "url title" string would
      // not change and the reference would keep the stale destination.
      await doc.replace('[x]: <https://example.com/a> "b c"');
      expect(doc.link()).toEqual({ href: 'https://example.com/a', title: 'b c' });
    } finally {
      doc.unmount();
    }
  });

  test('dropping the title re-renders the reference', async () => {
    const doc = await mountWithDefinition('[x]: https://example.com/a "t"');
    try {
      expect(doc.link()).toEqual({ href: 'https://example.com/a', title: 't' });
      await doc.replace('[x]: https://example.com/a');
      expect(doc.link()).toEqual({ href: 'https://example.com/a', title: null });
      // An empty title renders like no title; the snapshot still separates
      // the two states, which costs one render and never a stale one.
      await doc.replace('[x]: https://example.com/a ""');
      expect(doc.link()).toEqual({ href: 'https://example.com/a', title: null });
      await doc.replace('[x]: https://example.com/a "t"');
      expect(doc.link()).toEqual({ href: 'https://example.com/a', title: 't' });
    } finally {
      doc.unmount();
    }
  });
});

describe('deep-equal parse inputs from a parent re-render keep the previous frame', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const tags = (n: HostNode): string[] => [...(n.tag ? [n.tag] : []), ...n.children.flatMap(tags)];

  test('equal enginePlugins and sanitizeSchema literals do not re-parse; different ones do', async () => {
    vi.stubGlobal('window', {});
    parseCounts.length = 0;
    const tick = shallowRef(0);
    const plugins = shallowRef<readonly AIMarkdownEnginePlugin[]>(defaultEnginePlugins);
    const extend = shallowRef<(draft: SanitizeSchema) => void>(() => {});
    let renders = 0;
    const root = node();
    const app = host.createApp({
      render: () => {
        void tick.value;
        return h(AIMarkdown, {
          content: 'Term\n: Definition',
          // A parent that inlines both props hands the child a new array
          // and a new object on every render. The contents are equal until
          // the refs below change.
          enginePlugins: [...plugins.value],
          sanitizeSchema: extendSanitizeSchema(extend.value),
          onVnodeUpdated: () => {
            renders += 1;
          },
        });
      },
    });
    try {
      app.mount(root);
      await settle();
      expect(parseCounts).toEqual([1]);
      expect(tags(root)).toContain('dl');
      // Three parent renders with new-but-equal literals: the child renders
      // (its props changed identity) but the plugin chain, the schema and
      // the retained parse state all keep their previous identity, so the
      // pipeline is not run again.
      for (let i = 0; i < 3; i++) {
        tick.value += 1;
        await settle();
      }
      expect(renders).toBe(3);
      expect(parseCounts).toEqual([1]);
      // A genuinely different plugin list re-parses and changes the output.
      plugins.value = [];
      await settle();
      expect(parseCounts).toEqual([2]);
      expect(tags(root)).not.toContain('dl');
      // A genuinely different schema re-parses as well.
      extend.value = (draft) => {
        draft.tagNames?.push('custom-tag');
      };
      await settle();
      expect(parseCounts).toEqual([3]);
      // And an equal literal after each change is again absorbed.
      tick.value += 1;
      await settle();
      expect(parseCounts).toEqual([3]);
    } finally {
      app.unmount();
    }
  });
});

describe('top-level blocks keep their component instances by source offset', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const textOf = (n: HostNode): string => n.text + n.children.map(textOf).join('');
  const paragraphs = (n: HostNode): HostNode[] => [...(n.tag === 'p' ? [n] : []), ...n.children.flatMap(paragraphs)];

  test('appending never remounts earlier blocks and a same-offset rewrite keeps its instance', async () => {
    vi.stubGlobal('window', {});
    // Each mapped paragraph records the setup-time instance id it renders
    // with, so a remount shows up as a new id and a moved instance as an
    // old id under different text.
    let nextId = 0;
    const P = defineComponent({
      props: ['node', 'streaming', 'metadata'],
      setup(_props, { slots }) {
        const id = ++nextId;
        return () => h('p', { 'data-instance': id }, slots.default?.());
      },
    });
    const content = shallowRef('One\n\nTwo');
    const root = node();
    const app = host.createApp({
      render: () => h(AIMarkdown, { content: content.value, components: { p: P } }),
    });
    const snapshot = () => paragraphs(root).map((p) => [p.props['data-instance'], textOf(p)]);
    try {
      app.mount(root);
      await settle();
      expect(snapshot()).toEqual([
        [1, 'One'],
        [2, 'Two'],
      ]);
      // Streaming append: every earlier block keeps its offset, so its key
      // and therefore its instance.
      content.value = 'One\n\nTwo\n\nThree';
      await settle();
      expect(snapshot()).toEqual([
        [1, 'One'],
        [2, 'Two'],
        [3, 'Three'],
      ]);
      // Rewriting the first block without changing its length keeps every
      // offset, so every instance survives.
      content.value = 'Uno\n\nTwo\n\nThree';
      await settle();
      expect(snapshot()).toEqual([
        [1, 'Uno'],
        [2, 'Two'],
        [3, 'Three'],
      ]);
      // Keys are source offsets, which is React parity, not content
      // identity: a rewrite that changes the first block's length shifts
      // the later blocks' offsets, and those remount. Before keys existed
      // Vue paired unkeyed siblings by position; the difference shows only
      // when block order changes, where positional pairing moved a
      // component's state onto a different block.
      content.value = 'Primero\n\nTwo\n\nThree';
      await settle();
      const shifted = snapshot();
      expect(shifted.map(([, text]) => text)).toEqual(['Primero', 'Two', 'Three']);
      expect(shifted[0][0]).toBe(1);
      expect(shifted[1][0]).toBeGreaterThan(3);
      expect(shifted[2][0]).toBeGreaterThan(3);
    } finally {
      app.unmount();
    }
  });
});

describe('a documentId switch resolves the registry with the prefix', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const textOf = (n: HostNode): string => n.text + n.children.map(textOf).join('');

  test('one switch parses once and never pairs the old registry with the new prefix', async () => {
    vi.stubGlobal('window', {});
    parseCounts.length = 0;
    // Two documents whose companion chunks define the same labels with
    // different destinations. The reference chunk moves from one to the
    // other; its link resolves through the registry and its footnote mark
    // carries the clobber prefix, so a frame that mixes the two shows a
    // destination from one document under the prefix of the other.
    const doc = shallowRef('alpha');
    const frames: Array<{ link: string | undefined; mark: string | undefined }> = [];
    const root = node();
    // The wrapper renders a fragment, so the host root holds the fragment
    // anchors and the three chunk wrappers as siblings; the moved chunk is
    // the first element.
    const chunkRoot = () => root.children.find((child) => child.tag === 'div')!;
    const record = () => {
      const hrefs = anchors(chunkRoot()).map((a) => String(a.props.href));
      frames.push({
        link: hrefs.find((href) => !href.startsWith('#')),
        mark: hrefs.find((href) => href.startsWith('#')),
      });
    };
    // The link resolves through the registry's label set as soon as the
    // chunk holds the registry; the footnote number arrives with the
    // chunk's own contribution, which commits post-flush, so a frame may
    // still lack the mark. A mark under one document's prefix next to the
    // other document's destination is the mixed frame this test forbids.
    const consistent = ({ link, mark }: { link: string | undefined; mark: string | undefined }) =>
      (link === 'https://alpha.example/' && (mark === undefined || mark === '#aimd-alpha-fn-n')) ||
      (link === 'https://beta.example/' && (mark === undefined || mark === '#aimd-beta-fn-n'));
    const app = host.createApp({
      render: () =>
        h(AIMarkdownDocuments, null, {
          $stable: true,
          default: () => [
            h(AIMarkdown, {
              key: 'ref',
              content: 'Claim[^n] on [site][u].',
              documentId: doc.value,
              documentIndex: 0,
              onVnodeUpdated: record,
            }),
            h(AIMarkdown, {
              key: 'alpha',
              content: '[^n]: Alpha body\n\n[u]: https://alpha.example/',
              documentId: 'alpha',
              documentIndex: 1,
            }),
            h(AIMarkdown, {
              key: 'beta',
              content: '[^n]: Beta body\n\n[u]: https://beta.example/',
              documentId: 'beta',
              documentIndex: 1,
            }),
          ],
        }),
    });
    try {
      app.mount(root);
      await settle();
      record();
      expect(frames.at(-1)).toEqual({ link: 'https://alpha.example/', mark: '#aimd-alpha-fn-n' });
      const before = [...parseCounts];
      frames.length = 0;
      doc.value = 'beta';
      await settle();
      // The moved chunk parses once, with the new registry, its new symbol
      // and the new prefix together. The companions parse nothing: no label
      // set moved in either registry.
      expect(parseCounts.map((n, i) => n - before[i])).toEqual([1, 0, 0]);
      expect(frames.length).toBeGreaterThanOrEqual(1);
      expect(frames.filter((frame) => !consistent(frame))).toEqual([]);
      expect(frames.at(-1)).toEqual({ link: 'https://beta.example/', mark: '#aimd-beta-fn-n' });
      expect(textOf(root)).toContain('Beta body');
    } finally {
      app.unmount();
    }
  });
});

describe('the documents wrapper supplies the orphan policy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const textOf = (n: HostNode): string => n.text + n.children.map(textOf).join('');
  const mount = async (wrapper: Record<string, unknown>, chunk: Record<string, unknown>) => {
    vi.stubGlobal('window', {});
    const root = node();
    const app = host.createApp({
      render: () =>
        h(AIMarkdownDocuments, wrapper, {
          $stable: true,
          default: () => [
            h(AIMarkdown, { key: 'text', content: 'Prose without a reference.', documentId: 'doc', documentIndex: 0 }),
            h(AIMarkdown, { key: 'def', content: '[^o]: Orphan body', documentId: 'doc', documentIndex: 1, ...chunk }),
          ],
        }),
    });
    app.mount(root);
    await settle();
    const text = textOf(root);
    app.unmount();
    return text;
  };

  test('an unreferenced definition shows in the aggregate footer by default, as in React', async () => {
    expect(await mount({}, {})).toContain('Orphan body');
  });
  test('the wrapper prop turns the policy off', async () => {
    expect(await mount({ preserveOrphanReferences: false }, {})).not.toContain('Orphan body');
  });
  test('the wrapper value wins over a chunk prop in both directions, as in React', async () => {
    expect(await mount({}, { preserveOrphanReferences: false })).toContain('Orphan body');
    expect(await mount({ preserveOrphanReferences: false }, { preserveOrphanReferences: true })).not.toContain(
      'Orphan body'
    );
  });
});

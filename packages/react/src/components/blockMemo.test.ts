/**
 * Tests for block-level memoization. Covers buildBlocks (hast-driven block
 * extraction + ctx digest) and renderBlocksWithCache (per-block cache
 * identity + footnote single-slot + atomic Cache replacement).
 *
 * Cache hits are asserted by referential equality of the returned ReactNodes
 * across frames — when a block is cached, `renderBlocksWithCache` returns the
 * exact `node` reference stored in the prior frame's Cache.
 */

import { describe, expect, test } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import remarkSqueezeParagraphs from 'remark-squeeze-paragraphs';
import remarkRemoveComments from 'remark-remove-comments';
import rehypeRaw from '@ai-markdown/rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { VFile } from 'vfile';
import type { Element as HastElement, Root as HastRoot } from 'hast';
import type { Root as MdastRoot } from 'mdast';
import { sanitizeSchema } from '@ai-markdown/engine';
import { rehypeRebaseHashLinks } from '@ai-markdown/engine';
import { createElement, Fragment, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildBlocks, createCache, renderBlocksWithCache, type Cache, type PostOptions } from './blockMemo';
import { createRegistry, type Registry } from '@ai-markdown/engine';

interface PipelineOptions {
  removeComments?: boolean;
}

function buildProcessor(options: PipelineOptions = {}) {
  let processor = unified().use(remarkParse).use(remarkGfm).use(remarkSqueezeParagraphs);
  if (options.removeComments) {
    processor = processor.use(remarkRemoveComments);
  }
  return processor
    .use(remarkRehype, { allowDangerousHtml: true, clobberPrefix: '' })
    .use(rehypeRaw, { passThrough: [] })
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeRebaseHashLinks);
}

function runPipeline(content: string, options: PipelineOptions = {}): { mdast: MdastRoot; hast: HastRoot } {
  const processor = buildProcessor(options);
  const file = new VFile({ value: content });
  const mdast = processor.parse(file);
  const hast = processor.runSync(mdast, file) as HastRoot;
  return { mdast, hast };
}

const emptyPostOptions: PostOptions = {};

function frame(content: string, cacheRef: { current: Cache }, options: PipelineOptions = {}) {
  const { mdast, hast } = runPipeline(content, options);
  const built = buildBlocks(mdast, hast, content);
  const all = renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, emptyPostOptions);
  // Tests inspect cache identity at the block / synthetic level. Inlines
  // (top-level whitespace text inserted by mdast-util-to-hast between block
  // elements) are intentionally rendered fresh every frame and would skew
  // the index-based assertions, so filter them out for the tests' view.
  const rendered: ReactNode[] = [];
  for (let i = 0; i < built.plan.length; i++) {
    if (built.plan[i].kind === 'inline') continue;
    rendered.push(all[i].node);
  }
  return { built, rendered, cache: cacheRef.current };
}

// ─── isFootnoteSection / hasMdastSource ───────────────────────────────────

// ─── buildBlocks: structure ────────────────────────────────────────────────

// ─── renderBlocksWithCache: per-block hit/miss ─────────────────────────────

describe('renderBlocksWithCache — block identity', () => {
  test('identical content across frames: every block hits', () => {
    const cacheRef = { current: createCache() };
    const f1 = frame('Hello\n\nWorld', cacheRef);
    const f2 = frame('Hello\n\nWorld', cacheRef);
    expect(f2.rendered[0]).toBe(f1.rendered[0]);
    expect(f2.rendered[1]).toBe(f1.rendered[1]);
  });

  test('streaming append: prior blocks hit, new block fresh', () => {
    const cacheRef = { current: createCache() };
    const f1 = frame('Hello\n\nWorld', cacheRef);
    const f2 = frame('Hello\n\nWorld\n\nMore', cacheRef);
    expect(f2.rendered[0]).toBe(f1.rendered[0]);
    expect(f2.rendered[1]).toBe(f1.rendered[1]);
    expect(f2.rendered[2]).not.toBe(f1.rendered[1]);
  });

  test('self-correction: prefix changes → all subsequent offsets drift → miss', () => {
    const cacheRef = { current: createCache() };
    const f1 = frame('Hi\n\nWorld', cacheRef);
    const f2 = frame('Hello\n\nWorld', cacheRef);
    // Block "World" raw is unchanged but its startOffset shifted (4 → 7).
    expect(f2.built.blocks[1].raw).toBe('World');
    expect(f1.built.blocks[1].startOffset).not.toBe(f2.built.blocks[1].startOffset);
    expect(f2.rendered[1]).not.toBe(f1.rendered[1]);
  });

  test('duplicate raw: bucket per occurrence', () => {
    const cacheRef = { current: createCache() };
    const f1 = frame('---\n\nMid\n\n---', cacheRef);
    expect(f1.built.blocks).toHaveLength(3);
    // Same raw twice for the two thematic breaks → two bucket entries.
    const bucket = f1.cache.blocks.get(f1.built.blocks[0].raw);
    expect(bucket?.length).toBe(2);
    // Frame 2 hits both occurrences.
    const f2 = frame('---\n\nMid\n\n---', cacheRef);
    expect(f2.rendered[0]).toBe(f1.rendered[0]);
    expect(f2.rendered[2]).toBe(f1.rendered[2]);
  });

  test('partial hit on duplicate raw: bucket[0] hits, bucket[1] miss when offset drifts', () => {
    const cacheRef = { current: createCache() };
    const f1 = frame('---\n\nMid\n\n---', cacheRef);
    // Insert text before second --- so its offset changes
    const f2 = frame('---\n\nMidText\n\n---', cacheRef);
    expect(f2.rendered[0]).toBe(f1.rendered[0]);
    // Second --- has different startOffset → miss even though same raw + same bucket index
    expect(f2.built.blocks[2].raw).toBe('---');
    expect(f2.built.blocks[2].startOffset).not.toBe(f1.built.blocks[2].startOffset);
    expect(f2.rendered[2]).not.toBe(f1.rendered[2]);
  });
});

// ─── renderBlocksWithCache: ctx invalidation ───────────────────────────────

describe('renderBlocksWithCache — ctx invalidation', () => {
  test('tainted block hits when only an unrelated paragraph changes', () => {
    const cacheRef = { current: createCache() };
    const f1 = frame('See[^x].\n\nPlain.\n\n[^x]: hello', cacheRef);
    const f2 = frame('See[^x].\n\nDifferent.\n\n[^x]: hello', cacheRef);
    // First block (tainted) raw + ctx + offset unchanged → hit.
    expect(f2.rendered[0]).toBe(f1.rendered[0]);
  });

  test('changing a footnote definition url/body invalidates dependent block', () => {
    const cacheRef = { current: createCache() };
    const f1 = frame('See[^x].\n\n[^x]: original', cacheRef);
    const f2 = frame('See[^x].\n\n[^x]: updated', cacheRef);
    // The "See[^x]." block has the same raw + offset, but globalCtx changed
    // (footnoteDefinition body). Tainted blocks invalidate → miss.
    expect(f2.built.blocks[0].raw).toBe(f1.built.blocks[0].raw);
    expect(f2.rendered[0]).not.toBe(f1.rendered[0]);
  });

  test('reordering footnote refs (same multiset) invalidates tainted block', () => {
    const cacheRef = { current: createCache() };
    const f1 = frame('A[^x] B[^y].\n\n[^x]: x\n\n[^y]: y', cacheRef);
    const f2 = frame('A[^y] B[^x].\n\n[^x]: x\n\n[^y]: y', cacheRef);
    // Same set of refs but different order → globalCtx differs → ref-bearing
    // block must invalidate (footnote numbering depends on first-occurrence order).
    expect(f1.built.globalCtx).not.toBe(f2.built.globalCtx);
    expect(f2.rendered[0]).not.toBe(f1.rendered[0]);
  });

  test('linkRef block invalidates when its definition changes', () => {
    const cacheRef = { current: createCache() };
    const f1 = frame('[ref][a]\n\n[a]: https://x.com', cacheRef);
    const f2 = frame('[ref][a]\n\n[a]: https://y.com', cacheRef);
    expect(f1.built.globalCtx).not.toBe(f2.built.globalCtx);
    expect(f2.rendered[0]).not.toBe(f1.rendered[0]);
  });
});

// ─── footnote synthetic section: single-slot cache ─────────────────────────

describe('renderBlocksWithCache — footnote section', () => {
  test('section reused across frames when globalCtx unchanged', () => {
    const cacheRef = { current: createCache() };
    const f1 = frame('See[^x].\n\n[^x]: hello', cacheRef);
    const f2 = frame('See[^x].\n\n[^x]: hello', cacheRef);
    const sectionIdx = f1.built.blocks.length;
    expect(f2.rendered[sectionIdx]).toBe(f1.rendered[sectionIdx]);
  });

  test('toggle T1→T2→T3 (footnote present → absent → present) re-renders T3', () => {
    const cacheRef = { current: createCache() };
    const t1 = frame('See[^x].\n\n[^x]: hello', cacheRef);
    expect(t1.cache.footnoteSection).toBeDefined();
    const t2 = frame('Plain text.', cacheRef);
    expect(t2.cache.footnoteSection).toBeUndefined();
    const t3 = frame('See[^x].\n\n[^x]: hello', cacheRef);
    expect(t3.cache.footnoteSection).toBeDefined();
    // Section was wiped during T2 (no synthetic), so T3 must produce a
    // fresh node — design trade-off documented.
    const sectionIdx = t1.built.blocks.length;
    expect(t3.rendered[sectionIdx]).not.toBe(t1.rendered[sectionIdx]);
  });
});

// ─── atomic Cache replacement ──────────────────────────────────────────────

describe('renderBlocksWithCache — atomic replacement', () => {
  test('cacheRef.current is a brand-new Cache after each call', () => {
    const cacheRef = { current: createCache() };
    const before = cacheRef.current;
    frame('Hello', cacheRef);
    expect(cacheRef.current).not.toBe(before);
  });

  test('renders left over from prior frame are not retained when their raw disappears', () => {
    const cacheRef = { current: createCache() };
    frame('Hello\n\nWorld', cacheRef);
    expect(cacheRef.current.blocks.has('Hello')).toBe(true);
    expect(cacheRef.current.blocks.has('World')).toBe(true);
    frame('Goodbye', cacheRef);
    expect(cacheRef.current.blocks.has('Hello')).toBe(false);
    expect(cacheRef.current.blocks.has('World')).toBe(false);
    expect(cacheRef.current.blocks.has('Goodbye')).toBe(true);
  });
});

// ─── invariants ────────────────────────────────────────────────────────────

describe('renderBlocksWithCache — dev invariants', () => {
  test('throws when a block plan item has no position on its hast element', () => {
    // Simulate a buggy buildBlocks (or downstream rehype plugin) that produced
    // a `block` plan item whose hast element lost its `position`. The dev
    // invariant in renderBlocksWithCache must trip.
    const cacheRef = { current: createCache() };
    const fakeChild: HastElement = {
      type: 'element',
      tagName: 'p',
      properties: {},
      children: [],
    };
    expect(() =>
      renderBlocksWithCache(
        cacheRef,
        [
          {
            kind: 'block',
            el: fakeChild,
            key: 'block-0',
            info: { raw: 'a', startOffset: 0, endOffset: 1, startLine: 1, startColumn: 1, hasReference: false },
          },
        ],
        '[]',
        emptyPostOptions
      )
    ).toThrow(/position/);
  });
});

// ─── empty / edge documents ────────────────────────────────────────────────

// ─── raw HTML edge cases (validates two-tier offset lookup + occurrence index) ─

describe('buildBlocks — raw HTML', () => {
  test('2026-08-20 A1: a definition BEFORE an unclosed container still updates what it swallowed', () => {
    // The definition sits outside `[ownEnd, maxEnd)`, so the extent hash
    // cannot see the edit — only the mdast taint test can, by noticing the
    // swallowed reference and switching the block's key to `globalCtx`.
    for (const opener of ['<details>', '<div>', '<section>', '<table>', '<ul>', '<p>', '<blockquote>']) {
      for (const body of ['See [x].', '![y][x]', '[x]']) {
        const doc = (url: string) => `[x]: ${url}\n\nintro\n\n${opener}\n\n${body}\n`;
        const cacheRef = { current: createCache() };
        const first = frame(doc('https://a.example'), cacheRef);
        const second = frame(doc('https://b.example'), cacheRef);
        const fresh = frame(doc('https://b.example'), { current: createCache() });
        const label = `${opener} + ${body}`;
        expect({ label, html: renderToStaticMarkup(createElement(Fragment, null, ...second.rendered)) }).toEqual({
          label,
          html: renderToStaticMarkup(createElement(Fragment, null, ...fresh.rendered)),
        });
        // Guard against a vacuous case where both frames render the same.
        expect(renderToStaticMarkup(createElement(Fragment, null, ...first.rendered))).not.toBe(
          renderToStaticMarkup(createElement(Fragment, null, ...fresh.rendered))
        );
      }
    }
  });

  test('multi-root raw HTML partial change: BOTH blocks miss (mdast-node-level identity)', () => {
    // Design contract: cache identity = mdast-node-level. Both hast divs
    // share one mdast html source string, so changing any inner div mutates
    // the parent raw → bucket key changes for all occurrences. This is by
    // design, not a bug.
    const cacheRef = { current: createCache() };
    const f1 = frame('<div>A</div><div>B</div>', cacheRef);
    const f2 = frame('<div>D</div><div>B</div>', cacheRef);
    expect(f1.built.blocks).toHaveLength(2);
    expect(f2.built.blocks).toHaveLength(2);
    expect(f2.rendered[0]).not.toBe(f1.rendered[0]);
    expect(f2.rendered[1]).not.toBe(f1.rendered[1]);
  });

  test('multi-root raw HTML unchanged: both hast divs hit cache via bucket index', () => {
    const cacheRef = { current: createCache() };
    const f1 = frame('<div>A</div><div>B</div>', cacheRef);
    const f2 = frame('<div>A</div><div>B</div>', cacheRef);
    expect(f2.rendered[0]).toBe(f1.rendered[0]);
    expect(f2.rendered[1]).toBe(f1.rendered[1]);
  });
});

// ─── synthesized hast nodes (no mdast counterpart / no position) ──────────

// ─── G3 flush contract (cacheRef external reset) ──────────────────────────

describe('renderBlocksWithCache — G3 flush contract', () => {
  test('externally resetting cacheRef forces miss on the next frame', () => {
    // The MarkdownContent G3 flush works by replacing cacheRef.current with
    // a fresh Cache when any of the 10 tracked deps change identity. From
    // renderBlocksWithCache's perspective, this manifests as "prev cache is
    // empty even though content is unchanged".
    const cacheRef = { current: createCache() };
    const f1 = frame('Hello\n\nWorld', cacheRef);
    cacheRef.current = createCache();
    const f2 = frame('Hello\n\nWorld', cacheRef);
    expect(f2.rendered[0]).not.toBe(f1.rendered[0]);
    expect(f2.rendered[1]).not.toBe(f1.rendered[1]);
  });

  test('reset also discards the footnote synthetic single-slot', () => {
    const cacheRef = { current: createCache() };
    const f1 = frame('See[^x].\n\n[^x]: hello', cacheRef);
    expect(cacheRef.current.footnoteSection).toBeDefined();
    cacheRef.current = createCache();
    expect(cacheRef.current.footnoteSection).toBeUndefined();
    const f2 = frame('See[^x].\n\n[^x]: hello', cacheRef);
    const sectionIdx = f1.built.blocks.length;
    expect(f2.rendered[sectionIdx]).not.toBe(f1.rendered[sectionIdx]);
  });
});

// ─── React key uniqueness (multi-root raw HTML) ────────────────────────────

// ─── Position triple validity (line/column false-positive defence) ─────────

describe('renderBlocksWithCache — position triple validity', () => {
  test('cache miss when startLine differs even if startOffset matches', () => {
    // Regression: prior implementation only filtered by startOffset, so two
    // different documents that happen to put "Target" at the same byte offset
    // (but on different lines) would falsely hit the cache. The cached node's
    // `node.position.start.line` would then be stale for custom components
    // that read it via `passNode: true`.
    const cacheRef = { current: createCache() };
    const f1 = frame('A\n\nB\n\nTarget', cacheRef);
    const targetBlockF1 = f1.built.blocks.find((b) => b.raw === 'Target');
    expect(targetBlockF1).toBeDefined();
    expect(targetBlockF1!.startOffset).toBe(6);
    expect(targetBlockF1!.startLine).toBe(5);

    const f2 = frame('ABCD\n\nTarget', cacheRef);
    const targetBlockF2 = f2.built.blocks.find((b) => b.raw === 'Target');
    expect(targetBlockF2).toBeDefined();
    expect(targetBlockF2!.startOffset).toBe(6); // same offset
    expect(targetBlockF2!.startLine).toBe(3); // but different line
    // Cache MUST miss → fresh ReactNode reference.
    const idx = f2.built.blocks.indexOf(targetBlockF2!);
    expect(f2.rendered[idx]).not.toBe(f1.rendered[f1.built.blocks.indexOf(targetBlockF1!)]);
  });

  test('cache miss when startColumn differs (column-only drift)', () => {
    // Constructing a pure column-only drift on a top-level block via stock
    // markdown is artificial, so we drive renderBlocksWithCache directly with
    // a hand-crafted plan to exercise the column branch of the validity check.
    const cacheRef = { current: createCache() };
    const baseEl: HastElement = {
      type: 'element',
      tagName: 'p',
      properties: {},
      children: [],
      position: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 2, offset: 1 },
      },
    };
    const driftedEl: HastElement = {
      type: 'element',
      tagName: 'p',
      properties: {},
      children: [],
      position: {
        start: { line: 1, column: 2, offset: 0 }, // same offset, different column
        end: { line: 1, column: 3, offset: 1 },
      },
    };
    const r1 = renderBlocksWithCache(
      cacheRef,
      [
        {
          kind: 'block',
          el: baseEl,
          key: 'block-0',
          info: {
            raw: 'p',
            startOffset: 0,
            endOffset: 1,
            startLine: 1,
            startColumn: 1,
            hasReference: false,
          },
        },
      ],
      '[]',
      emptyPostOptions
    );
    const r2 = renderBlocksWithCache(
      cacheRef,
      [
        {
          kind: 'block',
          el: driftedEl,
          key: 'block-0',
          info: {
            raw: 'p',
            startOffset: 0,
            endOffset: 1,
            startLine: 1,
            startColumn: 2,
            hasReference: false,
          },
        },
      ],
      '[]',
      emptyPostOptions
    );
    expect(r2[0].node).not.toBe(r1[0].node);
  });
});

// ─── footnoteDefinition range-fallback safety ──────────────────────────────

describe('buildBlocks — half-built mdast position (v2.4.1 review)', () => {
  test('a block whose mdast node lacks an end offset is rendered inline, not dropped', () => {
    const md = 'Hello\n\nWorld';
    const { mdast, hast } = runPipeline(md);
    // A third-party remark plugin that emits `position.end` without offset.
    const second = mdast.children[1]!;
    (second.position as { end: { offset?: number } }).end = { ...second.position!.end, offset: undefined };
    const built = buildBlocks(mdast, hast, md);
    const kept = built.plan.filter((p) => p.kind === 'inline' && (p.el as HastElement).tagName === 'p');
    expect(kept).toHaveLength(1);
    expect(built.blocks).toHaveLength(1);
    // The uncached item still reaches the render list.
    const cacheRef = { current: createCache() };
    const all = renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, emptyPostOptions);
    expect(all).toHaveLength(built.plan.length);
  });
});

// ─── inline non-element preservation ──────────────────────────────────────

describe('buildBlocks — inline (non-element) top-level children', () => {
  test('inline output stays equivalent while block nodes retain cache identity', () => {
    const cacheRef = { current: createCache() };
    const { mdast: m1, hast: h1 } = runPipeline('A\n\nB');
    const built1 = buildBlocks(m1, h1, 'A\n\nB');
    const r1 = renderBlocksWithCache(cacheRef, built1.plan, built1.globalCtx, emptyPostOptions);
    const { mdast: m2, hast: h2 } = runPipeline('A\n\nB');
    const built2 = buildBlocks(m2, h2, 'A\n\nB');
    const r2 = renderBlocksWithCache(cacheRef, built2.plan, built2.globalCtx, emptyPostOptions);
    // Find inline indices.
    const inlineIndices = built1.plan.map((p, i) => (p.kind === 'inline' ? i : -1)).filter((i) => i !== -1);
    expect(inlineIndices.length).toBeGreaterThan(0);
    // Plain text can be returned directly. Verify emitted bytes, not an
    // incidental Fragment allocation around each whitespace separator.
    for (const i of inlineIndices) {
      const html = (node: ReactNode) => renderToStaticMarkup(createElement(Fragment, null, node));
      expect(html(r2[i].node)).toBe(html(r1[i].node));
      expect(html(r2[i].node)).toBe('\n');
    }
    // Block nodes still hit cache despite the inline re-render.
    const blockIndices = built1.plan.map((p, i) => (p.kind === 'block' ? i : -1)).filter((i) => i !== -1);
    for (const i of blockIndices) {
      expect(r2[i].node).toBe(r1[i].node);
    }
  });
});

// ─── miscellaneous correctness scenarios ──────────────────────────────────

describe('renderBlocksWithCache — misc scenarios', () => {
  test('setext heading raw stable across streaming append', () => {
    const cacheRef = { current: createCache() };
    const f1 = frame('Title\n=====\n\nBody', cacheRef);
    const f2 = frame('Title\n=====\n\nBody more', cacheRef);
    // The setext heading sits at offset 0 in both frames with identical raw,
    // so it must hit cache regardless of edits to the trailing block.
    expect(f2.rendered[0]).toBe(f1.rendered[0]);
  });

  test('external URL with hash does not taint the block — hits cache across frames', () => {
    const cacheRef = { current: createCache() };
    const f1 = frame('Visit [home](https://x.com#section).', cacheRef);
    expect(f1.built.blocks[0].hasReference).toBe(false);
    const f2 = frame('Visit [home](https://x.com#section).', cacheRef);
    expect(f2.rendered[0]).toBe(f1.rendered[0]);
  });

  test('changing footnote ref count in another paragraph invalidates ref-bearing block', () => {
    // A[^x] alone in T1 → globalCtx records [^x] once.
    // T2 adds another [^x] inline somewhere → globalCtx records [^x] twice.
    // The first block's raw + offset are identical, but its rendered output
    // depends on backref count → must invalidate.
    const cacheRef = { current: createCache() };
    const f1 = frame('A[^x].\n\nPlain.\n\n[^x]: x', cacheRef);
    const f2 = frame('A[^x].\n\nAlso[^x].\n\n[^x]: x', cacheRef);
    expect(f1.built.globalCtx).not.toBe(f2.built.globalCtx);
    expect(f2.built.blocks[0].raw).toBe(f1.built.blocks[0].raw);
    expect(f2.built.blocks[0].startOffset).toBe(f1.built.blocks[0].startOffset);
    expect(f2.rendered[0]).not.toBe(f1.rendered[0]);
  });

  test('postOptions reference change has no effect on cache identity (G3 is upstream)', () => {
    // Cache key = (raw, occurrence, ctx, startOffset). postOptions does not
    // appear in the key — invalidation on postOptions change is the G3
    // flush layer's responsibility (tested above). At this layer, identical
    // (blocks, ctx) with a fresh-reference postOptions object still hits.
    const cacheRef = { current: createCache() };
    const { mdast: m1, hast: h1 } = runPipeline('Hello');
    const built1 = buildBlocks(m1, h1, 'Hello');
    const r1 = renderBlocksWithCache(cacheRef, built1.plan, built1.globalCtx, {});
    const { mdast: m2, hast: h2 } = runPipeline('Hello');
    const built2 = buildBlocks(m2, h2, 'Hello');
    const r2 = renderBlocksWithCache(cacheRef, built2.plan, built2.globalCtx, {});
    expect(r2[0].node).toBe(r1[0].node);
  });
});

describe('renderBlocksWithCache fingerprint cache (v6)', () => {
  function makeOpts(registry: Registry | undefined, thisChunkSym?: symbol, clobberPrefix = 'doc-'): PostOptions {
    return Object.freeze({
      components: {},
      urlTransform: (u: string) => u,
      allowedElements: undefined,
      disallowedElements: undefined,
      allowElement: undefined,
      skipHtml: false,
      unwrapDisallowed: false,
      registry,
      thisChunkSymbol: thisChunkSym,
      clobberPrefix,
    });
  }

  test('TAINT block with stable fingerprint hits cache', () => {
    // Footnote definition included in source so remark-gfm parses [^x] as a footnoteReference
    // (a bare `See [^x].` without a definition is left as plain text).
    const source = 'See [^x].\n\n[^x]: hello';
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);
    const mdast = processor.parse(source);
    const hast = processor.runSync(mdast) as HastRoot;
    const built = buildBlocks(mdast as MdastRoot, hast, source);
    const reg = createRegistry();
    const sym = reg.allocateSymbol('chunk');
    reg.contributeChunkData(sym, {
      refs: [{ label: 'X', kind: 'footnote' }],
      defs: new Map(),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(),
      ownLinkLabels: new Set(),
    });

    const cacheRef = { current: createCache() };
    const opts = makeOpts(reg, sym);
    renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, opts);
    const e1 = cacheRef.current.blocks.get('See [^x].')?.[0];
    renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, opts);
    const e2 = cacheRef.current.blocks.get('See [^x].')?.[0];
    expect(e1?.node).toBe(e2?.node); // same ReactNode → cache hit
  });

  test('TAINT block with changed fingerprint misses cache', () => {
    // Footnote definition included so [^x] parses as a footnoteReference.
    const source = 'See [^x].\n\n[^x]: hello';
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);
    const mdast = processor.parse(source);
    const hast = processor.runSync(mdast) as HastRoot;
    const built = buildBlocks(mdast as MdastRoot, hast, source);
    const reg = createRegistry();
    const sym = reg.allocateSymbol('chunk');

    const cacheRef = { current: createCache() };
    const opts = makeOpts(reg, sym);
    renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, opts);
    const e1 = cacheRef.current.blocks.get('See [^x].')?.[0];

    // Mutate registry: add the ref so globalNumber returns 1 (was null before)
    reg.contributeChunkData(sym, {
      refs: [{ label: 'X', kind: 'footnote' }],
      defs: new Map(),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(),
      ownLinkLabels: new Set(),
    });

    renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, opts);
    const e2 = cacheRef.current.blocks.get('See [^x].')?.[0];
    expect(e1?.node).not.toBe(e2?.node); // different ReactNode → cache miss → re-rendered
  });

  test('standalone (no registry) falls back to globalCtx, byte-equiv to pre-v6', () => {
    const source = 'See [^x].\n\n[^x]: hello';
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);
    const mdast = processor.parse(source);
    const hast = processor.runSync(mdast) as HastRoot;
    const built = buildBlocks(mdast as MdastRoot, hast, source);

    const cacheRef = { current: createCache() };
    const opts = makeOpts(undefined); // no registry → fallback path
    renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, opts);
    const e1 = cacheRef.current.blocks.get('See [^x].')?.[0];
    renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, opts);
    const e2 = cacheRef.current.blocks.get('See [^x].')?.[0];
    expect(e1?.node).toBe(e2?.node); // globalCtx unchanged → cache hit
  });
});

// ─── renderHastSubtree re-entry safety (urlTransform convergence) ──────────

describe('renderBlocksWithCache — hast re-entry safety', () => {
  // Renders without a re-parse (registry version bump, G3 cache flush,
  // urlTransform prop swap) re-enter the SAME memoized hast elements. The
  // visit transform must therefore apply urlTransform CONVERGENTLY — always
  // recomputed from the stashed original (`element.data.originalUrls`), so
  // a non-idempotent urlTransform is never applied on top of its own
  // previous output and a swapped transform never sees the old one's.
  test('cache-miss re-render on the same hast applies urlTransform exactly once', () => {
    const content = '[link](https://example.com/a)';
    const { mdast, hast } = runPipeline(content);
    const built = buildBlocks(mdast, hast, content);
    const opts: PostOptions = { urlTransform: (u: string) => `https://proxy.test/?u=${encodeURIComponent(u)}` };

    const cacheRef = { current: createCache() };
    renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, opts);
    // Simulate a G3 flush: fresh cache, same plan/hast, same options.
    cacheRef.current = createCache();
    const r2 = renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, opts);

    const html = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        r2.map((r) => r.node)
      )
    );
    expect(html).toContain('https://proxy.test/?u=https%3A%2F%2Fexample.com%2Fa');
    expect(html).not.toContain('u%3Dhttps'); // double-wrapped proxy URL

    // Convergence contract: the transformed value lands in `properties`, but
    // the ORIGINAL href stays recoverable in the data stash — every future
    // pass recomputes from it, so re-entry can never compound the transform.
    const blockItem = built.plan.find((p) => p.kind === 'block');
    const para = blockItem && 'el' in blockItem ? (blockItem.el as HastElement) : undefined;
    const anchor = para?.children.find((c): c is HastElement => c.type === 'element' && c.tagName === 'a');
    const stash = (anchor?.data as { originalUrls?: Record<string, unknown> } | undefined)?.originalUrls;
    expect(stash?.href).toBe('https://example.com/a');
    expect(anchor?.properties.href).toBe('https://proxy.test/?u=https%3A%2F%2Fexample.com%2Fa');
  });

  test('swapping urlTransform between renders applies only the new transform', () => {
    const content = '[link](https://example.com/a)';
    const { mdast, hast } = runPipeline(content);
    const built = buildBlocks(mdast, hast, content);

    const cacheRef = { current: createCache() };
    renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, {
      urlTransform: (u: string) => `${u}?v=old`,
    });
    // urlTransform is a G3 dep: swapping it flushes the cache, then the same
    // hast re-renders. Only the NEW transform may appear in the output.
    cacheRef.current = createCache();
    const r2 = renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, {
      urlTransform: (u: string) => `${u}?v=new`,
    });

    const html = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        r2.map((r) => r.node)
      )
    );
    expect(html).toContain('https://example.com/a?v=new');
    expect(html).not.toContain('v=old');
  });

  test('identity transform stashes nothing, and a later real transform stays convergent', () => {
    const content = '[link](https://example.com/a)';
    const { mdast, hast } = runPipeline(content);
    const built = buildBlocks(mdast, hast, content);

    // First render under the DEFAULT transform (identity for safe URLs).
    const cacheRef = { current: createCache() };
    renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, {});

    const blockItem = built.plan.find((p) => p.kind === 'block');
    const para = blockItem && 'el' in blockItem ? (blockItem.el as HastElement) : undefined;
    const anchor = para?.children.find((c): c is HastElement => c.type === 'element' && c.tagName === 'a');
    // Nothing changed → nothing archived, no per-element allocation. These
    // nodes are retained by the block-memo cache, so a stash here would be
    // permanent dead weight on every URL-bearing element.
    expect((anchor?.data as { originalUrls?: Record<string, unknown> } | undefined)?.originalUrls).toBeUndefined();
    expect(anchor?.properties.href).toBe('https://example.com/a');

    // No stash ⇔ the property still holds the original, so a later pass
    // with a REAL transform (G3 flush after a urlTransform prop swap) reads
    // it directly and archives it only then.
    cacheRef.current = createCache();
    const r2 = renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, {
      urlTransform: (u: string) => `${u}?v=new`,
    });
    const html = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        r2.map((r) => r.node)
      )
    );
    expect(html).toContain('https://example.com/a?v=new');
    const stash = (anchor?.data as { originalUrls?: Record<string, unknown> } | undefined)?.originalUrls;
    expect(stash?.href).toBe('https://example.com/a');
  });
});

describe('raw-HTML swallow invalidation (hastDigest)', () => {
  // rehype-raw's HTML parsing algorithm reparents every FOLLOWING top-level
  // sibling into an unclosed container tag. The container's mdast identity
  // (raw, position, ctx) is byte-identical across those frames, so before
  // hastDigest the first swallowed snapshot became a permanent cache hit —
  // trailing content froze inside the container and the synthetic footnote
  // section ended up duplicated (stale copy trapped in <details> + fresh
  // top-level copy) once the close tag arrived.

  const DOC = [
    '一段话[^1]。',
    '',
    '[^1]: 脚注内容。',
    '',
    '<details>',
    '<summary>标题</summary>',
    '',
    '内部段落',
    '',
    '</details>',
    '',
    '尾部段落',
    '',
  ].join('\n');

  function detailsNodeOf(built: ReturnType<typeof buildBlocks>, all: { node: ReactNode }[]) {
    const idx = built.plan.findIndex((p) => p.kind === 'block' && (p.el as HastElement).tagName === 'details');
    return idx === -1 ? undefined : { item: built.plan[idx], node: all[idx].node };
  }

  function rawFrame(content: string, cacheRef: { current: Cache }) {
    const { mdast, hast } = runPipeline(content);
    const built = buildBlocks(mdast, hast, content);
    const all = renderBlocksWithCache(cacheRef, built.plan, built.globalCtx, emptyPostOptions);
    return { built, all };
  }

  test.each([false, true])('FNV-1a 32-bit collision invalidates swallowed content (tainted=%s)', (tainted) => {
    // These equal-length strings collide after the swallowed "\n\n" prefix.
    // Appending the same reference suffix preserves that FNV-1a 32-bit collision.
    const pair = ['0f1yco9044uacz', '01lhtot1bfoy1h'];
    const source = (text: string) => `<details>\n\n${text}\n\n${tainted ? '[ref][x]\n\n[x]: /url\n' : ''}`;
    const cacheRef = { current: createCache() };
    const f1 = rawFrame(source(pair[0]), cacheRef);
    const d1 = detailsNodeOf(f1.built, f1.all)!;
    const f2 = rawFrame(source(pair[1]), cacheRef);
    const d2 = detailsNodeOf(f2.built, f2.all)!;

    expect(f1.built.blocks[0].hasReference).toBe(tainted);
    expect(f2.built.blocks[0].hasReference).toBe(tainted);
    expect(f2.built.blocks[0].hastDigest).toBe(f1.built.blocks[0].hastDigest);
    expect(f2.built.globalCtx).toBe(f1.built.globalCtx);
    expect(d2.node).not.toBe(d1.node);
    const html = renderToStaticMarkup(createElement(Fragment, null, d2.node));
    expect(html).toContain(pair[1]);
    expect(html).not.toContain(pair[0]);

    // Exact source equality still permits reuse after the corrected render.
    const f3 = rawFrame(source(pair[1]), cacheRef);
    expect(detailsNodeOf(f3.built, f3.all)!.node).toBe(d2.node);
  });

  test('unclosed <details> swallowing the footnote section re-renders when the extent changes', () => {
    const cacheRef = { current: createCache() };
    // F1: cut right after the swallowed 内部段落 starts — details contains
    // summary + partial paragraph + the swallowed footnote section.
    const f1 = rawFrame(DOC.slice(0, DOC.indexOf('内部段落') + 3), cacheRef);
    const d1 = detailsNodeOf(f1.built, f1.all);
    expect(d1).toBeDefined();
    const html1 = renderToStaticMarkup(createElement(Fragment, null, d1!.node));
    expect(html1).toContain('data-footnotes');

    // F2: more bytes, still unclosed — digest must differ, node must be fresh.
    const f2 = rawFrame(DOC.slice(0, DOC.indexOf('</details>')), cacheRef);
    const d2 = detailsNodeOf(f2.built, f2.all);
    expect(d2).toBeDefined();
    expect(d2!.node).not.toBe(d1!.node);

    // F3: fully closed document — the details block must re-render WITHOUT
    // the swallowed section, and the section must appear exactly once at
    // the document level.
    const f3 = rawFrame(DOC, cacheRef);
    const d3 = detailsNodeOf(f3.built, f3.all);
    expect(d3).toBeDefined();
    expect(d3!.node).not.toBe(d1!.node);
    const html3 = renderToStaticMarkup(createElement(Fragment, null, d3!.node));
    expect(html3).not.toContain('data-footnotes');
    const fullHtml = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        f3.all.map((r, i) => createElement(Fragment, { key: i }, r.node))
      )
    );
    expect(fullHtml.split('data-footnotes').length - 1).toBe(1);
  });

  test('v2.4.2 review P2-1: an equal-length replacement of swallowed content is a cache miss', () => {
    const cacheRef = { current: createCache() };
    const a = '<details>\n<summary>t</summary>\n\nAnswer: 42\n';
    const b = '<details>\n<summary>t</summary>\n\nAnswer: 43\n';
    const f1 = rawFrame(a, cacheRef);
    const d1 = detailsNodeOf(f1.built, f1.all);
    expect(renderToStaticMarkup(createElement(Fragment, null, d1!.node))).toContain('Answer: 42');
    // Same byte length, same node count, same maxEnd — only the swallowed
    // text differs. Before the source hash this was a stale cache hit.
    const f2 = rawFrame(b, cacheRef);
    const d2 = detailsNodeOf(f2.built, f2.all);
    expect(d2!.node).not.toBe(d1!.node);
    expect(renderToStaticMarkup(createElement(Fragment, null, d2!.node))).toContain('Answer: 43');
  });

  test('degenerate corner: swallowed section leaves no maxEnd trace (positions point backwards)', () => {
    // <details> closes with NOTHING inside except the summary, and the
    // footnote defs live BEFORE it — the swallowed section's positioned
    // descendants all end before the details' own end offset, so maxEnd
    // alone cannot distinguish the swallowed frame from the closed frame.
    // The descendant-count / dataFootnotes components must catch it.
    //
    // The blank line before </details> is load-bearing: it makes the close
    // tag its OWN html block, so the open-tag block's `raw` is byte-identical
    // between the unclosed and closed frames (matching the streaming shape
    // of the original bug). Without it the close tag joins the open block
    // and plain raw-invalidation would mask what this test targets.
    const doc = ['引用[^a]。', '', '[^a]: 定义。', '', '<details>', '<summary>x</summary>', '', '</details>', ''].join(
      '\n'
    );
    const cacheRef = { current: createCache() };
    // Unclosed frame: cut just before </details> — section gets swallowed.
    const f1 = rawFrame(doc.slice(0, doc.indexOf('</details>')), cacheRef);
    const d1 = detailsNodeOf(f1.built, f1.all);
    expect(d1).toBeDefined();
    expect(renderToStaticMarkup(createElement(Fragment, null, d1!.node))).toContain('data-footnotes');

    const f2 = rawFrame(doc, cacheRef);
    const d2 = detailsNodeOf(f2.built, f2.all);
    expect(d2).toBeDefined();
    expect(d2!.node).not.toBe(d1!.node);
    expect(renderToStaticMarkup(createElement(Fragment, null, d2!.node))).not.toContain('data-footnotes');
  });

  test('stable closed raw-HTML block stays a cache hit across appends elsewhere', () => {
    const closed = '<details>\n<summary>x</summary>\n\n体\n\n</details>\n\n尾巴';
    const cacheRef = { current: createCache() };
    const f1 = rawFrame(closed, cacheRef);
    const d1 = detailsNodeOf(f1.built, f1.all);
    const f2 = rawFrame(closed + '继续追加的文字', cacheRef);
    const d2 = detailsNodeOf(f2.built, f2.all);
    // Subtree unchanged → digest unchanged → referential cache hit preserved.
    expect(d2!.node).toBe(d1!.node);
  });

  test('markdown-native blocks skip the digest walk; raw-HTML blocks get one', () => {
    const { mdast, hast } = runPipeline('段落文字\n\n<details>\n<summary>x</summary>\n</details>\n');
    const built = buildBlocks(mdast, hast, '段落文字\n\n<details>\n<summary>x</summary>\n</details>\n');
    const para = built.plan.find((p) => p.kind === 'block' && (p.el as HastElement).tagName === 'p');
    const details = built.plan.find((p) => p.kind === 'block' && (p.el as HastElement).tagName === 'details');
    expect(para && para.kind === 'block' ? para.info.hastDigest : 'missing').toBeUndefined();
    expect(details && details.kind === 'block' ? details.info.hastDigest : undefined).toMatch(
      /^\d+:\d+:[01]:[0-9a-z]+$/
    );
  });

  test('range-fallback blocks (split raw HTML) also get a digest', () => {
    // Leading spaces make rehype-raw emit the <div> as a hast sibling whose
    // offset sits INSIDE the mdast html node's range — resolved via the
    // range-containment fallback, which must also opt into the digest.
    const doc = '   <div>内容</div>\n\n尾部\n';
    const { mdast, hast } = runPipeline(doc);
    const built = buildBlocks(mdast, hast, doc);
    const div = built.plan.find((p) => p.kind === 'block' && (p.el as HastElement).tagName === 'div');
    expect(div && div.kind === 'block' ? div.info.hastDigest : undefined).toMatch(/^\d+:\d+:[01]:[0-9a-z]+$/);
  });
});

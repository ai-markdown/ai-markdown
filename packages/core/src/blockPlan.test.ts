import { describe, expect, test } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import remarkSqueezeParagraphs from 'remark-squeeze-paragraphs';
import remarkRemoveComments from 'remark-remove-comments';
import rehypeRaw from '@ai-markdown/rehype-raw';
import { buildCrossChunkHandlers } from '@ai-markdown/engine';
import rehypeSanitize from 'rehype-sanitize';
import { VFile } from 'vfile';
import type { Element as HastElement, Root as HastRoot } from 'hast';
import type { Root as MdastRoot } from 'mdast';
import { sanitizeSchema } from '@ai-markdown/engine';
import { rehypeRebaseHashLinks } from '@ai-markdown/engine';
import {
  buildBlocks,
  computeBlockFingerprint,
  computeHtmlBlockDigestWithExtent,
  isFootnoteSection,
  hasMdastSource,
} from './blockPlan';
import { createRegistry } from '@ai-markdown/engine';
import { visit } from 'unist-util-visit';

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

describe('isFootnoteSection', () => {
  test('true for <section data-footnotes>', () => {
    const node: HastElement = {
      type: 'element',
      tagName: 'section',
      properties: { dataFootnotes: true },
      children: [],
    };
    expect(isFootnoteSection(node)).toBe(true);
  });

  test('false for <section> without dataFootnotes', () => {
    const node: HastElement = {
      type: 'element',
      tagName: 'section',
      properties: {},
      children: [],
    };
    expect(isFootnoteSection(node)).toBe(false);
  });

  test('false for <div data-footnotes> (wrong tag)', () => {
    const node: HastElement = {
      type: 'element',
      tagName: 'div',
      properties: { dataFootnotes: true },
      children: [],
    };
    expect(isFootnoteSection(node)).toBe(false);
  });
});

describe('hasMdastSource', () => {
  test('true when position is set', () => {
    const node: HastElement = {
      type: 'element',
      tagName: 'p',
      properties: {},
      children: [],
      position: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 2, offset: 1 } },
    };
    expect(hasMdastSource(node)).toBe(true);
  });

  test('false when position is missing', () => {
    const node: HastElement = {
      type: 'element',
      tagName: 'p',
      properties: {},
      children: [],
    };
    expect(hasMdastSource(node)).toBe(false);
  });
});

describe('buildBlocks', () => {
  test('raw HTML retains exact swallowed source when FNV-1a 32-bit digests collide', () => {
    // FNV-1a 32-bit collision for the swallowed "\n\n" + text interval.
    const pair = ['0f1yco9044uacz', '01lhtot1bfoy1h'];
    const blocks = pair.map((text) => {
      const source = `<details>\n\n${text}\n\n`;
      const { mdast, hast } = runPipeline(source);
      return buildBlocks(mdast, hast, source).blocks[0];
    });

    expect(blocks[0].raw).toBe(blocks[1].raw);
    expect(blocks[0].hastDigest).toBe('25:3:0:1sn45ex');
    expect(blocks[1].hastDigest).toBe(blocks[0].hastDigest);
    expect(blocks.map((block) => block.swallowedSource)).toEqual(pair.map((text) => `\n\n${text}`));
  });

  test('paragraph blocks: 1:1 with mdast top-level', () => {
    const { mdast, hast } = runPipeline('Hello\n\nWorld');
    const built = buildBlocks(mdast, hast, 'Hello\n\nWorld');
    expect(built.blocks).toHaveLength(2);
    expect(built.blockHasts).toHaveLength(2);
    expect(built.synthetic).toBeUndefined();
    expect(built.globalCtx).toBe('[]');
    expect(built.blocks[0].raw).toBe('Hello');
    expect(built.blocks[1].raw).toBe('World');
  });

  test('hast-driven: HTML comment removed by plugin does not break invariant', () => {
    const md = 'Hello\n\n<!-- comment -->\n\nWorld';
    const { mdast, hast } = runPipeline(md, { removeComments: true });
    const built = buildBlocks(mdast, hast, md);
    // remarkRemoveComments drops the html-comment paragraph from mdast →
    // hast has 2 elements, blocks must match.
    expect(built.blocks).toHaveLength(built.blockHasts.length);
    expect(built.blocks).toHaveLength(2);
  });

  test('hast-driven: empty paragraphs squeezed away', () => {
    // remarkSqueezeParagraphs removes paragraphs that contain no content.
    // Triple blank lines collapse — hast ends up with fewer top-level
    // elements than the raw mdast parse.
    const md = 'A\n\n\n\nB';
    const { mdast, hast } = runPipeline(md);
    const built = buildBlocks(mdast, hast, md);
    expect(built.blocks).toHaveLength(built.blockHasts.length);
  });

  test('synthetic footnote section detected and excluded from blocks', () => {
    const md = 'See[^x].\n\n[^x]: hello';
    const { mdast, hast } = runPipeline(md);
    const built = buildBlocks(mdast, hast, md);
    expect(built.synthetic).toBeDefined();
    expect(built.synthetic?.tagName).toBe('section');
    // The footnote definition is hoisted out of mdast.children and into the
    // synthetic section; only the paragraph "See[^x]." remains as a block.
    expect(built.blocks).toHaveLength(1);
    expect(built.blocks[0].hasReference).toBe(true);
  });

  test('an authored <section data-footnotes> is an ordinary block, not the synthetic section', () => {
    // Raw HTML the author wrote comes out of rehype-raw with a source
    // position; only the engine's footer has none. The authored element used
    // to take the `__footnote_section__` slot (and, coordinated, was dropped
    // for the aggregate) while the real footer collided with it.
    const md = '<section data-footnotes>\n\nmine\n\n</section>\n\nSee[^x].\n\n[^x]: hello';
    const { mdast, hast } = runPipeline(md);
    const built = buildBlocks(mdast, hast, md);
    expect(built.synthetic).toBeDefined();
    expect(built.synthetic?.position).toBeUndefined();
    const kinds = built.plan.filter((item) => item.kind !== 'inline').map((item) => item.kind);
    expect(kinds).toEqual(['block', 'block', 'synthetic']);
    expect(built.blocks[0].startOffset).toBe(0);
    expect(built.blockHasts[0].tagName).toBe('section');
    expect(built.blockHasts[0].position).toBeDefined();
  });

  test('globalCtx records footnoteRef order', () => {
    const md1 = 'A[^x] B[^y].\n\n[^x]: x\n\n[^y]: y';
    const md2 = 'A[^y] B[^x].\n\n[^x]: x\n\n[^y]: y';
    const r1 = runPipeline(md1);
    const r2 = runPipeline(md2);
    const c1 = buildBlocks(r1.mdast, r1.hast, md1).globalCtx;
    const c2 = buildBlocks(r2.mdast, r2.hast, md2).globalCtx;
    expect(c1).not.toBe(c2);
  });

  test('globalCtx serialization avoids separator collision', () => {
    const md = '[a:b]: https://x.com\n\n[a:b]\n\n[c]: https://y.com|d\n\n[c]';
    const { mdast, hast } = runPipeline(md);
    const built = buildBlocks(mdast, hast, md);
    // Just sanity-check JSON round-trips and contains both definitions.
    const parts = JSON.parse(built.globalCtx);
    expect(Array.isArray(parts)).toBe(true);
    expect(parts.length).toBeGreaterThan(0);
  });

  test('hasReference: tainted block flagged, untainted block not', () => {
    const md = 'See[^x].\n\nPlain.\n\n[^x]: hello';
    const { mdast, hast } = runPipeline(md);
    const built = buildBlocks(mdast, hast, md);
    expect(built.blocks).toHaveLength(2);
    const seeBlock = built.blocks.find((b) => b.raw.startsWith('See'));
    const plainBlock = built.blocks.find((b) => b.raw === 'Plain.');
    expect(seeBlock?.hasReference).toBe(true);
    expect(plainBlock?.hasReference).toBe(false);
  });

  test('internal hash link is NOT tainted', () => {
    const md = 'Text [link](#x).';
    const { mdast, hast } = runPipeline(md);
    const built = buildBlocks(mdast, hast, md);
    expect(built.blocks).toHaveLength(1);
    expect(built.blocks[0].hasReference).toBe(false);
  });
});

describe('buildBlocks — edge documents', () => {
  test('empty content: no blocks, no synthetic', () => {
    const { mdast, hast } = runPipeline('');
    const built = buildBlocks(mdast, hast, '');
    expect(built.blocks).toHaveLength(0);
    expect(built.synthetic).toBeUndefined();
  });

  test('orphan footnoteDefinition only: no blocks, no synthetic (no refs to hoist)', () => {
    // gfm parses `[^x]: hi` but mdast-util-to-hast only synthesizes the
    // section when there's at least one footnoteReference. Without refs,
    // the def is dropped and we get an empty doc.
    const md = '[^x]: hi';
    const { mdast, hast } = runPipeline(md);
    const built = buildBlocks(mdast, hast, md);
    expect(built.blocks).toHaveLength(0);
    expect(built.synthetic).toBeUndefined();
  });
});

describe('buildBlocks — React key uniqueness', () => {
  test('multi-root raw HTML produces unique React keys despite shared mdast source', () => {
    // Regression: prior implementation used `block-${mdastStart}` as the key,
    // causing both hast <div>s (which share one mdast `html` node) to collide
    // on the same React key. Keys are now derived from each hast element's
    // own offset, which is unique per rendered top-level child.
    const md = '<div>A</div><div>B</div>';
    const { mdast, hast } = runPipeline(md);
    const built = buildBlocks(mdast, hast, md);
    const blockKeys = built.plan
      .filter((p): p is Extract<typeof p, { kind: 'block' }> => p.kind === 'block')
      .map((p) => p.key);
    expect(blockKeys.length).toBeGreaterThan(1);
    expect(new Set(blockKeys).size).toBe(blockKeys.length);
  });

  test('all plan items have globally unique key within the plan', () => {
    // Stronger: any pair of plan items (block / inline / synthetic) must have
    // distinct React keys, otherwise React will warn and reuse fibers wrongly.
    const md = '<div>A</div><div>B</div>\n\nSee[^x].\n\n   <span>indented</span>\n\n[^x]: x';
    const { mdast, hast } = runPipeline(md);
    const built = buildBlocks(mdast, hast, md);
    const allKeys = built.plan.map((p) => p.key);
    expect(new Set(allKeys).size).toBe(allKeys.length);
  });
});

describe('buildBlocks — footnoteDefinition fallback parity', () => {
  test('range-fallback resolving to a footnoteDefinition preserves the hast element as inline', () => {
    // Defensive parity with the other no-counterpart fallbacks: if a future
    // rehype plugin synthesizes a hast element whose offset lands inside a
    // footnoteDefinition's mdast source range, it must be rendered as inline
    // (preserved), NOT silently dropped from the plan.
    const md = 'See[^x].\n\n[^x]: hello';
    const { mdast, hast } = runPipeline(md);
    // mdast `[^x]: hello` spans some offset range (e.g., [10, 21]).
    const footnoteDef = mdast.children.find((c) => c.type === 'footnoteDefinition');
    expect(footnoteDef).toBeDefined();
    const startOffset = footnoteDef!.position?.start.offset;
    expect(startOffset).toBeDefined();
    const innerOffset = startOffset! + 1;

    // Inject a synthetic hast element whose offset falls inside that range
    // but doesn't exact-match any mdast node — forces the range fallback.
    hast.children.push({
      type: 'element',
      tagName: 'span',
      properties: {},
      children: [],
      position: {
        start: { line: 1, column: 1, offset: innerOffset },
        end: { line: 1, column: 2, offset: innerOffset + 1 },
      },
    });

    const built = buildBlocks(mdast, hast, md);
    // The synthetic span must appear as inline in the plan (preserved).
    const inlineFromFallback = built.plan.find((p) => p.kind === 'inline' && (p.el as HastElement).tagName === 'span');
    expect(inlineFromFallback).toBeDefined();
  });
});

describe('buildBlocks per-block taintLabels (v6)', () => {
  test('records footnoteRef labels per block', () => {
    // Refs only parse as footnoteReference when a matching definition exists;
    // include definitions so the paragraph block contains real ref nodes.
    const source = 'See [^x] and [^y].\n\n[^x]: x\n\n[^y]: y';
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);
    const mdast = processor.parse(source);
    const hast = processor.runSync(mdast) as HastRoot;
    const built = buildBlocks(mdast as MdastRoot, hast, source);

    const blk = built.blocks[0];
    expect(blk.hasReference).toBe(true);
    expect(blk.taintLabels).toBeDefined();
    expect(blk.taintLabels!.footnoteRefLabels.sort()).toEqual(['X', 'Y']);
  });

  test('records linkRef + imageRef + footnoteDef separately', () => {
    // Link/image refs need matching definitions to parse as reference nodes.
    const source = '[click][a] and ![alt][b].\n\n[a]: /a\n\n[b]: /b\n\n[^c]: def text';
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);
    const mdast = processor.parse(source);
    const hast = processor.runSync(mdast) as HastRoot;
    const built = buildBlocks(mdast as MdastRoot, hast, source);
    // First TAINT block: linkRef + imageRef
    const para = built.blocks.find((b) => b.taintLabels?.linkRefLabels.length);
    expect(para?.taintLabels?.linkRefLabels).toEqual(['A']);
    expect(para?.taintLabels?.imageRefLabels).toEqual(['B']);
    // The footnoteDefinition lives in synthetic footer typically; here treat as block-level
    // (synthetic is a separate plan item; this test only verifies non-synthetic blocks).
  });

  test('2026-08-19 review P2-4: chunk-local footnote occurrence state is part of the taint footprint', () => {
    // block1 `a[^w] b[^x]`, block2 `c[^x]`: block2's raw and registry answers
    // do not change when block1's `[^x]` becomes `[^w]` in place, but the
    // engine bakes localOccurrence(x)=2 vs 1 into block2's placeholder — the
    // fingerprint must see the prefix change.
    const build = (source: string) => {
      const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);
      const mdast = processor.parse(source);
      const hast = processor.runSync(mdast) as HastRoot;
      return buildBlocks(mdast as MdastRoot, hast, source);
    };
    const before = build('a[^w] b[^x]\n\nc[^x]\n\n[^w]: w\n\n[^x]: x');
    const after = build('a[^w] b[^w]\n\nc[^x]\n\n[^w]: w\n\n[^x]: x');
    const b2Before = before.blocks[1];
    const b2After = after.blocks[1];
    expect(b2Before.raw).toBe(b2After.raw);
    expect(b2Before.taintLabels!.footnoteRefLabels).toEqual(['X']);
    expect(b2Before.taintLabels!.footnoteRefLocalCtx).toBe(JSON.stringify([['X', 1, 1]]));
    expect(b2After.taintLabels!.footnoteRefLocalCtx).toBe(JSON.stringify([['X', 0, 1]]));
    // …and the fingerprint differs even against an identical registry.
    const reg = createRegistry();
    const sym = reg.allocateSymbol('chunk-A');
    reg.contributeChunkData(sym, {
      refs: [
        { label: 'W', kind: 'footnote' },
        { label: 'X', kind: 'footnote' },
      ],
      defs: new Map(),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(),
      ownLinkLabels: new Set(),
    });
    expect(computeBlockFingerprint(b2Before.taintLabels!, reg, sym, 'doc-')).not.toBe(
      computeBlockFingerprint(b2After.taintLabels!, reg, sym, 'doc-')
    );
    // Blocks without refs carry no local ctx.
    expect(build('plain\n\n[a]: /u\n\n[x][a]').blocks[0].taintLabels).toBeUndefined();
    // A ref inside a (list-nested) footnote definition is footer-rendered
    // AFTER every body ref — it must not shift a later body block's count.
    const nested = build('- item\n\n  [^x]: def with [^y] ref\n\nlater [^y]\n\n[^y]: y');
    const later = nested.blocks.find((b) => b.raw.startsWith('later'))!;
    expect(later.taintLabels!.footnoteRefLocalCtx).toBe(JSON.stringify([['Y', 0, 1]])); // rank 1: the nested [^x] definition took rank 0
  });

  test('2026-08-19 review r2 P2-8/P2-9: an unclosed raw-HTML container reads its taint from the swallowed subtree', () => {
    // rehype-raw reparents the following siblings into an unclosed
    // `<details>`; the container's own mdast node is an empty `html` node,
    // so every mdast-derived taint fact used to come out empty and the block
    // fell back to the un-fingerprinted cache key.
    const build = (source: string) => {
      const processor = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeRaw);
      const mdast = processor.parse(source);
      const hast = processor.runSync(mdast, source) as HastRoot;
      return buildBlocks(mdast as MdastRoot, hast, source);
    };
    const src = 'a[^w] b[^x]\n\n<details>\n\nc[^x]\n\n[^w]: w\n\n[^x]: x\n';
    const built = build(src);
    const container = built.blocks.find((b) => b.raw.startsWith('<details>'));
    expect(container, 'the unclosed container is a cached block').toBeDefined();
    // It now declares itself tainted and carries the labels + the local
    // occurrence values BAKED into the swallowed placeholders/marks.
    expect(container!.hasReference).toBe(true);
    // …and it reports that the synthesized footnote section landed inside.
    expect(container!.containsFootnoteSection).toBe(true);
    // The top-level plan therefore has NO synthetic item — which is exactly
    // why coordinated mode has to strip the section from this block instead.
    expect(built.synthetic).toBeUndefined();
    // Why `hasReference` is the whole point: an equal-length edit BEFORE the
    // container changes a footnote number baked INSIDE it (`b[^x]` → `b[^w]`
    // makes the swallowed `c[^x]` x's 1st ref, not its 2nd), while every
    // legacy key component of the container stays identical.
    const after = build('a[^w] b[^w]\n\n<details>\n\nc[^x]\n\n[^w]: w\n\n[^x]: x\n');
    const afterContainer = after.blocks.find((b) => b.raw.startsWith('<details>'))!;
    expect(afterContainer.raw).toBe(container!.raw);
    expect(afterContainer.startOffset).toBe(container!.startOffset);
    expect(afterContainer.hastDigest).toBe(container!.hastDigest);
    // With `hasReference` false (the old behaviour) the cache key was
    // `(raw, occ, '', position, hastDigest)` — identical across both frames,
    // a guaranteed stale hit. Now the block is tainted, so its ctx is the
    // document-wide globalCtx in standalone mode…
    expect(afterContainer.hasReference).toBe(true);
    expect(after.globalCtx).not.toBe(built.globalCtx);
    // …and in coordinated mode the swallowed `footnote-sup` placeholders
    // contribute their baked localOccurrence to the fingerprint as well
    // (scanSwallowedSubtree); standalone marks carry no such props, which is
    // why the flag alone has to carry that case.
    expect(container!.taintLabels).toBeDefined();

    // A standalone LINK reference inside the container renders as a plain
    // `<a href>` — indistinguishable from an inline link in the hast — so the
    // subtree scan cannot see it. When its definition sits BEFORE the
    // container it is also outside the digest's swallowed extent, and every
    // cache-key component stayed equal while the rendered href changed. The
    // mdast range test (taint offsets inside `[ownEnd, maxEnd)`) covers it.
    const linkBefore = build('[r]: /aaa\n\n<details>\n\nsee [u][r]\n');
    const linkAfter = build('[r]: /bbb\n\n<details>\n\nsee [u][r]\n');
    const lb = linkBefore.blocks.find((b) => b.raw.startsWith('<details'))!;
    const la = linkAfter.blocks.find((b) => b.raw.startsWith('<details'))!;
    expect(lb.hastDigest).toBe(la.hastDigest); // the edit is outside the swallowed extent
    expect(lb.hasReference).toBe(true); // …so only the taint flag separates the frames
    expect(linkBefore.globalCtx).not.toBe(linkAfter.globalCtx);
  });

  test('2026-08-20 B2: a phantom label takes no rank, so a phantom→real flip invalidates the blocks it renumbers', () => {
    // `localNumber` is `state.footnoteOrder.indexOf(id) + 1`, and phantom
    // labels never enter footnoteOrder — the handlers return early for both
    // their definition and their references. The cache's rank counted them
    // anyway, so when a cross-chunk label's definition arrived locally and
    // every LATER footnote was renumbered, the rank did not move: same raw,
    // same position, same key, and the cached superscript kept reading 1
    // under a footer numbering it 2.
    const buildWithPhantoms = (source: string, phantoms: string[]) => {
      const processor = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkRehype, {
          allowDangerousHtml: true,
          handlers: buildCrossChunkHandlers(),
          phantomFootnoteLabels: new Set(phantoms),
          preserveOrphan: false,
          documentId: 'doc',
        } as never)
        .use(rehypeRaw);
      const mdast = processor.parse(source);
      const hast = processor.runSync(mdast, source) as HastRoot;
      return {
        built: buildBlocks(mdast as MdastRoot, hast, source, { phantomFootnoteLabels: new Set(phantoms) }),
        hast,
      };
    };
    const bakedNumbers = (hast: HastRoot) => {
      const out: Array<[string, unknown]> = [];
      visit(hast, 'element', (el: HastElement) => {
        if (el.tagName === 'footnote-sup') out.push([String(el.properties?.label), el.properties?.localNumber]);
      });
      return out;
    };

    // Frame 1: `[^A]` is defined by ANOTHER chunk, so the pipeline injects a
    // phantom definition for it. Frame 2: A's real definition has arrived.
    const before = buildWithPhantoms('see [^A]\n\nsee [^B]\n\n[^B]: bee\n\n[^A]: __aimd_sentinel_fn__\n', ['A']);
    const after = buildWithPhantoms('see [^A]\n\nsee [^B]\n\n[^B]: bee\n\n[^A]: ay\n', []);

    // The premise: B really is renumbered, and nothing else about its block
    // moved — without both halves the test proves nothing.
    expect(bakedNumbers(before.hast)).toEqual([
      ['a', undefined],
      ['b', '1'],
    ]);
    expect(bakedNumbers(after.hast)).toEqual([
      ['a', '1'],
      ['b', '2'],
    ]);
    const blockBefore = before.built.blocks.find((b) => b.raw === 'see [^B]')!;
    const blockAfter = after.built.blocks.find((b) => b.raw === 'see [^B]')!;
    expect(blockAfter.startOffset).toBe(blockBefore.startOffset);
    expect(blockAfter.raw).toBe(blockBefore.raw);

    // …so the local ctx is the only thing that can separate the two frames.
    expect(blockBefore.taintLabels?.footnoteRefLocalCtx).not.toBe(blockAfter.taintLabels?.footnoteRefLocalCtx);

    // And it reaches the fingerprint, which is what the cache keys on.
    const reg = createRegistry();
    const sym = reg.allocateSymbol('chunk');
    expect(computeBlockFingerprint(blockBefore.taintLabels!, reg, sym, '')).not.toBe(
      computeBlockFingerprint(blockAfter.taintLabels!, reg, sym, '')
    );
  });

  test('2026-08-19 review r2 P2-8, coordinated leg: swallowed placeholders carry their baked occurrence into the fingerprint', () => {
    // The standalone leg is covered above; this is the leg the whole P2-8
    // fix exists for — a coordinated pipeline bakes `localOccurrence` into
    // `footnote-sup` placeholders, and an unclosed container swallows them.
    const buildCoordinated = (source: string) => {
      const processor = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkRehype, {
          allowDangerousHtml: true,
          handlers: buildCrossChunkHandlers(),
          // The handler reads these off `state.options`.
          phantomFootnoteLabels: new Set<string>(),
          preserveOrphan: false,
          documentId: 'doc',
        } as never)
        .use(rehypeRaw);
      const mdast = processor.parse(source);
      const hast = processor.runSync(mdast, source) as HastRoot;
      return buildBlocks(mdast as MdastRoot, hast, source);
    };
    // `b[^x]` → `b[^w]` is equal-length and sits BEFORE the container, so the
    // container's raw/position/digest are untouched — but it changes the
    // swallowed `c[^x]` from x's 2nd occurrence to its 1st.
    const before = buildCoordinated('a[^w] b[^x]\n\n<details>\n\nc[^x]\n\n[^w]: w\n\n[^x]: x\n');
    const after = buildCoordinated('a[^w] b[^w]\n\n<details>\n\nc[^x]\n\n[^w]: w\n\n[^x]: x\n');
    const cb = before.blocks.find((b) => b.raw.startsWith('<details'))!;
    const ca = after.blocks.find((b) => b.raw.startsWith('<details'))!;
    expect(cb.hastDigest).toBe(ca.hastDigest);
    expect(cb.startOffset).toBe(ca.startOffset);
    // The placeholder scan is what separates the two frames here.
    expect(cb.taintLabels?.footnoteRefLabels).toContain('X');
    expect(cb.taintLabels?.footnoteRefLocalCtx).toBeDefined();
    expect(cb.taintLabels!.footnoteRefLocalCtx).not.toBe(ca.taintLabels!.footnoteRefLocalCtx);
    // …and it reaches the fingerprint, which is what the cache actually keys on.
    const reg = createRegistry();
    const sym = reg.allocateSymbol('chunk');
    reg.contributeChunkData(sym, {
      refs: [{ label: 'X', kind: 'footnote' }],
      defs: new Map(),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(),
      ownLinkLabels: new Set(),
    });
    expect(computeBlockFingerprint(cb.taintLabels!, reg, sym, 'doc-')).not.toBe(
      computeBlockFingerprint(ca.taintLabels!, reg, sym, 'doc-')
    );
  });

  test('non-TAINT block has taintLabels undefined', () => {
    const source = 'Just plain text.';
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);
    const mdast = processor.parse(source);
    const hast = processor.runSync(mdast) as HastRoot;
    const built = buildBlocks(mdast as MdastRoot, hast, source);
    expect(built.blocks[0].hasReference).toBe(false);
    expect(built.blocks[0].taintLabels).toBeUndefined();
  });
});

describe('computeBlockFingerprint (v6)', () => {
  test('empty taintLabels yields just clobberPrefix', () => {
    const reg = createRegistry();
    const sym = Symbol('chunk');
    const fp = computeBlockFingerprint(
      { footnoteRefLabels: [], linkRefLabels: [], imageRefLabels: [], footnoteDefLabels: [] },
      reg,
      sym,
      'doc-user-content-'
    );
    expect(fp).toBe('doc-user-content-');
  });

  test('footnote ref label encoded with globalNumber', () => {
    const reg = createRegistry();
    const sym = reg.allocateSymbol('chunk-A');
    reg.contributeChunkData(sym, {
      refs: [{ label: 'X', kind: 'footnote' }],
      defs: new Map(),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(),
      ownLinkLabels: new Set(),
    });
    const fp = computeBlockFingerprint(
      { footnoteRefLabels: ['X'], linkRefLabels: [], imageRefLabels: [], footnoteDefLabels: [] },
      reg,
      sym,
      'doc-user-content-'
    );
    expect(fp).toBe('doc-user-content-|fn:X=1');
  });

  test('v2.4.1 review: a `|` inside url/title cannot collide with the part separator', () => {
    const taint = { footnoteRefLabels: [], linkRefLabels: ['X'], imageRefLabels: [], footnoteDefLabels: [] };
    const fpFor = (url: string, title: string | undefined): string => {
      const reg = createRegistry();
      const sym = reg.allocateSymbol('chunk-A');
      reg.contributeChunkData(sym, {
        refs: [],
        defs: new Map(),
        linkDefs: new Map([['X', { identifier: 'X', url, title }]]),
        ownFootnoteLabels: new Set(),
        ownLinkLabels: new Set(['X']),
      });
      return computeBlockFingerprint(taint, reg, sym, 'doc-');
    };
    expect(fpFor('a|b', undefined)).not.toBe(fpFor('a', 'b'));
    expect(fpFor('a', 'b')).toBe(fpFor('a', 'b'));
  });

  test('canonical change in registry → different fingerprint', () => {
    const reg = createRegistry();
    const a = reg.allocateSymbol('chunk-A');
    const b = reg.allocateSymbol('chunk-B');
    reg.contributeChunkData(a, {
      refs: [],
      defs: new Map([['X', { identifier: 'X', contentSource: 'A' }]]),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(['X']),
      ownLinkLabels: new Set(),
    });
    const taint = { footnoteRefLabels: [], linkRefLabels: [], imageRefLabels: [], footnoteDefLabels: ['X'] };
    const fpAFirst = computeBlockFingerprint(taint, reg, a, 'doc-');
    // A is canonical, fingerprint encodes 1
    expect(fpAFirst).toContain('fd:X=1');
    const fpBFirst = computeBlockFingerprint(taint, reg, b, 'doc-');
    // B is non-canonical, fingerprint encodes 0
    expect(fpBFirst).toContain('fd:X=0');
    expect(fpAFirst).not.toBe(fpBFirst);
  });

  test('refCount included in footnoteDef fingerprint', () => {
    const reg = createRegistry();
    const a = reg.allocateSymbol('A');
    reg.contributeChunkData(a, {
      refs: [
        { label: 'X', kind: 'footnote' },
        { label: 'X', kind: 'footnote' },
      ],
      defs: new Map(),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(),
      ownLinkLabels: new Set(),
    });
    const fp = computeBlockFingerprint(
      { footnoteRefLabels: [], linkRefLabels: [], imageRefLabels: [], footnoteDefLabels: ['X'] },
      reg,
      a,
      'doc-'
    );
    expect(fp).toContain('/2');
  });

  test('image title change invalidates fingerprint (v6.1 blocker 2 fix)', () => {
    const reg = createRegistry();
    const a = reg.allocateSymbol('A');
    const taint = { footnoteRefLabels: [], linkRefLabels: [], imageRefLabels: ['X'], footnoteDefLabels: [] };
    reg.contributeChunkData(a, {
      refs: [],
      defs: new Map(),
      linkDefs: new Map([['X', { identifier: 'X', url: 'https://x.png', title: 'first' }]]),
      ownFootnoteLabels: new Set(),
      ownLinkLabels: new Set(['X']),
    });
    const fp1 = computeBlockFingerprint(taint, reg, a, 'doc-');
    reg.contributeChunkData(a, {
      refs: [],
      defs: new Map(),
      linkDefs: new Map([['X', { identifier: 'X', url: 'https://x.png', title: 'second' }]]),
      ownFootnoteLabels: new Set(),
      ownLinkLabels: new Set(['X']),
    });
    const fp2 = computeBlockFingerprint(taint, reg, a, 'doc-');
    expect(fp1).not.toBe(fp2); // title delta must invalidate cache
  });

  test('cross-chunk refCount aggregation (v6.1 spec clarification)', () => {
    const reg = createRegistry();
    const a = reg.allocateSymbol('A');
    const b = reg.allocateSymbol('B');
    // A defines X but has no refs to X locally
    reg.contributeChunkData(a, {
      refs: [],
      defs: new Map([['X', { identifier: 'X', contentSource: 'def in A' }]]),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(['X']),
      ownLinkLabels: new Set(),
    });
    // Initial fingerprint for A's def block: refCount 0
    const taint = { footnoteRefLabels: [], linkRefLabels: [], imageRefLabels: [], footnoteDefLabels: ['X'] };
    const fpBefore = computeBlockFingerprint(taint, reg, a, 'doc-');
    expect(fpBefore).toContain('fd:X=1/0');
    // B contributes a ref to X (cross-chunk). registry.getRefsForLabel('X') should rise to 1.
    reg.contributeChunkData(b, {
      refs: [{ label: 'X', kind: 'footnote' }],
      defs: new Map(),
      linkDefs: new Map(),
      ownFootnoteLabels: new Set(),
      ownLinkLabels: new Set(),
    });
    const fpAfter = computeBlockFingerprint(taint, reg, a, 'doc-');
    expect(fpAfter).toContain('fd:X=1/1');
    expect(fpBefore).not.toBe(fpAfter); // A's def block must invalidate
  });
});

describe('buildBlocks — raw HTML', () => {
  test('2026-08-20 A1: the swallowed extent reaches everything the container actually swallowed', () => {
    // `maxEnd` bounds the source range a raw-HTML container is held
    // responsible for, and every use of it is unsafe in the SHORT direction:
    // too small and a swallowed reference falls outside the taint test, so a
    // definition edit outside the container leaves a stale href in the cache.
    // Two independent sources feed it — the container's own hast end offset
    // (rehype-raw reparses the raw string and closes the element wherever
    // parse5 does, which is past the swallowed blocks) and the max end over
    // its hast descendants. Either one alone covers every shape below; the
    // pin is here so an upgrade that changes how positions survive the
    // reparse fails loudly instead of silently under-tainting.
    const openers = [
      '<details>',
      '<details>\n<summary>s</summary>',
      '<div>',
      '<div class="a">',
      '<section>',
      '<blockquote>',
      '<span>',
      '<table>',
      '<table>\n<tbody>',
      '<table>\n<tr><td>c</td></tr>',
      '<ul>',
      '<ul>\n<li>i</li>',
      '<dl>',
      '<p>',
      '<div>\n<div>\n<div>',
      '<select>',
      '<button>',
      '<a href="#z">',
      '<td>',
      '<tr>',
      '<li>',
      '<summary>',
      '<div><!-- c -->',
      '<div a="b>c">',
      '<h1>',
      '<pre>',
      '<code>',
    ];
    const tails = [
      'See [x].',
      'para one\n\npara two [x]\n\npara three',
      '- a\n- b [x]\n\n> quote [x]\n',
      '| h |\n| - |\n| [x] |\n',
      '```\ncode [x]\n```\n\ntext [x]',
      '![y][x]\n\n### head [x]\n\nfinal',
    ];
    const tooShort: string[] = [];
    const inert: string[] = [];
    let checked = 0;
    for (const opener of openers) {
      for (const tail of tails) {
        const md = `[x]: https://a.example\n\n${opener}\n\n${tail}\n`;
        const { mdast, hast } = runPipeline(md);
        const containerIdx = mdast.children.findIndex((c) => c.type === 'html');
        if (containerIdx < 0) continue;
        const container = mdast.children[containerIdx];
        const ownEnd = container.position!.end!.offset!;
        const built = buildBlocks(mdast, hast, md);
        // Anything after the container that no longer has a top-level block
        // of its own was swallowed by it.
        const topStarts = new Set<number>();
        for (const item of built.plan) if (item.kind === 'block') topStarts.add(item.info.startOffset);
        let trueEnd = ownEnd;
        for (const node of mdast.children.slice(containerIdx + 1)) {
          const start = node.position?.start?.offset;
          const end = node.position?.end?.offset;
          if (start === undefined || end === undefined) continue;
          // Definitions render nothing of their own, so their absence from
          // the plan says nothing about who swallowed them.
          if (node.type === 'definition' || node.type === 'footnoteDefinition') continue;
          if (!topStarts.has(start)) trueEnd = Math.max(trueEnd, end);
        }
        const el = hast.children.find(
          (c): c is HastElement =>
            c.type === 'element' && c.position?.start?.offset === container.position!.start!.offset
        );
        // Sanitize drops some openers outright (`<figure>`, `<svg>`); nothing
        // to hold responsible then.
        if (el === undefined) continue;
        checked += 1;
        const { maxEnd } = computeHtmlBlockDigestWithExtent(el, md, ownEnd);
        const label = `${JSON.stringify(opener)} + ${JSON.stringify(tail.slice(0, 16))}`;
        if (maxEnd < trueEnd) tooShort.push(`${label}: maxEnd=${maxEnd} < ${trueEnd}`);
        if (trueEnd > ownEnd && maxEnd <= ownEnd) inert.push(`${label}: swallowed, extent empty`);
      }
    }
    expect({ tooShort, inert }).toEqual({ tooShort: [], inert: [] });
    expect(checked).toBeGreaterThan(100);
  });
  test('indented raw HTML: hast div at offset 3, mdast html at 0 — range fallback wins', () => {
    // `   <div>Hi</div>` → one mdast `html` node spanning [0,16]; hast emits
    // a leading text node and a `<div>` element starting at offset 3. The
    // exact-offset Map miss for offset 3 forces the range-containment
    // findLast fallback to recover the mdast html as the source.
    const md = '   <div>Hi</div>';
    const { mdast, hast } = runPipeline(md);
    const built = buildBlocks(mdast, hast, md);
    expect(built.blocks).toHaveLength(1);
    expect(built.blocks[0].startOffset).toBe(0);
    expect(built.blocks[0].raw).toBe(md);
  });
  test('multi-root raw HTML: two hast divs share one mdast html — bucket has both', () => {
    // One mdast html node at [0,24] becomes two sibling divs in hast at
    // [0,12] and [12,24]. Both look up to the same mdast counterpart →
    // identical raw → bucket array carries two occurrences.
    const md = '<div>A</div><div>B</div>';
    const { mdast, hast } = runPipeline(md);
    const built = buildBlocks(mdast, hast, md);
    expect(built.blocks).toHaveLength(2);
    expect(built.blocks[0].raw).toBe(md);
    expect(built.blocks[1].raw).toBe(md);
    expect(built.blocks[0].startOffset).toBe(built.blocks[1].startOffset);
  });
});

describe('buildBlocks — synthesized hast nodes', () => {
  test('throws when a hast block has no mdast counterpart', () => {
    // Simulate a rehype plugin that synthesized a block at an offset that
    // does not correspond to any mdast top-level node nor any range.
    const mdast: MdastRoot = { type: 'root', children: [] };
    const hast: HastRoot = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'div',
          properties: {},
          children: [],
          position: {
            start: { line: 1, column: 1, offset: 999 },
            end: { line: 1, column: 2, offset: 1000 },
          },
        },
      ],
    };
    expect(() => buildBlocks(mdast, hast, '')).toThrow(/no mdast counterpart/);
  });
  test('synthesized <div> without position is rendered as inline, NOT misidentified as footnote section', () => {
    // A rehype plugin might append a position-less <div>. `isFootnoteSection`
    // checks tagName + dataFootnotes, so this div must NOT be promoted to
    // `synthetic`. Without an mdast counterpart (no offset), it falls into
    // the inline path — rendered every frame, never cached, but content is
    // preserved (we don't silently drop user content).
    const md = 'Hi';
    const { mdast, hast } = runPipeline(md);
    hast.children.push({
      type: 'element',
      tagName: 'div',
      properties: {},
      children: [],
    });
    const built = buildBlocks(mdast, hast, md);
    expect(built.synthetic).toBeUndefined();
    expect(built.blocks).toHaveLength(1);
    // The orphan div is in the plan as inline (preserves it in render output).
    expect(built.plan.some((p) => p.kind === 'inline' && p.el === hast.children[hast.children.length - 1])).toBe(true);
  });
});

describe('buildBlocks — inline (non-element) top-level children', () => {
  test('whitespace text between blocks is included in plan as inline items', () => {
    // mdast-util-to-hast inserts `\n` text nodes between top-level block
    // elements. They must survive into the plan so renderBlocksWithCache
    // can re-emit them — preserving react-markdown's byte-equivalent output.
    const md = 'Hello\n\nWorld';
    const { mdast, hast } = runPipeline(md);
    const built = buildBlocks(mdast, hast, md);
    expect(built.blocks).toHaveLength(2);
    const inlines = built.plan.filter((p) => p.kind === 'inline');
    expect(inlines.length).toBeGreaterThan(0);
    // Plan order: block, inline, block (at minimum).
    expect(built.plan[0].kind).toBe('block');
    expect(built.plan[built.plan.length - 1].kind).toBe('block');
  });
  test('inline items get stable React keys (offset-based when position is set, index-based fallback otherwise)', () => {
    // mdast-util-to-hast sometimes omits `position` on the synthesized
    // whitespace text nodes it inserts between block elements. Both key
    // forms are stable across re-renders:
    //   - `inline-${offset}`: when the node carries position
    //   - `inline-i${planIndex}`: index in the plan (stable as long as
    //     document structure doesn't change between adjacent frames)
    const md = 'A\n\nB';
    const { mdast, hast } = runPipeline(md);
    const built = buildBlocks(mdast, hast, md);
    const inline = built.plan.find((p) => p.kind === 'inline');
    expect(inline).toBeDefined();
    expect(inline!.key).toMatch(/^inline-(\d+|i\d+)$/);
  });
  test('synthetic footnote section appears as kind=synthetic in plan, last position', () => {
    const md = 'See[^x].\n\n[^x]: hello';
    const { mdast, hast } = runPipeline(md);
    const built = buildBlocks(mdast, hast, md);
    const synthetic = built.plan.find((p) => p.kind === 'synthetic');
    expect(synthetic).toBeDefined();
    expect(synthetic!.key).toBe('__footnote_section__');
    expect(built.plan.findIndex((p) => p.kind === 'synthetic')).toBe(built.plan.length - 1);
  });
});

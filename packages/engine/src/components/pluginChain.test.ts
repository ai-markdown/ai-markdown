/**
 * Pins the order-independence contract of the produced chain: the canonical
 * per-stage tables — not the caller's array order — fix each plugin's splice
 * position (see `buildCoreRemarkPlugins`). The property currently holds by
 * construction; this test keeps it holding through future refactors.
 */
import { describe, expect, test } from 'vitest';
import { h } from 'hastscript';
import rehypeKatex from 'rehype-katex';
import rehypeUnwrapImages from 'rehype-unwrap-images';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import rehypeRawGuard from './rehypeRawGuard';
import rehypeSanitize from 'rehype-sanitize';
import remarkPangu from 'remark-pangu';
import remarkSmartypants from 'remark-smartypants';
import type { Root as HastRoot, RootContent as HastContent } from 'hast';
import { buildCoreRehypePlugins, buildCoreRemarkPlugins, buildCoreRemarkRehypeOptions } from './pluginChain';
import { rehypeUnwrapCrossChunkImages } from './rehypeUnwrapCrossChunkImages';
import { parseStage, transformStage } from './markdown';
import { rehypeVerifyEngineTags } from './rehypeVerifyEngineTags';
import { sanitizeSchema } from './sanitizeSchema';
import type { CrossChunkHandlerOptions } from './customMdastHandlers';
import { defaultEnginePlugins, highlight, pangu, smartypants } from '../plugins/catalog';
import type { AIMarkdownEnginePlugin } from '../plugins/defs';

/** Unwrap `[plugin, options]` tuples to the plugin function for identity comparison. */
function chainShape(chain: ReturnType<typeof buildCoreRemarkPlugins>) {
  return chain.map((entry) => (Array.isArray(entry) ? entry[0] : entry));
}

describe('buildCoreRemarkPlugins — user array order independence', () => {
  test('reversed full selection produces the identical chain', () => {
    const forward = buildCoreRemarkPlugins(defaultEnginePlugins);
    const reversed = buildCoreRemarkPlugins([...defaultEnginePlugins].reverse());
    expect(chainShape(reversed)).toEqual(chainShape(forward));
  });

  test('partial selections agree regardless of order', () => {
    const a = buildCoreRemarkPlugins([highlight, pangu, smartypants]);
    const b = buildCoreRemarkPlugins([smartypants, highlight, pangu]);
    const c = buildCoreRemarkPlugins([pangu, smartypants, highlight]);
    expect(chainShape(b)).toEqual(chainShape(a));
    expect(chainShape(c)).toEqual(chainShape(a));
  });
});

function textOf(node: HastRoot | HastContent): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'element' || node.type === 'root') return node.children.map(textOf).join('');
  return '';
}

function renderText(markdown: string, enginePlugins: readonly AIMarkdownEnginePlugin[]): string {
  return textOf(
    transformStage(
      parseStage({
        children: markdown,
        remarkPlugins: buildCoreRemarkPlugins(enginePlugins),
        rehypePlugins: buildCoreRehypePlugins(sanitizeSchema, ''),
        remarkRehypeOptions: { allowDangerousHtml: true, clobberPrefix: '' },
      })
    )
  ).trim();
}

describe('buildCoreRemarkPlugins — the smartypants entry and pangu', () => {
  // SmartyPants decides whether a straight quote opens or closes by the
  // token before it, and a CJK character is a word to it: alone it called
  // both quotes of `中文"引号"中文` closers. The `smartypants` entry now
  // runs `remarkCjkQuotes` first (see remarkCjkQuotes.test.ts for the
  // pairing rules); pangu runs after both and pads the curly double quotes.

  test('CJK prose quoting a word gets one opening and one closing quote', () => {
    const out = renderText('中文"引号"中文', [pangu, smartypants]);
    expect(out).not.toContain('”引号”');
    expect(out).not.toContain('” 引号”');
    // pangu pads the quotes on both sides; that spacing is its own rule.
    expect(out).toBe('中文 “引号” 中文');
    expect(renderText("中文'引号'中文", [pangu, smartypants])).toBe('中文‘引号’中文');
  });

  test('Latin prose is unchanged by the order', () => {
    const md = 'He said "hello" -- and "quoted" text...';
    expect(renderText(md, [pangu, smartypants])).toBe('He said “hello” — and “quoted” text…');
    expect(renderText(md, [smartypants])).toBe('He said “hello” — and “quoted” text…');
  });

  test('the canonical chain places smartypants before pangu whatever the caller order', () => {
    for (const selection of [
      [smartypants, pangu],
      [pangu, smartypants],
    ]) {
      const shape = chainShape(buildCoreRemarkPlugins(selection));
      const iPangu = shape.indexOf(remarkPangu as never);
      const iSmarty = shape.indexOf(remarkSmartypants as never);
      expect(iPangu).toBeGreaterThan(-1);
      expect(iSmarty).toBeGreaterThan(-1);
      expect(iSmarty).toBeLessThan(iPangu);
    }
  });
});

describe('buildCoreRehypePlugins — provenance verifier placement and compatibility', () => {
  test("the two-argument call shape still compiles and installs no verifier (today's chain)", () => {
    const chain = buildCoreRehypePlugins(sanitizeSchema, '');
    const names = chain.map((entry) => (Array.isArray(entry) ? entry[0] : entry));
    expect(names).not.toContain(rehypeVerifyEngineTags);
    expect(names.indexOf(rehypeRawGuard as never)).toBe(0);
    expect(names.indexOf(rehypeSanitize as never)).toBe(1);
  });

  test('with a credential the verifier sits after the guarded rehypeRaw and before rehypeSanitize', () => {
    const chain = buildCoreRehypePlugins(sanitizeSchema, '', { provenance: 'p' });
    const names = chain.map((entry) => (Array.isArray(entry) ? entry[0] : entry));
    const raw = names.indexOf(rehypeRawGuard as never);
    const verify = names.indexOf(rehypeVerifyEngineTags as never);
    const sanitize = names.indexOf(rehypeSanitize as never);
    expect(raw).toBe(0);
    expect(verify).toBe(1);
    expect(sanitize).toBe(2);
    const entry = chain[verify] as unknown as [unknown, { provenance: string }];
    expect(entry[1]).toEqual({ provenance: 'p' });
  });

  test('CrossChunkHandlerOptions without provenance is still a complete option object (type pin)', () => {
    const opts: CrossChunkHandlerOptions = {
      phantomFootnoteLabels: new Set(),
      phantomLinkLabels: new Set(),
      preserveOrphan: true,
      documentId: 'd',
    };
    expect(opts.provenance).toBeUndefined();
  });
});

describe('buildCoreRehypePlugins — image unwrapping runs before KaTeX', () => {
  // KaTeX multiplies the element count, so the passes after it are the
  // expensive ones. These cases pin that the cheaper order changes nothing.
  const CASES = [
    '![a](x.png)',
    '![a](x.png) $$x^2$$',
    '$$x^2$$ ![a](x.png)',
    '[![a](x.png)](u)',
    '[![a](x.png) $$y$$](u)',
    '[$$y$$](u) ![a](x.png)',
    '```math\nx^2\n```\n\n![a](x.png)',
    '> ![a](x.png)\n> $$z$$',
    '- ![a](x.png)\n- $$q$$\n- ![a](x.png) $$q$$',
    '| ![a](x.png) | $$t$$ |\n|---|---|\n| $$u$$ | ![b](y.png) |',
    '<p><code class="math-inline">x</code><img src="a.png"></p>',
    '$$\\bad$$ ![a](x.png)',
    '$$\\includegraphics{x.png}$$',
  ];
  const render = (plugins: ReturnType<typeof buildCoreRehypePlugins>, content: string) => {
    const processor = unified().use(remarkParse);
    for (const entry of buildCoreRemarkPlugins(defaultEnginePlugins))
      processor.use(...((Array.isArray(entry) ? entry : [entry]) as [never]));
    processor.use(remarkRehype, buildCoreRemarkRehypeOptions(true) as never);
    for (const entry of plugins) processor.use(...((Array.isArray(entry) ? entry : [entry]) as [never]));
    return processor.runSync(processor.parse(content));
  };

  test('KaTeX is the last plugin and both unwraps precede it', () => {
    const chain = buildCoreRehypePlugins(sanitizeSchema, '');
    expect(chain.slice(-3)).toEqual([rehypeUnwrapImages, rehypeUnwrapCrossChunkImages, rehypeKatex]);
  });

  test.each(CASES)('same tree as with KaTeX first: %j', (content) => {
    const shipped = buildCoreRehypePlugins(sanitizeSchema, '');
    const katexFirst = [...shipped.slice(0, -3), rehypeKatex, rehypeUnwrapImages, rehypeUnwrapCrossChunkImages];
    expect(render(shipped, content)).toEqual(render(katexFirst as typeof shipped, content));
  });

  test('coordinated-mode placeholders unwrap the same in either order', () => {
    const math = () => h('code', { className: ['math-inline'] }, 'x^2');
    const trees = (): HastRoot[] =>
      [
        h('p', [h('cross-chunk-image')]),
        h('p', [h('cross-chunk-image'), math()]),
        h('p', [h('cross-chunk-link', [h('img', { src: 'a' })])]),
        h('p', [h('cross-chunk-link', [h('img', { src: 'a' }), math()])]),
        h('p', [h('cross-chunk-link', [math()]), h('cross-chunk-image')]),
      ].map((node) => ({ type: 'root', children: [node] }));
    const run = (plugins: unknown[]) =>
      trees().map((tree) => {
        const processor = unified();
        for (const plugin of plugins) processor.use(plugin as never);
        return processor.runSync(tree) as HastRoot;
      });
    const shipped = run([rehypeUnwrapImages, rehypeUnwrapCrossChunkImages, rehypeKatex]);
    expect(shipped).toEqual(run([rehypeKatex, rehypeUnwrapImages, rehypeUnwrapCrossChunkImages]));
    // The first and third hold nothing but an image, so the paragraph is gone.
    expect(shipped.map((tree) => (tree.children[0] as { tagName: string }).tagName)).toEqual([
      'cross-chunk-image',
      'p',
      'cross-chunk-link',
      'p',
      'p',
    ]);
  });
});

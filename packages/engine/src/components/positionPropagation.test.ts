/**
 * Validates that hast top-level children retain `position` metadata after
 * passing through the full rehype plugin chain (remark-rehype + rehype-raw +
 * rehype-sanitize + rehype-katex + rehypeRebaseHashLinks + rehype-unwrap-images).
 *
 * This is a load-bearing assumption for Phase 5 block-memo: synthetic nodes
 * (e.g. footnote section) are detected by the absence of `position` after the
 * pipeline runs, and block cache keys are position-based. If any plugin
 * strips position, the detection breaks silently.
 *
 * PERMANENT contract pin (not a temporary verification): every plugin in the
 * default chain must preserve top-level `position` — a plugin added to the
 * chain must be added to `runProductionPipeline` below too. Do not delete.
 */

import { describe, expect, test } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import remarkEmoji from 'remark-emoji';
import remarkSqueezeParagraphs from 'remark-squeeze-paragraphs';
import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly';
import remarkCjkFriendlyGfmStrikethrough from 'remark-cjk-friendly-gfm-strikethrough/parseOnly';
import remarkRehype from 'remark-rehype';
import rehypeRaw from '@ai-markdown/rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import rehypeUnwrapImages from 'rehype-unwrap-images';
import rehypeRebaseHashLinks from './rehypeRebaseHashLinks';
import rehypeFooterAdorn from './rehypeFooterAdorn';
import { rehypeVerifyEngineTags } from './rehypeVerifyEngineTags';
import { sanitizeSchema } from './sanitizeSchema';
import type { Root, Element } from 'hast';

function runFullPipeline(content: string): Root {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath, { singleDollarTextMath: false })
    .use(remarkRehype, {
      allowDangerousHtml: true,
      clobberPrefix: '',
    })
    .use(rehypeRaw, { passThrough: [] })
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeRebaseHashLinks)
    .use(rehypeUnwrapImages)
    .use(rehypeKatex);

  const file = processor.parse(content);
  return processor.runSync(file, content) as Root;
}

/** Runs the EXACT default-on plugin stack from `MarkdownContent.tsx`. The
 *  block-memo cache (`blockMemo.ts:buildBlocks`) keys per-block entries by
 *  `position.start.offset` on top-level hast children — every plugin in the
 *  default stack must therefore preserve top-level positions or the cache
 *  silently produces incorrect output. This test pins the contract so that
 *  any future plugin addition to the always-on stack must be deliberately
 *  checked against this invariant (and added here). */
function runProductionPipeline(content: string): Root {
  const processor = unified()
    .use(remarkParse)
    // --- Core remark plugins (always on; mirror MarkdownContent.tsx) ---
    .use(remarkGfm)
    .use(remarkMath, { singleDollarTextMath: false })
    .use(remarkBreaks)
    .use(remarkEmoji)
    .use(remarkSqueezeParagraphs)
    .use(remarkCjkFriendly)
    .use(remarkCjkFriendlyGfmStrikethrough)
    .use(remarkRehype, {
      allowDangerousHtml: true,
      clobberPrefix: '',
    })
    // --- Rehype stack (always on; mirror MarkdownContent.tsx) ---
    .use(rehypeRaw, { passThrough: [] })
    // Provenance verifier sits between raw and sanitize in the shipped
    // chain (`buildCoreRehypePlugins` with a credential). It only unwraps
    // placeholder elements, so it must never touch top-level positions.
    .use(rehypeVerifyEngineTags, { provenance: 'position-propagation' })
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeFooterAdorn)
    .use(rehypeRebaseHashLinks)
    .use(rehypeUnwrapImages)
    .use(rehypeKatex);

  const file = processor.parse(content);
  return processor.runSync(file, content) as Root;
}

describe('hast position metadata preservation through rehype pipeline', () => {
  test('plain paragraph blocks retain position', () => {
    const hast = runFullPipeline('Hello\n\nWorld');
    const blocks = hast.children.filter((c): c is Element => c.type === 'element');
    expect(blocks.length).toBe(2);
    for (const block of blocks) {
      expect(block.position).toBeDefined();
      expect(block.position?.start.offset).toBeTypeOf('number');
      expect(block.position?.end.offset).toBeTypeOf('number');
    }
  });

  test('heading + paragraph + code block retain position', () => {
    const hast = runFullPipeline('# Title\n\nPara\n\n```js\ncode\n```');
    const blocks = hast.children.filter((c): c is Element => c.type === 'element');
    for (const block of blocks) {
      expect(block.position).toBeDefined();
    }
  });

  test('raw HTML block retains position after rehype-raw + sanitize', () => {
    const hast = runFullPipeline('<h2 id="x">Hello</h2>\n\nPara');
    const blocks = hast.children.filter((c): c is Element => c.type === 'element');
    for (const block of blocks) {
      expect(block.position).toBeDefined();
    }
  });

  test('block with KaTeX math retains position after rehype-katex', () => {
    const hast = runFullPipeline('$$x + y = z$$\n\nPara');
    const blocks = hast.children.filter((c): c is Element => c.type === 'element');
    for (const block of blocks) {
      expect(block.position).toBeDefined();
    }
  });

  test('footnote synthesized section has NO position (key invariant)', () => {
    const hast = runFullPipeline('See[^x].\n\n[^x]: hello');
    const blocks = hast.children.filter((c): c is Element => c.type === 'element');

    expect(blocks.length).toBeGreaterThanOrEqual(2);

    const last = blocks[blocks.length - 1];
    expect(last.tagName).toBe('section');
    // dataFootnotes may be '', true, or 'true' across versions — check truthy presence instead
    expect((last.properties as Record<string, unknown>)?.dataFootnotes).toBeDefined();
    expect(last.position).toBeUndefined();

    for (const block of blocks.slice(0, -1)) {
      expect(block.position).toBeDefined();
    }
  });

  test('multi-paragraph doc with raw HTML id and footnotes — combined invariants', () => {
    const md = '<h2 id="t">Title</h2>\n\nIntro[^a].\n\nBody[^b].\n\n[^a]: A\n\n[^b]: B';
    const hast = runFullPipeline(md);
    const blocks = hast.children.filter((c): c is Element => c.type === 'element');

    const realBlocks = blocks.filter((b) => b.position);
    const synthetic = blocks.filter((b) => !b.position);

    expect(synthetic.length).toBe(1);
    expect(synthetic[0].tagName).toBe('section');
    expect((synthetic[0].properties as Record<string, unknown>)?.dataFootnotes).toBeDefined();

    expect(realBlocks.length).toBeGreaterThanOrEqual(3);
  });

  test('thematicBreak + table retain position', () => {
    const md = 'Para\n\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |';
    const hast = runFullPipeline(md);
    const blocks = hast.children.filter((c): c is Element => c.type === 'element');
    for (const block of blocks) {
      expect(block.position).toBeDefined();
    }
  });
});

describe('production-pipeline position preservation (default-on plugin stack)', () => {
  // The block-memo cache keys per-block entries on `position.start.offset` of
  // top-level hast children. If any default-on plugin ever strips position
  // metadata, the cache silently produces stale output. The cases below
  // exercise every plugin in the always-on stack against representative
  // content; adding a new always-on plugin must include a matching case here.

  test('remarkBreaks soft-break content keeps top-level positions', () => {
    // remarkBreaks turns soft line breaks into <br>. The transformation
    // happens INSIDE paragraphs — top-level paragraph offsets must survive.
    const hast = runProductionPipeline('Line one\nLine two\n\nNext block');
    const blocks = hast.children.filter((c): c is Element => c.type === 'element');
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const block of blocks) {
      expect(block.position).toBeDefined();
    }
  });

  test('remarkEmoji shortcode replacement preserves top-level positions', () => {
    // `:smile:` is rewritten inside text nodes; the wrapping paragraph's
    // position must remain intact even though its inner text mutates.
    const hast = runProductionPipeline('Hi :smile:\n\nBye :wave:');
    const blocks = hast.children.filter((c): c is Element => c.type === 'element');
    expect(blocks.length).toBe(2);
    for (const block of blocks) {
      expect(block.position).toBeDefined();
    }
  });

  test('remarkSqueezeParagraphs preserves top-level positions on surviving blocks', () => {
    // Squeezing removes empty paragraphs. The blocks that remain must still
    // carry their original source offsets — block-memo treats those as
    // cache keys.
    const hast = runProductionPipeline('First\n\n\n\nSecond');
    const blocks = hast.children.filter((c): c is Element => c.type === 'element');
    for (const block of blocks) {
      expect(block.position).toBeDefined();
    }
  });

  test('remarkCjkFriendly / strikethrough preserve positions on CJK content', () => {
    // Mixed CJK + ASCII text; both CJK plugins rewrite intra-block
    // whitespace but must not strip top-level position.
    const hast = runProductionPipeline('中文段落 with English\n\n~~删除线 strikethrough~~');
    const blocks = hast.children.filter((c): c is Element => c.type === 'element');
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const block of blocks) {
      expect(block.position).toBeDefined();
    }
  });

  test('rehypeFooterAdorn keeps the synthetic footnote section position-free', () => {
    // rehypeFooterAdorn strips the sr-only <h2> from the footnote section
    // and prepends an <hr>. The synthetic section itself must STAY
    // position-less (block-memo's "synthetic footer" detection) and the
    // surrounding real blocks must KEEP their positions.
    const hast = runProductionPipeline('See[^a].\n\n[^a]: body.');
    const blocks = hast.children.filter((c): c is Element => c.type === 'element');
    const synthetic = blocks.filter((b) => !b.position);
    const real = blocks.filter((b) => b.position);
    expect(synthetic.length).toBe(1);
    expect(synthetic[0].tagName).toBe('section');
    expect(real.length).toBeGreaterThanOrEqual(1);
  });

  test('all default-on plugins combined — kitchen-sink invariant', () => {
    // Exercises the full default stack in one input. If any single plugin
    // strips position on a real block under realistic content, this fails.
    const md = [
      '# Title 🎯',
      '',
      'Para with :tada: shortcode and *italic*.',
      '',
      '中英混排 paragraph with $E = mc^2$ inline math.',
      '',
      '```js',
      'console.log("code");',
      '```',
      '',
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '<h2 id="raw">Raw HTML</h2>',
      '',
      'Refers to[^x].',
      '',
      '[^x]: footnote body.',
    ].join('\n');
    const hast = runProductionPipeline(md);
    const blocks = hast.children.filter((c): c is Element => c.type === 'element');
    const real = blocks.filter((b) => b.position);
    const synthetic = blocks.filter((b) => !b.position);
    // At minimum: title + 2 paras + code + table + raw h2 + ref para = 7 real blocks.
    expect(real.length).toBeGreaterThanOrEqual(6);
    // Synthetic footer is exactly one section.
    expect(synthetic.length).toBe(1);
    expect(synthetic[0].tagName).toBe('section');
  });
});

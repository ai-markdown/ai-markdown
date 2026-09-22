/**
 * Byte-equivalence regression guard. Compares the output of
 * `<AIMarkdownContent>` (block-memo pipeline) against the output of the
 * vendored `<Markdown>` component using the same plugin chain.
 *
 * Block-level memoization MUST NOT change the rendered HTML byte-for-byte.
 * In particular:
 * - Top-level whitespace text inserted by `mdast-util-to-hast` between block
 *   elements (the `\n` between `<p>`s, the leading spaces of indented HTML)
 *   MUST be preserved by the `inline` items in the render plan.
 * - All extra-syntax and display-optimize plugins enabled by
 *   the default engine plugin set (mark highlight, definition list,
 *   remove-comments, smartypants, pangu — in that chain order, where
 *   `smartypants` is the CJK quote pass followed by remark-smartypants) MUST
 *   run on the same content as the legacy bare `<Markdown>` reference.
 *
 * Scope of "byte-equivalence" in this suite:
 *
 * - **Standalone path** (the `describe('byte-equivalence ...')` blocks
 *   below): full `expect(renderNew).toBe(renderLegacy)` byte-for-byte
 *   equality. This is the strong contract.
 *
 * - **Wrapped SSR path**: compares a single wrapped chunk against standalone
 *   output while the registry is empty. Cross-chunk resolution requires
 *   mounting effects and is tested in crossChunkSemantics.test.tsx.
 */

import { describe, test, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from './markdown';
import AIMarkdownContent from './MarkdownContent';
import AIMarkdown from '../index';
import { AIMarkdownDocuments } from './AIMarkdownDocuments';
import AIMarkdownProvider from '../context';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkEmoji from 'remark-emoji';
import remarkSqueezeParagraphs from 'remark-squeeze-paragraphs';
import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly';
import remarkCjkFriendlyGfmStrikethrough from 'remark-cjk-friendly-gfm-strikethrough/parseOnly';
import remarkMath from 'remark-math';
import { remarkMark as remarkMarkHighlight } from '@ai-markdown/remark-mark-highlight';
import { remarkDefinitionList, defListHastHandlers } from 'remark-definition-list';
import remarkSmartypants from 'remark-smartypants';
import type { Html as MdastHtml, Parent as MdastParent, Root as MdastRoot, Text as MdastText } from 'mdast';
import { SKIP, visit } from 'unist-util-visit';
import remarkPangu from 'remark-pangu';
import rehypeRaw from '@ai-markdown/rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import rehypeUnwrapImages from 'rehype-unwrap-images';
import { sanitizeSchema } from '@ai-markdown/engine';
import { rehypeRebaseHashLinks } from '@ai-markdown/engine';
import { rehypeFooterAdorn } from '@ai-markdown/engine';
import { rehypeVerifyEngineTags } from '@ai-markdown/engine';
import { highlight, definitionList, removeComments, smartypants, pangu } from '@ai-markdown/engine';

type ExtraSyntaxName = 'highlight' | 'definitionList';
type DisplayOptimizeName = 'removeComments' | 'smartypants' | 'pangu';

interface PluginConfig {
  extras: ExtraSyntaxName[];
  display: DisplayOptimizeName[];
}

/** Maps names to the sealed catalog objects for the NEW-pipeline side only —
 *  the legacy mirror below keeps its own hand-rolled switch on names. */
const SEALED_BY_NAME = { highlight, definitionList, removeComments, smartypants, pangu } as const;

const ALL_EXTRAS: ExtraSyntaxName[] = ['highlight', 'definitionList'];
// Chain order: SmartyPants (CJK quote pass, then remark-smartypants) runs
// BEFORE pangu (the legacy mirror below follows this array's order, so it
// is load-bearing here too).
const ALL_DISPLAY: DisplayOptimizeName[] = ['removeComments', 'smartypants', 'pangu'];

/**
 * Hand-kept mirror of the engine's `remarkCjkQuotes` (the first half of the
 * `smartypants` plugin). A straight quote with a CJK character directly
 * before or after it is curled here, by pairing, so that remark-smartypants
 * (which reads a CJK character as a word and would close both quotes of
 * `中文"引号"中文`) only sees the Latin ones. The rules, in order: an
 * apostrophe before a decade (`'90s`) → closing; start of block/whitespace/
 * opening bracket before → opening; end of block/whitespace/closing
 * punctuation after → closing; a non-CJK letter or digit before → closing;
 * otherwise the pair state for that quote kind decides. A quote without a
 * CJK neighbour is skipped but, where those rules fix its direction, still
 * updates the pair state. The state runs per phrasing block (paragraph,
 * heading, table cell) over its text nodes in document order, through the
 * inline parents; a `break` is whitespace and any other childless node
 * (inline code, html, math, image, footnote reference) is opaque ink to
 * the quote beside it. Same independence rule as the comment stripper
 * below: drift shows up as a byte difference.
 */
const CJK_RE = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}\u3000-\u303f\uff00-\uffef]/u;
const OPENING_RE = /[\p{Ps}\p{Pi}]/u;
const CLOSING_RE = /[\p{Pe}\p{Pf}，。、！？；：]/u;
const WORD_RE = /[\p{L}\p{N}]/u;
const DECADE_RE = /\d\ds(?![\p{L}\p{N}])/uy;
const INK = '\u0000';
const PHRASING_BLOCKS = new Set(['paragraph', 'heading', 'tableCell']);

type LegacyLeaf = { text: MdastText; index: number; parent: MdastParent } | 'space' | 'ink';

function legacyCjkQuotes() {
  const isCjk = (char: string | undefined): boolean => char !== undefined && CJK_RE.test(char);
  const before = (value: string, i: number): string | undefined => {
    if (i === 0) return undefined;
    const unit = value.charCodeAt(i - 1);
    if (unit >= 0xdc00 && unit <= 0xdfff && i >= 2) return String.fromCodePoint(value.codePointAt(i - 2)!);
    return value[i - 1];
  };
  const at = (value: string, i: number): string | undefined =>
    i >= value.length ? undefined : String.fromCodePoint(value.codePointAt(i)!);
  const collect = (parent: MdastParent, out: LegacyLeaf[]): void => {
    parent.children.forEach((child, index) => {
      if (child.type === 'text') {
        if (child.value.length > 0) out.push({ text: child, index, parent });
      } else if (child.type === 'break') out.push('space');
      else if ('children' in child) collect(child, out);
      else out.push('ink');
    });
  };
  /** The character a quote at the edge of a text leaf sees in `leaf`. */
  const edge = (leaf: LegacyLeaf | undefined, side: 'start' | 'end'): string | undefined => {
    if (leaf === undefined) return undefined;
    if (leaf === 'space') return ' ';
    if (leaf === 'ink') return INK;
    return side === 'end' ? before(leaf.text.value, leaf.text.value.length) : at(leaf.text.value, 0);
  };
  return (tree: MdastRoot): void => {
    visit(
      tree,
      (node) => PHRASING_BLOCKS.has(node.type),
      (node) => {
        const leaves: LegacyLeaf[] = [];
        collect(node as MdastParent, leaves);
        const open = { '"': false, "'": false };
        leaves.forEach((leaf, position) => {
          if (leaf === 'space' || leaf === 'ink') return;
          const value = leaf.text.value;
          if (!value.includes('"') && !value.includes("'")) return;
          const blockBefore = edge(leaves[position - 1], 'end');
          const blockAfter = edge(leaves[position + 1], 'start');
          const out = value.split('');
          let changed = false;
          for (let i = 0; i < value.length; i++) {
            const char = value[i];
            if (char !== '"' && char !== "'") continue;
            const prev = i === 0 ? blockBefore : before(value, i);
            const next = i + 1 >= value.length ? blockAfter : at(value, i + 1);
            let opening: boolean | undefined;
            DECADE_RE.lastIndex = i + 1;
            if (char === "'" && DECADE_RE.test(value)) opening = false;
            else if (prev === undefined || /\s/u.test(prev) || OPENING_RE.test(prev)) opening = true;
            else if (next === undefined || /\s/u.test(next) || CLOSING_RE.test(next)) opening = false;
            else if (!isCjk(prev) && WORD_RE.test(prev)) opening = false;
            const cjk = isCjk(prev) || isCjk(next);
            if (cjk) opening ??= !open[char];
            if (opening !== undefined) open[char] = opening;
            if (!cjk) continue;
            out[i] = char === '"' ? (opening ? '“' : '”') : opening ? '‘' : '’';
            changed = true;
          }
          if (changed) leaf.parent.children[leaf.index] = { ...leaf.text, value: out.join('') };
        });
        return SKIP;
      }
    );
  };
}

/**
 * Hand-kept mirror of the engine's `remarkStripComments` (the transformer
 * behind `removeComments`): comment SPANS are stripped from html nodes and a
 * node is dropped only when nothing but whitespace remains. The engine does
 * not export it, and this file's mirrors are independent copies on purpose
 * (see the module header) — so a drift in the engine's transformer shows up
 * here as a byte difference, which is the point.
 */
function legacyStripComments() {
  return (tree: MdastRoot): void => {
    visit(tree, 'html', (node: MdastHtml, index, parent) => {
      if (parent === undefined || index === undefined || !node.value.includes('<!--')) return;
      const stripped = node.value.replace(/<!--[\s\S]*?-->/g, '');
      if (stripped === node.value) return;
      if (stripped.trim() === '') {
        parent.children.splice(index, 1);
        return [SKIP, index];
      }
      parent.children[index] = { ...node, value: stripped };
      return SKIP;
    });
  };
}

// Deterministic document id used by both sides of the byte-equivalence test
// so the per-document clobber prefix matches and the two pipelines stay
// byte-identical. The legacy path mirrors the production prefix-construction
// shape (`encodeURIComponent(documentId) + '-user-content-'`) so this test
// catches any divergence between the two — even when the chosen id contains
// no reserved characters and the encode is a no-op.
const TEST_DOCUMENT_ID = 'be';
const TEST_CLOBBER_PREFIX = `${encodeURIComponent(TEST_DOCUMENT_ID)}-user-content-`;

function legacyPlugins(config: PluginConfig) {
  // Mirrors MarkdownContent.tsx's plugin assembly order EXACTLY so any
  // ordering bug shows up here.
  const extraSyntaxPlugins = config.extras.map((syntax) => {
    switch (syntax) {
      case 'highlight':
        return remarkMarkHighlight;
      case 'definitionList':
        return remarkDefinitionList;
    }
  });
  const displayPlugins = config.display.flatMap((ability) => {
    switch (ability) {
      case 'removeComments':
        return [legacyStripComments];
      case 'smartypants':
        // One engine plugin, two transformers: the CJK quote pass first.
        return [legacyCjkQuotes, remarkSmartypants];
      case 'pangu':
        return [remarkPangu];
    }
  });
  return {
    remarkPlugins: [
      remarkGfm,
      [remarkMath, { singleDollarTextMath: false }],
      ...extraSyntaxPlugins,
      remarkBreaks,
      remarkEmoji,
      remarkSqueezeParagraphs,
      remarkCjkFriendly,
      remarkCjkFriendlyGfmStrikethrough,
      ...displayPlugins,
    ] as never,
    rehypePlugins: [
      [rehypeRaw, { passThrough: [] }],
      // The shipped chain installs the provenance verifier here (a
      // credential is always passed by the renderer). Mirrored deliberately;
      // note this mirror cannot detect a MISSING verifier — sanitize strips
      // the credential property anyway, so bytes still match.
      [rehypeVerifyEngineTags, { provenance: 'byte-equivalence-mirror' }],
      [rehypeSanitize, { ...sanitizeSchema, clobberPrefix: TEST_CLOBBER_PREFIX }],
      rehypeFooterAdorn,
      [rehypeRebaseHashLinks, { prefix: TEST_CLOBBER_PREFIX }],
      rehypeKatex,
      rehypeUnwrapImages,
    ] as never,
    remarkRehypeOptions: {
      allowDangerousHtml: true,
      clobberPrefix: '',
      handlers: {
        ...(config.extras.includes('definitionList') ? defListHastHandlers : {}),
      },
    },
  };
}

function renderLegacy(md: string, config: PluginConfig): string {
  const { remarkPlugins, rehypePlugins, remarkRehypeOptions } = legacyPlugins(config);
  return renderToStaticMarkup(
    <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} remarkRehypeOptions={remarkRehypeOptions}>
      {md}
    </Markdown>
  );
}

function renderNew(md: string, config: PluginConfig, blockMemo = true, incrementalParse = false): string {
  const enginePlugins = [...config.extras, ...config.display].map((name) => SEALED_BY_NAME[name]);
  return renderToStaticMarkup(
    <AIMarkdownProvider
      streaming={false}
      fontSize="14px"
      variant="default"
      colorScheme="light"
      documentId={TEST_DOCUMENT_ID}
      blockMemo={blockMemo}
      incrementalParse={incrementalParse}
    >
      <AIMarkdownContent
        content={md}
        blockMemo={blockMemo}
        incrementalParse={incrementalParse}
        preserveOrphanReferences={true}
        enginePlugins={enginePlugins}
      />
    </AIMarkdownProvider>
  );
}

// ── Baseline cases (no extras / no display optimizers) ────────────────────

const baselineConfig: PluginConfig = { extras: [], display: [] };
const baselineCases: Array<[string, string]> = [
  ['single paragraph', 'Hello'],
  ['two paragraphs (whitespace text between blocks)', 'Hello\n\nWorld'],
  ['heading + paragraphs', '# Title\n\nBody\n\nMore'],
  ['indented raw HTML (leading text node)', '   <div>Hi</div>'],
  ['multi-root raw HTML with separator', '<div>A</div>\n\n<div>B</div>'],
  ['multi-root raw HTML inline (one mdast html, two hast divs)', '<div>A</div><div>B</div>'],
  ['footnote forward + back ref + section', 'See[^x].\n\n[^x]: hello'],
  ['footnote definition ABOVE its reference (orphan-seed regression)', '[^x]: hello\n\nSee[^x].'],
  ['list + table + code', 'A\n\n# H\n\n- li1\n- li2\n\n| c1 | c2 |\n|----|----|\n| a  | b  |\n\n```js\nx\n```\n\nP'],
  [
    'realistic AI response',
    '# Streaming AI Markdown\n\nThis is a **bold** test of the rendering pipeline with [a link](#anchor) and `code`.\n\n## Section 2\n\nSome math: $$x + y = z$$\n\n- Item one\n- Item two with [^a]\n- Item three\n\n| Col A | Col B |\n|-------|-------|\n| 1     | 2     |\n\n```typescript\nconst x: number = 42;\n```\n\n> Blockquote here.\n> Multi-line.\n\n[^a]: Footnote definition.\n\nEnd paragraph with emoji :smile:.',
  ],
];

// ── Extra-syntax cases (each plugin exercised individually) ───────────────

const extraSyntaxCases: Array<[string, PluginConfig, string]> = [
  [
    'mark highlight (==text==) — HIGHLIGHT plugin',
    { extras: ['highlight'], display: [] },
    'Some ==highlighted== text in a paragraph.\n\nAnother ==block== here.',
  ],
  [
    'definition list — DEFINITION_LIST plugin',
    { extras: ['definitionList'], display: [] },
    'Term\n:   Definition body one.\n\nOther\n:   Another definition.',
  ],
];

// ── Display-optimize cases (each plugin exercised individually) ───────────

const displayOptimizeCases: Array<[string, PluginConfig, string]> = [
  [
    'remove HTML comments — REMOVE_COMMENTS plugin',
    { extras: [], display: ['removeComments'] },
    'Before.\n\n<!-- hidden comment -->\n\nAfter.',
  ],
  [
    'remove HTML comments inside an html block — REMOVE_COMMENTS keeps the block',
    { extras: [], display: ['removeComments'] },
    '<details>\n<summary>Sum</summary>\n<!-- hidden -->\nBody\n</details>\n\n<!-- note --> visible text',
  ],
  [
    'smartypants curly quotes + em-dash — SMARTYPANTS plugin',
    { extras: [], display: ['smartypants'] },
    'He said "hello" -- and then walked away...',
  ],
  ['pangu CJK-Latin spacing — PANGU plugin', { extras: [], display: ['pangu'] }, '中文mixedwith English在一段里面。'],
  // Order-sensitive: pangu first pads each straight `'` on its own
  // (`中文 ’ 引号 ’ 中文`), and remark-smartypants without the CJK pass makes
  // both double quotes closers. The mirror follows the array order and
  // carries its own copy of the pass, so this fails the moment either side
  // drifts.
  ['CJK quotes — SMARTYPANTS before PANGU', { extras: [], display: ['smartypants', 'pangu'] }, '中文"引号"中文'],
  ['CJK single quotes — SMARTYPANTS before PANGU', { extras: [], display: ['smartypants', 'pangu'] }, "中文'引号'中文"],
];

// ── CJK quote cases: the visible text is pinned as well as the bytes ──────
//
// Byte-equivalence alone would pass with any mirror that matches the
// engine, so the reader-facing text of each case is pinned too. `it's`,
// `'90s`, `a"b"c` and `"quoted" text` are remark-smartypants' own output:
// the CJK pass leaves quotes without a CJK neighbour alone.

const cjkQuoteCases: Array<[string, string]> = [
  ['中文"引号"中文', '中文 “引号” 中文'],
  ["中文'引号'中文", '中文‘引号’中文'],
  ["中文 '引号' 中文", '中文 ‘引号’ 中文'],
  ['中文"English"中文', '中文 “English” 中文'],
  ['中文"多"个"引号"了', '中文 “多” 个 “引号” 了'],
  ['English "quote" 中文', 'English “quote” 中文'],
  ['中文"引号', '中文 “引号'],
  ['引号"中文', '引号 “中文'],
  ['他说："你好。"', '他说：“你好。”'],
  // Pairing across inline markup, a soft line break, nesting, inline code.
  ["中文'*引号*'中文", '中文‘<em>引号</em>’中文'],
  ['中文"*引号*"中文', '中文 “<em>引号</em>” 中文'],
  ['"引号**强调**"中文', '“引号<strong>强调</strong>” 中文'],
  ['中文"引号\n引号"中文', '中文 “引号<br/>\n引号” 中文'],
  ["“他说：'引号'”", '“他说：‘引号’”'],
  ['中文"`code`"中文', '中文 “<code>code</code>” 中文'],
  ["it's", 'it’s'],
  ["'90s", '’90s'],
  ["don't and '90s and 中文'引号'中文", 'don’t and ’90s and 中文‘引号’中文'],
  ['a"b"c', 'a”b”c'],
  ['"quoted" text', '“quoted” text'],
];

// ── Default config (everything enabled, as <AIMarkdown> ships) ────────────

const defaultConfig: PluginConfig = { extras: ALL_EXTRAS, display: ALL_DISPLAY };
const defaultCases: Array<[string, string]> = [
  ['default config + simple paragraphs', 'Hello\n\nWorld'],
  [
    'default config + every-feature kitchen sink',
    '# Title\n\nIntro with ==mark== and H~2~O.\n\n<!-- hidden -->\n\n"Smart quotes" and 中文Latin spacing.\n\nTerm\n:   Definition.\n\nSee[^x].\n\n[^x]: footnote.',
  ],
  [
    'default config + CJK quotes and a commented html block',
    '中文"引号"中文 and "Latin"\n\n<details>\n<summary>Sum</summary>\n<!-- hidden -->\nBody\n</details>',
  ],
];

describe('byte-equivalence (baseline plugins only)', () => {
  for (const [label, md] of baselineCases) {
    test(label, () => {
      expect(renderNew(md, baselineConfig)).toBe(renderLegacy(md, baselineConfig));
    });
  }
});

describe('byte-equivalence (extra-syntax plugins)', () => {
  for (const [label, config, md] of extraSyntaxCases) {
    test(label, () => {
      expect(renderNew(md, config)).toBe(renderLegacy(md, config));
    });
  }
});

describe('byte-equivalence (display-optimize plugins)', () => {
  for (const [label, config, md] of displayOptimizeCases) {
    test(label, () => {
      expect(renderNew(md, config)).toBe(renderLegacy(md, config));
    });
  }
});

describe('byte-equivalence (default config — everything enabled)', () => {
  for (const [label, md] of defaultCases) {
    test(label, () => {
      expect(renderNew(md, defaultConfig)).toBe(renderLegacy(md, defaultConfig));
    });
  }
});

describe('byte-equivalence (default config — CJK quotes, text pinned)', () => {
  for (const [md, text] of cjkQuoteCases) {
    test(md, () => {
      const html = renderNew(md, defaultConfig);
      expect(html).toBe(renderLegacy(md, defaultConfig));
      expect(html).toContain(`<p>${text}</p>`);
    });
  }
});

// ── blockMemo toggle ───────────────────────────────────────────────────────

describe('byte-equivalence: blockMemo toggle produces identical output', () => {
  // Picks a cross-section of inputs that exercise each block-memo path:
  // single block, multi-block whitespace, raw HTML, footnote, kitchen sink.
  const toggleCases: Array<[string, PluginConfig, string]> = [
    ['single block', baselineConfig, 'Hello'],
    ['multi-block with inline whitespace', baselineConfig, 'Hello\n\nWorld'],
    ['multi-root raw HTML (shared mdast)', baselineConfig, '<div>A</div><div>B</div>'],
    ['footnote section', baselineConfig, 'See[^x].\n\n[^x]: hello'],
    ['footnote definition above its reference', baselineConfig, '[^x]: hello\n\nSee[^x].'],
    // Orphan definitions (no reference anywhere): the default policy keeps
    // them in the footer. The legacy path used to drop them — it never
    // merged the standalone footnoteDefinition handler — so `blockMemo`
    // was NOT output-invariant here (2026-08 project review, core-render-04).
    ['pure orphan definition', baselineConfig, '[^o]: orphan body'],
    ['orphan next to a cited note', baselineConfig, 'Cites[^a].\n\n[^a]: cited\n[^b]: orphan'],
    [
      'orphan definitions mid-stream (def before its later reference)',
      defaultConfig,
      '## Sources\n\n[^s]: soak\n[^t]: tag\n\nStill being written',
    ],
    [
      'kitchen sink with all plugins',
      defaultConfig,
      '# Title\n\nIntro with ==mark==.\n\nTerm\n:   Definition.\n\nSee[^x].\n\n[^x]: footnote.',
    ],
  ];
  for (const [label, config, md] of toggleCases) {
    test(`${label} — enabled === disabled`, () => {
      const enabled = renderNew(md, config, true);
      const disabled = renderNew(md, config, false);
      expect(enabled).toBe(disabled);
    });
  }

  test('orphan protection is really ON in both paths (not vacuously equal by both dropping the def)', () => {
    for (const blockMemo of [true, false]) {
      const html = renderNew('[^o]: orphan body', baselineConfig, blockMemo);
      expect(html, `blockMemo=${blockMemo}`).toContain('data-footnotes');
      expect(html, `blockMemo=${blockMemo}`).toContain('orphan body');
    }
  });
});

// ── incrementalParse toggle ────────────────────────────────────────────────
//
// One-shot SSR renders can NEVER exercise the incremental splice path: the
// per-instance state ref starts empty every render, so `advanceIncrementalParse`
// takes its internal full path (that is also why SSR correctness is untouched
// by the flag). This block therefore guards exactly one property: turning the
// flag ON does not perturb one-shot output. Frame-by-frame splice correctness
// is owned by `incrementalParse/spliceEquivalence.test.ts` (the arbiter) and
// the streaming Storybook play test.

describe('byte-equivalence: incrementalParse toggle produces identical output', () => {
  const toggleCases: Array<[string, PluginConfig, string]> = [
    ['single block', baselineConfig, 'Hello'],
    ['multi-block prose', baselineConfig, 'Hello\n\nWorld\n\nAgain'],
    ['multi-root raw HTML (shared mdast)', baselineConfig, '<div>A</div><div>B</div>'],
    ['footnote section (splices via injection replay since v2)', baselineConfig, 'See[^x].\n\n[^x]: hello'],
    ['footnote definition above its reference', baselineConfig, '[^x]: hello\n\nSee[^x].'],
    [
      'kitchen sink with all plugins',
      defaultConfig,
      '# Title\n\nIntro with ==mark==.\n\nTerm\n:   Definition.\n\nSee[^x].\n\n[^x]: footnote.',
    ],
  ];
  for (const [label, config, md] of toggleCases) {
    test(`${label} — incremental on === off`, () => {
      const on = renderNew(md, config, true, true);
      const off = renderNew(md, config, true, false);
      expect(on).toBe(off);
    });
  }
});

describe('cross-chunk semantic equivalence', () => {
  function renderSingle(source: string, documentId: string): string {
    return renderToStaticMarkup(<AIMarkdown content={source} documentId={documentId} />);
  }
  function renderChunked(chunks: string[], documentId: string): string {
    return renderToStaticMarkup(
      <AIMarkdownDocuments>
        {chunks.map((c, i) => (
          <AIMarkdown key={i} content={c} documentId={documentId} />
        ))}
      </AIMarkdownDocuments>
    );
  }

  // Server render under the wrapper: the registry exists but is EMPTY
  // (registerChunk/contribute run in effects), so every placeholder must
  // fall back to the chunk's own standalone facts — local footnote number,
  // local link/image def — and the output must be BYTE-identical to the
  // standalone render (2026-08 project review, core-render-02: marks and
  // reference links vanished from coordinated SSR while the local footer
  // still rendered with backrefs to nothing).
  describe('a wrapped chunk renders byte-identically to standalone on the server (empty registry)', () => {
    const cases: Array<[string, string]> = [
      [
        'footnote referenced twice + link ref + image ref',
        'Cites[^a] and [glossary][g] then [^a] again ![pic][g].\n\n[^a]: Note A.\n\n[g]: https://example.com/g "G"',
      ],
      ['two footnotes, def-before-ref order', '[^b]: B first.\n\nText[^a] then[^b].\n\n[^a]: A body.'],
      ['orphan definition next to a cited one', 'Cites[^a].\n\n[^a]: cited\n[^o]: orphan'],
      ['collapsed and shortcut link references', 'See [spec][] and [spec].\n\n[spec]: https://example.com/spec'],
      ['no references at all', '# Title\n\nPlain **prose** only.'],
      // v2.4.0 review: the four classes that broke the byte-identity claim.
      [
        'non-ASCII / percent / quote footnote labels (id encoding via normalizeUri)',
        'See[^注] and[^a%b] and[^q"x].\n\n[^注]: 中文\n\n[^a%b]: percent\n\n[^q"x]: quote',
      ],
      ['image reference alone in a paragraph (unwrap)', '![pic][x]\n\n![][x]\n\n[x]: https://example.com/p.png'],
      [
        'destination that normalizeUri rewrites (space, non-ASCII, quote)',
        '[a][x] [b][y] [c][z]\n\n[x]: <https://example.com/a b>\n[y]: https://example.com/日本\n[z]: https://example.com/q"x',
      ],
      [
        'blocked destinations render without href/src, not href=""',
        '[j][js] ![i][js] [m][my]\n\n[js]: javascript:alert(1)\n[my]: myapp://x',
      ],
      // v2.4.1 review: an EMPTY destination is legal (`[x]: <>`) and keeps
      // href=""/src="" in standalone — only a BLOCKED one drops the attribute.
      ['empty destination keeps href="" / src=""', '[e][x] ![i][x]\n\n[x]: <>'],
      // …and a linked image alone in a paragraph is unwrapped through the
      // link placeholder leg too.
      [
        'linked image reference alone in a paragraph (unwrap through the link)',
        '[![pic][p]][l]\n\n[p]: https://example.com/p.png\n[l]: https://example.com/l',
      ],
      [
        'inline image inside a link reference alone in a paragraph',
        '[![pic](https://example.com/p.png)][l]\n\n[l]: https://example.com/l',
      ],
    ];
    for (const [label, doc] of cases) {
      test(label, () => {
        expect(renderChunked([doc], 'doc-ssr')).toBe(renderSingle(doc, 'doc-ssr'));
      });
    }
    test('marks and links are really present (not vacuously equal by both being empty)', () => {
      const html = renderChunked([cases[0][1]], 'doc-ssr');
      expect(html).toContain('data-footnote-ref');
      expect(html).toContain('href="https://example.com/g"');
      expect(html).toContain('<img src="https://example.com/g"');
    });
  });
});

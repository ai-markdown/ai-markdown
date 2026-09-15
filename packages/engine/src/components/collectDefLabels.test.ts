import { describe, test, expect } from 'vitest';
import {
  collectDefLabels,
  createDefLabelScanner,
  DEF_LINE_START_RE,
  lastRegionStart,
  type DefLabels,
  type DefLabelGrammarOptions,
} from './collectDefLabels';
import { parseStage } from './markdown';
import { buildCoreRemarkPlugins, buildCoreRehypePlugins, buildCoreRemarkRehypeOptions } from './pluginChain';
import { extractContributions } from './extractContributions';
import { sanitizeSchema } from './sanitizeSchema';
import { defaultEnginePlugins, definitionList } from '../plugins/catalog';

const asPlain = (l: DefLabels) => ({ fn: [...l.footnoteLabels].sort(), link: [...l.linkLabels].sort() });

/** The labels the PRODUCTION chain defines for `source`: the chain
 *  `pluginChain.ts` builds for the shipped adapters (remark-math always on,
 *  `singleDollarTextMath: false`), read through `extractContributions` —
 *  the same extractor that publishes a chunk's definitions to the registry.
 *  This is the set PASS 0 has to advertise; anything else lets a sibling
 *  chunk phantom-inject a label the document never defines, or leaves a
 *  defined label unresolved. Only the parse stage runs: no remark
 *  transformer in the chain creates or removes `definition` /
 *  `footnoteDefinition` nodes, so the parse-stage mdast carries exactly the
 *  labels the transformed one does. */
function productionLabels(source: string, enginePlugins = defaultEnginePlugins): DefLabels {
  const parsed = parseStage({
    children: source,
    remarkPlugins: buildCoreRemarkPlugins(enginePlugins),
    rehypePlugins: buildCoreRehypePlugins(sanitizeSchema, 'p-', { provenance: 'test' }),
    remarkRehypeOptions: buildCoreRemarkRehypeOptions(enginePlugins.includes(definitionList)),
  });
  const footnoteLabels = new Set<string>();
  const linkLabels = new Set<string>();
  for (const c of extractContributions(parsed.mdast)) {
    if (c.kind === 'fnDef') footnoteLabels.add(c.label);
    else if (c.kind === 'linkDef') linkLabels.add(c.label);
  }
  return { footnoteLabels, linkLabels };
}

describe('collectDefLabels', () => {
  test('extracts footnote def labels', () => {
    const { footnoteLabels, linkLabels } = collectDefLabels('[^x]: text\n[^y]: more');
    expect(footnoteLabels).toEqual(new Set(['X', 'Y']));
    expect(linkLabels).toEqual(new Set());
  });

  test('extracts link def labels', () => {
    const { footnoteLabels, linkLabels } = collectDefLabels('[a]: https://example.com\n[b]: /img.png "title"');
    expect(linkLabels).toEqual(new Set(['A', 'B']));
    expect(footnoteLabels).toEqual(new Set());
  });

  test('uses uppercase normalize (case-fold + ws-collapse)', () => {
    const { footnoteLabels, linkLabels } = collectDefLabels('[^FooBar]: x\n\n[Hello World]: y');
    expect(footnoteLabels.has('FOOBAR')).toBe(true);
    expect(linkLabels.has('HELLO WORLD')).toBe(true);
  });

  test('ignores defs inside fenced code blocks', () => {
    const src = '```\n[notdef]: never\n```\n\n[real]: yes';
    const { linkLabels } = collectDefLabels(src);
    expect(linkLabels).toEqual(new Set(['REAL']));
  });

  test('handles indented defs (up to 3 spaces, CommonMark)', () => {
    const src = '   [indented]: yes';
    const { linkLabels } = collectDefLabels(src);
    expect(linkLabels.has('INDENTED')).toBe(true);
  });

  test('empty source returns empty sets', () => {
    const { footnoteLabels, linkLabels } = collectDefLabels('');
    expect(footnoteLabels.size).toBe(0);
    expect(linkLabels.size).toBe(0);
  });

  test('orphan ref source returns no labels (refs are not defs)', () => {
    const { footnoteLabels, linkLabels } = collectDefLabels('See [^x] and [y][z].');
    expect(footnoteLabels.size).toBe(0);
    expect(linkLabels.size).toBe(0);
  });
});

// ─── createDefLabelScanner — append-aware fast path ─────────────────────────

/** Replay `chunks` as an append-only stream and assert, at EVERY step, that
 *  the scanner's answer deep-equals a fresh full parse of the accumulated
 *  source under the same grammar. This is the scanner's whole contract —
 *  the fast path must be unobservable except through object identity.
 *  Under `{ math: true }` — the grammar the shipped adapters scan with —
 *  the full parse is ALSO checked against the production chain at every
 *  step, so a stream can neither drift from the collector nor the
 *  collector from the real parse. */
function replay(chunks: string[], grammar?: DefLabelGrammarOptions): void {
  const scanner = createDefLabelScanner(grammar);
  let acc = '';
  for (const chunk of chunks) {
    acc += chunk;
    const full = asPlain(collectDefLabels(acc, grammar));
    expect(asPlain(scanner.scan(acc)), JSON.stringify(acc)).toEqual(full);
    if (grammar?.math) expect(full, JSON.stringify(acc)).toEqual(asPlain(productionLabels(acc)));
  }
}

/** The production adapters' scanner grammar (React `MarkdownContent`, Vue
 *  `useMarkdownChunk` — both scan with `{ math: true }` because their chain
 *  always includes remark-math). */
const PRODUCTION: DefLabelGrammarOptions = { math: true };

describe('createDefLabelScanner', () => {
  test('equals a full parse at every step of adversarial streams', () => {
    // Plain prose (pure fast path).
    replay(['Hello ', 'world.\n\n', 'Another ', 'paragraph ', 'of text.\n']);
    // Def split mid-label and mid-destination.
    replay(['See [x', '][ref].\n\n[re', 'f]: https://exa', 'mple.com\n']);
    // Multi-line def: `[x]:` on one line, destination appended WITHOUT a
    // `[` — the case that forces the region back to the last blank line.
    replay(['[x]:\n', 'https://example.com\n']);
    // Setext re-typing: `===` (no `[`) turns the def-looking paragraph
    // region into a heading.
    replay(['[foo]: /url', '\n===\n']);
    // Defs inside an open (then closed) code fence never count.
    replay(['```\n', '[fake]: /nope\n', '```\n', '\n[real]: /yes\n']);
    // Blockquoted def, footnote def split across tokens.
    replay(['> quoted\n> [q]: /q\n\n', 'tail [^f', 'n]: body\n']);
    // Document with no blank lines at all (region = whole source).
    replay(['line one\n', 'line two\n', '[d]: /url\n']);
    // Bracket-dense prose: inline links and citations mid-line.
    replay(['Cite [1] then [a link](https://e.com) ', 'and more [2] prose.\n\n', 'tail [3] text ', 'continues.']);
    // CRLF stream with a def across a CRLF blank line.
    replay(['line one\r\n\r\n', '[d]: /url\r\n', 'prose after\r\n']);
    // Bulleted link (fast-path direction) and blockquoted def.
    replay(['- [t](https://e.com)\n', '- second bullet\n\n', '> [q]: /q\n']);
    // Escaped bracket inside a label, split right at the escape.
    replay(['[a\\', ']b]: /url\n', 'prose after\n']);
    // Multi-line label split across the line break.
    replay(['[foo\n', 'bar]: /url\n']);
    // Def signature completing one char at a time: `[x` → `[x]` → `[x]:`.
    replay(['see\n[x', ']', ': /url\n']);
    // Link list followed by a genuine def footer.
    replay(['- [a](https://e.com/a)\n', '- [b](https://e.com/b)\n', '\n[c]: https://e.com/c\n']);
    // Ghost-def counterexample (Phase B review): the boundary profile must
    // read `$$` exactly as the scanner's parser does. Under the pinned
    // no-argument (GFM) grammar the type-2 comment stays open past `$$` and
    // `[x]` is comment text — a math-aware boundary would let the frozen
    // prefix invent it. Under `{ math: true }` `$$`-wrapped `<!--` IS
    // closed math, the comment never opens and `[x]` is a definition. Each
    // profile is pinned by per-step equality with its own full parse.
    replay(['$$\n', '<!--\n', '$$\n', '\n', '[x]: /u\n', 'prose\n']);
    replay(['$$\r\n', '<!--\r\n', '$$\r\n', '\r\n', '[x]: /u\r\n']);
    replay(['$$\n', '<!--\n', '$$\n', '\n', '[x]: /u\n', 'prose\n'], PRODUCTION);
    replay(['$$\r\n', '<!--\r\n', '$$\r\n', '\r\n', '[x]: /u\r\n'], PRODUCTION);
    // A ``` fence inside $$ really opens under the pinned grammar; it is
    // math interior under `{ math: true }`.
    replay(['$$\n', '```\n', '$$\n', '\n', '[x]: /u\n']);
    replay(['$$\n', '```\n', '$$\n', '\n', '[x]: /u\n'], PRODUCTION);
    // Streaming def footer after freezable prose (the Phase B motivation).
    replay(['body paragraph one.\n\n', 'body paragraph two.\n\n', '[1]: /a\n', '[2]: /b\n', '[^3]: note\n']);
  });

  test('a definition on line 1 behind a document-leading BOM is reported by scanner and full collector', () => {
    // micromark drops a leading U+FEFF before tokenizing, so the full
    // collector sees `[a]: /u` at the line start. The scanner's line-start
    // probe used to see the BOM instead and never matched line 1, leaving
    // the definition unreported on the streaming path.
    const bom = '\uFEFF';
    expect(asPlain(collectDefLabels(`${bom}[a]: /u\n`))).toEqual({ fn: [], link: ['A'] });
    expect(asPlain(createDefLabelScanner().scan(`${bom}[a]: /u\n`))).toEqual({ fn: [], link: ['A'] });
    expect(asPlain(createDefLabelScanner().scan(`${bom}[^n]: note\n`))).toEqual({ fn: ['N'], link: [] });
    // Streamed one character at a time, then a footer after a blank line.
    replay([...`${bom}[a]: /u\n`, '\n[^n]: note\n', 'prose\n']);
    // A BOM anywhere else is an ordinary character: `\uFEFF[b]: /v` is a
    // paragraph, not a definition, and both sides agree.
    replay([`${bom}[a]: /u\n\n`, `${bom}[b]: /v\n`]);
  });

  test('raw BOM-led input takes a full-parse path that equals the full collector for any BOM count', () => {
    // Stage A strips every leading BOM before the engine, so this is the
    // scanner driven directly. It must not strip one BOM itself and hand
    // the rest to its parser, which drops one more: agreement with the
    // full collector then rested on the line-start probe happening to
    // reject the second BOM, not on a contract. A raw BOM-led source now
    // takes a full parse of the raw text, so the two are equal by
    // construction for any BOM count.
    const bom = '\uFEFF';
    const bodies = ['[a]: /u\n', '[^n]: note\n', '# h\n\n[a]: /u\n', 'prose\n\n[^n]: note\n\n[b]: /v\n'];
    for (const n of [0, 1, 2, 3]) {
      for (const body of bodies) {
        const source = `${bom.repeat(n)}${body}`;
        expect(asPlain(createDefLabelScanner().scan(source)), JSON.stringify(source)).toEqual(
          asPlain(collectDefLabels(source))
        );
        // Character-granular append stream, then a regenerated (non-append) frame.
        replay([...source, '\n[^z]: tail\n']);
        replay([source, `${bom.repeat(n)}${body}\n\n[c]: /w\n`, 'regenerated\n\n[d]: /x\n']);
      }
    }
    // The line-1 definition really is BOM-count dependent on the raw path
    // (this is what the conservative full parse preserves).
    expect(asPlain(collectDefLabels(`${bom}[a]: /u\n`)).link).toEqual(['A']);
    expect(asPlain(collectDefLabels(`${bom}${bom}[a]: /u\n`)).link).toEqual([]);
  });

  test('a raw BOM-led frame is a full parse of the whole source and leaves no frozen state behind', () => {
    let calls: string[] = [];
    const counting = (s: string) => {
      calls.push(s);
      return collectDefLabels(s);
    };
    const bom = '\uFEFF';
    const scanner = createDefLabelScanner(counting);
    const source = `${bom}${bom}intro\n\n[a]: /u\n`;
    scanner.scan(source);
    expect(calls).toEqual([source]); // the raw source, BOMs included
    // Equal sets on the next frame keep the previous object.
    calls = [];
    const first = scanner.scan(source + 'more prose');
    const second = scanner.scan(source + 'more prose and more');
    expect(second).toBe(first);
    expect(calls).toEqual([source + 'more prose', source + 'more prose and more']);
    // A BOM-free regeneration afterwards resumes the normal path from
    // scratch: the frozen prefix parse covers only the stripped-prefix
    // slice, never anything derived from the BOM frames.
    calls = [];
    expect(asPlain(scanner.scan('intro\n\n[a]: /u\n\n[b]: /v\n'))).toEqual(
      asPlain(collectDefLabels('intro\n\n[a]: /u\n\n[b]: /v\n'))
    );
    for (const call of calls) expect(call.charCodeAt(0)).not.toBe(0xfeff);
  });

  test('region boundary is CRLF-aware', () => {
    expect(lastRegionStart('a\n\nb')).toBe(3);
    expect(lastRegionStart('a\r\n\r\nb')).toBe(5);
    expect(lastRegionStart('a\r\n \r\nb')).toBe(6);
    expect(lastRegionStart('no blanks at all')).toBe(0);
  });

  test('fast-path trigger requires the full `]:` def signature, not just a line-start bracket', () => {
    // Mid-line brackets — the shape AI prose is dense with — must NOT
    // knock the stream off the fast path.
    expect(DEF_LINE_START_RE.test('See [the docs](https://e.com) and [1] for details')).toBe(false);
    expect(DEF_LINE_START_RE.test('prose line\nmore [citation] prose')).toBe(false);
    // Line-START brackets without the `]:` signature are links, task boxes
    // or references — grammar-verified non-defs, and exactly what the
    // Documents+smooth cliff streamed. They must stay on the fast path.
    expect(DEF_LINE_START_RE.test('- [Title](https://e.com)')).toBe(false);
    expect(DEF_LINE_START_RE.test('  - [maybe][ref]')).toBe(false); // `][` adjacency: not a def
    expect(DEF_LINE_START_RE.test('1. [ordered](u)')).toBe(false);
    expect(DEF_LINE_START_RE.test('- [x] task item')).toBe(false);
    expect(DEF_LINE_START_RE.test('[x')).toBe(false); // incomplete: no def until `]:` lands (region re-checks)
    expect(DEF_LINE_START_RE.test('[x]\n: /url')).toBe(false); // colon must be ADJACENT (grammar-verified)
    // Anything that CAN be a definition must trigger.
    expect(DEF_LINE_START_RE.test('[x]: /url')).toBe(true);
    expect(DEF_LINE_START_RE.test('prose\n[^fn]: body')).toBe(true);
    expect(DEF_LINE_START_RE.test('> [q]: /q')).toBe(true);
    expect(DEF_LINE_START_RE.test('- [li]: /url')).toBe(true); // defs nest in lists
    expect(DEF_LINE_START_RE.test('[a\\]b]: /url')).toBe(true); // escaped bracket inside label
    expect(DEF_LINE_START_RE.test('[a\\\\]: /url')).toBe(true); // escaped backslash then close
    expect(DEF_LINE_START_RE.test('[foo\nbar]: /url')).toBe(true); // labels may span lines
  });

  test('bulleted link lists and task lists stream entirely on the fast path', () => {
    // The measured Documents+smooth cliff: a blank-line-free `- [Title](url)`
    // list used to defeat the bracket-only probe and pay a full reparse per
    // revealed frame (~15ms at 20k chars). A def's real signature is the
    // adjacent `]:` — links (`](`), references (`][`) and task boxes (`] `)
    // never carry it.
    let calls = 0;
    const counting = (s: string) => {
      calls++;
      return collectDefLabels(s);
    };
    const scanner = createDefLabelScanner(counting);
    let acc = 'Sources:\n';
    scanner.scan(acc);
    // Phase B: the probe gates the SLICE and TAIL parses too, so a
    // signature-free document costs zero parses even on first scan.
    expect(calls).toBe(0);
    for (let i = 1; i <= 20; i += 1) {
      // Split each item mid-bracket to exercise the append seam.
      for (const piece of [`- [Result ${i}]`, `(https://example.com/${i})\n`]) {
        acc += piece;
        expect(asPlain(scanner.scan(acc))).toEqual(asPlain(collectDefLabels(acc)));
      }
    }
    for (const piece of ['- [ ] pending task\n', '- [x] done task\n']) {
      acc += piece;
      expect(asPlain(scanner.scan(acc))).toEqual(asPlain(collectDefLabels(acc)));
    }
    expect(calls).toBe(0); // the whole list rode the fast path
    // A REAL def arriving afterwards still forces a parse and is found.
    // (The list's continuation hazard blocks freezing here, so this one
    // parse covers the full source — the conservative direction.)
    acc += '\n[1]: https://example.com/canonical\n';
    const labels = scanner.scan(acc);
    expect(calls).toBe(1);
    expect([...labels.linkLabels]).toContain('1');
  });

  test('append without "[" in the active region returns the SAME object', () => {
    const scanner = createDefLabelScanner();
    const first = scanner.scan('[a]: /url\n\nprose ');
    const second = scanner.scan('[a]: /url\n\nprose and more prose');
    expect(second).toBe(first);
    expect([...second.linkLabels]).toEqual(['A']);
  });

  test('full rescan keeps the previous reference when the labels are unchanged', () => {
    const scanner = createDefLabelScanner();
    const first = scanner.scan('[a]: /url\n\nsee [a');
    // ']' completes a REFERENCE (not a def): region has '[' → full rescan,
    // but the label set is identical, so the object identity survives.
    const second = scanner.scan('[a]: /url\n\nsee [a]');
    expect(second).toBe(first);
  });

  test('non-append change (regeneration) falls back to a full parse', () => {
    const scanner = createDefLabelScanner();
    scanner.scan('[old]: /url\n\ntext');
    const next = scanner.scan('[new]: /url\n\ndifferent');
    expect(asPlain(next)).toEqual(asPlain(collectDefLabels('[new]: /url\n\ndifferent')));
  });

  test('fast path actually skips the parse on def-free prose appends', () => {
    // Injectable parse counts invocations — externally, a skipped parse is
    // indistinguishable from a parse whose sets came out equal.
    let calls = 0;
    const counting = (s: string) => {
      calls++;
      return collectDefLabels(s);
    };
    const scanner = createDefLabelScanner(counting);
    let acc = 'intro paragraph\n\nprose ';
    scanner.scan(acc);
    // Phase B: even the first scan skips the parse when neither the frozen
    // slice nor the live tail carries a def signature.
    expect(calls).toBe(0);
    for (const token of ['streams ', 'in with [a link](https://e.com) ', 'and citations [1] ', 'to the end.']) {
      acc += token;
      scanner.scan(acc);
    }
    expect(calls).toBe(0); // every append rode the fast path
    // A def line DOES force a parse — of the small tail only: the frozen
    // prefix ends at the blank line before it and holds no signature.
    acc += '\n\n[d]: /url';
    scanner.scan(acc);
    expect(calls).toBe(1);
  });

  test('a streaming def footer parses only the live tail once the prefix freezes', () => {
    // The Phase B goal: while a citation footer streams, the parse cost
    // must be O(footer), not O(document). The injected parse records the
    // LENGTH of every source it is given.
    const parsedLengths: number[] = [];
    const recording = (s: string) => {
      parsedLengths.push(s.length);
      return collectDefLabels(s);
    };
    const scanner = createDefLabelScanner(recording);
    const body = Array.from({ length: 60 }, (_, i) => `Body paragraph ${i} with prose text in it.`).join('\n\n');
    let acc = body + '\n\n';
    scanner.scan(acc); // body: full parse once (fast path not yet armed)
    const bodyLength = acc.length;
    parsedLengths.length = 0;
    for (let i = 1; i <= 30; i += 1) {
      acc += `[${i}]: https://example.com/${i}\n`;
      expect(asPlain(scanner.scan(acc))).toEqual(asPlain(collectDefLabels(acc)));
    }
    expect(bodyLength).toBeGreaterThan(2_000);
    const maxParsed = Math.max(...parsedLengths);
    // Every footer-era parse touched only the footer-sized tail (plus the
    // one-off frozen-prefix slice, which contains no def signature and is
    // skipped by the probe entirely).
    expect(maxParsed).toBeLessThan(1_200);
  });

  test('property: seeded random token streams match a full parse at every step', () => {
    // mulberry32 — deterministic; the pieces bias toward the constructs the
    // scanner's grammar facts interact with (defs, brackets, blank lines,
    // fences, CRLF, container prefixes, partial def lines).
    let s = 0xdef5 | 0;
    const rand = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const PIECES = [
      'word ',
      'two words ',
      '\n',
      '\n\n',
      '\r\n',
      '[',
      ']',
      '(https://e.com) ',
      '[^fn]: body\n',
      '[ref]: /url\n',
      '[ref]: ',
      '"title"\n',
      '```\n[fenced]: /nope\n```\n',
      '> quoted line\n',
      '- list item ',
      '- [Title](https://e.com)\n',
      '- [x] task\n',
      '[a\\]b]: /u\n',
      '\\',
      '   ',
      '===\n',
      ': ',
      '$$\n',
      '$$x$$\n',
      '$$ meta\n',
      '<!--\n',
      '-->\n',
      '<div>\n',
      '</div>\n',
    ];
    for (const grammar of [undefined, PRODUCTION]) {
      for (let stream = 0; stream < 25; stream++) {
        const scanner = createDefLabelScanner(grammar);
        let acc = '';
        for (let i = 0; i < 40; i++) {
          acc += PIECES[Math.floor(rand() * PIECES.length)];
          expect(asPlain(scanner.scan(acc)), JSON.stringify(acc)).toEqual(asPlain(collectDefLabels(acc, grammar)));
        }
      }
    }
    // The same generator against the production chain: `{ math: true }`
    // must agree with the real parse on every prefix, not only on the
    // hand-picked math shapes below.
    for (let stream = 0; stream < 12; stream++) {
      const scanner = createDefLabelScanner(PRODUCTION);
      let acc = '';
      for (let i = 0; i < 30; i++) {
        acc += PIECES[Math.floor(rand() * PIECES.length)];
        expect(asPlain(scanner.scan(acc)), JSON.stringify(acc)).toEqual(asPlain(productionLabels(acc)));
      }
    }
  });
});

// ─── `$$` flow math — the grammar the production chain parses with ────────

describe('math flow grammar (review F1)', () => {
  // The shapes the React and Vue repros used (`.local-notes` review,
  // 2026-09-14): a definition on the line directly under a closing `$$`
  // fence, and a def-shaped line inside a math block that contains blank
  // lines. The LaTeX preprocessor leaves `$$` flow blocks as they are and
  // rewrites `\[ … \]` display math to the same shape, so this is what the
  // scanner sees in production.
  const afterMath = '$$\nx\n$$\n[x]: https://example.com\n';
  const footnoteAfterMath = '$$\nE=mc^2\n$$\n[^1]: Einstein\n';
  const insideMath = '$$\n\n[^a]: note\n\n$$\n';
  const linkInsideMath = '$$\n\n[x]: /u\n\n$$\n';

  test('a link definition directly under a closing $$ fence is a definition, as in production', () => {
    // A definition cannot interrupt a paragraph; only a grammar that ends
    // the math block at the fence sees `[x]:` at a block start. This is the
    // missed cross-chunk link: the sibling `[link][x]` rendered as text.
    expect(asPlain(collectDefLabels(afterMath, PRODUCTION))).toEqual({ fn: [], link: ['X'] });
    expect(asPlain(collectDefLabels(afterMath, PRODUCTION))).toEqual(asPlain(productionLabels(afterMath)));
    expect(asPlain(createDefLabelScanner(PRODUCTION).scan(afterMath))).toEqual({ fn: [], link: ['X'] });
    // A footnote definition can interrupt a paragraph, so this direction
    // never depended on the grammar; pinned so it stays that way.
    expect(asPlain(collectDefLabels(footnoteAfterMath, PRODUCTION))).toEqual({ fn: ['1'], link: [] });
    expect(asPlain(collectDefLabels(footnoteAfterMath))).toEqual({ fn: ['1'], link: [] });
    expect(asPlain(collectDefLabels(footnoteAfterMath, PRODUCTION))).toEqual(
      asPlain(productionLabels(footnoteAfterMath))
    );
  });

  test('a def-shaped line inside a $$ block is math, not a definition, as in production', () => {
    // The ghost footnote: PASS 0 advertised `A`, the sibling `body[^a]`
    // phantom-injected it and rendered a numbered mark with no footer entry.
    expect(asPlain(collectDefLabels(insideMath, PRODUCTION))).toEqual({ fn: [], link: [] });
    expect(asPlain(collectDefLabels(insideMath, PRODUCTION))).toEqual(asPlain(productionLabels(insideMath)));
    expect(asPlain(createDefLabelScanner(PRODUCTION).scan(insideMath))).toEqual({ fn: [], link: [] });
    expect(asPlain(collectDefLabels(linkInsideMath, PRODUCTION))).toEqual({ fn: [], link: [] });
    expect(asPlain(collectDefLabels(linkInsideMath, PRODUCTION))).toEqual(asPlain(productionLabels(linkInsideMath)));
  });

  test('agrees with the production chain on the math shapes around definitions', () => {
    const cases = [
      // Unclosed `$$` runs to EOF and swallows every def-shaped line after it.
      '$$\n[x]: /u\n\n[^a]: note\n',
      // A single-line `$$x$$` is inline math in a paragraph: the link def
      // below it is paragraph text, the footnote def interrupts.
      '$$x$$\n[x]: /u\n',
      '$$x$$\n[^a]: note\n',
      // Opener with meta, closer with trailing spaces, indented (≤ 3) fences.
      '$$ tex\ny\n$$   \n[x]: /u\n',
      '   $$\ny\n   $$\n[x]: /u\n',
      // Four spaces: indented code, not math — the def-shaped line is code
      // and the `[x]:` after the (still open) code block is a definition
      // only once a blank line and an unindented line end the block.
      '    $$\n    [n]: /u\n\n[x]: /u\n',
      // Math interrupts a paragraph; the definition after it is real.
      'para\n$$\ny\n$$\n[x]: /u\n',
      // Math inside containers: blockquote and list item.
      '> $$\n> [q]: /u\n> $$\n> [x]: /u\n',
      '- $$\n  [l]: /u\n  $$\n  [x]: /u\n',
      // `$$` inside a fence and inside an html block is literal.
      '```\n$$\n```\n[x]: /u\n',
      '<div>\n$$\n</div>\n\n[x]: /u\n',
      // Definition before, inside (blank-line separated) and after math.
      '[a]: /a\n$$\n\n[b]: /b\n\n$$\n[c]: /c\n\n[^d]: note\n',
      // Control shapes from the review: blank line between fence and def.
      '$$\nx\n$$\n\n[x]: https://example.com\n',
      'Term\n: def\n[x]: /u\n',
      // CRLF.
      '$$\r\nx\r\n$$\r\n[x]: /u\r\n',
      '$$\r\n\r\n[^a]: note\r\n\r\n$$\r\n',
    ];
    for (const source of cases) {
      expect(asPlain(collectDefLabels(source, PRODUCTION)), JSON.stringify(source)).toEqual(
        asPlain(productionLabels(source))
      );
      expect(asPlain(createDefLabelScanner(PRODUCTION).scan(source)), JSON.stringify(source)).toEqual(
        asPlain(productionLabels(source))
      );
    }
    // The extra-syntax selection does not move a definition: the same
    // labels with the definition-list extension off.
    const plain = defaultEnginePlugins.filter((plugin) => plugin !== definitionList);
    for (const source of cases) {
      expect(asPlain(collectDefLabels(source, PRODUCTION)), JSON.stringify(source)).toEqual(
        asPlain(productionLabels(source, plain))
      );
    }
  });

  test('the no-argument form keeps the pinned CommonMark + GFM grammar', () => {
    // Documented contract for low-level consumers with a math-less chain
    // (and for existing custom `parse` hooks): `$$` is paragraph text, so
    // the def under the fence is paragraph continuation and the def inside
    // the "block" is real. `{ math: false }` spells the same grammar out.
    for (const grammar of [undefined, { math: false }]) {
      expect(asPlain(collectDefLabels(afterMath, grammar))).toEqual({ fn: [], link: [] });
      expect(asPlain(collectDefLabels(insideMath, grammar))).toEqual({ fn: ['A'], link: [] });
      expect(asPlain(collectDefLabels(linkInsideMath, grammar))).toEqual({ fn: [], link: ['X'] });
      expect(asPlain(createDefLabelScanner(grammar).scan(afterMath))).toEqual({ fn: [], link: [] });
      expect(asPlain(createDefLabelScanner(grammar).scan(insideMath))).toEqual({ fn: ['A'], link: [] });
    }
    // Math-free input is grammar-independent.
    for (const source of ['[a]: /u\n\n[^n]: note\n', '```\n[x]: /u\n```\n\n[y]: /v\n', 'para\n[^a]: note\n']) {
      expect(asPlain(collectDefLabels(source, PRODUCTION))).toEqual(asPlain(collectDefLabels(source)));
    }
  });

  test('streams through math shapes equal the full parse and the production chain at every step', () => {
    for (const grammar of [undefined, PRODUCTION]) {
      // The review shapes, token by token, including the frames where the
      // closing fence and the definition are still partial.
      replay(['$$\n', 'x\n', '$', '$\n', '[x', ']: https://', 'example.com\n'], grammar);
      replay(['$$\n', '\n', '[^a', ']: note\n', '\n', '$$', '\n', 'tail\n'], grammar);
      // Definition settled before math, then math opens, streams blank
      // lines and def-shaped lines, closes, and a footer follows.
      replay(
        ['[a]: /a\n\n', 'intro\n\n', '$$\n', '\n', '[b]: /b\n', '\n', '$$\n', '[c]: /c\n', '\n[^d]: note\n'],
        grammar
      );
      // Unclosed math runs to EOF: labels stay empty until the closer lands
      // and the def after it arrives.
      replay(['$$\n', '[x]: /u\n', '\n', 'prose\n', '\n', '$$\n', '[y]: /v\n'], grammar);
      // Inline `$$x$$` line then defs (paragraph continuation vs interrupt).
      replay(['$$x', '$$\n', '[x]: /u\n', '[^a]: note\n'], grammar);
      // Math in a blockquote and in a list item.
      replay(['> $$\n', '> [q]: /u\n', '> $$\n', '> [x]: /u\n'], grammar);
      replay(['- $$\n', '  [l]: /u\n', '  $$\n', '  [x]: /u\n'], grammar);
      // Fence and html block around `$$`.
      replay(['```\n', '$$\n', '```\n', '[x]: /u\n'], grammar);
      replay(['<div>\n', '$$\n', '</div>\n', '\n', '[x]: /u\n'], grammar);
      // CRLF.
      replay(['$$\r\n', 'x\r\n', '$$\r\n', '[x]: /u\r\n'], grammar);
      replay(['$$\r\n', '\r\n', '[^a]: note\r\n', '\r\n', '$$\r\n'], grammar);
      // Long prose prefix so the frozen-prefix path is exercised, then math
      // with an inner def-shaped line, then a real footer.
      const body = Array.from({ length: 12 }, (_, i) => `Body paragraph ${i} with prose.\n\n`);
      replay([...body, '$$\n', '\n', '[^g]: ghost\n', '\n', '$$\n', '[x]: /u\n', '\n[^n]: note\n'], grammar);
    }
  });

  test('non-append regeneration resets math state in both directions', () => {
    for (const grammar of [undefined, PRODUCTION]) {
      const scanner = createDefLabelScanner(grammar);
      const oracle = (source: string) => asPlain(collectDefLabels(source, grammar));
      // Frozen state built on an open math block must not survive a
      // regeneration into a math-free document, and vice versa.
      const opened = '$$\n\n[^a]: note\n\n';
      expect(asPlain(scanner.scan(opened))).toEqual(oracle(opened));
      const regenerated = 'intro\n\n[^a]: note\n\n[b]: /b\n';
      expect(asPlain(scanner.scan(regenerated))).toEqual(oracle(regenerated));
      expect(asPlain(scanner.scan(regenerated + '\n[c]: /c\n'))).toEqual(oracle(regenerated + '\n[c]: /c\n'));
      const back = '$$\nx\n$$\n[x]: /u\n';
      expect(asPlain(scanner.scan(back))).toEqual(oracle(back));
      expect(asPlain(scanner.scan(back + '\n$$\n\n[^z]: z\n'))).toEqual(oracle(back + '\n$$\n\n[^z]: z\n'));
      expect(asPlain(scanner.scan(back + '\n$$\n\n[^z]: z\n\n$$\n'))).toEqual(oracle(back + '\n$$\n\n[^z]: z\n\n$$\n'));
    }
  });

  test('prose appended after a closed math block with a definition rides the fast path', () => {
    let calls = 0;
    const scanner = createDefLabelScanner({
      math: true,
      parse: (s) => {
        calls++;
        return collectDefLabels(s, PRODUCTION);
      },
    });
    let acc = '$$\nx\n$$\n[x]: /u\n\nprose ';
    const first = scanner.scan(acc);
    expect(asPlain(first)).toEqual({ fn: [], link: ['X'] });
    calls = 0;
    for (const token of ['streams ', 'with [a link](https://e.com) ', 'and $$inline$$ math ', 'to the end.\n']) {
      acc += token;
      expect(scanner.scan(acc)).toBe(first);
    }
    expect(calls).toBe(0);
    // A new `$$` block opening afterwards carries no def signature either.
    for (const token of ['\n$$\n', 'y\n', '$$\n']) {
      acc += token;
      expect(scanner.scan(acc)).toBe(first);
    }
    expect(calls).toBe(0);
  });

  test('the bare-function form still injects the parse hook', () => {
    const seen: string[] = [];
    const scanner = createDefLabelScanner((s) => {
      seen.push(s);
      return collectDefLabels(s);
    });
    expect(asPlain(scanner.scan('[a]: /u\n'))).toEqual({ fn: [], link: ['A'] });
    expect(seen).toEqual(['[a]: /u\n']);
  });
});

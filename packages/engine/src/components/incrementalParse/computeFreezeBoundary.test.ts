/**
 * Unit tests for the production freeze-boundary detector. The experiment's
 * falsification suite (experiments/prefixFreeze) validated the L4 rule
 * against the real pipeline; these tests pin the DETECTOR's own contract —
 * blockers, settledness, monotonicity, and the config-aware definition-list
 * blockers that the experiment did not cover (H3).
 */

import { describe, expect, test } from 'vitest';

import {
  computeFreezeBoundary as scanFreezeBoundary,
  type FreezeBoundaryOptions,
  type FreezeScanCheckpointInternal,
} from './computeFreezeBoundary';

/** Most cases only assert the boundary; the footnote bit has its own tests. */
const computeFreezeBoundary = (text: string, options: FreezeBoundaryOptions): number =>
  scanFreezeBoundary(text, options).boundary;

// The engine profile of these tests: the shipped chain has remark-math,
// and the declaration is what makes a `$$` region verbatim. Left out, the
// scanner runs the union of both grammars (mathCapabilityOracle.test.ts).
const OFF = { defListEnabled: false, mathFlow: true };
const ON = { defListEnabled: true, mathFlow: true };

describe('computeFreezeBoundary — basics', () => {
  test('single blank line between paragraphs is a boundary', () => {
    const text = 'para one\n\npara two\n\npara three';
    // Last candidate wins: after 'para two\n\n'.
    expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('para three'));
  });

  test('empty and single-block content freezes nothing', () => {
    expect(computeFreezeBoundary('', OFF)).toBe(0);
    expect(computeFreezeBoundary('just one paragraph', OFF)).toBe(0);
  });

  test('a trailing blank line is only a boundary once its newline exists', () => {
    // 'para\n\n' — the blank line IS terminated (second \n present).
    expect(computeFreezeBoundary('para\n\n', OFF)).toBe(6);
    // 'para\n' — line 2 does not exist yet; nothing confirmed blank.
    expect(computeFreezeBoundary('para\n', OFF)).toBe(0);
    // 'para\n\n   ' — trailing spaces-only line is UNCONFIRMED, but the
    // confirmed blank before it still counts.
    expect(computeFreezeBoundary('para\n\n   ', OFF)).toBe(6);
  });

  test('boundary is monotonic across appends', () => {
    const full =
      'alpha\n\nbeta with **bold**\n\n```js\ncode block\n```\n\n- item\n- item two\n\ncol zero closes\n\nfinal paragraph\n';
    let prev = 0;
    for (let i = 1; i <= full.length; i++) {
      const b = computeFreezeBoundary(full.slice(0, i), OFF);
      expect(b, `regression at length ${i}`).toBeGreaterThanOrEqual(prev);
      prev = b;
    }
  });
});

describe('computeFreezeBoundary — fence and math blockers', () => {
  test('blank lines inside an open fence are not candidates', () => {
    const text = 'para\n\n```js\nline\n\nmore\n';
    expect(computeFreezeBoundary(text, OFF)).toBe(6);
  });

  test('closing the fence re-enables later candidates', () => {
    const text = 'para\n\n```js\ncode\n```\n\nafter\n\ntail';
    expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('tail'));
  });

  test('blank lines inside an open $$ block are blocked (math swallows blanks)', () => {
    const text = 'para\n\n$$\na = 1\n\nb = 2\n';
    expect(computeFreezeBoundary(text, OFF)).toBe(6);
  });
});

describe('computeFreezeBoundary — raw HTML blockers', () => {
  test('an unclosed container blocks candidates until it closes', () => {
    const open = '<details>\n\npara one\n\npara two\n';
    expect(computeFreezeBoundary(open, OFF)).toBe(0);
    const closed = '<details>\n\npara\n\n</details>\n\ntail\n\nend';
    expect(computeFreezeBoundary(closed, OFF)).toBe(closed.indexOf('end'));
  });

  test('an unclosed <!-- comment blocks; --> unblocks', () => {
    expect(computeFreezeBoundary('<!-- note\n\npara\n\nmore\n', OFF)).toBe(0);
    const closed = 'a\n\n<!-- note -->\n\ntail';
    expect(computeFreezeBoundary(closed, OFF)).toBe(closed.indexOf('tail'));
  });

  test('line-truncated open tags block (multi-line tag syntax)', () => {
    // `<div` + EOL opens a CommonMark html block; parse5 completes the tag
    // across lines and the container swallows later siblings.
    expect(computeFreezeBoundary('<div\n  class="x">\n\npara one\n\npara two\n', OFF)).toBe(0);
    // Attributes continuing on the next line — the `>` is off-line too.
    expect(computeFreezeBoundary('<div class="a"\n  data-x="y">\n\npara\n\nmore\n', OFF)).toBe(0);
    // Truncated CLOSING tag balances a truncated open.
    const closed = '<div\n>\ncontent\n</div\n>\n\ntail\n\nend';
    expect(computeFreezeBoundary(closed, OFF)).toBe(closed.indexOf('end'));
  });

  test('a line-truncated `<x` that never gets its `>` is prose — its phantom open is reverted at the blank line', () => {
    // `if x<y then` used to leave `y` open for the rest of the stream
    // (2026-08 project review, eng-parse-06 — permanent full-parse cliff).
    const prose = 'if x<y then\n\nnext paragraph\n\nzzz';
    expect(computeFreezeBoundary(prose, OFF)).toBe(prose.indexOf('zzz'));
    // …but a wrapped REAL tag (its `>` arrives on a later line) stays open.
    expect(computeFreezeBoundary('<div\n  class="a">\ncontent\n\nx\n\nzzz', OFF)).toBe(0);
    // A `>` on the continuation line confirms even prose-looking shapes
    // (`<b\nc>` IS an inline tag to micromark) — over-block, status quo.
    expect(computeFreezeBoundary('a<b\nc>d\n\nx\n\nzzz', OFF)).toBe(0);
    // Reverted phantom + a stray closer later: balance stays sane.
    const stray = '<div\n\n</div>\n\nzzz';
    expect(computeFreezeBoundary(stray, OFF)).toBe(stray.indexOf('zzz'));
    // Two truncated lines in one paragraph both revert.
    const two = 'a<b\nc<d\n\nnext\n\nzzz';
    expect(computeFreezeBoundary(two, OFF)).toBe(two.indexOf('zzz'));
  });

  test('2026-08-19 review P1: a line-truncated CLOSING tag is not counted on the spot', () => {
    // Paragraph context: `para </style` is prose (no `>` ever comes) and
    // the `<style>` opened above stays open — the boundary must not cross it.
    expect(computeFreezeBoundary('<style>\n\npara </style\n\ntail\n\nzzz', OFF)).toBe(0);
    expect(computeFreezeBoundary('<div>\n\npara </div\n\ntail\n\nzzz', OFF)).toBe(0);
    // …a real close later restores the balance.
    const closed = '<div>\n\npara </div\n\ntail\n\n</div>\n\nzzz';
    expect(computeFreezeBoundary(closed, OFF)).toBe(closed.indexOf('zzz'));
    // Paragraph context with a `>` on the next line: a line-start `>` is a
    // blockquote to micromark, the end tag cannot complete — stays open.
    expect(computeFreezeBoundary('<div>\n\npara </div\n>\n\ntail\n\nzzz', OFF)).toBe(0);
    // Html-flow run: `</div` at line start + `>` on the next line completes
    // the end tag (parse5) — applied at the `>` line.
    const flow = '<div>\ncontent\n</div\n>\n\ntail\n\nzzz';
    expect(computeFreezeBoundary(flow, OFF)).toBe(flow.indexOf('zzz'));
    // Html-flow run whose truncated close never gets its `>` before the
    // blank: dropped unapplied, element stays counted (over-block).
    expect(computeFreezeBoundary('<div>\ncontent\n</div\n\ntail\n\nzzz', OFF)).toBe(0);
  });

  test('a stray table-part tag poisons the candidates from it on (soak 2026-08-19 — direction battery)', () => {
    // `<td>` outside a table re-routes how parse5 builds every LATER GFM
    // table (v2.4.2 review P1-2); the splice already bails on it in the
    // frozen prefix — the scanner now refuses candidates past the tag, so
    // a `<td>` prefix cannot freeze a table whose shape depends on the tail
    // and no per-frame work is wasted on a splice that will bail.
    expect(computeFreezeBoundary('<td>s</td>\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n<!-- a closed com', OFF)).toBe(0);
    const before = 'para one\n\npara two\n\n<td>s</td>\n\n| a |\n| - |\n\nzzz';
    expect(computeFreezeBoundary(before, OFF)).toBe(before.indexOf('<td>'));
    // Inline, void (`<col>`) and truncated forms too.
    for (const doc of [
      'x <tr> y\n\n| a |\n| - |\n\nzzz',
      '<col>\n\n| a |\n| - |\n\nzzz',
      '<td\n\n| a |\n| - |\n\nzzz',
    ]) {
      expect(computeFreezeBoundary(doc, OFF), doc).toBe(0);
    }
    // …but a paragraph's truncated `<td b` that never gets its `>` is prose:
    // reverted at the blank, not poisoned (r2 P3); confirmed by a later `>`
    // it poisons.
    const prose = 'compare a<td b\n\nnext\n\nzzz';
    expect(computeFreezeBoundary(prose, OFF)).toBe(prose.indexOf('zzz'));
    expect(computeFreezeBoundary('compare a<td b\nc>\n\n| a |\n| - |\n\nzzz', OFF)).toBe(0);
  });

  test('oracle review of 2.4.4: after a line ending inside a tag, the next line up to the first `>` is attribute garbage', () => {
    // parse5's tokenizer is still in `</div` (or `<div`, or `<br`) at the
    // line ending: the `</div>` on the next line completes THAT tag, it
    // does not close the outer element (pre-existing under-block).
    for (const doc of [
      '<div>\n<div>\n</div\n</div>\n\ntail\n\nzzz',
      '<details>\n<summary>\n</summary\n</details>\n\ntail\n\nzzz',
      '<div>\n<br\n</div>\n\ntail\n\nzzz',
      '<div>\n</br\n</div>\n\ntail\n\nzzz',
      '<div>\n<b class="x"\n</div>\n\ntail\n\nzzz',
      // A quoted `>` before the real one: unknowable — poisoned.
      '<div>\n<b\ntitle=">"\n</div>\n\ntail\n\nzzz',
    ]) {
      expect(computeFreezeBoundary(doc, OFF), doc).toBe(0);
    }
    // Only the FIRST pending close completes at the `>` (`</div` on the
    // garbage line is garbage): span closes, div stays open.
    expect(computeFreezeBoundary('<span>\n<div>\n</span\n</div\n>\n\ntail\n\nzzz', OFF)).toBe(0);
    // Text AFTER the completing `>` is scanned normally: `<b>` there is a
    // real open.
    expect(computeFreezeBoundary('<div>\n</div\n><b>\n\ntail\n\nzzz', OFF)).toBe(0);
    // The garbage model is gated on a REAL html-flow start (type 6/1/7):
    // `</i` / `<br` / `</textarea` at line start are PARAGRAPHS to
    // micromark, so the next line's `<div>` (type 6, interrupts) and `<!--`
    // (type 2) are real blocks and stay counted (oracle re-check: gating on
    // the looser htmlFlowSinceBlank swallowed them — a new under-block).
    for (const doc of [
      '</i\n<div>\n\ntail\n\nzzz',
      '<br\n<div>\n\ntail\n\nzzz',
      '</span\n<div>\n\ntail\n\nzzz',
      '</textarea\n<details>\n\ntail\n\nzzz',
      '</i\n<!-- c\n<div\n\ntail\n\nzzz',
      '</textarea\n<!-- c\n- li\n\ntail\n\nzzz',
      // A real run inside a list item, then a DE-INDENTED line: the item
      // (and its html block) may have ended there — hast-util-raw resets
      // the tokenizer at the container boundary and the `<div>` is a real
      // start tag; poisoned (over-block either way — oracle 3rd pass).
      '- a\n  </div\n<div>\n\ntail para\n\nmore.\n\nzzz',
      '1. a\n   </div\n<div>\n\ntail para\n\nmore.\n\nzzz',
    ]) {
      expect(computeFreezeBoundary(doc, OFF), doc).toBe(0);
    }
  });

  test('2026-08-19 review r2: attribute quotes across lines, bogus comments, raw-text elements, lone CR', () => {
    // r2 P1-2 — dangling open quote: the next line's `>` is a value byte.
    expect(computeFreezeBoundary('<div>\n<hr title="\n<p></div>\n\ntail\n\nzzz', OFF)).toBe(0);
    // r2 P2-3 — paired quotes on the continuation line: NOT poisoned, the
    // stream keeps freezing.
    const paired = '# T\n\n<div\n  class="a">\ncontent\n</div>\n\ntail para\n\nzzz';
    expect(computeFreezeBoundary(paired, OFF)).toBe(paired.indexOf('zzz'));
    // r2 P1-3 — bogus comment eats the `</div>`.
    for (const doc of [
      '<div>\n<!\n</div>\n\ntail\n\nzzz',
      '<div>\n</\n</div>\n\ntail\n\nzzz',
      '<div>\n<//\n</div>\n\ntail\n\nzzz',
    ]) {
      expect(computeFreezeBoundary(doc, OFF), doc).toBe(0);
    }
    // …but in a paragraph `<!` is text and the next `<div>` is a real open.
    expect(computeFreezeBoundary('</i\n<!\n<div>\n\ntail\n\nzzz', OFF)).toBe(0);
    // r2 P1-4 — RCDATA/RAWTEXT content: `</div>` inside `<title>` is text.
    for (const doc of [
      '<div>\n<title>\n</div>\n</title>\n\ntail\n\nzzz',
      '<div>\n<iframe>\n</div>\n</iframe>\n\ntail\n\nzzz',
    ]) {
      expect(computeFreezeBoundary(doc, OFF), doc).toBe(0);
    }
    // Inline: the `</div>` inside `<title>` is text; the closed title is
    // balanced, so the boundary reaches the `<div>` (open from there on).
    const inlineTitle = 'para <title>x</div>y</title> z\n\n<div>\n\ntail\n\nzzz';
    expect(computeFreezeBoundary(inlineTitle, OFF)).toBe(inlineTitle.indexOf('<div>'));
    const titleClosed = '<title>a</title>\n\ntail\n\nzzz';
    expect(computeFreezeBoundary(titleClosed, OFF)).toBe(titleClosed.indexOf('zzz'));
    // r2 P1-5 — lone CR ends a line: the fence / math opener after `a\r`
    // is seen, and no candidate lands inside the open block.
    expect(computeFreezeBoundary('a\r```\ncode\n\ntail\n\nzzz', OFF)).toBe(0);
    expect(computeFreezeBoundary('a\r$$\nx\n\ntail\n\nzzz', OFF)).toBe(0);
    const crDoc = 'para one\r\rpara two\r\rzzz';
    expect(computeFreezeBoundary(crDoc, OFF)).toBe(crDoc.indexOf('zzz'));
    // A lone `\r` as the LAST byte is not a confirmed ending (a `\n` may follow).
    expect(computeFreezeBoundary('para one\n\npara two\r', OFF)).toBe('para one\n\n'.length);
  });

  test('oracle re-check of r2: `<div/>` opens (parse5 ignores the flag on non-void), `<div a=<` is an open, plaintext poisons', () => {
    expect(computeFreezeBoundary('<div/>\n\ntail\n\nzzz', OFF)).toBe(0);
    // `<title/>` opens RCDATA: the `</div>` inside is text, `</title>` closes it — balanced after.
    const titleSc = '<title/>\n</div>\n</title>\n\ntail\n\nzzz';
    expect(computeFreezeBoundary(titleSc, OFF)).toBe(titleSc.indexOf('zzz'));
    expect(computeFreezeBoundary('<div>\n<title/>\n</div>\n</title>\n\ntail\n\nzzz', OFF)).toBe(0);
    // Post-collapse (two-model T3.4) a self-closing FOREIGN CHILD is
    // counted open on purpose — exactness needed the breakout list that
    // was the F1/F2/F5 family. The measured cost of this over-block is
    // reported in the stage's boundary diff (12 corpus docs, all svg).
    const svg = '<svg><circle/></svg>\n\ntail\n\nzzz';
    expect(computeFreezeBoundary(svg, OFF)).toBe(0);
    const svgRoot = '<svg/>\n\ntail\n\nzzz';
    expect(computeFreezeBoundary(svgRoot, OFF)).toBe(svgRoot.indexOf('zzz'));
    // HTML breakout / integration point inside svg: HTML rules — `<div/>` opens.
    expect(computeFreezeBoundary('<svg><div/></svg>\n\ntail\n\nzzz', OFF)).toBe(0);
    expect(computeFreezeBoundary('<svg><foreignObject><div/></foreignObject></svg>\n\ntail\n\nzzz', OFF)).toBe(0);
    // `<` inside the attribute area: the tag-name `<` is the anchor.
    expect(computeFreezeBoundary('<div>\n<div a=<\n</div>\n\ntail\n\nzzz', OFF)).toBe(0);
    // …prose with two truncated shapes still reverts at the blank.
    const prose = 'compare a<b c<d\n\nnext\n\nzzz';
    expect(computeFreezeBoundary(prose, OFF)).toBe(prose.indexOf('zzz'));
    expect(computeFreezeBoundary('<div>\n<plaintext>\n</plaintext>\n</div>\n\ntail\n\nzzz', OFF)).toBe(0);
  });

  test('oracle review of the r2 batch: noscript is HTML, quoted `>` on the tag line, no raw text in foreign content', () => {
    // hast-util-raw: parse5 with scriptingEnabled:false → noscript content is HTML.
    expect(computeFreezeBoundary('<noscript>\n<div>\n</noscript>\n\ntail\n\nzzz', OFF)).toBe(0);
    // A `>` inside a quoted value on the tag's own line does not end it.
    for (const doc of [
      '<div>\n</div a=">\n\ntail\n\nzzz',
      '<div a=">\n</div>\n\ntail\n\nzzz',
      '<div a="x></div>">\n\ntail\n\nzzz',
    ]) {
      expect(computeFreezeBoundary(doc, OFF), doc).toBe(0);
    }
    // …and a value closed on the NEXT line completes the close there: balanced.
    const across = '<div>\n</div a="\n">\n\ntail\n\nzzz';
    expect(computeFreezeBoundary(across, OFF)).toBeGreaterThanOrEqual(across.indexOf('tail'));
    const paired = '<div title="a>b" class="c">x</div>\n\ntail\n\nzzz';
    expect(computeFreezeBoundary(paired, OFF)).toBe(paired.indexOf('zzz'));
    // Foreign content: `<svg><title>` is no RCDATA switch; the `<b>` inside opens.
    expect(computeFreezeBoundary('<svg>\n<title>\n<b>\n</title>\n</svg>\n\ntail\n\nzzz', OFF)).toBe(0);
    // Paragraph context: a closing tag with attributes is text (html-text
    // accepts `</name` + whitespace + `>` only) — the div stays open.
    expect(computeFreezeBoundary('p <div> x </div a="b"> y\n\ntail\n\nzzz', OFF)).toBe(0);
    const wsClose = 'p <div> x </div > y\n\ntail\n\nzzz';
    expect(computeFreezeBoundary(wsClose, OFF)).toBe(wsClose.indexOf('zzz'));
    // A raw-text element's own end tag with an unterminated quoted value
    // keeps tokenizing: title stays open.
    expect(computeFreezeBoundary('<title>\n</title a=">\n\ntail\n\nzzz', OFF)).toBe(0);
  });

  test('v2.4.0 review R2: a truncated tag is not reverted when the raw line closes it inside a masked span, and its seam is still checked', () => {
    // (a) `<div x="\`">b\``: micromark parses the tag first (the backtick
    // is inside a quoted attribute), so the code-span mask hid the tag's
    // own `>` and the revert made a REAL open tag disappear.
    expect(computeFreezeBoundary('a <div x="`">b`\n\npara\n\nzzz', OFF)).toBe(0);
    // Same real tag with a LATER truncated prose `<b` on the line: the
    // truncation anchors on `<b` (reverted at the blank as prose), and the
    // real `<div …>` — `>` inside the mask — must still be counted.
    expect(computeFreezeBoundary('a <div x="`">b`, compare a<b, prose\n\npara\n\nzzz', OFF)).toBe(0);
    // (b) a rawFlowStart line ending in a truncated `<div a` leaves floating
    // whitespace remnant; the phantom open must not skip the seam check.
    expect(computeFreezeBoundary('<!A> <div a\n\n$', OFF)).toBe(0);
    expect(computeFreezeBoundary('<!-- c --> <div a\n\n \npara\n', OFF)).toBe(0);
  });

  test('v2.4.0 review P1/P4: tags outside raw spans are counted on the same line as a raw construct', () => {
    // A tag AFTER the terminator on the terminator line…
    expect(computeFreezeBoundary('<?php\n?><details>\n\npara\n\nmore\n', OFF)).toBe(0);
    // …and a tag BEFORE a same-line opener (the former "accepted edge").
    expect(computeFreezeBoundary('<details> <?php\n?>\n\npara\n\nzzz', OFF)).toBe(0);
    // Balanced tags around a self-contained PI still freeze.
    const ok = '<b>x</b> <?x?> <i>y</i>\n\npara\n\nzzz';
    expect(computeFreezeBoundary(ok, OFF)).toBe(ok.indexOf('zzz'));
  });

  test('v2.4.0 review P2: whitespace-only floating remnant is seam remnant too', () => {
    expect(computeFreezeBoundary('<!-- c --> </s>\n\n-', OFF)).toBe(0);
    // Pure tags / a comment alone leave nothing floating.
    const bare = '<!-- c -->\n\nzzz';
    expect(computeFreezeBoundary(bare, OFF)).toBe(bare.indexOf('zzz'));
  });

  test('v2.4.1 review P1a: only U+0020/U+0009 make a blank line or end a fence closer', () => {
    // A U+3000-only line is a lazy paragraph continuation: no candidate at
    // `bar` (the old scanner froze at 8, inside the unfinished paragraph).
    expect(computeFreezeBoundary('foo\n\u3000\n\u3000\nbar\n', OFF)).toBe(0);
    expect(computeFreezeBoundary('foo\n\u00a0\nbar\n', OFF)).toBe(0);
    // A real blank line still settles the paragraph.
    const ok = 'foo\n\nbar\n';
    expect(computeFreezeBoundary(ok, OFF)).toBe(ok.indexOf('bar'));
    const after = 'foo\n\u3000\nbar\n\nzzz';
    expect(computeFreezeBoundary(after, OFF)).toBe(after.indexOf('zzz'));
    // A fence/math closer followed by NBSP is not a closer — still inside.
    expect(computeFreezeBoundary('```\ncode\n```\u00a0\nmore\n\nzzz', OFF)).toBe(0);
    expect(computeFreezeBoundary('$$\nx\n$$\u3000\nmore\n\nzzz', OFF)).toBe(0);
    // Trailing ASCII whitespace after the closer is fine.
    const closed = '```\ncode\n```  \n\nzzz';
    expect(computeFreezeBoundary(closed, OFF)).toBe(closed.indexOf('zzz'));
  });

  test('v2.4.1 review follow-up: every trim in the scanner is ASCII-only', () => {
    // A def rest ending in NBSP / U+3000 is a paragraph → `[a]` stays tainted.
    expect(computeFreezeBoundary('[a]\n\n[a]: /u "t"\u00a0\n\npara\n\nzzz', OFF)).toBe(0);
    expect(computeFreezeBoundary('[a]\n\n[a]: <#>\u3000\n\npara\n\nzzz', OFF)).toBe(0);
    const real = '[a]\n\n[a]: /u "t" \n\npara\n\nzzz';
    expect(computeFreezeBoundary(real, OFF)).toBe(real.indexOf('zzz'));
    // U+3000 before a paragraph-inline `<!--` is TEXT: the comment never
    // closes inside the paragraph, so the `<details>` is a real open block.
    expect(computeFreezeBoundary('\u3000<!-- c\n<details>\n\n-->\n\npara\n\nzzz', OFF)).toBe(0);
    expect(computeFreezeBoundary(' x <!-- c\n<details>\n\n-->\n\npara\n\nzzz', OFF)).toBe(0);
    // Label normalization keeps NBSP like micromark's normalizeIdentifier.
    expect(computeFreezeBoundary('[\u00a0a] x\n\n[a]: /u\n\npara\n\nzzz', OFF)).toBe(0);
  });

  test('v2.4.1 review follow-up: a FAILED inline link leaves a live shortcut reference', () => {
    // `[foo](bad url)`: space in a bare destination → not a link; `[foo]` is
    // a shortcut reference a later def can retarget.
    expect(computeFreezeBoundary('[foo](bad url) x\n\npara\n\nzzz', OFF)).toBe(0);
    expect(computeFreezeBoundary('[foo](\n\npara\n\nzzz', OFF)).toBe(0);
    expect(computeFreezeBoundary('[foo](/u "open\n\npara\n\nzzz', OFF)).toBe(0);
    // Well-formed resources are inline links — no taint.
    for (const ok of ['[foo](/u) x', '[foo]() x', '[foo](</u v> "t") x', "[foo](/u 't') x", '[foo](/u(x)y) x']) {
      const doc = `${ok}\n\npara\n\nzzz`;
      expect(computeFreezeBoundary(doc, OFF), ok).toBe(doc.indexOf('zzz'));
    }
  });

  test('v2.4.1 review follow-up: a cross-line label inside a blockquote drops the `>` marker', () => {
    const doc = '> see [foo\n> bar] end\n\n[foo bar]: /u\n\nzzz';
    expect(computeFreezeBoundary(doc, OFF)).toBe(doc.indexOf('zzz'));
    expect(computeFreezeBoundary('> see [foo\n> bar] end\n\npara\n\nzzz', OFF)).toBe(0);
  });

  test('v2.4.1 review P3: CRLF line endings judge like LF (the `\\r` is not line content)', () => {
    // A bare list-marker line under CRLF is still a list marker (blocker 3):
    // LF stops at the `-` line; CRLF used to freeze straight past it.
    const lf = 'x\n\n-\n\nzzz';
    const crlf = 'x\r\n\r\n-\r\n\r\nzzz';
    expect(computeFreezeBoundary(lf, OFF)).toBe(lf.indexOf('-'));
    expect(computeFreezeBoundary(crlf, OFF)).toBe(crlf.indexOf('-'));
    // A def line, a fence closer and a blank line all behave the same.
    const lfDoc = 'see [a]\n\n[a]: /u\n\n```\ncode\n```\n\nzzz';
    const crlfDoc = lfDoc.replace(/\n/g, '\r\n');
    expect(computeFreezeBoundary(lfDoc, OFF)).toBe(lfDoc.indexOf('zzz'));
    expect(computeFreezeBoundary(crlfDoc, OFF)).toBe(crlfDoc.indexOf('zzz'));
  });

  test('v2.4.1 review P1b: a reference label spanning a soft line break taints', () => {
    // The label closes on the next line: shortcut ref `[foo bar]` unresolved.
    expect(computeFreezeBoundary('see [foo\nbar] end\n\nx\n\nzzz', OFF)).toBe(0);
    // Three lines.
    expect(computeFreezeBoundary('see [foo\nbar\nbaz] end\n\nx\n\nzzz', OFF)).toBe(0);
    // A settled def releases it.
    const settled = 'see [foo\nbar] end\n\n[foo bar]: /u\n\nzzz';
    expect(computeFreezeBoundary(settled, OFF)).toBe(settled.indexOf('zzz'));
    // A NEW `[` before the closer kills the pending label (`[foo\n[bar]`
    // → only `[bar]` is a ref); the paragraph's blank line clears an
    // unclosed one, so `see [foo\nbar end` taints nothing.
    const stray = 'see [foo\nbar end\n\nx\n\nzzz';
    expect(computeFreezeBoundary(stray, OFF)).toBe(stray.indexOf('zzz'));
    // Inline link across the break is not a reference.
    const link = 'see [foo\nbar](/u) end\n\nx\n\nzzz';
    expect(computeFreezeBoundary(link, OFF)).toBe(link.indexOf('zzz'));
  });

  test('void and self-closing tags do not block', () => {
    const text = 'an image <img src="x"> and <br/> here\n\ntail';
    expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('tail'));
  });

  test("parse5's void list is wider than the spec's: basefont, bgsound and keygen open nothing", () => {
    // The three names parse5 inserts as void outside the HTML spec's list
    // (basefont/bgsound through "in head", keygen through "in body"). While
    // they were missing from VOID_TAGS the scanner pushed an element parse5
    // never opened and the whole rest of the document stopped freezing —
    // over-block, the safe direction, which is why it survived being
    // measured (constructAxisProbe's void-list probe recorded the gap by
    // name). Each line here froze 0 before the names were added.
    for (const name of ['basefont', 'bgsound', 'keygen']) {
      const text = `<${name}>\n\ntail paragraph`;
      expect(computeFreezeBoundary(text, OFF), name).toBe(text.indexOf('tail paragraph'));
    }
    // `frame` is deliberately NOT in the list: outside a frameset parse5
    // ignores the tag entirely, so nothing is inserted and the over-block
    // stands.
    expect(computeFreezeBoundary('<frame>\n\ntail paragraph', OFF)).toBe(0);
  });

  test('autolinks are not treated as tags', () => {
    const text = 'see <https://example.com> now\n\ntail';
    expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('tail'));
  });
});

describe('computeFreezeBoundary — raw-remnant seam (blocker 6)', () => {
  // 2026-07-31 direction-battery counterexample (reproduced on v1.8.0): the
  // html run swallows a math fence; after `</details>` the `$$` lines are
  // BALANCED floating remnant whose hast seam depends on whether a sibling
  // follows. The candidate right after the run froze a region that a
  // def-vs-paragraph flip of the tail (`[a]:` + "x") reshaped (1 → 2
  // children). The candidate must be rejected.
  const SOAK_PREFIX = '<details>\n<summary>t</summary>\nbody prose\n</details>\n$$\ne = mc^2\n$$\n\n[a]:';

  test('the candidate adjacent to a floating-remnant run is rejected (soak counterexample)', () => {
    expect(computeFreezeBoundary(SOAK_PREFIX, OFF)).toBe(0);
  });

  test('a later confirmed content line pins the seam and releases candidates', () => {
    const text = '<div>\n</div>\nfloating remnant\n\npinning paragraph\n\ntail';
    // The paragraph after the remnant run is real frozen-side content; the
    // candidate AFTER it survives (the run-adjacent one stays rejected).
    expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('tail'));
  });

  test('seam risk persists across the whole trailing blank run', () => {
    const text = '<div>\n</div>\nfloating remnant\n\n\n\ntail';
    expect(computeFreezeBoundary(text, OFF)).toBe(0);
  });

  test('interior remnant (text inside an open element) stays freezable', () => {
    const text = '<details>\n<summary>t</summary>\nbody prose\n</details>\n\ntail paragraph';
    expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('tail paragraph'));
  });

  test('a pure-tag run stays freezable', () => {
    const text = '<div>\n</div>\n\ntail paragraph';
    expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('tail paragraph'));
  });

  test('raw-construct terminators are consumed bytes, not remnant (PI corner)', () => {
    const text = '<?data\nmore\n?>\n\ntail paragraph';
    expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('tail paragraph'));
  });

  test('a stray --> in remnant prose does not hide the text before it', () => {
    const text = '<div>\n</div>\nx --> y\n\ntail';
    expect(computeFreezeBoundary(text, OFF)).toBe(0);
  });

  test('a settle line that opens a multi-line comment still flags its remnant (review F1)', () => {
    // Balance settles on the remnant line while a comment stays open across
    // lines — requiring closure at line end would hide the remnant forever.
    const text = '<div>\n</div>\nremnant <!-- c\n-->\n\ntail';
    expect(computeFreezeBoundary(text, OFF)).toBe(0);
  });

  test('a settle line that opens a multi-line PI still flags its remnant (review F1)', () => {
    const text = '<div>\n</div>\nremnant <?data\n?>\n\ntail';
    expect(computeFreezeBoundary(text, OFF)).toBe(0);
  });

  test('remnant AFTER a comment terminator on its closing line is flagged', () => {
    const text = '<div>\n</div>\n<!-- open\n--> tail remnant\n\ntail';
    expect(computeFreezeBoundary(text, OFF)).toBe(0);
  });

  test('a link-definition line does not release the seam (review F2 — defs emit no hast node)', () => {
    const text = '<div>\n</div>\nfloating remnant\n\n[a]: /u\n\nx';
    expect(computeFreezeBoundary(text, OFF)).toBe(0);
  });

  test('a footnote-definition line does not release the seam', () => {
    const text = '<div>\n</div>\nfloating remnant\n\n[^a]: body\n\nx';
    expect(computeFreezeBoundary(text, OFF)).toBe(0);
  });

  test('a comment-only block does not release the seam', () => {
    const text = '<div>\n</div>\nfloating remnant\n\n<!-- note -->\n\nx';
    expect(computeFreezeBoundary(text, OFF)).toBe(0);
  });

  describe('a definition CONTINUATION line does not release the seam (soak 20289117)', () => {
    // The def clause was a per-LINE shape test, so it caught the line a
    // definition STARTS on and nothing else. A definition can span three
    // lines (label, destination, title) and its title can wrap inside its
    // quotes — and every continuation line emits NO hast node, so it
    // cannot pin the seam either. The remote direction leg found it with a
    // wrapped title: the frozen remnant node went position-less to
    // positioned (3 → 4 children) when `-->` completed a trailing comment.
    // Live since the seam check was written; the marker is sticky to the
    // next blank, which is where a definition provably ends.
    test('a wrapped title line (the shrunk soak counterexample)', () => {
      expect(computeFreezeBoundary('</details>\nr\n\n[b]: /b\n[b]: /b "t\nw"\n\n<!--', OFF)).toBe(0);
    });

    test('a title on its own line', () => {
      expect(computeFreezeBoundary('</details>\nr\n\n[a]: /u\n"t"\n\n<!--', OFF)).toBe(0);
    });

    test('a blank ends the definition and the next content line releases', () => {
      const text = '</details>\nr\n\n[a]: /u\n\nreal paragraph\n\ntail\n';
      // `lastIndexOf`: `</details>` contains "tail" at index 4.
      expect(computeFreezeBoundary(text, OFF)).toBe(text.lastIndexOf('tail'));
    });

    test('a content line with no definition above it still releases', () => {
      const text = '</details>\nr\n\nreal paragraph\n\n<!--';
      expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('<!--'));
    });
  });

  describe('a footnote-def BODY continuation across a blank does not release the seam (release-gate F16, seed 20293003)', () => {
    // F15's cross-blank sibling: `defBlockMaybeOpen` clears at the blank
    // because a LINK definition provably ends there — but a FOOTNOTE
    // definition does not. Its body continues across blank lines via
    // ≥4-indent lines (the list-item continuation rule), and those lines
    // emit no top-level hast node (the body renders in the footer), so they
    // cannot pin the seam. The release predicate classified the post-blank
    // indented line as indented CODE and released a live seam.
    //
    // Seal trace of the RED shape below, line by line:
    //   `<!-- c --> </s>`   floating remnant ` ` → p5SealPending = true
    //   (blank)             candidate emitted, seamRisk — rejected
    //   `[^a]: body`        FOOTNOTE_DEF_RE → no release; arms fnDefResumable
    //   (blank)             defBlockMaybeOpen clears; fnDefResumable holds
    //   `    cont`          footnote BODY continuation — the line that
    //                       WRONGLY released before the fix (no node emitted)
    //   (blank)             candidate — must stay seamRisk-rejected
    //   `[b]: /v`           DEF_RE → no release; clears fnDefResumable
    //   (blank)             candidate — still seamRisk-rejected
    //   `tail para`         releases (emits a node), no candidate after it
    test('the ≥4-indent continuation line holds the seal (was: released as indented code)', () => {
      expect(computeFreezeBoundary('<!-- c --> </s>\n\n[^a]: body\n\n    cont\n\n[b]: /v\n\ntail para', OFF)).toBe(0);
    });

    test('a lazy body line between def and continuation does not break the hold', () => {
      // `lazy line` is not a block start (no blank above), so it neither
      // releases (defBlockMaybeOpen still set) nor clears resumability.
      expect(
        computeFreezeBoundary('<!-- c --> </s>\n\n[^a]: body\nlazy line\n\n    cont\n\n[b]: /v\n\ntail para', OFF)
      ).toBe(0);
    });

    test('the shrunk soak prefix (finding A, seed 20293003) is refused whole', () => {
      // The exact prefix the splice froze at boundary 91: footnote def +
      // indented continuation + link def, every line node-less, remnant live.
      expect(
        computeFreezeBoundary(
          '<!-- c --> </s>\n\n\n[^a]: body text\n\n    indented continuation\n\n[a]: https://example.com/a\n\n\n- t',
          OFF
        )
      ).toBe(0);
    });

    test('CLEAR, positive: a ≤3-indent block-start def ends the footnote — indented code then releases', () => {
      // `[a]: /u` is a block start at indent 0: no footnote body can resume
      // past it, so it clears fnDefResumable (while itself not releasing —
      // DEF_RE). The later `    code` line is then REAL indented code,
      // which emits a <pre> and releases; the def line after it carries a
      // clean candidate. If the clear never fired, the indented line would
      // hold the seal and the boundary would be 0.
      const text = '<!-- c --> </s>\n\n[^a]: body\n\n[a]: /u\n\n    code\n\n[b]: /v\n\ntail para';
      expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('tail para'));
    });

    test('CLEAR, negative: an interrupting paragraph clears AND releases', () => {
      const text = '<!-- c --> </s>\n\n[^a]: body\n\npinning paragraph\n\ntail para';
      expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('tail para'));
    });
  });

  describe('a LAZY continuation of a resumed footnote body does not release the seam (release-gate F18)', () => {
    // The adversarial review of the derived-release design refuted F16's
    // `indent >= 4` conjunct with a live member #4: after `    cont`
    // resumes the footnote body across the blank, `lazy tail` is that
    // paragraph's LAZY continuation — indent 0, emits nothing at the root —
    // and the conjunct read it as a releasing content line (boundary 72,
    // P-snap defect at the raw layer under [no-orphan]; shipped stream
    // output does NOT diverge — sanitize masks it — but masking is not a
    // safety argument). The rule is indent-INDEPENDENT: below a resumable
    // footnote, only a block-start line at ≤3 indent provably interrupts
    // (blank above means it cannot be lazy); every other non-blank line
    // keeps the seal.
    test('indent-0 lazy tail after the resumed body holds (was: boundary 72)', () => {
      expect(
        computeFreezeBoundary(
          '<div>\n</div>\nfloating remnant\n\n[^a]: note\n\n    cont\nlazy tail\n\n[b]: /v\n\ntail para\n',
          OFF
        )
      ).toBe(0);
    });

    test('indent-2 lazy tail holds too (was: boundary 74)', () => {
      expect(
        computeFreezeBoundary(
          '<div>\n</div>\nfloating remnant\n\n[^a]: note\n\n    cont\n  lazy tail\n\n[b]: /v\n\ntail para\n',
          OFF
        )
      ).toBe(0);
    });

    test('indent-4 lazy line holds (the F16 class, unchanged)', () => {
      expect(
        computeFreezeBoundary(
          '<div>\n</div>\nfloating remnant\n\n[^a]: note\n\n    cont\n    more cont\n\n[b]: /v\n\ntail para\n',
          OFF
        )
      ).toBe(0);
    });

    test("control: a blank before the tail makes it a BLOCK START — release stands (the skeptic's control)", () => {
      const text = '<div>\n</div>\nfloating remnant\n\n[^a]: note\n\n    cont\n\nlazy tail\n\n[b]: /v\n\ntail para\n';
      expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('tail para'));
    });
  });

  test('a line that is ONLY a closing tag does not release the seam (2026-08-26 review M6)', () => {
    // The release predicate meant "not blank, outside a run, not def-shaped,
    // not comment-only" — which is true of exactly the stray end-tag lines
    // the design's §2.1a measured as RETRO. Through rehype-raw's fragment
    // context a stray `</div>` emits NO node, so nothing sits between the
    // remnant and what streams in later and the trailing root text node can
    // still grow. The next REAL content line is what pins the seam.
    const text = '<!-- c --> remnant\n</div>\n\ntail paragraph';
    expect(computeFreezeBoundary(text, OFF)).toBe(0);
  });

  test('a paragraph line that merely CONTAINS a closing tag does release', () => {
    // The narrowing is whole-line: `prose </div>` is a paragraph, it emits
    // its node, and it pins the seam like any other content line.
    const text = '<!-- c --> remnant\nprose </div>\n\ntail paragraph';
    expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('tail paragraph'));
  });

  test('a real content line after the closing tag still releases', () => {
    // The seal is held, not lost: the candidate adjacent to the stray
    // closer is rejected and the one after the pinning paragraph survives.
    const text = '<!-- c --> remnant\n</div>\n\npinning paragraph\n\ntail';
    expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('tail'));
  });

  test('closed-comment content is not remnant', () => {
    const text = '<div>\n</div>\n<!-- note -->\n\ntail paragraph';
    expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('tail paragraph'));
  });

  describe('the release is DERIVED, not enumerated (design rev3)', () => {
    // The predicate answers three layers — does the line START a block, does
    // that block type have to-hast output, does its output survive parse5 —
    // and WITHHOLDS anything it cannot decide. The enumeration it replaces
    // listed the node-less classes and released everything else, so its
    // default was "release", and four separate events each added one member
    // to a list whose complement has no enumeration (F15, M6, F16, F18).
    //
    // These pin the DOWN side of the swap: the html-flow class withholds
    // whole, which revokes releases the enumeration granted by omission.
    // Each `was:` number is the boundary the enumeration produced on the
    // same bytes, measured by wiring it back in.
    test('a whole-line processing instruction withholds (was: 31)', () => {
      // The enumeration's own drift, and the clearest one: a whole-line
      // `<?instr ?>` released while a whole-line `<!-- note -->` withheld,
      // though both are the same L3 class — neither answer was earned.
      expect(computeFreezeBoundary('<!-- c --> remnant\n<?instr ?>\n\ntail paragraph', OFF)).toBe(0);
      expect(computeFreezeBoundary('<!-- c --> remnant\n<?>\n\ntail paragraph', OFF)).toBe(0);
    });

    test('a whole-line html block withholds (was: 32)', () => {
      // `<div></div>` opens and closes on its line, so the element bag is
      // balanced and nothing else rejects the candidate: the release is the
      // only thing holding it. The class contains both node-emitting members
      // (this one) and parse5-dropped ones (a stray closer, a doctype), and
      // the first landing does not split them.
      expect(computeFreezeBoundary('<!-- c --> remnant\n<div></div>\n\ntail paragraph', OFF)).toBe(0);
    });

    test('an indented comment-only line withholds at any indent', () => {
      // The L3 test runs on the trimmed line, so a ≥4-indent html shape
      // withholds too. That line is really indented CODE and does emit, so
      // this is an over-block — kept because it holds the derived predicate
      // at or inside the enumeration's releases, which the migration asserts
      // (the enumeration's comment-only and closing-tag clauses are
      // indent-blind).
      expect(computeFreezeBoundary('<!-- c --> remnant\n\n    <!-- note -->\n\ntail paragraph', OFF)).toBe(0);
    });

    test('CLEAR: html-SHAPED lines that are PARAGRAPHS still release', () => {
      // The layer classifies, it does not reject every line starting with
      // `<`. Two shapes micromark reads as paragraphs: an incomplete tag,
      // and two complete tags on one line (condition 7 takes exactly one).
      // Both emit their paragraph and pin the seam like any other content.
      const truncated = '<!-- c --> remnant\n<zz x\n\ntail paragraph';
      expect(computeFreezeBoundary(truncated, OFF)).toBe(truncated.indexOf('tail paragraph'));
      const twoTags = '<!-- c --> remnant\n<x-y></x-y>\n\ntail paragraph';
      expect(computeFreezeBoundary(twoTags, OFF)).toBe(twoTags.indexOf('tail paragraph'));
    });

    test('CLEAR: ordinary content lines release exactly as before', () => {
      const para = '<!-- c --> remnant\nplain prose\n\ntail paragraph';
      expect(computeFreezeBoundary(para, OFF)).toBe(para.indexOf('tail paragraph'));
      const heading = '<!-- c --> remnant\n# heading\n\ntail paragraph';
      expect(computeFreezeBoundary(heading, OFF)).toBe(heading.indexOf('tail paragraph'));
    });

    test('a PI residue is not a node the frozen prefix can keep (F23, was: 86 of 86)', () => {
      // parse5 ends the bogus comment at the FIRST `>` — inside `<b` — so
      // ` ?> after the pi` is a root-level TEXT node, and an append extends
      // it with the seam newline and drops its end offset (19-35 →
      // 19-undefined). The seam was armed correctly and the `<details>`
      // line released it: an html-flow line, the class this predicate
      // withholds. Fires under [display-only] alone, where the splice
      // engaged on 12 of 14 probes — the divergence was real at the raw
      // layer and only sanitize kept it out of shipped output.
      const text = '```\n```\n<?instr <b> ?> after the pi\r\n<details>\n</details>\r\n<!-- a closed comment -->\n\n';
      expect(computeFreezeBoundary(text, OFF)).toBe(0);
    });
  });

  describe('an end tag parse5 DISCARDS arms the seam (F24)', () => {
    // parse5 drops an end tag with no matching open element in scope, and
    // the character data on either side of it then lands at one insertion
    // point — one text node where the raw bytes show two runs, retroactively
    // and below the boundary. `DOCUMENT_STRUCTURE_NAMES` poisoned for that
    // merge on FOUR names while parse5 reaches it through a rule with no
    // enumeration, so the fix is keyed on the rule: the scanner already
    // walks `openStack` for the match, and the no-match branch is parse5's
    // own answer.
    test('two stray end tags leave a live trailing text node (was: 23 of 23)', () => {
      expect(computeFreezeBoundary('</address>\n</address>\n\ntail', OFF)).toBe(0);
    });

    test('the first construct can be a void START tag (was: 19 of 19)', () => {
      // Why "stray end tags" is the wrong reading of the class: `<area>` is
      // a void START tag, and the invariant is about the GAP — a text node
      // parse5 leaves between two constructs, at EOF, growing under append.
      expect(computeFreezeBoundary('<area>\n</script >\n\ntail', OFF)).toBe(0);
    });

    test('CLEAR: a MATCHED end tag arms nothing', () => {
      // The seam is armed by the discard, not by the closing tag: parse5
      // pops the div, the text between the tags is sealed inside it, and the
      // pure-tag run keeps freezing.
      const text = '<div>\n</div>\n\ntail paragraph';
      expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('tail paragraph'));
    });

    test('CLEAR: the seam is HELD, not lost — a later content line releases it', () => {
      const text = '</address>\n</address>\n\npinning paragraph\n\ntail';
      expect(computeFreezeBoundary(text, OFF)).toBe(text.lastIndexOf('tail'));
    });
  });

  describe('a name parse5 builds no element for is a phantom on openStack (F28)', () => {
    // F24 keyed the discard on `idx === -1` — no match on the SCANNER's
    // `openStack` — and called that parse5's own answer. It is a model of
    // parse5's stack, and the two disagree on exactly the names parse5 never
    // pushes under: the scanner pushed one, so the end tag MATCHED and popped,
    // `discardedEndTag` stayed false, and `openTotal` came back to zero. The
    // unbalanced form was safe by accident (the phantom blocked candidates),
    // which is the same accident `DOCUMENT_STRUCTURE_NAMES` records for an
    // unclosed `<body>` — so the balanced pair is where it shipped.
    //
    // Measured on v2.8.2 and v2.9.0, byte-identical: boundary 18 of 18, with
    // the raw layer's root text node going `7-8:"\n"` → `"\n\n"` on any
    // append. Fires on three of six configs; the other three reach boundary 0
    // through an unrelated guard, which is how it hid.
    test('a discarded start tag: <frame> (was: 18 of 18)', () => {
      expect(computeFreezeBoundary('<frame>\n</frame>\n\ntail', OFF)).toBe(0);
    });

    test('a RENAMED start tag: <image> becomes img, so `image` never exists (was: 18 of 18)', () => {
      // The second mechanism, and why the list cannot be keyed on "parse5
      // ignores it": parse5 builds an element here — just not one named
      // `image` — so `</image>` is still a stray end tag it discards.
      expect(computeFreezeBoundary('<image>\n</image>\n\ntail', OFF)).toBe(0);
    });

    test('attribute-bearing and self-closing spellings reach the same poison', () => {
      expect(computeFreezeBoundary('<frame src=a>\n</frame>\n\ntail', OFF)).toBe(0);
      expect(computeFreezeBoundary('<frame/>\n</frame>\n\ntail', OFF)).toBe(0);
    });

    test('the poison is document-wide, so an unbalanced one is refused too', () => {
      // Not a behaviour change — the phantom already blocked these — but the
      // reason is now the rule rather than the accident, and it must not
      // regress if the push ever stops.
      expect(computeFreezeBoundary('<frame>\n\ntail', OFF)).toBe(0);
      expect(computeFreezeBoundary('<image>\nremnant\n\ntail', OFF)).toBe(0);
    });

    test('CLEAR: a name parse5 DOES build keeps freezing', () => {
      // The control that separates F28 from "any tag pair poisons". `div` is
      // in the same alphabet equivalence class as `frame` — one 39-name class
      // keyed on `type6` alone — which is precisely why the census could not
      // have sampled them apart before `noElement` joined the table.
      const text = '<div>\n</div>\n\ntail paragraph';
      expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('tail paragraph'));
    });

    test('CLEAR: the names are markup, not text — one inside <script> must not poison', () => {
      // The poison sits past the raw-text guard on purpose (see the call
      // site). A `<frame>` inside a raw-text element is text to parse5 too.
      const text = '<script>\n<frame>\n</script>\n\ntail paragraph';
      expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('tail paragraph'));
    });
  });
});

describe('computeFreezeBoundary — retroactive constructs inside an inline-opened raw-text mask (release-gate F17, seed 20293004)', () => {
  // `p<iframe> …` opens parse5 RCDATA/RAWTEXT from a paragraph line
  // (openedInline). `</iframe a>` carries attributes: literal TEXT to
  // micromark (a closing tag takes none), a REAL end tag to parse5's
  // raw-text states — so parse5 may already be back in DATA while the
  // scanner still masks every construct scan. A `<!DOCTYPE …>` behind that
  // mask is then a REAL doctype whose fragment-mode drop merges text
  // BACKWARD past candidates emitted before the region opened (the F9/F11
  // erasure class) — the doctype's own document-wide poison never fired
  // because the raw-construct scan breaks inside the mask. Unknowable ⇒
  // poison document-wide.
  test('a doctype behind the mask poisons the whole document (was: boundary 5)', () => {
    expect(computeFreezeBoundary('foo\n\n[^a]: b\r\np<iframe> x </iframe a> y\n\n<!DOCTYPE html>\n\n', OFF)).toBe(0);
  });

  test('a <template> behind the mask poisons the whole document', () => {
    expect(computeFreezeBoundary('foo\n\np<iframe> x </iframe a> y\n\n<template>\n\n', OFF)).toBe(0);
  });

  test('a document-structure end tag behind the mask poisons the whole document', () => {
    expect(computeFreezeBoundary('foo\n\np<iframe> x </iframe a> y\n\n</body>\n\n', OFF)).toBe(0);
  });

  test('DOWN guard: the mask without a retroactive shape keeps the pre-region boundary', () => {
    // The from-here-on poison at the region's opening line already covers
    // forward damage; candidates BEFORE the region must survive.
    const text = 'foo\n\n[^a]: b\r\np<iframe> x </iframe a> y\n\nz\n\n';
    expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('[^a]'));
    const text2 = 'foo\n\np<iframe> x </iframe a> y\n\nplain z line\n\n';
    expect(computeFreezeBoundary(text2, OFF)).toBe(text2.indexOf('p<iframe>'));
  });

  test('an attribute-free close ends the mask and the doctype poison fires on its own', () => {
    // Control for the mechanism: `</iframe>` closes the region for BOTH
    // grammars' models, the construct scan resumes, and the doctype's own
    // document-wide poison (not this fix) zeroes the boundary.
    expect(computeFreezeBoundary('foo\n\n[^a]: b\r\np<iframe> x </iframe> y\n\n<!DOCTYPE html>\n\n', OFF)).toBe(0);
  });
});

describe('computeFreezeBoundary — continuation blockers', () => {
  test('list context blocks even across a double blank; column-0 paragraph terminates it', () => {
    const inList = '- item one\n\n\n- item two\n\n';
    expect(computeFreezeBoundary(inList, OFF)).toBe(0);
    const terminated = '- item one\n\ncol zero paragraph\n\ntail';
    expect(computeFreezeBoundary(terminated, OFF)).toBe(terminated.indexOf('tail'));
  });

  test('footnote definition context blocks (LOAD-BEARING since v2: defs splice via replay)', () => {
    expect(computeFreezeBoundary('[^n]: body\n\n', OFF)).toBe(0);
  });
});

describe('computeFreezeBoundary — review-hardened blockers (A1/A2/A4/A5/A6)', () => {
  test('A1: indented code blocks are continuation hazards', () => {
    expect(computeFreezeBoundary('    a\n\n', OFF)).toBe(0);
    const terminated = '    a\n\ncol zero\n\nzzz';
    expect(computeFreezeBoundary(terminated, OFF)).toBe(terminated.indexOf('zzz'));
  });

  test('A2: a def-shaped paragraph continuation line is NOT a definition', () => {
    // [a] ref + fake def on a continuation line → ref stays unresolved.
    expect(computeFreezeBoundary('see [a]\n\npara\n[a]: /x\n\nfiller\n\n', OFF)).toBe(0);
    // Consecutive defs chain without blanks (both valid).
    const chained = '[a]: /x\n[b]: /y\n\nsee [a] and [b]\n\nzzz';
    expect(computeFreezeBoundary(chained, OFF)).toBe(chained.indexOf('zzz'));
  });

  test('A4: a mid-line $$ does not close flow math', () => {
    expect(computeFreezeBoundary('$$\na $$\n\nx\n', OFF)).toBe(0);
    const closed = '$$\na $$\n$$\n\nzzz';
    expect(computeFreezeBoundary(closed, OFF)).toBe(closed.indexOf('zzz'));
  });

  test('A5: a backtick run with a backtick in the info string is not a fence', () => {
    // Paragraph, not fence — the <div> after it must be counted (blocked).
    expect(computeFreezeBoundary('```a``` b <div>\n\nx\n', OFF)).toBe(0);
    const plain = '```a``` b\n\nzzz';
    expect(computeFreezeBoundary(plain, OFF)).toBe(plain.indexOf('zzz'));
  });

  test('A6: html block types 3-5 block until their closer', () => {
    expect(computeFreezeBoundary('<?data\n\nx\n', OFF)).toBe(0);
    expect(computeFreezeBoundary('<![CDATA[\n\nx\n', OFF)).toBe(0);
    const piClosed = 'a <?x?> b\n\nzzz';
    expect(computeFreezeBoundary(piClosed, OFF)).toBe(piClosed.indexOf('zzz'));
    // A CLOSED declaration releases like the PI above — but not `<!DOCTYPE`,
    // which parse5 consumes into the document structure instead of emitting
    // a comment node, making it retroactive and therefore poisoned outright
    // (documentStructurePoison.test.ts). This case used `<!DOCTYPE html>`
    // and asserted a boundary of 17, which is exactly the under-block that
    // shipped: the doctype rewrote a text node the scanner had frozen.
    const declClosed = '<!ENTITY x>\n\nzzz';
    expect(computeFreezeBoundary(declClosed, OFF)).toBe(declClosed.indexOf('zzz'));
    expect(computeFreezeBoundary('<!DOCTYPE html>\n\nzzz', OFF)).toBe(0);
  });
});

describe('computeFreezeBoundary — reference taint', () => {
  test('an unresolved shortcut ref holds the boundary before it', () => {
    const text = 'see [spec] for details\n\nfiller one\n\nfiller two\n';
    expect(computeFreezeBoundary(text, OFF)).toBe(0);
  });

  test('a settled definition releases the taint', () => {
    // NOTE: the closing word must not be a substring of earlier text
    // ('tail' ⊂ 'details' bit us once).
    const text = 'see [spec] for details\n\n[spec]: https://example.com\n\nzzz';
    expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('zzz'));
  });

  test('an unsettled definition (no blank after) does not release', () => {
    const text = 'see [spec] here\n\nfiller\n\n[spec]: https://example.com';
    expect(computeFreezeBoundary(text, OFF)).toBe(0);
  });

  test('labels are matched with micromark case folding, not toLowerCase', () => {
    // micromark's normalizeIdentifier folds 'ß' → 'SS' (toLowerCase would not),
    // so the def below DOES resolve the ref and the boundary may advance.
    const folded = 'see [ß] here\n\n[SS]: https://example.com\n\ntail';
    expect(computeFreezeBoundary(folded, OFF)).toBe(folded.indexOf('tail'));
  });

  test('inline links and definitions themselves are not taint', () => {
    const text = 'a [link](https://example.com) here\n\n[def]: https://example.com\n\ntail';
    expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('tail'));
  });
});

describe('computeFreezeBoundary — definition-list blockers (H3)', () => {
  test("a single-blank candidate is blocked until the next line can't be a `: desc`", () => {
    // No next line yet → the block above could still be claimed as a <dt>.
    expect(computeFreezeBoundary('Term\n\n', ON)).toBe(0);
    // Same text without the extension is freely freezable.
    expect(computeFreezeBoundary('Term\n\n', OFF)).toBe(6);
    // Next line confirmed non-`:` → settled.
    const settled = 'Term\n\nnext paragraph\n\ntail';
    expect(computeFreezeBoundary(settled, ON)).toBe(settled.indexOf('tail'));
  });

  test('a `: desc` line claims across ONE blank; two blanks are immune', () => {
    // Candidate after 'Term\n\n' must not be selected when ': desc' follows.
    const claimed = 'Term\n\n: desc\n\nsomething at col zero\n\ntail';
    // The ': desc' both invalidates the Term candidate (dd line) and is a
    // continuation context for the candidate after itself; the col-zero
    // paragraph terminates, so the last candidate before 'tail' survives —
    // but only once its own next-line check settles (it has: 'tail').
    expect(computeFreezeBoundary(claimed, ON)).toBe(claimed.indexOf('tail'));
    // Double blank: the backward scan cannot cross two blank lines.
    const immune = 'Term\n\n\nnot claimed\n\ntail';
    expect(computeFreezeBoundary(immune, ON)).toBe(immune.indexOf('tail'));
  });

  test('partial trailing lines settle only when they contradict `^ {0,3}:[ \\t]`', () => {
    expect(computeFreezeBoundary('Term\n\nx', ON)).toBe(6); // 'x' can never become ': '
    expect(computeFreezeBoundary('Term\n\n:', ON)).toBe(0); // ':' may still grow a space
    expect(computeFreezeBoundary('Term\n\n  ', ON)).toBe(0); // spaces may still grow ': '
    expect(computeFreezeBoundary('Term\n\n:x', ON)).toBe(6); // ':x' can never match
    expect(computeFreezeBoundary('Term\n\n    code', ON)).toBe(6); // indent 4 can never match
  });
});

describe('computeFreezeBoundary — footnote taint (fence/mask aware)', () => {
  // v2 removed the hasFootnoteSyntax flag (footnotes splice via injection
  // replay); what remains load-bearing is the footnote-namespace reference
  // taint — pinned here through the boundary itself.
  test('an unresolved [^ref] pins the boundary below it', () => {
    const payload = 'intro para.\n\na claim[^n] here\n\nafter.\n\n';
    expect(computeFreezeBoundary(payload, OFF)).toBe(payload.indexOf('a claim'));
  });

  test('a settled footnote def releases the taint (whole doc freezable)', () => {
    const payload = 'a claim[^n] here\n\n[^n]: def body\n\nafter para.\n\n';
    expect(computeFreezeBoundary(payload, OFF)).toBe(payload.length);
  });

  test('[^ inside a code fence or math block does NOT taint', () => {
    const fenced = '```js\nconst re = /[^0-9]/;\n```\n\ntail\n\n';
    expect(computeFreezeBoundary(fenced, OFF)).toBe(fenced.length);
    const math = '$$\n[^x]\n$$\n\ntail\n\n';
    expect(computeFreezeBoundary(math, OFF)).toBe(math.length);
  });
});

describe('computeFreezeBoundary — inline code-span masking (safe direction)', () => {
  test('intra-line spans no longer over-block html/ref/footnote checks', () => {
    const html = 'use `<div>` in prose\n\nzzz';
    expect(computeFreezeBoundary(html, OFF)).toBe(html.indexOf('zzz'));
    const ref = 'the `[x]` token\n\nzzz';
    expect(computeFreezeBoundary(ref, OFF)).toBe(ref.indexOf('zzz'));
    const fnSpan = 'regex `[^0-9]` inline\n\ntail\n\n';
    expect(computeFreezeBoundary(fnSpan, OFF)).toBe(fnSpan.length);
  });

  test('a paragraph with an unpaired run disables masking (cross-line span gate)', () => {
    // The ` before <div> could pair with a run on the NEXT line — masking
    // must not hide the tag (over-block instead).
    expect(computeFreezeBoundary('a `unclosed <div> here\n\nfiller\n\n', OFF)).toBe(0);
  });

  test('resume-vs-fresh equivalence: chained checkpoints match fresh scans', () => {
    const payload =
      'para `code` one\n\n- item\n\n    indented\n\n[a]: /x\n\nsee [a] and `<b>`\n\nnote[^f] here\n\n[^f]: body\n\n```js\nx\n```\n\n<?pi?> done\n\ntail.\n';
    let checkpoint: ReturnType<typeof scanFreezeBoundary>['checkpoint'] | null = null;
    for (let i = 1; i <= payload.length; i++) {
      const prefix = payload.slice(0, i);
      const resumed = scanFreezeBoundary(prefix, OFF, checkpoint);
      checkpoint = resumed.checkpoint;
      const fresh = scanFreezeBoundary(prefix, OFF);
      expect(resumed.boundary, `at length ${i}`).toBe(fresh.boundary);
    }
  });
});

describe('computeFreezeBoundary — suppressed fence/math opens poison the phase (blocker 7)', () => {
  // A fence/math open glued under a REAL html-flow run (the member) is
  // suppressed — the run owns the line as raw text — and the suppression
  // point poisons all LATER candidates, sticky, because the member is
  // container-blind. After a PARAGRAPH `<embed`-style opener the fence and
  // math opens are REAL (both interrupt a paragraph — measured against
  // remark-parse/remark-math while flipping these pins for Migration B
  // row 6): seed-20260757's under-block was precisely the old code
  // SUPPRESSING that real open and inverting the phase.

  test('glued $$ after a paragraph tag-opener is a REAL math open (row 6 flip)', () => {
    const text = 'x\n\n<embed\n  src="x"\n/>\n$$\ne = mc^2\n\n$$\n\ntail prose\n\nmore prose\n';
    expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('more prose'));
  });

  test('glued ``` after a paragraph tag-opener is a REAL fence open (row 6 flip)', () => {
    const text = 'x\n\n<embed\n  src="x"\n/>\n```\ncode\n```\n\ntail prose\n\nmore prose\n';
    expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('more prose'));
  });

  test('control: blank-separated math with an internal blank line tracks and releases', () => {
    const text = 'para\n\n$$\ne = mc^2\n\n$$\n\ntail prose\n\nmore prose\n';
    // The blank INSIDE the math block must not be a candidate; the blanks
    // after the closed block are (last one wins).
    expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('more prose'));
  });

  test('type-6 glued math also poisons (deliberate over-block: swallow is container-dependent)', () => {
    const text = 'para\n\n<details>\n</details>\n$$\nnot math maybe\n\nmore\n\nend\n';
    expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('<details>'));
  });

  test('a paragraph-inline <!-- that never closes poisons the whole document', () => {
    // micromark treats the unclosed inline opener as literal text, so the
    // `<details>` after the blank is REAL and unclosed (seed-20260828).
    // Originally this poisoned from the opener; upgraded to document-wide
    // on 2026-08-24 — a cross-line comment is a sanitize-REMOVED node whose
    // removal merges the text on either side, and the merge reaches
    // BACKWARD past any earlier boundary (the same hole F9 had for
    // `<?`/`<!`+letter, measured at 173/200 in the scaled soak).
    const text =
      'x\n\nprose <b>x</b> <!-- trailing opener\n\n<details>\n\n<!-- a closed comment -->\n\nsee it\n\nmore\n';
    expect(computeFreezeBoundary(text, OFF)).toBe(0);
  });

  test('a 4-indented line glued after a fence close is an A1 hazard', () => {
    // Indented code starts fresh after the close and merges across the
    // blank into the next indented line (seed-20260841) — the blank between
    // them must not be a candidate.
    const text = 'x\n\n```\ncode\n```\n    indented code\n\n    more indented\n\ntail\n';
    expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('```'));
  });

  describe('a parse5 COMMENT that outlives micromark’s block poisons (F27)', () => {
    // At a blank line, parse5 has exactly three non-data token states that
    // can outlive micromark's block: a raw-text element, a bogus comment,
    // and a comment. Two had alignment checks; the third had none, and the
    // candidate then passed `htmlBalanced`, which excludes only `bogus`.
    test('a `<!--` inside an open type-6 block leaves parse5 in a comment (was: 25 of 36)', () => {
      // `<!--` here is the type-6 block's raw CONTENT — micromark opens no
      // type-2 block for it, so its type-6 block ends at the blank while
      // parse5's comment runs to end of document. The balanced tag pair is
      // load-bearing: with a bare `<div>` the element bag stays open and the
      // candidate is refused for that reason instead, which is exactly how
      // the shape survives being minimised.
      expect(computeFreezeBoundary('<div><p></div></p>\n<!--\n\ntail\n\nmore\n', OFF)).toBe(0);
      // The gate's own line endings (CRLF after the opener) behave the same.
      expect(computeFreezeBoundary('<div><p></div></p>\n<!--\r\n\r\ntail\n\nmore\n', OFF)).toBe(0);
    });

    test('CLEAR: the ALIGNED crossing is untouched — both grammars inside the comment', () => {
      // When `<!--` starts its own line at block indent, micromark DOES open
      // a type-2 block and the two grammars cross the blank together. That
      // candidate is already refused by the html member, and this fix must
      // not be what refuses it — the aligned path stays exactly as it was.
      const aligned = '<!--\n\nstill inside\n\nmore\n';
      expect(computeFreezeBoundary(aligned, OFF)).toBe(0);
      const cp = scanFreezeBoundary(aligned, OFF).checkpoint as FreezeScanCheckpointInternal;
      expect(cp.mdBlock, 'micromark is still in its type-2 block, so the crossing is aligned').toEqual({
        kind: 'html',
        type: 2,
        indent: 0,
      });
      expect(cp.phasePoisonedAt, 'the aligned crossing must not poison').toBe(Infinity);
    });

    test('CLEAR: a CLOSED comment on that line still freezes', () => {
      // The poison keys on parse5 still being inside a comment at the blank,
      // not on the line having held one.
      const text = '<div><p></div></p>\n<!-- c -->\n\ntail\n\nmore\n';
      expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('more'));
    });
  });

  test('a line-START <!-- block keeps terminator semantics (no poison)', () => {
    const text = 'x\n\n<!--\ninner\n-->\n\ntail prose\n\nmore prose\n';
    expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('more prose'));
  });

  test('the real-math-open reading stays monotone across appends', () => {
    // With the open REAL (row 6 flip) there is no poison ceiling any more;
    // what must still hold is append-monotonicity — no earlier boundary
    // may retreat as the math block streams in and closes.
    const text = 'x\n\n<embed\n  src="x"\n/>\n$$\ne = mc^2\n\n$$\n\ntail prose\n\nmore prose\n';
    let prev = 0;
    for (let i = 1; i <= text.length; i++) {
      const b = computeFreezeBoundary(text.slice(0, i), OFF);
      expect(b, `regression at length ${i}`).toBeGreaterThanOrEqual(prev);
      prev = b;
    }
    expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('more prose'));
  });
});

describe('computeFreezeBoundary — overlapping terminators & parse5 divergence (2026-08 review P1)', () => {
  // The 2026-08 project review found three P1s in one seam: the line-level
  // scanner modelled comment/PI terminators after micromark, but (a) it
  // missed closers that OVERLAP their opener, and (b) the hast shape is
  // decided by parse5's tokenizer, which disagrees with CommonMark on
  // `--!>` and on where a bogus comment (`<?…`, `<![CDATA[…`) ends. In
  // every case a REAL `<details>` went uncounted and the boundary froze
  // past a parse5-open element (the v1.5.1 swallow class). All shapes were
  // outside every generator's alphabet — the fuzz families were extended
  // in the same change (fuzzGenerators overlapTerminatorArb / TOKENS
  // `>`, `-->`, `<?`), and the old scanner fails the arbiter within ~30
  // samples under them.

  test('<!--> and <!---> are CLOSED empty comments: the <details> after them counts', () => {
    expect(computeFreezeBoundary('<!-->\n<details>\n-->\n\nx\n\ny\n', OFF)).toBe(0);
    expect(computeFreezeBoundary('<!--->\n<details>\n-->\n\nx\n\ny\n', OFF)).toBe(0);
    // …and they do not leave a comment open (control: freezable prose after).
    const c1 = '<!--> after an empty comment\n\ny\n\nzzz';
    expect(computeFreezeBoundary(c1, OFF)).toBe(c1.indexOf('zzz'));
    const c2 = '<!---> after an empty comment\n\ny\n\nzzz';
    expect(computeFreezeBoundary(c2, OFF)).toBe(c2.indexOf('zzz'));
  });

  test('inside an OPEN comment, <!--> / <!---> still carry the -->  closer (soak seed 20260759)', () => {
    // The regex consumes `<!--` first, hiding the overlapping `-->` at +2/+3.
    expect(computeFreezeBoundary('<!--\n\n<!-->\n<details>\n-->\n\nx\n\ny\n', OFF)).toBe(0);
    expect(computeFreezeBoundary('<!--\n\n<!--->\n<details>\n-->\n\nx\n\ny\n', OFF)).toBe(0);
    const c = '<!--\n\n<!--> closes here\n\ny\n\nzzz';
    expect(computeFreezeBoundary(c, OFF)).toBe(c.indexOf('zzz'));
    // `<!--!>` inside an open comment is a parse5-only `--!>` closer → poison.
    expect(computeFreezeBoundary('<!--\n<!--!>\n<details>\n-->\n\nx\n\ny\n', OFF)).toBe(0);
  });

  test('<?> at line start is a CLOSED processing instruction (flow); inline it poisons', () => {
    expect(computeFreezeBoundary('<?>\n<details>\n?>\n\nx\n\ny\n', OFF)).toBe(0);
    const c = '<?> after an empty pi\n\ny\n\nzzz';
    expect(computeFreezeBoundary(c, OFF)).toBe(c.indexOf('zzz'));
    // Paragraph-inline `<?>`: micromark html-text still wants a `?>` after
    // `<?` (open), parse5 closes at that `>` — divergent → poisoned.
    // (No <details> here — the tag alone would block; this isolates the poison.)
    expect(computeFreezeBoundary('a <?> b\n\n?>\n\ny\n\nzzz', OFF)).toBe(0);
  });

  test('parse5 closes a comment at --!>; the window poisons only when it holds markup', () => {
    // P3b batch 2: `<details>` in the window is a REAL parse5 element
    // inside micromark's comment content — irreconcilable, poisoned.
    expect(computeFreezeBoundary('<!--x--!>\n<details>\n-->\n\nx\n\ny\n', OFF)).toBe(0);
    // A markup-free window is parse5 TEXT inside micromark's block: the
    // grammars converge at `-->` and freezing resumes (the retired
    // unconditional poison capped this at the opener).
    const t = 'x\n\n<!--x--!>\n-->\n\ny\n\nzzz';
    expect(computeFreezeBoundary(t, OFF)).toBe(t.indexOf('zzz'));
  });

  test('a PI / CDATA first-`>` window poisons only when it holds markup (batch 3)', () => {
    expect(computeFreezeBoundary('<?x >\n<details>\n?>\n\nx\n\ny\n', OFF)).toBe(0);
    expect(computeFreezeBoundary('a <?x > <details>\n\n?>\n\nx\n\ny\n', OFF)).toBe(0);
    expect(computeFreezeBoundary('<![CDATA[x>\n<details>\n]]>\n\nx\n\ny\n', OFF)).toBe(0);
    // A markup-free window is parse5 TEXT inside micromark's block — the
    // grammars converge at the terminator and freezing resumes (the
    // retired unconditional poison capped this at the opener).
    const t = 'x\n\n<?x >?>\n\ny\n\nzzz';
    expect(computeFreezeBoundary(t, OFF)).toBe(t.indexOf('zzz'));
    // Control: a PI whose only `>` is the terminator's stays exact (A6).
    const ok = '<?instr x ?>\n\ny\n\nzzz';
    expect(computeFreezeBoundary(ok, OFF)).toBe(ok.indexOf('zzz'));
  });

  test('remnant after an OVERLAPPING closer of a comment open at line start is still remnant (review of 5074c4b)', () => {
    // `<!--` … `<!--> tail`: the `-->` inside `<!-->` closes the comment,
    // ` tail` is floating raw text (parse5 seam, blocker 6). Regex masking
    // erased the `<!-->` before the "cut at -->" step and hid the remnant.
    expect(computeFreezeBoundary('<!--\n<!--> tail\n\n[a]:', OFF)).toBe(0);
    const t = 'intro\n\n<!--\n<!---> tail\n\n[a]:';
    expect(computeFreezeBoundary(t, OFF)).toBe(t.indexOf('<!--'));
    // Same overlap mid-line after a balanced element.
    expect(computeFreezeBoundary('<div></div> <!-- x <!--> tail\n\n[a]:', OFF)).toBe(0);
    // A stray `-->` outside any comment is remnant TEXT, not a token to strip.
    expect(computeFreezeBoundary('<?x?>-->\n\n[a]:', OFF)).toBe(0);
    // Controls: nothing after the closer → no remnant, freezable.
    const c = '<!--\n<!-->\n\nzzz';
    expect(computeFreezeBoundary(c, OFF)).toBe(c.indexOf('zzz'));
  });

  test('a same-line-closed type-2 block with trailing text is floating remnant (blocker 6)', () => {
    // Direction-battery counterexample surfaced by the new family: the
    // text after `-->` on the opener line is raw html content whose hast
    // seam depends on whether a sibling follows (def → paragraph flip).
    expect(computeFreezeBoundary('<!-- c --> after a comment\n\n[a]:', OFF)).toBe(0);
    expect(computeFreezeBoundary('<!--> after an empty comment\n\n[a]:', OFF)).toBe(0);
    // No trailing text → nothing floats; a pinning paragraph releases.
    const bare = '<!-- c -->\n\nzzz';
    expect(computeFreezeBoundary(bare, OFF)).toBe(bare.indexOf('zzz'));
    const pinned = '<!-- c --> tail\n\npinning paragraph\n\nzzz';
    expect(computeFreezeBoundary(pinned, OFF)).toBe(pinned.indexOf('zzz'));
  });

  test('boundary stays monotone across appends through a divergent construct', () => {
    const text = 'x\n\n<!--x--!>\n<details>\n-->\n\ny\n\nzzz\n';
    let prev = 0;
    for (let i = 1; i <= text.length; i++) {
      const b = computeFreezeBoundary(text.slice(0, i), OFF);
      expect(b, `regression at length ${i}`).toBeGreaterThanOrEqual(prev);
      expect(b, `poison ceiling at length ${i}`).toBeLessThanOrEqual(text.indexOf('<!--x'));
      prev = b;
    }
  });
});

describe('computeFreezeBoundary — link-definition destination validity (ghost defs, 2026-08 review P1)', () => {
  // micromark rejects these destinations, so the def line is a PARAGRAPH and
  // `[a]` stays a live shortcut ref that a later real def retargets. The
  // old rest check registered them (ghost def → taint released early →
  // frozen literal `[a]` flipped to a linkReference on the def's arrival).
  const ghost = (dest: string): string => `see [a] here\n\n[a]: ${dest}\n\nfiller\n\nzzz`;

  test('unbalanced or stray parentheses in a bare destination do not register', () => {
    expect(computeFreezeBoundary(ghost('/u(x'), OFF)).toBe(0);
    expect(computeFreezeBoundary(ghost('/u)'), OFF)).toBe(0);
    expect(computeFreezeBoundary(ghost('/u(x "title"'), OFF)).toBe(0);
  });

  test('angle destinations with an inner `<` or left unclosed do not register', () => {
    // (`<u<v>` also opens a `<v>` tag for the balance scan — 0 either way;
    // the arbiter fixture covers the retarget.)
    expect(computeFreezeBoundary(ghost('<u<v>'), OFF)).toBe(0);
    expect(computeFreezeBoundary(ghost('<u'), OFF)).toBe(0);
    expect(computeFreezeBoundary(ghost('<u "title"'), OFF)).toBe(0);
  });

  test('a backslash only escapes ( ) \\ in a bare destination — `\\ ` ends the run (review of 5074c4b)', () => {
    // micromark rawEscape: `\\` before anything but `(`, `)`, `\\` is a
    // literal backslash and the next char is judged normally — whitespace
    // ENDS the destination, so `[a]: /u\\ x` is a paragraph (garbage after
    // the destination) and `/u(\\ )` is unbalanced. The first cut skipped
    // any next char and registered ghosts.
    expect(computeFreezeBoundary(ghost('/u\\ x'), OFF)).toBe(0);
    expect(computeFreezeBoundary(ghost('/u\\\tx'), OFF)).toBe(0);
    expect(computeFreezeBoundary(ghost('/u(\\ )'), OFF)).toBe(0);
    // Angle form: `\\` escapes only `<`, `>`, `\\`.
    // (registers — taint released at the def line — but `<v>` opens a tag: pre-existing over-block after it)
    expect(computeFreezeBoundary(ghost('<u\\<v>'), OFF)).toBe(ghost('<u\\<v>').indexOf('[a]:'));
    expect(computeFreezeBoundary(ghost('<u\\ v>'), OFF)).toBe(ghost('<u\\ v>').indexOf('zzz')); // literal `\\`, valid, no tag shape
  });

  test('controls: balanced parens, escaped parens, empty angle destination all register', () => {
    for (const dest of ['/u(x)y', '/u\\(x', '<>', '/u "title"', '<u v> "title"']) {
      const t = ghost(dest);
      // `<u v>` registers (taint released) but also opens a `u` tag for the
      // balance scan — pre-existing over-block from the def line on.
      const expected = dest.startsWith('<u') ? t.indexOf('[a]:') : t.indexOf('zzz');
      expect(computeFreezeBoundary(t, OFF), dest).toBe(expected);
    }
  });

  describe('the definition decision reads the RAW line, not the code-span mask (F26)', () => {
    // A link reference definition is a BLOCK construct: micromark decides it
    // before any inline parsing, where backticks are ordinary characters and
    // a code span does not exist yet. The scanner masks intra-line code
    // spans to keep its INLINE extractions honest, then handed the same
    // masked line to the definition scan — and masking DELETES exactly the
    // content that invalidates a definition, so def-shaped paragraphs
    // registered as ghost defs and the `[label]` micromark leaves live as a
    // shortcut reference was never tainted.
    //
    // Found by the gate290 census leg (fragment band K=4, probe
    // `collideDef:x`) as a raw-layer under-block that REACHED SHIPPED
    // OUTPUT: mdast mismatch on the final frame, three of six configs. The
    // three defList-ON configs are quiet because blocker 4 holds the same
    // candidate for its own reasons — the usual second mechanism standing
    // in for a broken first one.
    test('a code span after the destination is junk, not a definition (was: 18 of 18)', () => {
      // The gate's own document. `[x]: /u` + spaces + a code span is a
      // PARAGRAPH; appending `[x]: /collide` turns its leading `[x]` into a
      // linkReference and splits the frozen text node 0-11.
      expect(computeFreezeBoundary('[x]: /u    `<d>`\n\n', OFF)).toBe(0);
    });

    test('a code span after a CLOSED title is junk too (was: 19)', () => {
      // The same cause one clause further along: the title parses, and the
      // mask hid the garbage that has to follow it.
      expect(computeFreezeBoundary('[a]: /u "t" `<d>`\n\ntail', OFF)).toBe(0);
    });

    test('the LABEL is raw too — a masked label registered the wrong identifier (was: 26)', () => {
      // Third projection of one cause: masking rewrote `[a`b`]` to `[a   ]`,
      // so the def registered under `a`, and the later `[a]` reference
      // resolved against a definition micromark calls `a`b``. The boundary
      // now stops at the unresolved reference instead of freezing past it.
      const text = '[a`b`]: /u\n\nsee [a] here\n\ntail';
      expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('see [a] here'));
    });

    test('CLEAR: a code span inside a TITLE still registers — the mask was the only problem', () => {
      // Backticks inside a quoted title are ordinary characters to
      // micromark, so this IS a definition and the taint still lifts.
      const text = '[a]: /u "ti`ck ti`ck"\n\ntail';
      expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('tail'));
    });

    test('CLEAR: masking still protects the INLINE extractions', () => {
      // The precision the mask exists for is untouched: a reference inside a
      // code span is code, not a live reference, and must not taint.
      const text = 'see `[a]` here\n\ntail';
      expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('tail'));
    });
  });
});

describe('computeFreezeBoundary — scanner profile (mathFlow/referenceTaint off)', () => {
  // The def-label scanner runs a PINNED remark-parse+gfm grammar (no math,
  // and it only extracts def IDENTITIES). These switches exist for it and
  // for nothing else; each test asserts the ENGINE profile's opposite
  // behavior alongside, so a silently ignored switch turns the test red.
  const SCANNER = { defListEnabled: false, mathFlow: false, referenceTaint: false };

  test('math-masking hole: $$-wrapped <!-- is an OPEN comment without remark-math', () => {
    // Engine grammar: `$$…$$` is flow math containing the `<!--` as inert
    // interior; the candidate after the blank is genuinely safe. Scanner
    // grammar: `$$` is paragraph text and `<!--` opens a type-2 HTML block
    // running to `-->`/EOF — a boundary after the blank would let a
    // standalone tail parse read `[x]: /u` OUTSIDE the comment and invent a
    // ghost def (oracle counterexample, Phase B design review).
    const text = '$$\n<!--\n$$\n\n[x]: /u\nprose\n';
    expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('[x]: /u'));
    expect(computeFreezeBoundary(text, SCANNER)).toBe(0);
    // Closing the comment releases candidates under the scanner profile too.
    const closed = '$$\n<!--\n$$\n-->\n\n[y]: /u\nprose\n';
    expect(computeFreezeBoundary(closed, SCANNER)).toBe(closed.indexOf('[y]: /u'));
  });

  test('math-masking hole survives CRLF line endings', () => {
    const text = '$$\r\n<!--\r\n$$\r\n\r\n[x]: /u\r\nprose\r\n';
    expect(computeFreezeBoundary(text, SCANNER)).toBe(0);
  });

  test('a ``` fence inside $$ really opens without remark-math', () => {
    // Engine grammar: the fence chars are math interior. Scanner grammar:
    // a REAL fence opens at line 2 and never closes — the blank line and
    // everything after it live inside code.
    const text = '$$\n```\n$$\n\n[x]: /u\n';
    expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('[x]: /u'));
    expect(computeFreezeBoundary(text, SCANNER)).toBe(0);
  });

  test('referenceTaint off: a streaming def footer does not collapse the boundary', () => {
    // Body cites [1]; the footer defs have no settling blank line yet.
    // Engine profile: blocker 5 rejects every candidate past the citation.
    // Scanner profile: def identity is block-level — the candidate after
    // the body survives and the footer stays in the (small) tail.
    const text = 'intro cites [1] and [2] here\n\n[1]: /a\n[2]: /b\n[3]: /c';
    expect(computeFreezeBoundary(text, OFF)).toBe(0);
    expect(computeFreezeBoundary(text, SCANNER)).toBe(text.indexOf('[1]: /a'));
  });

  test('referenceTaint off, CRLF variant', () => {
    const text = 'intro cites [1] here\r\n\r\n[1]: /a\r\n[2]: /b';
    expect(computeFreezeBoundary(text, SCANNER)).toBe(text.indexOf('[1]: /a'));
  });

  test('a profile switch invalidates a resumed checkpoint', () => {
    const text = 'para one\n\npara two\n\nmore';
    const engine = scanFreezeBoundary(text, OFF);
    // Resuming under a different profile must rebuild from scratch, not
    // reuse engine-profile state (math phase / taint tables differ).
    const rescanned = scanFreezeBoundary(text, SCANNER, engine.checkpoint);
    expect(rescanned.checkpoint).not.toBe(engine.checkpoint);
    // The public type is opaque; tests may look behind the brand.
    const cp = rescanned.checkpoint as FreezeScanCheckpointInternal;
    expect(cp.mathFlow).toBe(false);
    expect(cp.referenceTaint).toBe(false);
  });

  test('scanner profile keeps every non-math blocker intact', () => {
    // Unclosed container tag still blocks…
    expect(computeFreezeBoundary('<div>\ntext\n\nafter\n', SCANNER)).toBe(0);
    // …an open fence still blocks…
    expect(computeFreezeBoundary('```\ncode\n\nafter\n', SCANNER)).toBe(0);
    // …and plain prose still freezes normally.
    const text = 'para one\n\npara two\n\npara three';
    expect(computeFreezeBoundary(text, SCANNER)).toBe(text.indexOf('para three'));
  });
});

/**
 * THE ARBITER — splice-equivalence falsification for incremental parsing.
 *
 * Contract under test: for every streaming frame, the `{mdast, hast}` that
 * `advanceIncrementalParse` returns (spliced or not) is DEEP-EQUAL —
 * positions included — to a fresh full-pipeline run over the same snapshot.
 * This is the property production wiring relies on; a failure here is a
 * shipping bug, not a flaky test. Phase 1 does not land unless this suite
 * is green (plan gate).
 *
 * Coverage axes:
 * - plugin permutations from testPluginCatalog (incl. defaults-all-on — the
 *   original experiment's evidence gap, H2);
 * - realistic corpora (the Storybook benchmark payloads) at two chunk sizes;
 * - adversarial fixtures targeting each design-review hole: H1 reach-back
 *   retarget, H3 definition-list claim, H4 unclosed-fence tail with prefix
 *   defs, H5 root seam, H8 case-fold labels + multi-line def titles, plus
 *   loose lists, comment spans, non-append rewrites, `[^` arriving
 *   mid-stream, and CRLF line endings.
 */

import { describe, expect, test } from 'vitest';

import { DEFAULT_PAYLOAD, withDefs } from '../../fixtures/scenarios';
import {
  collectPrefixInjection,
  isExactSanitizeStrippedConstruct,
  isSanitizeStrippedConstruct,
  type InjectionEvent,
} from './spliceParse';
import { advanceIncrementalParse, type IncrementalParseState } from './advanceIncrementalParse';
import { buildAdvanceOptions, buildCrossChunkAdvanceOptions, CATALOG, type CatalogConfig } from './testPluginCatalog';
import { codePointSnapshots as chunkSnapshots } from './codePointSnapshots';
import { scheduleSnapshots } from './fuzzGenerators';
import { buildPhantomSuffix, phantomSuffixCloser } from '../remarkInjectPhantomDefs';
import { parseStage, transformStage } from '../markdown';
import { assertStreamEquivalence, runCrossChunk, runFull, type FramePair } from './spliceArbiterHarness';

// --- realistic corpora ------------------------------------------------------

describe('splice equivalence — corpora × plugin catalog', () => {
  for (const config of CATALOG) {
    test(`llm-typical [${config.label}]`, () => {
      const stats = assertStreamEquivalence('llm-typical', chunkSnapshots(DEFAULT_PAYLOAD, 17), config);
      // The corpus must actually exercise the splice, not just fall back.
      expect(stats.incrementalFrames).toBeGreaterThan(stats.frames / 2);
    });

    test(`llm-typical-with-defs [${config.label}]`, () => {
      // withDefs appends footnote refs/defs — v2 splices straight through
      // them (injection replay); the old `[^` bypass would cap this at the
      // pre-footnote frame count.
      const stats = assertStreamEquivalence('with-defs', chunkSnapshots(withDefs(DEFAULT_PAYLOAD), 64), config);
      expect(stats.incrementalFrames).toBeGreaterThan(stats.frames / 2);
    });
  }

  test('cjk-mixed [defaults-all-on]', () => {
    const payload = [
      '# 流式渲染语料',
      '这是一段中文散文,行内有 **加粗**、`代码`,以及一个[行内链接](https://example.com)。',
      '> 引用块:已完成的内容不应再承担任何额外开销。',
      '$$\ne^{i\\pi} + 1 = 0\n$$',
      '| 方案 | 复杂度 |\n| --- | --- |\n| 全量重解析 | O(N²) |\n| 前缀冻结 | O(N) |',
      '最后一段收尾。',
    ].join('\n\n');
    const stats = assertStreamEquivalence('cjk-mixed', chunkSnapshots(payload, 13), CATALOG[1]);
    expect(stats.incrementalFrames).toBeGreaterThan(0);
  });
});

// --- fuzz-found regressions ---------------------------------------------------
//
// Shrunk counterexamples from spliceFuzz.test.ts, frozen verbatim (schedule
// included — the failures are frame-alignment-sensitive). Each pinned a real
// engine bug on the fuzz arbiter's first day; see the fix commits for the
// mechanism notes.

describe('splice equivalence — fuzz-found regressions', () => {
  const FUZZ_CASES: Array<[string, string, number[], number]> = [
    // Root position on empty-output docs: hast-util-raw leaves the rebuilt
    // root's position undefined when its reparse consumed no tokens
    // (defs-only prefix + partially-streamed footnote def). Fixed by the
    // empty-spliced-output bail in spliceTrees.
    [
      'empty-output-root-position',
      '[a]: https://example.com/a\n\n[^a]: body text\n\n[a]: https://example.com/a\n\n> a quoted line\n',
      [4, 1, 8, 5, 4, 4, 4, 4],
      4,
    ],
    // Same rule crossed from the other side: removeComments turns a
    // comment-only prefix into zero raw tokens while the tail's unterminated
    // `<?` opener is tokenizer-dropped.
    [
      'empty-output-remove-comments',
      '<!--\ninner prose\n-->\n\n<?instr <b> ?> after the pi\n\n- tight one\n- tight two\n\nsee [a] maybe, or [a][a] even ![a]\n\n[^a]: body text\n\n[^a]: body text\n',
      [4, 4, 4, 4, 4, 1, 1, 4],
      1,
    ],
    // Code-span masking inside an html FLOW block (no blank line after
    // `</details>`): micromark does no inline parsing there, so the masked
    // `<div>` was a REAL unclosed tag — an under-block (correctness) hole.
    // Fixed by htmlFlowSinceBlank in computeFreezeBoundary.
    [
      'masking-in-html-flow',
      '[a]: https://example.com/a\n\n<details>\n<summary>t</summary>\nbody prose\n</details>\ninline `<div>` stays code\n\n> a quoted line\n\n<b>x</b> <!-- trailing opener\n\n$$\ne = mc^2\n\n',
      [4, 4, 4, 4, 1, 4, 4, 4],
      0,
    ],
    // Raw trailing literal of an html block (unblanked text line after the
    // closing tag) is position-less and attributed FORWARD — the prefix cut
    // dropped it and resynthesized a bare separator. Fixed by the
    // trailing-literal handling in the cut + alignPrefixCut seam merge.
    [
      'html-block-trailing-literal',
      '<details>\n<summary>t</summary>\nbody prose\n</details>\n> a quoted line\n\ninline `<div>` stays code\n\ninline `<div>` stays code\n',
      [4, 4, 4, 4, 4, 4, 4, 4],
      0,
    ],
    // Seam separators around a tokenizer-DROPPED unterminated `<?` opener
    // merge in a full parse (nothing sat between them at raw time) but kept
    // two nodes in the splice. Fixed by the three-valued seam verdict
    // (tailLeadingTextIsHoist) + the remnantMerged proof from the injection
    // gap.
    [
      'dropped-pi-seam-merge',
      '[^a]: body text\n\n> a quoted line\n\n<?instr <b> ?> after the pi\n\n> a quoted line\n\n[a]: https://example.com/a\n\nTerm line\n\n:   description body\n\n<embed\n  src="x"\n/>\n',
      [1, 4, 4, 4, 4, 4, 4, 4],
      0,
    ],
    // A bullet glued under a paragraph INTERRUPTS it (new list block), and
    // freezing at the blank inside `- loose one\n\n- loose two` cut ONE
    // loose list in half. Fixed by the mid-run marker classification in
    // computeFreezeBoundary (blocker 3).
    [
      'list-interrupts-paragraph',
      '- tight one\n- tight two\n\nplain prose keeps flowing here\n- loose one\n\n- loose two\n\n```\nconst x = "[a]<div>";\n\n```\n\nsee [a] maybe, or [a][a] even ![a]\n\n> a quoted line\n',
      [1, 4, 4, 9, 6, 1, 1, 4],
      0,
    ],
    // Same stale-verdict hole after a just-closed `$$` line: the glued
    // ordered item starts a list whose blank-straddling continuation (the
    // indented line) must block the candidate.
    [
      'math-close-glued-list',
      '$$\ne = mc^2\n$$\n1. ordered\n2. items\n\n    <details>[a] scanned literal\n\nplain prose keeps flowing here\n',
      [4, 19, 5, 4, 4, 4, 4, 4],
      0,
    ],
    // A def-shaped line on an html-flow continuation line is raw text —
    // registering it released footnote taint AND replayed a definition the
    // real parse never had. Fixed by gating DEF_RE on htmlFlowSinceBlank.
    [
      'ghost-footnote-def-in-flow',
      '<details>\n<summary>t</summary>\nbody prose\n</details>\n[^a]: body text\n\n\nprose with [a] used\n\nplain prose keeps flowing here\n\n[^a]: body text\n',
      [4, 4, 6, 1, 4, 4, 4, 1],
      0,
    ],
    // The raw trailing literal keeps hast-util-raw's SOURCE position while
    // document-final and loses it when merged with following content — the
    // cut must re-drop / reconstruct the position per the CURRENT layout.
    [
      'literal-position-lifecycle',
      '- tight one\n- tight two\n\n<details>\n<summary>t</summary>\nbody prose\n</details>\n> a quoted line\n\n```\nconst x = "[a]<div>";\n```\n\n> a quoted line\n\n- tight one\n- tight two\n',
      [1, 1, 12, 14, 1, 27, 14, 11],
      0,
    ],
    // Footer-only tails (all-invisible mdast, orphan footnote def) still
    // emit the footer separator, which the full parse merges into the
    // trailing literal — the join's literal-seam branch.
    [
      'literal-footer-seam',
      'inline `<div>` stays code\n\n<details>\n<summary>t</summary>\nbody prose\n</details>\n[a]: https://example.com/a\n\n[^a]: body text\n\n<details>\ninner prose\n</details>\n\n> a quoted line\n',
      [4, 4, 10, 1, 4, 4, 4, 4],
      0,
    ],
    // Table hoist newlines merged into the trailing literal GROW with the
    // streaming tail — every trailing '\n' on the cut literal is a previous
    // frame's artifact and must be rebuilt from the current tail.
    [
      'literal-table-hoist-growth',
      '- tight one\n- tight two\n\n<details>\n<summary>t</summary>\nbody prose\n</details>\n[a]: https://example.com/a\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n> a quoted line\n\n```\nconst x = "[a]<div>";\n```\n\n> a quoted line\n\n- tight one\n- tight two\n',
      [1, 1, 8, 4, 1, 4, 4, 4],
      0,
    ],
    // A ``` line glued to `</details>` is raw text, not a fence — entering
    // fence state skipped tag extraction on a line rehype-raw parses as a
    // REAL `<div>`. Fence/math opens now gate on htmlFlowSinceBlank.
    [
      'fence-glued-to-details',
      'inline `<div>` stays code\n\n<details>\n<summary>t</summary>\nbody prose\n</details>\n```\nconst x = "[a]<div>";\n```\n\n[a]: https://example.com/a\n\n[^a]: body text\n\n<details>\ninner prose\n</details>\n\n> a quoted line\n',
      [4, 4, 4, 4, 4, 1, 4, 4],
      0,
    ],
    // `[a]: url` glued under a paragraph line is literal text where `[a]`
    // is still a live shortcut reference — the def-shaped skip in ref
    // extraction under-tainted it and a later real def retargeted frozen
    // output.
    [
      'def-shaped-paragraph-continuation',
      '[注一]: https://example.com/注一\n\n[注一]: https://example.com/注一\n\nTerm line\n\n:   description body\n[a]: https://example.com/a\n\nprose with [a] used\n\nsee [a] maybe, or [a][a] even ![a]\n\n[a]: https://example.com/a\n\nTerm line\n\n:   description body\n',
      [4, 4, 4, 4, 4, 4, 4, 4],
      0,
    ],
    // Doc-final literal position reconstruction: a literal that lost its
    // position to an earlier merge regains [prev element end, owner html
    // node end] when the document ends with an invisible tail.
    [
      'literal-position-reconstruction',
      '<details>\n<summary>t</summary>\nbody prose\n</details>\n> a quoted line\n\n[a]: https://example.com/a\n\nprose with [a] used\n\nTerm line\n\n:   description body\n',
      [4, 1, 4, 1, 4, 4, 4, 4],
      0,
    ],
    // A footnote def does NOT chain (its unindented next line lazily
    // continues the BODY): a def-shaped glued line was a ghost def.
    [
      'footnote-def-no-chain',
      '[^a]: body text\n[a]: https://example.com/a\n\n[spec]: https://example.com/spec\n\n- tight one\n- tight two\n\n[a]: https://example.com/a\n\n[^a]: body text\n',
      [4, 1, 4, 4, 4, 4, 4, 4],
      0,
    ],
    // Type 2-5 raw constructs end at their TERMINATOR's line, not at a
    // blank: a sticky html-flow flag set by `<!--` suppressed the REAL `$$`
    // open right after `-->`, and the blank inside the math block became a
    // candidate that split the math. rawOpenAtLineStart now scopes those
    // interiors exactly.
    [
      'comment-terminator-then-math',
      'a ref `[x]` in a span, plain prose keeps flowing here\n<!--\ninner prose\n-->\n$$\ne = mc^2\n\n$$\n\n```\nconst x = "[a]<div>";\n\n```\n\n> a quoted line\n\n$$\ne = mc^2\n\n$$\n\n> a quoted line\n',
      [16, 9, 12, 1, 17, 16, 1, 32],
      0,
    ],
    // `<embed` is NOT a type-6 tag name and (truncated) fails type 7 — the
    // "html block" is really a PARAGRAPH, and the glued `$$` a REAL math
    // open interrupting it. The ambiguous-tag run now poisons the hazard
    // verdict (pure over-block) instead of suppressing the math open.
    [
      'ambiguous-tag-glued-math',
      '<embed\n  src="x"\n/>\n\n<embed\n  src="x"\n/>\n$$\ne = mc^2\n\n$$\n\n<![CDATA[<div>data</div>]]> trailing prose\n\n<![CDATA[<div>data</div>]]> trailing prose\n\n[^a]: body text\n\n> a quoted line\n',
      [4, 4, 4, 4, 4, 30, 4, 4],
      0,
    ],
    // Deep-soak pair (50k fuzz / K=4 census): merged raw-remnant whitespace
    // around dropped/stripped constructs is out of the plain-slot seam
    // model — a trailing separator that is not exactly '\n', or a tail
    // LEADING with positioned bare text, now bails to a full parse instead
    // of silently dropping the remnant bytes.
    [
      'undercount-composed-remnant-space',
      '<details>\n<summary>t</summary>\nbody prose\n</details>\n<b>x</b> <!-- trailing opener\n<details>\ninner prose\n</details>\n\n<!-- a closed comment -->\n\n[a]: https://example.com/a\n\n> a quoted line\n\n$$\ne = mc^2\n\n',
      [4, 4, 4, 4, 4, 4, 4, 4],
      0,
    ],
    ['end-tag-trailing-spaces', 'a\n\n</d>    ', [3, 8], 0],
    // micromark requires a NON-EMPTY destination for a link definition: a
    // bare `[x]: ` line is a paragraph whose `[x]` stays a live shortcut
    // ref — registering it as a def released the taint and let the later
    // real def retarget frozen output (K=4 census counterexample).
    ['destination-less-def-shape', '[x]: \n\n[x]: /u', [7, 4], 0],
    // Same rule, other face: non-title garbage AFTER the destination also
    // invalidates the def — the line is a paragraph with live `[x]` refs.
    ['def-shape-trailing-garbage', '[x]: /u[x]: /u\n\n[x]: /u', [17, 6], 0],
    // Math flow fences carry a LENGTH like code fences: `$$$$` opens a
    // 4-dollar fence that swallows everything until a ≥4-dollar close —
    // treating it as same-line open+close froze a math block that the real
    // parse extends with each append (K=4 sharded census).
    ['math-fence-length', '$$$$\n\na', [6, 4], 0],
    ['math-fence-length-multi', '$$$$\n\n---', [3, 6], 0],
    // A def title left OPEN at EOL may be invalidated by garbage after its
    // close on the CONTINUATION line — registering at the opener line was
    // premature. Multi-line titles now never register (A2 edge).
    ['def-title-closed-then-garbage', '[x]: /u "t\nt2"a\n\n[x]: /u', [17, 5], 0],
    // Credit-refinement soak pair (300k fresh seeds, 2026-08-04). A
    // paragraph-inline `<!--` that never closes is literal TEXT to
    // micromark, but the detector's comment scan skipped the REAL unclosed
    // `<details>` after it as "comment interior" — the boundary landed past
    // an element whose raw-time node absorbs every later sibling. Fixed by
    // the inline-comment-opener phase poison (blocker 7 family).
    [
      'inline-comment-opener-poison',
      '- tight one\n- tight two\n\nplain prose keeps flowing here, inline `<div>` stays code, <b>x</b> <!-- trailing opener\n\n<details>\n\n<!-- a closed comment -->\n\nsee [a] maybe, or [a][a] even ![a]\n\n```\nconst x = "[a]<div>";\n```\n',
      [12, 22, 1, 16, 4, 4, 4, 31],
      3, // fuzz configIndex 21 % CATALOG.length — display-only
    ],
    // A stripped-construct remnant (`<?instr <b> ?>` → ` ?>`) is a
    // position-less content text that follows a TEXT node — attribution
    // stalls on the last positioned child and pulled the CURRENT TAIL's
    // remnant into the cut, duplicating it once the tail re-parsed. The cut
    // now requires a positioned-element predecessor for any position-less
    // content text (ownership by parse5 adjacency) and bails otherwise.
    [
      'tail-remnant-ownership',
      '<details>\n<summary>t</summary>\nbody prose\n</details>\nprose with [a] used\n\n[^a]: body text\n\n    indented continuation\n\n[a]: https://example.com/a\n\n<?instr <b> ?> after the pi\n\n```\nconst x = "[a]<div>";\n\n```\n\n[a]: https://example.com/a\n',
      [4, 4, 4, 1, 4, 4, 1, 4],
      0,
    ],
    // Round-3 soak (seeds 20260841/44/50). A 4-indented line GLUED after a
    // fence close starts an indented code block that merges across later
    // blanks (A1) — the stale rolling verdict let a candidate split it.
    // classifyBlockStart's glued-marker branch now covers indent >= 4.
    [
      'glued-indented-code-after-fence',
      '- tight one\n- tight two\n\n[^b]: body text\n\n<details>\ninner prose\n</details>\n\n```\nconst x = "[a]<div>";\n```\n    [^b]: not a real def\n\n    <details>[a] scanned literal\n\n[^a]: body text\n',
      [7, 4, 4, 7, 4, 4, 1, 1],
      0,
    ],
    [
      'glued-indented-code-after-fence-cdata',
      '[^b]: body text\n\nplain prose keeps flowing here\n\n```\nconst x = "[a]<div>";\n```\n    [^b]: not a real def\n\n    <details>[a] scanned literal\n\n<details>\ninner prose\n</details>\n\n[^a]: body text\n\n<![CDATA[<div>data</div>]]> trailing prose\n\n[^a]: body text\n',
      [4, 4, 9, 4, 4, 4, 4, 1],
      0,
    ],
    // A frozen html child ending in a sanitize-stripped construct
    // (`</details>\n<!--…-->`) leaves interior whitespace that the full
    // parse merges into the seam separator ("\n\n") — the plain-slot
    // trailing rebuild was blind to it (the merged node never reaches the
    // cut). The stripped-tail bail now sends those frames to a full parse.
    [
      'stripped-tail-seam-residue',
      '- tight one\n- tight two\n\n- tight one\n- tight two\n\n<details>\n<summary>t</summary>\nbody prose\n</details>\n<!--\n- tight one\n- tight two\n\n<!--\ninner prose\n-->\n\nprose with [a] used\n\nTerm line\n\n:   description body\n\nTerm line\n\n:   description body\n\n[^a]: body text\n',
      [4, 4, 4, 4, 1, 4, 4, 4],
      1, // fuzz configIndex 563389549 % CATALOG.length — defaults-all-on
    ],
    // 2026-08 project-review P1 family (eng-parse-01/02/03), surfaced by
    // the generator families added in the same change (the pre-fix scanner
    // fails each within ~30 fuzz samples). (a) `<!-->` is a CLOSED empty
    // comment (closer overlaps the opener) — the scanner left a comment
    // open, skipped the REAL `<details>` and froze past it; the tail was
    // then reparented into the frozen element by rehype-raw.
    [
      'overlap-empty-comment-swallow',
      'plain prose keeps flowing here\n\n<!-->\n<details>\n-->\n\n[a]: https://example.com/a\n\n> a quoted line\n',
      [4, 1, 1, 4, 4, 4, 4, 4],
      0,
    ],
    ['overlap-empty-pi-swallow', '<?>\n<details>\n?>\n\nx\n\ny\n\nz\n', [6, 4, 3, 5], 0],
    // Same closer hidden INSIDE an open comment: `<!--` … `<!-->` — the
    // regex consumed the `<!--` and never saw the `-->` it overlaps (release
    // soak seed 20260759, first run after the fix above).
    [
      'overlap-closer-inside-open-comment',
      '[^a]: body text\n\n[a]: https://example.com/a\n\n<!-- a closed comment -->\n\n```\nconst x = "[a]<div>";\n\n```\n\n<!--\n\n<!-->\n<details>\n-->\n\nplain prose keeps flowing here\n\n```\nconst x = "[a]<div>";\n\n```\n\n- tight one\n- tight two\n\nTerm line\n\n:   description body\n',
      [4, 4, 4, 4, 4, 1, 4, 4],
      0,
    ],
    // (b) parse5 closes a comment at `--!>` and a bogus comment (`<?…`) at
    // its FIRST `>`; CommonMark needs `-->` / `?>`. The bytes in between
    // are raw text to micromark but real markup to parse5 → poisoned.
    ['bang-comment-closer-swallow', '<!--x--!>\n<details>\n-->\n\nx\n\ny\n\nz\n', [1], 0],
    ['pi-first-gt-swallow', '<?x >\n<details>\n?>\n\nx\n\ny\n\nz\n', [10], 0],
    // (c) ghost definitions: micromark rejects `/u(x` (unbalanced paren)
    // and `<u<v>` (inner `<`) as destinations, so the line is a paragraph
    // and `[b]` stays a live ref — the old scanner registered the def,
    // released the taint, and the real def's arrival retargeted the frozen
    // literal into a linkReference.
    [
      'ghost-def-unbalanced-paren',
      '[b]: /u(x\n\n[^a]: body text\n\n> a quoted line\n\n[b]: https://example.com/b\n\n<embed\n  src="x"\n/>\n',
      [4, 1, 4, 4, 4, 4, 4, 4],
      0,
    ],
    ['ghost-def-angle-inner-lt', 'see [a] here\n\n[a]: <u<v>\n\ny\n\n[a]: /real\n\nz\n', [1], 0],
    // v2.4.0 review (engine): R2(a) masked-`>` revert of a real tag; R2(b)
    // phantom open skipping the seam check; P1 tag after a raw terminator;
    // P2 whitespace-only remnant. (P5 `[ __aimd_…]` is in the replay
    // describe below.)
    ['review-r2a-masked-gt-real-tag', 'a <div x="`">b`\n\npara\n', [17, 5], 0],
    ['review-r2b-truncated-seam-remnant', '<!A> <div a\n\n$', [1], 0],
    ['review-p1-tag-after-terminator', '<?php\n?><details>\n\npara\n\nmore\n', [19, 6], 0],
    ['review-p2-whitespace-remnant', '<!-- c --> </s>\n\n-', [1], 0],
    // P3: a stray end tag's dropped-block remnant (`</t>\na` → position-less
    // "\n\na") sat right after a frozen <p>; the cut took it as the
    // paragraph's "trailing literal" and the tail re-parse produced it
    // again. Only html-block output can own a trailing literal.
    ['review-p3-stray-end-tag-remnant-dup', 'a\n\n</t>\na\n\n>', [1], 0],
    ['review-p3-stray-end-tag-remnant-dup-defaults', 'a\n\n</t>\na\n\n>', [1], 1],
    // Join side of the same class: the tail STARTS with the dropped-tag
    // block, so its remnant must merge with the seam separator (fuzz, after
    // the `</t>\ntext` generator shape landed).
    // …and a tail whose leading html block is an unterminated `<div` opener
    // (parse5 drops it at EOF-in-tag; whether a node sat between the
    // separator and the following remnant needs the tokenizer) — bails to
    // a full parse instead of guessing (release soak of 2.4.1).
    [
      'review-p3-dropped-opener-tail-bail',
      '```\nconst x = "[a]<div>";\n\n```\n\n- tight one\n- tight two\n\nplain prose keeps flowing here\n\n> a quoted line\n\n<div\n\n</t>\ntext after a stray end tag\n\n```\nconst x = "[a]<div>";\n```\n\nsee [a] maybe, or [a][a] even ![a]\n\n[a]: https://example.com/a\n\n<![CDATA[<div>data</div>]]> trailing prose\n',
      [1, 4, 4, 8, 4, 4, 4, 4],
      0,
    ],
    [
      'review-p3-stray-end-tag-tail-merge',
      '> a quoted line\n\n[^a]: body text\n\n</t>\ntext after a stray end tag\n\ninline `<div>` stays code\n\n> a quoted line\n',
      [4, 4, 4, 4, 4, 4, 4, 4],
      0,
    ],
    // v2.4.1 review P1: (a) a line holding only U+3000 / U+00A0 is NOT a
    // blank line for micromark (`trim()` said it was) — the paragraph
    // continues across it, so the frozen boundary landed inside an unfinished
    // paragraph; (b) a shortcut reference whose label spans a soft line
    // break escaped the per-line REF_RE and a late def retargeted it.
    ['review-241-p1a-ideographic-space-lines', 'foo\n\u3000\n\u3000\nbar\n', [8, 4], 0],
    ['review-241-p1a-nbsp-fence-closer', '```\ncode\n```\u00a0\nstill code\n```\n\nx\n\ny\n', [4], 0],
    ['review-241-p1a-nbsp-math-closer', '$$\nx\n$$\u3000\nstill math\n$$\n\nx\n\ny\n', [4], 0],
    ['review-241-p1b-cross-line-shortcut-ref', 'see [foo\nbar] end\n\nx\n\ny\n\n[foo bar]: /url\n', [4], 0],
    ['review-241-p1b-cross-line-shortcut-ref-defaults', 'see [foo\nbar] end\n\nx\n\ny\n\n[foo bar]: /url\n', [4], 1],
    ['review-241-p1b-three-line-label', 'see [foo\nbar\nbaz] end\n\nx\n\ny\n\n[foo bar baz]: /url\n', [4], 0],
    // v2.4.1 review P2: an html block whose trailing end tag(s) parse5 drops
    // leaves a POSITIONED whitespace-only remnant (`</details>\n</details>`
    // → "\n" 20-21) that the full parse later merges, position-less, with
    // the seam separator. Cut side: whitespace-only positioned tail → bail;
    // output-ends-before-source → bail.
    ['review-241-p2-dropped-end-tags-remnant', '</details>\n</details>\n\nx\n\ny\n', [1], 0],
    ['review-241-p2-dropped-extra-end-tag-remnant', '<details>\n</details>\n</details>\n\nx\n\ny\n', [1], 0],
    ['review-241-p2-dropped-extra-end-tag-remnant-defaults', '<details>\n</details>\n</details>\n\nx\n\ny\n', [4], 1],
    // Follow-ups from the adversarial review of the first fix.
    ['review-241-fu-def-rest-nbsp-ghost', '[a]\n\n[a]: /u "t"\u00a0\n\npara\n\n[a]: /v\n', [4], 0],
    ['review-241-fu-u3000-before-inline-comment', '\u3000<!-- c\n<details>\n\n-->\n\npara\n\nmore\n', [4], 0],
    ['review-241-fu-failed-inline-link-retarget', '[foo](bad url) x\n\npara\n\n[foo]: /v\n', [4], 0],
    ['review-241-fu-failed-inline-link-retarget-defaults', '[foo](bad url) x\n\npara\n\n[foo]: /v\n', [1], 1],
    // Release soak of 2.4.2 (pre-existing on 2.4.1): a stray `</details>`
    // html block as the LAST frozen child — parse5 drops it outright, so the
    // full parse merges the separators around it into one "\n\n" while the
    // trailing rebuild emitted two bare '\n' (the sanitize-stripped shape).
    ['soak-242-dropped-trailing-end-tag-block', '</details>\n<!-- c\n\n-->\n</details>\n\nx\n\ny\n', [1], 0],
    [
      'soak-242-dropped-trailing-end-tag-block-fuzz',
      '<details>\n<summary>t</summary>\nbody prose\n</details>\n\u3000<!-- c\n<details>\n\n-->\ninner prose\n</details>\n\n[^a]: body text\n\n$$\ne = mc^2\n\n$$\n\nfoo line\n\u3000\n\u3000\nbar joins the paragraph\n\nprose with [a] used\n',
      [4, 1, 4, 4, 4, 1, 4, 4],
      0,
    ],
    // v2.4.2 review P1-1/P1-2: parse5 SYNTHESIZES a stray `</br>` / `</p>`
    // (the tail-only parse cannot), and a stray `<td>` foster-parents the
    // following table's cell text to the root, merging the table's own line
    // endings into the separator after it.
    ['review-242-p1-stray-br-end-tag', 'x\n\n</br>\n\ny\n', [1], 0],
    ['review-242-p1-stray-p-end-tag', 'x\n\n</p>\n\ny\n', [4], 1],
    ['review-242-p1-stray-br-with-text', 'x\n\n</br>\ntext\n\ny\n', [3, 5], 0],
    ['review-242-p1-stray-td-then-table', '<td>s</td>\n\n| a |\n| - |\n\nx\n\ny\n', [1], 0],
    ['review-242-p1-stray-td-then-table-defaults', '<td>s</td>\n\n| a |\n| - |\n\nx\n\ny\n', [3, 5], 1],
    // Adversarial follow-up: the quirks poison the tail's whole LEADING html
    // run (a comment / PI before the stray tag does not switch parse5 to
    // body mode) and, for table parts, the rest of the document.
    ['review-242-fu-comment-then-stray-br', 'x\n\n<!-- c -->\n\n</br>\n\ny\n', [3, 30], 0],
    ['review-242-fu-pi-then-stray-br', 'x\n\n<?php x ?>\n\n</br>\n\ny\n', [3, 30], 0],
    ['review-242-fu-comment-glued-stray-br', 'x\n\n<!-- c -->\n</br>\n\ny\n', [3, 30], 0],
    ['review-242-fu-comment-then-stray-td', 'x\n\n<!-- c -->\n\n<td>s</td>\n\ny\n', [3, 30], 0],
    ['review-242-fu-stray-col', 'x\n\n<col>\n\ny\n', [1, 1], 1],
    ['review-242-fu-stray-td-table-in-tail', '<td>s</td>\n\npara\n\n| a |\n| - |\n\nx\n\ny\n', [1, 1], 0],
    ['review-242-fu-stray-td-math-table-in-tail', '<td>s</td>\n\n$$\na\n$$\n\n| a |\n| - |\n\nx\n\ny\n', [1, 1], 1],
    ['review-241-p1b-cross-line-full-ref', 'see [text\nmore][foo] end\n\nx\n\ny\n\n[foo]: /url\n', [4], 0],
    // F29 (2026-09-15): parse5's "any other end tag" walk stops at a SPECIAL
    // element, so `</span>` under an open `<div>` is dropped and the span
    // swallows the rest of the document. The scope walk stopped at barriers
    // only and read the pair as balanced. Boundary 0 now — the fixture pins
    // the poison plus the full path.
    ['f29-span-div-block', '<span>\n<div>\n</span>\n</div>\n\npara\n', [1], 0],
    ['f29-span-div-one-line', '<span><div></span></div>\n\npara\n', [1], 0],
    ['f29-sup-pre-block-defaults', '<sup>\n<pre>\n</sup>\n</pre>\n\n*b*\n', [3, 30], 1],
    // F30 (2026-09-15, fuzz seeds 20260916 / 20260917): a footnote body
    // ending in an OPEN fence puts the definition's end one line ending past
    // the fence line; the '\n\n' replay join added a blank line inside the
    // fence and the footer's positions rebased by the tail delta. These
    // splice, and must keep splicing.
    ['f30-footnote-open-fence-tab', '[^a]: b\n\n\t```\n\n<b>x</b>\n\np\n', [1], 0],
    // v3.1.0 release soak (seed 202609405): after an indented code block an
    // empty marker line `-` followed by `  [x] ...` is a paragraph in
    // micromark, not a task item, so a late `[x]:` definition turns the box
    // into a link; the tracker had certified it as a checkbox.
    [
      'soak-empty-marker-after-indented-code',
      '\tcode indented by tab\n\tsecond code line\n\n-\n  [x] after an empty marker\n\nfoo line\n\u3000\n\u3000\nbar joins the paragraph\n\nplain prose keeps flowing here\n\nplain prose keeps flowing here\n\n[x]: /late\n',
      [1, 4, 4, 4, 4, 4, 4, 4],
      0,
    ],
    ['f30-footnote-open-fence-spaces-defaults', '[^a]: b\n\n    ```\n\n<b>x</b>\n\np\n', [4, 4, 4, 1], 1],
    ['f30-footnote-open-math', '[^a]: b\n\n\t$$\n\n<b>x</b>\n\np\n', [3, 30], 2],
    ['f30-footnote-open-fence-container-closer', '[^a]: b\n\n\t```\n\n[^c]: d\n\n<b>x</b>\n\np\n', [1], 0],
  ];

  // Many of these shapes have since been poisoned to boundary 0 by a later
  // blocker — the fixture then pins the poison plus the full path, not the
  // splice. Per-case engagement is therefore opted out and the anti-vacuity
  // claim is made once over the whole family (measured 839 of 3628 frames).
  let familyIncremental = 0;
  for (const [name, payload, sizes, configIdx] of FUZZ_CASES) {
    test(name, () => {
      // Frame-alignment matters: replay BOTH the exact failing schedule and
      // its reverse, matching the fuzz driver's coverage.
      for (const schedule of [sizes, [...sizes].reverse()]) {
        familyIncremental += assertStreamEquivalence(name, scheduleSnapshots(payload, schedule), CATALOG[configIdx], {
          minIncrementalFrames: 0,
        }).incrementalFrames;
      }
    });
  }

  test('the fuzz-case family still exercises the splice', () => {
    expect(familyIncremental, 'every pinned fuzz counterexample now runs the full path only').toBeGreaterThan(0);
  });
});

// --- adversarial fixtures ----------------------------------------------------

describe('splice equivalence — adversarial fixtures', () => {
  const ALL_ON = CATALOG[1];
  const BASELINE = CATALOG[0];

  test('H1 reach-back: shortcut ref resolved by a late definition', () => {
    // The ref parses as literal text until the def arrives; the boundary
    // must not jump past prev's literal-rendered paragraph the moment the
    // def settles. min(fresh, prev.stableBoundary) is the fix under test.
    const payload =
      'See [spec] for the details.\n\nfiller one.\n\nfiller two.\n\n[spec]: https://spec.commonmark.org\n\ntrailing paragraph.\n';
    for (const config of [BASELINE, ALL_ON]) {
      assertStreamEquivalence('h1-reach-back', chunkSnapshots(payload, 9), config);
    }
  });

  test('H3 definition-list: `: desc` claims a term across one blank line', () => {
    const payload = 'Term\n\n:   the description body\n\ncolumn zero paragraph.\n\ntrailing.\n';
    assertStreamEquivalence('h3-deflist-claim', chunkSnapshots(payload, 7), ALL_ON);
  });

  test('H4 prefix defs + tail ending inside an unclosed fence', () => {
    // Injection must be PREPENDED: an appended def would be swallowed by the
    // open fence and change the tail's code node.
    const payload =
      '[a]: https://example.com/a\n\nSee [text][a] resolved early.\n\n```js\nconst x = 1;\nconst y = 2;\n```\n\ndone.\n';
    for (const config of [BASELINE, ALL_ON]) {
      const stats = assertStreamEquivalence('h4-unclosed-fence-tail', chunkSnapshots(payload, 8), config);
      expect(stats.incrementalFrames).toBeGreaterThan(0);
    }
  });

  test('H4 variant: unclosed $$ math at the tail', () => {
    const payload = '[a]: https://example.com\n\nuse [link][a] here.\n\n$$\na = 1\nb = 2\n$$\n\nafter.\n';
    assertStreamEquivalence('h4-unclosed-math-tail', chunkSnapshots(payload, 8), BASELINE);
  });

  test('H5 seam: comments removed near the boundary (remove-comments on)', () => {
    const payload = 'para one.\n\n<!-- a removed comment -->\n\npara two.\n\npara three.\n';
    assertStreamEquivalence('h5-seam-comment', chunkSnapshots(payload, 6), ALL_ON);
  });

  test('H8 case-fold labels: ref [ß] resolved by def [SS]', () => {
    const payload = 'weight [ß] here.\n\n[SS]: https://example.com\n\ntail paragraph.\n';
    assertStreamEquivalence('h8-case-fold', chunkSnapshots(payload, 6), BASELINE);
  });

  test('H8 multi-line definition title', () => {
    const payload =
      '[a]: https://example.com "a title\nspanning two lines"\n\nuse [text][a] later.\n\nmore prose here.\n\nend.\n';
    // The two-line title keeps the def unresolved to the scanner, so the
    // boundary stays at 0 and no frame splices — the pin is the full path.
    assertStreamEquivalence('h8-multiline-title', chunkSnapshots(payload, 7), BASELINE, { minIncrementalFrames: 0 });
  });

  test('loose list extended across blank lines', () => {
    const payload = '- alpha\n\n  beta continues the item\n\n- gamma\n\ncol zero closes.\n\ntail.\n';
    assertStreamEquivalence('loose-list', chunkSnapshots(payload, 6), BASELINE);
  });

  test('review-confirmed detector corners A1-A6 (2026-07-15)', () => {
    // Each of these once produced real splice/full divergence (probe
    // MISMATCH) before its blocker landed; see the review record in the
    // engine memory. A6's `<?…?>` becomes a parse5 bogus comment that
    // sanitize strips — since the stripped-node alignment landed (v2 Phase
    // B) the engine SPLICES across it; the dedicated stripped-node suite
    // below asserts the splice actually engages.
    const corners: Array<[string, string, number]> = [
      ['A1-indented-code-merge', '    a\n\n    b\n\ncol zero\n\ntail.\n', 3],
      ['A2-def-on-continuation-line', '[a]\n\npara\n[a]: /x\n\nmore\n\n[a]: /y\n\nz [a]\n', 4],
      ['A3-blockquote-nested-def', '> [a]: /url\n\ntext\n\n[a]\n\nafter.\n', 4],
      ['A4-midline-math-close', '$$\na $$\nb\n$$\n\nafter math.\n', 3],
      ['A5-fence-info-backtick', '```a``` b\n<div>\nc\n</div>\n\nafter.\n', 4],
      ['A6-html-type3-pi', '<?data\n\nmore\n?>\n\nafter.\n', 3],
    ];
    let incremental = 0;
    for (const [name, payload, chunk] of corners) {
      for (const config of [BASELINE, ALL_ON]) {
        incremental += assertStreamEquivalence(name, chunkSnapshots(payload, chunk), config, {
          minIncrementalFrames: 0,
        }).incrementalFrames;
      }
    }
    // A3's container-nested def degrades to full parses by design, so the
    // anti-vacuity floor is the corner family's aggregate.
    expect(incremental).toBeGreaterThan(0);
  });

  test('code-span masking corners: intra-line spans splice, cross-line spans over-block', () => {
    // Intra-line `<div>`/`[x]` inside spans must not disengage splicing —
    // and cross-line spans (unpaired run carrying into the next line) must
    // fall back to raw scanning without ever unmasking real markup.
    const payloads = [
      'use `<div>` and `[x]` inline\n\npara two.\n\ntail.\n',
      'a `x\n<div> y` b\n\nfiller one.\n\ntail.\n',
      'mixed `code` and <em>real</em> tags\n\nafter.\n\nend.\n',
    ];
    let incremental = 0;
    for (const payload of payloads) {
      for (const config of [BASELINE, ALL_ON]) {
        incremental += assertStreamEquivalence('code-span-mask', chunkSnapshots(payload, 5), config, {
          minIncrementalFrames: 0,
        }).incrementalFrames;
      }
    }
    // The cross-line span payload over-blocks to zero on purpose — that is
    // half the claim — so the floor is the aggregate over the three.
    expect(incremental).toBeGreaterThan(0);
  });

  test('multi-line open tag (line-truncated `<div`) swallow class', () => {
    // `<div` + EOL opens an html block whose tag completes on the NEXT line;
    // the single-line tag scan used to miss it (6 mismatching frames before
    // the TRUNCATED_TAG_RE blocker).
    const payload = 'intro paragraph.\n\n<div\n  class="x">\n\nswallowed one.\n\nswallowed two.\n\ntail.\n';
    for (const config of [BASELINE, ALL_ON]) {
      assertStreamEquivalence('multiline-open-tag', chunkSnapshots(payload, 6), config);
    }
    // Variant: attributes continue past the first line.
    const attrs = 'intro.\n\n<div class="a"\n  data-x="y">\n\ninside.\n\nafter.\n';
    assertStreamEquivalence('multiline-attrs-tag', chunkSnapshots(attrs, 6), BASELINE);
  });

  test('unclosed <details> then closed (rehype-raw swallow class)', () => {
    const payload = '<details>\n<summary>t</summary>\n\ninside paragraph\n\n</details>\n\nafter paragraph.\n\ntail.\n';
    for (const config of [BASELINE, ALL_ON]) {
      // The unclosed `<details>` holds the balance open: boundary 0 on
      // every frame, which is the assertion.
      assertStreamEquivalence('details-swallow', chunkSnapshots(payload, 7), config, { minIncrementalFrames: 0 });
    }
  });

  test('non-append rewrite mid-stream falls back and stays equivalent', () => {
    const grown = chunkSnapshots('alpha paragraph.\n\nbeta paragraph.\n\ngamma paragraph.\n', 9);
    // Splice in a rewritten snapshot (simulates a Stage-A preprocessor
    // rewriting earlier content), then continue appending to the rewrite.
    const rewritten = grown[grown.length - 1].replace('alpha', 'ALPHA');
    const snapshots = [...grown, rewritten, `${rewritten}\nappended tail.\n`];
    assertStreamEquivalence('non-append', snapshots, BASELINE);
  });

  test('[^ arriving mid-stream keeps splicing (v2 replay)', () => {
    const payload = 'plain paragraph one.\n\nplain paragraph two.\n\na claim[^n] appears.\n\n[^n]: footnote body\n';
    for (const config of [BASELINE, ALL_ON]) {
      const stats = assertStreamEquivalence('footnote-mid-stream', chunkSnapshots(payload, 8), config);
      expect(stats.incrementalFrames).toBeGreaterThan(0);
    }
  });

  test('CRLF line endings', () => {
    const payload =
      'para one.\r\n\r\npara two with **bold**.\r\n\r\n- item\r\n- item two\r\n\r\ncol zero.\r\n\r\ntail.\r\n';
    assertStreamEquivalence('crlf', chunkSnapshots(payload, 9), BASELINE);
  });

  test('2026-08-19 review P2-1: a lone CR is a line ending — rebased tail line numbers stay exact', () => {
    // `x\r\r\ny`: micromark counts `\r`, `\r\n` and `\n` as one line ending
    // each; a lone `\r` in the frozen prefix used to leave every tail
    // `position.line` one short (offsets and shape were right).
    for (const [name, payload] of [
      ['lone-cr', 'x\r\r\ny\n\nz\n\nw settles.\n\ntail paragraph.\n'],
      ['lone-cr-blank', 'text\r\r\nmore\n\nz\n\nw\n\ntail.\n'],
      ['lone-cr-in-list', '- a\r  b\n\npara\n\nmore [a]\n\n[a]: /u\n\ntail.\n'],
    ] as const) {
      const stats = assertStreamEquivalence(name, chunkSnapshots(payload, 6), BASELINE);
      expect(stats.incrementalFrames).toBeGreaterThan(0);
    }
  });

  test('2026-08-19 review P1: a line-truncated CLOSING tag never zeroes the balance', () => {
    // `para </style` is prose to micromark and an unfinished end tag to
    // parse5 (RAWTEXT waits for the `>`): the `<style>` element is still
    // open in both grammars, and the boundary must not cross it.
    let incremental = 0;
    for (const [name, payload] of [
      ['truncated-close-style', '<style>\n\npara </style\n\ntail para\n\nmore.\n'],
      ['truncated-close-textarea', '<textarea>\n\npara </textarea\n\ntail para\n\nmore.\n'],
      ['truncated-close-div', '<div>\n\npara </div\n\ntail para\n\nmore.\n\n</div>\n\nend.\n'],
      // Html-flow run: `</div` + `>` on the next line IS the end tag (parse5
      // completes it; micromark's block ends at the blank) — the close is
      // applied at the `>` line, and the tail keeps splicing.
      ['truncated-close-flow', '<div>\ncontent\n</div\n>\n\ntail\n\nend paragraph.\n\nmore.\n'],
    ] as const) {
      incremental += assertStreamEquivalence(name, chunkSnapshots(payload, 5), BASELINE, {
        minIncrementalFrames: 0,
      }).incrementalFrames;
    }
    // The first three shapes hold the boundary before the open element and
    // never splice — that IS the claim. `truncated-close-flow` is the one
    // that must keep splicing, so the floor is the family aggregate.
    expect(incremental).toBeGreaterThan(0);
  });

  test('oracle review of 2.4.4: a line ending inside a tag makes the next line garbage up to the first `>` (pre-existing under-block)', () => {
    // parse5 is still in `</div` / `<div` / `<br` at the line ending — the
    // real-looking `</div>` on the next line completes THAT tag and the
    // outer element stays open; the scanner froze past it. 1-char slices:
    // the hast straddle bail that hid it at coarser chunkings needs the
    // previous frame's tree to have swallowed already.
    let incremental = 0;
    for (const [name, payload] of [
      ['garbage-close-close', '<div>\n<div>\n</div\n</div>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['garbage-details', '<details>\n<summary>\n</summary\n</details>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['garbage-def', '<div>\n<span>\n</span\n</div>\n\n[a]: /u\n\nuse [a]\n\nzzz end.\n'],
      ['garbage-void-open', '<div>\n<br\n</div>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['garbage-void-close', '<div>\n</br\n</div>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['garbage-two-pending', '<span>\n<div>\n</span\n</div\n>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['garbage-open-attr', '<div>\n<b class="x"\n</div>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['garbage-quoted-gt', '<div>\n<b\ntitle=">"\n</div>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['garbage-then-real', '<div>\n</div\n><b>x</b>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['garbage-stray-after', '<div>\n</div\n></div>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      // NOT real html-flow starts (paragraph lines to micromark): the next
      // line's `<div>` / `<!--` are real blocks — the garbage model must
      // not swallow them (oracle re-check).
      ['nonreal-comment-list', '</textarea\n<!-- c\n- li\n\ntail one.\n\ntail two.\n\nzzz end.\n'],
      ['nonreal-comment-div', '</i\n<!-- c\n<div\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['nonreal-div', '</i\n<div>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['nonreal-void-div', '<br\n<div>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['nonreal-details', '</textarea\n<details>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      // Type-7 start after a paragraph line cannot interrupt it: not real.
      ['nonreal-type7-after-para', 'para\n<span>\n<div>\n</span\n</div>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      // De-indent out of a list item's html block: the `<div>` is real.
      ['deindent-list', '- a\n  </div\n<div>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['deindent-ol', '1. a\n   </div\n<div>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['same-indent-list', '- a\n  </div\n  <div>\n\ntail para\n\nmore.\n\nzzz end.\n'],
    ] as const) {
      for (const size of [1, 4, 7]) {
        incremental += assertStreamEquivalence(name, chunkSnapshots(payload, size), BASELINE, {
          minIncrementalFrames: 0,
        }).incrementalFrames;
      }
    }
    // Anti-vacuity floor over the family: individual shapes here
    // legitimately poison to boundary 0.
    expect(incremental).toBeGreaterThan(0);
  });

  test('2026-08-19 review r2 P1-2/P2-3: quotes across the line ending follow parse5 attribute-value state', () => {
    let incremental = 0;
    for (const [name, payload] of [
      // Dangling open quote: the next line's `>` is a value byte, `</div>`
      // there does not close the outer div (r2 P1-2 — regression of the
      // first F1 fix, which ended the tag at the first `>`).
      ['dangling-quote-hr', '<div>\n<hr title="\n<p></div>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['dangling-quote-span', '<div>\n<span class="\n</div>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['dangling-quote-closes-later', '<div>\n<hr title="\n<p></div>\n\ntail para\n\n">\n\nmore.\n\nzzz end.\n'],
      // Paired quotes on the continuation line are ordinary (r2 P2-3: any
      // quote used to poison the whole stream).
      ['paired-quotes', '# T\n\n<div\n  class="a">\ncontent\n</div>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      [
        'paired-quotes-gt-inside',
        '<div\n  class=\'a\' data-x="b>c">\ncontent\n</div>\n\ntail para\n\nmore.\n\nzzz end.\n',
      ],
      ['unquoted-value', '<div\n  class=a>\ncontent\n</div>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['unquoted-value-eol', '<div\n  class=a\n>\ncontent\n</div>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['quote-in-name-position', '<div>\n</div\n"x">\n\ntail para\n\nmore.\n\nzzz end.\n'],
    ] as const) {
      for (const size of [1, 4, 7]) {
        incremental += assertStreamEquivalence(name, chunkSnapshots(payload, size), BASELINE, {
          minIncrementalFrames: 0,
        }).incrementalFrames;
      }
    }
    // Anti-vacuity floor over the family: individual shapes here
    // legitimately poison to boundary 0.
    expect(incremental).toBeGreaterThan(0);
  });

  test('oracle re-check of r2: self-closing syntax on non-void elements, `<` in the attribute area, plaintext', () => {
    let incremental = 0;
    for (const [name, payload] of [
      // parse5 ignores the self-closing flag on non-void HTML elements: `<div/>` OPENS.
      ['selfclose-div', '<div/>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['selfclose-div-attr', '<div class="x"/>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['selfclose-title', '<title/>\n</div>\n</title>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['selfclose-p', '<p/>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      // …but foreign content and the foreign roots honour it.
      ['selfclose-svg-child', '<svg><circle/></svg>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['selfclose-svg-root', '<svg/>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['selfclose-math-child', '<math><mi/></math>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      // …HTML breakout names and integration points inside foreign content
      // are HTML again: `<div/>` there OPENS.
      ['selfclose-svg-breakout', '<svg><div/></svg>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      [
        'selfclose-foreignobject',
        '<svg><foreignObject><div/></foreignObject></svg>\n\ntail para\n\nmore.\n\nzzz end.\n',
      ],
      // Attribute bytes may hold `<`: the truncated-tag anchor is the last
      // `<` that starts a NAME, so `<div a=<` is still the open it is.
      ['lt-in-attrs', '<div>\n<div a=<\n</div>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['lt-in-quoted-attr', '<div>\n<span x="<\n</div>\n">\n\ntail para\n\nmore.\n\nzzz end.\n'],
      // PLAINTEXT never ends.
      ['plaintext', '<div>\n<plaintext>\n</plaintext>\n</div>\n\ntail para\n\nmore.\n\nzzz end.\n'],
    ] as const) {
      for (const size of [1, 4, 7]) {
        incremental += assertStreamEquivalence(name, chunkSnapshots(payload, size), BASELINE, {
          minIncrementalFrames: 0,
        }).incrementalFrames;
      }
    }
    // Anti-vacuity floor over the family: individual shapes here
    // legitimately poison to boundary 0.
    expect(incremental).toBeGreaterThan(0);
  });

  test('oracle review of the r2 batch: noscript is plain HTML under rehype-raw, quoted `>` on the tag line, raw text only under HTML rules', () => {
    let incremental = 0;
    for (const [name, payload] of [
      // hast-util-raw runs parse5 with scriptingEnabled:false: `<noscript>`
      // content is ordinary HTML, the `<b>` inside is a real open.
      ['noscript-inline', 'x <noscript> y <b> z </noscript> w\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['noscript-inline-i', 'x <noscript><i>z</noscript>w\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['noscript-block', '<noscript>\n<div>\n</noscript>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      // A `>` inside a quoted attribute value on the tag's OWN line does not
      // end the tag (pre-existing, same family as r2 P1-2).
      ['close-quoted-gt', '<div>\n</div a=">\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['close-quoted-gt-title', '<div>\n</div title=">\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['close-quoted-gt-value', '<div>\nx\n</div a="b>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      [
        'close-quoted-gt-details',
        '<details>\n<summary>t</summary>\n</details a=">\n\ntail para\n\nmore.\n\nzzz end.\n',
      ],
      ['open-quoted-gt', '<div a=">\n</div>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['open-quoted-gt-close-inside', '<div a="x></div>">\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['open-quoted-gt-then-real-close', '<div a="x></div>">\n</div>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['paired-quoted-gt-same-line', '<div title="a>b" class="c">x</div>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['close-quote-across-lines', '<div>\n</div a="\n">\n\ntail para\n\nmore.\n\nzzz end.\n'],
      // Foreign content: `<title>` inside `<svg>` is a foreign element in the
      // DATA state — no RCDATA switch, `<b>` inside is a breakout open.
      ['svg-title-not-rcdata', '<svg>\n<title>\n<b>\n</title>\n</svg>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['svg-title-div', '<svg>\n<title><div></title></svg>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      // …but below an integration point HTML rules (and RCDATA) are back.
      [
        'foreignobject-title',
        '<svg><foreignObject><title><b></title></foreignObject></svg>\n\ntail para\n\nmore.\n\nzzz end.\n',
      ],
    ] as const) {
      for (const size of [1, 3, 7]) {
        incremental += assertStreamEquivalence(name, chunkSnapshots(payload, size), BASELINE, {
          minIncrementalFrames: 0,
        }).incrementalFrames;
      }
    }
    // Anti-vacuity floor over the family: individual shapes here
    // legitimately poison to boundary 0.
    expect(incremental).toBeGreaterThan(0);
  });

  test('oracle re-check of the r2 batch: closing tags with attributes, and a raw-text end tag mid-value', () => {
    let incremental = 0;
    for (const [name, payload] of [
      // Paragraph context: micromark's html-text accepts `</name` + optional
      // whitespace + `>` only, so `</div a="b">` is literal TEXT and parse5
      // never sees a close — the `<div>` wraps the tail (pre-existing).
      ['para-close-with-attrs', 'p <div> x </div a="b"> y\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['para-close-title-attr', 'p <title> x </title a> y\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['para-close-style-attr', 'p <style> x </style a> y\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['para-close-title-quote', 'p <title> x </title a="> y\n\ntail para\n\nmore.\n\nzzz end.\n'],
      // …whitespace before the `>` is still a close.
      ['para-close-ws', 'p <div> x </div > y\n\ntail para\n\nmore.\n\nzzz end.\n'],
      // Alone on a line it is not type 7 either (and span/b are not type-6
      // names, so there is no other route into html flow).
      ['line-close-attrs-span', '<span>\n\n</span a="b">\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['line-close-attrs-b', '<b>\n\n</b a>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['line-close-bare-span', '<span>\n\n</span>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      // A type-6 NAME is html flow whatever follows it: parse5 accepts
      // attributes on an end tag there, so this one really closes.
      ['line-close-attrs-div', '<div>\n\n</div a="b">\n\ntail para\n\nmore.\n\nzzz end.\n'],
      // The raw-text element's own end tag with an unterminated value keeps
      // tokenizing — the title stays open.
      ['rawtext-end-tag-quote', '<title>\n</title a=">\n\ntail para\n\nmore.\n\nzzz end.\n'],
    ] as const) {
      for (const size of [1, 3, 7]) {
        incremental += assertStreamEquivalence(name, chunkSnapshots(payload, size), BASELINE, {
          minIncrementalFrames: 0,
        }).incrementalFrames;
      }
    }
    // Measured zero: every shape in this family is a
    // pre-existing under-block pinned at boundary 0, so no frame
    // splices. `incremental` is kept as the readout.
    expect(incremental).toBe(0);
  });

  test('2026-08-19 review r2 P1-3: parse5 bogus comments (`<!` / `</` + non-letter) eat to the next `>`', () => {
    let incremental = 0;
    for (const [name, payload] of [
      ['bogus-bang', '<div>\n<!\n</div>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['bogus-bang-dash', '<div>\n<!-\n</div>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['bogus-slash', '<div>\n</\n</div>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['bogus-double-slash', '<div>\n<//\n</div>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['bogus-same-line', '<div>\n<! x > </div>\n\ntail para\n\nmore.\n\nzzz end.\n'],
      // Left open at the blank: poisoned (micromark ended the block, parse5
      // is still eating) — the later `</div>` must not release a candidate.
      ['bogus-open-at-blank', '<div>\n<!\n\ntail para\n\n</div>\n\nmore.\n\nzzz end.\n'],
      // In a paragraph `<!` is text and the next line's `<div>` is real.
      ['bogus-in-paragraph', '</i\n<!\n<div>\n\ntail para\n\nmore.\n\nzzz end.\n'],
    ] as const) {
      for (const size of [1, 4, 7]) {
        incremental += assertStreamEquivalence(name, chunkSnapshots(payload, size), BASELINE, {
          minIncrementalFrames: 0,
        }).incrementalFrames;
      }
    }
    // Anti-vacuity floor over the family: individual shapes here
    // legitimately poison to boundary 0.
    expect(incremental).toBeGreaterThan(0);
  });

  test('2026-08-19 review r2 P1-4: RAWTEXT / RCDATA elements in the type-6 list hold text, not tags', () => {
    let incremental = 0;
    for (const [name, payload] of [
      ['rawtext-title', '<div>\n<title>\n</div>\n</title>\n\nt p\n\nm.\n'],
      ['rawtext-iframe', '<div>\n<iframe>\n</div>\n</iframe>\n\nt p\n\nm.\n'],
      ['rawtext-noframes', '<div>\n<noframes>\n</div>\n</noframes>\n\nt p\n\nm.\n'],
      ['rawtext-xmp', '<div>\n<xmp>\n</div>\n</xmp>\n\nt p\n\nm.\n'],
      ['rawtext-inline', 'para <title>x</div>y</title> z\n\n<div>\n</div>\n\nt p\n\nm.\n'],
      ['rawtext-comment-inside', '<title>\n<!-- c\n</title>\n\nt p\n\nm.\n\nz.\n'],
      ['rawtext-uppercase', '<div>\n<TITLE>\n</div>\n</TITLE>\n\nt p\n\nm.\n'],
    ] as const) {
      for (const size of [1, 4, 7]) {
        incremental += assertStreamEquivalence(name, chunkSnapshots(payload, size), BASELINE, {
          minIncrementalFrames: 0,
        }).incrementalFrames;
      }
    }
    // Anti-vacuity floor over the family: individual shapes here
    // legitimately poison to boundary 0.
    expect(incremental).toBeGreaterThan(0);
  });

  test('2026-08-19 review r2 P1-5: a lone CR is a line ending to the SCANNER too', () => {
    let incremental = 0;
    for (const [name, payload] of [
      // `a\r` + fence opener: one scanner line hid the opener (a candidate
      // landed inside the open code block).
      ['cr-fence', 'a\r```\ncode\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['cr-math', 'a\r$$\nx=1\n\ntail para\n\nmore.\n\nzzz end.\n'],
      ['cr-only-doc', 'a\r\r```\rcode\r\r\rtail para\r\rmore.\r\rzzz end.\r'],
      ['cr-heading-list', '# h\r- x\n\npara\n\nmore\n\nzzz.\n'],
      ['cr-html', '<div>\r</div>\r\rpara\r\rmore\r\rzzz.\r'],
      ['cr-def', '[a]:\r/u\n\n[a]\n\nmore\n\nzzz.\n'],
      ['cr-quote', 'a\r> q\n\npara\n\nmore\n\nzzz.\n'],
    ] as const) {
      for (const size of [1, 4, 7]) {
        incremental += assertStreamEquivalence(name, chunkSnapshots(payload, size), BASELINE, {
          minIncrementalFrames: 0,
        }).incrementalFrames;
      }
    }
    // Anti-vacuity floor over the family: individual shapes here
    // legitimately poison to boundary 0.
    expect(incremental).toBeGreaterThan(0);
  });

  test('duplicate label: prefix def wins over a later tail def (first-def-wins)', () => {
    const payload =
      '[a]: https://first.example\n\nuse [text][a] here.\n\nfiller paragraph.\n\n[a]: https://second.example\n\ntail.\n';
    assertStreamEquivalence('dup-label', chunkSnapshots(payload, 8), BASELINE);
  });
});

// --- stripped-node prefixes (v2 Phase B) -------------------------------------
//
// Sanitize-stripped nodes (HTML comments, `<?…?>` bogus comments, <script>)
// leave orphan wrap separators in the hast. The alignment cursor in
// spliceParse must keep splicing across them — before Phase B every one of
// these payloads silently degraded to per-frame full parses. BASELINE is the
// config under test (no remove-comments: the comments reach sanitize as hast
// nodes); the assertions demand the splice ENGAGED, not just equivalence.

describe('splice equivalence — stripped-node prefixes', () => {
  const BASELINE = CATALOG[0];
  const ALL_ON = CATALOG[1];

  const spliceFixtures: Array<[string, string, number]> = [
    ['comment-mid-prefix', 'para one.\n\n<!-- gone -->\n\npara two.\n\npara three.\n\ntail paragraph.\n', 7],
    ['comment-at-seam', 'para one.\n\npara two.\n\n<!-- seam adjacent -->\n\ntail paragraph follows here.\n', 7],
    ['consecutive-comments', 'para one.\n\n<!-- x -->\n\n<!-- y -->\n\npara two.\n\nmore prose to stream after.\n', 7],
    ['comment-first-child', '<!-- lead -->\n\npara one.\n\npara two.\n\ntail paragraph to stream.\n', 6],
    ['comment-last-child', 'para one.\n\npara two.\n\nlong tail paragraph here.\n\n<!-- trailing -->', 7],
    ['pi-mid-prefix', 'para one.\n\n<?php echo 1; ?>\n\npara two.\n\ntail paragraph to stream.\n', 7],
    ['script-stripped', 'para one.\n\n<script>x()</script>\n\npara two.\n\ntail paragraph to stream.\n', 7],
    [
      'comment-before-table',
      'para one.\n\n<!-- x -->\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\ntail paragraph to stream.\n',
      9,
    ],
    [
      'multi-element-html-block',
      'para one.\n\n<div>a</div><div>b</div>\n\npara two.\n\ntail paragraph to stream.\n',
      8,
    ],
    ['defs-only-tail-after-comment', 'para one.\n\n<!-- x -->\n\npara two.\n\n[a]: https://example.com\n', 7],
  ];

  for (const [name, payload, chunk] of spliceFixtures) {
    test(name, () => {
      const stats = assertStreamEquivalence(name, chunkSnapshots(payload, chunk), BASELINE);
      expect(stats.incrementalFrames, `${name} must actually splice, not fall back`).toBeGreaterThan(0);
    });
  }

  test('comment leading the tail must NOT merge into the seam separator', () => {
    // Full parse keeps seam '\n' and the comment's gap slot as SEPARATE text
    // nodes (the comment sat between them at reparse time); hoist text from
    // a table merges. Both shapes in one payload.
    const payload = 'para one.\n\npara two.\n\n<!-- tail leads -->\n\n| a |\n| - |\n| 1 |\n\nclosing paragraph.\n';
    for (const config of [BASELINE, ALL_ON]) {
      const stats = assertStreamEquivalence('comment-leading-tail', chunkSnapshots(payload, 6), config);
      expect(stats.incrementalFrames).toBeGreaterThan(0);
    }
  });

  test('A6 PI corner now splices (was: stripped-node fallback)', () => {
    const stats = assertStreamEquivalence(
      'a6-pi-splices',
      chunkSnapshots('<?data\n\nmore\n?>\n\nafter.\n', 3),
      BASELINE
    );
    expect(stats.incrementalFrames).toBeGreaterThan(0);
  });

  test('splices on a frame whose FROZEN PREFIX contains the stripped node', () => {
    // `incrementalFrames > 0` alone could be satisfied by frames before the
    // comment enters the prefix — this pins the alignment cursor itself:
    // stream far enough that the boundary passes the comment, then assert
    // the last append frame both spliced AND crossed it.
    const payload =
      'para one.\n\n<!-- gone -->\n\npara two.\n\npara three.\n\npara four extends the document.\n\nfinal tail paragraph.\n';
    const options = buildAdvanceOptions(BASELINE);
    const snapshots = chunkSnapshots(payload, 9);
    let state: IncrementalParseState | null = null;
    let last: ReturnType<typeof advanceIncrementalParse> | null = null;
    for (const snapshot of snapshots) {
      last = advanceIncrementalParse(state, snapshot, options);
      state = last.nextState;
    }
    expect(last!.usedIncremental).toBe(true);
    expect(last!.boundary).toBeGreaterThan(payload.indexOf('-->') + 3);
  });

  test('a disordered top-level mdast makes the injection plan uninjectable instead of skipping a def (eng-parse-07)', () => {
    // Shipped chains position top-level nodes in order; a plugin-shaped tree
    // that moves a definition AFTER a later-positioned sibling would hit the
    // walk's boundary early-break and silently lose the injection event.
    // The walk detects the disorder and bails (full-parse fallback), matching
    // the cut layer's correct-or-bailing promise.
    const payload = 'see [a] later.\n\n[a]: https://example.com/a\n\ntail paragraph\n';
    const full = runFull(payload, BASELINE) as { mdast: Parameters<typeof collectPrefixInjection>[0] };
    const boundary = payload.indexOf('tail paragraph');
    const ordered = collectPrefixInjection(full.mdast, payload, boundary);
    expect(ordered.uninjectable).toBe(false);
    expect(ordered.events.some((e) => e.kind !== 'refs')).toBe(true); // the def is injected
    // Move the definition AFTER the tail paragraph (positions travel with the
    // nodes): the boundary early-break now fires before the def is seen.
    const [para, def, tail] = full.mdast.children;
    const swapped = { ...full.mdast, children: [para, tail, def] };
    const disordered = collectPrefixInjection(swapped as never, payload, boundary);
    expect(disordered.uninjectable).toBe(true);
    expect(disordered.events).toEqual([]);
  });

  test('injection plan resume ≡ fresh walk (final-review R3)', () => {
    // The cached plan appends only the children in [oldBoundary, boundary).
    // Property: for every boundary pair b1 < b2, resuming from b1's plan
    // yields the same EVENT STREAM as a fresh walk at b2. Refs-batch shapes
    // may differ at the b1 junction (two refs events where a fresh walk
    // merges one — state-seeding-identical), so compare the flattened
    // (kind, payload) sequence, which is what seeds mdast-util-to-hast.
    const payload = withDefs(DEFAULT_PAYLOAD);
    const full = runFull(payload, BASELINE) as { mdast: Parameters<typeof collectPrefixInjection>[0] };
    const flat = (events: InjectionEvent[]): Array<[string, string]> =>
      events.flatMap((e): Array<[string, string]> =>
        e.kind === 'refs' ? e.tokens.map((t): [string, string] => ['ref', t]) : [[e.kind, e.source]]
      );
    const boundaries: number[] = [];
    for (let i = payload.indexOf('\n\n'); i !== -1; i = payload.indexOf('\n\n', i + 1)) boundaries.push(i + 2);
    for (let i = 1; i < boundaries.length; i++) {
      const b1 = boundaries[i - 1];
      const b2 = boundaries[i];
      const plan1 = collectPrefixInjection(full.mdast, payload, b1);
      const resumed = collectPrefixInjection(full.mdast, payload, b2, { boundary: b1, ...plan1 });
      const fresh = collectPrefixInjection(full.mdast, payload, b2);
      expect(resumed.uninjectable).toBe(fresh.uninjectable);
      expect(flat(resumed.events), `resume b1=${b1} → b2=${b2}`).toEqual(flat(fresh.events));
    }
    expect(boundaries.length).toBeGreaterThan(5);
  });

  test('document-LEADING table keeps splicing (final-review R2)', () => {
    // rehype-raw foster-parents a table's internal whitespace to just before
    // the <table>; when the table is the FIRST document child there is no
    // preceding wrap slot to merge into, so the hast root LEADS with a bare
    // position-less text node. The alignment cursor must classify it as
    // hoist (kept verbatim), not as a leading stripped-child gap slot —
    // misclassification made every frame fall back for the document's whole
    // lifetime (probe: 0/11 incremental frames vs 7/11 before the alignment
    // model landed).
    const payload =
      '| a | b |\n| - | - |\n| 1 | 2 |\n\npara one follows the table.\n\npara two extends.\n\nfinal tail paragraph here.\n';
    for (const config of [BASELINE, ALL_ON]) {
      const stats = assertStreamEquivalence('table-first', chunkSnapshots(payload, 11), config);
      expect(stats.incrementalFrames, `table-first [${config.label}] must splice`).toBeGreaterThan(0);
    }
    // Pin: the final frame splices with the table INSIDE the frozen prefix.
    const options = buildAdvanceOptions(BASELINE);
    let state: IncrementalParseState | null = null;
    let last: ReturnType<typeof advanceIncrementalParse> | null = null;
    for (const snapshot of chunkSnapshots(payload, 11)) {
      last = advanceIncrementalParse(state, snapshot, options);
      state = last.nextState;
    }
    expect(last!.usedIncremental).toBe(true);
    expect(last!.boundary).toBeGreaterThan(payload.indexOf('| 1 | 2 |') + 9);
  });
});

// --- footnotes via injection replay (v2 Phase C) ------------------------------
//
// mdast-util-to-hast footnote state (footnoteOrder / footnoteCounts /
// footnoteById) is whole-document and encounter-ordered; the engine replays
// the prefix's event sequence at the tail head so the tail run regenerates
// the complete footer and the tail's inline refs continue the numbering.
// Every fixture runs the full catalog cross-product it names and asserts the
// splice ENGAGED — before Phase C every `[^` payload silently degraded to
// per-frame full parses. `settle` gives each payload a confirmed non-
// continuation block after the defs so the boundary can pass them.

describe('splice equivalence — footnote injection replay', () => {
  const BASELINE = CATALOG[0];
  const ALL_ON = CATALOG[1];
  const NO_ORPHAN = CATALOG.find((c) => c.label === 'no-orphan')!;

  const fixtures: Array<[string, string, number, CatalogConfig[]]> = [
    [
      'reuse-and-backrefs',
      'Alpha[^a] beta[^a].\n\nGamma[^b].\n\n[^a]: A body\n\n[^b]: B body\n\nplain settles.\n\ntail re-ref [^a] and new [^c].\n\n[^c]: C body\n\nclosing paragraph here.\n',
      11,
      [BASELINE, ALL_ON, NO_ORPHAN],
    ],
    [
      'orphan-def-ordering',
      'Intro[^a].\n\n[^orph]: orphan body\n\n[^a]: A body\n\nMid[^b].\n\n[^b]: B body\n\nplain settles.\n\ntail new [^c].\n\n[^c]: C body\n',
      9,
      [BASELINE, NO_ORPHAN],
    ],
    [
      'def-before-ref',
      '[^a]: defined first\n\nThen referenced[^a] later.\n\nfiller paragraph.\n\ntail paragraph extends.\n',
      8,
      [BASELINE, ALL_ON],
    ],
    [
      'ref-def-ref-interleave',
      'One[^x].\n\n[^x]: x body\n\nTwo[^y] then[^x].\n\n[^y]: y body\n\nplain settles here.\n\ntail closes[^y] again.\n',
      9,
      [BASELINE],
    ],
    [
      'duplicate-def-first-wins',
      'Ref[^d] here.\n\n[^d]: first body\n\nfiller paragraph.\n\nplain settles.\n\n[^d]: second body ignored\n\ntail paragraph.\n',
      8,
      [BASELINE],
    ],
    [
      'case-fold-labels',
      'Weight[^SS] here.\n\n[^ß]: sharp body\n\nfiller paragraph settles.\n\ntail re-ref [^ss] again.\n',
      7,
      [BASELINE],
    ],
    [
      // Taint holds the boundary at 0 while [^late] is unresolved; once the
      // def settles (blank line after) the boundary may pass the ref and the
      // closing frames splice. Without the settling paragraph this payload
      // would (correctly) never splice at all.
      'def-in-tail-ref-in-prefix',
      'Early claim[^late] made.\n\nfiller one paragraph.\n\nfiller two paragraph.\n\n[^late]: arrives late\n\nsettled paragraph.\n\nclosing tail paragraph.\n',
      9,
      [BASELINE, ALL_ON],
    ],
    [
      'multi-paragraph-def-body',
      'Claim[^m] here.\n\n[^m]: first body paragraph\n\n    second indented paragraph\n\nplain col-zero settles.\n\ntail paragraph extends.\n',
      9,
      [BASELINE, ALL_ON],
    ],
    [
      'indented-def-column-invariance',
      'Claim[^i] here.\n\n  [^i]: two-space-indented def\n\nplain settles.\n\ntail paragraph extends further.\n',
      8,
      [BASELINE],
    ],
    [
      'nested-ref-in-def-body',
      'Outer[^o] claim.\n\n[^o]: body references [^inner] here\n\n[^inner]: inner body\n\nplain settles.\n\ntail paragraph extends.\n',
      9,
      [BASELINE, ALL_ON],
    ],
    [
      'math-in-def-body',
      'Claim[^k] here.\n\n[^k]: body with $$e^{i\\pi}$$ math\n\nplain settles.\n\ntail paragraph extends here.\n',
      9,
      [BASELINE],
    ],
    [
      'ref-inside-blockquote',
      '> quoted claim[^q] here.\n\n[^q]: q body\n\nplain settles.\n\ntail paragraph extends.\n',
      8,
      [BASELINE],
    ],
    [
      'crlf-footnotes',
      'Claim[^c] here.\r\n\r\n[^c]: c body\r\n\r\nplain settles.\r\n\r\ntail paragraph extends.\r\n',
      9,
      [BASELINE],
    ],
  ];

  for (const [name, payload, chunk, configs] of fixtures) {
    test(name, () => {
      for (const config of configs) {
        const stats = assertStreamEquivalence(name, chunkSnapshots(payload, chunk), config);
        expect(stats.incrementalFrames, `${name} [${config.label}] must actually splice`).toBeGreaterThan(0);
      }
    });
  }

  test('injection continuation leaks (final-review R1): footnoteDef-last + indented tail', () => {
    // GFM footnote def bodies continue across blank lines into >=4-indented
    // content. When the LAST injected block is a footnote def, the tail's
    // leading indented line must not be absorbed into it (the injected node
    // is stripped — absorbed content would VANISH). The injection terminator
    // definition is the fix under test. Explicit 2-frame sequences pin the
    // exact boundary alignment the finders' probes reproduced.
    const shapes: Array<[string, string, string]> = [
      [
        'indent-code-after-def',
        'Claim[^m] here.\n\n[^m]: note body\n\nplain paragraph settles.\n\n',
        '    indented code arrives\n',
      ],
      [
        'tab-code-after-def',
        'Claim[^t] here.\n\n[^t]: note body\n\nplain paragraph settles.\n\n',
        '\tindented code arrives\n',
      ],
      ['list-ending-def-body', '[^a]: note\n    - item one\n\npara settles here.\n\n', '    continued?\n'],
      [
        'blank-then-indent',
        'Claim[^b] here.\n\n[^b]: note body\n\nplain paragraph settles.\n\n',
        '\n    late indent\n',
      ],
    ];
    for (const [name, frame0, appended] of shapes) {
      for (const config of [BASELINE, ALL_ON]) {
        // Third frame: defList's settled-check lags one confirmed line, so
        // under defaults-all-on some shapes legitimately full-parse frame 1
        // and splice from frame 2 — the splice assertion spans the run.
        const frames = [frame0, frame0 + appended, `${frame0 + appended}\nclosing paragraph.\n`];
        const stats = assertStreamEquivalence(name, frames, config);
        expect(stats.incrementalFrames, `${name} [${config.label}] must splice within the run`).toBeGreaterThan(0);
      }
    }
  });

  test('tail mentioning the terminator label falls back instead of mis-resolving (round-2)', () => {
    // The injection's terminator is a synthetic DEFINITION — a tail-side
    // `[label]` mention would resolve against it while the full parse
    // renders literal text. The engine must take the full path for such
    // frames (pathological input; correctness over splice rate). The
    // shortcut-, full-, and image-reference forms are all covered.
    const mentions = [
      'see [__aimd_injection_terminator__] maybe.\n',
      'see [text][__aimd_injection_terminator__] maybe.\n',
      'see ![alt][__aimd_injection_terminator__] maybe.\n',
      // Case / Unicode-fold variants: micromark matches labels after
      // normalizeIdentifier, so these resolve against the terminator def too
      // (2026-08 project review, eng-parse-04 — the byte-exact guard let
      // them through).
      'see [__AIMD_INJECTION_TERMINATOR__] maybe.\n',
      'see [text][__Aimd_Injection_Terminator__] maybe.\n',
      'see [__aımd_injection_terminator__] maybe.\n', // dotless ı folds to I
      'see [ __aimd_injection_terminator__] maybe.\n', // micromark trims the label (v2.4.0 review P5)
      'see [\t__aimd_injection_terminator__ ] maybe.\n',
    ];
    for (const mention of mentions) {
      const frame0 = 'note[^q] first.\n\n[^q]: def body\n\nplain settles.\n\n';
      // Two frames only, and the mention frame is the first append — the
      // pin is that the terminator lookalike does not corrupt the full path.
      assertStreamEquivalence('terminator-mention', [frame0, frame0 + mention], BASELINE, {
        minIncrementalFrames: 0,
      });
    }
  });

  test('injection continuation leaks (final-review R1): defList `: desc` claim through the join', () => {
    // The original document separates with TWO blank lines (blankRun>=2 is
    // defList-claim-immune), but the injection joins to the tail with ONE —
    // without a terminator the tail-leading ': desc' would claim the last
    // injected block as a <dt> and get stripped with it.
    const frame0 = '[^n]: note\n\nRef[^n] here.\n\nterm\n\n\n';
    const frame1 = `${frame0}: desc\n\ntail.\n`;
    const stats = assertStreamEquivalence('deflist-claim-through-join', [frame0, frame1], ALL_ON);
    expect(stats.incrementalFrames).toBeGreaterThan(0);
  });

  test('blockquote-nested footnote def → uninjectable fallback (equivalence holds)', () => {
    // Column fidelity cannot survive slicing a `> [^x]: …` def out of its
    // container, so frames whose prefix holds one degrade to full parses.
    const payload = '> [^bq]: quoted def\n\nRef[^bq] later.\n\nplain settles.\n\ntail paragraph extends.\n';
    // The comment above IS the zero-engagement claim: frames whose prefix
    // holds a container-nested def degrade to full parses.
    assertStreamEquivalence('bq-nested-footnote-def', chunkSnapshots(payload, 7), BASELINE, {
      minIncrementalFrames: 0,
    });
  });

  test('splices on a frame whose FROZEN PREFIX contains the footnote region', () => {
    // Pins that the replay path itself engaged: the final frame's boundary
    // must sit PAST the defs (events replayed) while still splicing.
    const payload =
      'Alpha[^a] beta[^a].\n\n[^a]: A body\n\nplain settles the region.\n\nmore prose extends.\n\ntail re-ref [^a] closes.\n\nfinal paragraph of the document.\n';
    const options = buildAdvanceOptions(BASELINE);
    const snapshots = chunkSnapshots(payload, 10);
    let state: IncrementalParseState | null = null;
    let last: ReturnType<typeof advanceIncrementalParse> | null = null;
    for (const snapshot of snapshots) {
      last = advanceIncrementalParse(state, snapshot, options);
      state = last.nextState;
    }
    expect(last!.usedIncremental).toBe(true);
    expect(last!.boundary).toBeGreaterThan(payload.indexOf('[^a]: A body') + 12);
  });
});

// --- cross-chunk phantom suffixes (v2 Phase D) --------------------------------
//
// Coordinated mode appends a phantom-definition suffix so refs to labels
// defined in OTHER chunks parse as references. The engine takes the suffix
// as a separate ALWAYS-TAIL input: the append gate and boundary scan see
// `content` alone, so suffix churn (labels arriving/leaving/reordering as
// the registry evolves) re-parses only the tail. Correctness backstop: a
// phantom's def is never in `content`, so phantom-resolved refs never
// settle — the reference taint keeps them out of the frozen prefix.
// Reference = full parse of `content + suffix` with the SAME options.

describe('splice equivalence — cross-chunk phantom suffixes', () => {
  const CHUNK_B = [
    'Chunk B opens with plain prose.',
    'Another settled paragraph here.',
    'Now referencing [^A1] from chunk A and the [SPEC] link too.',
    'Closing prose extends the chunk further.',
  ].join('\n\n');

  test('constant suffix: cross-refs resolve, prefix keeps splicing', () => {
    const options = buildCrossChunkAdvanceOptions(new Set(['A1']), new Set(['SPEC']));
    const frames = chunkSnapshots(`${CHUNK_B}\n`, 12).map((content) => ({
      content,
      footnotes: ['A1'],
      links: ['SPEC'],
    }));
    const stats = runCrossChunk('constant-suffix', frames, () => options);
    expect(stats.incrementalFrames).toBeGreaterThan(0);
  });

  test('a frame ending inside an open fence still registers the phantom defs (core-render-01)', () => {
    // Content references chunk A's [SPEC] and [^A1], then streams a code
    // block. Without the closer the appended suffix lands INSIDE the open
    // fence: the sentinel lines render as code and the two refs fall back
    // to literal text for the whole block. The closer keeps the code node's
    // value identical to the bare content's and the refs resolved.
    const doc = `See the [SPEC] link and note[^A1] first.\n\n\`\`\`ts\nconst a = 1;\nconst b = 2;\n\`\`\`\n\nAfter the block.\n`;
    const options = buildCrossChunkAdvanceOptions(new Set(['A1']), new Set(['SPEC']));
    const frames = chunkSnapshots(doc, 9).map((content) => ({ content, footnotes: ['A1'], links: ['SPEC'] }));
    // Equivalence across every frame (the arbiter mirrors production's closer).
    runCrossChunk('open-fence-suffix', frames, () => options);
    // Direct check on a mid-fence frame: refs resolved, no sentinel in code.
    const midFence = doc.slice(0, doc.indexOf('const b'));
    const suffix =
      phantomSuffixCloser(midFence) +
      buildPhantomSuffix({ missingFootnotes: new Set(['A1']), missingLinks: new Set(['SPEC']) });
    const parsed = parseStage({
      children: midFence + suffix,
      remarkPlugins: options.remarkPlugins,
      rehypePlugins: options.rehypePlugins,
      remarkRehypeOptions: options.remarkRehypeOptions,
    });
    const mdast = parsed.mdast as { children: Array<{ type: string; value?: string }> };
    const hast = JSON.stringify(transformStage(parsed));
    const code = mdast.children.find((c) => c.type === 'code');
    expect(code?.value).toBe('const a = 1;');
    expect(mdast.children.filter((c) => c.type === 'definition' || c.type === 'footnoteDefinition')).toHaveLength(2);
    expect(hast).not.toContain('__aimd_sentinel'); // placeholders, not sentinel hrefs; no sentinel code text
    expect(hast).toContain('cross-chunk-link');
    expect(hast).toContain('footnote-sup');
  });

  test('suffix churn mid-stream (grow, shrink, reorder) re-parses only the tail', () => {
    const base = chunkSnapshots(`${CHUNK_B}\n`, 16);
    const mid = Math.floor(base.length / 2);
    const frames: FramePair[] = base.map((content, i) => {
      if (i < mid) return { content, footnotes: ['A1'], links: [] };
      if (i === mid) return { content, footnotes: ['A1', 'A2'], links: ['SPEC'] }; // grow
      if (i === mid + 1) return { content, footnotes: ['A2', 'A1'], links: ['SPEC'] }; // reorder
      return { content, footnotes: ['A1'], links: ['SPEC'] }; // shrink
    });
    const stats = runCrossChunk('suffix-churn', frames, (f) =>
      buildCrossChunkAdvanceOptions(new Set(f.footnotes), new Set(f.links))
    );
    // Churn frames must not disengage the splice (that was the entire v1
    // reason for excluding coordinated mode).
    expect(stats.incrementalFrames).toBeGreaterThan(frames.length / 2);
  });

  test('equal content + suffix-only change still splices (registry bump)', () => {
    const options0 = buildCrossChunkAdvanceOptions(new Set(['A1']), new Set());
    const done = `${CHUNK_B}\n`;
    const frames: FramePair[] = [
      { content: done, footnotes: ['A1'], links: [] },
      { content: done, footnotes: ['A1', 'A2'], links: ['SPEC'] },
    ];
    const stats = runCrossChunk('suffix-only-change', frames, () => options0);
    expect(stats.results[1]).toBe(true);
  });

  test('phantom→owned handover: content gains the def, suffix drops it', () => {
    const before = 'Prose one settles.\n\nSee [^h] here.\n\nProse two settles.\n\n';
    const after = `${before}[^h]: now defined locally\n\npost-def paragraph.\n`;
    const frames: FramePair[] = [
      { content: before, footnotes: ['H'], links: [] },
      { content: after, footnotes: [], links: [] }, // append + suffix shrink in one frame
      { content: `${after}\nfinal tail.\n`, footnotes: [], links: [] },
    ];
    const stats = runCrossChunk('handover', frames, (f) =>
      buildCrossChunkAdvanceOptions(new Set(f.footnotes), new Set(f.links))
    );
    expect(stats.incrementalFrames).toBeGreaterThan(0);
  });

  test('own footnotes replay while cross-refs stay tainted in the tail', () => {
    const payload =
      'Own claim[^own] here.\n\n[^own]: own body\n\nplain settles.\n\ncross ref [^A1] appears.\n\nmore prose extends.\n';
    const frames = chunkSnapshots(payload, 10).map((content) => ({
      content,
      footnotes: ['A1'],
      links: [],
    }));
    const options = buildCrossChunkAdvanceOptions(new Set(['A1']), new Set());
    const stats = runCrossChunk('own-plus-cross', frames, () => options);
    expect(stats.incrementalFrames).toBeGreaterThan(0);
  });
});

describe('splice equivalence — constructs that vanish at PARSE5 time (release-gate F16/F17)', () => {
  // The 2026-08-27 release-gate soak caught two hast mismatches on the
  // production advance path (seeds 20293003 / 20293004). One mechanism, two
  // consumers: a construct that vanishes AT PARSE5 TIME (a `<!DOCTYPE>` —
  // dropped token, no node — or the un-construct tail of a mixed html block,
  // `<!-- c --> </s>` → remnant ` `) merges the wrap slots around it, while
  // the splice's separator model classified it like a construct SANITIZE
  // strips (node existed at raw time ⇒ slots stay separate). Both resolve
  // DOWN: the shapes bail to a full parse. The generator's U+3000
  // continuation lines rode along in both counterexamples but are inert —
  // kept in the pinned docs verbatim anyway (transcribed by codepoint).
  const BASELINE = CATALOG[0];

  /** driveSample's schedule pair, minus the fuzz machinery: equivalence on
   *  the exact doc × sizes, forward and reversed. Engagement floor 0 —
   *  post-fix these shapes are REFUSED (scanner poison / splice bail), and
   *  that refusal is the assertion; the controls below pin the splice
   *  still engaging on the sanitize-stripped neighbours. */
  const pinShrunk = (name: string, doc: string, sizes: number[]): void => {
    for (const schedule of [sizes, [...sizes].reverse()]) {
      assertStreamEquivalence(name, scheduleSnapshots(doc, schedule), BASELINE, { minIncrementalFrames: 0 });
    }
  };

  test('finding A (seed 20293003): frozen html block whose tail is not a construct — the fast-check shrink', () => {
    // Failure was at frame 19 (boundary 90): the block's whole output is
    // stripped/dropped, its remnant ` ` merges into the seam slot (`" \n"`),
    // and the trailing rebuild synthesized a bare `"\n"`.
    pinShrunk(
      'f16-shrunk',
      '<!-- c --> </s>\n\n\n[^a]: body text\n\n    indented continuation\n\n[a]: https://example.com/a\n\n\n- tight one\n- tight two\n\n```\nconst x = "[a]<div>";\n\n```\n\nfoo line\n\u3000\n\u3000\nbar joins the paragraph\n\n[a]: /u(x)y\n',
      [1, 4, 7, 4, 5, 10, 1, 7]
    );
  });

  test('finding A: hand-shrunk two-frame reproducer', () => {
    pinShrunk('f16-min', '<!-- c --> </s>\n\n[^a]: body\n\n    cont\n\n[a]: /u\n\nx', [48, 1]);
  });

  test('finding B (seed 20293004): doctype vanishing at parse5 time merges the seam — the fast-check shrink', () => {
    // Failure was at frame 31 (boundary 55): everything between the seam and
    // the doctype emits no top-level output, so the doctype's drop merged
    // the seam slot with the post-doctype slot (`"\n\n"`) while the join
    // kept two nodes (`"\n" | "\n"`).
    pinShrunk(
      'f17-shrunk',
      '> a quoted line\n\nfoo line\n\u3000\n\u3000\nbar joins the paragraph\n\n[^a]: body text\r\np<iframe> x </iframe a> y\n\n<!DOCTYPE html>\n\ntail para\n\n</br>\n\nTerm line\n\n:   description body\n\n[^a]: body text\n',
      [4, 4, 4, 4, 4, 4, 4, 1]
    );
  });

  test('finding B: hand-shrunk two-frame reproducer', () => {
    pinShrunk('f17-min', 'foo\n\n[^a]: b\r\np<iframe> x </iframe a> y\n\n<!DOCTYPE html>\n\n', [5, 53]);
  });

  test('doctype variants stay equivalent whichever side of the seam they land on', () => {
    for (const [name, doc] of [
      ['doctype-in-tail', 'x\n\n<!DOCTYPE html>\n\ny'],
      ['doctype-tail-only', 'x\n\n<!DOCTYPE html>\n'],
      ['doctype-in-prefix', 'x\n\n<!DOCTYPE html>\n\ny\n\nz'],
      ['doctype-after-defs', 'x\n\n[a]: /u\n\n<!DOCTYPE html>\n\nz'],
    ] as const) {
      for (const chunk of [3, 7]) {
        assertStreamEquivalence(name, chunkSnapshots(doc, chunk), BASELINE, { minIncrementalFrames: 0 });
      }
    }
  });

  test('controls: the sanitize-stripped neighbours still SPLICE', () => {
    // The tightened predicates must not swallow the legitimate class — a
    // pure comment trailing child, a bogus (non-doctype) declaration in the
    // tail, and a paragraph pinning the seam all keep the incremental path
    // engaged (floor 1 via the default).
    const controls: Array<[string, string[]]> = [
      ['ctl-pure-comment-def', ['<!-- c -->\n\n[a]: /u\n\n', '<!-- c -->\n\n[a]: /u\n\nx']],
      ['ctl-bogus-decl-tail', ['x\n\n', 'x\n\n[a]: /u\n\n<!ELEMENT html>\n\n', 'x\n\n[a]: /u\n\n<!ELEMENT html>\n\nz']],
      ['ctl-paragraph-pins-seam', ['<!-- c --> </s>\n\npara line\n\n', '<!-- c --> </s>\n\npara line\n\nx']],
    ];
    for (const [name, frames] of controls) {
      assertStreamEquivalence(name, frames, BASELINE);
    }
  });

  describe('the stripped-construct predicates carry PARSE5 term semantics, not micromark ones', () => {
    test('seam classifier: doctype is NOT sanitize-stripped (no node ever exists)', () => {
      expect(isSanitizeStrippedConstruct('<!DOCTYPE html>')).toBe(false);
      expect(isSanitizeStrippedConstruct('<!doctype html>')).toBe(false);
      // Non-doctype declarations ARE bogus comments — node exists.
      expect(isSanitizeStrippedConstruct('<!ELEMENT html>')).toBe(true);
      expect(isSanitizeStrippedConstruct('<!-- c -->')).toBe(true);
      expect(isSanitizeStrippedConstruct('<?php x ?>')).toBe(true);
      expect(isSanitizeStrippedConstruct('<![CDATA[x]]>')).toBe(true);
    });

    test('trailing rebuild: only ONE construct covering the value exactly', () => {
      // The finding-A shape: construct + remnant.
      expect(isExactSanitizeStrippedConstruct('<!-- c --> </s>')).toBe(false);
      // Whitespace between two constructs is a remnant text node.
      expect(isExactSanitizeStrippedConstruct('<!-- a --> <!-- b -->')).toBe(false);
      // A multi-line block's inner newline survives as its own text node.
      expect(isExactSanitizeStrippedConstruct('<!-- c -->\n<!-- d -->')).toBe(false);
      expect(isExactSanitizeStrippedConstruct('<!DOCTYPE html>')).toBe(false);
      expect(isExactSanitizeStrippedConstruct('<!-- c -->')).toBe(true);
      expect(isExactSanitizeStrippedConstruct('<!---->')).toBe(true);
      expect(isExactSanitizeStrippedConstruct('<!ELEMENT html>')).toBe(true);
    });

    test('a bogus comment ends at the FIRST `>` — a `>` inside the micromark body leaves a remnant', () => {
      // micromark's PI runs to `?>`; parse5's bogus comment closed at `a >`
      // and ` b ?>` survives as text. Same for CDATA and declarations.
      expect(isExactSanitizeStrippedConstruct('<?a > b ?>')).toBe(false);
      expect(isExactSanitizeStrippedConstruct('<![CDATA[a>b]]>')).toBe(false);
      expect(isExactSanitizeStrippedConstruct('<!EL a > b>')).toBe(false);
      expect(isExactSanitizeStrippedConstruct('<?x?>')).toBe(true);
      expect(isExactSanitizeStrippedConstruct('<![CDATA[ab]]>')).toBe(true);
    });

    test('a comment also closes at `--!>` — micromark ignores it, parse5 does not', () => {
      // parse5's comment node ends at `--!>`; ` b -->` survives as text
      // while micromark's block ran to the `-->`.
      expect(isExactSanitizeStrippedConstruct('<!-- a --!> b -->')).toBe(false);
      expect(isExactSanitizeStrippedConstruct('<!-- a --> b --!>')).toBe(false);
    });
  });
});

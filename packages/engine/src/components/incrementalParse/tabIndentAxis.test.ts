/**
 * Tab axis pins — deterministic companions to `tabIndentArb` in
 * fuzzGenerators.ts. The corpus carried no U+0009 until 2026-09-15, so the
 * tab-stop arm of `computeIndent`, the `[ \t]` alternations in the line
 * regexes and micromark's own tab expansion had never met the arbiter.
 *
 * Contract: every frame deep-equals a full parse (the harness asserts it).
 * The FREEZABLE shapes must also engage the splice, or the axis would only
 * ever prove the fallback correct. The POISONED shapes are documented
 * over-blocks — APPROX #5 literals inside tab-indented code, and the
 * checked-box rule (GRAMMAR-COVERAGE, task-list entry) — and owe
 * equivalence only.
 */
import { describe, expect, test } from 'vitest';

import { computeFreezeBoundary } from './computeFreezeBoundary';
import { scheduleSnapshots } from './fuzzGenerators';
import { assertStreamEquivalence } from './spliceArbiterHarness';
import { CATALOG } from './testPluginCatalog';

const TAIL = '\n\npara one\n\npara *two*\n\n[a]: /u\n\ntail [a] end\n';
const SCHEDULES = [[1], [4, 4, 4, 1], [7, 3, 5, 2, 6, 4, 8, 1], [3, 30], [30, 3]];

const FREEZABLE: Array<[string, string]> = [
  ['tab after a list marker', '-\titem\n-\tsecond'],
  ['tab-indented continuation line', '- item\n\tcontinuation'],
  ['list nested by a tab', '- a\n\t- nested\n\t\tdeep'],
  ['tab after an ordered marker', '1.\tordered\n2.\titems'],
  ['two tabs after a marker reach code', '-\t\tcode item'],
  ['tabs inside table cells', '| a\t| b |\n| -\t| - |\n|\t1\t|\t2\t|'],
  ['tab after a blockquote marker', '>\tquoted\n>\t\tcode in quote'],
  ['tab-indented code', '\tcode line\n\tsecond'],
  ['mixed space and tab indentation', '  \tcode mixed\n \t- not a list'],
  ['tab after a heading marker', '#\theading'],
  ['tab-only line is blank', 'para\n\t\npara after'],
  ['tab before a fence closer', '```\ncode\n\t```\nstill inside\n```'],
  ['tab-indented fence opener is code', '\t```\nnot an opener\n```\nreal\n```'],
  ['thematic break with tabs', '-\t-\t-'],
  ['tab after a setext underline', 'Setext\n===\t'],
  ['definition with tab whitespace', '[a]:\t/u\t"t"'],
  ['footnote definition with tab body and continuation', '[^n]:\tbody\n\n\tcont'],
  ['definition-list description after a tab', 'Term\n:\tdesc'],
  ['fence inside a blockquote with tabs', '> q\n>\t```\n>\tx\n>\t```'],
];

const POISONED: Array<[string, string]> = [
  ['tab code holding a scanned tag (APPROX #5)', '\t<details>[a] scanned literal\n\t[^b]: not a def'],
  ['tab code holding a table part', '\t<td>s</td>'],
  ['checked box after a tab', '-\t[x] task'],
  ['checked box before a tab', '- [x]\ttask'],
];

function drive(name: string, doc: string, minIncrementalFrames: number): number {
  let incremental = 0;
  for (const config of CATALOG) {
    for (const sizes of SCHEDULES) {
      incremental += assertStreamEquivalence(name, scheduleSnapshots(doc, sizes), config, {
        minIncrementalFrames,
      }).incrementalFrames;
    }
  }
  return incremental;
}

describe('tab axis: every frame equals a full parse', () => {
  for (const [name, head] of FREEZABLE) {
    test(`freezable: ${name}`, () => {
      const incremental = drive(name, `${head}${TAIL}`, 0);
      expect(incremental, `${name}: the incremental path never ran`).toBeGreaterThan(0);
    });
  }
  for (const [name, head] of POISONED) {
    test(`poisoned: ${name}`, () => {
      drive(name, `${head}${TAIL}`, 0);
    });
  }
});

/**
 * OPEN DIVERGENCE (fresh-seed fuzz finds 20260916 and 20260917 at 2000
 * runs, 2026-09-15; production is deliberately not edited here).
 *
 * A footnote definition, a blank line, then a ``` line indented to column
 * 4 — by a tab or by four spaces — opens a fence INSIDE the footnote body.
 * The next column-0 line ends the footnote with the fence unclosed, so in
 * a full parse the footnote's empty code node ends on the opener line
 * (`end: {line: 3, column: 5, offset: 13}` for the tab form). The spliced
 * tree keeps the end the node had while the fence still ran to EOF and
 * rebases it, so the footnotes section carries a negative `end.offset` on
 * the code, pre and li nodes. mdast is equal; only hast positions differ.
 * Two blank-separated blocks have to follow the opener line for the
 * divergence to show (`[^a]: b\n\n\t```\nx\n\n<b>x</b>\n` holds); an
 * indented plain continuation (`\tcont`) holds, a column-0 ``` holds, and
 * a `\t$$` math opener diverges the same way — so the unclosed fence in
 * the footnote body is the hazard and the tab only made the composition
 * reachable. `tabBenignArb` therefore leaves the `\t```` shape out until
 * this pin is green.
 *
 * Minimal input, 19 bytes, baseline config, single-byte schedule, frame 18
 * (snapshot `"[^a]: b\n\n\t```\n\nq\n\np"`, incremental=true). On the
 * 27-byte html form (`…\t```\n\n<b>x</b>\n\np\n`, frame 25):
 *   observed  section.footnotes > ol > li[end -33] > pre[end -33] > code[end -33]
 *   expected  section.footnotes > ol > li[end 14]  > pre[end 14]  > code[end 14]
 */
describe('footnote body fence opened by a column-4 ``` (open divergence, 2026-09-15)', () => {
  const CASES: Array<[string, string, number[]]> = [
    ['minimal, tab-indented opener', '[^a]: b\n\n\t```\n\nq\n\np\n', [1]],
    ['tab-indented opener before an html block', '[^a]: b\n\n\t```\n\n<b>x</b>\n\np\n', [1]],
    ['four-space opener', '[^a]: b\n\n    ```\n\n<b>x</b>\n\np\n', [1]],
    ['tab-indented math opener', '[^a]: b\n\n\t$$\n\n<b>x</b>\n\np\n', [1]],
    ['lazy body line before the opener', 'intro\n\n[^a]: b\nlazy\n\n\t```\n\n<b>x</b>\n\np\n', [1]],
    // The two shrunk fuzz counterexamples, schedule included.
    [
      'fuzz seed 20260916',
      '[^a]: body text\n\n\t```\nnot a fence opener\n```\nreal fence\n```\n\n> a quoted line\n\n<b>x</b> <!-- trailing opener\n\nplain prose keeps flowing here\n',
      [4, 4, 1, 4, 1, 1, 4, 4],
    ],
    [
      'fuzz seed 20260917',
      '[^a]: body text\n\n\t```\nnot a fence opener\n```\nreal fence\n```\n\ninline `<div>` stays code\n\n<div>\n<div>\n</div\n</div>\n\ntail para\n\n[a]: https://example.com/a\n\nTerm line\n\n:   description body\n\n-\ttab after marker\n-\tsecond item\n',
      [4, 4, 4, 4, 4, 1, 1, 4],
    ],
  ];
  for (const [name, doc, sizes] of CASES) {
    test.skip(`${name}: every frame equals a full parse`, () => {
      for (const schedule of [sizes, [...sizes].reverse()]) {
        assertStreamEquivalence(name, scheduleSnapshots(doc, schedule), CATALOG[0], { minIncrementalFrames: 0 });
      }
    });
  }
  // Controls that hold today and must keep holding once the divergence is fixed.
  const CONTROLS: Array<[string, string]> = [
    ['indented plain continuation', '[^a]: b\n\n\tcont\n\n<b>x</b>\n\np\n'],
    ['only one block after the opener', '[^a]: b\n\n\t```\nx\n\n<b>x</b>\n'],
    ['column-0 ``` ends the footnote', '[^a]: b\n\n```\nx\n```\n\n<b>x</b>\n\np\n'],
  ];
  for (const [name, doc] of CONTROLS) {
    test(`control: ${name}`, () => {
      for (const config of CATALOG) {
        assertStreamEquivalence(name, scheduleSnapshots(doc, [1]), config, { minIncrementalFrames: 0 });
      }
    });
  }
});

describe('tab axis: scanner direction', () => {
  const boundary = (text: string) => computeFreezeBoundary(text, { defListEnabled: false }).boundary;

  test('a tab-only line ends the paragraph like a blank line', () => {
    const head = 'para\n\t\n';
    expect(boundary(`${head}para after${TAIL}`)).toBeGreaterThan(head.length);
  });

  test('a tab before a fence closer leaves the fence open', () => {
    // Column 4, so not a closer: nothing past the opener may freeze until
    // the real closer arrives, and then the document freezes normally.
    const open = '```\ncode\n\t```\n';
    expect(boundary(`${open}still inside${TAIL}`)).toBeLessThan(open.length);
    const closed = `${open}still inside\n\`\`\``;
    expect(boundary(`${closed}${TAIL}`)).toBeGreaterThan(closed.length);
  });

  test('a tab-indented ``` is code, not a fence opener', () => {
    const head = '\t```\n';
    expect(boundary(`${head}not an opener${TAIL}`)).toBeGreaterThan(head.length);
  });
});

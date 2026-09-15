/**
 * Tag-name prefix pins — deterministic companions to `tagNamePrefixArb` in
 * fuzzGenerators.ts. Every name shares a prefix with a table part, a
 * document-structure name, a no-element name or a raw-text / type-1 name
 * (`td-cell`, `col-md-6`, `tr-row`, `caption-box`, `header`, `html-x`,
 * `body-x`, `images`, `framework`, `prefix`, `styled`, `scripted`,
 * `textareas`) but is an ordinary unknown element to micromark and parse5.
 * The corpus had none of them before 2026-09-15, so a guard keyed on
 * `startsWith` or `\b` could misread the real name's hazard onto them
 * without anything noticing.
 *
 * Contract: every frame deep-equals a full parse. FREEZABLE shapes must
 * also engage the splice; EQUIVALENCE_ONLY shapes carry a real hazard next
 * to the prefixed name (a non-void self-closing tag stays open, a real
 * stray table part, a doctype, an inline block-level element that splits
 * the paragraph) or a known over-block, and owe equivalence only.
 *
 * Probing this axis also surfaced F29, a divergence under STANDARD names
 * — see the last describe block and specialElementEndTag.test.ts.
 */
import { describe, expect, test } from 'vitest';

import { computeFreezeBoundary } from './computeFreezeBoundary';
import { scheduleSnapshots } from './fuzzGenerators';
import { assertStreamEquivalence } from './spliceArbiterHarness';
import { CATALOG } from './testPluginCatalog';

const TAIL = '\n\npara one\n\npara *two*\n\n[a]: /u\n\ntail [a] end\n';
const SCHEDULES = [[1], [4, 4, 4, 1], [7, 3, 5, 2, 6, 4, 8, 1], [3, 30], [30, 3]];

const FREEZABLE: Array<[string, string]> = [
  ['td-cell on one line', '<td-cell>x</td-cell>'],
  ['caption-box on one line', '<caption-box>cap</caption-box>'],
  ['header block', '<header>\nx\n</header>'],
  ['html-x block', '<html-x>\nx\n</html-x>'],
  ['body-x block', '<body-x>\nx\n</body-x>'],
  ['framework inline', 'p <framework>x</framework> q'],
  ['images inline', 'p <images>x</images> q'],
  ['prefix block', '<prefix>\nx\n</prefix>'],
  ['styled wrapping a real style', '<styled>\n<style>.a{}</style>\n</styled>'],
  ['scripted block without inner tags', '<scripted>\nlet s = 1;\n</scripted>'],
  ['textareas wrapping a real textarea', '<textareas>\n<textarea>t</textarea>\n</textareas>'],
  ['td-cell inside a real table row', '<table>\n<tr><td-cell>x</td-cell></tr>\n</table>'],
  ['tr-row wrapping a real td', '<table>\n<tr-row><td>x</td></tr-row>\n</table>'],
  ['td-cell inline before a GFM table', 'p <td-cell>x</td-cell> q\n\n| a | b |\n| - | - |\n| 1 | 2 |'],
  ['prefix inside a real pre', '<pre>\n<prefix>x</prefix>\n</pre>'],
  ['scripted inside a real script', '<script>\nlet s = "<scripted>";\n</script>'],
];

const EQUIVALENCE_ONLY: Array<[string, string]> = [
  // A non-void self-closing tag stays open at block level.
  ['images self-closing alone', '<images/>'],
  ['td-cell self-closing alone', '<td-cell/>'],
  ['tr-row self-closing before a GFM table', '<tr-row/>\n\n| a | b |\n| - | - |'],
  // A REAL stray part next to the prefixed name.
  ['real stray td then td-cell', '<td>s</td>\n\n<td-cell>x</td-cell>'],
  ['col-md-6 wrapping a real col', '<col-md-6>\n<col>\n</col-md-6>'],
  // Block-level real names inline split the paragraph.
  ['header inline', 'p <header>x</header> q'],
  ['prefix and pre inline', 'p <prefix><pre></prefix></pre> q'],
  ['scripted holding a real details in a string', '<scripted>\nlet s = "<details>";\n</scripted>'],
  ['textareas holding an unclosed comment', '<textareas>\n<!-- c\n</textareas>'],
  ['framework wrapping a raw-text iframe', '<framework>\n<iframe>\n</framework>\n</iframe>'],
  ['html-x then a doctype', '<html-x>\nx\n</html-x>\n\n<!DOCTYPE html>'],
  ['body-x wrapping a real body', '<body-x>\n<body>\n</body>\n</body-x>'],
  ['stray prefixed end tag', '</tr-row>\ntext after a stray prefixed end tag'],
  ['attributes with a quoted > on the tag line', '<td-cell class="c" data-x="a>b">\ninner prose\n</td-cell>'],
  // Scanner grants the boundary, splice refuses every frame: see the todo.
  // The one-line `<td-cell>x</td-cell>` above does engage; the multi-line
  // block forms do not.
  ['col-md-6 block', '<col-md-6>\nx\n</col-md-6>'],
  ['td-cell block', '<td-cell>\ninner prose\n</td-cell>'],
  ['tr-row block', '<tr-row>\ninner prose\n</tr-row>'],
  // The bag counts a non-void self-closing tag as open; parse5 closes it
  // with the paragraph's synthesized `</p>`. Over-block only.
  ['images self-closing inside a paragraph', 'p <images/> q'],
  // Equivalent under sanitize only: see the skipped block below.
  ['prefix wrapping a real pre across lines', '<prefix>\n<pre>\n</prefix>\n</pre>'],
];

function drive(name: string, doc: string): number {
  let incremental = 0;
  for (const config of CATALOG) {
    for (const sizes of SCHEDULES) {
      incremental += assertStreamEquivalence(name, scheduleSnapshots(doc, sizes), config, {
        minIncrementalFrames: 0,
      }).incrementalFrames;
    }
  }
  return incremental;
}

describe('tag-name prefix axis: every frame equals a full parse', () => {
  for (const [name, head] of FREEZABLE) {
    test(`freezable: ${name}`, () => {
      expect(drive(name, `${head}${TAIL}`), `${name}: the incremental path never ran`).toBeGreaterThan(0);
    });
  }
  for (const [name, head] of EQUIVALENCE_ONLY) {
    test(`equivalence only: ${name}`, () => {
      drive(name, `${head}${TAIL}`);
    });
  }

  // Measured 2026-09-15: the scanner grants boundary 57 of 70 on the
  // `<col-md-6>` document, but no frame ever splices under any config or
  // schedule, and the multi-line `<td-cell>` / `<tr-row>` blocks behave the
  // same. `TABLE_PART_TAG_RE` / `TABLE_TOKEN_RE` in spliceHtmlGuards.ts end
  // the name with `\b`, and `-` is a word boundary, so `<col-md-6>` reads as
  // a stray `<col>` and `hasStrayTablePart` refuses the splice. Over-block
  // only (the fallback is correct); the scanner side (`TABLE_PART_NAMES`,
  // exact-name set) does not share the gap. Production is not edited here.
  test.todo('a hyphenated name sharing a table-part prefix should still splice (<col-md-6>, <td-cell>, <tr-row>)');

  test('a hyphenated table-part prefix is not a stray part to the scanner', () => {
    const doc = `<col-md-6>\nx\n</col-md-6>${TAIL}`;
    const stray = `<col>\nx${TAIL}`;
    const grant = computeFreezeBoundary(doc, { defListEnabled: false }).boundary;
    expect(grant).toBeGreaterThan('<col-md-6>\nx\n</col-md-6>'.length);
    expect(computeFreezeBoundary(stray, { defListEnabled: false }).boundary).toBeLessThan(grant);
  });
});

/**
 * F29 (found 2026-09-15 while probing this axis, fixed the same day; see
 * GRAMMAR-COVERAGE.md and specialElementEndTag.test.ts).
 *
 * parse5 "any other end tag": walking the open-element stack from the top,
 * a SPECIAL element (div, pre, p, ul, section, …) met before the matching
 * element discards the token. In `<span>\n<div>\n</span>\n</div>` the
 * `</span>` is dropped, `</div>` pops the div, and the span stays OPEN —
 * every later block nests inside it. The scanner's scope walk stopped only
 * at the barrier subset, read the pair as balanced and granted the
 * boundary; the splice appended the tail at root. Formatting names (`a`,
 * `b`, `em`) take the adoption-agency path and are unaffected; an outer
 * `<div>` wrapper closes everything and is unaffected. `sup` and `kbd`
 * behave like `span`. The unknown names of this axis
 * (`<prefix>\n<pre>\n</prefix>\n</pre>`) walk the same path, but sanitize
 * strips the element and hoists its children, which hides the nesting from
 * the hast contract — the divergence was only visible under a
 * sanitize-allowed name.
 *
 * Minimal input, 31 bytes, baseline config, single-byte schedule, frame
 * 29 (snapshot `"<span>\n<div>\n</span>\n</div>\n\np"`, incremental=true):
 *   observed  root > [span > ["\n", div > "\n\n"], "\n", p > "p"]
 *   expected  root > [span > ["\n", div > "\n\n", "\n", p > "p"]]
 * The one-line form `<span><div></span></div>\n\npara\n` diverged at frame
 * 27 (`…\n\npa`): observed root > [p > span, div, "\n", p > "pa"], expected
 * root > [p > span, div, p, "\n", p > "pa"] — the synthesized empty `<p>`
 * was missing on the spliced side.
 *
 * The walk now stops at any special element for names outside parse5's
 * named end-tag cases, so the span stays on `openStack` and no candidate
 * past it survives. Equivalence only: the shapes never splice.
 */
describe('special-element end-tag discard (F29)', () => {
  const CASES: Array<[string, string]> = [
    ['span/div block', '<span>\n<div>\n</span>\n</div>\n\npara\n'],
    ['span/div one line', '<span><div></span></div>\n\npara\n'],
    ['span/pre block', '<span>\n<pre>\n</span>\n</pre>\n\n*b*\n'],
    ['span/p block', '<span>\n<p>\n</span>\n</p>\n\n*b*\n'],
    ['span/ul block', '<span>\n<ul>\n</span>\n</ul>\n\n*b*\n'],
    ['sup/div block', '<sup>\n<div>\n</sup>\n</div>\n\n*b*\n'],
    ['kbd/div block', '<kbd>\n<div>\n</kbd>\n</div>\n\n*b*\n'],
  ];
  for (const [name, doc] of CASES) {
    test(`${name}: every frame equals a full parse`, () => {
      for (const config of CATALOG) {
        assertStreamEquivalence(name, scheduleSnapshots(doc, [1]), config, { minIncrementalFrames: 0 });
      }
    });
    test(`${name}: the scanner keeps the element open`, () => {
      // The end tag is discarded, so nothing past the first start tag may
      // freeze: the boundary sits at or before the html block's first line.
      expect(computeFreezeBoundary(doc, { defListEnabled: false }).boundary).toBeLessThanOrEqual(doc.indexOf('\n') + 1);
    });
  }
  // Controls that hold today and must keep holding once the divergence is fixed.
  const CONTROLS: Array<[string, string]> = [
    ['formatting name b/div', '<b>\n<div>\n</b>\n</div>\n\n*b*\n'],
    ['formatting name em/div', '<em>\n<div>\n</em>\n</div>\n\n*b*\n'],
    ['wrapped in an outer div', '<div>\n<span>\n<div>\n</span>\n</div>\n</div>\n\n*b*\n'],
  ];
  for (const [name, doc] of CONTROLS) {
    test(`control: ${name}`, () => {
      for (const config of CATALOG) {
        assertStreamEquivalence(name, scheduleSnapshots(doc, [1]), config, { minIncrementalFrames: 0 });
      }
    });
  }
});

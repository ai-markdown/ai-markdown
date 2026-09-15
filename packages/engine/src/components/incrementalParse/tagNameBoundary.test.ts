/**
 * Tag-NAME boundaries, in the two places a name is matched by prefix
 * instead of as a whole token:
 *
 * - the splice guards (`TABLE_PART_TAG_RE`, `hasStrayTablePart`,
 *   `STRAY_SYNTHESIZED_END_TAG_RE`) ended names with `\b`, which treats `-`
 *   as a boundary. A custom element whose name starts with a table-part
 *   name (`<col-md-6>`, `<td-cell>`, `<tr-row>`, `<caption-box>`) passed the
 *   scanner (its tag grammar reads the whole `[A-Za-z][A-Za-z0-9-]*` run)
 *   and was refused by the splice on every frame — a full parse per frame
 *   with nothing to show for it (426 ms against 26 ms for `<section>` on
 *   400 paragraphs streamed in 60 frames).
 * - `tailCarriesRetroactive` matched `<head` etc. with `startsWith`, so a
 *   `<header …>` opener arriving byte by byte suppressed the boundary from
 *   `<head` onward, and kept suppressing it on every later frame because
 *   every later frame still starts with those bytes (37 of 41 frames were
 *   full parses for `<header class="x">Title</header>`).
 *
 * The first block below derives its corpus from the scanner's own name
 * lists and asserts the guards classify every shape the way the scanner's
 * tag grammar does, so the two cannot drift apart again.
 */
import { describe, expect, test } from 'vitest';

import { advanceIncrementalParse, type IncrementalParseState } from './advanceIncrementalParse';
import { computeFreezeBoundary } from './computeFreezeBoundary';
import { TAG_OR_COMMENT_RE, tailCarriesRetroactive } from './freezeLineSyntax';
import { SCANNER_NAME_LISTS } from './scannerNameLists';
import { scheduleSnapshots } from './fuzzGenerators';
import { assertStreamEquivalence } from './spliceArbiterHarness';
import {
  STRAY_SYNTHESIZED_END_TAG_RE,
  TABLE_PART_TAG_RE,
  hasStrayTablePart,
  rawTextRegionCrossesOut,
} from './spliceHtmlGuards';
import { CATALOG, buildAdvanceOptions } from './testPluginCatalog';

const listNamed = (label: string): ReadonlySet<string> => {
  const entry = SCANNER_NAME_LISTS.find(([name]) => name === label);
  if (!entry) throw new Error(`scanner name list ${label} is gone — update this pin`);
  return entry[1];
};

const TABLE_PARTS = listNamed('tablePart');
const RAW_TEXT = listNamed('rawText');
const SYNTHESIZED_END = new Set(['br', 'p']);

/** The scanner's reading of one token: the tag grammar `TAG_OR_COMMENT_RE`
 *  applies (a name is the whole `[A-Za-z][A-Za-z0-9-]*` run and must be
 *  followed by whitespace, `/` or `>`), or no tag at all. */
function scannerReads(token: string): { closing: boolean; name: string } | null {
  TAG_OR_COMMENT_RE.lastIndex = 0;
  const m = TAG_OR_COMMENT_RE.exec(token);
  if (m === null || m[2] === undefined) return null;
  return { closing: m[1] === '/', name: m[2].toLowerCase() };
}

/** Every shape a name can take around its boundary: real tags (open,
 *  attributes, self-closing, tab / newline before `>`, closing, upper case)
 *  and the look-alikes a `\b` confused with them (`-x`, `x`, `_x`, `.x`). */
function shapes(name: string): string[] {
  return [
    `<${name}>`,
    `<${name} a="b">`,
    `<${name}/>`,
    `<${name}\t>`,
    `<${name}\n>`,
    `</${name}>`,
    `</${name} >`,
    `<${name.toUpperCase()}>`,
    `<${name}-x>`,
    `</${name}-x>`,
    `<${name}x>`,
    `<${name}_x>`,
    `<${name}.x>`,
  ];
}

describe('splice guards classify tag names exactly like the scanner tag grammar', () => {
  const names = new Set([...TABLE_PARTS, ...RAW_TEXT, ...SYNTHESIZED_END, 'div', 'section', 'col-md']);

  test('every shape of every name agrees', () => {
    const disagreements: string[] = [];
    for (const name of names) {
      for (const token of shapes(name)) {
        const read = scannerReads(token);
        const expectTablePart = read !== null && TABLE_PARTS.has(read.name);
        const expectStrayTablePart = expectTablePart; // one stray token, no table around it
        const expectTablePartStart = expectTablePart && !read!.closing;
        const expectRawTextOpen = read !== null && !read.closing && RAW_TEXT.has(read.name);
        const expectSynthesizedEnd = read !== null && read.closing && SYNTHESIZED_END.has(read.name);
        const actual = {
          tablePartStart: TABLE_PART_TAG_RE.test(token),
          strayTablePart: hasStrayTablePart([token]),
          rawTextOpen: rawTextRegionCrossesOut([token]),
          synthesizedEnd: STRAY_SYNTHESIZED_END_TAG_RE.test(token),
        };
        const wanted = {
          tablePartStart: expectTablePartStart,
          strayTablePart: expectStrayTablePart,
          rawTextOpen: expectRawTextOpen,
          synthesizedEnd: expectSynthesizedEnd,
        };
        if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
          disagreements.push(
            `${JSON.stringify(token)}: guards ${JSON.stringify(actual)}, scanner ${JSON.stringify(wanted)}`
          );
        }
      }
    }
    expect(disagreements).toEqual([]);
  });

  test('a name cut off at the end of a value still counts (the old `\\b` behaviour at end of input)', () => {
    for (const name of TABLE_PARTS) {
      expect(TABLE_PART_TAG_RE.test(`<${name}`), name).toBe(true);
      expect(hasStrayTablePart([`<${name}`]), name).toBe(true);
      expect(hasStrayTablePart([`<table><${name}`]), name).toBe(false);
    }
    for (const name of SYNTHESIZED_END) expect(STRAY_SYNTHESIZED_END_TAG_RE.test(`</${name}`), name).toBe(true);
    expect(TABLE_PART_TAG_RE.test('<col-')).toBe(false);
    expect(STRAY_SYNTHESIZED_END_TAG_RE.test('</p-')).toBe(false);
  });

  test('scanner and splice agree end to end: a real stray part poisons, a look-alike splices', () => {
    const boundary = (text: string) => computeFreezeBoundary(text, { defListEnabled: false }).boundary;
    let paras = '';
    for (let i = 0; i < 12; i++) paras += `paragraph ${i} of the document.\n\n`;
    for (const name of TABLE_PARTS) {
      // The real thing: poisoned from the tag on (tablePartPoison owns the
      // detail; this is the control for the look-alikes).
      expect(boundary(`intro\n\n<${name}>x\n\n${paras}`), name).toBeLessThanOrEqual('intro\n\n'.length);
      for (const suffix of ['-x', 'x']) {
        const element = `<${name}${suffix}>\nx\n</${name}${suffix}>\n\n`;
        const doc = element + paras;
        expect(boundary(doc), `${name}${suffix} scanner`).toBeGreaterThan(element.length);
        const stats = assertStreamEquivalence(`look-alike ${name}${suffix}`, scheduleSnapshots(doc, [9]), CATALOG[0]);
        // Only the frames still inside the element itself may full-parse.
        const framesInsideElement = Math.ceil(element.length / 9);
        expect(stats.incrementalFrames, `${name}${suffix} splice`).toBeGreaterThanOrEqual(
          stats.frames - framesInsideElement - 1
        );
      }
    }
  });
});

describe('regression: `<col-md-6>` document splices on every frame after the first', () => {
  test('400 paragraphs streamed in 60 frames', () => {
    let paras = '';
    for (let i = 0; i < 400; i++) paras += `paragraph ${i} of the document.\n\n`;
    const doc = `<col-md-6>\nx\n</col-md-6>\n\n${paras}`;
    const step = Math.ceil(doc.length / 60);
    const stats = assertStreamEquivalence('col-md-6 regression', scheduleSnapshots(doc, [step]), CATALOG[0]);
    expect(stats.frames).toBe(60);
    expect(stats.incrementalFrames).toBe(stats.frames - 1);
  });
});

describe('tailCarriesRetroactive matches complete names only', () => {
  test.each([
    // [partial line text, verdict]
    ['<head>', true],
    ['<head ', true],
    ['<head/', true],
    ['x <HEAD class="a">', true],
    ['</head>', true],
    ['<body>', true],
    ['<html lang="en">', true],
    ['<frameset>', true],
    ['<frame>', true],
    ['</frame>', true],
    ['<image>', true],
    ['<!doctype', true],
    ['<!DOCTYPE html', true],
    // Cut inside the name: parse5 drops a tag that ends at end of input.
    ['<head', false],
    ['<bod', false],
    ['<!doctyp', false],
    // Other elements that merely start with a retroactive name.
    ['<header', false],
    ['<header class="x">', false],
    ['</header>', false],
    ['<html-x>', false],
    ['<bodyguard>', false],
    ['<framework>', false],
    ['<images>', false],
    ['<head_x>', false],
    ['<', false],
    ['plain text', false],
  ])('%j → %s', (text, verdict) => {
    expect(tailCarriesRetroactive(text)).toBe(verdict);
  });

  test('a confirmed line ends a name at its line ending', () => {
    expect(tailCarriesRetroactive('<head', true)).toBe(true);
    expect(tailCarriesRetroactive('</body', true)).toBe(true);
    expect(tailCarriesRetroactive('<header', true)).toBe(false);
    expect(tailCarriesRetroactive('<hea', true)).toBe(false);
  });
});

describe('streaming `<header class="x">Title</header>` byte by byte', () => {
  const HEADER = 'intro\n\n<header class="x">Title</header>\n';
  const HEAD = 'intro\n\n<head class="x">Title</head>\n';

  function verdicts(doc: string): boolean[] {
    const options = buildAdvanceOptions(CATALOG[0]);
    let state: IncrementalParseState | null = null;
    const out: boolean[] = [];
    for (let i = 1; i <= doc.length; i++) {
      const result = advanceIncrementalParse(state, doc.slice(0, i), options);
      state = result.nextState;
      out.push(result.usedIncremental);
    }
    return out;
  }

  test('every frame of the opener splices, including the ones that start with `<head`', () => {
    assertStreamEquivalence('header byte stream', scheduleSnapshots(HEADER, [1]), CATALOG[0]);
    const spliced = verdicts(HEADER);
    const openerStart = HEADER.indexOf('<header');
    const openerEnd = HEADER.indexOf('>', openerStart);
    // Frame k holds the first k bytes; the frame that adds byte i is k = i + 1.
    for (let i = openerStart; i <= openerEnd; i++) {
      expect(spliced[i], `frame ${i + 1} ${JSON.stringify(HEADER.slice(0, i + 1))}`).toBe(true);
    }
    // 4 of 41 frames spliced before the fix. The frames after the opener
    // are refused by a different, pre-existing rule: `header` is not in the
    // sanitize schema, so its output is a bare root text the join does not
    // model — `<article>` streams identically. Out of this test's scope.
    expect(spliced.filter(Boolean).length).toBeGreaterThanOrEqual(openerEnd - openerStart + 1);
  });

  test('a real `<head` tag still suppresses the boundary once its name is complete', () => {
    assertStreamEquivalence('head byte stream', scheduleSnapshots(HEAD, [1]), CATALOG[0]);
    const spliced = verdicts(HEAD);
    const nameEnd = HEAD.indexOf('<head') + '<head'.length;
    // `<head` (cut inside the name) still splices; `<head ` is a complete
    // head start tag and every frame from there on is a full parse.
    expect(spliced[nameEnd - 1]).toBe(true);
    for (let i = nameEnd; i < HEAD.length; i++) {
      expect(spliced[i], `frame ${i + 1} ${JSON.stringify(HEAD.slice(0, i + 1))}`).toBe(false);
    }
  });
});

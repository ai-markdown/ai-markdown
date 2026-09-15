/**
 * The reviewer's decision probes for bf9dc64 (2026-09-15 review, sections
 * 1 and 4), kept as tests.
 *
 * Section 1 judged five deliberate deviations of `taskListContext.ts` from
 * the design's wording by their observed facts: a fence or `$$` opener
 * certifies on the spot; an interrupting html block certifies the closed
 * paragraph and then forgets, a non-lazy type-7 line is a continuation and
 * an opaque line forgets before certifying; a column-0 list marker or `>`
 * after a confirmed blank is a root sync point; the first content after an
 * empty marker line requires an EMPTY marker line and zero extra indent;
 * and a `:` description line drops the box under the definition-list
 * profile. This pins those facts — the tracker's state after the source and
 * what a full parse with a late `[x]:` definition does with the box —
 * so the deviations cannot drift into an under-block unnoticed. The `$$`
 * case is pinned under the declared math capability and without it.
 *
 * Section 4 found the checkpoint abstraction merging two list items that
 * answer the same future differently; `taskItemSize` now separates them.
 */
import { describe, expect, test } from 'vitest';
import type { Nodes } from 'mdast';

import { parseStage } from '../markdown';
import {
  computeFreezeBoundary,
  type FreezeBoundaryOptions,
  type FreezeScanCheckpointInternal,
} from './computeFreezeBoundary';
import { abstractSignature, SIGNATURE_DOMAIN, signatureValues } from './checkpointAbstraction';
import { buildAdvanceOptions, CATALOG } from './testPluginCatalog';

const lateDefinition = '\n\n[x]: /u\n\n';

/** A fact that differs between the two definition-list profiles: [off, on]. */
type ByProfile<T> = T | [T, T];
const pick = <T>(value: ByProfile<T>, defList: boolean): T =>
  Array.isArray(value) ? (value as [T, T])[defList ? 1 : 0] : (value as T);

interface DecisionCase {
  name: string;
  source: string;
  /** Unresolved `[x]` references the scanner still holds (0 = certified). */
  xTaint: ByProfile<number>;
  /** The tracker gave up modelling the structure. */
  unknown: ByProfile<boolean>;
  checked: Array<boolean | null>;
  headings?: number;
  refs?: number;
}

const CASES: DecisionCase[] = [
  { name: 'fence certifies on the spot', source: '- [x] a\n  ```\n', xTaint: 0, unknown: false, checked: [true] },
  { name: 'declared $$ certifies on the spot', source: '- [x] a\n  $$\n', xTaint: 0, unknown: false, checked: [true] },
  {
    name: 'root html certifies the closed paragraph, then forgets',
    source: '- [x] a\n  <div>\n',
    xTaint: 1,
    unknown: true,
    checked: [true],
  },
  {
    name: 'quoted html certifies, then forgets',
    source: '> - [x] a\n>   <div>\n',
    xTaint: 0,
    unknown: true,
    checked: [true],
  },
  {
    name: 'non-lazy type 7 is a continuation: the setext still claims the box',
    source: '- [x] a\n  <x-tag>\n  ===\n',
    xTaint: 1,
    unknown: true,
    checked: [null],
    headings: 1,
    refs: 1,
  },
  {
    name: 'lazy type 7 opens html: forget without certifying',
    source: '- [x] a\n<x-tag>\n',
    xTaint: 1,
    unknown: true,
    checked: [true],
  },
  {
    name: 'root sync: column-0 list after a footnote body',
    source: '[^n]: text\n\n- [x] a\n\noutside\n\n',
    xTaint: 0,
    unknown: false,
    checked: [true],
  },
  {
    name: 'root sync: column-0 quote after a description',
    source: 'term\n: description\n\n> - [x] a\n\noutside\n\n',
    xTaint: 0,
    unknown: false,
    checked: [true],
  },
  {
    name: 'empty marker line, first content next',
    source: '-\n  [x] a\n\noutside\n\n',
    xTaint: 0,
    unknown: false,
    checked: [true],
  },
  {
    name: 'trailing space on the marker line is a linePrefix',
    source: '- \n  [x] a\n\noutside\n\n',
    xTaint: 1,
    unknown: false,
    checked: [null],
    refs: 1,
  },
  {
    name: 'extra indent before the first content',
    source: '-\n   [x] a\n\noutside\n\n',
    xTaint: 1,
    unknown: false,
    checked: [null],
    refs: 1,
  },
  {
    name: 'colon line right after the box',
    source: '- [x] a\n  : desc\n',
    xTaint: 1,
    unknown: [false, true],
    checked: [true],
  },
  {
    name: 'colon line after a blank',
    source: '- [x] a\n\n  : desc\n',
    xTaint: [0, 1],
    unknown: [false, true],
    checked: [true],
  },
];

const walk = (node: Nodes): Nodes[] => [node, ...('children' in node ? node.children.flatMap(walk) : [])];

function oracle(source: string, defList: boolean) {
  const config = CATALOG.find((c) => c.label === (defList ? 'def-list-only' : 'baseline'))!;
  const nodes = walk(
    parseStage({ children: source + lateDefinition, remarkPlugins: buildAdvanceOptions(config).remarkPlugins }).mdast
  );
  return {
    checked: nodes.filter((n) => n.type === 'listItem').map((n) => n.checked ?? null),
    headings: nodes.filter((n) => n.type === 'heading').length,
    refs: nodes.filter((n) => n.type === 'linkReference' && n.identifier === 'x').length,
  };
}

function scan(source: string, profile: FreezeBoundaryOptions, resume?: FreezeScanCheckpointInternal) {
  const result = computeFreezeBoundary(source, profile, resume);
  const cp = result.checkpoint as FreezeScanCheckpointInternal;
  return { boundary: result.boundary, cp, xTaint: cp.unresolvedRefs.filter((ref) => ref.label === 'X').length };
}

const profileFor = (defList: boolean): FreezeBoundaryOptions => ({
  defListEnabled: defList,
  gfmTaskListItems: true,
  mathFlow: true,
});

describe('five deviations: observed facts', () => {
  for (const defList of [false, true]) {
    test.each(CASES)(`[defList=${defList}] $name`, ({ source, xTaint, unknown, checked, headings = 0, refs = 0 }) => {
      const scanned = scan(source, profileFor(defList));
      expect(scanned.xTaint).toBe(pick(xTaint, defList));
      expect(scanned.cp.task.unknown).toBe(pick(unknown, defList));
      expect(oracle(source, defList)).toEqual({ checked, headings, refs });
      // A certified box must be a task in the real parse, whatever comes later.
      if (scanned.xTaint === 0) expect(checked).toContain(true);
    });
  }

  test('an undeclared $$ line forgets the item instead of certifying', () => {
    for (const defList of [false, true]) {
      const undeclared = scan('- [x] a\n  $$\n', { defListEnabled: defList, gfmTaskListItems: true });
      expect(undeclared.xTaint).toBe(1);
      expect(undeclared.cp.task.unknown).toBe(true);
    }
  });
});

describe('exact task projection across grammar-profile switches', () => {
  test('resuming under every switched profile matches a fresh scan, state for state', () => {
    let flips = 0;
    for (const defList of [false, true]) {
      const profile = profileFor(defList);
      const switched: FreezeBoundaryOptions[] = [
        { ...profile, gfmTaskListItems: false },
        profile,
        { ...profile, defListEnabled: !defList },
        { ...profile, mathFlow: false },
        { defListEnabled: defList, gfmTaskListItems: true },
        { ...profile, referenceTaint: false },
        profile,
      ];
      for (const { source } of CASES) {
        let resume = scan(source, profile).cp;
        for (const flip of switched) {
          const resumed = scan(source, flip, resume);
          const fresh = scan(source, flip);
          expect(resumed.cp.task, JSON.stringify({ source, flip })).toStrictEqual(fresh.cp.task);
          expect(resumed.cp.mathDeclared).toBe(fresh.cp.mathDeclared);
          expect(resumed.boundary, JSON.stringify({ source, flip })).toBe(fresh.boundary);
          resume = resumed.cp;
          flips += 1;
        }
      }
    }
    expect(flips).toBe(2 * CASES.length * 7);
  });
});

describe('checkpoint abstraction keeps the content column (review section 4)', () => {
  test('`- [x] a` and `-   [x] a` differ in exactly the taskItemSize field', () => {
    const profile = profileFor(false);
    const narrow = scan('- [x] a\n', profile).cp;
    const wide = scan('-   [x] a\n', profile).cp;
    expect(narrow.task.stack[0]).toMatchObject({ kind: 'item', size: 2 });
    expect(wide.task.stack[0]).toMatchObject({ kind: 'item', size: 4 });
    expect(abstractSignature(narrow)).not.toBe(abstractSignature(wide));
    const field = SIGNATURE_DOMAIN.findIndex((f) => f.name === 'taskItemSize');
    expect(field).toBeGreaterThanOrEqual(0);
    expect(signatureValues(narrow)[field]).toBe('2');
    expect(signatureValues(wide)[field]).toBe('4');
    const others = (cp: FreezeScanCheckpointInternal) => signatureValues(cp).filter((_, i) => i !== field);
    expect(others(narrow)).toEqual(others(wide));
    // The future the two states answer differently: a two-column underline
    // is the first item's setext heading and lazy text under the second.
    const future = '  ===\n\noutside\n\nnext\n\n';
    expect(scan('- [x] a\n' + future, profile).boundary).toBe(0);
    expect(scan('-   [x] a\n' + future, profile).boundary).toBeGreaterThan(('-   [x] a\n' + future).indexOf('outside'));
    expect(oracle('- [x] a\n' + future, false)).toEqual({ checked: [null], headings: 1, refs: 1 });
    expect(oracle('-   [x] a\n' + future, false)).toEqual({ checked: [true], headings: 0, refs: 0 });
  });

  test("taskItemSize buckets follow micromark's prefix size and stay inside the declared domain", () => {
    const profile = profileFor(false);
    const field = SIGNATURE_DOMAIN.find((f) => f.name === 'taskItemSize')!;
    // [source, bucket]: marker width plus one to four columns of marker
    // whitespace; five or more columns make the content indented code and
    // only one column is prefix; an empty marker line counts one column.
    const shapes: Array<[string, string]> = [
      ['- x\n', '2'],
      ['-\n', '2'],
      ['-     x\n', '2'],
      ['-  x\n', '3'],
      ['1. x\n', '3'],
      ['-   x\n', '4'],
      ['12. x\n', '4'],
      ['-    x\n', '5'],
      ['123. x\n', '5'],
      ['1.    x\n', '6+'],
      ['   123.    x\n', '6+'],
      ['para\n', 'none'],
      ['> quote\n', 'none'],
    ];
    for (const [source, bucket] of shapes) {
      const value = field.of(scan(source, profile).cp);
      expect(field.values, `${JSON.stringify(source)} → ${value}`).toContain(value);
      expect(value, JSON.stringify(source)).toBe(bucket);
    }
    expect([...new Set(shapes.map(([, bucket]) => bucket))].sort()).toEqual([...field.values].sort());
  });
});

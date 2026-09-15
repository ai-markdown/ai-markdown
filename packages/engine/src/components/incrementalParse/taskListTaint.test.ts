/**
 * Test-first contract for task-list taint release (design: tasklist-design.md).
 * The conservative describe must pass before the optimization exists. The
 * benefit describe is deliberately RED until explicit GFM capability,
 * container ownership and irreversible paragraph settlement are implemented.
 * No skipped/expected-failure tests: these become ordinary release gates.
 */
import { describe, expect, test } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Nodes, Root as MdastRoot } from 'mdast';

import { parseStage, transformStage } from '../markdown';
import {
  advanceIncrementalParse,
  type AdvanceOptions,
  type AdvanceResult,
  type IncrementalParseState,
} from './advanceIncrementalParse';
import { computeFreezeBoundary, type FreezeBoundaryOptions, type FreezeScanCheckpoint } from './computeFreezeBoundary';
import { buildAdvanceOptions, CATALOG } from './testPluginCatalog';

// Structural intersections let this test compile BEFORE the optional public
// fields land. The real functions receive the agreed flag; no implementation
// is mocked and no @ts-ignore/any hides future type incompatibilities.
type TaskProfile = FreezeBoundaryOptions & { gfmTaskListItems?: boolean };
type TaskOptions = AdvanceOptions & { gfmTaskListItems?: boolean };
type Ending = '\n' | '\r\n' | '\r';
const ENDINGS: readonly [string, Ending][] = [
  ['LF', '\n'],
  ['CRLF', '\r\n'],
  ['CR', '\r'],
];
const PROFILES = [
  { name: 'GFM', defList: false },
  { name: 'GFM + definitionList', defList: true },
] as const;
const closeAndContinue = '\n\noutside paragraph\n\nanother paragraph\n\nlast paragraph\n';
const lateDefinition = '\n\n[x]: /late\n\n';
const syntaxGfm = unified().use(remarkParse).use(remarkGfm);
const syntaxCommonMark = unified().use(remarkParse);

function descendants(root: Nodes): Nodes[] {
  const result: Nodes[] = [root];
  if ('children' in root) for (const child of root.children) result.push(...descendants(child));
  return result;
}

function facts(root: MdastRoot) {
  const nodes = descendants(root);
  return {
    checked: nodes.filter((node) => node.type === 'listItem').map((node) => node.checked ?? null),
    headings: nodes.filter((node) => node.type === 'heading').length,
    tables: nodes.filter((node) => node.type === 'table').length,
    xRefs: nodes.filter((node) => node.type === 'linkReference' && node.identifier.toLowerCase() === 'x').length,
  };
}

function options(defList = false, gfmTaskListItems: boolean | 'omitted' = true, commonMark = false): TaskOptions {
  const built = buildAdvanceOptions(
    CATALOG.find((config) => config.label === (defList ? 'def-list-only' : 'baseline'))!
  );
  return {
    ...built,
    // A real CommonMark parser is needed for the off/default control. Merely
    // turning off the scanner flag while retaining remark-gfm is not that test.
    ...(commonMark ? { remarkPlugins: [], rehypePlugins: [], remarkRehypeOptions: {} } : {}),
    ...(gfmTaskListItems === 'omitted' ? {} : { gfmTaskListItems }),
  };
}

function profileFor(opts: TaskOptions): TaskProfile {
  return {
    defListEnabled: opts.defListEnabled,
    ...(opts.gfmTaskListItems === undefined ? {} : { gfmTaskListItems: opts.gfmTaskListItems }),
  };
}

function full(source: string, opts: TaskOptions) {
  const parsed = parseStage({
    children: source,
    remarkPlugins: opts.remarkPlugins,
    rehypePlugins: opts.rehypePlugins,
    remarkRehypeOptions: opts.remarkRehypeOptions,
  });
  return { mdast: parsed.mdast, hast: transformStage(parsed) };
}

function withEnding(source: string, ending: Ending): string {
  return source.replaceAll('\n', ending);
}

function snapshots(source: string, schedule: 'character' | 'line'): string[] {
  if (schedule === 'character') return Array.from({ length: source.length }, (_, index) => source.slice(0, index + 1));
  // Includes bare CR, CRLF, container-only blank lines, and a final partial line.
  const cuts = [...source.matchAll(/\r\n|[\r\n]/g)].map((match) => match.index + match[0].length);
  if (cuts.at(-1) !== source.length) cuts.push(source.length);
  return cuts.map((cut) => source.slice(0, cut));
}

function stream(frames: readonly string[], opts: TaskOptions) {
  let state: IncrementalParseState | null = null;
  // Independent ownership: never resume a checkpoint borrowed from advance.
  let checkpoint: FreezeScanCheckpoint | null = null;
  const results: AdvanceResult[] = [];
  for (const [index, source] of frames.entries()) {
    const profile = profileFor(opts);
    const resumed = computeFreezeBoundary(source, profile, checkpoint);
    const fresh = computeFreezeBoundary(source, profile);
    checkpoint = resumed.checkpoint;
    const message = `frame=${index} source=${JSON.stringify(source)}`;
    expect(resumed.boundary, `resume vs fresh: ${message}`).toBe(fresh.boundary);
    expect(computeFreezeBoundary(source, profile, checkpoint).boundary, `idempotence: ${message}`).toBe(fresh.boundary);
    const actual = advanceIncrementalParse(state, source, opts);
    state = actual.nextState;
    expect(state.stableBoundary, `advance scanner: ${message}`).toBe(fresh.boundary);
    const expected = full(source, opts);
    // No position stripping or serialization: both syntax trees must match
    // the independent fresh pipeline, including on full-fallback frames.
    expect(actual.mdast, `MDAST: ${message}`).toStrictEqual(expected.mdast);
    expect(actual.hast, `HAST: ${message}`).toStrictEqual(expected.hast);
    results.push(actual);
  }
  return results;
}

interface SyntaxCase {
  name: string;
  body: string;
  checked: Array<boolean | null>;
  refs?: number;
  headings?: number;
  tables?: number;
}

// Every semantic example in design section 2, plus lexical/ownership edges.
const SYNTAX_CASES: SyntaxCase[] = [
  { name: 'checked', body: '- [x] a', checked: [true] },
  { name: 'uppercase checked', body: '- [X] a', checked: [true] },
  { name: 'unchecked', body: '- [ ] a', checked: [false] },
  { name: 'immediate setext equals', body: '- [x] a\n  ===', checked: [null], refs: 1, headings: 1 },
  { name: 'ordinary next line is not a certificate', body: '- [x] a\n  b', checked: [true] },
  { name: 'delayed setext', body: '- [x] a\n  b\n  ===', checked: [null], refs: 1, headings: 1 },
  { name: 'lazy then setext', body: '- [x] a\nb\n  ===', checked: [null], refs: 1, headings: 1 },
  { name: 'ordered marker is lazy at root', body: 'para\n2. [x] b', checked: [], refs: 1 },
  { name: 'ordered marker is lazy in item', body: '- a\n  2. [x] b', checked: [null], refs: 1 },
  { name: 'ordered siblings', body: '1. [x] a\n2. [x] b', checked: [true, true] },
  { name: 'nested bullet', body: '- a\n  - [x] b', checked: [null, true] },
  { name: 'quoted task', body: '> - [x] a', checked: [true] },
  { name: 'inline non-task', body: '- item [x] a', checked: [null], refs: 1 },
  { name: 'second paragraph is not first content', body: '- first\n\n  [x] a', checked: [null], refs: 1 },
  { name: 'heading consumed first content', body: '- # first\n\n  [x] a', checked: [null], refs: 1, headings: 1 },
  { name: 'empty marker then first content', body: '-\n  [x] a', checked: [true] },
  { name: 'bare checkbox has paragraph EOF', body: '- [x]', checked: [null], refs: 1 },
  { name: 'spaces then paragraph EOF', body: '- [x] \t', checked: [null], refs: 1 },
  { name: 'same paragraph supplies next-line content', body: '- [x]\n  a', checked: [true] },
  { name: 'tab content column and setext', body: '-\t[x] a\n    ===', checked: [null], refs: 1, headings: 1 },
  { name: 'GFM table claims paragraph', body: '- [x] a | b\n  --- | ---', checked: [null], refs: 1, tables: 1 },
  { name: 'blank prevents setext reachback', body: '- [x] a\n\n  ===', checked: [true] },
  { name: 'only first x is checkbox', body: '- [x] a [x]', checked: [true], refs: 1 },
  { name: 'definition preamble in first content', body: '- [y]: /y\n  [x] a', checked: [true] },
  { name: 'colon continuation', body: '- [x] term\n  : desc', checked: [true] },
  { name: 'colon after blank', body: '- [x] term\n\n  : desc', checked: [true] },
  { name: 'NBSP is not task whitespace', body: '- [x]\u00a0a', checked: [null], refs: 1 },
  { name: 'ideographic space is not task whitespace', body: '- [x]\u3000a', checked: [null], refs: 1 },
  { name: 'no whitespace after box', body: '- [x]text', checked: [null], refs: 1 },
  { name: 'escaped box', body: '- \\[x] a', checked: [null] },
  { name: 'code span box', body: '- `[x]` a', checked: [null] },
  { name: 'code consumed first content', body: '- ```\n  code\n  ```\n\n  [x] a', checked: [null], refs: 1 },
  { name: 'sublist consumed first content', body: '- - child\n\n  [x] a', checked: [null, null], refs: 1 },
  { name: 'root thematic break closes item', body: '- [x] a\n---', checked: [true] },
  { name: 'nested list marker closes paragraph', body: '- [x] a\n  - b', checked: [true, null] },
  {
    name: 'multiple container pops retain distinct item ownership',
    body: '- [x] outer\n  - [X] inner\n    - [x] deep\n  - sibling\n- next',
    checked: [true, true, true, null, null],
  },
];

const UNSAFE = [
  '- [x] a\n  ===',
  '- [X] a\n  ---',
  '- [x] a\n  b\n  c\n  ===',
  '- [x] a\nb\n  ===',
  '- [x] a\n===\n  ===',
  '-\t[x] a\n    ===',
  '> - [x] a\n>   ===',
  '- parent\n  - [x] a\n    ===',
  '- [x] a | b\n  --- | ---',
  'para\n2. [x] b',
  '> para\n> 2. [x] b',
  '- a\n  2. [x] b',
  'para\n    - [x] b',
  '- item [x] a',
  '- first\n\n  [x] a',
  '- # first\n\n  [x] a',
  '- [x]',
  '- [x] \t',
  '- [x]text',
  '- [x]\u00a0a',
  '- [x]\u3000a',
  '- [x] task then [x]',
] as const;

describe('保守正确性 — 当前实现必须通过', () => {
  test.each(SYNTAX_CASES)(
    'independent remark-gfm oracle: $name',
    ({ body, checked, refs = 0, headings = 0, tables = 0 }) => {
      const source = body + closeAndContinue + lateDefinition;
      const expected = { checked, headings, tables, xRefs: refs };
      expect(facts(syntaxGfm.parse(source))).toEqual(expected);
      expect(facts(full(source, options()).mdast)).toEqual(expected);
      // Extension profile must retain these observed semantics too, including
      // both colon cases; no scanner prediction is used as an oracle.
      expect(facts(full(source, options(true)).mdast)).toEqual(expected);
      for (const { defList } of PROFILES) stream(snapshots(source, 'character'), options(defList));
    }
  );

  test.each(UNSAFE)('ordinary reference cannot be released as a task: %j', (body) => {
    for (const { defList } of PROFILES) {
      const opts = options(defList);
      const beforeDef = body + closeAndContinue;
      const source = beforeDef + lateDefinition;
      const final = syntaxGfm.parse(source);
      expect(facts(final).xRefs).toBeGreaterThan(0);
      const ref = descendants(final).find((node) => node.type === 'linkReference' && node.identifier === 'x')!;
      const offset = ref.position!.start.offset!;
      expect(computeFreezeBoundary(beforeDef, profileFor(opts)).boundary).toBeLessThanOrEqual(offset);
      stream(snapshots(source, 'character'), opts);
    }
  });

  test.each(ENDINGS)('ordinary continuation must keep waiting before future setext (%s)', (_name, ending) => {
    const prefix = withEnding('- [x] a\n  b\n  c\n', ending);
    const future = withEnding('  ===\n\noutside\n\n[x]: /late\n\n', ending);
    const opts = options();
    expect(facts(syntaxGfm.parse(prefix)).checked).toEqual([true]);
    expect(facts(syntaxGfm.parse(prefix + future))).toMatchObject({ checked: [null], headings: 1, xRefs: 1 });
    expect(computeFreezeBoundary(prefix, profileFor(opts)).boundary).toBe(0);
    stream([...snapshots(prefix, 'character'), ...snapshots(future, 'character').map((tail) => prefix + tail)], opts);
  });

  test.each([0, 1, 2, 3, 4, 5])('setext indentation is relative to item content: %i columns', (indent) => {
    const body = '- [x] a\n' + ' '.repeat(2 + indent) + '===';
    const source = body + closeAndContinue + lateDefinition;
    const isHeading = indent < 4;
    expect(facts(syntaxGfm.parse(source))).toEqual({
      checked: [isHeading ? null : true],
      headings: isHeading ? 1 : 0,
      tables: 0,
      xRefs: isHeading ? 1 : 0,
    });
    for (const { defList } of PROFILES) {
      if (isHeading)
        expect(computeFreezeBoundary(body + closeAndContinue, profileFor(options(defList))).boundary).toBe(0);
      stream(snapshots(source, 'character'), options(defList));
    }
  });

  test.each(ENDINGS)('unconfirmed terminators and table delimiters cannot certify a checkbox (%s)', (_name, ending) => {
    for (const { defList } of PROFILES) {
      const opts = options(defList);
      for (const suffix of ['', ' ', '\t', '\n', '\n  b', '\n  b\n', '\n  ===', '\n  ---', '\n\r']) {
        const pending = withEnding('- [x] a' + suffix, ending);
        expect(computeFreezeBoundary(pending, profileFor(opts)).boundary, JSON.stringify(pending)).toBe(0);
      }
      const source = withEnding('- [x] a | b\n  --- | ---' + closeAndContinue + lateDefinition, ending);
      expect(facts(syntaxGfm.parse(source))).toMatchObject({ checked: [null], tables: 1, xRefs: 1 });
      stream(snapshots(source, 'character'), opts);
    }
  });

  test.each(['inline [X]', '[label][X]', '[x][]', '![X]', '![alt][x]', '![x][]'])(
    'same-label ordinary reference survives alongside a checked box: %s',
    (reference) => {
      const beforeDef = '- [x] task\n\noutside\n\n' + reference + closeAndContinue;
      const source = beforeDef + lateDefinition;
      const refs = descendants(syntaxGfm.parse(source)).filter(
        (node) =>
          (node.type === 'linkReference' || node.type === 'imageReference') && node.identifier.toLowerCase() === 'x'
      );
      expect(refs).toHaveLength(1);
      const offset = refs[0]!.position!.start.offset!;
      for (const { defList } of PROFILES) {
        const opts = options(defList);
        expect(computeFreezeBoundary(beforeDef, profileFor(opts)).boundary).toBeLessThanOrEqual(offset);
        stream(snapshots(source, 'character'), opts);
      }
    }
  );

  test.each(['term\n: - [x] a', 'term\n\n: - [x] a', '- [x] term\n  : desc', '- [x] term\n\n  : desc'])(
    'definition-list backclaim window stays equivalent at every split: %j',
    (body) => {
      for (const { defList } of PROFILES) {
        for (const [, ending] of ENDINGS) {
          stream(
            snapshots(withEnding(body + closeAndContinue + lateDefinition, ending), 'character'),
            options(defList)
          );
        }
      }
    }
  );

  test.each(ENDINGS)(
    'a settled definition may resolve taint before a later setext conversion (%s)',
    (_name, ending) => {
      const source = withEnding('[x]: /first\n\n- [x] a\n  b\n  ===' + closeAndContinue, ending);
      expect(facts(syntaxGfm.parse(source))).toMatchObject({ checked: [null], headings: 1, xRefs: 1 });
      for (const { defList } of PROFILES) stream(snapshots(source, 'character'), options(defList));
    }
  );

  test.each(['omitted', false] as const)(
    'CommonMark with capability=%s retains taint and resolves late definitions',
    (flag) => {
      const opts = options(false, flag, true);
      expect(opts.gfmTaskListItems).toBe(flag === 'omitted' ? undefined : false);
      const beforeDef = '- [x] a' + closeAndContinue;
      const source = beforeDef + lateDefinition;
      expect(facts(syntaxCommonMark.parse(source))).toMatchObject({ checked: [null], xRefs: 1 });
      expect(facts(full(source, opts).mdast)).toMatchObject({ checked: [null], xRefs: 1 });
      expect(computeFreezeBoundary(beforeDef, profileFor(opts)).boundary).toBe(0);
      stream(snapshots(source, 'character'), opts);
    }
  );

  test.each(ENDINGS)('unchecked / masked boxes preserve baseline behavior (%s)', (_name, ending) => {
    for (const body of ['- [ ] a', '- `[x]` a', '- \\[x] a']) {
      const source = withEnding(body + closeAndContinue, ending);
      const opts = options();
      const result = stream(snapshots(source, 'character'), opts);
      const off = computeFreezeBoundary(source, profileFor(options(false, false))).boundary;
      expect(result.at(-1)!.nextState.stableBoundary).toBe(off);
    }
  });

  test.each(['[^n]:\n    - [x] a', '```md\n- [x] a\n```', '$$\n- [x] a\n$$', '<pre>\n- [x] a\n</pre>'])(
    'unsupported/opaque container keeps full-parse equivalence: %j',
    (body) => {
      stream(snapshots(body + closeAndContinue + lateDefinition, 'character'), options(true));
    }
  );

  test('definition settlement still waits for a confirmed blank, including malformed and duplicate definitions', () => {
    const opts = options();
    const initial = 'inline [x]' + closeAndContinue + '\n';
    for (const def of ['[x]: /first', '[x]: /first\n', '[x]: /first\n\n']) {
      const source = initial + def;
      const boundary = computeFreezeBoundary(source, profileFor(opts)).boundary;
      if (def.endsWith('\n\n')) expect(boundary).toBeGreaterThan(initial.indexOf('[x]'));
      else expect(boundary).toBeLessThanOrEqual(initial.indexOf('[x]'));
    }
    for (const invalid of ['[x]:', '[x]: /bad(unclosed', '[x]: /u "open']) {
      const source = initial + invalid + '\n\n';
      expect(computeFreezeBoundary(source, profileFor(opts)).boundary).toBeLessThanOrEqual(initial.indexOf('[x]'));
      stream(snapshots(source + '[x]: /real\n\n', 'character'), opts);
    }
    const duplicate = initial + '[x]: /first\n\n[x]: /second\n\n';
    const final = stream(snapshots(duplicate, 'character'), opts).at(-1)!;
    const hrefs: unknown[] = [];
    const visit = (node: AdvanceResult['hast']['children'][number]): void => {
      if (node.type === 'element') {
        if (node.tagName === 'a') hrefs.push(node.properties.href);
        node.children.forEach(visit);
      }
    };
    final.hast.children.forEach(visit);
    expect(hrefs).toContain('/first');
    expect(hrefs).not.toContain('/second');
  });

  test('referenceTaint=false is unaffected by the new task capability', () => {
    const source = '- [x] a' + closeAndContinue;
    const profile: TaskProfile = { defListEnabled: false, referenceTaint: false, gfmTaskListItems: true };
    const off: TaskProfile = { ...profile, gfmTaskListItems: false };
    expect(computeFreezeBoundary(source, profile).boundary).toBe(computeFreezeBoundary(source, off).boundary);
  });
});

// These are inside the accepted first-version root/quote/bullet/ordered subset.
// Definition preambles, pipes/extension ambiguity and unsupported containers
// are deliberately NOT required to gain performance in the first version.
const BENEFITS = [
  ['bullet dash', '- [x] done'],
  ['uppercase', '- [X] done'],
  ['bullet star', '* [x] done'],
  ['bullet plus', '+ [x] done'],
  ['ordered dot', '1. [x] done'],
  ['ordered paren', '1) [x] done'],
  ['ordered siblings', '1. [x] one\n2. [X] two'],
  ['wide ordered marker at block start', '12. [x] done'],
  ['nested bullet', '- parent\n  - [x] done'],
  ['nested ordered', '- parent\n  1. [x] done'],
  ['quoted task', '> - [x] done'],
  ['nested quote', '> > - [X] done'],
  ['quoted nested item', '> - parent\n>   - [x] done'],
  ['confirmed normal continuation', '- [x] first\n  second'],
  ['confirmed lazy continuation', '- [x] first\nsecond'],
  ['tab after marker', '-\t[x] done'],
  ['tab after checkbox', '- [x]\tdone'],
  ['same-paragraph next-line content', '- [x]\n  done'],
] as const;

describe('收益与能力开关 — 实现后才通过（当前预期失败）', () => {
  for (const { name: grammar, defList } of PROFILES) {
    for (const [endingName, ending] of ENDINGS) {
      test.each(BENEFITS)(
        `releases only after irreversible paragraph termination [${grammar}, ${endingName}]: %s`,
        (_name, body) => {
          const opts = options(defList);
          const source = withEnding(body + closeAndContinue, ending);
          const floor = withEnding(body + '\n\noutside paragraph\n\n', ending).length;
          expect(facts(syntaxGfm.parse(source)).checked).toContain(true);
          for (const schedule of ['character', 'line'] as const) {
            const frames = stream(snapshots(source, schedule), opts);
            expect(
              frames.at(-1)!.nextState.stableBoundary,
              `${schedule}: confirmed task must not pin later paragraphs`
            ).toBeGreaterThanOrEqual(floor);
            expect(
              frames.some((frame) => frame.usedIncremental && frame.boundary >= floor),
              `${schedule}: must really splice beyond the task`
            ).toBe(true);
          }
        }
      );
    }
  }

  test('release is position-specific: an ordinary same-label reference still blocks', () => {
    const opts = options();
    const prefix = '- [x] done\n\noutside\n\n';
    const source = prefix + 'ordinary [X]\n\nmore\n\nlast\n';
    const result = stream(snapshots(source, 'character'), opts).at(-1)!;
    expect(result.nextState.stableBoundary).toBeGreaterThanOrEqual(prefix.length);
    expect(result.nextState.stableBoundary).toBeLessThanOrEqual(source.indexOf('[X]'));
    const resolved = stream(snapshots(source + lateDefinition, 'character'), opts).at(-1)!;
    expect(facts(resolved.mdast)).toMatchObject({ checked: [true], xRefs: 1 });
  });

  test('capability participates in checkpoint profile invalidation (on/off/on)', () => {
    const source = '- [x] done' + closeAndContinue;
    const on = profileFor(options());
    const off: TaskProfile = { ...on, gfmTaskListItems: false };
    const first = computeFreezeBoundary(source, on);
    expect(first.boundary).toBeGreaterThan(source.indexOf('outside'));
    const disabled = computeFreezeBoundary(source, off, first.checkpoint);
    expect(disabled.boundary).toBe(computeFreezeBoundary(source, off).boundary);
    expect(disabled.boundary).toBe(0);
    const enabled = computeFreezeBoundary(source, on, disabled.checkpoint);
    expect(enabled.boundary).toBe(computeFreezeBoundary(source, on).boundary);
    expect(enabled.boundary).toBeGreaterThan(source.indexOf('outside'));
  });

  test('capability invalidates advance even when content and caller depsKey are unchanged', () => {
    const source = '- [x] done' + closeAndContinue;
    const on = options();
    const first = advanceIncrementalParse(null, source, on);
    const off: TaskOptions = { ...on, gfmTaskListItems: false };
    const disabled = advanceIncrementalParse(first.nextState, source, off);
    expect(disabled.usedIncremental).toBe(false);
    expect(disabled.nextState.stableBoundary).toBe(0);
    expect(disabled.mdast).toStrictEqual(full(source, off).mdast);
    const enabled = advanceIncrementalParse(disabled.nextState, source, on);
    expect(enabled.usedIncremental).toBe(false);
    expect(enabled.nextState.stableBoundary).toBeGreaterThan(source.indexOf('outside'));
    expect(enabled.hast).toStrictEqual(full(source, on).hast);
  });

  test('non-append rewrite resets the task proof before a plain reference and delayed setext', () => {
    const opts = options();
    const frames = [
      '- [x] done' + closeAndContinue,
      'ordinary [x]' + closeAndContinue,
      '- [x] a\n  b\n',
      '- [x] a\n  b\n  ===\n\n',
      '- [x] a\n  b\n  ===\n\n[x]: /late\n\n',
    ];
    let state: IncrementalParseState | null = null;
    for (const [index, source] of frames.entries()) {
      const result = advanceIncrementalParse(state, source, opts);
      state = result.nextState;
      expect({ mdast: result.mdast, hast: result.hast }).toStrictEqual(full(source, opts));
      expect(state.stableBoundary).toBe(computeFreezeBoundary(source, profileFor(opts)).boundary);
      if (index === 0) expect(state.stableBoundary).toBeGreaterThan(source.indexOf('outside'));
      if (index === 1) expect(state.stableBoundary).toBeLessThanOrEqual(source.indexOf('[x]'));
      if (index === 2 || index === 3) expect(state.stableBoundary).toBe(0);
    }
  });
});

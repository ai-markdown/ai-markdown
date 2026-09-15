/**
 * The three states of the `$$` flow-math capability, and the safety
 * oracle for the undeclared one.
 *
 * `mathFlow: true` declares remark-math: a `$$` region is verbatim math.
 * `mathFlow: false` declares its absence: `$$` lines are paragraph text.
 * Omitted means unknown, and the scanner then takes the union of both
 * grammars: the region keeps its math blocker (no candidate inside it or
 * on its closer line) while every line inside is still scanned as text
 * for references, html, fences and definitions. See `MathHold` in
 * freezeScanState.ts for the merge rule at the closer.
 *
 * The first two tests are the independent review's reproduction and
 * profile matrix (2026-09-15, ab0042a final confirmation, section 3): a
 * remark-gfm caller without remark-math and without the declaration had
 * `$$\n[x]\n$$\n\n` frozen at 11 while the full parse later turned `[x]`
 * into a link reference. Red on ab0042a, green with the union.
 *
 * The oracle tests then prove the union on a generated corpus:
 *   - boundary(undeclared) <= min(boundary(true), boundary(false)) on
 *     every prefix cut — a smaller boundary is always acceptable, a
 *     larger one never;
 *   - the stream arbiter holds for the undeclared profile under BOTH real
 *     grammars, a chain with remark-math and the same chain without it,
 *     so one undeclared state is correct whichever the caller has.
 */
import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import isEqual from 'lodash-es/isEqual';

import { parseStage, transformStage } from '../markdown';
import { advanceIncrementalParse, type AdvanceOptions } from './advanceIncrementalParse';
import { computeFreezeBoundary, type FreezeBoundaryOptions, type FreezeScanCheckpoint } from './computeFreezeBoundary';
import { benignDocArb, hazardDocArb, scheduleSnapshots } from './fuzzGenerators';
import { REALISTIC_DOCS, pinnedFuzzDocs } from './pinnedCorpus';
import { assertStreamEquivalenceFor, testEnv } from './spliceArbiterHarness';
import { CATALOG, buildAdvanceOptions } from './testPluginCatalog';

type MathState = undefined | false | true;

/** remark-gfm alone: real task-list items, no `$$` flow math. */
function gfmOnly(mathFlow: MathState, gfmTaskListItems = true): AdvanceOptions {
  return {
    remarkPlugins: [remarkGfm],
    rehypePlugins: [],
    remarkRehypeOptions: {},
    depsKey: ['gfm-only'],
    defListEnabled: false,
    gfmTaskListItems,
    ...(mathFlow === undefined ? {} : { mathFlow }),
  };
}

/** The engine's own chain (remark-gfm and remark-math) for a catalog cell. */
function withMath(configIndex: number, mathFlow: MathState): AdvanceOptions {
  return {
    ...buildAdvanceOptions(CATALOG[configIndex % CATALOG.length]),
    gfmTaskListItems: true,
    ...(mathFlow === undefined ? {} : { mathFlow }),
  };
}

/** The same chain with remark-math removed: `$$` is paragraph text. */
function withoutMath(configIndex: number, mathFlow: MathState): AdvanceOptions {
  const base = withMath(configIndex, mathFlow);
  const remarkPlugins = (base.remarkPlugins as unknown[]).filter(
    (plugin) => plugin !== remarkMath && !(Array.isArray(plugin) && plugin[0] === remarkMath)
  );
  expect(remarkPlugins.length).toBe((base.remarkPlugins as unknown[]).length - 1);
  return {
    ...base,
    remarkPlugins: remarkPlugins as AdvanceOptions['remarkPlugins'],
    depsKey: ['no-math', ...base.depsKey],
  };
}

function full(source: string, opts: AdvanceOptions) {
  const parsed = parseStage({
    children: source,
    remarkPlugins: opts.remarkPlugins,
    rehypePlugins: opts.rehypePlugins,
    remarkRehypeOptions: opts.remarkRehypeOptions,
  });
  return { mdast: parsed.mdast, hast: transformStage(parsed) };
}

const REVIEW_PREFIXES = [
  '- [x] a\n  $$\n  $$\n  ===\n\np\n\n',
  '$$\n[x]\n$$\n\np\n\n',
  '$$\n- [x] a\n  ===\n$$\n\np\n\n',
  '$$\n<!--\n$$\n\np\n\n',
  '$$\n```\n$$\n\np\n\n',
  '- [x] a\n\np\n\n',
];

/** Shapes the union rule has to get right beyond the review's: a region
 *  closing an element opened before it, a table part after a region-opened
 *  table, a type-7 line right after the closer, a definition inside the
 *  region, references in the opener's meta, a fence closed inside the
 *  region, and nested `$$` lines. */
const UNION_PREFIXES = [
  '<div>\n\n$$\n</div>\n$$\n\n[x]\n\np\n\n',
  '$$\n<table>\n$$\n\n<td>x</td>\n\n[x]\n\np\n\n',
  '$$\n$$\n<x-y>\n[x]\n\np\n\n',
  '[x]\n\n$$\n[x]: /v\n$$\n\np\n\n',
  '$$ [x]\n$$\n\np\n\n',
  '$$\n```\n[x]\n```\n$$\n\np\n\n',
  '$$\n$$ x\n[x]\n$$\n\np\n\n',
  '- [x] a\n$$\n\n$$\n\np\n\n',
  '- [x]\n$$\n\n$$\n\np\n\n',
  '$$\n\n- [x] a\n\n$$\n\np\n\n',
  '[^a]: x\n$$\n\nfoo\n$$\n\n    more\n\np\n\n',
  '$$\nsee <div\n$$\n\np\n\n',
];

const TAIL = '[x]: /u\n\n';

describe('review reproduction (ab0042a final confirmation, section 3)', () => {
  test('undeclared math masks an ordinary reference: two-frame full/splice mismatch', () => {
    const prefix = '$$\n[x]\n$$\n\n';
    const content = prefix + TAIL;
    const rows: string[] = [];
    for (const builtin of [false, true]) {
      for (const mathFlow of [undefined, false, true] as MathState[]) {
        if (!builtin && mathFlow === true) continue; // do not declare a grammar the chain does not have
        for (const task of [false, true]) {
          const options = builtin ? { ...withMath(0, mathFlow), gfmTaskListItems: task } : gfmOnly(mathFlow, task);
          const first = advanceIncrementalParse(null, prefix, options);
          const actual = advanceIncrementalParse(first.nextState, content, options);
          const expected = full(content, options);
          if (!isEqual({ mdast: actual.mdast, hast: actual.hast }, expected)) {
            rows.push(
              `builtin=${builtin} mathFlow=${mathFlow ?? 'omitted'} task=${task} firstBoundary=${first.nextState.stableBoundary} boundary=${actual.boundary} incremental=${actual.usedIncremental}`
            );
          }
        }
      }
    }
    expect(rows).toEqual([]);
    // How: the reference inside the region is collected, so nothing past
    // it freezes until a definition settles it — under either grammar.
    const base: FreezeBoundaryOptions = { defListEnabled: false, gfmTaskListItems: true };
    expect(computeFreezeBoundary(prefix, base).boundary).toBe(0);
    expect(computeFreezeBoundary(prefix, { ...base, mathFlow: false }).boundary).toBe(0);
    expect(computeFreezeBoundary(prefix, { ...base, mathFlow: true }).boundary).toBe(prefix.length);
  });

  test('profile matrix: omitted and false, LF/CRLF/CR, with and without a profile flip between frames', () => {
    const failures: string[] = [];
    const run = (prefix: string, mathFlow: MathState, options: AdvanceOptions, flip: boolean, label: string) => {
      const first = advanceIncrementalParse(null, prefix, options);
      const secondOptions = flip ? { ...options, mathFlow: mathFlow === false ? undefined : false } : options;
      if (flip && mathFlow === false) delete (secondOptions as { mathFlow?: boolean }).mathFlow;
      const content = prefix + TAIL;
      const result = advanceIncrementalParse(first.nextState, content, secondOptions);
      const expected = full(content, secondOptions);
      if (!isEqual({ mdast: result.mdast, hast: result.hast }, expected)) {
        failures.push(
          `${label} prefix=${JSON.stringify(prefix)} mathFlow=${mathFlow ?? 'omitted'} flip=${flip} firstBoundary=${first.nextState.stableBoundary} boundary=${result.boundary} incremental=${result.usedIncremental}`
        );
      }
      // A flip between omitted and false is a profile change: the retained
      // trees must not be spliced against.
      if (flip && first.nextState.stableBoundary > 0) {
        if (result.usedIncremental) failures.push(`${label} flip reused state prefix=${JSON.stringify(prefix)}`);
      }
    };
    for (const prefix of [...REVIEW_PREFIXES, ...UNION_PREFIXES]) {
      for (const ending of ['\n', '\r\n', '\r']) {
        const p = prefix.replaceAll('\n', ending);
        for (const mathFlow of [undefined, false] as MathState[]) {
          for (const flip of [false, true]) {
            run(p, mathFlow, gfmOnly(mathFlow), flip, 'gfm-only');
            run(p, mathFlow, withoutMath(0, mathFlow), flip, 'chain-without-math');
          }
        }
        // A chain WITH remark-math: undeclared must be exact too (a false
        // declaration against it is a caller error and is not driven).
        run(p, undefined, withMath(0, undefined), false, 'chain-with-math');
      }
      run(prefix, true, withMath(0, true), false, 'chain-with-math-declared');
    }
    expect(failures).toEqual([]);
  });
});

// ── the oracle ─────────────────────────────────────────────────────────

const ORACLE_RUNS = Number(testEnv('FUZZ_RUNS') ?? 300);
const ORACLE_SEED = Number(testEnv('FUZZ_SEED') ?? 20260915);
const TIMEOUT_MS = Math.max(300_000, ORACLE_RUNS * 600);

interface OracleDoc {
  id: string;
  doc: string;
  configIndex: number;
}

function oracleCorpus(): OracleDoc[] {
  const docs: OracleDoc[] = [];
  REALISTIC_DOCS.forEach((d) => docs.push({ id: d.id, doc: d.doc, configIndex: d.configIndex }));
  [...REVIEW_PREFIXES, ...UNION_PREFIXES].forEach((prefix, i) => {
    for (const ending of ['\n', '\r\n', '\r']) {
      docs.push({
        id: `shape-${i}-${JSON.stringify(ending)}`,
        doc: (prefix + TAIL).replaceAll('\n', ending),
        configIndex: i,
      });
    }
  });
  pinnedFuzzDocs().forEach((d) => docs.push({ id: d.id, doc: d.doc, configIndex: d.configIndex }));
  fc.sample(benignDocArb, { seed: ORACLE_SEED, numRuns: ORACLE_RUNS }).forEach((d, i) =>
    docs.push({ id: `fresh-benign-${i}`, doc: d.doc, configIndex: d.configIndex })
  );
  fc.sample(hazardDocArb, { seed: ORACLE_SEED + 1, numRuns: ORACLE_RUNS }).forEach((d, i) =>
    docs.push({ id: `fresh-hazard-${i}`, doc: d.doc, configIndex: d.configIndex })
  );
  return docs;
}

describe(`undeclared math is the conservative union (runs=${ORACLE_RUNS} seed=${ORACLE_SEED})`, () => {
  test(
    'boundary(undeclared) <= min(boundary(declared true), boundary(declared false)) on every prefix cut',
    { timeout: TIMEOUT_MS },
    () => {
      const corpus = oracleCorpus();
      let cuts = 0;
      let strictlyLower = 0;
      let equalToBoth = 0;
      const violations: string[] = [];
      for (const { id, doc, configIndex } of corpus) {
        const defListEnabled = CATALOG[configIndex % CATALOG.length].defList;
        const profiles: Array<[string, FreezeBoundaryOptions]> = [
          ['undeclared', { defListEnabled, gfmTaskListItems: true }],
          ['true', { defListEnabled, gfmTaskListItems: true, mathFlow: true }],
          ['false', { defListEnabled, gfmTaskListItems: true, mathFlow: false }],
        ];
        // Each profile resumes its own checkpoint lineage across the cuts.
        // The declared profiles' resume contract is P2's job (spliceFuzz);
        // the undeclared one carries state P2 never drives (`mathHold`,
        // `contentOpenUnknown`), so every fourth cut is also scanned fresh.
        const checkpoints: Array<FreezeScanCheckpoint | null> = [null, null, null];
        let cutIndex = 0;
        for (const cut of scheduleSnapshots(doc, [3, 1, 7, 2, 5, 11])) {
          const boundaries = profiles.map(([, profile], i) => {
            const result = computeFreezeBoundary(cut, profile, checkpoints[i]);
            checkpoints[i] = result.checkpoint;
            return result.boundary;
          });
          const [undeclared, declaredTrue, declaredFalse] = boundaries;
          cutIndex += 1;
          if (cutIndex % 4 === 0) {
            const fresh = computeFreezeBoundary(cut, profiles[0][1]).boundary;
            if (fresh !== undeclared) {
              violations.push(
                `${id} len=${cut.length} resumed=${undeclared} fresh=${fresh} doc=${JSON.stringify(cut)}`
              );
            }
          }
          const bound = Math.min(declaredTrue, declaredFalse);
          cuts += 1;
          if (undeclared > bound) {
            violations.push(
              `${id} len=${cut.length} undeclared=${undeclared} true=${declaredTrue} false=${declaredFalse} doc=${JSON.stringify(cut)}`
            );
          } else if (undeclared < bound) strictlyLower += 1;
          else if (undeclared === declaredTrue && undeclared === declaredFalse) equalToBoth += 1;
        }
      }
      expect(violations.slice(0, 10)).toEqual([]);
      expect(cuts).toBeGreaterThan(1000);
      // Anti-vacuity: the union both costs something on math-shaped input and
      // costs nothing where the two grammars agree.
      expect(strictlyLower).toBeGreaterThan(0);
      expect(equalToBoth).toBeGreaterThan(cuts / 2);
    }
  );

  test(
    'stream arbiter: the undeclared profile is exact under a chain with remark-math and the same chain without it',
    { timeout: TIMEOUT_MS },
    () => {
      const streamRuns = Math.max(20, Math.floor(ORACLE_RUNS / 5));
      const docs: OracleDoc[] = [
        ...REALISTIC_DOCS.map((d) => ({ id: d.id, doc: d.doc, configIndex: d.configIndex })),
        ...[...REVIEW_PREFIXES, ...UNION_PREFIXES].map((prefix, i) => ({
          id: `shape-${i}`,
          doc: prefix + TAIL,
          configIndex: i,
        })),
        ...fc.sample(benignDocArb, { seed: ORACLE_SEED + 2, numRuns: streamRuns }).map((d, i) => ({
          id: `benign-${i}`,
          doc: d.doc,
          configIndex: d.configIndex,
        })),
        ...fc.sample(hazardDocArb, { seed: ORACLE_SEED + 3, numRuns: streamRuns }).map((d, i) => ({
          id: `hazard-${i}`,
          doc: d.doc,
          configIndex: d.configIndex,
        })),
      ];
      let frames = 0;
      let incremental = 0;
      for (const { id, doc, configIndex } of docs) {
        const snapshots = scheduleSnapshots(doc, [5, 13, 1, 8, 3, 21]);
        const cells: Array<[string, AdvanceOptions]> = [
          ['with-math', withMath(configIndex, undefined)],
          ['without-math', withoutMath(configIndex, undefined)],
          ['gfm-only', gfmOnly(undefined)],
        ];
        for (const [label, options] of cells) {
          const stats = assertStreamEquivalenceFor(id, snapshots, options, label, { minIncrementalFrames: 0 });
          frames += stats.frames;
          incremental += stats.incrementalFrames;
        }
      }
      expect(frames).toBeGreaterThan(0);
      // The undeclared profile still splices on the math-free majority.
      expect(incremental / frames).toBeGreaterThan(0.1);
    }
  );
});

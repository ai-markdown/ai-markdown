/**
 * Math flow as a DECLARED capability for task-list certification — the
 * 2026-09-15 review of bf9dc64 (N-TASK-1).
 *
 * `computeFreezeBoundary` reads a `$$` line as a fence opener by default,
 * which only over-blocks candidates. The task-list tracker took the same
 * default as proof that a `$$` line had closed an item's paragraph and
 * certified the box. A caller with remark-gfm but WITHOUT remark-math,
 * where `$$` is paragraph text, then had `- [x] a` released while a later
 * `===` still turned the paragraph into a heading whose `[x]` a late
 * definition retargets: the full parse has a linkReference, the spliced
 * tree kept the literal. The declaration (`mathFlow: true`) now travels
 * through `AdvanceOptions` and core's frame options, and the tracker
 * certifies on a `$$` opener only under it; undeclared, it forgets the
 * item at that line, which over-blocks in both grammars. Since the
 * follow-up review the undeclared scanner also scans the region as text
 * (the `MathHold` union — mathCapabilityOracle.test.ts), so omitted and
 * `false` are two profiles and two G0 states.
 *
 * The first test is the review's reproduction, kept as it was written:
 * red on bf9dc64, green once the declaration is wired through.
 */
import { describe, expect, test } from 'vitest';
import remarkGfm from 'remark-gfm';
import type { Nodes, Root as MdastRoot } from 'mdast';

import { parseStage, transformStage } from '../markdown';
import { advanceIncrementalParse, type AdvanceOptions, type IncrementalParseState } from './advanceIncrementalParse';
import {
  computeFreezeBoundary,
  type FreezeBoundaryOptions,
  type FreezeScanCheckpointInternal,
} from './computeFreezeBoundary';
import { ADAPTER_GRAMMAR, buildAdvanceOptions, CATALOG } from './testPluginCatalog';

const prefix = '- [x] a\n  $$\n  $$\n  ===\n\np\n\n';
const tail = '[x]: /u\n\n';
type Grammar = Pick<AdvanceOptions, 'gfmTaskListItems' | 'mathFlow'>;

/** remark-gfm alone: real task-list items, no `$$` flow math. */
function gfmOnly(grammar: Grammar): AdvanceOptions {
  return {
    remarkPlugins: [remarkGfm],
    rehypePlugins: [],
    remarkRehypeOptions: {},
    depsKey: [],
    defListEnabled: false,
    ...grammar,
  };
}

/** The engine's own chain (remark-gfm and remark-math) under the given declarations. */
function builtIn(grammar: Grammar): AdvanceOptions {
  return { ...buildAdvanceOptions(CATALOG[0]), ...grammar };
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
    xRefs: nodes.filter((node) => node.type === 'linkReference' && node.identifier.toLowerCase() === 'x').length,
  };
}

function twoFrames(opts: AdvanceOptions) {
  const first = advanceIncrementalParse(null, prefix, opts);
  const second = advanceIncrementalParse(first.nextState, prefix + tail, opts);
  return { first, second, expected: full(prefix + tail, opts) };
}

function scan(source: string, profile: FreezeBoundaryOptions): FreezeScanCheckpointInternal {
  return computeFreezeBoundary(source, profile).checkpoint as FreezeScanCheckpointInternal;
}

const xTaint = (cp: FreezeScanCheckpointInternal): number =>
  cp.unresolvedRefs.filter((ref) => ref.label === 'X').length;

describe('math flow is a declared capability for task-list certification', () => {
  test('review reproduction: remark-gfm without remark-math must not keep a literal box that `===` turned into a reference', () => {
    const { first, second, expected } = twoFrames(gfmOnly({ gfmTaskListItems: true }));
    // Under this grammar the `$$` lines are paragraph text and `===` makes
    // the whole paragraph a heading; the late definition then resolves the box.
    expect(facts(expected.mdast)).toEqual({ checked: [null], headings: 1, xRefs: 1 });
    expect(second.mdast).toStrictEqual(expected.mdast);
    expect(second.hast).toStrictEqual(expected.hast);
    // How: nothing before the box is stable, so the second frame is a full parse.
    expect(first.nextState.stableBoundary).toBe(0);
    expect(second.usedIncremental).toBe(false);
  });

  test('controls: capability off, and the built-in chain with and without the declaration', () => {
    const off = twoFrames(gfmOnly({ gfmTaskListItems: false }));
    expect(off.first.nextState.stableBoundary).toBe(0);
    expect(off.second.mdast).toStrictEqual(off.expected.mdast);
    expect(off.second.hast).toStrictEqual(off.expected.hast);

    // With remark-math the `$$` pair is an empty math block that really
    // closes the paragraph; the box is a task and the splice is exact.
    const declared = twoFrames(builtIn(ADAPTER_GRAMMAR));
    expect(facts(declared.expected.mdast)).toEqual({ checked: [true], headings: 0, xRefs: 0 });
    expect(declared.second.usedIncremental).toBe(true);
    expect(declared.second.boundary).toBe(prefix.length);
    expect(declared.second.mdast).toStrictEqual(declared.expected.mdast);
    expect(declared.second.hast).toStrictEqual(declared.expected.hast);

    // Same chain, declaration left out: correct, at the cost of the splice.
    const undeclared = twoFrames(builtIn({ gfmTaskListItems: true }));
    expect(undeclared.first.nextState.stableBoundary).toBe(0);
    expect(undeclared.second.usedIncremental).toBe(false);
    expect(undeclared.second.mdast).toStrictEqual(undeclared.expected.mdast);
    expect(undeclared.second.hast).toStrictEqual(undeclared.expected.hast);
  });

  test('scanner: a `$$` opener certifies only under an explicit mathFlow: true', () => {
    const source = '- [x] a\n  $$\n';
    const base: FreezeBoundaryOptions = { defListEnabled: false, gfmTaskListItems: true };
    const declared = scan(source, { ...base, mathFlow: true });
    expect(declared.mathDeclared).toBe(true);
    expect(xTaint(declared)).toBe(0);
    expect(declared.task.unknown).toBe(false);
    // Omitted: the scanner holds the region (the union's blocker, not the
    // math member), the tracker forgets the item and the box stays an
    // ordinary reference.
    const undeclared = scan(source, base);
    expect(undeclared.mathFlow).toBe(true);
    expect(undeclared.mathDeclared).toBe(false);
    expect(undeclared.mdBlock.kind).toBe('none');
    expect(undeclared.mathHold).toMatchObject({ len: 2, indent: 2 });
    expect(xTaint(undeclared)).toBe(1);
    expect(undeclared.task.unknown).toBe(true);
    // Fence default off as well: `$$` is a continuation line, the paragraph
    // stays open, the box is still pending and still tainted.
    const off = scan(source, { ...base, mathFlow: false });
    expect(off.mathDeclared).toBe(false);
    expect(off.mdBlock.kind).toBe('none');
    expect(xTaint(off)).toBe(1);
    expect(off.task.unknown).toBe(false);

    expect(computeFreezeBoundary(prefix, { ...base, mathFlow: true }).boundary).toBe(prefix.length);
    expect(computeFreezeBoundary(prefix, base).boundary).toBe(0);
    expect(computeFreezeBoundary(prefix, { ...base, mathFlow: false }).boundary).toBe(0);
  });

  test('the declaration is part of the checkpoint profile (declared/undeclared/declared)', () => {
    const on: FreezeBoundaryOptions = { defListEnabled: false, gfmTaskListItems: true, mathFlow: true };
    const off: FreezeBoundaryOptions = { defListEnabled: false, gfmTaskListItems: true };
    const first = computeFreezeBoundary(prefix, on);
    expect(first.boundary).toBe(prefix.length);
    const undeclared = computeFreezeBoundary(prefix, off, first.checkpoint);
    expect(undeclared.checkpoint).not.toBe(first.checkpoint);
    expect(undeclared.boundary).toBe(computeFreezeBoundary(prefix, off).boundary);
    expect(undeclared.boundary).toBe(0);
    const declared = computeFreezeBoundary(prefix, on, undeclared.checkpoint);
    expect(declared.checkpoint).not.toBe(undeclared.checkpoint);
    expect(declared.boundary).toBe(first.boundary);
    // `false` differs from omitted (no hold at all versus the union), so it
    // is a third profile; neither of the two is a declaration.
    const explicitOff = computeFreezeBoundary(prefix, { ...off, mathFlow: false }, declared.checkpoint);
    expect(explicitOff.checkpoint).not.toBe(declared.checkpoint);
    expect(explicitOff.boundary).toBe(0);
    expect(computeFreezeBoundary(prefix, off, explicitOff.checkpoint).checkpoint).not.toBe(explicitOff.checkpoint);
  });

  test('the declaration invalidates advance even when content and caller depsKey are unchanged', () => {
    const source = '- [x] a\n  $$\n  $$\n\noutside\n\nnext\n\n';
    const on = builtIn(ADAPTER_GRAMMAR);
    const first = advanceIncrementalParse(null, source, on);
    expect(first.nextState.mathFlow).toBe(true);
    expect(first.nextState.stableBoundary).toBeGreaterThan(source.indexOf('outside'));
    const off = builtIn({ gfmTaskListItems: true });
    const undeclared = advanceIncrementalParse(first.nextState, source, off);
    expect(undeclared.usedIncremental).toBe(false);
    expect(undeclared.nextState.mathFlow).toBeUndefined();
    expect(undeclared.nextState.stableBoundary).toBe(0);
    expect(undeclared.mdast).toStrictEqual(full(source, off).mdast);
    const declared = advanceIncrementalParse(undeclared.nextState, source, on);
    expect(declared.usedIncremental).toBe(false);
    expect(declared.nextState.mathFlow).toBe(true);
    expect(declared.nextState.stableBoundary).toBe(first.nextState.stableBoundary);
    expect(declared.hast).toStrictEqual(full(source, on).hast);
    // All three states are distinct at this layer too: `false` and omitted
    // do not reuse each other's state.
    const explicitOff = advanceIncrementalParse(
      declared.nextState,
      source,
      builtIn({ gfmTaskListItems: true, mathFlow: false })
    );
    expect(explicitOff.usedIncremental).toBe(false);
    expect(explicitOff.nextState.mathFlow).toBe(false);
    const omittedAgain = advanceIncrementalParse(explicitOff.nextState, source, off);
    expect(omittedAgain.usedIncremental).toBe(false);
    expect(omittedAgain.nextState).not.toBe(explicitOff.nextState);
    expect(omittedAgain.nextState.mathFlow).toBeUndefined();
    expect(advanceIncrementalParse(omittedAgain.nextState, source, off).nextState).toBe(omittedAgain.nextState);
  });

  test('GFM-only stream: every character split stays full-parse equivalent without the declaration', () => {
    const source = prefix + tail;
    for (const grammar of [{ gfmTaskListItems: true }, { gfmTaskListItems: true, mathFlow: false }]) {
      const opts = gfmOnly(grammar);
      let state: IncrementalParseState | null = null;
      for (let length = 1; length <= source.length; length++) {
        const content = source.slice(0, length);
        const result = advanceIncrementalParse(state, content, opts);
        state = result.nextState;
        const expected = full(content, opts);
        expect(result.mdast, JSON.stringify(content)).toStrictEqual(expected.mdast);
        expect(result.hast, JSON.stringify(content)).toStrictEqual(expected.hast);
      }
    }
  });
});

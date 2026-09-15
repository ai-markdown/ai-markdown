/**
 * Gate-semantics tests for the incremental-parse state machine. Output
 * CORRECTNESS is the splice-equivalence arbiter's job; these tests pin the
 * control flow: which gate fires, what `usedIncremental`/`boundary` report,
 * and what `nextState` records on each path.
 */

import { describe, expect, test, vi } from 'vitest';
import isEqual from 'lodash-es/isEqual';

import { buildPhantomSuffix } from '../remarkInjectPhantomDefs';
import { advanceIncrementalParse, type IncrementalParseState } from './advanceIncrementalParse';
import { scheduleSnapshots } from './fuzzGenerators';
import { assertStreamEquivalence, runFull } from './spliceArbiterHarness';
import { buildAdvanceOptions, buildCrossChunkAdvanceOptions, CATALOG } from './testPluginCatalog';
import type { SplicePrefixCacheInternal } from './spliceParse';

/** Tests read the cache's fields through the intra-package shape. */
const cacheOf = (state: IncrementalParseState): SplicePrefixCacheInternal =>
  state.spliceCache as SplicePrefixCacheInternal;

const BASE = () => buildAdvanceOptions(CATALOG[0]);

const DOC = 'para one.\n\npara two.\n\n';
const GROWN = `${DOC}para three.\n\n`;

function seed(content: string = DOC): IncrementalParseState {
  return advanceIncrementalParse(null, content, BASE()).nextState;
}

describe('advanceIncrementalParse — gates', () => {
  test('no previous state → full path, boundary reported as 0', () => {
    const result = advanceIncrementalParse(null, DOC, BASE());
    expect(result.usedIncremental).toBe(false);
    expect(result.boundary).toBe(0);
    // …but the boundary is still recorded for the NEXT frame.
    expect(result.nextState.stableBoundary).toBeGreaterThan(0);
    expect(result.nextState.content).toBe(DOC);
  });

  test('equal content short-circuits and returns the previous trees by reference', () => {
    const prev = seed();
    const result = advanceIncrementalParse(prev, DOC, BASE());
    expect(result.usedIncremental).toBe(true);
    expect(result.mdast).toBe(prev.mdast);
    expect(result.hast).toBe(prev.hast);
  });

  test('G0: depsKey identity mismatch → full path', () => {
    const prev = seed();
    const options = { ...BASE(), depsKey: ['different'] };
    const result = advanceIncrementalParse(prev, GROWN, options);
    expect(result.usedIncremental).toBe(false);
    expect(result.nextState.depsKey).toEqual(['different']);
  });

  test('G1: non-append rewrite → full path', () => {
    const prev = seed();
    const result = advanceIncrementalParse(prev, DOC.replace('one', 'ONE'), BASE());
    expect(result.usedIncremental).toBe(false);
  });

  test('footnote syntax no longer disengages splicing (v2: injection replay)', () => {
    // The unresolved `[^n]` taints candidates PAST it, but the boundary
    // before it stays valid — the frame splices with the ref in the tail.
    const prev = seed();
    const result = advanceIncrementalParse(prev, `${DOC}claim[^n] here.\n`, BASE());
    expect(result.usedIncremental).toBe(true);
    expect(result.boundary).toBeGreaterThan(0);
    expect(result.boundary).toBeLessThanOrEqual(DOC.length);
  });

  test('G3: zero boundary (single growing block) → full path', () => {
    const prev = advanceIncrementalParse(null, 'one long paragraph', BASE()).nextState;
    const result = advanceIncrementalParse(prev, 'one long paragraph keeps growing', BASE());
    expect(result.usedIncremental).toBe(false);
    expect(prev.stableBoundary).toBe(0);
  });

  test('append with a valid boundary → splice path with boundary > 0', () => {
    const prev = seed();
    const result = advanceIncrementalParse(prev, GROWN, BASE());
    expect(result.usedIncremental).toBe(true);
    expect(result.boundary).toBeGreaterThan(0);
    expect(result.boundary).toBeLessThanOrEqual(prev.content.length);
  });

  test('H1: splice boundary is capped by the PREVIOUS frame boundary', () => {
    // Frame k: unresolved shortcut ref pins prev.stableBoundary to 0.
    const withRef = 'See [spec] here.\n\nfiller.\n\n';
    const prev = seed(withRef);
    expect(prev.stableBoundary).toBe(0);
    // Frame k+1: def arrives and settles — fresh boundary would jump past
    // the (previously literal) ref paragraph, but min() must hold it back.
    const resolved = `${withRef}[spec]: https://example.com\n\ntail.\n\n`;
    const result = advanceIncrementalParse(prev, resolved, BASE());
    expect(result.usedIncremental).toBe(false); // min(fresh, 0) = 0 → full path
    expect(result.nextState.stableBoundary).toBeGreaterThan(0); // recorded for frame k+2
    // Frame k+2 can then splice against the re-parsed (resolved) trees.
    const grown = `${resolved}more prose.\n\n`;
    const next = advanceIncrementalParse(result.nextState, grown, BASE());
    expect(next.usedIncremental).toBe(true);
  });

  test('nextState.stableBoundary is written on both paths from one scan', () => {
    const full = advanceIncrementalParse(null, GROWN, BASE());
    const prev = seed();
    const spliced = advanceIncrementalParse(prev, GROWN, BASE());
    expect(spliced.nextState.stableBoundary).toBe(full.nextState.stableBoundary);
  });

  test('measure hook: scan runs once per new content, zero-scan short-circuits skip it', () => {
    const stages: string[] = [];
    const options = {
      ...BASE(),
      measure: <T>(stage: string, fn: () => T): T => {
        stages.push(stage);
        return fn();
      },
    };
    const prev = advanceIncrementalParse(null, DOC, options).nextState;
    expect(stages).toEqual(['scan', 'parse', 'transform']);
    stages.length = 0;
    advanceIncrementalParse(prev, DOC, options); // equal-content: whole state reused, NO scan
    expect(stages).toEqual([]);
  });

  test('settled footnote content splices with the def frozen into the prefix', () => {
    // Once the def settles (blank line after) and prose confirms the block
    // context, the boundary passes the whole footnote region — the splice
    // must replay the events (arbiter owns output equality; this pins that
    // the incremental path actually engages past a footnote).
    const withFn = 'a claim[^n] here.\n\n[^n]: note body\n\nplain paragraph.\n\n';
    const s1 = advanceIncrementalParse(null, withFn, BASE()).nextState;
    const r2 = advanceIncrementalParse(s1, `${withFn}more prose.\n`, BASE());
    expect(r2.usedIncremental).toBe(true);
    expect(r2.boundary).toBeGreaterThan(withFn.indexOf('[^n]:'));
  });

  test('fence-guarded [^ does NOT disengage splicing (Alt2 fix)', () => {
    const code = '```js\nconst re = /[^0-9]/;\n```\n\npara one.\n\n';
    const prev = advanceIncrementalParse(null, code, BASE()).nextState;
    const r = advanceIncrementalParse(prev, `${code}para two.\n`, BASE());
    expect(r.usedIncremental).toBe(true);
    expect(r.boundary).toBeGreaterThan(0);
  });
});

describe('splice cache — retained per lineage, dropped on the full path, checked before use', () => {
  const full = (content: string) => runFull(content, CATALOG[0]);
  const expectFullEqual = (content: string, result: { mdast: unknown; hast: unknown }) => {
    const expected = full(content);
    expect(isEqual(result.mdast, expected.mdast), 'mdast').toBe(true);
    expect(isEqual(result.hast, expected.hast), 'hast').toBe(true);
  };

  test('a full-path frame carries no cache; a splice frame records one for its own roots', () => {
    const s1 = seed();
    expect(s1.spliceCache).toBeNull();
    const r2 = advanceIncrementalParse(s1, GROWN, BASE());
    expect(r2.usedIncremental).toBe(true);
    const cache = cacheOf(r2.nextState);
    expect(cache.roots.mdast).toBe(r2.mdast);
    expect(cache.roots.hast).toBe(r2.hast);
    expect(cache.boundary).toBe(r2.boundary);
    expect(cache.mdastCount).toBe(r2.mdast.children.filter((c) => c.position!.start.offset! < r2.boundary).length);
    // The next splice resumes from it and its cache moves with the boundary.
    const r3 = advanceIncrementalParse(r2.nextState, `${GROWN}para four.\n\n`, BASE());
    expect(r3.usedIncremental).toBe(true);
    expect(cacheOf(r3.nextState).boundary).toBeGreaterThanOrEqual(cache.boundary);
    expectFullEqual(`${GROWN}para four.\n\n`, r3);
  });

  test('a non-append rewrite drops the cache, and the lineage rebuilds it', () => {
    const r2 = advanceIncrementalParse(seed(), GROWN, BASE());
    expect(r2.nextState.spliceCache).not.toBeNull();
    const rewritten = GROWN.replace('one', 'ONE');
    const r3 = advanceIncrementalParse(r2.nextState, rewritten, BASE());
    expect(r3.usedIncremental).toBe(false);
    expect(r3.nextState.spliceCache).toBeNull();
    const r4 = advanceIncrementalParse(r3.nextState, `${rewritten}para four.\n\n`, BASE());
    expect(r4.usedIncremental).toBe(true);
    expect(r4.nextState.spliceCache).not.toBeNull();
    expectFullEqual(`${rewritten}para four.\n\n`, r4);
  });

  test('a cache whose roots are not the previous trees is ignored, not trusted', () => {
    const r2 = advanceIncrementalParse(seed(), GROWN, BASE());
    // Same fields, foreign roots — as if a consumer had swapped the trees.
    const foreign: IncrementalParseState = {
      ...r2.nextState,
      spliceCache: {
        ...cacheOf(r2.nextState),
        roots: { mdast: seed().mdast, hast: seed().hast },
      } as SplicePrefixCacheInternal,
    };
    const r3 = advanceIncrementalParse(foreign, `${GROWN}para four.\n\n`, BASE());
    expect(r3.usedIncremental).toBe(true);
    expectFullEqual(`${GROWN}para four.\n\n`, r3);
  });

  test('a cache built past the current boundary is ignored, not trusted', () => {
    const r2 = advanceIncrementalParse(seed(), GROWN, BASE());
    const ahead: IncrementalParseState = {
      ...r2.nextState,
      spliceCache: {
        ...cacheOf(r2.nextState),
        boundary: cacheOf(r2.nextState).boundary + 1,
      } as SplicePrefixCacheInternal,
    };
    const r3 = advanceIncrementalParse(ahead, `${GROWN}para four.\n\n`, BASE());
    expect(r3.usedIncremental).toBe(true);
    expectFullEqual(`${GROWN}para four.\n\n`, r3);
  });

  test('the equal-content short-circuit keeps the cache with the state it belongs to', () => {
    const r2 = advanceIncrementalParse(seed(), GROWN, BASE());
    const r3 = advanceIncrementalParse(r2.nextState, GROWN, BASE());
    expect(r3.nextState).toBe(r2.nextState);
    expect(r3.nextState.spliceCache).toBe(r2.nextState.spliceCache);
  });

  test('a stream that falls back mid-way stays equal to a full parse on every frame', () => {
    // Fallback frames in the middle of a lineage (a stray `<td>` poisons
    // the boundary to 0 for the rest of the document) leave states without
    // a cache; the frames around them are compared against the oracle.
    const doc = 'para one.\n\npara two.\n\npara three.\n\n<td>x\n\npara four.\n\npara five.\n\n';
    assertStreamEquivalence('cache fallback', scheduleSnapshots(doc, [5, 9, 3, 7]), CATALOG[0]);
  });

  test('a document with html blocks, footnotes and definitions splices cached and uncached alike', () => {
    // The cached passes cover every prefix-wide step; drive a document
    // that exercises each (html values for the table/raw-text guards,
    // definitions and footnotes for the injection plan, a math block for
    // position-less attribution) and compare every frame to the oracle.
    const doc =
      'intro[^n] with [ref].\n\n[^n]: note\n\n[ref]: /u\n\n<table><tr><td>a</td></tr></table>\n\n' +
      '$$\nx^2\n$$\n\n<!-- c -->\n\n<details>\n<summary>s</summary>\n</details>\n\n' +
      'p1\n\np2\n\np3\n\np4\n\np5\n\np6\n\n';
    for (const config of CATALOG) {
      const stats = assertStreamEquivalence('cache mixed', scheduleSnapshots(doc, [4]), config);
      // Anti-vacuity floor only (the hazards above refuse a fair share of
      // frames by design); equality is what the harness asserts per frame.
      expect(stats.incrementalFrames).toBeGreaterThan(stats.frames / 3);
    }
  });
});

describe('rebaseTreeDual — plugin-shaped trees (v2.4.1 review P2)', () => {
  test('tolerates a position with a missing start/end point instead of throwing', async () => {
    const { rebaseTreeDual, rebaseTree } = await import('./spliceParse');
    // A consumer plugin that emits `position: {}` or a half-built point: the
    // walk used to throw `Cannot read properties of undefined (reading
    // 'offset')` out of the render path (fuzz on a gfm+math+raw chain).
    const tree = {
      type: 'root',
      children: [
        { type: 'text', value: 'a', position: {} },
        { type: 'text', value: 'b', position: { end: { line: 1, column: 2, offset: 1 } } },
        {
          type: 'text',
          value: 'c',
          position: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 2, offset: 1 } },
        },
      ],
    } as never;
    expect(() => rebaseTreeDual(tree, [], 10, 2)).not.toThrow();
    expect(() => rebaseTree(tree, 10, 2)).not.toThrow();
    const kids = (tree as { children: { position?: { start?: { offset: number }; end?: { offset: number } } }[] })
      .children;
    expect(kids[1].position?.end?.offset).toBe(21);
    expect(kids[2].position?.start?.offset).toBe(20);
    expect(kids[2].position?.end?.offset).toBe(21);
  });
});

describe('dev assertion — a phantom label must never be defined in the chunk itself', () => {
  // The phantom label sets are deliberately absent from `depsKey` (suffix
  // churn never invalidates the prefix). That is sound only while no
  // phantom label is ALSO defined in `content` — coordinationPreparation
  // excludes own labels today; the engine reports the day it stops.
  const suffixFor = (links: string[], footnotes: string[]): string =>
    buildPhantomSuffix({ missingLinks: new Set(links), missingFootnotes: new Set(footnotes) });

  test('fires for a crafted input whose own definition is also a phantom label', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const options = buildCrossChunkAdvanceOptions(new Set(['NOTE']), new Set(['X']));
      const content = '[x]: /own\n\nsee [x] and [^note]\n\n[^note]: own body\n\n';
      advanceIncrementalParse(null, content, { ...options, phantomSuffix: suffixFor(['X'], ['NOTE']) });
      expect(errors).toHaveBeenCalledTimes(1);
      const message = String(errors.mock.calls[0][0]);
      expect(message).toContain('[ai-react-markdown]');
      expect(message).toContain('X');
      expect(message).toContain('NOTE');
    } finally {
      errors.mockRestore();
    }
  });

  test('is silent for production-shaped inputs (phantoms are exactly the labels the chunk lacks)', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const options = buildCrossChunkAdvanceOptions(new Set(['OTHER']), new Set(['ELSEWHERE']));
      const suffix = suffixFor(['ELSEWHERE'], ['OTHER']);
      const doc = '[own]: /own\n\nsee [own], [elsewhere] and [^other]\n\n[^mine]: local\n\n';
      let state: IncrementalParseState | null = null;
      for (let i = 1; i <= doc.length; i++) {
        state = advanceIncrementalParse(state, doc.slice(0, i), { ...options, phantomSuffix: suffix }).nextState;
      }
      // Standalone mode never carries a suffix — nothing to check.
      advanceIncrementalParse(null, doc, BASE());
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });
});

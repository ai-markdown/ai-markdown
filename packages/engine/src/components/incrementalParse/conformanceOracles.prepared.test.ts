import { afterEach, describe, expect, test, vi } from 'vitest';

import * as markdown from '../markdown';
import * as incremental from './advanceIncrementalParse';
import { oracleCheckDoc, prepareSnapshotRawCheck, type NodeLike, type OracleSweepStats } from './conformanceOracles';
import * as harness from './spliceArbiterHarness';
import { CATALOG } from './testPluginCatalog';

function freezeTree<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freezeTree(child, seen);
  return Object.freeze(value);
}

const emptyStats = (): OracleSweepStats => ({
  probesRun: 0,
  spliceableProbes: 0,
  incrementalProbes: 0,
  snapshotNodesCompared: 0,
  snapshotPositions: 0,
  documentsProbed: 0,
  fullyBlindDocs: 0,
});

afterEach(() => vi.restoreAllMocks());

describe('prepared conformance references', () => {
  test('reuses only the frozen baseline and still detects a late reference definition on repeated probes', () => {
    const doc = 'uses [x] here\n\n';
    const config = CATALOG[0];
    const mdast = freezeTree(harness.runFull(doc, config).mdast);
    const parse = vi.spyOn(markdown, 'parseStage');
    const check = prepareSnapshotRawCheck(doc, 15, config, mdast as NodeLike);
    const first = check('[x]: /u\n');
    expect(first.nodesCompared).toBeGreaterThan(0);
    expect(first.detail).toMatch(/^P-snap:/);
    expect(check('plain tail\n').detail).toBeNull();
    expect(check('[x]: /u\n')).toEqual(first);
    // The baseline runs once; all three appended probes still parse, even
    // when a tail repeats. No output or probe-result cache hides a call.
    expect(parse.mock.calls.map(([options]) => options.children)).toEqual([
      doc,
      doc + '[x]: /u\n',
      doc + 'plain tail\n',
      doc + '[x]: /u\n',
    ]);
  });

  test('keeps raw-text swallowing visible and isolates prepared documents and configs', () => {
    const doc = '<iframe>\n\n<div>probe</div>\n\n';
    const rawText = prepareSnapshotRawCheck(doc, 28, CATALOG[0]);
    const plain = prepareSnapshotRawCheck('settled text\n\n', 14, CATALOG[1]);
    const before = rawText('</iframe>\n');
    expect(before.nodesCompared).toBeGreaterThan(0);
    expect(before.detail).toMatch(/^P-snap:/);
    expect(plain('more text\n').detail).toBeNull();
    expect(rawText('</iframe>\n')).toEqual(before);
  });

  test('shares read-only references while executing all engine frames, empty probes and zero-distance recursion', () => {
    const runFull = harness.runFull;
    const full = vi.spyOn(harness, 'runFull').mockImplementation((...args) => freezeTree(runFull(...args)));
    const advance = vi.spyOn(incremental, 'advanceIncrementalParse');
    const parseStage = markdown.parseStage;
    const transformStage = markdown.transformStage;
    const rawParsed = new WeakSet<markdown.ParsedMarkdown>();
    const parse = vi.spyOn(markdown, 'parseStage').mockImplementation((options) => {
      const parsed = parseStage(options);
      if (options.rehypePlugins?.length === 1) rawParsed.add(parsed);
      return parsed;
    });
    vi.spyOn(markdown, 'transformStage').mockImplementation((parsed) => {
      const tree = transformStage(parsed);
      return rawParsed.has(parsed) ? freezeTree(tree) : tree;
    });
    const stats = emptyStats();
    const findings = oracleCheckDoc('alpha\n\nomega\n', CATALOG[0], stats, 0, { idealIdentity: true });

    expect(findings.filter((finding) => finding.severity === 'defect')).toEqual([]);
    expect(stats.probesRun).toBe(30);
    expect(stats.spliceableProbes).toBe(26);
    expect(stats.documentsProbed).toBe(1);
    expect(stats.fullyBlindDocs).toBe(0);
    expect(stats.snapshotNodesCompared).toBeGreaterThan(0);
    expect(advance).toHaveBeenCalledTimes(stats.probesRun * 3);
    const fullInputs = full.mock.calls.map(([content]) => content);
    expect(new Set(fullInputs).size).toBe(fullInputs.length);
    // Only raw references use the truncated, one-plugin rehype chain.
    const rawInputs = parse.mock.calls
      .filter(([options]) => options.rehypePlugins?.length === 1)
      .map(([options]) => options.children);
    expect(rawInputs.length).toBeGreaterThan(0);
    expect(new Set(rawInputs).size).toBe(rawInputs.length);

    const referenceTrees = new Set(full.mock.results.flatMap((result) => [result.value.mdast, result.value.hast]));
    for (const result of advance.mock.results) {
      expect(referenceTrees.has(result.value.mdast)).toBe(false);
      expect(referenceTrees.has(result.value.hast)).toBe(false);
    }
  });

  test('reference reuse does not hide an intermediate engine-frame defect', () => {
    const advance = incremental.advanceIncrementalParse;
    vi.spyOn(incremental, 'advanceIncrementalParse').mockImplementation((...args) => {
      const result = advance(...args);
      return { ...result, mdast: { ...result.mdast, children: [] } };
    });
    const stats = emptyStats();
    const findings = oracleCheckDoc('alpha\n\nomega\n', CATALOG[0], stats, 0, { idealIdentity: true });
    const engineDefects = findings.filter(
      (finding) => finding.severity === 'defect' && finding.detail.startsWith('engine:')
    );
    expect(engineDefects).toHaveLength(stats.probesRun);
    expect(engineDefects.every((finding) => finding.detail.includes('INTERMEDIATE frame'))).toBe(true);
  });
});

/**
 * P1 conformance sweep: the engine probe (authoritative), the (M) span
 * oracle and the (P) identity instruments against the scanner's own
 * boundary, over the pinned corpus and an env-scaled fuzz slice.
 *
 * Env knobs (same pattern as spliceFuzz):
 *   ORACLE_RUNS  fuzz docs per family (default 40; soak runs use thousands)
 *   ORACLE_SEED  fast-check seed for the fuzz slice (default 20260824)
 *   ORACLE_RAW   adds the prefix-anchored instruments AND turns the gate on
 *
 * WHAT ONLY THE GATE COVERS. Almost everything this file exists for is
 * behind `ORACLE_RAW=1`, which no CI job sets — only soak leg 5 does. A
 * green `pnpm test` on this file therefore does NOT mean the raw-mode gate
 * ran. Specifically, without `ORACLE_RAW`:
 *
 *   - `oracleCheckDoc` is called with `idealIdentity: false`, so
 *     `snapshotRawDisagreement` never runs in the sweeps. The
 *     `expect(snapFirings).toEqual([])` assertion still executes — over an
 *     array that is unconditionally empty, which is a check of nothing.
 *   - all three anti-vacuity floors and the per-document blindness counter
 *     sit inside `if (RAW_MODE)` and do not execute.
 *
 * What DOES still run in CI, and is the reason this is coverage honesty
 * rather than a live hole: the self-tests below call
 * `snapshotRawDisagreement` DIRECTLY, and each asserts both `nodesCompared
 * > 0` and a firing on planted defects. A total blinding of the gate — the
 * failure mode the floors exist for — reddens CI through those, without
 * `ORACLE_RAW`. What CI cannot see is the gate's verdict over a CORPUS:
 * drift in blindness rate, a new firing family, an exemption widening.
 *
 * The engine probe, the (M) span oracle and the pinned-corpus sweep run
 * unconditionally and are unaffected by any of this.
 *
 * The self-test group is the harness-validation half of §2.3: an oracle
 * that has only ever reported zero has not been tested, so the known
 * diverging shapes (formElement, doctype erasure, def-list back-claim,
 * lazy continuation, orphan-footnote retarget) are asserted to FIRE, on
 * hand-built (prefix, tail) pairs that bypass the scanner — the scanner
 * (correctly) never offers those boundaries, which is exactly why the
 * instruments must be validated without it.
 *
 * Sweeps assert zero DEFECT findings. `info` findings (instrument fired,
 * engine still correct — refused tail, seam-absorbed, sanitize-masked) are
 * collected and printed for T1.5 classification, never failed on: turning
 * them into failures would either bury defects in noise or pressure the
 * instruments into leniency.
 */

import { describe, expect, test } from 'vitest';
import fc from 'fast-check';

import { CATALOG, buildAdvanceOptions } from './testPluginCatalog';
import { computeFreezeBoundary } from './computeFreezeBoundary';
import {
  mSpanDisagreement,
  pipelineIdentityDisagreement,
  rawLayerIdentityDisagreement,
  probeTailsFor,
  oracleCheckDoc,
  engineProbe,
  snapshotRawDisagreement,
  type OracleSweepStats,
} from './conformanceOracles';
import { REALISTIC_DOCS, pinnedFuzzDocs } from './pinnedCorpus';
import { testEnv } from './spliceArbiterHarness';
import { COVERAGE_MARKERS, benignDocArb, hazardDocArb, type FuzzDoc } from './fuzzGenerators';
import { soakBeat } from './soakHeartbeat';

describe('oracle self-tests (must fire / must stay quiet)', () => {
  test('the formElement counterexample fires at both identity layers', () => {
    // Design §2.1's fifth condition: the prefix leaves parse5's
    // formElement pointer non-null (implicitly closed form), so a tail
    // <form> is ignored in the full parse but real in the split parse.
    // Every enumerated (P) condition is clean here — only the identity
    // sees it. Sanitize masks the ELEMENT difference (form is lifted),
    // but the lifted text lands as its own node while the full parse's
    // text merged into the seam — the grouping echo keeps the final layer
    // firing too.
    const prefix = '<div><form></div>\n\n';
    const tail = '<form>b</form>\n';
    expect(rawLayerIdentityDisagreement(prefix, tail, CATALOG[0])).not.toBeNull();
    expect(pipelineIdentityDisagreement(prefix, tail, CATALOG[0])).not.toBeNull();
  });

  test('the def-list back-claim fires on the M oracle', () => {
    // `: description` reaches BACKWARD across one blank to claim the
    // paragraph as a <dt> — the paragraph's covering spans change.
    const prefix = 'term paragraph\n\n';
    const tail = ': claimed description\n';
    const defListConfig = CATALOG.find((c) => c.defList)!;
    expect(mSpanDisagreement(prefix, tail, defListConfig)).not.toBeNull();
    // Under a config without the extension the same tail is inert.
    const plainConfig = CATALOG.find((c) => !c.defList)!;
    expect(mSpanDisagreement(prefix, tail, plainConfig)).toBeNull();
  });

  test('list continuation across the blank fires on the M oracle', () => {
    const prefix = '- item one\n\n';
    const tail = '  continuation of the item\n';
    expect(mSpanDisagreement(prefix, tail, CATALOG[0])).not.toBeNull();
  });

  test('a footnote definition tail retargets an orphan ref (R dimension)', () => {
    const prefix = 'uses [^x] here\n\n';
    const tail = '[^x]: now defined\n';
    expect(mSpanDisagreement(prefix, tail, CATALOG[0])).not.toBeNull();
  });

  test('a raw-text element open across the blank fires (F10 shape)', () => {
    // <iframe> block + blank: micromark ended the type-6 block, parse5's
    // raw-text state runs on — later bytes are elements to one grammar
    // and text to the other.
    const prefix = '<iframe>\n\n';
    const tail = '<div>probe</div>\n\n</iframe>\n';
    expect(rawLayerIdentityDisagreement(prefix, tail, CATALOG[0])).not.toBeNull();
  });

  test('a planted under-block fires on the P snapshot gate (the gate is not blind)', () => {
    // The snapshot gate had no must-fire plant of its own — the edge fix
    // below could have blinded it silently. Two shapes whose frozen nodes
    // OWN bytes below the (deliberately wrong) boundary and are rewritten
    // by the tail:
    // - a reference the tail's definition retargets (the text node splits
    //   around a new <a>);
    // - the F10 iframe whose raw-text region swallows the probe.
    const ref = snapshotRawDisagreement('uses [x] here\n\n', '[x]: /u\n', 15, CATALOG[0]);
    expect(ref.nodesCompared).toBeGreaterThan(0);
    expect(ref.detail).toMatch(/^P-snap/);
    const f10 = snapshotRawDisagreement('<iframe>\n\n<div>probe</div>\n\n', '</iframe>\n', 28, CATALOG[0]);
    expect(f10.nodesCompared).toBeGreaterThan(0);
    expect(f10.detail).toMatch(/^P-snap/);
  });

  test('a zero-width node AT the boundary stays quiet on the P snapshot gate (281d artifact)', () => {
    // 281d oracle leg, ORACLE_SEED=20294308 benign #558 [no-orphan]: the
    // tail line `p<iframe> x </iframe a> y` collapses its own paragraph
    // element to a ZERO-WIDTH raw node sitting exactly AT the boundary
    // (`297-297:element:p`), and every probe's append legitimately reshapes
    // it. The node owns no frozen byte, so it is not the scanner's claim —
    // engine-clean on seven schedules × six configs, measured before the
    // predicate gained `start < boundary`. Minimal 33-byte reproduction,
    // all configs; nodesCompared stays positive, so the quiet verdict is
    // not vacuous.
    const doc = 'x\n\np<iframe> x </iframe a> y\nmore\n';
    for (const config of CATALOG) {
      const r = snapshotRawDisagreement(doc, 'probe tail text\n', 3, config);
      expect(r.nodesCompared, `[${config.label}] compared`).toBeGreaterThan(0);
      expect(r.detail, `[${config.label}]`).toBeNull();
      const findings = oracleCheckDoc(doc, config, undefined, 0, { idealIdentity: true });
      expect(
        findings.filter((f) => f.detail.startsWith('P-snap')),
        `[${config.label}] full probe battery`
      ).toEqual([]);
    }
  });

  test('a still-open raw-text element does not turn footer furniture into a frozen claim (F21)', () => {
    // v2.8.2 gate, oracle shard 11 (ORACLE_SEED=20298311, hazard #1990):
    // `P-snap: frozen node 49-67:element:li:{"id":"fn-spec"}` — a footnote
    // footer `<li>`, which the gate has always meant to exempt.
    //
    // The exemption used to key on the section wrapper's `data-footnotes`,
    // and a wrapper is a START TAG: any raw-text or escapable-raw-text
    // element still open when remark-rehype's footer is emitted puts parse5
    // in the "text" insertion mode, which drops start tags. The `<section>`
    // and `<h2>` opens vanish, "Footnotes" lands as element text, and the
    // `<ol>` resurfaces at the ROOT — unmarked, so the strip kept it on the
    // open side and removed it on the side the tail closed. All seven
    // members of the class behave identically; `plaintext` does not, because
    // it swallows the `<ol>` too, and neither does a comment.
    //
    // Engine-clean on the whole class before the instrument was touched:
    // 185k frames / 20k engaged over 250 randomized documents × 6 configs,
    // zero divergence, plus the shard's own document at 413 frames per
    // config. The scanner is not involved — boundaries are byte-identical on
    // v2.8.1 and the 22.23.2 corpus regen.
    const withRef = (tag: string) => `uses [^x] here\n\n[^x]: body\n\npara\n\n<${tag}>\n`;
    const orphanOnly = (tag: string) => `[^x]: body\n\npara\n\n<${tag}>\n`;
    for (const tag of ['textarea', 'title', 'style', 'script', 'xmp', 'iframe', 'noembed']) {
      for (const shape of [withRef, orphanOnly]) {
        const doc = shape(tag);
        for (const config of CATALOG) {
          const { defListEnabled } = buildAdvanceOptions(config);
          const boundary = computeFreezeBoundary(doc, { defListEnabled }).boundary;
          const r = snapshotRawDisagreement(doc, `</${tag}>\n`, boundary, config);
          const at = `<${tag}> [${config.label}] b=${boundary}`;
          // Non-vacuous: the body nodes below the boundary are still compared.
          expect(r.nodesCompared, `${at} compared`).toBeGreaterThan(0);
          expect(r.detail, at).toBeNull();
        }
      }
    }
    // Control A — the same shape with a wrapper that SURVIVES. Quiet before
    // and after the fix, so it cannot be what the pin above is measuring.
    for (const config of CATALOG) {
      const doc = 'uses [^x] here\n\n[^x]: body\n\npara\n\n<div>\n';
      const { defListEnabled } = buildAdvanceOptions(config);
      const boundary = computeFreezeBoundary(doc, { defListEnabled }).boundary;
      const r = snapshotRawDisagreement(doc, '</div>\n', boundary, config);
      expect(r.nodesCompared, `<div> [${config.label}] compared`).toBeGreaterThan(0);
      expect(r.detail, `<div> [${config.label}]`).toBeNull();
    }
    // Control B — the exemption is stated in a definition's OWN bytes, so a
    // document that carries one must still be able to fail. The planted
    // reference under-block fires on every config with a footnote definition
    // sitting above it.
    for (const config of CATALOG) {
      const doc = '[^n]: note\n\nuses [x] here\n\n';
      const r = snapshotRawDisagreement(doc, '[x]: /u\n', doc.length, config);
      expect(r.nodesCompared, `plant [${config.label}] compared`).toBeGreaterThan(0);
      expect(r.detail, `plant [${config.label}]`).toMatch(/^P-snap/);
    }
  });

  test('a document cannot forge the footer exemption and silence the gate', () => {
    // F21 fixed a footer the PARSER ate. This is the same key read from the
    // other end: `data-footnotes` is an attribute, and 24 bytes at column 0
    // (`<section data-footnotes>`) make rehype-raw hand the gate an element
    // the wrapper strip recognised as generated furniture — after which it
    // removed the author's own content from BOTH sides. Measured on the
    // shipped code before this changed: every bait below stayed quiet on
    // every config, and the first four compared ZERO nodes for the whole
    // document, so a real under-block inside the forged region was
    // invisible while the sweep's anti-vacuity floors — which are ratios
    // over a whole corpus — stayed comfortably satisfied.
    //
    // Each bait is a planted under-block (a deliberately wrong boundary
    // plus a tail that demonstrably rewrites a node below it), shaped to
    // look like the exemption it is aimed at. All of them must fire.
    const baits: Array<{ id: string; doc: string; tail: string }> = [
      // Controls: the byte-anchored exemption is what the gate keeps, and
      // a real definition sitting above or abutting the bait must not
      // extend to it.
      { id: 'naked retarget', doc: 'uses [x] here\n\n', tail: '[x]: /u\n' },
      { id: 'real definition above', doc: '[^n]: note\n\nuses [x] here\n\n', tail: '[x]: /u\n' },
      { id: 'definition abuts the bait', doc: '[^n]: note\n\n[x] ref\n\n', tail: '[x]: /u\n' },
      // Forged wrappers.
      { id: 'forged wrapper', doc: '<section data-footnotes>\n\nuses [x] here\n\n', tail: '[x]: /u\n' },
      {
        id: 'forged wrapper with the class too',
        doc: '<section data-footnotes class="footnotes">\n\nuses [x] here\n\n',
        tail: '[x]: /u\n',
      },
      { id: 'forged wrapper nested', doc: '<div>\n\n<section data-footnotes>\n\nuses [x] here\n\n', tail: '[x]: /u\n' },
      {
        id: 'forged wrapper beside a real definition',
        doc: '[^n]: note\n\n<section data-footnotes>\n\nuses [x] here\n\n',
        tail: '[x]: /u\n',
      },
      // The forged wrapper carrying F10's raw-text swallow instead of a
      // reference retarget — a different mechanism behind the same bait.
      {
        id: 'forged wrapper over F10',
        doc: '<section data-footnotes>\n\n<iframe>\n\n<div>probe</div>\n\n',
        tail: '</iframe>\n',
      },
      // The attribute is what is read, so any tag carries it.
      { id: 'forged on a span', doc: '<span data-footnotes>\n\nuses [x] here\n\n', tail: '[x]: /u\n' },
    ];
    for (const bait of baits) {
      for (const config of CATALOG) {
        const r = snapshotRawDisagreement(bait.doc, bait.tail, bait.doc.length, config);
        const at = `${bait.id} [${config.label}]`;
        expect(r.nodesCompared, `${at} compared nothing`).toBeGreaterThan(0);
        expect(r.detail, at).toMatch(/^P-snap/);
      }
    }
  });

  test('the per-document vacuity counter responds to a blinded document', () => {
    // `fullyBlindDocs` is a floor, and a floor that cannot be made to move
    // is decoration. The blind document is not hand-invented — it is the
    // 141-byte hazard sample this counter first flagged (seed 20400401),
    // hand-shrunk to 52 bytes: everything the scanner freezes is
    // definition content, which is the gate's one legitimate exemption, so
    // the gate correctly says nothing and the counter must notice that it
    // said nothing. Probed and blind on all six configs; a document with
    // ordinary frozen content must not be counted.
    //
    // Both halves matter. Asserting only the blind side would pass on a
    // counter stuck at 1, and asserting only the speaking side would pass
    // on one stuck at 0.
    const blind = '[^x]: body\n\n    cont\n\n[y]: /y\n\nprose [text][y] used\n';
    const speaking = 'para one with some words\n\npara two with more\n\npara three\n\n';
    const count = (doc: string) => {
      const stats: OracleSweepStats = {
        probesRun: 0,
        spliceableProbes: 0,
        incrementalProbes: 0,
        snapshotNodesCompared: 0,
        snapshotPositions: 0,
        documentsProbed: 0,
        fullyBlindDocs: 0,
      };
      for (const config of CATALOG) oracleCheckDoc(doc, config, stats, 0, { idealIdentity: true });
      return stats;
    };
    const a = count(speaking);
    expect(a.documentsProbed, 'the speaking document was never probed — pick another').toBeGreaterThan(0);
    expect(a.fullyBlindDocs, 'ordinary frozen content counted as blind').toBe(0);
    const b = count(blind);
    expect(b.documentsProbed, 'the blind document was never probed — pick another').toBeGreaterThan(0);
    expect(b.fullyBlindDocs, 'a document the gate said nothing about was not counted').toBe(b.documentsProbed);
  });

  test('the M oracle stays quiet on paragraph prefixes for every probe', () => {
    const prefix = 'para one with *emphasis*\n\npara two\n\n';
    for (const config of CATALOG) {
      for (const probe of probeTailsFor(prefix)) {
        if (probe.id === 'defListClaim' && config.defList) continue; // fires by design, asserted above
        expect(mSpanDisagreement(prefix, probe.tail, config), `M [${config.label}] probe=${probe.id}`).toBeNull();
      }
    }
  });

  test('the engine probe stays quiet on paragraph prefixes for every probe', () => {
    const doc = 'para one with *emphasis*\n\npara two\n\n';
    for (const config of CATALOG) {
      for (const probe of probeTailsFor(doc)) {
        const { disagreement } = engineProbe(doc, probe.tail, config);
        expect(disagreement, `engine [${config.label}] probe=${probe.id}`).toBeNull();
      }
    }
  });
});

// ORACLE_RAW=1 adds the prefix-anchored ideal-identity instruments to the
// sweeps (exploratory; they overclaim at evidence-dependent boundaries).
const RAW_MODE = testEnv('ORACLE_RAW') === '1';
const ORACLE_OPTS = { idealIdentity: RAW_MODE };

/**
 * The ORACLE_RAW gate is the SNAPSHOT-anchored raw identity: any firing
 * fails. It needs no exemption list, because it has no tail-alone parse to
 * produce artifacts about — which is why E1-E7 all measure zero under it.
 *
 * The prefix-anchored form stays as info-only triage beside it, with
 * `classifyRawFamily` demoted from gate to classification aid. See the
 * ledger for the recall/precision tradeoff that decided this.
 */
const snapshotFirings = (findings: Array<{ probeId: string; detail: string }>): string[] =>
  findings.filter((f) => f.detail.startsWith('P-snap')).map((f) => `probe=${f.probeId} ${f.detail.slice(0, 400)}`);

const formatFindings = (findings: unknown): string => JSON.stringify(findings, null, 1)?.slice(0, 4000) ?? '';

/**
 * Diagnostics on the real stream. `console.*` is intercepted in this package
 * and a PASSING test's output is dropped, which is every run this sweep's
 * readout exists for. The cast mirrors `spliceExhaustive.test.ts`: the engine
 * package takes no `@types/node` and its `process` shim exposes only `env`.
 */
const emit = (line: string): void => {
  (process as unknown as { stdout?: { write(text: string): void } }).stdout?.write(line);
};

describe('oracle sweep — pinned realistic corpus', () => {
  // NO INFO DIAGNOSTICS HERE, deliberately. This sweep used to collect its
  // `info` findings into a `classification log (informational)` test that
  // printed them at the end. That test was DELETED rather than moved to the
  // real stream when the dropped-console channel was fixed: its body was one
  // `console.log` plus `expect(true).toBe(true)`, so it asserted nothing and,
  // through the intercepted channel, printed nothing either — it had been
  // silent for its whole life. The fuzz sweeps below keep their info buckets
  // and now emit them for real. If you want the pinned corpus's info stream
  // back, it needs building, not restoring: nothing was moved aside.
  for (const doc of REALISTIC_DOCS) {
    test(`${doc.id}`, () => {
      const config = CATALOG[doc.configIndex % CATALOG.length];
      const stats: OracleSweepStats = {
        probesRun: 0,
        spliceableProbes: 0,
        incrementalProbes: 0,
        snapshotNodesCompared: 0,
        snapshotPositions: 0,
        documentsProbed: 0,
        fullyBlindDocs: 0,
      };
      const findings = oracleCheckDoc(doc.doc, config, stats, 0, ORACLE_OPTS);
      const defects = findings.filter((f) => f.severity === 'defect');
      const snapFirings = snapshotFirings(findings);
      expect(
        snapFirings,
        `${doc.id} [${config.label}] the frozen region did not survive an append at the raw layer — ` +
          `this is the scanner's own claim failing, not an instrument artifact:\n${snapFirings.join('\n')}`
      ).toEqual([]);
      expect(defects, `${doc.id} [${config.label}] ${formatFindings(defects)}`).toEqual([]);
      // The sweep must exercise the incremental path, not just prove the
      // fallback correct — and the counter must be the NON-EMPTY-tail one,
      // for the reason recorded on `OracleSweepStats.spliceableProbes`.
      if (RAW_MODE) {
        // The gate must have something to say about this document.
        expect(stats.snapshotPositions, `${doc.id} snapshot gate compared no frozen node`).toBeGreaterThan(0);
      }
      expect(stats.spliceableProbes).toBeGreaterThan(0);
      expect(
        stats.incrementalProbes,
        `${doc.id} spliced ${stats.incrementalProbes}/${stats.spliceableProbes} non-empty-tail probes`
      ).toBeGreaterThanOrEqual(Math.ceil(stats.spliceableProbes / 2));
    });
  }
});

describe('oracle sweep — fuzz corpus (env-scaled)', () => {
  const runs = Number(testEnv('ORACLE_RUNS') ?? 40);
  const seed = Number(testEnv('ORACLE_SEED') ?? 20260824);

  const sweep = (name: string, arb: fc.Arbitrary<FuzzDoc>, seedOffset: number) => {
    // Per-run budget is MEASURED, not guessed (the 100 ms/run guess timed a
    // COMPLETED zero-defect leg-5 sweep out at 4000 runs on the remote box): local dev
    // machine, idle, ORACLE_RUNS=800 — benign 26.3 ms/run, hazard 26.9
    // ms/run (21.1 s / 21.6 s per sweep, 2026-08-27, P0 three-frame probe +
    // snapshot instrument included). The remote box's timeout proves > 100 ms/run
    // on slower server cores under 12-way shard contention, so the budget
    // is 300 ms/run — ≈ 11× the local measurement and ≈ 3× the observed
    // server lower bound. A timeout here marks a FINISHED sweep failed, so
    // generous is the correct direction; real hangs still die within the
    // frame budget.
    test(`${name} × ${runs}`, { timeout: Math.max(60_000, runs * 300) }, () => {
      const docs = fc.sample(arb, { seed: seed + seedOffset, numRuns: runs });
      const stats: OracleSweepStats = {
        probesRun: 0,
        spliceableProbes: 0,
        incrementalProbes: 0,
        snapshotNodesCompared: 0,
        snapshotPositions: 0,
        documentsProbed: 0,
        fullyBlindDocs: 0,
      };
      const failures: string[] = [];
      const snapFirings: string[] = [];
      const infoBuckets = new Map<string, number>();
      const infoExamples = new Map<string, string[]>();
      const beat = soakBeat(name, docs.length);
      // Attribution for the blindness floor below: which generator families
      // (by COVERAGE_MARKERS) the documents the gate never compared belong
      // to. A document is blind when the gate cannot speak about it at any
      // position, so the tally names the corpus shapes that never freeze
      // and lets a threshold move be checked against the generator change
      // that caused it instead of against the number alone.
      const blindByMarker = new Map<string, number>();
      const blindExamples: string[] = [];
      docs.forEach((d, i) => {
        beat.tick();
        const config = CATALOG[d.configIndex % CATALOG.length];
        const blindBefore = stats.fullyBlindDocs;
        const findings = oracleCheckDoc(d.doc, config, stats, 0, ORACLE_OPTS);
        if (stats.fullyBlindDocs > blindBefore) {
          for (const [marker, re] of Object.entries(COVERAGE_MARKERS)) {
            if (re.test(d.doc)) blindByMarker.set(marker, (blindByMarker.get(marker) ?? 0) + 1);
          }
          if (blindExamples.length < 6) blindExamples.push(`doc#${i}=${JSON.stringify(d.doc).slice(0, 100)}`);
        }
        for (const f of findings.filter((f) => f.severity === 'info')) {
          // Aggregate by layer + probe: at soak scale the classification
          // question is "which exemption family", not "which sample" — but
          // keep two samples per bucket so a NEW family is classifiable
          // from the log without a re-run.
          const bucket = `${f.detail.split(':')[0]}/${f.probeId}${f.rawFamily ? `/${f.rawFamily}` : ''}`;
          infoBuckets.set(bucket, (infoBuckets.get(bucket) ?? 0) + 1);
          const ex = infoExamples.get(bucket) ?? [];
          if (ex.length < 2) {
            ex.push(`doc#${i}=${JSON.stringify(d.doc).slice(0, 120)} ${f.detail.slice(0, 260)}`);
            infoExamples.set(bucket, ex);
          }
        }
        const defects = findings.filter((f) => f.severity === 'defect');
        if (defects.length > 0) {
          failures.push(
            `#${i} [${config.label}] doc=${JSON.stringify(d.doc).slice(0, 200)} ${formatFindings(defects).slice(0, 600)}`
          );
        }
        for (const u of snapshotFirings(findings)) {
          snapFirings.push(`#${i} [${config.label}] doc=${JSON.stringify(d.doc).slice(0, 200)} ${u}`);
        }
      });
      beat.finish();
      const buckets = [...infoBuckets.entries()].sort((a, b) => b[1] - a[1]);
      // Real stream, not `console.log`: this readout only ever speaks on a
      // PASSING run, which is exactly the output vitest 4 drops here (see the
      // channel note in `vitest.config.ts`). It is also the only place
      // `fullyBlindDocs` is reported on a green run, and the 0.12 limit below
      // is an absolute constant calibrated from observed ratios (hazard
      // 5.79-8.14% on the 3.1.0 corpus) — so without this line nobody can watch that ratio drift
      // toward its own threshold. An assertion is a gate, not a gauge: its
      // message arrives only once the limit is already crossed.
      emit(
        `[oracle ${name}] probes=${stats.probesRun} spliceable=${stats.spliceableProbes} incremental=${stats.incrementalProbes} ` +
          `snapNodes=${stats.snapshotNodesCompared} snapPositions=${stats.snapshotPositions} ` +
          `blindDocs=${stats.fullyBlindDocs}/${stats.documentsProbed} info=${buckets.reduce((a, [, n]) => a + n, 0)}\n` +
          buckets
            .map(([k, n]) => `  ${k} ×${n}\n${(infoExamples.get(k) ?? []).map((e) => `    ${e}`).join('\n')}`)
            .join('\n') +
          '\n'
      );
      emit(
        `[oracle ${name}] blind docs by marker: ` +
          [...blindByMarker.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([k, n]) => `${k}=${n}`)
            .join(' ') +
          (blindExamples.length ? `\n${blindExamples.map((e) => `    ${e}`).join('\n')}` : '') +
          '\n'
      );
      expect(failures, failures.join('\n---\n').slice(0, 6000)).toEqual([]);
      // Under ORACLE_RAW=1 the SNAPSHOT form gates: every firing is the
      // frozen region failing to survive an append, with no exemptions.
      expect(
        snapFirings,
        `snapshot-anchored raw firings (${snapFirings.length}) — the frozen region changed under append:\n` +
          `${snapFirings.slice(0, 12).join('\n')}`
      ).toEqual([]);
      // Anti-vacuity floor for the GATE itself, same discipline as the
      // engagement floors: a gate that compares nothing passes everything.
      // The first prototype of this instrument compared root children only
      // and so compared ZERO nodes at 439 of 797 probe positions — caught
      // by measuring it, not by reasoning about it.
      //
      // The denominator is `spliceableProbes` — NON-EMPTY tails — not
      // `probesRun`. An empty tail compares raw(doc) against itself, and
      // counting those inflated this floor with positions that assert
      // nothing: 12.4% of positions, delivering 99.7% of the budget, so a
      // total gate collapse would have moved the ratio by 0.3%. Same
      // memo-hit shape as the engagement floors, same fix.
      //
      // Landed measurements over non-empty tails: benign 21499 nodes /
      // 2520 positions = 8.53 each, 100% of positions speaking; hazard
      // 10378 / 2281 = 4.55, 95.5%. Floors at 1 node (4.6x margin on the
      // tighter family) and half the positions (1.9x).
      if (RAW_MODE) {
        expect(
          stats.snapshotNodesCompared / stats.spliceableProbes,
          'the snapshot gate compared almost nothing'
        ).toBeGreaterThan(1);
        expect(
          stats.snapshotPositions / stats.spliceableProbes,
          'the snapshot gate was silent at most probe positions'
        ).toBeGreaterThan(0.5);
        // PER-DOCUMENT vacuity, which the two ratios above structurally
        // cannot see. They are corpus-wide, so one blinded document moves
        // them by a millionth: at the measured 0.974 against a 0.5
        // threshold, 48.7% of documents could be blind before either
        // fired. F22 is why that got measured — a forged footer wrapper
        // took a document's gate to zero compared nodes on all six configs
        // while every ratio here stayed comfortable.
        //
        // This is NOT an F22 detector, and must not be sold as one: at a
        // scanner-GRANTED boundary the forgery is unreachable (an open
        // `<section>` suppresses freezing entirely, so the document is
        // never probed and never counted here) and F22 is fixed at its own
        // key besides. What this catches is the general class — any future
        // mechanism that silences the gate on part of a corpus.
        //
        // Blindness is all-or-nothing per document: measured over 1,263
        // probed documents, the count blind at EVERY position equals the
        // count blind at ANY position (benign 4, hazard 24). Whether the
        // gate can speak is a property of the document, not of the probe,
        // so counting silent documents is the whole instrument.
        //
        // Threshold 12% against 12 shards x 4000 runs (seeds 20401200+i,
        // 2026-09-16, the 3.1.0 corpus): benign 0.70-1.75% (mean 1.27),
        // hazard 5.79-8.14% (mean 7.01). 1.47x the worst observed; at
        // n≈1050 documents per sweep the sampling sd is 0.8pp, so 12% sits
        // ~6.3 sd out and noise cannot reach it. The previous constant, 8%,
        // was calibrated on the 3.0.x corpus (seeds 20400400+i: benign
        // 0.23-1.37% mean 0.74, hazard 3.70-5.54% mean 4.50) and the v3.1.0
        // release soak crossed it at 8.22% on one shard. The corpus change
        // behind that is the 3.1.0 generator additions — tab-indented
        // hazards, prefix-colliding tag names and the task-list reclaim /
        // late-definition families — a share of which are documents that
        // never freeze at any position; the `blind docs by marker` readout
        // above attributes each sweep's blind documents to those families.
        // One 4000-run sweep (seed 20401300): hazard 75/1044 blind, of
        // which taskLateDef=49 tabIndent=34 taskBox=30 taskEmptyMarker=6
        // taskSetextReclaim=5 tagNamePrefix=4 taskLazyMarker=4
        // taskTableReclaim=3 (markers overlap; proseBracketTaint=71 and
        // loneCr=52 are the pre-existing shapes the new ones combine with).
        // The hazard denominator also moved down (1010-1082 per sweep, from
        // 1120-1150): it sits close to the 1000 sample guard, so a sweep
        // that lands under it announces NOT APPLIED rather than gating.
        //
        // THE SAMPLE GUARD IS NOT OPTIONAL, and this floor shipped without
        // it for one commit. `ORACLE_RUNS` scales the corpus, and fast-check
        // biases toward SMALL documents early in a sample — a small document
        // has fewer positioned nodes below its boundary, so it is likelier
        // to be blind. The rate therefore falls monotonically with n, on one
        // seed: 20.0% at 5 probed documents, 7.7% at 26, 2.6% at 115, 1.6%
        // at 313, against 0.74% at n≈1200. At `ORACLE_RUNS=40` (the DEFAULT)
        // seed 20401000 gives benign 1 of 5 = 20%, and the assertion failed
        // on a corpus behaving exactly as calibrated. Two further seeds put
        // hazard anywhere in 2.1-7.1% below n≈250.
        //
        // A ratio over a denominator of 5 is not a measurement, and a
        // threshold that renders a verdict anyway is the same fault this
        // whole round kept finding: an instrument that cannot notice it does
        // not apply. So "not enough sample" is a THIRD ANSWER — not a pass,
        // not a failure — and it is announced, because a floor that goes
        // quiet is indistinguishable from a floor that is satisfied.
        //
        // 1000 is where the spread has settled: every 4000-run sweep
        // measured lands at 1175-1365 probed documents, and everything
        // below that was still moving.
        //
        // 8 is an ABSOLUTE, corpus-derived constant — the only one in this
        // package. Contrast the engagement floor below: `/2` is a RELATIVE
        // bound that still means the same thing under any corpus, so it
        // never needs re-deriving. This one does, whenever the generators
        // move. HOW to re-derive it, because an instruction to "re-measure
        // with evidence" that does not say how is the same failure one
        // level up:
        //
        //   for i in $(seq 0 11); do
        //     ORACLE_RAW=1 ORACLE_RUNS=4000 ORACLE_SEED=$((<fresh> + i)) \
        //       ../../node_modules/.bin/vitest run \
        //       src/components/incrementalParse/oracleConformance.test.ts &
        //   done
        //
        // Read `blindDocs=N/M` from each sweep's readout — one line per
        // family per shard, 24 readings — and take the spread. Use a FRESH
        // seed base above every one already used (20400400-411 and
        // 20400700-711 are spent), for the reason `soak.sh` insists on
        // one. No reporter flag is needed: the readout goes through
        // `emit`/`process.stdout.write`, not `console.log`.
        //
        // That last point is why the original calibration appears in no
        // committed log. Until "the diagnostics that only speak on a
        // green run were the ones being dropped", this readout was a
        // `console.log`,
        // and vitest 4 drops those from PASSING tests unless a reporter is
        // named — which no leg does. The numbers above were captured by
        // passing `--reporter=dot` by hand. Re-deriving them today needs
        // no such trick; the method above is the whole of it.
        //
        // Then move the threshold WITH that evidence, rather than to
        // whatever makes the run green.
        if (stats.documentsProbed >= 1000) {
          expect(
            stats.fullyBlindDocs / stats.documentsProbed,
            `the gate compared nothing at all on ${stats.fullyBlindDocs}/${stats.documentsProbed} documents — ` +
              `a per-document blinding the corpus-wide ratios cannot see`
          ).toBeLessThan(0.12);
        } else {
          emit(
            `[oracle ${name}] blindness floor NOT APPLIED: ${stats.fullyBlindDocs}/${stats.documentsProbed} ` +
              `probed documents, needs 1000 — raise ORACLE_RUNS to ~4000 to gate on it\n`
          );
        }
      }
      // Anti-vacuity floor, over NON-EMPTY tails only. The old form counted
      // every probe and so could not fall below 4/doc even with the splice
      // torn out — an identical-content frame is a memo hit that reports
      // `usedIncremental` without splicing anything. Measured engagement on
      // this counter sits near 90% for both families; half is a collapse
      // detector with room for hazard drift.
      expect(stats.spliceableProbes).toBeGreaterThan(0);
      expect(
        stats.incrementalProbes / stats.spliceableProbes,
        `the sweep spliced ${stats.incrementalProbes}/${stats.spliceableProbes} non-empty-tail probes — it proved little`
      ).toBeGreaterThan(0.5);
    });
  };

  sweep('benign', benignDocArb, 0);
  sweep('hazard', hazardDocArb, 1);
});

describe('pinned corpus integrity', () => {
  test('the fuzz slice is deterministic for this fast-check build', () => {
    const a = pinnedFuzzDocs();
    const b = pinnedFuzzDocs();
    expect(a.length).toBe(2000);
    expect(a[0].doc).toBe(b[0].doc);
    expect(a[1999].doc).toBe(b[1999].doc);
  });
});

/**
 * BOUNDED-EXHAUSTIVE sweep — the census companion to the fuzz arbiter.
 *
 * Every sequence of ≤ K tokens from each of two alphabets is streamed
 * through EVERY 2-cut append schedule (plus a deterministic sample of
 * 3-cuts) under EVERY catalog config, and must satisfy:
 *   P1  per-frame splice ≡ fresh full parse (hast+mdast deep-equal);
 *   P2  checkpoint-resumed scan ≡ fresh scan (boundary values);
 *   P3  the frozen region at the raw() layer is invariant under append.
 * Within this bounded space the guarantee is EXHAUSTIVE, not
 * probabilistic — the small-scope hypothesis says line-lexer bugs
 * (off-by-one line state, blank-run accounting) overwhelmingly manifest on
 * tiny inputs.
 *
 * WHY IT CAUGHT NOTHING FOR SIX DEFECTS (F13, F16-F20). The 2026-08-27
 * architecture review found three independent causes, all addressed here:
 *
 *  - The properties were ENGAGEMENT-GATED. P1 and P2 only say something
 *    when the incremental path runs, and it runs on ~3% of census frames.
 *    P3 states the scanner's claim directly and needs no splice at all.
 *  - The CONFIG coverage was 2 of 6 catalog cells, one of them conditional
 *    on the document containing `': '`. F20 diverged on 3 of 6 cells.
 *  - The ALPHABET was hand-written. It is now derived on both axes — one
 *    token per scanner name-equivalence class (`NAME_CLASS_REPS`) and one
 *    per measured grammar-rule disagreement (`SHAPE_TOKENS`).
 *
 * TWO BANDS, and the split is structural rather than budgetary. The
 * FRAGMENT band is sub-line: `'<!--'`, `'>'`, `'-->'`, `'<?'` are pieces
 * that must COMPOSE within one line to build `<!-->`, `<!--->`, `<?>` —
 * the 2026-08 review found every P1 of its batch in that gap, so the band
 * needs DEPTH and lives or dies on K. The NAME band is line-shaped: one
 * scanner-taxonomy class per token, where the question is which names the
 * two grammars sort differently, not how bytes compose. It needs BREADTH,
 * and at line granularity three tokens already reach what the fragment
 * band needs five or six for. Merging them would multiply two alphabets
 * that want opposite knobs.
 *
 * TWO CONFIGURATIONS, and the defaults are the CI one: both bands at K=2,
 * configs ROTATED one per document, P3 on. ~26 s here, ~1-1.5 min on a
 * shared runner. A PR check costing half an hour gets skipped, then
 * disabled, then deleted, so breadth is what pays for the budget — the
 * PROPERTY stays, because P3 is the part that sees what the old leg
 * structurally could not, and its cost is per DOCUMENT rather than per
 * schedule, so it survives the cut nearly intact. CI is a regression NET;
 * the gate is the PROOF.
 *
 * WHAT ONLY THE GATE COVERS — read this before treating a green CI as the
 * full claim:
 *   - K=3 and K=4 documents in the fragment band. CI stops at two tokens,
 *     so no composed three-fragment construct (`<!--` + `>` + a stray
 *     `-->`) is ever built. Every P1 of the 2026-08 review's batch lived
 *     in exactly that gap.
 *   - K=3 in the name band, which is where P3 currently fires at all: the
 *     stray-end-tag class needs three lines, and CI's two-line documents
 *     produce `fired=0` every run. A green CI is silent about it.
 *   - The CONFIG CROSS-PRODUCT. CI rotates, so each document is tried
 *     under ONE of the six cells, and no green CI run has ever tried a
 *     given document under the other five. Only the gate can say "every
 *     document under every shipped configuration".
 *   - Full-stride cut schedules. CI runs stride 1 only because K=2
 *     documents are short; the gate's K=4 documents are strided.
 *
 * The rotation slice is FIXED, not a rolling sample: the same document
 * gets the same config on every run, so CI's blind five-sixths does not
 * shrink by running CI more often. `EXHAUSTIVE_ROTATE_SALT` moves it.
 *
 * A THIRD SEARCH sits below the two censuses: a state-directed BFS over
 * abstract scanner checkpoints. The censuses enumerate the token surface,
 * which is bounded by token granularity rather than by K; the BFS
 * enumerates reachable ABSTRACT STATES, which is what gets to F20's shape
 * in two tokens instead of eight. It is a directed search, not a proof —
 * see `checkpointAbstraction.ts`. `EXHAUSTIVE_BFS_DEPTH=0` skips it.
 *
 * The release gate passes the expensive values, sharded — one process per
 * shard, since a census is a single vitest test and therefore a single
 * core:
 *   for i in $(seq 0 11); do EXHAUSTIVE_K=4 EXHAUSTIVE_STRIDE=3 \
 *     EXHAUSTIVE_NAME_K=3 EXHAUSTIVE_CONFIG_MODE=cross \
 *     EXHAUSTIVE_SHARD=$i/12 \
 *     ../../node_modules/.bin/vitest --run src/components/incrementalParse/spliceExhaustive.test.ts & done
 * `EXHAUSTIVE_CONFIG_MODE=cross` is the load-bearing one: without it the
 * gate would inherit CI's rotation and quietly stop being the full
 * cross-product the ledger claims it is. Measured: ~27 min/shard for the
 * fragment band plus ~6 min for the name band, ~45 min on the worst shard
 * at the recorded ×1.5 skew.
 * `EXHAUSTIVE_SHARD` scatters BOTH bands, so one set of shard processes
 * covers the whole leg. Knobs: `EXHAUSTIVE_CONFIGS` (label list) narrows
 * the catalog, `EXHAUSTIVE_ROTATE_SALT` moves the rotation slice,
 * `EXHAUSTIVE_RAW_FROZEN=0` turns P3 off, `EXHAUSTIVE_NAME_K=0` skips the
 * name band, `EXHAUSTIVE_NAME_STRIDE` is its own cut stride.
 */

import { describe, expect, test } from 'vitest';

import { computeFreezeBoundary, type FreezeScanCheckpoint } from './computeFreezeBoundary';
import { SCANNER_NAME_LISTS } from './scannerNameLists';
import { CATALOG, buildAdvanceOptions, type CatalogConfig } from './testPluginCatalog';
import { assertStreamEquivalence, fallbackOracleSampleFromEnv, runFull, testEnv } from './spliceArbiterHarness';
import { engineProbe, probeTailsFor, snapshotRawDisagreement, type NodeLike } from './conformanceOracles';
import { CONSTRUCT_AXIS_CLAIMED_SHAPES } from './constructAxisAdapters';
import { F20_CHAIN, SIGNATURE_DOMAIN, signatureValues } from './checkpointAbstraction';
import { soakBeat } from './soakHeartbeat';
import type { FreezeScanCheckpointInternal } from './computeFreezeBoundary';

/**
 * The FRAGMENT band: sub-line pieces that compose within a line.
 *
 * Hand-written, and staying that way — every entry is here because it
 * composes with another entry, which is a property of the pair rather than
 * of any list the scanner keeps. What was WRONG with hand-writing was
 * using it for the name axis too; that axis is derived below.
 */
const FRAGMENT_TOKENS = [
  'a',
  '\n',
  '\n\n',
  '\r\n',
  '[x]',
  '[x]: /u',
  '[x]: /u "t\nt2"',
  '`',
  '`<d>`',
  '<d>',
  '</d>',
  '<d',
  '</br>',
  '/>',
  '<!--',
  // Bare closers/openers so the census can COMPOSE the overlapping and
  // divergent terminators (`<!-->`, `<!--->`, `<?>`, and a stray `-->`
  // after them) instead of only ever seeing complete or bare-open forms
  // (2026-08 project review: every P1 lived in this gap).
  '>',
  '-->',
  '<?',
  // Unicode whitespace line + a bracket left open across a line break: the
  // v2.4.1 review P1 pair (JS `trim()` vs micromark space; per-line ref scan).
  '\u3000\n',
  '[x\n',
  '<![CDATA[<d>]]>',
  '<?p <b> ?>',
  '$$',
  '- ',
  ': ',
  '[^n]',
  '[^n]: y',
  '    ',
  '> ',
  '---',
  // The three states the BFS coverage report named as never reached, each
  // of which turned out to be an ALPHABET gap rather than an impossible
  // state — and the report says in its own output that it cannot tell those
  // apart, so the only way to find out was to add the token and look.
  //
  // These are not BFS-only: `FRAGMENT_TOKENS` is the fragment census's
  // alphabet too, so before this the GATE had never built a GFM table, and
  // `tableMaybeOpen` — a conjunct of the seal-release predicate — was
  // reached by nothing in the repo. A bare declaration and a bare CDATA
  // opener are the same story one layer down: the complete
  // `<![CDATA[<d>]]>` above closes on its own line, so its block state never
  // survives into a checkpoint and `mdBlock=html5` was unreachable by
  // construction.
  '<!A',
  '<![CDATA[',
  '| a |',
] as const;

/**
 * The NAME band's tag names, DERIVED from the scanner's own taxonomy at
 * test time — never transcribed.
 *
 * Two names are the same token iff they fall in the same cell of EVERY
 * list in `SCANNER_NAME_LISTS`. Nothing in the scanner can tell such a
 * pair apart, so sampling both buys nothing and costs a factor of the
 * alphabet size per K. Measured 2026-08-28: 91 names collapse to 16
 * classes, and the pairwise set-differences the review asked for fall out
 * as class boundaries rather than needing to be enumerated —
 * `TYPE1_NAMES \ RAW_TEXT_ELEMENTS` is the singleton class `{pre}`, which
 * is F13, and `RAW_TEXT_ELEMENTS \ TYPE1_NAMES` splits into `{noembed,
 * plaintext, xmp}`, `{iframe, noframes}` and `{title}` because the type-6
 * and scope-barrier lists cut across it.
 *
 * When an upstream `micromark-util-html-tag-name` bump moves a name, or
 * the scanner starts keying on a new list, the classes re-partition on the
 * next run and the corpus follows. That is the whole point of deriving it:
 * the previous alphabet named `<d>` and `</d>` — a made-up element in no
 * list at all — and could not have reached `pre` if it tried.
 *
 * SELF-CERTIFICATION, named rather than left implicit. A derived alphabet
 * inherits the blind spots of the list it derives from: a name that is
 * WRONG in `TYPE1_NAMES` is equally absent from the corpus meant to catch
 * it. That is F13 moved up one level, and it is worse than transcription
 * error in one specific way — it looks rigorous. So, as of 2026-08-29:
 *
 *   FALSIFIED against measured grammar behaviour by `constructAxisProbe`,
 *   over candidate pools WIDER than the lists themselves, so a missing
 *   name reds and not only an extra one. As of 2026-08-29 that is ALL EIGHT
 *   — `type1`, `rawText`, `type6`, `void`, `noElement`, `tablePart`,
 *   `scopeBarrier`, `foreignRoot` — and the dangerous direction is empty on
 *   every one of them. Deriving the alphabet from these lists is therefore
 *   no longer self-certifying, which was this paragraph's standing caveat
 *   for two releases.
 *
 *   `void`'s three known omissions (`basefont`, `bgsound`, `keygen`) joined
 *   the list with the derived-seal batch, and this paragraph went on
 *   describing them as open for a release — the probe's own assertion had
 *   already moved to `missingFromList: []`.
 *
 *   What each probe CANNOT decide is named in its own assertion rather than
 *   folded into a pass: `scopeBarrier` leaves four names undecidable
 *   (`select`, `table`, `template`, `title`) because raw text swallows the
 *   end tag or foster parenting hides the marker, and three more measured
 *   transparent whose barrier role needs a `<table>` ancestor that answers
 *   the scope walk before they can. All of those are the over-blocking
 *   direction. F19 lived on `scopeBarrier`, and the probe that would have
 *   caught it now sees a barrier through each of the three namespaces it
 *   models — asserted per context, so an empty dangerous set means "none
 *   found" rather than "nothing asked".
 *
 *   `documentStructure` left that group with F28, in the only way a list
 *   can: every one of its members is now asserted, by measurement, to be a
 *   member of `noElement` — which is the property the scanner actually acts
 *   on. What stays unfalsified is its INTERNAL boundary, i.e. which
 *   no-element names arrive through "in template" rather than through the
 *   other two mechanisms. Nothing reads that distinction any more; since
 *   F28 the list has no behavioural use at all beyond seeding `noElement`,
 *   and it stays in `SCANNER_NAME_LISTS` only because dropping it would
 *   COARSEN this partition, which is the wrong direction to move a corpus
 *   for tidiness.
 *
 * LIMIT, stated because it bounds what a green run means: this equivalence
 * is the SCANNER's, not parse5's. `address` and `form` share a class here
 * and behave differently in parse5's tree construction — `form` is the
 * counterexample that refuted the (P) enumeration. Rule differences of
 * that kind are SHAPES, not names (`</script/>` differs from `</script>`
 * by a rule, not by a name); `SHAPE_TOKENS` below carries them, so the two
 * axes sit in one alphabet without either pretending to cover the other.
 */
const NAME_CLASS_REPS: readonly string[] = (() => {
  const universe = new Set<string>();
  for (const [, names] of SCANNER_NAME_LISTS) for (const name of names) universe.add(name);
  const byCell = new Map<string, string>();
  // Sorted so the representative is the lexicographically smallest member:
  // a stable choice that does not depend on Set iteration order, so the
  // corpus is reproducible across runs and across engines.
  for (const name of [...universe].sort()) {
    const cell = SCANNER_NAME_LISTS.map(([, names]) => (names.has(name) ? '1' : '0')).join('');
    if (!byCell.has(cell)) byCell.set(cell, name);
  }
  return [...byCell.values()].sort();
})();

/**
 * The construct-axis SHAPE tokens — the other half of the alphabet.
 *
 * A set difference over name lists yields NAMES. It cannot yield
 * `</script/>` versus `</script>`, which differ by a RULE: the stray slash
 * fails CommonMark's type-1 end condition while parse5 tokenizes the tag
 * anyway. That is the axis F16, F17 and F20 lived on, and no amount of
 * name derivation reaches it. `constructAxisAdapters.ts` MEASURES those
 * cells against both grammars and publishes the result.
 *
 * `CLAIMED`, not `DISAGREEING`, and the difference is the point.
 * `CONSTRUCT_AXIS_DISAGREEING_SHAPES` is 48 shapes (measured 2026-08-28;
 * it was 55 until seven `plaintext` closers were removed as a correctness
 * fix, so do not treat any count here as stable), of which 33 are type-6
 * normality — micromark's html block ends at a blank line, parse5's
 * element ends at its own end tag, and the two disagreeing about that is
 * the design working. The 15 CLAIMED shapes are the ones a scanner member
 * asserts the grammars AGREE on when they do not, which is F20's family.
 * At 15 the alphabet grows 38 → 53 and the band costs ~1.9× at K=2; at 48
 * it would grow to 86 and cost roughly ×10 at K=3, for tokens whose
 * disagreement is already understood. Weight, not volume.
 *
 * Nothing here PINS either count — the import is by name and the alphabet
 * size is derived — which is why the upstream shrink cost this file
 * nothing but a stale sentence.
 *
 * Every token in this band is a WHOLE NUMBER OF LINES, which is what makes
 * the newline-carrying shapes (`'</script\n>'`, from the `newline`
 * operator) safe to include rather than a trap: appending `'\n'` makes
 * that one two lines instead of one, and two lines is still a legal token
 * here. Splitting or dropping them would remove exactly the wrapped-tag
 * case the operator exists to produce.
 */
const SHAPE_TOKENS: readonly string[] = CONSTRUCT_AXIS_CLAIMED_SHAPES.map((shape) => `${shape}\n`);

/**
 * The NAME band's alphabet: LINE-shaped, one construct per token.
 *
 * Line granularity is where the reach comes from. The fragment band spends
 * tokens on the newlines between constructs — `'a'`, `'\n'`, `'\n\n'` — so
 * a three-line document costs five or six of its K. Here every token is a
 * whole line, so K=3 buys three lines — the 2026-08-27 review put F19's
 * shape at K=5-6 in fragment tokens and K=3 in line tokens.
 *
 * The markdown lines are not decoration: a scope barrier's second
 * consequence is that it discards the end tags MARKDOWN generates, so a
 * pure tag alphabet cannot reach it. `'> x\n'` and `'- x\n'` are the
 * generators; the blank line is what ends every block type but type 1.
 */
const NAME_CLASS_TOKENS: readonly string[] = [
  ...NAME_CLASS_REPS.flatMap((name) => [`<${name}>\n`, `</${name}>\n`]),
  ...SHAPE_TOKENS,
  '\n',
  'x\n',
  '- x\n',
  '> x\n',
  '[a]: /u\n',
  '```\n',
];

/**
 * CI DEFAULT vs GATE, and the defaults here are the CI half.
 *
 * A PR check that costs half an hour gets skipped, then disabled, then
 * deleted, and the budget is RUNNER wall clock — ~3 minutes there, which
 * is ~60-90 s here. Six configs and P3 took the old K=3 default to 709 s;
 * K=2 crossed still cost 154 s local, i.e. 5-8 min on a runner. So the
 * default is K=2 with the configs rotated: 26 s here.
 *
 * DEPTH and BREADTH pay; the PROPERTY does not. P3 stays because it is the
 * part that sees what the old leg structurally could not, and its cost is
 * per DOCUMENT rather than per schedule, so it is the cheapest thing here
 * to keep. See the header for what that leaves to the gate alone, and read
 * that list before treating a green CI as the whole claim.
 */
const MAX_K = Number(testEnv('EXHAUSTIVE_K') ?? 2);
/** Fallback-frame oracle sample denominator; 1 unless FALLBACK_ORACLE_SAMPLE
 *  is set (the soak passes 20). About 97% of census frames are fallbacks.
 *  See the harness header. */
const FALLBACK_SAMPLE = fallbackOracleSampleFromEnv();
/** Cut-schedule stride: CI samples every 3rd cut at K=3; deep runs set
 *  EXHAUSTIVE_STRIDE=1 for the full census. K≤2 is always full. The ≈40 s
 *  this comment used to quote predates six-config coverage and P3 — see
 *  the header for current costs. */
const CUT_STRIDE = Number(testEnv('EXHAUSTIVE_STRIDE') ?? (MAX_K >= 3 ? 3 : 1));
/**
 * Deep-run parallelism: a census is ONE vitest test — one worker, one
 * core. `EXHAUSTIVE_SHARD=i/N` makes this process drive a deterministic
 * 1/N hash-scatter of the documents, so N shard processes launched side
 * by side cover the space in ~1/N wall-clock:
 *   for i in $(seq 0 11); do EXHAUSTIVE_K=4 EXHAUSTIVE_SHARD=$i/12 … & done
 * The assignment hashes the doc counter instead of taking `docs % N`:
 * the counter is an odometer in base `tokens.length`, and whenever the
 * alphabet size shares a factor with N the high digits vanish from the
 * residue (30² ≡ 0 mod 12), leaving shard membership a function of the
 * LAST tokens only. Token identity drives per-doc cost (length² via the
 * cut count, ×2 configs on `: `), so that correlation produced a stable
 * ×1.5 wall-clock skew across census shards (measured 2026-08-24).
 * The doc/schedule counters still count the whole space walk, so the
 * sanity floors scale by TOTAL below.
 *
 * THE GENERAL RULE, because this trap has now been walked into twice in
 * this one file and it fails SILENTLY both times: any modulo taken over a
 * counter that advances with the enumeration inherits the enumeration's
 * periodicity. The odometer's last digit ticks once per document and so
 * does the counter, so `counter % N` is congruent to `lastTokenIndex % N`
 * up to a constant — and the moment `N` shares a factor with the alphabet
 * size, the selection becomes a function of the final token.
 *
 * Second host, `EXHAUSTIVE_CONFIG_MODE=rotate` (2026-08-28): the obvious
 * `docs % CONFIGS.length` would have pinned each config to a residue class
 * of the last token, and with 30 tokens against 6 configs three cells
 * would never once have seen a document ending in `'---'`. It would have
 * looked like working six-config coverage forever, because nothing about a
 * green run says which cells the documents actually reached. First host
 * only skewed wall-clock; this one would have silently halved the corpus.
 *
 * So: hash, never modulo, and use different multipliers and different bits
 * per selection so two hashed selections do not correlate with each other
 * either.
 */
const [SHARD_INDEX, SHARD_TOTAL] = (() => {
  const raw = testEnv('EXHAUSTIVE_SHARD');
  if (!raw) return [0, 1];
  const m = /^(\d+)\/(\d+)$/.exec(raw);
  if (!m) throw new Error(`EXHAUSTIVE_SHARD must be i/N, got ${JSON.stringify(raw)}`);
  const [i, n] = [Number(m[1]), Number(m[2])];
  if (n < 1 || i >= n) throw new Error(`EXHAUSTIVE_SHARD out of range: ${raw}`);
  return [i, n];
})();
/**
 * CONFIG COVERAGE — the whole catalog, not a curated pair.
 *
 * Until 2026-08-28 this leg drove `baseline` always and `def-list-only`
 * only when the document happened to contain `': '` — 2 of 6 catalog
 * cells, and one of those conditionally. F20 is what that hole costs: it
 * diverged on 100% of engaged frames on 3 of the 6 cells, and reading the
 * six-config aggregate instead of the per-cell rates made it look like
 * noise. A census that fixes the plugin selection is not a census of the
 * shipped configuration space.
 *
 * `EXHAUSTIVE_CONFIGS` narrows it back for cost experiments (a
 * comma-separated label list); the default is every cell.
 *
 * HOW the cells are spent is a separate knob, `EXHAUSTIVE_CONFIG_MODE`.
 * `cross` runs every document against every config — the honest
 * cross-product. `rotate` runs each document against ONE, so the corpus
 * still covers all six at a sixth of the cost.
 *
 * `rotate` is the CI DEFAULT; the gate passes `cross` (decided
 * 2026-08-28, after measuring that the crossed K=2 corpus costs 154 s
 * locally and so 5-8 minutes on a shared runner — over budget). The
 * division of labour: CI is a regression NET, the gate is the PROOF.
 * "Every document under every shipped configuration" is a claim worth
 * making every release at full cross-product and not worth five
 * runner-minutes on every push.
 *
 * Rotation is the right shape for a budget cut because the other way to
 * fit one is picking two cells by hand — the curation this whole change
 * removes. It is a real reduction and not a free lunch: a defect needing a
 * SPECIFIC document under a SPECIFIC config drops from certainty to a 1/6
 * chance per document. F20's shape (100% of engaged frames on 3 of 6
 * cells) survives any 1/6 slice; a hand-picked pair can miss it outright.
 *
 * The slice is FIXED, not a sample that moves between runs. The assignment
 * hashes the document counter, so the same corpus yields the same
 * document→config map every time: CI's blind fifth-sixth is the SAME
 * fifth-sixth on every push, and "eventually everything gets covered" is
 * not true of it. `EXHAUSTIVE_ROTATE_SALT` shifts the map and is echoed in
 * the readout, so setting it to the CI run number turns that fixed blind
 * spot into a rotating one while a failure stays reproducible from the
 * printed salt. It is a deployment choice rather than a default: a corpus
 * that changes underneath you cannot be bisected, and this leg is the one
 * whose whole value is being able to say exactly what it covered.
 */
const CONFIG_MODE = (() => {
  const raw = testEnv('EXHAUSTIVE_CONFIG_MODE') ?? 'rotate';
  // THROW on anything else, because the failure is silent and one-directional:
  // an unrecognised value falls through to rotate, which is the WEAKER mode,
  // and the gate is where this variable is typed by hand. `Cross`, `crossed`
  // or a stray space would downgrade a release gate to a CI run while every
  // log line still said the leg passed. `EXHAUSTIVE_SHARD` and
  // `EXHAUSTIVE_CONFIGS` have thrown on bad input since they were written;
  // this one was the odd one out.
  if (raw !== 'cross' && raw !== 'rotate') {
    throw new Error(`EXHAUSTIVE_CONFIG_MODE must be 'cross' or 'rotate', got ${JSON.stringify(raw)}`);
  }
  return raw;
})();
const ROTATE_SALT = Number(testEnv('EXHAUSTIVE_ROTATE_SALT') ?? 0);
const CONFIGS = (() => {
  const raw = testEnv('EXHAUSTIVE_CONFIGS');
  if (!raw) return CATALOG;
  const wanted = raw.split(',').map((s) => s.trim());
  return wanted.map((label) => {
    const hit = CATALOG.find((c) => c.label === label);
    if (!hit) throw new Error(`EXHAUSTIVE_CONFIGS: no catalog config labelled ${JSON.stringify(label)}`);
    return hit;
  });
})();
/**
 * P3 costs ~13 raw-layer parse PAIRS per document that carries a boundary.
 * That is per DOCUMENT, not per schedule, so it is flat in the cut stride
 * while P1/P2 scale with it: measured at K=3 over six configs, P3 adds
 * 244 s to a 372 s sweep at stride 3 (66% overhead) but to a ~1100 s sweep
 * at stride 1 (22%). The gate runs at stride 1, so P3 rides along there
 * cheaply and this switch exists for cost experiments rather than for the
 * gate. `EXHAUSTIVE_RAW_FROZEN=0` turns it off.
 *
 * "The gate runs at stride 1" was FALSE for one release and this comment did
 * not notice, which is the only interesting thing about it: `soak.sh`
 * defaulted `CENSUS_STRIDE` to 3 between 2026-08-28 and 2026-08-29 while
 * three sentences here went on describing full-stride as a gate property. A
 * cost argument that names a setting has to be checked against the script
 * that passes it — the script is the fact, this is a claim about the script.
 */
const RAW_FROZEN = (testEnv('EXHAUSTIVE_RAW_FROZEN') ?? '1') !== '0';
/**
 * Scale the vitest timeout with K — K=4 is ~24× K=3.
 *
 * The floor was 600 s against a ~50 s strided K=3 run. Six configs and P3
 * took that same run to 616 s local and 668 s on a loaded machine, so the
 * floor started failing the band BY MARGIN — caught 2026-08-28 on a
 * contended run, which is the same failure this comment already recorded
 * once ("a 150 s run tripped a 120 s floor in CI while two earlier runs
 * squeaked under"), reintroduced by growing the work and leaving the
 * backstop alone. A timeout is a backstop, not a budget: it must clear the
 * SLOWEST honest run, and GitHub's shared runners are 2-3× slower than
 * this machine. 3600 s at K=3 is ~6× the local measurement, restoring the
 * margin the original floor had.
 *
 * The formula ignores `EXHAUSTIVE_SHARD`, which divides the real work by
 * up to 12 — deliberately, since a shard that hangs should still be killed
 * by something.
 */
const TIMEOUT_MS = Math.max(3_600_000, 900_000 * 24 ** Math.max(0, MAX_K - 3));

/**
 * The NAME band's own depth. It defaults to 2, not 3, and the reason is
 * the alphabet's size rather than timidity: the derived alphabet is ~38
 * tokens, so K=3 is 55k documents against the fragment band's 27k, but
 * each document is three LINES instead of a handful of characters, and the
 * cut count grows with length. Measured cost is in the commit message.
 * `EXHAUSTIVE_NAME_K=3` is the deep setting; `0` skips the band.
 */
const NAME_K = Number(testEnv('EXHAUSTIVE_NAME_K') ?? 2);
/** The name band's own cut stride. The DEFAULT thins to every third cut at
 *  K>=3 because that is CI's budget; the release gate passes 1 explicitly
 *  (`CENSUS_NAME_STRIDE` in `soak.sh`) and has since 2026-08-29. Measured
 *  on one shard at K=3 cross: 397 s at stride 3 against 1077 s at stride 1,
 *  for 936k against 2.62M cut schedules.
 *
 *  Note the shape of that sentence, because the file got it wrong once about
 *  the OTHER stride: this describes the default and names the script that
 *  overrides it. A comment here cannot know what the gate passes — only the
 *  script does — so it may say what the default is and where to look, never
 *  what the gate runs. */
const NAME_STRIDE = Number(testEnv('EXHAUSTIVE_NAME_STRIDE') ?? (NAME_K >= 3 ? 3 : 1));
/** Same doctrine as `TIMEOUT_MS`, from this band's own measurements: 161 s
 *  at K=2 and 2919 s at K=3 (contended, unsharded). 1800 s at K=2 is ~11×
 *  the measurement; the ×40 step per K is the alphabet growth. */
const NAME_TIMEOUT_MS = Math.max(1_800_000, 900_000 * 40 ** Math.max(0, NAME_K - 2));

/**
 * The census readout, on the real stream.
 *
 * `console.log` is DROPPED — verified 2026-08-28 by putting a bare
 * `console.log` in a passing test in this package and getting nothing on
 * either stream. This leg reported through `console.log`, so every
 * `[census]` line has been invisible since the vitest 4 upgrade, including
 * the engagement ratios the anti-vacuity floors are tuned against. The
 * cast is needed because the engine package takes no `@types/node` and its
 * `process` shim (`src/typings/shims.d.ts`) deliberately exposes only
 * `env`; widening that shim would hand production code a Node global the
 * package is built not to have.
 */
const emit = (line: string): void => {
  (process as unknown as { stdout?: { write(text: string): void } }).stdout?.write(line);
};

/** Code-point-safe cut: never split a surrogate pair. */
const alignCut = (doc: string, at: number): number => {
  const code = doc.charCodeAt(at - 1);
  return code >= 0xd800 && code <= 0xdbff ? at + 1 : at;
};

/**
 * P3 — RAW-LAYER FROZEN-REGION INVARIANCE, and the reason this leg is not
 * only about splices.
 *
 * P1 and P2 both require the incremental path to ENGAGE: P1 compares a
 * spliced frame against a full parse, P2 compares a resumed scan against a
 * fresh one. A document whose hosts never engage is swept, driven, and
 * proves nothing about the scanner's claim — the aggregate engagement
 * floor below measures ~3%, so ~97% of this census's documents were
 * carrying P1/P2 vacuously. F19's block hosts are exactly that shape
 * (inc=0 on every frame), so this leg would have missed F19 at any depth
 * with any alphabet. That is not an alphabet hole; it is a property hole.
 *
 * P3 closes it by asserting the scanner's claim DIRECTLY: bytes
 * `[0, boundary)` are settled, so every positioned node the raw layer puts
 * below the boundary must survive an arbitrary append unchanged. No splice
 * is involved, so engagement is irrelevant.
 *
 * Two deliberate choices:
 *  - The tails come from `probeTailsFor`, which appends prefix-COLLIDING
 *    material (an element name the prefix opened, a link/footnote label it
 *    used) on top of the static hazard battery. A static list cannot know
 *    what a given census document collides with.
 *  - The comparison is `snapshotRawDisagreement`, not the prefix-anchored
 *    `frozenRegion` shape in `boundaryDirection.test.ts`. That one pops
 *    trailing position-less children before comparing, justified in prose
 *    — structurally the F21 instrument defect, and sitting on the very
 *    seam class F15/F16/F17 lived in. The snapshot form needs no such
 *    carve-out: its one exemption (footnote-definition bytes) is computed
 *    from the INPUT document's own bytes and applied to BOTH sides. Its
 *    stated scope limit — position-less nodes are invisible to it — is
 *    inherited knowingly and pinned by the anti-vacuity readout below,
 *    which fails the sweep if P3 ever stops comparing nodes.
 *
 * WHAT IT REPORTS TODAY, so a non-empty `fired` count is not a surprise
 * to whoever reads the next run. At the CI point — fragment K=3, name K=2
 * — both bands are clean: `fired=0` on 285357 and 8151 probe positions
 * respectively. At `EXHAUSTIVE_NAME_K=3` the name band fires, and the
 * minimal shape is `"</address>\n</address>\n\n"`: the scanner freezes all
 * 23 bytes, and the raw text node at 10-11 grows from `"\n"` to `"\n\n"`
 * under any append. parse5 discards both stray end tags — nothing of that
 * name is open, so "any other end tag" walks the stack and drops it — and
 * the text on either side merges, BELOW the boundary. `</table>`,
 * `</script>`, `</b>` and `</d>` all do it; a single stray end tag does
 * not, and neither does the balanced `<address>…</address>` control.
 *
 * The defect is in the KEYING, not in `</address>`. parse5 discards every
 * end tag with no matching open element, by one rule; the scanner poisons
 * for the resulting retroactive text-merge on four NAMES
 * (`DOCUMENT_STRUCTURE_NAMES`), which are four instances of an unbounded
 * class. That is the third defect of this shape after F19 and F20.
 *
 * Shipped output does not diverge, and the reason is worth stating
 * precisely, because the obvious reading of it is wrong. `inc=false` on
 * all 14 probe tails does NOT mean the splice cannot engage on documents
 * carrying this ingredient: `"x\n\n</address>\n</address>\n\n"` engages
 * 10-11 of 26 byte-by-byte frames on every config, and
 * `"</address>\n</address>\n\nx\n\ny\n"` engages 20 of 20 tail frames —
 * both with zero divergence. What holds — across a 28-document × 6-config
 * × 20-tail battery, FOR THIS MECHANISM, which is as far as the claim
 * goes — is that engagement and firing were disjoint: the gate fires only
 * while the boundary sits at EOF with a trailing blank whose text node can
 * still grow, and the splice engages only once settled content follows
 * that blank. The edit that gives the splice something to reuse is the
 * edit that settles the node.
 *
 * Do NOT generalise that to the trigger class. F23 in GRAMMAR-COVERAGE is
 * a different mechanism under the SAME `boundary == document length`
 * trigger — a PI's residue text node absorbing the seam newline — and
 * there the splice engages on 12 of 14 probes under `display-only` with
 * shipped output correct every time. So the class demonstrably contains
 * engaging members; this mechanism's members happen not to be, on the
 * documents reachable so far. The narrowness is a property of the splice's
 * current appetite, not of the scanner's claim, which is why this is
 * recorded rather than dismissed. Reported to the scanner's owner rather
 * than fixed here; a scanner change needs the soak gate.
 *
 * NOT done here, and why: `oracleCheckDoc` follows each document with a
 * ZERO-DISTANCE variant — the claimed prefix re-run as a document of its
 * own, so probes land directly on the boundary instead of behind the real
 * tail. It would double P3's cost, and a census gets most of it for free:
 * the corpus is every token sequence of length ≤ K, so a prefix that ends
 * at a token boundary IS already a shorter document in the same corpus,
 * probed at zero distance there. What that argument does NOT cover is a
 * boundary landing mid-token, which is where it stops being free.
 */
function driveRawFrozen(doc: string, config: CatalogConfig, stats: RawFrozenStats): void {
  const { defListEnabled } = buildAdvanceOptions(config);
  const boundary = computeFreezeBoundary(doc, { defListEnabled }).boundary;
  if (boundary <= 0) return;
  stats.boundaries += 1;
  const positionsOnEntry = stats.positions;
  const docMdast = runFull(doc, config).mdast as NodeLike;
  for (const probe of probeTailsFor(doc.slice(0, boundary))) {
    // An empty tail compares `raw(doc)` against itself: it cannot fire, and
    // counting it would pad the anti-vacuity readout with positions that
    // assert nothing.
    if (probe.tail === '') continue;
    const snap = snapshotRawDisagreement(doc, probe.tail, boundary, config, docMdast);
    stats.probes += 1;
    stats.nodesCompared += snap.nodesCompared;
    if (snap.nodesCompared > 0) stats.positions += 1;
    if (snap.detail === null) continue;
    stats.fired += 1;
    // The raw firing is the DETECTION. The VERDICT is what the engine
    // ships, measured independently for this exact position — and this is
    // not an exemption for the instrument, which drops nothing and gets no
    // allowlist. The system's safety contract is the scanner's boundary
    // AND the splice-side guards together (`headRoutedCaptureUnclosed`,
    // the stray-tag bail, seam synthesis), so a boundary the raw layer
    // refutes is a real scanner fault that a guard may already be
    // absorbing. Measured 2026-08-28 on `"</address>\n</address>\n\n"`:
    // the raw gate fires on 13 of 14 probe tails under `baseline`,
    // `display-only` and `no-orphan`, and the engine diverges on NONE of
    // them because the splice refused every one (inc=false on 14 of 14) —
    // the stray end tags in the frozen prefix trip the bail. Failing the
    // suite on that would be reporting a guard doing its job.
    //
    // So: engine divergence FAILS; a raw-only firing is counted and its
    // shape recorded, because a latent under-block masked by a guard is
    // exactly the thing that ships the day the guard is relaxed.
    const engine = engineProbe(doc, probe.tail, config);
    if (engine.usedIncremental) stats.firedEngaged += 1;
    // COLLECT, do not throw. A census is a 10-to-60-minute run; stopping at
    // the first firing spends all of it to learn one shape, and the triage
    // question is always "how many distinct shapes, and does the shipped
    // engine diverge on each" — an aggregate over one sample cannot answer
    // it. Deduped by probe and by the signature of the node that moved, so
    // one grammar fault reported by ten thousand documents shows up once.
    const line =
      `doc=${JSON.stringify(doc)} config=${config.label} probe=${probe.id} ` +
      `inc=${engine.usedIncremental} — ${snap.detail}` +
      (engine.disagreement === null ? '' : `\n    ENGINE: ${engine.disagreement}`);
    if (engine.disagreement !== null) {
      stats.defects += 1;
      if (stats.defectSamples.length < MAX_SAMPLES) stats.defectSamples.push(line);
      continue;
    }
    // The key is (config, moved node) and deliberately NOT (config, probe,
    // moved node). Keying on the probe was the first version and it wasted
    // the whole sample budget: one document fires on ~13 of its 14 tails
    // with an identical signature, so 20 slots held ONE document and a half
    // instead of twenty distinct positions. The probe that revealed a
    // firing is triage colour; the node that moved is the finding.
    const key = `${config.label}|${snap.detail.slice(0, 96)}`;
    if (stats.seen.has(key) || stats.samples.length >= MAX_SAMPLES) continue;
    stats.seen.add(key);
    stats.samples.push(line);
  }
  // Per-DOCUMENT blindness, counted after every probe for this document.
  // The corpus-wide density below cannot see a blinding that takes out
  // whole documents while leaving others rich, which is the shape the
  // oracle leg's `fullyBlindDocs` was added for; this leg runs the same
  // gate over ~20× more documents and had only the corpus-wide form.
  stats.documentsProbed += 1;
  if (stats.positions === positionsOnEntry) stats.fullyBlindDocs += 1;
}

interface RawFrozenStats {
  /** Documents whose scanner granted a non-zero boundary. */
  boundaries: number;
  /** Non-empty probe tails driven against those boundaries. */
  probes: number;
  /** Probe positions where at least one frozen node was compared. */
  positions: number;
  /** Documents P3 actually probed — i.e. the scanner granted a boundary. A
   *  document with boundary 0 is not counted: the gate cannot fail to check
   *  a claim that was never made. Same scope limit as the oracle leg's
   *  counter, and it hides the same thing — a blinding that ALSO suppresses
   *  the boundary. */
  documentsProbed: number;
  /** Of `documentsProbed`, the ones where NO probe position compared a
   *  single node. See the floor in `reportAndAssert`. */
  fullyBlindDocs: number;
  /** Frozen nodes compared, summed — a gate that compares nothing passes
   *  everything. */
  nodesCompared: number;
  /** Probe positions where a frozen node did not survive the append. */
  fired: number;
  /** Of `fired`, the ones where the splice actually engaged — the number
   *  that says how close the masked population is to shipping. */
  firedEngaged: number;
  /** Of `fired`, the ones where the SHIPPED engine also diverged. Any of
   *  these fails the census. */
  defects: number;
  defectSamples: string[];
  /** Deduped raw-only firings, capped at MAX_SAMPLES. */
  samples: string[];
  seen: Set<string>;
}

/** Enough distinct shapes to tell "one fault, many documents" from "a
 *  family"; small enough that a failure message stays readable. */
const MAX_SAMPLES = 20;

function drive(doc: string, cuts: number[], config: CatalogConfig): { frames: number; incrementalFrames: number } {
  const snapshots: string[] = [];
  for (const cut of cuts) {
    const end = Math.min(doc.length, alignCut(doc, cut));
    if (end > 0 && (snapshots.length === 0 || end > snapshots[snapshots.length - 1].length)) {
      snapshots.push(doc.slice(0, end));
    }
  }
  if (snapshots.length === 0 || snapshots[snapshots.length - 1] !== doc) snapshots.push(doc);

  // P1 — the arbiter throws with a labeled diff on any mismatch. The
  // engagement floor is an AGGREGATE over the whole census (asserted at the
  // end of the sweep): most short token sequences legitimately poison to
  // boundary 0, so a per-schedule floor would fight the alphabet.
  const stats = assertStreamEquivalence(
    () => `exhaustive doc=${JSON.stringify(doc)} cuts=${JSON.stringify(cuts)}`,
    snapshots,
    config,
    { minIncrementalFrames: 0, fallbackOracleSample: FALLBACK_SAMPLE }
  );

  // P2 — resumed scan ≡ fresh scan, own lineage.
  //
  // WHAT P2 DOES NOT LICENSE, written here because this is where anyone
  // looking for the licence will land. The loop below is LINEAR: one
  // checkpoint, one successor, the shape a stream has. A checkpoint is
  // CONSUMED by the call it is passed to — `computeFreezeBoundary` returns
  // the very object it was handed, with `confirmedOffset` advanced in
  // place — so passing one checkpoint to two calls resumes the second from
  // a state the first already moved. P2 says nothing about that, and
  // saying "resumed equals fresh" without the word LINEAR invites exactly
  // the reading that it does.
  //
  // The state-directed search below hit it: one node, 83 children, one
  // checkpoint. It scans fresh now. Anyone building a second search, a
  // speculative parse, or a retry that re-passes a checkpoint it already
  // passed needs to clone first, and the shape to clone is documented as
  // changing between minor versions. Audited 2026-08-28 — every other
  // resume in the repo is a linear loop, and `MarkdownContent`'s catch
  // already nulls its state ref for this exact reason.
  const defListEnabled = config.defList;
  let checkpoint: FreezeScanCheckpoint | null = null;
  for (const snapshot of snapshots) {
    const fresh = computeFreezeBoundary(snapshot, { defListEnabled });
    const resumed = computeFreezeBoundary(snapshot, { defListEnabled }, checkpoint);
    if (resumed.boundary !== fresh.boundary) {
      expect.fail(
        `resume/fresh divergence doc=${JSON.stringify(doc)} len=${snapshot.length}: resumed=${resumed.boundary} fresh=${fresh.boundary}`
      );
    }
    checkpoint = resumed.checkpoint;
  }
  return stats;
}

interface SweepStats {
  docs: number;
  schedules: number;
  frames: number;
  incrementalFrames: number;
  rawFrozen: RawFrozenStats;
}

/** Walk every token sequence of length 1..maxK, driving P1/P2 over the cut
 *  schedules and P3 once per document, under every config.
 *
 *  `band` names the sweep in its progress heartbeat. The denominator is the
 *  odometer's own size, `sum(alphabet^k)` for k in 1..maxK, and the counter
 *  is `out.docs`, which advances on EVERY document including the ones this
 *  shard hashes away — so the percentage is progress through the shared
 *  walk, identical across shards, rather than a per-shard figure that would
 *  make twelve logs disagree about the same run. */
function sweep(band: string, tokens: readonly string[], maxK: number, stride: number): SweepStats {
  let planned = 0;
  for (let k = 1; k <= maxK; k++) planned += tokens.length ** k;
  const beat = soakBeat(band, planned);
  const out: SweepStats = {
    docs: 0,
    schedules: 0,
    frames: 0,
    incrementalFrames: 0,
    rawFrozen: {
      boundaries: 0,
      probes: 0,
      positions: 0,
      documentsProbed: 0,
      fullyBlindDocs: 0,
      nodesCompared: 0,
      fired: 0,
      firedEngaged: 0,
      defects: 0,
      defectSamples: [],
      samples: [],
      seen: new Set(),
    },
  };
  // Iterative odometer over sequence lengths 1..maxK.
  for (let k = 1; k <= maxK; k++) {
    const idx = new Array<number>(k).fill(0);
    for (;;) {
      out.docs += 1;
      beat.tick();
      // Multiplicative hash, HIGH bits: low bits of `docs * odd` depend
      // only on low bits of `docs`, which would re-import the odometer
      // correlation the hash exists to break.
      if ((Math.imul(out.docs, 0x9e3779b1) >>> 16) % SHARD_TOTAL !== SHARD_INDEX) {
        // Not this shard's document — advance the odometer without even
        // building the string.
        let s = k - 1;
        while (s >= 0 && ++idx[s] === tokens.length) {
          idx[s] = 0;
          s -= 1;
        }
        if (s < 0) break;
        continue;
      }
      const doc = idx.map((i) => tokens[i]).join('');
      // Rotation picks the config by a HASH of the document counter, not by
      // `docs % CONFIGS.length`, for the reason the shard comment above
      // gives and one worse: the counter advances in step with the LAST
      // token index, so under a plain modulo — with any alphabet size
      // sharing a factor with the catalog, and 30 shares 6 — the config
      // would be a deterministic function of the last token. Three cells
      // would then never see a document ending in `'---'`. Different
      // multiplier and different bits from the shard hash, so the two
      // selections stay independent.
      const configs =
        CONFIG_MODE === 'cross'
          ? CONFIGS
          : [CONFIGS[(Math.imul(out.docs + ROTATE_SALT, 0x85ebca6b) >>> 13) % CONFIGS.length]];
      for (const config of configs) {
        // P3 first: it is per-document, not per-schedule, and it does not
        // care whether anything below engages.
        if (RAW_FROZEN) driveRawFrozen(doc, config, out.rawFrozen);
        // 2-cut schedules: every interior cut point (strided in CI; the
        // k-1 stride offsets rotate so every cut is hit across nearby
        // docs rather than the same residue class every time).
        for (let cut = 1 + ((out.docs + k) % stride); cut < doc.length; cut += stride) {
          const s = drive(doc, [cut], config);
          out.frames += s.frames;
          out.incrementalFrames += s.incrementalFrames;
          out.schedules += 1;
        }
        // Deterministic 3-cut sample: thirds (adds a mid-stream resume).
        if (doc.length >= 3) {
          const s = drive(doc, [Math.floor(doc.length / 3), Math.floor((2 * doc.length) / 3)], config);
          out.frames += s.frames;
          out.incrementalFrames += s.incrementalFrames;
          out.schedules += 1;
        }
      }
      // Odometer increment.
      let d = k - 1;
      while (d >= 0 && ++idx[d] === tokens.length) {
        idx[d] = 0;
        d -= 1;
      }
      if (d < 0) break;
    }
  }
  beat.finish();
  return out;
}

/**
 * Shared reporting and anti-vacuity floors.
 *
 * The engagement floor is PER BAND, and by two orders of magnitude, because
 * the corpora engage at different rates by construction: a floor sitting on
 * the mean of both would clear a total collapse in the weaker one. That is
 * the same mistake the six-config aggregate made about F20, at a different
 * scale.
 */
function reportAndAssert(band: string, tokens: readonly string[], maxK: number, stride: number, s: SweepStats): void {
  // The sweep must actually have swept (guards against a silent early-out
  // if the odometer or alphabet is refactored). `docs` counts the whole
  // walk; `schedules` counts only this shard's driven work.
  expect(s.docs).toBeGreaterThanOrEqual(tokens.length ** maxK);
  expect(s.schedules * SHARD_TOTAL).toBeGreaterThan(s.docs);
  emit(
    `\n[census:${band}] K=${maxK} stride=${stride} fallbackOracleSample=${FALLBACK_SAMPLE} alphabet=${tokens.length} ` +
      `shard=${SHARD_INDEX}/${SHARD_TOTAL} configs=${CONFIGS.length}/${CONFIG_MODE}` +
      `${CONFIG_MODE === 'rotate' ? `+salt${ROTATE_SALT}` : ''} docs=${s.docs} ` +
      `schedules=${s.schedules} frames=${s.frames} incremental=${s.incrementalFrames} ` +
      `ratio=${(s.incrementalFrames / s.frames).toFixed(4)}\n` +
      `[census:${band}] P3 rawFrozen=${RAW_FROZEN ? 'on' : 'off'} boundaries=${s.rawFrozen.boundaries} ` +
      `probes=${s.rawFrozen.probes} positions=${s.rawFrozen.positions} ` +
      `nodesCompared=${s.rawFrozen.nodesCompared} ` +
      `blindDocs=${s.rawFrozen.fullyBlindDocs}/${s.rawFrozen.documentsProbed} ` +
      `blind=${s.rawFrozen.probes === 0 ? 'n/a' : (100 - (100 * s.rawFrozen.positions) / s.rawFrozen.probes).toFixed(1)}%\n` +
      `[census:${band}] P3 fired=${s.rawFrozen.fired} ofWhichEngaged=${s.rawFrozen.firedEngaged} ` +
      `engineDefects=${s.rawFrozen.defects} distinctRawShapes=${s.rawFrozen.samples.length}\n` +
      s.rawFrozen.samples.map((x) => `[census:${band}]   raw-only: ${x}\n`).join('')
  );
  if (s.rawFrozen.defects > 0) {
    expect.fail(
      `P3/${band} UNDER-BLOCK REACHED SHIPPED OUTPUT: ${s.rawFrozen.defects} of ${s.rawFrozen.fired} raw firings ` +
        `also diverged in the engine:\n` +
        s.rawFrozen.defectSamples.map((x) => `  ${x}`).join('\n')
    );
  }
  // Engagement floors, modelled on spliceFuzz's and measured 2026-08-28
  // over six configs. FRAGMENT: 48804/1693632 = 2.88% at K=3 stride 3, and
  // 933/91416 = 1.02% at K=2, where the documents are too short to carry a
  // candidate at all; 0.5% clears the smaller with 2× margin. NAME:
  // 396/301746 = 0.13% at K=2 — two orders of magnitude lower, because a
  // two-LINE document almost never leaves a confirmed blank line with
  // content after it, which is what a candidate needs. At that rate the
  // floor can only catch a TOTAL collapse, and saying so is better than
  // dressing 0.05% up as a coverage guarantee: the name band's real
  // anti-vacuity guard is P3's node density below, which does not care
  // whether anything spliced.
  expect(s.frames).toBeGreaterThan(0);
  expect(
    s.incrementalFrames / s.frames,
    `the ${band} census drove ${s.frames} frames and spliced ${s.incrementalFrames} — the path collapsed`
  ).toBeGreaterThan(band === 'fragment' ? 0.005 : 0.0005);
  // P3's own anti-vacuity floor. `probes` guards the outer loop (a refactor
  // that stops reaching `driveRawFrozen`, or an alphabet that stops
  // granting boundaries); the node DENSITY guards the instrument, which is
  // a SUBSET check and passes trivially wherever it compared nothing.
  //
  // Density, not the fraction of positions that compared something: most
  // probe positions here compare NO node — 83.4% of them in the fragment
  // band at K=3, 93.2% at K=2 — because a document a few tokens long
  // rarely has a positioned raw node lying wholly below its boundary. That
  // is a property of a small-scope corpus, not of a broken instrument, and
  // a positional floor tight enough to catch a blinded instrument would be
  // tripped by an alphabet change instead.
  //
  // Measured 2026-08-28, fragment band: 0.319 nodes per probe at K=3
  // cross, 0.127 at K=2 cross, and 0.0896 at the K=2 ROTATE CI default —
  // rotation lowers the density because each document contributes one
  // config's boundaries instead of six.
  //
  // The floor is 0.03, and it is NOT set by "whatever the default is". It
  // is set by the smallest density any RUNNABLE configuration produces,
  // which is the rotate one — and the reason it is 0.03 rather than 0.05
  // is the ROTATION SALT. A salt moves which sixth of the corpus each
  // config sees, so it moves the boundary population too: salts 0/1/2
  // measure 0.0896, 0.136 and 0.103. Three samples do not bound the
  // minimum over all salts, so the margin is taken against the worst
  // OBSERVED (0.0896) with room for unobserved ones — 3× rather than the
  // 1.8× that 0.05 would give. Anyone wiring `EXHAUSTIVE_ROTATE_SALT` to a
  // CI run number is varying this population on every run, and a floor
  // fitted tightly to three measured salts would be a flake source rather
  // than a guard.
  //
  // Do not read 0.03 against the 0.319 figure and conclude it is slack: it
  // is 3× the tightest configuration, not a tenth of the loosest. What it
  // has to catch is a total blinding (0/N — the shape a
  // root-children-only signature walk produced elsewhere in this
  // directory), and it catches anything within 3× of that.
  //
  // TWO PER-DOCUMENT FLOORS sit beside it, because the density above is
  // corpus-wide and a corpus-wide ratio cannot see either of the two ways
  // this instrument loses documents. Measured mutation it does not catch:
  // cutting P3's document REACH twentyfold leaves density ≈0.09, still 3×
  // over the floor, still green.
  //
  //  1. REACH — `documentsProbed` against the documents this shard swept.
  //     Measured 2026-08-28: 11.0% at the K=2 rotate CI default (fragment)
  //     and 2.24% (name), 14.3% at K=4 cross (fragment, shard 0/192) and
  //     7.7% at name K=3 cross. The floor is 1%, set from the smallest
  //     (2.24%) with margin; a twentyfold reach cut takes every one of
  //     those to 0.11-0.72% and reds.
  //  2. SIGHTED DOCUMENTS — documents where P3 compared at least one node,
  //     against those it probed. This is the `fullyBlindDocs` shape the
  //     oracle leg gates on, and its THRESHOLD DOES NOT TRANSFER: that leg
  //     requires blindness under 8%, while this corpus is 70-95% blind by
  //     construction (95.1% fragment / 90.6% name at the CI default, 76.9%
  //     / 71.3% at the gate) because a two-token document rarely has a
  //     positioned raw node lying wholly below its boundary. Copying 0.08
  //     here would have produced a floor that reds on every honest run —
  //     the mirror of the mistake it exists to prevent. Stated as its
  //     complement instead: at least 2% of probed documents must SEE
  //     something. Measured 4.9% / 9.4% at the CI default and 23.1% /
  //     28.7% at the gate, so 2% clears the tightest by 2.45× and a
  //     per-document blinding that takes the instrument to zero reds.
  //
  // Floor 2 is NEARLY REDUNDANT with the density floor on this corpus, and
  // saying so is the point of measuring it. Density ≈ sightedFraction ×
  // (nodes per sighted document ÷ probes per document), which is 2.04 ×
  // sightedFraction at the gate and 1.83 × at the CI default. Density reds
  // below a sighted fraction of ~1.6%, floor 2 below 2% — so floor 2 adds
  // detection only in that sliver, and every mutation actually planted
  // (2026-08-28) was caught by density first. It is kept because it states
  // the per-document claim DIRECTLY rather than inferring it from an
  // aggregate, and because the sliver widens as the corpus gets
  // node-richer with K. It is not independent coverage today; do not count
  // it twice.
  //
  // Floor 1, by contrast, is provably additive. Planted mutation: probe
  // only documents with boundary ≥ 9 (a reach cut biased toward PRODUCTIVE
  // documents). Result on the name band — reach 12/2862 = 0.42%, RED; and
  // it was invisible to the other two, which improved: density 0.75
  // against a 0.03 floor, blindness 66.7% against a baseline of 90.6%.
  //
  // WHAT NONE OF THE THREE CAN CHECK, stated because three floors agreeing
  // looks like corroboration and is not: density and floor 2 both derive
  // from `snap.nodesCompared`, the instrument's OWN report of how much it
  // compared. If that number were wrong they would be wrong together and
  // agree, which is the shape that let a whole-table pin miss a verdict bug
  // elsewhere this batch — the pin and the measurement shared one
  // expression. Floor 1 is the only one whose denominator comes from
  // somewhere else (the sweep's odometer, not P3's accounting), which is
  // also why it caught what the others could not. An independent check on
  // `nodesCompared` would mean re-deriving the frozen-node set outside
  // `snapshotRawDisagreement`; that is not done here, and until it is, the
  // honest reading of a green run is "the instrument says it looked",
  // not "the instrument looked".
  if (RAW_FROZEN) {
    expect(s.rawFrozen.probes, `P3/${band} drove no probe tails — the raw-layer property never ran`).toBeGreaterThan(0);
    expect(
      s.rawFrozen.nodesCompared / s.rawFrozen.probes,
      `P3/${band} drove ${s.rawFrozen.probes} probes and compared ${s.rawFrozen.nodesCompared} frozen nodes — the instrument went blind`
    ).toBeGreaterThan(0.03);
    // `s.docs` counts the WHOLE space walk; this process drove 1/SHARD_TOTAL
    // of it, times one config per document under rotation and all of them
    // under cross.
    const docConfigsDriven = (s.docs / SHARD_TOTAL) * (CONFIG_MODE === 'cross' ? CONFIGS.length : 1);
    expect(
      s.rawFrozen.documentsProbed / docConfigsDriven,
      `P3/${band} probed ${s.rawFrozen.documentsProbed} of ${Math.round(docConfigsDriven)} document-configs — its reach collapsed`
    ).toBeGreaterThan(0.01);
    expect(
      (s.rawFrozen.documentsProbed - s.rawFrozen.fullyBlindDocs) / s.rawFrozen.documentsProbed,
      `P3/${band} compared nothing at all on ${s.rawFrozen.fullyBlindDocs} of ${s.rawFrozen.documentsProbed} probed documents — ` +
        `a per-document blinding the corpus-wide density cannot see`
    ).toBeGreaterThan(0.02);
  }
}

// `EXHAUSTIVE_K=0` skips the band, symmetric with `EXHAUSTIVE_NAME_K=0` and
// `EXHAUSTIVE_BFS_DEPTH=0`. It did not, and the asymmetry was not documented
// anywhere: a cost experiment that set it got `expected 0 to be greater than
// or equal to 1` out of an anti-vacuity floor — a red that names neither the
// knob nor the cause, on a leg where a red is supposed to mean a defect.
// Found 2026-08-29 by walking into it while measuring the name band.
describe.skipIf(MAX_K === 0)(
  `splice exhaustive sweep (fragment band K=${MAX_K}, alphabet=${FRAGMENT_TOKENS.length})`,
  () => {
    test('all sequences × all 2-cuts (+ sampled 3-cuts)', { timeout: TIMEOUT_MS }, () => {
      reportAndAssert(
        'fragment',
        FRAGMENT_TOKENS,
        MAX_K,
        CUT_STRIDE,
        sweep('fragment', FRAGMENT_TOKENS, MAX_K, CUT_STRIDE)
      );
    });
  }
);

describe.skipIf(NAME_K === 0)(
  `name-class census (K=${NAME_K}, alphabet=${NAME_CLASS_TOKENS.length} from ${NAME_CLASS_REPS.length} classes)`,
  () => {
    test('every derived name-class line sequence', { timeout: NAME_TIMEOUT_MS }, () => {
      reportAndAssert(
        'name',
        NAME_CLASS_TOKENS,
        NAME_K,
        NAME_STRIDE,
        sweep('name', NAME_CLASS_TOKENS, NAME_K, NAME_STRIDE)
      );
    });
  }
);

// ── state-directed search ───────────────────────────────────────────────

/**
 * BFS over ABSTRACT SCANNER STATES, the third search shape in this file.
 *
 * The two censuses enumerate the token surface, and that surface is
 * bounded by token granularity rather than by K: F20's witness is eight
 * line-tokens, 30^8 ≈ 6.6e11, unreachable at any fundable depth with any
 * alphabet. This one grows prefixes, keys each on
 * `abstractSignature(checkpoint)`, and keeps at most `BFS_KEEP`
 * representatives of each NOVEL signature. Cost becomes linear in
 * REACHABLE ABSTRACT STATES instead of exponential in depth, so depth 8-12
 * costs about what K=4 costs the fragment band.
 *
 * DOMAIN COVERAGE, measured 2026-08-29 and worth stating because the
 * report's own caveat is that it cannot tell an alphabet gap from an
 * impossible state. At the default depth 2 the run leaves five declared
 * values unreached; at depth 3 it reaches **all 78**. So nothing in
 * `SIGNATURE_DOMAIN` is unreachable — the domain was written from the
 * scanner's type declarations rather than from any run, and it turns out
 * to contain no dead cells at all.
 *
 * Getting there took closing three ALPHABET gaps the report had named for
 * two releases (`mdBlock=html4`, `mdBlock=html5`, `tableMaybeOpen=1`); the
 * remaining two, both the `script` escape ladder and the three `3+` depth
 * buckets, were DEPTH gaps and needed no new token. Those are different
 * findings with different fixes, and the only way to tell them apart was to
 * add the token and look. A depth-2 run's unreached list should be read as
 * "not at this depth", not as a coverage claim.
 *
 * WHAT IT IS: a directed search. WHAT IT IS NOT: soundness-preserving.
 * Two prefixes with the same abstract signature can produce different
 * hast, so a property can hold on the representative and fail on the
 * prefix that was discarded. It finds things or it does not; it never
 * proves a state safe. `checkpointAbstraction.ts` carries the same
 * warning next to the abstraction, because that is where someone tempted
 * to read a green run as a proof will be standing.
 *
 * The scan profile, not the plugin catalog, is what shapes this space: the
 * scanner takes only `defListEnabled` (plus profile flags baked at
 * creation), so the two profiles are the whole state space, and the
 * per-config plugin selection matters only to the PROPERTIES run on the
 * representatives. Searching six configs would have cost 3× for nothing.
 */
/** Depth 2 costs 1.2 s and already reaches 1408 abstract states and both
 *  of F20's first two chain stages, so it is the CI default; depth 3 is
 *  25 s and 37184 states. `EXHAUSTIVE_BFS_DEPTH=0` skips the search. */
const BFS_DEPTH = Number(testEnv('EXHAUSTIVE_BFS_DEPTH') ?? 2);
const BFS_KEEP = Number(testEnv('EXHAUSTIVE_BFS_KEEP') ?? 3);
/** The search alphabet is BOTH bands: the fragment tokens compose
 *  sub-line constructs and the line tokens reach named elements, and a
 *  state search wants every transition it can get. */
const BFS_TOKENS: readonly string[] = [...FRAGMENT_TOKENS, ...NAME_CLASS_TOKENS];
/**
 * FRONTIER CAP, and it is reported rather than silent.
 *
 * Depth 4 without one exits 144 — the frontier and the `seen` map both
 * grow with distinct keys, and keying on the unconfirmed tail (necessary,
 * see the dedup key) multiplies them. A search that quietly truncates
 * would still print a coverage report, and that report would claim
 * everything it did not reach was unreachable. So the cap is counted, and
 * `clamped` rides in the readout next to the coverage numbers: a clamped
 * run's unreached list is a list of "not reached BY THIS RUN", which is a
 * different claim and has to look different.
 *
 * This is not decoration. The first deep run to use it — depth 4,
 * `keep=1`, 2026-08-28 — DID clamp: 3,293,938 visited, 159,685 expanded,
 * 813,219 representatives dropped. It reported the same three unreached
 * values as the unclamped depth-3 run, and without the label it would have
 * reported them with the same confidence as an exhaustive pass.
 */
const BFS_MAX_FRONTIER = Number(testEnv('EXHAUSTIVE_BFS_MAX_FRONTIER') ?? 120_000);
const BFS_TIMEOUT_MS = Math.max(600_000, 300_000 * Math.max(1, BFS_DEPTH - 3));

interface BfsResult {
  /** Distinct abstract signatures reached. */
  states: number;
  /** Prefixes actually expanded (representatives), not the space walked. */
  expanded: number;
  /** Prefixes built and scanned — the search's real cost. */
  visited: number;
  /** Per-field observed values, for the coverage report. */
  seenValues: Map<string, Set<string>>;
  /** Observed unordered field-pair value combinations, keyed
   *  `fieldA=valA|fieldB=valB`. */
  seenPairs: Set<string>;
  /** Shortest witness found for each declared F20 chain stage. */
  chainWitness: Map<string, string>;
  /** Values observed that the domain table does not declare — a stale
   *  abstraction, and a failure rather than a curiosity. */
  undeclared: string[];
  representatives: string[];
  /** Representatives dropped because the frontier cap was hit. Non-zero
   *  means the unreached list is "not reached by this run". */
  clamped: number;
}

function bfs(defListEnabled: boolean, depth: number): BfsResult {
  const out: BfsResult = {
    states: 0,
    expanded: 0,
    visited: 0,
    seenValues: new Map(SIGNATURE_DOMAIN.map((f) => [f.name, new Set<string>()])),
    seenPairs: new Set(),
    chainWitness: new Map(),
    undeclared: [],
    representatives: [],
    clamped: 0,
  };
  const seen = new Map<string, number>();
  // The empty prefix is the search's root; its checkpoint is whatever the
  // scanner produces for zero confirmed lines.
  let frontier: string[] = [''];

  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const prefix of frontier) {
      for (const token of BFS_TOKENS) {
        const doc = prefix + token;
        out.visited += 1;
        // FRESH SCAN per node, deliberately, after the resume version was
        // caught being wrong. A checkpoint is CONSUMED by the call it is
        // passed to: measured 2026-08-28, `computeFreezeBoundary` returns
        // the very object it was given (`parent.checkpoint ===
        // child.checkpoint`) with `confirmedOffset` advanced in place, 9
        // to 11 on the probe. A BFS node has one checkpoint and many
        // children, so resuming all 83 successors from it left every
        // sibling after the first resuming from a state the first had
        // already advanced. P2 does not license that and never did — it
        // pins resumed-equals-fresh for a LINEAR chain of snapshots, which
        // is the shape a stream has and a search does not.
        //
        // Cloning the parent instead would mean deep-copying a shape the
        // scanner documents as an implementation detail that changes
        // between minor versions. Rescanning costs O(prefix) per node
        // rather than O(token), which at these depths is a few seconds.
        const scanned = computeFreezeBoundary(doc, { defListEnabled });
        const cp = scanned.checkpoint as FreezeScanCheckpointInternal;
        const values = signatureValues(cp);
        const signature = values.join('|');

        SIGNATURE_DOMAIN.forEach((field, i) => {
          const v = values[i];
          if (!field.values.includes(v))
            out.undeclared.push(`${field.name}=${JSON.stringify(v)} doc=${JSON.stringify(doc)}`);
          out.seenValues.get(field.name)!.add(v);
        });
        for (let a = 0; a < SIGNATURE_DOMAIN.length; a++) {
          for (let b = a + 1; b < SIGNATURE_DOMAIN.length; b++) {
            out.seenPairs.add(`${SIGNATURE_DOMAIN[a].name}=${values[a]}|${SIGNATURE_DOMAIN[b].name}=${values[b]}`);
          }
        }
        const byName: Record<string, string> = {};
        SIGNATURE_DOMAIN.forEach((f, i) => (byName[f.name] = values[i]));
        for (const stage of F20_CHAIN) {
          if (!out.chainWitness.has(stage.id) && stage.hit(byName)) out.chainWitness.set(stage.id, doc);
        }

        // The dedup key is the signature PLUS THE UNCONFIRMED TAIL, and
        // leaving the tail out was this search's own first bug — worth
        // keeping because the coverage report is what caught it.
        //
        // A checkpoint describes the scan strictly BEFORE
        // `confirmedOffset`; its own declaration says so. So every prefix
        // ending mid-line — `'<!--'`, `'<?'`, `'<d'`, `'$$'`, every
        // fragment token — leaves the checkpoint identical to its parent's
        // and collapses to ONE signature. Keeping three representatives of
        // that signature then discarded every other half-finished
        // construct, and with it every state reachable only by completing
        // one. The search reported 13 unreached values and every one was
        // an artifact: `<!--\n` alone reaches `p5Tok=comment`, `$$\n`
        // reaches `mdBlock=math`, `<!x\n` reaches `html4`+`bogus` — all
        // at depth 2, all called unreachable at depth 4.
        //
        // The tail is bounded by a line, so keying on it verbatim is
        // cheap, and it restores the property a state search needs: two
        // prefixes share a key only when the scanner AND the bytes it has
        // not yet judged are the same.
        const key = `${signature}\u0000${doc.slice(cp.confirmedOffset)}`;
        const count = seen.get(key) ?? 0;
        if (count >= BFS_KEEP) continue;
        seen.set(key, count + 1);
        if (count === 0) out.states += 1;
        if (next.length >= BFS_MAX_FRONTIER) {
          out.clamped += 1;
          continue;
        }
        next.push(doc);
        out.expanded += 1;
        if (out.representatives.length < 400) out.representatives.push(doc);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return out;
}

/**
 * The coverage report, and the reason it is worth more than the search.
 *
 * An unreached signature value is an ALPHABET GAP with a mechanical name —
 * the thing that turns "is the alphabet complete?" from an assertion into
 * a measurement. The domain it is measured against lives in
 * `checkpointAbstraction.ts` and is written from the scanner's type
 * declarations, never from a run, because a search that decides what it
 * should have covered reports total coverage by construction. That is the
 * same failure that let three floors above look like corroboration when
 * two of them shared one input.
 *
 * LIMIT, stated because the report cannot tell the difference: an
 * unreached value is either a gap in the alphabet OR a state the scanner
 * cannot enter at all. Deciding which needs a human reading the scanner.
 * What the report does prove is the direction that matters — an
 * UNDECLARED value fails the test, so the abstraction cannot silently rot
 * behind the scanner it describes.
 */
function bfsReport(label: string, r: BfsResult): void {
  const missingValues: string[] = [];
  let declaredValues = 0;
  for (const field of SIGNATURE_DOMAIN) {
    declaredValues += field.values.length;
    for (const v of field.values) {
      if (!r.seenValues.get(field.name)!.has(v)) missingValues.push(`${field.name}=${v}`);
    }
  }
  let declaredPairs = 0;
  for (let a = 0; a < SIGNATURE_DOMAIN.length; a++) {
    for (let b = a + 1; b < SIGNATURE_DOMAIN.length; b++) {
      declaredPairs += SIGNATURE_DOMAIN[a].values.length * SIGNATURE_DOMAIN[b].values.length;
    }
  }
  const seenValueCount = declaredValues - missingValues.length;
  emit(
    `\n[bfs:${label}] depth=${BFS_DEPTH} keep=${BFS_KEEP} alphabet=${BFS_TOKENS.length} ` +
      `visited=${r.visited} expanded=${r.expanded} states=${r.states}` +
      (r.clamped > 0 ? ` CLAMPED=${r.clamped} (coverage below is THIS RUN's reach, not the space's)` : '') +
      '\n' +
      `[bfs:${label}] values=${seenValueCount}/${declaredValues} pairs=${r.seenPairs.size}/${declaredPairs} ` +
      '\n' +
      `[bfs:${label}] F20 chain: ` +
      F20_CHAIN.map((s) => `${s.id}=${r.chainWitness.has(s.id) ? 'REACHED' : 'unreached'}`).join(' ') +
      '\n' +
      F20_CHAIN.filter((s) => r.chainWitness.has(s.id))
        .map((s) => `[bfs:${label}]   ${s.id} witness=${JSON.stringify(r.chainWitness.get(s.id))}\n`)
        .join('') +
      (missingValues.length === 0
        ? `[bfs:${label}] every declared value reached\n`
        : `[bfs:${label}] ${r.clamped > 0 ? 'NOT REACHED BY THIS (CLAMPED) RUN' : 'UNREACHED'} values ` +
          `(${missingValues.length}): ${missingValues.join(' ')}\n`)
  );
  // The abstraction must not rot behind the scanner it describes.
  expect(
    r.undeclared.slice(0, 8),
    `the checkpoint produced values SIGNATURE_DOMAIN does not declare — the abstraction is stale`
  ).toEqual([]);
  // Anti-vacuity: a search that expands nothing reports perfect coverage
  // of nothing. Measured at the committed defaults in the commit message.
  expect(r.visited, `[bfs:${label}] visited nothing`).toBeGreaterThan(BFS_TOKENS.length);
  expect(r.states, `[bfs:${label}] found only ${r.states} distinct abstract states`).toBeGreaterThan(20);
  // The first two F20 stages are PINNED as reached, because they are what
  // makes this search worth running: the surface censuses need eight line
  // tokens to build that state and this one is at it in two. If a change
  // to the alphabet or the abstraction stops reaching them, the search has
  // quietly lost the capability it exists for, and a coverage report full
  // of green would not say so. Stage 3 is deliberately NOT pinned — it is
  // unreached, and pinning an unreached stage as unreached would freeze a
  // gap into a requirement.
  for (const stage of F20_CHAIN.slice(0, 2)) {
    expect(
      r.chainWitness.has(stage.id),
      `[bfs:${label}] F20 chain stage ${stage.id} is no longer reachable — the search lost the state it exists to find`
    ).toBe(true);
  }
}

describe.skipIf(BFS_DEPTH === 0)(`state-directed search (depth=${BFS_DEPTH}, keep=${BFS_KEEP})`, () => {
  test('abstract state coverage and F20 reachability', { timeout: BFS_TIMEOUT_MS }, () => {
    for (const defListEnabled of [false, true]) {
      bfsReport(defListEnabled ? 'defList' : 'baseline', bfs(defListEnabled, BFS_DEPTH));
    }
  });
});

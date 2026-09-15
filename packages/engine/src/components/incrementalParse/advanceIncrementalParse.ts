/**
 * React-free state machine for incremental (prefix-freeze) parsing.
 *
 * Given the previous frame's state and the current content, either splice
 * a frozen prefix with a tail-only parse or run the full pipeline. Every
 * gate failure degrades to the full path — the caller cannot observe a
 * difference except through `usedIncremental` and the dev-only stage
 * timings. The splice output is deep-equal to a full parse (the
 * splice-equivalence arbiter test enforces this; see spliceParse.ts).
 *
 * Gate order (first failure wins):
 *  - G0 depsKey identity — the parse inputs beyond `content` (plugin
 *    arrays, remark-rehype options, handlers, documentId, …) must be
 *    identical to the previous frame's. This intentionally covers MORE
 *    than the component's G3 12-dep flush (e.g. `preserveOrphanReferences`
 *    flips reach the handlers without touching any G3 field).
 *  - G1 append — `content.startsWith(prev.content)`; equal content returns
 *    the previous trees unchanged. Non-append rewrites (including Stage-A
 *    preprocessor rewrites near the stream end) land here. A document
 *    that starts with U+FEFF is never an append: micromark drops a leading
 *    byte order mark before tokenizing, so every position in the parsed
 *    trees is the string index minus one, while the scan, the prefix cut,
 *    the straddle check and the rebase delta all work in string indices.
 *    Stage A strips that character before the engine sees it; if one
 *    reaches here anyway, the frame is a full parse (the scanner grants no
 *    boundary for such a document either — see computeFreezeBoundary).
 *  - G3 boundary — `b = min(computeFreezeBoundary(content), prev.stableBoundary)`
 *    must be > 0. The `min` with the PREVIOUS frame's boundary is
 *    load-bearing, not defensive: the freshly computed boundary proves
 *    stability of the CURRENT parse's prefix, but the splice reuses the
 *    PREVIOUS parse's nodes — e.g. a shortcut ref rendered literal last
 *    frame must not be frozen the moment its definition arrives and the
 *    fresh boundary jumps past it. `prev.stableBoundary` is exactly the
 *    "stable under all future appends" property for prev's nodes.
 *  - G4 straddle (defensive) — no prev top-level mdast child may cross the
 *    boundary; the detector's blockers should already prevent this.
 *
 * (v1's G2 footnote bypass is GONE. Footnotes splice via INJECTION REPLAY:
 * the prefix's footnote event sequence — defs and refs ×count, in document
 * order, collected from prev.mdast — is prepended to the tail source, so
 * the tail run's mdast-util-to-hast state (footnoteOrder / footnoteCounts /
 * footnoteById) is seeded exactly and its footer regenerates the WHOLE
 * document's section; the injected nodes are stripped from both trees and
 * the footer's positions are rewritten by the dual rule in spliceParse.
 * Prefix inline hast is naturally stable — numbering is first-reference
 * order, which appends cannot change for the prefix. The detector's
 * reference taint (footnote namespace) keeps unresolved `[^x]` out of the
 * frozen prefix, C0-probe + arbiter verified.)
 *
 * `nextState.stableBoundary` is written on BOTH paths from the same single
 * boundary computation.
 */

import type { Root as HastRoot } from 'hast';
import type { Root as MdastRoot } from 'mdast';

import { parseStage, transformStage, type PipelineOptions as MarkdownOptions } from '../markdown';
import { computeFreezeBoundary, type FreezeScanCheckpoint } from './computeFreezeBoundary';
import type { FreezeScanCheckpointInternal } from './freezeScanState';
import {
  buildInjectionPrefix,
  collectPrefixInjection,
  spliceTrees,
  tailMentionsTerminator,
  type CachedInjectionPlan,
  type SplicePrefixCache,
  type SplicePrefixCacheInternal,
} from './spliceParse';

/** The phantom label sets ride on the merged remark-rehype options (the
 *  cross-chunk handlers read them there); the engine only ever reads them
 *  for the dev invariant below. */
interface PhantomLabelOptions {
  phantomFootnoteLabels?: ReadonlySet<string>;
  phantomLinkLabels?: ReadonlySet<string>;
}

/**
 * Dev-only invariant (bare `process.env.NODE_ENV` gate — CONTRIBUTING,
 * "Dev-only gates"): no phantom label may also be DEFINED in the chunk's
 * own text.
 *
 * The phantom label sets are deliberately absent from `depsKey` (suffix
 * churn must never invalidate the frozen prefix). That is sound because a
 * phantom's definition is never in `content`, so the reference taint keeps
 * every phantom-resolved reference in the tail. The frozen `footnote-sup`
 * hast shape and the footnoteDefinition handler both branch on
 * `phantomFootnoteLabels.has(id)`, though: a label that is BOTH phantom
 * and locally defined would let the prefix freeze one handler verdict and
 * the next frame's suffix change it without a deps-key miss.
 * `coordinationPreparation` subtracts the chunk's own labels from the
 * phantom sets today; this reports the day it stops.
 *
 * Cost: the scan checkpoint already holds the confirmed block-level
 * definitions of `content`, keyed by micromark's normalized identifier —
 * the same rule the label sets use — so this is a set intersection, no
 * extra parse. Scope: a definition on the still-unconfirmed last line
 * registers on the next frame; definitions nested in containers
 * (`> [a]: /u`) are not registered by the scanner and are not checked.
 */
function reportPhantomDefinedLocally(checkpoint: FreezeScanCheckpoint, options: AdvanceOptions): void {
  const labels = options.remarkRehypeOptions as PhantomLabelOptions | null | undefined;
  if (!labels) return;
  const { defs, footnoteDefs } = checkpoint as FreezeScanCheckpointInternal;
  const collisions: string[] = [];
  if (labels.phantomLinkLabels) {
    for (const label of labels.phantomLinkLabels) if (defs.has(label)) collisions.push(`[${label}]`);
  }
  if (labels.phantomFootnoteLabels) {
    for (const label of labels.phantomFootnoteLabels) if (footnoteDefs.has(label)) collisions.push(`[^${label}]`);
  }
  if (collisions.length > 0) {
    console.error(
      `[ai-react-markdown] incremental parse: phantom label(s) ${collisions.join(', ')} are also defined in the ` +
        'chunk itself. Phantom label sets are excluded from the engine deps key on the premise that a phantom is ' +
        'never locally defined; a frozen prefix may now carry a handler verdict the suffix can change. This is a ' +
        'coordination defect (the own-label subtraction in coordinationPreparation) — please report it.'
    );
  }
}

export interface IncrementalParseState {
  /** The CHUNK's own text — excludes the phantom suffix. */
  content: string;
  /** The phantom suffix this state's trees were parsed with ('' standalone). */
  phantomSuffix: string;
  /** Post-transform trees (transformStage mutates mdast in place; these are
   *  the settled shapes) — of `content + phantomSuffix`. */
  mdast: MdastRoot;
  hast: HastRoot;
  /** Scan boundary at the frame that produced these trees. */
  stableBoundary: number;
  /** Detector resume state: append frames re-lex only past the confirmed
   *  prefix instead of the whole document (E2). Single-consumer mutable —
   *  owned by this state lineage. */
  scanCheckpoint: FreezeScanCheckpoint | null;
  /** Injection-plan resume state: events derive from (content, positions)
   *  alone, so within an append lineage only children past the cached
   *  boundary need visiting (final-review R3 — without this the plan walk
   *  re-visits the entire frozen prefix every splice frame). Null until the
   *  first splice frame; carried verbatim across full-path append frames. */
  injectionPlan: CachedInjectionPlan | null;
  /** Splice resume state: the prefix-wide passes of `spliceTrees` (prefix
   *  cut, hast attribution, html-value guards, alignment, line count) as
   *  they stood at the last splice frame's boundary, so the next splice
   *  frame only walks what the boundary advanced over. Null after a
   *  full-path frame (fresh roots — nothing to resume). Validated against
   *  the trees it was built for before use; see SplicePrefixCache. */
  spliceCache: SplicePrefixCache | null;
  /** Identity tuple of every parse input beyond `content` (G0). */
  depsKey: readonly unknown[];
  /** The scanner grammar profile these trees were frozen under (see
   *  `AdvanceOptions.gfmTaskListItems`). A flip is a G0 miss like any
   *  other deps change: the retained trees were spliced against under the
   *  old profile and must not survive into the new one. */
  gfmTaskListItems: boolean;
}

export type IncrementalStage = 'scan' | 'parse' | 'transform';

export interface AdvanceOptions {
  remarkPlugins: MarkdownOptions['remarkPlugins'];
  rehypePlugins: MarkdownOptions['rehypePlugins'];
  /** The FULLY-MERGED remark-rehype options (handlers, clobberPrefix, …) —
   *  exactly what the full path would pass to parseStage. */
  remarkRehypeOptions: MarkdownOptions['remarkRehypeOptions'];
  depsKey: readonly unknown[];
  /** Whether remark-definition-list is active (`enginePlugins` includes `definitionList`). */
  defListEnabled: boolean;
  /** Whether the chain parses GFM task-list items (remark-gfm). Default
   *  `false`, the conservative profile; the engine's own chain builders
   *  always include remark-gfm, so the adapters pass `true`. See
   *  `FreezeBoundaryOptions.gfmTaskListItems`. Participates in the G0
   *  deps check on top of `depsKey`. */
  gfmTaskListItems?: boolean;
  /** Cross-chunk phantom-definition suffix (coordinated mode) — appended to
   *  the parse input but NEVER frozen: the append gate, boundary scan, and
   *  prefix cut all see `content` alone, and the suffix re-parses with the
   *  tail every frame. It may shrink/grow/reorder between frames (registry
   *  label churn) without invalidating the frozen prefix — the reference
   *  taint keeps every phantom-resolved ref in the tail (a phantom's def is
   *  never IN `content`, so such refs never settle). '' when standalone. */
  phantomSuffix?: string;
  /** Optional stage-timing wrapper (the component passes measureStage). */
  measure?: <T>(stage: IncrementalStage, fn: () => T) => T;
}

export interface AdvanceResult {
  mdast: MdastRoot;
  hast: HastRoot;
  usedIncremental: boolean;
  /** The boundary the splice used (0 on the full path). */
  boundary: number;
  nextState: IncrementalParseState;
}

const identityMeasure = <T>(_stage: IncrementalStage, fn: () => T): T => fn();

function depsKeyEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function runPipeline(source: string, options: AdvanceOptions): { mdast: MdastRoot; hast: HastRoot } {
  const measure = options.measure ?? identityMeasure;
  const parsed = measure('parse', () =>
    parseStage({
      children: source,
      remarkPlugins: options.remarkPlugins,
      rehypePlugins: options.rehypePlugins,
      remarkRehypeOptions: options.remarkRehypeOptions,
    })
  );
  const hast = measure('transform', () => transformStage(parsed));
  return { mdast: parsed.mdast, hast };
}

/** @soak-entry incremental-parse */
export function advanceIncrementalParse(
  prev: IncrementalParseState | null,
  content: string,
  options: AdvanceOptions
): AdvanceResult {
  const measure = options.measure ?? identityMeasure;
  const phantomSuffix = options.phantomSuffix ?? '';
  const gfmTaskListItems = options.gfmTaskListItems ?? false;
  const sameDeps =
    prev !== null && depsKeyEqual(prev.depsKey, options.depsKey) && prev.gfmTaskListItems === gfmTaskListItems;

  // Zero-scan short-circuit — identical content AND suffix reuse the whole
  // previous state verbatim (registry version bumps, unrelated re-renders).
  // A suffix-only change falls through: the scan resume over unchanged
  // content is ~free, and the tail (which always contains the suffix)
  // re-parses with the new one.
  if (sameDeps && content === prev!.content && phantomSuffix === prev!.phantomSuffix) {
    return {
      mdast: prev!.mdast,
      hast: prev!.hast,
      usedIncremental: true,
      boundary: prev!.stableBoundary,
      nextState: prev!,
    };
  }
  // A leading BOM shifts parser offsets off the string indices the splice
  // coordinates use (module docs, G1) — such a frame is never an append.
  const appendOnly = sameDeps && content.charCodeAt(0) !== 0xfeff && content.startsWith(prev!.content);

  // Every remaining frame scans ONCE (fence-aware). Full-path frames
  // consume the scan on the NEXT frame via `prev.stableBoundary`.
  // Append frames resume the detector from its confirmed-prefix checkpoint
  // instead of re-lexing the whole document (E2); everything else scans
  // fresh. The checkpoint is mutable and single-consumer — this state
  // lineage owns it.
  const scan = measure('scan', () =>
    computeFreezeBoundary(
      content,
      { defListEnabled: options.defListEnabled, gfmTaskListItems },
      appendOnly ? prev!.scanCheckpoint : null
    )
  );
  const freshBoundary = scan.boundary;
  if (process.env.NODE_ENV !== 'production' && phantomSuffix !== '') {
    reportPhantomDefinedLocally(scan.checkpoint, options);
  }

  // Carried across full-path append frames; refreshed on splice frames
  // (where the plan walk actually runs). Non-append lineages start over.
  let injectionPlan: CachedInjectionPlan | null = appendOnly ? prev!.injectionPlan : null;

  const finish = (
    mdast: MdastRoot,
    hast: HastRoot,
    usedIncremental: boolean,
    boundary: number,
    spliceCache: SplicePrefixCache | null
  ): AdvanceResult => ({
    mdast,
    hast,
    usedIncremental,
    boundary,
    nextState: {
      content,
      phantomSuffix,
      mdast,
      hast,
      stableBoundary: freshBoundary,
      scanCheckpoint: scan.checkpoint,
      injectionPlan,
      spliceCache,
      depsKey: options.depsKey,
      gfmTaskListItems,
    },
  });

  // Fresh roots carry no splice cache: nothing about them was computed by
  // the splice, and the next frame's identity check would refuse the old
  // one anyway. Null makes that explicit rather than incidental.
  const fullPath = (): AdvanceResult => {
    const { mdast, hast } = runPipeline(content + phantomSuffix, options);
    return finish(mdast, hast, false, 0, null);
  };

  // G0 + G1 (scan already ran — its result seeds nextState either way)
  if (!appendOnly) return fullPath();
  // G3
  const boundary = Math.min(freshBoundary, prev!.stableBoundary);
  if (boundary <= 0) return fullPath();
  // Splice resume state is usable only for the very trees it was built
  // from and for a boundary that did not move back (its passes ran to
  // `cache.boundary`; a later boundary only appends work). Anything else
  // runs the passes in full — same output, more work.
  // The state stores the public brand; only this module reads the fields.
  const cache = prev!.spliceCache as SplicePrefixCacheInternal | null;
  const resume =
    cache !== null && cache.roots.mdast === prev!.mdast && cache.roots.hast === prev!.hast && cache.boundary <= boundary
      ? cache
      : null;
  // G4 (defensive) — deliberately a FULL scan of the unverified children,
  // no ordered-children early break: this is the gate that catches
  // ordering/straddle violations, so it must not share the assumption it
  // defends against (round-2 review). With a valid resume the first
  // `mdastCount` children are the previous frame's frozen prefix, node for
  // node — this same gate proved at that frame that none of them ends past
  // its boundary, which is at most this one — so the scan covers the rest.
  const children = prev!.mdast.children;
  for (let i = resume ? resume.mdastCount : 0; i < children.length; i++) {
    const child = children[i];
    const start = child.position?.start?.offset;
    const end = child.position?.end?.offset;
    if (start !== undefined && end !== undefined && start < boundary && end > boundary) {
      return fullPath();
    }
  }

  // The one input class where the injection's synthetic terminator label
  // could change how the tail parses: the tail literally mentioning it.
  // Checked on the PRE-injection tail (the injection itself contains the
  // label). Pathological by construction — correctness over splice rate.
  const tailAndSuffix = content.slice(boundary) + phantomSuffix;
  if (tailMentionsTerminator(tailAndSuffix)) return fullPath();

  // The plan cache and the splice cache are written by the same splice
  // frame, so when both resume from the same boundary the splice cache's
  // frozen prefix is exactly the run of children the plan walk would skip
  // as "before the resume point" — hand it the count so it starts after
  // them (see `verifiedPrefix`). Any mismatch (plan carried across a
  // full-path frame, plan not cacheable) walks every child as before.
  const verifiedPrefix =
    resume !== null && injectionPlan !== null && injectionPlan.boundary === resume.boundary ? resume.mdastCount : 0;
  const plan = collectPrefixInjection(prev!.mdast, prev!.content, boundary, injectionPlan, verifiedPrefix);
  if (plan.cacheable !== false) {
    injectionPlan = { boundary, events: plan.events, uninjectable: plan.uninjectable };
  }
  // A nested definition/footnote-def that cannot be re-injected verbatim —
  // take the full path this frame rather than splice without it (A3).
  if (plan.uninjectable) return fullPath();
  const injection = buildInjectionPrefix(plan.events);
  const tailSource = injection.text + tailAndSuffix;
  const tail = runPipeline(tailSource, options);
  const spliced = spliceTrees({
    prevMdast: prev!.mdast,
    prevHast: prev!.hast,
    tailMdast: tail.mdast,
    tailHast: tail.hast,
    content,
    boundary,
    injectionPrefix: injection.text,
    injectedSegments: injection.segments,
    resume,
  });
  // null = the prefix/tail hast layout fell outside the alignment model —
  // full parse this frame (safe, one-frame cost).
  if (spliced === null) return fullPath();
  return finish(spliced.mdast, spliced.hast, true, boundary, spliced.cache);
}

/**
 * Pure splice helpers for incremental (prefix-freeze) parsing: cut the
 * frozen prefix out of the previous frame's trees, re-base a tail-only
 * parse into document coordinates, and join the two into fresh roots.
 *
 * Invariant these helpers exist to uphold (enforced by the
 * splice-equivalence arbiter test, NOT asserted at runtime): the spliced
 * `{mdast, hast}` is deep-equal — positions included — to a full pipeline
 * run over the whole content. Defined on UNRENDERED trees; after a render,
 * `renderHastSubtree` mutates hast in place (convergent `data.originalUrls`
 * stash, raw→text rewrite — see Markdown.tsx), so no in-component
 * deep-equal check is possible or attempted.
 *
 * Prefix link/image definitions are PREPENDED to the tail source (not
 * appended: a streaming tail routinely ends inside an unclosed fence or
 * `$$` block that would swallow appended lines, and appended defs would
 * invert CommonMark first-def-wins against a same-label tail def).
 * Definitions emit zero hast (mdast-util-to-hast has no `definition`
 * handler), so their only trace is `definition` mdast nodes inside the
 * injected region, which are dropped before the join. Definition text is
 * sliced verbatim from the previous content via node positions — exact
 * source roundtrip preserves escapes and multi-line titles.
 *
 * Sanitize-STRIPPED prefix nodes (HTML comments, `<?…?>` bogus comments,
 * `<script>`) are modeled explicitly: their wrap separators survive as
 * orphans, and `alignPrefixCut` re-derives the mdast↔hast pairing from
 * separator-run lengths (B0-probe-verified: one orphan '\n' per stripped
 * child's gap slot; separators MERGED into raw trailing literals count via
 * their trailing newlines — `literalCredit`). Layouts outside the model
 * return null → full-parse fallback for the frame.
 */

import type { Root as HastRoot, RootContent as HastContent } from 'hast';
import type { Root as MdastRoot, RootContent as MdastContent } from 'mdast';
import { attributeHastChildrenResumable, type AttributionResume } from './attributeHastChildren';
import { rebaseTree, rebaseTreeDual, rebasePoint, countNewlines, type InjectedSegment } from './spliceCoordinates';
import {
  TABLE_PART_TAG_RE,
  STRAY_SYNTHESIZED_END_TAG_RE,
  scanTableParts,
  headRoutedCaptureUnclosed,
  rawTextRegionCrossesOut,
} from './spliceHtmlGuards';
import {
  alignPrefixCut,
  stripInjectedHast,
  tailLeadingTextIsHoist,
  isWrapInvisible,
  ownsTrailingLiteral,
  isTrailingLiteralText,
  type AlignResume,
} from './prefixAlignment';

// Preserve the existing internal entry points used by the engine and its falsification suites.
export { collectPrefixInjection, buildInjectionPrefix, tailMentionsTerminator } from './prefixInjection';
export type { InjectionEvent, PrefixInjectionPlan, CachedInjectionPlan, InjectionPrefix } from './prefixInjection';
export { rebaseTree, rebaseTreeDual } from './spliceCoordinates';
export type { InjectedSegment } from './spliceCoordinates';
export { alignPrefixCut } from './prefixAlignment';
export { isSanitizeStrippedConstruct, isExactSanitizeStrippedConstruct } from './spliceHtmlGuards';

/**
 * What a splice frame learned about its frozen prefix, kept in engine state
 * for the next frame. Every per-frame step of `spliceTrees` that walks the
 * whole prefix — the prefix cut, hast attribution, the html-value guards,
 * the alignment loop, the line count — is a left-to-right pass whose state
 * at the previous boundary is the same in the next frame, because within an
 * append lineage the frozen prefix is byte-identical and the spliced roots
 * were built by this module: `mdast.children[0, mdastCount)` IS the previous
 * `prefixMdast` and `hast.children[0, hast.align.outLen)` IS the previous
 * aligned cut, node for node. Without this the fixed cost of a frame grew
 * with the document (measured: 28 ms per appended token on 64,000 short
 * paragraphs, of which the tail parse was under 1 ms).
 *
 * Validity is the CALLER's check (advanceIncrementalParse): the cache is
 * used only when the previous trees are the very roots it was built for
 * (`roots` identity — a full-parse frame produces fresh roots, so its
 * state carries no cache) and the boundary did not move back
 * (`boundary <= current`). A boundary that regressed or a lineage that
 * restarted simply runs the uncached passes, which produce the same output.
 */
export interface SplicePrefixCache {
  /** Brand only: the field set below is an implementation detail and stays
   *  out of the public d.ts, like `FreezeScanCheckpoint`. The supported
   *  operations on the public type are storing it in the state and passing
   *  it back. */
  readonly '~splicePrefixCache'?: never;
}

/** The real shape behind `SplicePrefixCache`; intra-package only. */
export interface SplicePrefixCacheInternal extends SplicePrefixCache {
  /** Boundary the passes below were run to. */
  boundary: number;
  /** The roots `spliceTrees` returned with this cache — identity anchors. */
  roots: { mdast: MdastRoot; hast: HastRoot };
  /** `countNewlines(content, boundary)`. */
  lines: number;
  /** `prevMdast.children[0, mdastCount)` is the frozen prefix's mdast. */
  mdastCount: number;
  /** `hasStrayTablePart` depth after the prefix's html values (none stray). */
  tableDepth: number;
  /** hast-side resume points, or null when the previous alignment rewrote
   *  the cut's last node (the trailing-literal path) and the hast walks
   *  must start from index 0 again. The mdast-side fields stay valid. */
  hast: { align: AlignResume; attribution: AttributionResume } | null;
}

export interface SpliceInput {
  prevMdast: MdastRoot;
  prevHast: HastRoot;
  /** Tail trees, freshly parsed from `injectionPrefix + content.slice(boundary)`. */
  tailMdast: MdastRoot;
  tailHast: HastRoot;
  content: string;
  boundary: number;
  injectionPrefix: string;
  /** Coordinate mappings for injected footnote-def blocks (footer rebase). */
  injectedSegments: InjectedSegment[];
  /** Previous frame's cache, already validated against `prevMdast` /
   *  `prevHast` and `boundary` by the caller; null runs every pass in full. */
  resume?: SplicePrefixCacheInternal | null;
}

export function spliceTrees(
  input: SpliceInput
): { mdast: MdastRoot; hast: HastRoot; cache: SplicePrefixCacheInternal } | null {
  const { prevMdast, prevHast, tailMdast, tailHast, content, boundary, injectionPrefix, injectedSegments } = input;
  const resume = input.resume ?? null;

  const injectedLen = injectionPrefix.length;
  const injectedLines = countNewlines(injectionPrefix);
  // Bounded count — slicing the prefix would allocate a copy of the whole
  // frozen document every frame just to count newlines (final-review R3).
  // Resumed: only the bytes the boundary advanced over since the cache.
  const prefixLines = resume
    ? resume.lines + countNewlines(content, boundary, resume.boundary)
    : countNewlines(content, boundary);
  const offsetDelta = boundary - injectedLen;
  const lineDelta = prefixLines - injectedLines;

  // --- prefix cuts (non-mutating reads of the previous frame's trees) ---
  // Filter semantics (no ordered-children early break): together with G4's
  // full straddle scan this keeps the cut correct-or-bailing even for
  // disordered trees a plugin-shaped mdast could present (round-2 review).
  // Resumed: the first `mdastCount` children are the previous prefix by
  // construction (see SplicePrefixCache); the filter runs over the rest.
  const resumedMdastCount = resume ? resume.mdastCount : 0;
  const prefixMdast: MdastContent[] = resume ? prevMdast.children.slice(0, resumedMdastCount) : [];
  for (let i = resumedMdastCount; i < prevMdast.children.length; i++) {
    const child = prevMdast.children[i];
    const start = child.position?.start?.offset;
    if (start !== undefined && start < boundary) prefixMdast.push(child);
  }
  const attribution = attributeHastChildrenResumable(prevMdast, prevHast, boundary, resume?.hast?.attribution ?? null);
  const attrs = attribution.attrs;
  // Resumed: `[0, outLen)` were cut last frame and every check below passed
  // on them then, against the same nodes, neighbours and prefix; their
  // attribution is below the cached boundary, hence below this one.
  const cutStart = resume?.hast ? resume.hast.align.outLen : 0;
  const cutRegion: HastContent[] = resume?.hast ? prevHast.children.slice(0, cutStart) : [];
  for (let i = cutStart; i < prevHast.children.length; i++) {
    if (attrs[i] < boundary) {
      const node = prevHast.children[i];
      // HAST STRADDLE BAIL (campaign, 2026-08-03): an mdast-clean boundary
      // does not imply a hast-clean one — parse5's tree construction can
      // hoist an unclosed inline element (`<details>` open tag in a frozen
      // paragraph) to the root, where it swallows every later sibling. The
      // frozen subtree then CONTAINS tail bytes, and the tail re-parse
      // duplicates them (seed-20260751 counterexample). A positioned cut
      // child whose source extends past the boundary is exactly that shape.
      const end = node.position?.end?.offset;
      if (end !== undefined && end > boundary) return null;
      // A position-less CONTENT text is only attributable when it directly
      // follows a positioned element — its owner (parse5 merges adjacent
      // texts, so one block never emits two literal nodes). One that
      // follows another text is a stripped-construct remnant whose owner
      // may live PAST the boundary (`<?instr <b> ?>` → ` ?>`, seed-20260830:
      // attribution stalls on the last positioned child and pulled the
      // CURRENT TAIL's remnant into the cut, duplicating it). Ownership is
      // undecidable here — bail to a full parse.
      if (isTrailingLiteralText(node)) {
        const prev = i > 0 ? prevHast.children[i - 1] : undefined;
        if (!prev || prev.type !== 'element' || prev.position === undefined) return null;
        // …and it must be that element's OWN trailing literal (its html
        // block's source ends with the text). Attribution can hand a
        // following dropped-tag block's remnant (`[a]: def\n\n</t>\ntext`)
        // an offset before the boundary — the def between them has no
        // output — and freezing it duplicated it (release soak).
        if (!ownsTrailingLiteral(prev as HastContent, node as HastContent & { value: string }, prefixMdast))
          return null;
      }
      cutRegion.push(node);
      continue;
    }
    // Raw trailing literal of a frozen html block (fuzz counterexample):
    // `</tag>` followed by an unblanked text line makes rehype-raw emit the
    // line as a POSITION-LESS non-whitespace text after the element. Being
    // position-less it is attributed FORWARD (to the first tail block), but
    // its bytes live before the boundary — it must freeze with its owner,
    // the preceding included node. Whitespace-only texts stay excluded:
    // those are separators/foster-hoist, owned by the model below.
    //
    // OWNERSHIP is element-adjacency (seed-20260830 regression, exposed by
    // removing the coarse tail bail): a real trailing literal always sits
    // DIRECTLY after its owner's element output — parse5 merges adjacent
    // texts, so one block never emits two literal nodes. A position-less
    // non-whitespace text after a TEXT node is the current tail's own
    // stripped-construct remnant (`<?instr <b> ?>` → ` ?>`), which the tail
    // re-parse reproduces — freezing it would duplicate it.
    const node = prevHast.children[i];
    if (
      i > 0 &&
      attrs[i - 1] < boundary &&
      prevHast.children[i - 1].type === 'element' &&
      isTrailingLiteralText(node) &&
      // …and only when that element really IS an html block's output: a
      // raw literal can only trail an `html` mdast node. A position-less
      // text after a `<p>` is the NEXT block's remnant — a stray end tag
      // (`</t>\na`) parse5 dropped, whose text merged with the wrap
      // separator — owned by the tail, which re-parses it; freezing it
      // here duplicated it (v2.4.0 review P3). Falls through to the
      // remnant look-ahead below, which bails to a full parse. And the
      // literal must really be THAT block's trailing text: the block's raw
      // source ends with it. A dropped-tag block right after a frozen html
      // element (`</details>\n\n</t>\ntext`) puts its remnant in the same
      // position, and freezing it duplicated it (release soak of the fix).
      ownsTrailingLiteral(prevHast.children[i - 1] as HastContent, node as HastContent & { value: string }, prefixMdast)
    ) {
      cutRegion.push(node);
      // NOTE: this break skips the remnant look-ahead below. Safe today
      // because a frozen stripped construct AFTER a pushed trailing
      // literal always leaves an orphan separator that alignPrefixCut's
      // block-final branch rejects via `trailingGaps > 0 || sepBuffer` —
      // a NON-LOCAL invariant: loosening that bail re-opens the swallow
      // through this path (final-review cross-reference).
      break;
    }
    // Stripped-construct remnant look-ahead (seeds 20260821/20260893): a
    // position-less NON-whitespace text in the run right past the cut
    // point is a stripped construct's remnant, and its owner carries no
    // position. If the owner is fully FROZEN, the tail re-parse cannot
    // reproduce the text and the model below would synthesize its gap
    // slot as a plain '\n' — swallowing it (`<?instr <b> ?> after the pi`
    // froze three blocks back; sanitize stripped the bogus comment and
    // left ` ?> after the pi\n` behind). If tail-owned, freezing it here
    // would duplicate it. Ownership is undecidable — bail to a full
    // parse. The scan stops at the first element or positioned node:
    // remnants further out belong to blocks the tail re-parses anyway.
    for (let j = i; j < prevHast.children.length; j++) {
      const look = prevHast.children[j];
      if (look.type === 'element' || look.position !== undefined) break;
      if (isTrailingLiteralText(look)) return null;
    }
    break;
  }

  // wrap() emits separators per mdast-child ADJACENCY, before sanitize
  // strips anything — so the seam's existence is decided by the tail's
  // post-transform MDAST (excluding wrap-invisible types, which produce no
  // to-hast output), not by whether the tail hast ends up non-empty.
  // (Learned from the arbiter: a sanitize-removed comment leaves its
  // separator behind.)
  //
  // ALL injected nodes are dropped from the tail mdast — wrap-invisible
  // defs (v1) and the replay's footnote-ref paragraphs alike; non-injected
  // children can never start before injectedLen.
  const tailMdastChildren = tailMdast.children.filter((child) => {
    const start = child.position?.start?.offset;
    return !(start !== undefined && start < injectedLen);
  });
  const tailWrapVisible = tailMdastChildren.some((child) => !isWrapInvisible(child));

  // parse5 tree-construction quirks that poison the WHOLE document, not one
  // seam (v2.4.2 review P1-1/P1-2 + its adversarial follow-up):
  // - a stray table-part tag (`<td>`, `<tr>`, `<col>` …) outside any table
  //   changes how every LATER GFM table is built (its cell text is
  //   foster-parented to the root in the full parse; a tail-only parse
  //   builds a real <table>) — once such a tag sits in the frozen prefix,
  //   no later splice is trustworthy;
  // - the tail-only parse opens in a mode where a stray `</br>` / `</p>` (the
  //   two end tags HTML synthesizes instead of dropping) and table parts
  //   are DROPPED until the first element start tag switches it to body,
  //   while the full parse — already in body — synthesizes / foster-parents
  //   them. Any such tag inside the tail's LEADING run of html blocks
  //   (comments / PIs / declarations do not switch the mode) → bail.
  // Resumed: only html values the boundary advanced over are new. The
  // cached prefix's values were scanned, in order, by the frames that
  // froze them (a stray part or an open region would have refused the
  // splice and left no cache); the table scan continues from the depth
  // they left, the per-value raw-text scan needs nothing carried.
  const newHtmlValues: string[] = [];
  for (let i = resumedMdastCount; i < prefixMdast.length; i++) {
    const child = prefixMdast[i];
    if (child.type === 'html') newHtmlValues.push(child.value);
  }
  const tableScan = scanTableParts(newHtmlValues, resume ? resume.tableDepth : 0);
  if (tableScan.stray) return null;
  if (rawTextRegionCrossesOut(newHtmlValues)) return null;
  const leadingHtml: string[] = [];
  for (const child of tailMdastChildren) {
    if (isWrapInvisible(child)) continue;
    if (child.type !== 'html') break;
    if (STRAY_SYNTHESIZED_END_TAG_RE.test(child.value) || TABLE_PART_TAG_RE.test(child.value)) return null;
    leadingHtml.push(child.value);
  }
  // …and the same case analysis for the head-routed raw-text names, whose
  // mode capture the comment above missed: they are precisely the start tags
  // that do NOT switch the mode to body.
  if (headRoutedCaptureUnclosed(leadingHtml)) return null;

  // Align the cut region against the prefix mdast (stripped-node aware) and
  // rebuild its trailing separators. Bails null on any layout the model
  // does not cover — the caller falls back to a full parse for the frame.
  const aligned = alignPrefixCut(prefixMdast, cutRegion, tailWrapVisible, resume?.hast?.align ?? null);
  if (aligned === null) return null;
  const hastChildren = aligned.children;
  const interiorFinalLiteral = aligned.interiorFinalLiteral;

  // --- tail: strip the injected region's hast, then re-base ---
  const stripResult = stripInjectedHast(tailMdast, tailHast, injectedLen, tailWrapVisible);
  if (stripResult === null) return null;
  const strippedTailHast = stripResult.rest;
  for (const child of tailMdastChildren) rebaseTree(child, offsetDelta, lineDelta);
  for (const child of strippedTailHast) rebaseTreeDual(child, injectedSegments, offsetDelta, lineDelta);

  // --- join ---
  //
  // Seam anatomy (all learned from the arbiter, not theory):
  // - Pre-raw, wrap() puts exactly ONE '\n' text node between any two root
  //   children — including between the last frozen block and the first
  //   tail block; `alignPrefixCut` has already synthesized it (plus one per
  //   trailing stripped-child gap) as plain '\n' nodes.
  // - rehype-raw's reserialize+reparse HOISTS whitespace-only text out of
  //   table internals to just BEFORE the <table> (parse5 foster-parenting),
  //   then merges it with the adjacent separator into one multi-'\n' text
  //   node. That run is TAIL-derived and grows with the table — it must
  //   come from the tail parse (which reproduces it as leading text), not
  //   from the previous frame's tree. Joining therefore MERGES the seam
  //   separator with the tail's leading text, exactly like the reparse
  //   would — but ONLY when they were literally adjacent in the serialized
  //   HTML. A tail whose first wrap-visible child was sanitize-STRIPPED
  //   (leading comment) emits its leading text as a gap SLOT that the full
  //   parse keeps as a separate node (the comment sat between them at
  //   reparse time), so merging would be wrong there.
  const mdastChildren = prefixMdast.concat(tailMdastChildren);
  // Layout-driven verdict when the injection gap proved it (see
  // stripInjectedHast docs); the classification covers uninjected tails and
  // bails to a full parse when the seam is genuinely ambiguous.
  const seamMergeVerdict = stripResult.remnantMerged ?? tailLeadingTextIsHoist(tailMdastChildren, strippedTailHast);
  if (seamMergeVerdict === null) return null;
  const seamMergeAllowed = seamMergeVerdict;
  let firstTailChild = true;
  for (const child of strippedTailHast) {
    const tailEnd = hastChildren[hastChildren.length - 1];
    if (firstTailChild && child.type === 'text' && child.position !== undefined) {
      // The tail LEADS with a positioned bare text — a raw literal whose
      // preceding construct vanished at the tokenizer (stray end tag's
      // trailing spaces, deep-soak counterexample). A full parse merges it
      // into the seam separator (or keeps it apart when the vanished thing
      // was sanitize-stripped) — classifying which means modeling the
      // tokenizer. Bail to a full parse.
      return null;
    }
    if (firstTailChild && tailEnd && tailEnd.type === 'text' && child.type === 'text' && child.position === undefined) {
      // Interior-literal gate (seed-20260838, join side): when the cut
      // ends in an INTERIOR raw literal (classified by alignPrefixCut —
      // its stripped following sibling kept it un-merged at reparse
      // time), the full parse keeps it verbatim with a SEPARATE
      // separator after it, never merged. Push the tail child as its own
      // node; a hoist-merge verdict against it is out of model — bail.
      // Block-final positioned literals do NOT take this path: the full
      // parse merges them with the seam separator exactly like the
      // position-less artifacts this branch models.
      if (interiorFinalLiteral && tailEnd.value.trim() !== '') {
        if (seamMergeAllowed) return null;
        firstTailChild = false;
        hastChildren.push(child);
        continue;
      }
      // A trailing html-block literal absorbs adjacent tail text the same
      // way (footer separator of an all-invisible tail — no wrap slot sat
      // between them at reparse time), and the merge drops the source
      // position, matching hast-util-raw's merged-text output.
      const literalSeam = tailEnd.value.trim() !== '' && !tailWrapVisible;
      if (seamMergeAllowed || literalSeam) {
        // Adjacent text at the seam — the full parse would have merged
        // these during rehype-raw's reparse. Replace (don't mutate) the
        // seam node: it may be a reference into the previous frame's tree.
        hastChildren[hastChildren.length - 1] = { type: 'text', value: tailEnd.value + child.value };
        firstTailChild = false;
        continue;
      }
    }
    firstTailChild = false;
    hastChildren.push(child);
  }

  // No POSITIONED top-level output → bail (fuzz + exhaustive-sweep
  // finding). hast-util-raw anchors the rebuilt root's position on its
  // positioned output nodes: a sanitize-stripped comment still anchored it
  // (positioned pre-sanitize), while a defs-only doc, a tokenizer-dropped
  // `<?…` opener, or a stray `</d>` end tag (dropped, leaving only a bare
  // position-less wrap separator behind) do not — and removeComments
  // shifts the comment case across that line. Reconstructing the verdict
  // for position-less-only output means re-modeling the parse5 tokenizer
  // per child; such frames are tiny by construction, so a full parse costs
  // nothing.
  if (!hastChildren.some((child) => child.position !== undefined)) return null;

  // Root positions must match a full parse: start of document to end of
  // document. The re-based tail MDAST root end IS the document end. The
  // tail HAST root's position is NOT source-based after rehype-raw's
  // reparse (hast-util-raw rewrites it in serialized-HTML coordinates), so
  // it cannot be re-based — but a full parse with POSITIONED output (the
  // other case bailed above) leaves the hast root position equal to the
  // mdast root position (arbiter-verified), so reuse that.
  const docStart = { line: 1, column: 1, offset: 0 };
  const mdastRootPosition = tailMdast.position
    ? { start: docStart, end: rebasePoint(tailMdast.position.end, offsetDelta, lineDelta) }
    : prevMdast.position;
  const hastRootPosition = mdastRootPosition;

  const mdast: MdastRoot = { type: 'root', children: mdastChildren };
  if (mdastRootPosition) mdast.position = mdastRootPosition;
  const hast: HastRoot = { type: 'root', children: hastChildren };
  if (hastRootPosition) hast.position = hastRootPosition;
  if (prevHast.data !== undefined) hast.data = prevHast.data;
  // The join above only ever rewrote `hastChildren` at or past the aligned
  // content's end (a seam text is a rebuilt separator or a trailing literal,
  // and the literal path hands out no resume), so `[0, outLen)` of the
  // returned hast is the aligned cut the alignment snapshot describes. The
  // attribution state is the one after the cut's last content node — its
  // trailing separators are position-less, so it holds at `outLen` too.
  const cache: SplicePrefixCacheInternal = {
    boundary,
    roots: { mdast, hast },
    lines: prefixLines,
    mdastCount: prefixMdast.length,
    tableDepth: tableScan.depth,
    hast: aligned.resume
      ? {
          align: aligned.resume,
          attribution: {
            attrs,
            hastIdx: aligned.resume.outLen,
            cursor: attribution.cursor,
            mdastIdx: attribution.mdastIdx,
          },
        }
      : null,
  };
  return { mdast, hast, cache };
}

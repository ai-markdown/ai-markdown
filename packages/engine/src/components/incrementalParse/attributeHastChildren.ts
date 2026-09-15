/**
 * Source-offset attribution for top-level hast children.
 *
 * hast positions alone cannot delimit a frozen prefix: rehype-katex
 * replaces a math block with a position-less span (and other plugins can
 * do the same), and mdast-util-to-hast's root `wrap()` interleaves
 * position-less `'\n'` text separators. Each top-level hast child is
 * therefore attributed a source offset:
 *
 * - its own `position.start.offset` when present;
 * - otherwise the start of the first top-level MDAST child at or after the
 *   running cursor (top-level mdast children always carry positions — this
 *   mirrors blockMemo's source-offset lookup);
 * - the synthetic footnote section is attributed `Infinity` — it is never
 *   freeze-eligible (production handles it via `FootnoteSectionEntry` /
 *   `aggregateFootnotesIfLast`, not positional identity).
 *
 * The returned array is non-decreasing except for `Infinity` entries, so
 * "children attributed before offset b" is always a prefix of the child
 * list.
 *
 * Extracted from the prefixFreeze experiment's falsification harness
 * (which now imports this module) — the production splice and the
 * experiment must cut prefixes identically or the experiment stops being
 * evidence.
 */

import type { Root as HastRoot } from 'hast';
import type { Root as MdastRoot } from 'mdast';

import { isFootnoteSection } from '../hastPredicates';

/** Walk state captured by `attributeHastChildrenResumable` so the next
 *  splice frame can continue the walk instead of restarting it at index 0
 *  (the per-frame O(document) cost the splice cache exists to remove). */
export interface AttributionResume {
  /** Attribution values for hast children `[0, hastIdx)`, as computed by
   *  the walk that produced this state. */
  attrs: number[];
  /** First hast index the resumed walk attributes. */
  hastIdx: number;
  /** Running cursor / mdast index as they stood at `hastIdx`. */
  cursor: number;
  mdastIdx: number;
}

export function attributeHastChildren(mdast: MdastRoot, hast: HastRoot, stopAt = Infinity): number[] {
  return attributeHastChildrenResumable(mdast, hast, stopAt, null).attrs;
}

/**
 * Same attribution, resumable. With `resume`, children `[0, resume.hastIdx)`
 * take their values from `resume.attrs` and the walk continues from
 * `resume.hastIdx` with the recorded cursor state; the caller guarantees
 * that those children and the mdast prefix they map onto are the same node
 * objects the recorded walk saw (the splice cache's identity anchors).
 *
 * The returned `cursor` / `mdastIdx` are the state after the LAST child
 * attributed below `stopAt` — the state a walk resuming at any index whose
 * preceding run back to that child is position-less (the trailing wrap
 * separators of a cut) would be in, because position-less children never
 * move the cursor, and `mdastIdx` only ever advances lazily to the first
 * mdast child at or past the cursor, so any value at or below that point
 * attributes identically.
 *
 * `stopAt` truncates the walk once attribution reaches the boundary — the
 * splice consumer only reads the prefix, and top-level attribution is
 * non-decreasing (E5).
 */
export function attributeHastChildrenResumable(
  mdast: MdastRoot,
  hast: HastRoot,
  stopAt: number,
  resume: AttributionResume | null
): { attrs: number[]; cursor: number; mdastIdx: number } {
  const mdastChildren = mdast.children;
  let cursor = resume ? resume.cursor : 0;
  // Index into `mdast.children` (position-less children are skipped in
  // place — same values as the compact start-offset array this walk used
  // to precompute, without rebuilding it every frame).
  let mdastIdx = resume ? resume.mdastIdx : 0;
  const out: number[] = resume ? resume.attrs.slice(0, resume.hastIdx) : [];
  let settledCursor = cursor;
  let settledMdastIdx = mdastIdx;
  for (let i = resume ? resume.hastIdx : 0; i < hast.children.length; i++) {
    const attr = attributeOne(hast.children[i], hast.children[i + 1]);
    out.push(attr);
    if (attr >= stopAt) break;
    settledCursor = cursor;
    settledMdastIdx = mdastIdx;
  }
  return { attrs: out, cursor: settledCursor, mdastIdx: settledMdastIdx };

  function attributeOne(child: HastRoot['children'][number], next?: HastRoot['children'][number]): number {
    const start = child.position?.start?.offset;
    const end = child.position?.end?.offset;
    if (start !== undefined && start !== null) {
      cursor = Math.max(cursor, end ?? start);
      return start;
    }
    if (child.type === 'element' && isFootnoteSection(child)) return Infinity;
    // The footer's PRECEDING '\n' is footer plumbing appended after wrap()
    // (footer.js pushes `'\n', <section>`), not a wrap gap slot — pin it to
    // the section's Infinity so the prefix cut never absorbs it.
    if (child.type === 'text' && next?.type === 'element' && isFootnoteSection(next)) return Infinity;
    while (mdastIdx < mdastChildren.length) {
      const off = mdastChildren[mdastIdx].position?.start?.offset;
      if (off !== undefined && off >= cursor) return off;
      mdastIdx += 1;
    }
    return cursor;
  }
}

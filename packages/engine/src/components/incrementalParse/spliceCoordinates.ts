/** Position conversion for freshly parsed tail trees; previous trees are never mutated. */
import type { Node as UnistNode, Position } from 'unist';

/** One injected footnote-definition block's coordinate mapping — footer
 *  `<li>` content carries positions from the DEF node, so injected-copy
 *  coordinates must be rewritten back to the original's (C0 probe). */
export interface InjectedSegment {
  injStart: number;
  injEnd: number;
  offsetDelta: number;
  lineDelta: number;
}

export interface TreeWithChildren extends UnistNode {
  children?: UnistNode[];
}

/**
 * Shift every position in the subtree from tail-parse coordinates into
 * document coordinates. Tolerates position-less subtrees (KaTeX output).
 * Mutates in place — callers only pass freshly-parsed tail trees.
 */
export function rebaseTree(node: UnistNode, offsetDelta: number, lineDelta: number): void {
  // Exactly rebaseTreeDual with no segments (find never matches) — one
  // implementation, two names for the two call sites' semantics.
  rebaseTreeDual(node, EMPTY_SEGMENTS, offsetDelta, lineDelta);
}

const EMPTY_SEGMENTS: InjectedSegment[] = [];

/**
 * Dual-rule position rebase for the tail HAST (C0-probe-verified): the
 * footer's `<li>` content carries positions from footnoteById's DEF nodes —
 * for INJECTED defs those are injection coordinates (per-segment mapping),
 * while tail-native nodes (inline content and tail-defined footnotes) take
 * the ordinary tail shift. Dispatch is per POINT with CLOSED segment bounds:
 * END offsets are exclusive, so a node ending exactly at a segment's last
 * byte has offset === injEnd (at least one line ending separates segments
 * and the next one starts past it — unambiguous).
 * Column is invariant under both rules (defs are sliced from line start).
 */
export function rebaseTreeDual(
  node: UnistNode,
  segments: InjectedSegment[],
  offsetDelta: number,
  lineDelta: number
): void {
  // Segments live entirely inside the injection prefix; after the injected
  // region is stripped, ~every remaining point sits past them all. One
  // bound check replaces an always-failing O(segments) scan per point
  // (final-review R3).
  const maxEnd = segments.length > 0 ? segments[segments.length - 1].injEnd : -1;
  rebaseDualWalk(node, segments, maxEnd, offsetDelta, lineDelta);
}

function rebaseDualWalk(
  node: UnistNode,
  segments: InjectedSegment[],
  maxEnd: number,
  offsetDelta: number,
  lineDelta: number
): void {
  const position = node.position as Position | undefined;
  if (position) {
    for (const point of [position.start, position.end]) {
      // Plugin-shaped trees (a consumer's own remark/rehype plugin emitting
      // `{ position: {} }` or a half-built point) reached this walk and threw
      // `Cannot read properties of undefined (reading 'offset')` out of the
      // render path — every other splice defence against such trees bails;
      // this one tolerates, like its "position-less subtrees" contract says.
      if (!point) continue;
      const seg =
        point.offset !== undefined && point.offset <= maxEnd
          ? segments.find((s) => point.offset! >= s.injStart && point.offset! <= s.injEnd)
          : undefined;
      if (seg) {
        point.offset! += seg.offsetDelta;
        if (typeof point.line === 'number') point.line += seg.lineDelta;
      } else {
        if (point.offset !== undefined) point.offset += offsetDelta;
        if (typeof point.line === 'number') point.line += lineDelta;
      }
    }
  }
  const children = (node as TreeWithChildren).children;
  if (children) {
    for (const child of children) rebaseDualWalk(child, segments, maxEnd, offsetDelta, lineDelta);
  }
}

export function rebasePoint(point: Position['end'], offsetDelta: number, lineDelta: number): Position['end'] {
  return {
    line: point.line + lineDelta,
    column: point.column,
    offset: point.offset !== undefined ? point.offset + offsetDelta : undefined,
  };
}

/** Line endings in `text[from, end)` (defaults to the whole string) — the
 *  bounds avoid allocating prefix slices on the per-frame hot path, and
 *  `from` lets the splice cache count only the bytes the boundary advanced
 *  over since the last frame. Counts what micromark counts: `\n`, `\r\n`
 *  and a LONE `\r` are one line ending each (2026-08-19 review P2-1: a
 *  lone `\r` in the frozen prefix left every rebased tail `position.line`
 *  one short — offsets and shape were right, only the line numbers
 *  drifted). Two indexOf sweeps keep the hot path allocation-free; a `\r`
 *  directly followed by `\n` is the CRLF pair, already counted by the `\n`
 *  sweep (a CRLF split by `from` is still counted once: the `\r` half
 *  looks past `from` at its `\n`, the `\n` half counts on its own). */
export function countNewlines(text: string, end = text.length, from = 0): number {
  let count = 0;
  for (let i = text.indexOf('\n', from); i !== -1 && i < end; i = text.indexOf('\n', i + 1)) count += 1;
  for (let i = text.indexOf('\r', from); i !== -1 && i < end; i = text.indexOf('\r', i + 1)) {
    if (text.charCodeAt(i + 1) !== 10 /* \n */) count += 1;
  }
  return count;
}

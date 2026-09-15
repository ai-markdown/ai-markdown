/** Ordered replay of frozen reference/definition events into a tail parse. */
import { normalizeIdentifier } from 'micromark-util-normalize-identifier';
import type { Root as MdastRoot } from 'mdast';
import type { Node as UnistNode } from 'unist';
import { countNewlines, type InjectedSegment, type TreeWithChildren } from './spliceCoordinates';

/** Prefix footnote/definition events in DOCUMENT ORDER. Order is the whole
 *  point: mdast-util-to-hast's footnoteOrder/footnoteCounts are built from
 *  encounter order, and the replay must reproduce it exactly. */
export type InjectionEvent =
  /** Link/image definition — parse-time resolution only, zero hast. */
  | { kind: 'def'; source: string }
  /** Footnote definition — sliced from the PHYSICAL LINE START (column
   *  invariance for the footer position rebase). `concreteEnd`: the body's
   *  last block is a code / math / html node, so the definition's END moves
   *  with the blank lines that follow it (see `endsInConcreteBlock`). */
  | { kind: 'footnoteDef'; source: string; origStart: number; origLine: number; concreteEnd: boolean }
  /** Consecutive footnote references, verbatim source tokens. Seeds
   *  footnoteOrder (first-encounter) and footnoteCounts (backref -N ids). */
  | { kind: 'refs'; tokens: string[] };

export interface PrefixInjectionPlan {
  events: InjectionEvent[];
  /** True when an event exists that CANNOT be injected reliably — the caller
   *  must fall back to a full parse for this frame (safe, one-frame cost). */
  uninjectable: boolean;
  /** False when the plan must NOT be cached for resume: a position-less
   *  top-level child cannot be partitioned by the resume offset, so a
   *  resumed walk would re-visit it and duplicate its events (round-2
   *  review). Fresh walks stay correct — they just can't be incremental. */
  cacheable?: boolean;
}

/** A plan cached in engine state: valid for any LATER boundary of the same
 *  append lineage, because events derive from (content, positions) alone
 *  and the boundary is monotone under appends — new frames only APPEND
 *  events for children in [cached.boundary, newBoundary). */
export interface CachedInjectionPlan extends PrefixInjectionPlan {
  boundary: number;
}

/** Collect the prefix's injectable events (document order).
 *
 * Walks the FULL subtree, not just top-level children: definitions nested
 * inside blockquotes/lists are document-scoped in CommonMark
 * (probe-confirmed A3 — a `> [a]: /url` def must resolve a later tail
 * ref). A nested link definition's position starts at its own `[`, so a
 * single-line slice is a valid standalone def line; a MULTI-LINE nested
 * slice would drag `> ` container prefixes into the injection text, so it
 * is flagged uninjectable instead (full-parse fallback).
 *
 * Footnote definitions must be sliced from their physical line start (the
 * footer position rebase requires column invariance), so ANY nested
 * footnote def is uninjectable — the line-start slice would drag the `> `
 * container prefix in, and a node-start slice would shift columns.
 *
 * footnoteDefinition subtrees are NOT descended: refs inside a def body are
 * counted at FOOTER time (state.all over the stored def node), and the
 * injected def text replays them there; emitting them as inline events
 * would double-count.
 */
export function collectPrefixInjection(
  mdast: MdastRoot,
  content: string,
  boundary: number,
  resume?: CachedInjectionPlan | null,
  /** Leading top-level children the caller KNOWS are positioned, in
   *  document order and below `resume.boundary` — the splice cache's frozen
   *  prefix, which the cut that built it filtered by position and whose
   *  order the plan walks of the frames that froze it verified. The
   *  ordering scan below would inspect each of them and `continue`; it
   *  starts after them instead, seeded with the last one's start so the
   *  check on the first inspected child is unchanged. Only honoured with a
   *  valid resume, since without one every child must be visited. */
  verifiedPrefix = 0
): PrefixInjectionPlan {
  // Resume path (final-review R3): the frozen prefix is byte-identical
  // frame to frame, so a cached plan only needs the children in
  // [resume.boundary, boundary) appended — without this the deep visit
  // re-walks the ENTIRE prefix every splice frame (the collectDefLabels
  // O(stream²) shape). Boundary validity gates EVERYTHING resumed —
  // including the sticky-uninjectable short-circuit: the boundary is
  // monotone within an append lineage today, but a regressed cache must
  // degrade to a fresh walk, never to a stale verdict (round-2 review).
  const resumeValid = resume != null && resume.boundary <= boundary;
  // `uninjectable` is sticky: the offending node stays in the prefix for
  // the lineage's lifetime.
  if (resumeValid && resume!.uninjectable) return { events: resume!.events, uninjectable: true };
  const resumeAt = resumeValid ? resume!.boundary : 0;
  const events: InjectionEvent[] = resumeAt > 0 ? cloneEventsForAppend(resume!.events) : [];
  let uninjectable = false;
  let cacheable = true;
  const pushRef = (token: string): void => {
    const last = events[events.length - 1];
    if (last && last.kind === 'refs') last.tokens.push(token);
    else events.push({ kind: 'refs', tokens: [token] });
  };
  const visit = (node: UnistNode, nested: boolean): void => {
    const type = (node as { type?: string }).type;
    if (type === 'definition') {
      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;
      if (start !== undefined && end !== undefined && start < boundary) {
        const slice = content.slice(start, end);
        if (nested && slice.includes('\n')) uninjectable = true;
        else events.push({ kind: 'def', source: slice });
      }
      return;
    }
    if (type === 'footnoteDefinition') {
      const start = node.position?.start;
      const end = node.position?.end?.offset;
      if (start?.offset === undefined || end === undefined || start.offset >= boundary) return;
      if (nested) {
        uninjectable = true;
        return;
      }
      const lineStart = start.offset - (start.column - 1);
      events.push({
        kind: 'footnoteDef',
        source: content.slice(lineStart, end),
        origStart: lineStart,
        origLine: start.line,
        concreteEnd: endsInConcreteBlock(node),
      });
      return; // body refs replay at footer time via the injected text
    }
    if (type === 'footnoteReference') {
      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;
      if (start === undefined || end === undefined) {
        uninjectable = true; // cannot reproduce the token verbatim
        return;
      }
      pushRef(content.slice(start, end));
      return;
    }
    const children = (node as TreeWithChildren).children;
    if (children) {
      for (const child of children) visit(child, true);
    }
  };
  // Top-level children are position-ordered with the shipped chain, and the
  // event stream assumes it. A plugin-shaped tree that reorders top-level
  // nodes must not produce a WRONG plan: an early break at the boundary
  // would silently skip a def that sits after a later-positioned sibling,
  // so the walk uses filter semantics (every child is inspected, only those
  // in [resumeAt, boundary) are visited) and flags any disorder as
  // uninjectable (full-parse fallback) — the cut layer's correct-or-bailing
  // promise for the same threat model (2026-08 project review, eng-parse-07).
  const children = mdast.children;
  const skip = resumeValid && verifiedPrefix > 0 ? Math.min(verifiedPrefix, children.length) : 0;
  let lastStart = skip > 0 ? (children[skip - 1].position?.start?.offset ?? -1) : -1;
  for (let i = skip; i < children.length; i++) {
    const child = children[i];
    // Nothing at or past the boundary can contribute a prefix event (E5),
    // and nothing before the resume point needs re-visiting.
    const start = child.position?.start?.offset;
    if (start !== undefined) {
      if (start < lastStart) return { events: [], uninjectable: true, cacheable: false };
      lastStart = start;
    }
    if (start === undefined) {
      // A position-less top-level child cannot be partitioned by offset: a
      // resumed walk would re-visit it and DUPLICATE its cached events.
      // Restart fresh once (correct by construction) and mark the plan
      // uncacheable. Unreachable with the shipped chain (the parser
      // positions every top-level node); defense for plugin-shaped trees.
      if (resumeAt > 0) return collectPrefixInjection(mdast, content, boundary, null);
      cacheable = false;
      visit(child, false);
      continue;
    }
    if (start >= boundary || start < resumeAt) continue;
    visit(child, false);
  }
  return { events, uninjectable, cacheable };
}

/** Flow containers whose LAST child decides where the container's own end
 *  lands. `defList*` are remark-definition-list's nodes; a container type
 *  outside this set stops the walk and reads as non-concrete, which keeps
 *  the old two-newline join for it. */
const FLOW_CONTAINER_TYPES = new Set([
  'footnoteDefinition',
  'list',
  'listItem',
  'blockquote',
  'defList',
  'defListDescription',
]);

/** Block nodes micromark closes only at the container's end: an unclosed
 *  fence, `$$` block or html block (types 1-5) keeps consuming blank lines
 *  until a non-continuing line arrives. */
const CONCRETE_BLOCK_TYPES = new Set(['code', 'math', 'html']);

/**
 * Does the definition's body END in a code / math / html block (through any
 * nesting of lists and blockquotes)?
 *
 * micromark places a footnote definition's end at the point where its flow
 * was closed. A paragraph-like last block closes at the end of its last
 * content line, and blank lines after it never move that end, so any
 * number of blank lines before the next injected block reproduces it — the
 * `'\n\n'` join. A concrete block left OPEN (`\t```` inside the body, never
 * closed) absorbs the blank lines that follow it, so the definition's end
 * moves with them: a non-container closer leaves the end at the start of
 * the last blank line, a container closer (another footnote def, a list
 * item) at its own line start, and with no blank line at all the end sits
 * mid-line after the fence. The `'\n\n'` join put a second blank line
 * inside the still-open fence, the tail's copy of the definition ended one
 * line later than the frozen original, fell outside its injected segment,
 * and the footer's `<li>` / `<pre>` / `<code>` positions came back rebased
 * by the tail delta instead of the segment's (observed `end.offset: -33`
 * for `[^a]: b\n\n\t```\n\n<b>x</b>\n\np\n`; fuzz seeds 20260916 /
 * 20260917). `buildInjectionPrefix` closes such a definition with one line
 * ending and a non-container line instead. A CLOSED fence, an indented
 * code block and a type-6 html block all end mid-line and cannot lazily
 * continue, so the same closing is exact for them too (measured on every
 * shape, 2026-09-15). A trailing inline html node inside a paragraph must
 * NOT count: the paragraph would lazily continue into the closing line —
 * hence the walk descends through flow containers only.
 */
function endsInConcreteBlock(def: UnistNode): boolean {
  let node = def as TreeWithChildren;
  while (FLOW_CONTAINER_TYPES.has(node.type) && node.children !== undefined && node.children.length > 0) {
    node = node.children[node.children.length - 1] as TreeWithChildren;
  }
  return CONCRETE_BLOCK_TYPES.has(node.type);
}

/** Cached plans are shared with the previous state — clone the array, and
 *  the trailing refs event too (pushRef mutates its token list when the new
 *  region opens with another reference). */
function cloneEventsForAppend(events: InjectionEvent[]): InjectionEvent[] {
  const out = events.slice();
  const last = out[out.length - 1];
  if (last && last.kind === 'refs') out[out.length - 1] = { kind: 'refs', tokens: last.tokens.slice() };
  return out;
}

export interface InjectionPrefix {
  text: string;
  segments: InjectedSegment[];
}

/** The injection TERMINATOR: a sentinel link-definition block appended after
 *  the last event. The detector's blockers prove the REAL prefix is inert
 *  toward the tail — but the injection text itself introduces continuation
 *  context the real prefix did not have (final-review R1, probe-confirmed):
 *
 *  - a trailing footnote-def event's body continues across blank lines into
 *    any >=4-indented tail line, swallowing real content into a node the
 *    splice then strips;
 *  - with the definition-list extension, a tail-leading `: desc` separated
 *    from the ORIGINAL prefix by two blank lines (claim-immune) sits only
 *    ONE '\n\n' from the last injected block and would claim it as a <dt>.
 *
 *  A column-0 link definition neutralizes both: it terminates a footnote
 *  body (not >=4-indented), cannot be claimed as a <dt> (not a paragraph),
 *  emits zero hast and zero wrap-separator slots, and is stripped with the
 *  rest of the injected region.
 *
 *  Unlike the phantom sentinel URLs (values — they can never change parse
 *  SHAPE), a definition LABEL is resolvable by any `[label]` mention, so a
 *  document that literally writes the sentinel label would have its tail
 *  mentions resolve against the terminator (round-2 review, probe-
 *  confirmed). {@link tailMentionsTerminator} closes that structurally:
 *  such frames take the full path instead of splicing. */
const TERMINATOR_LABEL = '__aimd_injection_terminator__';

const INJECTION_TERMINATOR = `[${TERMINATOR_LABEL}]: __aimd_sentinel_link__`;

/** True when the tail input could REFERENCE the terminator's label — the
 *  one input class where the splice's synthetic definition would change how
 *  the tail parses. Prefix mentions need no check: an unresolved mention is
 *  reference-tainted (pinned into the tail), and a resolved one has a real
 *  def that wins first-def-wins over the terminator. */
export function tailMentionsTerminator(tailSource: string): boolean {
  // micromark matches labels after `normalizeIdentifier` (whitespace
  // collapse + Unicode case fold), so `[__AIMD_INJECTION_TERMINATOR__]` — or
  // a dotless-ı variant — resolves against the lowercase terminator def just
  // the same. Compare in the same normal form (2026-08 project review,
  // eng-parse-04: a byte-exact `includes` let case variants through).
  // Whitespace right after `[` is trimmed by micromark's label matching
  // too (`[ __aimd_…]` resolves) — collapse it before the check (v2.4.0
  // review P5).
  return normalizeIdentifier(tailSource)
    .replace(/\[ /g, '[')
    .includes(`[${normalizeIdentifier(TERMINATOR_LABEL)}`);
}

/** Build the injection text prepended to the tail source (with per-footnote-
 *  def coordinate segments). Blocks are '\n\n'-joined: a def line directly
 *  after a ref paragraph would be a paragraph CONTINUATION (A2, literal
 *  text), and anything unindented after a footnote def line would join its
 *  body.
 *
 *  A footnote def whose body ends in a concrete block (`endsInConcreteBlock`)
 *  is closed differently: ONE line ending, then a copy of the terminator
 *  line, then the usual blank line. The def's end in the tail depends on
 *  what closes it, and a non-container closer one line ending after the
 *  sliced source reproduces the original end in every case: a source that
 *  ends mid-line (no blank followed it) is closed directly, one that ends
 *  at a line start (blank lines followed it, the last one excluded) gets
 *  that blank line back, and one that ends after a blank line (a container
 *  closed it, blank included) gets one more blank line, which the
 *  non-container closer excludes again. The next injected event would not
 *  do: a footnote def closing it puts the end at its own line start
 *  instead, one line later than a blank-line closer. */
export function buildInjectionPrefix(events: InjectionEvent[]): InjectionPrefix {
  if (events.length === 0) return { text: '', segments: [] };
  let text = '';
  // Rolling line number of the text end — recounting the accumulated text
  // per event would be O(events × textLength) (final-review R3).
  let line = 1;
  // Separator owed before the next block by the event just written.
  let separator = '';
  const segments: InjectedSegment[] = [];
  for (const event of events) {
    if (text.length > 0) {
      text += separator;
      line += countNewlines(separator);
    }
    const injStart = text.length;
    const source = event.kind === 'refs' ? event.tokens.join(' ') : event.source;
    if (event.kind === 'footnoteDef') {
      segments.push({
        injStart,
        injEnd: injStart + source.length,
        offsetDelta: event.origStart - injStart,
        lineDelta: event.origLine - line,
      });
    }
    text += source;
    line += countNewlines(source);
    separator =
      event.kind === 'footnoteDef' && event.concreteEnd
        ? `${singleLineEnding(source)}${INJECTION_TERMINATOR}\n\n`
        : '\n\n';
  }
  // A concrete-ending last event already carries its terminator line.
  const closing = separator === '\n\n' ? `\n\n${INJECTION_TERMINATOR}\n\n` : separator;
  return { text: text + closing, segments };
}

/** One line ending after `source`. A source ending in a lone `\r` would fuse
 *  with a following `\n` into one CRLF ending, so it gets `\r\n` — two
 *  endings to micromark, one blank line, the same as `\n` after `\n`. */
function singleLineEnding(source: string): string {
  return source.endsWith('\r') ? '\r\n' : '\n';
}

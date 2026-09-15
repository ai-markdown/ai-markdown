/**
 * Task-list ownership tracker for the freeze scanner (blocker 5, the GFM
 * task-list leg of reference taint).
 *
 * `collectRefLine` pushes every `[x]` / `[X]` as a shortcut-reference
 * candidate, and a real task list never brings the `[x]:` definition that
 * would settle it, so a document with one checked box used to stay at the
 * boundary before the list for the rest of the stream. micromark's
 * `tasklistCheck` construct consumes the box BEFORE reference resolution,
 * but only in one position: the first code of the first content construct
 * of a list item, followed by whitespace and more paragraph text, or by a
 * line ending that is still inside the paragraph. Whether a box sits there
 * depends on the container stack, and whether it STAYS there depends on
 * what follows — a setext underline turns the paragraph into a heading and
 * a GFM table delimiter row turns its last line into a table head, and in
 * both the box is a reference again.
 *
 * This module is a prover, not a second parser. It models the container
 * subset it can follow exactly — root, blockquotes, bullet and ordered
 * lists, with micromark's own continuation, sibling, interrupt and lazy
 * rules (verified against `micromark/lib/initialize/document.js`,
 * `micromark-core-commonmark/lib/list.js`, `block-quote.js`,
 * `setext-underline.js`, `micromark-extension-gfm-task-list-item` and
 * `micromark-util-subtokenize`) — plus the lifecycle of the innermost
 * paragraph. A box is certified only when all of these hold:
 *
 *   - ownership: the box is the first character of the first flow
 *     construct of a list item, at the item's content column (the
 *     subtokenize hook marks only that chunk, and only when nothing but a
 *     single empty line precedes it);
 *   - lexis: `[x]` / `[X]` is followed by a space or tab and a non-space
 *     character on the same line, or by a line ending that a later
 *     confirmed line proves is inside the paragraph;
 *   - block identity: the paragraph closed irreversibly — a blank line, an
 *     interrupting block, or a new container — and, with the
 *     definition-list extension enabled, the back-claim window after a
 *     blank has closed (a non-`:` line, or a second blank);
 *   - trust: no line involved sits at or past `phasePoisonedAt`, and no
 *     line was html-owned or inside a verbatim block the scanner tracks.
 *
 * Anything else — an html block, a footnote definition, a definition-list
 * description, a fence the scanner does not track, a setext or delimiter
 * shape while the paragraph is open — either drops the pending box (it
 * stays an ordinary reference) or puts the tracker into `unknown`, where it
 * proves nothing until a root sync point (a confirmed blank line followed
 * by a column-0 line the scanner does not own). A missed certificate costs
 * only performance; a wrong one changes frozen output, so every doubt
 * resolves to "keep the taint".
 *
 * Columns follow CommonMark's tab stops: a tab spans to the next multiple
 * of four from the line start, and a container prefix may consume part of
 * one, so the cursor can sit inside a tab.
 */

import {
  ATX_HEADING_RE,
  RAW_CONSTRUCT_START_RE,
  THEMATIC_BREAK_RE,
  TYPE1_START_RE,
  TYPE6_NAMES,
  TYPE6_START_RE,
  isType7Line,
} from './freezeLineSyntax';
import type { FreezeScanCheckpointInternal, LineRec } from './freezeScanState';

export type TaskFirstContent = 'unseen' | 'open' | 'consumed';

export interface TaskItemFrame {
  kind: 'item';
  /** Offset of the marker's first character (a stable identity). */
  start: number;
  /** Prefix width in columns, relative to the parent's prefix end — the
   *  indentation a continuation line needs (micromark's `containerState.size`). */
  size: number;
  ordered: boolean;
  /** Bullet character, or the ordered delimiter (`.` / `)`). */
  marker: string;
  firstContent: TaskFirstContent;
  /** The marker line ended right after the marker (`initialBlankLine`). */
  initialBlank: boolean;
  /** A blank line followed an initial-blank marker: the next non-blank line
   *  is not this item's content (`furtherBlankLines`). */
  furtherBlank: boolean;
}

export interface TaskQuoteFrame {
  kind: 'quote';
}

export type TaskFrame = TaskItemFrame | TaskQuoteFrame;

export interface PendingTaskBox {
  /** Offset of the `[` — the exact candidate `collectRefLine` pushed. */
  offset: number;
  /** `waiting`: only `]` and whitespace seen so far; a continuation line
   *  turns it `valid`, a paragraph end drops it. */
  suffix: 'waiting' | 'valid';
}

export interface TaskParagraph {
  /** `open`: still growing. `await`: closed by a blank line under the
   *  definition-list profile — a `:` line could still claim it. */
  phase: 'open' | 'await';
  /** Blank lines seen since the paragraph closed (await only). */
  blanks: number;
  box: PendingTaskBox | null;
}

export interface TaskContext {
  /** The structure is not modelled from here on; nothing is certified
   *  until a root sync point. */
  unknown: boolean;
  /** The previous confirmed line was blank in the raw sense. */
  prevBlank: boolean;
  stack: TaskFrame[];
  paragraph: TaskParagraph | null;
}

export function freshTaskContext(): TaskContext {
  return { unknown: false, prevBlank: true, stack: [], paragraph: null };
}

// ── columns ────────────────────────────────────────────────────────────

interface Cursor {
  /** Index into the line text of the next character. Inside a tab this
   *  stays on the tab until its last column is consumed. */
  i: number;
  col: number;
}

const nextTabStop = (col: number): number => (Math.floor(col / 4) + 1) * 4;
const isSpaceChar = (ch: string | undefined): boolean => ch === ' ' || ch === '\t';

/** Consume up to `max` columns of spaces and tabs; returns the count. */
function eatSpaces(text: string, cur: Cursor, max: number): number {
  let n = 0;
  while (n < max) {
    const ch = text[cur.i];
    if (ch === ' ') {
      cur.i += 1;
      cur.col += 1;
    } else if (ch === '\t') {
      const stop = nextTabStop(cur.col);
      cur.col += 1;
      if (cur.col === stop) cur.i += 1;
    } else break;
    n += 1;
  }
  return n;
}

function restBlank(text: string, cur: Cursor): boolean {
  for (let i = cur.i; i < text.length; i++) if (!isSpaceChar(text[i])) return false;
  return true;
}

// ── list markers ───────────────────────────────────────────────────────

interface MarkerParse {
  ordered: boolean;
  marker: string;
  size: number;
  /** Position right after the marker's own whitespace. */
  after: Cursor;
  /** Nothing but whitespace follows the marker. */
  blankRest: boolean;
  /** Nothing at all follows the marker — the one blank shape whose next
   *  line can still be first content (a trailing space or tab becomes a
   *  `linePrefix` token that the subtokenize hook does not look past). */
  emptyRest: boolean;
}

/**
 * micromark's `tokenizeListStart` at `at` (after the up-to-three-space
 * prefix whose width is `initialSize`). `interrupt` applies the paragraph-
 * interrupt restrictions (non-empty item, ordered start `1` only);
 * `sibling` constrains to the open list's kind and marker (the
 * `notInCurrentItem` path, which runs with interrupt cleared).
 */
function parseListMarker(
  text: string,
  at: Cursor,
  initialSize: number,
  interrupt: boolean,
  sibling: { ordered: boolean; marker: string } | null
): MarkerParse | null {
  const c = { ...at };
  const ch = text[c.i];
  let ordered = false;
  let marker: string;
  if (ch === '-' || ch === '*' || ch === '+') {
    if (sibling !== null && (sibling.ordered || sibling.marker !== ch)) return null;
    if ((ch === '-' || ch === '*') && THEMATIC_BREAK_RE.test(text.slice(c.i))) return null;
    marker = ch;
    c.i += 1;
    c.col += 1;
  } else if (ch !== undefined && ch >= '0' && ch <= '9') {
    if (sibling !== null && !sibling.ordered) return null;
    let digits = 0;
    while (text[c.i] >= '0' && text[c.i] <= '9') {
      digits += 1;
      if (digits > 9) return null;
      c.i += 1;
      c.col += 1;
    }
    const delimiter = text[c.i];
    if (delimiter !== '.' && delimiter !== ')') return null;
    if (sibling !== null && sibling.marker !== delimiter) return null;
    if (interrupt && (digits !== 1 || ch !== '1')) return null;
    ordered = true;
    marker = delimiter;
    c.i += 1;
    c.col += 1;
  } else return null;
  const markerWidth = c.col - at.col;
  if (restBlank(text, c)) {
    if (interrupt) return null;
    return {
      ordered,
      marker,
      size: initialSize + markerWidth + 1,
      after: c,
      blankRest: true,
      emptyRest: c.i === text.length,
    };
  }
  if (!isSpaceChar(text[c.i])) return null;
  // One to four columns of whitespace belong to the prefix; five or more
  // mean the content is indented code and only one column is prefix.
  const probe = { ...c };
  const columns = eatSpaces(text, probe, Number.POSITIVE_INFINITY);
  const ws = columns <= 4 ? columns : 1;
  const after = { ...c };
  eatSpaces(text, after, ws);
  return { ordered, marker, size: initialSize + markerWidth + ws, after, blankRest: false, emptyRest: false };
}

// ── flow line classes ──────────────────────────────────────────────────

type FlowKind = 'continuation' | 'setext' | 'table' | 'code' | 'atx' | 'hr' | 'fence' | 'math' | 'html' | 'paragraph';

const FENCE_OPEN_RE = /^(`{3,}|~{3,})/;
const MATH_OPEN_RE = /^(\$\$+)/;
const SETEXT_RE = /^(?:=+|-+)[ \t]*$/;
/** A GFM table delimiter row, over-approximated: only `-`, `|`, `:` and
 *  whitespace, with at least one dash and at least one pipe or colon
 *  (`micromark-extension-gfm-table` needs one of the two to be seen;
 *  `---` alone is a setext underline). */
const TABLE_DELIMITER_RE = /^(?=[^\n]*-)(?=[^\n]*[|:])[-|: \t]+$/;
const FOOTNOTE_DEF_SHAPE_RE = /^\[\^[^\]]*\]:/;

/**
 * What the flow tokenizer does with `rest` (the line after every container
 * prefix, its `rel` leading columns stripped). `open` says whether the
 * content construct is open, `lazy` whether the line failed a container
 * continuation — setext underlines, table delimiter rows and type-7 html
 * interrupts all read `parser.lazy`.
 */
function classifyFlow(mathFlow: boolean, rest: string, rel: number, open: boolean, lazy: boolean): FlowKind {
  if (rel >= 4) return open ? 'continuation' : 'code';
  if (ATX_HEADING_RE.test(rest)) return 'atx';
  const fence = FENCE_OPEN_RE.exec(rest);
  // A backtick fence's info string may not contain a backtick (A5).
  if (fence !== null && !(fence[1][0] === '`' && rest.slice(fence[0].length).includes('`'))) return 'fence';
  const math = mathFlow ? MATH_OPEN_RE.exec(rest) : null;
  if (math !== null && !rest.slice(math[0].length).includes('$')) return 'math';
  if (rest[0] === '<') {
    if (RAW_CONSTRUCT_START_RE.test(rest) || TYPE1_START_RE.test(rest)) return 'html';
    const t6 = TYPE6_START_RE.exec(rest);
    if (t6 !== null && TYPE6_NAMES.has(t6[1].toLowerCase())) return 'html';
    // Type 7 cannot interrupt content — except on a lazy line, where
    // micromark's `tagName` drops the refusal (`self.interrupt &&
    // !self.parser.lazy[line]`).
    if (isType7Line(rest)) return open && !lazy ? 'continuation' : 'html';
    return open ? 'continuation' : 'paragraph';
  }
  if (open && !lazy) {
    if (SETEXT_RE.test(rest)) return 'setext';
    if (TABLE_DELIMITER_RE.test(rest)) return 'table';
  }
  if (THEMATIC_BREAK_RE.test(rest)) return 'hr';
  return open ? 'continuation' : 'paragraph';
}

// ── state transitions ──────────────────────────────────────────────────

function forget(t: TaskContext): void {
  t.unknown = true;
  t.stack = [];
  t.paragraph = null;
}

function certify(cp: FreezeScanCheckpointInternal, offset: number): void {
  cp.taskCertified.push(offset);
}

/** The innermost item's first content is spent by a block that is not a
 *  paragraph, or by a nested container. */
function consumeFirstContent(t: TaskContext): void {
  const inner = t.stack[t.stack.length - 1];
  if (inner !== undefined && inner.kind === 'item' && inner.firstContent === 'unseen') inner.firstContent = 'consumed';
}

/**
 * The paragraph ends. `blank`: a blank line (setext and table delimiters
 * cannot reach across it; the definition-list claim can, across exactly
 * one). `interrupt`: an interrupting block, a new container or a sibling
 * item, none of which any later line can undo. `convert`: a setext
 * underline or a table delimiter row took the paragraph — the box is a
 * reference. An `await` paragraph resolves here on any non-blank line
 * (`:` lines never reach this function; they forget the context first).
 */
function closeParagraph(
  cp: FreezeScanCheckpointInternal,
  t: TaskContext,
  reason: 'blank' | 'interrupt' | 'convert'
): void {
  const p = t.paragraph;
  if (p === null) return;
  if (p.phase === 'await') {
    if (reason === 'blank') return;
    certify(cp, p.box!.offset);
    t.paragraph = null;
    return;
  }
  for (let i = t.stack.length - 1; i >= 0; i--) {
    const f = t.stack[i];
    if (f.kind === 'item' && f.firstContent === 'open') {
      f.firstContent = 'consumed';
      break;
    }
  }
  if (reason !== 'convert' && p.box !== null && p.box.suffix === 'valid') {
    if (reason === 'blank' && cp.defListEnabled) {
      p.phase = 'await';
      p.blanks = 1;
      return;
    }
    certify(cp, p.box.offset);
  }
  t.paragraph = null;
}

function onBlank(cp: FreezeScanCheckpointInternal, t: TaskContext): void {
  const p = t.paragraph;
  if (p === null) return;
  if (p.phase === 'open') {
    closeParagraph(cp, t, 'blank');
    return;
  }
  p.blanks += 1;
  if (p.blanks >= 2) {
    certify(cp, p.box!.offset);
    t.paragraph = null;
  }
}

/** A line continued the paragraph: the line ending after a waiting box is
 *  inside the paragraph, which is what `tasklistCheck` needs after `]`. */
function continueParagraph(t: TaskContext): void {
  const box = t.paragraph?.box;
  if (box !== undefined && box !== null && box.suffix === 'waiting') box.suffix = 'valid';
}

/** The `tasklistCheck` lexis at the paragraph's first character. */
function boxAt(ln: LineRec, i: number): PendingTaskBox | null {
  const s = ln.text;
  if (s[i] !== '[' || (s[i + 1] !== 'x' && s[i + 1] !== 'X') || s[i + 2] !== ']') return null;
  const after = s[i + 3];
  if (after === undefined) return { offset: ln.start + i, suffix: 'waiting' };
  if (!isSpaceChar(after)) return null;
  let j = i + 3;
  while (j < s.length && isSpaceChar(s[j])) j += 1;
  return { offset: ln.start + i, suffix: j < s.length ? 'valid' : 'waiting' };
}

function pushItem(t: TaskContext, m: MarkerParse, start: number): void {
  consumeFirstContent(t);
  t.stack.push({
    kind: 'item',
    start,
    size: m.size,
    ordered: m.ordered,
    marker: m.marker,
    firstContent: m.blankRest && !m.emptyRest ? 'consumed' : 'unseen',
    initialBlank: m.blankRest,
    furtherBlank: false,
  });
}

/**
 * A block starts in the innermost container. Returns whether it is a
 * fence or math open the scanner must also have seen.
 */
function startBlock(t: TaskContext, ln: LineRec, at: Cursor, rel: number, kind: FlowKind): boolean {
  if (kind === 'paragraph') {
    const inner = t.stack[t.stack.length - 1];
    let box: PendingTaskBox | null = null;
    if (inner !== undefined && inner.kind === 'item' && inner.firstContent === 'unseen') {
      // Extra indentation before the first content becomes a `linePrefix`
      // token, and the subtokenize hook marks nothing past one.
      if (rel === 0) {
        inner.firstContent = 'open';
        box = boxAt(ln, at.i);
      } else inner.firstContent = 'consumed';
    }
    t.paragraph = { phase: 'open', blanks: 0, box };
    return false;
  }
  consumeFirstContent(t);
  if (kind === 'html') forget(t);
  return kind === 'fence' || kind === 'math';
}

/** One confirmed non-blank or blank line, from a modelled state. Returns
 *  whether the tracker saw a fence/math open on it. */
function processLine(cp: FreezeScanCheckpointInternal, t: TaskContext, ln: LineRec): boolean {
  const text = ln.text;
  let cur: Cursor = { i: 0, col: 0 };
  const paragraphOpen = t.paragraph !== null && t.paragraph.phase === 'open';

  // 1. Continue the stack, outermost first, stopping at the first failure.
  let k = 0;
  let failedItem: TaskItemFrame | null = null;
  for (; k < t.stack.length; k++) {
    const f = t.stack[k];
    if (f.kind === 'quote') {
      const c2 = { ...cur };
      eatSpaces(text, c2, 3);
      if (text[c2.i] !== '>') break;
      c2.i += 1;
      c2.col += 1;
      eatSpaces(text, c2, 1);
      cur = c2;
      continue;
    }
    if (restBlank(text, cur)) {
      if (f.initialBlank) f.furtherBlank = true;
      continue;
    }
    if (f.furtherBlank || !isSpaceChar(text[cur.i])) {
      f.furtherBlank = false;
      f.initialBlank = false;
      failedItem = f;
      break;
    }
    f.furtherBlank = false;
    f.initialBlank = false;
    const c2 = { ...cur };
    if (eatSpaces(text, c2, f.size) !== f.size) {
      failedItem = f;
      break;
    }
    cur = c2;
  }
  let continued = k;
  let opened = false;

  // 2. `notInCurrentItem`: a sibling of the failed item's list, tried with
  //    the interrupt flag cleared, closes the flow and the frames inside.
  if (failedItem !== null) {
    const c2 = { ...cur };
    const pre = eatSpaces(text, c2, 3);
    const m = parseListMarker(text, c2, pre, false, { ordered: failedItem.ordered, marker: failedItem.marker });
    if (m !== null) {
      closeParagraph(cp, t, 'interrupt');
      t.stack.length = k;
      pushItem(t, m, ln.start + c2.i);
      cur = m.after;
      continued = t.stack.length;
      opened = true;
    }
  }
  // `self.interrupt` is recomputed only when every container continued;
  // a failed continuation leaves it cleared.
  const interrupt = !opened && continued === t.stack.length && paragraphOpen;

  // 3. New containers, as many as the line opens.
  for (;;) {
    const c2 = { ...cur };
    const pre = eatSpaces(text, c2, 3);
    const ch = text[c2.i];
    if (ch === undefined) break;
    if (ch === '>') {
      if (!opened) {
        closeParagraph(cp, t, 'interrupt');
        t.stack.length = continued;
        opened = true;
      }
      consumeFirstContent(t);
      t.stack.push({ kind: 'quote' });
      c2.i += 1;
      c2.col += 1;
      eatSpaces(text, c2, 1);
      cur = c2;
      continued = t.stack.length;
      continue;
    }
    // Containers outside the modelled subset: a definition-list
    // description (which may also claim the paragraph above) and a
    // footnote definition.
    if (cp.defListEnabled && ch === ':' && (c2.i + 1 === text.length || isSpaceChar(text[c2.i + 1]))) {
      forget(t);
      return false;
    }
    if (ch === '[' && FOOTNOTE_DEF_SHAPE_RE.test(text.slice(c2.i))) {
      forget(t);
      return false;
    }
    const m = parseListMarker(text, c2, pre, interrupt, null);
    if (m === null) break;
    if (!opened) {
      closeParagraph(cp, t, 'interrupt');
      t.stack.length = continued;
      opened = true;
    }
    pushItem(t, m, ln.start + c2.i);
    cur = m.after;
    continued = t.stack.length;
  }

  // 4. The flow line in the innermost container.
  if (restBlank(text, cur)) {
    // Nothing stays open across a blank line, so the containers that did
    // not continue exit before it.
    if (!opened) t.stack.length = continued;
    onBlank(cp, t);
    return false;
  }
  // A non-blank line that is not a `:` description resolves the
  // definition-list window.
  if (t.paragraph !== null && t.paragraph.phase === 'await') closeParagraph(cp, t, 'interrupt');
  const lazy = !opened && continued < t.stack.length;
  const at = { ...cur };
  const rel = eatSpaces(text, at, Number.POSITIVE_INFINITY);
  const rest = text.slice(at.i);
  const open = t.paragraph !== null;
  const kind = classifyFlow(cp.mathFlow, rest, rel, open, lazy);
  if (open) {
    if (kind === 'continuation') {
      continueParagraph(t);
      return false;
    }
    if (kind === 'setext' || kind === 'table') {
      closeParagraph(cp, t, 'convert');
      return false;
    }
    closeParagraph(cp, t, 'interrupt');
  }
  // A lazy line that did not continue the paragraph closes the containers
  // it failed to continue, before its own block starts.
  if (lazy) t.stack.length = continued;
  return startBlock(t, ln, at, rel, kind);
}

/**
 * Commit one confirmed line to the task context. Called from
 * `processConfirmedLine` AFTER the scanner's own transition, on every
 * return path, so the two states never disagree about which line was
 * baked. `verbatimBefore`: a scanner-tracked fence or math block was open
 * at the line start (the line is its interior or closer). `opaque`: the
 * line is html-owned in either grammar, before or after the transition.
 *
 * @soak-entry task-list-release
 */
export function advanceTaskLine(
  cp: FreezeScanCheckpointInternal,
  ln: LineRec,
  verbatimBefore: boolean,
  opaque: boolean
): void {
  if (!cp.taskTracking) return;
  const t = cp.task;
  if (verbatimBefore) {
    t.prevBlank = false;
    return;
  }
  // The scanner's phase is untrusted from the poison on: no certificate
  // may rest on this line, and a sticky poison keeps this branch for good.
  if (cp.phasePoisonedAt <= ln.start || opaque) {
    forget(t);
    t.prevBlank = ln.blank;
    return;
  }
  if (t.unknown) {
    // Root sync: after a confirmed blank line no paragraph is open, so a
    // column-0 line cannot be a lazy continuation, cannot continue a list
    // item (those need the item's indent), a footnote body (four columns)
    // or a description (its size), and a blockquote ended at the blank.
    // Whatever container held the unknown structure is closed here.
    if (ln.blank || !t.prevBlank || isSpaceChar(text0(ln))) {
      t.prevBlank = ln.blank;
      return;
    }
    t.unknown = false;
    t.stack = [];
    t.paragraph = null;
  }
  const trackerOpened = processLine(cp, t, ln);
  const scannerOpened = cp.mdBlock.kind === 'fence' || cp.mdBlock.kind === 'math';
  // A fence the scanner does not track (one behind a `>` prefix, or at
  // four or more raw columns inside an item) would feed its interior to
  // this tracker as text; a fence the tracker does not see would be a
  // model gap. Either disagreement forfeits the proof.
  if (trackerOpened !== scannerOpened) forget(t);
  t.prevBlank = ln.blank;
}

const text0 = (ln: LineRec): string | undefined => ln.text[0];

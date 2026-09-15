/**
 * Blocker 5 — reference taint (the (R) leg of the safety condition),
 * extracted from `computeFreezeBoundary` as a PURE MOVE (two-model plan
 * P2). micromark decides reference-ness at parse time, so a later
 * `[label]:` definition retargets earlier literal `[text]`; every
 * reference-style candidate before a boundary must resolve against a
 * SETTLED definition (one followed by a confirmed blank line). This module
 * owns the definition/reference grammar and the per-line collection over
 * the checkpoint's ref sub-state; the scanner calls `collectRefLine` once
 * per confirmed line and `settleRefsAndEarliestUnresolved` once per scan.
 *
 * Definition settlement also respects the scanner's uncertain-phase limit:
 * untrusted block ownership cannot release an earlier unresolved reference.
 */

import { normalizeIdentifier } from 'micromark-util-normalize-identifier';

import { isMdBlank, mdTrim } from './mdLineText';

export interface UnresolvedRef {
  offset: number;
  label: string;
  footnote: boolean;
}

export const FOOTNOTE_DEF_RE = /^ {0,3}\[\^[^\]]*\]:/;
/** Any link/footnote reference definition at block indent. */
export const DEF_RE = /^ {0,3}\[((?:[^[\]\\]|\\.)+)\]:/;
/** Bracketed inline candidate: link/image reference or shortcut. No nesting
 *  support — plain prose brackets count as taint (conservative direction). */
const REF_RE = /!?\[((?:[^[\]\\]|\\.)*)\]/g;

/** Index of the first unescaped `ch` in `text`, or -1. */
function firstUnescaped(text: string, ch: string): number {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') i += 1;
    else if (text[i] === ch) return i;
  }
  return -1;
}

/** Index of the last unescaped `[` that has no unescaped `]` after it, or -1. */
function lastUnclosedBracket(text: string): number {
  let open = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') i += 1;
    else if (c === '[') open = i;
    else if (c === ']') open = -1;
  }
  return open;
}

function normalizeLabel(label: string): string {
  const collapsed = label.replace(/[ \t\r\n]+/g, ' ').replace(/^ | $/g, '');
  return collapsed ? normalizeIdentifier(collapsed) : '';
}

/**
 * Rest-of-line check for a link definition after `[label]:`: a non-empty
 * destination (angle-bracketed or a bare non-whitespace run), then nothing
 * or a title that CLOSES on this line with nothing after it. Everything
 * else — no destination, non-title garbage, garbage after a closed title
 * (`"t"a`), or a title left OPEN at EOL (its continuation line may append
 * garbage that invalidates the whole def: `"t\nt2"a`, K=4 census) — is
 * rejected: the line is (or may become) a paragraph whose `[label]` stays
 * a live ref. Rejecting a real def only over-blocks (refs stay tainted);
 * registering a ghost under-blocks. Multi-line titles therefore never
 * register — the documented A2 conservative edge.
 */
function isPlausibleLinkDefRest(rest: string): boolean {
  const t = mdTrim(rest);
  if (t === '') return false; // destination-less
  const destEnd = linkDestinationEnd(t);
  if (destEnd === -1) return false; // micromark rejects the destination → paragraph
  const after = mdTrim(t.slice(destEnd));
  if (after === '') return true;
  const opener = after[0];
  if (opener !== '"' && opener !== "'" && opener !== '(') return false;
  const closer = opener === '(' ? ')' : opener;
  // Find the UNESCAPED closing delimiter; the def is valid only when it
  // exists on this line and nothing but whitespace follows it.
  for (let i = 1; i < after.length; i++) {
    if (after[i] === '\\') {
      i += 1;
      continue;
    }
    if (after[i] === closer) return isMdBlank(after.slice(i + 1));
  }
  return false; // title still open at EOL
}

/**
 * micromark's link-destination grammar (micromark-factory-destination),
 * applied to a trimmed def rest. Returns the index just past the
 * destination, or -1 when micromark would REJECT it — the def line is then
 * a paragraph whose `[label]` stays a live shortcut ref. Two forms:
 *   - `<…>`: any characters except line endings and UNESCAPED `<` / `>`
 *     (whitespace is legal); unclosed at EOL → reject. `<>` is valid.
 *   - bare: a non-empty run without whitespace or ASCII control characters;
 *     unescaped parentheses must balance, and a `)` at balance zero ENDS
 *     the destination (whatever follows must then be a title or nothing).
 * The old check accepted any `<…>` with a `>` somewhere and any bare run —
 * `[a]: <u<v>` / `[a]: /u(x` registered GHOST defs that released reference
 * taint early (2026-08 project-review P1; ghost defs are the unsafe
 * direction — see the def-registration comment in processConfirmedLine).
 */
function linkDestinationEnd(t: string): number {
  if (t.startsWith('<')) {
    for (let i = 1; i < t.length; i++) {
      const ch = t[i];
      // `enclosedEscape`: a backslash only escapes `<`, `>`, `\`; before
      // anything else it is a literal backslash and the next character is
      // judged on its own.
      if (ch === '\\' && (t[i + 1] === '<' || t[i + 1] === '>' || t[i + 1] === '\\')) {
        i += 1;
        continue;
      }
      if (ch === '>') return i + 1;
      if (ch === '<') return -1;
    }
    return -1; // unclosed angle destination
  }
  let balance = 0;
  let i = 0;
  for (; i < t.length; i++) {
    const code = t.charCodeAt(i);
    if (code === 0x20 || code === 0x09) break; // whitespace ends the run
    if (code < 0x20 || code === 0x7f) return -1; // ASCII control
    const ch = t[i];
    // `rawEscape`: only `(`, `)`, `\` are escapable; `\ ` is a literal
    // backslash followed by whitespace, which ENDS the run (review probe:
    // skipping any next char swallowed the space and registered a ghost).
    if (ch === '\\' && (t[i + 1] === '(' || t[i + 1] === ')' || t[i + 1] === '\\')) {
      i += 1;
      continue;
    }
    if (ch === '(') balance += 1;
    else if (ch === ')') {
      if (balance === 0) break; // ends the destination
      balance -= 1;
    }
  }
  if (balance !== 0 || i === 0) return -1;
  return i;
}

/**
 * micromark's inline-link resource grammar (`(` destination? title? `)`)
 * on ONE line, starting at the `(` at `openIdx`. Returns the index just past
 * the closing `)`, or -1 when the resource is malformed here — the bracket
 * text before it is then a live shortcut reference.
 */
function inlineResourceEnd(text: string, openIdx: number): number {
  let i = openIdx + 1;
  const skipWs = () => {
    while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i += 1;
  };
  skipWs();
  if (text[i] === ')') return i + 1; // `()` — empty resource is valid
  const destEnd = linkDestinationEnd(text.slice(i));
  if (destEnd === -1) return -1;
  i += destEnd;
  const beforeWs = i;
  skipWs();
  if (text[i] === ')') return i + 1;
  if (i === beforeWs) return -1; // title must be whitespace-separated
  const opener = text[i];
  if (opener !== '"' && opener !== "'" && opener !== '(') return -1;
  const closer = opener === '(' ? ')' : opener;
  for (i += 1; i < text.length; i++) {
    if (text[i] === '\\') {
      i += 1;
      continue;
    }
    if (text[i] === closer) {
      i += 1;
      skipWs();
      return text[i] === ')' ? i + 1 : -1;
    }
  }
  return -1; // title still open at EOL
}

/** The checkpoint's reference sub-state, as this module sees it — the
 *  fields stay flat on `FreezeScanCheckpointInternal` (a pure move does
 *  not reshape state); this view is the module's contract with them. */
export interface RefTaintView {
  defs: Map<string, number>;
  footnoteDefs: Map<string, number>;
  unresolvedRefs: UnresolvedRef[];
  openBracket: { offset: number; text: string } | null;
  referenceTaint: boolean;
  prevLineWasText: boolean;
  prevLineWasValidDef: boolean;
  lastBlankStart: number;
  phasePoisonedAt: number;
  /** Box offsets certified by the task-list tracker since the last settle. */
  taskCertified: number[];
}

export interface RefLineFacts {
  /** This line registered (or chained) a definition. */
  validDef: boolean;
  /** …and it was a LINK def (`prevLineWasValidDef` tracks only those). */
  validLinkDef: boolean;
}

// Blocker 5: definitions (block-start or def-chain only — A2) and refs.
// Inside an html flow run a def-shaped line is RAW TEXT — micromark never
// registers it. Registering a ghost def is the UNSAFE direction twice
// over: it releases reference taint early AND makes the footnote replay
// inject a definition the real parse does not have (fuzz-arbiter
// counterexample). Refs stay extracted regardless: extra candidates only
// over-taint.
export function collectRefLine(
  cp: RefTaintView,
  lnStart: number,
  lnEnd: number,
  scanText: string,
  rawText: string,
  inRawText: boolean,
  isBlockStart: boolean
): RefLineFacts {
  // The definition decision reads the RAW line, never `scanText`. A link
  // reference definition is a BLOCK construct: micromark decides it before
  // any inline parsing, so a code span does not exist yet and its backticks
  // are ordinary characters. `scanText` has intra-line code spans blanked
  // out — correct for the inline extractions below, and an input error
  // here, because blanking DELETES the very content that invalidates a
  // definition. `[x]: /u    ` + a code span is a PARAGRAPH whose `[x]` is a
  // live shortcut reference; masked, it read as a valid definition, so the
  // scanner registered a ghost def, never tainted the reference, and froze
  // a paragraph that a later `[x]: …` retargets into a linkReference —
  // 18 of 18 bytes, shipped-output divergence on three configs (gate290
  // census leg, fragment band K=4, probe collideDef:x).
  //
  // Index arithmetic stays sound across the two strings because masking is
  // LENGTH-PRESERVING (spans become runs of spaces), so `defBracket` below
  // is a valid offset into `scanText` even though `def` was matched here.
  // Keep that property if you touch `maskIntraLineCodeSpans`.
  const defShaped = inRawText ? null : DEF_RE.exec(rawText);
  // micromark requires a NON-EMPTY destination followed by nothing but an
  // optional TITLE for a link definition. A bare `[label]:` line, or one
  // with non-title garbage after the destination (`[x]: /u[x]: /u` — K=4
  // census counterexamples), is a PARAGRAPH whose `[label]` stays a live
  // shortcut ref that a LATER real def can retarget. Rejecting a real def
  // here only over-blocks (refs stay tainted); registering a ghost
  // under-blocks. Footnote defs legitimately have empty bodies.
  const def =
    defShaped !== null &&
    (defShaped[1].startsWith('^') || isPlausibleLinkDefRest(rawText.slice(defShaped.index + defShaped[0].length)))
      ? defShaped
      : null;
  const defLineStart = isBlockStart || !cp.prevLineWasText || cp.prevLineWasValidDef;
  const validDef = def !== null && defLineStart;
  if (validDef) {
    const label = def![1];
    if (label.startsWith('^')) {
      const key = normalizeLabel(label.slice(1));
      if (key && !cp.footnoteDefs.has(key)) cp.footnoteDefs.set(key, lnEnd);
    } else {
      const key = normalizeLabel(label);
      if (key && !cp.defs.has(key)) cp.defs.set(key, lnEnd);
    }
  }
  // Blocker 5 collection is skipped entirely under referenceTaint=false
  // (the def-label scanner profile): definition IDENTITY is a block-level
  // fact independent of how inline references resolve, and taint would
  // collapse the boundary to the body's first citation while a def footer
  // streams (defs settle only after a trailing blank line).
  if (cp.referenceTaint) {
    const pushRef = (offset: number, inner: string, followAt: number): void => {
      const follow = scanText[followAt];
      // `[text](…)` is an inline link only when the resource is WELL-FORMED
      // on this line; `[foo](bad url)` fails micromark's resource grammar
      // and `[foo]` falls back to a shortcut reference a later def can
      // retarget (adversarial review). A resource that continues on the
      // next line is unverifiable here → taint (over-block).
      if (follow === '(' && inlineResourceEnd(scanText, followAt) !== -1) return;
      let label: string;
      let footnote = false;
      if (inner.startsWith('^')) {
        footnote = true;
        label = normalizeLabel(inner.slice(1));
      } else if (follow === '[') {
        const explicit = /^\[((?:[^[\]\\]|\\.)*)\]/.exec(scanText.slice(followAt));
        label = normalizeLabel(explicit && explicit[1] ? explicit[1] : inner);
      } else {
        // Shortcut reference candidate. Plain prose brackets ("[sic]") land
        // here too — a future definition COULD retarget them, so they count.
        //
        // GFM task-list checkboxes land here as well, on purpose. A
        // line-local skip of `- [x] text` is NOT safe: whether micromark's
        // `tasklistCheck` consumes the box depends on the container stack
        // (`para` / `2. [x] b` is a lazy line whose box is a reference; a
        // sibling `1. [x] a` / `2. [x] b` is a task), and whether it STAYS
        // consumed depends on later lines (`- [x] a` / `  ===` is a heading
        // whose box is a reference again; `- [x] a | b` / `  --- | ---` a
        // table head). So the candidate is pushed here like any other, and
        // `taskListContext.ts` — which carries that container state in the
        // checkpoint — releases it by EXACT OFFSET through
        // `settleRefsAndEarliestUnresolved` once the box's paragraph has
        // closed for good. A same-label `[x]` anywhere else keeps its
        // candidate. Under a grammar without the construct
        // (`gfmTaskListItems` unset) nothing is ever released.
        label = normalizeLabel(inner);
      }
      if (label) cp.unresolvedRefs.push({ offset, label, footnote });
    };
    // A bracket left open on an earlier line of this paragraph: it closes
    // here (label = the joined text — micromark's label grammar allows soft
    // line breaks, and normalizeLabel folds them), stays open when this line
    // has no bracket at all, or dies when a NEW `[` comes first (a label
    // cannot contain an unescaped `[`; that `[` may itself pend below).
    const pending = cp.openBracket;
    cp.openBracket = null;
    if (pending) {
      const close = firstUnescaped(scanText, ']');
      const open = firstUnescaped(scanText, '[');
      // A continuation line inside a blockquote carries its `>` marker in
      // the source but not in micromark's label — strip it, or the joined
      // label (`foo > bar`) could never match its def and the taint would
      // never lift (adversarial review). Wrong-way stripping only over-taints.
      const cont = (t: string): string => t.replace(/^ {0,3}>[ \t]?/, '');
      if (close !== -1 && (open === -1 || close < open)) {
        pushRef(pending.offset, `${pending.text}\n${cont(scanText.slice(0, close))}`, close + 1);
      } else if (close === -1 && open === -1) {
        cp.openBracket = { offset: pending.offset, text: `${pending.text}\n${cont(scanText)}` };
      }
    }
    if (scanText.includes('[')) {
      // `[label]:` is only definition-shaped when THIS line registers it as
      // a def (the label bracket of validDef). On a paragraph CONTINUATION
      // line the same bytes are literal text where micromark still parses
      // `[label]` as a shortcut reference — skipping it there under-taints
      // and lets a later definition retarget frozen output (fuzz
      // counterexample: a def line glued under a paragraph). Extra
      // candidates only over-taint.
      const defBracket = validDef ? def!.index + def![0].indexOf('[') : -1;
      REF_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = REF_RE.exec(scanText)) !== null) {
        const followAt = m.index + m[0].length;
        if (scanText[followAt] === ':' && m.index === defBracket) continue; // the def's own label
        pushRef(lnStart + m.index, m[1], followAt);
      }
      // The LAST unescaped `[` with no `]` after it stays open into the next
      // paragraph line (a def line's own label never reaches here unclosed).
      const trailingOpen = lastUnclosedBracket(scanText);
      if (trailingOpen !== -1) {
        cp.openBracket = { offset: lnStart + trailingOpen, text: scanText.slice(trailingOpen + 1) };
      }
    }
  }
  return { validDef, validLinkDef: validDef && !def![1].startsWith('^') };
}

/** Settle references (monotone: entries only ever leave — a def counts
 *  once a confirmed blank line follows it, and a task-list box counts once
 *  the tracker certified its exact offset), then report the earliest still
 *  unresolved ref offset (`Infinity` when none). */
export function settleRefsAndEarliestUnresolved(cp: RefTaintView): number {
  // Certified task boxes leave by POSITION, never by label: the same `X`
  // label in prose elsewhere is still a live shortcut reference. The list
  // is consumed here so a resumed scan and a fresh one remove each entry
  // exactly once, at the same scan.
  if (cp.taskCertified.length > 0) {
    const certified = new Set(cp.taskCertified);
    cp.taskCertified = [];
    cp.unresolvedRefs = cp.unresolvedRefs.filter((ref) => ref.footnote || !certified.has(ref.offset));
  }
  if (cp.unresolvedRefs.length > 0) {
    // Once block ownership is uncertain, a definition-shaped line may be
    // HTML or math content. It cannot resolve an earlier reference: that
    // would release a prefix which a later real definition can still change.
    const settled = (defEnd: number): boolean => cp.lastBlankStart >= defEnd && defEnd < cp.phasePoisonedAt;
    cp.unresolvedRefs = cp.unresolvedRefs.filter((ref) => {
      const table = ref.footnote ? cp.footnoteDefs : cp.defs;
      const defEnd = table.get(ref.label);
      return defEnd === undefined || !settled(defEnd);
    });
  }
  let earliestUnresolved = Infinity;
  for (const ref of cp.unresolvedRefs) earliestUnresolved = Math.min(earliestUnresolved, ref.offset);
  return earliestUnresolved;
}

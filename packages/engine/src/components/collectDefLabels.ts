/**
 * Lightweight def-only parse: runs a minimal unified pipeline
 * (remark-parse + remark-gfm, plus remark-math on request) to extract
 * identifiers of all `footnoteDefinition` and `definition` nodes from a
 * markdown source string.
 *
 * Used by PASS 0 of cross-chunk coordination to discover label sets without
 * triggering the full to-hast pipeline. Output is normalized via normalizeId
 * (uppercase, whitespace-collapsed) — same canonical form used everywhere in
 * the registry, phantomFootnoteLabels Set, and handler comparisons.
 *
 * The parse must agree with the production chain (`pluginChain.ts`) on
 * every BLOCK-level construct that can contain or interrupt a definition,
 * or PASS 0 advertises labels the real parse never defines (and vice
 * versa). `$$` flow math is such a construct: it swallows blank lines and
 * def-shaped lines, and a definition directly under its closing fence is a
 * definition to remark-math but paragraph text to a math-less grammar
 * (a link definition cannot interrupt a paragraph). The shipped adapters
 * therefore scan with `{ math: true }`, which adds remark-math with the
 * production `singleDollarTextMath: false` setting. The no-argument form
 * keeps the documented CommonMark + GFM grammar for hand-assembled chains
 * without remark-math and for existing custom `parse` hooks.
 *
 * @module components/collectDefLabels
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { visit } from 'unist-util-visit';
import type { Root as MdastRoot } from 'mdast';
import { normalizeId } from './normalizeId';
import { createBlankLineScanner } from './blankLineScanner';
import { computeFreezeBoundary, type FreezeScanCheckpoint } from './incrementalParse/computeFreezeBoundary';

/**
 * Grammar switches shared by {@link collectDefLabels} and
 * {@link createDefLabelScanner}. The scanner's parse and its freeze-boundary
 * profile are derived from the SAME object, so the two can never disagree
 * about what `$$` means.
 */
export interface DefLabelGrammarOptions {
  /**
   * Parse `$$` flow math (remark-math with `singleDollarTextMath: false`,
   * exactly as the production chain does). Pass `true` whenever the chain
   * that renders the same source includes remark-math — the shipped React
   * and Vue adapters always do — so PASS 0 reads a definition directly under
   * a closing `$$` fence as a definition and a def-shaped line inside a
   * math block as math. Default `false`: the pinned CommonMark + GFM grammar
   * of the no-argument form, where `$$` is paragraph text to both the parse
   * and the boundary scan.
   */
  math?: boolean;
}

/**
 * The scanner's freeze-boundary grammar profile for a given grammar.
 * `mathFlow` follows {@link DefLabelGrammarOptions.math}: with remark-math in
 * the pipeline `$$` opens a block that swallows blank lines, so no candidate
 * inside it may freeze (the production profile); without it `$$` is
 * paragraph text and the math masking would hide comment/fence opens from
 * the balance scan (ghost-def counterexample, Phase B design review).
 * `referenceTaint: false` because only definition IDENTITIES matter to
 * PASS 0 — a block-level fact independent of inline reference resolution —
 * and taint would collapse the boundary to the body's first citation
 * exactly while a def footer streams. `defListEnabled: false` because this
 * pipeline has no definition-list extension. The engine's soak battery does
 * not cover this switch combination; the replay/property/fuzz suites in
 * collectDefLabels.test.ts are its safety net.
 */
const scannerBoundaryProfile = (math: boolean) =>
  ({ defListEnabled: false, mathFlow: math, referenceTaint: false }) as const;

export interface DefLabels {
  footnoteLabels: Set<string>;
  linkLabels: Set<string>;
}

// Build helpers kept as their own functions so the cached processors' types
// are inferred as the FULL chained Processor, not the bare `unified()`
// Processor with `undefined` extension types.
//
// NOTE: PASS 0 deliberately pins remark-parse + remark-gfm (+ remark-math
// when `math` is set) and ignores the pipeline's user remarkPlugins. The
// append-aware scanner below encodes grammar facts about exactly this
// plugin set — "definitions never cross a blank line", "a definition's `[`
// sits at a line's content start", "whether a line is math interior is
// decided by the lines before it". If this processor ever grows plugins
// whose def-like constructs violate those facts (directives, MDX,
// multi-line containers), the scanner's fast path must be revisited: its
// replay tests only lock today's grammar.
function buildMathProcessor() {
  return unified().use(remarkParse).use(remarkGfm).use(remarkMath, { singleDollarTextMath: false });
}
function buildPlainProcessor() {
  return unified().use(remarkParse).use(remarkGfm);
}
let _mathProcessor: ReturnType<typeof buildMathProcessor> | null = null;
let _plainProcessor: ReturnType<typeof buildPlainProcessor> | null = null;
function processor(math: boolean): ReturnType<typeof buildMathProcessor> | ReturnType<typeof buildPlainProcessor> {
  if (math) return (_mathProcessor ??= buildMathProcessor());
  return (_plainProcessor ??= buildPlainProcessor());
}

export function collectDefLabels(source: string, options?: DefLabelGrammarOptions): DefLabels {
  if (!source) {
    return { footnoteLabels: new Set(), linkLabels: new Set() };
  }
  const mdast = processor(options?.math ?? false).parse(source) as MdastRoot;
  const footnoteLabels = new Set<string>();
  const linkLabels = new Set<string>();
  visit(mdast, (node) => {
    if (node.type === 'footnoteDefinition' && 'identifier' in node) {
      footnoteLabels.add(normalizeId(node.identifier as string));
    } else if (node.type === 'definition' && 'identifier' in node) {
      linkLabels.add(normalizeId(node.identifier as string));
    }
  });
  return { footnoteLabels, linkLabels };
}

const setsEqual = (a: Set<string>, b: Set<string>): boolean => {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
};

/** Blank line (whitespace-only), the boundary no definition can span.
 *  CRLF-aware on both newlines — without `\r?` a CRLF document never
 *  matches, the region silently becomes the whole source, and the fast
 *  path is vacuously off for that entire input class. */
const BLANK_LINE_RE = /\r?\n[ \t]*\r?\n/g;

/** Index just past the LAST blank line of `source`, or 0 if none.
 *  Plain non-overlapping scan: for runs of blanks ("\n\n\n") this can land
 *  a newline or two early, but the slack is whitespace-only and whitespace
 *  can never satisfy DEF_LINE_START_RE, so the decision is identical.
 *  @internal exported for tests only (module path — not on the package barrel) — the fast path is otherwise
 *  indistinguishable from a full parse whose sets came out equal. */
export function lastRegionStart(source: string): number {
  BLANK_LINE_RE.lastIndex = 0;
  let start = 0;
  for (let m = BLANK_LINE_RE.exec(source); m !== null; m = BLANK_LINE_RE.exec(source)) {
    start = m.index + m[0].length;
  }
  return start;
}

/** A line that can START a definition, matched by the FULL def signature:
 *  container prefixes (blockquote `>`, list bullets, ordered-list digits),
 *  then `[label]` with the closing bracket IMMEDIATELY followed by `:` —
 *  remark accepts a definition only with that adjacency (grammar-verified:
 *  `[x]\n: url` and `[x] : url` are paragraphs, and `[a][b]: url` is a
 *  reference because the label's first unescaped `]` isn't followed by
 *  `:`). The label alternation admits escape pairs (`\]` stays inside the
 *  label) and spans newlines (labels may soft-wrap; they cannot cross the
 *  blank line that bounds the region). Both alternatives are disjoint, so
 *  the scan is linear — no backtracking blowup on bracket-dense regions.
 *
 *  Requiring the signature (not just a line-start `[`) is what keeps the
 *  streaming-heavy shapes — bulleted link lists `- [t](u)`, task boxes
 *  `- [x]`, reference lists `- [a][b]` — on the fast path; a bracket-only
 *  probe made every append inside a blank-line-free link list pay a full
 *  reparse (the measured Documents+smooth cliff). An INCOMPLETE def line
 *  (`[x` with `]:` still in flight) correctly stays on the fast path too:
 *  the parser sees no definition in it either, and the region re-check on
 *  the completing append flips to the full parse exactly when the answer
 *  can change. The `m` flag also matches at index 0, which is a true line
 *  start (the region begins just past a blank line or at the document
 *  start). Residual over-matching (e.g. `[x]:` inside an open code fence)
 *  is safe: it costs a redundant full parse, never a wrong result.
 *  @internal exported for tests only (module path — not on the package barrel). */
export const DEF_LINE_START_RE = /^[ \t>*+\d.)-]*\[(?:[^\]\\]|\\[\s\S])*\]:/m;

export interface DefLabelScanner {
  /** Equivalent to `collectDefLabels(source, options)` at every call, but
   *  cheap for the streaming common case. Returns a REFERENCE-STABLE result
   *  while the label set is unchanged. */
  scan(source: string): DefLabels;
}

export interface DefLabelScannerOptions extends DefLabelGrammarOptions {
  /**
   * Full-parse fallback — injectable so tests can COUNT parses and assert
   * the fast path actually fires (from the outside, a skipped parse is
   * indistinguishable from a parse whose sets came out equal). Defaults to
   * `collectDefLabels` under this scanner's grammar; a replacement must
   * parse the grammar `math` names, because the boundary profile is derived
   * from `math`, not from the function. Production callers never pass it.
   */
  parse?: (source: string) => DefLabels;
}

/**
 * Append-aware wrapper around {@link collectDefLabels} for the streaming
 * hot path: PASS 0 re-runs on every token, but its result — the def label
 * set — almost never changes while prose streams in.
 *
 * Fast path: when the new source merely APPENDS to the previous one, the
 * label set can only differ if the affected region contains a line-start
 * `[label]:` def signature (see DEF_LINE_START_RE — mid-line brackets,
 * bulleted links, task boxes and reference lists all lack the adjacent
 * `]:` and stay on the fast path). That region is the previous source's
 * text SINCE ITS LAST BLANK LINE plus the appended text — not just the
 * appended text, because CommonMark definitions span lines (`[x]:` with
 * the destination on the next line) and a trailing append can re-type an
 * entire paragraph (setext `===`). No construct that produces or destroys
 * a definition crosses a blank line (labels, destinations and titles all
 * forbid them), so text before that boundary is settled. `$$` flow math
 * DOES cross blank lines, but whether a line is math interior is decided
 * only by the lines before it (the opener sits at a line start and, once
 * unclosed, runs to EOF), so an append can never move an earlier def line
 * into or out of a math block; a def line it opens or closes math AROUND
 * carries the signature itself and takes the slow path. When the region
 * has no def-capable line, the previous result is returned AS-IS;
 * otherwise (and for any non-append change) a full re-parse runs, and the
 * previous result object is kept whenever the recomputed sets are equal.
 *
 * Misjudging conservatively (an unnecessary `[` hit — e.g. inside an open
 * code fence) only costs a redundant full parse, never a wrong result.
 *
 * The reference stability doubles as churn control: consumers that list
 * the result in effect deps (chunk re-registration) stop firing per token.
 *
 * @param options Grammar switches ({@link DefLabelGrammarOptions}) plus the
 *   test-only `parse` hook ({@link DefLabelScannerOptions}). A bare
 *   function is accepted as the `parse` hook (the original signature).
 */
/** @soak-entry definition-label-scanner */
export function createDefLabelScanner(
  options?: DefLabelScannerOptions | ((source: string) => DefLabels)
): DefLabelScanner {
  const resolved: DefLabelScannerOptions = typeof options === 'function' ? { parse: options } : (options ?? {});
  const math = resolved.math ?? false;
  const grammar: DefLabelGrammarOptions = { math };
  const parse = resolved.parse ?? ((source: string) => collectDefLabels(source, grammar));
  const boundaryProfile = scannerBoundaryProfile(math);
  let prevSource: string | null = null;
  let prevLabels: DefLabels | null = null;
  const scanBlankLines = createBlankLineScanner();
  let regionStart = 0;
  // Frozen-prefix cache (Phase B): labels extracted from the region before
  // `frozenEnd` are FINAL — the freeze boundary guarantees every block
  // beginning before it parses byte-identically under any future append,
  // so a def there can neither appear nor disappear. The checkpoint makes
  // the boundary scan O(new lines) per call; it belongs to this scanner's
  // single append-only lineage (non-append resets it).
  let frozenEnd = 0;
  let frozenFootnotes = new Set<string>();
  let frozenLinks = new Set<string>();
  let checkpoint: FreezeScanCheckpoint | null = null;

  const resetFrozen = () => {
    frozenEnd = 0;
    frozenFootnotes = new Set();
    frozenLinks = new Set();
    checkpoint = null;
  };

  return {
    scan(source: string): DefLabels {
      if (source === prevSource && prevLabels !== null) return prevLabels;
      // A document-leading BOM is invisible to micromark (dropped before
      // tokenizing) but not to DEF_LINE_START_RE, whose line-start probe
      // sees U+FEFF where the `[` of a line-1 definition sits, nor to the
      // freeze scan, which grants no boundary. Stage A strips every leading
      // BOM before the engine sees the text, so this path is for the
      // scanner driven directly with raw input. Do not strip here and hand
      // the rest to the parser: with two BOMs the scanner and its parser
      // would each drop one and report a line-1 definition the full
      // collector (one BOM dropped, one left in the text) does not. Take
      // the conservative path instead — a full parse of the raw source,
      // exactly `collectDefLabels(source)` — and keep the frozen prefix
      // empty so a later frame never resumes from state built on it.
      if (source.charCodeAt(0) === 0xfeff) {
        resetFrozen();
        const next = parse(source);
        prevSource = source;
        if (
          prevLabels !== null &&
          setsEqual(next.footnoteLabels, prevLabels.footnoteLabels) &&
          setsEqual(next.linkLabels, prevLabels.linkLabels)
        ) {
          return prevLabels;
        }
        prevLabels = next;
        return next;
      }
      const previousRegionStart = regionStart;
      const appended = prevSource !== null && source.startsWith(prevSource);
      regionStart = scanBlankLines(source, appended ? prevSource!.length : 0);
      let isAppend = false;
      if (prevSource !== null && prevLabels !== null) {
        if (source === prevSource) return prevLabels;
        if (source.startsWith(prevSource)) {
          isAppend = true;
          // Joined so a def line straddling the append boundary keeps its
          // line-start context.
          const region = source.slice(previousRegionStart);
          if (!DEF_LINE_START_RE.test(region)) {
            prevSource = source;
            return prevLabels;
          }
        }
      }
      // Slow path — the region really may contain a definition. Advance the
      // frozen prefix as far as the boundary allows, then parse ONLY the
      // live tail instead of the whole document.
      if (!isAppend && prevSource !== null) resetFrozen();
      const scanResult = computeFreezeBoundary(source, boundaryProfile, isAppend ? checkpoint : null);
      checkpoint = scanResult.checkpoint;
      // An older freeze is permanently valid — never move backwards even if
      // a later scan reports a smaller boundary (over-blocking direction).
      const boundary = Math.max(scanResult.boundary, frozenEnd);
      if (boundary > frozenEnd) {
        const slice = source.slice(frozenEnd, boundary);
        // The slice can only add labels if it contains a def signature —
        // the same probe that gates the slow path.
        if (DEF_LINE_START_RE.test(slice)) {
          const sliceLabels = parse(slice);
          for (const label of sliceLabels.footnoteLabels) frozenFootnotes.add(label);
          for (const label of sliceLabels.linkLabels) frozenLinks.add(label);
        }
        frozenEnd = boundary;
      }
      const tailSource = source.slice(frozenEnd);
      const tail = DEF_LINE_START_RE.test(tailSource)
        ? parse(tailSource)
        : { footnoteLabels: new Set<string>(), linkLabels: new Set<string>() };
      const next: DefLabels = {
        footnoteLabels: new Set([...frozenFootnotes, ...tail.footnoteLabels]),
        linkLabels: new Set([...frozenLinks, ...tail.linkLabels]),
      };
      if (
        prevLabels !== null &&
        setsEqual(next.footnoteLabels, prevLabels.footnoteLabels) &&
        setsEqual(next.linkLabels, prevLabels.linkLabels)
      ) {
        prevSource = source;
        return prevLabels;
      }
      prevSource = source;
      prevLabels = next;
      return next;
    },
  };
}

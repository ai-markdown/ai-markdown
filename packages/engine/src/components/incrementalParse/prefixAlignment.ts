/** Wrap-slot ownership and seam reconstruction. Ambiguous layouts return null. */
import type { Root as HastRoot, RootContent as HastContent } from 'hast';
import type { Root as MdastRoot, RootContent as MdastContent } from 'mdast';
import {
  STRAY_SYNTHESIZED_END_TAG_RE,
  isSanitizeStrippedConstruct,
  isExactSanitizeStrippedConstruct,
} from './spliceHtmlGuards';

/** mdast types with no to-hast output AND no wrap separator slot. Everything
 *  else gets a slot at wrap() time — even nodes sanitize later strips
 *  (comments, PIs, `<script>`), whose slots survive as orphan separators. */
export function isWrapInvisible(node: MdastContent): boolean {
  return node.type === 'definition' || node.type === 'footnoteDefinition';
}

/**
 * Stripped-node-aware prefix cut (B0-probe-verified layout model).
 *
 * The cut region of the previous hast interleaves CONTENT nodes with
 * position-less '\n' SEPARATORS. wrap() emitted one separator per gap
 * between adjacent wrap-visible mdast children; sanitize then stripped some
 * children's output (HTML comment / PI / `<script>`), leaving their
 * separators orphaned. The walk below re-derives the pairing:
 *
 * - separator-run lengths are the gap ground truth (a run of length L
 *   between two content nodes ⇒ L−1 stripped children between them; a
 *   leading run of length L ⇒ L leading stripped children);
 * - positioned content cross-checks the pairing (its start offset must fall
 *   inside the paired mdast child's range). Multiple positioned content
 *   nodes inside ONE child's range are a raw-reparse multi-output html
 *   block — legal, zero separators between them;
 * - position-less content (KaTeX span) pairs by cursor arithmetic alone.
 *
 * Internal separators are kept VERBATIM (one before a frozen <table> may
 * legitimately hold hoisted newlines — frozen with the table, stable). The
 * TRAILING run is rebuilt from scratch as plain '\n' nodes: its last member
 * is seam-adjacent and may carry the previous frame's tail-derived hoist
 * (stale), and its length must reflect the CURRENT tail's wrap visibility,
 * not the previous frame's.
 *
 * Returns null whenever the observed layout contradicts the model — the
 * caller falls back to a full parse (safe, one-frame cost).
 */
/**
 * TEST-ONLY export (not re-exported by any barrel).
 *
 * The block-final/interior classifier below is reachable from a document
 * only through a FIRST FREEZE, and a sound blocker-6 seal refuses every
 * first freeze that could carry a positioned block-final literal — so each
 * seal fix has cost `spliceBlockFinalLiteralMerge.test.ts` another witness,
 * and after the derived-seal batch the `litEnd === litOwnerEnd` case had
 * none left. Harvesting is the wrong instrument now: a document that killed
 * the mutant would mean the seal had a hole, not that the guard was healthy.
 *
 * So the guard is applied HERE instead, to the classifier's own contract.
 * See that file for what this does and does not claim.
 */
/** Pairing-loop state at the end of the cut's CONTENT (before the trailing
 *  separator run the trailing region discards and rebuilds), plus the
 *  inputs it was computed over. A later frame whose cut region starts with
 *  the same `outLen` node objects (the splice cache guarantees it: those
 *  are the previous frame's aligned output, and the join never rewrites a
 *  node below `outLen`) continues the loop from here instead of re-pairing
 *  the whole frozen prefix. The loop is a left-to-right state machine over
 *  the cut region and `visibles`, and both are identical up to that point
 *  in the next frame, so the resumed run computes exactly what a fresh
 *  run would — `sepBuffer` is empty and `literalCredit` is zero after every
 *  content push on the paths that produce a snapshot. */
export interface AlignResume {
  /** `visibles` of the prefix this snapshot was computed over, which is
   *  `prefixMdast.slice(0, mdastCount)` of the resuming frame. */
  visibles: MdastContent[];
  mdastCount: number;
  /** Nodes `[0, outLen)` of the cut region are the resumed loop's `out`. */
  outLen: number;
  pairIdx: number;
  sawContent: boolean;
}

export function alignPrefixCut(
  prefixMdast: MdastContent[],
  cutRegion: HastContent[],
  tailWrapVisible: boolean,
  resume: AlignResume | null = null
): { children: HastContent[]; interiorFinalLiteral: boolean; resume: AlignResume | null } | null {
  const visibles = resume
    ? resume.visibles.concat(prefixMdast.slice(resume.mdastCount).filter((c) => !isWrapInvisible(c)))
    : prefixMdast.filter((c) => !isWrapInvisible(c));

  const out: HastContent[] = resume ? cutRegion.slice(0, resume.outLen) : [];
  let sepBuffer: HastContent[] = [];
  let pairIdx = resume ? resume.pairIdx : -1; // index into `visibles` of the child paired with the last content node
  let sawContent = resume ? resume.sawContent : false;
  // Wrap separators MERGED into pushed trailing literals (every trailing
  // '\n' on a literal is a merged separator — see the trailing-region
  // note). They count toward the NEXT gap's run length: without the
  // credit, separator runs after a literal UNDERCOUNT the stripped
  // children and the run-length rule mispairs position-less content
  // (seed-20260752: the KaTeX span paired with the stripped comment,
  // inflating the trailing gap count and duplicating the seam separator).
  let literalCredit = 0;

  for (let i = resume ? resume.outLen : 0; i < cutRegion.length; i++) {
    const node = cutRegion[i];
    if (isSeparatorText(node)) {
      sepBuffer.push(node);
      continue;
    }
    const start = node.position?.start?.offset;
    const paired = pairIdx >= 0 ? visibles[pairIdx] : undefined;
    if (
      sawContent &&
      start !== undefined &&
      paired &&
      paired.position?.start?.offset !== undefined &&
      paired.position?.end?.offset !== undefined &&
      start >= paired.position.start.offset &&
      start < paired.position.end.offset
    ) {
      // Multi-output continuation of the SAME mdast child (raw reparse of a
      // multi-element html block) — serialized adjacently, so no separator
      // may sit between the outputs.
      if (sepBuffer.length !== 0) return null;
      out.push(node);
      continue;
    }
    if (sawContent && isTrailingLiteralText(node)) {
      // Raw trailing literal of the SAME html block (position-less,
      // non-whitespace — cannot be foster-parenting hoist, which is
      // whitespace-only). Serialized adjacent to its element output, so no
      // separator may intervene; the pairing cursor stays put.
      if (sepBuffer.length !== 0) return null;
      out.push(node);
      literalCredit += countTrailingNewlines(node.value);
      continue;
    }
    // New pairing: the separator run before this node covers the gap from
    // the previous content node (1 separator) plus one per stripped child.
    //
    // LEADING-run exception (final-review R2): when the FIRST wrap-visible
    // child is a table (or any foster-parenting element), rehype-raw's
    // hoisted whitespace has no preceding wrap slot to merge into and lands
    // as a bare leading text node — one leading text with ZERO stripped
    // children. A positioned first content node therefore locates its own
    // pair by containment within [0..sepBuffer.length]; the excess leading
    // texts are hoist, kept verbatim (frozen with their table, stable —
    // interior hoist always merges into an existing slot, so only the
    // leading run needs this). Position-less first content (KaTeX — never
    // hoist-preceded) keeps the pure run-length rule.
    let nextIdx: number;
    if (!sawContent && start !== undefined) {
      nextIdx = -1;
      for (let j = 0; j <= sepBuffer.length && j < visibles.length; j++) {
        const vStart = visibles[j].position?.start?.offset;
        const vEnd = visibles[j].position?.end?.offset;
        if (vStart !== undefined && vEnd !== undefined && start >= vStart && start < vEnd) {
          nextIdx = j;
          break;
        }
      }
      if (nextIdx === -1) return null;
      // Excess leading texts beyond the stripped-child slots can only be
      // hoist, and hoist exists as a SEPARATE node only when there is no
      // slot to merge into (nextIdx === 0, probe-verified). Any excess in
      // the presence of slots is out of model → bail (round-2 review
      // tightened this from `excess > 1`).
      const excess = sepBuffer.length - nextIdx;
      if (excess > (nextIdx === 0 ? 1 : 0)) return null;
    } else {
      // Run length = observed bare separators PLUS the ones merged into
      // trailing literals since the last pairing (literalCredit) — the gap
      // ground truth the stripped-children arithmetic needs.
      const stripped = sawContent ? sepBuffer.length + literalCredit - 1 : sepBuffer.length;
      if (stripped < 0) return null;
      nextIdx = pairIdx + 1 + stripped;
      const candidate = visibles[nextIdx];
      if (!candidate) return null;
      if (start === undefined && sepBuffer.some((sep) => sep.type !== 'text' || sep.value !== '\n')) {
        // Position-less content (KaTeX) can only be paired by run length, and
        // a merged separator (`"\n\n"` around an html block parse5 dropped
        // outright) UNDERCOUNTS the gap — the span would pair with the
        // dropped block and be frozen twice (release soak of 2.4.2). Bail.
        return null;
      }
      if (start !== undefined) {
        const cStart = candidate.position?.start?.offset;
        const cEnd = candidate.position?.end?.offset;
        if (cStart === undefined || cEnd === undefined || start < cStart || start >= cEnd) return null;
      }
    }
    out.push(...sepBuffer, node);
    sepBuffer = [];
    literalCredit = 0; // merged separators consumed by this gap
    pairIdx = nextIdx;
    sawContent = true;
  }

  // Trailing region: every visible child after the last paired one must be
  // stripped. The observed run came from the PREVIOUS frame (its length
  // includes that frame's seam separator when its tail was wrap-visible),
  // so it is discarded and rebuilt for the current tail.
  const trailingStripped = visibles.length - (pairIdx + 1);
  const trailingGaps = sawContent ? trailingStripped : Math.max(0, visibles.length - 1);
  const seam = visibles.length > 0 && tailWrapVisible ? 1 : 0;
  // Loop state at the end of the cut's content — the next frame's resume
  // point (see `AlignResume`). Captured before anything below appends to
  // or rewrites `out`; only handed out on the plain-slot path, where the
  // content nodes are kept verbatim.
  const snapshot: AlignResume = { visibles, mdastCount: prefixMdast.length, outLen: out.length, pairIdx, sawContent };

  // Trailing-literal seam merge: when the cut ends in an html block's raw
  // trailing literal, the full parse MERGES the wrap separator into that
  // text node (adjacent text at reparse time) instead of keeping a bare
  // '\n' — and the merge DROPS the text's source position (an unmerged
  // document-final literal keeps hast-util-raw's position; the same
  // literal followed by wrap-visible content comes out position-less,
  // fuzz-verified both ways). The literal's intrinsic value never ends
  // with '\n' (an html node's source ends at line content), so EVERY
  // trailing '\n' on the cut node is a previous frame's merged artifact —
  // seam separator, footer separator, or table hoist (which GROWS with the
  // streaming tail and must never be carried forward). Shed them all, then
  // re-merge (and re-drop the position) for the CURRENT tail's layout — the
  // join merges the tail's own leading text back in. Stripped children
  // after a trailing literal are out of model — bail to the full parse.
  const last = out[out.length - 1];
  // A POSITIONED whitespace-only text at the cut's end is an html block's
  // raw remnant with every tag dropped by parse5 (`</details>\n</details>`
  // leaves only the line ending, positioned) — the trailing-literal branch
  // below models non-blank literals only, and the plain-slot rebuild would
  // push it next to a synthesized bare '\n' where the full parse merges
  // both into one position-less `"\n\n"`. Out of model — bail (v2.4.1
  // review P2, the neighbour of the two 2.4.1 trailing-literal fixes).
  if (last !== undefined && last.type === 'text' && last.position !== undefined && last.value.trim() === '') {
    return null;
  }
  // Interior-literal gate (seed-20260838): this branch models BLOCK-FINAL
  // literals — the ones the full parse merges with the seam separator
  // (position dropped). A POSITIONED literal whose source ends BEFORE its
  // owner html node's end is an INTERIOR raw literal: a sanitize-stripped
  // sibling (`</details>` text `<embed/>`) followed it at reparse time, so
  // the full parse keeps it verbatim — positioned, un-merged, with its own
  // separator. Route those to the plain-slot rebuild (and tell the join to
  // keep its hands off — see `interiorFinalLiteral`). A positioned literal
  // whose end EQUALS the owner's end is block-final like the position-less
  // ones and stays in this branch (first freeze straight from a full-parse
  // tree — later frames see the merged, position-less artifact).
  const lastIsLiteral = last !== undefined && last.type === 'text' && last.value.trim() !== '';
  if (lastIsLiteral && pairIdx >= 0 && visibles[pairIdx].type !== 'html') {
    // Root-level literal text owned by a NON-html block: a stray `<td>`
    // earlier in the document made parse5 foster-parent the following GFM
    // table's cell text to the root and destroy the table skeleton, whose
    // internal line endings then merged into the separator AFTER it — a
    // separator the cut never sees (it lives past the boundary) and the
    // rebuild cannot reproduce (v2.4.2 review P1-2). Out of model — bail.
    return null;
  }
  const litOwnerEnd = pairIdx >= 0 ? visibles[pairIdx].position?.end?.offset : undefined;
  const litEnd = lastIsLiteral ? last.position?.end?.offset : undefined;
  if (lastIsLiteral && last.position !== undefined && (litEnd === undefined || litOwnerEnd === undefined)) {
    // Positioned literal with an unclassifiable owner — out of model.
    return null;
  }
  if (litEnd !== undefined && litOwnerEnd !== undefined && litEnd > litOwnerEnd) {
    // A positioned literal extending PAST its owner is unreachable by the
    // model (positioned ⟹ never merged ⟹ span stays inside the owner) —
    // if it ever shows up the model diverged, and folding it into the
    // block-final branch would merge bytes we cannot account for. Bail
    // explicitly: "unreachable" becomes "safe when reached" (final-review
    // MINOR, echoing the first-fix regression lesson).
    return null;
  }
  const interiorFinalLiteral =
    lastIsLiteral && litEnd !== undefined && litOwnerEnd !== undefined && litEnd < litOwnerEnd;
  if (lastIsLiteral && !interiorFinalLiteral) {
    // This bail is also the backstop for the cut loop's trailing-literal
    // break path (see the cross-reference note there): a frozen stripped
    // construct after the literal surfaces here as trailing gaps or a
    // leftover separator run. Do not loosen without restoring a remnant
    // check at the cut.
    if (trailingGaps > 0 || sepBuffer.length > 0) return null;
    const body = last.value.replace(/\n+$/, '');
    if (last.position !== undefined && body !== last.value) {
      // A positioned block-final literal never carries trailing newlines
      // (its source ends at line content; merges drop the position) — a
      // trailing '\n' here is out of model.
      return null;
    }
    if (seam > 0) {
      out[out.length - 1] = { type: 'text', value: `${body}\n` };
    } else if (last.position !== undefined) {
      // Positioned block-final literal fresh from a full-parse tree: its
      // own position IS the source truth — keep the node verbatim (the
      // trailing-'\n' guard above proved body === value).
    } else {
      // Document-final literal (nothing wrap-visible follows): hast-util-raw
      // keeps its SOURCE position — [previous element's end, owner html
      // node's end]. A literal that got merged in an earlier frame lost its
      // position, so reconstruct it from the neighbors; bail when they
      // don't carry the needed points. (If the current tail still appends a
      // footer, the join's literal-seam merge re-drops the position — the
      // same order a full parse resolves it in.)
      const prevEl = out.length >= 2 ? out[out.length - 2] : undefined;
      const owner = pairIdx >= 0 ? visibles[pairIdx] : undefined;
      const start = prevEl?.type === 'element' ? prevEl.position?.end : undefined;
      const end = owner?.position?.end;
      if (!start || !end) return null;
      out[out.length - 1] = { type: 'text', value: body, position: { start, end } };
    }
    // The cut's last node may have been rewritten above, so the next frame
    // cannot resume past it — no snapshot on this path.
    return { children: out, interiorFinalLiteral: false, resume: null };
  }

  // A trailing separator whose value is not a PLAIN '\n' carries a merged
  // raw remnant (a dropped construct's whitespace, a prior merged gap) —
  // rebuilding it as bare '\n' silently drops those bytes (deep-soak
  // counterexample: a stripped comment's preceding ' ' merged into ' \n').
  // Out of the plain-slot model — bail to a full parse.
  if (sepBuffer.some((s) => s.type !== 'text' || s.value !== '\n')) return null;
  // An interior literal whose merged separators were never consumed by a
  // later pairing (literal, bare separators, then nothing) — its credit
  // would have to offset the trailing-run arithmetic below, a shape the
  // trailing rebuild does not model. Bail to a full parse.
  if (literalCredit > 0) return null;
  // A frozen html child ENDING in a sanitize-stripped construct (`…-->`,
  // `…?>`, `…]]>`, declarations) leaves interior whitespace between its
  // last element and the stripped tail — whitespace the full parse MERGES
  // into the seam separator (`"\n\n"`, seed-20260850) while the plain-slot
  // rebuild below synthesizes a bare `'\n'`. The merged node never reaches
  // the cut (attribution excludes it), so the rebuild is blind to it —
  // bail to a full parse when the last paired child has such a tail.
  const lastPaired = pairIdx >= 0 ? visibles[pairIdx] : undefined;
  if (lastPaired && lastPaired.type === 'html') {
    const v = (lastPaired as { value: string }).value;
    const lastLt = v.lastIndexOf('<');
    if (lastLt !== -1 && /^<[!?]/.test(v.slice(lastLt))) return null;
    // Same blindness, other cause: the block's OUTPUT ends before its
    // SOURCE does — parse5 dropped whatever followed the last element (a
    // stray `</details>` after the real one, v2.4.1 review P2) and the line
    // ending before it survives as a remnant the full parse merges into
    // the seam separator (`"\n\n"`), which the rebuild below cannot see.
    const lastOut = out[out.length - 1];
    const outEnd = lastOut?.type === 'element' ? lastOut.position?.end?.offset : undefined;
    const blockEnd = lastPaired.position?.end?.offset;
    if (outEnd !== undefined && blockEnd !== undefined && outEnd < blockEnd) return null;
  }
  if (sepBuffer.length !== trailingGaps && sepBuffer.length !== trailingGaps + 1) return null;
  // The rebuild below emits ONE bare '\n' per stripped trailing child — the
  // shape a sanitize-stripped node leaves (comment/PI/CDATA/declaration:
  // rehype-raw made a node, sanitize removed it, the separators around it
  // stay separate texts). An html block that parse5 DROPPED outright (a
  // stray `</details>`, a `<!DOCTYPE>`, or an element sanitize removed as a
  // whole) leaves no node, and hast-util-raw merges the separators around
  // it into one `"\n\n"` — the two are indistinguishable from the cut hast
  // (release soak of 2.4.2, `</details>\n<!-- c\n\n-->\n</details>` —
  // pre-existing). And a child that only STARTS with a construct leaves the
  // rest as a text remnant that merges into a slot the rebuild synthesizes
  // bare (`<!-- c --> </s>` → `" \n"`, release-gate finding A, seed
  // 20293003 — the old `/^\s*<[!?]/` prefix test admitted it). Bail unless
  // every stripped trailing child is EXACTLY one sanitize-stripped
  // construct.
  for (let j = pairIdx + 1; j < visibles.length; j++) {
    const v = visibles[j];
    if (v.type === 'html' && !isExactSanitizeStrippedConstruct((v as { value: string }).value)) return null;
  }
  for (let i = 0; i < trailingGaps + seam; i++) {
    out.push({ type: 'text', value: '\n' });
  }
  // An interior final literal is kept verbatim on this path too, but the
  // join treats the seam after it specially; keep the resume to the plain
  // case where nothing about the cut's end needs modelling.
  return { children: out, interiorFinalLiteral, resume: lastIsLiteral ? null : snapshot };
}

/**
 * Drop the injected region's output from a freshly-parsed tail hast.
 *
 * The injection contributes two kinds of root output: the replay's footnote
 * REF paragraphs (one `<p>` each — footnote/link defs are wrap-invisible)
 * and the wrap separators around them. Consume exactly:
 *
 *   output_1 [sep output_2 … sep output_k] [gapSep]
 *
 * where k = injected wrap-visible children and gapSep (present only when
 * the REAL tail has wrap-visible children) is the injected|tail gap slot.
 * gapSep's value beyond its wrap '\n' is text the raw reparse MERGED into
 * the slot — rehype-raw hoist ahead of a table, or the orphan separator of
 * an opener the tokenizer dropped outright (an unterminated `<?`/`<!`, fuzz
 * counterexample) — retained as a leading text node.
 *
 * `remnantMerged` carries the seam verdict that merge PROVES: the injected
 * region occupies the same serialized-adjacency position inside the tail
 * parse that the frozen prefix occupies in a full parse, so "the tail's raw
 * pass merged the gap with what follows" ⇔ "a full parse merges the seam
 * separator there too". Null when no gap was consumed (no injection): the
 * caller falls back to the hoist heuristic.
 *
 * Returns null on any layout surprise (caller falls back to a full parse).
 */
export function stripInjectedHast(
  tailMdast: MdastRoot,
  tailHast: HastRoot,
  injectedLen: number,
  tailWrapVisible: boolean
): { rest: HastContent[]; remnantMerged: boolean | null } | null {
  if (injectedLen === 0) return { rest: tailHast.children.slice(), remnantMerged: null };
  const injectedVisibleCount = tailMdast.children.filter((c) => {
    const start = c.position?.start?.offset;
    return start !== undefined && start < injectedLen && !isWrapInvisible(c);
  }).length;
  if (injectedVisibleCount === 0) return { rest: tailHast.children.slice(), remnantMerged: null };

  const children = tailHast.children;
  let idx = 0;
  let consumed = 0;
  while (idx < children.length && consumed < injectedVisibleCount) {
    const node = children[idx];
    if (isSeparatorText(node)) {
      idx += 1;
      continue;
    }
    const start = node.position?.start?.offset;
    // Injected outputs are always positioned paragraphs; running into tail
    // content (or anything unpositioned) before finishing is a surprise.
    if (start === undefined || start >= injectedLen) return null;
    consumed += 1;
    idx += 1;
  }
  if (consumed < injectedVisibleCount) return null;

  let remnant = '';
  let remnantMerged: boolean | null = null;
  if (tailWrapVisible) {
    const gap = children[idx];
    if (!gap || !isSeparatorText(gap)) return null;
    remnant = (gap as { value: string }).value.slice(1);
    remnantMerged = remnant !== '';
    idx += 1;
  }
  const rest = children.slice(idx);
  if (remnant !== '') rest.unshift({ type: 'text', value: remnant });
  return { rest, remnantMerged };
}

/**
 * Decide whether the tail hast's LEADING position-less text may merge with
 * the seam separator. True only when it is rehype-raw hoist output sitting
 * directly against the seam in serialized HTML — i.e. the tail's first
 * wrap-visible mdast child SURVIVED sanitize (its output is the first tail
 * content node). If that child was stripped (leading comment), the leading
 * text is a gap SLOT the full parse keeps as a separate node.
 *
 * Three-valued (fuzz-arbiter finding — the old boolean version claimed
 * "false is provably right wherever evidence is ambiguous", and fuzz
 * disproved it): a tail whose first wrap-visible child VANISHES at raw time
 * (an unterminated `<?`/`<!` opener the tokenizer drops outright) leaves
 * the same post-sanitize shape as one stripped at sanitize time (a
 * complete comment), but the full parse MERGES the seam in the first case
 * and keeps it separate in the second. Positive classifications:
 * - `true`  — hoist: first content is positioned inside the first visible
 *   child (table foster-parenting), merge;
 * - `false` — the vanished/position-less output is positively attributable:
 *   math (KaTeX emits its own output, never dropped) or a COMPLETE
 *   comment/PI/decl/CDATA html child (a raw-time node existed; sanitize
 *   stripped it, so the slots stay separate);
 * - `null`  — cannot classify (unterminated raw constructs, mixed html
 *   values): caller falls back to a full parse for the frame.
 */
export function tailLeadingTextIsHoist(
  tailMdastChildren: MdastContent[],
  tailHastChildren: HastContent[]
): boolean | null {
  const firstText = tailHastChildren[0];
  const firstVisible = tailMdastChildren.find((c) => !isWrapInvisible(c));
  // HTML's two end-tag SYNTHESIS exceptions: a stray `</br>` becomes a
  // `<br>` and a stray `</p>` an empty `<p>` (every other unmatched end tag
  // is dropped). The full parse synthesizes them in body context; the
  // tail-only parse, which opens on the stray tag, does not — the element
  // is simply absent from the tail hast, so no join rule can put it back
  // (v2.4.2 review P1-1: `x\n\n</br>\n\ny` lost its `<br>`). Bail.
  if (firstVisible?.type === 'html' && STRAY_SYNTHESIZED_END_TAG_RE.test(firstVisible.value)) return null;
  if (!firstText) return false;
  if (!isSeparatorText(firstText)) {
    // Position-less NON-whitespace leading text: the tail starts with an
    // html block whose leading end tag the tokenizer DROPPED (`</t>\ntext`
    // — no open element to close, so no node ever existed) and whose
    // remaining text merged with the wrap separator at reparse time. The
    // full parse therefore has ONE merged text at the seam; treat it as
    // hoist-merge (v2.4.0 review P3 join side, surfaced by the new fuzz
    // shape). Any other position-less literal keeps its own node.
    if (firstText.type === 'text' && firstText.position === undefined && firstVisible?.type === 'html') {
      if (/^\s*<\/[A-Za-z][A-Za-z0-9-]*\s*>/.test(firstVisible.value)) return true;
      // A complete comment/PI/decl/CDATA existed at raw time (sanitize
      // stripped it later) — its slots stay separate: no merge. A DOCTYPE
      // is not in that class (parse5 drops it, no node) and falls to the
      // bail below.
      if (isSanitizeStrippedConstruct(firstVisible.value)) return false;
      // Anything else — an unterminated `<div` opener the tokenizer drops
      // at EOF-in-tag (release soak: `<div\n\n</t>\ntext`), mixed raw
      // values — needs the tokenizer to say whether a node existed
      // between the separator and this text. Bail to a full parse.
      return null;
    }
    return false;
  }
  if (!firstVisible) return false;
  const firstContent = tailHastChildren.find((c) => !isSeparatorText(c));
  if (firstContent) {
    const start = firstContent.position?.start?.offset;
    const vStart = firstVisible.position?.start?.offset;
    const vEnd = firstVisible.position?.end?.offset;
    if (start !== undefined && vStart !== undefined && vEnd !== undefined) {
      if (start >= vStart && start < vEnd) return true; // hoist
      // First visible's output vanished; classify by the child itself below.
    }
  }
  if (firstVisible.type === 'math') return false; // KaTeX output, never dropped
  // Sanitize-stripped constructs only: a raw-time node existed, the slots
  // stay separate. A `<!DOCTYPE …>` child VANISHES at parse5 time instead
  // (no node — fragment tree construction drops the doctype token), so the
  // seam separator and the tail's leading text MERGE in a full parse
  // (release-gate finding B, seed 20293004) — it falls through to the null
  // bail, full parse for the frame.
  if (firstVisible.type === 'html' && isSanitizeStrippedConstruct(firstVisible.value)) return false;
  return null;
}

/** Position-less whitespace-only root text — wrap()/rehype-raw separator runs. */
function isSeparatorText(node: HastContent): boolean {
  return node.type === 'text' && node.position === undefined && node.value.trim() === '';
}

/** Whether a position-less literal is the trailing raw text of the `html`
 *  mdast block that produced `el` (the element's start is that block's
 *  start, and the block's source ENDS with the literal's text). Trailing raw
 *  literals can only follow html-block output, and only that block's own
 *  text counts — a following dropped-tag block's remnant sits in the same
 *  spot but is not in this block's source. */
export function ownsTrailingLiteral(el: HastContent, literal: { value: string }, prefixMdast: MdastContent[]): boolean {
  const start = el.position?.start?.offset;
  if (start === undefined) return false;
  const owner = prefixMdast.find((c) => c.type === 'html' && c.position?.start?.offset === start);
  if (!owner || owner.type !== 'html') return false;
  const text = literal.value.trim();
  return text !== '' && owner.value.trimEnd().endsWith(text);
}

/** Position-less NON-whitespace text at the top level — the raw reparse's
 *  literal trailing output of an html block (an unblanked text line after
 *  the block's closing tag). Distinct from separators and foster-parenting
 *  hoist, which are whitespace-only. */
export function isTrailingLiteralText(node: HastContent): node is HastContent & { type: 'text'; value: string } {
  return node.type === 'text' && node.position === undefined && node.value.trim() !== '';
}

/** Trailing '\n' run length on a literal's value — its merged separators. */
function countTrailingNewlines(value: string): number {
  let n = 0;
  for (let i = value.length - 1; i >= 0 && value[i] === '\n'; i--) n += 1;
  return n;
}

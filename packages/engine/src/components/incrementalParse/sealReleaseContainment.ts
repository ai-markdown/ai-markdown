/**
 * Dev/test-only containment assertion for the blocker-6 seal release.
 *
 * `shouldReleaseSeal` (freezeLineTransition.ts) is DERIVED from parse5's
 * rule. The RETIRED enumeration of node-less line classes below is kept for
 * one release as the migration's containment assertion (design §8.4): the
 * derived predicate must release only where this one did. Deleted with its
 * F-rows at the next version.
 *
 * Production never runs this module. Its one production call site sits
 * inside a `process.env.NODE_ENV !== 'production'` gate, which the
 * production build folds to `if (false)` and tree-shakes together with this
 * import (tsup `treeshake`, see tsup.config.ts), so neither the counter nor
 * the enumeration reaches `dist/index.js`; the development build keeps both.
 * Tests import the counter by this module path — no barrel re-exports it.
 */
import { CLOSE_TAG_ONLY_RE } from './freezeLineSyntax';
import { type FreezeScanCheckpointInternal, type LineRec } from './freezeScanState';
import { DEF_RE, FOOTNOTE_DEF_RE } from './referenceTaint';

/**
 * How many times the containment assertion has been EVALUATED, which is the
 * number of times the derived predicate released a pending seam.
 *
 * It exists because the assertion cannot otherwise report that it applied.
 * `sealReleaseContainment.test.ts` drives the whole pinned corpus and asserts
 * that nothing was logged — a claim a corpus that never reaches the release
 * path satisfies perfectly. That file already names the risk and answers it
 * with a hand-written single-document pin, which catches the release path
 * dying GLOBALLY and cannot catch this corpus drifting away from it: a
 * regenerated corpus, or a guard moving earlier, leaves the pin green and the
 * sweep vacuous. Measured 2026-08-29 before the floor went in: 862
 * evaluations over 91 distinct line shapes on 6,060 scans, so the sweep is
 * live today and the floor records what "live" was.
 */
let sealReleaseEvaluations = 0;

/** TEST-ONLY (see above). */
export const readSealReleaseEvaluations = (): number => sealReleaseEvaluations;

/** The retired enumeration: def-shaped, comment-only and close-tag-only
 *  lines withhold; everything else releases. */
function sealReleaseEnumerated(cp: FreezeScanCheckpointInternal, ln: LineRec, isBlockStart: boolean): boolean {
  const defShapedLine =
    DEF_RE.test(ln.text) ||
    FOOTNOTE_DEF_RE.test(ln.text) ||
    cp.defBlockMaybeOpen ||
    (cp.fnDefResumable && !(isBlockStart && ln.indent <= 3));
  const commentOnly =
    ln.text
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<!--[\s\S]*$/, ' ')
      .replace(/[ \t\r]/g, '') === '';
  return !defShapedLine && !commentOnly && !CLOSE_TAG_ONLY_RE.test(ln.text);
}

/**
 * Called after the derived predicate released a seam: the enumeration it
 * replaces must have released too. The other quadrant (the enumeration
 * releasing where the derived one holds) is the migration's whole point and
 * is silent; THIS direction would be the derived side going UP, which is the
 * defect direction, so it is reported rather than tolerated. Not a hot path —
 * the caller reaches it on a non-blank line only while a seam is actually
 * pending.
 */
export function assertSealReleaseContained(cp: FreezeScanCheckpointInternal, ln: LineRec, isBlockStart: boolean): void {
  sealReleaseEvaluations += 1;
  if (!sealReleaseEnumerated(cp, ln, isBlockStart)) {
    console.error(
      `[ai-react-markdown] seal-release containment broken at offset ${ln.start}: the derived predicate ` +
        `released a line the retired enumeration withheld (${JSON.stringify(ln.text.slice(0, 80))}).`
    );
  }
}

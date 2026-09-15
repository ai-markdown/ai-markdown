/**
 * TEST-ONLY view of the name lists the freeze scanner classifies tags by.
 *
 * Not part of the scanner's behaviour. No production module imports this
 * file and no barrel re-exports it, so it never reaches `dist`; tests import
 * it by module path. It exists so a test can DERIVE its corpus from the
 * scanner's own taxonomy instead of transcribing it. The census alphabet was
 * hand-written for two years, and F13 is exactly one cell of the table below
 * — `pre`, the single member of `TYPE1_NAMES \ RAW_TEXT_ELEMENTS`. A
 * transcribed list cannot grow that cell back when an upstream
 * `htmlBlockNames` bump moves a name; a derived one does, on the next test
 * run.
 *
 * Adding a list here widens every derived corpus automatically, which is
 * the point — so add one whenever the scanner starts keying a decision on a
 * new set of names.
 */
import {
  DOCUMENT_STRUCTURE_NAMES,
  FOREIGN_ROOT_NAMES,
  NO_ELEMENT_NAMES,
  RAW_TEXT_ELEMENTS,
  SCOPE_BARRIER_NAMES,
  TABLE_PART_NAMES,
  TYPE1_NAMES,
  TYPE6_NAMES,
  VOID_TAGS,
} from './freezeLineSyntax';

export const SCANNER_NAME_LISTS: ReadonlyArray<readonly [string, ReadonlySet<string>]> = [
  ['type1', TYPE1_NAMES],
  ['rawText', RAW_TEXT_ELEMENTS],
  ['type6', TYPE6_NAMES],
  ['void', VOID_TAGS],
  ['documentStructure', DOCUMENT_STRUCTURE_NAMES],
  // Added with F28, and it is the list that would have made F28 visible: the
  // derived census alphabet partitions names by their membership across THIS
  // table, so before it existed `frame` shared one 39-name class with `div`
  // and could never be sampled apart from it.
  ['noElement', NO_ELEMENT_NAMES],
  ['tablePart', TABLE_PART_NAMES],
  ['scopeBarrier', SCOPE_BARRIER_NAMES],
  ['foreignRoot', new Set(FOREIGN_ROOT_NAMES)],
];

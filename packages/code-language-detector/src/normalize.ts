/** Past this length only the head and the tail are inspected, so a huge agent output cannot drive the cost up */
export const MAX_DETECTION_LENGTH = 20_000;

export interface NormalizedCode {
  code: string;
  truncated: boolean;
  /** Original length; confidence uses it to tell whether the snippet is too short */
  originalLength: number;
}

/**
 * Deliberately minimal: trim surrounding whitespace and truncate oversized input.
 * No restructuring, no comment removal, no reformatting: all of those would
 * destroy the literal features detection relies on.
 */
export function normalize(input: string): NormalizedCode {
  const code = input.trim();
  const originalLength = code.length;

  if (originalLength <= MAX_DETECTION_LENGTH) {
    return { code, truncated: false, originalLength };
  }

  const half = Math.floor(MAX_DETECTION_LENGTH / 2);
  // Join with a newline so the seam between head and tail cannot fabricate a
  // token that does not exist.
  const head = code.slice(0, half);
  const tail = code.slice(-half);
  return { code: `${head}\n${tail}`, truncated: true, originalLength };
}

import { useEffect, useState } from 'react';
import { createCodeFrame, nextCodeFrame } from './codeFrame';

/** Initial/SSR, static, final and replacement renders use current text.
 * Only append-only streaming frames may display the preceding snapshot. */
export function useCodeFrame(code: string, language: string, streaming: boolean, interval: number): string {
  const [source, setSource] = useState(() => nextCodeFrame(undefined, code, language));
  const current = nextCodeFrame(source, code, language);
  // React discards this render and retries with the new snapshot. Keeping
  // continuity in render state (not a mutable ref/controller) also means an
  // abandoned concurrent render cannot alter the committed generation.
  if (current !== source) setSource(current);
  const [frame, setFrame] = useState(source);
  const [controller] = useState(() => createCodeFrame(source, setFrame));
  useEffect(() => {
    controller.update(current, streaming, interval);
  }, [controller, current, streaming, interval]);
  useEffect(() => () => controller.dispose(), [controller]);
  return !streaming || interval === 0 || current.generation !== frame.generation ? code : frame.code;
}

import { useEffect, useMemo, useState } from 'react';
import { createCodeBlockSession, type CodeBlockInput, type CodeBlockSnapshot } from '@ai-markdown/core/components';

/**
 * What a code block shows for its current source: the text for the
 * highlighter, the language, and the generation that changes on a rewrite.
 * The policy is core's `createCodeBlockSession`. This hook reads it during
 * render, so the first and the server render are complete, and commits once
 * the render is on screen, so an abandoned render changes nothing.
 */
export function useCodeBlock(input: CodeBlockInput): CodeBlockSnapshot {
  const [changes, setChanges] = useState(0);
  const [session] = useState(() => createCodeBlockSession(() => setChanges((count) => count + 1)));
  const { code, language, identity, streaming, autoDetect, formatJson, expandNestedJson, highlightIntervalMs } = input;
  const current = useMemo<CodeBlockInput>(
    () => ({ code, language, identity, streaming, autoDetect, formatJson, expandNestedJson, highlightIntervalMs }),
    [code, language, identity, streaming, autoDetect, formatJson, expandNestedJson, highlightIntervalMs]
  );
  useEffect(() => {
    session.commit(current);
  }, [session, current]);
  useEffect(() => () => session.dispose(), [session]);
  return useMemo(
    () => session.read(current),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a timer changes the session's answer
    [session, current, changes]
  );
}

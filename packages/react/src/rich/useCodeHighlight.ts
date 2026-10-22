import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { createCodeHighlightSession, type CodeHighlightInput } from '@ai-markdown/core/components';

const useCommitEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** React owns commits and cleanup; the highlighting policy lives in core. */
export function useCodeHighlight(input: CodeHighlightInput) {
  const [changes, changed] = useState(0);
  const [session] = useState(() => createCodeHighlightSession(() => changed((n) => n + 1)));
  const { adapter, code, language, colorScheme, generation, active, streaming } = input;
  const current = useMemo(
    () => ({ adapter, code, language, colorScheme, generation, active, streaming }),
    [adapter, code, language, colorScheme, generation, active, streaming]
  );
  useCommitEffect(() => {
    session.commit(current);
  }, [session, current, changes]);
  useCommitEffect(() => () => session.dispose(), [session]);
  return { ...session.read(current), retry: session.retry };
}

import { useEffect, useMemo, useState } from 'react';
import { createCodeLanguageTracker } from '@ai-markdown/core/components';
import type { CodeLanguage } from '@ai-markdown/code-language-detector';

/**
 * The language of an unlabelled block, or null while the detector abstains.
 * The policy is core's `createCodeLanguageTracker`; this hook reads it during
 * render and lets it time the settle once the text is on screen.
 */
export function useDetectedLanguage(code: string, enabled: boolean, streaming: boolean): CodeLanguage | null {
  const [settles, setSettles] = useState(0);
  const [tracker] = useState(() => createCodeLanguageTracker(() => setSettles((count) => count + 1)));
  useEffect(() => {
    if (enabled) tracker.observe(code, streaming);
    else tracker.dispose();
  }, [tracker, enabled, code, streaming]);
  useEffect(() => () => tracker.dispose(), [tracker]);
  return useMemo(
    () => (enabled ? tracker.read(code, streaming) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a settle changes the tracker's answer
    [tracker, enabled, code, streaming, settles]
  );
}

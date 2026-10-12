import { StreamingLanguageDetector, type CodeLanguage } from '@ai-markdown/code-language-detector';
import { CODE_LANGUAGE_SETTLE_MS, codeBody, extendsCode } from './codeText';

/**
 * Follows the language of one unlabelled code block.
 *
 * The detector is synchronous, so `read` can run during render, server
 * rendering included. It keeps one verdict for as long as the text only
 * grows: it looks again only when the text has grown enough to change the
 * evidence, never lowers its confidence, and charges a margin for a switch
 * across language families. A rewritten block starts over at once, so it
 * never shows the verdict of the text it replaced. The detector is fed the
 * text without hast's final newline, which makes every append a continuation.
 *
 * While the document streams the detector does not look again before 80 more
 * characters, and the streaming flag describes the document, not this fence.
 * `observe` therefore starts a timer after each change: a block whose text
 * has been still for `CODE_LANGUAGE_SETTLE_MS` is judged as complete, and
 * `onSettle` asks the host to read again.
 */
export function createCodeLanguageTracker(onSettle: () => void) {
  const detector = new StreamingLanguageDetector();
  let followed = '';
  let settled: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return {
    /** The verdict for `code`. The same input gives the same answer, so a repeated render is harmless. */
    read(code: string, streaming: boolean): CodeLanguage | null {
      if (!extendsCode(code, followed)) detector.reset();
      followed = code;
      const text = codeBody(code);
      return (streaming && settled !== text ? detector.update(text) : detector.finalize(text)).language;
    },
    /** Call once the text is on screen. Each call replaces the pending timer. */
    observe(code: string, streaming: boolean): void {
      cancel();
      const text = codeBody(code);
      if (!streaming || settled === text) return;
      timer = setTimeout(() => {
        timer = undefined;
        settled = text;
        onSettle();
      }, CODE_LANGUAGE_SETTLE_MS);
    },
    // Cancellation is reversible: a later observe starts a new timer.
    dispose: cancel,
  };
}

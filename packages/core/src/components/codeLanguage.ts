import { StreamingLanguageDetector, type CodeLanguage } from '@ai-markdown/code-language-detector';
import { CODE_LANGUAGE_SETTLE_MS, codeBody, extendsCode } from './codeText';

/**
 * Follows the language of one unlabelled code block.
 *
 * `read` answers during render, server rendering included, and changes
 * nothing: a render that is thrown away cannot move the verdict. `observe` is
 * called once the text is on screen, and only it feeds the detector that
 * follows the block. That detector keeps one verdict for as long as the text
 * only grows: it looks again only when the text has grown enough to change
 * the evidence, never lowers its confidence, and charges a margin for a
 * switch across language families. It is fed the text without hast's final
 * newline, which makes every append a continuation.
 *
 * What `read` answers for a text:
 * - the observed text, or one that extends it: the followed verdict as it
 *   stands. `observe` then looks at the new text and returns true when the
 *   verdict moved, so the host can read again;
 * - anything else (a first or server render, a rewrite, an older text): the
 *   verdict a fresh detector gives it, which is also what `observe` will
 *   arrive at after starting over.
 *
 * While the document streams the detector does not look again before 80 more
 * characters, and the streaming flag describes the document, not this fence.
 * `observe` therefore starts a timer after each change: a block whose text
 * has been still for `CODE_LANGUAGE_SETTLE_MS` is judged as complete, and
 * `onSettle` asks the host to read again.
 */
export function createCodeLanguageTracker(onSettle: () => void) {
  const detector = new StreamingLanguageDetector();
  /** The text the detector follows; undefined until the first `observe`. */
  let followed: string | undefined;
  let settled: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const judge = (from: StreamingLanguageDetector, text: string, streaming: boolean) =>
    (streaming && settled !== text ? from.update(text) : from.finalize(text)).language;
  return {
    /** The verdict for `code`. Changes nothing, so a repeated or abandoned render is harmless. */
    read(code: string, streaming: boolean): CodeLanguage | null {
      if (followed !== undefined && extendsCode(code, followed)) return detector.current.language;
      return judge(new StreamingLanguageDetector(), codeBody(code), streaming);
    },
    /** Call once the text is on screen. Each call replaces the pending timer. True when the verdict `read` gave for `code` has moved. */
    observe(code: string, streaming: boolean): boolean {
      cancel();
      const text = codeBody(code);
      const starting = followed === undefined || !extendsCode(code, followed);
      if (starting) detector.reset();
      const before = detector.current.language;
      followed = code;
      const after = judge(detector, text, streaming);
      if (streaming && settled !== text)
        timer = setTimeout(() => {
          timer = undefined;
          settled = text;
          detector.finalize(text);
          onSettle();
        }, CODE_LANGUAGE_SETTLE_MS);
      // A text that starts over was read with a fresh detector, which is what this one now is.
      return !starting && before !== after;
    },
    // Cancellation is reversible: a later observe starts a new timer.
    dispose: cancel,
  };
}

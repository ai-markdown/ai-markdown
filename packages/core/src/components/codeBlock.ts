import { createCodeFrame, type CodeFrame } from './codeFrame';
import { createCodeLanguageTracker } from './codeLanguage';
import { extendsCode } from './codeText';
import { prettyPrintJson } from './formatJson';
import { createJsonCompletenessScanner } from './jsonCompleteness';

/** The state of one code block at one update. Options arrive already resolved by the host. */
export interface CodeBlockInput {
  /** Raw accumulated source, including its trailing newline. */
  code: string;
  /** Explicit fence language, normalized. Empty when the fence has none. */
  language: string;
  /** Which block this is. A different value starts a new generation even when the text continues. */
  identity?: string;
  /** Document streaming state. */
  streaming: boolean;
  /** Detect the language of a block that has none. */
  autoDetect: boolean;
  /** Pretty-print a JSON block once it is complete. */
  formatJson: boolean;
  expandNestedJson: boolean;
  /** Minimum time between two displayed frames of a growing block. Zero shows every update. */
  highlightIntervalMs: number;
}

export interface CodeBlockSnapshot {
  /** Text for the highlighter: throttled while the block grows, pretty-printed when it is complete JSON. */
  text: string;
  /** The fence language, else the detected one, else empty. */
  language: string;
  /** Grows by one when the block is rewritten or becomes another block. An append keeps it. */
  generation: number;
}

interface Lineage {
  code: string;
  language: string;
  identity: string | undefined;
  generation: number;
}

/**
 * Everything a code block derives from its source, for one block.
 *
 * `read` answers during render, server rendering included. Equal input gives
 * an equal answer, and a render that is abandoned leaves the committed
 * generation and the language verdict alone. `commit` is called once the answer
 * is on screen: it records the lineage, lets the language detector look at the
 * text, and starts the display throttle and the language settle timer. When a
 * commit or a timer changes the answer, `onChange` asks the host to read again. A host that never commits, such as a server render, always reads the
 * current text.
 *
 * - An append keeps the generation; a rewrite, another fence language or
 *   another `identity` advances it.
 * - While the document streams, appends inside `highlightIntervalMs` share one
 *   displayed frame. A rewrite, a language change, a static update and the end
 *   of the stream show the current text at once.
 * - A block with no fence language is detected as it grows and judged as
 *   complete once its text has been still (see `createCodeLanguageTracker`).
 * - JSON is pretty-printed when the document is not streaming, or as soon as
 *   the displayed text is a balanced value.
 */
export function createCodeBlockSession(onChange: () => void) {
  let committed: Lineage | undefined;
  /** The frame on screen: what the throttle last published. */
  let shown: { code: string; language: string; generation: number } | undefined;
  let frames: ReturnType<typeof createCodeFrame> | undefined;
  let token: { key: string; value: object } | undefined;
  let committing = false;
  const tracker = createCodeLanguageTracker(() => onChange());
  const scanJson = createJsonCompletenessScanner();
  let formatted: { source: string; nested: boolean; text: string } | undefined;

  const generationOf = (input: CodeBlockInput): number => {
    if (!committed) return 0;
    const continues =
      input.identity === committed.identity &&
      input.language === committed.language &&
      extendsCode(input.code, committed.code);
    return continues ? committed.generation : committed.generation + 1;
  };
  const languageOf = (input: CodeBlockInput): string =>
    input.language || (input.autoDetect ? (tracker.read(input.code, input.streaming) ?? '') : '');
  const pretty = (source: string, nested: boolean): string => {
    if (formatted?.source !== source || formatted.nested !== nested)
      formatted = { source, nested, text: prettyPrintJson(source, nested) };
    return formatted.text;
  };

  return {
    read(input: CodeBlockInput): CodeBlockSnapshot {
      const generation = generationOf(input);
      const language = languageOf(input);
      const current =
        !shown ||
        !input.streaming ||
        input.highlightIntervalMs === 0 ||
        shown.generation !== generation ||
        shown.language !== language;
      const displayed = current ? input.code : shown!.code;
      const text =
        input.formatJson && displayed && language === 'json' && (!input.streaming || scanJson(displayed))
          ? pretty(displayed, input.expandNestedJson)
          : displayed;
      return { text, language, generation };
    },
    commit(input: CodeBlockInput): void {
      const generation = generationOf(input);
      const detecting = input.autoDetect && !input.language;
      // Only a commit feeds the detector. It reports a verdict that differs from the one `read` gave.
      const moved = detecting ? tracker.observe(input.code, input.streaming) : (tracker.dispose(), false);
      const language = languageOf(input);
      committed = { code: input.code, language: input.language, identity: input.identity, generation };
      // The throttle treats a new token as a replacement: a rewrite, or another language to highlight in.
      const key = `${generation}:${language}`;
      if (token?.key !== key) token = { key, value: {} };
      const frame: CodeFrame = { code: input.code, language, generation: token.value };
      committing = true;
      try {
        if (!frames) {
          shown = { code: input.code, language, generation };
          frames = createCodeFrame(frame, (next) => {
            shown = { code: next.code, language: next.language, generation: committed!.generation };
            // A frame published inside commit is the text `read` already returned.
            if (!committing) onChange();
          });
        }
        frames.update(frame, input.streaming, input.highlightIntervalMs);
        // The throttle publishes nothing for unchanged text, so a new generation of it is adopted here.
        if (shown!.code === input.code && shown!.language === language) shown!.generation = generation;
      } finally {
        committing = false;
      }
      if (moved) onChange();
    },
    // Cancellation is reversible: a later commit starts the timers again.
    dispose(): void {
      frames?.dispose();
      tracker.dispose();
    },
  };
}

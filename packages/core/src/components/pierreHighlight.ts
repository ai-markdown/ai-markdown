import { startsWithText } from './codeText';
import { CodeLanguageFormat, type CodeHighlightAdapter, type CodeHighlightToken } from './codeHighlight';

export interface PierreHighlightToken {
  content: string;
  offset: number;
  color?: string;
  bgColor?: string;
  fontStyle?: number;
}
/** Only the synchronous, editable-document API is needed; core imports no WASM runtime. */
export interface PierreLiveTokenizer {
  readonly lineCount: number;
  getLineLength(line: number): number;
  getLineTokens(line: number): { tokens: readonly PierreHighlightToken[] };
  applyEdits(
    edits: readonly {
      range: { start: { line: number; character: number }; end: { line: number; character: number } };
      newText: string;
    }[]
  ): { lineChanges: readonly { oldStartLine: number; oldEndLine: number; newStartLine: number; newEndLine: number }[] };
  dispose(): void;
}
/** Structural interface: applications own the optional WASM engine and theme imports. */
export interface PierreHighlightRuntime<Language extends string, Theme> {
  isSupportedLanguage(language: string): boolean;
  codeToTokens(
    code: string,
    options: { lang: Language; theme: NoInfer<Theme> }
  ): {
    tokens: readonly (readonly PierreHighlightToken[])[];
    fg?: string;
  };
  LiveTokenizer?: new (options: { code: string; lang: Language; theme: NoInfer<Theme> }) => PierreLiveTokenizer;
  themes: { light: Theme; dark: Theme };
}
function convert(token: PierreHighlightToken, foreground?: string): CodeHighlightToken {
  return {
    text: token.content,
    color: token.color ?? foreground,
    backgroundColor: token.bgColor,
    fontStyle: token.fontStyle,
  };
}
/** Lazy initialization is shared; mutable tokenizers belong to individual mounted blocks. */
export function createPierreHighlightAdapter<Language extends string, Theme>(options: {
  load: () => Promise<PierreHighlightRuntime<Language, Theme>>;
  /** Defaults to true. Disable to compare with full-frame tokenization. */
  incremental?: boolean;
}): CodeHighlightAdapter {
  let runtime: PierreHighlightRuntime<Language, Theme> | undefined;
  let pending: Promise<void> | undefined;
  const adapter: CodeHighlightAdapter = {
    languageFormat: CodeLanguageFormat.Pierre,
    supports: (language) =>
      !['plain', 'plaintext', 'text', 'txt'].includes(language) && (!runtime || runtime.isSupportedLanguage(language)),
    isReady: () => Boolean(runtime),
    prepare: () => {
      if (runtime) return;
      return (pending ??= Promise.resolve()
        .then(options.load)
        .then((loaded) => {
          runtime = loaded;
        })
        .finally(() => {
          pending = undefined;
        }));
    },
    highlight: ({ code, language, colorScheme }) => {
      if (!runtime?.isSupportedLanguage(language)) return;
      const result = runtime.codeToTokens(code, { lang: language as Language, theme: runtime.themes[colorScheme] });
      const tokens: CodeHighlightToken[] = [];
      let cursor = 0;
      for (const line of result.tokens) {
        for (const token of line) {
          if (token.offset > cursor) tokens.push({ text: code.slice(cursor, token.offset), color: result.fg });
          tokens.push(convert(token, result.fg));
          cursor = token.offset + token.content.length;
        }
      }
      if (cursor < code.length) tokens.push({ text: code.slice(cursor), color: result.fg });
      return { tokens };
    },
  };
  if (options.incremental !== false)
    adapter.createSession = () => {
      let live: PierreLiveTokenizer | undefined;
      let previous = '',
        previousLanguage = '',
        previousScheme = '';
      let lines: CodeHighlightToken[][] = [];
      const dispose = () => {
        live?.dispose();
        live = undefined;
        lines = [];
        previous = '';
      };
      return {
        dispose,
        highlight(request) {
          const { code, language, colorScheme } = request;
          if (!runtime?.isSupportedLanguage(language)) return;
          if (!request.streaming || !runtime.LiveTokenizer) {
            dispose();
            return adapter.highlight(request);
          }
          const appended = startsWithText(code, previous);
          // HAST adds a final newline: `ab\n` -> `abc\n` is still an append to the source.
          // Replace that terminator with the new suffix, retaining the preceding lexer state.
          const terminatorLength = previous.endsWith('\r\n') ? 2 : previous.endsWith('\n') ? 1 : 0;
          const suffixStart = previous.length - terminatorLength;
          const replacesTerminator =
            !appended && terminatorLength > 0 && startsWithText(code, previous.slice(0, suffixStart));
          if (
            !live ||
            language !== previousLanguage ||
            colorScheme !== previousScheme ||
            (!appended && !replacesTerminator)
          ) {
            dispose();
            live = new runtime.LiveTokenizer({ code, lang: language as Language, theme: runtime.themes[colorScheme] });
            lines = Array.from({ length: live.lineCount }, (_, line) =>
              live!.getLineTokens(line).tokens.map((token) => convert(token))
            );
          } else if (code !== previous) {
            const line = live.lineCount - 1;
            const end = { line, character: live.getLineLength(line) };
            const start = replacesTerminator ? { line: line - 1, character: live.getLineLength(line - 1) } : end;
            const update = live.applyEdits([
              { range: { start, end }, newText: code.slice(replacesTerminator ? suffixStart : previous.length) },
            ]);
            // Apply ranges backwards so old line indices remain valid. Materialize only changed lines.
            for (const change of [...update.lineChanges].reverse()) {
              const replacement = Array.from({ length: change.newEndLine - change.newStartLine }, (_, index) =>
                live!.getLineTokens(change.newStartLine + index).tokens.map((token) => convert(token))
              );
              lines = [...lines.slice(0, change.oldStartLine), ...replacement, ...lines.slice(change.oldEndLine)];
            }
          }
          previous = code;
          previousLanguage = language;
          previousScheme = colorScheme;
          const breaks = code.match(/\r\n|\r|\n/g) ?? [];
          return {
            tokens: lines.flatMap((line, index) => (index < breaks.length ? [...line, { text: breaks[index] }] : line)),
          };
        },
      };
    };
  return adapter;
}

import { normalizeHighlightJsLanguage, normalizeShikiLanguage } from '@ai-markdown/code-language-detector';

/** Engine spellings, independent of the UI package. */
export enum CodeLanguageFormat {
  HighlightJs = 'highlight-js',
  Shiki = 'shiki',
  Pierre = 'pierre',
}
export type CodeLanguageResolver = CodeLanguageFormat | ((language: string) => string);
export function resolveCodeHighlightLanguage(
  language: string,
  format: CodeLanguageResolver = CodeLanguageFormat.HighlightJs
): string {
  if (format === CodeLanguageFormat.Pierre) {
    const name = normalizeShikiLanguage(language);
    return name === 'common-lisp' ? 'lisp' : name;
  }
  return typeof format === 'function'
    ? format(language)
    : format === CodeLanguageFormat.Shiki
      ? normalizeShikiLanguage(language)
      : normalizeHighlightJsLanguage(language);
}
export function resolveCodeHighlightInterval(value: number | undefined, fallback = 50): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}
export interface CodeHighlightToken {
  text: string;
  color?: string;
  backgroundColor?: string;
  /** Shiki-compatible bit flags: italic=1, bold=2, underline=4. */
  fontStyle?: number;
}
/** HTML must come from a trusted highlighter which escapes source text. Never return raw source as HTML. */
export type CodeHighlightResult = { html: string } | { tokens: readonly CodeHighlightToken[] };
export interface CodeHighlightRequest {
  code: string;
  language: string;
  colorScheme: 'light' | 'dark';
  /** Enable incremental work while the document is streaming. */
  streaming?: boolean;
}
/** Mutable engine state owned by one mounted code block, updated only on commit. */
export interface CodeHighlightBackend {
  highlight(request: CodeHighlightRequest): CodeHighlightResult | undefined;
  dispose(): void;
}
/** Inject engines from the application; core imports no highlighting runtime. */
export interface CodeHighlightAdapter {
  languageFormat: CodeLanguageResolver;
  /** Optional incremental backend. Never created during rendering or SSR. */
  createSession?(): CodeHighlightBackend;
  supports?(language: string): boolean;
  isReady?(request: CodeHighlightRequest): boolean;
  /** Called only after the framework commits. May load an engine, theme or language. */
  prepare?(request: CodeHighlightRequest): void | Promise<void>;
  /** Synchronous after preparation. Return undefined to display plain source. */
  highlight(request: CodeHighlightRequest): CodeHighlightResult | undefined;
}
export interface CodeHighlightInput {
  adapter?: CodeHighlightAdapter;
  code: string;
  /** Unconverted fence language or detector result. */
  language: string;
  colorScheme: 'light' | 'dark';
  /** Enable incremental work while the document is streaming. */
  streaming?: boolean;
  generation: number;
  active?: boolean;
}
export interface CodeHighlightSnapshot {
  language: string;
  status: 'plain' | 'loading' | 'ready' | 'error';
  result?: CodeHighlightResult;
  error?: unknown;
}
/** Per-block cache and async preparation. A late preparation never publishes an old code result. */
export function createCodeHighlightSession(onChange: () => void) {
  let prepared:
    | {
        adapter: CodeHighlightAdapter;
        language: string;
        colorScheme: string;
        error?: unknown;
        failed?: boolean;
        ready?: boolean;
      }
    | undefined;
  let cached: { input: CodeHighlightInput; snapshot: CodeHighlightSnapshot } | undefined;
  let fault: { input: CodeHighlightInput; error: unknown } | undefined;
  let epoch = 0;
  let backend:
    | {
        adapter: CodeHighlightAdapter;
        language: string;
        colorScheme: string;
        generation: number;
        value: CodeHighlightBackend;
      }
    | undefined;
  const release = () => {
    const previous = backend;
    backend = undefined;
    try {
      previous?.value.dispose();
    } catch {
      // Third-party cleanup must not block invalidation, a replacement backend or framework unmount.
    }
  };
  const sameInput = (a: CodeHighlightInput | undefined, b: CodeHighlightInput) =>
    a?.adapter === b.adapter &&
    a?.code === b.code &&
    a?.language === b.language &&
    a?.colorScheme === b.colorScheme &&
    a?.generation === b.generation &&
    a?.streaming === b.streaming;
  const commitHighlight = (input: CodeHighlightInput, request: CodeHighlightRequest) => {
    const adapter = input.adapter!;
    if (!adapter.createSession || sameInput(cached?.input, input)) return;
    let snapshot: CodeHighlightSnapshot;
    try {
      backend ??= {
        adapter,
        language: request.language,
        colorScheme: request.colorScheme,
        generation: input.generation,
        value: adapter.createSession(),
      };
      const result = backend.value.highlight(request);
      snapshot = { language: request.language, status: result ? 'ready' : 'plain', result };
    } catch (error) {
      release();
      snapshot = { language: request.language, status: 'error', error };
    }
    cached = { input: { ...input }, snapshot };
    onChange();
  };
  const matches = (adapter: CodeHighlightAdapter, request: CodeHighlightRequest) =>
    prepared?.adapter === adapter &&
    prepared.language === request.language &&
    prepared.colorScheme === request.colorScheme;
  const requestOf = (input: CodeHighlightInput): CodeHighlightRequest => ({
    code: input.code,
    language: input.adapter
      ? resolveCodeHighlightLanguage(input.language, input.adapter.languageFormat)
      : input.language,
    colorScheme: input.colorScheme,
    streaming: input.streaming,
  });
  return {
    read(input: CodeHighlightInput): CodeHighlightSnapshot {
      const adapter = input.adapter;
      if (!adapter || input.active === false) return { language: input.language, status: 'plain' };
      if (fault && sameInput(fault.input, input))
        return { language: input.language, status: 'error', error: fault.error };
      let request: CodeHighlightRequest;
      try {
        request = requestOf(input);
        if (adapter.supports?.(request.language) === false) return { language: request.language, status: 'plain' };
        if (matches(adapter, request) && prepared?.failed)
          return { language: request.language, status: 'error', error: prepared.error };
        if (adapter.prepare && !adapter.isReady?.(request) && !(matches(adapter, request) && prepared?.ready))
          return { language: request.language, status: 'loading' };
        if (sameInput(cached?.input, input)) return cached!.snapshot;
        if (adapter.createSession) return { language: request.language, status: 'loading' };
        const result = adapter.highlight(request);
        const snapshot: CodeHighlightSnapshot = {
          language: request.language,
          status: result ? 'ready' : 'plain',
          result,
        };
        cached = { input: { ...input }, snapshot };
        return snapshot;
      } catch (error) {
        return { language: input.language, status: 'error', error };
      }
    },
    commit(input: CodeHighlightInput) {
      if (input.adapter && input.active !== false && fault && sameInput(fault.input, input)) return;
      fault = undefined;
      const adapter = input.adapter;
      if (!adapter || input.active === false) {
        epoch++;
        prepared = undefined;
        cached = undefined;
        release();
        return;
      }
      let request: CodeHighlightRequest;
      try {
        request = requestOf(input);
        if (
          backend &&
          (backend.adapter !== adapter ||
            backend.language !== request.language ||
            backend.colorScheme !== request.colorScheme ||
            backend.generation !== input.generation)
        ) {
          release();
          cached = undefined;
        }
        if (adapter.supports?.(request.language) === false) {
          epoch++;
          prepared = undefined;
          cached = undefined;
          release();
          return;
        }
        if (matches(adapter, request)) {
          if (!prepared?.failed && (!adapter.prepare || adapter.isReady?.(request) || prepared?.ready))
            commitHighlight(input, request);
          return;
        }
        const ticket = ++epoch;
        prepared = { adapter, language: request.language, colorScheme: request.colorScheme };
        if (!adapter.prepare || adapter.isReady?.(request)) {
          commitHighlight(input, request);
          return;
        }
        Promise.resolve()
          .then(() => {
            if (ticket !== epoch) return;
            return adapter.prepare!(request);
          })
          .then(
            () => {
              if (ticket !== epoch) return;
              prepared!.ready = true;
              cached = undefined;
              onChange();
            },
            (error: unknown) => {
              if (ticket !== epoch) return;
              prepared!.failed = true;
              prepared!.error = error;
              onChange();
            }
          );
      } catch (error) {
        epoch++;
        release();
        prepared = undefined;
        cached = undefined;
        fault = { input: { ...input }, error };
        onChange();
      }
    },
    retry() {
      fault = undefined;
      release();
      epoch++;
      prepared = undefined;
      cached = undefined;
      onChange();
    },
    dispose() {
      fault = undefined;
      release();
      epoch++;
      prepared = undefined;
      cached = undefined;
    },
  };
}

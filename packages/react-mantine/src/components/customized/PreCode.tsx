'use client';

import { createContext, HTMLAttributes, memo, useContext, useMemo, useState } from 'react';
import { CodeHighlight, CodeHighlightTabs, CodeHighlightControl } from '@mantine/code-highlight';
import { useAIMarkdownState, useAIMarkdownTheme } from '@ai-markdown/react';
import {
  StreamingLanguageDetector,
  normalizeHighlightJsLanguage,
  normalizeShikiLanguage,
  type CodeLanguage,
} from '@ai-markdown/code-language-detector';
import { useMantineCodeBlockOptions } from '../../hooks/useMantineCodeBlockOptions';
import MantineAIMMermaidCode from './MermaidCode';
import { CopyButton } from '@mantine/core';
import { prettyPrintJson } from './formatJson';
import { createJsonCompletenessScanner } from './jsonCompleteness';
import { useCodeFrame } from './useCodeFrame';
import { MantineLanguageFormat, type MantineCodeBlockOptions } from '../../defs';
export { jsonLooksComplete } from './jsonCompleteness';
export { prettyPrintJson } from './formatJson';

const createDetector = () => new StreamingLanguageDetector();

/**
 * The language of an unlabelled block, or null while the detector abstains.
 *
 * History: detection used to run `hljs.highlightAuto`, which scores every
 * registered grammar against the whole text. That forced a doubling
 * schedule to keep a stream O(n), an asynchronous highlight.js injection
 * (`codeBlock.highlightJs`) so the peer could stay optional, and a first
 * paint of "unknown" on every render path. The heuristic detector is
 * synchronous and dependency-free, so it runs during render — server
 * rendering included — and owns the streaming policy itself: it re-detects
 * only when the text has grown enough to change the evidence, never lowers
 * its confidence, charges a margin for a switch across language families,
 * and treats any text that does not extend the previous one (a regenerate)
 * as a new block.
 *
 * One detector per block instance. `finalize` is idempotent for an
 * unchanged text, so re-renders after the stream ends cost nothing.
 */
function useDetectedLanguage(codeText: string, enabled: boolean, streaming: boolean): CodeLanguage | null {
  const [detector] = useState(createDetector);
  return useMemo(() => {
    if (!enabled) return null;
    return (streaming ? detector.update(codeText) : detector.finalize(codeText)).language;
  }, [detector, enabled, streaming, codeText]);
}

/**
 * Loads mermaid ahead of time. It is otherwise loaded on demand by the
 * diagram renderer (the first diagram pays the download); an app that would
 * rather take that cost at startup — a documentation page whose first screen
 * shows a diagram, say — calls this once at boot. Safe to call repeatedly;
 * failures are swallowed (the renderer will simply load lazily later).
 */
export function preloadMantineCodeAssets(): Promise<void> {
  return import('mermaid').then(
    () => undefined,
    () => undefined
  );
}

const RawCodeContext = createContext('');

/** Context updates the copy control without re-running the highlighter. */
function RawCodeCopy() {
  const code = useContext(RawCodeContext);
  return (
    <CopyButton value={code}>
      {({ copied, copy }) => (
        <CodeHighlightControl
          tooltipLabel={copied ? 'Copied' : 'Copy'}
          aria-label={copied ? 'Copied' : 'Copy code'}
          onClick={copy}
        >
          {copied ? (
            '✓'
          ) : (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <rect x="8" y="8" width="12" height="12" rx="2" />
              <path d="M16 8V4H4v12h4" />
            </svg>
          )}
        </CodeHighlightControl>
      )}
    </CopyButton>
  );
}

/**
 * Stable props keep intermediate streaming renders away from Mantine's
 * highlighter: the parent coalesces appended code through `useCodeFrame`,
 * and this memo boundary means an unchanged frame is not re-rendered at
 * all. Beyond that, no local caching: Mantine's `CodeHighlight` already
 * memoizes `highlight()` on code, language, color scheme and the
 * language-loaded flag, so an extra single-entry cache bought nothing.
 *
 * It also must NOT sit under its own `CodeHighlightAdapterProvider`. An
 * earlier version wrapped these components in a nested provider whose
 * adapter exposed only `getHighlighter`. `CodeHighlight` reads
 * `useLoadLanguage()` / `useIsLanguageLoaded()` from the NEAREST provider,
 * so the consumer's adapter was never asked to load a grammar and adapters
 * that load languages on demand (Mantine's `createShikiAdapter`) rendered
 * every block as plain text. The components now read the consumer's
 * provider directly.
 */
const OrdinaryCodeHighlight = memo(function OrdinaryCodeHighlight({
  code,
  language,
  fileName,
  fontSize,
  defaultExpanded,
}: {
  code: string;
  language: string;
  fileName: string;
  fontSize: number | string;
  defaultExpanded: boolean;
}) {
  return fileName === 'unknown' ? (
    <CodeHighlight
      mb={15}
      fz={fontSize}
      w="100%"
      code={code}
      withBorder
      withExpandButton
      defaultExpanded={defaultExpanded}
      maxCollapsedHeight="320px"
      withCopyButton={false}
      controls={[<RawCodeCopy key="copy" />]}
    />
  ) : (
    <CodeHighlightTabs
      mb={15}
      fz={fontSize}
      w="100%"
      code={[
        {
          fileName: fileName,
          code: code,
          language: language,
        },
      ]}
      withBorder
      withExpandButton
      defaultExpanded={defaultExpanded}
      maxCollapsedHeight="320px"
      withCopyButton={false}
      controls={[<RawCodeCopy key="copy" />]}
    />
  );
});

/**
 * Code languages that receive specialized rendering instead of standard
 * syntax-highlighted code blocks. Adding a new member here automatically
 * marks that language as "special" — you only need to add the corresponding
 * rendering branch in the component's return.
 */
enum SpecialCodeLanguage {
  /** Rendered as interactive diagrams via {@link MantineAIMMermaidCode} */
  Mermaid = 'mermaid',
}

/** O(1) lookup set, derived from {@link SpecialCodeLanguage}. */
const SPECIAL_LANGUAGES = new Set<string>(Object.values(SpecialCodeLanguage));

/**
 * Mantine code block renderer for `<pre>` elements.
 *
 * Replaces the default `<pre>` rendering with Mantine's {@link CodeHighlight} or
 * {@link CodeHighlightTabs} components, providing syntax highlighting, expand/collapse
 * behavior, and file-name tabs.
 *
 * Behavior:
 * - If the code block has an explicit language annotation, uses that language.
 * - If no language is specified and the `codeBlock` group's
 *   `autoDetectUnknownLanguage` option is enabled, uses the language
 *   `@ai-markdown/code-language-detector` identifies.
 * - Either way the highlighter receives the language in the naming of the
 *   adapter selected by `codeBlock.languageFormat`.
 * - Mermaid code blocks (`language-mermaid`) are rendered as interactive diagrams
 *   via {@link MantineAIMMermaidCode}.
 * - JSON code blocks are formatted without rounding numeric tokens; nested expansion is optional.
 * - Unrecognized languages render as plaintext with an "unknown" label using
 *   {@link CodeHighlight} (no tabs).
 * - Recognized languages render with {@link CodeHighlightTabs} showing the
 *   language name as the tab label.
 *
 * @param props.codeText - The raw text content of the code block.
 * @param props.existLanguage - Language identifier extracted from the `language-*` CSS class, if present.
 */
const MantineAIMPreCode = memo(
  (
    props: HTMLAttributes<HTMLPreElement> & {
      codeText: string;
      existLanguage?: string;
      options?: Partial<MantineCodeBlockOptions>;
      disableSpecial?: boolean;
    }
  ) => {
    const { fontSize } = useAIMarkdownTheme();
    const { streaming } = useAIMarkdownState();
    const {
      autoDetectUnknownLanguage,
      languageFormat,
      defaultExpanded,
      formatJson,
      expandNestedJson,
      highlightIntervalMs,
    } = useMantineCodeBlockOptions(props.options);

    const detectedLanguage = useDetectedLanguage(
      props.codeText,
      autoDetectUnknownLanguage && !props.existLanguage,
      streaming
    );
    // Lower-cased once for every decision below: fence languages arrive in
    // whatever case the model wrote (` ```Mermaid `, ` ```JSON `), and both
    // the special-language switch and the JSON branch must agree
    // (2026-08 project review, pkg-small-08 — the mermaid check was
    // case-sensitive while the JSON check was not).
    const codeLanguage = props.existLanguage ? props.existLanguage.toLowerCase() : (detectedLanguage ?? '');

    // The label keeps the language as the model wrote it, or the detected
    // language's own name; the highlighter gets the adapter's spelling of it:
    // under highlight.js ` ```objc ` is highlighted as `objectivec`, and a Vue
    // component is labelled `vue` and highlighted as `xml`. A name neither
    // table knows passes through, and Mantine's adapters degrade a language
    // they lack to plaintext. The label is "unknown" only when there is no
    // language at all.
    const [usedCodeLanguage, usedFileName] = useMemo(() => {
      if (!codeLanguage) return ['plaintext', 'unknown'];
      const normalize =
        languageFormat === MantineLanguageFormat.Shiki ? normalizeShikiLanguage : normalizeHighlightJsLanguage;
      return [normalize(codeLanguage), codeLanguage];
    }, [codeLanguage, languageFormat]);

    const isSpecialCodeBlock =
      Boolean(props.existLanguage) && !props.disableSpecial && SPECIAL_LANGUAGES.has(codeLanguage);

    const [scanJson] = useState(createJsonCompletenessScanner);
    const jsonComplete = useMemo(
      () => (codeLanguage === 'json' && formatJson && streaming ? scanJson(props.codeText) : false),
      [codeLanguage, formatJson, streaming, scanJson, props.codeText]
    );

    const normalCodeBlockContent = useMemo(() => {
      if (isSpecialCodeBlock) return null;
      let usedCodeStr = props.codeText;
      // JSON pretty-print as soon as the block LOOKS complete: a streamed
      // prefix never parses, so trying to pretty-print every chunk of a
      // growing block was O(n²) work for nothing (pkg-small-06) — but a
      // block that finished mid-document must not wait for the whole
      // message to end. "Ends with a closing bracket" alone was not enough
      // of a tell: pretty-printed JSON (the common LLM shape) ends a chunk
      // on `}` / `]` at almost every nesting level, so the parse still ran
      // on nearly every chunk (v2.4.1 review). Only a BALANCED bracket
      // scan (strings skipped, one linear pass) admits the parse.
      if (formatJson && usedCodeStr && codeLanguage === 'json' && (!streaming || jsonComplete)) {
        usedCodeStr = prettyPrintJson(usedCodeStr, expandNestedJson);
      }
      return usedCodeStr;
    }, [isSpecialCodeBlock, props.codeText, codeLanguage, streaming, formatJson, expandNestedJson, jsonComplete]);
    const displayedCode = useCodeFrame(
      normalCodeBlockContent ?? '',
      usedCodeLanguage,
      streaming && !isSpecialCodeBlock,
      highlightIntervalMs
    );

    const specialCodeBlockContent = useMemo(() => {
      switch (codeLanguage) {
        case SpecialCodeLanguage.Mermaid:
          return <MantineAIMMermaidCode code={props.codeText} options={props.options} />;
        default:
          return null;
      }
    }, [codeLanguage, props.codeText, props.options]);

    return isSpecialCodeBlock ? (
      specialCodeBlockContent
    ) : (
      <RawCodeContext.Provider value={props.codeText}>
        <OrdinaryCodeHighlight
          code={displayedCode}
          language={usedCodeLanguage}
          fileName={usedFileName}
          fontSize={fontSize}
          defaultExpanded={defaultExpanded}
        />
      </RawCodeContext.Provider>
    );
  }
);

MantineAIMPreCode.displayName = 'MantineAIMPreCode';

export default MantineAIMPreCode;

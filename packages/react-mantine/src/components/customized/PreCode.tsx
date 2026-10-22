'use client';

import { createContext, HTMLAttributes, memo, useContext, useMemo } from 'react';
import { CodeHighlight, CodeHighlightTabs, CodeHighlightControl } from '@mantine/code-highlight';
import { useAIMarkdownDocument, useAIMarkdownState, useAIMarkdownTheme } from '@ai-markdown/react';
// The frame throttle, language detection and JSON helpers are the shared headless ones.
// This file adds the Mantine presentation.
import { useCodeBlock } from '@ai-markdown/react/components/code/plain';
import { resolveCodeHighlightLanguage } from '@ai-markdown/core/components';
import { useMantineCodeBlockOptions } from '../../hooks/useMantineCodeBlockOptions';
import { InjectedCodeHighlight } from './InjectedCodeHighlight';
import MantineAIMMermaidCode from './MermaidCode';
import { CopyButton } from '@mantine/core';
import { defaultMantineCodeBlockLabels, type MantineCodeBlockLabels, type MantineCodeBlockOptions } from '../../defs';
import { resolveLabels } from '@ai-markdown/core/components';

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
const LabelsContext = createContext<MantineCodeBlockLabels>(defaultMantineCodeBlockLabels);

/** Context updates the copy control without re-running the highlighter. */
function RawCodeCopy() {
  const code = useContext(RawCodeContext);
  const labels = useContext(LabelsContext);
  return (
    <CopyButton value={code}>
      {({ copied, copy }) => (
        <CodeHighlightControl
          tooltipLabel={copied ? labels.copiedTooltip : labels.copyTooltip}
          aria-label={copied ? labels.copied : labels.copy}
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
 * highlighter: the parent coalesces appended code through `useCodeBlock`,
 * and this memo boundary means an unchanged frame is not re-rendered at
 * all. Beyond that, no local caching: Mantine's `CodeHighlight` already
 * memoizes `highlight()` on code, language, color scheme and the
 * language-loaded flag, so an extra single-entry cache bought nothing.
 *
 * Without an explicit neutral highlighter, it reads the consumer Provider. An
 * earlier version wrapped these components in a nested provider whose
 * adapter exposed only `getHighlighter`. `CodeHighlight` reads
 * `useLoadLanguage()` / `useIsLanguageLoaded()` from the NEAREST provider,
 * so the consumer's adapter was never asked to load a grammar and adapters
 * that load languages on demand (Mantine's `createShikiAdapter`) rendered
 * every block as plain text. The components now read the consumer's
 * provider directly. With an explicit neutral adapter, InjectedCodeHighlight
 * owns the React session and its local Provider only paints the prepared result.
 */
const OrdinaryCodeHighlight = memo(function OrdinaryCodeHighlight({
  code,
  language,
  fileName,
  fontSize,
  defaultExpanded,
  expandLabel,
  collapseLabel,
}: {
  code: string;
  language: string;
  fileName: string;
  fontSize: number | string;
  defaultExpanded: boolean;
  expandLabel: string;
  collapseLabel: string;
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
      expandCodeLabel={expandLabel}
      collapseCodeLabel={collapseLabel}
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
      expandCodeLabel={expandLabel}
      collapseCodeLabel={collapseLabel}
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
    const { fontSize, colorScheme } = useAIMarkdownTheme();
    const { streaming } = useAIMarkdownState();
    const { documentId } = useAIMarkdownDocument();
    const {
      autoDetectUnknownLanguage,
      languageFormat,
      highlighter,
      defaultExpanded,
      formatJson,
      expandNestedJson,
      highlightIntervalMs,
      labels: configuredLabels,
    } = useMantineCodeBlockOptions(props.options);
    const labels = resolveLabels(defaultMantineCodeBlockLabels, configuredLabels);

    // Lower-cased once for every decision below: fence languages arrive in
    // whatever case the model wrote (` ```Mermaid `, ` ```JSON `), and both
    // the special-language switch and the JSON branch must agree
    // (2026-08 project review, pkg-small-08 — the mermaid check was
    // case-sensitive while the JSON check was not).
    const fenceLanguage = props.existLanguage ? props.existLanguage.toLowerCase() : '';
    const isSpecialCodeBlock = Boolean(fenceLanguage) && !props.disableSpecial && SPECIAL_LANGUAGES.has(fenceLanguage);

    // Core's code block session: appended code is coalesced before it is
    // scanned, formatted and highlighted, an unlabelled block is detected,
    // and JSON is pretty-printed once the displayed text is a balanced value.
    // Copy still reads props.codeText, including bytes waiting for the frame.
    const block = useCodeBlock({
      code: isSpecialCodeBlock ? '' : props.codeText,
      language: fenceLanguage,
      // The block is keyed by its position; another document there is another block.
      identity: documentId,
      streaming: streaming && !isSpecialCodeBlock,
      autoDetect: autoDetectUnknownLanguage,
      formatJson,
      expandNestedJson,
      highlightIntervalMs,
    });
    const codeLanguage = block.language;

    // The label keeps the language as the model wrote it, or the detected
    // language's own name; the highlighter gets the adapter's spelling of it:
    // under highlight.js ` ```objc ` is highlighted as `objectivec`, and a Vue
    // component is labelled `vue` and highlighted as `xml`. A name neither
    // table knows passes through, and Mantine's adapters degrade a language
    // they lack to plaintext. The label is "unknown" only when there is no
    // language at all.
    const [usedCodeLanguage, usedFileName] = useMemo(() => {
      if (!codeLanguage) return ['plaintext', 'unknown'];
      return [resolveCodeHighlightLanguage(codeLanguage, languageFormat), codeLanguage];
    }, [codeLanguage, languageFormat]);

    const specialCodeBlockContent = useMemo(() => {
      switch (codeLanguage) {
        case SpecialCodeLanguage.Mermaid:
          return <MantineAIMMermaidCode code={props.codeText} options={props.options} />;
        default:
          return null;
      }
    }, [codeLanguage, props.codeText, props.options]);

    const ordinary = (
      <OrdinaryCodeHighlight
        code={block.text}
        language={usedCodeLanguage}
        fileName={usedFileName}
        fontSize={fontSize}
        defaultExpanded={defaultExpanded}
        expandLabel={labels.expand}
        collapseLabel={labels.collapse}
      />
    );
    return isSpecialCodeBlock ? (
      specialCodeBlockContent
    ) : (
      <RawCodeContext.Provider value={props.codeText}>
        <LabelsContext.Provider value={labels}>
          {highlighter ? (
            <InjectedCodeHighlight
              input={{
                adapter: highlighter,
                code: block.text,
                language: codeLanguage,
                colorScheme: colorScheme === 'dark' ? 'dark' : 'light',
                generation: block.generation,
                streaming,
              }}
            >
              {ordinary}
            </InjectedCodeHighlight>
          ) : (
            ordinary
          )}
        </LabelsContext.Provider>
      </RawCodeContext.Provider>
    );
  }
);

MantineAIMPreCode.displayName = 'MantineAIMPreCode';

export default MantineAIMPreCode;

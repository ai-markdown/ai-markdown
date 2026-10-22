/**
 * Mantine-specific type definitions and defaults: the `codeBlock` behavior
 * group and the metadata extension point.
 *
 * @module defs
 */

import { AIMarkdownMetadata } from '@ai-markdown/react';
import {
  defaultCodeBlockLabels,
  defaultDiagramLabels,
  type CodeBlockLabels,
  type CodeBlockOptions,
  type CodeLanguageResolver,
  type DiagramLabels,
  type DiagramEngineLoader,
  type LabelsOption,
} from '@ai-markdown/core/components';

/**
 * The language names code blocks are handed to the highlighter in. A fence's
 * language as the model wrote it (`objc`, `vue`, `txt`) and a detected language
 * are both translated to these names. Mantine's adapters take different names
 * for some languages, and the renderer cannot see which adapter the
 * `CodeHighlightAdapterProvider` holds, so the `codeBlock` group says it.
 */
export { CodeLanguageFormat as MantineLanguageFormat } from '@ai-markdown/core/components';
import { CodeLanguageFormat as MantineLanguageFormat } from '@ai-markdown/core/components';

/**
 * Code block rendering options (the mantine `codeBlock` behavior group).
 *
 * v2 transport: passed as the flat `codeBlock` prop on `MantineAIMarkdown`
 * (group value replaces atomically) and read through
 * `useMantineCodeBlockOptions()`, which applies the defaults below inside
 * the hook — the single place defaults live at read time.
 */
export interface MantineCodeBlockOptions extends Omit<CodeBlockOptions, 'labels'> {
  /**
   * Whether code blocks start in their expanded state.
   * When `false`, long code blocks are collapsed with an expand button.
   *
   * @default true
   */
  defaultExpanded: boolean;

  /**
   * Whether to identify the language of code blocks that lack an explicit
   * language annotation, with `@ai-markdown/code-language-detector`. The
   * detector abstains rather than guess, so a block it cannot place stays
   * plaintext with an "unknown" label. No further setup: it is a dependency
   * of this package and runs synchronously, server rendering included. Set
   * `false` to render every unlabelled block as plaintext.
   *
   * @default true
   */
  autoDetectUnknownLanguage: boolean;
  /**
   * The names languages are passed to the highlighter in; match it to the
   * adapter in your `CodeHighlightAdapterProvider`. Applies to a language
   * written on the fence (` ```objc ` reaches highlight.js as `objectivec`)
   * and to a detected one. The tab label keeps the name as written, or the
   * detected language's own name. An unrecognised value falls back to the
   * default.
   *
   * @default MantineLanguageFormat.HighlightJs
   */
  languageFormat?: CodeLanguageResolver;
  /** Format JSON for display without changing numeric literals. @default true */
  formatJson?: boolean;
  /** Expand string values containing JSON objects/arrays for display. @default true */
  expandNestedJson?: boolean;
  /** Coalesce appended code display updates while streaming. Completion,
   * replacement and language changes update immediately; copy uses latest
   * source. Set 0 for every update. @default 50 */
  highlightIntervalMs?: number;
  /** Shortest time between two mermaid render attempts of the same block
   * while streaming; the final source is always rendered once streaming
   * ends. Separate from `highlightIntervalMs` because a mermaid render lays
   * the diagram out synchronously (tens to hundreds of milliseconds) and
   * most streamed prefixes fail to parse anyway, so a much longer interval
   * is appropriate. Set 0 to attempt every update. @default 300 */
  mermaidIntervalMs?: number;
  /** Optional renderer loader; omission keeps Mermaid. */
  mermaidEngine?: DiagramEngineLoader | false;
  /** Fall back only for a known unsupported diagram type. */
  mermaidFallback?: boolean;
  /** Text of the code block, as overrides of the English defaults. A function
   * is read on every render, so it can follow the application's own i18n. */
  labels?: LabelsOption<MantineCodeBlockLabels>;
  /** Text of the Mermaid diagram block, as overrides of the English defaults. */
  mermaidLabels?: LabelsOption<MantineMermaidLabels>;
}

/** Text of the Mantine code block. It uses the copy and the expand entries;
 * the rest label the source and copy shell around a custom language renderer. */
export interface MantineCodeBlockLabels extends CodeBlockLabels {
  copyTooltip: string;
  copiedTooltip: string;
}
export const defaultMantineCodeBlockLabels: Readonly<MantineCodeBlockLabels> = Object.freeze({
  ...defaultCodeBlockLabels,
  // Mantine's own wording for its expand control.
  expand: 'Expand code',
  collapse: 'Collapse code',
  copyTooltip: 'Copy',
  copiedTooltip: 'Copied',
});

/** Text of the Mantine Mermaid block. A tooltip and the accessible name of its button are separate entries. */
export interface MantineMermaidLabels extends Pick<DiagramLabels, 'renderFailed' | 'tooLarge'> {
  /** Optional additions preserve existing complete label objects. */
  loadFailed?: string;
  retry?: string;
  /** Tab title of the source shown with an error. */
  errorTitle: string;
  render: string;
  renderTooltip: string;
  openInNewWindow: string;
  openInNewWindowTooltip: string;
  showCode: string;
  showCodeTooltip: string;
  copy: string;
  copied: string;
  copyTooltip: string;
  copiedTooltip: string;
  /** The expand control of the source view. */
  expand: string;
  collapse: string;
}
export const defaultMantineMermaidLabels: Readonly<Required<MantineMermaidLabels>> = Object.freeze({
  loadFailed: defaultDiagramLabels.loadFailed,
  retry: defaultDiagramLabels.retry,
  renderFailed: defaultDiagramLabels.renderFailed,
  tooLarge: defaultDiagramLabels.tooLarge,
  errorTitle: 'Mermaid Render Error',
  render: 'Render Mermaid diagram',
  renderTooltip: 'Render Mermaid',
  openInNewWindow: 'Open Mermaid diagram in a new window',
  openInNewWindowTooltip: 'Open in new window',
  showCode: 'Show Mermaid code',
  showCodeTooltip: 'Show Mermaid Code',
  copy: 'Copy Mermaid code',
  copied: 'Mermaid code copied',
  copyTooltip: 'Copy',
  copiedTooltip: 'Copied',
  expand: 'Expand code',
  collapse: 'Collapse code',
});

/** {@link MantineCodeBlockOptions} with every default applied; the label overrides stay as given. */
export type ResolvedMantineCodeBlockOptions = Required<
  Omit<MantineCodeBlockOptions, 'labels' | 'mermaidLabels' | 'mermaidEngine' | 'highlighter'>
> &
  Pick<MantineCodeBlockOptions, 'labels' | 'mermaidLabels' | 'mermaidEngine' | 'highlighter'>;

/** Shipped defaults for the `codeBlock` behavior group. */
export const defaultMantineCodeBlockOptions: Readonly<MantineCodeBlockOptions> = Object.freeze({
  defaultExpanded: true,
  autoDetectUnknownLanguage: true,
  languageFormat: MantineLanguageFormat.HighlightJs,
  formatJson: true,
  expandNestedJson: true,
  highlightIntervalMs: 50,
  mermaidIntervalMs: 300,
  mermaidFallback: true,
});

/**
 * Metadata type for the Mantine integration.
 *
 * Currently identical to {@link AIMarkdownMetadata}. Exists as an extension point
 * so that consumers can augment metadata in Mantine-specific wrappers without
 * needing to reference the core type directly.
 */
export interface MantineAIMarkdownMetadata extends AIMarkdownMetadata {}

/**
 * Mantine-specific type definitions and defaults: the `codeBlock` behavior
 * group and the metadata extension point.
 *
 * @module defs
 */

import { AIMarkdownMetadata } from '@ai-markdown/react';

/**
 * The language names code blocks are handed to the highlighter in. A fence's
 * language as the model wrote it (`objc`, `vue`, `txt`) and a detected language
 * are both translated to these names. Mantine's adapters take different names
 * for some languages, and the renderer cannot see which adapter the
 * `CodeHighlightAdapterProvider` holds, so the `codeBlock` group says it.
 */
export enum MantineLanguageFormat {
  /**
   * highlight.js names, for `createHighlightJsAdapter`: `objectivec`,
   * `vbnet`, `x86asm`, and `xml` for HTML, Vue and Svelte (its xml grammar
   * highlights `<script>` and `<style>` blocks as sub-languages).
   */
  HighlightJs = 'highlight-js',
  /** Shiki language names, for `createShikiAdapter`: `objective-c`, `make`, `text` for plain text. */
  Shiki = 'shiki',
}

/**
 * Code block rendering options (the mantine `codeBlock` behavior group).
 *
 * v2 transport: passed as the flat `codeBlock` prop on `MantineAIMarkdown`
 * (group value replaces atomically) and read through
 * `useMantineCodeBlockOptions()`, which applies the defaults below inside
 * the hook — the single place defaults live at read time.
 */
export interface MantineCodeBlockOptions {
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
  languageFormat?: MantineLanguageFormat;
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
}

/** Shipped defaults for the `codeBlock` behavior group. */
export const defaultMantineCodeBlockOptions: Readonly<MantineCodeBlockOptions> = Object.freeze({
  defaultExpanded: true,
  autoDetectUnknownLanguage: true,
  languageFormat: MantineLanguageFormat.HighlightJs,
  formatJson: true,
  expandNestedJson: true,
  highlightIntervalMs: 50,
  mermaidIntervalMs: 300,
});

/**
 * Metadata type for the Mantine integration.
 *
 * Currently identical to {@link AIMarkdownMetadata}. Exists as an extension point
 * so that consumers can augment metadata in Mantine-specific wrappers without
 * needing to reference the core type directly.
 */
export interface MantineAIMarkdownMetadata extends AIMarkdownMetadata {}

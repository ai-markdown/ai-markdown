/**
 * Mantine-specific type definitions and defaults: the `codeBlock` behavior
 * group and the metadata extension point.
 *
 * @module defs
 */

import { AIMarkdownMetadata } from '@ai-markdown/react';

/**
 * The part of highlight.js that language auto-detection uses. The root
 * `highlight.js` export satisfies it, and so does a `highlight.js/lib/core`
 * instance with only the consumer's languages registered.
 */
export interface MantineHighlightJsLike {
  highlightAuto: (code: string) => { language?: string };
}

/**
 * Where auto-detection gets highlight.js from: the instance itself (the one
 * already passed to `createHighlightJsAdapter`), or a loader that imports it
 * on demand (`() => import('highlight.js')`; the module namespace is
 * unwrapped). Keep a loader at module scope so its identity is stable — the
 * `codeBlock` group is compared by value, and a new function on every render
 * counts as a new group.
 */
export type MantineHighlightJsSource =
  MantineHighlightJsLike | (() => Promise<MantineHighlightJsLike | { default: MantineHighlightJsLike }>);

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
   * When `true`, uses `highlight.js` auto-detection to determine the language
   * of code blocks that lack an explicit language annotation. Needs
   * {@link MantineCodeBlockOptions.highlightJs}; without it the option is
   * inert and a warning is logged once.
   *
   * @default false
   */
  autoDetectUnknownLanguage: boolean;
  /**
   * highlight.js for auto-detection: an instance or a loader. The package
   * does not import `highlight.js` itself, so a consumer that never turns on
   * auto-detection (or highlights with another adapter) need not install it.
   *
   * @default null
   */
  highlightJs?: MantineHighlightJsSource | null;
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
  autoDetectUnknownLanguage: false,
  highlightJs: null,
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

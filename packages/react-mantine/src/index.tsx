/**
 * Public API surface for `@ai-markdown/react-mantine`.
 *
 * Re-exports the Mantine-integrated AI markdown component, its supporting
 * sub-components, extended types, default configuration, and typed hooks.
 *
 * @packageDocumentation
 */

// Every component here reads React context and runs effects, so the whole
// package is a client module. The directive has to sit on the ENTRY file:
// tsup/esbuild only keeps a directive from the entry, and the ones in
// PreCode.tsx / MermaidCode/index.tsx were dropped from the bundle (3.0.2
// review: dist/index.js shipped without it, and RSC consumers importing the
// default export from a server component got the "hooks in a server
// component" error). assert-dist-clean.mjs checks both dist entries.
'use client';

// --- Components ---

/** Props for the main {@link MantineAIMarkdown} component. */
export type { MantineAIMarkdownProps } from './MantineAIMarkdown';

/** Main component -- Mantine-integrated AI markdown renderer (default export). */
export { default } from './MantineAIMarkdown';

/** Mantine-themed typography wrapper used by default inside {@link MantineAIMarkdown}. */
export { default as MantineAIMarkdownTypography } from './components/typography/MantineTypography';

/** Default extra styles wrapper providing Mantine-compatible CSS scoping and overrides. */
export { default as MantineAIMDefaultExtraStyles } from './components/extra-styles/DefaultExtraStyles';

// --- Types, config, and hooks ---

/** Extended render configuration and metadata types for the Mantine integration. */
export type { MantineAIMarkdownMetadata, MantineCodeBlockOptions } from './defs';

// ── v2 surface (props-api v2) ───────────────────────────────────────────────

/** Shipped defaults of the `codeBlock` behavior group. */
export { defaultMantineCodeBlockOptions } from './defs';

/** Narrow hook for the `codeBlock` behavior group — the single assertion site. */
export { useMantineCodeBlockOptions } from './hooks/useMantineCodeBlockOptions';

/** Optional eager loading of the on-demand code-block assets (mermaid, highlight.js). */
export { preloadMantineCodeAssets } from './components/customized/PreCode';

/** Widened behaviors factory (core fields + mantine's `codeBlock` group). */
export { defineMantineBehaviors } from './define';
export type { MantineBehaviorProps } from './define';

/** Typed hook for accessing metadata within the Mantine AI markdown tree. */
export { useMantineAIMarkdownMetadata } from './hooks/useMantineAIMarkdownMetadata';

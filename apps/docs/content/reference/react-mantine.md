# Mantine reference

`@ai-markdown/react-mantine` adds Mantine presentation to the React renderer: theme-aware typography, expandable highlighted code, source-preserving JSON formatting, and Mermaid diagrams. Its `MantineAIMarkdown` wrapper accepts the React adapter's props and adds one `codeBlock` behavior group.

Parsing, URL policy, metadata, and cross-chunk references remain engine/React adapter responsibilities. The integration supplies default slots and a `pre` renderer; caller overrides take precedence. Set up the stylesheet imports and both providers in the quick start before using the code-block features. If you replace `pre`, your component takes over the formatting, copy, highlighting, and diagram behavior described here.

> **Upgrading from 1.x?** v2.0.0 removes the 1.x object-based `config` channel — the Mantine code-block options move to a flat `codeBlock` prop, and the render-state hook is replaced by narrow hooks plus `useMantineCodeBlockOptions()`. See the [migration guide](https://ai-markdown.github.io/docs/guides/migrating-to-v2/).

## What It Adds to the React Adapter

- **Mantine typography** -- markdown content is wrapped in Mantine's `<Typography>` so it inherits the active theme's font family, line height, and color tokens
- **Syntax highlighting** -- code blocks render via `@mantine/code-highlight` with the adapter you provide (highlight.js or Shiki), with language-labelled tabs, expand/collapse, and optional language detection for unlabelled blocks through `@ai-markdown/code-language-detector`
- **Mermaid diagrams** -- fenced `mermaid` code blocks render as interactive SVG diagrams with dark/light theme support, source toggle, copy, and open-in-new-window
- **JSON pretty-print** -- fenced `json` code blocks are validated and formatted with 2-space indent while retaining numeric tokens, duplicate keys, and key order; string values that are themselves JSON documents (an object or array — the tool-call transcript shape) are expanded too, primitive-looking strings (`"true"`, `"123"`) are left as written
- **Automatic color scheme** -- follows the active `MantineProvider`; under `auto` the system preference is read on the first client frame (server output is light), and the result is forwarded to the core renderer when no explicit `colorScheme` prop is supplied
- **Mantine-scoped CSS** -- extra-styles wrapper overrides Mantine spacing/font-size custom properties to use relative `em` units, giving consistent scaling at any base font size

All React adapter features (GFM, LaTeX math, CJK support, streaming, metadata context, content preprocessors, custom components, cross-chunk coordination via `<AIMarkdownDocuments>`) are inherited unchanged from `@ai-markdown/react`. See the [React reference](react.md) for the base API.

## Package family

| Package                                                                                                    | Role                                                                                                                                                          | Version policy                                            |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [`@ai-markdown/core`](https://www.npmjs.com/package/@ai-markdown/core)                                     | Framework-independent sessions, block planning, contributions and smooth coordination                                                                         | Release train; exact engine dependency                    |
| [`@ai-markdown/react`](https://www.npmjs.com/package/@ai-markdown/react)                                   | The React renderer — `<AIMarkdown>`, `<AIMarkdownSmoothStream>`, `<AIMarkdownDocuments>`, hooks, providers                                                    | Release train                                             |
| [`@ai-markdown/vue`](https://www.npmjs.com/package/@ai-markdown/vue)                                       | Vue 3.5 renderer — components, scoped slots, SSR/hydration and smooth composables                                                                             | Release train; exact core and engine dependencies         |
| [`@ai-markdown/react-mantine`](https://www.npmjs.com/package/@ai-markdown/react-mantine)                   | Mantine UI bindings — themed typography, code-highlight tabs, Mermaid, color-scheme wiring                                                                    | Release train; compatible React 3.x peer                  |
| [`@ai-markdown/engine`](https://www.npmjs.com/package/@ai-markdown/engine)                                 | Framework-agnostic engine — incremental parsing, LaTeX preprocessing, plugin pipeline, cross-chunk registry                                                   | Release train; pinned exactly by shared core and adapters |
| [`@ai-markdown/remark-mark-highlight`](https://www.npmjs.com/package/@ai-markdown/remark-mark-highlight)   | remark plugin for `==mark==` highlight syntax                                                                                                                 | Independent semver                                        |
| [`@ai-markdown/code-language-detector`](https://www.npmjs.com/package/@ai-markdown/code-language-detector) | Heuristic language detection for unlabelled code blocks, and fence language names mapped to Shiki or highlight.js names; a regular dependency of this package | Independent semver                                        |

## Compatibility

|                |                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| Mantine        | `@mantine/core` ^9 and `@mantine/code-highlight` ^9 (peer dependencies)                                  |
| highlight.js   | ^11.11.2 (optional peer; never imported by the package — needed only for Mantine's highlight.js adapter) |
| React          | ^19.0.0                                                                                                  |
| Node           | `^20.19.0 \|\| >=22.12.0` (`engines.node`)                                                               |
| Module formats | ESM and CJS with types; the compiled stylesheet is exported as `@ai-markdown/react-mantine/styles.css`   |
| React adapter  | [Peer range below](#peer-dependencies); upgrade both packages together                                   |

## Installation

```bash
# npm
npm install @ai-markdown/react-mantine @ai-markdown/react

# pnpm
pnpm add @ai-markdown/react-mantine @ai-markdown/react

# yarn
yarn add @ai-markdown/react-mantine @ai-markdown/react
```

The commands above add the integration and its React peer. For a new React application, also install the UI peers and KaTeX for the math example:

```bash
pnpm add react@^19 react-dom@^19 @mantine/core@^9 @mantine/code-highlight@^9 highlight.js@^11.11.2 katex
```

Mantine uses the React adapter and does not depend directly on shared core. Vue applications use the [Vue adapter](vue.md); this integration provides React components only.

### Peer Dependencies

```json
{
  "react": "^19.0.0",
  "react-dom": "^19.0.0",
  "@ai-markdown/react": "^3.2.0",
  "@mantine/core": "^9.0.0",
  "@mantine/code-highlight": "^9.0.0",
  "highlight.js": "^11.11.2"
}
```

`highlight.js` is declared optional (`peerDependenciesMeta`). The package contains no import of it, so a build without it succeeds; install it only for Mantine's highlight.js adapter. Language auto-detection does not use it: it runs on `@ai-markdown/code-language-detector`, which is a regular dependency and installs with the package.

### CSS Dependencies

Import the required stylesheets in your application entry point:

```tsx
// Mantine core styles (required)
import '@mantine/core/styles.css';

// Mantine code highlight styles (required for code blocks)
import '@mantine/code-highlight/styles.css';

// Mantine AI Markdown styles (required for extra styles + Mermaid)
import '@ai-markdown/react-mantine/styles.css';

// KaTeX styles (required for LaTeX math rendering)
import 'katex/dist/katex.min.css';
```

## Quick Start

```tsx
import { MantineProvider } from '@mantine/core';
import { CodeHighlightAdapterProvider, createHighlightJsAdapter } from '@mantine/code-highlight';
import hljs from 'highlight.js';
import MantineAIMarkdown from '@ai-markdown/react-mantine';

const highlightJsAdapter = createHighlightJsAdapter(hljs);

function App() {
  return (
    <MantineProvider>
      <CodeHighlightAdapterProvider adapter={highlightJsAdapter}>
        <MantineAIMarkdown content="Hello **world**! Math: $E = mc^2$" />
      </CodeHighlightAdapterProvider>
    </MantineProvider>
  );
}
```

### Streaming Example

```tsx
function StreamingChat({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  return <MantineAIMarkdown content={content} streaming={isStreaming} />;
}
```

## Props API Reference

### `MantineAIMarkdownProps<TMetadata>`

`MantineAIMarkdownProps<TMetadata>` extends `AIMarkdownProps<TMetadata>` -- every React adapter prop (`enginePlugins`, `blockMemo`, `incrementalParse`, `preserveOrphanReferences`, `streamingCursor`, …) is supported, plus the Mantine-specific `codeBlock` prop. The table below lists the props with a Mantine-specific default override or addition (props not listed here inherit React adapter defaults unchanged — see the [React props reference](../guides/api/react-props.md)).

| Prop               | Type                               | Default                          | Description                                                                                                                                                                                       |
| ------------------ | ---------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `colorScheme`      | `AIMarkdownColorScheme`            | Auto-detected                    | Color scheme. When omitted, follows the `MantineProvider`: its `light`/`dark`, or under `auto` the system preference (light on the server).                                                       |
| `customComponents` | `AIMarkdownCustomComponents`       | Mantine defaults                 | Component overrides, merged with Mantine's built-in `<pre>` handler. Caller overrides take precedence -- including `pre` here disables Mantine's code-block features.                             |
| `Typography`       | `AIMarkdownTypographyComponent`    | `MantineAIMarkdownTypography`    | Typography wrapper component.                                                                                                                                                                     |
| `ExtraStyles`      | `AIMarkdownExtraStylesComponent`   | `MantineAIMDefaultExtraStyles`   | Extra style wrapper rendered between typography and content.                                                                                                                                      |
| `codeBlock`        | `Partial<MantineCodeBlockOptions>` | `defaultMantineCodeBlockOptions` | Code-block behavior group (Mantine-specific). The group value replaces atomically; omitted fields resolve to the shipped defaults inside `useMantineCodeBlockOptions()`. `null` counts as absent. |

## Configuration

The `codeBlock` prop transports a partial behavior group. An absent or null group contributes no `codeBlock` key, so an outer `AIMarkdownBehaviorsProvider` can supply it. A present group replaces an outer group atomically: `{ defaultExpanded: false }` does not inherit the outer group's other fields. The narrow hook fills omitted fields from package defaults.

### `codeBlock` (`Partial<MantineCodeBlockOptions>`)

| Field                       | Type                    | Default                             | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------- | ----------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `defaultExpanded`           | `boolean`               | `true`                              | Initial expanded state; false starts long blocks collapsed with an expand action                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `autoDetectUnknownLanguage` | `boolean`               | `false`                             | Identify an unannotated block's language with `@ai-markdown/code-language-detector`, synchronously during render (server rendering included). A block the detector abstains on stays plaintext labelled "unknown"; the detector never overrides an explicit fence language                                                                                                                                                                                                                             |
| `languageFormat`            | `MantineLanguageFormat` | `MantineLanguageFormat.HighlightJs` | The names languages are handed to the highlighter in; match it to the adapter in your `CodeHighlightAdapterProvider` (`HighlightJs` or `Shiki`). Applies to a language written on the fence and to a detected one: under highlight.js ` ```objc ` is highlighted as `objectivec` and ` ```txt ` as `plaintext`, and under Shiki ` ```Makefile ` as `make`. The tab label keeps the name as written (lower-cased), or the detected language's own name. An unrecognised value falls back to the default |
| `formatJson`                | `boolean`               | `true`                              | Format valid JSON for display while preserving numeric tokens, duplicate keys, and order                                                                                                                                                                                                                                                                                                                                                                                                               |
| `expandNestedJson`          | `boolean`               | `true`                              | While formatting, expand string values that contain JSON objects or arrays                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `highlightIntervalMs`       | `number`                | `50`                                | Coalesce appended code display updates during streaming; zero displays every update                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `mermaidIntervalMs`         | `number`                | `300`                               | Shortest time between two mermaid render attempts of one block while streaming; the final source renders once streaming ends; zero attempts every update                                                                                                                                                                                                                                                                                                                                               |

Explicit undefined fields retain their shipped defaults. Both intervals must be finite and non-negative; invalid values fall back to the defaults (50 ms and 300 ms). Do not assume that null is a supported value for individual fields merely because null at the group boundary counts as absent: no individual field accepts `null`.

### Example: Collapsed Code Blocks

```tsx
<MantineAIMarkdown content={markdown} codeBlock={{ defaultExpanded: false }} />
```

The omitted options resolve to the defaults in the table. To keep JSON structure exactly as written apart from whitespace, set `expandNestedJson: false`; to display the original JSON text, set `formatJson: false`. Neither setting changes what the copy button copies.

For a stable reusable fragment, use the widened factory:

```tsx
import { defineMantineBehaviors } from '@ai-markdown/react-mantine';

const BEHAVIORS = defineMantineBehaviors({
  blockMemo: true,
  codeBlock: { defaultExpanded: false, expandNestedJson: false },
});

<MantineAIMarkdown content={markdown} {...BEHAVIORS} streaming={isStreaming} />;
```

The factory provides types and shallow freezing, not default resolution or recursive merging. Runtime props placed after a spread win in ordinary JSX order. Behavior-group defaults are applied only by `useMantineCodeBlockOptions()`, so custom code renderers should read that hook rather than reproduce the table locally.

## Hooks

### `useMantineCodeBlockOptions()`

Narrow hook for the `codeBlock` behavior group -- the single place the group's type assertion and defaults live. Returns `Required<MantineCodeBlockOptions>`: the caller-passed group merged over `defaultMantineCodeBlockOptions`.

```tsx
import { useMantineCodeBlockOptions } from '@ai-markdown/react-mantine';

function MyCodeBlock() {
  const { defaultExpanded, autoDetectUnknownLanguage } = useMantineCodeBlockOptions();
  // ...
}
```

For everything else (streaming state, theme, document ids, core behavior switches), use the React adapter's narrow hooks directly -- `useAIMarkdownState()`, `useAIMarkdownTheme()`, `useAIMarkdownDocument()`, `useAIMarkdownBehaviors()` -- or the aggregate `useAIMarkdown()` for low-frequency components. See the [React hooks reference](../guides/api/react-hooks.md#hooks).

```tsx
import { useAIMarkdownState, useAIMarkdownTheme } from '@ai-markdown/react';
import { useMantineCodeBlockOptions } from '@ai-markdown/react-mantine';

function MyCodeBlock() {
  const { streaming } = useAIMarkdownState();
  const { colorScheme } = useAIMarkdownTheme();
  const { defaultExpanded } = useMantineCodeBlockOptions();
  // ...
}
```

### `useMantineAIMarkdownMetadata<TMetadata>()`

Typed wrapper around the core `useAIMarkdownMetadata`, defaulting `TMetadata` to `MantineAIMarkdownMetadata`. Metadata lives in a separate React context from render state, so metadata updates do not cause re-renders in components that only consume render state.

```tsx
import { useMantineAIMarkdownMetadata } from '@ai-markdown/react-mantine';

function MyComponent() {
  const metadata = useMantineAIMarkdownMetadata<{ messageId: string }>();
  // ...
}
```

## Typography and Styling

### `MantineAIMarkdownTypography`

Default typography wrapper. Renders Mantine's `<Typography>` with `w="100%"` and `fz={fontSize}`, so all rendered markdown inherits the active theme's font family, line height, and color tokens. Receives the `style` prop carrying the React adapter's CSS custom properties (`--aim-font-size-root`) and forwards it onto the Mantine root.

Replace it via the `Typography` prop when you need different theming, but consider extending rather than replacing -- the wrapper is intentionally minimal.

### `MantineAIMDefaultExtraStyles`

Default `ExtraStyles` wrapper. Renders a `<div className="aim-mantine-extra-styles">` that activates the package's scoped CSS overrides:

- Mantine spacing and font-size CSS custom properties switched to relative `em` units (consistent scaling at any base font size)
- Heading, list, paragraph, blockquote, and inline-code spacing tuned for AI-generated markdown
- Definition list layout

Activated by importing `@ai-markdown/react-mantine/styles.css` in your app entry. Pass a custom `ExtraStyles` prop to bypass these defaults.

## Code Block Rendering

<span id="code-highlight-adapter"></span>
<span id="language-auto-detection"></span>
<span id="preloading-the-on-demand-assets"></span>

See [Code Block Rendering](../guides/mantine-code-blocks.md#code-block-rendering) for the rendering behavior and configuration examples.

## Mermaid Diagrams

See [Mermaid Diagrams](../guides/mantine-code-blocks.md#mermaid-diagrams) for the rendering behavior and configuration examples.

## Color Scheme Integration

`MantineAIMarkdown` resolves its color scheme in this order:

1. Explicit non-null `colorScheme` prop
   (undefined uses the wrapper default; runtime null reaches the React adapter’s fallback)
2. The active `MantineProvider`'s scheme: `light` or `dark` as set, or under `auto` the system `prefers-color-scheme` query, read on the first client frame through `useSyncExternalStore` (server output is light; hydration re-renders to the client value without a mismatch). Mantine's own `useComputedColorScheme` is not used because it seeds `auto` with its default and reads the query in an effect, which committed a light frame first on dark systems.

```tsx
// Follows Mantine's color scheme automatically
<MantineAIMarkdown content={markdown} />

// Explicit override
<MantineAIMarkdown content={markdown} colorScheme="dark" />
```

The resolved color scheme is forwarded to:

- The core `<AIMarkdown>` for typography theming
- Mermaid diagram rendering (dark / base theme selection)
- The extra-styles wrapper for color-aware CSS

## Custom Components

Caller-provided `customComponents` are merged on top of the Mantine defaults; caller overrides take precedence:

```tsx
import MantineAIMarkdown from '@ai-markdown/react-mantine';
import type { AIMarkdownCustomComponents } from '@ai-markdown/react';

const customComponents: AIMarkdownCustomComponents = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  img: ({ src, alt }) => <img src={src} alt={alt} loading="lazy" />,
};

<MantineAIMarkdown content={markdown} customComponents={customComponents} />;
```

To override the default `<pre>` handler (and lose built-in code highlighting, Mermaid, and JSON pretty-print support), include `pre` in your custom components.

## Cross-Chunk Coordination

`<MantineAIMarkdown>` participates in cross-chunk coordination identically to `<AIMarkdown>`. Wrap multiple chunks in `<AIMarkdownDocuments>` (from `@ai-markdown/react`) and share `documentId` to coordinate footnotes, link references, and image references across chunks:

```tsx
import { AIMarkdownDocuments } from '@ai-markdown/react';
import MantineAIMarkdown from '@ai-markdown/react-mantine';

<AIMarkdownDocuments>
  {message.chunks.map((c, i) => (
    <MantineAIMarkdown key={i} content={c} documentId={message.id} />
  ))}
</AIMarkdownDocuments>;
```

See the [React reference's cross-chunk section](react.md#cross-chunk-coordination) for the full `<AIMarkdownDocuments>` API and `useDocumentRegistry` hook.

## Smooth Streaming

Typewriter pacing composes with `<MantineAIMarkdown>` through the React adapter's `useSmoothStream` hook — its result is props-shaped, so it spreads straight in:

```tsx
import { useSmoothStream } from '@ai-markdown/react';
import MantineAIMarkdown from '@ai-markdown/react-mantine';

function ChatMessage({ markdown, pending }: { markdown: string; pending: boolean }) {
  const smooth = useSmoothStream({ content: markdown, streaming: pending, pacing: 'balanced' });
  return <MantineAIMarkdown {...smooth} />;
}
```

For multi-chunk documents under `<AIMarkdownDocuments>`, swap in `useDocumentSmoothStream` and chunks sharing a `documentId` reveal turn-by-turn (one typewriter, one cursor). Pass the SAME id to the hook and the component — the hook can't cross-check the two:

```tsx
import { useDocumentSmoothStream } from '@ai-markdown/react';

function ChatChunk({ id, markdown, pending }: { id: string; markdown: string; pending: boolean }) {
  const smooth = useDocumentSmoothStream({ documentId: id, content: markdown, streaming: pending });
  return <MantineAIMarkdown {...smooth} documentId={id} />;
}
```

See [apps/docs/content/guides/smooth-streaming.md](https://ai-markdown.github.io/docs/guides/smooth-streaming/) for the pacing model, presets, and footguns.

## Architecture Overview

```text
<MantineAIMarkdown>
  └─ wraps <AIMarkdown> with Mantine defaults:
       Typography          = MantineAIMarkdownTypography      (Mantine <Typography>)
       ExtraStyles         = MantineAIMDefaultExtraStyles     (aim-mantine-extra-styles scope)
       customComponents.pre = MantineAIMPreCode               (CodeHighlight + Mermaid + JSON pretty-print)
       colorScheme         = provider scheme / system query    (when not overridden)
```

Caller-provided `Typography`, `ExtraStyles`, and `customComponents` props override the Mantine defaults at their respective slots. Inside the wrapped `<AIMarkdown>`, the rest of the render pipeline (the five per-system contexts, content preprocessors, remark/rehype plugin chain) is identical to the standalone React adapter -- see the [React architecture overview](react.md#architecture-overview).

## Exported API

### Default Export

- `MantineAIMarkdown` -- the main component (memoized)

### Components

- `MantineAIMarkdownTypography` -- Mantine-themed typography wrapper
- `MantineAIMDefaultExtraStyles` -- default extra styles wrapper with Mantine CSS scoping

### Types

- `MantineAIMarkdownProps`
- `MantineAIMarkdownMetadata`
- `MantineCodeBlockOptions` -- the `codeBlock` group shape
- `MantineBehaviorProps` -- input type of `defineMantineBehaviors`

### Constants

- `defaultMantineCodeBlockOptions` -- shipped defaults of the `codeBlock` behavior group (frozen)

### Enums

- `MantineLanguageFormat` -- the value of `codeBlock.languageFormat`: `HighlightJs` (`'highlight-js'`, the default) or `Shiki` (`'shiki'`)

### Asset helpers

- `preloadMantineCodeAssets(): Promise<void>` — starts the lazy Mermaid import; takes no arguments; idempotent, with renderer fallback if loading fails

### Factories

- `defineMantineBehaviors()` -- widened behaviors factory (core behavior fields + `codeBlock`); identity + types + `Object.freeze`, zero logic

### Hooks

- `useMantineCodeBlockOptions()` -- typed access to the `codeBlock` group with defaults applied
- `useMantineAIMarkdownMetadata<TMetadata>()` -- typed metadata access

## Documentation

Everything below applies unchanged through `<MantineAIMarkdown>`; the mantine-specific parts are the sections above.

| Guide                                                                                                                                                                                                                                             | What it covers                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [Streaming & performance](https://ai-markdown.github.io/docs/guides/streaming-and-performance/)                                                                                                                                                   | Block memoization, incremental (prefix-freeze) parsing, what to pass while tokens arrive |
| [Smooth streaming](https://ai-markdown.github.io/docs/guides/smooth-streaming/)                                                                                                                                                                   | `<AIMarkdownSmoothStream>` typewriter reveal, pacing presets, document turn-taking       |
| [Streaming cursor](https://ai-markdown.github.io/docs/guides/streaming-cursor/)                                                                                                                                                                   | The overlay cursor that tracks the streaming tail                                        |
| [Cross-chunk coordination](https://ai-markdown.github.io/docs/guides/cross-chunk-coordination/)                                                                                                                                                   | `<AIMarkdownDocuments>`, footnotes and link references across chunks, the registry       |
| [URL sanitization & custom schemes](https://ai-markdown.github.io/docs/guides/url-sanitization/)                                                                                                                                                  | The two-gate model, `urlTransform`, `extendSanitizeSchema`                               |
| [Custom components](https://ai-markdown.github.io/docs/guides/custom-components/) · [Custom typography](https://ai-markdown.github.io/docs/guides/custom-typography/) · [Design tokens](https://ai-markdown.github.io/docs/guides/design-tokens/) | Swapping renderers, theming, the `--aim-*` variables                                     |
| [CJK typography](https://ai-markdown.github.io/docs/guides/cjk-typography/)                                                                                                                                                                       | Line breaking, spacing, pangu                                                            |
| [Metadata context](https://ai-markdown.github.io/docs/guides/metadata-context/) · [TypeScript generics](https://ai-markdown.github.io/docs/guides/typescript-generics/)                                                                           | Passing typed metadata to custom components                                              |
| [Content preprocessors](https://ai-markdown.github.io/docs/guides/content-preprocessors/)                                                                                                                                                         | Rewriting the source before it parses                                                    |
| [Extending via subpackage](https://ai-markdown.github.io/docs/guides/extending-via-subpackage/)                                                                                                                                                   | Building your own UI-kit binding (the mantine package is the reference)                  |
| [Architecture](https://ai-markdown.github.io/docs/guides/architecture/) · [Benchmark](https://ai-markdown.github.io/docs/guides/benchmark/)                                                                                                       | How the packages fit together, measured numbers                                          |
| [Migrating to v2](https://ai-markdown.github.io/docs/guides/migrating-to-v2/) · [Release highlights](https://ai-markdown.github.io/docs/guides/release-highlights/)                                                                               | Old → new API mapping, what changed per version                                          |

## React Adapter

For base features, configuration options, content preprocessors, TypeScript generics, and architecture details, see the [React reference](react.md).

## Streaming code: source, display, and asynchronous work

See [Streaming code: source, display, and asynchronous work](../guides/mantine-code-blocks.md#streaming-code-source-display-and-asynchronous-work) for the rendering behavior and configuration examples.

## Verify an application setup

Check light and dark schemes, a known language, an unannotated block, JSON with a large numeric literal, a nested JSON string, and a Mermaid fence that is incomplete before becoming valid. Copy each source and compare its whitespace with the original. Then replace a block with different content of the same length, complete a stream during a pending highlight interval, and change the theme after a diagram has rendered.

For custom wrappers, test an outer behavior provider both with an absent `codeBlock` prop and a present partial group. For multiple logical chunks, use the same React `AIMarkdownDocuments` wrapper and explicit document ids; no Mantine-specific registry exists. Smooth presentation composes through the React adapter's hooks, whose returned streaming state includes the reveal drain.

See [`src/MantineAIMarkdown.tsx`](../../../../packages/react-mantine/src/MantineAIMarkdown.tsx) for wrapper precedence and [`src/defs.tsx`](../../../../packages/react-mantine/src/defs.tsx) for the authoritative group defaults. This reference describes the presentation layer; the [React reference](react.md) remains the reference for inherited parsing and coordination behavior.

## License

MIT

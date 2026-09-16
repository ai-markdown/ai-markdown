# React reference

React 19 application adapter. For Vue 3.5, use [`@ai-markdown/vue`](vue.md). For package selection, CSS setup and API differences, see [Getting started](https://ai-markdown.github.io/docs/guides/getting-started/).

> **Since 3.0.0:** React and Vue adapters share the public `@ai-markdown/core` and `@ai-markdown/engine` packages. See the [migration guide](https://ai-markdown.github.io/docs/guides/framework-transition/).

`@ai-markdown/react` renders accumulated Markdown strings in React. It combines GFM, KaTeX math, CJK delimiter handling, optional typography transforms, and a verified incremental parsing path for append-heavy content. Use it with the built-in CSS or supply your own typography and element components.

The React adapter owns the React lifecycle, context hooks, document coordination, and cached element construction. Its exact-version engine dependency owns syntax processing. Code fences remain code text in the React adapter; syntax highlighting, JSON presentation, and rendered Mermaid diagrams are supplied by the Mantine package or your custom `pre` component. Start with the installation and quick start, then use the API tables to make each customization explicit.

> **Upgrading from 1.x?** v2.0.0 removes the 1.x object-based `config` channel (and its integrator default channel) in favor of flat props, a sealed engine-plugin catalog, and five narrow hooks. See the [migration guide](https://ai-markdown.github.io/docs/guides/migrating-to-v2/) for the complete old → new mapping with before/after code.

## Features

- **GFM** -- tables, strikethrough, task lists, autolinks via `remark-gfm`
- **LaTeX math** -- inline and display math rendered with KaTeX; smart preprocessing handles currency `$` signs, bracket delimiters (`\[...\]`, `\(...\)`), pipe escaping, and mhchem commands
- **Emoji** -- shortcode support (`:smile:`) via `remark-emoji`
- **CJK-friendly** -- CJK-aware emphasis/strikethrough parsing, optional pangu spacing, and configurable fonts; source line breaks still become `<br>`
- **Extra syntax** -- highlight (`==text==`), definition lists
- **Display optimizations** -- SmartyPants typography, pangu CJK spacing, HTML comment removal
- **Streaming-aware** -- built-in `streaming` flag propagated via context for custom components
- **Smooth streaming** -- `AIMarkdownSmoothStream` shell (and the `useSmoothStream` hook beneath it) reveals bursty token chunks as a steady grapheme-by-grapheme typewriter; see [apps/docs/content/guides/smooth-streaming.md](https://ai-markdown.github.io/docs/guides/smooth-streaming/)
- **Customizable** -- swap typography, color scheme, individual markdown element renderers, and inject extra style wrappers
- **Metadata context** -- pass arbitrary data to deeply nested custom components without prop drilling, isolated from render state to avoid unnecessary re-renders
- **TypeScript** -- fully typed flat props plus a metadata generic (`AIMarkdownProps<TMetadata>`)

## Package family

| Package                                                                                                    | Role                                                                                                                                                     | Version policy                                            |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [`@ai-markdown/core`](https://www.npmjs.com/package/@ai-markdown/core)                                     | Framework-independent sessions, block planning, contributions and smooth coordination                                                                    | Release train; exact engine dependency                    |
| [`@ai-markdown/react`](https://www.npmjs.com/package/@ai-markdown/react)                                   | The React renderer — `<AIMarkdown>`, `<AIMarkdownSmoothStream>`, `<AIMarkdownDocuments>`, hooks, providers                                               | Release train                                             |
| [`@ai-markdown/vue`](https://www.npmjs.com/package/@ai-markdown/vue)                                       | Vue 3.5 renderer — components, scoped slots, SSR/hydration and smooth composables                                                                        | Release train; exact core and engine dependencies         |
| [`@ai-markdown/react-mantine`](https://www.npmjs.com/package/@ai-markdown/react-mantine)                   | Mantine UI bindings — themed typography, code-highlight tabs, Mermaid, color-scheme wiring                                                               | Release train; compatible React 3.x peer                  |
| [`@ai-markdown/engine`](https://www.npmjs.com/package/@ai-markdown/engine)                                 | Framework-agnostic engine — incremental parsing, LaTeX preprocessing, plugin pipeline, cross-chunk registry                                              | Release train; pinned exactly by shared core and adapters |
| [`@ai-markdown/remark-mark-highlight`](https://www.npmjs.com/package/@ai-markdown/remark-mark-highlight)   | remark plugin for `==mark==` highlight syntax                                                                                                            | Independent semver                                        |
| [`@ai-markdown/code-language-detector`](https://www.npmjs.com/package/@ai-markdown/code-language-detector) | Heuristic language detection for unlabelled code blocks, and fence language names mapped to Shiki or highlight.js names; used by the Mantine integration | Independent semver                                        |

## Compatibility

|                |                                                                                                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| React          | ^19.0.0 (`react`, `react-dom` peer dependencies)                                                                                                                                                                                                             |
| KaTeX          | `^0.16` or `^0.17` (optional peer — only if you render math)                                                                                                                                                                                                 |
| Node           | `^20.19.0 \|\| >=22.12.0` (`engines.node`)                                                                                                                                                                                                                   |
| Module formats | ESM and CJS, TypeScript types for both, `sideEffects` declared                                                                                                                                                                                               |
| Runtimes       | Browser, Node, edge/workers; server rendering via `renderToString`, and the bundle keeps its `"use client"` directive for React Server Components apps — see [Streaming & performance](https://ai-markdown.github.io/docs/guides/streaming-and-performance/) |
| Bundling       | ESM/CJS artifacts and declared side effects; selecting fewer plugins disables their pipeline behavior, but does not guarantee their dependencies disappear from the bundle                                                                                   |

## Installation

```bash
# npm
npm install @ai-markdown/react

# pnpm
pnpm add @ai-markdown/react

# yarn
yarn add @ai-markdown/react
```

The React adapter declares both `@ai-markdown/core` and `@ai-markdown/engine` as ordinary dependencies, pinned to the same train version when packed. Applications install `@ai-markdown/react`; the package manager resolves the shared layers automatically. Core owns sessions, planning and coordination, while engine owns parsing and tree algorithms. Adapter authors may depend on these layers directly and should keep their versions aligned. Exact pins reduce version mismatch; they do not guarantee a single module instance across arbitrary nested installations.

### Peer Dependencies

```json
{
  "react": "^19.0.0",
  "react-dom": "^19.0.0",
  "katex": "^0.16.0 || ^0.17.0"
}
```

`katex` is optional. For a new application using the math examples, also run `pnpm add react@^19 react-dom@^19 katex`; declare KaTeX directly when importing its CSS.

### CSS Dependencies

For LaTeX math rendering, include the KaTeX stylesheet:

```tsx
import 'katex/dist/katex.min.css';
```

`katex` is declared as an **optional peer dependency** — by this package and by `@ai-markdown/engine`, which owns the `rehype-katex` pipeline step. It ships transitively via `rehype-katex`, so a hoisted installation may expose the import transitively. Declare it in your own app when importing its CSS, so resolution does not depend on hoisting or installer configuration:

```bash
npm install katex
```

Skip the install only if you have no `import 'katex/…'` calls in your app and don't render math.

For the built-in default typography, include the typography CSS:

```tsx
import '@ai-markdown/react/typography/default.css';
// or import all typography variants at once:
import '@ai-markdown/react/typography/all.css';
```

## Quick Start

```tsx
import AIMarkdown from '@ai-markdown/react';
import 'katex/dist/katex.min.css';
import '@ai-markdown/react/typography/default.css';

function App() {
  return <AIMarkdown content="Hello **world**! Math: $E = mc^2$" />;
}
```

### Streaming Example

```tsx
function StreamingChat({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  return <AIMarkdown content={content} streaming={isStreaming} colorScheme="dark" />;
}
```

## Props API Reference

### `AIMarkdownProps<TMetadata>`

See the [React props reference](../guides/api/react-props.md) for types, defaults and behavior of all flat props. Wrapper authors should use it as the prop-name registry before adding configuration.

## Engine Plugins

Optional pipeline features are selected through the `enginePlugins` prop, which accepts **sealed plugin objects** exported from the `@ai-markdown/react/plugins` subpath. All five are enabled by default.

| Plugin           | Description                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| `highlight`      | `==Highlight==` syntax support                                                                          |
| `definitionList` | Definition list syntax ([PHP Markdown Extra](https://michelf.ca/projects/php-markdown/extra/#def-list)) |
| `removeComments` | Strip HTML comments                                                                                     |
| `smartypants`    | Typographic substitutions: curly quotes, em-dashes (`--`), ellipses (`...`)                             |
| `pangu`          | Auto-insert spaces between CJK and half-width characters                                                |

### Example: Selective Plugins

```tsx
import AIMarkdown from '@ai-markdown/react';
import { highlight, smartypants } from '@ai-markdown/react/plugins';

const PLUGINS = [highlight, smartypants]; // module scope — stable reference

<AIMarkdown content={markdown} enginePlugins={PLUGINS} />;
```

Passing an array **replaces the selection wholesale** (array-atomic semantics) — the example above enables only highlight and smartypants, disabling the other three. The recommended "turn one off" idiom:

```tsx
import { defaultEnginePlugins, pangu } from '@ai-markdown/react/plugins';

const PLUGINS = defaultEnginePlugins.filter((p) => p !== pangu);
```

Rules worth knowing:

- Omitting `enginePlugins` means `defaultEnginePlugins` (all five).
- Each plugin's position in the produced chain comes from its internal stage metadata; the order of your array is irrelevant. Duplicates are deduplicated with a dev warning.
- The set is **sealed**: only engine constructs plugins (the incremental engine's boundary scanner must know every construct's syntax; open injection would void its verification record). Third-party content extension stays open through `contentPreprocessors` + `customComponents`.
- Plugin objects are not serializable. For remote-config scenarios, store `plugin.name` strings (typed as `AIMarkdownEnginePluginName`) and map them back to the exported singletons at the edge.
- The prop is deep-equal-stabilized as a backstop, but an inline array still pays one comparison per render — define the array at module scope.

## Behavior Props

Three flat boolean props control engine behavior:

| Prop                       | Type      | Default | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------- | --------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `blockMemo`                | `boolean` | `true`  | Enables block-level memoization: the renderer splits each document into per-block units and memoizes each block's React subtree by source identity, so unchanged blocks skip `toJsxRuntime` and React reconcile work during streaming. Output is byte-identical to the disabled path in standalone rendering. Cross-chunk coordination (`<AIMarkdownDocuments>`) is wired through this path only — with `blockMemo={false}` a wrapped chunk renders as if standalone (cross-chunk references stay literal). Set `blockMemo={false}` as an escape hatch for debugging standalone documents. |
| `incrementalParse`         | `boolean` | `true`  | Prefix-freeze incremental parsing for streaming: when content grows by appends, the renderer freezes the stable document prefix at a verified-safe boundary and re-parses only the tail (83–94% less pipeline stage time on the benchmark payloads; footnotes and cross-chunk documents splice too). Output is deep-equal to a full parse — enforced by a per-frame splice-equivalence test suite. Effective only while `blockMemo` is `true`.                                                                                                                                             |
| `preserveOrphanReferences` | `boolean` | `true`  | Protects orphan `[^x]: …` footnote definitions from being silently dropped by `mdast-util-to-hast` when no matching `[^x]` reference exists. Useful for streamed content where the reference may arrive in a later chunk. Inside `<AIMarkdownDocuments>`, the wrapper's `preserveOrphanReferences` prop overrides this prop unconditionally.                                                                                                                                                                                                                                               |

```tsx
<AIMarkdown content={markdown} blockMemo={false} incrementalParse={false} />
```

## Cross-chunk Coordination

When a single logical markdown document is split across multiple
`<AIMarkdown>` instances (chunked streaming for chat UIs, etc.), wrap
them in `<AIMarkdownDocuments>` and pass the SAME `documentId` to every
chunk to coordinate footnotes, link references, and image references
across chunks:

```tsx
import AIMarkdown, { AIMarkdownDocuments } from '@ai-markdown/react';

<AIMarkdownDocuments>
  {message.chunks.map((c, i) => (
    <AIMarkdown key={i} content={c} documentId={message.id} />
  ))}
</AIMarkdownDocuments>;
```

Without the wrapper, each `<AIMarkdown>` is independent — its
references resolve only within its own content (current standalone
behavior).

### Chunks that mount out of order (virtualized lists)

Cross-chunk state — footnote numbering, and which chunk renders the
aggregate footer — follows the order chunks **register** in, which by
default is the order they mount. That is correct as long as each chunk
mounts once, in document order.

A virtualized transcript breaks that assumption: a message scrolled out of
view unmounts, and scrolling back re-registers it _after_ the chunks that
stayed mounted — so footnotes renumber and the footer moves. Pass
`documentIndex` (any stable per-chunk ordinal — the message's index in your
list) and registration order stops depending on mount order:

```tsx
<AIMarkdownDocuments>
  {message.chunks.map((c, i) => (
    <AIMarkdown key={i} content={c} documentId={message.id} documentIndex={i} />
  ))}
</AIMarkdownDocuments>
```

The prop is optional and changes nothing when every chunk mounts once in
order, so existing code needs no update.

### `<AIMarkdownDocuments>` Props

| Prop                       | Type        | Default | Description                                                                                                                                                                                                                                                                                                                                       |
| -------------------------- | ----------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preserveOrphanReferences` | `boolean`   | `true`  | Controls orphan-reference protection for every chunk under this wrapper. Unconditionally overrides each chunk's `preserveOrphanReferences` prop. Does not gate cross-chunk coordination itself (that's gated by wrapper + `documentId`).                                                                                                          |
| `smoothTurnTaking`         | `boolean`   | `true`  | Wrapper-level switch for smooth-stream turn-taking: when `true`, `<AIMarkdownSmoothStream>` chunks sharing this `documentId` type one at a time in mount order. `false` lets every chunk pace independently. See [smooth streaming → turn-taking](https://ai-markdown.github.io/docs/guides/smooth-streaming/#multi-chunk-documents-turn-taking). |
| `children`                 | `ReactNode` | -       | The `<AIMarkdown>` instances to coordinate. Do not nest document wrappers: development throws; production logs an error and renders children using the outer wrapper.                                                                                                                                                                             |

### `useDocumentRegistry(documentId)`

The full signature is `useDocumentRegistry(documentId: string | undefined, documentIdExplicit?: boolean): Registry | null`. The second argument defaults to `true`; pass `false` when the identity was generated automatically rather than supplied for coordination.

Returns the provider-owned registry for the ID, or `null` outside `<AIMarkdownDocuments>`, for an empty/undefined ID, or when `documentIdExplicit` is false. The read-only `Registry` type is exported; the hook does not register a chunk or subscribe the component to registry changes.

For reactive reads, pair a registry subscription with cleanup through React's external-store API; see [Reactive registry reads](../guides/cross-chunk-coordination.md#reactively-reading-the-registry). Treat returned definitions and snapshots as borrowed data. Provider and renderer lifecycle owns registration and release; a consumer of this read hook must not mutate registry internals.

```tsx
import { useDocumentRegistry, type Registry } from '@ai-markdown/react';

function MyHelper({ documentId }: { documentId: string }) {
  const registry: Registry | null = useDocumentRegistry(documentId);
  // null when no <AIMarkdownDocuments> ancestor — treat as "run standalone".
}
```

## Custom URL Schemes and Sanitization

By default `<AIMarkdown>` only renders links and images whose URLs use the standard set of safe protocols (`http`, `https`, `irc`, `ircs`, `mailto`, `xmpp`). Anything else — `javascript:`, `data:`, or your own `myapp://` — is stripped. This protects against XSS in LLM-generated markdown but also means private application schemes are unreachable without configuration.

### The Two-Gate Model

Sanitization runs in **two independent gates** (defense in depth):

1. **`rehype-sanitize` schema** — runs first, inside the rehype plugin chain, and drops the URL when the protocol is not in the schema's per-attribute allowlist (`protocols.href`, `protocols.src`, `protocols.cite`).
2. **`urlTransform`** — runs second, at render time during the hast traversal, on every URL-bearing attribute, that survived the schema; the default transform returns an empty string for a disallowed URL. A custom transform may also return null or undefined to omit the attribute. Called per-attribute with the attribute name (`'href'` / `'src'` / …) so key-aware transforms can discriminate (e.g. allow a scheme on `href` but not on `src` to block tracker pixels).

For a private scheme to render, **both gates must permit it**. Allowing only one is the most common pitfall.

**Cross-chunk symmetry.** When `<AIMarkdown>` instances are wrapped in `<AIMarkdownDocuments>`, link/image references resolved across chunks (chunk A defines `[evil]: …`, chunk B writes `[click][evil]`) go through both gates as well — the same `urlTransform` and `sanitizeSchema` you pass to `<AIMarkdown>` apply at render time. The per-attribute key (`'href'` vs `'src'`) is honored: a key-aware policy that permits a scheme on `<a>` but not `<img>` will produce identical behavior whether the reference is in-chunk or cross-chunk. The same holds for `customComponents`: an `a` or `img` override receives the resolved cross-chunk element (with its `node` prop and the already-rendered link children) exactly as it receives a same-chunk one, so a `SafeLink` / `SafeImg` wrapper covers both.

### Allowing a Custom Scheme

Define both gates at module scope so their reference identity is stable across renders (this keeps the per-block memo cache warm):

```tsx
import AIMarkdown, { defaultUrlTransform, extendSanitizeSchema, type UrlTransform } from '@ai-markdown/react';

// Gate 2: compose with the default so https/mailto/etc. still work.
const ALLOWED = /^myapp:/i;
const URL_TRANSFORM: UrlTransform = (url, key, node) =>
  key === 'href' && ALLOWED.test(url) ? url : defaultUrlTransform(url, key, node);

// Gate 1: allow the application scheme for links. Images keep their default policy.
const SCHEMA = extendSanitizeSchema((s) => {
  s.protocols!.href!.push('myapp');
});

function App() {
  return <AIMarkdown content={markdown} urlTransform={URL_TRANSFORM} sanitizeSchema={SCHEMA} />;
}
```

### `extendSanitizeSchema((draft) => Schema | void)`

Hands you a deep clone of the library's default sanitize schema. Mutate it freely (the original singleton is never touched) or return a replacement object. Library invariants — cross-chunk coordination tags (`cross-chunk-link`, `cross-chunk-image`, `footnote-sup`), the KaTeX `math-inline` / `math-display` className allowlist, the `<mark>` allowance — survive untouched. **Hand-rolling a schema that doesn't spread these invariants silently breaks coordinated rendering**, which is why the helper is the recommended path.

```tsx
const SCHEMA = extendSanitizeSchema((s) => {
  (s.tagNames ??= []).push('my-widget'); // add a tag
  s.protocols!.href!.push('myapp'); // permit a protocol
  (s.attributes ??= {})['my-widget'] = ['dataId', 'dataMode']; // allow attributes
  // No `return` needed — mutate-only is fine.
});
```

**Footguns** (also documented in JSDoc):

- Returning `null` is treated like returning nothing (the mutated draft is used).
- Reassigning the local parameter (`s = { ... }`) does NOT replace the draft — JS only rebinds the local. Either mutate the original or `return` an explicit value.
- Throwing inside the modifier propagates uncaught. Usually fine because the helper is called once at module load.

### Reference Stability and the Cache

Both `urlTransform` and `sanitizeSchema` participate in the per-block memo cache, but they are stabilized **asymmetrically**:

- **`urlTransform`** is tracked by identity only. A new function reference every render flushes the cache. Callers MUST supply a stable reference (module scope or `useMemo`).
- **`sanitizeSchema`** is tracked by identity AND additionally stabilized internally via a deep-equal safety net (`useStableValue`). An inline-but-deep-equal schema still works, just with a one-time deep compare on each render — cheaper than a cache flush but not free.

Why the asymmetry: function identity can't be deep-compared (two closures with identical bodies are always non-equal), so for `urlTransform` only the call-site can produce a stable reference. `sanitizeSchema` is plain data, so a deep compare is meaningful and serves as a guardrail for callers who forget the module-scope rule.

```tsx
// 🚫 Anti-pattern — `urlTransform` is recreated every render and discards
//    the entire markdown cache. `sanitizeSchema` would too without the
//    internal deep-equal safety net, but you still pay the deep-compare cost.
<AIMarkdown
  urlTransform={(url, k, n) => /* … */}
  sanitizeSchema={extendSanitizeSchema((s) => /* … */)}
/>

// ✅ Stable — both refs are minted once at module scope.
const URL_TRANSFORM = (url, k, n) => /* … */;
const SCHEMA = extendSanitizeSchema((s) => /* … */);
<AIMarkdown urlTransform={URL_TRANSFORM} sanitizeSchema={SCHEMA} />
```

In development the library will `console.warn` after detecting 3+ identity flips on either prop. The warning is dead-code-eliminated in production builds. Define both values at module scope, or memoize with `useMemo` if they depend on state.

### Regex Escaping for `+` / `-` / `.` in Scheme Names

Scheme names can contain `+`, `-`, and `.`. Escape `+` and `.` when matching them literally; a hyphen is literal outside a character class. Use `/^web\+app:/i` for `web+app:`. The unescaped `/^web+app:/i` instead matches `webapp:`, `webbapp:`, and further repetitions of `b`.

### Inspecting the Default Schema

`extendSanitizeSchema` hands the modifier a deep clone of the library default. That makes the helper itself the cleanest introspection path — no separate export of the singleton is needed:

```tsx
extendSanitizeSchema((s) => {
  console.log('default sanitize schema:', s);
});
```

Why no direct `sanitizeSchema` export? Because the obvious extension pattern — `{ ...sanitizeSchema, … }` — is a shallow spread. Nested arrays (`protocols.href`, `attributes.a`, `ancestors.*`, …) stay aliased to the singleton; a mutation would target shared nested data. The engine singleton is now deeply frozen, so such writes can throw instead of extending it. A deep clone gives each customization its own mutable arrays. `extendSanitizeSchema` always works on a deep clone, so this class of bug is impossible by construction.

### API Stability of `UrlTransform` and `SanitizeSchema`

Both prop types track their respective upstream packages — `UrlTransform` follows `react-markdown`'s shape and `SanitizeSchema` follows `rehype-sanitize`'s. They may evolve with those packages' major versions. Hand-construct schemas via the helpers (rather than typing your own from scratch) and you'll inherit any upstream-driven changes automatically.

## Hooks

<span id="the-five-narrow-hooks"></span>
<span id="useaimarkdown--the-aggregate"></span>
<span id="useaimarkdownmetadatatmetadata"></span>
<span id="usestablevaluetvalue-t"></span>
<span id="usestablerecordrecord-table"></span>

See [React hooks](../guides/api/react-hooks.md#hooks) for signatures, examples and lifecycle contracts.

## Additive Providers

<span id="group-key-registry"></span>

See [additive providers](../guides/api/react-hooks.md#additive-providers) for signatures, examples and lifecycle contracts.

## Typography and Styling

The `<AIMarkdown>` component wraps its content in a typography component that controls font size, variant, and color scheme.

### Built-in Default Typography

The built-in `DefaultTypography` renders a `<div>` with CSS class names for the active variant and color scheme:

```html
<div class="aim-typography-root default light" style="width: 100%; font-size: 0.9375rem">
  <!-- markdown content -->
</div>
```

Import the corresponding CSS to activate styles:

```tsx
import '@ai-markdown/react/typography/default.css';
```

#### Customization tokens

All `default`-variant styles are driven by CSS custom properties declared on `.aim-typography-root.default`. Spacing, font-size, and heading tokens are **anchored to `--aim-font-size-root`** (injected by the renderer from the `fontSize` prop), so those dimensions scale with `fontSize`; radius constants, border widths, and unitless values follow their own declarations. To customize, override any token in your own stylesheet:

```css
.aim-typography-root.default {
  --aim-spacing-md: calc(var(--aim-font-size-root) * 1.2); /* roomier paragraphs */
  --aim-h1-font-size: calc(var(--aim-font-size-root) * 2.5); /* bigger H1 */
  --aim-font-weight-strong: 600; /* lighter headings + th */
  --aim-color-anchor: #ff6b6b; /* red links */
}
```

| Group         | Tokens                                                                                      | Notes                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spacing       | `--aim-spacing-{xs,sm,md,lg,xl}`                                                            | `calc(var(--aim-font-size-root) * k)` where `k ∈ {0.625, 0.75, 1, 1.25, 1.5}`                                                                                                           |
| Font size     | `--aim-font-size-{xs,sm,md,lg,xl}`                                                          | `k ∈ {0.75, 0.875, 1, 1.125, 1.25}`                                                                                                                                                     |
| Heading sizes | `--aim-h{1..6}-font-size`                                                                   | Multipliers mirror Mantine's heading scale (`{2.125, 1.625, 1.375, 1.125, 1, 0.875}`)                                                                                                   |
| Heading meta  | `--aim-h{1..6}-line-height`, `--aim-h{1..6}-font-weight`                                    | line-heights are unitless; weights default to `var(--aim-font-weight-strong)`                                                                                                           |
| Weight        | `--aim-font-weight-strong`                                                                  | Shared by all headings and `<th>`. Default `700`.                                                                                                                                       |
| KaTeX         | `--aim-katex-font-size`                                                                     | Defaults to `var(--aim-font-size-root)`, so formulas stay at the component-root size regardless of parent context (blockquote, heading). Override to `1em` if you want parent-relative. |
| Misc          | `--aim-line-height`, `--aim-radius-sm`, `--aim-font-family-{monospace,headings}`            | Unitless / rem / font-stack constants.                                                                                                                                                  |
| Color (light) | `--aim-color-{text,dimmed,anchor,border,code-bg,code-text,blockquote-bg,mark-bg,mark-text}` | Declared on `.aim-typography-root.light`; dark variants on `.aim-typography-root.dark`.                                                                                                 |

> **Stability contract:** the _names_ and _roles_ of these tokens follow semver. The exact default _values_ (multipliers, colors) may shift under minor bumps as the visual design evolves — override the token if you need a specific value to be locked.

### Custom Typography Component

Replace the typography wrapper by passing a custom component. The `style` prop carries CSS custom properties injected by the React renderer — **merge it onto your root element** so that descendant CSS can reference these variables:

```tsx
import type { AIMarkdownTypographyProps } from '@ai-markdown/react';

function MyTypography({ children, fontSize, variant, colorScheme, style }: AIMarkdownTypographyProps) {
  return (
    <div className={`my-markdown ${colorScheme}`} style={{ fontSize, ...style }}>
      {children}
    </div>
  );
}

<AIMarkdown content={markdown} Typography={MyTypography} />;
```

#### Injected CSS Custom Properties

The React renderer injects the following CSS custom properties via the Typography `style` prop:

| Variable               | Value           | Purpose                                                                                                                                                                                             |
| ---------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--aim-font-size-root` | `fontSize` prop | Absolute font-size anchor for the component instance. Inner CSS can use `var(--aim-font-size-root)` to bypass `em` compounding in deeply nested markdown structures (e.g. code inside blockquotes). |

**Why `--aim-font-size-root`?** Markdown content frequently nests elements that use relative `em` units — blockquotes, lists, code blocks. Each nesting level compounds the effective size: a `0.875em` code span inside a `1.125em` blockquote resolves to `0.984em` of the parent, not `0.875em` of the root. This variable provides a stable, absolute reference that inner CSS rules can use to opt out of compounding when a fixed size is needed.

The built-in `default` variant already consumes this variable — all of its spacing, font-size, and heading tokens are defined as `calc(var(--aim-font-size-root) * k)`, so changing the `fontSize` prop on `<AIMarkdown>` scales the root-anchored dimensions, without changing independent rem/px constants. See [Customization tokens](#customization-tokens) above for the full surface.

### Extra Styles Wrapper

The `ExtraStyles` prop accepts a component rendered between the typography wrapper and the markdown content. Useful for injecting additional CSS scope or theme providers:

```tsx
import type { AIMarkdownExtraStylesProps } from '@ai-markdown/react';

function MyExtraStyles({ children }: AIMarkdownExtraStylesProps) {
  return <div className="my-extra-scope">{children}</div>;
}

<AIMarkdown content={markdown} ExtraStyles={MyExtraStyles} />;
```

## Custom Components

Override the default renderers for specific HTML elements using the `customComponents` prop. This maps directly to `react-markdown`'s `Components` type:

```tsx
import type { AIMarkdownCustomComponents } from '@ai-markdown/react';

const components: AIMarkdownCustomComponents = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  img: ({ src, alt }) => <img src={src} alt={alt} loading="lazy" />,
};

<AIMarkdown content={markdown} customComponents={components} />;
```

## Streaming Support

Update `content` with the full accumulated string and set `streaming` from the source lifecycle. The flag reaches `useAIMarkdownState()` consumers and controls cursor mounting; it does not select a separate Markdown grammar. Incremental parsing is governed by the behavior switches and the append/safety gates.

```tsx
import { AIMarkdownStreamingCursor } from '@ai-markdown/react';

<AIMarkdown
  content={accumulatedMarkdown}
  streaming={requestStatus === 'streaming'}
  streamingCursor={AIMarkdownStreamingCursor}
/>;
```

A cursor belongs outside the source string. Appending a decorative character to Markdown breaks the append-only relationship between frames and can corrupt code or math text. The built-in cursor uses a DOM overlay and hides for unsupported tails such as code, math, and images.

For paced presentation, replace the renderer with `AIMarkdownSmoothStream`, or pass `useSmoothStream({ content, streaming })` into a custom wrapper. The source may finish before the visible text has drained; the returned streaming flag remains true during that drain. Existing text snaps on mount, replacements snap after the sync effect, and only real backlog rounds produce drain callbacks.

Use one renderer for a normal transport stream. Multiple logical Markdown chunks can share an explicit document id under `AIMarkdownDocuments`, with block memoization enabled. The wrapper coordinates references; it does not reconnect fences, tables, or paragraphs split at arbitrary token boundaries.

See [the full chat example](https://ai-markdown.github.io/docs/guides/streaming-chat-example/), [smooth streaming](https://ai-markdown.github.io/docs/guides/smooth-streaming/), and [streaming performance](https://ai-markdown.github.io/docs/guides/streaming-and-performance/) for framing, cancellation, lifecycle, and cache behavior.

## Metadata

The `metadata` prop lets you pass arbitrary data to deeply nested custom components without prop drilling. Metadata is stored in a **separate React context** from the render state, so updating metadata does not cause re-renders in components that only read render state (like the core `MarkdownContent`).

```tsx
interface ChatMetadata {
  messageId: string;
  onCopyCode: (code: string) => void;
  onRegenerate: () => void;
}

<AIMarkdown<ChatMetadata>
  content={markdown}
  metadata={{
    messageId: msg.id,
    onCopyCode: handleCopy,
    onRegenerate: handleRegenerate,
  }}
/>;
```

## Content Preprocessors

The rendering pipeline runs a LaTeX preprocessor by default. You can append additional preprocessors that transform the raw markdown string before it enters the remark/rehype pipeline:

```tsx
import type { AIMDContentPreprocessor } from '@ai-markdown/react';

const stripFrontmatter: AIMDContentPreprocessor = (content) => content.replace(/^---[\s\S]*?---\n/, '');

<AIMarkdown content={markdown} contentPreprocessors={[stripFrontmatter]} />;
```

Preprocessors run in sequence: built-in LaTeX preprocessor first, then your custom ones in array order.

## TypeScript Generics

The component takes one generic type parameter — `TMetadata` for type-safe metadata:

```tsx
import AIMarkdown, { type AIMarkdownMetadata } from '@ai-markdown/react';

interface MyMetadata extends AIMarkdownMetadata {
  messageId: string;
}

<AIMarkdown<MyMetadata> content={markdown} metadata={{ messageId: '123' }} />;
```

The metadata hook accepts the matching generic:

```tsx
const metadata = useAIMarkdownMetadata<MyMetadata>();
```

Sub-packages extend the **flat prop surface** instead of a config generic: `@ai-markdown/react-mantine`'s `MantineAIMarkdownProps<TMetadata> extends AIMarkdownProps<TMetadata>` adds a `codeBlock` prop, transports it through `AIMarkdownBehaviorsProvider`, and asserts the group type exactly once inside its own narrow hook (`useMantineCodeBlockOptions()`). See [Additive Providers](#additive-providers) above and [Extending via a sub-package](https://ai-markdown.github.io/docs/guides/extending-via-subpackage/).

## Architecture Overview

```text
<AIMarkdown>
  <AIMarkdownMetadataProvider>          // Separate context for metadata
    <AIMarkdownProvider>                // Per-system contexts: document, state, theme, behaviors
      <Typography>                      // Configurable typography wrapper
        <ExtraStyles?>                  // Optional extra style wrapper
          <AIMarkdownContent />         // react-markdown with remark/rehype plugin chain
        </ExtraStyles?>
      </Typography>
    </AIMarkdownProvider>
  </AIMarkdownMetadataProvider>
</AIMarkdown>
```

State is deliberately split across five per-system contexts (document, metadata, state, theme, behaviors) so a change in one system — a metadata callback swap, a `streaming` flip — only re-renders that system's subscribers.

## Exported API

### Default Export

- `AIMarkdown` -- the main component (memoized)

### Components

- `AIMarkdownDocuments` -- optional outer wrapper enabling cross-chunk coordination
- `AIMarkdownStreamingCursor` -- built-in inline cursor for the `streamingCursor` slot
- `AIMarkdownSmoothStream` -- `<AIMarkdown>` plus typewriter pacing (`smooth*` props); chunks sharing a `documentId` under `<AIMarkdownDocuments>` reveal turn-by-turn (one typewriter, one cursor); see [apps/docs/content/guides/smooth-streaming.md](https://ai-markdown.github.io/docs/guides/smooth-streaming/)

### Providers

- `AIMarkdownBehaviorsProvider` -- additive transport for wrapper/app behavior groups (stack outside `<AIMarkdown>`)
- `AIMarkdownStateProvider` -- additive transport for extension lifecycle-state groups

### Hooks

- `useAIMarkdownState()`, `useAIMarkdownTheme()`, `useAIMarkdownDocument()`, `useAIMarkdownBehaviors()`, `useAIMarkdownMetadata<T>()` -- the five narrow hooks
- `useAIMarkdown()` -- the aggregate (subscribes to all five contexts)
- `useDocumentRegistry()`
- `useSmoothStream()` -- typewriter pacing as a hook; returns a props-shaped `{ content, streaming, flush }` that spreads into any wrapper
- `useDocumentSmoothStream()` -- `useSmoothStream` plus document turn-taking (`waiting` reserves an empty slot before input): pass a `documentId` and, under `<AIMarkdownDocuments>`, chunks reveal in mount order (one typewriter, one cursor); degrades to plain `useSmoothStream` without one
- `useStableValue()`
- `useStableRecord()` -- the stability firewall, for wrapper authors

### Factories

- `defineTheme`, `defineBehaviors`, `definePipeline` -- frozen, typed, reference-stable flat prop fragments (identity + types + `Object.freeze`, zero logic)
- `createRemendPreprocessor()` -- opt-in streaming tail-repair factory for `contentPreprocessors` (effect enabled by including it in the preprocessor array)
- `createSmoothStreamController()` -- the framework-free pacing core beneath `useSmoothStream` (no React/DOM dependency); accepts advanced numeric overrides on top of the pacing presets
- `SMOOTH_STREAM_PACING_PRESETS` -- the frozen parameter bundles behind the three `smoothPacing` presets

### Constants and Helpers

- `defaultUrlTransform` -- the library's built-in URL-allowlist transform; compose with this when supplying a custom `urlTransform`
- `extendSanitizeSchema((draft) => Schema | void)` -- mutate-and-return factory that produces a sanitize schema from a deep clone of the library default; preserves cross-chunk and KaTeX invariants
- `AIMarkdownStabilityPolicy` -- policy enum for `useStableRecord` tables (`DEEP_EQUAL` / `WARN_ONLY` / `PASS_THROUGH`)

### `@ai-markdown/react/plugins` (subpath)

- `highlight`, `definitionList`, `smartypants`, `pangu`, `removeComments` -- the sealed engine plugin singletons
- `defaultEnginePlugins` -- all five, the shipped default selection

### Types

- `AIMarkdownProps`
- `AIMarkdownDocumentsProps`
- `AIMarkdownCustomComponents`
- `AIMarkdownMetadata`
- `AIMarkdownEnginePlugin`, `AIMarkdownEnginePluginName` -- sealed plugin type + its name union (the serialization escape hatch)
- `AIMarkdownTypographyProps`
- `AIMarkdownTypographyComponent`
- `AIMarkdownExtraStylesProps`
- `AIMarkdownExtraStylesComponent`
- `AIMarkdownVariant`
- `AIMarkdownColorScheme`
- `AIMDContentPreprocessor`, `RemendPreprocessorOptions`
- `AIMarkdownThemeProps`, `AIMarkdownBehaviorProps`, `AIMarkdownPipelineProps` -- the `define*` factory input types
- `AIMarkdownStabilityTable` -- table type for `useStableRecord`
- Context payload types: `AIMarkdownDocumentInfo`, `AIMarkdownThemeInfo`, `AIMarkdownStateCore`, `AIMarkdownBehaviorsCore`, `AIMarkdownStateGroups`, `AIMarkdownBehaviorGroups`, `AIMarkdownExtensionGroups`, `AIMarkdownAggregate`
- Streaming cursor types: `AIMarkdownStreamingCursorProps`, `AIMarkdownStreamingIndicatorProps`, `AIMarkdownStreamingIndicatorComponent`
- Smooth streaming types: `AIMarkdownSmoothStreamProps`, `SmoothStreamController`, `SmoothStreamOptions`, `SmoothStreamPacing`, `SmoothStreamPacingParams`, `UseSmoothStreamOptions`, `UseSmoothStreamResult`, `UseDocumentSmoothStreamOptions`
- `UrlTransform`, `SanitizeSchema` -- prop-type aliases for the URL handling props (track upstream `react-markdown` / `rehype-sanitize` shapes)
- Cross-chunk registry types: `Registry`, `ChunkData`, `FootnoteDef`, `LinkDef`, `RefRecord`, `RefKind`

## Documentation

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

## Integration checks and implementation boundaries

Before adding customization, verify the basic renderer with its typography CSS and KaTeX CSS. Then add one surface at a time: tokens for appearance, `customComponents` for element behavior, metadata for application data, and a schema/URL transform for an explicitly chosen URL policy. This makes a missing style distinguishable from a parser or sanitizer result.

For streaming, keep component keys stable, preserve the accumulated source, and end the source state on success, cancellation, and failure. Completed blocks may reuse React elements, but their state, context, and external-store subscriptions can still update them. Cache reuse is not a promise that a custom component will never render again.

For coordination, test a late definition and a chunk remount. `documentIndex` orders the mounted entries; unmounting still removes their contributions. Server rendering and the first hydration frame use local definitions until effects publish shared contributions. Auto-generated ids namespace standalone output and do not opt into coordination.

The default schema removes disallowed tags and attributes before `urlTransform`; the callback cannot restore an attribute already removed. Cross-chunk references apply the consuming chunk's policy to their final `a` or `img`, including ancestor constraints. Registry selectors expose raw definition URLs, so a custom sidebar must apply its own URL policy before rendering them.

Source owners: [`src/index.tsx`](../../../../packages/react/src/index.tsx) resolves public inputs, [`MarkdownContent`](../../../../packages/react/src/components/MarkdownContent.tsx) owns rendering and contribution effects, and the [engine README](../../../../packages/engine/README.md) describes the syntax layer. The [development guide index](https://ai-markdown.github.io/docs/guides/) connects every customization surface to a detailed recipe.

## License

MIT

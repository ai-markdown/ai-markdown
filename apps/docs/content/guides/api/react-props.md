# React props reference

Use these props with `<AIMarkdown>`. The [React quick start](../react-quick-start.md) covers installation; the [component reference](../../reference/react.md) covers smooth streaming, document providers and exported types.

## Props and defaults

The component accepts `AIMarkdownProps<TMetadata>`.

Configuration uses **flat props**. A non-null value overrides the shipped default; `undefined` and `null` use the default. This also preserves defaults when serialization produces `null` for omitted options.

Wrapper authors should check this **prop-name registry** and the wrappers they extend before adding a prop. All wrapper layers share the same namespace; for example, Mantine adds `codeBlock`. A conflicting type fails a TypeScript interface extension, while plain JavaScript can silently override the existing value.

### `content`

Type: `string`. Default: **(required)**.

Raw markdown content to render.

### `streaming`

Type: `boolean`. Default: `false`.

Whether content is actively being streamed (e.g. from an LLM).

### `streamingCursor`

Type: `ComponentType`. Default: `undefined`.

Streaming cursor slot. While `streaming === true`, the given component is rendered after the markdown content and unmounted when streaming stops. Pass the exported `AIMarkdownStreamingCursor` for the built-in inline cursor. Compared by identity — define at module scope. Definition-aware: while a footnote definition streams, the cursor follows the text into its footer entry; it hides for tails it cannot truthfully point at (a streaming link-reference definition, which renders nothing; a definition whose footer entry lives in another chunk under cross-chunk coordination).

### `fontSize`

Type: `number | string`. Default: `'0.9375rem'`.

Base font size. Numbers are treated as pixels.

### `variant`

Type: `AIMarkdownVariant`. Default: `'default'`.

Typography variant name.

### `colorScheme`

Type: `AIMarkdownColorScheme`. Default: `'light'`.

Color scheme name (`'light'`, `'dark'`, or custom).

### `metadata`

Type: `TMetadata`. Default: `undefined`.

Arbitrary data passed to custom components via a dedicated context. Deliberately never stabilized by the library — stabilization is the consumer's responsibility.

### `contentPreprocessors`

Type: `AIMDContentPreprocessor[]`. Default: `undefined`.

Additional preprocessors run after the built-in LaTeX preprocessor. An optional `createRemendPreprocessor()` factory (streaming tail repair — unterminated `**bold`/`` `code `` render styled mid-stream) ships with the package; its effect is opt-in; actual bundle elimination depends on the emitted package and consumer bundler.

### `customComponents`

Type: `AIMarkdownCustomComponents`. Default: `undefined`.

React component overrides for specific HTML elements. Components receive the converted element props and the source HAST `node`; omit `node` when forwarding props to a DOM element.

### `Typography`

Type: `AIMarkdownTypographyComponent`. Default: `DefaultTypography`.

Typography wrapper component.

### `ExtraStyles`

Type: `AIMarkdownExtraStylesComponent`. Default: `undefined`.

Optional extra style wrapper rendered between typography and content.

### `documentId`

Type: `string`. Default: auto via `useId()`.

Stable id for the _logical markdown document_ this `<AIMarkdown>` is rendering. Used as the id namespace for clobberable attributes (`id`, hash hrefs) so two documents on the same page do not cross-link (footnote `[^1]` in message A won't scroll to `[^1]` in message B). When one document is split into chunks rendered by multiple `<AIMarkdown>` instances, pass the SAME `documentId` to every chunk so prefixes align. The value is passed through `encodeURIComponent` before being injected into HTML attributes, so any string is safe (React's `useId()` output, your own opaque ids, user-supplied UUIDs — even ill-formed UTF-16 from a string truncated mid-emoji, which is hashed into the prefix and warns in dev builds). Long ids (>16 chars, e.g. UUIDs) are hashed via MurmurHash3 to a short Base62 form **inside the rendered `id="…"`/`href="#…"` prefix only** to keep HTML compact; the `documentId` exposed by `useAIMarkdownDocument()` and registry keying via `useDocumentRegistry` stay raw, so deep linking and any consumer code reading `documentId` are unaffected.

### `documentIndex`

Type: `number`. Default: mount order.

This chunk's position in the DOCUMENT, for instances sharing a `documentId` under `<AIMarkdownDocuments>`. Cross-chunk state (footnote numbering, which chunk renders the aggregate footer) follows registration order, which defaults to mount order — correct when chunks mount once in document order. Pass a stable ordinal when chunks can mount out of order or remount (a virtualized transcript that unmounts messages scrolled out of view re-registers them at the end when they scroll back). Ignored outside `<AIMarkdownDocuments>`. See [Cross-chunk Coordination](../../reference/react.md#chunks-that-mount-out-of-order-virtualized-lists).

### `urlTransform`

Type: `UrlTransform | null`. Default: `defaultUrlTransform`.

Override the URL allowlist applied to `href`, `src`, and similar attributes. The default mirrors GitHub: `http`, `https`, `irc`, `ircs`, `mailto`, `xmpp`. Pass a function defined at module scope (or memoized) to permit additional schemes — see [Custom URL Schemes and Sanitization](../../reference/react.md#custom-url-schemes-and-sanitization).

### `sanitizeSchema`

Type: `SanitizeSchema`. Default: library default.

Override the `rehype-sanitize` schema. Build with [`extendSanitizeSchema`](../../reference/react.md#custom-url-schemes-and-sanitization) so the library's cross-chunk tag and KaTeX className allowlists survive — hand-rolling silently drops them.

### `enginePlugins`

Type: `readonly AIMarkdownEnginePlugin[]`. Default: `defaultEnginePlugins`.

Sealed engine-plugin selection — accepts React-exported plugin objects from `@ai-markdown/react/plugins` only. Absent → all five shipped plugins; passing an array replaces the set wholesale. See [Engine Plugins](../../reference/react.md#engine-plugins).

### `blockMemo`

Type: `boolean`. Default: `true`.

Block-level memoization. Output-invariant in standalone rendering — flipping it changes no rendered byte; under `<AIMarkdownDocuments>` it is the path cross-chunk coordination runs on (`false` leaves cross-chunk refs literal). See [Behavior Props](../../reference/react.md#behavior-props).

### `incrementalParse`

Type: `boolean`. Default: `true`.

Prefix-freeze incremental parsing for streaming. Output-invariant; effective only while `blockMemo` is `true`. See [Behavior Props](../../reference/react.md#behavior-props).

### `preserveOrphanReferences`

Type: `boolean`. Default: `true`.

Protect orphan footnote/link definitions in incomplete streaming documents. Affects output. See [Behavior Props](../../reference/react.md#behavior-props).

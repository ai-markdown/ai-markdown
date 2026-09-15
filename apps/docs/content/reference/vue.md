# Vue reference

Vue 3 Markdown rendering built on the framework-independent `@ai-markdown/core` and `@ai-markdown/engine`. This package supplies real Vue VNodes, server rendering and hydration, scoped document references, component/slot customization, smooth streaming and a measured streaming cursor. It replaces the earlier private lifecycle prototype.

**Stable since `3.0.0`.** Vue ships on the same release train and uses the same shared engine and core as React. Its first prerelease was `3.0.0-beta.2`; beta.1 did not include Vue.

## Requirements and dependencies

- Vue **3.5 or later within Vue 3** (`^3.5.0`). The adapter uses `useId()` for application-local IDs that match between server rendering and hydration. Earlier Vue 3 minors do not provide this API.
- Node `^20.19.0 || >=22.12.0` for server/build consumers; verification records identify the actual tested Node version.
- Modern browsers with `ResizeObserver`, `MutationObserver`, `requestAnimationFrame` and Web Crypto `getRandomValues`. A secure context is not required: the adapter does not use `crypto.randomUUID`, so plain `http://` origins render. Without Web Crypto at all the cross-chunk placeholder credential degrades to a unique but non-secret value and development builds log one `console.error` per mounted chunk. The browser acceptance suite runs Chromium, Firefox and WebKit; this is not a claim that every browser/version has been exercised.
- `@ai-markdown/core` and `@ai-markdown/engine` are ordinary dependencies at the exact release-train version. Applications do not need to install them separately. Vue remains a peer and is external to both ESM and CJS output.
- KaTeX is an optional peer (`^0.16 || ^0.17`). Declare it directly when importing its stylesheet rather than depending on hoisting.

Install the stable release:

```bash
pnpm add @ai-markdown/vue vue@^3.5.0 katex
```

See [Getting started](https://ai-markdown.github.io/docs/guides/getting-started/) for the package map and React/Vue API differences. The Vue package exposes its helpers from the root; it has no `/plugins` entry or React typography variants.

## Minimal component

```vue
<script setup lang="ts">
import { ref } from 'vue';
import AIMarkdown from '@ai-markdown/vue';
import '@ai-markdown/vue/styles.css';
import 'katex/dist/katex.min.css';

const content = ref('# Answer\n\n**Markdown**, $x^2$ and 中文.');
</script>

<template>
  <AIMarkdown :content="content" />
</template>
```

Pass the **complete accumulated Markdown string**. Append decoded network data to your application state; the renderer does not own Fetch, SSE framing, UTF-8 decoding, cancellation or retries. Replacing the string is supported and invalidates retained parsing when necessary. `streaming` controls UI state; it is not the switch that enables incremental parsing.

`styles.css` provides a small base stylesheet, including code overflow, tables and cursor animation. It is optional when the application supplies its own presentation. KaTeX CSS is separate. The renderer never uses `v-html` or `innerHTML` to insert the Markdown result.

## Component props

| Prop                       | Default                  | Contract                                                                                                                                    |
| -------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `content`                  | Required                 | Complete current source string                                                                                                              |
| `documentId`               | Vue `useId()`            | Explicit IDs coordinate only inside `AIMarkdownDocuments`; generated IDs stay standalone                                                    |
| `documentIndex`            | Mount order              | Optional ordering hint for the reference registry; supply it for reordered/remounted logical chunks                                         |
| `streaming`                | `false`                  | Passed to custom components and element slots, controls cursor and `aria-busy`                                                              |
| `incrementalParse`         | `true`                   | Uses verified retained-prefix parsing in the browser; a server render uses the full pipeline                                                |
| `preserveOrphanReferences` | `false`                  | Preserve unreferenced footnote definitions; React's document wrapper defaults this to `true`, see [below](#multiple-chunks-in-one-document) |
| `enginePlugins`            | All five shipped plugins | Sealed catalog selection; membership changes, canonical ordering does not                                                                   |
| `contentPreprocessors`     | `[]`                     | Synchronous string transforms after built-in LaTeX normalization                                                                            |
| `sanitizeSchema`           | Library schema           | Treat as immutable; derive a fresh schema with `extendSanitizeSchema`                                                                       |
| `urlTransform`             | Safe default transform   | Final attribute-specific URL policy after sanitization                                                                                      |
| `components`               | `{}`                     | Tag-to-Vue-component mapping                                                                                                                |
| `metadata`                 | `undefined`              | Application-owned value passed to mapped components and scoped element slots                                                                |
| `streamingCursor`          | `true`                   | Enable the cursor while streaming; custom rendering uses the `cursor` slot                                                                  |

Root attributes such as `class`, `id` and `style` fall through to the wrapper. The wrapper establishes a relative positioning context for the cursor. Supplying a different `position` style can change that geometry.

## Custom Vue components and slots

A mapped component receives the sanitized element attributes plus `node`, `streaming` and `metadata`. Its default slot contains converted Vue children. Declare the props you consume and forward attributes deliberately; framework event handlers belong to your component code, not Markdown attributes.

```vue
<script setup lang="ts">
import AIMarkdown from '@ai-markdown/vue';
import CodeBlock from './CodeBlock.vue';
const components = { code: CodeBlock };
</script>

<template>
  <AIMarkdown content="**Hello**" :components="components" :metadata="{ messageId: 'a' }"> </AIMarkdown>
</template>
```

For arbitrary VNode children, a render-function slot is often simpler than a template loop:

```ts
import { h } from 'vue';
import AIMarkdown, { type MarkdownElementContext } from '@ai-markdown/vue';

const render = () =>
  h(
    AIMarkdown,
    { content: '**Hello**' },
    {
      strong: ({ children, metadata }: MarkdownElementContext) =>
        h('strong', { title: String(metadata ?? '') }, children),
    }
  );
```

An element slot takes precedence over the matching `components` entry. Markdown text is not interpreted as a Vue template. The adapter rejects event attributes and DOM insertion properties even if a broadened sanitizer admits them. Custom components and slots are trusted application code and are responsible for their own output policy.

## Multiple chunks in one document

```vue
<script setup lang="ts">
import AIMarkdown, { AIMarkdownDocuments } from '@ai-markdown/vue';
const chunks = ['A claim[^source] and [site][url].', '[^source]: Shared citation\n\n[url]: https://example.com'];
</script>

<template>
  <AIMarkdownDocuments>
    <AIMarkdown
      v-for="(chunk, index) in chunks"
      :key="index"
      :content="chunk"
      document-id="answer-1"
      :document-index="index"
    />
  </AIMarkdownDocuments>
</template>
```

Chunks are intentionally complete logical Markdown sections. A code fence, table row or other syntax construct split across arbitrary transport chunks is not joined by the registry. Prefer one accumulated `content` unless the application genuinely needs independently mounted sections.

References may precede definitions. The shared registry supplies canonical link/image destinations, global footnote numbering and occurrence IDs. The last registered chunk renders the aggregate footer. Updating/removing a definition updates readers; switching `documentId` releases the old registration. Different IDs and different provider instances remain independent.

The aggregate footer follows each chunk's `preserveOrphanReferences`, which defaults to `false`: a footnote definition that no chunk references is left out. React's `<AIMarkdownDocuments>` defaults the same policy to `true` and applies it to every chunk, so a definition whose reference never arrives (a stream that stops early, a chunk that is never mounted) shows in React's footer but not in Vue's. For the same output pass `:preserve-orphan-references="true"` on each chunk; there is no document-level prop in Vue.

SSR renders each chunk's local content and local footnotes without registering or publishing contributions. The first hydration render uses the same path. Cross-chunk resolution becomes available after mounted contributions commit. Consequently, a definition supplied only by another chunk is not pre-resolved in server HTML. If server-only output needs fully resolved references, render the complete document through one component.

## Smooth streaming and turn-taking

`AIMarkdownSmoothStream` accepts the base props plus `pacing` (`smooth`, `balanced`, `responsive`) and `coordinate` (default `true`). Its initial content is shown completely, including SSR and remounts. Future appends animate. Finishing the source drains the remaining reveal before clearing the rendered streaming state. Replacements snap rather than replaying unrelated content.

Inside `AIMarkdownDocuments`, explicitly named smooth chunks share a turn-taking coordinator. A chunk mounted empty waits until earlier registered smooth chunks finish. A chunk mounted with content does not hide already visible text. Completion is sticky for the current registration: a later resumed stream does not re-gate successors. Reveal order is mount order; `documentIndex` orders references, not smooth turns.

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { AIMarkdownSmoothStream } from '@ai-markdown/vue';

const content = ref('');
const finished = ref(false);
// Append decoded transport data to content.value; set finished.value on completion.
</script>

<template>
  <AIMarkdownSmoothStream :content="content" :streaming="!finished" pacing="responsive" document-id="answer-1">
    <template #waiting><span>Waiting for the previous section…</span></template>
    <template #cursor><span>▍</span></template>
  </AIMarkdownSmoothStream>
</template>
```

The `waiting` slot is used only when this component is inside `AIMarkdownDocuments` and an earlier smooth chunk is still producing or draining. The standalone example above does not enter that waiting state.

The component exposes `flush()` through its template ref. Flushing respects the engine's grapheme hold-back while the source is live; it does not pretend that an unfinished grapheme is complete.

For your own wrapper, call `useSmoothStream` or `useDocumentSmoothStream` during setup with a getter returning current string/boolean values. Read `.value` from application refs inside that getter; see the [complete wrapper example](../guides/vue-streaming.md#build-a-custom-wrapper-with-a-live-getter). Returned `content` and `streaming` are read-only computed refs; the document variant also returns `pending`. Pass `.value` in render functions and let templates unwrap refs. Always pass a getter over live state rather than capturing a one-time object snapshot.

## Composable reference

Import both composables and their input types from `@ai-markdown/vue`. Call them during component setup; a getter supplies live configuration rather than a one-time snapshot.

| Input field  | Type                 | Default / contract                                                                      |
| ------------ | -------------------- | --------------------------------------------------------------------------------------- |
| `content`    | `string`             | Required complete accumulated source                                                    |
| `streaming`  | `boolean`            | Omitted means the producer is not active                                                |
| `pacing`     | `SmoothStreamPacing` | `smooth`, `balanced`, or `responsive`; omitted uses the engine's balanced preset        |
| `documentId` | `string`             | Document variant only; an explicit ID inside `AIMarkdownDocuments` enables coordination |
| `coordinate` | `boolean`            | Document variant only; `false` opts out, otherwise eligible participants coordinate     |

`SmoothStreamInput` contains the first three fields. `DocumentSmoothStreamInput` extends it with document identity and coordination. Both functions take `input: () => Input`.

| Returned member                   | Contract                                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `content: ComputedRef<string>`    | Read-only visible source; templates unwrap top-level refs and render functions use `.value`                    |
| `streaming: ComputedRef<boolean>` | True while the producer is active or the visible source still differs from the input                           |
| `flush(): void`                   | Reveals available text; before mounting there is no controller to flush; live grapheme hold-back still applies |
| `pending: ComputedRef<boolean>`   | Document variant only; true while an empty-at-mount participant waits for its turn                             |

Controllers and watchers are created on mount and released on unmount. Initial/SSR content is complete. Changing pacing updates the existing controller's live options. The document variant releases its previous coordinator subscription when document identity or coordination eligibility changes.

`AIMarkdownSmoothStream` applies these results to `AIMarkdown`. Its extra props are `pacing` (default `balanced`) and `coordinate` (default `true`), and its template ref exposes `flush()`. It does not emit a completion event; use the returned computed state in a custom composable wrapper when your application needs to observe reveal completion.

## Slots and context types

| Slot                                         | Context and behavior                                                                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| An HTML element name such as `strong` or `a` | Receives `MarkdownElementContext`; takes precedence over the matching `components` entry                                                           |
| `cursor`                                     | Receives `{ streaming: true }`; supplies content inside the measured cursor shell while the renderer is streaming and `streamingCursor` is enabled |
| `waiting`                                    | Smooth component only; no slot props; replaces the renderer while document turn-taking is pending                                                  |

`MarkdownElementContext` contains `node` (the render-owned HAST element), `properties` (sanitized element properties), `children` (converted Vue children), `streaming` (boolean), and `metadata` (unknown application data). It is the element-slot contract, not the cursor-slot contract.

`MarkdownComponents` is a read-only tag-to-Vue-component map. Mapped components receive element attributes plus `node`, `streaming`, and `metadata`, with converted children in their default slot. `MarkdownElementSlot` is a function from `MarkdownElementContext` to a Vue child value. See [custom rendering](../guides/vue-customization.md) for complete examples.

`AIMarkdownDocuments` accepts its default slot and renders a fragment. It has no declared configuration props; orphan-reference policy belongs to each renderer (default `false`, unlike React's wrapper default of `true`; see [Multiple chunks in one document](#multiple-chunks-in-one-document)). It owns the document scope, rather than adding a layout element.

## Cursor behavior

The cursor measures the final visible prose text using DOM ranges and follows content mutation, resizing and scrolling. Code, math, image and unsupported element tails hide it rather than anchoring to an earlier paragraph. Shared `deriveTailSignal` identifies invisible link definitions and footnote-definition tails; a footnote cursor is shown only when its actual footer is in this component. Observers and animation frames are released on unmount. The default animation respects reduced motion.

The exported `AIMarkdownStreamingCursor` has no declared custom props. Its default slot supplies the indicator, falling back to `▍`. It measures its direct parent and renders an absolutely positioned, `aria-hidden` shell. Prefer the renderer's `cursor` slot, which keeps the component inside the correct measurement root and supplies the tail markers. If mounting the cursor directly, your wrapper owns its placement and mount/unmount condition; the standalone component does not read a `streaming` prop.

## API and distribution

The root exports `AIMarkdown` (also default), `AIMarkdownDocuments`, `AIMarkdownSmoothStream`, `AIMarkdownStreamingCursor`, `useSmoothStream` and `useDocumentSmoothStream`, plus their prop/context/input types. It re-exports the sealed plugin catalog, LaTeX/remend preprocessor factories, schema extension and default URL policy. See the [checked public declaration](../../../../tooling/api-reports/vue.api.txt) for exact names and signatures.

ESM and CJS each have development and production entries, with matching declaration files. Vue, core and engine remain external. There is no React peer, React context or `use client` directive. The public package exposes only its root, stylesheet and `package.json`; lifecycle helpers and the HAST converter are implementation details. The adapter shares the core pipeline sessions and contribution preparation with React but not its block planner or per-block render cache: each frame's HAST is converted to VNodes whole and Vue's patcher diffs the result.

## Verification and scope

```bash
pnpm build
pnpm --filter @ai-markdown/vue typecheck
pnpm --filter @ai-markdown/vue test
pnpm test:vue-browser
pnpm test:vue-browser:compat
pnpm check:public-api
pnpm test:packed-consumers
```

Unit tests exercise SSR, sanitization, custom rendering and lifecycle publication/release. Browser tests cover three adapter integration paths: standalone hydration; cross-chunk references and document switching; customization, smooth waiting/drain and cursor layout. Packed consumers load ESM/CJS in both export conditions, compile installed declarations and resolve CSS outside the workspace.

This implementation does not claim React/Mantine UI parity: Mantine remains React-only, and Vue has no built-in Mermaid/code-toolbar integration. Nuxt-specific packaging and KeepAlive/Suspense combinations require their own integration coverage before being advertised. Parsing correctness continues to use the repository's shared oracle and release soak gates.

## Interactive examples

Run `pnpm storybook:vue` from the repository root. The development launcher resolves package source and styles directly for live updates on port 6008; `pnpm storybook` also starts React and the combined entry on port 6006.

The chapter names and order follow the React catalog. Start with **Streaming/Streaming Basics**, then **Incremental Parsing**, **Smooth Streaming**, **Streaming Cursor**, **Turn Taking** and **Error Recovery** for the corresponding lifecycle contracts. **Documents/Cross-Chunk Coordination** covers late definitions and repeated footnotes; **Definition Lifecycle** covers updates and isolation. **Basics/Engine Plugins** demonstrates reactive plugin selection. **Customization/Custom Components** and **Metadata** cover mapping, scoped slots and context; **URL Sanitization**, **Content Preprocessors** and **Orphan References** cover output policies. Each chapter includes usage notes and browser assertions; relevant examples expose editable Controls.

React-specific typography tokens, extra-style registries, context factories, Mantine widgets and render profiling remain separate. The Vue Introduction explains those boundaries; the shared catalog guide maps all common chapters and records renamed Vue story URLs.

General examples read corpus excerpts. Cross-chunk and plugin syntax fixtures remain purpose-built to isolate their contracts. See the [catalog guide](https://ai-markdown.github.io/docs/guides/storybook/) for comparable React examples and run `pnpm test:storybook:vue` to verify the Vue stories in Chromium.

## Browser stress verification

After building the workspace, run `pnpm test:vue-browser` from the repository root. This command is included in CI, release verification, and local preflight. It checks hydration, cross-chunk references, custom rendering, smooth-stream turn-taking, and cursor placement in Chromium.

The same command keeps a document provider mounted through 24 document lifecycles and 288 append updates. It checks that queued chunks wait for their predecessor, completion drains correctly, cancelling a producing predecessor releases its successor, replacement and document switches update the rendered result, and unmount releases every instrumented document subscription. Weak references to actual registries and smooth coordinators must clear after forced garbage collection while the provider remains mounted. This catches retained document state without relying on a noisy absolute heap-size threshold.

These are bounded browser regressions, not an engine equivalence soak or a proof of unlimited-session memory stability. Forced-GC ownership checks remain Chromium-specific; Firefox/WebKit run the functional hydration, reference, customization, smooth-stream and cursor paths through `pnpm test:vue-browser:compat`. These checks do not establish Nuxt, KeepAlive or Suspense integration. The engine's separate six-leg campaign does not substitute for these Vue lifecycle checks.

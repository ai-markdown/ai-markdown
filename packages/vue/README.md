# @ai-markdown/vue

[Documentation](https://ai-markdown.github.io/docs/vue/) · [Examples](https://ai-markdown.github.io/examples/) · [Website](https://ai-markdown.github.io/)

[![@ai-markdown/vue stable](https://img.shields.io/npm/v/@ai-markdown/vue?label=npm&color=blue)](https://www.npmjs.com/package/@ai-markdown/vue?activeTab=versions)
[![@ai-markdown/vue monthly downloads](https://img.shields.io/npm/dm/@ai-markdown/vue?label=downloads%2Fmonth&color=blue)](https://www.npmjs.com/package/@ai-markdown/vue)
[![TypeScript declarations included](https://img.shields.io/badge/TypeScript-included-3178c6?logo=typescript&logoColor=white)](https://github.com/ai-markdown/ai-markdown/tree/main/packages/vue)
[![MIT license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/ai-markdown/ai-markdown/blob/main/LICENSE)

[![Vue ^3.5](https://img.shields.io/badge/Vue-%5E3.5-42b883?logo=vuedotjs&logoColor=white)](#requirements-and-dependencies)

Render Markdown as Vue VNodes, including streaming responses, shared references, scoped slots and smooth reveal. The adapter shares parsing with React while following Vue's component and lifecycle APIs.

## Requirements and dependencies

- Vue `^3.5.0`, including `useId()` for server/hydration identity.
- Node `^20.19.0 || >=22.12.0` for server/build consumers.
- ESM and CJS with TypeScript declarations. Core and engine are exact-version dependencies; applications do not install them separately.
- KaTeX is an optional peer. Install it directly when importing its stylesheet for math.
- See the [full environment and browser requirements](https://ai-markdown.github.io/docs/vue/#requirements-and-dependencies) for browser APIs and verification scope.

## Installation

```bash
pnpm add @ai-markdown/vue vue@^3.5.0 katex
```

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

Pass the complete accumulated string as `content`. Your application owns transport framing, cancellation and retries. The base stylesheet supplies code/table layout and cursor animation; KaTeX CSS is separate.

Vue uses `components` and named element slots for customization. It has no React context hooks, `blockMemo` prop, React typography variants or Mantine integration. Nuxt-specific packaging and KeepAlive/Suspense combinations require separate integration coverage.

A standalone `AIMarkdown` defaults `preserveOrphanReferences` to `false`. Inside `AIMarkdownDocuments` the wrapper's own `preserveOrphanReferences` prop (default `true`) applies to every chunk and wins over the chunk's prop, so a footnote definition whose reference never arrives stays in the document footer. Both adapters resolve the wrapper value first; standalone React defaults to `true`, while standalone Vue defaults to `false`.

## Documentation

- [Component and composable reference](https://ai-markdown.github.io/docs/vue/).
- [Streaming](https://ai-markdown.github.io/docs/guides/vue-streaming/): reactive input, smooth reveal and live getters.
- [Documents and references](https://ai-markdown.github.io/docs/guides/vue-documents/): sections, ordering and isolation.
- [Custom rendering and styling](https://ai-markdown.github.io/docs/guides/vue-customization/).
- [SSR and lifecycle](https://ai-markdown.github.io/docs/guides/vue-ssr/): hydration and mounted contributions.

The independent site owns the detailed API and guides. This README provides the package's minimal installation and usage path.

## License

MIT

### Shared syntax highlighters

`createMarkdownCodeBlock({ highlighter })` accepts the framework-independent
`CodeHighlightAdapter` from `@ai-markdown/core/components` (also re-exported by
`@ai-markdown/vue/components`). Core owns language conversion, readiness and
stale-load handling; Vue composables bind lifecycle and render tokens or trusted
HTML. `highlighter` takes precedence over the existing `highlight` callback.
Legacy callbacks still receive highlight.js names by default; use
`languageFormat: CodeLanguageFormat.Shiki` for Shiki names without losing TSX/Vue
information. See [the shared contract and examples](../../apps/docs/content/guides/rich-components.md#shared-code-highlighting)
and Storybook **Customization / Code Highlighting**.

Pierre is available through `createPierreHighlightAdapter({ load })`. Return the
`@pierre/highlights` module (including `LiveTokenizer`) and `themes: { light, dark }`
from the loader. The adapter defaults to native incremental highlighting while
`streaming` is true, with isolated state for each code block. Set `streaming` to
false when the document finishes to release live WASM instances. Use
`incremental: false` for full-frame highlighting or comparison. Static blocks do
not allocate live tokenizers; SSR renders source and initializes after mounting.
See [the Pierre setup example](../../apps/docs/content/guides/rich-components.md#pierre-highlights).

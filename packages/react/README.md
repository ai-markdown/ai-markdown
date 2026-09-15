# @ai-markdown/react

[Documentation](https://ai-markdown.github.io/docs/react/) · [Examples](https://ai-markdown.github.io/examples/) · [Website](https://ai-markdown.github.io/)

[![@ai-markdown/react stable](https://img.shields.io/npm/v/@ai-markdown/react?label=npm&color=blue)](https://www.npmjs.com/package/@ai-markdown/react?activeTab=versions)
[![@ai-markdown/react monthly downloads](https://img.shields.io/npm/dm/@ai-markdown/react?label=downloads%2Fmonth&color=blue)](https://www.npmjs.com/package/@ai-markdown/react)
[![TypeScript declarations included](https://img.shields.io/badge/TypeScript-included-3178c6?logo=typescript&logoColor=white)](https://github.com/ai-markdown/ai-markdown/tree/main/packages/react)
[![MIT license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/ai-markdown/ai-markdown/blob/main/LICENSE)

[![React 19](https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white)](#compatibility)

Render accumulated Markdown in React, including streaming responses, GFM, math and CJK text. Customize element renderers, typography and metadata, or use [Mantine](https://ai-markdown.github.io/docs/react/mantine/) for highlighted code and Mermaid diagrams. Vue applications use [@ai-markdown/vue](https://ai-markdown.github.io/docs/vue/).

## Compatibility

- React and React DOM `^19.0.0`.
- Node `^20.19.0 || >=22.12.0` for server/build consumers.
- ESM and CJS with TypeScript declarations. Core and engine are exact-version dependencies; applications do not install them separately.
- KaTeX is an optional peer. Install it directly when importing its stylesheet for math.
- `<AIMarkdownDocuments>` uses `WeakRef` and `FinalizationRegistry` (ES2021) when the runtime provides them, so a per-document scope resolved by a render that never commits can be garbage collected. On a runtime without them the wrapper keeps strong references instead: scopes are still released when their last chunk unmounts, but a scope resolved only by an abandoned render stays cached until a chunk registers into it and later releases it.

## Installation

```bash
pnpm add @ai-markdown/react react@^19 react-dom@^19 katex
```

## Quick Start

```tsx
import AIMarkdown from '@ai-markdown/react';
import '@ai-markdown/react/typography/default.css';
import 'katex/dist/katex.min.css';

export function Answer() {
  return <AIMarkdown content="Hello **world**! Math: $E = mc^2$" />;
}
```

Pass the complete current string as `content`, appending decoded transport text to your application state. `streaming` describes producer state; incremental parsing is enabled separately by default. In a React Server Components application, use a client boundary and import global CSS from the location permitted by your host framework.

Code fences remain code text in this adapter. Syntax highlighting and Mermaid rendering require Mantine or your own component. React-specific CSS tokens and hooks are not Vue APIs.

## Documentation

- [Installation and API reference](https://ai-markdown.github.io/docs/react/): props, hooks, providers, public exports and compatibility details.
- [Streaming chat](https://ai-markdown.github.io/docs/guides/streaming-chat-example/) and [smooth streaming](https://ai-markdown.github.io/docs/guides/smooth-streaming/).
- [Documents and references](https://ai-markdown.github.io/docs/guides/cross-chunk-coordination/).
- [Custom components](https://ai-markdown.github.io/docs/guides/custom-components/) and [CSS tokens](https://ai-markdown.github.io/docs/guides/design-tokens/).
- [Package migration](https://ai-markdown.github.io/docs/guides/framework-transition/) from the former `@ai-react-markdown` scope.

The independent site owns the detailed API and guides. This README provides the package's minimal installation and usage path.

## License

MIT

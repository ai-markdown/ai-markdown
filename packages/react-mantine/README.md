# @ai-markdown/react-mantine

[Documentation](https://ai-markdown.github.io/docs/react/mantine/) · [Examples](https://ai-markdown.github.io/examples/) · [Website](https://ai-markdown.github.io/)

[![@ai-markdown/react-mantine stable](https://img.shields.io/npm/v/@ai-markdown/react-mantine?label=npm&color=blue)](https://www.npmjs.com/package/@ai-markdown/react-mantine?activeTab=versions)
[![@ai-markdown/react-mantine monthly downloads](https://img.shields.io/npm/dm/@ai-markdown/react-mantine?label=downloads%2Fmonth&color=blue)](https://www.npmjs.com/package/@ai-markdown/react-mantine)
[![TypeScript declarations included](https://img.shields.io/badge/TypeScript-included-3178c6?logo=typescript&logoColor=white)](https://github.com/ai-markdown/ai-markdown/tree/main/packages/react-mantine)
[![MIT license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/ai-markdown/ai-markdown/blob/main/LICENSE)

[![React 19](https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white)](#compatibility)
[![Mantine 9](https://img.shields.io/badge/Mantine-9-339af0?logo=mantine&logoColor=white)](#compatibility)

Add Mantine presentation to the React Markdown renderer: themed typography, highlighted and expandable code, source-preserving JSON formatting, and Mermaid diagrams. Parsing, URL policy, metadata and document coordination follow the React adapter.

## Compatibility

- React and React DOM `^19.0.0`.
- `@mantine/core` and `@mantine/code-highlight` `^9.0.0`.
- highlight.js `^11.11.2` is an optional peer. The package never imports it; install it for Mantine's highlight.js adapter (the Quick Start). An app that highlights with another adapter (Shiki) can leave it out.
- A compatible `@ai-markdown/react` peer; upgrade the React adapter and integration together. See [the declared peer range](./package.json).
- Node `^20.19.0 || >=22.12.0` for server/build consumers.
- This integration is React-only. Vue applications use `@ai-markdown/vue`.

## Installation

```bash
pnpm add @ai-markdown/react-mantine @ai-markdown/react \
  react@^19 react-dom@^19 @mantine/core@^9 @mantine/code-highlight@^9 \
  highlight.js@^11.11.2 katex
```

## Quick Start

```tsx
import { MantineProvider } from '@mantine/core';
import { CodeHighlightAdapterProvider, createHighlightJsAdapter } from '@mantine/code-highlight';
import hljs from 'highlight.js';
import MantineAIMarkdown from '@ai-markdown/react-mantine';
import '@mantine/core/styles.css';
import '@mantine/code-highlight/styles.css';
import '@ai-markdown/react-mantine/styles.css';
import 'katex/dist/katex.min.css';

const adapter = createHighlightJsAdapter(hljs);

export function Answer() {
  return (
    <MantineProvider>
      <CodeHighlightAdapterProvider adapter={adapter}>
        <MantineAIMarkdown content="Hello **world**! Math: $E = mc^2$" />
      </CodeHighlightAdapterProvider>
    </MantineProvider>
  );
}
```

Both providers and the stylesheet imports are part of this setup. KaTeX CSS is required for the math example. Keep the adapter object stable. Replacing the `pre` renderer transfers code formatting, copy, highlighting and diagram behavior to your component.

Language auto-detection for unlabelled fences is on by default and uses [`@ai-markdown/code-language-detector`](https://ai-markdown.github.io/docs/plugins/code-language-detector/), a dependency of this package, so it needs no further setup. Detection is synchronous and runs during render, server rendering included. A block the detector cannot place with confidence stays plaintext labelled "unknown", and the detector never overrides an explicit fence language. `codeBlock.languageFormat` names your adapter (highlight.js by default), and every language, whether written on the fence or detected, is handed to the highlighter in that adapter's spelling: ` ```objc ` reaches highlight.js as `objectivec`, and ` ```txt ` reaches Shiki as `text`. The tab label keeps the name as written:

```tsx
<MantineAIMarkdown content={content} /> // detection is on by default
// with Mantine's Shiki adapter:
// codeBlock={{ languageFormat: MantineLanguageFormat.Shiki }}
// to keep unlabelled blocks plaintext:
// codeBlock={{ autoDetectUnknownLanguage: false }}
```

Mermaid renders while streaming are throttled by `codeBlock.mermaidIntervalMs` (default 300 ms; the final source always renders once streaming ends), and input above mermaid's `maxTextSize` shows an error instead of a placeholder diagram.

## Documentation

- [Installation, props and exports](https://ai-markdown.github.io/docs/react/mantine/).
- [Code block rendering](https://ai-markdown.github.io/docs/react/mantine/#code-block-rendering) and [Mermaid diagrams](https://ai-markdown.github.io/docs/react/mantine/#mermaid-diagrams).
- [Streaming code](https://ai-markdown.github.io/docs/react/mantine/#streaming-code-source-display-and-asynchronous-work): source, displayed text and asynchronous work.
- [React API](https://ai-markdown.github.io/docs/react/) for inherited behavior.

The independent site owns the detailed API and guides. This README provides the package's minimal installation and usage path.

## License

MIT

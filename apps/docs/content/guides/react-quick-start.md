# React quick start

Use React and React DOM 19. Server/build consumers need Node `^20.19.0 || >=22.12.0`. Core and engine are resolved as dependencies; you do not install them separately.

## Installation

```bash
pnpm add @ai-markdown/react react@^19 react-dom@^19 katex
```

## Render Markdown

```tsx
import AIMarkdown from '@ai-markdown/react';
import '@ai-markdown/react/typography/default.css';
import 'katex/dist/katex.min.css';

export function Answer() {
  return <AIMarkdown content="Hello **world**! Math: $E = mc^2$" />;
}
```

Pass the complete current string as `content`, appending decoded transport text to your application state. `streaming` describes producer state; incremental parsing is enabled separately by default. In a React Server Components application, use a client boundary and import global CSS from the location permitted by your host framework.

Base Markdown rendering leaves code fences as code text. Syntax highlighting and Mermaid rendering come from the optional [`@ai-markdown/react/components`](rich-components.md) entries, Mantine, or your own component. React-specific CSS tokens and hooks are not Vue APIs.

## Choose your next task

[Streaming chat](streaming-chat-example.md), [custom rendering](custom-components.md), [SSR and hydration](react-ssr.md), or the [React reference](../reference/react.md).

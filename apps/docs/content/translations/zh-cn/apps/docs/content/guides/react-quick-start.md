# React 快速开始

使用 React 和 React DOM 19。服务端与构建环境需要 Node `^20.19.0 || >=22.12.0`。core 与 engine 作为依赖自动解析，无需单独安装。

## 安装

```bash
pnpm add @ai-markdown/react react@^19 react-dom@^19 katex
```

## 渲染 Markdown

```tsx
import AIMarkdown from '@ai-markdown/react';
import '@ai-markdown/react/typography/default.css';
import 'katex/dist/katex.min.css';

export function Answer() {
  return <AIMarkdown content="Hello **world**! Math: $E = mc^2$" />;
}
```

将完整的当前字符串作为 `content` 传入，把解码后的网络数据持续追加到应用状态中。`streaming` 描述生成端的状态；增量解析在客户端默认开启。在 React Server Components 应用中，请在客户端边界内使用，并按照宿主框架的规范导入全局 CSS。

本适配器中代码围栏仅作为代码文本渲染。语法高亮与 Mermaid 图表需要使用 Mantine 或自定义组件。React 专属的 CSS 变量和 Hooks 不适用于 Vue。

## 下一步

[流式对话示例](streaming-chat-example.md)、[自定义渲染](custom-components.md)、[服务端渲染与水合](react-ssr.md)，或查看 [React 参考](../reference/react.md)。

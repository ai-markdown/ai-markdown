# Mantine 快速开始

使用 React 19、Mantine 9 与 highlight.js `^11.11.2`。请将 React 适配器与 Mantine 集成一同升级。服务端与构建环境需要 Node `^20.19.0 || >=22.12.0`。此包为 React 集成；Vue 请使用其独立适配器。

## 安装

```bash
pnpm add @ai-markdown/react-mantine @ai-markdown/react \
  react@^19 react-dom@^19 @mantine/core@^9 @mantine/code-highlight@^9 \
  highlight.js@^11.11.2 katex
```

## 渲染 Markdown

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

两个 Provider 和样式表的导入都是必须的基础配置。数学公式需要引入 KaTeX CSS。请保持 `adapter` 对象的引用稳定。替换 `pre` 元素渲染器会将代码格式化、复制按钮、语法高亮和 Mermaid 图表行为转由自定义组件处理。

## 下一步

[代码块与图表](mantine-code-blocks.md)、[主题配置](../reference/react-mantine.md#configuration)，或查看 [Mantine 参考](../reference/react-mantine.md)。

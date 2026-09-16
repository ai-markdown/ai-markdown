# Mantine 参考

`@ai-markdown/react-mantine` 为 React 渲染器注入 Mantine 呈现体系：支持主题排版、可折叠且带语法高亮的代码块、保留原始词法的 JSON 格式化以及 Mermaid 图表。其 `MantineAIMarkdown` 包装组件完整接收 React 适配器的属性，并扩展了一个 `codeBlock` 行为控制组。

底层解析、URL 策略、元数据以及跨片段引用依然由底层引擎与 React 适配器负责。本集成包提供了默认的组件插槽和 `pre` 渲染器；调用方传入的自定义组件具有更高优先级。在体验代码块特性之前，请先按照快速开始完成样式导入和双层 Provider 的配置。若你替换了 `pre` 渲染器，本文所介绍的排版、复制、高亮和图表行为将转由你自己的代码处理。

> **从 1.x 升级？** v2.0.0 移除了 1.x 基于对象的 `config` 通道——Mantine 代码块选项现已收归平铺的 `codeBlock` 属性，渲染状态 Hook 也由窄订阅 Hook 与 `useMantineCodeBlockOptions()` 取代。详见[迁移指南](https://ai-markdown.github.io/docs/guides/migrating-to-v2/)。

<span id="what-it-adds-to-the-react-adapter"></span>

## 为 React 适配器增加的能力

- **Mantine 排版**：Markdown 内容包裹在 Mantine 的 `<Typography>` 中，继承当前主题的字体系列、行高与颜色 Token。
- **语法高亮**：代码块通过 `@mantine/code-highlight` 及你提供的适配器（highlight.js 或 Shiki）渲染，提供带有语言标签的选项卡、展开/折叠功能，并可借助 `@ai-markdown/code-language-detector` 自动检测未标注语言的代码块。
- **Mermaid 图表**：声明了 `mermaid` 的代码围栏渲染为交互式 SVG 矢量图表，支持深浅主题切换、查看源码、一键复制和在新窗口中打开。
- **JSON 美化展示**：声明为 `json` 的代码块在格式合法时以 2 空格缩进排版展示，同时保留数值 Token、重复键及其原始顺序；嵌套了 JSON 文档（对象或数组，常见于大模型工具调用返回）的字符串值同样会被递归展开，而字面量风格的原始字符串（如 `"true"`、`"123"`）保持原样。
- **自动配色方案自适应**：未显式传入 `colorScheme` 时，跟随当前 `MantineProvider`；处于 `auto` 时在客户端首帧即读取系统偏好（服务端输出为浅色），并透传给核心渲染器。
- **Mantine 作用域样式**：额外样式包装器重写了 Mantine 间距与字号自定义属性，改用相对 `em` 单位，确保在任意基础字号下均等比例缩放。

所有 React 适配器特性（GFM、LaTeX 数学公式、CJK 中文排版支持、流式渲染、元数据上下文、内容预处理器、自定义组件、基于 `<AIMarkdownDocuments>` 的跨片段协调）均从 `@ai-markdown/react` 完整继承。基础 API 请参阅 [React 参考](react.md)。

<span id="package-family"></span>

## 相关包

| 包名                                                                                                       | 职责                                                                                                           | 版本策略                                           |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| [`@ai-markdown/core`](https://www.npmjs.com/package/@ai-markdown/core)                                     | 框架无关的会话管理、块级规划、贡献管理与平滑协调                                                               | 统一版本发布；以精确版本依赖 Engine                |
| [`@ai-markdown/react`](https://www.npmjs.com/package/@ai-markdown/react)                                   | React 渲染器——提供 `<AIMarkdown>`、`<AIMarkdownSmoothStream>`、Hooks 与 Provider                               | 统一版本发布                                       |
| [`@ai-markdown/vue`](https://www.npmjs.com/package/@ai-markdown/vue)                                       | Vue 3.5 渲染器——提供组件、作用域插槽、SSR/水合与平滑组合式函数                                                 | 统一版本发布；精确依赖 core 与 engine              |
| [`@ai-markdown/react-mantine`](https://www.npmjs.com/package/@ai-markdown/react-mantine)                   | Mantine UI 绑定——主题排版、代码高亮标签页、Mermaid、配色联动                                                   | 统一版本发布；声明兼容的 React 3.x 对等依赖        |
| [`@ai-markdown/engine`](https://www.npmjs.com/package/@ai-markdown/engine)                                 | 框架中立引擎——增量解析、LaTeX 预处理、插件管线与跨分块注册表                                                   | 统一版本发布；被共享 core 与适配器严格锁定依赖版本 |
| [`@ai-markdown/remark-mark-highlight`](https://www.npmjs.com/package/@ai-markdown/remark-mark-highlight)   | 支持 `==mark==` 高亮语法的 remark 插件                                                                         | 独立语义化版本                                     |
| [`@ai-markdown/code-language-detector`](https://www.npmjs.com/package/@ai-markdown/code-language-detector) | 为未标注语言的代码块做启发式语言检测，并把 fence 上的语言名映射为 Shiki 或 highlight.js 的写法；本包的常规依赖 | 独立语义化版本                                     |

<span id="compatibility"></span>

## 兼容性与运行环境

| 项目         | 规格要求                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------- |
| Mantine      | `@mantine/core` ^9 与 `@mantine/code-highlight` ^9（对等依赖）                               |
| highlight.js | ^11.11.2（可选对等依赖；包本身不会导入它——仅 Mantine 的 highlight.js 适配器需要）            |
| React        | ^19.0.0                                                                                      |
| Node         | `^20.19.0 \|\| >=22.12.0`（`engines.node`）                                                  |
| 模块格式     | 包含类型定义的 ESM 与 CJS；编译后的样式文件通过 `@ai-markdown/react-mantine/styles.css` 导出 |
| React 适配器 | 参见[下方对等依赖范围](#peer-dependencies)；建议两个包保持同步升级                           |

<span id="installation"></span>

## 安装与引入

```bash
# npm
npm install @ai-markdown/react-mantine @ai-markdown/react

# pnpm
pnpm add @ai-markdown/react-mantine @ai-markdown/react

# yarn
yarn add @ai-markdown/react-mantine @ai-markdown/react
```

上述命令安装集成包及其 React 对等依赖。若是全新的 React 应用，还需安装 UI 对等依赖以及数学公式所需的 KaTeX：

```bash
pnpm add react@^19 react-dom@^19 @mantine/core@^9 @mantine/code-highlight@^9 highlight.js@^11.11.2 katex
```

Mantine 集成基于 React 适配器构建，不直接依赖共享 core。Vue 应用请参阅 [Vue 适配器参考](vue.md)；本包仅提供 React 组件。

<span id="peer-dependencies"></span>

### 对等依赖

```json
{
  "react": "^19.0.0",
  "react-dom": "^19.0.0",
  "@ai-markdown/react": "^3.1.0",
  "@mantine/core": "^9.0.0",
  "@mantine/code-highlight": "^9.0.0",
  "highlight.js": "^11.11.2"
}
```

`highlight.js` 声明为可选对等依赖（`peerDependenciesMeta`）。包内没有任何对它的导入，因此未安装时构建也能通过；只有使用 Mantine 的 highlight.js 适配器时才需要安装。语言自动检测不依赖它，而是由 `@ai-markdown/code-language-detector` 完成，该包是常规依赖，会随本包一起安装。

<span id="css-dependencies"></span>

### CSS 样式依赖

在应用入口文件中导入必需的样式表：

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

<span id="quick-start"></span>

## 快速开始

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

### 流式使用示例

```tsx
function StreamingChat({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  return <MantineAIMarkdown content={content} streaming={isStreaming} />;
}
```

<span id="props-api-reference"></span>

## 属性 API 参考

### `MantineAIMarkdownProps<TMetadata>`

`MantineAIMarkdownProps<TMetadata>` 继承自 `AIMarkdownProps<TMetadata>`——完整支持 React 适配器的所有属性（`enginePlugins`、`blockMemo`、`incrementalParse`、`preserveOrphanReferences`、`streamingCursor` 等），并扩展了 Mantine 专有的 `codeBlock` 属性。下表列出了具有 Mantine 默认值覆盖或新增的属性（未列出的属性完全继承 React 适配器默认值——详见 [React 属性参考](../guides/api/react-props.md)）。

| 属性               | 类型                               | 默认值                           | 说明                                                                                                                                                 |
| ------------------ | ---------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `colorScheme`      | `AIMarkdownColorScheme`            | 自动检测                         | 配色方案。未传入时跟随 `MantineProvider`：其 `light`/`dark`，或在 `auto` 下取系统偏好（服务端为浅色）。                                              |
| `customComponents` | `AIMarkdownCustomComponents`       | Mantine 默认组件表               | 自定义组件覆盖，与 Mantine 内置的 `<pre>` 处理器合并。调用方的覆盖项优先生效——在此传入 `pre` 会关闭 Mantine 的代码块增强特性。                       |
| `Typography`       | `AIMarkdownTypographyComponent`    | `MantineAIMarkdownTypography`    | 排版样式包装组件。                                                                                                                                   |
| `ExtraStyles`      | `AIMarkdownExtraStylesComponent`   | `MantineAIMDefaultExtraStyles`   | 渲染在排版与正文之间的额外样式包装组件。                                                                                                             |
| `codeBlock`        | `Partial<MantineCodeBlockOptions>` | `defaultMantineCodeBlockOptions` | 代码块行为控制组（Mantine 专有）。该组的值整体替换生效；未传入的字段在 `useMantineCodeBlockOptions()` 内部解析为官方默认值。传入 `null` 视为未提供。 |

<span id="configuration"></span>

## 配置项说明

`codeBlock` 属性传递部分行为配置组。未传或传入 null 时不贡献 `codeBlock` 键，因此外层的 `AIMarkdownBehaviorsProvider` 可以提供该组。传入对象时会原子级替换外层组：`{ defaultExpanded: false }` 不会继承外层组的其他字段。窄订阅 Hook 会为省略的字段填充包默认值。

### `codeBlock` (`Partial<MantineCodeBlockOptions>`)

| 字段                        | 类型                    | 默认值                              | 行为说明                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------- | ----------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defaultExpanded`           | `boolean`               | `true`                              | 初始展开状态；设为 false 时长代码块默认折叠，并展示展开操作按钮                                                                                                                                                                                                                                                                                                                         |
| `autoDetectUnknownLanguage` | `boolean`               | `false`                             | 使用 `@ai-markdown/code-language-detector` 识别未标注语言代码块的语言，在渲染期间同步执行（包括服务端渲染）。检测器放弃判断的代码块保持纯文本，标签为“unknown”；检测器永远不会覆盖显式声明的围栏语言                                                                                                                                                                                    |
| `languageFormat`            | `MantineLanguageFormat` | `MantineLanguageFormat.HighlightJs` | 语言以哪套名称交给高亮器；应与 `CodeHighlightAdapterProvider` 中的适配器一致（`HighlightJs` 或 `Shiki`）。它同时作用于围栏上书写的语言和检测出的语言：使用 highlight.js 时，` ```objc ` 按 `objectivec` 高亮，` ```txt ` 按 `plaintext` 高亮；使用 Shiki 时，` ```Makefile ` 按 `make` 高亮。标签页标题保留书写的名称（转换为小写），或检测出的语言本身的名称。无法识别的值回退为默认值 |
| `formatJson`                | `boolean`               | `true`                              | 在展示时格式化合法 JSON，并保留数值 Token、重复键及其原始顺序                                                                                                                                                                                                                                                                                                                           |
| `expandNestedJson`          | `boolean`               | `true`                              | 格式化时，将包含 JSON 对象或数组的字符串值展开                                                                                                                                                                                                                                                                                                                                          |
| `highlightIntervalMs`       | `number`                | `50`                                | 合并流式追加过程中的代码展示更新；设为 0 则每次更新立即刷新                                                                                                                                                                                                                                                                                                                             |
| `mermaidIntervalMs`         | `number`                | `300`                               | 流式期间同一代码块两次 Mermaid 渲染尝试之间的最短间隔；流结束后最终源码必定渲染一次；设为 0 则每次更新都尝试                                                                                                                                                                                                                                                                            |

显式设为 undefined 的字段保留包默认值。两个间隔都必须为非负有限数字；非法数值自动回退为默认值（50 毫秒与 300 毫秒）。请勿因为组边界允许 null（视为未传）就假定单个具体字段也支持传入 null：没有任何单个字段接受 `null`。

### 示例：折叠长代码块

```tsx
<MantineAIMarkdown content={markdown} codeBlock={{ defaultExpanded: false }} />
```

未指定的选项将回退到上表中的默认值。若希望除空白符外严格保留 JSON 原始结构，设置 `expandNestedJson: false`；若希望展示最原始的 JSON 文本，设置 `formatJson: false`。这些设置均不会改变复制按钮所复制的内容。

如需在模块级复用稳定的配置片段，请使用类型扩展工厂函数：

```tsx
import { defineMantineBehaviors } from '@ai-markdown/react-mantine';

const BEHAVIORS = defineMantineBehaviors({
  blockMemo: true,
  codeBlock: { defaultExpanded: false, expandNestedJson: false },
});

<MantineAIMarkdown content={markdown} {...BEHAVIORS} streaming={isStreaming} />;
```

该工厂函数提供类型支持和浅层对象冻结，不执行默认值解析或深层合并。放在解构之后的 JSX 属性按正常执行顺序优先胜出。行为组默认值仅在 `useMantineCodeBlockOptions()` 内部注入，因此自定义代码渲染器应调用该 Hook，而不是在本地重复实现默认值逻辑。

## Hooks

### `useMantineCodeBlockOptions()`

针对 `codeBlock` 行为组的窄订阅 Hook——这是该组类型断言与默认值注入的唯一定义处。返回 `Required<MantineCodeBlockOptions>`：将调用方传入的组与 `defaultMantineCodeBlockOptions` 进行合并后的完整配置。

```tsx
import { useMantineCodeBlockOptions } from '@ai-markdown/react-mantine';

function MyCodeBlock() {
  const { defaultExpanded, autoDetectUnknownLanguage } = useMantineCodeBlockOptions();
  // ...
}
```

对于其他所有状态（流式状态、主题、文档 ID、核心行为开关），请直接使用 React 适配器的窄订阅 Hook：`useAIMarkdownState()`、`useAIMarkdownTheme()`、`useAIMarkdownDocument()`、`useAIMarkdownBehaviors()`，或在低频组件中使用聚合 Hook `useAIMarkdown()`。详见 [React Hooks 参考](../guides/api/react-hooks.md#hooks)。

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

对核心 `useAIMarkdownMetadata` 的带类型封装，默认泛型 `TMetadata` 为 `MantineAIMarkdownMetadata`。元数据在独立的 React 上下文中管理，因此元数据的更新不会导致仅使用渲染状态的组件产生不必要的重渲染。

```tsx
import { useMantineAIMarkdownMetadata } from '@ai-markdown/react-mantine';

function MyComponent() {
  const metadata = useMantineAIMarkdownMetadata<{ messageId: string }>();
  // ...
}
```

## 排版与样式定制

### `MantineAIMarkdownTypography`

默认排版包装器。渲染 Mantine 的 `<Typography>`，带有 `w="100%"` 与 `fz={fontSize}`，使所有渲染出的 Markdown 内容继承当前生效主题的字体系列、行高与颜色 Token。接收携带 React 适配器 CSS 自定义属性（`--aim-font-size-root`）的 `style` 属性，并透传给 Mantine 根容器。

如需调整主题样式，可通过 `Typography` 属性传入自定义组件进行替换，但建议优先在其基础上扩展而非彻底重写——默认包装器本身保持了极简设计。

### `MantineAIMDefaultExtraStyles`

默认 `ExtraStyles` 包装器。渲染一个 `<div className="aim-mantine-extra-styles">`，用于激活本包的作用域 CSS 覆盖规则：

- 将 Mantine 的间距与字号 CSS 自定义属性转换为相对 `em` 单位（确保在任意基础字号下均等比例缩放）
- 针对 AI 生成内容的标题、列表、段落、引用块以及行内代码间距进行了微调
- 优化了定义列表布局

在应用入口导入 `@ai-markdown/react-mantine/styles.css` 即可生效。传入自定义 `ExtraStyles` 属性可绕过这些默认样式。

<span id="code-block-rendering"></span>

## 代码块渲染

<span id="code-highlight-adapter"></span>
<span id="language-auto-detection"></span>
<span id="preloading-the-on-demand-assets"></span>

渲染行为和配置示例请参阅[代码块渲染指南](../guides/mantine-code-blocks.md#code-block-rendering)。

<span id="mermaid-diagrams"></span>

## Mermaid 图表

渲染行为和配置示例请参阅 [Mermaid 图表指南](../guides/mantine-code-blocks.md#mermaid-diagrams)。

## 配色方案集成

`MantineAIMarkdown` 按以下优先级确定当前生效的配色方案：

1. 显式传入非 null 的 `colorScheme` 属性（undefined 使用包装层默认逻辑；运行时的 null 会到达 React 适配器的回退处理）
2. 当前活跃 `MantineProvider` 的配色方案：设置为 `light` 或 `dark` 时直接使用；为 `auto` 时通过 `useSyncExternalStore` 在客户端首帧读取系统的 `prefers-color-scheme` 查询（服务端输出为浅色；水合时再以客户端值重新渲染，不会产生不匹配）。这里不使用 Mantine 自带的 `useComputedColorScheme`，因为它在 `auto` 下先以默认值渲染、再在副作用中读取查询，深色系统上会先提交一帧浅色。

```tsx
// Follows Mantine's color scheme automatically
<MantineAIMarkdown content={markdown} />

// Explicit override
<MantineAIMarkdown content={markdown} colorScheme="dark" />
```

解析出的配色方案将被透传给：

- 核心 `<AIMarkdown>` 以供排版主题使用
- Mermaid 图表渲染（用于暗色 / 亮色主题切换）
- 额外样式包装器以应用适配色彩的 CSS 规则

## 自定义组件

调用方传入的 `customComponents` 会与 Mantine 默认组件表合并；调用方的覆盖项优先：

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

若要覆盖默认的 `<pre>` 处理器（此举将不再使用内置的代码高亮、Mermaid 和 JSON 美化），请在自定义组件表中包含 `pre` 映射。

<span id="cross-chunk-coordination"></span>

## 跨片段文档协调

`<MantineAIMarkdown>` 参与跨片段协调的方式与 `<AIMarkdown>` 完全一致。在 `@ai-markdown/react` 的 `<AIMarkdownDocuments>` 中包裹多个分块，并共享同一个 `documentId`，即可跨分块协调脚注、链接引用和图片引用：

```tsx
import { AIMarkdownDocuments } from '@ai-markdown/react';
import MantineAIMarkdown from '@ai-markdown/react-mantine';

<AIMarkdownDocuments>
  {message.chunks.map((c, i) => (
    <MantineAIMarkdown key={i} content={c} documentId={message.id} />
  ))}
</AIMarkdownDocuments>;
```

完整的 `<AIMarkdownDocuments>` API 与 `useDocumentRegistry` Hook 详见 [React 参考文档中的跨分块协调章节](react.md#cross-chunk-coordination)。

<span id="smooth-streaming"></span>

## 平滑流式输出

通过 React 适配器的 `useSmoothStream` Hook，打字机节奏可以接入 `<MantineAIMarkdown>`——其返回值格式与组件属性一致，支持直接解构展开：

```tsx
import { useSmoothStream } from '@ai-markdown/react';
import MantineAIMarkdown from '@ai-markdown/react-mantine';

function ChatMessage({ markdown, pending }: { markdown: string; pending: boolean }) {
  const smooth = useSmoothStream({ content: markdown, streaming: pending, pacing: 'balanced' });
  return <MantineAIMarkdown {...smooth} />;
}
```

对于包裹在 `<AIMarkdownDocuments>` 下的多分块文档，可替换为 `useDocumentSmoothStream`，共享同一 `documentId` 的分块将实现依次轮流呈现（单打字机、单光标）。请确保向 Hook 和组件传入**完全相同的** ID——Hook 无法自动进行双向校验：

```tsx
import { useDocumentSmoothStream } from '@ai-markdown/react';

function ChatChunk({ id, markdown, pending }: { id: string; markdown: string; pending: boolean }) {
  const smooth = useDocumentSmoothStream({ documentId: id, content: markdown, streaming: pending });
  return <MantineAIMarkdown {...smooth} documentId={id} />;
}
```

关于节奏控制模型、预设与避坑指南，请参阅[平滑流式指南](../guides/smooth-streaming.md)。

<span id="architecture-overview"></span>

## 架构概览

```text
<MantineAIMarkdown>
  └─ wraps <AIMarkdown> with Mantine defaults:
       Typography          = MantineAIMarkdownTypography      (Mantine <Typography>)
       ExtraStyles         = MantineAIMDefaultExtraStyles     (aim-mantine-extra-styles scope)
       customComponents.pre = MantineAIMPreCode               (CodeHighlight + Mermaid + JSON pretty-print)
       colorScheme         = provider scheme / system query    (when not overridden)
```

调用方传入的 `Typography`、`ExtraStyles` 与 `customComponents` 属性会在对应的插槽处覆盖 Mantine 默认组件。在被包裹的 `<AIMarkdown>` 内部，其余渲染管线（五个系统上下文、内容预处理器、remark/rehype 插件链）与独立的 React 适配器完全一致——详见 [React 架构概览](react.md#architecture-overview)。

## 导出的 API

### 默认导出

- `MantineAIMarkdown`：主渲染组件（已做 memo 优化）

### 组件

- `MantineAIMarkdownTypography`：Mantine 主题排版样式包装器
- `MantineAIMDefaultExtraStyles`：带有 Mantine CSS 作用域限制的默认额外样式包装器

### 类型定义

- `MantineAIMarkdownProps`
- `MantineAIMarkdownMetadata`
- `MantineCodeBlockOptions`：`codeBlock` 组的结构定义
- `MantineBehaviorProps`：`defineMantineBehaviors` 的入参类型

### 常量

- `defaultMantineCodeBlockOptions`：`codeBlock` 行为控制组的内置默认值（已冻结）

### 枚举

- `MantineLanguageFormat`：`codeBlock.languageFormat` 的取值，`HighlightJs`（`'highlight-js'`，默认值）或 `Shiki`（`'shiki'`）

### 资源辅助工具

- `preloadMantineCodeAssets(): Promise<void>`：提前触发 Mermaid 的惰性导入；不接受参数；调用幂等，加载失败时渲染器平滑降级

### 工厂函数

- `defineMantineBehaviors()`：扩展行为工厂函数（核心行为字段 + `codeBlock`）；仅负责身份声明 + 类型提示 + `Object.freeze`，不含多余业务逻辑

### Hooks

- `useMantineCodeBlockOptions()`：带类型且注入默认值的 `codeBlock` 组访问 Hook
- `useMantineAIMarkdownMetadata<TMetadata>()`：带类型的元数据访问 Hook

## 相关指南文档

以下指南中的全部内容在 `<MantineAIMarkdown>` 中均完全适用；Mantine 专有部分即为上文所述内容。

| 指南                                                                                                                                                                                                                             | 内容说明                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [流式与性能](https://ai-markdown.github.io/docs/guides/streaming-and-performance/)                                                                                                                                               | 块级记忆、增量（前缀冻结）解析与流式接收最佳实践          |
| [平滑流式](https://ai-markdown.github.io/docs/guides/smooth-streaming/)                                                                                                                                                          | `<AIMarkdownSmoothStream>` 打字机展开、节奏预设与轮流呈现 |
| [流式光标](https://ai-markdown.github.io/docs/guides/streaming-cursor/)                                                                                                                                                          | 跟随流式追加尾部的定位光标                                |
| [跨分块协调](https://ai-markdown.github.io/docs/guides/cross-chunk-coordination/)                                                                                                                                                | `<AIMarkdownDocuments>`、跨分块脚注与链接引用、注册表     |
| [URL 安全过滤与自定义 Scheme](https://ai-markdown.github.io/docs/guides/url-sanitization/)                                                                                                                                       | URL 需同时通过清洗和最终策略、`urlTransform` 与扩展模式   |
| [自定义组件](https://ai-markdown.github.io/docs/guides/custom-components/) · [自定义排版](https://ai-markdown.github.io/docs/guides/custom-typography/) · [设计 Token](https://ai-markdown.github.io/docs/guides/design-tokens/) | 替换渲染器、主题定制与 `--aim-*` CSS 变量                 |
| [中文排版](https://ai-markdown.github.io/docs/guides/cjk-typography/)                                                                                                                                                            | 换行断字、盘古空格与 CJK 特性                             |
| [元数据上下文](https://ai-markdown.github.io/docs/guides/metadata-context/) · [TypeScript 泛型](https://ai-markdown.github.io/docs/guides/typescript-generics/)                                                                  | 向自定义组件传递类型安全的业务元数据                      |
| [内容预处理器](https://ai-markdown.github.io/docs/guides/content-preprocessors/)                                                                                                                                                 | 在 Markdown 解析之前重写源文本                            |
| [通过子包进行扩展](https://ai-markdown.github.io/docs/guides/extending-via-subpackage/)                                                                                                                                          | 构建你自己的 UI 库绑定（Mantine 包即为参考实现）          |
| [架构设计](https://ai-markdown.github.io/docs/guides/architecture/) · [性能基准](https://ai-markdown.github.io/docs/guides/benchmark/)                                                                                           | 模块拆分设计与实测性能数据                                |
| [迁移到 v2](https://ai-markdown.github.io/docs/guides/migrating-to-v2/) · [版本更新亮点](https://ai-markdown.github.io/docs/guides/release-highlights/)                                                                          | 新旧 API 对应关系与各版本更新总结                         |

## React 基础适配器

关于基础功能、配置选项、内容预处理器、TypeScript 泛型与架构细节，请参阅 [React 参考](react.md)。

<span id="streaming-code-source-display-and-asynchronous-work"></span>

## 流式代码：源码、展示与异步任务

渲染行为和配置示例请参阅[流式代码：源码、展示与异步任务](../guides/mantine-code-blocks.md#streaming-code-source-display-and-asynchronous-work)。

## 应用集成校验清单

测试亮色与暗色模式、已知语言、未标注语言、包含超大数值字面量的 JSON、嵌套 JSON 字符串、以及从尚未闭合过渡到合法语法的 Mermaid 代码围栏。复制每个代码块源码并对比空白字符是否与原始输入完全一致。随后将代码块替换为相同长度的不同内容，在挂起的高亮合并间隔期间结束数据流，并在图表渲染完毕后切换应用主题。

对于自定义封装层，请在外部行为 Provider 中分别测试未提供 `codeBlock` 属性与传入部分配置组的情况。对于多分块文档，使用相同的 React `AIMarkdownDocuments` 容器和显式文档 ID；不存在 Mantine 专有的注册表。平滑流式通过 React 适配器的 Hook 组合接入，其返回的流式状态包含了展示排空阶段。

关于包装层优先级请参阅 [`src/MantineAIMarkdown.tsx`](../../../../packages/react-mantine/src/MantineAIMarkdown.tsx)，权威的行为组默认值请参阅 [`src/defs.tsx`](../../../../packages/react-mantine/src/defs.tsx)。本参考文档描述展示层特性；继承的解析与跨分块协调行为请参阅 [React 参考](react.md)。

## 许可证

MIT

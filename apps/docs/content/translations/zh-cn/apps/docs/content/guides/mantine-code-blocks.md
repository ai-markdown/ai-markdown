# Mantine 代码块与图表

请先完成 [Mantine 快速开始](react-mantine-quick-start.md)：语法高亮代码展示需要正确配置双层 Provider 并引入对应的样式表。本指南介绍内置的 `pre` 元素渲染器。如果你自定义替换了该组件，则需要由你自己的代码承担这些职责。属性默认值请参阅 [Mantine 参考](../reference/react-mantine.md#props-api-reference)。

## 代码块渲染 <a id="code-block-rendering"></a>

Mantine 集成包安装了一个默认的 `<pre>` 渲染器（`MantineAIMPreCode`），负责驱动所有代码块特性。针对不同类型的代码块，其渲染行为如下：

| 代码块类型                                                                                                                                                                                                                                                                                                     | 渲染为                            | 行为说明                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 已声明且受支持的语言（如 ` ```ts `） \| `<CodeHighlightTabs>`                                                                                                                                                                                                                                                  | 标签页标题 = 转换为小写的语言名称 |
| 已声明但未知的语言标识符                                                                                                                                                                                                                                                                                       | `<CodeHighlightTabs>`             | 标签页标题 = 转换为小写的标识符；Mantine 的高亮适配器会将未知语言安全降级为纯文本展示                                                                                                      |
| 未声明任何语言                                                                                                                                                                                                                                                                                                 | `<CodeHighlight>` 纯文本          | 标签页标题 = `"unknown"`。当设置 `codeBlock.autoDetectUnknownLanguage: true` 时，`hljs.highlightAuto` 会尽早预估，随代码块增长重新校验，并在流式结束时给出最终判定——原位升级标签与语法高亮 |
| ` ```mermaid `（大小写不敏感）                                                                                                                                                                                                                                                                                 | 交互式 Mermaid 图表               | 详见 [Mermaid 图表](#mermaid-diagrams)；语言匹配不区分大小写                                                                                                                               |
| ` ```json `（大小写不敏感） \| 美化格式化后的 JSON \| 代码块一旦呈现完整形态（以 `}` 或 `]` 结尾且括号在字符串外对称闭合），即会进行解析；字符串中嵌套的 JSON 对象/数组会被展开（原始字面量风格的字符串如 `"true"` 保持为字符串），并以 2 空格缩进排版，同时保留精确的数值 Token；格式化和嵌套展开均可单独关闭 |

无论 JSON 显示如何美化，点击复制按钮均会复制最原始的代码文本（包含尾部换行符）。包含嵌套元素、兄弟文本或额外属性的原生 HTML `<pre>` 结构会保持原生渲染，不会错误进入代码高亮器。

所有常规代码块默认携带 `withBorder` 边框与 `withExpandButton` 展开按钮，默认折叠至 `maxCollapsedHeight="320px"`，直至用户点击展开。

### 代码高亮适配器

代码高亮要求在组件树外层包裹 `CodeHighlightAdapterProvider`。这是 Mantine 的官方要求——该适配器将 `highlight.js` 桥接到 Mantine 的代码高亮组件中。

```tsx
import { CodeHighlightAdapterProvider, createHighlightJsAdapter } from '@mantine/code-highlight';
import hljs from 'highlight.js';

const highlightJsAdapter = createHighlightJsAdapter(hljs);

function App() {
  return (
    <CodeHighlightAdapterProvider adapter={highlightJsAdapter}>
      {/* MantineAIMarkdown components can be rendered anywhere below */}
    </CodeHighlightAdapterProvider>
  );
}
```

### 语言自动检测

默认情况下，未标注语言的代码块会作为纯文本渲染。可通过 `codeBlock` 属性开启自动检测：

```tsx
<MantineAIMarkdown content={markdown} codeBlock={{ autoDetectUnknownLanguage: true }} />
```

开启后将使用 `highlight.js` 的 `highlightAuto` 猜测语言。对于过短或含义模糊的代码片段，猜测结果可能会有所波动。在代码块流式接收期间，检测按照**倍增计划**执行——当代码块达到约 32 个字符时进行首次预估，长度每次翻倍时重新修正一次，并在流式彻底结束时给出最终裁定——因此纯追加的数据流只会向检测器提交 O(n) 的总文本量，避免在每个前缀上反复计分。这限制了提交的文本规模，但不代表能限制 highlight.js 或其特定语法解析器的执行耗时。若代码块被整体替换而非追加（重新生成），倍增计划会重新计时。若未传入 `streaming` 属性，渲染器无法判断数据分块边界，会在每次内容变动时重新触发全量检测——因此在流式传输时请传入 `streaming`。完整的 `highlight.js` 构建会在首次需要时按需动态加载；包本身不再直接导入根 `highlight.js` 入口，因此通过 `highlight.js/lib/core` 仅注册所需语言的使用者，除非显式开启该选项，否则依然能够享受体积优化。

### 预加载按需资源

`mermaid` 以及自动检测所需的 `highlight.js` 由代码块渲染器惰性加载。如果应用希望在启动时提前承担此项开销——例如首屏即包含图表的文档页，或希望消除首个图表模块加载延迟的聊天界面——可在应用启动时调用导出的预加载函数一次：

```tsx
import { preloadMantineCodeAssets } from '@ai-markdown/react-mantine';

void preloadMantineCodeAssets(); // idempotent; failures are swallowed and the renderers fall back to lazy loading
```

当应用自身的预加载能够解析为与渲染器动态导入相同的模块实例时，也可以直接采用应用层的静态导入。当你希望独立于应用的模块解析策略预加载集成资源时，请使用该辅助函数。

## Mermaid 图表 <a id="mermaid-diagrams"></a>

声明了 `mermaid` 语言标识的代码围栏会被渲染为交互式 SVG 矢量图表。`mermaid` 模块采用按需加载——首个渲染的图表会承担模块导入开销（在加载期间原样显示为代码块源码），在支持代码分割的打包工具中可将该分块延迟加载。实际加载体验取决于你的打包工具以及是否配置了静态导入或预加载：

````markdown
```mermaid
graph TD
  A[Start] --> B{Decision}
  B -->|Yes| C[OK]
  B -->|No| D[Cancel]
```
````

核心特性：

- 随 Mantine 配色方案自动切换亮色/暗色主题
- 支持在渲染后的图表与原始代码之间自由切换
- 提供针对 Mermaid 源码的一键复制按钮
- 顶部操作栏支持在新窗口中打开生成的 SVG；图表本身保留矢量图形语义
- 标题栏清晰展示当前图表类型标识
- 遇到解析错误时平滑回退为源码展示；在流式生成期间遇到短暂的未闭合解析失败时，仍能保留最近一次成功渲染的图表

`mermaid` 库属于本包的直接依赖——无需单独手动安装。

## 流式代码：源码、展示与异步任务 <a id="streaming-code-source-display-and-asynchronous-work"></a>

常规代码高亮内部严格区分**源码值**与**展示值**。最新的源码会立即同步，以供复制按钮使用；而纯追加的流式展示更新则可以通过 `highlightIntervalMs` 进行时间合并。这是一个有界的挂起更新窗口：新的追加不会无休止地推迟同一个截止时间。当流式结束、文本被替换、语言发生变更或进行非流式更新时，系统会跳过合并间隔，使最终视图瞬间追赶至最新状态。

高亮器仅为相同的代码、语言、配色方案和高亮函数保留最新的计算结果，它不是一个无节制缓存每个流式前缀的无限存储。JSON 格式化首先校验候选串的完整性，随后在不经过 `JSON.stringify` 往返的情况下直接对 Token 进行排版，避免数值文本格式被意外篡改。嵌套的 JSON 字符串仅在包含对象或数组时才会展开；看起来像原始字面量的字符串保持不变。嵌套展开会改变视觉展示结构，因此在需要严格保留原始字面形式时请将其关闭。

Mermaid 拥有完全独立的异步生命周期。初始化、语法解析与渲染操作按序串行化执行，每个实例仅保留最新的挂起请求。在未闭合的流式生成过程中，遇到偶发失败时会持续保持展示最近一个有效的合法图表；在产生第一个合法图表之前，则以源码作为回退展示。生成彻底结束后会触发最终的校正渲染。渲染器强制执行了严格的 Mermaid 安全配置，并独立于常规代码的高亮合并机制进行图表绘制。

只有标准的 pre/code 结构才会被自动替换：即单个承载文本内容的 code 子节点、pre 上无自定义属性、code 上除了语言 class 之外无多余属性。包含嵌套标记、兄弟元素或额外属性的原始 HTML 会保持原生 pre 元素输出，从而完整保留高亮器本会丢弃的结构信息。如果调用方传入了自定义 `pre` 组件覆盖，将接管整条决策链路；仅单独覆盖 `code` 组件无法拦截已经被 Mantine pre 渲染器使用的代码围栏。

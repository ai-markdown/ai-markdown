# React 参考

React 19 应用程序适配器。Vue 3.5 应用请使用 [`@ai-markdown/vue`](vue.md)。包选型、样式配置与 API 差异请参阅[快速开始](https://ai-markdown.github.io/docs/guides/getting-started/)。

> **自 3.0.0 起：** React 与 Vue 适配器共享公开的 `@ai-markdown/core` 与 `@ai-markdown/engine` 底层包。详见[迁移指南](https://ai-markdown.github.io/docs/guides/framework-transition/)。

`@ai-markdown/react` 负责在 React 中渲染累积的 Markdown 字符串。它集成了 GFM、KaTeX 数学公式、CJK 分隔符处理、可选排版变换，以及针对高频追加内容经过验证的增量解析路径。你可以直接配合内置 CSS 使用，也可以传入自己的排版与元素渲染组件。

React 适配器负责管理 React 生命周期、上下文 Hooks、文档协调与元素缓存构建。其严格锁定版本的引擎依赖负责底层的语法处理。在 React 基础适配器中，代码围栏保持为代码纯文本展示；语法高亮、JSON 美化展示与 Mermaid 图表渲染由 Mantine 集成包或你的自定义 `pre` 组件提供。建议先完成安装与快速开始，再对照 API 列表明确各项配置。

> **从 1.x 升级？** v2.0.0 移除了 1.x 基于对象的 `config` 通道（以及集成层默认通道），改为平铺属性、密封的引擎插件目录以及五个窄订阅 Hook。关于新旧 API 的完整映射及代码对比，请参阅[迁移指南](https://ai-markdown.github.io/docs/guides/migrating-to-v2/)。

<span id="features"></span>

## 特性

- **GFM**：通过 `remark-gfm` 支持表格、删除线、任务列表与自动链接
- **LaTeX 数学公式**：行内与块级数学公式均通过 KaTeX 渲染；智能预处理可妥善处理货币 `$` 符号、括号定界符（`\[...\]`、`\(...\)`）、管道符转义以及 mhchem 化学公式
- **Emoji**：通过 `remark-emoji` 支持短码格式（`:smile:`）
- **CJK 友好**：支持针对中日韩字符的强调/删除线解析、可选的盘古空格以及可配置字体；源码换行符仍映射为 `<br>`
- **扩展语法**：支持 `==高亮==` 标记与定义列表
- **排版优化**：支持 SmartyPants 弯引号/破折号优化、盘古空格插入以及 HTML 注释过滤
- **流式感知**：内置 `streaming` 标记并通过上下文广播，方便自定义组件获取当前生成状态
- **平滑流式**：通过 `AIMarkdownSmoothStream` 外壳组件（以及其底层的 `useSmoothStream` Hook），将网络突发到达的 Token 块平稳转化为逐字打字机展示；详见 [平滑流式指南](https://ai-markdown.github.io/docs/guides/smooth-streaming/)
- **可定制**：可自由替换排版容器、配色方案、单个 Markdown 元素渲染器，并可插入额外的样式包装器
- **元数据上下文**：无需逐层传递属性（Prop drilling），即可向深层嵌套的自定义组件传递任意业务数据；元数据与渲染状态完全隔离，避免无谓的重渲染
- **TypeScript 完备**：具备完备类型定义的平铺属性，并支持元数据泛型（`AIMarkdownProps<TMetadata>`）

<span id="package-family"></span>

## 相关包

| 包名                                                                                                       | 职责                                                                                                                | 版本策略                                           |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| [`@ai-markdown/core`](https://www.npmjs.com/package/@ai-markdown/core)                                     | 框架无关的会话管理、块级规划、贡献管理与平滑协调                                                                    | 统一版本发布；以精确版本依赖 Engine                |
| [`@ai-markdown/react`](https://www.npmjs.com/package/@ai-markdown/react)                                   | React 渲染器——提供 `<AIMarkdown>`、`<AIMarkdownSmoothStream>`、Hooks 与 Provider                                    | 统一版本发布                                       |
| [`@ai-markdown/vue`](https://www.npmjs.com/package/@ai-markdown/vue)                                       | Vue 3.5 渲染器——提供组件、作用域插槽、SSR/水合与平滑组合式函数                                                      | 统一版本发布；精确依赖 core 与 engine              |
| [`@ai-markdown/react-mantine`](https://www.npmjs.com/package/@ai-markdown/react-mantine)                   | Mantine UI 绑定——主题排版、代码高亮标签页、Mermaid、配色联动                                                        | 统一版本发布；声明兼容的 React 3.x 对等依赖        |
| [`@ai-markdown/engine`](https://www.npmjs.com/package/@ai-markdown/engine)                                 | 框架中立引擎——增量解析、LaTeX 预处理、插件管线与跨分块注册表                                                        | 统一版本发布；被共享 core 与适配器严格锁定依赖版本 |
| [`@ai-markdown/remark-mark-highlight`](https://www.npmjs.com/package/@ai-markdown/remark-mark-highlight)   | 支持 `==mark==` 高亮语法的 remark 插件                                                                              | 独立语义化版本                                     |
| [`@ai-markdown/code-language-detector`](https://www.npmjs.com/package/@ai-markdown/code-language-detector) | 为未标注语言的代码块做启发式语言检测，并把 fence 上的语言名映射为 Shiki 或 highlight.js 的写法；供 Mantine 集成使用 | 独立语义化版本                                     |

<span id="compatibility"></span>

## 兼容性与运行环境

| 项目     | 规格要求                                                                                                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React    | ^19.0.0（`react` 与 `react-dom` 对等依赖）                                                                                                                                                                                                  |
| KaTeX    | `^0.16` 或 `^0.17`（可选对等依赖——仅在需要渲染数学公式时安装）                                                                                                                                                                              |
| Node     | `^20.19.0 \|\| >=22.12.0`（`engines.node`）                                                                                                                                                                                                 |
| 模块格式 | 包含类型声明的 ESM 与 CJS 产物，显式声明了 `sideEffects`                                                                                                                                                                                    |
| 运行时   | 浏览器、Node、Edge / Workers；支持通过 `renderToString` 执行服务端渲染，打包产物保留了适用于 React Server Components 应用的 `"use client"` 指令——详见[流式与性能指南](https://ai-markdown.github.io/docs/guides/streaming-and-performance/) |
| 打包行为 | ESM/CJS 产物且声明了副作用；减少插件配置可关闭其管线行为，但不保证其底层依赖从最终打包产物中彻底移除                                                                                                                                        |

<span id="installation"></span>

## 安装与引入

```bash
# npm
npm install @ai-markdown/react

# pnpm
pnpm add @ai-markdown/react

# yarn
yarn add @ai-markdown/react
```

React 适配器将 `@ai-markdown/core` 与 `@ai-markdown/engine` 作为常规依赖声明，在发包时严格锁定在相同的统一发布版本上。应用程序只需安装 `@ai-markdown/react`，包管理器会自动解析底层共享层。Core 负责会话、规划与协调，Engine 负责解析与树算法。适配器开发者可直接依赖这些共享层，但应保持其版本严格一致。精确的版本锁定能减少版本不匹配，但无法保证在任意嵌套安装中只安装一个模块实例。

<span id="peer-dependencies"></span>

### 对等依赖

```json
{
  "react": "^19.0.0",
  "react-dom": "^19.0.0",
  "katex": "^0.16.0 || ^0.17.0"
}
```

`katex` 为可选依赖。对于需要渲染数学公式的新应用，还需运行 `pnpm add react@^19 react-dom@^19 katex`；在导入其 CSS 时应显式声明 KaTeX 依赖。

<span id="css-dependencies"></span>

### CSS 样式依赖

若需渲染 LaTeX 数学公式，请引入 KaTeX 样式表：

```tsx
import 'katex/dist/katex.min.css';
```

`katex` 被本包以及负责 `rehype-katex` 管线步骤的 `@ai-markdown/engine` 声明为**可选对等依赖**。它通过 `rehype-katex` 进行传递，因此在某些依赖提升的安装环境下可能会隐式暴露。但在应用中直接导入其 CSS 时，建议在应用自身的 `package.json` 中显式声明该依赖，避免依赖不确定的提升机制或安装器策略：

```bash
npm install katex
```

只有在应用中完全不调用 `import 'katex/…'` 且不渲染数学公式时，才可跳过安装。

若使用内置的默认排版样式，请引入排版 CSS：

```tsx
import '@ai-markdown/react/typography/default.css';
// or import all typography variants at once:
import '@ai-markdown/react/typography/all.css';
```

<span id="quick-start"></span>

## 快速开始

```tsx
import AIMarkdown from '@ai-markdown/react';
import 'katex/dist/katex.min.css';
import '@ai-markdown/react/typography/default.css';

function App() {
  return <AIMarkdown content="Hello **world**! Math: $E = mc^2$" />;
}
```

### 流式使用示例

```tsx
function StreamingChat({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  return <AIMarkdown content={content} streaming={isStreaming} colorScheme="dark" />;
}
```

<span id="props-api-reference"></span>

## 属性 API 参考

### `AIMarkdownProps<TMetadata>`

所有平铺属性的类型定义、默认值与行为说明，请参阅 [React 属性参考](../guides/api/react-props.md)。封装层作者在扩展新增属性前，应以该参考文档作为属性名称注册登记表。

<span id="engine-plugins"></span>

## 引擎插件

可选的管线特性通过 `enginePlugins` 属性进行配置，该属性接收从 `@ai-markdown/react/plugins` 子路径导出的**密封插件单例对象**。默认情况下五个插件全部开启。

| 插件             | 说明                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| `highlight`      | 支持 `==高亮==` 语法                                                                                    |
| `definitionList` | 支持定义列表语法（遵循 [PHP Markdown Extra](https://michelf.ca/projects/php-markdown/extra/#def-list)） |
| `removeComments` | 过滤并移除 HTML 注释                                                                                    |
| `smartypants`    | 文本标点排版替换：弯引号、破折号（`--`）、省略号（`...`）                                               |
| `pangu`          | 在中日韩文字与半角英文字符之间自动插入盘古空格                                                          |

### 示例：按需挑选插件

```tsx
import AIMarkdown from '@ai-markdown/react';
import { highlight, smartypants } from '@ai-markdown/react/plugins';

const PLUGINS = [highlight, smartypants]; // module scope — stable reference

<AIMarkdown content={markdown} enginePlugins={PLUGINS} />;
```

传入数组将**原子级全量替换**插件配置（数组原子性语义）——上方示例仅开启了 highlight 与 smartypants，其余三个被关闭。官方推荐的“关闭单项”写法如下：

```tsx
import { defaultEnginePlugins, pangu } from '@ai-markdown/react/plugins';

const PLUGINS = defaultEnginePlugins.filter((p) => p !== pangu);
```

配置规则说明：

- 省略 `enginePlugins` 即代表使用 `defaultEnginePlugins`（全部开启）。
- 每个插件在处理管线中的实际位置由其内部的阶段元数据决定，与传入数组的元素排列顺序无关。数组中的重复项会被自动去重并在开发环境下发出警告。
- 插件集合是**密封的**：仅能使用引擎内置构建的插件（增量解析引擎的边界扫描器必须明确知晓每项语法的特征；开放任意注入会破坏其验证基线）。第三方语法扩展请通过 `contentPreprocessors` 与 `customComponents` 进行定制。
- 插件对象不可序列化。在远程下发配置场景中，应存储 `plugin.name` 字符串（类型为 `AIMarkdownEnginePluginName`），并在边缘运行时将其映射回导出的单例对象。
- 该属性内部配置了深比较稳定防线，但内联数组在每次渲染中仍会消耗一次比对开销——建议在模块作用域定义数组。

<span id="behavior-props"></span>

## 行为控制属性

三个平铺布尔属性用于控制底层引擎的行为模式：

| 属性                       | 类型      | 默认值 | 说明                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------- | --------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blockMemo`                | `boolean` | `true` | 开启块级记忆优化：渲染器将文档拆分为独立的块级单元，并按源码比对记忆每个块的 React 子树，使未修改的块在流式生成期间跳过 `toJsxRuntime` 与 React 的 DOM 协调开销。在独立渲染模式下，其输出结果与关闭该功能完全一致。跨片段协调（`<AIMarkdownDocuments>`）严格建立在该路径之上——若设置 `blockMemo={false}`，分块将退化为独立模式渲染。可作为独立文档调试排查问题的回退开关。 |
| `incrementalParse`         | `boolean` | `true` | 用于流式传输的前缀冻结增量解析：当内容以纯追加方式增长时，渲染器在经过安全验证的边界处冻结稳定的文档前缀，仅对尾部进行重新解析（在基准测试中管线执行耗时降低 83–94%；脚注与跨分块文档同样支持拼接）。其解析输出通过每帧拼接等价测试套件严格保障与全量解析深比较完全相同。仅在 `blockMemo` 为 `true` 时生效。                                                               |
| `preserveOrphanReferences` | `boolean` | `true` | 保护未被任何行内引用关联的孤立 `[^x]: …` 脚注定义，避免其被 `mdast-util-to-hast` 静默丢弃。这对于流式传输极为重要，因为对应的引用标记可能稍后在后续分块中到达。在 `<AIMarkdownDocuments>` 容器内部，容器上的同名属性具有最高优先级，会无条件覆盖该属性。                                                                                                                   |

```tsx
<AIMarkdown content={markdown} blockMemo={false} incrementalParse={false} />
```

<span id="cross-chunk-coordination"></span>

## 跨片段文档协调

当一个逻辑 Markdown 文档被拆分在多个 `<AIMarkdown>` 实例中展示时（例如聊天界面中的分块流式等场景），请使用 `<AIMarkdownDocuments>` 包裹它们，并向每个分块传入**相同的** `documentId`，以协调脚注、链接引用和图片引用：

```tsx
import AIMarkdown, { AIMarkdownDocuments } from '@ai-markdown/react';

<AIMarkdownDocuments>
  {message.chunks.map((c, i) => (
    <AIMarkdown key={i} content={c} documentId={message.id} />
  ))}
</AIMarkdownDocuments>;
```

如果不使用该容器，每个 `<AIMarkdown>` 都是相互独立的——其内部的引用标记只能在其自身的内容范围内进行解析（即默认的独立渲染行为）。

<span id="chunks-that-mount-out-of-order-virtualized-lists"></span>

### 乱序挂载的分块（虚拟化列表）

跨分块状态（脚注编号以及由哪个分块承载汇总脚注区）默认取决于分块的**注册顺序**，在默认情况下即为它们的组件挂载顺序。只要每个分块按照文档顺序仅挂载一次，该逻辑就能正常工作。

虚拟列表会打破这一假设：当某条消息滚动离开可视区域时会被卸载，重新滚回时重新注册的时机就会**晚于**那些持续挂载的分块——导致脚注编号错乱且汇总脚注区发生位移。通过传入 `documentIndex`（任意稳定的分块序号，如列表索引），注册顺序便不再受挂载时机影响：

```tsx
<AIMarkdownDocuments>
  {message.chunks.map((c, i) => (
    <AIMarkdown key={i} content={c} documentId={message.id} documentIndex={i} />
  ))}
</AIMarkdownDocuments>
```

该属性为可选项，当所有分块按文档顺序依次挂载时无需传入，现有代码无需修改。

### `<AIMarkdownDocuments>` 属性

| 属性                       | 类型        | 默认值 | 说明                                                                                                                                                                                                                                                              |
| -------------------------- | ----------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preserveOrphanReferences` | `boolean`   | `true` | 控制容器下所有分块的孤立引用保护策略。无条件覆盖每个子分块自身的 `preserveOrphanReferences` 属性。并不直接控制跨分块协调本身（协调由容器 + `documentId` 共同决定）。                                                                                              |
| `smoothTurnTaking`         | `boolean`   | `true` | 容器级的平滑流式轮流呈现开关：设为 `true` 时，共享该 `documentId` 的 `<AIMarkdownSmoothStream>` 分块会按挂载顺序依次逐个展开打字动画。设为 `false` 则各分块独立展开。详见[平滑流式 → 轮流呈现](../guides/smooth-streaming.md#multi-chunk-documents-turn-taking)。 |
| `children`                 | `ReactNode` | -      | 需要协调的一组 `<AIMarkdown>` 实例。禁止嵌套文档容器：开发环境抛出错误；生产环境输出错误日志，子树退化为使用外层容器。                                                                                                                                            |

### `useDocumentRegistry(documentId)`

完整签名函数为 `useDocumentRegistry(documentId: string | undefined, documentIdExplicit?: boolean): Registry | null`。第二个参数默认为 `true`；若当前 ID 是自动生成的而非显式提供的，请传入 `false`。

返回该 ID 对应的 Provider 级注册表；在 `<AIMarkdownDocuments>` 外部、ID 为空/未定义、或 `documentIdExplicit` 为 false 时返回 `null`。导出了只读的 `Registry` 类型；该 Hook 本身不会注册分块，也不会自动将组件订阅到注册表变更中。

若需响应式读取，请使用 React 的外部存储订阅机制（`useSyncExternalStore`）；详见[响应式注册表读取](../guides/cross-chunk-coordination.md#reactively-reading-the-registry)。返回的定义数据属于借用数据，应用层代码禁止直接修改注册表内部结构。

```tsx
import { useDocumentRegistry, type Registry } from '@ai-markdown/react';

function MyHelper({ documentId }: { documentId: string }) {
  const registry: Registry | null = useDocumentRegistry(documentId);
  // null when no <AIMarkdownDocuments> ancestor — treat as "run standalone".
}
```

<span id="custom-url-schemes-and-sanitization"></span>

## 自定义 URL Scheme 与安全过滤

默认情况下，`<AIMarkdown>` 仅渲染使用标准安全协议（`http`、`https`、`irc`、`ircs`、`mailto`、`xmpp`）的链接和图片。其他任何协议——无论是 `javascript:`、`data:` 还是自定义私有协议 `myapp://`——均会被直接过滤剥离。这能有效抵御大模型生成 Markdown 中的 XSS 攻击，但也意味着在未作配置时私有应用协议无法被正常解析展示。

### 清洗与转换机制

URL 必须同时通过安全清洗架构与最终转换策略：

1. **`rehype-sanitize` 安全 Schema**：在第一阶段执行（位于 rehype 插件链内部），当协议不在 Schema 的各属性白名单（`protocols.href`、`protocols.src`、`protocols.cite`）中时，该 URL 会被直接丢弃。
2. **`urlTransform` 策略函数**：在第二阶段执行（位于 hast 渲染遍历阶段），作用于所有通过了第一阶段清洗的携带 URL 的属性；默认的转换函数会针对不受信任的 URL 返回空字符串。自定义转换函数也可返回 null 或 undefined 以直接省略该属性。该函数针对每个属性被独立调用，并携带属性名（`'href'`、`'src'` 等），使策略函数能够区分处理（例如允许在 `href` 链接上使用自定义协议，但在 `src` 图片上禁止以防追踪像素）。

私有自定义协议若要在页面中正常渲染，**必须同时获得这两道关卡的许可**。仅配置其中一道是极为常见的使用失误。

**跨分块对等性**：当 `<AIMarkdown>` 分块包裹在 `<AIMarkdownDocuments>` 内部时，跨分块解析的链接与图片引用（分块 A 定义了 `[evil]: …`，分块 B 书写了 `[click][evil]`）同样会经过这两道检查——传入 `<AIMarkdown>` 的 `urlTransform` 与 `sanitizeSchema` 同样会在渲染时生效。属性名区分（`'href'` 对比 `'src'`）同样有效：在 `<a>` 标签上允许但在 `<img>` 上禁止的属性感知策略，无论引用是在分块内部还是跨分块，表现完全一致。

### 放行自定义 Scheme

请在模块作用域定义两道配置，确保其引用在多次渲染之间保持稳定（从而保护块级记忆缓存不被意外冲刷）：

```tsx
import AIMarkdown, { defaultUrlTransform, extendSanitizeSchema, type UrlTransform } from '@ai-markdown/react';

// Gate 2: compose with the default so https/mailto/etc. still work.
const ALLOWED = /^myapp:/i;
const URL_TRANSFORM: UrlTransform = (url, key, node) =>
  key === 'href' && ALLOWED.test(url) ? url : defaultUrlTransform(url, key, node);

// Gate 1: allow the application scheme for links. Images keep their default policy.
const SCHEMA = extendSanitizeSchema((s) => {
  s.protocols!.href!.push('myapp');
});

function App() {
  return <AIMarkdown content={markdown} urlTransform={URL_TRANSFORM} sanitizeSchema={SCHEMA} />;
}
```

### `extendSanitizeSchema((draft) => Schema | void)`

该辅助函数会为你提供库默认安全 Schema 的深拷贝副本。你可以在其上直接进行修改（原始单例对象不会被改动），或者返回一个替换对象。库的关键内置标记——跨分块协调标签（`cross-chunk-link`、`cross-chunk-image`、`footnote-sup`）、KaTeX 的 `math-inline` / `math-display` 类名白名单、以及 `<mark>` 标签放行——均会完好保留。**如果手动自建 Schema 且未包含这些内置项，会静默破坏跨片段协调渲染**，因此强烈推荐使用该辅助函数。

```tsx
const SCHEMA = extendSanitizeSchema((s) => {
  (s.tagNames ??= []).push('my-widget'); // add a tag
  s.protocols!.href!.push('myapp'); // permit a protocol
  (s.attributes ??= {})['my-widget'] = ['dataId', 'dataMode']; // allow attributes
  // No `return` needed — mutate-only is fine.
});
```

**避坑提示**（JSDoc 中亦有说明）：

- 返回 `null` 等同于什么都不返回（将使用修改后的 draft 草稿对象）。
- 重新对局部参数赋值（`s = { ... }`）并不会替换草稿——JS 仅会重新绑定局部变量。要么就地修改原对象，要么显式 `return` 新对象。
- 在修改函数中抛出异常会直接向外冒泡。由于该函数通常在模块加载时仅执行一次，通常无需担心。

### 引用稳定性与缓存

`urlTransform` 与 `sanitizeSchema` 均参与块级记忆缓存的判定，但它们的稳定机制**并不对称**：

- **`urlTransform`** 纯粹依据引用相等性进行追踪。每次渲染传入新的函数引用都会清空整篇文档的记忆缓存。调用方必须保证传入稳定的引用（使用模块作用域或 `useMemo`）。
- **`sanitizeSchema`** 不仅依据引用追踪，在内部还额外配置了基于深比较的安全兜底（`useStableValue`）。内联传入但在结构上深比较相同的 Schema 依然能够正常工作，只是每次渲染需要承担一次深比较计算——虽然代价低于全量清空缓存，但并非完全无开销。

之所以存在这种不对称性：函数引用无法进行深比较（两个函数体相同的闭包在 JS 中永远不全等），因此对于 `urlTransform` 只能由调用点保证引用稳定。而 `sanitizeSchema` 是纯数据结构，深比较完全可行，能够作为调用方忘记模块作用域规则时的安全防护网。

```tsx
// 🚫 Anti-pattern — `urlTransform` is recreated every render and discards
//    the entire markdown cache. `sanitizeSchema` would too without the
//    internal deep-equal safety net, but you still pay the deep-compare cost.
<AIMarkdown
  urlTransform={(url, k, n) => /* … */}
  sanitizeSchema={extendSanitizeSchema((s) => /* … */)}
/>

// ✅ Stable — both refs are minted once at module scope.
const URL_TRANSFORM = (url, k, n) => /* … */;
const SCHEMA = extendSanitizeSchema((s) => /* … */);
<AIMarkdown urlTransform={URL_TRANSFORM} sanitizeSchema={SCHEMA} />
```

在开发环境下，若库检测到这两个属性发生 3 次以上的引用频繁切换，会在控制台输出 `console.warn` 告警。该告警在生产构建中会被作为 Dead Code 自动剔除。请在模块作用域定义这两个值，或者在它们依赖状态时使用 `useMemo` 包装。

### Scheme 名称中 + / - / . 的正则转义

Scheme 名称可以包含 `+`、`-` 和 `.`。在进行字面匹配时，请对 `+` 和 `.` 进行转义；连字符在字符类之外可直接作为字面量。使用 `/^web\+app:/i` 匹配 `web+app:`。未转义的 `/^web+app:/i` 会错误匹配到 `webapp:`、`webbapp:` 以及更多 `b` 的重复项。

### 查看默认 Schema

`extendSanitizeSchema` 会将库默认配置的深拷贝传递给修改函数。这使得该辅助函数本身就成为了查看默认配置的方式——无需单独导出单例：

```tsx
extendSanitizeSchema((s) => {
  console.log('default sanitize schema:', s);
});
```

为什么不直接导出 `sanitizeSchema`？因为显而易见的扩展模式——`{ ...sanitizeSchema, … }`——仅是浅拷贝。嵌套数组（`protocols.href`、`attributes.a`、`ancestors.*` 等）依然与单例保持引用关联；就地修改会污染共享的底层数据。引擎单例目前已被深度冻结，对此类写入会直接抛出错误。深拷贝能让每次定制都拥有专属的可变数组。`extendSanitizeSchema` 始终在深拷贝上操作，从机制上根绝了此类问题。

### `UrlTransform` 与 `SanitizeSchema` 的 API 稳定性

这两个属性的类型均跟随其对应的上游库——`UrlTransform` 遵循 `react-markdown` 的结构，`SanitizeSchema` 遵循 `rehype-sanitize` 的定义。它们可能会随这些上游库的大版本更新而演进。通过辅助函数构建 Schema（而不是从零硬写手打类型），可以自动继承上游驱动的任何结构调整。

## Hooks

<span id="the-five-narrow-hooks"></span>
<span id="useaimarkdown--the-aggregate"></span>
<span id="useaimarkdownmetadatatmetadata"></span>
<span id="usestablevaluetvalue-t"></span>
<span id="usestablerecordrecord-table"></span>

关于各个 Hook 的签名、代码示例与生命周期规范，请参阅 [React Hooks 指南](../guides/api/react-hooks.md#hooks)。

<span id="additive-providers"></span>

## 附加 Provider

<span id="group-key-registry"></span>

关于附加 Provider 的签名与用法，请参阅 [Additive Providers 指南](../guides/api/react-hooks.md#additive-providers)。

## 排版与样式定制

`<AIMarkdown>` 组件将其内容包裹在一个排版组件中，用以控制字号、排版变体与配色方案。

### 内置默认排版组件

内置的 `DefaultTypography` 会渲染一个带有当前变体和配色方案 CSS 类名的 `<div>`：

```html
<div class="aim-typography-root default light" style="width: 100%; font-size: 0.9375rem">
  <!-- markdown content -->
</div>
```

引入对应的 CSS 即可激活样式：

```tsx
import '@ai-markdown/react/typography/default.css';
```

<span id="customization-tokens"></span>

#### 定制 Token 变量

所有 `default` 变体的样式均由声明在 `.aim-typography-root.default` 上的 CSS 自定义属性驱动。间距、字号和标题 Token **均锚定在 `--aim-font-size-root`**（由渲染器根据 `fontSize` 属性注入），因此这些尺寸会随 `fontSize` 等比例缩放；圆角常量、边框宽度和无单位数值遵循其各自的声明。若需定制，可在你自己的样式表中重写任意 Token：

```css
.aim-typography-root.default {
  --aim-spacing-md: calc(var(--aim-font-size-root) * 1.2); /* roomier paragraphs */
  --aim-h1-font-size: calc(var(--aim-font-size-root) * 2.5); /* bigger H1 */
  --aim-font-weight-strong: 600; /* lighter headings + th */
  --aim-color-anchor: #ff6b6b; /* red links */
}
```

| 属性组           | 变量名                                                                                      | 说明                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 间距             | `--aim-spacing-{xs,sm,md,lg,xl}`                                                            | `calc(var(--aim-font-size-root) * k)`，其中 `k ∈ {0.625, 0.75, 1, 1.25, 1.5}`                                                                  |
| 字体大小         | `--aim-font-size-{xs,sm,md,lg,xl}`                                                          | `k ∈ {0.75, 0.875, 1, 1.125, 1.25}`                                                                                                            |
| 标题字号         | `--aim-h{1..6}-font-size`                                                                   | 倍数与 Mantine 的标题比例保持一致（`{2.125, 1.625, 1.375, 1.125, 1, 0.875}`）                                                                  |
| 标题元数据       | `--aim-h{1..6}-line-height`, `--aim-h{1..6}-font-weight`                                    | 行高为无单位数值；字重默认继承 `var(--aim-font-weight-strong)`                                                                                 |
| 字重             | `--aim-font-weight-strong`                                                                  | 所有标题与 `<th>` 共享；默认值为 `700`                                                                                                         |
| KaTeX 数学       | `--aim-katex-font-size`                                                                     | 默认为 `var(--aim-font-size-root)`，确保公式大小在无论何种父级上下文（引用块、标题）下均与组件根字号保持一致。如需相对父级缩放，可重写为 `1em` |
| 其他基础         | `--aim-line-height`, `--aim-radius-sm`, `--aim-font-family-{monospace,headings}`            | 无单位 / rem / 字体族常量                                                                                                                      |
| 颜色（浅色模式） | `--aim-color-{text,dimmed,anchor,border,code-bg,code-text,blockquote-bg,mark-bg,mark-text}` | 声明在 `.aim-typography-root.light` 上；暗色变体对应声明在 `.aim-typography-root.dark` 上                                                      |

> **稳定性约定**：这些 Token 的**名称**与**职责**遵循语义化版本规范。随着视觉设计的迭代演进，具体的默认**数值**（倍数、色值）可能在小版本中发生微调——若需要严格锁定特定数值，请在应用层样式表中重写该 Token。

### 自定义排版组件

可通过传入自定义组件来替换排版包装器。`style` 属性携带了 React 渲染器注入的 CSS 自定义属性——**请将其合并到你的根元素上**，以便子代 CSS 能够正常引用这些变量：

```tsx
import type { AIMarkdownTypographyProps } from '@ai-markdown/react';

function MyTypography({ children, fontSize, variant, colorScheme, style }: AIMarkdownTypographyProps) {
  return (
    <div className={`my-markdown ${colorScheme}`} style={{ fontSize, ...style }}>
      {children}
    </div>
  );
}

<AIMarkdown content={markdown} Typography={MyTypography} />;
```

#### 注入的 CSS 自定义属性

React 渲染器通过 Typography 的 `style` 属性注入以下 CSS 自定义属性：

| 变量                   | 取值            | 用途说明                                                                                                                                              |
| ---------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--aim-font-size-root` | `fontSize` 属性 | 组件实例的绝对字号基准。深层嵌套的 Markdown 结构（如引用块中的代码）可通过 `var(--aim-font-size-root)` 绕过 `em` 复合叠加计算，保持字号与根组件一致。 |

**为什么需要 `--aim-font-size-root`？** Markdown 内容经常包含嵌套使用相对 `em` 单位的元素——如引用块、列表、代码块。每一层嵌套都会复合缩放实际尺寸：一个处于 `1.125em` 引用块中的 `0.875em` 代码片段，其最终计算大小相当于父级的 `0.984em`，而非根组件的 `0.875em`。该变量提供了一个稳定的绝对参考基准，使内部 CSS 规则在需要固定尺寸时能够主动退出复合叠加。

内置的 `default` 变体已经充分使用了该变量——其所有间距、字号和标题 Token 均定义为 `calc(var(--aim-font-size-root) * k)`，因此在 `<AIMarkdown>` 上修改 `fontSize` 属性只会等比缩放锚定在根字号上的维度，而不会影响独立的 rem/px 常量。完整变量表详见上文[定制 Token 变量](#customization-tokens)。

### 额外样式包装器

`ExtraStyles` 属性接收一个渲染在排版包装器与 Markdown 内容之间的组件。适合用于注入额外的 CSS 作用域或主题 Provider：

```tsx
import type { AIMarkdownExtraStylesProps } from '@ai-markdown/react';

function MyExtraStyles({ children }: AIMarkdownExtraStylesProps) {
  return <div className="my-extra-scope">{children}</div>;
}

<AIMarkdown content={markdown} ExtraStyles={MyExtraStyles} />;
```

## 自定义组件

通过 `customComponents` 属性可以针对特定 HTML 元素覆盖其默认渲染器。该属性直接映射到 `react-markdown` 的 `Components` 类型：

```tsx
import type { AIMarkdownCustomComponents } from '@ai-markdown/react';

const components: AIMarkdownCustomComponents = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  img: ({ src, alt }) => <img src={src} alt={alt} loading="lazy" />,
};

<AIMarkdown content={markdown} customComponents={components} />;
```

## 流式支持

请使用完整累积的字符串更新 `content`，并根据数据源的生命周期设置 `streaming`。该标记会传递给 `useAIMarkdownState()` 的使用方并控制光标的挂载显示；它不会切换不同的 Markdown 语法分支。增量解析受行为开关以及追加/安全门禁控制。

```tsx
import { AIMarkdownStreamingCursor } from '@ai-markdown/react';

<AIMarkdown
  content={accumulatedMarkdown}
  streaming={requestStatus === 'streaming'}
  streamingCursor={AIMarkdownStreamingCursor}
/>;
```

光标必须独立于源文本之外。向 Markdown 源码末尾追加装饰性光标字符会破坏帧与帧之间的纯追加关系，并可能损坏代码或数学公式源码。内置光标采用 DOM 浮层定位，并在代码块、数学公式及图片等不支持的尾部状态下主动隐去。

如需打字机节奏的视觉呈现，可使用 `AIMarkdownSmoothStream` 替换基础渲染器，或在自定义包装组件中调用 `useSmoothStream({ content, streaming })`。数据源可能会在可见文本彻底排空之前结束；在排空期间，返回的流式标记会持续保持为 true。挂载时已有内容的文本会瞬间完整呈现，文本被整体替换时会在同步 Effect 之后瞬间切换，仅有发生真实积压的生成轮次才会触发排空完成回调。

对于常规的数据传输流，一条消息使用单个渲染器即可。对于多分块文档，多个逻辑 Markdown 分块可以在开启块级记忆的前提下，在 `<AIMarkdownDocuments>` 中共享显式的文档 ID。该容器负责跨分块协调引用，但不会拼接在任意 Token 边界被切断的代码围栏、表格或段落。

关于数据分帧、取消请求、生命周期与缓存行为，请参阅[完整聊天示例](https://ai-markdown.github.io/docs/guides/streaming-chat-example/)、[平滑流式指南](https://ai-markdown.github.io/docs/guides/smooth-streaming/)与[流式与性能指南](https://ai-markdown.github.io/docs/guides/streaming-and-performance/)。

## 元数据上下文

通过 `metadata` 属性可以向深层嵌套的自定义组件传递任意业务数据，无需逐层传递属性。元数据存储在与渲染状态**相互独立的 React 上下文**中，因此更新元数据不会导致仅读取渲染状态的组件（如核心的 `MarkdownContent`）产生不必要的重渲染。

```tsx
interface ChatMetadata {
  messageId: string;
  onCopyCode: (code: string) => void;
  onRegenerate: () => void;
}

<AIMarkdown<ChatMetadata>
  content={markdown}
  metadata={{
    messageId: msg.id,
    onCopyCode: handleCopy,
    onRegenerate: handleRegenerate,
  }}
/>;
```

## 内容预处理器

渲染管线默认会先运行 LaTeX 预处理器。你可以追加额外的内容预处理器，在源文本进入 remark/rehype 插件管线之前对其进行字符串级转换：

```tsx
import type { AIMDContentPreprocessor } from '@ai-markdown/react';

const stripFrontmatter: AIMDContentPreprocessor = (content) => content.replace(/^---[\s\S]*?---\n/, '');

<AIMarkdown content={markdown} contentPreprocessors={[stripFrontmatter]} />;
```

预处理器按顺序串行执行：首先运行内置的 LaTeX 预处理器，随后按照数组顺序依次运行你的自定义预处理器。

## TypeScript 泛型

组件接收一个泛型参数——用于实现类型安全元数据的 `TMetadata`：

```tsx
import AIMarkdown, { type AIMarkdownMetadata } from '@ai-markdown/react';

interface MyMetadata extends AIMarkdownMetadata {
  messageId: string;
}

<AIMarkdown<MyMetadata> content={markdown} metadata={{ messageId: '123' }} />;
```

元数据 Hook 同样接收匹配的泛型定义：

```tsx
const metadata = useAIMarkdownMetadata<MyMetadata>();
```

子包扩展的是**平铺属性表面**而非配置泛型：例如 `@ai-markdown/react-mantine` 的 `MantineAIMarkdownProps<TMetadata> extends AIMarkdownProps<TMetadata>` 增加了 `codeBlock` 属性，通过 `AIMarkdownBehaviorsProvider` 进行传输，并在其自身的窄订阅 Hook（`useMantineCodeBlockOptions()`）中对该组类型进行唯一一次校验。详见上文[附加 Provider](#additive-providers)与[通过子包进行扩展](https://ai-markdown.github.io/docs/guides/extending-via-subpackage/)。

<span id="architecture-overview"></span>

## 架构概览

```text
<AIMarkdown>
  <AIMarkdownMetadataProvider>          // Separate context for metadata
    <AIMarkdownProvider>                // Per-system contexts: document, state, theme, behaviors
      <Typography>                      // Configurable typography wrapper
        <ExtraStyles?>                  // Optional extra style wrapper
          <AIMarkdownContent />         // react-markdown with remark/rehype plugin chain
        </ExtraStyles?>
      </Typography>
    </AIMarkdownProvider>
  </AIMarkdownMetadataProvider>
</AIMarkdown>
```

渲染状态被刻意拆分在五个独立的系统上下文（document、metadata、state、theme、behaviors）中，因此某个系统的局部变动（如元数据回调更换、`streaming` 状态切换）只会触发该系统订阅者的定向重渲染。

## 导出的 API

### 默认导出

- `AIMarkdown`：主渲染组件（已做 memo 优化）

### 组件

- `AIMarkdownDocuments`：启用跨分块文档协调的可选外层容器
- `AIMarkdownStreamingCursor`：用于 `streamingCursor` 插槽的内置行内浮层光标
- `AIMarkdownSmoothStream`：包含打字机节奏控制（`smooth*` 属性）的外壳组件；在 `<AIMarkdownDocuments>` 下共享相同 `documentId` 的分块支持按挂载顺序轮流呈现（单打字机、单光标）；详见 [平滑流式指南](https://ai-markdown.github.io/docs/guides/smooth-streaming/)

### Provider

- `AIMarkdownBehaviorsProvider`：用于包装层或应用层传递自定义行为组的附加 Provider（包裹在 `<AIMarkdown>` 外层）
- `AIMarkdownStateProvider`：用于传递扩展生命周期状态组的附加 Provider

### Hooks

- `useAIMarkdownState()`、`useAIMarkdownTheme()`、`useAIMarkdownDocument()`、`useAIMarkdownBehaviors()`、`useAIMarkdownMetadata<T>()`：五个窄订阅 Hook
- `useAIMarkdown()`：聚合 Hook（同时订阅全部五个上下文）
- `useDocumentRegistry()`：跨分块文档注册表访问 Hook
- `useSmoothStream()`：打字机节奏控制 Hook；返回可直接展开解构为组件属性的 `{ content, streaming, flush }` 对象
- `useDocumentSmoothStream()`：在 `useSmoothStream` 基础上叠加文档轮流呈现控制（`waiting` 可在输入到达前预留空位）；传入 `documentId` 后在 `<AIMarkdownDocuments>` 下按挂载顺序依次展开；未配置时平滑降级为普通 `useSmoothStream`
- `useStableValue()`：值引用稳定化 Hook
- `useStableRecord()`：用于包装层作者的引用稳定防火墙 Hook

### 工厂函数

- `defineTheme`、`defineBehaviors`、`definePipeline`：已冻结、带类型、引用稳定的平铺属性片段工厂函数（仅负责身份声明 + 类型提示 + `Object.freeze`，不含业务逻辑）
- `createRemendPreprocessor()`：用于 `contentPreprocessors` 的可选流式尾部语法修复工厂函数（将其加入预处理器数组即可启用）
- `createSmoothStreamController()`：位于 `useSmoothStream` 底层、不依赖框架的纯节奏控制核心（无 React/DOM 依赖）；支持在预设基础上覆盖高级数值参数
- `SMOOTH_STREAM_PACING_PRESETS`：三个 `smoothPacing` 预设背后的冻结参数包

### 常量与辅助工具

- `defaultUrlTransform`：库内置的 URL 白名单安全转换函数；在提供自定义 `urlTransform` 时可与之组合使用
- `extendSanitizeSchema((draft) => Schema | void)`：基于库默认配置深拷贝生成安全 Schema 的修改工厂函数；自动保留跨分块协调与 KaTeX 关键标记
- `AIMarkdownStabilityPolicy`：用于 `useStableRecord` 策略表的枚举值（`DEEP_EQUAL` / `WARN_ONLY` / `PASS_THROUGH`）

### `@ai-markdown/react/plugins`（子路径导出）

- `highlight`、`definitionList`、`smartypants`、`pangu`、`removeComments`：密封的引擎插件单例对象
- `defaultEnginePlugins`：全部五个插件的内置默认数组

### 类型定义

- `AIMarkdownProps`
- `AIMarkdownDocumentsProps`
- `AIMarkdownCustomComponents`
- `AIMarkdownMetadata`
- `AIMarkdownEnginePlugin`、`AIMarkdownEnginePluginName`：密封插件类型及其名称联合类型（用于支持远程配置序列化）
- `AIMarkdownTypographyProps`
- `AIMarkdownTypographyComponent`
- `AIMarkdownExtraStylesProps`
- `AIMarkdownExtraStylesComponent`
- `AIMarkdownVariant`
- `AIMarkdownColorScheme`
- `AIMDContentPreprocessor`、`RemendPreprocessorOptions`
- `AIMarkdownThemeProps`、`AIMarkdownBehaviorProps`、`AIMarkdownPipelineProps`：`define*` 工厂函数的入参类型
- `AIMarkdownStabilityTable`：`useStableRecord` 的策略表类型
- 上下文载荷类型：`AIMarkdownDocumentInfo`、`AIMarkdownThemeInfo`、`AIMarkdownStateCore`、`AIMarkdownBehaviorsCore`、`AIMarkdownStateGroups`、`AIMarkdownBehaviorGroups`、`AIMarkdownExtensionGroups`、`AIMarkdownAggregate`
- 流式光标类型：`AIMarkdownStreamingCursorProps`、`AIMarkdownStreamingIndicatorProps`、`AIMarkdownStreamingIndicatorComponent`
- 平滑流式类型：`AIMarkdownSmoothStreamProps`、`SmoothStreamController`、`SmoothStreamOptions`、`SmoothStreamPacing`、`SmoothStreamPacingParams`、`UseSmoothStreamOptions`、`UseSmoothStreamResult`、`UseDocumentSmoothStreamOptions`
- `UrlTransform`、`SanitizeSchema`：URL 处理属性的类型别名（对齐上游 `react-markdown` / `rehype-sanitize` 结构）
- 跨分块注册表类型：`Registry`、`ChunkData`、`FootnoteDef`、`LinkDef`、`RefRecord`、`RefKind`

## 相关指南文档

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

<span id="integration-checks-and-implementation-boundaries"></span>

## 集成检查与实现边界

在增加任何自定义配置之前，请先通过排版样式 CSS 和 KaTeX 样式验证基础渲染器功能。随后逐个引入自定义图层：先通过 Token 调整视觉外观，再通过 `customComponents` 定制元素行为，接着通过元数据传递应用数据，最后配置 Schema 与 URL 转换实现明确的 URL 安全策略。这样能够清晰区分是样式缺失、解析异常还是清洗拦截导致的渲染问题。

在流式传输场景中，请保持组件 key 稳定，保存累积的源文本，并在成功、取消或失败等任何终态下及时关闭流式状态。已经渲染完毕的稳定块虽然会复用 React 元素，但其自身的状态、上下文及外部 Store 订阅仍然可能触发更新。缓存复用并不等于保证自定义组件永远不再被渲染。

对于跨分块协调，请测试后置定义到达以及分块重新挂载的场景。`documentIndex` 负责对已挂载的分块进行相对排序；分块卸载依然会移除其贡献。服务端渲染与首轮客户端水合渲染使用本地定义，直至 Effect 执行发布共享贡献。自动生成的 ID 仅用于隔离独立输出的命名空间，不会自动加入跨片段协调。

默认的 Schema 会在执行 `urlTransform` 之前剔除不符合白名单的标签与属性；回调函数无法恢复已被丢弃的属性。跨分块引用同样会将使用分块的策略应用在其最终生成的 `a` 或 `img` 上（包含其祖先约束）。注册表选择器暴露的是原始定义中的未清洗 URL，因此在自定义侧边栏等独立视图中渲染时，必须自行应用 URL 安全策略。

源码参考：[`src/index.tsx`](../../../../packages/react/src/index.tsx) 负责解析公开入参，[`MarkdownContent`](../../../../packages/react/src/components/MarkdownContent.tsx) 负责管理渲染与贡献 Effect，[引擎 README](../../../../packages/engine/README.md) 阐述了语法解析层的实现细节。[开发指南目录](https://ai-markdown.github.io/docs/guides/)为每个自定义表面提供了详尽的实践方案。

## 许可证

MIT

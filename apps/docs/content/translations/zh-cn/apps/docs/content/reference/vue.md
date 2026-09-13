# Vue 参考

基于框架无关的 `@ai-markdown/core` 与 `@ai-markdown/engine` 构建的 Vue 3 Markdown 渲染适配器。本包提供真正的 Vue VNode 渲染、服务端渲染（SSR）与水合支持、作用域文档引用、组件与插槽定制、平滑流式输出以及经过布局测量的流式光标。它完全替代了早期的内部生命周期原型。

自 `3.0.0` 起稳定发布。Vue 适配器与 React 共享底层解析引擎和协调核心。首个预发布版本为 `3.0.0-beta.2`。

## 环境要求与依赖 <a id="requirements-and-dependencies"></a>

- Vue **3.5 或更高版本的 Vue 3**（`^3.5.0`）。适配器依赖 `useId()` 生成能够在服务端渲染与客户端水合之间保持一致的应用局部 ID。较早的 Vue 3 次要版本不提供该 API。
- 服务端与构建环境要求 Node `^20.19.0 || >=22.12.0`。
- 支持现代浏览器，需具备 `ResizeObserver`、`MutationObserver`、`requestAnimationFrame` 与 Web Crypto 的 `getRandomValues`。不强制要求安全上下文（Secure Context）：适配器不依赖 `crypto.randomUUID`，因此普通 `http://` 域名亦可正常渲染。如果环境完全缺乏 Web Crypto，跨片段占位凭据将降级为普通非保密唯一值，且开发构建中每个挂载的片段会输出一条 `console.error`。浏览器验收测试覆盖了 Chromium、Firefox 与 WebKit。
- `@ai-markdown/core` 与 `@ai-markdown/engine` 是常规依赖项，与主包版本保持一致，应用无需单独安装。Vue 本身作为 peer 依赖，在 ESM 与 CJS 产物中均作为外部依赖处理。
- KaTeX 是可选的 peer 依赖（`^0.16 || ^0.17`）。若需要导入其样式表渲染数学公式，请在应用中直接声明安装，避免依赖包管理器的依赖提升。

安装稳定版本：

```bash
pnpm add @ai-markdown/vue vue@^3.5.0 katex
```

关于包结构与 React/Vue API 差异，请参阅[入门指南](https://ai-markdown.github.io/docs/guides/getting-started/)。Vue 包直接从根入口导出辅助工具；它不提供 `/plugins` 子路径，也不包含 React 的排版变体。

<span id="minimal-component"></span>

## 最小组件示例

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

请传入**累积的完整 Markdown 字符串**。由应用将解码后的网络数据持续追加到应用状态中；渲染器本身不负责 Fetch 请求、SSE 分帧、UTF-8 解码、请求取消或网络重试。支持直接替换字符串，并在必要时自动使保留的解析缓存失效。`streaming` 用于控制界面状态，并不是开启增量解析的开关。

`styles.css` 提供了精简的基础样式，包含代码块溢出滚动、表格排版与光标动画。当应用自行提供样式时可不引入该样式。KaTeX CSS 需独立导入。渲染器绝不使用 `v-html` 或 `innerHTML` 插入 Markdown 解析结果。

<span id="component-props"></span>

## 组件属性

| 属性                       | 默认值            | 契约与说明                                                                                    |
| -------------------------- | ----------------- | --------------------------------------------------------------------------------------------- |
| `content`                  | 必填              | 当前完整的 Markdown 源字符串                                                                  |
| `documentId`               | Vue `useId()`     | 显式传入的 ID 仅在 `AIMarkdownDocuments` 内部参与跨片段协调；自动生成的 ID 保持独立单组件渲染 |
| `documentIndex`            | 挂载顺序          | 引用注册表的排序提示；当逻辑片段存在乱序挂载或重新挂载时提供该序号                            |
| `streaming`                | `false`           | 传递给自定义组件与元素插槽，控制光标显示与 `aria-busy` 状态                                   |
| `incrementalParse`         | `true`            | 在浏览器端启用前缀冻结的增量解析；服务端渲染使用完整流水线                                    |
| `preserveOrphanReferences` | `false`           | 是否在渲染结果中保留未被引用的孤立脚注定义                                                    |
| `enginePlugins`            | 全部内置 5 个插件 | 封闭目录选择；可选择启用哪些插件，规范执行顺序固定不变                                        |
| `contentPreprocessors`     | `[]`              | 在内置 LaTeX 预处理之后同步运行的字符串预处理函数数组                                         |
| `sanitizeSchema`           | 库内置 schema     | 视为不可变对象；若需扩展请使用 `extendSanitizeSchema`                                         |
| `urlTransform`             | 安全默认策略      | 清洗流程之后针对具体属性的最终 URL 策略                                                       |
| `components`               | `{}`              | HTML 标签到 Vue 组件的映射表                                                                  |
| `metadata`                 | `undefined`       | 传递给映射组件与具名元素插槽的应用层数据                                                      |
| `streamingCursor`          | `true`            | 流式生成期间是否显示光标；自定义外观可使用 `cursor` 插槽                                      |

根级属性（如 `class`、`id` 与 `style`）会自动透传至外层包装元素。外层包装元素为光标提供了相对定位上下文（relative positioning context）。传入自定义的 `position` 样式可能会影响光标的几何定位。

<span id="custom-vue-components-and-slots"></span>

## 自定义 Vue 组件与插槽

映射的组件会接收清洗后的元素属性以及 `node`、`streaming` 与 `metadata`。其默认插槽包含转换后的 Vue 子节点。请显式声明需要使用的 props 并按需传递属性；框架事件监听器属于应用组件代码，而非 Markdown 属性。

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

若需定制任意 VNode 子元素，使用渲染函数插槽通常比模板语法更简洁：

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

元素插槽的优先级高于匹配的 `components` 映射项。Markdown 文本不会被当作 Vue 模板进行二次解析。即使配置了宽松的清洗策略，适配器依然会剔除事件属性和 DOM 插入属性。自定义组件和插槽作为受信任的应用层代码，需自行保障输出内容的安全性。

<span id="multiple-chunks-in-one-document"></span>

## 单文档多片段协调

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

每个片段应当是结构完整的逻辑 Markdown 片段。被网络分块从中间切断的代码围栏、表格行或其他语法结构，不会被注册表自动拼合。除非业务场景确实需要独立挂载各个区域，否则请优先传入单个累积的 `content`。

引用可以先于其定义出现。共享注册表负责提供规范的链接/图片目标、全局统一的脚注编号与出现序号。最后注册的片段负责渲染汇总结尾脚注区。更新或移除定义会同步更新读取方；切换 `documentId` 会释放旧的注册。不同的文档 ID 以及不同的 Provider 实例相互独立。

服务端渲染（SSR）会渲染每个片段的局部内容和局部脚注，不向外部注册或发布协调数据。客户端水合的首帧也遵循相同路径。跨片段协调解析在组件挂载并提交协调数据后生效。因此，完全由其他片段提供的引用定义不会预先解析在服务端 HTML 中。如果服务端渲染必须完整解析所有引用，请将完整文档通过单一组件渲染。

<span id="smooth-streaming-and-turn-taking"></span>

## 平滑流式与轮流呈现

`AIMarkdownSmoothStream` 在基础属性之外扩展了 `pacing`（`smooth`、`balanced`、`responsive`）与 `coordinate`（默认 `true`）。开始时直接显示已有内容，包括服务端渲染和重新挂载的内容。后续追加的文本才播放动画。生成端结束后，组件会继续排空剩余的展示队列，随后才会清除流式状态。直接替换文本会立即跳转更新，不会重放无关内容。

在 `AIMarkdownDocuments` 内部，显式指定相同文档 ID 的平滑片段会共享一个轮流呈现协调器。挂载时内容为空的片段会等待先注册的平滑片段输出结束。挂载时已有内容的片段不会隐藏已经可见的文本。本次注册完成后，不会因替换内容重新进入队列。呈现顺序依据挂载顺序；`documentIndex` 仅用于引用编号排序，不影响平滑输出轮次。

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

`waiting` 插槽仅在组件位于 `AIMarkdownDocuments` 内部且前置平滑片段仍在生成或排空时生效。上方展示的单组件示例不会进入等待状态。

组件通过模板引用导出 `flush()`。当数据源仍在活跃时，`flush()` 遵循引擎的字素保留规则，不会将尚未完整的复合字素强行截断展示。

编写自定义包装器时，可以在 setup 中调用 `useSmoothStream` 或 `useDocumentSmoothStream`，并传入一个返回最新字符串和布尔值的 getter 函数。在该 getter 内部读取应用响应式引用的 `.value`；完整示例见 [Vue 流式指南](../guides/vue-streaming.md#build-a-custom-wrapper-with-a-live-getter)。返回的 `content` 与 `streaming` 为只读的计算属性 ref；文档变体还会返回 `pending`。在渲染函数中请读取 `.value`，模板中则会自动解包。请始终传入响应式状态的 getter 函数，而不是捕获一次性的静态对象快照。

<span id="composable-reference"></span>

## 组合式函数参考

从 `@ai-markdown/vue` 导入组合式函数及其输入类型。请在组件 setup 期间调用，并通过 getter 传递实时状态。

| 输入字段     | 类型                 | 默认值 / 契约                                                            |
| ------------ | -------------------- | ------------------------------------------------------------------------ |
| `content`    | `string`             | 必填项，当前累积的完整源文本                                             |
| `streaming`  | `boolean`            | 省略时表示生成端未处于活跃状态                                           |
| `pacing`     | `SmoothStreamPacing` | `smooth`、`balanced` 或 `responsive`；省略时使用引擎内置的 balanced 预设 |
| `documentId` | `string`             | 仅文档变体需要；在 `AIMarkdownDocuments` 内传入显式 ID 启用协调          |
| `coordinate` | `boolean`            | 仅文档变体需要；设为 `false` 可退出协调，否则符合条件的参与者共同协调    |

`SmoothStreamInput` 包含前三个字段。`DocumentSmoothStreamInput` 进一步扩展了文档标识与协调选项。两个函数均接受 `input: () => Input` 类型的参数。

| 返回成员                          | 契约与说明                                                         |
| --------------------------------- | ------------------------------------------------------------------ |
| `content: ComputedRef<string>`    | 只读的当前可见源文本；模板中自动解包，渲染函数中使用 `.value`      |
| `streaming: ComputedRef<boolean>` | 当生成端处于活跃状态或可见文本仍滞后于输入时为 true                |
| `flush(): void`                   | 立即排空展示可用文本；挂载前控制器尚未创建，活跃字素保留机制仍生效 |
| `pending: ComputedRef<boolean>`   | 仅文档变体提供；挂载时为空的参与者在排队等待自身轮次时为 true      |

控制器与监听器在挂载时创建并在卸载时自动释放。初始/SSR 内容展示完整。调整 `pacing` 会动态更新现有控制器的选项。当文档标识或协调资格变化时，文档变体会自动释放旧协调器的订阅。

`AIMarkdownSmoothStream` 将上述结果应用于内部的 `AIMarkdown`。其扩展属性为 `pacing`（默认 `balanced`）与 `coordinate`（默认 `true`），并通过模板引用暴露 `flush()`。组件本身不派发完成事件；若应用需监听展示排空完成，建议在自定义组合式函数中观察返回的计算状态。

## 插槽与上下文类型

| 插槽                                   | 上下文与行为                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 具体 HTML 标签名（如 `strong` 或 `a`） | 接收 `MarkdownElementContext`；优先级高于匹配的 `components` 映射项                               |
| `cursor`                               | 接收 `{ streaming: true }`；在渲染器处于流式状态且开启 `streamingCursor` 时渲染光标外层内部的内容 |
| `waiting`                              | 仅平滑组件提供；无插槽参数；在文档轮流呈现排队等待期间替换原有渲染内容                            |

`MarkdownElementContext` 包含 `node`（渲染拥有的 HAST 元素节点）、`properties`（清洗后的元素属性）、`children`（转换后的 Vue 子节点）、`streaming`（布尔值）与 `metadata`（应用层数据）。这是元素插槽的契约规范，与光标插槽不同。

`MarkdownComponents` 为只读的标签名到 Vue 组件的映射表。映射组件接收元素属性以及 `node`、`streaming` 与 `metadata`，并在默认插槽中接收转换后的子节点。`MarkdownElementSlot` 是接收 `MarkdownElementContext` 并返回 Vue 子节点的函数类型。完整用法见[自定义渲染指南](../guides/vue-customization.md)。

`AIMarkdownDocuments` 接收默认插槽并渲染为 Fragment 片段。它不声明自定义配置属性；孤立引用策略由各个渲染器自行配置。它负责建立文档作用域，不额外生成布局 DOM 节点。

<span id="cursor-behavior"></span>

## 光标行为

光标通过 DOM Range 测量最终可见的正文文本位置，并跟随内容变更、尺寸调整与页面滚动。当遇到代码块、数学公式、图片或不支持的元素末尾时会自动隐藏，不会错误定位到前置段落。共享的 `deriveTailSignal` 能够识别不可见的链接定义与脚注定义末尾；仅当脚注的实际尾部列表项位于当前组件内时才显示光标。监听器与动画帧在组件卸载时自动释放。默认动画遵循系统的减弱动态效果设置。

导出的 `AIMarkdownStreamingCursor` 不声明自定义属性。其默认插槽用于自定义指示器图标，默认显示为 `▍`。该组件会测量直接父元素并渲染为绝对定位、带有 `aria-hidden` 的外层容器。推荐优先使用渲染器的 `cursor` 插槽，这样能保证组件位于正确的测量根节点内并获得准确的末尾标记。若直接挂载光标组件，应用需自行管理其定位与挂载/卸载时机；独立的光标组件不直接读取 `streaming` 属性。

<span id="api-and-distribution"></span>

## API 与分发产物

根入口导出 `AIMarkdown`（同时为默认导出）、`AIMarkdownDocuments`、`AIMarkdownSmoothStream`、`AIMarkdownStreamingCursor`、`useSmoothStream` 与 `useDocumentSmoothStream`，以及对应的属性、上下文和输入类型。同时重新导出了封闭的引擎插件目录、LaTeX 与 remend 预处理器工厂函数、schema 扩展工具与默认 URL 策略。具体类型签名请参阅公开类型声明文件。

ESM 与 CJS 产物均提供开发版与生产版入口，并配有对应的 `.d.ts` 声明文件。Vue、core 与 engine 保持外部依赖。无 React peer 依赖、React 上下文或 `"use client"` 指令。公开包仅暴露根入口、样式表与 `package.json`；生命周期辅助函数与 HAST 转换器属于内部实现细节。适配器与 React 共享底层流水线会话与数据构建，但不共用 React 专属的块级规划器或块渲染缓存：每帧的 HAST 会全量转换为 VNode 树，由 Vue 自身的响应式与 patch 算法进行 diff 更新。

<span id="verification-and-scope"></span>

## 验证与测试命令

```bash
pnpm build
pnpm --filter @ai-markdown/vue typecheck
pnpm --filter @ai-markdown/vue test
pnpm test:vue-browser
pnpm test:vue-browser:compat
pnpm check:public-api
pnpm test:packed-consumers
```

单元测试覆盖了服务端渲染、内容清洗、自定义渲染以及生命周期注册与释放。浏览器测试覆盖了三种核心集成路径：独立组件水合；跨片段引用与文档切换；自定义渲染、平滑等待/排空与光标定位。打包使用测试在两种导出条件下加载 ESM/CJS，编译安装后的声明文件并在工作区外解析 CSS。

本实现不声明与 React/Mantine 的 UI 表现完全对齐：Mantine 仅针对 React，Vue 未内置 Mermaid 或代码工具栏集成。Nuxt 专属打包以及与 KeepAlive / Suspense 的组合在宣传前需建立独立的集成测试覆盖。解析正确性继续由仓库共享的基准测试集与发布验证流程保障。

## 交互式示例

在仓库根目录运行 `pnpm storybook:vue`。开发启动器直接解析包源码与样式，在 6008 端口提供热更新；`pnpm storybook` 会同时启动 React 并在 6006 端口提供聚合入口。

章节名称与顺序与 React 目录对齐。建议依次查阅 **Streaming/Streaming Basics**、**Incremental Parsing**、**Smooth Streaming**、**Streaming Cursor**、**Turn Taking** 与 **Error Recovery** 了解对应生命周期。**Documents/Cross-Chunk Coordination** 演示了后置定义与重复脚注；**Definition Lifecycle** 展示了更新与隔离机制。**Basics/Engine Plugins** 演示了响应式插件选择。**Customization/Custom Components** 与 **Metadata** 展示了元素映射、作用域插槽与上下文；**URL Sanitization**、**Content Preprocessors** 与 **Orphan References** 展示了输出策略。每个章节均包含使用说明与浏览器断言；相关示例提供可编辑的 Controls 控件。

React 专有的排版 token、额外样式注册表、上下文工厂、Mantine 组件与渲染性能分析保持独立。相关对比与说明可参阅示例指南，并运行 `pnpm test:storybook:vue` 在 Chromium 中验证 Vue 示例。

## 浏览器压力验证

构建工作区后，在仓库根目录运行 `pnpm test:vue-browser`。该命令已集成至 CI、发布验证与本地 preflight 中。它会在 Chromium 中检查水合、跨片段引用、自定义渲染、平滑流式轮流呈现以及光标定位。

该命令还会保持文档 Provider 挂载并运行 24 个文档生命周期与 288 次追加更新。它会验证排队片段是否按顺序等待、生成完成后的排空过程、取消正在生成的片段能否正确释放后续片段、替换与文档切换能否正确更新渲染结果，以及组件卸载时是否释放了所有文档订阅。在 Provider 保持挂载的同时触发强制垃圾回收后，针对注册表与平滑协调器的弱引用必须被成功回收。这样无需依赖存在波动的堆大小绝对阈值即可可靠发现残留的文档状态。

这些是边界明确的浏览器回归测试，并非引擎层面的全量一致性浸泡测试，也不构成无限长会话内存稳定性的证明。强制垃圾回收所有权检查仅针对 Chromium；Firefox 与 WebKit 则通过 `pnpm test:vue-browser:compat` 运行功能水合、引用、定制、平滑流式与光标测试。这些检查不代替 Nuxt、KeepAlive 或 Suspense 的专属测试。

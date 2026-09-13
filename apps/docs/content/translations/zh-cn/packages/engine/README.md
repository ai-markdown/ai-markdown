# @ai-markdown/engine

[文档](https://ai-markdown.github.io/docs/engine/) · [示例](https://ai-markdown.github.io/examples/) · [官网](https://ai-markdown.github.io/)

[![@ai-markdown/engine stable](https://img.shields.io/npm/v/@ai-markdown/engine?label=npm&color=blue)](https://www.npmjs.com/package/@ai-markdown/engine?activeTab=versions)
[![@ai-markdown/engine monthly downloads](https://img.shields.io/npm/dm/@ai-markdown/engine?label=downloads%2Fmonth&color=blue)](https://www.npmjs.com/package/@ai-markdown/engine)
[![TypeScript declarations included](https://img.shields.io/badge/TypeScript-included-3178c6?logo=typescript&logoColor=white)](https://github.com/ai-markdown/ai-markdown/tree/main/packages/engine)
[![MIT license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/ai-markdown/ai-markdown/blob/main/LICENSE)

> **自 3.0.0 起：** React 与 Vue 适配器共享公开的 `@ai-markdown/core` 与 `@ai-markdown/engine` 相关包。详见[迁移指南](https://ai-markdown.github.io/docs/guides/framework-transition/)。

`@ai-markdown/engine` 包含 ai-markdown 所使用的字符串与语法树处理逻辑：LaTeX 预处理、unified 插件链、增量解析以及共享引用管理。它不依赖 React。框架适配器提供组件生命周期、DOM 渲染、Context 订阅以及语法高亮等展示功能。

**这是面向适配器开发者的算法层。** 共享 core、React 与 Vue 均以完全相同的发布版本使用它。公共根目录导出解析、预处理、注册表与策略契约；测试装置与私有注册表容器被排除在外。已记录的公开契约自 3.0.0 起遵循语义化版本规范；破坏性变更需要升级主版本。应用程序应安装 `@ai-markdown/react` 或 `@ai-markdown/vue`；详见[快速开始](https://ai-markdown.github.io/docs/guides/getting-started/)。

以下示例演示了各个独立的入口点。它们并不组装一个完整的框架适配器：URL 转换、协调占位符渲染、Effect 时机以及 CSS 仍由适配器负责处理。

<span id="whats-inside"></span>

## 包含内容

所有内容均从相关包根目录导出（`import { … } from '@ai-markdown/engine'`）；按层次结构划分：

| 层次       | 包含模块                                                                                                                                                         | 核心亮点                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 预处理器   | `preprocessors/latex`、`preprocessors/remend`、`preprocessAIMDContent`                                                                                           | `preprocessLaTeX(text)`（货币 `$`、`\[…\]` / `\(…\)` 规范化、代码块与行内代码保护）、用于纯追加流的 `createIncrementalLatexPreprocessor()`、用于未闭合标记修复的 `remend`                                                                                                                                                                                                                                             |
| 增量解析   | `incrementalParse/*`                                                                                                                                             | `advanceIncrementalParse(state, content, options)` —— 前缀冻结引擎：行扫描器判定经过验证的安全冻结边界，仅对尾部重新解析，并将两棵语法树拼接；每一帧都与全量解析深层等价（由仲裁测试套件强制保证）或安全回退到全量解析                                                                                                                                                                                                |
| 流水线组装 | `markdown/*`、`pluginChain`、`plugins/catalog`、`customMdastHandlers`、`remarkInjectPhantomDefs`、`rehypeRebaseHashLinks`、`rehypeFooterAdorn`、`rehypeRawGuard` | `buildCoreRemarkPlugins` / `buildCoreRehypePlugins` / `buildCoreRemarkRehypeOptions` —— React 与 Vue 渲染器共享的插件链；密封的引擎插件目录（`highlight`、`definitionList`、`removeComments`、`smartypants`、`pangu`、`defaultEnginePlugins`）；`EngineRawHtmlDepthError`，当元素嵌套深度超过 `RAW_HTML_MAX_DEPTH`（256；见下文）或步骤自身遍历耗尽调用栈时，由插件链受保护的原生 HTML 步骤抛出（守卫本身为内部逻辑） |
| 跨片段协调 | `documentRegistry`、`collectDefLabels`、`extractContributions`、`extractDefBodiesFromHast`、`crossChunkUrlSanitize`                                              | `createRegistry()` —— 负责单文档内跨片段脚注编号与链接定义解析的存储中心；`sanitizeCrossChunkUrl()` 镜像了独立的双门禁 URL 策略                                                                                                                                                                                                                                                                                       |
| 安全清洗   | `sanitizeSchema`、`extendSanitizeSchema`、`markdown/urlTransform`                                                                                                | 库默认的 `rehype-sanitize` Schema（只读单例 —— 使用 `extendSanitizeSchema` 进行扩展）、`defaultUrlTransform`                                                                                                                                                                                                                                                                                                          |
| 流式控制   | `smoothStream/controller`                                                                                                                                        | `createSmoothStreamController()` —— `<AIMarkdownSmoothStream>` 底层与框架无关的打字机节奏状态机，配套提供 `SMOOTH_STREAM_PACING_PRESETS`                                                                                                                                                                                                                                                                              |
| 叶子工具   | `hastPredicates`、`normalizeId`、`shortenDocumentId`、`devStageTimings`                                                                                          | 小型纯函数辅助工具；共享测试语料保持仅限源码使用，不对外导出                                                                                                                                                                                                                                                                                                                                                          |

<span id="install"></span>

## 安装

```bash
npm install @ai-markdown/engine
```

提供双格式 ESM/CJS 构建并均附带类型声明。ESM 保持流水线依赖为外部依赖。CJS 构建打包了仅提供 ESM 默认导出的插件，以便 Node 能够接收可调用的插件，且不会尝试通过 `require` 去解析仅支持 import 的 `remend` 入口。打包的第三方开源许可证位于 `dist/THIRD_PARTY_LICENSES.txt` 中。无 React 依赖。唯一的对等依赖是 `katex`（`^0.16 || ^0.17`，**可选** —— 仅在渲染数学公式时需要）。流水线还会通过 `rehype-katex` 传递引入 KaTeX。如果你的应用需要引入 KaTeX CSS 样式，请直接声明 KaTeX 依赖，以便样式导入能够独立于依赖提升进行解析。纯语法树使用方无需加载浏览器样式表。

<span id="example-the-latex-preprocessor-on-its own"></span>
<span id="example-the-latex-preprocessor-on-its-own"></span>

## 示例：单独使用 LaTeX 预处理器

```ts
import { preprocessLaTeX } from '@ai-markdown/engine';

preprocessLaTeX('Price is $100, and \\(x^2\\) is inline math.');
// → 'Price is \\$100, and $$x^2$$ is inline math.'
// (currency `$` escaped; `\\(…\\)` normalized to the `$$…$$` form remark-math's inline rule accepts)
```

该函数同样在 `@ai-markdown/react` 内部的每次解析前执行；增量变体（`createIncrementalLatexPreprocessor`）可在仅追加内容的各帧之间复用计算成果。

<span id="example-driving-the-incremental-parser"></span>

## 示例：驱动增量解析器

```ts
import {
  advanceIncrementalParse,
  buildCoreRemarkPlugins,
  buildCoreRehypePlugins,
  buildCoreRemarkRehypeOptions,
  defaultEnginePlugins,
  sanitizeSchema,
  type IncrementalParseState,
  type AdvanceOptions,
} from '@ai-markdown/engine';

const remarkPlugins = buildCoreRemarkPlugins(defaultEnginePlugins);
const rehypePlugins = buildCoreRehypePlugins(sanitizeSchema, 'example-user-content-');
const remarkRehypeOptions = buildCoreRemarkRehypeOptions(true);
const options: AdvanceOptions = {
  remarkPlugins,
  rehypePlugins,
  remarkRehypeOptions,
  // Keep this key stable until a pipeline input changes.
  depsKey: [remarkPlugins, rehypePlugins, remarkRehypeOptions],
  defListEnabled: true, // defaultEnginePlugins includes definitionList.
};

let state: IncrementalParseState | null = null;
for (const frame of ['# Hello', '# Hello\n\nworld', '# Hello\n\nworld and more']) {
  const result = advanceIncrementalParse(state, frame, options);
  state = result.nextState;
  // result.hast — the full-document hast for this frame
  // result.usedIncremental / result.boundary — whether the frame spliced, and where
}
```

`AdvanceOptions` 详细记录在 `incrementalParse/advanceIncrementalParse.ts` 中；React 渲染器的 `MarkdownContent` 是参考使用实现。

<span id="verification"></span>

## 验证

增量引擎配有五层等价性验证技术栈（固定测试装置、模糊仲裁器、方向测试集、穷尽普查、仲裁敏感度元测试套件）以及六阶段发布门禁压测（`scripts/soak/soak.sh`，带有完整的发布配置与全新的随机种子基准）；完整记录位于 `src/experiments/prefixFreeze/README.md` 中。迄今为止发现的每一个可触达的差异均已固定为确定性的测试用例。

<span id="runtime-support"></span>

## 运行时支持

纯粹针对字符串与语法树的计算：无 DOM 访问、无 Node 专用 API、无未受保护的环境变量读取。可在浏览器、Node、Web Worker 以及嵌入式 JS 运行时（如 Hermes/JavaScriptCore）中运行。

<span id="nesting-depth-bound"></span>

### 嵌套深度边界

原生 HTML 步骤之后的每个遍历器在每个嵌套层级都会递归一次，因此包含数百至数千个嵌套标签的数据帧会在 HTML 重新解析与适配器渲染之间的某处耗尽调用栈，具体位置取决于引擎。因此，原生 HTML 步骤在语法树重新解析完成后立即使用迭代遍历测量元素嵌套深度，并在深度超过 `RAW_HTML_MAX_DEPTH`（256）时抛出 `EngineRawHtmlDepthError`。使用 `scripts/measure-raw-depth.mjs` 测得的嵌套 `<div>` 首次失败深度（2026-09-11，Playwright，默认调用栈；近似值，栈限制随 JIT 状态波动）：

| 浏览器   | 原生步骤（`hast-util-from-parse5`） | Vue 适配器 | React 适配器                     |
| -------- | ----------------------------------- | ---------- | -------------------------------- |
| Chromium | ~1920                               | ~1024      | 高于原生步骤（原生步骤优先失败） |
| Firefox  | ~8193                               | ~2048      | ~4864                            |
| WebKit   | ~8193                               | ~4096      | 高于原生步骤（原生步骤优先失败） |

该上限比上述最浅的溢出深度低四倍，远高于正常内容（64 层嵌套列表即为 128 层深度）。`@ai-markdown/core` 中 `createPipelineSession` 的使用者会将此类数据帧渲染为纯文本；手动组装的流水线会接收到该错误。当渲染器或浏览器发生变化时，请重新运行该脚本。

<span id="versioning"></span>

## 版本策略

与 `@ai-markdown/react` 严格保持统一版本发布，后者**严格**锁定本包版本 —— engine 与共享 core 暴露了遵循 3.0.0 起语义化版本规范的显式适配器契约（见上文状态说明）。发布更新记录详见[版本更新亮点](https://ai-markdown.github.io/docs/guides/release-highlights/)。

<span id="package-family"></span>

## 相关包家族

| 相关包                                                                                                   | 职责角色                                                                                            | 版本策略                                     |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| [`@ai-markdown/core`](https://www.npmjs.com/package/@ai-markdown/core)                                   | 与框架无关的会话、块规划、贡献与平滑协调                                                            | 统一版本发布；精确依赖 engine                |
| [`@ai-markdown/react`](https://www.npmjs.com/package/@ai-markdown/react)                                 | React 渲染器 —— `<AIMarkdown>`、`<AIMarkdownSmoothStream>`、`<AIMarkdownDocuments>`、Hook、Provider | 统一版本发布                                 |
| [`@ai-markdown/vue`](https://www.npmjs.com/package/@ai-markdown/vue)                                     | Vue 3.5 渲染器 —— 组件、作用域插槽、SSR/水合与平滑组合式函数                                        | 统一版本发布；精确依赖 core 与 engine        |
| [`@ai-markdown/react-mantine`](https://www.npmjs.com/package/@ai-markdown/react-mantine)                 | Mantine UI 绑定 —— 主题排版、代码高亮选项卡、Mermaid、色彩方案串联                                  | 统一版本发布；兼容 React 3.x 对等依赖        |
| [`@ai-markdown/engine`](https://www.npmjs.com/package/@ai-markdown/engine)                               | 框架中立引擎 —— 增量解析、LaTeX 预处理、插件流水线、跨片段注册表                                    | 统一版本发布；由共享 core 与各适配器严格固定 |
| [`@ai-markdown/remark-mark-highlight`](https://www.npmjs.com/package/@ai-markdown/remark-mark-highlight) | 支持 `==mark==` 高亮语法的 remark 插件                                                              | 独立语义化版本发布                           |

<span id="owning-incremental-state"></span>

## 管理增量状态

每个逻辑输入流保留一个解析状态。将当前完整的源文本传给 `advanceIncrementalParse`，并仅保留其返回的 `nextState` 用于下一帧计算。文本替换或安全门禁触发可能选择全量解析；`usedIncremental: false` 属于预期内的正常结果，本身不是错误。返回的 HAST 依然代表当前整篇文档。

成功的拼接处理既取决于源文本的连续性，也取决于流水线的兼容性。如果所选插件、Schema、命名空间或转换选项发生改变，请同步更新依赖项 key。原地修改插件数组同时保留其引用同一性可能会导致手动构建的适配器在错误的假设下复用旧状态。示例中仅创建一次流水线，并在解析选项与插件选择中一致地启用定义列表处理。

`advanceIncrementalParse` 不会自动隐式应用 core 所暴露的每一项预处理便利功能。当需要 core 的 LaTeX 行为时，请先规范化原始输入；若使用有状态形式，每个流需保留独立的增量 LaTeX 预处理器。用户自定义转换在 core 中针对规范化字符串运行；单纯复现解析调用并不等同于复现 React 适配器的完整输入流水线。

<span id="adapter-responsibilities"></span>

## 适配器职责

HAST 语法树是中间表示，不是最终的 HTML 或 React 输出。Rehype 安全清洗器在插件链中运行，而 URL 转换属于后续的渲染关注点。直接使用方必须对保留下来的 URL 属性应用对应的 URL 策略，并且在重新访问保留语法树时必须保持收敛性。

跨片段协调不仅需要创建注册表。Core 在提交后注册片段并贡献处理后的数据，订阅文档与标签变动，在使用片段策略下渲染占位符，并输出统一的聚合页脚。Engine 构建的私有占位符标签在发布的流水线中同样使用溯源边界。缺少匹配凭据生命周期的手工组装流水线无法直接作为开箱即用的协调渲染器使用。

在构建其他宿主时，可将 React 适配器作为源码级参考，并为该宿主建立独立的生命周期与等价性测试。[架构设计全景](https://ai-markdown.github.io/docs/guides/architecture/)梳理了阶段执行顺序，而[压测覆盖](https://ai-markdown.github.io/docs/guides/soak-coverage/)区分了成功的 Oracle 比对与优化路径确实得到执行的测试证据。

<span id="repository-commands"></span>

## 代码仓库命令

安装工作区依赖后，使用 `pnpm --filter @ai-markdown/engine build` 进行构建，使用 `pnpm --filter @ai-markdown/engine typecheck` 进行类型检查。该相关包的 `fuzz:splice` 命令用于运行拼接属性测试套件；`soak:coverage` 用于验证覆盖映射表。开发环境压测使用 smoke 配置，复用的诊断随机种子标记为 replay 运行。只有完整的发布测试证据才能判定发布合格（PASS）。

实验性 README 记录了最初的 L0–L4 研究与后续的验证历史。其历史测试数量与层级分类不能替代当前的生产扫描器、覆盖映射表或发布运行器配置。

<span id="license"></span>

## 开源协议

MIT

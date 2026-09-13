# @ai-markdown/core

[文档](https://ai-markdown.github.io/docs/core/) · [示例](https://ai-markdown.github.io/examples/) · [官网](https://ai-markdown.github.io/)

[![@ai-markdown/core stable](https://img.shields.io/npm/v/@ai-markdown/core?label=npm&color=blue)](https://www.npmjs.com/package/@ai-markdown/core?activeTab=versions)
[![@ai-markdown/core monthly downloads](https://img.shields.io/npm/dm/@ai-markdown/core?label=downloads%2Fmonth&color=blue)](https://www.npmjs.com/package/@ai-markdown/core)
[![TypeScript declarations included](https://img.shields.io/badge/TypeScript-included-3178c6?logo=typescript&logoColor=white)](https://github.com/ai-markdown/ai-markdown/tree/main/packages/core)
[![MIT license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/ai-markdown/ai-markdown/blob/main/LICENSE)

为 ai-markdown 适配器提供与框架无关的编排能力，与 React 和 Vue 适配器处于同一发布版本。它提供流水线会话、块规划、跨片段贡献、聚合脚注树以及流式协调能力。应用程序安装 `@ai-markdown/react` 或 `@ai-markdown/vue`；适配器开发者可直接安装 `@ai-markdown/core` 与 `@ai-markdown/engine`。

本包在旧版 v2.14.1 发布中为私有运行时。在当前版本中，它已成为两个框架适配器的实际外部依赖项，并具有显式的公开导出列表。旧版 `@ai-react-markdown/core` React 包对应于 `@ai-markdown/react`，而非本包。详情请参阅[迁移指南](https://ai-markdown.github.io/docs/guides/framework-transition/)。已记录的公开契约自 3.0.0 起遵循语义化版本规范；请保持共享包处于完全相同的发布版本。

<span id="responsibility-and-dependency-direction"></span>

## 职责与依赖方向

```text
@ai-markdown/react-mantine → @ai-markdown/react (peer)
@ai-markdown/react         → @ai-markdown/core + @ai-markdown/engine
@ai-markdown/vue           → @ai-markdown/core + @ai-markdown/engine
@ai-markdown/core          → @ai-markdown/engine
```

适配器也可以直接使用 engine 原语。共享 core 不会重复复制 engine 的公开 barrel 导出，也不会仅仅为了重命名而包装每个 engine 函数。它负责原本需要复制到另一个框架适配器中的可复用编排逻辑。

| 模块                         | 职责定位                                                                                                                                    | 状态归属                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `coordinationPreparation.ts` | 推导幻影目标，选取协调/孤立处理器与提取策略，构建贡献失效元组                                                                               | 纯决策函数；先前快照归属于调用方 |
| `pipelineSession.ts`         | 合并协调解析选项，追加受保护的幻影后缀，选择全量/增量解析，重置失效状态，在出错时回退到全量解析，或仅在遇到引擎原始深度错误时回退到纯文本帧 | 每个渲染片段对应一个会话         |
| `blockPlan.ts`               | 将转换后的 HAST 与源码 MDAST 进行关联，生成稳定 key，分类引用依赖与被吞没的 HTML，计算注册表指纹                                            | 基于传入的语法树与注册表的纯函数 |
| `blockPlanner.ts`            | 复用符合条件的保留前缀规划，同时保留整篇文档的引用上下文                                                                                    | 每个渲染片段对应一个规划器       |
| `contribution.ts`            | 比对源码与策略指纹，提取转换后的定义正文，发布发生变更的已提交贡献                                                                          | 每个挂载片段对应一个发布器       |
| `aggregateFootnotes.ts`      | 将文档的有序脚注与引用反向链接组装为 HAST                                                                                                   | 返回的语法树归属于调用方         |
| `cloneHastForRender.ts`      | 在渲染时发生修改之前，克隆 node/children/properties/data 与原始 URL 容器                                                                    | 返回的克隆对象归属于调用方       |
| `smoothCoordinator.ts`       | 编排片段展现顺序，维持完成状态粘滞性，延迟清理并合并通知                                                                                    | 每个逻辑文档对应一个协调器       |
| `tailSignal.ts`              | 对渲染在脚注内部或作为不可见链接定义的源码尾部进行分类识别                                                                                  | 基于 MDAST 的纯函数              |

Engine 依然负责语法解析、预处理、插件链、扫描器、增量解析算法、注册表存储/索引、引用解析以及 URL 策略原语。共享 core 使用这些算法来实现可复用的渲染决策。

框架适配器保留组件构建与生命周期集成职责。React 保留 `ReactNode` 缓存、Context、Effect、`useSyncExternalStore`、注册生命周期、溯源凭据分配、最终元素转换以及 DOM 光标测量。共享 core 的根模块不依赖 React、Vue、Svelte 或 DOM。其生产源码在不引入 DOM 类型库的环境下通过类型检查。Node 类型仅为跨宿主原语（如 `queueMicrotask`）提供类型声明，不会引入 Node 运行时依赖。

<span id="a-pipeline-session-is-local-to-one-consumer"></span>

## 每个渲染片段独立持有解析会话

为一个渲染的逻辑片段创建一次会话。将预处理后的累积内容、稳定的插件数组以及当前的协调事实传入 `parse`。返回结果包含 MDAST 与 HAST，不包含任何框架特定的节点。

```ts
import { createBlockPlanner, createPipelineSession } from '@ai-markdown/core';
import {
  buildCoreRemarkPlugins,
  buildCoreRehypePlugins,
  buildCoreRemarkRehypeOptions,
  sanitizeSchema,
} from '@ai-markdown/engine';

const pipeline = createPipelineSession();
const planBlocks = createBlockPlanner();
const remarkPlugins = buildCoreRemarkPlugins([]);
const rehypePlugins = buildCoreRehypePlugins(sanitizeSchema, 'example-');
const remarkRehypeOptions = buildCoreRemarkRehypeOptions(false);
const targetPhantoms = { missingFootnotes: new Set<string>(), missingLinks: new Set<string>() };
const content = 'A **framework-neutral** frame.';

const trees = pipeline.parse({
  content,
  targetPhantoms,
  remarkPlugins,
  rehypePlugins,
  remarkRehypeOptions,
  preserveForBodyHarvest: false,
  documentId: 'example',
  provenance: 'standalone-example',
  incrementalParse: false,
  defListEnabled: false,
});
const blocks = planBlocks(trees.mdast, trees.hast, content);
// Convert blocks.plan using the host renderer; use item.key for sibling identity.
```

这是使用公开相关包入口的独立示例。一个参与跨片段协调的适配器必须获取每实例独立的溯源凭据，将同一凭据传给引擎验证器和协调处理器，推导实际的幻影目标，并在注册期间保留定义正文。示例中的常量凭据不适用于协调路径。

宿主环境为单次服务端渲染选用 `incrementalParse: false`。共享 core 不会检查 `window` 对象来推断宿主环境。在非增量帧之后，后续的增量帧会从全新的初始状态开始。当宿主环境因渲染策略发生变更而使保留的解析状态失效时，调用 `reset()`。解析输入的同一性也会通过引擎的依赖项 key 进行检查；幻影后缀的变更始终作为尾部输入处理，不会使所有已保留的源文本失效。

增量解析失败会在重试完整流水线之前清空已保留的状态。完整流水线只有一种降级输出：当引擎的原生 HTML 处理步骤报告 `EngineRawHtmlDepthError`（元素嵌套深度超过引擎限制 `RAW_HTML_MAX_DEPTH`，数百个嵌套原生 `<div>` 标签即可触发）时，会话会在开发构建中记录该错误，并将该帧渲染为一个覆盖完整源码位置的转义纯文本段落，这样一条恶意消息就不会导致整个宿主界面崩溃；下一帧将正常解析。这种应急降级呈现的是转义文本，而不是陈旧的旧帧。完整流水线抛出的任何其他异常都会直接向上传递给宿主，包括非该溢出的 `RangeError` 以及由宿主传入的 remark/rehype 插件或处理器抛出的异常：这些属于应暴露的代码缺陷，不应降级为纯文本渲染，且该回退机制不能替代适配器代码外层的错误边界（Error Boundary）。每个会话与规划器都是可变且局部的计算状态：切勿跨独立的片段或并发执行的使用方共享同一个实例。

<span id="shared-preparation-decisions"></span>

## 共享的准备决策

`coordinationPreparation.ts` 包含 React 适配器与 [Vue 适配器](../vue/README.md) 共同使用的规则：

- `derivePhantomTargets({ content, ownLabels, labels }, previous?)` 排除本地拥有的定义，然后将规范化后的源码与外部标签进行比对。脚注与链接命名空间保持独立。如果不存在候选标签，则跳过源码规范化；如果结果集合与 `previous` 相同，则返回同一对象。比对逻辑保留了旧版的子串高估算法，并非新增的 Markdown 引用解析器。
- `deriveCoordinationPolicy({ coordinated, registered, preserveOrphanReferences }, previous?)` 选取全部协调处理器、仅孤立脚注处理器，或常规的单机独立行为。只要完成注册，即使禁用了可见孤立项渲染，也会开启正文提取。仅变更提取策略会保持处理器引用同一性。宿主环境在调用此函数前应先解析包装层的任何覆盖项。
- `buildContributionChain(inputs)` 显式声明策略依赖项：remark/rehype 数组、remark-rehype 选项、处理器、正文提取策略、防污染前缀、文档 ID 与溯源标识。源码、幻影集合、注册表与符号仍属于发布器自身的指纹输入。

这些函数不会执行注册、订阅、发布或修改传入的快照数据。请将标签集合与返回的对象视为不可变对象；仅在来自同一个逻辑使用方时才传入先前的结果。React 在 ref 中保留先前快照并配合记忆化；Vue 在计算属性中使用局部变量。当源内容被替换或保留的渲染被丢弃时，引擎与规划器仍能保证计算的正确性。

已发布的 [Vue 适配器](../vue/README.md) 在其组件生命周期中采用了这些决策，同时避免将 AST/注册表对象放入深层响应式代理中。它提供 SSR、水合、插槽、基础样式以及光标支持，并在 Chromium、Firefox 与 WebKit 下通过了功能适配器检查，在 Chromium 下通过了强制 GC 生命周期检查。早期的私有原型已归档在 `prototypes/` 目录下，不再是应用入口点。

<span id="preparation-and-commit-have-different-effects"></span>

## 准备阶段与提交阶段具有不同的作用

解析、规划以及构建贡献会话的操作不会注册片段，也不会发布文档事实。宿主环境在其 commit/生命周期阶段注册片段，获得一个 Symbol 凭据，并且仅对已提交且其 Symbol 归属于当前注册表的渲染调用 `createContributionSession().commit(options)`。

在 React 中，`useRegistryContribution` 管理一个会话并在 Effect 中调用 `commit`。注册 Symbol 与其注册表成对绑定；切换文档不会短暂使用旧文档的 Symbol 发布新帧。SSR 不运行该 Effect，因此保留了局部脚注语义。其他适配器必须自行提供等价的生命周期保证。

贡献指纹覆盖了有序引用、定义源、原始链接目标、拥有的标签集合、幻影目标集合以及解析策略的标识元组。源码相同但插件改变不属于等价贡献。源码相同但定义正文中的幻影得到解决同样不属于等价贡献。只有指纹或策略发生变化时，才会触发开销较大的流水线后 HAST 正文提取。

发布器在贡献阶段不会对链接 URL 进行安全清洗：每个使用元素根据自身策略应用最终的 URL 策略。提取的脚注正文保留插件输出结果。`buildAggregateTree` 在追加反向链接前克隆结构容器，因此组装过程不会修改注册表拥有的正文。克隆操作会复制 `data` 及其 `originalUrls` 容器，同时共享 `position`、其他嵌套插件数据以及各个属性值；它不是供使用端随意修改的无限制深拷贝。

清理工作同样属于宿主的职责。在片段卸载时，释放其注册表注册信息与平滑协调器插槽。协调器将移除操作延迟到微任务中，以便连续的清理/重新注册操作能够恢复同一插槽而无需重新排序。在注册期间，完成状态具有粘滞性；进度心跳不会在每个展开帧上通知所有订阅者。

<span id="planning-and-rendering-contracts"></span>

## 块规划与渲染契约

块规划基于 HAST 子节点进行，因为转换过程可能会丢弃或重新组合源码节点。每个规划项拥有一个中立的 `key` 以及类型标识：`block`、`inline` 或 `synthetic`。块包含源码范围、行列位置、依赖标签以及可选的被吞没 HTML 摘要。规划器的 key 代表同级节点的身份标识；它们本身不足以验证缓存输出的有效性。

渲染器还必须对比相同源码分桶内的出现频次、依赖指纹、位置、HTML 摘要以及剥离被吞没的局部脚注小节的决策。React 适配器将此缓存保留在 `packages/react/src/components/blockMemo.ts` 中。它会原子化替换上一帧的缓存，从而使被移除的块释放其对应的节点。如果将该缓存完整移入 core，会暴露 React 专属的数据，而无法建立有价值的跨框架契约。

保留前缀规划器仅复用经过身份证明的符合条件的节点。它在原生 HTML 与定义周围保留全量规划，并在规划跟在带有引用的保留块之后的尾部内容时，保留整篇文档的引用上下文。这并不意味着每次追加内容的开销都严格等于追加的字符数量：顶层遍历与引用上下文处理仍然可能会随文档规模发生变化。

<span id="build-and-validation"></span>

## 构建与验证

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @ai-markdown/core typecheck
pnpm --filter @ai-markdown/core test
pnpm test:core-contracts
pnpm preflight
```

在运行分发测试之前必须先完成构建：测试会在独立的 Node 进程中加载真实的 ESM/CJS 生产与开发环境文件，禁止传递解析 UI 框架，并在无浏览器全局变量的环境下执行解析。其他测试将检查会话输出与独立的引擎完整流水线的一致性，测试重置/回退分支，验证显式贡献时机，并检查聚合正文的不可变性。既有的 React 测试仍会验证适配器的委托、记忆化、逐字节等价性、协调机制及浏览器行为。

专用的 `test:core-contracts` 验证门禁会构建 core 及其工作区依赖项，检查其类型，并独立于 React/Vue 运行所有 core 测试。它在 preflight、专用 CI 任务以及发布工作流中均会执行。纯规划器、协调器、尾部信号与块规划测试与 core 存放在一起；React 保留渲染器/缓存集成测试。固定随机种子序列会将保留的流水线/规划与贡献状态与全量重建结果进行对比，并将协调器生命周期与独立的参考模型进行比对。有关模块映射表、固定预算、重放命令与局限性，请参阅[核心测试](https://ai-markdown.github.io/docs/guides/core-testing/)。

`assert-boundary.mjs` 检查公开相关包标识、允许的生产依赖、源码导入方向以及折叠的环境门禁。React 分发防护要求引入外部 core 与 engine。Core 的类型声明不得暴露 `RegistryInternal`、`SmoothCoordinatorInternal` 或私有的引用计数/订阅者容器。

发布版本包含相同版本的 engine/core/react/react-mantine/vue。Vue 现在使用相同的共享契约；有关稳定签名与自 beta.1 以来的迁移，请参阅 [API 契约](https://ai-markdown.github.io/docs/guides/api/core-engine-contracts/)。Core 通过 `workspace:*` 依赖 engine，在发布的包清单中该项会被替换为精确的统一发布版本号。ESM 与 CJS 均提供生产与开发入口；每次构建会单独折叠环境门禁。Core 不包含 `use client` 指令，也不内联第二份 engine 实现。

<span id="public-api-and-write-capabilities"></span>

## 公开 API 与写入能力

根入口显式列出受支持的稳定导出内容。会话创建、解析、规划、纯协调准备、贡献提交、聚合构建、结构克隆以及源码尾部分类属于适配器契约。既有的块摘要与指纹函数因被 React 使用而继续保持可用；上文关于其源码/归属的假设依然适用。

`createSmoothCoordinator` 返回只读状态以及 `SmoothCoordinator` 的已记录方法，排除了内部引用计数与通知容器。`ContributionOptions.registry` 仅接受带有 `contributeChunkData` 的 `ContributionRegistry` 写入能力；它不需要具体的实现注册表。通过 engine 的 `createRegistry` 创建注册表，其 `RegistryController` 在只读 `Registry` 契约之上增加了注册与发布能力。在所属适配器中，将每次注册与释放操作成对绑定。

这些属于类型层面的 API 边界，并非进行对象冻结或任意深拷贝。修改返回的集合、语法树数据或未记录的实现字段是不受支持的操作。公开契约与经过校验的签名记录在 [API 契约文档](https://ai-markdown.github.io/docs/guides/api/core-engine-contracts/) 中。

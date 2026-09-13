# 从 ai-react-markdown 迁移到 ai-markdown

**从旧版 v2.14.1 升级到 `@ai-markdown` 作用域下的 3.0.0 稳定版。** GitHub 代码仓库已迁移至 `ai-markdown/ai-markdown`。相关包名称、目录归属与共享核心的分发机制同步调整。React 组件、Hook、配置项名称以及样式表行为均保持原有形态。

第一个 Beta 版本确立了新的相关包边界。Beta.2 增加了 Vue 适配器，并收窄了进阶 engine/core API。本指南记录了在 3.0.0 稳定版中引入的变更。有关当前版本、对等依赖范围与安装命令，请参阅[快速开始](getting-started.md)。四个旧版 `@ai-react-markdown` 相关包的所有已发布版本均已附带各包专用的迁移通知。现有的版本与 Git 标签仍可访问，其 dist-tags 与 tarball 包保持不变。旧版本线不再接收新功能；紧急修复视情况进行评估。

<span id="package-and-import-mapping"></span>

## 相关包与导入映射

| 旧相关包或路径                                  | 新相关包或路径                             | 职责定位                                          |
| ----------------------------------------------- | ------------------------------------------ | ------------------------------------------------- |
| `@ai-react-markdown/engine`                     | `@ai-markdown/engine`                      | 语法解析、语法树转换、增量算法、注册表与 URL 原语 |
| 私有 `@ai-react-markdown/runtime`               | `@ai-markdown/core`                        | 会话管理、规划、已提交贡献、聚合 HAST 与呈现协调  |
| `@ai-react-markdown/core`                       | `@ai-markdown/react`                       | React 组件、Hook、Context、节点缓存与 DOM 集成    |
| `@ai-react-markdown/core/plugins`               | `@ai-markdown/react/plugins`               | 面向 React 的插件与预处理导出                     |
| `@ai-react-markdown/core/typography/<name>.css` | `@ai-markdown/react/typography/<name>.css` | 原有排版样式表                                    |
| `@ai-react-markdown/mantine`                    | `@ai-markdown/react-mantine`               | Mantine 排版与代码/图表展示                       |
| `@ai-react-markdown/mantine/styles.css`         | `@ai-markdown/react-mantine/styles.css`    | Mantine 集成样式表                                |
| `@ai-react-markdown/remark-mark-highlight`      | `@ai-markdown/remark-mark-highlight`       | 独立版本发布的 unified 插件                       |

**旧版 React core 更名为 `react`，而非新的共享 `core`。** 应用程序应当安装对应的框架相关包。Engine 与共享 core 属于常规依赖项，会自动随框架包引入。自定义适配器的开发者可以显式依赖二者。新旧依赖图谱之间不提供别名包装层；请同步更新应用程序的导入路径与集成依赖。

Vue 没有旧版 React 的导入映射。安装 `@ai-markdown/vue` 与 Vue `^3.5.0`，导入 `@ai-markdown/vue/styles.css`，并按照 [Vue 安装指南](getting-started.md#vue-35) 进行配置。不能仅仅通过将导入中的路径简单替换为 `/vue` 来迁移 React 组件与 Hook。

<span id="react-installation-and-api-continuity"></span>

## React 安装与 API 延续性

```bash
pnpm remove @ai-react-markdown/core
pnpm add @ai-markdown/react react@^19 react-dom@^19
```

```tsx
import AIMarkdown from '@ai-markdown/react';
import '@ai-markdown/react/typography/default.css';

export function Answer({ content, streaming }: { content: string; streaming: boolean }) {
  return <AIMarkdown content={content} streaming={streaming} />;
}
```

继续传入完整的累积 Markdown 字符串。`AIMarkdown`、窄粒度 Hook、`AIMarkdownDocuments`、组件插槽以及平铺配置名称均保持原有的 React API 规范。现有的自定义排版在新相关包路径下使用相同的变体文件名。从 React 根模块导入 `createRemendPreprocessor`，从 `@ai-markdown/react/plugins` 导入密封的插件对象。`/plugins` 入口导出插件清单及其类型，不导出预处理器。Vue 直接从 `@ai-markdown/vue` 导出其插件清单与预处理器辅助函数。

React 19 是当前支持的初始对等依赖范围。保留了 ESM/CJS、开发/生产条件导出、类型声明以及 React `use client` 指令。KaTeX 仍为可选对等依赖；在进行数学公式渲染时，请根据 [React 参考文档](../reference/react.md) 安装它并引入其样式表。自定义渲染器仍须执行文档中说明的最终元素 URL 策略。

<span id="mantine-integration"></span>

## Mantine 集成

```bash
pnpm remove @ai-react-markdown/mantine
pnpm add @ai-markdown/react @ai-markdown/react-mantine
```

保留现有的 React 19、Mantine 9 与 highlight.js 对等依赖。初始的 3.0.0 集成声明 React 适配器对等依赖为 `^3.0.0`；后续版本可能会提升最低版本要求。请参照当前参考文档将二者一同升级。在 Mantine 样式之后引入 `@ai-markdown/react-mantine/styles.css`，并保留 [Mantine 参考文档](../reference/react-mantine.md) 中展示的 Provider。`MantineAIMarkdown`、`codeBlock` 及调用方插槽优先级保持不变。

该集成保持专属于 React；它不能渲染 Vue 节点。Mermaid 加载逻辑与可选的数学公式样式表遵循现有的集成行为。

<span id="shared-core-ownership"></span>

## 共享 Core 职责归属

旧版的架构拆分在变更公开导入前就已提取出可复用的计算逻辑。新的 core 现已独立发布，拥有明确的导出列表，而不再捆绑打包进 React。Engine 和 core 是适配器的精确版本依赖项。它们不导入 React、Vue 或 DOM API；适配器可以直接使用 engine，无需将所有原语都通过 core 重新导出。

Core 负责管理流水线会话、幻影准备、块规划、贡献指纹、转换后正文提取、聚合脚注 HAST、平滑队列状态以及源码尾部分类。它返回语法树和协调事实。React 负责管理节点、缓存的 React 输出、Context 订阅、溯源凭据、生命周期调度、最终占位符转换以及 DOM 光标测量。

`createRegistry` 暴露了 engine 的 `RegistryController` 写契约，不包含私有的订阅者/引用计数容器。Core 的贡献发布器仅要求 `ContributionRegistry` 能力。`createSmoothCoordinator` 通过 `SmoothCoordinator` 暴露文档中声明的状态与方法。这些类型边界不会深度冻结返回值。[Core README](../../../../packages/core/README.md) 详细记录了职责归属、失效处理与只读快照规则。

<span id="cross-chunk-references-and-ssr"></span>

## 跨片段引用与服务端渲染（SSR）

在变更导入时，请保留现有的逻辑 `documentId`、稳定的片段标识以及文档顺序。`AIMarkdownDocuments` 仍用于界定协调范围。注册与贡献发布在已提交的生命周期工作中进行；解析与规划阶段切勿进行发布。被丢弃的并发渲染不会保留永久占用的文档作用域。

服务端渲染不会运行注册相关的生命周期逻辑，并保留局部脚注行为。宿主环境为服务端输出选用单次解析；随后的客户端帧必须建立自己的会话与注册。切勿将某个请求中可变的注册表或规划器序列化传递给另一个请求。稳定版 v3 保留了 React SSR 的既有表现；Vue 同样支持服务端渲染与初始水合，直到挂载完成后协调机制才激活。

<span id="public-api-and-release-policy"></span>

## 公开 API 与发布策略

Engine、core、react 与 react-mantine 在 `3.0.0-beta.1` 启用了统一版本发布；Vue 在 `3.0.0-beta.2` 加入。这五个相关包在 npm `latest` 上遵循稳定的 `3.0.0` 统一版本发布。高亮插件保持其独立的 1.x 版本线；现有的 rehype/raw fork 保留各自的代码仓库以及与上游对应的版本。后续的预发布版本不得变更 npm `latest` 指向，也不得作为 GitHub 稳定发布。Vue 的首次发布根据维护者决定保留了初始的 `latest → 3.0.0-beta.2` 映射；该历史映射已被正式的稳定发布所取代。[发布记录](release-highlights.md#300-beta2--vue-35-adapter-and-explicit-shared-apis)记录了该例外情况。

已记录的 engine/core 契约自 3.0.0 起遵循语义化版本规范。测试装置与实现容器被排除在公共根目录之外。框架应用应避免导入源码路径或未记录的辅助函数。发布验证包括签名审查、受支持的使用端检查以及完整的发布门禁。详情请参阅[共享 API 契约](api/core-engine-contracts.md)与[架构全景](architecture.md)。

代码仓库迁移与五个统一版本发布相关包的首次发布已全部完成。2026-09-11 检查的 npm 注册表元数据显示，[engine](https://registry.npmjs.org/@ai-markdown%2Fengine)、[core](https://registry.npmjs.org/@ai-markdown%2Fcore)、[React](https://registry.npmjs.org/@ai-markdown%2Freact)、[Vue](https://registry.npmjs.org/@ai-markdown%2Fvue) 以及 [Mantine](https://registry.npmjs.org/@ai-markdown%2Freact-mantine) 的 `latest` 均指向 `3.0.0`。发布额外相关包仍需要针对各包配置专用凭据与可信发布者；仅拥有代码仓库所有权并不会自动完成配置。

<span id="validation-and-second-framework-limits"></span>

## 验证与第二框架边界

共享 core 测试会在全新的 Node 进程中加载生产与开发环境的 ESM 及 CJS，禁止框架模块解析，并在无浏览器全局对象的环境中执行解析与规划。会话测试将增量输出与引擎完整流水线进行对比，并覆盖重置、回退以及显式贡献时机。React 测试覆盖节点身份比对、SSR、严格模式（Strict Mode）、跨片段协调与浏览器交互。发布的构建产物还必须在工作区之外正常解析，包括类型声明、插件入口与 CSS 路径。

[Vue 适配器](../reference/vue.md)现在同样采用相同的准备契约，并提供 VNode 转换、作用域引用、SSR 水合、组件/插槽扩展以及流式 UI。它要求 Vue `^3.5.0`；首个稳定版本为 3.0.0。原有的原型已被归档。稳定契约以及自 beta.1 以来的进阶 API 变更详见 [API 契约](api/core-engine-contracts.md)。

Vue 已纳入发布的稳定统一版本发布之中。功能集成检查覆盖 Chromium、Firefox 与 WebKit；强制垃圾回收生命周期检查仍专属于 Chromium。Nuxt 专用集成以及 KeepAlive/Suspense 组合在对外宣传支持之前，仍需要建立自身的测试覆盖。

<span id="documentation-site"></span>

## 文档站点

独立的文档站点尚未公开发布。请使用代码仓库中的指南与相关包 README 进行稳定版 v3 的集成，并使用 [Storybook](storybook.md) 查看交互式示例。

相关包 README 继续包含完整的安装步骤、最小示例、运行环境要求及关键限制。旧版 1.x 到 2.x 的指导内容作为历史资料保留；新用户应从当前框架的 README 与本迁移指南开始阅读。

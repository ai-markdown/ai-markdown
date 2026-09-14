# 安装与选择框架

先选择适合应用的适配器，再按对应的快速开始完成接入。每篇快速开始都包含安装命令、所需样式和完整的首次渲染示例。

## 从你的框架开始

| 应用                     | 对应指南                                         |
| ------------------------ | ------------------------------------------------ |
| React 19，使用自己的 UI  | [React 快速开始](react-quick-start.md)           |
| Vue 3.5，使用自己的 UI   | [Vue 快速开始](vue-quick-start.md)               |
| React 19，使用 Mantine 9 | [Mantine 快速开始](react-mantine-quick-start.md) |

通常只需安装一个框架适配器及其对等依赖，Core 和 Engine 会自动安装。如果 React 应用需要 Mantine 的排版、代码高亮和图表展示，再选择 Mantine 集成。

首次渲染成功后，继续阅读 [React 流式聊天](streaming-chat-example.md)或 [Vue 流式输出](vue-streaming.md)。下面的内容用于查询包的职责、兼容范围和已有项目的安装要求。

## 当前版本

AI Markdown 支持在 React 19 或 Vue 3.5 中渲染累积的 Markdown 内容。两个适配器共享底层解析引擎和协调逻辑；组件、定制方式和生命周期 API 遵循各自框架。

当前版本与兼容范围以各包的 manifest 和[发布记录](release-highlights.md)为准。安装稳定版本时可以不加 dist-tag，直接安装 latest。需要保证构建可复现时，请固定版本并保留锁文件；测试预发布版本时请使用明确的候选版本号。

## 选择包

| 包                                   | 直接安装的场景                                            | 公开入口                                |
| ------------------------------------ | --------------------------------------------------------- | --------------------------------------- |
| `@ai-markdown/react`                 | 构建 React 应用                                           | 根入口、`/plugins`、`/typography/*.css` |
| `@ai-markdown/vue`                   | 构建 Vue 3.5 应用                                         | 根入口、`/styles.css`                   |
| `@ai-markdown/react-mantine`         | 为 React 添加 Mantine 9 排版样式、代码高亮与 Mermaid 图表 | 根入口、`/styles.css`                   |
| `@ai-markdown/core`                  | 构建需要会话管理、执行规划与跨文档协调的框架适配器        | 根入口                                  |
| `@ai-markdown/engine`                | 构建适配器或纯字符串 / AST 语法处理流水线                 | 根入口                                  |
| `@ai-markdown/remark-mark-highlight` | 为独立的 unified 处理流水线添加 `==高亮==` 语法           | 根入口                                  |

每个包均提供公开的 `/package.json`。应用只能导入公开导出的入口路径；不支持直接从 `src/` 或内部 `dist/` 路径导入。`@ai-markdown/react/plugins` 是 React 包的子路径导出，并非需要单独安装的独立包。Vue 则直接从根入口导出封装好的插件。

React 和 Vue 分别依赖完全同版本的 core 与 engine。Core 本身依赖 engine。Mantine 声明了兼容的 React 适配器作为 peer 依赖；升级时请参阅其[对等依赖要求](../reference/react-mantine.md)并将两者一同升级。应用通常只需安装所选的框架适配器及其对等依赖。高亮插件作为 engine 的依赖项，与框架主包分开独立管理版本。

早期的旧包 `@ai-react-markdown/core` 是一个 React 渲染器；其替代者是 `@ai-markdown/react`。新的 `@ai-markdown/core` 中不包含任何 React 组件或 Vue 组件。在重命名现有导入语句前，请先参阅[包迁移指南](framework-transition.md)。

## 运行环境要求

服务端与构建环境要求 Node `^20.19.0 || >=22.12.0`。CJS 产物通过 Node 的 `require(ESM)` 支持来加载 ESM 依赖；在更早的 Node 20/22 版本中可能会因 `ERR_REQUIRE_ESM` 报错失败。仓库贡献者请遵循 [`.nvmrc`](../../../../.nvmrc) 与 [`package.json`](../../../../package.json) 中指定的运行时版本。

React 适配器要求 React 与 React DOM 19。Vue 要求 `^3.5.0`；Mantine 集成基于 Mantine 9。下方的框架快速开始指南列出了各自所需的对等依赖与样式文件导入。KaTeX 是可选的 peer 依赖：当需要渲染数学公式并导入其样式表时，请在业务项目中显式声明安装，避免依赖包管理器的偶然依赖提升。

浏览器端 API 要求与水合边界请参阅 [React 兼容性](../reference/react.md)与 [Vue 环境要求与依赖](../reference/vue.md)。共享同一套解析逻辑并不意味着框架层面或浏览器行为完全一致。

## React 19

请遵循 [React 快速开始](react-quick-start.md)指南，获取安装步骤、所需样式文件以及一份完整的最小化示例。

## Vue 3.5

请遵循 [Vue 快速开始](vue-quick-start.md)指南，获取安装步骤、所需样式文件以及一份完整的最小化示例。

## React 与 Mantine 9

请遵循 [Mantine 快速开始](react-mantine-quick-start.md)指南，获取安装步骤、所需样式文件以及一份完整的最小化示例。

## React 与 Vue 的 API 差异

| 任务                  | React / React Mantine                                             | Vue                                                                       |
| --------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 传入当前源文本        | `content={content}`                                               | `:content="content"`                                                      |
| 声明生产端状态        | `streaming={streaming}`                                           | `:streaming="streaming"`                                                  |
| 选择引擎功能插件      | 从 `@ai-markdown/react/plugins` 导出的清单中选择                  | 从 `@ai-markdown/vue` 导出的清单中选择                                    |
| 替换 HTML 元素渲染    | `customComponents` 映射（React 组件）                             | `components` 映射或具名元素插槽；插槽优先                                 |
| 读取元数据与流式状态  | `useAIMarkdownMetadata`、`useAIMarkdownState`                     | 映射到组件属性或插槽上下文                                                |
| 定制外层容器样式      | `Typography`、`ExtraStyles`、`fontSize`、`variant`、`colorScheme` | 基础 CSS 与外层 `class` / `style`                                         |
| 显示流式光标          | 通过 `streamingCursor={AIMarkdownStreamingCursor}` 显式启用       | 默认启用；可通过 `:streaming-cursor="false"` 关闭；支持 `cursor` 插槽定制 |
| 平滑流式展示          | `AIMarkdownSmoothStream`、接收当前配置对象的 Hooks                | `AIMarkdownSmoothStream`、接收实时 getter 的 setup 组合式函数             |
| 自定义平滑等待状态 UI | `waiting` 属性                                                    | `waiting` 插槽                                                            |
| 共享引用上下文        | 使用 React 的 `AIMarkdownDocuments` 并传入显式 `documentId`       | 使用 Vue 的 `AIMarkdownDocuments` 并传入显式 `document-id`                |
| 保留孤立引用定义      | 渲染器属性与文档提供者策略（默认开启）                            | 每个渲染器上的 `preserveOrphanReferences`（默认 `false`）                 |
| 切换块级渲染缓存      | `blockMemo` 属性                                                  | 无 `blockMemo` 属性                                                       |

两个适配器在客户端均默认启用增量解析。两者均接受 `enginePlugins`、`contentPreprocessors`、`sanitizeSchema` 与 `urlTransform`，但仅共享文档中明确规范的通用契约，并不保证所有属性及默认值完全一致。在配置发生实际变更前，请保持插件数组和策略对象的引用稳定。传入自定义插件数组会整体替换已启用的插件集合，而不是在默认 remark 插件列表后追加任意插件。

## 流式输入与文档边界

每次更新时，请向组件传入单个完整的当前累积字符串。由应用负责传输协议解码、数据分帧、取消以及重试；`streaming` 仅用于向渲染器通报生产端的运行状态，并不用于控制是否开启增量解析。

关于生成完成检测与平滑文本呈现，请参阅[流式输入](streaming-input.md)；当单个逻辑文档需要有意跨多个渲染器共享引用时，请参阅[文档与引用](documents-and-references.md)。接下来可继续参考 [React 聊天示例](streaming-chat-example.md)或 [Vue 流式指南](vue-streaming.md)。

## 运行本仓库中的示例

```bash
pnpm install --frozen-lockfile
pnpm storybook
```

Storybook 导航页运行在 6006 端口，React 示例运行在 6007 端口，Vue 示例运行在 6008 端口。本地开发时可直接解析工作区源码与样式，无需预先执行包构建。运行 `pnpm storybook:react` 或 `pnpm storybook:vue` 可单独启动对应的框架目录。静态构建则会使用公开包导出并优先构建依赖包。

公开包位于 `packages/*` 目录下。`apps/storybook-*` 应用、`tooling/storybook-kit`、基准语料集、benchmarks 以及归档原型均属于私有工作区。相关构建与校验命令请参阅[交互式示例](storybook.md)与[开发命令](development-commands.md)。

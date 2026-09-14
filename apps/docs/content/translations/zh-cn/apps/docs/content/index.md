# 介绍

AI Markdown 用于在 React 和 Vue 中渲染 Markdown，也支持逐步返回的 AI 回答。它提供 GFM、数学公式与中日韩混排能力，并支持流式输出、自定义组件和共享引用。

先把一条消息渲染出来，再按需要添加平滑输出、样式定制或文档协调。

<span id="choose-your-framework"></span>

## 选择你的框架

| 你的应用             | 从这里开始                                              | 包含的配置                    |
| -------------------- | ------------------------------------------------------- | ----------------------------- |
| React 19             | [React 快速开始](guides/react-quick-start.md)           | 安装、样式与可运行的组件      |
| Vue 3.5              | [Vue 快速开始](guides/vue-quick-start.md)               | 安装、样式与可运行的 Vue 组件 |
| React 配合 Mantine 9 | [Mantine 快速开始](guides/react-mantine-quick-start.md) | 主题 Provider、代码高亮与图表 |

不确定该安装哪个包？先看[安装与选择框架](guides/getting-started.md)。想直接体验？[打开交互示例](examples:)。

<span id="build-a-streaming-experience"></span>

## 构建流式体验

对于一条聊天回答，把收到的文本追加到同一个字符串中，再把当前完整字符串交给一个渲染器。应用负责网络连接，AI Markdown 负责内容呈现。

1. **接收文本：**了解[输入、完成状态与取消](guides/streaming-input.md)。
2. **呈现回答：**参考 [React 聊天示例](guides/streaming-chat-example.md)或 [Vue 流式指南](guides/vue-streaming.md)。
3. **调整节奏：**添加 [React 平滑输出](guides/smooth-streaming.md)或 [Vue 平滑组件](guides/vue-streaming.md)。

只有将同一逻辑文档拆成多个展示区块时，才需要[文档协调](guides/documents-and-references.md)。普通聊天消息不需要这一步，也不要把网络数据包当作独立的 Markdown 组件。

<span id="customize-rendering"></span>
<span id="定制你的渲染器"></span>

## 接入应用的样式与交互

| 你想做什么          | 接着看                                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 替换渲染元素        | [React 自定义组件](guides/custom-components.md)或 [Vue 组件与样式](guides/vue-customization.md)                                               |
| 调整排版            | [React 排版](guides/custom-typography.md)、[Vue 样式](guides/vue-customization.md)或 [Mantine 配置](reference/react-mantine.md#configuration) |
| 处理中日韩混排      | [中日韩排版](guides/cjk-typography.md)                                                                                                        |
| 控制链接与原始 HTML | [URL 与 HTML 策略](guides/url-sanitization.md)                                                                                                |
| 使用服务端渲染      | [React SSR](guides/react-ssr.md)或 [Vue SSR](guides/vue-ssr.md)                                                                               |

基础适配器把代码围栏渲染为代码文本。代码语法高亮与 Mermaid 图表需要 Mantine 集成或自定义组件。

<span id="build-an-adapter"></span>
<span id="go-deeper"></span>
<span id="深入底层"></span>

## 找到需要的说明

先看[配置总览](guides/configuration.md)选择需要调整的部分，再按场景查阅[任务指南](guides/index.md)，或在 [React](reference/react.md)、[Vue](reference/vue.md)、[Mantine](reference/react-mantine.md) 参考中查询具体 API。遇到问题时，先看[常见问题排查](guides/troubleshooting.md)。

适配器开发者可以继续阅读 [Core 与 Engine 契约](guides/api/core-engine-contracts.md)。开发命令、内部架构和发布档案集中在“参与贡献”中，使用组件前无需先读这些内容。

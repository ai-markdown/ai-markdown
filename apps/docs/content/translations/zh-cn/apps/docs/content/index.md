# AI Markdown

在 React 和 Vue 中渲染 Markdown，支持持续返回的内容。先从对应框架的基础配置开始，再根据具体任务查阅对应指南。两个适配器共享底层解析和文档协调逻辑；组件结构、样式方案和生命周期 API 则各自遵循宿主框架。

## 选择你的框架

| 你的应用             | 从这里开始                                              | 提供的能力                                  |
| -------------------- | ------------------------------------------------------- | ------------------------------------------- |
| React 19             | [React 快速开始](guides/react-quick-start.md)           | 组件、Hooks 与可自定义的元素渲染器          |
| Vue 3.5              | [Vue 快速开始](guides/vue-quick-start.md)               | 组件、作用域插槽与 setup 组合式函数         |
| React 配合 Mantine 9 | [Mantine 快速开始](guides/react-mantine-quick-start.md) | 支持主题排版、语法高亮代码块与 Mermaid 图表 |

[对比包和环境要求](guides/getting-started.md)。当 React 应用使用 Mantine 设计系统时，选择 Mantine 集成包。适配器开发者可以直接使用 core 和 engine；业务应用通常只需安装所选的框架适配器及其对等依赖。

## 构建流式体验

对于常见的对话消息，将收到的文本累积到单个字符串中并传给一个渲染器。仅在单个逻辑文档确实需要由多个渲染器分块展示时，才使用文档协调功能。它负责跨片段解析共享引用与脚注，不会拼接被切断在组件边界两侧的语法结构。

1. 阅读[流式输入](guides/streaming-input.md)，了解数据源、完成状态与取消语义。
2. 参考 [React 聊天示例](guides/streaming-chat-example.md)或 [Vue 流式指南](guides/vue-streaming.md)。
3. 当页面排版需要独立的展示块时，引入[文档与引用](guides/documents-and-references.md)。

[打开交互示例](examples:)浏览目录，或选择 [Playground](examples.md#playgrounds-try-your-own-markdown) 测试自定义 Markdown。二者均在站内直接使用 Storybook 运行。

<span id="customize-rendering"></span>

## 定制你的渲染器

先从 [React 自定义组件](guides/custom-components.md)、[Vue 组件与插槽](guides/vue-customization.md)或 [Mantine 配置](reference/react-mantine.md#configuration)开始。查阅[指南目录](guides/index.md)获取预处理、URL 策略、排版与元数据的详细介绍。

<span id="build-an-adapter"></span>

## 深入底层

[渲染与性能](guides/rendering-and-performance.md)区分了共享解析与框架渲染的不同开销。[核心与引擎契约](guides/api/core-engine-contracts.md)介绍了适配器的职责划分与生命周期。贡献者命令和维护历史记录在侧边栏中单独分组，方便随时查阅而不影响普通开发配置。

# 配置渲染

先按 [React](react-quick-start.md)、[Vue](vue-quick-start.md) 或 [Mantine](react-mantine-quick-start.md) 快速开始完成首次渲染，再选择需要调整的部分。React 和 Vue 共享解析选项，组件与样式 API 则有所不同。

## 按需求选择配置

| 你想做什么             | 使用什么配置                                                | 对应指南                                                                                                             |
| ---------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 展示持续返回的文本     | 更新累积的 `content`，用生成端状态驱动 `streaming`          | [流式输入](streaming-input.md)                                                                                       |
| 平滑展示突发到达的文本 | 使用对应框架的平滑组件、Hook 或组合式函数                   | [React](smooth-streaming.md) · [Vue](vue-streaming.md)                                                               |
| 选择可选的语法转换     | `enginePlugins`                                             | [Markdown 功能](markdown-features.md)                                                                                |
| 解析前整理源文本       | `contentPreprocessors`                                      | [内容预处理](content-preprocessors.md)                                                                               |
| 替换链接、代码块等元素 | React 的 `customComponents`；Vue 的 `components` 或具名插槽 | [React](custom-components.md) · [Vue](vue-customization.md)                                                          |
| 调整字体、间距和颜色   | React 排版与 CSS 变量；Vue 容器样式；Mantine 主题           | [React](custom-typography.md) · [Vue](vue-customization.md) · [Mantine](../reference/react-mantine.md#configuration) |
| 控制允许的 HTML 与 URL | `sanitizeSchema` 和 `urlTransform`                          | [链接与 HTML 安全](url-sanitization.md)                                                                              |
| 在文档各区块间共享引用 | `AIMarkdownDocuments` 与明确的文档 id                       | [文档与引用](documents-and-references.md)                                                                            |

## 了解默认启用的能力

GFM、数学处理、Emoji、源文本换行、中日韩分隔符解析和受控的原始 HTML 处理属于基础解析流程。五个内置的可选插件默认全部启用。传入 `enginePlugins` 会替换这组可选插件；空数组不会关闭基础流程或安全过滤。

`highlight` 插件表示 `==标记文本==`，不负责代码语法高亮。代码高亮和 Mermaid 需要 [Mantine](mantine-code-blocks.md) 或自定义渲染器。完整区别见 [Markdown 功能](markdown-features.md)。

## 保持配置引用稳定

不依赖状态的插件数组、预处理器和策略对象可以定义在渲染函数之外。如果配置取决于应用设置，在设置发生变化前保持引用稳定。Vue 组合式函数应接收实时 getter，以便读取后续更新。

插件目录只接受内置对象，不能通过 `enginePlugins` 传入任意 remark/rehype 插件。应用扩展请使用文档中说明的内容预处理和自定义渲染入口。

## 覆盖默认值前，先确认作用范围

`streaming` 描述生成端状态，不是增量解析开关。React 的光标需要主动启用，Vue 则默认开启。React 排版属性与 Hooks 不适用于 Vue。

URL 转换在安全过滤之后执行。自定义组件自行创建的 URL 或 HTML 也需要遵守应用的输出策略。修改这两个阶段前，请阅读[链接与 HTML 安全](url-sanitization.md)。

## 查询具体选项

类型、默认值与优先级见 [React 属性](api/react-props.md)、[Vue 组件属性](../reference/vue.md#component-props)或 [Mantine 配置](../reference/react-mantine.md#configuration)。如果结果不符合预期，先从[常见问题排查](troubleshooting.md)定位。

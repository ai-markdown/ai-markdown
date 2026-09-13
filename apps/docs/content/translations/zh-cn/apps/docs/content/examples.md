# 交互式示例

[打开站内嵌入式示例工作区](examples:)。

在 Storybook 目录中直接查看实时渲染效果。React 和 Vue 共享相同的能力章节划分，Mantine 则对 React 目录进行了扩展。

| 目录                                                                         | 体验内容                                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------------ |
| [React](storybook:react/)                                                    | Markdown 渲染、自定义、流式输出与文档协调              |
| [Vue](storybook:vue/)                                                        | Vue 属性、作用域插槽、组合式函数与流式生命周期         |
| [Mantine](storybook:react/?path=/docs/integrations-mantine-playground--docs) | 包含主题排版、代码语法高亮与 Mermaid 图表的 React 集成 |

若未配置在线部署的 Storybook 目录，上述链接将跳转至[本地 Storybook 说明](guides/storybook.md)。在仓库根目录运行 `pnpm storybook` 可以在 6006 端口启动聚合导航页，React 运行在 6007 端口，Vue 运行在 6008 端口。

安装指南与完整 API 参考请查阅 [React 参考](reference/react.md)、[Vue 参考](reference/vue.md)与 [Mantine 参考](reference/react-mantine.md)。

## Playgrounds：体验自定义 Markdown <a id="playgrounds-try-your-own-markdown"></a>

使用 Playground 粘贴自定义 Markdown，在 Controls 面板中调整渲染选项并即时查看渲染结果。以下是 Storybook 目录中的几个常用入口：

- [React Playground](storybook:react/?path=/story/playground--default)
- [Vue Playground](storybook:vue/?path=/story/playground--interactive)
- [React 流式回放](storybook:react/?path=/story/playground--streaming)

**Examples** 是完整示例目录，**Playground** 是其中可编辑内容的入口。示例工作区当前保留英文 Storybook 控件和样例名称；本站的页面、导航与文档提供中文。二者目前均基于 Storybook 提供。

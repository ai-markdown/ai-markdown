# 按任务查找

按下面的任务找到对应指南。首次接入时，先看[安装与选择框架](getting-started.md)。框架专用指南标注了 React、Vue 或 Mantine，共享解析指南适用于三者。

<span id="choose-your-adapter"></span>

## 选择适配器

| 应用程序         | 首次渲染                                         | 下一步任务                                                                | 参考文档                                                                                     |
| ---------------- | ------------------------------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| React            | [React 快速开始](react-quick-start.md)           | [流式对话](streaming-chat-example.md)、[自定义组件](custom-components.md) | [React 组件](../reference/react.md)                                                          |
| Vue              | [Vue 快速开始](vue-quick-start.md)               | [流式渲染](vue-streaming.md)、[自定义渲染](vue-customization.md)          | [Vue API](../reference/vue.md)                                                               |
| React 与 Mantine | [Mantine 快速开始](react-mantine-quick-start.md) | [代码块与图表](mantine-code-blocks.md)                                    | [Mantine API](../reference/react-mantine.md)                                                 |
| 框架适配器开发者 | [开发框架适配器](building-an-adapter.md)         | [Core 与 Engine 契约](api/core-engine-contracts.md)                       | [Core](../../../../packages/core/README.md)、[Engine](../../../../packages/engine/README.md) |

完成首次渲染后，[配置渲染](configuration.md)说明该调整哪一层：React 与 Vue 共享的解析选项，还是各适配器不同的组件与样式 API。

<span id="by-scenario-start-here"></span>

<span id="按任务查找指南"></span>

## 流式渲染

| 任务                                | 指南                                                | 适用范围 |
| ----------------------------------- | --------------------------------------------------- | -------- |
| 理解累积输入、完成与取消机制        | [流式输入](streaming-input.md)                      | 全部     |
| 构建随 token 到达即时渲染的对话视图 | [React 流式聊天](streaming-chat-example.md)         | React    |
| 平滑处理突发到达的 token            | [React 平滑流式输出](smooth-streaming.md)           | React    |
| 在流式边缘显示光标                  | [React 流式光标](streaming-cursor.md)               | React    |
| 在 Vue 组件中流式渲染               | [Vue 流式渲染](vue-streaming.md)                    | Vue      |
| 将逻辑文档拆分为共享引用的多个片段  | [文档与引用](documents-and-references.md)           | 全部     |
| 在 React 片段之间协调脚注与链接     | [React 文档与引用协调](cross-chunk-coordination.md) | React    |
| 在 Vue 片段之间协调脚注与链接       | [Vue 文档与引用](vue-documents.md)                  | Vue      |

## 内容与样式

| 任务                              | 指南                                             | 适用范围 |
| --------------------------------- | ------------------------------------------------ | -------- |
| 选择需要调整的配置层              | [配置渲染](configuration.md)                     | 全部     |
| 确认支持渲染的 Markdown 语法      | [Markdown 语法支持](markdown-features.md)        | 全部     |
| 渲染中日韩与混合语言文本          | [CJK 排版](cjk-typography.md)                    | 全部     |
| 在解析前转换源文本                | [内容预处理器](content-preprocessors.md)         | 全部     |
| 配置 URL 与 HTML 安全策略         | [URL 过滤与安全策略](url-sanitization.md)        | 全部     |
| 用自己的组件替换渲染出的元素      | [React 自定义组件](custom-components.md)         | React    |
| 替换排版容器                      | [React 自定义排版容器](custom-typography.md)     | React    |
| 通过 CSS 变量调整间距、颜色与字体 | [React CSS 设计变量](design-tokens.md)           | React    |
| 在 Vue 中自定义渲染与样式         | [Vue 自定义渲染与样式定制](vue-customization.md) | Vue      |
| 在浏览器中试用自己的 Markdown     | [交互示例与 Playground](../examples.md)          | 全部     |

## 集成与性能

| 任务                         | 指南                                                     | 适用范围 |
| ---------------------------- | -------------------------------------------------------- | -------- |
| 用 Mantine 渲染代码块与图表  | [Mantine 代码块与图表](mantine-code-blocks.md)           | Mantine  |
| 服务端渲染与水合             | [React SSR 与水合](react-ssr.md)                         | React    |
| 服务端渲染与组件生命周期管理 | [Vue SSR 与生命周期](vue-ssr.md)                         | Vue      |
| 理解增量解析节省的开销       | [渲染与性能](rendering-and-performance.md)               | 全部     |
| 在流式输出时保持低成本重渲染 | [React 流式传输与性能优化](streaming-and-performance.md) | React    |

## API 参考

| 需求                         | 页面                                            |
| ---------------------------- | ----------------------------------------------- |
| 全部 React 属性及其默认值    | [React 属性参考](api/react-props.md)            |
| Hook 与 Provider             | [React Hooks 与 Provider](api/react-hooks.md)   |
| 传递给自定义组件的元数据     | [React 元数据上下文](metadata-context.md)       |
| 泛型组件与属性类型           | [React TypeScript 泛型](typescript-generics.md) |
| Vue 属性、插槽与导出         | [Vue API](../reference/vue.md)                  |
| Mantine 属性与配置           | [Mantine API](../reference/react-mantine.md)    |
| 次版本更新下哪些内容保持稳定 | [API 规范与稳定性](api-conventions.md)          |

## 故障排查与升级

| 任务                           | 指南                                              |
| ------------------------------ | ------------------------------------------------- |
| 排查跨适配器的故障现象         | [故障排查](troubleshooting.md)                    |
| 从旧包名升级                   | [包名迁移](framework-transition.md)               |
| 将 1.x 安装升级到 2.0          | [从 1.x 迁移到 2.0](migrating-to-v2.md)           |
| 查看各版本的更新记录           | [版本更新亮点](release-highlights.md)             |
| 决定在测试中锁定或断言哪些内容 | [稳定性策略](api-conventions.md#stability-policy) |

1.x 到 2.x 迁移页面与 [2026 年 7 月基准测试](benchmark.md)描述的是其对应版本的情况，不代表当下的安装要求。

## 开发集成

| 任务                      | 指南                                                                                                                                                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 开发框架适配器            | [开发框架适配器](building-an-adapter.md)                                                                                                                                                                                                |
| 依赖共享包                | [Core 与 Engine 契约](api/core-engine-contracts.md)                                                                                                                                                                                     |
| 发布 React 设计系统集成包 | [构建 React 集成包](extending-via-subpackage.md)                                                                                                                                                                                        |
| 阅读各包 API              | [Core](../../../../packages/core/README.md)、[Engine](../../../../packages/engine/README.md)、[高亮插件](../../../../packages/remark-mark-highlight/README.md)、[代码语言探测器](../../../../packages/code-language-detector/README.md) |

<span id="full-topic-index"></span>

<span id="完整主题索引"></span>

## 参与贡献

| 任务                     | 指南                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| 运行检查、测试与构建     | [开发命令](development-commands.md)                                                        |
| 了解各包分别负责哪些文件 | [架构设计全景](architecture.md)                                                            |
| 编辑或部署本站点         | [文档站点](documentation-site.md)                                                          |
| 开发 Storybook 示例      | [交互式示例](storybook.md)                                                                 |
| 测量一项改动             | [基准测试方法](benchmarking.md)                                                            |
| 验证核心契约与状态序列   | [核心测试](core-testing.md)                                                                |
| 判断改动是否需要压测     | [压测覆盖映射](soak-coverage.md)                                                           |
| 发布版本                 | [版本发布指南](releasing.md)                                                               |
| 保持指南与实现同步       | [结合源码实现阅读指南](api-conventions.md#reading-the-implementation-alongside-the-guides) |

<span id="release-maintenance"></span>

<span id="发布维护"></span>

发布维护：[已发布产物验证](releasing.md#repeatable-published-artifact-verification)。[3.0 版本发布验收记录](releasing-3.0.md)是该版本的归档记录。

## 已迁移的章节

以下章节原本位于本页，内容未作改动。

<span id="a-note-on-stability"></span>

<span id="关于稳定性策略"></span>

**关于稳定性策略**现位于[稳定性策略](api-conventions.md#stability-policy)与[共享包](api-conventions.md#shared-packages)两节。

<span id="conventions-used-in-this-guide"></span>

<span id="本指南遵循的规范"></span>

**本指南遵循的规范**现位于[指南中的约定](api-conventions.md#conventions-used-in-the-guides)。

<span id="reporting-issues-with-these-docs"></span>

<span id="文档问题反馈"></span>

**文档问题反馈**现位于[文档问题反馈](api-conventions.md#reporting-issues-with-these-docs)。

<span id="reading-the-implementation-alongside-the-guides"></span>

<span id="结合源码实现阅读指南"></span>

**结合源码实现阅读指南**现位于[结合源码实现阅读指南](api-conventions.md#reading-the-implementation-alongside-the-guides)。

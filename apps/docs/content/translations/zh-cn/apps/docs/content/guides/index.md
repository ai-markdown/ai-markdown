# 指南目录

首先阅读[文档总览](../index.md)以选择合适的适配器，或阅读[快速开始](getting-started.md)了解安装与样式表要求。以下页面按任务场景进行组织；React Hook 与排版 API 不适用于 Vue。

<span id="choose-your-adapter"></span>

## 选择适配器

| 应用程序         | 入门指南                                         | 下一步任务                                                                |
| ---------------- | ------------------------------------------------ | ------------------------------------------------------------------------- |
| React            | [React 安装配置](react-quick-start.md)           | [流式对话](streaming-chat-example.md)、[自定义组件](custom-components.md) |
| Vue              | [Vue 安装配置](vue-quick-start.md)               | [流式渲染](vue-streaming.md)、[自定义渲染](vue-customization.md)          |
| React 与 Mantine | [Mantine 安装配置](react-mantine-quick-start.md) | [代码块与图表](mantine-code-blocks.md)                                    |
| 框架适配器开发者 | [构建框架适配器](building-an-adapter.md)         | [Core 与 Engine 契约](api/core-engine-contracts.md)                       |

<span id="by-scenario-start-here"></span>

## 按任务查找指南

| 任务场景                       | 对应指南                                   |
| ------------------------------ | ------------------------------------------ |
| 理解累积输入、完成与取消机制   | [流式输入机制](streaming-input.md)         |
| 将逻辑文档拆分为多个章节片段   | [文档与引用](documents-and-references.md)  |
| 理解增量解析所节省的具体开销   | [渲染与性能](rendering-and-performance.md) |
| 尝试运行你自己的 Markdown 内容 | [交互示例与 Playground](../examples.md)    |
| 在解析前对源文本进行转换       | [内容预处理器](content-preprocessors.md)   |
| 配置 URL 与 HTML 安全策略      | [URL 过滤与安全策略](url-sanitization.md)  |
| 渲染中日韩（CJK）文本混排      | [中日韩排版](cjk-typography.md)            |
| 从旧包名升级                   | [包名迁移](framework-transition.md)        |
| 查看各版本的更新记录与特性     | [版本更新亮点](release-highlights.md)      |

<span id="full-topic-index"></span>

## 完整主题索引

侧边栏列出了框架教程与 API 参考文档。若参与代码库开发维护，请查阅[开发命令](development-commands.md)、[核心测试](core-testing.md)、[压测覆盖](soak-coverage.md)、[Storybook 开发](storybook.md)、[文档站点与部署](documentation-site.md)以及[版本发布指南](releasing.md)。

历史的 [1.x 到 2.x 迁移指南](migrating-to-v2.md)与[基准测试测量数据](benchmark.md)描述的是其对应版本的历史情况，不能代表当下的安装要求。

<span id="a-note-on-stability"></span>

## 关于稳定性策略

公开 API 自 3.0.0 起遵循语义化版本规范。请将统一版本发布的相关包一同升级。下表描述了稳定的 React API 策略；早期预发布版本可能存在不同的契约。Vue 拥有独立的公开属性与类型，具体记录在其[参考文档](../reference/vue.md)中。

| 层面                                                                                                      | 次版本（Minor）更新下的稳定性保证                                     |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 组件属性（`AIMarkdownProps`、`MantineAIMarkdownProps`）                                                   | 稳定。新增属性属于非破坏性变更；属性更名或移除需要主版本（Major）递增 |
| Hook 签名（五个窄粒度 Hook、`useAIMarkdown`、`useDocumentRegistry`、`useStableValue`、`useStableRecord`） | 稳定                                                                  |
| 平铺属性**名称**与**职责**（包括密封插件名称）                                                            | 稳定                                                                  |
| 平铺属性**默认值**                                                                                        | 可能会随默认行为优化在次版本中微调——若需锁定行为请显式覆盖            |
| CSS 自定义属性**名称**（设计变量，例如 `--aim-spacing-md`）                                               | 稳定                                                                  |
| CSS 自定义属性**默认值**                                                                                  | 可能会随视觉设计演进而调整                                            |
| `UrlTransform`、`SanitizeSchema` 类型                                                                     | 跟踪上游 `react-markdown` / `rehype-sanitize`；随上游主版本升级而变更 |
| `Registry` 接口                                                                                           | 稳定的只读接口；修改器方法故意不导出                                  |
| 内部逐字节对应的 HTML 输出                                                                                | 不保证稳定——应用测试建议使用语义化查询和断言                          |
| `@ai-markdown/engine` 导出的全部内容                                                                      | 3.0.0 起记录的稳定公开契约——详见下文                                  |

**关于共享包。** `@ai-markdown/core` 负责与框架无关的会话、规划、贡献及平滑协调；`@ai-markdown/engine` 负责语法解析、语法树算法及注册表原语。两者均为具有明确导出的公开包。安装 `@ai-markdown/react` 或 `@ai-markdown/vue` 时，会将二者解析为精确版本依赖项。适配器开发者可以直接使用它们，保持五个统一版本发布相关包（engine、core、react、vue 和 react-mantine）处于严格相同的版本。对其已记录公开契约的破坏性变更需要升级主版本；React 包提供了在应用指南中使用的组件和 Hook API。

若有疑问，建议显式传入配置覆盖项，而不要依赖默认值。

---

<span id="conventions-used-in-this-guide"></span>

## 本指南遵循的规范

- **代码块**按用途进行标注。完整方案包含所需的导入语句；较小的片段假定已存在周围的应用上下文变量；封装模板使用明确命名的占位符模块。在使用前请安装相关包的对等依赖并导入必需的 CSS。
- **避坑指南**章节收集了常见反模式与稳定性陷阱。有关跨适配器的故障现象与修复方案，请参阅[故障排查](troubleshooting.md)。
- `// ✅` 与 `// ⚠️` 标注分别标识推荐模式与反模式代码行。
- 当某项行为由 `@ai-markdown/react` 与 `@ai-markdown/react-mantine` 共享时，示例使用 `AIMarkdown`（React 适配器）；该用法同样适用于 `MantineAIMarkdown`。

---

<span id="reporting-issues-with-these-docs"></span>

## 文档问题反馈

如果你发现文档记录的 API 行为与实际不符，或者自定义配置在版本边界处发生破坏，请提交 Issue 并提供以下信息：

- 文档名称与所在章节，
- 精确的相关包版本（`@ai-markdown/react@x.y.z` 等），
- 最小化复现用例，
- 观察到的实际行为与预期行为。

Issue 追踪平台：<https://github.com/ai-markdown/ai-markdown/issues>

<span id="reading-the-implementation-alongside-the-guides"></span>

## 结合源码实现阅读指南

在修改某项特性的文档之前，请沿其归属模块追踪该数据。公开属性在 React 适配器中解析；语法与增量算法归属于 engine；流水线会话、规划与贡献编排归属于共享 core；React Provider、生命周期 Effect 与缓存元素构建归属于 React 适配器；Mantine 负责自身的代码展示与分组默认值。在 engine 中导出的符号并不自动等同于受支持的 React API。

| 疑问点                               | 应查阅的源码实现                        | 应保持同步的指南           |
| ------------------------------------ | --------------------------------------- | -------------------------- |
| 省略某个属性会产生什么行为？         | React 属性解析器与包装层的参数默认值    | 属性参考文档、迁移指南     |
| 何时可以复用原有的解析结果或块结构？ | 增量步进算法、块规划器、MarkdownContent | 架构设计、流式输出与性能   |
| 哪个片段拥有某项引用？               | 文档注册表与使用端占位符                | 跨片段协调、URL 安全清洗   |
| 展示或复制的文本具体是什么？         | 引擎预处理器链与 Mantine 代码渲染器     | 内容预处理器、Mantine 参考 |
| 流式结果何时宣告完成？               | 传输状态、平滑控制器、文档队列          | 对话示例、平滑流式输出     |
| 哪些测试证据能证明优化确实被执行了？ | 覆盖映射表、Oracle 测试、压测清单       | 压测覆盖、实验记录         |

在贡献文档时，请保留有价值的示例与历史测量数据，但须注明其对应版本与适用范围。请对照当前代码检出分支核对 API 名称、默认值、相对链接与 CLI 命令。构建成功仅证明相关包产物能够通过编译，本身并不足以验证所有正文论断或性能估算。

<span id="release-maintenance"></span>

## 发布维护

- [已发布产物验证](releasing.md#repeatable-published-artifact-verification)

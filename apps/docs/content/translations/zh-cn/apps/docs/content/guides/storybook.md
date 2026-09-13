# 交互式示例（Storybook）

AI Markdown 为每个渲染框架提供了一个独立的 Storybook 目录，并通过一个组合入口将它们整合展示。React 与 Mantine 共享 React 渲染器。Vue 独立运行，拥有自己的预览环境和浏览器测试。Engine 与 core 的契约保持在各自包的文档和独立测试套件中。

<span id="run-locally"></span>

## 本地运行

安装依赖并启动目录：

```bash
pnpm install
pnpm storybook
```

组合入口打开于 `http://localhost:6006`，React 位于 `http://localhost:6007`，Vue 位于 `http://localhost:6008`。组合命令会在等待 React 和 Vue 的索引及预览端点就绪后，再启动组合入口。这使 Storybook 能够将本地目录识别为公开引用，并跨端口免密获取其索引。`[storybook]` 启动和 HTTP 就绪消息明确展示了此顺序；并发的 Storybook 横幅和后续编译消息并不代表执行顺序契约。该命令会同时启动所有三个服务；可通过 Ctrl+C 停止。关闭过程会等待所属进程组退出，并在三秒宽限期后强制终止所有遗留的子进程。端口是固定的：若请求的端口被占用，启动将直接失败，而不会静默切换到 6009 或其他端口。请在重试前停止占用端口的会话；启动器不会仅仅因为某进程占用了端口就终止无关进程。若只需针对单一渲染器开发，可使用 `pnpm storybook:react` 或 `pnpm storybook:vue`。

开发命令会将各目录使用的 engine、core、highlight、React、Mantine 和 Vue 入口直接解析到工作区源码，包括引入的渲染器样式。无需预先构建相关包或启动单独的构建监视器。保存这些源码会触发 Vite 更新或预览重载；重载可能会重置当前示例的状态。静态构建保留了公开相关包的导出解析并优先构建相关包，因此已发布的入口点和生成的样式仍能得到测试验证。

React 目录包含 Playground、Basics、Customization、Streaming、Documents、Integrations/Mantine、Performance Lab 和 QA。Vue 在受支持的范围内采用相同的功能分类。Vue 不提供 Mantine 部件或 React 渲染次数统计工具。组合分组属于导航边界：控件、主题状态和重播计时器在不同框架之间不会同步。

<span id="chapter-structure-and-renderer-comparison"></span>

## 章节结构与渲染器对比

React 是信息架构的参考基准。其目录划分了使用章节（Basics、Customization、Streaming 和 Documents）、可选集成、性能分析工具以及 QA 回归用例。QA 测试数量并不代表公开使用文档的篇幅多少。两种渲染器采用相同的章节顺序，并均提供 Introduction 和 Playground。Storybook 要求内联排序配置，因此每个预览环境都声明了该顺序；静态验收会对比生成的共享章节顺序以防止出现偏离。

以下 19 个使用章节（包括 Playground）在两个目录中使用完全相同的标题。它们的示例数量可能不同，但访问者可以在切换框架时无需重新适应功能特性的归属位置。

| 共享章节                            | 在 Vue 中可探索的行为                           |
| ----------------------------------- | ----------------------------------------------- |
| Playground                          | 编辑累积源文本与渲染开关                        |
| Basics/Markdown Basics              | 语料库标题、强调、表格、任务列表与引用块        |
| Basics/Math                         | 行内/块级 KaTeX 输出及其样式表要求              |
| Basics/CJK & International Text     | 国际标点符号与强调测试装置                      |
| Basics/Footnotes & Definition Lists | 独立脚注、反向链接与语义化定义列表              |
| Basics/Engine Plugins               | 默认配置、仅高亮与空插件选择；响应式动态切换    |
| Customization/Custom Components     | 映射组件、作用域插槽、属性透传与插槽优先级      |
| Customization/Metadata              | 组件属性与插槽参数中的响应式元数据/流式上下文   |
| Customization/URL Sanitization      | 默认不安全协议拦截与更严格的自定义 URL 策略     |
| Customization/Content Preprocessors | 解析前的源码转换处理                            |
| Customization/Orphan References     | 保留或隐藏未引用的定义，随后添加/移除其读取方   |
| Streaming/Streaming Basics          | 累积语料重播、生产端完成、取消与替换            |
| Streaming/Incremental Parsing       | 在快照与替换之间对比增量解析与全量解析          |
| Streaming/Smooth Streaming          | 组合式排空、节奏控制、生产端完成与初始快照      |
| Streaming/Streaming Cursor          | 自定义标记以及正文/代码/数学公式尾部过渡        |
| Streaming/Turn Taking               | 完成或卸载前序片段以允许队列中的后序片段呈现    |
| Streaming/Error Recovery            | 对比可选的 remend 修复与未修改的不完整 Markdown |
| Documents/Cross-Chunk Coordination  | 迟到定义、重复脚注出现与有效反向链接            |
| Documents/Definition Lifecycle      | 定义更新、移除、恢复与文档隔离                  |

共享的章节名称并不意味着适配器 API 完全相同。Vue 通过 props/作用域插槽接收元素上下文。其 `preserveOrphanReferences` 默认为 `false` 并按渲染器配置；React 的 Provider 层级覆盖在 Vue 中不是组件属性。平滑轮流呈现顺序即注册顺序，而 `documentIndex` 用于决定引用顺序。排空未完成的平滑流时，会暂留其最后一个推测性字素，直到后续追加内容或生产端完成信号对其进行确认。

其余的 React 章节承担明确的框架或验证职责：

| React 章节                                                                                     | Vue 对应边界                                                                                                                                       |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customization/Theming/Font Size & Color Scheme; Design Tokens; Custom Typography & ExtraStyles | Vue 提供基础样式表与常规 class/style 自定义，但不导出 React 排版变体、设计变量或 extra-style 注册表。Vue 预览主题控制其外部画布。                  |
| Customization/Extending/Contexts & Hooks; Define Factories                                     | Vue 上下文在 Custom Components 和 Metadata 下记录；平滑组合式函数位于 Smooth Streaming 下。React Provider Hook 与定义工厂函数不是 Vue 的导出内容。 |
| Integrations/Mantine（包括其 QA 章节）                                                         | 仅限 React 的集成。不隐含提供任何 Vue UI 库相关包。                                                                                                |
| Performance Lab/Streaming Comparisons; Cross-Chunk Stress                                      | React 性能分析工具保留在 React 中。Vue 保留 Performance Lab/DOM Update 用于测量显式 DOM 提交耗时。                                                 |
| QA（增量解析、光标、轮流呈现、状态隔离及其他回归用例）                                         | Vue 保留自身相关的回归用例与浏览器生命周期套件。共享的引擎正确性由引擎测试保证；单纯照搬 React 专用的检测工具并不能为 Vue 提供等价的覆盖。         |

每个 Vue 使用章节均配有 Docs 说明。Controls 用于编辑有用的属性；按钮用于触发挂载后的生命周期转换。静态验收检查要求两个索引中均包含全部 19 个共享章节标题，因此偶发的目录结构偏离会导致验证失败。

<span id="compare-individual-examples"></span>

### 单个示例对比

在共享章节中，Vue 现在针对表格对齐与任务列表状态、中日韩标点与从右至左（RTL）文字方向、流式数学公式与脚注、Smartypants/Pangu/注释移除对比，以及自定义 URL 协议，均包含了与 React 相同的专项场景。这些是对总览示例的补充，而不是新增顶级分组。

插件对比在保留其他默认项的同时省略某一个插件。它们的内容 Controls 会同时更新两个面板。语法与排版测试装置特意包含精确的标点符号、CJK/RTL 文本与字面代码；这些装置中对 React 的引用属于测试数据，并非 Vue 安装指南。流式功能示例使用固定的样本重播，并配有显式的重播/完成/取消按钮，不暴露无实际效果的内容 Control。

自定义协议对比演示了安全清洗与 URL 转换的双重门禁：单独在转换中允许 `app:` 协议并不能恢复已被安全清洗器移除的 URL。该示例仅扩展了选定的协议，保持无关协议处于拦截状态，且不会启动自定义外部应用程序。

<span id="updated-vue-links"></span>

### 更新后的 Vue 链接

原有的组合 Vue 页面已被拆分。使用 `basics-markdown`、`customization-components-and-slots`、`customization-element-context`、`streaming-replay`、`streaming-controls-and-cursor`、`documents-coordination`、`documents-cross-chunk-references` 或 `basics-plugin-configuration` Story ID 的书签必须更新为包含该示例的对应章节。例如，`customization-element-context--reactive-context` 现变更为 `customization-metadata--reactive-context`。不提供自动重定向。代码仓库验收链接使用新的 ID。

<span id="choose-a-sample"></span>

## 选择示例语料

通用示例使用来自 `corpus/documents/markdown.md`、`code.md`、`math.md` 与 `mermaid.md` 的完整摘录。私有的 Storybook 工具包通过显式标题选取小节，并在这些边界丢失时报错失败。它不会另外维护一份手写的相同 Markdown 副本。共享摘录确保了 React、Vue 和 Mantine 的演示具有可比性，而无需生成完全相同的 ID 或 DOM 外层包裹结构。

当精确语法本身就是示例的主题时，专用输入依然适用：CJK 与 RTL 排版、脚注顺序、单独挂载的跨片段定义、不安全 URL 策略、异常流式尾部、代码折叠阈值、嵌套 JSON 格式化以及生命周期回归用例。这些测试装置应明确标识其所验证的行为。其中的字符串属于测试输入，并非安装说明或性能声明。

通用摘录避开了完整语料库中的远程图片与畸形输入小节。浏览器回归测试所使用的静态资源均由本地提供。请勿在通用示例中引入远程图片/字体依赖：离线静态构建与可复现测试必须渲染相同的内容。

<span id="browser-verification"></span>

## 浏览器环境验证

```bash
pnpm typecheck:storybook
pnpm test:storybook:react
pnpm test:storybook:vue
# Both renderer suites, sequentially:
pnpm test:storybook
# Development composition, source updates and shutdown (ports 6006–6008 must be free):
pnpm test:storybook:dev
```

开发模式检查会临时编辑并还原渲染器、core、engine 以及 Vue 样式表源码，以验证浏览器热更新而无需重启服务。请在空闲的代码检出分支上运行；切勿同时编辑这些文件或并发运行其他浏览器套件。它还会检查 Ctrl+C 是否能释放所有三个监听端口，而进程管理测试装置则覆盖了顽固子进程与启动失败的场景。

Vue 明确使用 `vue-component-meta` 进行构建期组件文档生成，替代了已废弃的默认 `vue-docgen-api`。未启用服务端实验性 docgen。

React 套件包含 Mantine。每个项目加载各自的 Storybook 配置并在 Chromium 中运行各自的 `play` 断言。组合入口不会重复执行引用的测试套件。QA 导航在本地保持可见；设置 `STORYBOOK_DOCS_EXPORT=1` 可以在公开导航中隐藏 QA，同时保留其已建立索引的 Stories 和断言。针对隔离性能分析工具特意配置的 `!test` 排除规则依然保持生效。

可访问性插件目前在 `todo` 模式下报告检测结果。浏览器套件测试通过并不代表完全符合可访问性规范。独立的 core 契约、React 生命周期/GC 测试、Vue SSR/水合/压力测试以及引擎压测仍属于分开的验证职责。

<span id="build-a-portable-static-site"></span>

## 构建可移植的静态站点

```bash
STORYBOOK_DOCS_EXPORT=1 pnpm build:storybook
pnpm test:storybook:site
```

构建输出为一个必须整体部署的单一目录：

```text
storybook-static/
  index.html          # Composition entry
  react/              # React and Mantine catalog
  vue/                # Vue catalog
```

Hub 页面引用 `./react` 与 `./vue`，使整个目录能够放置在版本或预览前缀之下。冒烟命令将其托管在 `/preview/storybook/` 下，并依次检查两个直接 iframe 入口、页面刷新、组合导航、实时 Vue Controls 更新以及 React 隔离性能 iframe 目标。保持所有三个构建均源自同一 Git 提交。对于特意分离部署的场景，可在构建 Hub 时设置 `STORYBOOK_REACT_URL` 与 `STORYBOOK_VUE_URL`；这些覆盖项必须指向匹配的版本或 PR 预览环境。

构建命令首先构建公开相关包，然后清空 `storybook-static`，构建 Hub，随后构建两个子目录。仅在所有构建与冒烟检查均成功通过后，才将完整目录整体上传。此构建布局不隐含任何托管服务商、公开域名或版本归档策略。

<span id="repository-ownership-and-links"></span>

## 仓库归属与链接

Stories 存放在 `packages/react/stories`、`packages/react-mantine/stories` 与 `packages/vue/stories` 中。渲染器配置位于 `apps/storybook-*` 目录下。`tooling/storybook-kit` 包含框架中立的语料库摘录与显式的 React/Vue 辅助子路径。这些工作区属于私有工作区，被排除在公开相关包构建、packcheck 与 npm 统一版本发布之外。

React 此前的 `Core/...` 侧边栏名称现在直接描述功能特性；组合入口提供 React 分组。Mantine 移至 `Integrations/Mantine` 下。包含 `core-` 或 `mantine-` 的旧 Story URL 必须进行更新；本仓库中的隔离 iframe 引用使用新 ID。Story ID 由标题和导出名称生成，因此重命名任何一项都需要核对嵌入链接与浏览器回归测试。

安装、公开 API、架构以及迁移指南归属于文档与相关包 README。Storybook 提供交互式示例与简明说明，并配有指向这些指南的链接。共享文档链接集中管理在私有工具包中，以便后续能够定位到独立的文档站点。

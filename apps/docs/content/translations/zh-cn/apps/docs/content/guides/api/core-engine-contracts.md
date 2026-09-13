# Core 与 Engine 公共 API 接口契约

本指南明确了跨框架适配器所依赖的底层共享契约。本文档记录的所有公开 API 均严格遵循语义化版本规范（Semantic Versioning，从 3.0.0 起）；任何破坏性变更（Breaking Changes）均必须升级主版本号（Major Version）。上层应用程序开发者通常直接使用对应的框架适配包；而适配器作者则可以直接使用此处定义的 engine 与 core 接口。关于安装说明请参阅各包的 README 文件，关于运行时行为验证请参阅 [Core 测试指南](../core-testing.md)。

<span id="layers-and-consumers"></span>

## 架构分层与使用方

Engine 提供了语法解析、抽象语法树（AST）转换、增量解析算法、跨片段引用注册表（Reference Registries）以及打字机平滑流式控制器。Core 则提供了可复用的解析会话、块级规划（Block planning）、贡献数据准备与发布、脚注汇总（Aggregate footnotes）以及轮流呈现协调（Turn-taking coordination）。React 和 Vue 适配器显式依赖 core 与 engine；具体的 UI 集成则直接依赖对应的上层框架适配器。

Core 不会无脑重新导出 engine 的全部 API，也不处理 ReactNode、VNode、DOM 元素或框架自身的生命周期。框架适配器负责将语法树转换为具体组件、控制订阅与卸载时机、SSR 服务端水合、插槽/Context 上下文传递、以及光标物理尺寸测量。具体的实现与使用细节请参阅 [Vue 参考文档](../../reference/vue.md)。

<span id="core-factories-and-lifecycles"></span>

## Core 工厂函数与生命周期

| 能力项                               | 输入与输出                                              | 状态所有权与生命周期释放                                                                                  |
| :----------------------------------- | :------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------- |
| `createPipelineSession`              | `PipelineFrameOptions → PipelineTrees`；同步解析        | 每个独立片段持有一个会话；调用 reset 丢弃已保留的中间状态；丢弃宿主引用即可直接释放，无需定时器或全局注册 |
| `createBlockPlanner`                 | 完整 MDAST/HAST、预处理源文本、幻影提示 → 块规划        | 保留单个使用方的上一帧规划状态；替换规划器会重置其内部缓存；被保留的语法树绝不可被篡改                    |
| `derivePhantomTargets`               | 自身定义、注册表全局标签、源文本 → 缺失的目标集合       | 纯函数式准备逻辑；传入 previous 仅作为当前使用方的快照引用一致性提示                                      |
| `deriveCoordinationPolicy`           | 协调状态、注册状态、孤立引用保留策略 → 处理器/采集策略  | 既不执行全局注册，也不发布任何状态                                                                        |
| `buildContributionChain`             | 流水线配置与前缀 → 策略身份元组                         | 覆盖解析策略配置；仅凭源文本相等无法断定贡献数据的有效性                                                  |
| `createContributionSession().commit` | 最终提交的树、标签、Symbol 凭据、写入能力、策略身份元组 | 仅在宿主组件提交（commit）挂载后调用；宿主负责生命周期的注册与释放                                        |
| `buildAggregateTree`                 | 注册表、前缀、孤立引用策略 → 页脚脚注 HAST 树或 null    | 仅为排在最后且符合条件的片段渲染；切勿将结果写回共享的定义主体中                                          |
| `cloneHastForRender`                 | HAST 节点 → 结构性克隆副本                              | 深度克隆节点、children、properties、data 以及 originalUrls；其余嵌套的插件自定义数据保持共享              |
| `createSmoothCoordinator`            | 可选的 onEmpty 回调 → `SmoothCoordinator` 实例          | register 与 release 必须成对调用；清理操作延迟到微任务中执行；done 完成状态在注册生命周期内具有粘性       |
| `deriveTailSignal`                   | MDAST 与预处理后的真实源文本长度 → 源码尾部状态事实     | 不读取物理 DOM；由具体的适配器自主决定测量与视觉呈现方式                                                  |

请将解析与准备阶段生成的结果视为**借用出来的只读数据**（Borrowed readonly values），即便底层的 HAST 类型定义中包含了可变数组。在对语法树或节点属性进行任何修改前，必须先行克隆。共享层既不对每个节点执行全量深度冻结（Deep-freeze），也不保证每次都返回全新引用的对象；适配器之间**绝不允许通过直接修改快照对象来传递状态**。

当增量解析路径遭遇失败时，会自动清空已保留的解析状态并退回全量解析进行重试。整条流水线抛出的大多数异常均会同步向外抛出传播，包括由应用程序自定义插件或处理器抛出的运行时错误。受保护的原始 HTML 嵌套深度超限（报出 `EngineRawHtmlDepthError`）是唯一被特殊处理的例外：解析会话会将该帧降级渲染为经过转义的纯文本段落、清空保留状态，并在下一帧内容到达时重新尝试正常解析。普通的 `RangeError` 并不会触发这一降级兜底。传入 `incrementalParse=false` 同样会清空保留状态，专用于一次性单次服务端渲染（SSR）。服务端无需依赖对浏览器的环境探测即可做出此项决策。

块级 key 严格对齐其逻辑位置；但**单个 key 的稳定并不等同于缓存依然有效**。URL 安全策略、注册表数据、组件配置或语法树引用的变动，依然可能需要重新执行组件树转换。部分扫描与规划工作的时间复杂度仍为 O(blocks) 或 O(document)；更新开销并不承诺绝对与新增追加的字符数量严格成正比。

<span id="engine-registry-readwrite-boundaries"></span>

## Engine Registry 读写边界

调用 `createRegistry()` 会返回一个 `RegistryController` 控制器。其只读查询面 `Registry` 暴露了版本号、只读索引快照、全局及针对特定标签的订阅方法、以及引用解析选择器。其写入面则提供了必须成对调用的注册/释放机制与贡献提交方法。内部的引用计数器、订阅者集合容器以及广播通知函数均不会出现在对外暴露的公共返回类型中。

每一次调用 `registerChunk(chunkId, ...)`，都必须严格配对一次 `releaseSymbol(chunkId)`。某个片段在延迟清理触发之前可以再次注册，但配对调用的原则依旧不可破坏。`onEmpty` 回调会在最终释放的微任务队列中执行。持有注册表的外层映射容器在删除某个注册表前，必须检查其当前条目是否依然指向该注册表实例，以避免误删更新创建的同名新实例。

调用依赖接收者上下文的方法时，请使用标准对象调用形式 `registry.method()`；在作为回调函数传递时请显式绑定上下文（bind）或使用箭头函数包裹。组件卸载时必须主动取消订阅。通知广播可能会将多次无净变动的更新进行合并，因此使用方应当始终直接读取当前的快照数据，而不能依赖回调被触发的绝对次数来推断业务语义。单靠一个 URL 解析选择器无法完整观测到所有汇总脚注主体的变更。

`ContributionRegistry` 刻意仅对外暴露了 `contributeChunkData` 这一项能力；底层共享发布器不会僭越接管宿主框架的生命周期管理。请将语法树（AST）、注册表（Registry）以及协调器（Coordinator）保存在 Vue 的浅层引用（`shallowRef`）中。深层响应式代理（Deep reactive proxy）生成的 Proxy 引用并不等同于 engine 底层的原始节点引用。

<span id="urls-placeholders-and-extensions"></span>

## URL、占位符与扩展机制

适配器需为每个会话分配一个独立的来源凭据（Provenance credential），并将其同时传递给 rehype 校验阶段与跨片段处理器。从 Markdown 源文本中伪造的恶意 engine 占位符标签，绝不允许被直接解释为内部框架组件。

在转换为具体框架组件之前，必须将 `buildTransform` 的最终 URL 校验策略应用于普通的 HAST 语法树。跨片段引用的真实目标地址是在后续阶段动态解析获得的，因此必须经过 `resolveCrossChunkReference` 进行二次清洗、哈希锚点重定址以及逐属性的 `urlTransform`。仅仅把注册表里的原始 URL 粗暴挂载上去是危险的。`keepChildren` 机制能够清晰区分“清洗器仅解包外层标签”与“将元素及其子节点全量剔除”这两种不同的安全动作。

`sanitizeSchema` 是一个全局共享的只读默认单例；`extendSanitizeSchema` 会生成一份独立的深拷贝草稿。全新的对象或函数引用会向适配器传递配置变更的信号。在运行过程中就地修改正在使用的 Schema 对象是明确不受支持的违规行为。自定义框架组件依然被视为受信任的应用程序代码：Markdown 安全清洗器不会对其最终输出的 JSX/VNode 结果进行二次审查。

<span id="smooth-controllers"></span>

## 平滑流式控制器

Engine 控制器负责驱动单个文本源的可见前缀渐进显现；而 Core 协调器则负责裁决何时轮到具体的某一个片段进行展示呈现。

- 初始帧与整段替换操作会立即瞬时呈现（Snap）；经确认的增量追加则按字素（Grapheme）匀速推进。
- Finish 动作会确认最终的完整字素并排空缓冲积压；后续到达的新更新能够重新激活流式播放。
- Flush 刷新操作依然会严格尊重活跃流的字素保留边界。
- 控制器的配置选项对象被刻意设计为实时活跃配置。适配器可以在保留原有对象引用的同时动态调整节奏步长。
- 自定义调度器（Schedulers）必须以异步方式执行回调，且必须返回对应的取消清理函数。同步执行回调属于严重违反接口契约。
- Dispose 会取消当前尚未执行的动画帧并清空所有订阅，但后续的调用仍能重新激活该控制器。在组件真正卸载后请切勿继续调用。
- 协调器的完成状态（Done）具有粘性。当后续有全新消息需要重新排队时，请使用全新的注册身份标识。

<span id="declaration-and-consumer-guards"></span>

## 类型声明与使用方防护门禁

在完成代码构建后，请执行 `pnpm check:public-api`。该脚本会将剔除注释后的完整类型声明文件，与保存在代码库中的 [engine](../../../../../tooling/api-reports/engine.api.txt)、[core](../../../../../tooling/api-reports/core.api.txt)、[React](../../../../../tooling/api-reports/react.api.txt)、[React plugins](../../../../../tooling/api-reports/react-plugins.api.txt)、[Mantine](../../../../../tooling/api-reports/react-mantine.api.txt) 以及 [Vue](../../../../../tooling/api-reports/vue.api.txt) API 契约快照进行逐字比对。该门禁会检查私有 registry/coordinator 类型泄漏、本地 node_modules 物理路径残留、以及共享底层违规反向引入 UI 框架依赖等问题，并确保所有入口模块禁止出现通配星号导出（`export *`）。在运行 `node scripts/check-public-api.mjs --update` 更新快照之前，请人工仔细审查函数签名的每一次变动。

快照比对并不能替代语义维度的行为测试。单元测试全面覆盖了生命周期与不可变性契约；真实浏览器环境则完整覆盖了 Vue 适配器的三条端到端渲染路径。打包后的独立使用测试会在工作区外部安装打包生成的 tarball，并针对 ESM/CJS、开发环境/生产环境、SSR 服务端渲染以及 TypeScript 类型推导进行独立端到端验证。任何对 engine 产生实质影响的发布，均必须提供经过严格验证的本地稳定性压力测试（Soak testing）证据与人工发布审批记录；具体的发布影响策略与证据复用规范请参阅 [Soak 压测覆盖指南](../soak-coverage.md)。严禁将 engine 层的稳定性压测结果误当成 core 或上层适配器的完整生命周期覆盖。

<span id="api-differences-from-beta1"></span>

## 相比 beta.1 的 API 差异

| 接口表面                                                                   | 架构决策                                                   | 演进原因                                                                   |
| :------------------------------------------------------------------------- | :--------------------------------------------------------- | :------------------------------------------------------------------------- |
| Engine 根模块 `export *`                                                   | 彻底移除所有通配星号导出，改为显式命名导出                 | 避免内部辅助函数的添加在无形中导致支持的公共 API 范围发生意外扩散          |
| `PipelineSession` / `PipelineTrees`                                        | 增加显式命名的公共类型；工厂函数明确返回 `PipelineSession` | 规范化 parse/reset 核心契约，避免类型声明随内部实现对象的变动而膨胀        |
| `ContributionSession`                                                      | 增加显式命名的状态发布接口                                 | 确保外部使用方仅能获取到 commit 提交能力                                   |
| `BlockPlanner`                                                             | 增加显式命名的函数类型                                     | 清晰区分有状态的工厂函数与其逐帧执行的规划调用函数                         |
| `isEnginePlugin`                                                           | 增加公开的配置类型保护函数（Type guard）                   | 允许 React/Vue 适配器在无需窥探内部阶段实现细节的前提下合法校验插件合法性  |
| `getEnginePluginInternals` / `EnginePluginInternals` / `EnginePluginStage` | 从根模块导出中彻底移除；收敛为内部实现专用                 | 流水线阶段属于内部实现细节；替换方案直接对外暴露更安全的布尔决策函数       |
| `codePointSnapshots`                                                       | 从根模块导出中移除；开发环境 Story 直接从源码引入          | 测试/演示专用的中间帧生成逻辑并不属于生产级适配器的公共契约                |
| `attributeHastChildren`                                                    | 从根模块导出中移除；收敛保留在增量算法内部                 | HAST 节点的归属关联由增量解析引擎内部全权把控                              |
| `SENTINEL_FN_CONTENT` / `SENTINEL_LINK_URL`                                | 从根模块导出中彻底移除                                     | 适配器层不应当直接手动拼接或硬编码比对内部的幻影协议常量                   |
| `preprocessAIMDContent` 中的额外预处理器数组                               | 接受只读数组（ReadonlyArray）                              | 底层实现仅需对输入进行迭代遍历，无需强制要求调用方提供可变数组             |
| 块级摘要（Digest）与指纹（Fingerprint）辅助函数                            | 作为高级 API 继续予以保留                                  | React 内部缓存机制依赖这些计算；其有效性仍严格取决于语法树与引用上下文策略 |
| `computeFreezeBoundary` 与阶段耗时统计函数                                 | 作为高级诊断工具继续予以保留                               | 供开发者分析工具使用；并不承诺对外提供绝对固定的性能指标或格式化日志输出   |

上述重大改进已在先行预发布系列中全面落地，并构成了 3.0.0 正式稳定版 API 契约的基石。在从 beta.1 进行版本升级时，请始终引入官方文档中明确记录的公共入口，切勿直接依赖内部私有的 dist 物理文件路径。React 组件、Hooks、插件以及 CSS 的公共引用路径均保持向后兼容。插件对象内部的品牌标识字符串（Brand string）同样保持完全不变，以确保单纯的代码组织重构不会破坏已部署线上配置的语义解析。

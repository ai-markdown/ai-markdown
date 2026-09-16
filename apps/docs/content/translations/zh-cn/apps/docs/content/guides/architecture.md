# 架构设计全景（Architecture Overview）

本代码库将底层的 Markdown 计算处理与上层的 React / Vue UI 渲染彻底解耦。`@ai-markdown/engine` 负责文本规范化、语法解析、抽象语法树转换、增量解析状态机以及跨片段文档注册表（Document registries）。共享的 `@ai-markdown/core` 提供了流水线解析会话、块级规划（Block planning）、贡献数据发布、汇总脚注 HAST 树生成以及打字机平滑呈现调度。`@ai-markdown/react` 作为 React 适配器使用上述核心成果，提供 Context 上下文、各类插槽以及多级渲染缓存。`@ai-markdown/react-mantine` 则通过组合 React 适配器的公共 API，提供针对 Mantine 设计系统的专属排版与代码/图表组件。

在排查渲染缺陷、调整性能优化策略或开发新集成时，请通读本指南。最核心的关键认知在于清晰区分以下四个完全独立的离散事件：输入源文本变动、语法树重新计算、块级规划重新生成、以及 React 使用方组件重新渲染。这些事件具有完全不同的触发条件与依赖项。订阅 Context 的更新绝不需要重新解析 Markdown，而增量解析的成功命中也并不意味着后续的所有处理开销都能绝对与最新到达的单个 Token 成正比。

<span id="shared-core-and-framework-adapters"></span>

## 共享核心层与框架适配器

在历史版本 v2.14.1 中，代码库完成了私有运行时的架构拆分。在 3.0.0 正式稳定版中，该共享实现已提升为独立的公共包 `@ai-markdown/core`，而 React 专属实现则对应为 `@ai-markdown/react`。Core 依赖 engine；各个适配器均将 core 和 engine 声明为严格锁定相同版本的外部依赖。Mantine 则是建立在 React 之上的对等集成包（Peer-based integration）。[迁移指南](framework-transition.md) 详细列出了使用方端的包名引入变更与样式表更新路径。

共享 core 管理的是纯粹的计算会话，而非 React 的框架生命周期。`MarkdownContent` 为每个渲染实例独立维护一个流水线会话与规划器实例，在渲染策略失效时重置已保留的状态，并安全委托解析，而绝不把注册动作提前到渲染期执行。`useRegistryContribution` 仅在组件挂载提交（Commit）后才调用共享发布器。React 依然牢牢把控着缓存的 VNode 节点、Context 订阅、SSR 服务端水合一致性（水合渲染阶段绝不读取注册表动态状态，因此处于 Suspense 边界内晚于兄弟节点完成水合的片段依然能与服务端输出完美吻合）以及光标在物理 DOM 中的几何测量。[Core 模块架构图](../../../../packages/core/README.md#responsibility-and-dependency-direction) 是深入该层的权威源码索引。

<span id="vue-adapter"></span>

## Vue 适配器

当前发布的 `@ai-markdown/vue` 稳定版适配器与 React 共享完全相同的底层流水线会话与贡献准备算法。它并未采用块规划器（Block planner）：因为块规划的核心目的是为 React 的逐块渲染缓存生成稳定的 key，而 Vue 则是将每一帧生成的完整 HAST 整体转换为 VNode 树，并交由 Vue 底层的高效虚拟 DOM Patch 算法执行 Diff 计算。它将 AST 语法树与注册表引用严格隔离在 Vue 深层响应式代理（Deep reactive proxy）之外，通过计算属性（Computed refs）按需选择稳定的插件与 Schema 输入，且严格仅在挂载（Mounted）后才发布贡献数据。注册表发出的状态更新通知通过引用稳定的计算属性（幻影目标与占位符背后的解析事实）传递给目标片段，因此文档中其他片段发布新定义时，仅当当前片段正在等待或展示的数据确实发生变更时，才会触发该片段的重新解析或重渲染。VNode 转换在应用最终 URL 策略之前会对 HAST 进行浅克隆；解析后的跨片段链接/图片调用统一的共享解析器。SSR 与首帧水合阶段不分配注册表。Vue 3.5 的 `useId` 提供了稳定的自动化 ID，DOM 观察器则归属于 Vue 光标组件。参见 [Vue 参考文档](../reference/vue.md) 与 [共享 API 契约](api/core-engine-contracts.md)。

<span id="the-react-component-tree"></span>

## React 组件树分层架构

```text
<AIMarkdown>
  <AIMarkdownMetadataProvider>          ← Context for opaque user metadata
    <AIMarkdownProvider>                ← Four per-system contexts: document / state / theme / behaviors
      <Typography>                      ← Configurable wrapper (default | Mantine | custom)
        <ExtraStyles?>                  ← Optional CSS-scope wrapper
          <AIMarkdownContent>           ← The actual markdown renderer
            ↳ react-markdown (vendored) with remark/rehype pipeline
            ↳ block-level memoization
            ↳ cross-chunk placeholder resolution
        </ExtraStyles?>
      </Typography>
    </AIMarkdownProvider>
  </AIMarkdownMetadataProvider>
</AIMarkdown>
```

每一层均承担单一且有严密规范的独立职责：

| 架构分层                       | 核心职责                                                                                                                                |
| :----------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------- |
| `<AIMarkdown>`                 | 单点平铺属性（Flat-prop）解析，合并官方默认配置；调度内容预处理流水线；维系稳定性防护门禁（Stability firewall）                         |
| `<AIMarkdownMetadataProvider>` | 将用户自定义的不透明业务数据与渲染层 Context 彻底物理隔离                                                                               |
| `<AIMarkdownProvider>`         | 承载已解析的 document / state / theme / behaviors 数据载荷（四个独立 Context；state 与 behaviors 支持向上合并外层累加式 Provider 分组） |
| `<Typography>`                 | 注入 `font-family`、基准 `font-size` 与主题类名；通过 `style` 行内注入 `--aim-*` CSS 自定义属性变量                                     |
| `<ExtraStyles>`                | 可选的局部 CSS 作用域包装容器（Mantine 集成借助此层注入基于 em 的变量覆盖）                                                             |
| `<AIMarkdownContent>`          | 深度定制的内置 react-markdown 流水线 + 块级缓存缓存 + 跨片段占位符动态解析                                                              |

---

<span id="why-five-contexts"></span>

## 为什么拆分为五个 Context？

解析出的全部状态被细致解耦到五个按职责划分的专属 Context 中——document、metadata、state、theme、behaviors——各自配套提供专属的窄粒度 Hook（`useAIMarkdownDocument()`、`useAIMarkdownMetadata()`、`useAIMarkdownState()`、`useAIMarkdownTheme()`、`useAIMarkdownBehaviors()`），同时提供了一次性订阅全部五个 Context 的聚合型 Hook `useAIMarkdown()`。

这种拆分完全对应了各状态在运行时的**变动频率差异**。**元数据 Metadata**（业务回调、消息 ID、业务状态）通常在父组件重渲染时频繁重新分配——在 React 中编写 `metadata={{ onCopy, messageId }}` 是普遍的常规写法——因此它被完全独立隔离，Markdown 渲染主体绝对不订阅它。**`streaming` 流式标记**是整套库中翻转最频繁的状态字段，因此它位于专属的 state Context 中，状态翻转仅会精准唤醒 `useAIMarkdownState()` 的订阅者。而主题配置、行为开关以及文档身份标识极少发生改变，不会被前两者的高频波动所殃及。

如果像旧版 v1.x 一样将所有状态混在单个全局 Context 中，任何一次元数据微调或 `streaming` 标记切换都会无差别强制重渲染所有子组件。通过拆分，组件仅在其真正关心的局部系统发生变化时才会重渲染，从而为块级缓存缓存提供了坚实的生效前提。

详细的业务影响与使用建议请参阅 [元数据 Context](metadata-context.md)。

---

<span id="the-render-pipeline"></span>

## 核心渲染流水线（Render Pipeline）

官方标准流水线由**渲染阶段（Render phase）**与**提交阶段（Commit phase）**交替驱动。解析与块规划负责计算出当前帧的渲染输出。挂载后的 Effect 负责将已提交的引用与定义发布到跨片段注册表中，这可能会触发新一轮渲染以解析刚就绪的新定义。

```text
Raw accumulated content
  │
  ├─ built-in append-aware LaTeX normalization
  └─ caller string preprocessors, in order
  │
Preprocessed source
  │
  ├─ coordinated mode: scan own definition labels
  ├─ read currently registered labels / determine phantom suffix
  │
  ├─ full parse, or verified prefix + parsed/transformed tail
  │    remark parse → remark transforms → remark-rehype
  │    → raw HTML expansion → engine-tag provenance check
  │    → sanitize schema → footer adornment → hash rebasing
  │    → KaTeX → image unwrapping
  │
Full-document mdast + hast
  │
  ├─ plan blocks (reuse eligible retained prefix plans)
  ├─ render cache hits / convert misses to React elements
  │    URL transform runs during hast traversal for conversion
  └─ render local or aggregate footnotes and source-tail signal
  │
React commit
  └─ effects register the chunk and publish changed refs/defs
       → registry notifications → affected consumers render again
```

<span id="stage-a-content-preprocessing"></span>

### 阶段 A：内容预处理（Content preprocessing）

React 适配器为每个挂载的实例创建一个专属的增量 LaTeX 预处理器，并根据源文本及外部预处理器引用对预处理结果进行缓存。内置预处理器负责保护受支持的代码区域、规范化数学分隔符、精准识别货币符号、转义公式内的表格管道符，并在语法允许的情况下截断末尾未闭合的块级公式。该流程独立于 `streaming` 标记运行。

调用方自定义的预处理器按数组顺序依次接收已规范化的完整字符串。它们有权改动源码位置以及连续两次解析输入之间的末尾追加关系。如果预处理器改写了前文已有的文本或剥除了末尾的人工修补字符，即使原始源文本是纯末尾追加，送入解析器的输入也不再构成严格的末尾追加。详见 [内容预处理器](content-preprocessors.md)。

<span id="stage-b-parse-and-transform"></span>

### 阶段 B：语法解析与转换（Parse and transform）

`buildCoreRemarkPlugins` 严格定义了插件的标准执行顺序：GFM 与数学语法；选定的高亮与定义列表语法；换行、Emoji、段落压缩以及两个 CJK 标点解析扩展；随后执行注释过滤、SmartyPants 智能标点（在此之前优先执行 engine 专属的 CJK 引号配对预处理，确保紧邻中文的直引号在 SmartyPants 接管前已向正确方向弯曲）以及盘古混排空格。调用方传入的 `enginePlugins` 仅控制插件的启用与否，绝不允许篡改既定顺序。

`remark-rehype` 将 Markdown 语法树节点转换为 HTML 语法树节点。自定义处理器在调用方要求时保留孤立脚注的主体内容，并在注册表存在时输出跨片段协调占位符。幻影定义（Phantom definitions）允许 Markdown 解析器能够合法识别那些当前由文档其他片段所定义的跨片段引用。它们属于流水线内部的辅助解析输入，绝非调用方书写的实际正文。

rehype 插件链负责展开原始 HTML、校验 engine 占位符的合法来源凭据（Provenance）、执行安全清洗、规范化脚注展示、重定址哈希锚点、调用 KaTeX 渲染数学公式、并解包仅包含单张图片的孤立段落。安全清洗严格发生在 KaTeX 之前：清洗 Schema 仅放行 KaTeX 所使用的数学标记类名，而非对 KaTeX 生成的深层公式 HTML 进行全盘盲目放行。

当开启增量解析时，`advanceIncrementalParse` 统揽语法解析与转换全过程。它会验证并复用已确认安全的冻结前缀，仅对末尾的新增尾部重跑上述阶段。一旦前置门禁未通过或遇到不支持的语法接缝，它会自动平滑退回全量解析。输出的严格契约包含每个语法树节点的行列与偏移量位置，以供下游缓存 key 与自定义组件精准使用。

<span id="stage-c-cross-chunk-contributions"></span>

### 阶段 C：跨片段贡献管理（Cross-chunk contributions）

定义标签扫描仅在跨片段协调模式下激活，且具备追加感知能力。注册与发布严格在 React Effect 中执行，绝不在计算语法树的渲染阶段偷跑。注册 Effect 会为当前片段分配唯一的 Symbol 凭据，并记录其在文档中的顺序和自身拥有的定义标签。随后的提交帧才能在该 Symbol 凭据下将解析出的引用和定义主体安全发布。

`useRegistryContribution` 通过运行时的贡献会话提交数据，该会话会对引用列表、定义内容、标签集合以及幻影目标，连同解析策略依赖元组一起计算特征指纹。内容完全一致的贡献不会重复广播。脚注主体直接从经过完整流水线处理后的 HAST 树中提取，因此数学公式、原始 HTML 以及定义列表格式在最终汇总呈现时均能保留。超链接的目标地址以未经清洗的原始形式存入注册表；由最终使用该链接的渲染器严格执行属于它自己的最终元素安全策略。

<span id="stage-d-block-planning"></span>

### 阶段 D：块级规划（Block planning）

`buildBlocks` 利用顶层的 HAST 树与 MDAST 归属关联构建渲染项列表。它会精确追踪源文本切片、行列位置、重复出现序号、外部引用依赖、以及特殊的页脚/行内输出。没有有效源位置信息的合成节点不能简单丢弃；原始 HTML 同样可能导致一个 Markdown 源码块衍生出多个 HTML 兄弟元素，或者将后续的源码块意外包裹吞没。

`createBlockPlanner` 仅在保留的 mdast 与 hast 节点引用能够证明前缀完全兼容时才复用规划结果。包含引用的前缀可以被安全复用，但其尾部规划会接收全文档级的引用上下文，以确保全局编号与引用序号严格准确。原始 HTML 区域与定义声明区域则采取保守的全量规划策略。顶层遍历开销与块数量成正比，引用上下文的遍历仍需访问完整的 mdast 语法树。

<span id="stage-e-per-block-render-memoization"></span>

### 阶段 E：逐块渲染与记忆化缓存（Per-block render + memoization）

每个渲染实例内部的私有缓存根据源码引用、物理位置以及关联的上下文特征来索引已渲染的 React 子树。渲染器在构建当前活跃缓存的同时比对上一帧缓存，从而确保在新规划中被删除的旧块不会在内存中无限期滞留。当输出策略发生变化时，会在读取缓存之前**同步彻底清空缓存**；如果等待 Effect 异步清理，会导致页面闪现一帧陈旧过期的渲染输出。

缓存命中会直接返回先前已构建的 React 元素节点。这省去了对未变动块的 JSX 转换开销，但其下层子孙依然是普通的 React 组件：其内部的局部 state、Context 订阅或外部 Store 变更依然能够正常驱动它们独立更新。块级缓存缓存的是语法树到 JSX 的转换计算，而非将该子树未来的所有交互行为全盘冻结。

<span id="stage-f-per-attribute-url-transform"></span>

### 阶段 F：逐属性 URL 转换（Per-attribute URL transform）

URL 转换回调在发生缓存未命中时、语法树遍历转换为 JSX 的过程中即时执行，早于最终生成的 React 元素真实挂载渲染。它绝不是在 React 渲染整篇文档之后的二次单独遍历。第一道关卡 Gate 1 已通过 `rehype-sanitize` 过滤了整棵树；第二道关卡 Gate 2 接收通过过滤的 URL 属性并对其进行业务改写。

跨片段链接/图片占位符在主树完成 rehype 各阶段后才进行最终动态解析，因此其最终生成的 `a` 或 `img` 会在解析时完整复现等价的 Schema 与 URL 策略校验。这包括目标标签名合法性、属性白名单、祖先节点约束以及哈希锚点重定址。注册表仅共享数据，绝不共享安全授权策略；每个使用引用的片段始终严格使用自身的组件 props 进行安全把关。

---

<span id="documentid-and-clobber-prefix"></span>

## `documentId` 与 DOM 污染隔离前缀（Clobber prefix）

Markdown 脚注与哈希锚点在生成 HTML 时会输出带有自动化 ID 的 `<li id="…">` 与 `<a href="#…">`。如果没有命名空间隔离，同一个页面上并存的两个 `<AIMarkdown>` 实例必定会发生严重的 DOM ID 碰撞：

```html
<!-- Message 1 -->
<a href="#user-content-fn-1">[1]</a>
<li id="user-content-fn-1">…definition A…</li>

<!-- Message 2 -->
<a href="#user-content-fn-1">[1]</a>
<!-- ← scrolls to message 1's footnote! -->
<li id="user-content-fn-1">…definition B…</li>
```

解决方案：为每一个可能遭受污染的 HTML 属性自动添加基于当前文档的专属命名空间前缀。`<AIMarkdown>` 接收调用方传入的 `documentId`（或通过 `useId()` 自动生成），并由此派生出 `clobberPrefix`：

```ts
clobberPrefix = `${encodeURIComponent(shortenDocumentId(documentId))}-user-content-`;
```

长度超过 16 字符的超长 ID 会在编码前通过 MurmurHash3 哈希并转为 Base62 编码，确保调用方传入 UUID 或 nanoid 时生成的最终 HTML 依然精简紧凑。这种哈希缩短仅影响最终渲染到 DOM 上的属性前缀——通过 `useAIMarkdownDocument().documentId` 读取到的依然是未经修改的原始字符串，确保注册表键名与调用方业务代码读取到的始终是真实 ID。针对格式畸形的 UTF-16 字符串（存在未配对的孤立代理对，例如上游截断 emoji 导致的半截字符），无论长度如何均会无条件强制哈希——基于其原始 UTF-16 码元并在独立种子下运算——从而派生出合法的有效前缀，彻底避免抛出 `URIError` 异常，同时确保不同的损坏字符串依然能对应互不冲突的独立前缀（在 2^32 哈希碰撞概率上限内）。开发环境下控制台会输出黄色 warning 警告并精准指出上游数据损坏的根源。

**属于同一逻辑文档的多个片段共享相同的 `documentId`**，因此它们的属性前缀完全对齐。这正是串联 [`<AIMarkdownDocuments>`](cross-chunk-coordination.md) 与跨片段锚点平滑导航的底层核心纽带。

---

<span id="the-cross-chunk-registry"></span>

## 跨片段注册表架构机制

底层实现位于 `packages/engine/src/components/documentRegistry.ts`（纯框架无关实现；React 适配器仅重新导出了其只读公共类型）。核心不变性保证：

1. **按 `documentId` 严格分区隔离**。外层容器维护一个 `Map<documentId, Registry>`。每个唯一的文档 ID 拥有完全独立的专属注册表。
2. **基于 Symbol 凭据的贡献归属**。每个片段在挂载时分配一个唯一的 `Symbol(reactId)`，并在该 Symbol 下向注册表提交数据。该 Symbol 是该片段在注册表生命周期内的唯一身份标识。
3. **引用计数与微任务延迟清理**。`releaseSymbol` 会递减引用计数并通过 `queueMicrotask` 调度清理。这确保了在 React 19 的 Strict Mode 严格模式下（单帧内快速触发 mount → unmount → mount），片段的注册状态与身份标识能够平滑存续而不丢失。
4. **单调递增的版本计数器**。任何产生实际状态变动的写入均会递增 `version`；全局订阅者通过微任务合并广播被统一唤醒。针对特定标签的细粒度订阅者则通过比对索引选择器快照，仅在关心的标签确实受到影响时才被精准唤醒。
5. **动态汇总 labelSet**。`labelSet.{footnoteLabels, linkLabels}` 是当前所有存活片段自身拥有定义的并集。供阶段 B 的幻影定义注入流程使用，精确判定哪些孤立引用需要建立保护。
6. **尾部片段卸载与内存回收**。当最后一个存活片段释放其 Symbol 且注册表彻底变空时，会触发 `onEmpty` 回调，将该注册表从外层的全局 Map 中干净移除。下一次使用相同 ID 挂载时会分配全新的干净注册表。注册表与平滑协调器缓存均采用弱引用机制（Weak references），因此由已放弃的中间渲染帧引发的临时分配不会被外层持久强引用。挂载存活的使用方保留活跃作用域；垃圾回收后的空键由带有身份校验的终结器安全清理。

对外公开的 `Registry` 接口**仅暴露只读查询方法与选择器**。所有写操作方法（`registerChunk`、`allocateSymbol`、`releaseSymbol`、`contributeLabels`、`contributeChunkData`）均收敛在内部的 `RegistryInternal` 接口中，**严禁**从包入口中导出。外部业务代码不可能绕过渲染器直接篡改注册表内部状态。

---

<span id="block-memoization-invariants"></span>

## 块级缓存核心不变性规范

共享的块规划与特征指纹位于 `packages/core/src/blockPlan.ts` 与 `blockPlanner.ts`；React 专用的节点缓存保留在 `packages/react/src/components/blockMemo.ts` 中。规划项采用框架中立的 `key`。核心不变性规范：

1. **规划以 HAST 为核心，兼顾 MDAST 归属映射。** 只有真正能在 HTML 侧产生视觉输出的节点才会成为渲染项。源位置、范围、合成节点以及原始 HTML 的归属关系决定了输出如何映射回源码；切勿假定每个 mdast 节点必定能严格对应生成单个 HTML 元素。
2. **两级偏移量检索（Two-tier offset lookup）。** 源码位置元数据（`startOffset`、`startLine`）会被直接纳入缓存 key 的计算，确保在不同位置出现的相同文本内容不会发生错误的缓存碰撞。
3. **换入并丢弃语义（Swap-and-discard）。** 规划在每一帧重新生成；先通过 key 检索上一帧的活跃缓存，随后将已不在新规划中的弃用块彻底清理释放。
4. **同步依赖失效清理。** 主 G3 检查会比对 12 项渲染策略依赖；独立的孤立引用策略检查同样会精准清空受影响的缓存输出。关键在于时序：必须在当前渲染帧读取任何缓存节点**之前同步完成失效清理**。
5. **`globalCtx` 为所有引用/定义贡献者的全局并集。** 受到全局上下文污染的敏感块会将该并集特征纳入自身的缓存 key。

上述不变性由完备的自动化测试体系强力保障（`byteEquivalence.test.tsx` 是一套严密的测试框架，针对每一种插件组合在开启/关闭 `blockMemo` 的情况下断言逐字节绝对等价）。

在对块规划或渲染逻辑进行任何改动之前，请参阅 [Core 共享契约文档](../../../../packages/core/README.md#planning-and-rendering-contracts)。其中详尽规范了缓存身份、归属权与提交时序；无需依赖任何未纳入版本管理的本地临时文档。

---

<span id="sanitization-architecture"></span>

## 安全清洗架构设计

官方默认 Schema 是基于 `rehype-sanitize` 原生 `defaultSchema` 扩展并全局深层冻结的单例。其包含的渲染器专属规则包括：

- 放行用于 `==高亮语法==` 的 `<mark>` 标签。
- 放行 `<code>` 标签上的 `math-inline` 与 `math-display` 数学类名（供 `remark-math` 标记，以便后续 `rehype-katex` 安全使用）。KaTeX 自身生成的深层类名（`katex`、`katex-html` 等）无需在此声明——它们能安全存活是因为 `rehype-katex` 运行在 `rehype-sanitize` 之后。
- 放行跨片段协调专用标签：`cross-chunk-link`、`cross-chunk-image` 与 `footnote-sup`。

若通过 `{ ...defaultSchema, … }` 手工硬编码 Schema，上述重要规则会被全部静默抹杀。`extendSanitizeSchema` 始终在**本库专属的**默认配置克隆副本上操作，确保扩展时内置规则无一遗漏。

官方默认 Schema **不会**直接作为静态常量从 `@ai-markdown/react` 根模块导出——仅导出扩展辅助函数。这在架构设计上彻底杜绝了浅拷贝（Shallow-spread）的隐患：因为使用端压根找不到可以被浅拷贝的原始对象变量。（`@ai-markdown/engine` 导出了该深层冻结的单例供 core 构建核心流水线；外部需通过扩展函数获取独立的可变草稿副本。）

完整的双重门禁设计原理请参阅 [URL 过滤与自定义协议](url-sanitization.md)。

---

<span id="the-mantine-integration"></span>

## Mantine 官方扩展包的集成架构

`@ai-markdown/react-mantine` 是一个极具代表性的轻量级官方封装层：

1. 提供 `codeBlock` 专属行为配置分组（`defaultExpanded`、`autoDetectUnknownLanguage`、`languageFormat`、`formatJson`、`expandNestedJson`、`highlightIntervalMs`、`mermaidIntervalMs`）——通过累加式 `AIMarkdownBehaviorsProvider` 注入，调用 `useMantineCodeBlockOptions()` 进行读取。
2. 提供 `MantineAIMarkdownTypography`（内部封装了 Mantine 官方的 `<Typography>` 组件）。
3. 提供 `MantineAIMDefaultExtraStyles`（用于承载基于 em 的 Mantine CSS 变量局部作用域覆盖）。
4. 将 `customComponents.pre` 覆盖为 `MantineAIMPreCode`（集成 CodeHighlight 语法高亮、Mermaid 图表以及 JSON 美化折叠）；开启 `autoDetectUnknownLanguage` 时，它借助 `@ai-markdown/code-language-detector` 识别未标注语言的代码块。
5. 从 Mantine 的 provider（`useMantineColorScheme`）读取配色方案，`auto` 时借助 `useSyncExternalStore` 对系统查询求值，使客户端首帧即为正确配色。

上述每一项扩展均完全基于 core 导出的**官方公开扩展点**构建。未借助任何内部未公开私有后门。完整实现模板请参阅 [通过子包进行功能扩展](extending-via-subpackage.md)。

---

<span id="react-19-specifics"></span>

## React 19 专属适配细节

- `useId()` 用于生成自动化的 `documentId`——具备 SSR 安全性，在多次重渲染间保持稳定，且在不同组件实例间天然严格唯一。
- 兼容 React 19 Strict Mode 严格模式下的双重挂载行为，通过 `documentRegistry` 中的微任务延迟清理机制实现平滑过渡（releaseSymbol → microtask → 身份一致性校验 → 决策是否物理销毁）。
- 明确将 React 19 声明为 Peer 依赖要求。内部同时合理运用了用于注册表/控制器订阅的 `useSyncExternalStore` 以及注入光标样式的 `useInsertionEffect`；代码中存在早期 Hook 并不能作为支持旧版本 React 主版本的依据。

---

<span id="why-a-vendored-react-markdown"></span>

## 为什么采用内置分叉（Vendored）的 `react-markdown`？

本库将 `react-markdown` 深度改造为内部模块引入，并沿着 engine 边界清晰拆分为两半：纯流水线的一半（processor、transform、parse/transform 各阶段）位于 `packages/engine/src/components/markdown/`；React UI 渲染的一半（`renderHastSubtree`、`<Markdown>` 组件）位于 `packages/react/src/components/markdown/`。这是经过深思熟虑的内部定制分叉，保留了上游原作者的全部版权归属信息：

- 块级缓存必须能够深度介入底层语法树到 JSX 的转换阶段（`toJsxRuntime`），而上游原版将该逻辑严密封装在组件内部无法干预。
- 流水线必须解耦为**三个完全独立的离散阶段**（解析 parse、规划 plan、渲染 render），使得块级缓存能够在各阶段缝隙间实现精准拦截与缓存。
- 跨片段协调占位符标签需要深度介入 mdast → hast 的转换逻辑，并在底层挂载上游原版所不支持的自定义处理器。

分叉改动完全是有意为之且严格受控的。终端开发者完全无需自行安装 `react-markdown`——引入本库即可开箱即用。

---

<span id="module-layout"></span>

## 代码库模块目录物理拓扑

```text
packages/engine/src/                ← @ai-markdown/engine (framework-agnostic)
├── index.ts                    ← explicit public algorithm exports for core and adapters
├── plugins/
│   ├── catalog.ts              ← the five sealed engine plugins + defaultEnginePlugins
│   └── defs.ts                 ← AIMarkdownEnginePlugin type + seal brand
├── preprocessors/
│   ├── index.ts                ← preprocessing pipeline orchestrator
│   ├── defs.ts                 ← AIMDContentPreprocessor type
│   ├── latex.ts                ← built-in LaTeX normalizer
│   └── remend.ts               ← remend streaming-repair preprocessor
├── fixtures/                   ← shared streaming payload fixtures (tests + stories)
├── experiments/prefixFreeze/   ← freeze-boundary measurement study
└── components/
    ├── incrementalParse/       ← splice engine + arbiter harness + fuzz batteries
    │   ├── computeFreezeBoundary.ts ← resume orchestration and boundary selection
    │   ├── freezeScanState.ts / freezeLineSyntax.ts / freezeLineTransition.ts
    │   ├── spliceParse.ts       ← splice orchestration and fallback order
    │   └── prefixInjection.ts / spliceCoordinates.ts / spliceHtmlGuards.ts / prefixAlignment.ts
    ├── markdown/               ← pure pipeline half of the vendored react-markdown
    │                             (processor, transform, parse/transform stages)
    ├── smoothStream/controller.ts ← framework-agnostic pacing controller
    ├── pluginChain.ts          ← remark/rehype chain assembly
    ├── collectDefLabels.ts     ← def-label scanner
    ├── extractDefBodiesFromHast.ts / extractContributions.ts
    ├── documentRegistry.ts     ← cross-chunk shared state (pure data structure)
    ├── sanitizeSchema.ts       ← library default schema
    ├── extendSanitizeSchema.ts ← public schema-extension helper
    ├── crossChunkUrlSanitize.ts ← cross-chunk URL filter
    ├── customMdastHandlers.ts  ← mdast → hast handlers (phantom defs, footnote sup, …)
    ├── rehypeRebaseHashLinks.ts / rehypeFooterAdorn.ts
    ├── remarkInjectPhantomDefs.ts
    ├── hastPredicates.ts       ← shared hast detection helpers
    ├── normalizeId.ts / shortenDocumentId.ts / devStageTimings.ts
    └── …
```

```text
packages/core/src/                 ← @ai-markdown/core (framework-independent)
├── index.ts                       ← explicit public orchestration exports
├── coordinationPreparation.ts     ← phantom targets and shared policy decisions
├── pipelineSession.ts             ← one consumer’s parse session
├── blockPlan.ts / blockPlanner.ts ← neutral plan and retained-plan reuse
├── contribution.ts                ← committed publication
├── aggregateFootnotes.ts          ← aggregate footer HAST
├── cloneHastForRender.ts           ← render-owned structural clone
├── smoothCoordinator.ts           ← document reveal queue
└── tailSignal.ts                  ← source-tail classification

packages/vue/src/                  ← @ai-markdown/vue (Vue 3.5)
├── index.ts                       ← components, composables and shared helpers
├── AIMarkdown.ts                  ← props and Vue lifecycle
├── useMarkdownChunk.ts            ← per-chunk session/planner integration
├── documents.ts                   ← provider and document scopes
├── render.ts                      ← HAST to VNodes, components and slots
├── smooth.ts                      ← smooth component and composables
├── cursor.ts                      ← DOM cursor and observer lifecycle
├── types.ts                       ← public props and element context
└── styles.css                     ← base presentation
```

```text
packages/react/src/                  ← @ai-markdown/react (React)
├── index.tsx                   ← <AIMarkdown> + public API re-exports
├── defs.ts                     ← prop payload types, variant/scheme types
├── resolveFlatProps.ts         ← single-point flat-prop resolution vs shipped defaults
├── context.tsx                 ← five contexts + narrow hooks + additive Providers
├── define.ts                   ← defineTheme / defineBehaviors / definePipeline factories
├── plugins/index.ts            ← /plugins subpath (re-exports the engine catalog)
├── hooks/
│   ├── useStableRecord.ts      ← stability firewall (table-driven, policy per prop)
│   ├── useStableValue.ts       ← deep-equal reference stabilizer
│   └── useReferenceFlipWarning.ts ← dev-only identity-flip detector
├── components/
│   ├── MarkdownContent.tsx     ← the actual markdown renderer
│   ├── markdown/               ← React half of the vendored react-markdown
│   │                             (renderHastSubtree, <Markdown>)
│   ├── typography/             ← default typography variant
│   ├── blockMemo.ts            ← block-level memoization
│   ├── AIMarkdownDocuments.tsx ← cross-chunk wrapper (React shell over the registry)
│   ├── crossChunkPlaceholders.tsx ← placeholder element renderers
│   ├── streamingCursor/        ← streaming cursor feature
│   └── smoothStream/           ← useSmoothStream / useDocumentSmoothStream / coordinator
└── typings/                    ← ambient type shims
```

```text
packages/react-mantine/src/
├── index.tsx                   ← barrel
├── defs.tsx                    ← codeBlock group type + shipped defaults, metadata type
├── define.ts                   ← defineMantineBehaviors (widened factory)
├── MantineAIMarkdown.tsx       ← wrapper component (firewall + behaviors Provider)
├── components/
│   ├── typography/
│   │   └── MantineTypography.tsx
│   ├── extra-styles/
│   │   └── DefaultExtraStyles.tsx
│   └── customized/
│       └── PreCode.tsx          ← CodeHighlight + Mermaid + JSON
└── hooks/
    ├── useMantineCodeBlockOptions.ts
    └── useMantineAIMarkdownMetadata.ts
```

`packages/remark-mark-highlight` 是由 engine 引入、遵循独立语义化版本发布的 remark 插件包，是仓库内的第六个公开包。`packages/code-language-detector` 是由 react-mantine 引入、零依赖且遵循独立语义化版本发布的代码语言探测器，是第七个公开包。`packages/react/plugins` 仅属于 `@ai-markdown/react` 的一个导出子路径。

Storybook 应用位于 `apps/storybook-{hub,react,vue}`，共享工具位于 `tooling/storybook-kit`。这些工作区、核心测试语料库、性能基准套件以及归档的原型代码均属于私有维护资产。关于按包过滤构建与测试的命令，请参阅 [开发命令速查](development-commands.md)。

<span id="package-boundary-and-verification-ownership"></span>

## 包边界隔离与验证归属

Engine 与 Core 均对外暴露了完备且有严格文档记录的适配器公共契约，自 3.0.0 起严格遵循语义化版本规范。Core 将 engine 的依赖精确锁定在相同的发布版本上。React 设计系统包装层应当使用 React 适配器的稳定 props、Hooks 与导出的辅助函数。引入 engine 原语构建非 React 适配器的开发者，负责自身处理流水线的组装与质量验证。

不同维度的自动化验证层回答了完全不同的技术问题：

| 验证分层                             | 核心解答的关键技术命题                                                                               |
| :----------------------------------- | :--------------------------------------------------------------------------------------------------- |
| Core 逐字节等价性测试                | 经过块级缓存优化的渲染输出，是否与未经优化的原生路径保持绝对完全一致？                               |
| Engine 语法树拼接等价性              | 增量解析生成的 mdast/hast 语法树（包含每个节点的行列坐标），是否与单次全新全量解析完全一致？         |
| 边界移动方向与语法一致性             | 一个已被冻结判定的安全前缀，在后续遇到危险语法时是否会发生错误的越权篡改？                           |
| 敏感度与非空洞性校验（Anti-vacuity） | 人工植入的语法缺陷能否被测试套件精准捕获？各项性能优化逻辑在实际测试中是否确实被真正执行了？         |
| 浏览器 Storybook 端到端用例          | Context 状态流转、光标精确定位、队列调度与真实 DOM 渲染，在真实的 React 挂载生命周期中能否完美运转？ |
| 浏览器性能 Benchmark 基准测试        | 在特定压力负载场景下，系统实际消耗的 CPU 耗时与交互响应延迟处于何种水平？                            |

性能测试数据不能作为逻辑等价性的数学证明，而全绿的等价性测试同样不能代表系统渲染绝对零延迟。当前正式发布的验证机制在 [Soak 压测覆盖指南](soak-coverage.md) 中有详细说明；历史实验报告仅代表其特定测试环境下的基准数据与局限性。

<span id="where-to-investigate-a-defect"></span>

## 常见缺陷的排查定位路径

- 如果发现**字符被意外改写或丢失**：在进入解析器之前，重点排查预处理阶段。
- 如果发现**语法树节点结构异常**：在进入 React 转换之前，比对全量解析与增量解析生成的语法树结构。
- 如果在策略更新或新定义发布后**页面残留陈旧过期内容**：检查块级上下文 key、同步失效清理逻辑、以及贡献指纹比对机制。
- 如果**语法树完全正确但 UI 展示异常**：重点审查自定义组件自身的渲染逻辑及其订阅的 Context 状态。

在向官方反馈流式问题时，请完整提供原始的累积文本帧序列。最终文本完全相同的两个数据流，在中间传输过程中可能会形成完全不同的切片边界；仅凭最终完成的一份文档往往无法复现接缝拼接缺陷。反馈时请附带：插件配置、Schema 配置、自定义预处理器列表、`documentId`、片段到达顺序、以及在传入 `incrementalParse={false}` 时该现象是否依然存在。在测试跨片段协调输出是否等价时，切勿手动关闭 `blockMemo`：因为关闭它会直接改变协调机制内部的执行路径。

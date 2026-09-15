# React 流式传输与性能优化

下文介绍的 `blockMemo` 属性、Hooks 以及性能分析示例均为 React 专属实现。Vue 适配器共享了增量解析引擎与核心流水线/贡献会话，但它并未采用块规划器或 React 的逐块渲染缓存：Vue 将每一帧生成的 HAST 整体转换为 VNodes，并交由 Vue 底层 Patch 算法进行比对。参见 [Vue 指南](../reference/vue.md#component-props) 与 [安装配置](getting-started.md)。

流式传输的本质是在数据持续到达的过程中，高频重复渲染不断增长的 Markdown 文档。Engine 提供了感知末尾追加的预处理与经过验证的增量解析机制；React 适配器则调用共享 core 的块规划器并缓存已渲染的 React 节点。`streaming` 属性主要用于描述生命周期状态；它本身并不负责开启这些性能优化。`blockMemo` 与 `incrementalParse` 在默认配置下均处于开启状态。

本指南详细剖析了各项优化机制所节省的具体开销以及导致其缓存失效的边界条件。同时涵盖了跨片段开销、属性引用稳定性、性能分析以及 Mantine 代码块展示节奏。目标在于帮助你在实际业务负载中准确识别耗时瓶颈，而不是仅仅依据某项开关或单一的历史基准测试数据进行主观推断。

<span id="the-streaming-flag"></span>

## `streaming` 状态标记

```tsx
<AIMarkdown content={chunk} streaming={!done} />
```

`streaming` 是一个纯布尔值，通过 `useAIMarkdownState()` 细粒度 Hook 对外暴露。React 适配器利用该标记来挂载光标插槽并暴露源码尾部标记信号；自定义组件同样可以读取该状态。Mantine 利用它来调度代码块高亮展示节奏并控制图表渲染与语言自动检测。解析器的性能优化门禁则是完全独立的系统。

自 v2 版本拆分 Context 以来，`streaming` 的状态翻转**仅会唤醒 `useAIMarkdownState()` 的订阅者**——读取其他细粒度 Hook（`useAIMarkdownTheme()`、`useAIMarkdownBehaviors()` 等）的组件在流式开始或结束时不会发生重渲染。聚合型的 `useAIMarkdown()` 由于同时订阅了全部五个 Context，在每次翻转时均会触发重渲染；请避免在细粒度的逐块组件中调用它。

<span id="common-uses"></span>

### 常见应用场景

```tsx
import { useAIMarkdownState } from '@ai-markdown/react';

function CodeWithCopy({ children, onCopy }: { children?: React.ReactNode; onCopy: () => void }) {
  const { streaming } = useAIMarkdownState();
  return (
    <div>
      {!streaming && (
        <button type="button" onClick={onCopy}>
          Copy
        </button>
      )}
      <pre>{children}</pre>
    </div>
  );
}
```

- **在流式传输期间隐藏交互控件**——如复制按钮、编辑按钮、展开折叠按钮。流式输出途中的半截代码通常不具备可操作性。
- **展示打字机流式光标**——在部分到达的内容末尾展示光标。光标元素带有 `display: inline-block` 与 CSS 闪烁动画；在 `streaming === false` 时自动卸载。
- **跳过流式中间动画**——例如 Mermaid 图表在流式结束后才淡入呈现，中间帧仅以源码形式渲染。
- **推迟高开销副作用**——产生外部副作用的组件（如埋点上报、路由预加载）可在文本频繁变动时先行跳过。

<span id="what-streaming-does-not-do"></span>

### `streaming` 明确不负责的事情

它**不改变**底层语法解析流水线。相同的 remark/rehype 插件链依然运行，安全清洗规则完全一致。无论 `streaming` 为 true 还是 false，块级缓存均处于激活状态。它不会切换为不同的 Markdown 语法集。受生命周期驱动的 UI（包括光标呈现以及 Mantine 代码块调度）在该标记变动时会相应更新。

---

<span id="blocklevel-memoization"></span>

## 块级缓存缓存（Block-level memoization）

当 `blockMemo` 为 `true`（默认值）时，渲染流水线执行以下步骤：

1. 在单次遍历中将 Markdown 源码统一解析为 **mdast**（Markdown 抽象语法树）与 **hast**（HTML 抽象语法树）。
2. 将 hast 拆分为逐块渲染单元——每个顶层子元素与 mdast 块级节点（段落、标题、代码块、列表、表格等）一一对应，外加可选的合成脚注区域。
3. 记忆化缓存每个块对应的 React 子树，缓存 key 由以下维度组合而成：
   - `raw`（该块对应的源码文本）
   - `occurrence` 出现序号（针对文本完全相同的块——例如多个连续的 `---` 分割线）
   - `ctx` 上下文特征摘要（针对依赖跨块语法的块，如脚注引用与链接定义）
   - `startOffset` 与 `startLine`（源码起始偏移量与行号，防止处于不同位置的相同内容发生错误缓存）

缓存命中时会直接返回已存在的 `ReactNode`，完全跳过从 hast 到 JSX 的转换计算。未变动元素的引用一致性大幅减轻了 React 的 DOM Reconciliation 比对工作，而子组件依然可以通过本地 state、订阅的 Context 或外部 Store 正常更新。其最终渲染输出与关闭该优化时的路径保持**逐字节严格等价**。

<span id="what-invalidates-a-block"></span>

### 导致块缓存失效的因素

| 变更类型                                                   | 影响范围                                              |
| :--------------------------------------------------------- | :---------------------------------------------------- |
| 该块的原始文本发生变动                                     | 仅该块自身失效                                        |
| 该块的位置发生变动（由于前文插入内容导致行号或偏移量位移） | 所有产生位移的后续块（位置信息属于缓存 key 的一部分） |
| `customComponents` 引用发生变动                            | 整篇文档的所有块                                      |
| `urlTransform` 引用发生变动                                | 整篇文档的所有块                                      |
| `sanitizeSchema` 发生深层内容变动                          | 整篇文档的所有块                                      |
| 文档内任何位置新增或删除了脚注/链接/图片定义或引用         | 包含引用/定义的所有块（通过 `ctx` 特征摘要感知）      |
| 普通正文段落块（不含任何引用/定义）                        | 完全不受文档其他位置引用/定义变动的影响               |

最后一项是最核心的性能收益：在一篇末尾带有脚注的长对话中，正文输入**不会**导致末尾脚注块的缓存失效；而在末尾追加新脚注也**不会**导致前文未引用该脚注的纯文本段落缓存失效。

<span id="disabling-block-memoization"></span>

### 关闭块级缓存

显式传入 `blockMemo={false}` 即可关闭：

```tsx
<AIMarkdown content={c} blockMemo={false} />
```

在单文档独立使用场景下，其输出在**结构上完全不变**。但性能会大幅退化为每一帧均全量重跑整条流水线。关闭该特性的适用场景：

- 调试排查——若怀疑自定义的 remark/rehype 插件与块规划抽象层存在罕见冲突，可关闭此项进行验证。
- 不希望在内存中使用基于 `useRef` 缓存的特殊运行环境。
- 对比评估性能开销基准。

在生产环境中处理流式输出时：**请保持默认开启**。

> ⚠️ **跨片段协调必须保持 `blockMemo` 为 `true`。** 当该标记为 `false` 时，渲染器会走旧版路径，该路径**根本没有挂载 `Registry` 跨片段注册表**。在 `<AIMarkdownDocuments>` 内部若设置了 `blockMemo={false}` 会导致特性静默失效——跨片段引用将无法解析，且不会生成整篇文档的汇总页脚。若需要跨片段协调，请保持块缓存处于开启状态（默认开启）。

---

<span id="incremental-parse-prefixfreeze"></span>
<span id="incremental-parse-prefix-freeze"></span>

## 增量解析（前缀冻结机制 Prefix-freeze）

> `incrementalParse` 属性自 v1.8.0 起默认开启（在此之前为实验性可选特性）。该属性仅在 `blockMemo` 为 `true` 时生效。

块级缓存虽然消除了组件树重复转换的开销，但在默认情况下，`unified.parse` 在流式传输的每一帧中依然会对**整篇长文档**执行全量解析——对于万字长文，语法解析与树转换阶段将占据单 Token 耗时的绝大部分（参见下文性能分析）。增量解析正是针对这一瓶颈而设计的：当内容以末尾追加形式增长时（最标准的大模型流式特征），渲染器在经过严格安全性验证的边界处将文档的**稳定前缀冻结**，仅对新增的末尾部分进行局部解析，随后将上一帧保留的前缀语法树与新解析出的末尾语法树进行快速拼接。

```tsx
// On by default — pass `false` only as an escape hatch:
<AIMarkdown content={content} streaming={!done} incrementalParse={false} />
```

<span id="the-freeze-boundary"></span>

### 冻结安全边界的判定规则

安全边界通常取自围栏代码块外部的**最后一行已确认闭合的空行**（必须包含终止换行符——处于文本末尾未换行的半截空行可能仍会接收字符），同时会受到以下语法的防御性拦截阻断：

- **未闭合的原始 HTML 或未闭合的 `<!--` 注释**——未闭合的标签会导致 rehype-raw 将后续的所有兄弟元素错误地认作其子元素，因此前缀文本的稳定并不代表前缀输出的稳定。
- **未闭合的 `$$` 块级数学公式**——remark-math 在遇到闭合定界符之前会持续吞没其间出现的所有空行。
- **列表 / 脚注定义 / 定义列表的延续上下文**——CommonMark 列表不会被单空行甚至双空行切断；后方缩进的代码或文本会追溯性扩展前序列表项。在开启 `definitionList` 插件时，`: 描述` 行能够跨越单个空行将其上方的段落吸收为术语，因此单个空行候选点只有在下一行被确认无法构成 `: ` 语法时才会最终稳定。
- **引用语法污染（Reference taint）**——micromark 解析器在语法解析阶段即完成引用关联：后方出现的 `[label]:`（或 `[^label]:`）定义会使前文原本被当作纯文本的 `[text]` 重新变为超链接。前缀中出现的每一个类似引用的语法结构（链接、图片、脚注），必须在已稳定的定义（其后已跟随空行）中找到匹配归宿，否则不能冻结。标签比对采用 micromark 自身的 Unicode 大小写折叠规范；链接与脚注使用相互独立的命名空间。

语法树拼接流程使用相同的插件链处理末尾片段，并将末尾片段的坐标重新映射回整篇文档的全局坐标系。前缀中已存在的链接/图片定义会被注入到末尾片段前侧，以确保末尾片段中的引用能够正常解析，随后在最终输出中将这些辅助定义安全剔除。**脚注同样支持增量拼接**：脚注的全局编号、页脚出现顺序以及反向链接 ID 在 mdast-util-to-hast 内部属于全文档级全局状态，因此引擎会在末尾片段处理前，按文档顺序重放前缀中的脚注**事件序列**（按出现次数记录的定义与引用）——末尾片段的处理器由此精确还原全局状态并重新生成完整的全文档页脚，随后将页脚中的节点坐标重写回全局坐标系。被安全清洗剔除的前缀节点通过分隔符对齐模型进行处理。测试套件（`spliceEquivalence.test.ts`）严格保证了拼接后的 `{mdast, hast}` 语法树在**包含行列坐标的前提下，与单次全量解析结果保持深度等价**。块缓存的缓存 key 依赖节点位置，因此这两项优化能够配合使用：冻结块在下游继续命中缓存。

**跨片段模式**（`<AIMarkdownDocuments>`）同样支持增量解析：每个片段由注册表驱动生成的幻影定义后缀会被作为末尾输入提供给引擎——追加门禁与边界扫描仅关注片段自身的源码，因此幻影定义的动态波动（兄弟片段流式输出时标签的动态到达与离开）仅会触发末尾的局部重新解析。由幻影定义解析的引用不会被冻结到前缀中（其定义从未出现在当前片段文本内，引用污染标记会将其始终保留在末尾），这从设计原理上保证了幻影后缀波动的安全性。

<span id="automatic-fallback-when-the-flag-does-nothing"></span>

### 自动化安全回退门禁

每一帧渲染均会重新校验门禁链条；任何一项门禁未通过，该帧都会静默平滑回退为标准的全量解析——无论走哪条路径，最终输出完全等价：

| 触发条件                                             | 为什么必须回退                                                                                                                                      |
| :--------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------- |
| 内容变动不属于纯末尾追加                             | 包括阶段 A 的预处理器在流式末尾改写了前文（例如截断了未闭合公式，或自动修补预处理器闭合了 `**粗体`——参见 [内容预处理器](content-preprocessors.md)） |
| 当前尚未形成安全冻结边界                             | 例如整篇文档是一个超大段落、从开头起就存在未闭合的围栏代码块、或存在未配对的孤立引用导致前缀持续被污染                                              |
| 跨越前缀边界的容器内嵌套了定义（如 `> [a]: /url`）   | 无法在保持列坐标精度的前提下原样注入该定义的源码——该帧全量解析                                                                                      |
| 前缀与末尾的 HAST 布局超出了分隔符对齐模型的表达范围 | 防御性安全兜底                                                                                                                                      |
| 插件数组、处理器或 `documentId` 引用发生了改变       | 引擎底层的依赖项发生变动——这比块缓存缓存的失效范围更广                                                                                              |

服务端渲染（SSR）始终走全量解析路径（每次请求的上下文状态均从零开始），因此该优化开关不会改变服务端输出。

<span id="measured-effect"></span>

### 实际性能度量收益

在 Storybook 基准测试载荷下，冻结边界通常能覆盖真实 LLM 流式内容的 73%–87%，将解析与转换开销大幅压缩至仅针对新增尾部的局部计算。在真实浏览器中的实测数据显示：**流水线阶段耗时大幅降低**——在同时开启两项优化的情况下，超大载荷下的 p50 提交耗时显著下降。跨片段协调文档同样具备良好的缩放特性。推荐使用 Storybook 中的 `IncrementalParseCompare` 与 `CrossChunkIncrementalCompare` 对你的业务数据进行实际采样。

<span id="footguns-incremental"></span>

### 增量解析的注意事项

- **冻结边界推进在设计上滞后一帧。** 拼接边界取值为 `min(当前帧边界, 上一帧边界)`——上一帧边界才是等价性性质对上一帧语法树能够确实担保的稳定范围。不要移除该 `min` 判定：上一帧中原本按纯文本渲染的未匹配引用，不能在其定义刚刚到达的瞬间就被错误冻结。
- **未解析的孤立引用会限制边界。** 任何未找到已稳定定义的 `[text]` 或 `[^note]` 会将其下方的所有内容持续标记为污染状态——在其闭合稳定之前，其后方所有内容在每一帧均需局部重新解析。在跨片段模式下，指向外部其他片段的引用会持续保持在末尾未冻结区（因为其定义不会出现在当前片段自身文本中）；这是保证正确性的核心机制而非缺陷——但这确实意味着以跨片段引用开头的片段能够享受的前缀冻结收益相对有限。
- 末尾局部解析的时间复杂度仍与末尾长度成正比；如果一份文档完全不产生空行，系统会自动安全降级为全量解析。
- **超长 GFM 表格存在二次方解析开销，且流式表格属于单个不可分割的块。** 上游表格解析器在每新增一行时均需全量重建内部事件列表，导致解析开销随行数的平方增长。该开销源于上游底层机制。冻结边界无法从内部切断表格，因此在表格流式输出期间，每新增一行都会对整张表格进行重新解析。如果大模型可能输出数百行以上的巨型表格，建议在业务层将其拆分为多条消息、利用 `<AIMarkdownDocuments>` 分片输出、或在前端应用层进行分页。

---

<span id="reference-stability-across-props"></span>

## 属性层面的引用稳定性规范

块级缓存将若干关键 props 视为缓存的核心依赖项。任何一个依赖项发生全新引用变更，都会导致整篇文档的缓存被全量清空：

| 属性名称               | 稳定性防护网（Stability Firewall）策略 | 最佳实践建议                                    |
| :--------------------- | :------------------------------------- | :---------------------------------------------- |
| `content`              | 不在表中——字符串按值比对               | 普通字符串，无需特殊稳定化                      |
| `customComponents`     | `DEEP_EQUAL` 兜底保护                  | 声明在模块顶层作用域或使用 `useMemo` 实现零开销 |
| `contentPreprocessors` | `WARN_ONLY`——函数数组无法进行深度比对  | 声明在模块顶层作用域或提供完备依赖项缓存        |
| `urlTransform`         | `WARN_ONLY`——函数无法进行深度比对      | 声明在模块顶层作用域或提供完备依赖项缓存        |
| `sanitizeSchema`       | `DEEP_EQUAL` 兜底保护                  | **强烈建议**声明在模块顶层作用域                |
| `enginePlugins`        | `DEEP_EQUAL`（数组元素为模块单例）     | 声明在模块顶层作用域                            |
| `metadata`             | `PASS_THROUGH`——刻意豁免检查           | 完全不影响块缓存（位于独立隔离的 Context 中）   |

<span id="the-functionvalued-exception-urltransform-contentpreprocessors"></span>
<span id="the-function-valued-exception-urltransform-contentpreprocessors"></span>

### 函数值例外规范（`urlTransform`、`contentPreprocessors`）

标记为 `WARN_ONLY` 的属性**不存在自动深度比对的安全兜底**。由于闭包函数的内存引用无法通过深度比对判断等价性，在 JSX 中直接书写行内函数 `urlTransform={(url) => …}` 会导致父组件的每一次重渲染都彻底强制清空整个 Markdown 缓存。

```tsx
// ⚠️ Effectively disables block memoization for the whole document.
function MyApp() {
  return <AIMarkdown content={c} urlTransform={(url) => (/^myapp:/.test(url) ? url : '')} />;
}

// ✅ Module scope — stable, cache stays warm.
const URL_TRANSFORM: UrlTransform = (url, key, node) =>
  key === 'href' && /^myapp:/i.test(url) ? url : defaultUrlTransform(url, key, node);
function MyApp() {
  return <AIMarkdown content={c} urlTransform={URL_TRANSFORM} />;
}
```

在开发构建中，若检测到 `WARN_ONLY` 属性频繁发生 3 次以上的引用切换，控制台会输出带有频次限制的 `console.warn` 告警。生产构建中该告警逻辑会被作为无用代码彻底剥除。

---

<span id="the-usestablevalue-hook"></span>

## `useStableValue` 辅助 Hook

```ts
function useStableValue<T>(value: T): T;
```

通过与上一帧渲染的值进行深度内容比对（基于 lodash `isEqual`），返回一个引用保持稳定的值。若内容相等则复用旧引用；仅在内容确实改变时才更新引用。

当无法在父组件层面上缓存复杂对象属性、又希望阻断下游不必要的重复渲染时，可以使用该 Hook：

```tsx
import { useStableValue } from '@ai-markdown/react';

function MyChat({ rawMeta }: { rawMeta: ChatMeta }) {
  const stableMeta = useStableValue(rawMeta);
  // stableMeta keeps the same reference across renders as long as rawMeta is deep-equal.
  return <AIMarkdown content={c} metadata={stableMeta} />;
}
```

开销说明：每次渲染均会执行一次深层比对。对小型对象开销极低；对超大状态树开销较大。切勿盲目滥用——若上游引用本身已经保持稳定，直接使用即可。

---

<span id="streaming-patterns"></span>

## 流式架构模式选型

两种主流架构方案，命名完全对齐 [流式聊天端到端实战](streaming-chat-example.md)：

<span id="approach-a-single-aimarkdown-with-growing-content"></span>

### 方案 A——单实例 `<AIMarkdown>` 承载递增内容

```tsx
function GrowingMessage({ content, done }: { content: string; done: boolean }) {
  return <AIMarkdown content={content} streaming={!done} />;
}
```

逻辑更精简且性能通常更优——单一组件实例、单一缓存池、无多余包装。当你能在 `<AIMarkdown>` 上游完全掌控文本拼接且无需对片段进行虚拟列表滚动时，**除非有明确的业务分片诉求，否则请始终优先选用此方案**。

<span id="approach-b-chunked-with-aimarkdowndocuments"></span>

### 方案 B——多片段分片配合 `<AIMarkdownDocuments>`

```tsx
<AIMarkdownDocuments>
  {chunks.map((chunk, i) => (
    <AIMarkdown key={i} content={chunk} documentId={messageId} streaming={!done && i === chunks.length - 1} />
  ))}
</AIMarkdownDocuments>
```

每个片段维护独立的块缓存缓存。跨片段引用通过 [`<AIMarkdownDocuments>`](cross-chunk-coordination.md) 自动协同。适用于消息虚拟滚动列表、服务端按业务切片输出独立消息、或每个片段需要绑定专属独立元数据的场景。

<span id="variant-streaming-cursor"></span>

### 衍生方案：流式打字机光标

```tsx
import AIMarkdown, { AIMarkdownStreamingCursor } from '@ai-markdown/react';

function StreamingMessage({ content, done }: { content: string; done: boolean }) {
  return <AIMarkdown content={content} streaming={!done} streamingCursor={AIMarkdownStreamingCursor} />;
}
```

`streamingCursor` 插槽允许在 `streaming === true` 期间在内容末尾渲染指定的光标组件，并在流式结束时安全卸载。内置的 `AIMarkdownStreamingCursor` 借助底层物理 DOM 测量将指示器精准定位在**最后一个已渲染字符的右侧**——Markdown 源码、底层解析流水线以及块缓存缓存均完全不受任何触碰，因此增量解析能够维持其末尾追加门禁，光标的闪烁不会导致任何块缓存失效。

详细规范参阅 [流式光标指南](streaming-cursor.md)。对本文档而言最重要的性能契约在于：光标插槽组件基于引用进行比对（请在模块顶层作用域定义），且光标为解析/缓存流水线带来的额外计算开销为零。

> ⚠️ **严禁在 `content` 字符串末尾手动拼接光标字符**（如历史旧文档中曾提及的 `content + '▍'` 模式）。这会在每一帧中彻底破坏增量解析——`c1 + '▍'` 变成 `c1 + delta + '▍'` 永远不再构成严格的末尾追加，导致引擎每一帧均被迫回退为昂贵的全量解析——且该字符极易掉落进尚未闭合的数学公式或代码块内部，导致语法结构被破坏。

---

<span id="profiling"></span>

## 性能分析与性能度量

在对页面进行性能分析时，请清晰区分以下三个离散阶段：

1. 语法解析与树转换——全量解析回退时针对全文本，增量拼接命中时仅针对未冻结的活跃尾部。
2. 遍历 mdast/hast 构建块规划——开销与块的数量成正比。
3. 缓存未命中的块转换为 React 元素，随后触发 React 协调更新与浏览器重排重绘。

这是全量解析基准模型，而非当前的全部开销模型。增量解析能将（1）压缩至活跃尾部，保留前缀规划能减少（2）中的重复工作。顶层遍历、部分引用上下文遍历、预处理、注册表通知、React 框架层开销以及浏览器布局依然存在。若文档中存在一个持续增长的单一超大段落，大部分文本仍会停留在活跃尾部中。

若性能分析显示 `<AIMarkdown>` 成为耗时瓶颈：

1. 首先排查 `customComponents`、`urlTransform`、`sanitizeSchema`、`enginePlugins`、`contentPreprocessors` 是否均已声明在模块顶层或保持引用稳定。行内匿名对象/函数是性能退化最常见的原因。
2. 在保持块缓存开启的前提下，优先对比关闭 `incrementalParse={false}` 时的表现。仅将 `blockMemo={false}` 作为独立的诊断手段：因为关闭它会连带关闭增量解析与协调机制，同时改变了多个变量。
3. 使用 React DevTools Profiler 进行录制——若组件树中绝大多数块显示为“Did not render（未重新渲染）”，说明缓存机制运作良好。

<span id="builtin-stage-timing-dev-builds-only"></span>

### 内置阶段耗时度量（仅限开发构建）

在开发环境下，块缓存渲染路径在每次内容更新时均会针对流水线的各个阶段输出 [`performance.measure`](https://developer.mozilla.org/docs/Web/API/Performance/measure) 指标：

```
ai-markdown:stage:scan       # incremental-parse boundary detector (only when
                             # incrementalParse routes through the engine)
ai-markdown:stage:parse      # unified.parse — full document, or TAIL-ONLY when
                             # incremental parsing spliced this frame
ai-markdown:stage:transform  # remark/rehype transformer run (same full/tail split)
ai-markdown:stage:build      # block-plan construction
ai-markdown:stage:render     # per-block render with cache lookup
```

这为排查耗时瓶颈提供了直观精确的数据依据。两种官方支持的查看方式：

- **浏览器开发者工具 Performance 面板**：录制性能分析；指标会清晰展示在 User Timing 泳道中。无需任何额外代码配置——开发环境下始终自动输出。
- **通过代码创建 `PerformanceObserver` 监听**：过滤监听 `entryTypes: ['measure']`，并按 `ai-markdown:stage:` 前缀过滤。

需要注意的传递语义：每个度量条目在输出后会**立即从全局 User Timing 缓冲区中清理移除**，确保缓冲区体积不会因高频渲染而无限膨胀。已经就绪注册的监听器依然能按队列完整接收到每一个事件，但在控制台中后置执行 `performance.getEntriesByType('measure')` 将无法看到历史记录——请在流式开始前先行挂载监听器。生产构建中完全不输出该度量，仅保留单次极轻量的布尔检查。

<span id="validating-output-equivalence"></span>

### 验证输出的严格等价性

若怀疑开启 `blockMemo` 导致渲染输出与未开启时产生差异，可运行代码库内置的 `byteEquivalence.test.tsx` 测试套件，该套件针对每一种插件排列组合严格断言生成的 HTML 逐字节一致。任何不一致均属于需要修复的 Bug。

---

<span id="footguns"></span>

## 常见问题

<span id="perrender-closureasprop"></span>

### 在渲染函数内临时创建闭包并作为 prop 传递

前文已在 `urlTransform` 章节重点阐述。该反面模式对任何携带引用身份的 prop 均完全适用：

```tsx
import AIMarkdown, { type AIMarkdownCustomComponents, type AIMDContentPreprocessor } from '@ai-markdown/react';
import { highlight, pangu } from '@ai-markdown/react/plugins';

// ⚠️ All of these are new objects/functions every render.
function Bad({ content }: { content: string }) {
  return (
    <AIMarkdown
      content={content}
      customComponents={{
        a: ({ href, children }) => (
          <a href={href} className="link">
            {children}
          </a>
        ),
      }}
      contentPreprocessors={[(c) => c.trim()]}
      enginePlugins={[highlight, pangu]}
    />
  );
}

// ✅ Hoist — define once at module scope.
const Link = ({ href, children }: { href?: string; children?: React.ReactNode }) => (
  <a href={href} className="link">
    {children}
  </a>
);
const trim: AIMDContentPreprocessor = (c) => c.trim();

const COMPONENTS: AIMarkdownCustomComponents = { a: Link };
const PREPROCESSORS: AIMDContentPreprocessor[] = [trim];
const PLUGINS = [highlight, pangu];

function Good({ content }: { content: string }) {
  return (
    <AIMarkdown
      content={content}
      customComponents={COMPONENTS}
      contentPreprocessors={PREPROCESSORS}
      enginePlugins={PLUGINS}
    />
  );
}
```

虽然 `useStableValue` 深度比对能为 `customComponents` 提供兜底保护——但深度比对本身同样消耗时间，且 `urlTransform` 完全不具备此类兜底。

<span id="disabling-blockmemo-as-a-perf-fix"></span>

### 误以为关闭 block-memo 能“修复性能”

当页面卡顿时，部分开发者的直觉反应是关闭 block-memo 试试看。事实证明：

- 对于流式传输内容，关闭它只会让渲染**变得更慢**，不会变快。
- 真正的性能元凶几乎总是某个在行内临时分配的对象引用。
- 仅在排查语法结构正确性问题时才考虑临时关闭 `blockMemo`。

<span id="building-a-giant-single-block-document"></span>

### 构造没有空行的单块长篇文档

块级缓存的收益来自于将整篇文档细分为若干个细小局部的独立缓存。如果文本是一篇完全没有空行的巨型单一长段落（在 CommonMark 规范中仅算作单个块），系统将无从进行分块，记忆化机制将无法发挥作用。尽管真实大模型输出几乎必定包含多段落结构，但在病态输入下，单帧开销将完全被解析阶段主导。

<span id="mistaking-streaming-for-an-in-progress-signal-that-pauses-rendering"></span>

### 误将 `streaming` 当作推迟渲染的暂停信号

`streaming === true` 并不会推迟或暂停渲染。内容在到达时会立刻呈现。该标记仅用于同步生命周期状态并控制关联的辅助 UI。若需要缓冲批量投递，请在上游使用带有最大等待阈值的批量刷新队列，并在流结束时立即排空；切勿在持续输入下使用无上限的防抖（Debounce），那会导致渲染被无限期推迟。如需视觉层面的平滑匀速打字机呈现，请使用 [平滑流式组件](smooth-streaming.md)，它将数据源完成与视觉呈现完成清晰解耦。

<span id="mantine-code-display-cadence"></span>

## Mantine 代码块的高亮展示节奏

常规的流式代码块会通过 `codeBlock.highlightIntervalMs`（默认 50 ms）对追加内容的高亮更新进行节流合并。首帧到达、静态固定文本、流结束、整段替换以及语言变更均会立刻绕过等待瞬时呈现。进行中的定时器不会因后续持续追加而被无限后推，因此持续的数据输入依然能稳定推进呈现。将该间隔设置为 0 可在每次更新时立即高亮；非法或负数值会自动回退至默认配置。Mermaid 代码块使用单独且更长的间隔 `codeBlock.mermaidIntervalMs`（默认 300 毫秒），因为每次尝试都是一次同步的图表布局；流结束后最终源码必定渲染一次。主线程繁忙或标签页处于后台时定时器触发可能会有所延迟，因此该间隔属于调度目标，而非绝对的物理硬延迟承诺。

复制代码控件读取的是最新的未经格式化的原始源码，独立于屏幕上展示的高亮快照。每个代码块仅保留其最新的一次高亮结果，按代码文本、语言、配色方案以及高亮器函数引用进行缓存；外层适配器 Provider 的重渲染因此不会触发重复的高亮计算。适配器或主题变动依然会导致该缓存失效。Mermaid 图表则保持其专有的串行渲染队列。

包含引用的保留前缀块如今支持复用其块规划。当包含引用时，末尾规划会使用全文档级的引用上下文，确保全局编号与引用序号准确无误。原始 HTML 与定义依然采用保守的全量规划。这有效减少了逐块规划的重复开销；而全文档上下文遍历与顶层数组遍历依然存在。

<span id="separate-performance-from-delivery-semantics"></span>

## 理清性能优化与数据投递语义的界限

请始终将完整累积的源文本作为 `content` 传入。若网络端依次接收到三段切片 `"Hel"`、`"lo"` 和 `" world"`，渲染器应当依次接收到 `"Hel"`、`"Hello"` 和 `"Hello world"`。如果每次仅传入最新的一小段增量切片，这在语义上属于整体替换，而非末尾追加流。同理，动态变动的 React key 会导致组件实例彻底卸载并清空全部缓存，即便传入的文本是严格追加的也无济于事。

当数据更新频率远超显示器的物理刷新率时，在应用层进行批量节流合并是一种合理的优化策略。它通过微小的实时性折损换取更少的渲染次数；块级缓存并不能替代这一上游考量。建议同时度量端到端延迟与流水线耗时，并在网络传输结束时立刻投递最终的完整累积内容。面对持续活跃的数据流，切勿使用无边界的防抖。

平滑流式呈现有意在网络数据到达之间插入额外的视觉渲染步骤。其前缀通常符合增量解析条件，但依然需要具备安全的冻结边界。超长的未闭合代码块、较早出现的未解析引用、或改写文本的预处理器可能会使渲染帧持续走全量路径。“纯末尾追加”仅是第一道安全门禁，并不保证整帧渲染必定在常数时间内完成。

<span id="a-repeatable-investigation"></span>

## 性能排查步骤

1. 完整记录各依赖包版本以及累积文本切片的精确序列。保留替换与结束事件。
2. 在组件与配置引用均保持稳定的基准下，度量默认的单文档渲染耗时。
3. 仅关闭 `incrementalParse`，在保留块缓存与协调机制的前提下，单独观测增量解析带来的收益。
4. 针对单文档独立输出，单独对比 `blockMemo={false}`。切勿将该对比误当成跨片段协调模式下的通用性能开关。
5. 利用内置的阶段耗时度量工具分析解析/转换/规划/JSX转换各阶段的耗时分布，随后在真实的生产构建中审查浏览器布局与交互响应表现。
6. 使用完全相同的帧序列复测渲染结果的正确性。以丢失内容为代价换取的渲染提速属于严重的缺陷故障。

[历史基准测试速查表](benchmark.md) 记录的是特定开发构建下的对比实验。[浏览器基准测试套件](../../../../benchmarks/README.md) 测量的是生产构建产物，且包含明确的节流节奏与测量约束。两者均不代表通用的绝对帧率保证，也不证明所有开销均严格与最新到达的单个 Token 成正比。

<span id="context-and-cache-boundaries"></span>

## Context 与缓存的作用域边界

全新的元数据引用仅会唤醒元数据使用方，不会导致解析与块缓存缓存失效。全新的 `urlTransform` 函数引用会导致整篇文档的渲染缓存失效，即便函数体看似完全一样。全新的预处理器数组引用会触发预处理链重跑，但若最终产出的原始字符串值未变，下游的记忆化缓存依然能安全存留。更换插槽组件类型会导致整棵子树被彻底销毁并重新挂载，而非仅是单个块级缓存失效。

请使用 `useStableRecord` 理解这些策略规范，而非试图用它掩盖真实的业务状态变动。`DEEP_EQUAL` 仅在内容确实深度相等时复用先前的引用；它无法挽救每次重新创建的组件函数。`WARN_ONLY` 仅用于诊断引用的频繁切换，不会修改引用。`PASS_THROUGH` 则让不透明的元数据直接透传。请确保自定义渲染器内部的高开销计算均基于其实际核心输入完成了 `useMemo` 记忆化，并让组件的 Context 订阅范围尽可能保持最小化。

# React 文档与引用协调

下方的示例与注册表 Hook 针对 React 环境展开。Vue 提供了其专有的 `AIMarkdownDocuments` 和 `AIMarkdown`，采用相同的显式文档 ID 模型，但不包含 React 专有的注册表 Hook 或 Provider 级的孤立引用策略覆盖。详见 [Vue 指南](../reference/vue.md#multiple-chunks-in-one-document)与[包安装配置](getting-started.md)。

一个逻辑 Markdown 文档可以分散在多个 `<AIMarkdown>` 实例中进行展示：例如，多个独立更新的回答章节，它们需要共同引用文末的同一组参考文献。每个渲染器各自解析其收到的 Markdown。当它们共享一个显式且非空的 `documentId` 时，`<AIMarkdownDocuments>` 容器负责在它们之间建立引用定义与脚注编号的关联。

这是一个**引用协调层**，而非用于拼接任意切断的网络传输数据的解析器。对于常规的聊天界面，请将 SSE 或网络 Token 增量累积为单个完整字符串。仅当每个片段都是结构完整的 Markdown 语法单元时才使用多渲染器分块：一个代码围栏、段落、表格或强调语法无法在组件 A 中开启却在组件 B 中闭合。

```tsx
import AIMarkdown, { AIMarkdownDocuments } from '@ai-markdown/react';

interface Message {
  id: string;
  chunks: { id: string; markdown: string }[];
}

function StreamedMessage({ message }: { message: Message }) {
  return (
    <AIMarkdownDocuments>
      {message.chunks.map((chunk, index) => (
        <AIMarkdown key={chunk.id} content={chunk.markdown} documentId={message.id} documentIndex={index} />
      ))}
    </AIMarkdownDocuments>
  );
}
```

该容器使得分块 A 中的脚注引用能够找到后续分块 B 中的定义，并让链接与图片引用能够解析由其他分块提供的定义。如果不使用该容器，未解析的引用语法会遵循常规的独立 Markdown 行为，通常保留为字面纯文本；它不会自动变成空链接，也不会凭空消失。

请保持 `blockMemo` 开启（默认即为开启）。跨片段协调完全建立在该渲染路径之上；如果设置了 `blockMemo={false}`，系统会退化为传统的独立渲染路径，从而失去共享编号、引用解析以及汇总脚注区。

## 何时需要使用

| 业务场景                                                               | 是否使用 `<AIMarkdownDocuments>`？                                           |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 每个逻辑文档使用单个 `<AIMarkdown>` 实例（绝大多数非流式应用）         | **否** — 增加额外开销且无实际收益                                            |
| 每条聊天消息使用单个 `<AIMarkdown>` 实例，引用全部在消息内部闭环       | **否**                                                                       |
| 流式消息被拆分为多个 `<AIMarkdown>` 实例（每个均为完整 Markdown 单元） | **是** — 且需要在各个分块间传入相同的 `documentId`                           |
| 同一页面上存在多条不同的消息，各消息拥有各自独立的内部引用             | **否** — 自动生成的 `documentId` 命名空间已足以避免不同消息间的 HTML ID 碰撞 |
| 某个概念上的文档在视图上被切分（折叠面板、虚拟列表行）                 | **是** — 前提是引用关系跨越了这些切分边界                                    |

---

## `documentId` 命名规范

`documentId` 为容易引起碰撞的 HTML 属性（如 `id="…"`、`href="#…"`）提供了**命名空间**。它具备双重语义：

1. **在单一文档内部**：前缀确保脚注反向链接与正文锚点能够准确跳转。
2. **在同一页面的不同文档之间**：互不相同的前缀能够防止消息 A 的 `<a href="#fn-1">` 误跳转到消息 B 的 `<li id="fn-1">`。

当你把分块包裹在 `<AIMarkdownDocuments>` 内部并传入相同的 `documentId` 时，容器会以该 ID 为键分配一个共享的 `Registry` 注册表，各个分块从而能够观察到彼此发布的定义贡献。

### 超长 ID 自动哈希缩写

如果你传入的是 UUID 或 Nanoid 等长字符串（超过 16 字符），库内部会通过 MurmurHash3 → Base62 对其进行哈希压缩，以保持渲染出的 HTML 简洁：

```text
documentId="550e8400-e29b-41d4-a716-446655440000"
  → state.documentId is the raw value
  → state.clobberPrefix becomes "Abc123-user-content-" (≤6-char hash)
  → registry keying uses the raw value
```

这种缩短仅仅是针对**渲染出的 HTML DOM 属性**所做的处理。`useDocumentRegistry(documentId)` 和 `state.documentId` 观察到的始终是原始完整字符串，因此深层链接与注册表交互完全不受影响。

### 自动生成的 ID

如果省略了 `documentId`，库会调用 React 的 `useId()` 自动生成一个。这在 SSR 服务端渲染下是安全的，并在同一实例的多次重渲染间保持稳定。不同的 `<AIMarkdown>` 实例会获得不同的 ID——这在独立渲染模式下正是你所需要的，但在跨片段流式分块模式下**绝非**你所期望的。

> **最常见的使用错误**：将分块包裹在 `<AIMarkdownDocuments>` 中，却忘记传入共享的 `documentId`。自动生成的 ID 只能为独立 HTML 提供防冲突命名空间；省略 `documentId` 会使渲染器主动脱离共享注册表。必须显式传入相同的 ID 才能加入协调；传入空字符串或 null 同样代表脱离协调。

---

## 哪些内容会被跨片段协调

系统在两个命名空间中协调三类引用。脚注拥有独立的标签命名；链接与图片则共享 Markdown 的链接定义命名空间：

| 引用类型 | Markdown 语法                             | 是否支持跨片段协调？                                  |
| -------- | ----------------------------------------- | ----------------------------------------------------- |
| 脚注     | `[^label]` + `[^label]: text`             | ✅ 全局编号、正向链接 href、反向链接 href、汇总脚注区 |
| 链接引用 | `[click][label]` + `[label]: url "title"` | ✅ 目标 URL 与 title 属性解析                         |
| 图片引用 | `![alt][label]` + `[label]: url "title"`  | ✅ 目标 URL 与 title 属性解析                         |

**行内链接**（`[click](https://…)`）与**行内图片**（`![alt](https://…)`）无需任何协调——它们在行内直接携带了 URL。注册表仅针对引用样式（Reference-style）的标记起效。

脚注区**只会在整篇文档的最后一个分块末尾渲染一次**，集中汇总来自所有分块的定义。单个分块内部不会生成孤立的局部脚注区——容器内部的 `AggregateFootnotesIfLast` 组件能够自动识别当前分块是否为最后一个分块，并在其末尾输出完整的脚注列表。如果分块顺序发生变化（例如流式期间某些分块动态卸载或重新挂载），汇总脚注区会自动跟随转移到新的“最后一个”分块下方。

定义在整篇文档中全局可见，无论写在何处。嵌套写在脚注正文中的链接定义或脚注定义（例如 `[^a]: 参见 [x]`，下方缩进书写 `[x]: /url`）会像顶层定义一样被注册表捕获并向外广播，因此兄弟分块中的 `[x]` 能够成功解析。脚注正文是从分块的渲染输出中采集的，并以脚注列表项 `<li id>` 所携带的相同编码 ID 片段为键，因此包含非 ASCII 字符或百分号转义的标签（如 `[^中文]`、`[^a%41]`）在汇总脚注区中能够完好保留其正文内容。系统仅会采集自动合成的脚注区：作者在 Markdown 中手写的原生 `<section data-footnotes>` 属于普通正文内容，不会被采集成脚注定义。

仅在另一个脚注正文中被引用的嵌套脚注，遵循独立编号规则：它的编号排在所有行内正文引用之后，按照汇总脚注区渲染引用它的正文的先后顺序排列，并展示在汇总脚注区对应的位置。这种嵌套引用并非普通的行内标记，因此不会被计入 `getRefsForLabel` 的引用次数，也不会生成按次序的编号反向链接；脚注区仅为其生成一个基础反向链接。

---

## `<AIMarkdownDocuments>` 属性配置

| 属性                       | 类型        | 默认值 | 用途说明                                                                                                                                                                                                                                                    |
| -------------------------- | ----------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preserveOrphanReferences` | `boolean`   | `true` | **无条件覆盖**每个分块自身的 `preserveOrphanReferences` 属性。当为 `true` 时，孤立的 `[^label]: …` 定义（暂未找到匹配的 `[^label]`）会受到保护，不被 `mdast-util-to-hast` 静默丢弃。这对流式至关重要——因为对应的引用标记可能稍后才会在后续分块中到达。      |
| `smoothTurnTaking`         | `boolean`   | `true` | 容器级的平滑流式轮流开关：共享该 `documentId` 的 `<AIMarkdownSmoothStream>` 分块会按照挂载顺序依次逐个打字展开。设为 `false` 则全局关闭门禁拦截（所有分块各自独立展开）。详见[平滑流式 → 轮流呈现](smooth-streaming.md#multi-chunk-documents-turn-taking)。 |
| `children`                 | `ReactNode` | —      | 需要进行协调的一组 `<AIMarkdown>` 实例                                                                                                                                                                                                                      |

```tsx
<AIMarkdownDocuments preserveOrphanReferences={true}>{children}</AIMarkdownDocuments>
```

注意：容器上的 `preserveOrphanReferences` 属性**优先级高于**各个分块自身的同名属性。这是刻意设计的：容器级策略通常需要在整组分块中保持一致。

### 嵌套容器：开发环境抛错 / 生产环境降级

```tsx
// Dev: throws an error immediately.
// Prod: console.errors, renders children, inner wrapper is a no-op.
<AIMarkdownDocuments>
  <AIMarkdownDocuments>{children}</AIMarkdownDocuments>
</AIMarkdownDocuments>
```

这种区分是故意的——在开发阶段尽早暴露错误，在生产环境下保证页面容错可用。切勿嵌套容器；若遇到偶发的嵌套协调作用域，外层容器永远是其下所有节点的唯一权威。

---

## 读取注册表：`useDocumentRegistry`

```ts
function useDocumentRegistry(documentId: string | undefined): Registry | null;
```

返回值说明：

- 当且仅当 (a) 处于 `<AIMarkdownDocuments>` 容器内部，且 (b) `documentId` 非空时，返回共享的 `Registry` 实例。
- 其他情况下返回 `null`——在业务中应作为“走独立渲染路径，无协调”处理。

> ℹ️ **该 Hook 可能会分配作用域，但不会注册或发布分块**。在渲染期间调用 `useDocumentRegistry(documentId)` 可能会创建一个空的注册表对象。容器使用 `WeakRef` 进行缓存，因此并发渲染以及持有该对象的已挂载组件能够共享同一引用，而被放弃的废弃渲染不会让该对象被容器强引用常驻。垃圾回收器能够自动回收未使用的外壳；终结器（Finalizer）会清理其过期的缓存键，且不会误删该 ID 下的新建作用域。已注册的分块仍通过显式的微任务延迟释放进行及时注销。GC 回收时机与引用解析或注册的正确性无关。

```tsx
import { useDocumentRegistry, defaultUrlTransform } from '@ai-markdown/react';

function BacklinkPanel({ documentId, label }: { documentId: string; label: string }) {
  const registry = useDocumentRegistry(documentId);
  if (!registry) return null;

  const def = registry.resolveLinkDef(label);
  if (!def) return <span>(unresolved: {label})</span>;

  // ⚠️ def.url is the RAW destination from the contributing chunk — the
  // registry does not sanitize. Run your own policy (here the library's
  // default allowlist) before rendering it as an attribute; a chunk can
  // define `[evil]: javascript:alert(1)`.
  const href = defaultUrlTransform(def.url, 'href', { type: 'element', tagName: 'a', properties: {}, children: [] });
  return (
    <a href={href || undefined} title={def.title}>
      {label}
    </a>
  );
}
```

### `Registry` 接口说明（只读）

| 字段 / 方法                                         | 返回值类型                                     | 用途说明                                                                                                                                                                              |
| --------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chunkOrder`                                        | `readonly symbol[]`                            | 按 `documentIndex` 排序的分块标识符列表，挂载顺序作为回退/平局决胜依据                                                                                                                |
| `chunkData`                                         | `ReadonlyMap<symbol, ChunkData>`               | 每个分块贡献的引用/定义/链接映射表                                                                                                                                                    |
| `labelSet`                                          | `{ footnoteLabels, linkLabels }` (ReadonlySet) | 所有分块中自身定义的标签全集                                                                                                                                                          |
| `version`                                           | `number`                                       | 单调递增的版本号计数器，每次注册表变更时递增                                                                                                                                          |
| `subscribe(cb)`                                     | 退订函数                                       | 监听整个注册表的任意变更                                                                                                                                                              |
| `subscribeLabel(kind, label, cb)`                   | 退订函数                                       | 监听经过规范化处理的单个 `link` 或 `footnote` 标签的选择器变更；链接与图片共用 link 监听通道                                                                                          |
| `canonicalFootnoteFor(label)`                       | `symbol \| null`                               | 查询哪个分块拥有该脚注标签的权威定义                                                                                                                                                  |
| `canonicalLinkFor(label)`                           | `symbol \| null`                               | 查询哪个分块拥有该链接标签的权威定义                                                                                                                                                  |
| `globalNumber(label)`                               | `number \| null`                               | 查询该脚注标签在全文档范围内的统一编号                                                                                                                                                |
| `resolveLinkDef(label)`                             | `LinkDef \| null`                              | 跨分块查询链接定义                                                                                                                                                                    |
| `getRefsForLabel(label)`                            | `number`                                       | 统计全篇文档正文流动文本中指向该标签的**脚注**引用标记数量。在另一脚注正文中出现的引用（`RefRecord.nestedIn`）会被编号但不计入该计数；链接/图片引用不参与计数（不存在类似计数器 API） |
| `globalOccurrenceForRef(chunkSym, label, localIdx)` | `number \| null`                               | 将分块局部的引用索引映射为全文档范围内的全局出现序号                                                                                                                                  |

变异修改方法（`registerChunk`、`allocateSymbol` 等）被刻意**排除**在公开的 `Registry` 类型之外。这些方法仅供内部渲染器驱动；若暴露给用户代码，可能会破坏引用计数、版本递增以及编号的不变性。

### 哪些内容没有被暴露

以下内部实现细节被刻意隐藏在公共 API 之外：

- **分块自身的 `Symbol`**：每个分块在注册表内部都会分配一个独一无二的 `Symbol`。不存在用于从自定义组件读取当前分块 Symbol 的 Hook。如果你需要分块维度的特定行为，请结合 `useAIMarkdownDocument().documentId` 与自身的业务逻辑进行推导。
- **分块级 URL 策略 / 跨分块 URL 清洗上下文**：跨分块占位符会在内部使用当前使用分块的 `urlTransform` 与 `sanitizeSchema` 独立运行每个属性的 URL 转换。该机制属于内部细节；你只需为各个 `<AIMarkdown>` 传入属性，而无需介入跨分块协调底层。
- **`Registry` 上的变异方法**：如上所述，公共表面仅暴露选择器、`subscribe` 以及 `subscribeLabel`。

如果你发现自己需要这些内部细节，正规途径通常是通过公开 API（`documentId`、`metadata`、`urlTransform`、`sanitizeSchema` 以及 `Registry` 的公共选择器）来实现相同目标。如果公开能力确实无法满足业务场景，欢迎提 Issue 说明用例。

### 响应式读取注册表 <a id="reactively-reading-the-registry"></a>

`Registry` 的变更发生在 React 的常规渲染流程之外。如果需要让组件在注册表变更时重新渲染，请通过 `useSyncExternalStore` 进行订阅：

```tsx
import { useSyncExternalStore } from 'react';
import { useDocumentRegistry, type Registry } from '@ai-markdown/react';

function useRegistryVersion(registry: Registry | null): number {
  return useSyncExternalStore(
    (cb) => (registry ? registry.subscribe(cb) : () => {}),
    () => registry?.version ?? 0,
    () => 0 // Server and hydration start before contribution effects.
  );
}

function FootnoteCount({ documentId }: { documentId: string }) {
  const registry = useDocumentRegistry(documentId);
  useRegistryVersion(registry); // re-render when version bumps
  return <span>{registry?.labelSet.footnoteLabels.size ?? 0} footnotes</span>;
}
```

### 实战示例：基于 `resolveLinkDef` 构建引用面板

在侧边栏中渲染所有跨分块链接引用及其最终解析出的 URL——可用于查看引用出处或展示归属信息：

```tsx
import { useSyncExternalStore } from 'react';
import { useDocumentRegistry, defaultUrlTransform } from '@ai-markdown/react';

// urlTransform's third argument is the hast node; a minimal stand-in is fine.
const A_NODE: Parameters<typeof defaultUrlTransform>[2] = {
  type: 'element',
  tagName: 'a',
  properties: {},
  children: [],
};

function BacklinkPanel({ documentId, labels }: { documentId: string; labels: string[] }) {
  const registry = useDocumentRegistry(documentId);
  useRegistryVersion(registry);

  if (!registry) return null;

  return (
    <aside>
      <h3>References</h3>
      <ul>
        {labels.map((label) => {
          const def = registry.resolveLinkDef(label);
          if (!def) return <li key={label}>{label} — unresolved</li>;
          // ⚠️ def.url is RAW — the registry stores destinations unsanitized
          // and the library's placeholders sanitize at render time. Do the
          // same here (correct key for the attribute you render) — see the
          // url-sanitization docs.
          const href = defaultUrlTransform(def.url, 'href', A_NODE);
          return (
            <li key={label}>
              <a href={href || undefined} title={def.title}>
                {label}
              </a>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
```

### 实战示例：按标签显示脚注编号角标

为指定标签渲染全文档范围内的统一脚注编号（例如在引用 Tooltip 旁展示 `[3]`）：

```tsx
function FootnoteBadge({ documentId, label }: { documentId: string; label: string }) {
  const registry = useDocumentRegistry(documentId);
  useRegistryVersion(registry);
  const n = registry?.globalNumber(label) ?? null;
  return n === null ? null : <sup>[{n}]</sup>;
}
```

`globalNumber` 能够解析跨越所有分块的统一序号——因此即使同一个标签在不同分块中被多次引用，角标展示的编号也绝对一致。

### 实战示例：统计单个标签的引用次数

`getRefsForLabel(label)` 返回全篇文档正文流动文本中指向该标签的**脚注**标记总数（写在其他脚注内部的嵌套引用除外）。可用于展示“该脚注被引用了 N 次”等状态：

```tsx
function FootnoteUsage({ documentId, label }: { documentId: string; label: string }) {
  const registry = useDocumentRegistry(documentId);
  useRegistryVersion(registry);
  const n = registry?.getRefsForLabel(label) ?? 0;
  return <span>{n === 0 ? 'unused' : `cited ${n}×`}</span>;
}
```

链接/图片引用没有对应的计数器 API——如需此类统计，可自行遍历 `registry.chunkData` 进行汇总。

---

## 流式接入模式

跨分块协调文档与[流式聊天端到端指南](streaming-chat-example.md)和[流式渲染与性能指南](streaming-and-performance.md)中使用相同的模式划分（方案 A = 累积模式，方案 B = 分块模式）。本文优先介绍方案 B，因为该模式才真正需要跨分块协调。

### 方案 B：每个逻辑分块对应一个 `<AIMarkdown>`（分块模式）

```tsx
function StreamedMessage({ chunks, id, done }: { chunks: string[]; id: string; done: boolean }) {
  return (
    <AIMarkdownDocuments>
      {chunks.map((chunk, i) => (
        <AIMarkdown
          key={i}
          content={chunk}
          documentId={id}
          documentIndex={i}
          streaming={!done && i === chunks.length - 1}
        />
      ))}
    </AIMarkdownDocuments>
  );
}
```

注意：通常仅有**最后一个**分块的 `streaming` 为 `true`。先前的分块已经完成终结。

### 方案 A：在同一个 `<AIMarkdown>` 上更新累积内容（累积模式）

```tsx
function GrowingMessage({ content, done }: { content: string; done: boolean }) {
  return <AIMarkdown content={content} streaming={!done} />;
}
```

无需任何外层容器包装——全程只有单一实例。块级记忆缓存（Block-level Memoization）会自动最小化重渲染开销；整个文档视为单一逻辑大块。当你在数据上游能够控制内容拼接时，这是**更加推荐且轻量**的模式。

### 进阶变体：分块结合虚拟化列表

引入虚拟化滚动会改变当前实际挂载的分块集合。`documentIndex` 只能维持**当前已挂载**分块的相对顺序；它无法保留已卸载分块的定义、引用或编号。因此，当承载某个定义的分块随滚动离开挂载窗口时，指向它的引用可能会重新变为未解析状态，而全局汇总脚注区则归属于当前挂载的最后一个分块，而非完整数据集的最末项。

仅在应用生命周期契合上述特征时才使用虚拟化。请尽量保持包含关键定义的分块常驻挂载，或者在全文档必须随时可被跳转导航时保持完整渲染器挂载。仅仅预留一个数字索引并不能弥补已卸载正文的缺失。

对于虚拟列表的一行，渲染器层面的接入契约如下：

```tsx
function DocumentRow({ id, index, markdown }: { id: string; index: number; markdown: string }) {
  return <AIMarkdown content={markdown} documentId={id} documentIndex={index} />;
}
```

外层的虚拟化容器负责管理滚动监听、总高度撑开占位、行绝对定位测量以及稳定的组件 key。请将单个 `<AIMarkdownDocuments>` 放置在所有已挂载行的外层。虚拟行的 React key 应当能够标识逻辑分块（即使它发生物理位移）；`documentIndex` 则描述其当前在文档中的位置次序。

默认情况下，注册表顺序取决于挂载顺序。已释放的分块若稍后重新挂载，若没有额外信息，会被直接追加到注册表末尾，从而可能导致其脚注与脚注区跑到文档中间。传入稳定的 `documentIndex` 能彻底解决此乱序问题。带有索引的分块总是排在无索引分块之前；遇到相同索引或无索引时，按挂载时间排序。建议始终提供一致的索引以确保排序完全可控。

平滑流式输出的轮流呈现维护自身独立的挂载顺序队列。`documentIndex` **不会**改变平滑打字动画的排队次序；详见[平滑流式输出](smooth-streaming.md#chunks-inserted-out-of-mount-order)。

## 生命周期：分块如何向注册表登记

分块的注册与贡献发布属于 Commit 阶段的 Effect。渲染阶段仅用于准备 AST 语法树与贡献数据；只有在 Effect 执行发布之后，其他渲染器才能观察到它们。

1. 渲染器根据当前显式的文档 ID 获取注册表，并在注册生命周期中分配自身分块的身份 Symbol。该 Symbol 与该注册表紧密绑定，因此切换文档 ID 不会将旧 Symbol 误发布到新的 Store 中。
2. 注册阶段向外发布分块自身声明的定义标签以及可选的 `documentIndex`。这些标签信息使其他分块能够立即识别那些后续才能解析的引用标记。
3. 贡献 Effect 发布解析后的引用明细、链接定义以及处理后的脚注正文。贡献指纹比对机制会跳过未修改的写入；父组件的无害重渲染不会对底层 Store 产生任何变动。
4. 组件清理函数会递减该 Symbol 的引用计数。实际的删除操作会推迟至微任务队列中，并在执行时二次校验计数——这兼容了 React 19 严格模式在开发环境下的 Effect“清理/重新执行”循环，确保复用同一个存活条目。
5. 最后一个已注册分块释放后，会触发注册表的空闲回调，将其从外层容器的映射表中彻底移除。后续重新挂载会启动全新的文档注册表。从未注册过分块的推测性空外壳采用弱引用缓存，一旦没有渲染或组件引用它们就会被垃圾回收。

汇总脚注区与引用占位符会订阅最终生成的 Store。标签级订阅能够避免在无关引用的 URL 或编号未变动时唤醒组件；而全文档级别的视图仍然需要全局订阅。两者的区别详见下文的通知分发机制。

### 服务端渲染与客户端首帧水合

在服务端，React 的 Effect 不执行。因此每个分块完全按照**独立模式**的语义渲染：本地定义的引用在本地解析，本地脚注标记与其局部的脚注列表保持一致。仅存在于其他分块中的定义此时不可见，对应的引用在服务端输出阶段保持为未解析状态。

客户端首轮渲染从完全相同的空注册表开始，从而严格保证水合一致（Hydration Agreement）。首轮水合渲染完全不读取任何注册表状态，因此即使分块分散在不同的 `<Suspense>` 边界内且某些边界在兄弟节点已完成 Commit 注册后才开始水合，一致性依然成立：晚水合的分块仍然会产生与服务端相同的 HTML 字节，而不会过早生成已被解析的引用导致 React 抛出水合不匹配警告。水合彻底完成后，Effect 开始执行注册与贡献发布，此时引用会根据文档顺序解析到权威定义，脚注获得全局统一编号，局部脚注区退让给全局汇总脚注区。纯客户端渲染流程遵循相同的两阶段逻辑（省略水合比对）：首帧提交呈现独立模式输出，Effect 运行后立即平滑升级为协调解析后的完整形态。如果服务端生成的 HTML 必须包含跨分块完全解析后的内容，请将完整字符串传给单个渲染器，而不要寄希望于在服务端运行 Effect。

## 避坑指南

### 忘记在分块间共享 `documentId`

```tsx
// ⚠️ Each chunk auto-generates its own id → no coordination.
<AIMarkdownDocuments>
  {chunks.map((c, i) => <AIMarkdown key={i} content={c} />)}
</AIMarkdownDocuments>

// ✅ Share the id.
<AIMarkdownDocuments>
  {chunks.map((c, i) => <AIMarkdown key={i} content={c} documentId={messageId} />)}
</AIMarkdownDocuments>
```

### 共享了 `documentId` 却省略了 `<AIMarkdownDocuments>` 容器

```tsx
// ⚠️ Same documentId across instances, but no <AIMarkdownDocuments> → references still don't coordinate.
{
  chunks.map((c, i) => <AIMarkdown key={i} content={c} documentId={messageId} />);
}
```

外层容器是把各个分块绑定在一起的关键载体。单独传 ID 仅能统一步调，无法共享注册表实例。

### 原地修改注册表返回的对象

```tsx
// ⚠️ Mutating a returned LinkDef.
const def = registry?.resolveLinkDef('docs');
if (def) def.url = '...'; // shared across all consumers; corrupts other components

// ✅ Treat registry-returned data as read-only.
const def = registry?.resolveLinkDef('docs');
const myUrl = def?.url; // read only
```

TypeScript 类型层面已标记为 `readonly`，但在运行时 JavaScript 不具备强约束，请自觉遵守。

### 期望 `Registry` 在渲染期间“瞬间”更新

注册表是通过分块挂载/渲染后的 Effect 修改的，执行时机**晚于**触发该次渲染的 Commit 阶段。如果在首次渲染期间直接调用 `registry.canonicalFootnoteFor(label)`，即便定义确实存在也可能会返回 `null`——因为承载该定义的分块的 Effect 尚未执行。请通过上文介绍的 `useSyncExternalStore` 进行响应式订阅，在注册表就绪后触发更新。

### 传入不稳定的 `documentId`

```tsx
// ⚠️ A new id every render → registries pile up.
<AIMarkdown content={c} documentId={`msg-${Date.now()}`} />

// ✅ Stable id per logical document.
<AIMarkdown content={c} documentId={message.id} />
```

虽然容器能够自动清理空注册表，但每次渲染都进行创建/注销的性能开销极大，且每次递增的 `version` 会让所有订阅组件持续陷入无谓的重渲染。

### 嵌套 `<AIMarkdownDocuments>` 容器

如上所述——开发环境直接抛错，生产环境静默降级。请不要嵌套。

### 标签通知路由分发机制

占位符采用 `subscribeLabel` 并读取标量快照，而非盲目监听注册表的每一次全局广播。链接观察者仅在其权威拥有者、目标 URL 或标题发生变更时被唤醒。脚注观察者仅在权威拥有者、编号、引用次数或分块局部出现区间发生变更时被唤醒（包含因前方插入了新脚注而引发的间接重编号）。标签的规范化规则与选择器保持一致。

每个微任务在派发任何回调之前，都会先将待观察的标签与当前最新的有序索引进行比对。监听相同标签的多个占位符共享此项比对计算。无净变动的更新不会派发标签回调；全局 `subscribe` 仍会监听每一个变异批次，这对于读取原始分块数据、脚注正文列表以及全局汇总视图是必需的。注销最后一个监听者会同步移除该标签组。重建索引和比对被订阅标签本身仍有轻微开销；该机制消除的是无关组件的回调广播风暴，而非消除了全文档扫描。

## 协调集成的验证清单

在集成测试中，请覆盖常规流程以外的边界情况：在引用标记之后才追加定义文本、动态编辑已有定义的 URL 或标题、在前方插入新的脚注、删除权威定义、以及携带原有的 `documentIndex` 重新挂载分块。测试共享相同标签的链接引用与图片引用（二者共用链接命名空间）。验证不同的文档 ID 之间不会发生定义泄露。

对于自定义注册表读取组件，在依赖后续贡献前务必建立订阅监听。首个 `BacklinkPanel` 示例仅展示了 URL 的查询提取；在实际业务中应配合完整侧边栏示例中的 `useRegistryVersion` 以支持实时热更新。`defaultUrlTransform` 为手动构建的链接提供了库内置的默认安全策略；但它无法自动推导任意外部使用分块的自定义架构或转换逻辑。

实现源码参考：[文档容器](../../../../packages/react/src/components/AIMarkdownDocuments.tsx)、[注册表](../../../../packages/engine/src/components/documentRegistry.ts) 与 [渲染生命周期](../../../../packages/react/src/components/MarkdownContent.tsx)。

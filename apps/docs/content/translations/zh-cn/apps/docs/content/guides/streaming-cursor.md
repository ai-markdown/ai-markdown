# React 流式光标

以下介绍的组件插槽 API 为 React 专属设计。Vue 默认通过布尔属性 `streamingCursor` 开启光标，并通过 `cursor` 插槽进行自定义，详见 [Vue 指南](../reference/vue.md#cursor-behavior)与[包安装配置](getting-started.md)。

`streamingCursor` 是一个用于展示“正在生成中”视觉状态的组件插槽。React 适配器仅在 `streaming` 为 `true` 时将其挂载到排版容器内部。导出的 `AIMarkdownStreamingCursor` 会在最后一个支持的文本锚点之后定位一个浮层指示器，并在数据传输停顿期间持续播放动画。

```tsx
import AIMarkdown, { AIMarkdownStreamingCursor } from '@ai-markdown/react';

function StreamingMessage({ content, done }: { content: string; done: boolean }) {
  return (
    <div aria-busy={!done}>
      <AIMarkdown content={content} streaming={!done} streamingCursor={AIMarkdownStreamingCursor} />
    </div>
  );
}
```

请确保 `content` 始终为实际累积的 Markdown 源文本。光标完全独立于解析器的输入，因此用户复制文本、提取代码以及解析器的增量追加判定，获取到的都是最原始纯净的内容。内置指示器无需单独导入样式表文件。当流式结束时，该插槽会自动卸载；当页面尾部不存在受支持的文本锚点时，即便流式仍处于活跃状态，光标也会安全隐患。

对于平滑流式外壳，内层的流式状态会一直保持活跃直至排空动画结束。而对于尚未产生第一个字符的初始响应，请在 Markdown 组件外部渲染等待占位状态。

## 为什么不能直接追加光标字符？

曾经很常见的做法是：在流式生成期间直接传入 `content={content + '▍'}`。这种做法现在被明确视为具有破坏性：

1. **它会在每一帧彻底破坏增量解析**。[前缀冻结引擎](streaming-and-performance.md#incremental-parse-prefix-freeze)的追加门禁要求每一帧的内容必须是上一帧的纯粹追加。`c1 + '▍'` 变为 `c1 + delta + '▍'` 绝不是纯追加（因为上一帧的 `▍` 被移除并在新位置重新添加），导致每一帧都静默退化为全量重新解析。
2. **光标字符会破坏对源文本敏感的语法结构**。在尚未闭合的 `$$` 数学公式块内部，它会导致 KaTeX 解析报错；在流式代码块或 Mermaid 图表内部，它会污染图表源码（文本提取渲染器会将其读入）。
3. **它会在每一帧使最后一个块的记忆缓存（Memo Cache）失效**，即便实际正文内容根本没有变化。

`streamingCursor` 从架构设计上彻底杜绝了这三个问题：Markdown 源码、解析管线和块级缓存完全不受干扰。光标纯粹存在于 DOM 渲染层。

## 运行机制

整个系统分为三层，将定位机制与视觉呈现解耦：

1. **插槽层**（`<AIMarkdown>` 上的 `streamingCursor?: ComponentType` 属性）：React 适配器仅在 `streaming === true` 时，将传入的组件渲染在内容之后——包裹在排版容器以及两个 Context Provider 内部。该插槽不注入任何额外属性，仅控制组件挂载的**时机**与**位置**。与 `Typography` 类似，该属性按引用进行相等性比对：**请在模块作用域定义它**。

2. **定位外壳**（`<AIMarkdownStreamingCursor />`）：一个高度为 0 的绝对定位浮层，负责在渲染后的内容中查找最后一个文本节点（通过白名单 DOM 遍历），使用 Range API 测量最后一个字符的物理尺寸（具备 UTF-16 代理对感知，能正确测量 Emoji 尾部），并通过命令式位移将绝对定位的容器直接放置在该字符正后方。重新定位由三个在绘制前触发的信号驱动：内容根节点上的 MutationObserver（监测 Token 到达、尾部块结构变形）、ResizeObserver（监测容器排版重排）以及 `document.fonts.ready`（监测字体加载替换）——这使得光标能够自适应内容与几何布局的变化，无需将 x/y 坐标存入 React 状态触发重渲染。具体的观察器与绘制时机取决于浏览器。移动的是像素而非 DOM 节点：光标永远不会进入文本流，全选复制不会抓取到它。

3. **指示器**（最终的视觉元素）：可通过外壳的 `indicator` 属性进行替换，遵循包含三个字段的契约接口（详见[自定义指示器](#custom-indicators)）。

### 默认指示器

一个闪烁的小圆点，尺寸与当前行高自适应（在标题行更大，在正文行更小）。在内容超过 **5 秒**没有发生任何 DOM 变动后，小圆点会平滑淡出并转为双色旋转圆环——提示“连接依然活跃，但当前流似乎停顿了”；一旦收到新 Token，圆环立即恢复为闪烁圆点。对于集成方而言的关键实现细节包括：

- 纯 CSS 动画（仅使用 opacity 与 transform，不触发布局重排），在网络停顿期间持续动画且**重渲染次数为 0**。
- 关键帧动画通过 `useInsertionEffect` 在每个 Document 的 `document.head` 中仅注入一次；多个并发流式消息共享同一个 `<style>` 标签。
- 标记有 `aria-hidden="true"`——详见[可访问性](#accessibility)。
- 遵循 `prefers-reduced-motion: reduce`：禁用闪烁、旋转与平滑过渡；仅保留静态的圆点或圆环以明确区分两种状态。

## 光标何时会隐藏

光标的展示判定极为克制：如果当前内容的尾部无法安全锚定光标，光标会在这些帧中主动隐去，并在尾部重新出现文本时恢复（下一次变动会重新触发探测）。以下情况会主动隐藏光标：

| 尾部所处状态                                              | 隐藏原因                                                                                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 代码块 / 行内代码（`pre`, `code`）                        | 这些元素被故意排除在锚点之外；代码渲染器可能自行接管滚动，或将源码替换为不同的展示结构。光标浮层本身不会向代码源码中注入文字 |
| KaTeX 数学公式（`.katex`）                                | 无确定文本位置的生成标记结构                                                                                                 |
| SVG 矢量图（已渲染的 Mermaid 图表）                       | 非普通文本节点                                                                                                               |
| 原始 HTML 解析产生的未知元素                              | 白名单遍历机制——遇到未知 DOM 结构不会深入探索                                                                                |
| 空元素（最后一个节点为 `hr`, `br`, `img`）                | 没有可以跟随其后的文本字符                                                                                                   |
| 内容为空（第一个 Token 到达之前）                         | 尚无任何文本——如需展示等待状态，请在 `<AIMarkdown>` 旁边渲染自定义占位组件                                                   |
| 竖排书写模式（Vertical writing modes）                    | 暂不支持                                                                                                                     |
| 尾部正处于链接引用定义中（如末尾正流式接收 `[label]: …`） | 该语法本身不渲染任何可见内容，没有可供吸附的字形                                                                             |
| 尾部处于脚注定义中，且该脚注的底部区域位于另一个分块中    | 在跨片段文档协调模式下，汇总的脚注区归属于最后一个分块；光标无法且不应当跨 DOM 跨组件定位到另一个分块中                      |

其他所有常规元素——段落、标题、列表项、表格单元格、引用块、定义列表及行内格式化文本——均可正常锚定。

### 定义感知锚定（2.2.1+）

内容尾部的判定基于 **mdast** 语法树，而非仅仅反向搜索 DOM。当流式接收的文本属于脚注定义（如 `[^n]: 这里是脚注正文…`）时，光标会跟随进入脚注区域：它会吸附在局部或全局汇总脚注区中该脚注对应的 `<li>` 内部，使闪烁字形准确出现在新字符实际渲染的位置。嵌套定义会解析至最深层子节点——定义内部嵌套的另一个定义会在其独立的 `<li>` 中渲染。当脚注定义结束重新开始普通正文段落时，光标会自动返回正文尾部。

## 自定义指示器 <a id="custom-indicators"></a>

定位外壳负责探测与绝对定位；指示器负责绘制像素。你可以在不重复实现任何定位逻辑的前提下替换视觉样式：

```tsx
import AIMarkdown, { AIMarkdownStreamingCursor, type AIMarkdownStreamingIndicatorProps } from '@ai-markdown/react';

function MyIndicator({ height, width, lastMutationAt }: AIMarkdownStreamingIndicatorProps) {
  // height/width: rendered size (px) of the last character — match the line.
  // lastMutationAt: performance.now() timestamp of the last content change —
  // derive your own stall styling from it if you want one.
  return <span style={{ display: 'block', width: 3, height, backgroundColor: 'currentColor' }} />;
}

// Module scope — both bindings must be referentially stable.
const MyCursor = () => <AIMarkdownStreamingCursor indicator={MyIndicator} />;

<AIMarkdown content={content} streaming={!done} streamingCursor={MyCursor} />;
```

属性契约规范：

- `height` / `width` — 锚点字符的测量尺寸，具备相等性短路：仅当测量尺寸发生变化时才会触发更新。不同的字形、字体或布局可能会改变尺寸；相等性检查可以避免无谓的重复渲染。
- **垂直居中由指示器自身负责**。定位外壳将其持有器顶部与锚点字符的边框盒顶部对齐；如果指示器的高度小于 `height`，它默认会渲染在行顶，除非自身进行居中调整——例如对于高度为 `size` 的小圆点，可设置 `marginTop: Math.round((height - size) / 2)`（默认指示器正是如此处理的）。与行高同高的元素（如上方示例中的竖条）则无需任何额外偏移。
- `lastMutationAt` — 每个变动批次更新一次，因此相关的 DOM 变动批次可以更新指示器。DOM 变动批次与传输层 Token 并非严格的一对一关系。指示器属于叶子组件，此项开销微乎其微——正是借助这一属性，普通的 `useEffect` 即可轻松实现停顿计时，无需复杂的订阅机制。
- 坐标位置（x/y）**不属于**该属性契约。坐标随每个 Token 变化，且必须与内容更新呈现在同一帧内，因此由外壳通过命令式样式直接操作。自定义指示器本身无需关心自身的具体绝对坐标。

## 细节行为说明

- **RTL 文本方向**：锚定侧遵循锚点段落的计算 `direction` 样式——在 RTL（从右向左）文本中，光标会自动吸附在最后一个字形的视觉左侧。混排文本按段落独立判定。
- **祖先节点的 `transform: scale`**（如进入动画、缩放容器）：外壳会自动计算并补偿缩放比；暂不支持祖先节点的旋转（rotate）与斜切（skew）变换（可能导致短暂停留偏差，在下一次变动时自愈）。
- **SSR 服务端渲染**：外壳在服务端仅输出一个无样式的不可见容器——真实的测量必须依赖浏览器 DOM。不会引起水合不一致，也没有视觉跳动。
- **多片段文档模式**（`<AIMarkdownDocuments>`）：通常只需将 `streamingCursor` 传给正在追加内容的活动片段（通常是最后一个）。插槽只要在 `streaming === true` 时就会挂载；如果将其传给非末尾片段，光标会出现在文档中间该片段的尾部。除非正处于脚注定义流中（见上方定义感知锚定），探测器会自动跳过汇总脚注区，确保光标始终标记正文结尾而非附录；若正处于流式接收中的脚注定义由另一片段呈现其底部列表，光标会在这些帧中安全隐藏。
- **停顿检测时钟**：内容根节点下的任何 DOM 变动（光标自身的变动除外）均计为活跃——Mermaid 图表重新绘制或跨片段脚注区重渲染均会重置 5 秒停顿计时。该信号代表“当前消息仍在活动”，而非狭义的“收到了新 Token”。

### 可访问性 <a id="accessibility"></a>

视觉光标标记为 `aria-hidden`——闪烁的字符对于屏幕阅读器而言纯属杂音，且每次光标位置变动都触发朗读会带来极差的体验。“正在生成中”的语义应当放置在你的**消息外层容器**上：在生成期间设置 `aria-busy="true"`（或维护带有 `role="status"` 的区域）。本库不会主动向正文树中注入动态区域行为。

```tsx
<div aria-busy={!done}>
  <AIMarkdown content={content} streaming={!done} streamingCursor={AIMarkdownStreamingCursor} />
</div>
```

## 已知边界限制

- **Shadow DOM 与 iframe 宿主**：默认指示器的关键帧样式注入在 `document.head` 中；Shadow Root 无法直接继承该样式，而通过 Portal 挂载进 iframe 会将样式错误注入父级文档。这两种情况下，请改用自带内联样式的自定义指示器（外壳本身不含外部样式，在任何环境中均可正常定位）。
- **仅修改属性导致的排版重排盲区**：若仅修改 class 或 style 导致文本换行，而没有发生 childList 或 characterData 变动，此时不会触发 MutationObserver 回调——光标会短暂停留在旧位置，直到下一个 Token 到达时自愈。本库有意未开启开销巨大的 `attributes: true` 监听。
- **末行刚好占满整行宽度**：行内光标本身不占用任何排版空间；当最后一行文本恰好填满容器宽度时，真实的行内文字本该换行，而浮层光标会暂时被限制在容器边缘。此现象极为短暂（偏差 ≤ 几个像素，持续几帧），在下一次文本换行时自动恢复。

## 避坑指南

### 在 JSX 中内联定义插槽组件

```tsx
// ⚠️ New component identity every render — the slot unmounts/remounts each time,
// resetting detection state and the stall clock.
<AIMarkdown streamingCursor={() => <AIMarkdownStreamingCursor indicator={MyIndicator} />} ... />

// ✅ Module scope.
const MyCursor = () => <AIMarkdownStreamingCursor indicator={MyIndicator} />;
<AIMarkdown streamingCursor={MyCursor} ... />
```

### 因为“代码块内需要显示光标”而回退到 `content + '▍'`

直接向内容末尾追加字符确实可以在代码块内部强行显示光标（内置光标在代码块中会主动隐藏）。但如果这种视觉效果比解析管线的完整性更重要，你必须清楚其中的代价：每一个流式传输帧都会退化为全量重新解析（增量解析被永久关死），且该字符很可能会在中途破坏数学公式和 Mermaid 图表。代码块内主动隐藏光标是经过深思熟虑的设计权衡，而非疏漏。

### 期望在首个 Token 产生前展示等待状态

内容为空时不存在任何可供锚定的文本，因此在首个字符到达前光标会保持隐藏。首个 Token 到达前的加载动画应在业务组件中通过简单的条件渲染实现——参见[端到端流式聊天示例](streaming-chat-example.md)——自行管理加载动画不仅逻辑清晰，还能自由控制其摆放位置（如头像旁、气泡内），这本身也是行内光标无法做到的。

### 在指示器中包裹过大的文本流元素

指示器渲染在一个高度为 0、带有 `pointer-events: none` 的浮层中。如果你在自定义指示器中渲染了较大尺寸的元素（如文本标签、工具栏），它会直接遮挡锚点行下方的文字——定位外壳**不会**预留排版占位空间。请保持指示器为字形大小；任何尺寸更大的组件都应放置在 `<AIMarkdown>` 外部。

## 配合自定义排版容器使用

外壳通过其 DOM 父节点来定位渲染出的正文内容。请确保在正文与光标兄弟节点外层保留一个真实的包裹容器；使用 Fragment 或设置 `display: contents` 会破坏几何尺寸计算的假设前提，即便普通 Markdown 看起来渲染正常。保持光标处于相同的内容作用域内，并避免在 Markdown 之后紧接着放置工具栏，以免尾部遍历时将其误认为是文档正文。

在验证光标定位时，建议测试以下用例：跨行折行段落、标题到段落的过渡、RTL 文本、末尾带有 Emoji 表情、异步字体加载以及流式接收中的脚注。同时应当验证设计上的主动隐藏状态：空文本、代码块内部、数学公式中以及末尾为图片的情形。在这些状态下光标隐藏并不代表请求已结束；消息的状态 UI 负责向用户传递连接状态。

内置的停顿计时器测量的是内容根节点下的 DOM 活动，而非传输层的物理连接健康状况。请通过应用层请求状态来处理超时报错、取消与重试；5 秒超时圆环无法替代正规的业务错误处理。

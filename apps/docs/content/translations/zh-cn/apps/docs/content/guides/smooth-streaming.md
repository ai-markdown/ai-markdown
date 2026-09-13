# React 平滑流式输出

以下示例基于 React Hooks 与组件插槽展开；底层的引擎控制器完全独立于前端框架。Vue 提供了同名的组合式函数，支持传入响应式 getter 并返回计算 ref，详见 [Vue 指南](../reference/vue.md#smooth-streaming-and-turn-taking)与[包安装配置](getting-started.md)。

模型输出往往成批到达，例如先收到 40 个字符，停顿 300 毫秒后再收到几批。直接显示会让文字一段段跳出。平滑流式把接收和显示分开：应用继续传入累积的 Markdown，控制器按到达节奏逐字展开。

```tsx
import { AIMarkdownSmoothStream, AIMarkdownStreamingCursor } from '@ai-markdown/react';

<AIMarkdownSmoothStream
  content={message.markdown}
  streaming={message.pending}
  streamingCursor={AIMarkdownStreamingCursor}
/>;
```

`<AIMarkdownSmoothStream>` 接受 `<AIMarkdown>` 的全部属性，并增加 `smoothPacing`、`onSmoothDrained`、`smoothCoordination` 和 `smoothWaiting`，详见 [API 参考](#api-reference)。它仍使用基础组件渲染，只是传入按节奏展开的 `content`，因此插件、自定义组件、URL 过滤和文档协调沿用原有行为。

## 与增量解析配合

内容展开可以做到每秒 60 帧（每个动画帧更新一次），其频率远高于网络数据包的到达频率。展开过程中的每一个前缀依然是累积的 Markdown 字符串，因此共享的解析管线可以复用已冻结的前缀块和先前规划好的块结构，只对尾部可变部分进行增量解析。

这种机制让平滑输出在面对绝大多数长文档时都切实可用，但这并不意味着每一帧的计算开销都严格等于 O(新字符数)。某些帧仍可能扫描或解析较长的未冻结尾部；遇到中间编辑或复杂语法嵌套时也会触发全量解析。块规划器需要遍历文档的顶层块，而引用、内联 HTML 或脚注定义则需要跨块的上下文。除了解析本身，React 自身的协调重渲染、自定义组件渲染、语法高亮、浏览器排版布局与 DOM 观察器同样需要消耗计算资源。

内置的 LaTeX 预处理器和跨片段定义扫描器均具备针对追加内容的增量状态。在基准测试中，1.5 万字符的高密度数学公式流式追加时，有状态路径每次追加约耗时 20 微秒，而无状态路径约耗时 2 毫秒（此数据基于特定测试用例，不构成通用渲染预算）。用户传入的 `contentPreprocessors` 会在解析前接收完整的当前可见字符串；全字符串变换可能会成为单帧的主要开销，即便解析器已复用了前缀。

建议保持 `blockMemo` 和 `incrementalParse` 开启，稳定预处理器的输入，并针对具体的实际消息特征进行性能分析。若存在大量跨片段协调的兄弟组件，还需要考虑注册表级别的订阅开销；文末的避坑指南详细说明了为何局部标签订阅只能消除部分开销。

## 节奏控制原理

控制器为当前积压内容估算一个显示截止时间，目标是在下一批数据到达前显示完。它通过滑动窗口记录到达间隔（包含停顿），取高分位数估算下一次间隔；连续两次较慢的到达即可调整节奏。

- **流式接收阶段**：截止时间被锚定在最后一次到达时间之后的一个**预期窗口**（`horizon = bufferFactor × 预期时间间隔`，加上几帧冗余，且不超过预设的 `maxLagMs`），此时 `速率 = 待展示积压字符量 / 距离截止时间的剩余时间`。积压量与剩余时间同步减少，因此**在同一个到达周期内速率是恒定的**：面对粗粒度数据流（例如代理层缓冲了 2 秒才推送一次的 SSE 数据），页面表现为一个匀速打字机，落后实际接收大约半个周期平稳输出，而不是“喷涌一团然后停滞很久”。控制器还设有一个极小的防冻结下限速率，只要有未显示的内容就始终保持可见的推进。
- **遇到网络停顿无需特殊处理**：超过最大延迟上限的间隔会直接让 horizon 达到上限饱和，不会做出过度减速的决策——`maxLagMs` 限制了控制器规划的调度周期上限，但如果浏览器后台切标签挂起动画帧或主线程被阻塞，该参数无法保证物理时钟延迟。上限参数是按需生效的：细粒度、低延迟的数据流拥有自己紧凑的节奏窗口，完全不会触及该上限。
- **流式接收结束阶段**：截止时间窗口按保证速率连续性来计算：尾部内容以大约当前测得速率的两倍速度展开，并限制在 `[drainMs, 3 × drainMs]` 之间。控制器瞄准这个明确的截止时间推进，而不是无休止地渐近收尾。截止时间到达时的下一个调度帧即完成全部内容的展开；后台标签页节流或主线程繁忙可能会延后该帧的触发。

通过 `smoothPacing` 选择以下三个预设，在显示延迟与连贯性之间取舍：

| 预设                 | 窗口 (Horizon)     | 最大延迟 (Max lag) | 适用场景与权衡                                             |
| -------------------- | ------------------ | ------------------ | ---------------------------------------------------------- |
| `smooth`             | 约 1.7 × 到达间隔  | 3.5 秒             | 在服务器推送之间预留更多缓冲时间，对粗粒度推送吸收能力最强 |
| `balanced`（默认值） | 约 1.0 × 到达间隔  | 2.5 秒             | 以较小延迟为 2.5 秒以内的到达间隔提供均匀节奏              |
| `responsive`         | 约 0.45 × 到达间隔 | 0.8 秒             | 延迟最低；面对粗粒度或突发到达时会出现可见的停顿           |

平滑输出的经验法则：使用 `balanced` 或 `smooth`（`bufferFactor ≥ 1`）时，到达间隔在 `maxLagMs` 范围内的网络流，能以大约间隔时间一半的稳定延迟匀速播放。如果推送间隔超过该上限，控制器会匀速展开当前块然后等待下一块——此时最合理的解决方案是让传输层更频繁地 flush，而不是无限制加大前端缓冲。

高级宿主可以通过 `createSmoothStreamController` 传入具体的数值参数（缓冲倍数、时间常数、排空预算）——详见 `SmoothStreamPacingParams` 与导出的 `SMOOTH_STREAM_PACING_PRESETS` 预设包。预设属性支持运行时动态读取：在流式生成中途切换预设会即时平滑调整节奏，无需重置控制器。

展开以字素簇为单位，使用 `Intl.Segmenter` 保留代理对、组合字符和 Emoji ZWJ 序列。缺少该 API 时会回退到代码点，仍能保护代理对，但组合字符和 Emoji 序列可能分步显示。流式输入期间会暂留最后一个字素，等后续内容确认边界或数据源结束后再显示，避免切开尚未接收完整的序列。

## 数据结束与显示结束

传入的 `streaming` 表示数据源是否仍在生成。内部渲染器会在积压文字尚未显示完时继续保持 `streaming === true`，让光标跟随可见文本；显示完毕后才跟随输入状态。`onSmoothDrained` 只在实际经历积压的一轮显示完成后触发，初始静态内容和直接替换不属于这样的轮次。

## 与封装层配合使用

组件封装了 `useSmoothStream`。Hook 的返回值可以直接展开为基础组件或自定义包装器的属性：

```tsx
import { useSmoothStream } from '@ai-markdown/react';
import MantineAIMarkdown from '@ai-markdown/react-mantine';

function ChatMessage({ markdown, pending }: { markdown: string; pending: boolean }) {
  const smooth = useSmoothStream({ content: markdown, streaming: pending });
  return <MantineAIMarkdown {...smooth} />;
}
```

返回值中还包含一个函数引用稳定的 `flush()` 方法，用于实现“跳过打字动画”功能：

```tsx
const { flush, ...props } = useSmoothStream({ content, streaming });
return (
  <>
    {props.streaming && <button onClick={flush}>Skip</button>}
    <AIMarkdown {...props} />
  </>
);
```

（直接解构展开时不显式移除 `flush` 也没有问题——基础组件会自动忽略未知属性。）`flush()` 同样严格遵循字素边界保护：只要数据源流仍处于打开状态，它会立即展开所有已确认的字素，并与常规动画一样暂留末尾可能不完整的字素；后续追加的文本或传入 `streaming={false}` 会将其确认并呈现在屏幕上。

## 多片段文档：轮流呈现 <a id="multi-chunk-documents-turn-taking"></a>

在 `<AIMarkdownDocuments>` 容器内部，共享相同 `documentId` 且启用了平滑输出的片段会自动进行跨片段协调（自 2.2.0 起）：所有以空内容挂载的片段会**按照组件挂载顺序轮流呈现**——即片段 N 必须彻底完成（源传输结束且展开动画排空）之后，片段 N+1 才会开始展开。整个文档就如同一台打字机配有一支光标，即便后台数据源是并发推送的。

```tsx
<AIMarkdownDocuments>
  <AIMarkdownSmoothStream documentId={id} content={a} streaming={aLive} />
  <AIMarkdownSmoothStream documentId={id} content={b} streaming={bLive} />
</AIMarkdownDocuments>
```

在自定义包装器中，可使用 `useDocumentSmoothStream` 为平滑流式增加轮流呈现：

```tsx
const smooth = useDocumentSmoothStream({ documentId: id, content, streaming });
return <MantineAIMarkdown {...smooth} documentId={id} />;
```

行为机制说明：

- **空内容挂载的片段会等待轮到自己。** 已有文本的片段在挂载时直接显示，不会清空或重播，适用于水合、虚拟列表滚回和流式中途重挂载。这类片段仍占据队列位置，后面的空内容片段需要等它完成。
- **等待中的片段不显示文字或光标。** 轮到自己后按正常节奏展开积压内容，目标时长为 `drainMs` 到 `3 × drainMs`，还受动画帧调度影响；`drainMs` 本身不是最大时长。
- **完成后不会重新阻挡后续片段。** 已完成片段再次收到流式内容（例如下一轮工具调用）时，不会隐藏已经开始显示的后续内容。
- **卸载会释放队列位置。** 后续片段不再等待已卸载的片段。
- **不同的 `documentId` 维护彼此独立的排队队列**——两个并发流式输出的不同文档各自拥有独立的打字机与光标。跨文档强制串行并不属于设计范围。
- 可以通过在外壳组件上设置 `smoothCoordination={false}` 单独关闭某个片段的协调（或改用普通 `useSmoothStream` / 在 Hook 中省略 `documentId`）；也可以在 `<AIMarkdownDocuments>` 上设置 `smoothTurnTaking={false}` 全局关闭轮流机制。对正在被门禁拦截的片段关闭协调会立即解除拦截——如果此时它的数据源已经结束，所有累积文本会在单帧内瞬间呈现（瞬显快照而非动画）。这种单帧闪现是预期内的降级效果：因为一旦退出协调机制，就失去了排队调度的基准。

## 在 React 之外使用

节奏控制核心是 `createSmoothStreamController`——这是一个不依赖 React 甚至不依赖 DOM 的纯 TypeScript 对象，可用于非 React 宿主环境或将来的其他框架绑定：

```ts
import { createSmoothStreamController } from '@ai-markdown/react';

const controller = createSmoothStreamController({ pacing: 'balanced' });
controller.update(''); // Initialize empty if the first append should animate.
const unsubscribe = controller.subscribe(() => render(controller.getVisible()));
render(controller.getVisible()); // subscribe does not emit the initial snapshot.
socket.on('token', (accumulated) => controller.update(accumulated));
socket.on('done', () => controller.finish());
// On host teardown: remove socket listeners, unsubscribe(), controller.dispose().
```

生命周期规范要点（导出模块包含完整 JSDoc）：

- `update(source)` 接收的是**完整累积的字符串**，而不是增量 delta——因此操作幂等，在 React StrictMode 下重放安全，且框架中立。源文本的追加扩展会触发平滑动画；其他任何变化——包括首次调用——均瞬间完整呈现。
- `finish()` **并不是终结销毁**：在调用 `finish()` 之后再次调用 `update()` 会恢复动画。多轮对话或多阶段流程（流式输出 → 工具调用 → 继续流式输出）可全程复用同一个控制器。
- `snap(source)` 与 `flush()` 可以无动画瞬间跃进到最新状态；`dispose()` 则会取消尚未执行的调度帧。

## API 参考 <a id="api-reference"></a>

### `<AIMarkdownSmoothStream>` 扩展属性

| 属性                 | 类型                                     | 默认值       | 说明                                                                     |
| -------------------- | ---------------------------------------- | ------------ | ------------------------------------------------------------------------ |
| `smoothPacing`       | `'smooth' \| 'balanced' \| 'responsive'` | `'balanced'` | 延迟与平滑度权衡预设（参见上文预设表格）；支持运行时动态修改             |
| `onSmoothDrained`    | `() => void`                             | —            | 在流式结束后排空动画彻底完成时触发——每轮存在真实积压的展开过程仅触发一次 |
| `smoothWaiting`      | `boolean`                                | `false`      | 等待输入期间保留空片段的队列占位；在收到有效输入或空响应结束时清除       |
| `smoothCoordination` | `boolean`                                | `true`       | 该片段是否参与文档级轮流呈现；设为 `false` 则独立呈现                    |

其余所有属性均会直接透传给内层的 `<AIMarkdown>`。在上层容器 `<AIMarkdownDocuments>` 上对应的总控开关为 `smoothTurnTaking`（默认值为 `true`）。

### `useSmoothStream(options)`

可从 `@ai-markdown/react` 导入该 Hook 及其相关类型 `UseSmoothStreamOptions` 与 `UseSmoothStreamResult`。在 React 组件或自定义 Hook 中直接调用。

| 参数选项    | 类型                                   | 默认值与行为说明                                                        |
| ----------- | -------------------------------------- | ----------------------------------------------------------------------- |
| `content`   | `string`                               | 必填，当前完整累积的 Markdown 源字符串                                  |
| `streaming` | `boolean`                              | 默认 `false`；表示数据生产端当前是否处于活跃状态                        |
| `pacing`    | `SmoothStreamPacing`                   | 默认 `balanced`；支持热更新而无需替换内部控制器                         |
| `onDrained` | `() => void`                           | 可选；真实积压展开完毕时触发一次，初始/静态快照或源文本直接替换不会触发 |
| `now`       | `() => number`                         | 引擎内部时钟；高级测试缝隙，在 Hook 构造控制器时捕获                    |
| `schedule`  | `(callback: () => void) => () => void` | 引擎帧调度器；高级测试缝隙，在构造时捕获                                |

返回对象为 `{ content: string, streaming: boolean, flush: () => void }`。`content` 为当前可见的前缀字符串；`streaming` 在生产端活跃或仍有待展开文本时持续为 `true`。`flush` 的引用恒定不变，会立即跳过动画展示所有可用文本（仍受末尾不确定字素暂留规则保护），但不会中断数据源生产。

初始内容与服务端渲染内容均为完整形态。后续输入由 Effect 同步给保留的控制器；组件卸载时会自动清理控制器并注销订阅。回调函数引用的变化完全安全：下一个已提交的 Effect 会自动更新内部的 `onDrained` 引用。自定义注入的调度器必须异步执行回调并返回取消函数；在后续渲染中改变 `now` 或 `schedule` 不会重新创建控制器。

### `useDocumentSmoothStream(options)`

接收 `useSmoothStream` 的全部参数，外加 `documentId` 以及可选的 `waiting`（Hook 版本的 `smoothWaiting`，默认为 `false`）。在提供 `documentId` 且位于 `<AIMarkdownDocuments>` 祖先树内部时，它会自动加入该文档的轮流呈现队列；缺少任一条件时，其行为与普通 `useSmoothStream` 完全一致。传入的 `documentId` 必须与最终渲染组件接收的 ID 完全匹配，且挂载期间禁止变更。在被门禁拦截期间，返回的 `flush()` 为空操作（此时尚未开始播放），`onDrained` 也只会在轮到该片段彻底播放完成后触发——这可能会显著滞后于数据源结束的时间点。

### 高级数值控制

`createSmoothStreamController(options)` 除了接收 `pacing` 预设名外，还支持传入 `SmoothStreamPacingParams` 中的具体字段来覆盖预设项：`bufferFactor`、`correctionTauMs`、`minCharsPerSecond`、`drainMs` 以及 `maxLagMs`。（`emaTauMs` 依然兼容传入，但自 v2.10 截止时间法则重构后已被废弃且不再起效。）预设参数包本身通过 `SMOOTH_STREAM_PACING_PRESETS` 导出。所有传入数值均会经过安全校验——遇到 NaN 或 Infinity（例如通过 `parseInt` 解析缺失的配置项）会自动回退为预设默认值，不会破坏控制法则。`drainMs` 在流式结束瞬间使用（截止时间在此刻锚定），因此中途修改只会影响下一次排空，而不会改变当前正在进行的排空时长。

## 核心行为细节

- **挂载快照（Mount snaps）**：控制器首次接收到的内容会立即瞬间完整渲染。这确保了 SSR 服务端渲染与客户端水合的一致性（服务端输出的是全量文本），并防止虚拟化聊天列表在向上滚动重新呈现历史消息时反复重放打字机动画。**只有在挂载之后新追加的内容**才会播放平滑动画。
- **重新生成快照（Regeneration snaps）**：如果传入的 `content` 并不是在上一版本基础上的追加扩展（例如用户点击了“重新生成”，或编辑了之前的消息），内容会瞬间完整更新——替换并非流式追加。同时不会触发 `onSmoothDrained`：因为上一条被替换的消息是被中断废弃，而不是正常完成。
- **替换文本的生效会落后一个提交**：控制器是在 Effect 中与新属性同步的，因此传入新 `content` 的那次渲染在挂载瞬显之前，会在单个提交帧内短暂呈现上一条文本。普通追加不会有此现象（因为节奏控制的前缀天然滞后于源文本）；这只有在将重新生成与同帧截图或同帧 DOM 断言混用时才需要关注。
- **停顿行为**：如果数据源在中途停顿，展开动画会平稳地将当前剩余积压内容播放到预定的截止时间，随后停住；此段停顿会落入间隔时间窗口的长尾区域而被分位数统计忽略，因此当后续数据到达时，会直接恢复停顿前的匀速节奏，而不会对长时间的静默过度适应。内置光标的停顿指示器会在此刻接管，与非平滑渲染完全一致。
- **突发大块数据的快速呈现**：单帧展开量会随着爆发数据的大小动态伸缩：细粒度的数据流如果突然涌入一大块数据（例如断线重连后代理层一次性清空了积压缓冲区），控制器会在较短的预期窗口内快速展开这部分内容，而不是生硬地拉长时间——截止时间法则确保了内容能够及时跟上最新状态。平稳传输的数据流永远不会触发此现象；这仅是极端异常投递情况下的单帧保护机制。
- **`onSmoothDrained` 在数据源结束、积压内容显示完毕后触发，每轮一次。** 流式输入仍在进行时，末尾暂留的字素使显示进度略落后于源文本，因此中途追赶不会触发回调。多轮生成时，每轮积压显示完毕后触发一次。启用轮流呈现时，等待中的片段要轮到自己并完成显示后才会触发，可能晚于数据源结束。如果内容完全在等待期间被替换，显示控制器只观察到从空文本到最终内容，仍会按一轮积压完成触发回调。

## 避坑指南

### 忘记将 `streaming` 重置为 `false`

流式结束信号在此承担着关键职责：它负责确认最后暂留的尾部字素，并启动定时的排空收尾流程。如果 `streaming` 始终保持为 `true`，消息的最后一个字素将永远无法展开，返回的 `streaming` 状态也永远无法收敛（导致尾部光标无法卸载）。在轮流呈现模式下，后果会进一步恶化：同一文档中后续的所有片段都会被这一个卡住的片段永久阻塞，**彻底无法展示**——在用户看来表现为内容丢失，而不仅仅是光标残留。在开发环境下，如果前序片段超过约 10 秒没有任何展开进展，会触发告警提示；在生产环境中，请确保将 `streaming` 严格绑定到网络传输层的真实结束事件上，切勿依赖估算。

### 等待首次输入的空片段

当 `streaming={false}` 且内容为空时，系统会将其判定为已完成的空结果，并立即让出轮流播放权限。如果你在发起网络请求之前需要提前挂载占位组件，请从首次挂载起就设置 `smoothWaiting={true}`（或在 `useDocumentSmoothStream` 中传入 `waiting: true`）。这样可以在不激活光标的前提下锁定队列位置。当数据开始流入，或者请求以空文本结束时，清除该标记：

```tsx
<AIMarkdownSmoothStream
  documentId="answer"
  content={text}
  streaming={status === 'streaming'}
  smoothWaiting={status === 'waiting'}
/>
```

等待标记仅仅是延缓队列完成判定，并不会拦截新流入的内容，也不会压制显式激活的 `streaming` 状态。在未开启协调时该标记无任何副作用。完成状态具有粘滞性：在一个片段已经宣布完成后再次设置 waiting 并不能重新唤醒其队列位置。如需独立排队的新消息，请为其挂载带有新 key 的新组件。在展开动画进行期间，请保持该片段始终处于挂载状态。

### 偏离挂载顺序插入的片段 <a id="chunks-inserted-out-of-mount-order"></a>

轮流呈现队列完全基于**组件挂载顺序**。引用注册表支持基于 `documentIndex` 进行排序，但该属性**不会**改变平滑轮流呈现的播放次序。如果在会话中途动态插入新片段（例如重新生成早期历史消息，或在列表顶部插入新项），该片段会排在队列的**最末尾**，必须等待现有所有片段完成（包括排版上位于其下方的消息）——在视觉上表现为对话中间出现空白断层。对于这种非按序插入的片段，请显式设置 `smoothCoordination={false}`（使其独立展开，不阻塞其他片段也不被其他片段阻塞）。

### 手动路径下 `documentId` 重复传入引发的不一致

使用 `useDocumentSmoothStream` 时，你需要将 `documentId` 同时传给 Hook 以及最终渲染的组件，Hook 无法在二者之间进行交叉验证。如果这两个 ID 发生漂移，代码不会报错崩溃——但该片段会静默脱离协调（或在错误的文档下进行协调）。外壳组件 `<AIMarkdownSmoothStream>` 不存在此问题，它会自动在内部向下透传自己的属性。

### 虚拟列表中回收正在流式展开的片段

向上滚动使片段重新进入视图时，重新挂载包含累积文本的片段会瞬间完整呈现并继续展开（不会重放，也不会白屏）。但如果在某个片段**正在播放展开动画时**将其卸载，系统会立即释放其后继片段（避免队列无法继续推进），此时如果用户重新滚回，就会看到该片段的尾部与后继片段同时播放动画。如果你的列表使用了虚拟滚动，请将当前正在流式生成的项保留在已挂载列表中，暂不回收。

### 大量兄弟片段下的注册表广播开销

在跨片段协调模式下，每次内容发生变化时，系统都会对该片段的源文本执行定义扫描（Definition scan）。该扫描具备追加感知能力并在两个方向上进行了增量优化——链接和任务列表通过特征探测直接跳过解析，而真正的引用定义块（如引用脚注区）流式追加时仅对活动尾部重新解析（在 1.2 万字符的片段上，耗时从全量重解析的约 30ms 降低至约 0.8ms/追加）。在逐帧展开的频率下，主要的潜在开销来自于协调广播本身：当某个片段展开包含定义的正文时，每帧都会更新共享注册表版本并通知订阅者。目前引用占位符仅针对自身的目标地址或编号进行窄订阅，无关变更不会导致占位符重渲染；但父级渲染器与全局脚注汇总组件仍会观察全注册表变更。注册表查询在每个版本上共享惰性有序索引。
轮流呈现已经为你提供了单一打字机的效果，处于门禁等待状态的片段在等待期间不会产生任何开销；如果你在拥有极多并发挂载片段的场景下仍观察到广播性能瓶颈，在将消息传入协调分块**之前**对其进行平滑处理（先经过单一平滑流控制器，再向下拆分）仍然是减少独立节奏控制器数量的有效方式。若将平滑后的结果再拆分给多个协调渲染器，依然会触发贡献更新与注册表广播；而使用单一独立渲染器则可以彻底免除协调开销。在无跨片段协调的独立渲染场景下，此项扫描完全不执行。

### 在平滑输出时关闭块级记忆

如果设置了 `blockMemo={false}`，底层的增量解析也会被一并关闭，此时逐帧平滑展开就会退化为**逐帧全量重新解析整个文档**——这是平滑输出真正产生高额性能开销的唯一组合。在启用平滑输出时，请保持 `blockMemo` 为默认的开启状态。

### 叠加双重节奏控制

如果你的传输层已经实现了限流或打字效果（某些 SDK 辅助工具会按词逐个推送），再将该输出接入平滑外壳会导致双重控制：两个追赶控制器互相博弈，内容呈现会出现忽快忽慢的“橡皮筋”效应。请始终将最原始的累积字符串直接传给平滑外壳，由单一图层掌控展示节奏。

### 偏好减少动画的用户适配

打字机展开效果属于视觉动画。本库不会自动静默关闭它（因为平滑字符串本质上只是普通文本，不存在用于开关的纯 CSS 属性），因此在需要关照动画偏好的场景中，请由应用层自行适配：当 `matchMedia('(prefers-reduced-motion: reduce)').matches` 成立时，直接渲染普通 `<AIMarkdown>`（或不通过 `useSmoothStream` 传递）——外壳组件总是会执行平滑逻辑，不传 `smoothPacing` 仅代表使用默认预设。

### 在单元测试中断言物理时钟

节奏控制是基于可注入时钟的截止时间机制。在编写单元测试时，请注入 `now` 与 `schedule`（Hook 接受二者作为内部测试缝隙，底层控制器同样支持在 options 中传入）并通过手动步进推进时钟——依赖物理时钟定时器与断言竞争，正是这些测试缝隙所要规避的不稳定性来源。

## 明确选择生命周期表现

| 输入变更状态                     | 视觉呈现行为                             | 完成回调行为                             |
| -------------------------------- | ---------------------------------------- | ---------------------------------------- |
| 挂载时已包含初始文本             | 立即展示全量文本，包括尾部               | 初始快照不触发完成回调                   |
| 流式接收中持续追加内容           | 将已确认的字素平稳推进到当前截止时间     | 中途追赶对齐不触发完成回调               |
| 流式结束但仍有待展开文本         | 确认尾部暂留字素，启动平滑排空           | 当积压队列彻底展开完毕时触发一次         |
| 替换或缩短当前可见的源文本       | 在同步 Effect 之后瞬间完整切换           | 文本替换不会将废弃的中断轮次报告为已排空 |
| 之前结束后再次追加新内容         | 复用现有控制器恢复动画                   | 后续新的积压轮次结束时可再次触发完成回调 |
| 对处于活跃状态的流执行 `flush()` | 瞬间展开所有已确认前缀，保留不确定的尾部 | 不会判定数据源已结束                     |

各预设的基础排空基准时间为：`smooth` 320 毫秒、`balanced` 240 毫秒、`responsive` 150 毫秒。最终的收尾窗口最长可达该基准的三倍。这些是控制器的规划时间目标，而非严格的帧率或网络通信保障。

如果业务逻辑依赖“生成完毕”，请严格区分**数据源结束事件**与**视觉展开排空回调**。持久化保存回答可以跟随数据源结束；而自动滚动至可视区域底部则适合跟随视觉展开排空。切勿将 `onSmoothDrained` 用作空响应、初始静态文本、消息替换或网络请求失败的唯一成功信号。

源码参考：[控制器](../../../../packages/engine/src/components/smoothStream/controller.ts)、[React Hook](../../../../packages/react/src/components/smoothStream/useSmoothStream.ts) 与 [文档感知 Hook](../../../../packages/react/src/components/smoothStream/useDocumentSmoothStream.ts)。

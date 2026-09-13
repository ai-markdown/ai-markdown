# React 元数据上下文

本页的 Hooks 和 Context Provider 属于 React API。Vue 通过属性把 `metadata` 和 `streaming` 传给自定义组件与元素插槽。参见 [Vue 指南](../reference/vue.md#custom-vue-components-and-slots)和[安装配置](getting-started.md)。

`metadata` 通过独立的 React Context，把应用数据传给自定义 Markdown 组件，例如消息 ID、操作回调或引用记录。这些数据不需要参与 Markdown 解析配置。库会原样传递对象，不复制，也不做深比较。

```tsx
import AIMarkdown, { useAIMarkdownMetadata, type AIMarkdownCustomComponents } from '@ai-markdown/react';

interface ChatMeta {
  messageId: string;
  onCopyCode: (code: string) => void;
  onCitationClick: (label: string) => void;
}

const CopyablePre: NonNullable<AIMarkdownCustomComponents['pre']> = ({ node, children, ...props }) => {
  const meta = useAIMarkdownMetadata<ChatMeta>();
  const code = node?.children[0];
  const source =
    code?.type === 'element' && code.tagName === 'code'
      ? code.children.map((child) => (child.type === 'text' ? child.value : '')).join('')
      : '';
  return (
    <div>
      <button type="button" disabled={!meta} onClick={() => meta?.onCopyCode(source)}>
        Copy code
      </button>
      <pre {...props}>{children}</pre>
    </div>
  );
};
const COMPONENTS = { pre: CopyablePre } satisfies AIMarkdownCustomComponents;

<AIMarkdown<ChatMeta>
  content={markdown}
  metadata={{ messageId: msg.id, onCopyCode: handleCopy, onCitationClick: handleCitation }}
  customComponents={COMPONENTS}
/>;
```

Hook 返回 `ChatMeta | undefined`，需要处理未提供元数据的情况。泛型只提供编译期类型信息，不能保证运行时存在 Provider。包含 HTML 回退和剪贴板错误处理的复制示例见[自定义组件](custom-components.md#custom-code-block-with-copy-button-react-no-mantine)。

<span id="why-a-separate-context"></span>

## 为什么采用独立的 Context？

`<AIMarkdown>` 内部划分了五个系统级 React Context（文档、元数据、状态、主题、行为配置——各自配套专属的细粒度 Hook）。其中与本文相关的核心设计为：

- **元数据 Context（Metadata context）**——以不透明黑盒形式承载调用方传入的 `metadata`。通过 `useAIMarkdownMetadata()` 进行读取。**Markdown 内容主体本身并不订阅此 Context**。

父组件可能在每次渲染时创建新的 `metadata` 对象。如果它与主题或流式状态共用 Context，元数据变化也会通知 Markdown 主体。使用独立 Context，可以避免仅因元数据变化而重新执行主体渲染。

元数据引用变化不会使解析缓存和块转换缓存失效，但订阅该 Context 的自定义组件仍会重新渲染。行内对象和回调可以正常使用；当订阅组件开销较大时，可保持它们的引用稳定，减少不必要的更新。

```text
parent render → new `metadata` object
  → the metadata context value changes
  → components that call `useAIMarkdownMetadata` re-render
  → the other four context values are unchanged
  → AIMarkdownContent is memoized on its own stable props
    and does NOT re-render
  → the per-block memo cache is untouched
```

这里保证的是解析和块缓存不因元数据变化失效。外层排版容器和 Provider 仍可能因为新的 `children` 而重新渲染，但不会因此重新执行 Markdown 解析流程。

库不调用 `useStableValue(metadata)`，避免在每次渲染时深比较未知的大型对象。是否稳定引用，应由应用根据订阅组件的需要决定。

---

<span id="recipes"></span>

## 常见用法

<span id="pass-copy-regenerate-edit-callbacks-to-a-code-block"></span>

### 为代码块传递复制、重新生成、编辑操作回调

把操作按钮放在 `<pre>` 外，并从代码节点读取文本，不要直接把 React children 转成字符串。下例使用 ref，在代码包含嵌套高亮标签时也能取得显示文本：

```tsx
import { useRef } from 'react';

interface ChatActions {
  onCopyCode: (code: string) => void;
  onRegenerate: () => void;
  onEdit: () => void;
}

function ChatCodeBlock({ children }: { children?: React.ReactNode }) {
  const meta = useAIMarkdownMetadata<ChatActions>();
  const pre = useRef<HTMLPreElement>(null);
  return (
    <div>
      <div className="toolbar">
        <button type="button" disabled={!meta} onClick={() => meta?.onCopyCode(pre.current?.textContent ?? '')}>
          Copy
        </button>
        <button type="button" disabled={!meta} onClick={() => meta?.onRegenerate()}>
          Regenerate
        </button>
        <button type="button" disabled={!meta} onClick={() => meta?.onEdit()}>
          Edit
        </button>
      </div>
      <pre ref={pre}>{children}</pre>
    </div>
  );
}
```

上述方案复制的是屏幕上展示的文本内容。如果语法高亮器或格式化插件改变了视觉展示结构，可以通过组件自身的 props 传递原始代码，或者从对应的 hast 文本节点中读取。元数据仅作为操作动作的传输通道；具体复制代码的哪种数据表现形态由业务组件自行决定。

<span id="resolve-citations-to-ui-state"></span>

### 将自定义引文协议解析为 UI 交互状态

```tsx
interface CitationMeta {
  citations: Map<string, { title: string; url: string }>;
}

function CitedLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  const meta = useAIMarkdownMetadata<CitationMeta>();
  if (href?.startsWith('cite://')) {
    const id = href.slice('cite://'.length);
    const c = meta?.citations.get(id);
    if (c)
      return (
        <a href={c.url} title={c.title}>
          {children}
        </a>
      );
  }
  return <a href={href}>{children}</a>;
}
```

该模式可与 [URL 过滤](url-sanitization.md) 配合使用：在两个过滤阶段都允许 `cite://` 后，自定义组件可以读取这样的引用标记，并在渲染时解析目标链接。应用仍需验证最终目标 URL。

<span id="per-message-identity-for-analytics"></span>

### 结合消息标识进行埋点数据统计

```tsx
interface AnalyticsMeta {
  messageId: string;
  conversationId: string;
  trackEvent: (event: string, props?: Record<string, unknown>) => void;
}

function TrackedLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  const meta = useAIMarkdownMetadata<AnalyticsMeta>();
  return (
    <a
      href={href}
      onClick={() =>
        meta?.trackEvent('link_click', {
          href,
          messageId: meta.messageId,
          conversationId: meta.conversationId,
        })
      }
    >
      {children}
    </a>
  );
}
```

在不改动 Markdown 源码或流水线配置的前提下，可以随时更新回调函数的实现。由于使用元数据的组件能实时获取最新的 Provider 状态，当组件内部包含较多衍生逻辑时，保持回调引用的稳定依然是推荐的最佳实践。

<span id="per-message-thinking-indicator-while-streaming"></span>

### 流式生成期间展示单条消息专属的“思考中”状态

下述示例中的 `Spinner` 属于业务组件，接收一个开始时间戳参数。请将其放置在代码块元素外层，确保复制代码时不会把状态提示文本夹杂进去：

```tsx
interface StreamMeta {
  thinkingStartedAt: number | null;
}

function CodeWithSpinner({ children }: { children?: React.ReactNode }) {
  const meta = useAIMarkdownMetadata<StreamMeta>();
  const { streaming } = useAIMarkdownState();
  return (
    <div>
      {streaming && meta?.thinkingStartedAt != null && <Spinner since={meta.thinkingStartedAt} />}
      <pre>{children}</pre>
    </div>
  );
}
```

请注意，`useAIMarkdownState()` 与 `useAIMarkdownMetadata()` 可以完全自由组合使用——虽然它们源自不同的底层 Context，但业务组件可以同时按需调用两者。

---

<span id="typing-the-metadata-generic"></span>

## 为元数据泛型声明类型

调用 `useAIMarkdownMetadata<TMetadata>()` 本质上是一种**调用方断言**，而非自动推导出的安全类型。TypeScript 在编译期无法真正验证上层的 `<AIMarkdown>` Provider 实际注入的 `metadata` 是否确实符合 `TMetadata` 的结构契约。一旦类型断言有误，字段在编译期看似正常，而在运行时读取却会变成 `undefined`。

推荐的最佳工程实践是在统一的模块中集中定义类型规范，并封装项目专属的包装 Hook：

```ts
// my-chat/metadata.ts
import { useAIMarkdownMetadata } from '@ai-markdown/react';

export interface ChatMeta {
  messageId: string;
  onCopyCode: (code: string) => void;
}

export const useChatMeta = () => useAIMarkdownMetadata<ChatMeta>();
```

此时业务组件只需统一引入 `useChatMeta()`——所有的类型断言收敛在单处维护：

```tsx
function MyCodeBlock() {
  const meta = useChatMeta(); // typed as ChatMeta | undefined
}
```

这完全对齐了 `@ai-markdown/react-mantine` 官方包内部封装 `useMantineAIMarkdownMetadata` 的设计模式。关于在行为分组中应用该模式的进阶用法，请参阅 [TypeScript 泛型](typescript-generics.md) 与 [通过子包进行功能扩展](extending-via-subpackage.md)。

---

<span id="metadata-vs-render-facing-props-vs-prop-drilling"></span>

## Metadata 与渲染 Props 及属性逐层透传的选型比对

| 适用场景与数据特征                                                                      | 推荐选型通道                                                                                                                                 |
| :-------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------- |
| 影响 Markdown **核心呈现逻辑**的数据（主题方案、基准字号、流式标记、文档 ID）           | 直接作为 `<AIMarkdown>` 的平铺 props 传入，并通过匹配的专属 Hook 读取（`useAIMarkdownTheme`、`useAIMarkdownState`、`useAIMarkdownDocument`） |
| 自定义组件所需的**应用级业务回调、ID 或业务数据**（极少改变标准 Markdown 的解析与渲染） | 使用元数据通道（通过 `metadata` prop 传入，调用 `useAIMarkdownMetadata` 读取）                                                               |
| 仅传递给某个特定单一直接子组件的一次性私有数据                                          | 直接作为自定义组件自身的常规 props 传递                                                                                                      |
| 已经存在于应用全局 Context 中的系统状态                                                 | 在自定义组件内部直接调用对应的 Context 读取——完全无需绕道 `metadata` 转手                                                                    |

本库绝不**强制绑架**你必须使用 `metadata`。如果你的应用中已经引入了 Redux、Zustand 或项目专属的全局聊天状态 Context，自定义组件可以直接调用它们。`metadata` 的价值在于当你缺乏现成的轻量方案时提供阻力最小的直达通道——并且自动为你提供重渲染隔离的性能保护。

---

<span id="footguns"></span>

## 常见问题

<span id="forgetting-that-metadata-can-be-undefined"></span>

### 遗漏处理 `metadata` 可能为 `undefined` 的边界情况

```ts
// ⚠️ Crashes when no metadata was passed to the provider.
const meta = useAIMarkdownMetadata<ChatMeta>();
meta.onCopyCode(code);

// ✅ Optional-chain.
meta?.onCopyCode(code);

// ✅ Or assert defensively.
if (!meta) throw new Error('ChatMeta is required for this component');
```

正因如此，该 Hook 的返回类型被设计为 `TMetadata | undefined`。使用可选链（`?.`）调用的开销几乎为零；而忽视这一点则可能在调用方遗漏传递该 prop 时引发难以捉摸的运行时崩溃。

<span id="stabilizing-metadata-when-you-dont-need-to"></span>

### 何时使用 `useMemo`

是否稳定元数据引用，应根据订阅组件的开销判断。小型、低频的数据可以直接使用行内对象；如果依赖没有变化，`useMemo` 能复用对象，避免触发 Context 更新。

```tsx
// Inside your message component; include every reactive field in the dependencies.
const metadata = useMemo(() => ({ onCopy, messageId }), [onCopy, messageId]);
<AIMarkdown content={content} metadata={metadata} />;
```

依赖中的回调或 ID 变化时，`useMemo` 仍会生成新对象。如果回调在父组件每次渲染时重新创建，应按需要用 `useCallback` 稳定它。对于高频数据，可以传入稳定的外部 Store，并让组件只订阅所需状态。

<span id="storing-huge-state-trees-in-metadata"></span>

### 避免在 `metadata` 中挂载巨型状态树

库不检查 `metadata` 的内部字段，也不对它做深比较。引用改变时，Context 会通知订阅者；引用不变时不会因该值触发通知。因此：

- 只要 `metadata` 的引用发生改变，所有调用了 `useAIMarkdownMetadata` 的组件均会接收到 Context 刷新通知，即便某个具体组件所读取的局部字段并未改变。
- 常规聊天场景通常只需要少量回调和消息 ID。
- 如果每次都传入新建的大型对话树，所有元数据订阅组件都会收到更新。保持引用不变可以减少通知，但不会提供字段级订阅。

对于复杂的大型状态，建议让 `metadata` 保持精简（仅传递选择器 ID 或实体引用标识），将厚重的状态树交由专门的响应式状态库（Zustand、Jotai、Redux 或配合 `useSyncExternalStore` 的私有 Context）接管。

<span id="calling-useaimarkdownmetadata-outside-a-custom-component"></span>

### 在自定义组件外部错误调用 `useAIMarkdownMetadata`

在没有对应 Provider 的组件树外部调用该 Hook，会返回 `undefined`。请把读取逻辑放在 Markdown 内的自定义组件中，或直接从原始 state、props、Store 读取数据。

<span id="stable-containers-and-live-subscriptions"></span>

## 稳定容器句柄与实时响应式订阅

对于高频变化的数据，可以通过元数据传入**稳定的 Store 对象**，避免每次更新都替换 `metadata`。Store 必须提供订阅机制，组件才能响应其变化。直接修改 `metadata.progress` 不会通知 React，普通 ref 也不是响应式 Store。

```tsx
import { useSyncExternalStore } from 'react';

interface ProgressStore {
  subscribe: (notify: () => void) => () => void;
  getSnapshot: () => number;
  getServerSnapshot: () => number;
}
interface ProgressMeta {
  progress: ProgressStore;
}

const NO_SUBSCRIPTION = () => () => {};
const ZERO = () => 0;

function ProgressLabel() {
  const store = useAIMarkdownMetadata<ProgressMeta>()?.progress;
  const progress = useSyncExternalStore(
    store?.subscribe ?? NO_SUBSCRIPTION,
    store?.getSnapshot ?? ZERO,
    store?.getServerSnapshot ?? ZERO
  );
  return <span>{progress}%</span>;
}
```

Store 方法的引用应保持稳定，相关字段未变时，快照也应保持相等。SSR 需要提供与客户端首次水合值一致的 `getServerSnapshot`。元数据负责传递稳定的 Store，具体更新由 Store 订阅处理。

<span id="provider-boundaries-and-safe-application-data"></span>

## Provider 作用域边界与应用级安全数据流

元数据属于最近的 Markdown Provider。组件不会仅因 `documentId` 相同就共享元数据；跨片段协调只共享引用和脚注信息。每个片段应显式传入所需上下文，或共享同一个外部 Store。

如果自定义引文组件将 `cite://42` 转换为从元数据中读取的真实跳转 URL，该转换操作发生在 Markdown 内置的 URL 清洗链路之后。因此，应用程序必须针对引文 Store 中取出的真实目标 URL 执行严格的链接安全校验。在 Markdown 安全关卡中放行自定义引文协议，仅代表该协议标记能够合法流经 Markdown 语法树；它绝不担保后续从外部应用状态中读取出来的任意数据是天然安全的。

测试时可保持 `content` 不变并替换回调、尝试不传 `metadata`，以及同时挂载两个使用不同 ID 和回调的实例，检查组件是否读取最新回调、正确处理空值并保持实例隔离。实现与测试见 [`context.tsx`](../../../../packages/react/src/context.tsx)、[`context.test.tsx`](../../../../packages/react/src/context.test.tsx) 和 [`contextsV2.test.tsx`](../../../../packages/react/src/contextsV2.test.tsx)。

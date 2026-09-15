# React TypeScript 泛型

这些元数据泛型与定义工厂函数归属于 `@ai-markdown/react`。Vue 导出了 `AIMarkdownProps`、`MarkdownComponents` 以及元数据为 `unknown` 的 `MarkdownElementContext`。详情请参阅 [Vue 指南](../reference/vue.md#api-and-distribution) 与[相关包安装配置](getting-started.md)。

React 适配器仅包含一个组件泛型：`TMetadata`。它描述通过 `metadata` 属性传入的数据类型，而普通属性则描述主题、生命周期、流水线选项以及渲染插槽。在 v2 中不再存在配置相关的泛型。

```ts
function AIMarkdown<TMetadata extends AIMarkdownMetadata = AIMarkdownMetadata>(
  props: AIMarkdownProps<TMetadata>
): ReactElement;
```

`AIMarkdownMetadata` 继承自 `Record<string, any>`，不强加任何必需的业务字段。常规接口（如 `{ messageId: string }`）可直接使用。组件能够从传入的 `metadata` 属性中自动推导该接口；当你希望传入的对象严格符合共享契约时，显式指定类型参数会非常有用。

使用端 Hook 的类型参数是相互独立的。`useAIMarkdownMetadata<ChatMeta>()` 告知 TypeScript 如何对待最近的 Context 值，但它无法证明外层 Provider 确实提供了符合该结构的数据。建议在应用级 Hook 中集中管理该断言，并保持显式的运行时缺失值处理逻辑。

对于 1.x 代码，请移除第一个泛型参数：`AIMarkdownProps<MyConfig, MyMeta>` 变更为 `AIMarkdownProps<MyMeta>`。行为扩展现在使用包装层属性与 Provider 分组，如下文以及[迁移指南](migrating-to-v2.md)所示。

<span id="extending-metadata"></span>

## 扩展元数据

```tsx
import { useRef } from 'react';
import AIMarkdown, { useAIMarkdownMetadata, type AIMarkdownMetadata } from '@ai-markdown/react';

interface ChatMeta extends AIMarkdownMetadata {
  messageId: string;
  onCopyCode: (code: string) => void;
}

function MyCodeBlock({ children }: { children?: React.ReactNode }) {
  const pre = useRef<HTMLPreElement>(null);
  const meta = useAIMarkdownMetadata<ChatMeta>();
  //                                  ^^^^^^^^ caller-asserted
  return (
    <div>
      <button type="button" onClick={() => meta?.onCopyCode(pre.current?.textContent ?? '')}>
        Copy
      </button>
      <pre ref={pre}>{children}</pre>
    </div>
  );
}

function App({ msg, onCopy }: { msg: { id: string; content: string }; onCopy: (c: string) => void }) {
  return (
    <AIMarkdown<ChatMeta>
      content={msg.content}
      metadata={{ messageId: msg.id, onCopyCode: onCopy }}
      customComponents={{ pre: MyCodeBlock }}
    />
  );
}
```

TypeScript 在大多数场景下能够从 `metadata` 的结构中自动推导 `ChatMeta`；出于下文所述原因，显式声明类型更为稳妥。

> 元数据没有默认回退值。若 Provider 未传入 `metadata`，无论断言为何种类型，Hook 均返回 `undefined`。请始终使用可选链操作符（`?.`）进行访问。

---

<span id="the-assertion-problem-and-where-it-lives-now"></span>

## 断言问题及其当前的归属位置

`useAIMarkdownMetadata<T>()` 属于**调用方断言**，而非推导类型。TypeScript 无法自动验证上层的 `<AIMarkdown>` Provider 是否确实接收到了符合 `ChatMeta` 形状的值——如果断言有误，`meta.messageId` 在编译时看似正常，但在运行时求值结果为 `undefined`。

解决方案是沿用一贯的**包装层 Hook 模式**：将断言在提供该数值的代码旁边集中固定一次，并导出一个收窄的专属 Hook：

```ts
// my-app/markdown/meta.ts
import { useAIMarkdownMetadata } from '@ai-markdown/react';
import type { ChatMeta } from './types';

export const useChatMeta = () => useAIMarkdownMetadata<ChatMeta>();
```

每个自定义组件均引入 `useChatMeta()`；类型断言仅存在于单一文件中。

对于**行为分组（behavior groups）**——即 v2 中替代扩展配置的机制——这一模式是唯一的通道，并且已内置在 API 设计之中。`useAIMarkdownBehaviors()` 是非泛型的：它返回三个核心行为开关加上一个不透明的扩展记录，唯独一次类型断言发生在包装层的窄粒度 Hook 内部。这正是 `@ai-markdown/react-mantine` 为其 `codeBlock` 分组所采用的实现方案：

```ts
// Equivalent narrow-hook pattern; use the package hook in application code.
export function useMantineCodeBlockOptions(): Required<MantineCodeBlockOptions> {
  const behaviors = useAIMarkdownBehaviors();
  // The single assertion: the `codeBlock` group key is owned by this
  // package, contributed by `MantineAIMarkdown` via its behaviors Provider.
  const group = behaviors.codeBlock as Partial<MantineCodeBlockOptions> | undefined;
  return useMemo(
    () => ({
      defaultExpanded: group?.defaultExpanded ?? true,
      autoDetectUnknownLanguage: group?.autoDetectUnknownLanguage ?? false,
      highlightJs: group?.highlightJs ?? null,
      formatJson: group?.formatJson ?? true,
      expandNestedJson: group?.expandNestedJson ?? true,
      highlightIntervalMs:
        Number.isFinite(group?.highlightIntervalMs) && group!.highlightIntervalMs! >= 0
          ? group!.highlightIntervalMs!
          : 50,
      mermaidIntervalMs:
        Number.isFinite(group?.mermaidIntervalMs) && group!.mermaidIntervalMs! >= 0 ? group!.mermaidIntervalMs! : 300,
    }),
    [group]
  );
}
```

分组默认值也在此处应用——该 Hook 是类型断言与默认值逻辑唯一共存的场所。有关包装层完整实现配方，请参阅[通过子包进行扩展](extending-via-subpackage.md)。

---

<span id="available-type-imports"></span>

## 可用的类型导入

```ts
import type {
  // Component props
  AIMarkdownProps,
  AIMarkdownDocumentsProps,

  // Metadata
  AIMarkdownMetadata,

  // Context payloads (narrow-hook return shapes)
  AIMarkdownDocumentInfo,
  AIMarkdownThemeInfo,
  AIMarkdownStateCore,
  AIMarkdownBehaviorsCore,
  AIMarkdownStateGroups,
  AIMarkdownBehaviorGroups,
  AIMarkdownExtensionGroups,
  AIMarkdownAggregate,

  // Engine plugins (values live in '@ai-markdown/react/plugins')
  AIMarkdownEnginePlugin,
  AIMarkdownEnginePluginName,

  // define* factory fragments
  AIMarkdownThemeProps,
  AIMarkdownBehaviorProps,
  AIMarkdownPipelineProps,

  // Stability firewall (wrapper reuse)
  AIMarkdownStabilityTable,

  // Customization
  AIMarkdownCustomComponents,
  AIMarkdownTypographyProps,
  AIMarkdownTypographyComponent,
  AIMarkdownExtraStylesProps,
  AIMarkdownExtraStylesComponent,
  AIMarkdownVariant,
  AIMarkdownColorScheme,

  // Streaming cursor
  AIMarkdownStreamingCursorProps,
  AIMarkdownStreamingIndicatorProps,
  AIMarkdownStreamingIndicatorComponent,

  // Pipeline
  AIMDContentPreprocessor,

  // Sanitization
  UrlTransform, // tracks react-markdown
  SanitizeSchema, // tracks rehype-sanitize

  // Cross-chunk registry (read-only)
  Registry,
  ChunkData,
  FootnoteDef,
  LinkDef,
  RefRecord,
  RefKind,
} from '@ai-markdown/react';
```

Mantine 相关包额外导出了以下类型：

```ts
import type {
  MantineAIMarkdownProps, // extends AIMarkdownProps<TMetadata> with `codeBlock`
  MantineAIMarkdownMetadata,
  MantineCodeBlockOptions,
  MantineBehaviorProps, // widened defineMantineBehaviors input
} from '@ai-markdown/react-mantine';
```

---

<span id="api-stability-of-urltransform-and-sanitizeschema"></span>

## `UrlTransform` 与 `SanitizeSchema` 的 API 稳定性

这两种类型均属于跟踪其上游相关包形态的**别名**：

- `UrlTransform` —— 跟踪 `react-markdown` 的类型形态。
- `SanitizeSchema` —— 跟踪 `rehype-sanitize` 的类型形态（具体为 `typeof defaultSchema`）。

这些类型**可能会随上游相关包的主版本升级而调整**。本库重新导出它们是为了让使用者无需直接依赖上游包进行类型导入；其权衡在于，若 `rehype-sanitize` 发布了变更 Schema 形态的主版本，此处的 `SanitizeSchema` 也会同步变更。

请通过 [`extendSanitizeSchema`](url-sanitization.md#sanitizeschema-gate-1-via-extendsanitizeschema) 构建你的安全清洗 Schema，而不要手写字面量类型——该辅助函数能使你免受大多数上游结构变动的影响。

---

<span id="footguns"></span>

## 避坑指南

<span id="asserting-a-wider-tmetadata-than-the-provider-supplies"></span>

### 断言的 `TMetadata` 范围大于 Provider 提供的实际数据

```tsx
// Provider:
<AIMarkdown content={c} metadata={{ messageId: '1' }} />; // ← no onCopyCode

// Consumer:
const meta = useAIMarkdownMetadata<ChatMeta>();
meta?.onCopyCode; // undefined at runtime, but TS shows the function type
```

TypeScript 无法在编译期捕获此类问题。包装层 Hook 模式并不能使类型断言在本质上绝对安全，但能使不匹配问题更容易被定位排查，因为 Provider 与断言集中在同一个文件中维护。

<span id="passing-v1x-style-generic-arguments"></span>

### 传入 1.x 风格的泛型参数

```tsx
<AIMarkdown<MyConfig, ChatMeta> … /> // ✗ compile error in v2 — one parameter only
<AIMarkdown<ChatMeta> … />           // ✓
```

对于 `MantineAIMarkdownProps<MyMantineConfig, MyMeta>` → `MantineAIMarkdownProps<MyMeta>` 同样如此。如果你正处于迁移过渡期，[迁移指南](migrating-to-v2.md#generic-signature-mapping-ts-users)提供了完整的签名对照表（包含已移除的 `PartialDeep` 导出）。

<span id="scattering-as-assertions-at-read sites"></span>
<span id="scattering-as-assertions-at-read-sites"></span>

### 在读取处到处分散 `as` 断言

若你发现在多个文件中重复编写 `behaviors.myGroup as MyGroupOptions`，说明你遗漏了窄粒度 Hook 的封装。请进行集中管理：一个 Hook、一次断言、在内部应用默认值（在多处读取位置随意使用 `??` 回退会导致逻辑发散——详见[通过子包进行扩展](extending-via-subpackage.md#footguns)）。

<span id="preserve-inference-in-wrappers"></span>

## 在包装层中保留类型推导

包装组件可以扩展 `AIMarkdownProps<TMetadata>` 并将元数据参数原样向下透传。若对泛型组件进行记忆化封装（memoize），在暴露该组件时请保留其可调用的函数签名；否则使用端可能会失去显式提供元数据类型参数的能力。

```tsx
import { memo } from 'react';
import AIMarkdown, { type AIMarkdownMetadata, type AIMarkdownProps } from '@ai-markdown/react';

interface MessageMarkdownProps<T extends AIMarkdownMetadata> extends AIMarkdownProps<T> {
  compact?: boolean;
}

function MessageMarkdownImpl<T extends AIMarkdownMetadata = AIMarkdownMetadata>({
  compact,
  ...props
}: MessageMarkdownProps<T>) {
  return (
    <div data-compact={compact || undefined}>
      <AIMarkdown<T> {...props} />
    </div>
  );
}

export const MessageMarkdown = memo(MessageMarkdownImpl) as typeof MessageMarkdownImpl;
```

最后的类型断言还原了包装层自身的泛型函数签名。它不会在运行时校验元数据，也不应被滥用于声称无关属性互相兼容。

<span id="check-fragments-without-widening-away-useful-types"></span>

## 在不放宽有用类型的前提下检查配置片段

对于自定义组件映射表，使用 `satisfies AIMarkdownCustomComponents` 既能校验元素标签键与属性，又能保留对象的精确推导类型。对于回调函数，显式标注 `UrlTransform`，而不要写成 `node: unknown` 随后传给 `defaultUrlTransform`。导出的类型包含了该回调函数所期望的只读 HAST 元素。

`defineTheme`、`defineBehaviors` 与 `definePipeline` 在浅层 `Object.freeze` 后返回相同的对象。它们会检查配置片段声明的字段；它们不会合并默认值、深度冻结嵌套数值或验证从 JSON 读取的外部配置。请在应用边界解码持久化配置，并在传给组件之前将插件名称映射到导出的清单对象。

可选字段在分组 Hook 中需要格外细致处理。`{ ...defaults, ...group }` 会允许显式传入的 `undefined` 覆盖默认值。请逐个解析受支持的字段或跳过 undefined 项，正如 Mantine Hook 所做的那样。返回类型 `Required<Group>` 必须如实描述实际返回的值。

<span id="other-typed-streaming-surfaces"></span>

## 其他带类型的流式 API 层面

React 适配器还导出了 `AIMarkdownSmoothStreamProps<TMetadata>`、`UseSmoothStreamOptions`、`UseSmoothStreamResult` 与 `UseDocumentSmoothStreamOptions`。平滑输出外壳保留了相同的元数据泛型；Hook 专注于处理字符串与生命周期状态，无需该泛型。控制器类型（`SmoothStreamController`、`SmoothStreamOptions`、`SmoothStreamPacing`、`SmoothStreamPacingParams`）描述了与框架无关的节奏控制层。

权威的导出名称位于 [`react/src/index.tsx`](../../../../packages/react/src/index.tsx)，载荷类型位于 [`context.tsx`](../../../../packages/react/src/context.tsx)。[子包扩展指南](extending-via-subpackage.md)展示了包装层的属性、分组 Hook 与扩展工厂函数如何协同工作。

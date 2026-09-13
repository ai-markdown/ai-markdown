# React Hooks 与 Provider

上下文 Hooks 从外层的 React 渲染器树读取状态。其中的稳定性辅助函数也可用于其他 React 组件。组件属性请参阅 [React 属性参考](react-props.md)。平滑节奏控制 Hooks 请参阅[平滑流式输出 API](../smooth-streaming.md#api-reference)；文档注册表访问请参阅 [`useDocumentRegistry`](../../reference/react.md#usedocumentregistrydocumentid)。Vue 提供了[独立的 setup 组合式函数](../../reference/vue.md#composable-reference)。

## Hooks <a id="hooks"></a>

渲染状态被拆分在**五个独立的系统上下文**中。每个窄订阅 Hook 仅订阅其中一个系统，因此无关上下文的更新不会通知该 Hook。普通的父组件渲染规则仍然适用。所有 Hook 在对应的 Provider 边界之外调用时均会抛出错误（`useAIMarkdownMetadata` 除外，在未提供元数据时返回 `undefined`）。

### 五个窄订阅 Hook

| Hook                                 | 返回内容                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `useAIMarkdownState()`               | `{ streaming, …扩展状态组 }`                                             |
| `useAIMarkdownTheme()`               | `{ fontSize, variant, colorScheme }`                                     |
| `useAIMarkdownDocument()`            | `{ documentId, documentIdExplicit, clobberPrefix }`                      |
| `useAIMarkdownBehaviors()`           | `{ blockMemo, incrementalParse, preserveOrphanReferences, …扩展行为组 }` |
| `useAIMarkdownMetadata<TMetadata>()` | `TMetadata \| undefined`                                                 |

```tsx
import type { PropsWithChildren } from 'react';
import { useAIMarkdownState, useAIMarkdownTheme } from '@ai-markdown/react';

function CustomCodeBlock({ children }: PropsWithChildren) {
  const { streaming } = useAIMarkdownState();
  const { colorScheme } = useAIMarkdownTheme();

  if (streaming) {
    return <pre className={`streaming ${colorScheme}`}>{children}</pre>;
  }
  return <pre className={colorScheme}>{children}</pre>;
}
```

字段说明：

| 字段                                                          | 来源 Hook                  | 类型                    | 说明                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------- | -------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `streaming`                                                   | `useAIMarkdownState()`     | `boolean`               | 是否正在以流式接收内容。                                                                                                                                                                                                                                                                  |
| `fontSize`                                                    | `useAIMarkdownTheme()`     | `string`                | 计算后的 CSS 字体大小值。                                                                                                                                                                                                                                                                 |
| `variant`                                                     | `useAIMarkdownTheme()`     | `AIMarkdownVariant`     | 当前生效的排版变体。                                                                                                                                                                                                                                                                      |
| `colorScheme`                                                 | `useAIMarkdownTheme()`     | `AIMarkdownColorScheme` | 当前生效的配色方案。                                                                                                                                                                                                                                                                      |
| `documentId`                                                  | `useAIMarkdownDocument()`  | `string`                | 逻辑 Markdown 文档的稳定 ID，由调用方显式传入或通过 `useId()` 自动生成。                                                                                                                                                                                                                  |
| `documentIdExplicit`                                          | `useAIMarkdownDocument()`  | `boolean`               | `documentId` 是否为调用方显式传入（而非自动生成）。用于内部协调信号，`useDocumentRegistry` 借此确保自动生成的 ID 不会将独立片段纳入跨片段协调。大多数自定义组件可忽略此字段。                                                                                                             |
| `clobberPrefix`                                               | `useAIMarkdownDocument()`  | `string`                | 源自 `documentId` 的 URI 安全 ID 前缀（超过 16 字符的 ID 会经过 MurmurHash3 → Base62 缩写处理），用于所有防覆盖的 HTML 属性（`id=…` / `href="#…"`）。编写输出锚点的组件时，请从 Hook 中读取此值，不要在本地自行重新计算——该前缀的具体字节格式属于内部实现细节，在版本升级中可能发生调整。 |
| `blockMemo` / `incrementalParse` / `preserveOrphanReferences` | `useAIMarkdownBehaviors()` | `boolean`               | 解析后的行为开关，名称与平铺属性保持一致。                                                                                                                                                                                                                                                |

### `useAIMarkdown()` — 聚合 Hook

在自定义渲染器内部，可从 `@ai-markdown/react` 导入 `useAIMarkdown` 读取聚合状态：

```tsx
const { document, metadata, state, theme, behaviors } = useAIMarkdown();
```

该 Hook 会订阅**全部五个上下文**，任何一项变更（包括每次 `streaming` 切换）都会触发重渲染。适合教学示例以及低频渲染的组件；对性能敏感的组件应改用窄订阅 Hook。

### `useAIMarkdownMetadata<TMetadata>()`

从元数据上下文中读取应用程序数据。Hook 返回 `TMetadata | undefined`；其泛型为编译期类型断言，无法在运行时校验是哪个组件提供了该值。

```tsx
import { useRef, type PropsWithChildren } from 'react';
import { useAIMarkdownMetadata, type AIMarkdownMetadata } from '@ai-markdown/react';

interface MyMetadata extends AIMarkdownMetadata {
  onCopyCode: (source: string) => void;
}

function CustomCodeBlock({ children }: PropsWithChildren) {
  const preRef = useRef<HTMLPreElement>(null);
  const metadata = useAIMarkdownMetadata<MyMetadata>();
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          metadata?.onCopyCode(preRef.current?.textContent ?? '');
        }}
      >
        Copy
      </button>
      <pre ref={preRef}>{children}</pre>
    </div>
  );
}
```

这个小型渲染器从真实的 `<pre>` 中提取可见的代码文本，并将复制按钮置于其外。如果直接调用 `String(children)`，会将其作为 React 元素转换为字符串，而无法恢复原始代码。对于存在 AST 转换的展示场景，建议改从 hast 节点中保留原始源码；[自定义组件指南](https://ai-markdown.github.io/docs/guides/custom-components/)提供了更完整的实现方案。

元数据在传递时不会进行深比较包装。若数值未发生变化，请复用稳定的对象引用；若响应式元数据发生变更，再传入新的对象。包含回调函数或外部 Store 的稳定容器适合承载高频应用数据，但仅修改 Ref 内部属性并不会触发 React 视图重新渲染。

### `useStableValue<T>(value: T)`

返回具有引用稳定性的 `value`。在每次渲染中，新值会与上一次提交的值进行深比较（基于 `lodash/isEqual`）。如果结构相同，则返回上一次的引用，以便下游的 `useMemo`/`useEffect` 依赖能够保持其引用一致性。保留的引用只在提交阶段推进，渲染中断时不会推进。切勿就地修改保留的对象；当业务含义改变时，应传入新对象。

```tsx
import { useStableValue } from '@ai-markdown/react';

export function useStableConfig(config: { compact: boolean }) {
  return useStableValue(config);
}
```

### `useStableRecord(record, table)`

适配器内部使用的引用稳定防火墙，已导出供封装层开发者使用。根据针对每个键的 `AIMarkdownStabilityPolicy` 策略表，返回具有引用稳定性的 `record`：

- `DEEP_EQUAL` — 当新值深比较相等时，恢复上一次的引用（适用于纯数据属性）。
- `WARN_ONLY` — 直接透传，但多次引用变化后在开发环境下发出警告（适用于函数或组件，在此深比较没有意义）。
- `PASS_THROUGH` — 显式声明的豁免项，不进行稳定化处理（如 `metadata`）。

仅返回表中声明的键；未在表中列出的键会被丢弃。保持策略表本身稳定，并将返回的值视为不可变对象。

封装层只需为自身使用的对象属性构建策略表（例如 Mantine 的 `codeBlock`）；透传给 `<AIMarkdown>` 的平铺属性会直接经过 React 适配器的防火墙处理。

```tsx
import { useStableRecord, AIMarkdownStabilityPolicy, type AIMarkdownStabilityTable } from '@ai-markdown/react';

interface PanelOptions {
  compact: boolean;
}

const TABLE: AIMarkdownStabilityTable<{ panel: Partial<PanelOptions> | undefined }> = {
  panel: AIMarkdownStabilityPolicy.DEEP_EQUAL,
};

export function usePanelOptions(panel: Partial<PanelOptions> | undefined) {
  return useStableRecord({ panel }, TABLE);
}
```

## Additive Providers <a id="additive-providers"></a>

React 适配器导出了两个可叠加的 Provider：`AIMarkdownBehaviorsProvider` 与 `AIMarkdownStateProvider`，使封装层和应用程序能够通过 React 适配器的上下文传递自定义扩展组。将 Provider 叠加包裹在 `<AIMarkdown>` **外层**；下游使用者依然只读取单一上下文：

```tsx
import { useMemo } from 'react';
import AIMarkdown, {
  AIMarkdownBehaviorsProvider,
  type AIMarkdownBehaviorGroups,
  type AIMarkdownProps,
} from '@ai-markdown/react';

type MyMarkdownProps = AIMarkdownProps & { panel?: { compact: boolean } };

const NO_GROUPS: AIMarkdownBehaviorGroups = Object.freeze({});

function MyMarkdown({ panel, ...rest }: MyMarkdownProps) {
  // Absent prop → contribute NO group (an outer app-level Provider's
  // `panel` group then stays visible); present prop wins via inner-wins.
  const groups = useMemo<AIMarkdownBehaviorGroups>(() => (panel != null ? { panel } : NO_GROUPS), [panel]);
  return (
    <AIMarkdownBehaviorsProvider value={groups}>
      <AIMarkdown {...rest} />
    </AIMarkdownBehaviorsProvider>
  );
}
```

- **内置 React 属性键已被锁定**。行为配置（`blockMemo`、`incrementalParse`、`preserveOrphanReferences`）和状态（`streaming`）无法从外部注入——在类型层面已被禁止，在最内层合并时会被平铺属性无条件覆盖，并在开发环境下发出告警。
- 多层封装自然支持嵌套叠加；遇到重复的组键时，以最内层为准。
- `AIMarkdownStateProvider` 用于传递扩展生命周期状态（例如 aborted、reasoning、tool-call-in-progress 等）。组内成员应保持消息级生命周期的更新频率——高频帧率数据（如逐字生成进度）仍应通过元数据的稳定容器模式传递。
- 在封装层的窄 Hook 中统一应用一次组默认值（如 Mantine 内部的 `useMantineCodeBlockOptions()` 模式）；在多个读取点使用 `??` 回退容易导致默认值不一致。

### 组键注册表 <a id="group-key-registry"></a>

在整个封装层和应用程序中，组键在每个上下文（behaviors、state）中共享同一命名空间。遇到重复的组键时，会**静默按内层优先**覆盖。因此该注册表起到了命名防冲突的治理作用，其机制与 [React 属性参考](../../reference/react.md#props-api-reference)规范平铺属性名相同。封装库发布前请通过 PR 在此登记；应用程序建议使用应用前缀命名（如 `chatPanel` 而非 `panel`），避免与未来的封装库键冲突。

| 组键        | 所属上下文 | 维护方                       |
| ----------- | ---------- | ---------------------------- |
| `codeBlock` | behaviors  | `@ai-markdown/react-mantine` |

**预留策略**：React 适配器承诺在稳定的大版本周期内（预发布阶段 API 仍可能调整），不会将已登记的组键升级为核心锁定键（带有 `never` 类型的内部锁定键）——因为这种升级会直接破坏使用了该键的下游代码编译，因此按规范必须作为破坏性变更在大版本中进行。

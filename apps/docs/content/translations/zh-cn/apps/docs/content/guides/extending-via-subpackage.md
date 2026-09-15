# 构建 React 设计系统集成包

本文档中的所有示例均面向当前稳定统一发布版本。在分发自定义集成包时，请严格匹配 React 的 Peer 依赖范围；关于安装与包边界规范请参阅 [快速上手](getting-started.md)。

在此架构中，底层基础渲染器、其 props 属性定义、各级 Context Provider 以及 Hooks 均由 `@ai-markdown/react` 提供。完全独立的 `@ai-markdown/core` 提供框架无关的跨片段编排能力，其内部不包含任何 React Context 或 UI 渲染 API。UI 维度的第三方集成包将 React 适配器作为 Peer 依赖引入；而框架层适配器则直接依赖共享的 core 与 engine。

构建 React 集成包的标准途径是：对外层包装 `@ai-markdown/react`，并围绕其封装专属于你的设计系统（Design System）交互行为。`@ai-markdown/react-mantine` 是官方标准的参考实现：它负责提供排版系统、代码块增强呈现、主题默认值以及强类型的行为配置项；而底层的 React 适配器及其共享依赖则全权提供语法解析、安全清洗、跨片段引用以及流式呈现。

本指南遵循完全相同的工程架构，分九个步骤系统拆解如何从零构建集成包：从行为分组接口定义一直到包根模块的公共导出与 Peer 依赖声明。文中的 `Your…` 组件与 `your-design-system` 仅作为占位模板名称，供你在自己的包中替换实现。示例代码清晰揭示了必须遵守的接口契约、默认值的收敛源头以及每个属性的归属权。

请始终使用 React 适配器官方导出的公共 props、插槽、累加式 Provider、稳定化辅助函数以及工厂函数。React 设计系统集成层完全不需要直接引入 engine 的底层模块。Engine 与共享 core 属于面向适配器作者的公共底层包，其公开记录的导出接口自 3.0.0 起严格遵循语义化版本规范。构建非 React 的框架适配器属于完全不同的工程命题：它需要直接使用语法树、严格锁定匹配的 core 与 engine 版本、并对自身的渲染生命周期承担全责。[Vue 适配器](../reference/vue.md) 是现存的第二个官方框架实现；若构建 Vue UI 集成，请直接使用其公开的组件。

<span id="the-extension-points-at-a-glance"></span>

## 核心扩展点一览

| 扩展点名称                                        | 承载的数据与职责                                                                                      | 传输与分发通道                                                        |
| :------------------------------------------------ | :---------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------- |
| 外层包装的**行为分组**（如 `codeBlock`）          | 组件层面的可调交互参数——运行时可动态切换，开销仅限于叶子组件局部重渲染                                | 包装组件的平铺 prop → `AIMarkdownBehaviorsProvider` → 专属细粒度 Hook |
| **状态分组（State groups）**                      | 针对集成层的消息生命周期状态（已终止 aborted、思考中 reasoning、工具调用中 tool-call-in-progress 等） | `AIMarkdownStateProvider` → 通过 `useAIMarkdownState()` 读取          |
| `Typography` / `ExtraStyles` / `customComponents` | 设计系统专属的视觉呈现                                                                                | 通过解构赋予默认值，作为普通 props 原样透传给底层                     |
| `enginePlugins`                                   | **仅限于集合编排**——打包默认预设、过滤剔除、语法糖封装                                                | 作为 prop 透传；任何解析语法层面的新能力必须向上游 engine 提交 PR     |
| 引擎层负载（`sanitizeSchema`、预处理器等）        | 你的业务特性可能依赖的底层流水线输入                                                                  | 作为 prop 透传；必须为每项负载明确声明注入策略（参见步骤 6）          |

状态分组通道受两大约束规范制约：

- **频次契约（Frequency contract）**：状态分组必须属于消息生命周期频次（流开始/结束、取消终止、工具调用发起/结束时触发翻转）。高频的帧级数据（如逐 Token 进度等）必须改走元数据的稳定容器订阅模式。
- **内置属性锁（Built-in prop locks）**：外层的 Provider 不能篡改库内置的核心字段（state 中的 `streaming`；behaviors 中的 `blockMemo` / `incrementalParse` / `preserveOrphanReferences`）。三重物理锁强力保障该规则：Provider 的 `value` 类型将内置键标记为 `never`（触发 TS 编译报错）；React 适配器最内层的解构展开无条件覆盖外层同名键（依赖对象的展开顺序）；开发构建中若检测到外层携带内置键会抛出控制台警告。

封闭的 `enginePlugins` 集合是深思熟虑的架构边界：增量解析引擎的边界扫描器必须事先获知所有语法的结构特征，开放任意插件注入会直接彻底击溃其等价性验证记录。上层包装负责编排挑选；底层 engine 负责定义经过严密验证的流水线，React 适配器则提供其封闭受控的插件目录。第三方在**内容层**的扩展依然通过 `contentPreprocessors` + `customComponents` 保持完全开放。

---

<span id="the-mantine-model"></span>

## Mantine 官方包的架构模型

```text
@ai-markdown/react-mantine
├── MantineAIMarkdown (wrapper component)
│   ├── Typography = MantineAIMarkdownTypography     ← Mantine <Typography> wrapper
│   ├── ExtraStyles = MantineAIMDefaultExtraStyles   ← CSS scoping for em-based tokens
│   ├── customComponents.pre = MantineAIMPreCode     ← CodeHighlight + Mermaid + JSON pretty-print
│   ├── codeBlock prop → AIMarkdownBehaviorsProvider ← the wrapper's behavior group
│   └── colorScheme = Mantine provider scheme / system query (when not overridden)
│
├── defs.tsx
│   ├── MantineCodeBlockOptions + defaultMantineCodeBlockOptions
│   └── MantineAIMarkdownMetadata (extends AIMarkdownMetadata)
│
├── define.ts
│   └── defineMantineBehaviors (widened factory: built-in behavior fields + codeBlock)
│
└── hooks/
    ├── useMantineCodeBlockOptions   (THE single assertion + defaults site for the group)
    └── useMantineAIMarkdownMetadata
```

每一块积木均完全基于 React 适配器现有的公开 API 组装而成——不存在任何特殊的“集成私有通道”。你的集成子包完全可以遵循相同的物理结构，仅需将 Mantine 替换为你自身的设计系统。

---

<span id="step-1-define-your-behavior-group"></span>

## 步骤 1：定义行为选项分组

一个分组由一个纯 TypeScript 接口加上一份被深层冻结的默认值组成。不继承无关配置对象，不盲目混入 React 适配器的默认值——分组在逻辑上必须完全自洽闭环：

```ts
// packages/your-integration/src/defs.ts
import type { AIMarkdownMetadata } from '@ai-markdown/react';

export interface YourCodeBlockOptions {
  showCopyButton: boolean;
  defaultLanguage: string;
}

/** Shipped defaults — applied inside the narrow hook (Step 3), nowhere else. */
export const defaultYourCodeBlockOptions: Readonly<YourCodeBlockOptions> = Object.freeze({
  showCopyButton: true,
  defaultLanguage: 'plaintext',
});

export interface YourAIMarkdownMetadata extends AIMarkdownMetadata {
  // Extension point — keep empty or add integration-specific fields.
}
```

在为分组的 _prop_ 字段命名之前，请查阅 [React 参考文档](../reference/react.md#props-api-reference) 中的 props 属性注册表：平铺的 props 在 React 适配器与所有外层包装层之间共享同一个顶层命名空间（参见 [常见隐患](#footguns)）。

---

<span id="step-2-build-the-wrapper-component"></span>

## 步骤 2：构建外层包装组件

包装组件主要承担四项职责：为插槽组件赋予默认值、合并 `customComponents`、针对自身终结使用的 props 运行专属的稳定性防护网（Stability firewall）、并通过累加式 Provider 向下注入行为分组。这完全对齐了 `packages/react-mantine/src/MantineAIMarkdown.tsx` 的实现：

```tsx
// packages/your-integration/src/YourAIMarkdown.tsx
import { memo, useMemo } from 'react';
import AIMarkdown, {
  type AIMarkdownProps,
  type AIMarkdownCustomComponents,
  type AIMarkdownBehaviorGroups,
  type AIMarkdownStabilityTable,
  AIMarkdownBehaviorsProvider,
  AIMarkdownStabilityPolicy,
  useStableRecord,
  useStableValue,
} from '@ai-markdown/react';

import YourTypography from './components/Typography';
import YourExtraStyles from './components/ExtraStyles';
import YourPreCode from './components/PreCode';
import type { YourAIMarkdownMetadata, YourCodeBlockOptions } from './defs';

export interface YourAIMarkdownProps<
  TMetadata extends YourAIMarkdownMetadata = YourAIMarkdownMetadata,
> extends AIMarkdownProps<TMetadata> {
  /** Your behavior group. Atomic replacement; defaults applied inside the narrow hook. */
  codeBlock?: Partial<YourCodeBlockOptions>;
}

/**
 * Stable empty CONTRIBUTION for the absent-prop case. Deliberately carries
 * no `codeBlock` key: contributing `codeBlock: {}` would shadow a group
 * provided by an outer app-level Provider (inner-wins merge) even though
 * your wrapper has nothing to say.
 */
const NO_GROUPS: AIMarkdownBehaviorGroups = Object.freeze({});

/**
 * Your stability-firewall table — rows ONLY for object props this wrapper
 * TERMINATES (consumes in its own machinery). Forwarded object props ride
 * the React adapter's firewall untouched; derived values (the merged `customComponents`
 * below) are caught by the React adapter's wall.
 */
const STABILITY_TABLE: AIMarkdownStabilityTable<{
  codeBlock: Partial<YourCodeBlockOptions> | undefined;
}> = {
  codeBlock: AIMarkdownStabilityPolicy.DEEP_EQUAL,
};

const DEFAULT_COMPONENTS: AIMarkdownCustomComponents = {
  pre: YourPreCode,
  // …add more if your integration overrides other elements
};

const YourAIMarkdownComponent = <TMetadata extends YourAIMarkdownMetadata = YourAIMarkdownMetadata>({
  Typography = YourTypography,
  ExtraStyles = YourExtraStyles,
  customComponents,
  codeBlock,
  ...rest
}: YourAIMarkdownProps<TMetadata>) => {
  const stableCustomComponents = useStableValue(customComponents);

  // Merge: caller overrides win over your defaults.
  const usedComponents = useMemo(
    () => (stableCustomComponents ? { ...DEFAULT_COMPONENTS, ...stableCustomComponents } : DEFAULT_COMPONENTS),
    [stableCustomComponents]
  );

  // Your firewall: `codeBlock` is terminated here (it feeds the Provider
  // below, not the React prop surface).
  const stable = useStableRecord({ codeBlock }, STABILITY_TABLE);

  // Contribute the group through the additive behaviors Provider — firewall
  // output used directly, record identity memoized so the context value
  // stays stable across unrelated re-renders. `null`/absent prop ≡ NO
  // contribution (not an empty group): an outer app-level Provider's group
  // stays visible; when the prop IS present, inner-wins gives it precedence.
  const behaviorGroups = useMemo<AIMarkdownBehaviorGroups>(
    () => (stable.codeBlock != null ? { codeBlock: stable.codeBlock } : NO_GROUPS),
    [stable.codeBlock]
  );

  return (
    <AIMarkdownBehaviorsProvider value={behaviorGroups}>
      <AIMarkdown<TMetadata>
        Typography={Typography}
        ExtraStyles={ExtraStyles}
        customComponents={usedComponents}
        {...rest}
      />
    </AIMarkdownBehaviorsProvider>
  );
};

export const YourAIMarkdown = memo(YourAIMarkdownComponent) as typeof YourAIMarkdownComponent & {
  displayName?: string;
};
YourAIMarkdown.displayName = 'YourAIMarkdown';
export default YourAIMarkdown as typeof YourAIMarkdownComponent;
```

**核心要点**：

- Provider 必须包裹在 `<AIMarkdown>` 的**最外层**。React 适配器最内层的 Provider 会读取你在外层注入的 Context，并在向下提供时执行 `{ ...outer, ...coreResolved }` 合并——下游使用方看到的是唯一的 behaviors Context，且官方内置核心键始终保持绝对最高优先级。
- 自身专有的标量 props 通过参数解构赋予默认值，通过 rest 解构将其剥离，随后透传 `{...rest}`。rest 对象本身的引用无需进行任何稳定化缓存——JSX 展开语法会将其扁平打散为独立的原子属性，React 会逐一比对它们。
- 稳定性防护网准则：你的 `useStableRecord` 表格中**仅声明由本层组件终结使用的属性**（Mantine 当前仅有一项：`codeBlock`）。透传给底层的属性绝不要在此处触动——每个属性由真正使用它的那一层架构执行唯一一次精准的稳定化处理。
- 顶层组件使用 `memo` 包裹；合并 `customComponents` 时采用调用方覆盖优先的展开顺序（`{ ...DEFAULT_COMPONENTS, ...callerComponents }`）。

---

<span id="step-3-the-narrow-hook-the-single-assertion-defaults-site"></span>

## 步骤 3：封装细粒度 Hook——唯一的类型断言与默认值收敛处

官方的 `useAIMarkdownBehaviors()` 是非泛型的，返回内置的核心开关外加一个不透明的扩展字典对象。你的细粒度 Hook 正是执行类型断言（严格仅此一处）并应用分组默认值（严格仅此一处）的权威收敛地：

```ts
// packages/your-integration/src/hooks/useYourCodeBlockOptions.ts
import { useMemo } from 'react';
import { useAIMarkdownBehaviors } from '@ai-markdown/react';
import { defaultYourCodeBlockOptions, type YourCodeBlockOptions } from '../defs';

export function useYourCodeBlockOptions(): Required<YourCodeBlockOptions> {
  const behaviors = useAIMarkdownBehaviors();
  // The single assertion: the `codeBlock` group key is owned by this package,
  // contributed by `YourAIMarkdown` via its behaviors Provider.
  const group = behaviors.codeBlock as Partial<YourCodeBlockOptions> | undefined;
  return useMemo(
    () => ({
      showCopyButton: group?.showCopyButton ?? defaultYourCodeBlockOptions.showCopyButton,
      defaultLanguage: group?.defaultLanguage ?? defaultYourCodeBlockOptions.defaultLanguage,
    }),
    [group]
  );
}
```

上述示例将空值字段视为未传入。请明确制定该回退策略：简单的对象解构展开会导致显式传入的 `undefined` 错误覆盖默认值。Mantine 会跳过 undefined 字段并对数值型的高亮间隔进行独立校验。

分组的值在传输层是原子级整体替换的；传入的部分局部配置（如 `codeBlock={{ showCopyButton: false }}`）在此处将其省略的缺省字段解析补齐为官方默认值。所有组件读取处必须统一调用此 Hook，**严禁在使用处使用 `??` 裸操作符重复打补丁**（参见 [常见隐患](#footguns)）。

元数据 Hook 依然是简洁的一行代码封装：

```ts
// packages/your-integration/src/hooks/useYourMetadata.ts
import { useAIMarkdownMetadata } from '@ai-markdown/react';
import type { YourAIMarkdownMetadata } from '../defs';

export const useYourMetadata = () => useAIMarkdownMetadata<YourAIMarkdownMetadata>();
```

---

<span id="step-4-the-widened-define-factory"></span>

## 步骤 4：提供宽化的 `define*` 工厂函数

官方的工厂函数仅接受内置核心字段——直接向官方的 `defineBehaviors` 传入 `codeBlock` 会触发 TypeScript 编译报错。提供宽化后的工厂函数是你的义务（对齐 `packages/react-mantine/src/define.ts`）：

```ts
// packages/your-integration/src/define.ts
import type { AIMarkdownBehaviorProps } from '@ai-markdown/react';
import type { YourCodeBlockOptions } from './defs';

export interface YourBehaviorProps extends AIMarkdownBehaviorProps {
  codeBlock?: Partial<YourCodeBlockOptions>;
}

/** Identity + your types + freeze; zero logic. */
export function defineYourBehaviors(values: YourBehaviorProps): Readonly<YourBehaviorProps> {
  return Object.freeze(values);
}
```

业务开发者可以直接展开被冻结的配置片段；运行时动态变动的属性放置在展开之后（后声明的属性胜出）：

```tsx
const BEHAVIORS = defineYourBehaviors({ blockMemo: true, codeBlock: { showCopyButton: false } });

<YourAIMarkdown content={content} {...BEHAVIORS} streaming={!done} />;
```

---

<span id="step-5-design-system-components"></span>

## 步骤 5：实现设计系统专属组件

<span id="typography-wrapper"></span>

### 排版包装容器（Typography）

```tsx
// packages/your-integration/src/components/Typography.tsx
import type { AIMarkdownTypographyComponent } from '@ai-markdown/react';
import { Box, useTheme } from 'your-design-system';

const YourTypography: AIMarkdownTypographyComponent = ({ children, fontSize, variant, colorScheme, style }) => {
  const theme = useTheme();
  return (
    <Box
      data-variant={variant}
      data-color-scheme={colorScheme}
      style={{
        fontSize,
        fontFamily: theme.fonts.body,
        ...style, // ← MUST spread style for --aim-font-size-root to reach descendants
      }}
    >
      {children}
    </Box>
  );
};

export default YourTypography;
```

关于完整的 Typography 接口契约以及为什么必须展开透传 `style`，请参阅 [自定义排版容器](custom-typography.md)。

<span id="extra-styles-wrapper"></span>

### 额外样式容器（ExtraStyles）

```tsx
// packages/your-integration/src/components/ExtraStyles.tsx
import type { AIMarkdownExtraStylesComponent } from '@ai-markdown/react';

const YourExtraStyles: AIMarkdownExtraStylesComponent = ({ children }) => (
  <div className="your-integration-scope">{children}</div>
);

export default YourExtraStyles;
```

为该组件配套提供一份 CSS 样式文件，在 `.your-integration-scope` 类名下编写专属于你的设计系统的 em 相对单位覆盖或主题变量规则。

<span id="the-precode-component-if-you-override-code-blocks"></span>

### 代码块组件（若接管代码块呈现）

覆盖 `pre` 渲染器会同时接收到已转换的 children 与底层的 hast 节点。在替换元素前，务必对节点结构进行严格的防御性检查。标准的 Markdown 围栏代码块通常生成一个包含纯文本子节点的 `<code>` 子元素；而任意手写的原始 HTML 可能会具备完全不同的结构或属性，导致你的高亮器无法安全处理。

```tsx
// packages/your-integration/src/components/PreCode.tsx
import type { ComponentProps } from 'react';
import type { Element } from 'hast';
import { useAIMarkdownState } from '@ai-markdown/react';
import { useYourCodeBlockOptions } from '../hooks/useYourCodeBlockOptions';
import YourHighlightedBlock from './HighlightedBlock';
import YourMermaidBlock from './MermaidBlock';
import YourJsonBlock from './JsonBlock';

type PreProps = ComponentProps<'pre'> & {
  node?: Element;
};

function YourPreCode({ node, children, ...props }: PreProps) {
  const { streaming } = useAIMarkdownState();
  const { showCopyButton, defaultLanguage } = useYourCodeBlockOptions();
  const code = node?.children.length === 1 ? node.children[0] : undefined;
  if (
    !node ||
    Object.keys(node.properties).length !== 0 ||
    code?.type !== 'element' ||
    code.tagName !== 'code' ||
    !node.position ||
    !code.position ||
    Object.keys(code.properties).some((key) => key !== 'className') ||
    code.children.some((child) => child.type !== 'text')
  ) {
    return <pre {...props}>{children}</pre>;
  }
  const classes = code.properties.className;
  if (
    classes != null &&
    (!Array.isArray(classes) || classes.some((c) => typeof c !== 'string' || !c.startsWith('language-')))
  )
    return <pre {...props}>{children}</pre>;

  const language = Array.isArray(classes)
    ? classes.find((c): c is string => typeof c === 'string')?.slice('language-'.length)
    : undefined;
  const source = code.children.map((child) => (child.type === 'text' ? child.value : '')).join('');

  if (language === 'mermaid') return <YourMermaidBlock source={source} />;
  if (language === 'json') return <YourJsonBlock source={source} />;
  return (
    <YourHighlightedBlock
      source={source}
      language={language ?? defaultLanguage}
      showCopy={!streaming && showCopyButton}
    />
  );
}

export default YourPreCode;
```

请在包的开发依赖中声明 `@types/hast`（如果构建产物的类型声明中暴露了它，也需让外部使用方能访问到）。`node` 属性属于渲染器元数据，**不能**直接作为 DOM 属性展开到最终的 HTML 元素上。

上述三个视觉呈现组件均属于集成包私有的内部模块。它们接收到的 `source` 是精确的代码纯文本，且完整保留了末尾换行符。如果你需要格式化 JSON 或在界面上隐藏末尾空行，请单独计算用于展示的字符串；复制操作应当始终保留原始数据。切勿在仅有的一份源码副本上调用 `trimEnd()`。

两个 Hook 均在语法树结构校验之前无条件执行。State 与 behaviors 采用完全隔离的独立 Context，因此流式状态的翻转能够及时唤醒该组件刷新复制按钮状态，而无需强制纯行为订阅者跟着重渲染。请将复制按钮与操作工具栏放置在真实的 `<pre>` 元素外部，确保在降级使用纯文本提取时不会把按钮上的文案错误复制进去。

---

<span id="step-6-payload-policy-declare-it-per-payload"></span>

## 步骤 6：明确针对引擎层负载的注入策略

针对每一项引擎层负载输入（`contentPreprocessors`、`urlTransform`、`sanitizeSchema`、`customComponents`），请明确挑选以下两种立场之一，并在集成包的规范中予以公示：

- **业务特性强依赖此配置** → 无条件在底层注入。对于 `contentPreprocessors`，必须固定并在文档中明确注入位置（前置 prepend 还是后置 append——顺序直接决定语义）。
- **其余配置** → 完全以用户传入的值为准，并在包中公开导出你的原始积木供用户按需手动组合。

以 Mantine 在第二种立场下的实践为例：Mantine 不会静默隐式注入 Schema 规则，因此若业务开发者在未借助 `extendSanitizeSchema` 的情况下直接全盘替换了 `sanitizeSchema`，会静默破坏依赖默认规则的一系列内置特性（跨片段占位符、KaTeX 类名）。请在文档中明确告知此类注意事项。

如果你提供了一个侧重性能的专属开关（例如假设的 `mermaid.lazyRender`），它并不能直接继承 React 适配器的逐字节等价性保证——你需要在自己的文档中为该特性的等价性独立背书。

---

<span id="step-7-index-barrel-exports"></span>

## 步骤 7：规范根模块入口导出（Index Barrel）

```ts
// packages/your-integration/src/index.ts
export type { YourAIMarkdownProps } from './YourAIMarkdown';
export { default } from './YourAIMarkdown';
export { default as YourTypography } from './components/Typography';
export { default as YourExtraStyles } from './components/ExtraStyles';
export type { YourAIMarkdownMetadata, YourCodeBlockOptions } from './defs';
export { defaultYourCodeBlockOptions } from './defs';
export { useYourCodeBlockOptions } from './hooks/useYourCodeBlockOptions';
export { useYourMetadata } from './hooks/useYourMetadata';
export { defineYourBehaviors } from './define';
export type { YourBehaviorProps } from './define';
```

保持与 `@ai-markdown/react-mantine` 入口一致的拓扑规范。重新导出排版与样式容器组件，方便下游开发者在其基础上二次包装或自由组合。

---

<span id="step-8-peer-dependencies"></span>

## 步骤 8：配置 Peer 依赖范围

```jsonc
// packages/your-integration/package.json
{
  "peerDependencies": {
    "@ai-markdown/react": "^3.0.2",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "your-design-system": "^1.0.0",
  },
  "dependencies": {
    // Direct deps your integration needs (e.g. a mermaid library, a syntax highlighter)
  },
}
```

**务必将 `@ai-markdown/react` 声明为 `peerDependencies`**——不能作为普通 direct 依赖打包。否则上层项目打包时可能打入两份 React 适配器运行时，导致 React Context 的引用一致性校验彻底失效（表现为所有 Hooks 均无法找到对应的 Provider 而集体报错）。

---

<span id="step-9-use-it"></span>

## 步骤 9：在应用中使用集成包

```tsx
import YourAIMarkdown from '@yourorg/ai-markdown-yourds';
import { YourDesignSystemProvider } from 'your-design-system';

function App() {
  return (
    <YourDesignSystemProvider>
      <YourAIMarkdown content="Hello **world**!" codeBlock={{ showCopyButton: false }} />
    </YourDesignSystemProvider>
  );
}
```

终端业务开发者完全不需要关心底层的 core 或 engine——直接安装你的集成包，即可享受完全对齐 Mantine 的开箱即用体验。

---

<span id="thirdlevel-extension-apps-stacking-their-own-provider"></span>

## 第三层扩展：应用程序级自由层叠 Provider

累加式 Provider 并非仅供官方或封装包专用。构建在你的包装组件之上（或直接构建在 React 适配器之上）的宿主应用，完全可以在其组件树外层按需层叠专属的分组配置：

```tsx
import { AIMarkdownBehaviorsProvider, AIMarkdownStateProvider } from '@ai-markdown/react';

// Integration-time groups: module scope.
const APP_BEHAVIORS = { chatPanel: { compactQuotes: true } };

function ChatMessage({ content, aborted, toolCallInProgress }: ChatMessageProps) {
  // Runtime state groups: memoized so the context value keeps its identity.
  const lifecycleGroups = useMemo(
    () => ({ lifecycle: { aborted, toolCallInProgress } }),
    [aborted, toolCallInProgress]
  );
  return (
    <AIMarkdownStateProvider value={lifecycleGroups}>
      <AIMarkdownBehaviorsProvider value={APP_BEHAVIORS}>
        <YourAIMarkdown content={content} />
      </AIMarkdownBehaviorsProvider>
    </AIMarkdownStateProvider>
  );
}
```

多层嵌套的 Provider 能够自然递归合并——当遇到重复的分组 key 时，**最内层胜出**。相同的铁律贯穿每一层级：内置核心键被绝对锁定（前文所述的三重物理锁）；状态分组必须遵守消息生命周期的低频变动契约；传入的值应当经过防护网或 `useMemo` 处理以维系 Context 值的引用稳定；应用层应当通过其自身的细粒度 Hook 使用对应分组。仅有 behaviors 与 state 支持这种向上层叠合并机制；theme 上下文处于保留状态（底层机制完备，待出现真实强烈诉求时开启）；document 上下文为封闭系统（其内部数据均为强数学推导的不变量——伪造 `clobberPrefix` 会彻底破坏锚点系统）；而 metadata 完全不需要 Provider（各层在 prop 传递阶段直接完成解构合并）。

已知开销：在同一个 Context 内部，不同分组之间的失效广播不是绝对隔离的——任一分组数据的变动，会导致订阅该 Context 的所有叶子组件均触发一次轻量重渲染。在当前架构规模下该开销完全可控；若个别业务线对隔离度有极致严苛的要求，可自行开辟私有 Context 作为逃生通道（两种方式可完全并存）。

---

<span id="tips-from-the-mantine-integration"></span>

## 来自 Mantine 官方实现的工程经验

| 工程实践                                                                               | 核心技术原因                                                                                 |
| :------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------- |
| 使用 `useStableRecord` 校验终结使用的对象属性；在合并前对外部组件使用 `useStableValue` | 每次渲染都重新分配合并后的新对象，会直接彻底清空块级缓存缓存                                 |
| 若未显式传入配色方案，自动从宿主设计系统中感知浅色/深色模式                            | 无需显式传递繁复属性，即可与外层宿主 UI 的明暗主题对齐                                       |
| 在 `ExtraStyles` 内部引入将设计系统间距/字号转换为 em 相对单位的 CSS                   | 确保 Markdown 内部元素能够严格跟随 `fontSize` 按比例缩放，不受外层设计系统绝对像素单位的干扰 |
| 将 `mermaid`（或任何重型第三方库）声明为**直接依赖**而非 Peer 依赖                     | 开发者既然主动启用了你的集成包特性，就不应再被强迫手动去安装繁琐的深层底层依赖               |
| 在最外层对包装组件使用 `memo` 包裹                                                     | 标准的 React 性能优化工程基线                                                                |

---

<span id="what-to-avoid"></span>

## 明确反面模式与开发禁区

<span id="reimplementing-the-pipeline"></span>

### 切勿推倒重写核心流水线

严禁私自分叉 `MarkdownContent` 或 remark/rehype 插件链。React 适配器内置的严密流水线正是你赖以构建的坚实基石；绕开它将直接导致丢失跨片段协调、块级缓存、LaTeX 增量预处理、安全清洗以及 CJK 标点排版等全部核心价值。请始终在官方公开的扩展点上进行组合开发。

<span id="trying-to-inject-engine-plugins"></span>

### 严禁强行注入未受控的 Engine 插件

`enginePlugins` 仅接受由 React 适配器导出的封闭插件对象——防伪印记是一个外部绝对无法自行构造的 `unique symbol`。这是深思熟虑的严格限制：增量解析引擎的全部验证资产（Fuzz 模糊测试、逐字节等价性）均基于一个完全闭环的语法集构建。你的编排权限仅限于：打包默认预设、过滤剔除（`defaultEnginePlugins.filter(...)`）以及提供语法糖。若业务确实需要引入全新的解析层语法，请向上游 engine 提交 PR 并完成适配器集成——这是明码标价的架构取舍。

<span id="choosing-the-peer-version-of-aimarkdownreact"></span>

### 正确配置 `@ai-markdown/react` 的 Peer 版本范围

针对稳定版 v3，当使用 3.0.0 引入的 API 时，应将 React 适配器的 Peer 依赖声明为 `^3.0.0`。如果完全对齐 Mantine 的包规范，请匹配其 [声明的 React Peer 范围](../reference/react-mantine.md#peer-dependencies)。当使用了后续小版本追加的新 API 时请相应提升最低版本，并在独立测试中验证该受支持的范围。旧版的 `^2.13.2` 依赖范围根本无法解析全新的发布列车包。

<span id="reexporting-internal-react-adapter-types"></span>

### 严禁重新导出内部私有类型

请严格使用 `AIMarkdownProps`、`AIMarkdownCustomComponents`、`AIMarkdownTypographyComponent`、`AIMarkdownStabilityTable` 等公开文档中明确记录的公共类型。如果你在开发中觉得必须使用某个内部私有类型，这本身就是一个明确的警示信号：要么应向上游提 issue 申请公开导出，要么应当寻找其他替代实现方案。

<span id="forgetting-to-test-cross-chunk-coordination"></span>

### 切勿遗漏跨片段协调机制的测试覆盖

`<AIMarkdownDocuments>` 能够完全透明地穿透作用于 `<YourAIMarkdown>`——但验证该特性的自动化测试必须切实包含在你的集成包测试套件中。Mantine 官方测试集中包含完备的对应测试；请对照镜像补齐。

---

<span id="footguns"></span>

## 常见问题

<span id="reapplying-group-defaults-at-read-sites"></span>

### 在数据读取端重复兜底默认值

分组默认值有且仅有一处归宿：收敛在你的细粒度 Hook 内部。如果某个组件直接读取 `behaviors.codeBlock` 并在局部使用 `??` 裸操作符自行兜底，这不仅造成了默认值的代码重复，更会导致未来官方调整默认值时不同组件间的表现发生静默分歧。所有读取操作必须统一经由 Hook 获取。

<span id="propname-collisions"></span>

### 属性名称命名碰撞

所有平铺的 props 在 React 适配器以及所有外层包装层之间共享唯一平铺的命名空间。在向包装组件添加全新 prop 之前，请仔细核对 [React 参考文档](../reference/react.md#props-api-reference) 中的属性注册表。属性名碰撞对于 TypeScript 用户会在 `extends` 继承阶段直接报出编译错误——但对于纯 JavaScript 用户，则会引发**灾难性的静默属性覆盖**。在 Provider 内部的分组 key 上同样必须遵守该纪律：查阅 [分组 Key 注册表](api/react-hooks.md#group-key-registry) 并通过 PR 在该表中登记你的包专属 key——每个 Context 内部的分组 key 同样共享单一命名空间，重复的 key 会导致内层静默覆盖外层。应用局部的私有分组建议采用明确带有应用作用域的前缀（如 `chatPanel`，切忌使用通用的 `panel`）。

<span id="wholesalereplacing-sanitizeschema"></span>

### 全盘暴力替换 `sanitizeSchema`

任何调用方（或你的外层包装）若直接传入一个手工构造的 `sanitizeSchema`，会直接原子级整体覆盖底层规则——库内部不会执行任何自动合并。失去默认规则的支撑，跨片段占位符与 KaTeX 数学公式类名会被安全清洗器当场全部剔除。请始终通过 `extendSanitizeSchema` 构建 Schema（它始终基于包含全部内置不变量的官方副本进行扩展），并在你的 README 中向用户反复强调这一点。

---

<span id="distribution"></span>

## 发布与分发规范

将集成包作为独立的 `@yourorg/ai-markdown-…` npm 包发布是最自然的生态分发形态。社区不存在中心化的“集成注册表”——主要通过 npm 关键词、你的项目 README 以及 ai-markdown 广阔的开发者社区进行自发现。

在筹备发布时，请重点关注：

- 撰写一份完全参照 `@ai-markdown/react-mantine` 结构的严谨 README。
- 声明足够包容的 Peer 依赖范围（针对 React 和 React DOM 声明 `^19.0.0`；针对使用了稳定版 3.0.0 API 的集成，声明 `@ai-markdown/react: ^3.0.0`）。
- 标注精准的 npm 关键词：`react`, `markdown`, `ai`, `llm`, `<your-design-system>`, `ai-markdown-integration`。
- 主动公开包构建体积（贴上 bundlephobia 徽章）。

---

<span id="validate-the-published-integration-contract"></span>

## 验证发布后的集成包接口契约

在正式发布之前，请通过公共入口对包装组件进行全方位的端到端集成测试：确认调用方传入的自定义组件覆盖能够顺利胜出；未传入行为分组时外层的 Provider 能够正常穿透；传入部分行为分组时能以原子替换方式覆盖外层且省略字段能被细粒度 Hook 正常补齐。分别针对显式 `false`、显式 `undefined` 以及你文档中约定的空值策略进行完备测试。

既要测试单文档独立渲染，也要测试包含后置定义的双片段跨片段协调渲染。针对常规代码块、带有复杂属性的原始 `<pre>`、流式输出中的半截代码块、流式结束后的最终完整代码块、以及能够完整保留末尾空白的复制功能进行逐一验证。主题切换与流式结束应当能够平滑更新视觉呈现，而无需被迫重新传入全新的 Markdown 字符串。

最后，请检查打包生成的 ESM 与 CJS 入口文件、导出的 TypeScript 类型声明、样式表导出路径、Peer 依赖版本区间以及 `package.json` 中的 `sideEffects` 声明。你的 README 应当清晰列出必需的外层 Provider 与 CSS 引入语句、解释异步懒加载资源、列出所有对外导出的辅助函数、并提供指向 React 适配器基准文档的链接以供开发者查阅继承的属性。包的默认配置与代码复制策略应当是可被自动化测试清晰断言的确定性规范，而非含糊假定设计系统组件“刚好能这么工作”。

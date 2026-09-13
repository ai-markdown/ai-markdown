# 从 1.x 迁移到 2.0

这是 React 1.x → 2.x 的历史 API 迁移指南。若要采用当前的 3.0 稳定版相关包，还请一并遵循[从 ai-react-markdown 迁移到 ai-markdown](framework-transition.md)；旧版 React core 包现已更名为 `@ai-markdown/react`，而 `@ai-markdown/core` 则是与框架无关的独立包。

2.0 版本的迁移将原有的 `config` 和 `defaultConfig` 替换为组件平铺属性（flat props）、密封的引擎插件选择机制，以及分别用于文档标识、元数据、状态、主题与行为的独立 Context。原有的配置类型与渲染状态 Hook 已被彻底移除；升级过程需要更新导入路径与调用处代码，无法通过简单的兼容性开关过渡。

请使用下方的映射表格保留你的配置项，然后迁移自定义渲染器与包装组件默认值。变更前的代码片段故意使用了已移除的 1.x API；变更后的代码片段针对 2.x 设计。代码片段中的 `content`、`MY_SCHEMA` 以及应用包装类型等模板变量代表你项目中的实际代码。

最初的 2.0 变更旨在为相同配置保留 1.8.x 的渲染流水线行为。该历史兼容性论述并不保证后续所有 2.x 版本都能输出完全相同的 HTML：后续版本包含了针对解析器、安全清洗、协调机制与渲染逻辑的多项缺陷修复。若直接升级到当前版本，请阅读后续的[版本更新亮点](release-highlights.md)，并从语义层面对自定义输出进行验证。

<span id="why-the-break"></span>

## 产生破坏性变更的原因

1.x 的 `config` 配置对象存在四个结构性缺陷：

1. **快照老化（Snapshot rot）**：自定义的 `defaultConfig` 是一个完全冻结的快照；核心库后续新增的任何可选字段都会在该快照中静默缺失。这曾经导致过一个实际缺陷：手动编写且省略了 `incrementalParseEnabled` 的 `defaultConfig` 会静默关闭增量解析功能。
2. **调用方断言的泛型**：`useAIMarkdownRenderState<TConfig>()` 本质上是一个 TypeScript 无法校验的 `as` 类型断言。
3. **一个对象承担两种变更契约**：流水线层级的字段与组件偏好字段混合在同一个对象中，二者的重渲染开销有着天壤之别。
4. **合并语义的认知负担**：深度合并、数组全量替换以及不进行向后回填这三条规则分散在三处不同的逻辑中。

v2 使用平铺属性替代了复杂的配置对象（对照官方默认值仅解析一次），引入了密封的引擎插件清单，并将状态拆分到五个按系统划分的 Context 中。

<span id="field-mapping-exhaustive"></span>

## 字段映射（详尽对照）

| v1.x                                                         | v2.0.0                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `config.blockMemoEnabled` / `defaultConfig.blockMemoEnabled` | `blockMemo` 属性                                                          |
| `config.incrementalParseEnabled`                             | `incrementalParse` 属性                                                   |
| `config.preserveOrphanReferences`                            | `preserveOrphanReferences` 属性                                           |
| `config.extraSyntaxSupported`                                | `enginePlugins` 属性（插件对象 `highlight`、`definitionList`）            |
| `config.displayOptimizeAbilities`                            | `enginePlugins` 属性（插件对象 `removeComments`、`smartypants`、`pangu`） |
| `config.codeBlock.*`（mantine）                              | `MantineAIMarkdown` 上的 `codeBlock` 属性                                 |
| `defaultConfig`（集成商渠道）                                | 包装层解构默认值 + 扩展的 `define*` 工厂函数                              |

对于核心层解析的平铺字段，v2 中的优先级包含两个层级：显式传入的属性（`v != null`）将覆盖官方默认值；未传入的属性使用官方默认值。传入 `null` 等同于未传入——这可以防止序列化边界（如 RSC、持久化存储）将“未传入”具象化为 `null` 时破坏默认值行为。包装层插槽默认值与扩展组内部的字段拥有各自的策略：JavaScript 解构默认值仅对 `undefined` 生效，分组默认值归包装层 Hook 所有。切勿将核心层的 `null` 处理机制推论到每个嵌套字段上。

<span id="behavior-switches"></span>

### 行为开关

```tsx
// v1.x
<AIMarkdown
  content={content}
  config={{ blockMemoEnabled: false, incrementalParseEnabled: false }}
/>

// v2.0.0
<AIMarkdown content={content} blockMemo={false} incrementalParse={false} />
```

<span id="absence-semantics-flip-incrementalparse"></span>

### ⚠️ 缺省语义反转：`incrementalParse`

v1.x 将自定义 `defaultConfig` 中省略的 `incrementalParseEnabled` 视为**关闭**（快照老化陷阱）。v2.0.0 将缺省视为官方默认值，即**开启**。

```tsx
// v1.x — this custom defaultConfig silently DISABLED incremental parsing
// because the optional field is absent from the snapshot:
<AIMarkdown content={content} defaultConfig={myCompleteConfigWithoutIncrementalField} />

// v2.0.0 — absence means the shipped default (ON). To keep the old
// behavior, opt out explicitly:
<AIMarkdown content={content} incrementalParse={false} />
```

如果你的 1.x 应用此前依赖该陷阱（从未显式设置该字段，引擎保持关闭状态），你现在**必须**显式传入 `incrementalParse={false}` 才能保持原有行为。

<span id="enums--sealed-engine-plugins"></span>

### 枚举类型 → 封闭的引擎插件

原有的两个枚举类型被替换为一个接受核心库导出的密封插件对象的属性。请注意，单一属性现在同时覆盖了原有的两个枚举字段——传入数组将全量替换整个插件选项。

```tsx
// v1.x
import AIMarkdown, {
  AIMarkdownRenderExtraSyntax,
  AIMarkdownRenderDisplayOptimizeAbility,
} from '@ai-react-markdown/core';

<AIMarkdown
  content={content}
  config={{
    extraSyntaxSupported: [AIMarkdownRenderExtraSyntax.HIGHLIGHT],
    displayOptimizeAbilities: [AIMarkdownRenderDisplayOptimizeAbility.PANGU],
  }}
/>;

// v2.0.0
import AIMarkdown from '@ai-react-markdown/core';
import { highlight, pangu } from '@ai-react-markdown/core/plugins';

const PLUGINS = [highlight, pangu]; // module scope — stable reference

<AIMarkdown content={content} enginePlugins={PLUGINS} />;
```

推荐的“仅关闭某一个”写法：

```tsx
import { defaultEnginePlugins, pangu } from '@ai-react-markdown/core/plugins';

const PLUGINS = defaultEnginePlugins.filter((p) => p !== pangu);
```

需要了解的关键规则：

- 省略 `enginePlugins` 表示采用 `defaultEnginePlugins`（全部五个插件——与 1.x 官方默认配置等价）。
- 每个插件在生成的插件链中的位置取决于其内部阶段元数据；数组中元素的顺序并不影响执行顺序。重复项会被去重并在开发模式下给出警告。
- 插件集合是**密封的**：只有核心库能构建插件（增量引擎的边界扫描器必须明确知晓每项语法的规则；开放注入会破坏其验证记录）。第三方内容扩展依然通过 `contentPreprocessors` + `customComponents` 保持开放。
- 插件对象不可序列化。对于远程配置场景，请在数据中存储 `plugin.name` 字符串，并在应用边界处映射回导出的单例对象。

<span id="mantine-codeblock"></span>

### Mantine `codeBlock`

```tsx
// v1.x
<MantineAIMarkdown content={content} config={{ codeBlock: { defaultExpanded: false } }} />

// v2.0.0 — group value replaces atomically; omitted fields fall to defaults
<MantineAIMarkdown content={content} codeBlock={{ defaultExpanded: false }} />
```

<span id="hook-replacement-useaimarkdownrenderstate-is-deleted"></span>

## Hook 替代方案：`useAIMarkdownRenderState` 已移除

不提供垫片兼容层。旧渲染状态中的每个字段都有明确对应的窄粒度 Hook；窄粒度 Hook 仅在所属系统发生变化时才触发重渲染（`streaming` 的切换不再唤醒所有使用组件）：

| v1.x 读取方式                                                                         | v2.0.0 对应 Hook                                         |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `.config.blockMemoEnabled` / `.incrementalParseEnabled` / `.preserveOrphanReferences` | `useAIMarkdownBehaviors()`（名称与平铺属性一致）         |
| `.config.<wrapperField>`（例如 Mantine 的 `codeBlock`）                               | 包装层的窄粒度 Hook，例如 `useMantineCodeBlockOptions()` |
| `.streaming`                                                                          | `useAIMarkdownState().streaming`                         |
| `.fontSize` / `.variant` / `.colorScheme`                                             | `useAIMarkdownTheme()`                                   |
| `.documentId` / `.documentIdExplicit` / `.clobberPrefix`                              | `useAIMarkdownDocument()`                                |

```tsx
// v1.x
import { useAIMarkdownRenderState } from '@ai-react-markdown/core';

function MyCodeBlock() {
  const { streaming, fontSize, config } = useAIMarkdownRenderState();
  return <pre data-streaming={streaming} style={{ fontSize }} data-memo={config.blockMemoEnabled} />;
}

// v2.0.0
import { useAIMarkdownState, useAIMarkdownTheme, useAIMarkdownBehaviors } from '@ai-react-markdown/core';

function MyCodeBlock() {
  const { streaming } = useAIMarkdownState();
  const { fontSize } = useAIMarkdownTheme();
  const { blockMemo } = useAIMarkdownBehaviors();
  return <pre data-streaming={streaming} style={{ fontSize }} data-memo={blockMemo} />;
}
```

对于教学演示代码与低频变动的组件，提供了聚合 Hook：

```tsx
const { document, metadata, state, theme, behaviors } = useAIMarkdown();
```

它同时订阅全部五个 Context，并在**任何**变更时触发重渲染（包括每一次 `streaming` 翻转）——对性能敏感的组件应使用窄粒度 Hook。

`useMantineAIMarkdownRenderState` 同样被移除；请使用上述窄粒度 Hook 组合加上针对 `codeBlock` 分组的 `useMantineCodeBlockOptions()` 进行替代。

<span id="integrator-channel-defaultconfig--destructuring-defaults--factories"></span>

## 集成商渠道：`defaultConfig` → 解构默认值 + 工厂函数

过去提供扩展 `defaultConfig` 的 1.x 包装组件，现在应：

1. 通过参数解构为自身的标量属性提供默认值；
2. 通过 `AIMarkdownBehaviorsProvider`（嵌套在 `<AIMarkdown>` 外层）传递组件参数分组，并通过自己的窄粒度 Hook 读取它们——这是类型断言与分组默认值唯一共存的地方；
3. 为其扩展字段重新导出扩展后的 `define*` 工厂函数。

```tsx
// v1.x wrapper pattern (deleted)
export const myDefaultConfig: MyConfig = { ...defaultAIMarkdownRenderConfig, panel: { compact: false } };
export const useMyRenderState = () => useAIMarkdownRenderState<MyConfig>();

// v2.0.0 wrapper pattern
import { useMemo } from 'react';
import AIMarkdown, {
  AIMarkdownBehaviorsProvider,
  useAIMarkdownBehaviors,
  useStableRecord,
  AIMarkdownStabilityPolicy,
  type AIMarkdownProps,
  type AIMarkdownBehaviorGroups,
  type AIMarkdownStabilityTable,
} from '@ai-react-markdown/core';

interface PanelOptions {
  compact: boolean;
}
const PANEL_DEFAULTS: Readonly<PanelOptions> = Object.freeze({ compact: false });

interface MyMarkdownProps extends AIMarkdownProps {
  panel?: Partial<PanelOptions>;
}

const TABLE: AIMarkdownStabilityTable<{ panel: Partial<PanelOptions> | undefined }> = {
  panel: AIMarkdownStabilityPolicy.DEEP_EQUAL,
};

const NO_GROUPS: AIMarkdownBehaviorGroups = Object.freeze({});

export function MyMarkdown({ panel, ...rest }: MyMarkdownProps) {
  const stable = useStableRecord({ panel }, TABLE);
  // Absent prop → contribute NO group, so an outer app-level Provider's
  // `panel` group stays visible; a present prop wins via inner-wins.
  const groups = useMemo<AIMarkdownBehaviorGroups>(
    () => (stable.panel != null ? { panel: stable.panel } : NO_GROUPS),
    [stable.panel]
  );
  return (
    <AIMarkdownBehaviorsProvider value={groups}>
      <AIMarkdown {...rest} />
    </AIMarkdownBehaviorsProvider>
  );
}

// The single assertion site — group defaults applied INSIDE the hook:
export function usePanelOptions(): Required<PanelOptions> {
  const behaviors = useAIMarkdownBehaviors();
  const group = behaviors.panel as Partial<PanelOptions> | undefined;
  return useMemo(() => ({ compact: group?.compact ?? PANEL_DEFAULTS.compact }), [group]);
}
```

过去的三级扩展模式（应用程序通过包装层传递自定义 `defaultConfig`）现在演变为：直接传递包装层的分组属性（或解构扩展后的 `define*` 片段）；应用也可以自行堆叠 `AIMarkdownBehaviorsProvider` / `AIMarkdownStateProvider` 来注入应用层级的分组。核心关键字（`blockMemo`、`incrementalParse`、`preserveOrphanReferences`；`streaming`）已被锁定——在类型层面禁止传入，在最内层合并时会被覆盖，并在开发模式下给出警告。

<span id="define-factories-new-optional"></span>

## `define*` 工厂函数（新增，可选）

集成时的静态配置可以打包为冻结的、引用稳定的片段，并在组件上展开传入。运行时动态变动的字段应放在展开属性**之后**（后传入的属性生效）：

```tsx
import { defineTheme, defineBehaviors, definePipeline } from '@ai-react-markdown/core';

const THEME = defineTheme({ fontSize: 15, variant: 'default' });
const BEHAVIORS = defineBehaviors({ blockMemo: false });
const PIPELINE = definePipeline({ sanitizeSchema: MY_SCHEMA });

<AIMarkdown content={content} {...THEME} {...BEHAVIORS} {...PIPELINE} colorScheme={userScheme} />;
```

工厂函数会返回带有类型的输入对象并执行浅层 `Object.freeze`；它们不会递归冻结嵌套分组，也不会解析默认值——直接传入裸平铺属性始终完全合法。核心工厂函数仅接受核心字段；包装层会重新导出扩展后的版本（例如增加了 `codeBlock` 的 `defineMantineBehaviors`）。

<span id="generic-signature-mapping-ts-users"></span>

## 泛型签名映射（TypeScript 用户）

显式类型参数的位置发生了调整：

```tsx
// v1.x
AIMarkdownProps<MyConfig, MyMetadata>;
MantineAIMarkdownProps<MyMantineConfig, MyMetadata>;

// v2.0.0 — TConfig is gone; metadata moves to the FIRST position
AIMarkdownProps<MyMetadata>;
MantineAIMarkdownProps<MyMetadata>;
```

显式传入 `<MyConfig, MyMeta>` 参数将无法通过编译——请移除 config 参数。`PartialDeep` 类型导出已被移除且不提供替代项（v2 的类型体系中不再存在深度可选）。

`useAIMarkdownMetadata<TMetadata>()` 保持不变。

<span id="removed-symbols-complete-list"></span>

## 移除标识符完整清单

| 移除的标识符                                                            | 替代去向                                                    |
| ----------------------------------------------------------------------- | ----------------------------------------------------------- |
| `config` / `defaultConfig` 属性                                         | 平铺属性（见上文对照表）                                    |
| `AIMarkdownRenderConfig`、`defaultAIMarkdownRenderConfig`               | —（官方默认值内置于解析器中）                               |
| `AIMarkdownRenderExtraSyntax`、`AIMarkdownRenderDisplayOptimizeAbility` | `@ai-react-markdown/core/plugins`                           |
| `AIMarkdownRenderState`、`useAIMarkdownRenderState`                     | 五个窄粒度 Hook + `useAIMarkdown()`                         |
| `PartialDeep` 类型导出                                                  | —                                                           |
| `MantineAIMarkdownRenderConfig`、`defaultMantineAIMarkdownRenderConfig` | `MantineCodeBlockOptions`、`defaultMantineCodeBlockOptions` |
| `useMantineAIMarkdownRenderState`                                       | 窄粒度 Hook + `useMantineCodeBlockOptions()`                |

<span id="unchanged-contracts-stated-for-clarity"></span>

## 保持不变的契约（明确说明）

- `<AIMarkdownDocuments preserveOrphanReferences>`：省略该属性始终等同于显式传入 `true`，且包装组件仍会无条件覆盖其下方所有片段的单片段配置。v2 中保持不变。
- 旧版渲染器（`blockMemo: false`）仍不参与跨片段协调。
- `metadata` 依然故意不被库内部进行引用稳定化——这一豁免在稳定性防护门禁表中被明确声明为 `PASS_THROUGH` 规则，而不再是未记录的缺席。

<span id="footguns"></span>

## 避坑指南

- **切勿在读取处重复应用分组默认值。** 包装层分组仅在包装层的窄粒度 Hook 内部应用一次默认值；在多处读取位置随意使用 `??` 回退会导致逻辑发散。
- **`enginePlugins` 数组应置于模块作用域。** 该属性配置了深层比较稳定化作为后备兜底，但内联数组在每次渲染时仍需要进行一次比较计算（开发构建在频繁恢复时会发出警告）。
- **全量替换 `sanitizeSchema` 时未重新包含库的基础规则**会静默禁用依赖这些规则的功能特性（如跨片段占位符、KaTeX 类名）。请使用 `extendSanitizeSchema` 构建 Schema——与 1.x 保持一致。
- **平铺属性在核心层与包装层之间共享同一命名空间。** 包装组件作者在新增字段之前必须查阅属性名称注册表（参见 [React 参考文档](../reference/react.md#props-api-reference) 中的属性表格）；命名冲突对于 TypeScript 用户会导致编译错误，但对于纯 JavaScript 用户可能会造成静默覆盖。

<span id="a-practical-migration-sequence"></span>

## 实用迁移步骤建议

1. 将 core 与 Mantine 集成一同升级，满足其 React 与 UI 库的对等依赖，并重新生成 lockfile。不要在 React 应用中添加独立的 engine 版本；core 会自动安装与其匹配的版本。
2. 在源码和包装包中全局搜索 `defaultConfig`、`config=`、已移除的枚举名称以及旧版的两个渲染状态 Hook。搜索范围应包含导出的属性别名与显式组件类型参数，而不仅限于 JSX 模板。
3. 将两个旧的插件选项整合为一个完整的 `enginePlugins` 数组。仅传入高亮插件会同时移除其他可选插件；当仅需禁用某一个功能时，请从 `defaultEnginePlugins` 开始过滤。
4. 将生命周期、主题与行为属性的读取逻辑迁移至对应的窄粒度 Hook。保留 metadata 作为独立的泛型参数。在自定义渲染器中保持所有 Hook 的无条件调用。
5. 使用属性默认值与类型化行为分组替换包装层的配置快照。验证未传入的分组能够继承外层 Provider，已传入的分组能够进行原子化替换。在单一 Hook 内部应用分组默认值，并对显式的 `undefined` 字段声明明确的策略。
6. 检查独立与协调模式下的渲染输出、自定义 URL 协议、数学公式、代码复制以及流式完成状态。对比语义结构与功能表现；自动生成的命名空间与后续的正确性修复可能会导致字面 HTML 产生变化。

如果编译通过但性能发生变化，首先检查 `incrementalParse`：省略字段的行为已从 1.x 的可能关闭转变为 2.x 的默认开启。随后检查 `urlTransform`、预处理器和插槽的函数引用稳定性。工厂函数是可选的；稳定的模块常量或正确记忆化的动态值表达的是完全相同的配置意图。

对于全新编写的包装组件，请使用当前的[子包扩展指南](extending-via-subpackage.md)作为实现模板。本页面完整保留了新旧映射关系，以便在无需重建已移除 API 的情况下对迁移过程进行审查核对。

# React 自定义排版容器

`Typography`、`ExtraStyles` 以及变体相关属性均为 React 专属 API。Vue 适配器使用其基础样式表、外层 class/style 属性透传以及元素插槽体系。参见 [Vue 指南](../reference/vue.md#minimal-component) 与 [安装配置](getting-started.md)。

`Typography` 控制 Markdown 的外层元素、基准字号、类名和设计系统 Provider。需要不同的 DOM 结构时，可以替换它；如果只调整颜色、间距或标题字号，优先使用[设计变量](design-tokens.md)，保留现有容器和样式。

容器接收主题值和注入的 CSS 变量，必须保留全部 `children`，其中可能包含 Markdown 块、隐藏的尾部定位标记和流式光标。丢弃样式或假定只有一个子节点，可能造成公式字号错误或光标错位。

<span id="the-typography-contract"></span>

## Typography 接口契约

库导出的排版组件类型继承自 `PropsWithChildren`。除了 `children` 之外，它还提供了 `fontSize`、`variant`、`colorScheme` 和 `style`：

```ts
interface AIMarkdownTypographyProps {
  children?: React.ReactNode;
  fontSize: string; // resolved (e.g. '0.9375rem')
  variant?: AIMarkdownVariant; // 'default' | string
  colorScheme?: AIMarkdownColorScheme; // 'light' | 'dark' | string
  style?: React.CSSProperties; // CSS custom properties injected by the React renderer
}
```

`style` 包含渲染器注入的 CSS 变量，目前为 `--aim-font-size-root`。自定义容器必须把它合并到根元素上，否则依赖该变量的样式无法使用预期的根字号。后续小版本可能增加新的变量。

```tsx
import AIMarkdown, { type AIMarkdownTypographyComponent } from '@ai-markdown/react';

const MyTypography: AIMarkdownTypographyComponent = ({ children, fontSize, colorScheme, style }) => (
  <div
    className={`my-markdown ${colorScheme}`}
    style={{ fontSize, ...style }} // ← spread style here
  >
    {children}
  </div>
);

<AIMarkdown content={markdown} Typography={MyTypography} />;
```

`fontSize` 也作为单独属性提供，便于直接设置根元素的 `font-size`，不必从 CSS 变量中读取。

---

<span id="recipes"></span>

## 常见用法

<span id="theme-aware-wrapper-using-a-design-system"></span>

### 接入设计系统的主题感知容器

```tsx
import type { AIMarkdownTypographyComponent } from '@ai-markdown/react';
import { useTheme } from 'my-design-system';

const ThemedTypography: AIMarkdownTypographyComponent = ({ children, fontSize, colorScheme, style }) => {
  const theme = useTheme();
  return (
    <div
      style={{
        fontSize,
        fontFamily: theme.fonts.body,
        color: colorScheme === 'dark' ? theme.colors.textDark : theme.colors.textLight,
        ...style,
      }}
    >
      {children}
    </div>
  );
};
```

<span id="inject-a-context-provider-above-markdown-content"></span>

### 在 Markdown 内容外层注入 Context Provider

```tsx
const ChatContextTypography: AIMarkdownTypographyComponent = ({ children, fontSize, style }) => (
  <ChatToolbarContext.Provider value={{ showCopyButtons: true }}>
    <div style={{ fontSize, ...style }}>{children}</div>
  </ChatToolbarContext.Provider>
);
```

在 `<AIMarkdown>` 内部渲染的任何自定义组件均可自由读取 `ChatToolbarContext`——该模式能够与 [元数据上下文](metadata-context.md) 完美配合，不过对于尚未包装为 Context 的常规业务数据，推荐直接使用 `metadata` 传递。

<span id="add-aria-landmarks-for-screen-readers"></span>

### 为屏幕朗读器添加无障碍 ARIA 标注

```tsx
const A11yTypography: AIMarkdownTypographyComponent = ({ children, fontSize, style }) => (
  <article role="article" aria-label="Assistant message" style={{ fontSize, ...style }}>
    {children}
  </article>
);
```

<span id="add-a-display-contents-wrapper-for-grid-layout"></span>

### 用于 Grid 网格布局的 display: contents 容器

当 Markdown 位于父级 Grid 网格中（例如在聊天界面的单行消息布局中），默认的 `<div>` 容器可能会打乱网格单元的排布。使用 `display: contents` 可以让外层包装对网格布局完全透明：

```tsx
const GridFriendlyTypography: AIMarkdownTypographyComponent = ({ children, fontSize, style }) => (
  <div style={{ display: 'contents', fontSize, ...style }}>{children}</div>
);
```

> `display: contents` 会移除包装容器的实际 CSS 布局盒（layout box）。请注意检查目标浏览器的可访问性支持，且当搭配依赖内容根容器物理坐标定位的内置流式光标时，请使用常规具有实体布局盒的容器。此模式专用于无需该光标几何测量的网格排版。

---

<span id="multiple-variants-via-class-names"></span>

## 通过类名实现多套排版变体

内置的 `DefaultTypography` 将 `variant` 和 `colorScheme` 作为 CSS 类名直接挂载在 `<div className="aim-typography-root">` 上：

```html
<div class="aim-typography-root default light" style="--aim-font-size-root: 0.9375rem">
  <!-- markdown content -->
</div>
```

你可以编写一个输出对应类名的排版组件，并配合针对不同类名的 CSS 规则，从而在应用中发布多套排版变体：

```tsx
const MultiVariantTypography: AIMarkdownTypographyComponent = ({ children, fontSize, variant, colorScheme, style }) => (
  <div className={`my-typo my-typo--${variant} my-typo--${colorScheme}`} style={{ fontSize, ...style }}>
    {children}
  </div>
);
```

```css
.my-typo--compact {
  line-height: 1.4;
}
.my-typo--compact h1 {
  margin-block: 0.5em;
}
.my-typo--prose {
  line-height: 1.7;
}
.my-typo--prose h1 {
  margin-block: 1.2em;
}
```

```tsx
<AIMarkdown content={c} Typography={MultiVariantTypography} variant="compact" />
<AIMarkdown content={c} Typography={MultiVariantTypography} variant="prose" />
```

`variant` 属性的类型被定义为 `'default' | (string & {})`——即字面量 `'default'` 联合任意字符串。你可以传入任意自定义变体名称；类型系统既能在 IDE 中为内置和已知变体提供贴心的代码补全，又不会限制你使用自定义字符串。

---

<span id="the-extrastyles-slot"></span>

## ExtraStyles 插槽机制

`ExtraStyles` 是渲染在排版包装容器内部、但在具体 Markdown 渲染内容外部的第二个可选包装插槽：

```text
<Typography>
  <ExtraStyles>            // ← optional
    <AIMarkdownContent />
  </ExtraStyles>
</Typography>
```

它专用于**需要与渲染后的 Markdown 紧密就近放置**、但又**独立于全局排版主题**的 CSS 作用域。Mantine 适配包正是利用该插槽来挂载 `@mantine` 专属的 CSS 变量覆盖规则，从而避免污染外层排版容器。

```tsx
import type { AIMarkdownExtraStylesComponent } from '@ai-markdown/react';

const MyExtraStyles: AIMarkdownExtraStylesComponent = ({ children }) => (
  <div className="my-markdown-extra-scope">{children}</div>
);

<AIMarkdown content={c} ExtraStyles={MyExtraStyles} />;
```

---

<span id="mantine-extending-vs-replacing"></span>

## Mantine：扩展与完全替换

`@ai-markdown/react-mantine` 导出了以下两个组件：

- `MantineAIMarkdownTypography`——带有 `w="100%"` 与 `fz={fontSize}` 的 Mantine `<Typography>` 容器
- `MantineAIMDefaultExtraStyles`——渲染 `<div className="aim-mantine-extra-styles">`，用于激活该包基于 em 的 CSS 变量覆盖

两者均已公开导出。你可以直接复用它们、在其外层再次包装、或者彻底将其替换：

```tsx
import { MantineAIMarkdownTypography, MantineAIMDefaultExtraStyles } from '@ai-markdown/react-mantine';

// Wrap Mantine's typography (e.g. to add an outer container)
const WrappedTypography: AIMarkdownTypographyComponent = (props) => (
  <div className="my-outer">
    <MantineAIMarkdownTypography {...props} />
  </div>
);

<MantineAIMarkdown content={c} Typography={WrappedTypography} />;
```

---

<span id="footguns"></span>

## 常见问题

<span id="forgetting-to-spread-style"></span>

### 遗漏展开 `style` 属性

这是编写自定义 Typography 时最常见的高频 Bug。渲染后的 Markdown 在容器自身层级看起来正常，但内层子元素（KaTeX 数学公式、代码块、各级标题）全部回退到了系统默认继承值，原因在于 `--aim-font-size-root` 解析结果变成了空值：

```tsx
// ⚠️ Missing the style spread — descendant CSS variables won't apply.
const Broken: AIMarkdownTypographyComponent = ({ children, fontSize }) => <div style={{ fontSize }}>{children}</div>;

// ✅ Spread style after your own properties (or before — order doesn't matter here).
const Fixed: AIMarkdownTypographyComponent = ({ children, fontSize, style }) => (
  <div style={{ fontSize, ...style }}>{children}</div>
);
```

<span id="changing-the-rendered-root-element-on-every-render"></span>

### 在每次渲染中重新创建根组件定义

库内置的排版组件已经过 `memo` 优化，但 React 适配器不会（也不应该）盲目将调用方传入的任意插槽强制包裹进 `memo`。React 依赖函数或类的引用一致性来识别组件类型。在函数组件内部每次重新定义 Typography 会导致引用发生变更，React 会判定组件类型改变，从而彻底卸载原有子树并重新挂载新子树，导致内部状态与所有渲染缓存全部丢失。请在模块顶层作用域定义插槽组件；仅在具体的 props 使用场景确实能带来重渲染收益时，再为其添加 `memo`。

```tsx
// ⚠️ A new MyTypography reference every render = full re-render of the markdown tree.
function App() {
  const MyTypography: AIMarkdownTypographyComponent = ({ children }) => <div>{children}</div>;
  return <AIMarkdown content={c} Typography={MyTypography} />;
}

// ✅ Module-scope.
const MyTypography: AIMarkdownTypographyComponent = ({ children, fontSize, style }) => (
  <div style={{ fontSize, ...style }}>{children}</div>
);
function App() {
  return <AIMarkdown content={c} Typography={MyTypography} />;
}
```

<span id="dont-spread-props-blindly-onto-the-root-if-you-also-override-children"></span>

### 不要将全部 `...props` 盲目透传给根 DOM 元素

请明确仅透传你打算对外暴露的标准 HTML 属性，而不要把整个插槽 props 对象无脑展开。`fontSize`、`variant` 和 `colorScheme` 属于组件层面的配置项，并非原生 `<div>` 的合法标准属性。在 JSX 中既通过展开传递 children 又显式声明 JSX children 属于冗余操作；这并不会让包装容器自行消失。

```tsx
// Avoid forwarding component-only configuration as DOM attributes.
const Broken: AIMarkdownTypographyComponent = (props) => <div {...props}>{props.children}</div>;

const Explicit: AIMarkdownTypographyComponent = ({ children, fontSize, variant, colorScheme, style }) => (
  <div style={{ fontSize, ...style }} data-variant={variant} data-color-scheme={colorScheme}>
    {children}
  </div>
);
```

如果你添加的自定义行内样式与系统注入的 `style` 存在重叠属性，请审慎决定展开的前后顺序。`style={{ ...ownStyles, ...style }}` 能够完整保留 React 适配器注入的关键系统变量。颠倒顺序会让你的自定义值完全覆盖系统变量；只有当你明确打算完全接管并对尺寸度量契约承担全部责任时，才应这么做。

<span id="children-dom-structure-and-cursor-placement"></span>

## 子节点、DOM 结构与光标定位

请原样输出渲染 `{children}`。切勿调用 `Children.only`，切勿假设子节点必须是 `<AIMarkdownContent>`，也切勿使用 `cloneElement` 强行挂载 ref。React 传入的是一个包含渲染内容与光标插槽的完整 Fragment。当提供 `ExtraStyles` 时，它接收的也是同一组子节点。

内置的光标通过查找自身的 DOM 父节点来定位其内容根容器。必须保证光标与渲染出来的 Markdown 块级元素同处于一个真实的物理 DOM 元素之下。将整组节点统一包裹在单个 `<div>` 内能够正常工作；如果将选定的子节点移出到独立的容器或 React Portal 中，会导致光标定位检测进入错误的子树。`display: contents` 的根元素虽然对网格布局有帮助，但它缺乏常规的物理布局盒，无法为光标提供准确的几何坐标计算基准。当需要将自定义排版容器与内置流式光标结合使用时，请使用常规的标准布局元素。

实际的 DOM 结构如下：

```text
Typography root
└─ ExtraStyles root, when supplied
   ├─ rendered Markdown blocks
   ├─ hidden source-tail signal, when needed
   └─ streamingCursor, while streaming is true
```

`ExtraStyles` 仅接收 children 作为参数。如果它需要读取主题数据，可以调用窄粒度的主题 Hook；它并不会通过 prop 接收排版容器的 `style` 对象。CSS 自定义变量通过 DOM 树层级从外层的 Typography 根节点自然继承向下传递。

<span id="reusing-the-default-stylesheet-with-a-custom-wrapper"></span>

## 在自定义容器中复用官方默认样式表

官方默认样式表以 `.aim-typography-root` 作为选择器基准，并在 `.default`、`.light` 和 `.dark` 等变体类名上声明变量。如果自定义容器仅仅命名为 `.my-markdown`，并不会仅仅因为你导入了样式表就激活这些选择器规则。请保留库预期的类名，或者编写完整的自定义 CSS 规则：

```tsx
const CompatibleTypography: AIMarkdownTypographyComponent = ({ children, fontSize, variant, colorScheme, style }) => (
  <article
    className={`aim-typography-root ${variant} ${colorScheme}`}
    aria-label="Assistant message"
    style={{ fontSize, ...style }}
  >
    {children}
  </article>
);
```

自定义变体名称仅会激活你自己编写的 CSS 规则，它不会凭空自动合成一套新的设计变量尺寸阶梯。同理，自定义配色方案字符串也需要配套提供对应的颜色样式规则。在验证自定义容器时，请使用包含嵌套列表、内含代码块的引用块、标题内数学公式以及处于流式结尾阶段的综合测试用例；这些复杂场景能够精准暴露出纯文本测试中不易察觉的样式继承与子元素布局隐患。

底层实现代码参考：[`defs.ts`](../../../../packages/react/src/defs.ts)、[`Default.tsx`](../../../../packages/react/src/components/typography/Default.tsx) 以及 [`index.tsx`](../../../../packages/react/src/index.tsx) 中的 `contentBody` 组合逻辑。

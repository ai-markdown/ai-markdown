# React CSS 设计变量

本页介绍 React 默认排版样式中的 CSS 设计变量（design tokens）。Vue 基础样式和 Mantine 组件使用各自的样式规则。参见 [Vue 指南](../reference/vue.md#minimal-component)和[安装配置](getting-started.md)。

React 默认样式通过 CSS 自定义属性控制间距、字号、字重、颜色和公式大小。覆盖这些变量即可接入应用的设计系统，同时保留内置元素样式。Mantine 使用自己的排版组件和 Mantine CSS 变量，不适用本页的默认样式约定。

大多数尺寸根据组件的 `fontSize` 计算，便于让不同字号的界面保持相同的排版比例。但并非所有长度都随它缩放：圆角使用固定 `rem`，部分边框和内边距使用 `px`。以下列出变量默认值、适用元素和覆盖规则。

<span id="token-anchor-aim-font-size-root"></span>

## 根字号：`--aim-font-size-root`

所有间距、字号以及标题变量均严格锚定于 `--aim-font-size-root`，该变量由 React 渲染器根据组件的 `fontSize` prop 自动注入。默认排版变体的变量均定义为 `calc(var(--aim-font-size-root) * k)` 公式——这意味着**更改 `fontSize` 会按比例联动缩放所有基于根变量计算的尺寸**。

```tsx
<AIMarkdown content={c} fontSize="0.875rem" /> // 14px-ish — root-token dimensions scale down
<AIMarkdown content={c} fontSize="1.125rem" /> // 18px-ish — root-token dimensions scale up
```

你仅在需要进行非等比调整时才需要显式覆盖具体单个变量（例如：希望间距更紧凑但字号保持不变、或者加大 H1 字号但正文保持原样等）。

---

<span id="complete-token-reference"></span>

## 变量参考

所有变量均声明在 `.aim-typography-root.default` 作用域下。在你的应用样式表中通过该选择器（或更高优先级的选择器）进行属性覆盖：

```css
.aim-typography-root.default {
  --aim-spacing-md: calc(var(--aim-font-size-root) * 1.2);
  --aim-h1-font-size: calc(var(--aim-font-size-root) * 2.5);
  --aim-font-weight-strong: 600;
  --aim-color-anchor: #ff6b6b;
}
```

<span id="spacing-scale"></span>

### 间距阶梯（Spacing scale）

| 变量名称           | 默认计算公式                              | 使用此变量的元素                                    |
| :----------------- | :---------------------------------------- | :-------------------------------------------------- |
| `--aim-spacing-xs` | `calc(var(--aim-font-size-root) * 0.625)` | 标题/图片外边距、代码块内边距、表格单元格垂直内边距 |
| `--aim-spacing-sm` | `calc(var(--aim-font-size-root) * 0.75)`  | 表格单元格水平内边距                                |
| `--aim-spacing-md` | `calc(var(--aim-font-size-root) * 1)`     | `<hr>`、`<pre>`、列表、表格、引用块等块级元素外边距 |
| `--aim-spacing-lg` | `calc(var(--aim-font-size-root) * 1.25)`  | 段落下边距、引用块水平内边距                        |
| `--aim-spacing-xl` | `calc(var(--aim-font-size-root) * 1.5)`   | 主要章节间距                                        |

<span id="font-sizes-inline-scale"></span>

### 字号阶梯（行内字号）

| 变量名称             | 默认计算公式                              | 使用此变量的元素                        |
| :------------------- | :---------------------------------------- | :-------------------------------------- |
| `--aim-font-size-xs` | `calc(var(--aim-font-size-root) * 0.75)`  | 行内代码与代码块、键盘按键 `<kbd>` 标签 |
| `--aim-font-size-sm` | `calc(var(--aim-font-size-root) * 0.875)` | 表格标题 caption、表头 th 以及单元格 td |
| `--aim-font-size-md` | `calc(var(--aim-font-size-root) * 1)`     | 正文文本                                |
| `--aim-font-size-lg` | `calc(var(--aim-font-size-root) * 1.125)` | 引用块文本                              |
| `--aim-font-size-xl` | `calc(var(--aim-font-size-root) * 1.25)`  | 备选字号变量；默认无内置元素直接使用    |

<span id="heading-sizes"></span>

### 标题字号阶梯

| 变量名称             | 默认计算公式                              |
| :------------------- | :---------------------------------------- |
| `--aim-h1-font-size` | `calc(var(--aim-font-size-root) * 2.125)` |
| `--aim-h2-font-size` | `calc(var(--aim-font-size-root) * 1.625)` |
| `--aim-h3-font-size` | `calc(var(--aim-font-size-root) * 1.375)` |
| `--aim-h4-font-size` | `calc(var(--aim-font-size-root) * 1.125)` |
| `--aim-h5-font-size` | `calc(var(--aim-font-size-root) * 1)`     |
| `--aim-h6-font-size` | `calc(var(--aim-font-size-root) * 0.875)` |

乘数系数（`2.125`、`1.625` 等）对齐了 Mantine 的标题尺寸比例。如需进行非均匀微调，可针对特定标题级别单独覆盖。

<span id="heading-metadata"></span>

### 标题排版元数据

| 变量名称                    | 默认取值                         | 说明                             |
| :-------------------------- | :------------------------------- | :------------------------------- |
| `--aim-h{1..6}-line-height` | `1.3, 1.35, 1.4, 1.45, 1.5, 1.5` | 无单位数值，按 h1 至 h6 顺序排列 |
| `--aim-h{1..6}-font-weight` | `var(--aim-font-weight-strong)`  | 默认所有标题级别均共享此粗细     |

<span id="shared-weight"></span>

### 共享字重权重

| 变量名称                   | 默认取值 | 使用此变量的元素                                                                                 |
| :------------------------- | :------- | :----------------------------------------------------------------------------------------------- |
| `--aim-font-weight-strong` | `700`    | 所有标题（通过 `--aim-h*-font-weight` 间接引用）、`<th>` 表头——`<strong>` 则保留浏览器的默认粗体 |

可改为 `500` 或 `600`，同时调整所有使用该变量的标题和表头字重。

<span id="katex"></span>

### KaTeX 数学公式

| 变量名称                | 默认取值                    | 设计用途与行为                                                                                                             |
| :---------------------- | :-------------------------- | :------------------------------------------------------------------------------------------------------------------------- |
| `--aim-katex-font-size` | `var(--aim-font-size-root)` | 数学公式字号——无论父元素是引用块还是各级标题，均始终锁定为组件根基准字号。若希望随父容器字号相对缩放，可显式设置为 `1em`。 |

<span id="misc"></span>

### 其它杂项样式

| 变量名称                      | 默认取值                  | 使用此变量的元素                            |
| :---------------------------- | :------------------------ | :------------------------------------------ |
| `--aim-line-height`           | `1.55`                    | 正文段落与代码块的基础行高                  |
| `--aim-radius-sm`             | `0.25rem`                 | 代码块、键盘按键 `<kbd>` 与引用块的圆角弧度 |
| `--aim-font-family-monospace` | 系统等宽字体栈            | `<code>`、`<pre>`                           |
| `--aim-font-family-headings`  | `inherit`（继承正文字体） | 所有标题（覆盖此项可使标题字体区别于正文）  |

<span id="colors-light"></span>

### 浅色模式色彩（Light）

声明在 `.aim-typography-root.light` 选择器上：

| 变量名称                    | 视觉角色                     |
| :-------------------------- | :--------------------------- |
| `--aim-color-text`          | 正文主文本颜色               |
| `--aim-color-dimmed`        | 辅助说明、次级文本颜色       |
| `--aim-color-anchor`        | 链接锚点颜色                 |
| `--aim-color-border`        | 表格边框、引用块左侧高亮边框 |
| `--aim-color-code-bg`       | 行内代码背景色               |
| `--aim-color-code-text`     | 行内代码前景色               |
| `--aim-color-blockquote-bg` | 引用块背景色                 |
| `--aim-color-mark-bg`       | `<mark>` 高亮文本背景色      |
| `--aim-color-mark-text`     | `<mark>` 高亮文本前景色      |

<span id="colors-dark"></span>

### 深色模式色彩（Dark）

变量名称完全一致，声明在 `.aim-typography-root.dark` 选择器上。根据当前生效的类名自动应用对应的色彩方案。

```css
.aim-typography-root.dark {
  --aim-color-text: #c9d1d9;
  --aim-color-anchor: #58a6ff;
  /* … */
}
```

---

<span id="common-recipes"></span>

## 常见定制实践方案

<span id="roomier-reading-layout"></span>

### 宽松舒朗的长文阅读排版

```css
.aim-typography-root.default {
  --aim-spacing-md: calc(var(--aim-font-size-root) * 1.4);
  --aim-spacing-lg: calc(var(--aim-font-size-root) * 1.8);
  --aim-line-height: 1.75;
}
```

<span id="compact-chat-layout-less-vertical-space"></span>

### 紧凑型聊天界面布局（压缩垂直空间）

```css
.aim-typography-root.default {
  --aim-spacing-md: calc(var(--aim-font-size-root) * 0.8);
  --aim-spacing-lg: calc(var(--aim-font-size-root) * 1);
  --aim-h1-font-size: calc(var(--aim-font-size-root) * 1.6);
  --aim-h2-font-size: calc(var(--aim-font-size-root) * 1.3);
  --aim-line-height: 1.5;
}
```

<span id="heavier-headings-lighter-body-strong"></span>

### 强化标题字重、弱化正文粗体

```css
.aim-typography-root.default {
  --aim-h1-font-weight: 800;
  --aim-h2-font-weight: 700;
  --aim-font-weight-strong: 600; /* doesn't override per-heading weights above */
}
```

各个级别的标题字重变量默认回退至 `--aim-font-weight-strong`，因此单独覆盖 `--aim-font-weight-strong` 会同时影响所有标题级别。如需精细控制某一级别的标题，请直接覆盖对应的 `--aim-h{N}-font-weight`。

<span id="brand-accent-link-color"></span>

### 品牌强调色链接样式

```css
.aim-typography-root.light {
  --aim-color-anchor: #6366f1;
}
.aim-typography-root.dark {
  --aim-color-anchor: #a5b4fc;
}
```

<span id="different-font-for-headings"></span>

### 为标题指定独立字体系列

```css
.aim-typography-root.default {
  --aim-font-family-headings: 'Source Serif Pro', Georgia, serif;
}
```

<span id="scope-to-a-single-component-instance"></span>

### 限定作用域于单一组件实例

上述选择器属于全局样式规则。如需将样式限定在特定局部范围，可通过增加父级容器类名来提升选择器特异性（specificity）：

```css
.chat-message .aim-typography-root.default {
  --aim-spacing-md: calc(var(--aim-font-size-root) * 0.8);
}
```

父级包裹容器 `<div className="chat-message">` 既可以来自你自己的业务布局组件，也可以通过 [自定义 Typography 排版组件](custom-typography.md) 注入。

---

<span id="stability-contract"></span>

## 接口稳定性契约

| 规范层面                                | 次版本（Minor 版本）升级下的稳定性保证                        |
| :-------------------------------------- | :------------------------------------------------------------ |
| 变量**名称**（如 `--aim-spacing-md`）   | 保证严格稳定。任何废弃、移除或更名均需触发主版本（Major）升级 |
| 变量**职责**（变量注入的具体 CSS 属性） | 保证严格稳定                                                  |
| 默认**取值**（乘数系数、基准色彩）      | 随着视觉设计规范的演进，在次版本更新中可能会有细微调整        |

如果你的应用严格依赖某一特定的像素或绝对尺寸，**请显式覆盖该变量**，而不要隐式依赖默认值。显式覆盖能将该数值永久锁定为你的业务规范，不受未来官方默认值迭代的影响。

```css
/* ⚠️ Trusting the default — may drift under minor bumps. */
.my-app h1 {
  /* assumes default --aim-h1-font-size is 2.125rem */
}

/* ✅ Locked explicitly — survives any default shift. */
.aim-typography-root.default {
  --aim-h1-font-size: 2rem;
}
```

---

<span id="where-these-tokens-live-in-the-build"></span>

## 构建产物文件分布

CSS 自定义属性变量打包在以下独立样式文件中：

```text
@ai-markdown/react/typography/default.css   # default variant only
@ai-markdown/react/typography/all.css       # every shipped variant
```

根据应用的打包策略按需引入对应文件：

```ts
import '@ai-markdown/react/typography/default.css';
// or
import '@ai-markdown/react/typography/all.css';
```

如果你编写了 [自定义 Typography 组件](custom-typography.md)，你也可以编写自己的 CSS 文件并在自定义根选择器上声明这些变量（或完全属于你自己的变量体系）。当你彻底替换了排版包装组件时，并不强制要求复用官方的变量命名——这些变量是官方内置 `default` 变体样式表与外部样式覆盖之间专用的协同契约。

---

<span id="footguns"></span>

## 常见问题

<span id="overriding-aim-font-size-root-directly"></span>

### 在 CSS 中直接覆盖 `--aim-font-size-root`

`--aim-font-size-root` 是**由渲染器根据组件上的 `fontSize` prop 动态行内注入的**——在 CSS 样式表中强行覆盖它虽然在某些情况下有效，但极为脆弱（每次重新渲染时 React 都会再次注入行内 style，而除非使用 `!important`，否则 React 的行内样式特异性必定战胜外部 CSS）。请始终通过组件的 `fontSize` prop 进行配置：

```tsx
// ✅ Correct: use the prop, the root variable is set for you.
<AIMarkdown content={c} fontSize="1rem" />

// ⚠️ Will lose to the inline style React injects.
// .aim-typography-root.default { --aim-font-size-root: 1rem; }
```

<span id="specificity-wars-with-downstream-resets"></span>

### 避免与下游 CSS Reset 产生特异性冲突

在盲目提升选择器权重之前，请先在浏览器开发者工具中检查实际胜出的 CSS 声明。Cascade Layers（层叠层）、`!important`、选择器特异性权重以及源码书写顺序属于不同的层叠维度；在同一层级内，后出现的规则并不会自动击败权重更高的前置规则。

官方提供的元素样式规则采用了类似 `.aim-typography-root :where(h1)` 的选择器结构。`:where(...)` 伪类本身具有零特异性（zero specificity）；因此整个选择器仅贡献单个 class 类名的权重。一个纯粹的 `h1` 标签选择器权重低于它，而带有应用级作用域限定的选择器则能实现样式覆盖：

```css
.chat-message .aim-typography-root {
  --aim-h1-font-size: calc(var(--aim-font-size-root) * 1.8);
}

/* Use an element override only when a token cannot express the change. */
.chat-message .aim-typography-root h1 {
  letter-spacing: -0.02em;
}
```

对于变量变量声明，内置的 `.aim-typography-root.default` 拥有两个 class 的特异性权重。请添加你自己的父级作用域，或在库样式表之后引入具有同等权重的覆盖样式表。使用 `:where()` 包裹选择器只会降低其权重，并不会提升权重。避免过度使用 `!important`，这会增加后续应用层样式的调试与推理难度。

<span id="default-color-values"></span>

## 默认颜色值

浅色（light）与深色（dark）模式声明了完全相同的属性变量集合。下表完整记录了当前版本的基准预设值，方便设计师在规划主题时直接对照比对，而无需逆向解析编译后的打包 CSS：

| 变量后缀（`--aim-color-…`） | 浅色模式（Light） | 深色模式（Dark） |
| :-------------------------- | :---------------- | :--------------- |
| `text`                      | `inherit`         | `#c9d1d9`        |
| `dimmed`                    | `#868e96`         | `#8b949e`        |
| `anchor`                    | `#228be6`         | `#58a6ff`        |
| `border`                    | `#dee2e6`         | `#30363d`        |
| `code-bg`                   | `#f1f3f5`         | `#161b22`        |
| `code-text`                 | `inherit`         | `#c9d1d9`        |
| `blockquote-bg`             | `#f8f9fa`         | `#161b22`        |
| `mark-bg`                   | `#fff3bf`         | `#bb800926`      |
| `mark-text`                 | `inherit`         | `inherit`        |

取值为 `inherit` 意味着其实际呈现依赖于外层环境样式，因此请结合具体的消息气泡或页面背景色进行色彩校准。样式表本身并不负责加载网络字体文件。正文的 `font-family` 请声明在根节点上，所有所需的字体资源均需由宿主应用程序自行引入。

<span id="a-predictable-override-workflow"></span>

## 样式覆盖步骤

1. 先行引入 React 适配器的排版 CSS 样式文件，随后再引入你自己的应用样式表。
2. 设置 `fontSize`，可以传入数字或有效的 CSS 长度，如 `15`、`'15px'`、`'0.9375rem'`。数值 `0` 保持为 `0`，空字符串回退到默认值。
3. 在具有应用级作用域的选择器下覆盖语义化变量变量，避免重复编写针对基础 HTML 元素的繁复规则。
4. 重点抽检各级标题、表格单元格、行内代码以及嵌套在引用块内的 KaTeX 数学公式的实际计算样式。
5. 同时验证浅色和深色两种模式。声明在 `.light` 或 `.dark` 上的颜色变量可能会与同等权重的通用变体覆盖规则产生竞争。

根变量是通过行内样式直接注入的。普通的外部样式表规则不仅在下次 React 渲染后会失效，从初次挂载起就会立即被行内样式压制。自定义包装容器必须如实透传 `style` 属性以保留该变量。详细的包装容器与 Fragment 规范请参阅 [自定义排版容器](custom-typography.md)。

默认值来自 [`default.scss`](../../../../packages/react/src/components/typography/variants/default.scss)。并非每个元素都会使用所有变量，自定义组件也需要自行决定使用哪些变量。

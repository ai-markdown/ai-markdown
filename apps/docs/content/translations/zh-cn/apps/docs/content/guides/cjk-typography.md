# CJK 中日韩排版与标点规范

解析规则与盘古之白（Pangu）行为源自底层的 engine 引擎层，对 React 和 Vue 两个适配器完全适用。下文中的排版变体（typography variants）与 CSS 变量属于 React 专属特性；Vue 适配器使用其基础样式表及应用程序自带的 CSS，并从根模块导出 `pangu`。参见 [Vue 指南](../reference/vue.md#minimal-component) 与 [安装配置](getting-started.md)。

CJK 渲染涉及三个互相独立的关注点：识别中日韩标点符号旁边的 Markdown 分隔符；在不同文字书写系统（中西文/半角全角）交界处按需插入空格；以及使用合适的字体与行高对最终结果进行排版布局。本库提供了相应的解析器扩展与默认排版样式，而具体使用哪种语言、字形字体以及具体的文案空格排版规范，则由应用程序自主决定。

本指南明确划分了这些职责归属，避免把标点符号无法成对的问题误当成 CSS 样式问题，或把折行行为归咎于错误的插件。同时本文也明确指出了 `==highlight==` 的边界——它并未采用 CJK 强调扩展的分隔符放宽规则。

<span id="what-works-out-of-the-box"></span>

## 开箱即用特性

| 功能特性                                            | 对应插件                                    | 默认状态                |
| :-------------------------------------------------- | :------------------------------------------ | :---------------------- |
| 紧邻 CJK 标点的强调分隔符（粗体/斜体）识别          | `remark-cjk-friendly`                       | ✅ 始终开启             |
| 紧邻 CJK 标点的 GFM 删除线分隔符识别                | `remark-cjk-friendly-gfm-strikethrough`     | ✅ 始终开启             |
| 在 CJK 与半角字符之间自动插入空格（盘古之白）       | `remark-pangu`                              | ✅ 默认开启；可单独关闭 |
| 智能标点转换（SmartyPants）——弯引号、破折号、省略号 | `remark-smartypants`（紧随 CJK 引号预处理） | ✅ 默认开启；可单独关闭 |
| HTML 注释过滤移除                                   | engine 内置（`removeComments`）             | ✅ 默认开启；可单独关闭 |

上述解析器扩展均通过其 `parseOnly` 入口引入。它们仅影响 Markdown 语法的识别逻辑，本身不会移除软换行（soft line breaks）。选定的转换插件会在相关源内容解析或转换时执行；增量解析能够直接复用已稳定的前缀结果，因此在 React 的每次重渲染中并不一定会对整篇文档全量重跑插件。

---

<span id="what-pangu-spacing-does"></span>

## 盘古之白（Pangu）空格机制

中日韩字符属于全角字符，拉丁字母与阿拉伯数字属于半角字符。在没有分隔符的情况下，混排文本在视觉上容易显得拥挤局促：

```text
今天我用React19重构了项目             ← source
今天我用 React19 重构了项目           ← mixed-script spacing
```

`remark-pangu`（由 engine 的 `pangu` 插件控制）应用其中西文混排空格规则，在受支持的 CJK 与拉丁字符边界处插入常规 ASCII 空格。该空格直接出现在最终生成的 HTML 文本节点中，并非 CSS 视觉间距黑盒技巧，因此在复制粘贴、屏幕朗读器（screen readers）以及下游文本处理中均能完整保留。

<span id="turning-pangu-off"></span>

### 关闭盘古空格

```tsx
import { defaultEnginePlugins, pangu } from '@ai-markdown/react/plugins';

// Module scope — stable reference. pangu filtered out → spacing disabled.
const PLUGINS = defaultEnginePlugins.filter((p) => p !== pangu);

<AIMarkdown content="今天我用React19重构了项目" enginePlugins={PLUGINS} />;
```

> 请注意，显式传入的 `enginePlugins` 数组会**整体替换**默认的插件列表（不会进行自动合并）。上述使用 `filter` 的写法是仅禁用某一个插件同时保留其余默认插件的推荐模式。

<span id="when-to-keep-pangu-off"></span>

### 适合保持关闭 pangu 的场景

- 内容已在上游流水线中**预先完成了格式化加空格**。Pangu 通常会保留现有的空格分隔而不会重复插入第二个空格，因此对此类内容重复运行可能纯属冗余开销。
- 模型正在处于 Token 级流式输出中间状态，中间插入空格可能引发视觉抖动——不过在实际应用中 pangu 的处理速度极快，这类现象极少产生明显影响。
- 测试用例需要断言完全精确的逐字节内容匹配，且不希望受到 pangu 新增空白字符的干扰。

当其输出符合你的文案编辑排版规范时，保持默认开启即可。日语与韩语应用程序可能会采用不同的空格规范；在做出取舍决策前，建议针对代表性语句和标点进行实测比对。

---

<span id="quotes-beside-cjk-text"></span>

## CJK 文本两侧的引号处理

`smartypants` 插件包含两道转换流程。原生 SmartyPants 依赖直引号前后的 Token 决定其为前引号（开引号）还是后引号（闭引号），由于它将汉字、假名或谚文字符均视为单个单词（word），导致单独使用它处理 `中文"引号"中文` 时，两侧的引号均会被误判为闭引号。因此本库优先运行一道 CJK 感知处理流程：紧邻 CJK 字符（汉字、平假名、片假名、谚文、CJK 标点或全角字符）前后的直引号 `"` 或 `'`，会根据其在文本连续流中的配对状态转为弯引号，而 SmartyPants 仅处理两侧均无 CJK 字符的常规引号。Pangu 随后在两者之后运行，并按照自身规则为弯双引号两侧补充空格，但不会改动弯单引号。

| 输入源文本             | 渲染后的实际文本         |
| :--------------------- | :----------------------- |
| `中文"引号"中文`       | `中文 “引号” 中文`       |
| `中文'引号'中文`       | `中文‘引号’中文`         |
| `中文 '引号' 中文`     | `中文 ‘引号’ 中文`       |
| `中文"English"中文`    | `中文 “English” 中文`    |
| `中文"多"个"引号"了`   | `中文 “多” 个 “引号” 了` |
| `他说："你好。"`       | `他说：“你好。”`         |
| `English "quote" 中文` | `English “quote” 中文`   |
| `it's`, `'90s`         | `it’s`, `’90s`           |

引号配对规则按先后优先级排序如下：年代缩写前的撇号（`'90s`）作为闭引号；位于块开头、空白字符后或开括号后的引号作为开引号；位于块结尾、空白字符前或闭标点（`）」，。！？；：`）前的引号作为闭引号；紧随非 CJK 字母或数字之后的引号作为闭引号；位于两个其他字符之间的引号，在当前尚无同类型未闭合引号时判定为开引号，否则判定为闭引号。开闭状态在每个块级元素（段落、标题、表格单元格）内部按文档顺序贯穿文本流，跨越强调（emphasis）、粗体（strong）、删除线（strikethrough）以及链接（links）进行状态跟踪，因此 `中文'*引号*'中文` 与 `"引号**强调**"中文` 均能正确成对闭合，同一个段落内跨软换行闭合的引号亦能正确识别。未闭合的引号（如 `中文"引号`）在闭合引号到达前会始终保持开引号状态，这正是流式渲染帧中的标准常态。

行内代码、围栏代码块、原始 HTML、数学公式与图片均保留其内部的原生直引号，且在相邻引号看来既不算空白字符也不算 CJK 字符（例如 `中文"` + 行内代码 + `"中文` 能够围绕代码跨节点正确配对）。该流程仅就地改写文本节点内容，不会在节点之间移动文本，也不会变更源位置信息，因此增量解析引擎能够安全复用已确认的前缀内容。

---

<span id="line-breaking-semantics"></span>

## 换行语义

生产环境的处理链始终包含 `remark-breaks`。因此在段落内部，源文本中的单个换行符会直接渲染为 HTML 的 `<br>` 标签；CJK 插件不会将断开的行拼合为单行。两个 CJK 扩展均采用纯解析入口（parsing-only entry points），仅修补标点旁的分隔符识别规则，不会注入软换行移除转换。

| 段落内的源文本                  | 生成的 HTML 结构               |
| :------------------------------ | :----------------------------- |
| `这是一段\n中文内容`            | `这是一段<br>中文内容`         |
| `English with\na soft break`    | `English with<br>a soft break` |
| `中文 mixed with\nEnglish text` | 两行源码之间生成真实换行折行   |

此处 `\n` 代表输入源文本中的真实换行符。空行依然用于分隔独立的块级元素，代码块则保留其自身的空白排版语义。由于窄屏容器限制引起的浏览器自动排版折行属于另一层机制：它取决于 CSS、字体度量指标（font metrics）以及容器的可用宽度。

CJK 扩展的关键作用体现在如 `前面**「重点」**后面` 以及对应的 `~~…~~` 示例上。它们使解析器能够在紧邻全角标点的场景下正确识别强调或删除线，而在未修补的原始规则下这些标记会被原样输出为字面符号。它们并不提供字体文件，不改变东亚字符字形宽度，也不定义浏览器的文本换行算法。

库内部并未提供关闭始终开启的换行插件或 CJK 解析插件的公开开关。如果上游数据源插入了不应展示的排版换行符，请在渲染前使用适合该格式的规则对源文本进行规范化预清洗。切勿盲目无差别移除所有换行符：围栏代码块、表格、列表以及块级边界均严格依赖换行符。

<span id="fonts-and-css"></span>

## 字体与 CSS

默认的排版变体并未硬编码固定的特定 CJK 字体——它让操作系统从系统字体制备回退链（fallback chain）中挑选。这是深思熟虑的设计：中文文本在采用用户系统首选字体（例如 macOS 上的 PingFang SC、Windows 上的 Microsoft YaHei、Linux 上的 Source Han Sans）时，呈现效果最佳。

如果你希望指定特定的 CJK 字体系列，可以通过覆盖字体变量来实现：

```css
.aim-typography-root.default {
  --aim-font-family-headings: 'Source Han Sans SC', 'Noto Sans CJK SC', sans-serif;
  /* The body font isn't a separate token — set it on the typography root directly: */
  font-family: 'Source Han Sans SC', 'Noto Sans CJK SC', sans-serif;
}
```

针对代码块内的等宽字体，现有 `--aim-font-family-monospace` 变量已经完成了配置——但如果你希望 `<code>` 内部的 CJK 字符使用不同于西文的回退字体，现代浏览器会根据字体所包含的 CJK 字形自动处理回退。该变量仅在你的等宽字体缺乏 CJK 字形且你希望显式指定具备 CJK 能力的回退字体时发挥作用：

```css
.aim-typography-root.default {
  --aim-font-family-monospace: 'Fira Code', 'Noto Sans Mono CJK SC', monospace;
}
```

完整的 CSS 设计变量列表请参阅 [设计变量](design-tokens.md)。

---

<span id="line-height-for-cjk"></span>

## CJK 行高调整

相比拉丁字母，中日韩文字在视觉密度上显著更高——在相同的标称行高（line-height）下，CJK 文本看起来会更紧凑且更难阅读。默认的 `--aim-line-height` 针对中西文混排进行了平衡调优；对于**以 CJK 为主**的阅读布局（例如通过 `<AIMarkdown>` 渲染的纯中文博客），建议适当调大行高：

```css
.aim-typography-root.default {
  --aim-line-height: 1.8; /* shipped default: 1.55; choose the value for your actual font */
}
```

这属于视觉风格与品牌层面的定制决策，并无唯一绝对的“正确”标准值。

---

<span id="ruby-annotations-furigana-zhuyin"></span>

## 旁注标记 Ruby（注音 / 假名）

`<ruby>`、`<rt>` 与 `<rp>` 均内置在 `rehype-sanitize` 的 `defaultSchema.tagNames` 白名单中，因此无需任何额外配置即可顺利通过库的安全清洗机制。在 Markdown 中直接编写行内 HTML 即可生效：

```markdown
<ruby>漢<rt>kan</rt></ruby>字
```

默认的清洗规则中也定义了通用的属性规则；标签支持与属性支持属于独立的决策。如果你需要允许特定属性（例如为屏幕朗读器在 `<rt>` 上添加 `lang` 属性，或为样式添加 `class` 属性），请显式扩展清洗 schema：

```ts
import { extendSanitizeSchema } from '@ai-markdown/react';

const SCHEMA = extendSanitizeSchema((s) => {
  s.attributes ??= {};
  for (const tag of ['ruby', 'rt', 'rp']) {
    s.attributes[tag] = [...(s.attributes[tag] ?? []), 'lang', 'className'];
  }
});
```

> 对于极少数不支持 ruby 布局的陈旧浏览器，会自动优雅回退为渲染 `<rp>` 内的内容（即 `(` / `)` 括号）。这是 HTML 官方规范推荐的标准降级路径——本库不会对此进行任何干扰。

---

<span id="whats-intentionally-not-done"></span>

## 明确不做的事项

本库**明确不**提供以下能力：

- **竖排文本排版（`writing-mode: vertical-rl`）**——该特性由 CSS 标准原生支持，但 `<AIMarkdown>` 自身不会设置此属性。如果你需要排版竖排的中文或日文，请将 `writing-mode: vertical-rl` 应用在外层父容器上（或通过自定义 CSS 应用在排版根节点上）。所有的间距变量依然有效。
- **特定语言专用的 Markdown 语法扩展**（例如将「」直接当成引号语法）——这会偏离 CommonMark 标准，目前并不在技术演进路标中。
- **针对 `==highlight==` 的 CJK 标点放宽识别**——`remark-cjk-friendly` 仅修补了强调语法（`*`、`_`），其配套扩展修补了 GFM 删除线（`~~`），但没有任何扩展修补 `==`，因此它依然遵循 CommonMark 原生的未经修补的分隔符边界规则。在全角标点紧挨分隔符内侧的情况下，`**` 与 `~~` 能够配对，而 `==` 则不能：`前面**「重点」**后面` 会渲染为粗体，而 `前面==「重点」==后面` 会被原样渲染为字面符号 `==`。这一设计是深思熟虑的：`==` 既非 CommonMark 也非 GFM 核心语法——它是一项社区扩展，其核心价值在于在 Obsidian、VitePress 等各生态工具间保持相同源文本的一致渲染，在此处擅自放宽规则恰恰会打破这一生态通用性。如果你确实需要高亮并与标点混用，以下两种书写形式能够成功配对：将标点移到分隔符外侧（`前面「==重点==」后面`、`前面==重点==。后面`），或者在分隔符**两侧同时**留有空格（`前面 ==「重点」== 后面`——仅单侧有空格是不够的）。除此之外，建议直接使用已修补的 `**` 或 `~~`。
- **阿拉伯语/希伯来语的双向文字支持（Bidi）**——这与 CJK 无关；双向文本完全由浏览器的标准排版引擎处理。从布局层面上，从右至左（RTL）文本与 CJK 混排能够正常工作；本库无需也不做额外特殊处理。

如果你遇到了本文档未涵盖的具体 CJK 渲染需求，在 GitHub 上附带复现 Markdown 样例提交 Issue 是寻求修复或解决方案最快捷的途径。

---

<span id="quick-recipe-chinese-first-layout"></span>

## 快速实践：中文优先布局方案

以下是专为中文网站打造的完整配置方案，采用了品牌定制字体并适当放宽了行高：

```tsx
import AIMarkdown from '@ai-markdown/react';
import '@ai-markdown/react/typography/default.css';
import './my-cjk-overrides.css'; // contains the CSS below

function Article({ content }: { content: string }) {
  return <AIMarkdown content={content} fontSize="1rem" />;
}
```

```css
/* my-cjk-overrides.css */
.aim-typography-root.default {
  font-family: 'PingFang SC', 'Source Han Sans SC', 'Noto Sans CJK SC', sans-serif;
  --aim-font-family-headings: 'PingFang SC', 'Source Han Serif SC', serif;
  --aim-font-family-monospace: 'Fira Code', 'Noto Sans Mono CJK SC', monospace;
  --aim-line-height: 1.8;
  --aim-spacing-md: calc(var(--aim-font-size-root) * 1.15);
}
```

这就是完整的配置代码。解析器扩展、`remark-breaks`、SmartyPants（包含 CJK 引号预处理）以及盘古空格排版全部处于激活状态，因此中文段落中的被引内容（`中文"引号"中文`、`中文'引号'中文`）能够获得正常成对的前后弯引号，而不是被误判为两个闭引号。网络字体的预加载以及页面根节点的 `lang` 属性设置属于宿主应用程序的职责。

---

<span id="footguns"></span>

## 常见问题

<span id="disabling-pangu-when-content-is-already-pre-spaced"></span>

### 在文本已完成预加空格时关闭 pangu

部分内容生产流水线会在上游直接完成中西文/半角字符间的空格插入。在此类内容上运行 pangu **并不会造成双重空格**（该操作具有幂等性，已有空格处绝不追加第二层空格）——但它依然需要深度遍历 AST 语法树，在每次渲染中造成不必要的计算开销。如果你的上游内容已经绝对可靠地完成了空格排版，可以在 `enginePlugins` 中过滤移除 `pangu` 以完全跳过语法树遍历。但只要你的数据源中混入了未处理的内容，这一优化前提便不复存在。

<span id="asserting-on-exact-byte-content-in-tests"></span>

### 在自动化测试中断言严格的逐字节内容

Pangu 会向最终生成的渲染文本节点中插入真实字符。如果测试用例断言快照与原始 Markdown 源码严格逐字节相等，测试将会失败，因为经过 pangu 处理后 `今天用React` 会变成 `今天用 React`。解决方案包括：

- 在测试套件配置中关闭 pangu（在 `enginePlugins` 中剔除 `pangu`——如前文的 `filter` 写法）。
- 使用语义化匹配器（例如断言 `textContent.includes('React')`）代替严格逐字比对。

这一规则对 SmartyPants 同样适用——且受影响的不仅是引号：在固定版本的 `remark-smartypants` 处理下，直引号会转为弯引号，`--` 会转换为破折号，`...` 会转换为省略号。针对原生 CLI 风格字符串（如 `--verbose`）的严格断言将无法通过——这两个插件在默认配置下均处于激活状态。

<span id="engineplugins-replaces-the-array"></span>

### `enginePlugins` 采用整组替换机制

当你传入 `enginePlugins={[...]}` 时，你传入的数组会**完整覆盖替换**默认插件列表，而不是进行追加合并。如果你只想禁用 pangu，请保留其余插件：

```tsx
import { defaultEnginePlugins, pangu } from '@ai-markdown/react/plugins';

// ⚠️ Disables ALL engine plugins (loses comment removal + SmartyPants +
// highlight + definition lists too).
enginePlugins={[]}

// ✅ Keep everything except pangu (module scope — stable reference).
const PLUGINS = defaultEnginePlugins.filter((p) => p !== pangu);
enginePlugins={PLUGINS}
```

<span id="hair-space-vs-ascii-space-confusion"></span>

### 极细空格（Hair-space）与 ASCII 空格的区别

本库中的 pangu 插件插入的是**标准 ASCII 空格**（`U+0020`），而不是排版专用的极细空格（`U+200A`）。这完全遵循上游 `pangu` 官方包的既定行为。虽然视觉上的排版效果近乎一致，但执行逐字节 diff 或内容严格比对的工具会将其识别为单个普通空格，而不是窄空格。如果你确实需要渲染为极细空格，请自行覆盖外层容器或在下游对输出进行后置处理。

<span id="font-family-override-forgetting-font-family-on-the-root"></span>

### 覆盖字体时遗漏了根节点的 `font-family`

`--aim-font-family-headings` 变量专门用于控制标题字体。但设计变量中并不存在等价的正文字体变量；正文文本直接继承自排版根容器。因此，如果你需要为 CJK 布局指定不同的正文字体，请直接在 `.aim-typography-root.default` 容器类名上声明 `font-family`（如上文快速实践示例所示）——仅覆盖 `--aim-font-family-headings` 会导致正文继续沿用系统默认的回退字体。

<span id="diagnosing-multilingual-output"></span>

## 多语言排版问题排查定位

排查时请从能够复现问题的最小 Markdown 片段入手，并对异常表现进行分类定性：

1. 标点符号旁边出现原样字面字符 `**` 或 `~~`，说明属于分隔符识别未触发。请分别测试粗体和删除线；`==` 则属于完全独立的扩展解析器。
2. 文字书写系统之间出现了多余的空格，通常来自 pangu。尝试从插件列表中仅移除 `pangu` 并比对 `textContent`。
3. 引号变为弯引号或短横线被替换为破折号，源于 `smartypants` 插件（紧挨 CJK 字符的引号由 CJK 引号预处理把关，其余由 SmartyPants 掌控）。如果命令行参数示例必须原样保留原始标点符号，请将其放置在行内代码或围栏代码块内。
4. 源码中的单换行直接呈现为换行折行，源自 `remark-breaks`；而在视口边缘处的折行则源自 CSS 盒模型自动排版。
5. 缺失字形或文字高度不协调属于字体回退（font fallback）问题。请在浏览器开发者工具中检查实际生效渲染的真实物理字体，而不能仅看 CSS 声明列表中的首选字体。

在宿主应用程序的容器元素上，请结合具体内容恰当设置 `lang="zh-Hans"`、`lang="zh-Hant"`、`lang="ja"` 或 `lang="ko"`。这能准确向浏览器和无障碍辅助技术传递语言上下文；但它不会改变本库内部的插件选择。包含多种混合语言的长篇内容可能需要在更精细的行内层级声明语言标注。

在编写验证用例时，建议构造包含以下特征的输入源：紧邻强调符号的中文标点、日文引号括号、韩文/拉丁混合标识符、紧邻数学公式的货币符号、行内代码、表格单元格以及注音旁注（ruby）。既要测试完整的文本字符串，也要测试停留在未闭合分隔符中间的流式截断前缀。仅看最终输出快照无法验证中间状态源码是如何被解析处理的。

底层实现代码参考 [`pluginChain.ts`](../../../../packages/engine/src/components/pluginChain.ts)；默认的 CSS 样式定义位于 [`default.scss`](../../../../packages/react/src/components/typography/variants/default.scss)。这些文件清晰隔离了解析器配置与排版样式规则。

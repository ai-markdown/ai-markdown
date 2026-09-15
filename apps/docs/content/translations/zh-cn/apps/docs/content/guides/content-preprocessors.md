# 内容预处理器（Content Preprocessors）

预处理逻辑由共享的 Engine 执行。下文使用 React 示例；Vue 同样导出 `createRemendPreprocessor` 和 `AIMDContentPreprocessor`，通过 `:content-preprocessors` 传入。参见 [Vue 指南](../reference/vue.md#component-props)和[安装配置](getting-started.md)。

内容预处理器是一个同步函数，类型为 `(content: string) => string`。它在 Markdown 解析前处理文本，例如移除 Frontmatter、把业务标记转换成标准 Markdown，或规范已知的输入格式。它只能读取字符串，不能访问语法树或 React Context。

```tsx
import AIMarkdown, { type AIMDContentPreprocessor } from '@ai-markdown/react';

const stripFrontmatter: AIMDContentPreprocessor = (content) => {
  if (!content.startsWith('---\n')) return content;
  const end = content.indexOf('\n---\n', 3);
  return end < 0 ? content : content.slice(end + 5);
};
const PREPROCESSORS = [stripFrontmatter];

<AIMarkdown content={raw} contentPreprocessors={PREPROCESSORS} />;
```

这个示例仅处理以 LF 换行的特定 Frontmatter 格式，未闭合的头部会原样保留；它不是通用 YAML 解析器。请在模块作用域定义函数和数组；如果依赖应用配置，可使用 `useMemo`。预处理器不支持异步返回值，远程请求等异步操作应在传入 `content` 前完成。

<span id="execution-order"></span>

## 执行顺序

最外层的 React 组件会首先剥除文本开头的每一个 Unicode 字节顺序标记（BOM，U+FEFF），随后执行内置的 LaTeX 预处理阶段，最后按照数组中的先后顺序依次调用你提供的各个预处理器。每个函数接收上一阶段函数的输出作为输入：

```ts
// With contentPreprocessors={[a, b, c]}:
const result = c(b(a(latexNormalizedContent)));
```

预处理首先移除文本开头连续的所有 U+FEFF 字符。Markdown 解析器会忽略第一个 BOM，但节点坐标不计入它；增量解析器、块规划器和定义扫描器又需要把坐标对应到源文本。先移除 BOM，可以让两者使用一致的坐标。

这是预处理层的规则，与直接解析原文有所不同：原生解析 `\uFEFF\uFEFF# Heading` 时，第二个 BOM 会保留为文本，得到一个段落；本库移除开头的整个 BOM 序列后会得到标题。因此结果不受转码或流式重组带入的 BOM 数量影响。正文其他位置的 U+FEFF 原样保留，自定义预处理器不会再收到开头的 BOM。

LaTeX 预处理器识别数学分隔符和货币符号，保护代码区域，规范括号形式的公式，并转义公式中的 `|`，避免它被当成 GFM 表格分隔符。行内 `$x$` 和 `\(x\)` 会转换成 `$$x$$`，交给配置了 `singleDollarTextMath: false` 的 `remark-math` 处理；块级公式按行识别分隔符。因此，自定义预处理器收到的美元符号写法可能已被规范化。

已知 HTML 标签也会受到保护，例如 `<span>$</span>100` 会保留美元符号。标签必须符合 CommonMark 属性语法、内部不能包含 `>`，也不能跨越空行。因此，正文中的 `a<b` 不会使后面的公式跳过处理。

字面内容标签 `<code>`、`<pre>`、`<kbd>`、`<samp>`、`<math>` 和 `<svg>` 会保护整个配对区域；如果开始标签的闭合标签尚未到达，则从该标签起直到输入末尾的全部内容都受保护。这是流式渲染的约定：闭合标签可能还在路上，若在它到达前就转换区域内的 `$`，会改写之后才被确认为代码的字节。永远不闭合的标签同样适用这条规则，所以在 `Use the <code> tag. Then $x^2$` 中，公式在文档余下部分都会保持为普通文本。把这类标签写成行内代码（`` `<code>` ``）或转义（`&lt;code&gt;`），后面的公式就能正常渲染。

只有当文档中出现数学分隔符（任意位置的 `$`、`\[` 或 `\(`）时，这一阶段才会生效。其他 LaTeX 命令不是触发条件，因为在公式分隔符之外它们只是普通文本。一个可见的结果是：`\text{a_b}` 中的下划线只有在文档某处存在分隔符后才会被转义；在此之前输入原样返回，增量预处理器会在第一个分隔符到达时再转换前面的文本。对同一份完整输入，两个入口产生的字节完全一致。

行内公式只在当前行内匹配。如果一行结束时单个 `$` 仍未配对，例如 `quoted in US$ per unit`，它会作为普通文本，后续行的 `|` 不受影响。只有输入最后一行中未配对的 `$` 会使其后的 `|` 暂时转义，直到这一行完成。

未闭合块级公式是否截断取决于源文本语法。预处理器不接收 `streaming`，所以不完整的静态文档也可能被截断。行中未配对的 `$$` 不会直接开启块级公式：如果段落先于闭合符结束，它会作为普通文本，也不会与后面公式块的起始符配对。例如，`It costs $$100 per month.` 后面的独立公式块不会因此被截断。只有行首 `$$` 可以跨空行继续匹配；这类公式块在输入结束时仍未闭合，才会被截断。

挂载后的每个 React 渲染器均独立持有一套感知追加状态的增量 LaTeX 预处理器。它在可能的情况下会复用已验证的前缀成果，并在检测到非追加形式的输入变动时重置状态；其处理结果与对同一输入全量运行无状态 `preprocessLaTeX` 的结果保持逐字节一致。你的自定义预处理器函数在每次内容更新时依然会接收完整的规范化文本。增量解析引擎无法消除调用方自定义全文本遍历函数所带来的计算成本。

React 适配器在输入为空时跳过预处理。因此，请在应用组件中渲染空消息占位，不要依赖预处理器生成占位内容。

<span id="builtin-optional-streaming-tail-repair-createremendpreprocessor"></span>

## 可选的流式尾部修复（`createRemendPreprocessor`）

流式内容的末尾经常是不完整语法，例如 `**bold`、未闭合的 `` `code `` 或 `[link](url`。默认情况下，它们会保留字面符号，直到闭合字符到达。本库提供可选的 `createRemendPreprocessor`，封装了从 Vercel Streamdown 提取的 Markdown 修复库 [`remend`](https://www.npmjs.com/package/remend)（零依赖，Apache-2.0），用于补全这些未闭合标记：

```tsx
import AIMarkdown, { createRemendPreprocessor } from '@ai-markdown/react';

// Module scope — see “Reference stability” below.
const PREPROCESSORS = [createRemendPreprocessor()];

<AIMarkdown content={streamed} streaming contentPreprocessors={PREPROCESSORS} />;
```

该功能需要显式启用。未使用的修复代码能否从产物中移除，取决于发布构建和应用的打包器；请以实际构建结果判断体积变化。

支持修复粗体、斜体、粗斜体、行内代码、删除线、链接、图片、Setext 标题歧义，以及零散 `>` 和 `~` 的误判。未完成的图片会被**丢弃**，不会渲染占位图。修复规则随依赖版本而变，虽然目标是保留完整 Markdown，升级时仍应测试典型的完整和不完整输入。

本库对原生 `remend` 的默认配置做了两项重要调整，其中一项支持覆盖，另一项为强制锁定：

- `linkMode: 'text-only'`（可覆盖）：remend 默认使用 `streamdown:incomplete-link` 作为未完成链接的占位 URL，但本库会过滤未知协议。`text-only` 会在真实 URL 到达前显示普通文本；如果应用自行处理该占位协议，可以传入 `{ linkMode: 'protocol' }`。
- `katex`/`inlineKatex`：**强制锁定关闭**（不可覆盖，且已从配置类型中移除）——内置的 LaTeX 预处理器始终优先运行，负责 `$`/`$$` 的处理以及未闭合 `$$` 尾部的截断。若两个处理器同时争夺对同一套数学分隔符的改写权，会相互干扰。

<span id="interactions-with-the-streaming-optimizations"></span>

### 与流式优化的关系

- **块级缓存（`blockMemo`，默认开启）**：修复只影响尾部，前面稳定块的字节和缓存的 hast 不变。
- **增量解析（`incrementalParse`）**：补入闭合字符后，当前帧可能不再是上一帧的纯追加，解析器会在这些帧回退到全量解析。回退不会持续锁定；真实闭合字符到达后可恢复增量拼接。普通文本通常只有少数帧受到影响，行内语法密集时影响会更多。两项优化可以一起使用，代价是部分拼接机会换成了中间帧的格式完整性。

<span id="footguns-repair"></span>

### 使用注意事项

- **预处理器工厂函数仅创建一次**（声明在模块顶层作用域或使用 `useMemo`）。在每次渲染中临时调用工厂函数会破坏 `contentPreprocessors` 的稳定引用校验，导致每一帧都全量重跑整条流水线。
- **在长文本输入下度量修补开销。** 传入的函数在每次内容更新时都会携带完整字符串调用 remend。当前依赖版本为 remend 1.3.1（包含了扫描算法调整）；早期的历史性能数据无法代表当前版本的真实开销。建议在真实的打字机节奏下，针对长篇文字、重度代码以及残缺行内语法进行充分的性能 Profile 分析。
- **切勿应用于静态固定内容。** 如果一份正规文档本身就合法地以某种未闭合符号结尾（例如末尾刻意留了一个孤立的星号 `*`），它会被无差别强制闭合。请将该特性严格限定在流式交互 UI 中，或在 `streaming` 转为 false 时动态将其卸载（参考下文的状态切换模式）。
- **修补逻辑在 `preprocessLaTeX` 之后执行**（它运行在调用方插槽中）。在极少数流式中间帧中，若尚未闭合的代码片段内部恰好包含了货币符号（如 `` `$100 and… ``），LaTeX 阶段可能会在反引号被修补闭合之前就抢先对 `$` 执行了转义——这仅仅是该单帧内的瞬时短暂现象；一旦真正的闭合反引号流出，格式便会自动自愈。

---

<span id="recipes"></span>

## 常见用法

<span id="strip-yaml-frontmatter"></span>

### 剥除 YAML Frontmatter

```ts
const stripFrontmatter: AIMDContentPreprocessor = (content) => {
  if (!content.startsWith('---\n')) return content;
  const end = content.indexOf('\n---\n', 3);
  return end === -1 ? content : content.slice(end + 5);
};
```

开头的强校验将该转换严格限制在起始偏移量为 0 的头部区域，闭合标记查找避免了误吞不完整的残缺头部。如果源文本格式需要支持 CRLF 或文件末尾闭合标记，可补充相应逻辑。无论是该精简实现还是复杂的正则表达式，均不等同于通用的 YAML 解析器。

<span id="normalize-curly-quotes-back-to-straight"></span>

### 将弯引号规整恢复为直引号

本库默认开启了 SmartyPants，会自动将直引号转为排版弯引号。如果下游工具（如 `<input>` 自动补全等）严格依赖直引号，请通过在 `enginePlugins` 中过滤移除 `smartypants` 的方式，**在流水线看到它们之前**将其关闭（参考 [过滤模式](cjk-typography.md#engineplugins-replaces-the-array)）——预处理器运行的时机过早，无法逆转 remark 插件后续尚未做出的决策。

<span id="autolink-bare-urls-that-the-model-emitted-without"></span>

### 自动链接大模型未包裹 `<…>` 输出的裸 URL

GFM 已经能够在段落中自动链接 `https://…`。但部分模型输出会将 URL 与相邻的中文或标点符号紧密粘连（例如 `请查阅 https://example.com。`），导致 GFM 的切词识别出现偏差。预处理器可以将此类模式改写为显式的 `<url>` 语法：

```ts
const explicitAutolinks: AIMDContentPreprocessor = (content) =>
  content.replace(/(?<![<\(\[\w])(https?:\/\/[^\s<>"]+?)(?=[.,;:?!]?(?:\s|$))/g, '<$1>');
```

<span id="convert-too-many-blank-lines-to-standard-paragraph-breaks"></span>

### 将连续多余的空行规整为标准段落换行

```ts
const normalizeBlankLines: AIMDContentPreprocessor = (content) => content.replace(/\n{3,}/g, '\n\n');
```

请仅在空行确实无关紧要的源文本上应用此规则。全局正则替换同样会修改围栏代码块内部的空行，并可能影响列表的疏密布局与源码位置映射。源文本字节数的缩减并不必然带来缓存命中的提升；建议对包含持续增长空行的数据流进行基准测试验证。

<span id="replace-wikilink-syntax-with-standard-markdown-links"></span>

### 将 `[[双链]]` 语法替换为标准 Markdown 链接

```ts
const wikiLinks: AIMDContentPreprocessor = (content) =>
  content.replace(/\[\[([^\]]+)\]\]/g, (_, name) => `[${name}](/wiki/${encodeURIComponent(name)})`);
```

这在对接输出类似 Obsidian 知识库风格语法的 AI 助手时常见。采用预处理器方案能够让整套流水线的其余环节（安全清洗、自定义组件、KaTeX 公式）完全无需改动而保持正常工作。

<span id="translate-llmspecific-markers"></span>

### 翻译大模型专属标记（如 "[end of stream]"、引文标签等）

```ts
const stripStreamMarkers: AIMDContentPreprocessor = (content) =>
  content.replace(/\[end of stream\]\s*$/i, '').replace(/<\/citation>/g, '');
```

非常适用于过滤上游大模型输出的特殊控制哨兵字符（Sentinels）。

<span id="multistep-pipeline"></span>

### 多阶段复合流水线

```ts
const pipeline: AIMDContentPreprocessor[] = [
  stripFrontmatter,
  normalizeBlankLines,
  stripStreamMarkers,
  wikiLinks,
];

<AIMarkdown content={raw} contentPreprocessors={pipeline} />
```

推荐通过数组编排流水线，而不是将所有逻辑杂糅在单个超大函数中——这样每个步骤都可以进行独立的单元测试。

---

<span id="reference-stability"></span>

## 引用稳定性规范

`contentPreprocessors` 在稳定性防护网中被标记为 **`WARN_ONLY`**（仅告警）级别属性（参见 [流式与性能 → 函数值例外规范](streaming-and-performance.md#the-function-valued-exception-urltransform-contentpreprocessors)）：由于函数数组无法进行深度内容递归比对，因此不存在自动的 `useStableValue` 安全兜底机制。在 JSX 中直接书写行内数组意味着每一帧渲染都会生成一个全新的数组引用——这会导致父组件即使在源文本完全未变的情况下也强行重跑预处理链；当转换后的字符串或依赖项发生真实变动时，下游的所有工作将被迫重做；在开发环境中，短时间内频繁变动引用会触发控制台告警。对于固定转换，请声明在模块顶层作用域；对于动态依赖应用状态的场景，请使用带有完备依赖项数组的 `useMemo`：

```ts
// ✅ Stable identity — the chain runs only when `content` changes.
const PREPROCESSORS: AIMDContentPreprocessor[] = [stripFrontmatter, normalizeBlankLines];

function App({ content }) {
  return <AIMarkdown content={content} contentPreprocessors={PREPROCESSORS} />;
}
```

函数声明仅在其所在的外层作用域本身稳定时才是稳定的。在组件渲染函数内部声明的函数每次都会重新分配。当闭包必须捕获动态组件状态时请使用 `useCallback`；切勿仅仅为了维系缓存而违背逻辑强行冻结过期闭包。

---

<span id="when-a-preprocessor-is-the-wrong-tool"></span>

## 何时不适合使用预处理器

预处理器仅在纯文本层面上操作。它无法感知解析后的抽象语法树（AST），无法区分当前文本究竟是属于围栏代码块内部还是属于常规正文段落，因此难以避免对代码块内部的内容造成误伤：

````markdown
Look at this output:

```text
---
my-frontmatter-looking-block
---
```
````

如果在此类内容上执行使用 `content.replace(/^---[\s\S]*?---\n/, '')` 的 `stripFrontmatter` 预处理器，虽然在此例中凑巧没事（因为 `---` 并不在文档起始处），但若编写不够严密的正则表达式，极易把代码块内部的代码破坏。对于需要改变 HTML 元素渲染呈现的诉求，请使用能够接收已解析语法树元素的 `customComponents`。真正的语法语义层级转换需要由具备 AST 感知能力的专用插件流水线以及明确的正确性约定来承载。

React 适配器仅提供了一套经过严格测试的封闭式插件集，并不支持随意向内注入任意第三方 remark/rehype 插件。边界扫描器与等价性验证套件专门针对这套选定的核心语法保驾护航。[React 扩展子包](extending-via-subpackage.md) 推荐通过组合官方公开的插槽与 Provider 实现定制，而非强行开启隐秘的插件后门。如需引入全新的 Markdown 语法，建议向上游提交功能提案，或者自行基于 engine 引擎构建一套独立的集成层并承担相应的校验测试。

---

<span id="footguns"></span>

## 常见问题

<span id="mutating-shared-state-inside-a-preprocessor"></span>

### 在预处理器内部修改外部共享状态

预处理器是在组件渲染阶段被直接调用的。在函数体内部修改模块级全局状态会导致 React 并发渲染（Concurrent Rendering）模式下出现严重的数据不一致问题（被中断抛弃的渲染帧可能已局部修改了全局状态且永远无法回滚）：

```ts
// ⚠️ Mutating shared state inside a preprocessor.
let callCount = 0;
const counting: AIMDContentPreprocessor = (content) => {
  callCount++; // visible to other parts of the app, not safe under concurrent rendering
  return content;
};

// ✅ Preprocessors should be pure.
```

<span id="preprocessor-that-depends-on-streamingstate"></span>

### 预处理器逻辑依赖流式状态

预处理器不接收 `streaming`。需要根据流式状态切换转换逻辑时，可以采用以下两种方式：

1. **无条件在预处理器中执行转换。** 绝大多数文本清洗操作（剥除 Frontmatter、规整多余空行）在部分输出的流式文本上运行本身就是完全安全的。
2. **将分支决策上移至调用方。** 在 `<AIMarkdown>` 的上游预先计算出期望的 `content` 字符串。

```tsx
function StreamingDoc({ rawContent, isStreaming }) {
  const content = useMemo(() => (isStreaming ? rawContent : finalCleanup(rawContent)), [rawContent, isStreaming]);
  return <AIMarkdown content={content} streaming={isStreaming} />;
}
```

<span id="preprocessor-thats-expensive-on-long-inputs"></span>

### 在超长输入上运行高 CPU 开销的预处理器

本库在 `content` 发生任何改变时均会重新执行预处理器链——在流式输出期间这意味着每个 Chunk 到达时都会全量重跑。如果预处理器的单次执行时间复杂度达到 `O(n²)`，它将迅速成为拖垮整个页面性能的头号元凶。

对于超大型长篇文档，请使用轻量级、单次遍历（Single-pass）的正则表达式；在盲目优化前，请使用 React DevTools Profiler 进行真实性能采样。

<span id="streamonly-repair-with-explicit-completion-behavior"></span>

## 仅在流式阶段开启修补并明确完成后的呈现行为

当希望在流式输出结束时彻底停止修补逻辑时，可以在组件调用处基于稳定的数组引用进行条件切换：

```tsx
import AIMarkdown, { createRemendPreprocessor } from '@ai-markdown/react';

const REPAIR = [createRemendPreprocessor()];

function RepairedMessage({ content, pending }: { content: string; pending: boolean }) {
  return <AIMarkdown content={content} streaming={pending} contentPreprocessors={pending ? REPAIR : undefined} />;
}
```

最终完成的一帧更新会刻意使用未经人工修补的原始真实源码重新求值。如果上游原始源文本恰好真的以残缺未闭合的语法结尾，最后一帧的视觉呈现可能会发生回退改变。仅当容纳并补全此类残缺语法明确属于你的产品契约一部分时，才建议在流式结束后依然保留修补处理器。

当结合平滑打字机流式组件（Smooth streaming）使用时，需明确语法修补是跟随底层的“数据源到达完毕”还是跟随上层的“视觉渐进呈现完毕”。如果将修补逻辑放置在 `useSmoothStream` 之后、并传入其返回的 `streaming` 标记，可以在缓冲队列排空期间让中间展示的前缀始终处于被修补的美化状态。如果将修补逻辑放在匀速节流调度之前，处理的是完全不同的源字符串，可能会生成略有出入的中间渲染帧。

<span id="verification-and-source-locations"></span>

## 验证策略与核心源码索引

针对编写的每一个预处理函数，测试用例必须覆盖：空字符串输入、部分残缺的头部或标记、完整的标准文档、以及将相同文本放置在围栏代码块内部的防御测试。针对流式应用场景，请对比一系列逐步追加累积的前缀帧，而不仅是孤立的增量切片。务必包含重置更新的测试场景：当用户点击“重新生成回答”时，感知追加的预处理器必须能够立即清空陈旧状态。

核心编排逻辑位于 [`preprocessors/index.ts`](../../../../packages/engine/src/preprocessors/index.ts)，每个实例的包装器在 [`react/src/index.tsx`](../../../../packages/react/src/index.tsx) 中创建。[`latex.ts`](../../../../packages/engine/src/preprocessors/latex.ts) 负责公式规整及其增量解析实现；[`remend.ts`](../../../../packages/engine/src/preprocessors/remend.ts) 固化了语法修补的预设选项。LaTeX 等价性测试套件与原子级差分测试套件确保了内置实现与标准参考路径严格对齐。自定义预处理器需要另行测试。

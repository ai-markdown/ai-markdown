# React 自定义组件

React 适配器使用 `customComponents` 与 React children 子组件树。Vue 适配器使用 `components` 或带有 `MarkdownElementContext` 上下文的具名元素插槽。参见 [Vue 指南](../reference/vue.md#custom-vue-components-and-slots) 与 [安装配置](getting-started.md)。

`customComponents` 允许你替换由 Markdown 流水线生成的特定 HTML 标签对应的 React 渲染组件。常用于链接、图片、表格、各级标题、任务清单勾选框以及需要承载复杂业务逻辑的代码块。Markdown 核心语法解析依旧由底层流水线接管；你的自定义组件仅负责接收转换后的 HTML 元素属性、已解析的 React children，以及可选的底层 hast 语法树 `node` 节点。

```tsx
import AIMarkdown, { type AIMarkdownCustomComponents } from '@ai-markdown/react';

const COMPONENTS = {
  a: ({ node, children, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
} satisfies AIMarkdownCustomComponents;

<AIMarkdown content="Read [the guide](/guide)." customComponents={COMPONENTS} />;
```

上述首个示例将所有链接均在新标签页中打开。下方的外部链接实战则展示了如何实现条件判断。无论采用哪种策略，在向原生 DOM 元素透传 props 之前，**请解构移除 `node` 属性**：它是语法树层面的元数据，并非合法的 HTML DOM 属性。若希望自定义组件保留默认的链接行为，请妥善保留 `id`、`title` 以及 `data-footnote-ref` 等语义属性。

该属性类型对齐了底层封装的 Markdown 渲染组件的 `Components` 类型定义。常用的键名包括 `a`、`img`、`p`、`pre`、`code`、`blockquote`、`h1`–`h6`、列表标签以及各类表格标签。GFM 扩展追加了 `del` 与任务列表的 `input`；可选语法扩展则支持 `mark`、`dl`、`dt` 与 `dd`。生成的 KaTeX 数学公式节点同样会流经元素渲染，因此若覆盖了全局范围的 `span` 渲染器，必须确保其能兼容处理数学公式的节点输出。

自定义渲染器运行在标准 HTML 与 URL 清洗策略之后。由你在自定义渲染器内部自行拼装或注入的新 URL 不会倒流回 Markdown 流水线进行再次清洗。由应用程序自行生成的跳转目的地，需由应用自身负责安全把关；详见 [URL 清洗规范](url-sanitization.md)。

<span id="recipes"></span>

## 常见用法

<span id="lazy-load-images"></span>

### 图片懒加载

```tsx
const components: AIMarkdownCustomComponents = {
  img: ({ src, alt, title }) => <img src={src} alt={alt ?? ''} title={title} loading="lazy" decoding="async" />,
};
```

对于未声明替代文本的 Markdown 图片，`alt` 属性可能为 `undefined`——将其强制回退为 `''`（空字符串）以满足 Web 无障碍（a11y）标准。

<span id="open-external-links-in-a-new-tab-keep-internal-links-in-tab"></span>

### 外部链接在新标签页打开，站内链接在当前页跳转

对于内部导航采用相对路径的站点，通过正则校验 HTTP(S) 协议是一种简单的策略。该规则会将所有绝对的 HTTP(S) 链接归类为外链（包括指向相同源域名下的绝对地址）。如果你的应用内容在站内导航中也使用了绝对 URL，建议将链接地址与应用程序配置的当前域名（Origin）进行额外比对。

```tsx
const COMPONENTS = {
  a: ({ node, href, children, ...props }) => {
    const external = /^https?:\/\//i.test(href ?? '');
    return (
      <a {...props} href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {children}
      </a>
    );
  },
} satisfies AIMarkdownCustomComponents;
```

页面内锚点链接（Hash fragment）将保持在当前标签页内跳转。透传其余所有属性能够完整保留脚注 ID 以及辅助技术无障碍元数据。前端路由专用组件（如 Next.js 的 Link 等）同样可以使用此判定逻辑，前提是其 props 能够兼容你透传的各项属性。

<span id="wrap-tables-for-horizontal-scroll-on-mobile"></span>

### 为表格添加移动端横向滚动容器

```tsx
const components: AIMarkdownCustomComponents = {
  table: ({ children }) => (
    <div className="table-scroll-wrapper">
      <table>{children}</table>
    </div>
  ),
};
```

<span id="render-task-list-checkboxes-as-toggleable-controls"></span>

### 将任务列表勾选框渲染为可交互控件

GFM 任务列表复选框在到达渲染层时默认带有 `disabled` 属性。如果透传的 props 依然保留了该属性，仅仅将 `checked` 改为 `defaultChecked` 是无法使其恢复可点击状态的。必须显式解构移除 `disabled`，建立本地组件状态，并在 Markdown 源文本中的 checked 发生更新时同步刷新该状态：

```tsx
import { useEffect, useState } from 'react';

type TaskInputProps = React.ComponentPropsWithoutRef<'input'>;

function TaskInput({ checked, disabled, type, ...props }: TaskInputProps) {
  const [selected, setSelected] = useState(Boolean(checked));
  useEffect(() => setSelected(Boolean(checked)), [checked]);
  if (type !== 'checkbox') return <input {...props} type={type} disabled={disabled} />;
  return (
    <input
      {...props}
      type="checkbox"
      checked={selected}
      onChange={(event) => setSelected(event.currentTarget.checked)}
      aria-label={props['aria-label'] ?? 'Markdown task'}
    />
  );
}

const COMPONENTS = {
  input: ({ node, ...props }) => <TaskInput {...props} />,
} satisfies AIMarkdownCustomComponents;
```

此操作仅改变了页面展示控件的交互状态；它**并不会直接篡改或编辑 `content` 源文本**。持久化该变更应通过 [元数据上下文](metadata-context.md) 注入的应用层业务回调函数来完成，同时结合由你的业务数据派生出的稳定任务标识符与无障碍描述文本。解析器生成的源码偏移量（offset）虽然能够精确定位某次解析版本中的任务位置，但在源文本被编辑或经过预处理修改后，它无法作为长期持久的稳定标识。

<span id="copy-button-on-code-blocks"></span>
<span id="custom-code-block-with-copy-button-react-no-mantine"></span>

### 为代码块添加一键复制按钮

Markdown 代码块由外层 `<pre>` 与内层 `<code>` 组合而成。`pre` 渲染器通常接收一个 React `<code>` 元素作为其子节点。因此直接执行 `String(children)` 只会输出 React 对象的字符串描述而非代码文本，若再将这些 children 放入另一个 `<code>` 中则会造成非法的代码标签嵌套。正确的做法是：读取语法树中文字形式的 hast 子节点，同时完整保留原始的 React children 用于页面展示：

```tsx
import { useRef, useState } from 'react';
import { useAIMarkdownState, type AIMarkdownCustomComponents } from '@ai-markdown/react';

type PreRenderer = NonNullable<AIMarkdownCustomComponents['pre']>;

const CopyablePre: PreRenderer = ({ node, children, ...props }) => {
  const { streaming } = useAIMarkdownState();
  const preRef = useRef<HTMLPreElement>(null);
  const [feedback, setFeedback] = useState('');
  const code = node?.children.length === 1 ? node.children[0] : undefined;
  const source =
    code?.type === 'element' && code.tagName === 'code' && code.children.every((child) => child.type === 'text')
      ? code.children.map((child) => (child.type === 'text' ? child.value : '')).join('')
      : undefined;

  async function copy() {
    try {
      await navigator.clipboard.writeText(source ?? preRef.current?.textContent ?? '');
      setFeedback('Copied');
    } catch {
      setFeedback('Copy failed; select and copy the code manually.');
    }
  }

  return (
    <div className="code-block">
      <button type="button" onClick={copy} disabled={streaming}>
        Copy code
      </button>
      <span role="status">{feedback}</span>
      <pre {...props} ref={preRef}>
        {children}
      </pre>
    </div>
  );
};

const COMPONENTS = { pre: CopyablePre } satisfies AIMarkdownCustomComponents;
```

操作工具栏放置在 `<pre>` 外部，这样 pre 的空白符排版规则不会把按钮格式化为代码文本，且复制兜底逻辑也不会将工具栏按钮文本夹杂进去。提取出的代码内容完整保留了解析器保留的末尾换行符。除非产品层面明确要求剔除空白字符，否则应避免随意调用 `trim()` 或 `trimEnd()`。上述方案复制的是解析后的纯文本代码；如果你需要与源文件完全逐字节一致的代码切片，请在外部单独保存原始输入与其预处理映射表。

在本示例中，`streaming` 状态下禁用了复制功能。这属于应用层面的产品决策：其他业务界面也可以允许用户复制未完成的流式代码片段。向系统剪贴板写入内容可能会因权限问题失败，因此本示例显式向用户展示了失败提示，而不是静默谎报复制成功。

<span id="add-anchor-links-to-headings"></span>

### 为标题添加锚点链接

```tsx
const components: AIMarkdownCustomComponents = {
  h2: ({ children, id }) => (
    <h2 id={id}>
      {id && (
        <a href={`#${id}`} className="heading-anchor">
          #
        </a>
      )}
      {children}
    </h2>
  ),
};
```

该渲染器仅保留已存在的 `id`，它本身不会凭空自动创建新 id。官方默认流水线中未包含根据文本自动生成 slug 的插件，因此常规 Markdown 标题默认不会生成自动化 slug。由源文本 HTML 显式声明并允许放行的 ID，会自动通过 `documentId` 添加命名空间前缀——关于多文档页面如何避免 ID 命名碰撞，请参阅 [架构设计](architecture.md#documentid-and-clobber-prefix)。

---

<span id="reference-stability-matters"></span>

## 引用稳定性（Reference Stability）的重要性

`customComponents` 会直接参与块级缓存缓存（block-memo cache）的有效性校验。虽然库内部通过深度比对（`useStableValue`）对传入的对象进行了稳定性收敛，能够容忍直接声明行内对象——但每次渲染都要执行深层比对是存在性能开销的。最佳实践是在模块顶层作用域定义组件映射，或者使用 `useMemo` 进行包裹：

```tsx
// ⚠️ Re-created every render — internal deep-equal catches it, but pays a deep-compare cost.
<AIMarkdown content={c} customComponents={{ a: MyLink }} />;

// ✅ Stable identity, zero overhead.
const COMPONENTS = { a: MyLink } satisfies AIMarkdownCustomComponents;
<AIMarkdown content={c} customComponents={COMPONENTS} />;
```

组件函数本身的引用同样应当保持稳定。在模块顶层作用域使用 `function MyLink() {…}` 声明或定义 `const MyLink = (props) => …` 是非常规范的做法。如果直接在父组件的渲染函数体内部临时定义函数，会导致每一帧渲染都会生成一个全新的函数引用：

```tsx
// ⚠️ New MyLink reference every render.
function Parent({ content }) {
  const MyLink = (props) => <a {...props} target="_blank" />;
  return <AIMarkdown content={content} customComponents={{ a: MyLink }} />;
}
```

---

<span id="interaction-with-mantine-defaults"></span>

## 与 Mantine 默认组件的交互机制

`@ai-markdown/react-mantine` 内置了其专属的 `customComponents.pre` 实现，用于驱动语法高亮、Mermaid 图表渲染以及 JSON 美化折叠。调用方传入的自定义组件会**层叠合并**在 Mantine 默认组件之上——你的自定义覆盖具有最高优先级：

```tsx
// Mantine handles <pre>, you handle <a>:
<MantineAIMarkdown content={c} customComponents={{ a: MyLink }} />

// Mantine still handles <pre> — your <a> override doesn't affect it.
```

如果你自行提供了 `pre` 渲染器，你将彻底接管并替换 Mantine 原有的整个代码块处理链路：

```tsx
// ⚠️ Disables Mantine's CodeHighlight, Mermaid, JSON pretty-print.
<MantineAIMarkdown content={c} customComponents={{ pre: MyPlainPre }} />
```

有时候这正是你的业务诉求（例如你想使用自己专属的代码高亮方案）——但务必清楚这样做的连锁影响。

反之亦然：由于 Mantine 的 `pre` 渲染器通过其内部的 `CodeHighlight` / Mermaid / JSON 流程来渲染围栏代码块，它在内部**不会**挂载底层的 `code` 标签——因此覆盖 `customComponents.code` 仅会影响**行内代码**（如 `` `行内代码` ``），不会触及围栏代码块。如果需要在 `@ai-markdown/react-mantine` 下定制围栏代码块的呈现，请直接覆盖 `pre`（并自行接管高亮），或者使用官方包文档中记录的 `codeBlock` 分组属性（如 `defaultExpanded`、`autoDetectUnknownLanguage` 等）。

---

<span id="accessing-the-underlying-mdast-hast-node"></span>

## 访问底层的 mdast/hast 语法树节点

可选的 `node` prop 是一个 hast 元素（Element），并非 Markdown 侧的 mdast 节点。它描述了传递给当前渲染器的 HTML 侧抽象语法树元素。当你需要获取标准 HTML 属性之外的底层信息时可以使用它。请始终使用可选链（`?.`）进行安全访问——对于合成元素（例如自定义 remark 插件输出的未带位置信息的节点、或者库内部的占位符元素），`node` 可能会是 `undefined`，即使 `node` 存在，其 `node.position` 同样是可选的。

```tsx
const components: AIMarkdownCustomComponents = {
  code: ({ node, className, children }) => {
    const language = className?.replace('language-', '');
    const sourceOffset = node?.position?.start?.offset;
    // …use language and sourceOffset for analytics, syntax highlighting, etc.
    return <code className={className}>{children}</code>;
  },
};
```

`node.position` 记录了当前节点在传入解析器的预处理 Markdown 源文本中的具体行列与偏移量位置——非常适用于实现差异化行为（例如：“仅对文档前 100 个字符内的代码块展示行号”）。

<span id="generating-ids-that-share-the-document-namespace"></span>

### 生成共享文档命名空间的 ID

为了避免多个 `<AIMarkdown>` 实例同时存在时脚注锚点与 Hash 链接产生冲突，本库会为所有可被污染的属性（`id="..."` / `href="#..."`）自动加上特定于当前文档的命名空间前缀。如果你的自定义组件需要自行生成 ID（例如各级标题的锚点跳转），应当使用完全相同的前缀，而不是随意拼接。从文档上下文中直接读取 `clobberPrefix`：

```tsx
import { useAIMarkdownDocument } from '@ai-markdown/react';

import { Children, isValidElement, type ReactNode } from 'react';

function textOf(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child);
      return isValidElement<{ children?: ReactNode }>(child) ? textOf(child.props.children) : '';
    })
    .join('');
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const components: AIMarkdownCustomComponents = {
  h2: ({ children }) => {
    const { clobberPrefix } = useAIMarkdownDocument();
    const text = textOf(children);
    const id = `${clobberPrefix}heading-${slugify(text) || 'section'}`;
    return (
      <h2 id={id}>
        <a href={`#${id}`} className="heading-anchor">
          #
        </a>
        {children}
      </h2>
    );
  },
};
```

`clobberPrefix` 的具体字节形式（对于长 ID 会经过 MurmurHash3 进行哈希压缩以精简 HTML 体积）并不属于公共 API 稳定性契约的一部分——**请始终通过 `useAIMarkdownDocument()` 进行读取**，切勿自行根据 `documentId` 重新推算。

---

<span id="footguns"></span>

## 常见问题

<span id="call-hooks-before-conditional-returns"></span>

### 必须在条件分支返回之前调用 React Hooks

自定义组件是由 `react-markdown` 针对每个语法树节点逐一调用的。它们与常规 React 组件一样可以使用各类 Hooks——但每一条代码执行路径上，Hooks 的调用次数与调用顺序必须完全一致。React 官方的 Hooks 规则在此处完全适用：

```tsx
// ⚠️ Calling a Hook conditionally breaks rules-of-Hooks.
const components: AIMarkdownCustomComponents = {
  a: ({ href }) => {
    if (!href) return null;
    const { colorScheme } = useAIMarkdownTheme(); // Hook after conditional return
    return <a href={href}>{colorScheme}</a>;
  },
};

// ✅ Hooks first, conditional later.
const components: AIMarkdownCustomComponents = {
  a: ({ href }) => {
    const { colorScheme } = useAIMarkdownTheme();
    if (!href) return null;
    return <a href={href}>{colorScheme}</a>;
  },
};
```

<span id="dont-mutate-node-properties-from-a-custom-component"></span>

### 切勿在自定义组件中直接修改 `node.properties`

当块级缓存命中缓存时，`node` 对象会在多次渲染之间被复用。直接在组件中修改其属性（如 `node.properties.className = …`）会污染后续命中该缓存的后续渲染帧，引发偶发性的样式渲染异常。请将 `node` 视为严格只读对象。

<span id="heavy-work-in-render-measure-first"></span>

### 渲染过程中的高开销计算：务必先行度量并进行记忆化

当 React 需要更新视图时（包括块输入变更、状态变更或订阅的 Context 发生更新），自定义组件就会重新执行。如果组件中包含高 CPU 开销的操作（如语法高亮、代码格式化、运行大型正则表达式），请针对驱动这些计算的核心输入变量使用 `useMemo` 进行记忆化缓存：

```tsx
import { useMemo } from 'react';

const components: AIMarkdownCustomComponents = {
  code: ({ node, children, ...props }) => {
    const text = node?.children.every((child) => child.type === 'text')
      ? node.children.map((child) => (child.type === 'text' ? child.value : '')).join('')
      : null;
    const highlighted = useMemo(() => (text === null ? null : expensiveHighlight(text)), [text]);
    return highlighted === null ? (
      <code {...props}>{children}</code>
    ) : (
      <code {...props} dangerouslySetInnerHTML={{ __html: highlighted }} />
    );
  },
};
```

上述示例中的 `expensiveHighlight` 代表一个受信任的代码高亮器，其生成的 HTML 字符串已对源码文本完成了必要的转义。由自定义组件直接注入的 HTML 会脱离 Markdown 安全清洗器的管控；切勿将未经转义的原始代码直接传入 `dangerouslySetInnerHTML`。兜底分支保留了非纯文本的代码子元素，而不会粗暴将其抹平。

块级缓存缓存会在缓存命中时直接复用现有的 React 元素子树。但自定义组件依然可能因自身内部的 state 改变或订阅的 Context 变更而独立触发重渲染；对 React 元素的缓存并不会冻结其内部的 Hooks 或下层子孙节点。在组件内部使用 `useMemo` 的核心价值在于：当块内容确实发生了局部变动、但其中的某项昂贵子计算可以被复用时（例如内容微调但代码语言并未变更），能够有效节省计算资源。

<span id="heading-identity-and-component-verification"></span>

## 标题标识与组件行为验证

上述 slug 示例仅用于演示命名空间的拼接机制。具有相同文本内容的两个标题依然会生成重复的 ID；同时针对非拉丁文本（如中文），需要采用能够保留 Unicode 字符的 slug 生成算法，或由应用程序直接提供持久的稳定 ID。切勿在渲染阶段递增模块全局计数器：并发渲染或被放弃的中间渲染帧会在未提交真实标题 DOM 的情况下白白消耗计数器序号。对于长期可用的深度链接锚点，请直接从持久化文档数据中分配稳定 ID。

在对自定义替换组件进行测试验证时，务必覆盖它可能接收到的所有语法形态：普通链接、锚点跳转链接、多次引用的同一个脚注引用、围栏代码块、行内代码以及原始 `<pre>` HTML 标签。确保源码文本能够完整无损呈现，所有控件均能通过键盘无障碍操作，并且在更新 metadata 时能够平滑刷新回调逻辑，而无需重新实例化整个组件函数。

源码参考：[`markdown/Markdown.tsx`](../../../../packages/react/src/components/markdown/Markdown.tsx) 负责 JSX 树转换；[`crossChunkPlaceholders.tsx`](../../../../packages/react/src/components/crossChunkPlaceholders.tsx) 将跨片段协调引用适配到相同的组件映射表；[`MantineAIMarkdown.tsx`](../../../../packages/react-mantine/src/MantineAIMarkdown.tsx) 演示了对代码块的安全提取与防御性处理。

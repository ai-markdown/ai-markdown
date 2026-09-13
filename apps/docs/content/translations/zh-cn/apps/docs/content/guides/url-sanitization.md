# URL 过滤与自定义协议

这套两阶段安全校验策略由 React 和 Vue 两个适配器完全共享。下文示例代码采用了 React 导入语法；Vue 适配器同样从其根模块导出了 `extendSanitizeSchema`、`defaultUrlTransform` 以及 `UrlTransform` 类型，并通过组件属性接收 `:sanitize-schema` 与 `:url-transform`。参见 [Vue 指南](../reference/vue.md#component-props) 与 [安装配置](getting-started.md)。

URL 的安全处理分为两个阶段：首先由清洗规则 Schema 决定哪些 HTML 标签、属性以及协议类型能够合法留存；随后在渲染阶段由 `urlTransform` 针对留存下来的每个承载 URL 的属性进行逐一审查改写。若需要放行应用程序的私有自定义协议（例如 `myapp:`），必须针对需要该协议的具体 HTML 属性同时对这两个阶段进行协同配置。

这两个阶段的输出具有完全不同的表现：Schema 拦截会直接在你的改写回调执行之前彻底剔除该属性；而改写回调可以返回空字符串、`null` 或 `undefined`——在 HTML 语义中这些返回值不能混为一谈。一个合法的空链接与被安全拦截的恶意链接同样存在本质区别。本指南将厘清这些技术细节，提供强类型的扩展方案，并阐述该策略在跨片段协调引用中是如何保持一致生效的。

<span id="the-two-gate-model"></span>

## 两阶段 URL 过滤

```text
LLM-emitted URL string
        │
        ▼
┌────────────────────────────────────┐
│ Gate 1: rehype-sanitize schema      │  Per-protocol allowlist
│  • protocols.href / .src / .cite    │
│  • runs FIRST (in the rehype chain, │
│    during parseStage)               │
│  • drops the URL if its protocol    │
│    isn't on the allowlist           │
└────────────────────────────────────┘
        │
        ▼
┌────────────────────────────────────┐
│ Gate 2: urlTransform                │  Per-attribute rewriter
│  • receives (url, key, node)         │
│  • runs SECOND (at render time, in   │
│    renderHastSubtree)                │
│  • returns the rewritten URL, or     │
│    '' / null / undefined to drop     │
└────────────────────────────────────┘
        │
        ▼
  Rendered <a>/<img>/etc.
```

一个 URL 必须**同时通过这两个关卡**才能最终被渲染到 DOM 中。仅配置其中一个关卡是开发者最常踩的坑——详见 [常见问题](#footguns)。

> 上图所展示的执行顺序就是流水线内部的**真实物理执行顺序**：`rehype-sanitize` 作为 rehype 插件链的一部分优先运行（在 `parseStage` 解析阶段），而 `urlTransform` 则在后续的 `renderHastSubtree` 属性递归遍历渲染阶段执行。这里的编号代表了 URL 在运行时实际流经的先后次序，而不仅仅是概念上的抽象分层。

<span id="default-allowlist"></span>

### 默认允许的协议

`defaultUrlTransform` 默认仅放行以下显式声明的安全协议：

```text
http  https  irc  ircs  mailto  xmpp
```

其余所有显式协议（包括高危的 `javascript:`、`data:`、`vbscript:` 以及 `file:` 等）在默认转换器处理下均会返回空字符串。相对路径、协议相对 URL、哈希锚点（#）以及查询参数（?）同样被默认转换器合法接受。第一关的 Schema 针对不同的 HTML 属性维护了各自独立的协议白名单，因此上述协议列表并不保证对所有 HTML 属性均天然全量开放。

---

<span id="allowing-a-custom-scheme"></span>

## 放行自定义协议

若需要支持应用的深度链接（Deep Link），只需在 `href` 属性上放行该协议，同时保持图片的安全策略不变。为回调函数标注库导出的 `UrlTransform` 类型，确保其接收到的 `node` 参数具备准确的 hast 语法树类型：

```tsx
import AIMarkdown, { defaultUrlTransform, extendSanitizeSchema, type UrlTransform } from '@ai-markdown/react';

const SCHEMA = extendSanitizeSchema((draft) => {
  draft.protocols ??= {};
  draft.protocols.href = [...(draft.protocols.href ?? []), 'myapp'];
});

const URL_TRANSFORM: UrlTransform = (url, key, node) => {
  if (key === 'href' && /^myapp:/i.test(url)) return url;
  return defaultUrlTransform(url, key, node);
};

function App({ content }: { content: string }) {
  return <AIMarkdown content={content} sanitizeSchema={SCHEMA} urlTransform={URL_TRANSFORM} />;
}
```

此时 Markdown 中的 `[打开详情](myapp://items/42)` 就能顺利到达链接渲染器。如果希望图片的 `src` 属性同样支持该协议，只需将其追加至 `draft.protocols.src`，并在回调函数中显式放行 `src` 属性名。协议级的校验并不会自动校验应用的主机名、路由或业务 ID；当你的深度链接处理器有特定安全要求时，请在回调中补充相应的业务校验逻辑。

当安全策略固定时，请将这两个配置对象声明在模块顶层作用域。如果策略动态依赖于应用层配置，请使用 `useMemo` 进行缓存，并将这些配置项作为依赖项。当业务安全策略发生真实变动时，必须确保最新的配置能够传递给渲染器；为了盲目追求性能而过度缓存一个过期的函数引用，会导致安全策略同样处于过期陈旧状态。

---

<span id="urltransform-gate-2"></span>

## `urlTransform`（第二关）

该函数接收当前 URL 以及上下文元数据；返回改写后的新 URL（或返回空值将其剔除）。

```ts
import type { Element } from 'hast';

type UrlTransform = (url: string, key: string, node: Readonly<Element>) => string | null | undefined;
```

| 参数名称 | 核心含义与来源                                                                                                      |
| :------- | :------------------------------------------------------------------------------------------------------------------ |
| `url`    | 经历了语法解析、规范化、Schema 过滤以及哈希重定址（Hash rebasing）后的当前 URL 字符串                               |
| `key`    | 当前承载该 URL 的 HTML 属性名——例如 `'href'`、`'src'`、`'cite'` 等                                                  |
| `node`   | 携带该属性的 hast `Element` 语法树元素，标注为只读 `Readonly`——当策略需要根据标签名或兄弟属性进行综合判定时极为有用 |

其返回值可以是：

- 改写后的新 URL（非空字符串）——将原样作为属性值渲染。
- `null` 或 `undefined`——在渲染出的 HTML 元素上彻底不输出该属性。
- `''`（空字符串）——渲染出一个取值为空的属性。其最终的 HTML 序列化表现与浏览器行为取决于具体标签以及 React；当“属性缺失”与“属性为空”在业务中有严格区分时，切勿混淆使用。

`Readonly` 是 TypeScript 编译期的类型约束，并非运行时的对象深层冻结。切勿在回调函数中直接篡改 `node` 或其属性对象。回调函数应当是一个纯函数：仅根据传入的参数与安全策略计算返回值，而不应依赖于某棵被缓存的语法树究竟被遍历了多少次。

<span id="key-aware-policies"></span>

### 区分属性名的安全策略

一个典型的业务诉求是：允许在超链接 `<a href>` 中使用 `myapp:`，但严厉禁止在图片 `<img src>` 中使用（防止攻击者通过图片注入追踪像素探测用户本地应用）。`key` 参数正是为此而生：

```ts
const URL_TRANSFORM: UrlTransform = (url, key, node) => {
  if (key === 'href' && /^myapp:/i.test(url)) return url;
  // src/cite paths still go through the default allowlist
  return defaultUrlTransform(url, key, node);
};
```

<span id="composing-with-defaulturltransform"></span>

### 与 `defaultUrlTransform` 组合使用

`defaultUrlTransform` 是官方内置的安全转换器——完整实现了 GitHub 级别的安全白名单规范。建议在其基础上进行扩展组合，而不是全盘推倒重写：

```ts
// ✅ Whitelist your scheme; defer everything else to the default.
const URL_TRANSFORM: UrlTransform = (url, key, node) =>
  /^myapp:/i.test(url) ? url : defaultUrlTransform(url, key, node);

// ⚠️ Reimplementing the safe set yourself — easy to miss a scheme.
const URL_TRANSFORM = (url) => {
  if (/^(myapp|https?|mailto):/i.test(url)) return url; // forgot irc, ircs, xmpp
  return '';
};
```

<span id="setting-urltransform-null"></span>

### 将 `urlTransform` 设置为 `null`

传入 `null` 完全等价于不传该 prop——`<AIMarkdown>` 会自动优雅回退至内置的 `defaultUrlTransform`（React 适配器在透传前会自动对空值进行规范化）。系统不存在“彻底关闭逐属性审查”的开关；`urlTransform` 审查阶段必定会执行。如果需要放宽白名单，请如上文所示与 `defaultUrlTransform` 组合使用。

---

<span id="sanitizeschema-gate-1-via-extendsanitizeschema"></span>

## `sanitizeSchema`（第一关：借助 `extendSanitizeSchema`）

`extendSanitizeSchema` 会为你提供一份官方默认 Schema 的深拷贝副本。你可以自由就地修改它，或者返回一个全新的替换对象——该副本不会与底层的单例对象产生引用混淆。

```ts
import { extendSanitizeSchema } from '@ai-markdown/react';

// Mutate-style (recommended for additive changes).
const SCHEMA = extendSanitizeSchema((s) => {
  s.protocols!.href!.push('myapp');
  s.protocols!.src!.push('myapp');
  s.tagNames!.push('my-widget');
  s.attributes!['my-widget'] = ['dataId', 'dataMode'];
});

// Return-style alternative (when you need a wider replacement).
const RETURNED_SCHEMA = extendSanitizeSchema((s) => ({
  ...s,
  tagNames: [...(s.tagNames ?? []), 'my-widget'],
}));
```

> ⚠️ **返回对象模式不会执行任何字段自动合并。** 你返回的任何对象都会被不加修改地原样采纳。如果你自作聪明地写下 `({ ...s, protocols: { href: ['myapp'] } })` 并以为“我只是追加了一个协议”，实际上你**彻底覆盖了整个 `protocols` 对象**——这不仅抹杀了继承而来的原有 `href` 白名单，更将 `src` 等其余所有属性的协议限制全部清空。对于增量修改，就地修改模式更加安全（直接对现有数组执行 push）；返回对象模式仅在极少数你确实希望全盘重写 Schema 且愿意为补充所有字段承担全部责任的场景下使用。

<span id="why-use-the-helper-instead-of-building-a-schema-from-scratch"></span>

### 为什么要使用辅助函数而不是从零手写 Schema？

官方默认配置在 `rehype-sanitize` 的原生 `defaultSchema` 之上补充了渲染器专属的放行规则以及源码纯文本过滤策略：

| 官方预置规则                                                                      | 为什么不可或缺                                                                                                                                                                                                                                         |
| :-------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 放行 `<mark>` 标签                                                                | 确保 `==高亮语法==` 能够正常渲染为高亮元素                                                                                                                                                                                                             |
| 放行 `<code>` 上的数学公式类名（`math-inline`, `math-display`）                   | 确保 `remark-math` 能够安全地为代码片段打上数学标记，供后续的 `rehype-katex` 处理。KaTeX 自身生成的类名（`katex`, `katex-html`, …）不在该白名单中——它们之所以能留存，是因为 `rehype-katex` 在 `rehype-sanitize` **之后**才执行，清洗时这些类名尚未生成 |
| 放行跨片段协调专用标签（`cross-chunk-link`, `cross-chunk-image`, `footnote-sup`） | 确保 [跨片段协调引用](cross-chunk-coordination.md) 能够被正确解析与挂载                                                                                                                                                                                |

如果手动硬编码 Schema（例如 `{ ...defaultSchema, … }`），**上述规则会被全部静默丢弃**——导致 `==高亮语法==` 退化为纯文本，数学公式无法转换而停留在原始代码状态，跨片段占位符标签被直接从语法树中剔除。`extendSanitizeSchema` 始终基于**本库专属的**默认配置克隆（而非第三方库的原始默认配置），因此上述重要规则能够保留。

<span id="inspecting-the-default-schema"></span>

### 检查官方默认 Schema 的内部结构

辅助函数本身就是最便捷的自省调试途径：

```ts
extendSanitizeSchema((s) => {
  console.log('library default sanitize schema:', s);
});
```

参数 `s` 是一个独立的深拷贝对象——在模块初始化时打印一次即可全面掌握当前允许放行的全部规则，进而精准编写覆盖逻辑。

<span id="why-isnt-the-default-schema-exported-as-a-value"></span>

### 为什么不直接导出一个 Schema 静态常量？

因为最容易被开发者写出的扩展写法——`{ ...sanitizeSchema, protocols: { ...sanitizeSchema.protocols, href: [...] } }`——本质上只是浅拷贝（Shallow spread）。浅拷贝依然会共享内层嵌套的对象和数组引用。底层引擎的单例配置现在已被全局深层冻结（deep-frozen），直接修改这些共享的内层数组会触发运行时报错，而无法生成独立的规则配置。只有深拷贝才能提供完全无共享状态的可变对象图。`extendSanitizeSchema` 始终在深拷贝副本上操作，从架构设计上彻底杜绝了这类隐患。

---

<span id="reference-stability-asymmetric-handling"></span>

## 引用稳定性——非对称处理机制

这两个 props 均参与了块级缓存缓存的校验，但其稳定化策略是**非对称的**：

| 配置属性         | 追踪判断依据                                   | 库内部的安全兜底防护                                     |
| :--------------- | :--------------------------------------------- | :------------------------------------------------------- |
| `urlTransform`   | 仅比对引用身份（Identity only）                | 无——全新的函数引用会导致整个 Markdown 渲染缓存被彻底清空 |
| `sanitizeSchema` | 结合引用比对与深度内容比对（`useStableValue`） | 引用改变但内容深层相等的 Schema 会自动收敛复用先前的引用 |

为什么是非对称的？因为函数的内部实现无法进行深层内容比对（函数体完全一致的两个闭包永远是不相等的），因此 `urlTransform` **无法**提供自动兜底。而 Schema 属于纯数据对象，深度递归比对是完全可行且有明确语义的。

**核心工程启示**：在 JSX 中直接编写行内函数 `urlTransform={(url) => …}` 会导致每一帧渲染都彻底丢弃块级缓存缓存。在行内编写 `sanitizeSchema` 虽然不会清空缓存，但会带来额外的每帧计算开销：每次调用 `extendSanitizeSchema((s) => …)` 都会对整个默认规则执行一次 `cloneDeep`，随后 `useStableValue` 还要对前后两套完整规则执行全量深度递归比对（包含 protocols、attributes、ancestors、tagNames 等海量属性）。将它们提取至**模块顶层作用域**能够一举消除这两项不必要的开销。

```tsx
// ⚠️ Anti-pattern — discards the entire markdown cache every render.
<AIMarkdown
  urlTransform={(url, k, n) => /* … */}
  sanitizeSchema={extendSanitizeSchema((s) => /* … */)}
/>

// ✅ Module-scope, no per-render overhead.
const URL_TRANSFORM = (url, k, n) => /* … */;
const SCHEMA = extendSanitizeSchema((s) => /* … */);

<AIMarkdown urlTransform={URL_TRANSFORM} sanitizeSchema={SCHEMA} />
```

在开发环境下（development build），当检测到任一属性发生 3 次以上的引用频繁切换时，控制台会输出 `console.warn` 性能告警。在生产构建中，该告警代码会被作为无用代码彻底摇树优化（Tree-shaking）剔除。

---

<span id="cross-chunk-symmetry"></span>

## 跨片段引用的过滤规则

当多个内容片段被包裹在 `<AIMarkdownDocuments>` 中协同渲染时，**跨片段解析的引用**（例如片段 A 定义了 `[evil]: javascript:…`，片段 B 写入了 `[点击此处][evil]`）会在最终使用该引用的片段的**渲染阶段**，严格走一遍完整的双重门禁校验。传递给 `<AIMarkdown>` 的 `urlTransform` 与 `sanitizeSchema` 会无差别地应用于跨片段引用。对 `key` 属性名的区分判定同样得到完整尊重：针对 `<a>` 放行但针对 `<img>` 拦截的策略，无论引用是在当前片段内闭环还是跨片段引用，均能表现出完全一致的安全行为。

每个引用的使用片段都会执行自己的 URL 策略。一个片段采用较宽松的 `urlTransform`，不会替其他片段放行 URL。

---

<span id="regex-escaping-for-scheme-names"></span>

## 协议名称中的正则表达式字符转义

在编写正则表达式时，字面量 `+` 或 `.` 必须进行反斜杠转义。在 `/^web+app:/i` 中，未转义的 `+` 会被解析为将前面的字母 `b` 重复一次或多次；它匹配的是 `webapp:` 或 `webbapp:`，而根本无法匹配本意的 `web+app:`。

```ts
const WRONG = /^web+app:/i;
const CORRECT = /^web\+app:/i;
```

连字符（`-`）在字符集方括号外部代表普通字面量字符；而在字符集方括号内部则代表区间范围，因此其书写位置或转义非常关键。切勿将这三类字符的正则处理机制混为一谈。

针对动态配置的协议白名单，切勿从未转义的用户输入中临时拼接正则表达式。建议将协议提取出来作为普通字符串数据进行集合比对：

```ts
const EXTRA_SCHEMES = new Set(['myapp', 'web+share']);
const URL_TRANSFORM: UrlTransform = (url, key, node) => {
  const colon = url.indexOf(':');
  const scheme = colon < 0 ? '' : url.slice(0, colon).toLowerCase();
  if (key === 'href' && EXTRA_SCHEMES.has(scheme)) return url;
  return defaultUrlTransform(url, key, node);
};
```

第一关的 Gate 1 Schema 同样需要同步登记这些协议名称。这是一套专用于已知合法应用协议的放行策略，而非全功能的通用 URL 解析引擎。

---

<span id="footguns"></span>

## 常见问题

<span id="allowing-only-one-gate"></span>

### 仅配置了一个过滤阶段

```ts
// ⚠️ Gate 2 (urlTransform) permits 'myapp:', but Gate 1 (sanitize schema) still drops it.
const URL_TRANSFORM = (url) => (/^myapp:/.test(url) ? url : defaultUrlTransform(url, ...));
// No matching extendSanitizeSchema → URL silently disappears in the rendered output.
```

故障表象：Markdown 源码中确实书写了链接/图片，调用方自定义的 `urlTransform` 逻辑中也明确放行了该协议，但最终渲染出的 HTML 中 `href` 或 `src` 属性却不翼而飞。

```ts
// ⚠️ Gate 1 (sanitize schema) permits 'myapp', but Gate 2 (urlTransform) still rewrites to ''.
const SCHEMA = extendSanitizeSchema((s) => {
  s.protocols!.href!.push('myapp');
});
// No urlTransform override → defaultUrlTransform rewrites 'myapp:…' to ''.
```

故障表象完全相同。请保持两道关卡步调一致地协同扩展。

<span id="reassigning-the-local-schema-parameter-inside-extendsanitizeschema"></span>

### 在 `extendSanitizeSchema` 内部重新赋值局部形参

```ts
// ⚠️ Does nothing — JS only rebinds the local variable.
const SCHEMA = extendSanitizeSchema((s) => {
  s = { ...completelyNewSchema }; // ← local rebind, not a mutation
});
// SCHEMA === the unmodified clone.

// ✅ Either mutate the original draft …
const SCHEMA = extendSanitizeSchema((s) => {
  s.tagNames!.push('my-tag');
});

// ✅ … or return the new object explicitly.
const SCHEMA = extendSanitizeSchema((s) => ({ ...s, ...overrides }));
```

<span id="trusting-defurl-from-usedocumentregistry-without-sanitizing"></span>

### 盲目信任并直接使用来自 `useDocumentRegistry` 的 `def.url`

`Registry.resolveLinkDef(label).url` 返回的是来自贡献片段的**未经任何清洗的原始目标地址**——注册表内部存储的是原始定义（自 2.4.3 起；早期版本曾在入库前使用 `'href'` 属性键进行预过滤，导致被拦截链接与合法空链接被错误归一化，且造成后续改写规则被重复二次执行）。库内置的占位符组件在渲染期会使用正确的属性键执行全量双重门禁校验。任何直接读取 `def.url` 的外部模块（例如反向链接面板、数据埋点上报、开发者工具等）在将其渲染为真实的 `href`/`src` 之前，必须自行执行相同的安全校验；因为恶意片段完全可能提交 `[evil]: javascript:alert(1)`。

防御性编程范式：

```ts
// Synthesize a minimal hast Element for the call — urlTransform's signature
// requires a node, and most policies only read `node.tagName` / `node.properties`.
const syntheticNode = { type: 'element', tagName: 'img', properties: {}, children: [] } as const;

const def = registry?.resolveLinkDef(label);
if (def) {
  const safeUrl = myUrlTransform(def.url, 'src', syntheticNode); // your policy, correct key
  // …use safeUrl (an empty result means "blocked": omit the attribute)
}
```

<span id="throwing-inside-the-extendsanitizeschema-modifier"></span>

### 在 `extendSanitizeSchema` 回调函数中抛出未捕获异常

该辅助函数内部并未包裹 try/catch。回调内抛出的任何异常都会直接向外抛出至调用栈顶层。这一设计是有意为之的——在模块顶层调用时，抛错能够在应用启动期立刻暴露，这属于最稳妥的快速失败（fail-fast）机制。但如果在组件渲染执行路径中错误地调用了 `extendSanitizeSchema`（强烈不建议这么做），抛出的异常将直接导致整个组件渲染崩溃。

<span id="forgetting-that-arrays-in-the-schema-are-readonly-typed-but-mutable-at-runtime"></span>

### 误将 Schema 字段的可选类型与只读类型混为一谈

该辅助函数返回的是上游 `Schema` 的类型结构，其内部字段均标记为可选属性。当 TypeScript 报出 `protocols` 或 `href` 可能为 undefined 时，需要进行初始化防护或提供经过严密推断的非空断言。这与是否声明为只读类型毫无关系：非空断言操作符 `!` 仅用于从表达式类型中剔除 `null`/`undefined`，无法将原本标记为只读的数组变为可变类型。

```ts
const SCHEMA = extendSanitizeSchema((draft) => {
  draft.protocols ??= {};
  draft.protocols.href = [...(draft.protocols.href ?? []), 'myapp'];
});
```

官方默认的草稿对象中已经初始化了常见的协议数组，因此使用精简的 `draft.protocols!.href!.push('myapp')` 在当前类型和默认 Schema 下能够正常编译。若编写需要复用于外部未知 Schema 的可复用通用工具函数，建议采用更为严密的展开赋值写法。

<span id="final-element-policy-for-cross-chunk-references"></span>

## 跨片段引用的最终元素安全策略

注册表之所以保留原始目标地址，是为了让最终使用该引用的片段能够严格执行且仅执行一次属于该片段的安全策略。在解析引用时，底层引擎会构建最终的 `a` 或 `img` 语法树节点、对其 URL 进行标准化规范、应用 Schema 过滤、重新计算哈希跳转锚点，最终调用 URL 转换改写器。自 2.12 版本起，该解析逻辑还会严格校验目标标签的合法性、允许的属性白名单以及父级祖先节点的嵌套约束。仅靠校验 `protocols.href` 无法覆盖独立渲染策略中的全部安全维度。

因此，被第一关 Gate 1 剔除的 URL 可能根本没有机会流经 `urlTransform`。仅仅在第二关中放行某协议，不可能凭空复活已被前置规则剥离的属性。如果整个链接标签在 Schema 中均属于非法标签，根据规则其内部文本可能会被保留，也可能连带子节点全量剔除；而图片标签则完全不具备文本子节点回退能力。测试时请断言最终生成的真实 DOM 结构，而不能仅仅依赖于断言自己的改写回调是否曾被触发。

在原始 HTML 展开与安全清洗之间，引擎还会严格校验私有占位符标签的合法来源凭据（Provenance credential）。直接手写 `<cross-chunk-link>` 或 `<footnote-sup>` HTML 标签并非合法的跨片段引用创建方式。官方渲染器内部会自动创建并校验专属凭据；常规的 React 集成代码无需也无法对其进行手动配置。

<span id="keep-the-policy-boundary-explicit"></span>

## 安全策略的边界

自定义 Schema 会整体替换调用方传入的配置；React 适配器在后续处理中不会再将其与默认配置进行隐式合并。虽然 `extendSanitizeSchema` 为你提供了官方完整配置的副本作为基准，但若在回调中返回了不同的对象或删除了关键字段，依然可能会破坏库内置的不变性保障。尤其是：删除 `protocols` 限制与在该属性上禁止所有协议在语义上存在本质差异。

官方默认 Schema 会连同内容彻底剔除包括 `script`、`style`、`title` 以及 `iframe` 在内的若干原始纯文本标签。KaTeX 数学公式渲染发生在安全清洗之后，使用的是被放行的合法数学标记。由自定义组件或下游流程手动注入的 HTML 节点完全脱离了前置清洗器的管辖。对于这类主动引入的输出内容，请在其产生的源头建立相应的安全审查防线。

在编写安全策略的回归测试用例时，建议同时覆盖以下典型场景：HTTP 链接、相对路径、包含冒号的 URL 查询参数、带有命名空间前缀的哈希锚点、业务私有协议、受禁高危协议以及合法的空链接。针对链接和图片标签，分别在单片段独立模式与跨片段协调模式下重复执行上述校验，并在源 Markdown 文本不变的前提下动态切换安全策略进行断言。这能独立且精准地排查出回调组合错误、属性名判定失误以及因缓存失效机制异常导致的陈旧策略残留。

核心实现源码参考：[`pluginChain.ts`](../../../../packages/engine/src/components/pluginChain.ts)、[`extendSanitizeSchema.ts`](../../../../packages/engine/src/components/extendSanitizeSchema.ts)、[`resolveCrossChunkReference.ts`](../../../../packages/engine/src/components/resolveCrossChunkReference.ts) 与 [`markdown/transform.ts`](../../../../packages/engine/src/components/markdown/transform.ts)。

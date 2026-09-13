# React 属性参考

在 `<AIMarkdown>` 组件中使用以下属性配置。安装与基础用法见 [React 快速开始](../react-quick-start.md)；平滑流式输出、文档上下文提供者及导出类型见 [React 组件参考](../../reference/react.md)。

## 属性与默认值

组件接受泛型属性对象 `AIMarkdownProps<TMetadata>`。

组件配置采用**平铺属性（flat props）**。传入非 null 的有效值将覆盖默认值；传入 `undefined` 或 `null` 则使用默认值。序列化时若将省略项转为 `null`，仍能正常使用内置默认值。

包装组件的开发者在新增属性前，应检查此**属性名称注册表**及所继承扩展的包装层。所有包装层共享同一个扁平命名空间；例如 Mantine 增加了 `codeBlock` 属性。存在命名冲突的类型在 TypeScript 接口扩展时会直接报错，而在纯 JavaScript 环境下可能会静默覆盖现有值。

### `content`

类型：`string`。默认值：**（必填）**。

需要渲染的原始 Markdown 字符串内容。

### `streaming`

类型：`boolean`。默认值：`false`。

内容当前是否处于流式生成中（例如来自大语言模型的实时流式输出）。

### `streamingCursor`

类型：`ComponentType`。默认值：`undefined`。

流式光标插槽组件。当 `streaming` 为 `true` 时，该组件会渲染在 Markdown 内容末尾；当流式结束时自动卸载。

传入导出的 `AIMarkdownStreamingCursor` 可使用内置的行内光标。组件内部使用引用身份比对，建议在模块作用域定义。

该插槽具备定义感知能力。当脚注定义正在流式生成时，光标会跟随文本进入页面底部的脚注项；对于无法真实指向可见文本的尾部（例如仅在后台声明的链接引用定义，或在跨片段协调下位于其他片段中的脚注），光标会自动隐藏。

### `fontSize`

类型：`number | string`。默认值：`'0.9375rem'`。

基础排版字号。传入数值时按像素（px）处理。

### `variant`

类型：`AIMarkdownVariant`。默认值：`'default'`。

排版样式变体名称。

### `colorScheme`

类型：`AIMarkdownColorScheme`。默认值：`'light'`。

配色方案名称（`'light'`、`'dark'` 或自定义名称）。

### `metadata`

类型：`TMetadata`。默认值：`undefined`。

通过专用 Context 传递给自定义组件的任意应用数据。本库不对其进行引用稳定化处理，稳定该引用的职责属于应用代码。

### `contentPreprocessors`

类型：`AIMDContentPreprocessor[]`。默认值：`undefined`。

在内置 LaTeX 预处理器之后运行的附加预处理器数组。软件包附带了可选的 `createRemendPreprocessor()` 工厂函数（用于流式末尾语法修复——使流式生成中未闭合的 `**bold` 或 `` `code `` 行内代码提前渲染出对应样式）；该功能为显式按需引入；能否减小打包体积取决于具体打包工具。

### `customComponents`

类型：`AIMarkdownCustomComponents`。默认值：`undefined`。

用于替换特定 HTML 元素渲染实现的 `react-markdown` 自定义组件映射表。

### `Typography`

类型：`AIMarkdownTypographyComponent`。默认值：`DefaultTypography`。

最外层的排版包装器组件。

### `ExtraStyles`

类型：`AIMarkdownExtraStylesComponent`。默认值：`undefined`。

渲染在排版包装器与 Markdown 内容之间的可选额外样式包装组件。

### `documentId`

类型：`string`。默认值：通过 `useId()` 自动生成。

当前 `<AIMarkdown>` 渲染的逻辑文档标识符。用于给元素 `id` 和锚点 `href` 划分命名空间，避免同一页面内的不同文档发生锚点串扰（例如消息 A 中的脚注 `[^1]` 不会跳转到消息 B 中的 `[^1]`）。

当单个逻辑文档拆分为多个片段并由多个 `<AIMarkdown>` 实例渲染时，必须为所有片段传入完全相同的 `documentId`，以保证生成的属性前缀对齐。该值在注入 HTML 属性前会经过 `encodeURIComponent` 处理，支持传入任意字符串（包括 React `useId()` 的输出、自定义 ID 或 UUID；若传入在 Emoji 中间截断的畸形 UTF-16 字符串，开发构建会给出警告并在前缀中进行散列）。

对于超过 16 个字符的长 ID（如 UUID），仅在渲染生成的 `id="…"` 与 `href="#…"` 前缀内部会通过 MurmurHash3 散列为紧凑的 Base62 形式；通过 `useAIMarkdownDocument()` 获取的 `documentId` 以及 `useDocumentRegistry` 的注册表键名仍保留原始字符串，不影响应用层读取。

### `documentIndex`

类型：`number`。默认值：组件挂载顺序。

在 `<AIMarkdownDocuments>` 容器中，表示当前片段在整个文档中的位置序号。

跨片段状态（如脚注重新编号、由哪个片段渲染底部脚注区）以注册顺序为准，默认等同于挂载顺序。当片段按文档顺序只挂载一次时，使用默认行为即可；当片段可能乱序挂载或重新挂载时（例如虚拟滚动列表中，移出视口被卸载的消息在重新进入视口时会注册到末尾），请传入稳定的数字序号。

在 `<AIMarkdownDocuments>` 容器之外，该属性会被自动忽略。详见[跨片段协调](../../reference/react.md)。

### `urlTransform`

类型：`UrlTransform | null`。默认值：`defaultUrlTransform`。

覆盖应用于 `href`、`src` 及类似属性的 URL 协议安全白名单。默认白名单与 GitHub 对齐：`http`、`https`、`irc`、`ircs`、`mailto`、`xmpp`。如需放行额外的自定义协议，请传入在模块作用域定义（或经过缓存 memoize）的转换函数——详见[自定义 URL 协议与清洗](../../reference/react.md)。

### `sanitizeSchema`

类型：`SanitizeSchema`。默认值：库内置默认 schema。

覆盖底层 `rehype-sanitize` 使用的 HTML 清洗模式。构建新规则时请使用 [`extendSanitizeSchema`](../../reference/react.md)，以确保库内置的跨片段协调标签和 KaTeX className 白名单规则得到完整保留——自行完全从头构建或简单覆盖会静默丢失这些关键规则。

### `enginePlugins`

类型：`readonly AIMarkdownEnginePlugin[]`。默认值：`defaultEnginePlugins`。

封闭的引擎功能插件选择项——仅接受从 `@ai-markdown/react/plugins` 导出的 React 插件对象。省略该属性将默认启用内置的全部 5 个插件；传入自定义插件数组将整体替换该集合。详见[引擎插件](../../reference/react.md)。

### `blockMemo`

类型：`boolean`。默认值：`true`。

块级缓存渲染缓存。在单组件独立渲染时，该属性具有输出不变性——开启或关闭不影响最终渲染结果；而在 `<AIMarkdownDocuments>` 容器下，它是跨片段协调赖以运行的核心路径（若设为 `false`，跨片段引用将保留为字面原始状态而无法协调）。详见[行为控制属性](../../reference/react.md)。

### `incrementalParse`

类型：`boolean`。默认值：`true`。

面向流式生成的前缀冻结增量解析。该属性同样具有输出不变性；仅在 `blockMemo` 为 `true` 时生效。详见[行为控制属性](../../reference/react.md)。

### `preserveOrphanReferences`

类型：`boolean`。默认值：`true`。

在尚未生成完毕的流式文档中保护孤立的脚注与链接定义。该属性会影响最终渲染结果。详见[行为控制属性](../../reference/react.md)。

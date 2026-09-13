# Markdown 语法支持

React 和 Vue 共享解析引擎。组件、排版与图表集成属于各自框架层。

## 内置能力

支持标题、段落、列表、引用、链接、图片、强调与代码，以及 GFM 表格、任务列表、删除线、自动链接和脚注。数学经过 LaTeX 预处理后由 KaTeX 渲染；应用需要导入 KaTeX CSS。Emoji 短代码会转换为表情。

源文本的段内换行变成硬换行。CJK 解析处理中文等文字附近的强调和删除线分隔符。原始 HTML 经过有深度保护的解析与清洗，然后才交给框架渲染。

## 可选插件目录

五个插件默认全部开启。传入 `enginePlugins` 数组会替换整个集合；执行顺序仍由引擎固定，不由数组顺序决定。

| 插件             | 用途                          |
| ---------------- | ----------------------------- |
| `highlight`      | `==标记==`，不是代码语法高亮  |
| `definitionList` | 定义列表                      |
| `removeComments` | 去除 HTML 注释                |
| `smartypants`    | 排版引号、标点及 CJK 引号处理 |
| `pangu`          | CJK 与半角字符之间的间距      |

React 从 `@ai-markdown/react/plugins` 导入，Vue 从 `@ai-markdown/vue` 导入。这里只接受随包提供的插件对象，不是任意 remark/rehype 插件入口。空数组不会关闭基础语法、数学处理或清洗。

## 代码、公式与安全边界

基础适配器呈现代码文本，不执行 JavaScript、Vue 模板或 MDX。Mantine 为 React 添加高亮和 Mermaid；自定义渲染器由应用负责。

解析器可以区分常见的美元金额与公式写法；存在歧义的输入仍需结合具体内容测试。流式文本应持续累积并传给同一个渲染器。HTML 清洗与最终 URL 转换分别执行，见 [URL 过滤](url-sanitization.md)。

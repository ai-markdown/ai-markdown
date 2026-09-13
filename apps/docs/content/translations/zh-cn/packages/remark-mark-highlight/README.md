# @ai-markdown/remark-mark-highlight

[文档](https://ai-markdown.github.io/docs/plugins/highlight/) · [示例](https://ai-markdown.github.io/examples/) · [官网](https://ai-markdown.github.io/)

[![@ai-markdown/remark-mark-highlight latest](https://img.shields.io/npm/v/@ai-markdown/remark-mark-highlight/latest?label=npm%20latest&color=blue)](https://www.npmjs.com/package/@ai-markdown/remark-mark-highlight?activeTab=versions)
[![@ai-markdown/remark-mark-highlight monthly downloads](https://img.shields.io/npm/dm/@ai-markdown/remark-mark-highlight?label=downloads%2Fmonth&color=blue)](https://www.npmjs.com/package/@ai-markdown/remark-mark-highlight)
[![TypeScript declarations included](https://img.shields.io/badge/TypeScript-included-3178c6?logo=typescript&logoColor=white)](https://github.com/ai-markdown/ai-markdown/tree/main/packages/remark-mark-highlight)
[![MIT license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/ai-markdown/ai-markdown/blob/main/packages/remark-mark-highlight/LICENSE)

用于文本高亮语法的 [remark](https://github.com/remarkjs/remark) 插件。`==text==` 会转换为 MDAST 的 `mark` 节点，其 `data.hName` 告知 remark-rehype 生成 `<mark>text</mark>`。该相关包同时注册了解析扩展与 Markdown 序列化扩展；它不提供 CSS 样式或 HTML 安全清洗器。

在 unified 中使用命名的 `remarkMarkHighlight` 导出。别名 `remarkMark` 保留了上游导出名称，更底层的 micromark/mdast 扩展可用于自定义流水线。两个框架适配器默认通过 engine 的密封 `highlight` 插件启用此功能，因此 React 和 Vue 应用程序无需单独安装或注册本包。

该包是无人维护的 [`remark-mark-highlight`](https://www.npmjs.com/package/remark-mark-highlight) 的官方维护延续版本，在内部被 [`@ai-markdown/react`](https://github.com/ai-markdown/ai-markdown/blob/main/packages/react) 的密封 `highlight` 引擎插件使用 —— 独立发布是因为它在本仓库之外同样有用，且上游仅提供 ESM 的 exports 映射导致纯 Node CJS 环境下的 `require()` 使用者报错中断。

<span id="install"></span>

## 安装

```bash
npm install @ai-markdown/remark-mark-highlight
```

双格式 ESM/CJS 构建：`import` 与 `require` 均可正常工作，两者均附带类型声明。

<span id="use"></span>

## 使用

仅解析的处理器会生成 MDAST 语法树。请调用 `parse` 与 `run` 而不是 `process`，因为第一段流水线中没有包含编译器：

```ts
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { remarkMarkHighlight } from '@ai-markdown/remark-mark-highlight';

const processor = unified().use(remarkParse).use(remarkMarkHighlight);
const tree = processor.runSync(processor.parse('==hi=='));
// tree contains: { type: 'mark', data: { hName: 'mark' }, children: [...] }
```

若要渲染 HTML，请添加转换与序列化阶段（将对应包与 unified 及 remark-parse 一同安装）：

```ts
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { remarkMarkHighlight } from '@ai-markdown/remark-mark-highlight';

const html = unified()
  .use(remarkParse)
  .use(remarkMarkHighlight)
  .use(remarkRehype)
  .use(rehypeStringify)
  .processSync('==**bold** inside==');

console.log(String(html));
// <p><mark><strong>bold</strong> inside</mark></p>
```

不需要自定义的 mdast-to-hast 处理器。如果你的完整应用流水线使用了 rehype-sanitize，请在允许的标签列表中包含 `mark`；React 适配器的默认 Schema 已包含该标签。对于 Markdown 格式输出，将 HTML 阶段替换为 remark-stringify。该插件提供了对应的 `==` 序列化规则，包括下文所述的转义行为。

<span id="syntax-at-a-glance"></span>

## 语法速览

| Markdown                    | MDAST                                          | HTML                                        |
| --------------------------- | ---------------------------------------------- | ------------------------------------------- |
| `==text==`                  | `{ type: 'mark', children: [text] }`           | `<mark>text</mark>`                         |
| `==**bold** inside==`       | `mark` → `strong` → `text`（嵌套遵循强调规则） | `<mark><strong>bold</strong> inside</mark>` |
| `\==not a mark==`           | 纯文本                                         | `==not a mark==`                            |
| `` `==code==` ``            | `inlineCode`（行内代码跨度优先）               | `<code>==code==</code>`                     |
| `=single=` / `===triple===` | 纯文本（必须严格为两个 `=` 开闭）              | 保持原样                                    |

开箱即可与 `remark-rehype` 良好配合工作（`data.hName = 'mark'`）；无需自定义处理器。若使用 `rehype-sanitize` 进行安全清洗，请允许 `mark` 标签（`@ai-markdown/react` 的默认 Schema 已包含该标签）。

<span id="compatibility"></span>

## 兼容性

| 维度             | 支持范围                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| unified / remark | remark 15+（micromark 4、mdast-util-from-markdown 2、mdast-util-to-markdown 2）                                                       |
| Node             | `^20.19.0 \|\| >=22.12.0`                                                                                                             |
| 模块格式         | 同时支持 ESM 与 CJS 并均附带类型 —— 上游仅支持 ESM 的 exports 映射导致纯 Node 环境下的 `require()` 报错，这也是本 fork 存在的原因之一 |
| 类型支持         | `Mark` 注册在 mdast 的 `PhrasingContentMap` 与 `RootContentMap` 中，使 `mark` 节点在段落内部能够通过类型检查                          |

<span id="behavior-contract"></span>

## 行为契约

- 遵循强调风格的分词器（与 GFM 删除线属于同一家族）：必须严格为两个 `=`，标准侧翼规则，可与粗体/斜体嵌套，遵循转义符与行内代码跨度，标记跨度可包含换行。与其他强调扩展（如 GFM 删除线）的交互遵循 micromark 的共享强调机制，但未纳入固定语料库中（固定语料库在未启用 GFM 的情况下运行该插件）。
- **与 `remark-mark-highlight@0.1.1` 保持逐字节兼容**：在用本包替换上游之前，对照上游生成了一个包含 50 个用例的等价性语料库（带位置信息的 mdast + hast），并在 CI 中持续运行。行为变更需要升级本包的主版本。

<span id="footguns"></span>

## 避坑指南

- **加载本插件会改变 `remark-stringify` 对 `=` 的转义行为。** 序列化器将 `=` 注册为短语内容中的不安全字符（以便 `==` 跨度在往返转换中得以保留），这会导致对短语内容中的**每一个** `=` 执行转义 —— `let a = b` 会序列化为 `let a \= b`。这符合上游的行为，且仅影响 stringify 输出，不会影响解析或渲染。

<span id="api"></span>

## API 列表

| 导出符号                                                | 说明                                                            |
| ------------------------------------------------------- | --------------------------------------------------------------- |
| `remarkMarkHighlight`                                   | remark 插件（同时提供别名 `remarkMark`，即上游导出名称）        |
| `markHighlight()`                                       | 底层 micromark 扩展                                             |
| `markHighlightFromMarkdown` / `markHighlightToMarkdown` | mdast 的 from/to-markdown 扩展                                  |
| `Mark`（类型）                                          | mdast 节点接口（`type: 'mark'`），注册在 mdast 的短语内容映射中 |

<span id="versioning"></span>

## 版本策略

本包独立于 `@ai-markdown/react` 发布版本进行版本管理 —— `@ai-markdown/engine` 通过常规的语义化版本范围依赖它。共享 core 以及 React/Vue 适配器通过传递依赖引入它。

<span id="integration-boundaries-and-verification"></span>

## 集成边界与验证

分隔符必须严格为两个等号，且具备有效的强调风格侧翼。单个或三个等号保持为文本；行内代码跨度与转义符具有更高优先级，且标记内部可出现嵌套的粗体/斜体。本包本身不会为 CJK 文本放宽分隔符侧翼规则，也不会替代 engine 使用的独立 CJK 插件。

引入插件的类型会在 mdast 的内容映射中注册 `Mark`。生成的节点是包含子节点的短语内容，因此语法树访问器应递归遍历，而不应假定只有单一文本子节点。`data.hName` 携带 HTML 元素映射；在后续转换中移除该数据会改变下一阶段对该节点的渲染结果。

固定的 50 用例等价性语料库将带位置信息的 mdast 和 hast 与 `remark-mark-highlight@0.1.1` 进行对比。它覆盖了本插件的独立行为；与其他强调扩展（如 GFM）的交互不包含在该等价性声明中。若依赖特定嵌套规则，请对完整的插件组合进行测试。

参与代码仓库开发时，运行 `pnpm --filter @ai-markdown/remark-mark-highlight test` 与相关包构建。在修改语法或序列化逻辑时，请同时包含解析树示例与往返测试示例：转义每个短语等号是既有的序列化器契约，即便源文本不是高亮跨度也是如此。本包采用独立的语义化版本，因此其行为变更不受 React 适配器版本号的约束。

<span id="license"></span>

## 开源协议

MIT。基于 MIT 协议的 `remark-mark-highlight` 与 `micromark-extension-highlight-mark` / `mdast-util-highlight-mark` 衍生；相关归属详见 [LICENSE](https://github.com/ai-markdown/ai-markdown/blob/main/packages/remark-mark-highlight/LICENSE)。

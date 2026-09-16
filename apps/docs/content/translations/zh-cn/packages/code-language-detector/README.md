# @ai-markdown/code-language-detector

[文档](https://ai-markdown.github.io/docs/plugins/code-language-detector/) · [示例](https://ai-markdown.github.io/examples/) · [官网](https://ai-markdown.github.io/)

[![@ai-markdown/code-language-detector latest](https://img.shields.io/npm/v/@ai-markdown/code-language-detector/latest?label=npm%20latest&color=blue)](https://www.npmjs.com/package/@ai-markdown/code-language-detector?activeTab=versions)
[![@ai-markdown/code-language-detector monthly downloads](https://img.shields.io/npm/dm/@ai-markdown/code-language-detector?label=downloads%2Fmonth&color=blue)](https://www.npmjs.com/package/@ai-markdown/code-language-detector)
[![TypeScript declarations included](https://img.shields.io/badge/TypeScript-included-3178c6?logo=typescript&logoColor=white)](https://github.com/ai-markdown/ai-markdown/tree/main/packages/code-language-detector)
[![MIT license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/ai-markdown/ai-markdown/blob/main/packages/code-language-detector/LICENSE)

为没有语言标注的代码块做启发式语言检测，例如 LLM 输出中未标注语言的 Markdown 代码 fence。它返回的 id 可以直接交给 Shiki 或 highlight.js 使用。

主要使用场景是 **agent 的流式输出**：代码逐行到达，检测器必须在代码块完整之前给出可用的判定，并且中途不能反复改变判断，因为每次翻转都会让高亮闪烁。

指导原则是**宁可说“不知道”，也不要猜错**。证据不足时，结果是 `language: null` 加一份简短的候选列表，而不是强行选出一种语言。

- 零运行时依赖，同步执行，约 315 条正则规则覆盖 42 种语言。
- 流式检测器采用四种稳定性策略；在可复现语料库上跨家族翻转次数为 0。
- 提供到 Shiki 与 highlight.js 语言名称的转换函数，以及几个规范化函数，把由人、模型或工具写出的语言名称映射为 `CodeLanguage`，或映射为高亮器使用的名称。

<span id="install"></span>

## 安装

```bash
npm install @ai-markdown/code-language-detector
```

双格式 ESM/CJS 构建：`import` 与 `require` 均可正常工作，两者均附带类型声明。

<span id="use"></span>

## 使用

<span id="one-shot-detection"></span>

### 一次性检测

```ts
import { detectLanguage } from '@ai-markdown/code-language-detector';

const result = detectLanguage(code);
// {
//   language: 'rust',              // CodeLanguage.Rust，证据不足时为 null
//   confidence: 1,                 // 0..1；只有达到 0.8 及以上才会给出语言
//   candidates: ['rust'],          // 最佳候选在前，最多四个，language 为 null 时同样存在
//   evidence: ['rs-fn', 'rs-let-mut', ...], // 规则 id，用于调试
// }

const lang = result.language ?? 'text';
```

`language` 是 `CodeLanguage` 枚举成员。它的取值就是 Shiki 语言 id，因此 `result.language === 'rust'` 与 `result.language === CodeLanguage.Rust` 是同一个判断。

<span id="streaming"></span>

### 流式检测

```ts
import { StreamingLanguageDetector } from '@ai-markdown/code-language-detector';

const detector = new StreamingLanguageDetector();

// 每收到一个 chunk，都传入目前累积的完整代码，而不是增量。
// 大多数调用直接返回缓存结果，不做任何检测。
onChunk((accumulated) => {
  render(detector.update(accumulated).language ?? 'text');
});

// fence 闭合时，基于完整内容再检测一次。
onFenceClose((full) => {
  render(detector.finalize(full).language ?? 'text');
});
```

每个代码块使用一个检测器。以相同文本再次调用 `update` 或 `finalize`（例如重新渲染）时，会直接返回缓存结果，不再检测。

<span id="cache-across-renders"></span>

### 跨渲染缓存

```ts
import { DetectionCache } from '@ai-markdown/code-language-detector';

const cache = new DetectionCache(500); // LRU，以内容哈希为键
const result = cache.detect(code); // 相同内容只检测一次
```

<span id="converters"></span>

### 转换函数

```ts
import { detectLanguage, toHighlightJsLanguage, toShikiLanguage } from '@ai-markdown/code-language-detector';

const { language } = detectLanguage(code);

// Shiki：id 本身已经一致
const html = language ? await codeToHtml(code, { lang: toShikiLanguage(language), theme }) : escape(code);

// highlight.js：少数名称不同，且对应的 grammar 可能尚未注册
const name = language ? toHighlightJsLanguage(language) : null;
const highlighted = name && hljs.getLanguage(name) ? hljs.highlight(code, { language: name }).value : escape(code);
```

| `CodeLanguage`          | `toHighlightJsLanguage`     | 原因                                                                                                                                                                              |
| ----------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `objective-c`           | `objectivec`                | highlight.js 的名称                                                                                                                                                               |
| `vb`                    | `vbnet`                     | highlight.js 的名称                                                                                                                                                               |
| `asm`                   | `x86asm`                    | highlight.js 的名称                                                                                                                                                               |
| `jsx` / `tsx`           | `javascript` / `typescript` | highlight.js 只把它们作为别名；这里写出完整名称，因此是否注册了别名不会产生影响                                                                                                   |
| `html`, `vue`, `svelte` | `xml`                       | `html` 是 `xml` 的别名。highlight.js 没有 Vue 或 Svelte 的 grammar；`xml` 会把 `<script>` 作为 JavaScript、把 `<style>` 作为 CSS 子语言高亮，而 `javascript` 会把模板高亮得一团糟 |
| `zig`                   | `zig`                       | highlight.js 未内置，但第三方 grammar 包会以这个名称注册；请检查 `hljs.getLanguage`，并回退为纯文本                                                                               |
| 其他所有语言            | 保持不变                    |                                                                                                                                                                                   |

<span id="normalizing-language-names"></span>

### 规范化语言名称

模型和人在代码 fence 上写的语言名称，高亮器未必采用同样的拼写，甚至可能完全不认识：`objc`、`txt`、`Makefile`、`console`。`normalizeHighlightJsLanguage` 与 `normalizeShikiLanguage` 把这类名称映射为高亮库实际使用的名称。两者都忽略大小写和首尾空白，并且总是返回字符串：

- 属于 42 种语言之一的名称，经 `normalizeCodeLanguage` 和对应的转换函数解析：`objc` 在 highlight.js 下变为 `objectivec`，在 Shiki 下变为 `objective-c`；`vue` 在 highlight.js 下变为 `xml`。
- 42 种语言之外、两个高亮器拼写不同的常见名称，由一张小表转换，覆盖纯文本、shell 会话、批处理文件、Makefile、CoffeeScript、Fortran、Delphi、Vim script、Jinja、Mathematica、Common Lisp、Protocol Buffers、补丁、Elixir、Perl、NDJSON 与 Objective-C++。
- 其他名称只转为小写，其余原样返回（`haskell`、`jsonc`），因为它很可能是高亮器认识的语言。

| fence 上的名称                   | `normalizeHighlightJsLanguage` | `normalizeShikiLanguage` |
| -------------------------------- | ------------------------------ | ------------------------ |
| `objc`                           | `objectivec`                   | `objective-c`            |
| `vue`                            | `xml`                          | `vue`                    |
| `txt`、`text`、`plain`、空字符串 | `plaintext`                    | `text`                   |
| `console`                        | `shell`                        | `shellsession`           |
| `batch`、`bat`、`cmd`            | `dos`                          | `bat`                    |
| `Makefile`                       | `makefile`                     | `make`                   |
| `coffee`                         | `coffeescript`                 | `coffee`                 |
| `viml`                           | `vim`                          | `viml`                   |
| `jinja2`                         | `django`                       | `jinja`                  |
| `proto`                          | `protobuf`                     | `proto`                  |
| `patch`                          | `diff`                         | `diff`                   |
| `ndjson`                         | `json`                         | `jsonl`                  |
| `mm`、`objective-c++`            | `objectivec`                   | `objective-cpp`          |
| `haskell`、`jsonc`（其他名称）   | 仅转为小写                     | 仅转为小写               |

```ts
import { detectLanguage, normalizeHighlightJsLanguage } from '@ai-markdown/code-language-detector';

// 带 info string 的 fence：信任它，只有没有 info string 时才检测
const language = info || detectLanguage(code).language;
const hljsName = language ? normalizeHighlightJsLanguage(language) : 'plaintext';
const highlighted = hljs.getLanguage(hljsName) ? hljs.highlight(code, { language: hljsName }).value : escape(code);
```

返回的是名称，而不是 grammar 已注册或已加载的保证：请检查 `hljs.getLanguage(name)` 或 Shiki 实例已加载的语言，并回退为纯文本。

`normalizeCodeLanguage` 回答的是另一个问题：某个名称指的是 42 种语言中的哪一种。它把由人或其他工具写出的名称（fence 的 info string、文件扩展名、highlight.js 或 Shiki 的名称及别名）解析为 `CodeLanguage`，不对应其中任何一种时返回 `null`。它同样忽略大小写和首尾空白，并且完全匹配的 `CodeLanguage` 取值总是优先于别名（`html` 解析为 `Html`，尽管 highlight.js 把 `html` 归在 `xml` 之下）。

```ts
import { normalizeCodeLanguage } from '@ai-markdown/code-language-detector';

normalizeCodeLanguage('py'); // CodeLanguage.Python
normalizeCodeLanguage('x86asm'); // CodeLanguage.Assembly
normalizeCodeLanguage('haskell'); // null：不在这 42 种语言之内
```

有歧义的名称会刻意解析为 `null`：`m`（Objective-C 或 MATLAB）、`s`、`sc`、`conf`、`cfg`、`console`（表示 shell 会话，而不是脚本）、`sass`（缩进语法并不是 SCSS）、`gradle`、`jsp`，以及 Objective-C++（`mm`）。`h` 解析为 C。`jsonc` 与 `json5` 也解析为 `null`：它们是 JSON 的超集，在 Shiki 中有各自的 grammar，而 highlight.js 把两者都注册为 `json` 的别名，因此原样交给高亮器对两者都适用。映射高亮器名称的两个函数会转换 `console` 和 Objective-C++ 的各种写法，并原样传递 `jsonc` 与 `json5`。

<span id="api"></span>

## API 列表

| 导出符号                                   | 说明                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `detectLanguage(code)`                     | 一次性检测，返回 `LanguageDetectionResult`                                                                         |
| `StreamingLanguageDetector`                | `update(code)`、`finalize(code)`、`reset()`、`current`；选项见下                                                   |
| `DetectionCache`                           | `new DetectionCache(limit = 500)`、`detect(code)`、`clear()`、`size`                                               |
| `toShikiLanguage(language)`                | Shiki 语言 id（原样返回）                                                                                          |
| `toHighlightJsLanguage(language)`          | highlight.js 语言名称（见上表）                                                                                    |
| `normalizeHighlightJsLanguage(name)`       | fence 上所写名称对应的 highlight.js 语言名称；不认识的名称只转为小写后返回                                         |
| `normalizeShikiLanguage(name)`             | fence 上所写名称对应的 Shiki 语言名称；不认识的名称只转为小写后返回                                                |
| `normalizeCodeLanguage(name)`              | 根据名称、扩展名或高亮器别名返回 `CodeLanguage`；不对应 42 种语言中的任何一种时返回 `null`                         |
| `CodeLanguage`                             | 42 种语言的字符串枚举；取值为 Shiki id                                                                             |
| `LanguageDetectionResult`（类型）          | `{ language: CodeLanguage \| null; confidence; candidates: readonly CodeLanguage[]; evidence: readonly string[] }` |
| `StreamingLanguageDetectorOptions`（类型） | `lockConfidence`（0.9）、`growthRatio`（0.5）、`minGrowthChars`（80）、`familySwitchMargin`（0.1）                 |

结果对象在调用方之间共享（未知结果是冻结对象），请将其视为只读。

<span id="how-it-works"></span>

## 工作原理

```
code → rules score every language ─ high confidence ─→ language
                                  └ ambiguous ───────→ language: null, candidates: [2–4 languages]
                                  └ no evidence ─────→ language: null, candidates: []
```

JSON 单独处理：能被 `JSON.parse` 接受的对象或数组直接判定为 `json`，置信度 0.98。其他内容都由规则打分。超过 20,000 个字符的输入只检查开头和结尾各 10,000 个字符。

<span id="design-principles"></span>

### 设计原则

**规则只有一种。** 所谓“definitive”规则，就是权重较高并带有 `definitive` 标记的普通规则（`<?php`、`let mut`、`System.out.println`）。由于只有一条代码路径，永远不会出现“强规则命中了，但分数给出另一个结论”这种需要仲裁的情况。

**definitive 规则只有在唯一时才会提升置信度。** 只有当恰好存留一种 definitive 语言（被负分压到零以下的语言不计入），并且它同时也是得分最高的语言时，置信度才会被提升到 0.95。如果两种语言的强特征同时出现（例如 Python 文件中包含一段 SQL 字符串），说明证据自相矛盾，此时按普通打分处理。如果采用“第一条命中的 definitive 规则”，被提升的语言就会取决于规则文件的拼接顺序。

**definitive 规则必须足够窄。** 审查中发现的 0.95 误判几乎都来自写得过宽的 definitive 规则：`SELECT … FROM` 吞掉了 `import { Select } from '…'` 和 Drizzle 的 `select().from()`；`Verb-Noun` 形式的 cmdlet 规则吞掉了 JS 中的 `'Set-Cookie'`；`activate$` 吞掉了 `source venv/bin/activate`；两行 `int a = 1;` 被当成了汇编的 `int` 中断指令；`Eigen::Matrix<…>` 匹配上了 Julia 的 `::Matrix`。把规则标记为 definitive 之前，先排除**这种写法在其他语言中最常见的相似形式**（位于引号内、注释内，或不在命令位置）。

**在多种语言中同样合法的语法，必须给这些语言打相同的分。** 这是最重要的一条经验。`int main()` 在 C 和 C++ 中同样常见；给 C 打 7 分、给 C++ 打 5 分，就凭空制造出 2 分的差距，把一个本应有歧义的 `#include <stdio.h>` 片段变成高置信度的误判。同样的道理适用于 JS/TS 共有的 `function foo()`，以及 TS/Swift/Kotlin 共有的类型注解 `(name: String)`。**只有真正能区分两种语言的规则，才可以给它们打不同的分。** 差距应当由真正的区分特征补回来：小写的基本类型（`: string`、`Map<string, number>`）和 `const x: T` 只存在于 TS 中；`: Int`、`init(`、`val` 和 `lateinit` 只存在于 Swift 或 Kotlin 中。

**大部分消歧由负权重完成。** `interface Foo` 给 typescript +9、给 javascript −8；JSX 标签给 jsx +9、给 javascript −4（JSX 无法作为普通 JS 运行）。如果只有正分，就无法区分“碰巧包含 interface 一词的 JS”与真正的 TS。

**结构上不可能的情况使用 `excludes`，而不是负分。** 负分表达的是倾向，足够多的正面证据可以累加超过它：Svelte 组件 `<script lang="ts">` 块里的数百行 TS 会触发十几条 TS 规则，typescript 达到 80 分，而 svelte 只有 49 分，反向扣分设成 −6、−12 还是 −40 都只是赌博。然而，以 `<script>` 标签开头的片段在结构上不可能是 JS/TS 文件，因此这条规则用 `excludes` 把这些语言从排名中移除。由于 `excludes` 非常粗暴，规则卫生测试只允许在锚定于片段开头的规则上使用它（`^`，且没有 `m` flag）；目前恰好只有一条这样的规则。

**注释和字符串中的代码不算证据。** agent 输出中充满了包含其他语言的注释和字符串：JSDoc 行 `* Usage: <script src="x.js">`、断言 `toContain('<style>')` 的测试、写着“把这段放进 `<style>` 标签”的 CSS 注释。因此，HTML 标签规则要求标签不在注释行上（行首不是 `/*`、`*`、`//` 或 `#`），并且不直接跟在引号之后。嵌入在 CI 配置中的 shell（`run: |` 块）属于同一类，会由 `yaml-embedded-script` 给 bash 打一个很大的负分。

**置信度不是分数的线性函数。** 它是三项的加权和：分数（0.55）、相对第二名的差距（0.30），以及证据的分散程度（0.15）。单条证据的置信度上限为 0.72，非常短的片段还会打折扣。分数和差距都会先开平方，因此“刚刚越过阈值”就已经能得到合理的中等置信度。

**平局时按流行度决定。** 语言先按分数排名，再按独立证据的数量排名，最后按流行度排名；只有前两项完全相同时，流行度才起作用。排名采用 TIOBE 指数份额（取自 2026-09），它在相似语言之间指向正确的方向：JavaScript 2.76 > TypeScript 0.43，因此没有类型证据时平局判给 javascript；C 10.28 > C++ 8.67，因此单独的 `#include` 判给 c。两者都是更保守的选择。TIOBE 统计的是搜索结果，与代码 fence 中实际出现的内容差别很大（TypeScript 排在 Visual Basic 之后；bash、JSON、YAML 和 HTML 根本没有排名），因此 18 种未上榜的语言使用根据其在代码 fence 中的常见程度估算的值。修改这些值不会改变任何有证据支撑的判定。

**候选有绝对下限。** 仅靠相对下限（最高分的 40%）是不够的：总分较低时，某条规则顺带给一种语言加的 1–2 分就可能越过它。候选还必须至少有 3 分，并且最多四个。

C 与 C++ 的区分模式以及 Objective-C 的区分模式，沿用了 [GitHub Linguist](https://github.com/github-linguist/linguist) 的 `named_patterns.cpp` 与 `named_patterns.objectivec` 启发式规则（MIT License），这些规则已在真实代码仓库上得到验证。

<span id="streaming-strategies"></span>

### 流式策略

`StreamingLanguageDetector` 跟踪一段不断增长的文本，并采用四种策略：

- **置信度只升不降。** 置信度更低的重新检测结果会被忽略，因此代码块中途证据被稀释时，判定不会退回 `null`。
- **切换家族需要超出差距。** 当两次判定都越过高置信度线，却指向不同的语言家族时，说明证据自相矛盾；新判定必须比旧置信度高出 `familySwitchMargin`（0.1）。家族内部的细化（例如 `typescript → tsx`）不受限制。
- **高置信度即锁定。** 从 `lockConfidence`（0.9）起，追加的内容不再重新检测。
- **增长阈值。** 在文本自上一个检查点起增长 `minGrowthChars`（80）个字符且增长 `growthRatio`（50%）之前，`update` 不查看文本，直接返回缓存结果。检查点按几何级数增长，因此整个流只需要少数几次检测。

`finalize` 会基于完整内容重新检测，但**不会无条件覆盖**：如果完整内容得不出语言，就保留流式期间的判定；家族内部的细化会被采纳；切换到其他家族仍然必须超出差距。早期版本允许 `finalize` 直接覆盖，结果 GitHub Actions 文件前 30 行一直稳定判定为 `yaml`，却因为 `run: |` 块中积累了足够多的 bash 证据，在 fence 闭合的那一刻跳成了 `bash`。

语言家族：JavaScript/TypeScript/JSX/TSX · C/C++/Objective-C · HTML/XML/Vue/Svelte · CSS/SCSS/Less · JSON/YAML/TOML/INI · Bash/PowerShell · Java/Kotlin/Groovy/Scala · MATLAB/Julia。家族内部的混淆对高亮几乎没有影响。

**跟踪同一段文本。** 如果输入不是所跟踪文本的延伸（`startsWith` 不成立），它就是另一段文本，检测器会重置。当调用方用 `+=` 拼接文本时，即使只读取一个字符，V8 也会先把整段字符串展平，所以查看内容的耗时始终与文本长度成正比；如果每次调用都查看，逐 token 的流式输入会变成平方级开销（一个 200 KB 的代码块会耗时数秒而不是数毫秒）。因此检测器按几何级数的节奏查看内容：自上次检查以来，文本增长了 256 个字符，或增长量超过其长度的 1/32 时（取较大者），执行一次尾部检查，比较上一次检查过的输入的最后 64 个字符是否仍位于相同偏移处；比所跟踪文本更长的替换文本（例如重新生成的代码块）会在这段增长之内重置检测器。整段文本的比较在以下时机执行：输入不长于所跟踪的文本时、到达增长检查点时，以及 `finalize` 中，替换文本恰好重复了这 64 个字符的情况也会在这些时机被发现。整个流的总开销保持线性。`finalize` 之后，相同的文本直接返回缓存结果；延伸文本会以当前判定恢复流式检测；其他文本则会触发重置。

<span id="accuracy-and-performance"></span>

## 准确率与性能

下文所有准确率数据都是在检测器作为原型开发期间测得的。其中两组可以在本仓库中复现：合成测试装置（`fixture metrics` 测试在每次运行时对其设置门禁），以及手工挑选的 GitHub 语料库（见[基准测试](#benchmarks)）。本地语料库的数据是在一批私有源文件上测得的，无法重新生成。

**合成测试装置**（78 个模仿真实代码 fence 的样本，其中 20 个应当保持沉默）。可复现，并由测试套件强制校验。

| 指标                | 数值          |
| ------------------- | ------------- |
| False positive rate | 0.0% (0/20)   |
| Precision           | 100% (58/58)  |
| Coverage            | 74.4% (58/78) |

**GitHub 语料库**（`scripts/github-curated.tsv`：126 个文件，121 个可用，涵盖本地语料库中没有样本的 11 种语言）。可复现：每个文件都钉在固定的 commit 上。该列表是**手工挑选**的：先按 star 数选出每种语言的头部仓库，再只保留承载业务逻辑的源文件（lichess 的锦标赛模块、Spark 的调度器、ghostty 的终端解析器、tigerbeetle 的存储层、SDWebImage 的缓存、YesPlayMusic 的页面等），排除测试、示例、演示、文档、vendored 的第三方代码、VBA（而非 VB.NET）以及恶意软件源码合集。片段取自每个文件的开头；“宽松”口径接受同一家族的语言。

| 语言        | 文件数  | 检出率    | 严格      | 宽松     | 流式跨家族 |
| ----------- | ------- | --------- | --------- | -------- | ---------- |
| objective-c | 11      | 100%      | 100%      | 100%     | 0%         |
| vue         | 9       | 100%      | 100%      | 100%     | 0%         |
| zig         | 15      | 93.3%     | 100%      | 100%     | 0%         |
| matlab      | 13      | 92.3%     | 100%      | 100%     | 0%         |
| julia       | 11      | 90.9%     | 100%      | 100%     | 0%         |
| applescript | 8       | 87.5%     | 100%      | 100%     | 0%         |
| asm         | 7       | 85.7%     | 100%      | 100%     | 0%         |
| vb          | 14      | 78.6%     | 100%      | 100%     | 0%         |
| svelte      | 8       | 75.0%     | 100%      | 100%     | 0%         |
| scala       | 13      | 69.2%     | 100%      | 100%     | 0%         |
| less        | 12      | 58.3%     | 57.1%     | 100%     | 0%         |
| **合计**    | **121** | **84.3%** | **97.1%** | **100%** | **0%**     |

流式一列和下面的数据来自同一语料库上的 `src/evidence/streaming.evidence.ts`（对共享文件头去重后为 100 个文件，前 40 行逐行输入）：跨家族翻转 0%，首次得到正确判定的行号为第 7 行（p50）/ 第 21 行（p90），92% 在 40 行内检出，`finalize` 后 94% 正确。

手写样本系统性地偏向教科书风格。这个语料库首次运行就暴露了以下问题：以 `<script lang="ts">` 开头的 Svelte 组件、正文为 Markdown 的 Julia docstring、与 Go 的 `package main` 冲突的单段 Scala 包名，以及用 MASM 语法编写的 MS-DOS 汇编；合成测试装置一个都没有发现。**请在真实项目代码上验证新语言。**

**本地语料库**（仅限原型，不可复现；按每个文件的前三行去重，排除快照与测试装置文件，以文件扩展名作为真实标签）：

| 采样方式                     | 严格 precision | 宽松 precision | Coverage |
| ---------------------------- | -------------- | -------------- | -------- |
| 文件开头（最接近代码 fence） | 92.7%          | **100%**       | 79.4%    |
| 文件中任意位置               | 89.5%          | 97.9%          | 72.4%    |

| 流式（289 个文件，前 40 行逐行输入） | 数值               |
| ------------------------------------ | ------------------ |
| 跨家族翻转（高亮闪烁）               | **0.0%** (0/289)   |
| 首次得到正确判定所需行数             | p50 **5** · p90 19 |
| 40 行内检出                          | 84.1%              |
| 最终判定正确                         | 88.6%              |

| 完整大文件（204 个超过 8 KB 的文件，与 `finalize` 时一样单次调用检测） | 数值                            |
| ---------------------------------------------------------------------- | ------------------------------- |
| 同家族正确                                                             | **100%**                        |
| 检出率                                                                 | 93.6%                           |
| 单次调用耗时                                                           | 平均 5.6 ms（输入上限为 20 KB） |

在修复 CI 内嵌 shell 与引入 `excludes` 之前，整文件指标为 94.8%：GitHub Actions workflow 中的 `run: |` 块把 7 个 YAML 文件判成了 bash，还有一个 Svelte 组件因为其 script 块被判成了 typescript。只看前 40 行的流式评估无法发现这类问题。

<span id="performance"></span>

### 性能

| 场景                                                                            | 耗时                                      | 来源                  |
| ------------------------------------------------------------------------------- | ----------------------------------------- | --------------------- |
| 单次检测，典型 fence（8–36 行）                                                 | p50 0.28 ms · p95 0.6 ms                  | GitHub 语料库，可复现 |
| 在 20 KB 上限处的单次检测                                                       | 5.6–7.7 ms                                | 本地语料库            |
| **逐行流式输入一个 fence 的全部检测工作**（平均 14.7 KB，456 次 `update` 调用） | **p50 4.9 ms · p90 8.4 ms · max 10.7 ms** | GitHub 语料库，可复现 |

测试环境为 Apple M3 Max 与 Node 24。对流式场景而言，最后一行才是关键：增长阈值按几何级数递增，锁定机制会停止重新检测，因此一个 fence 从流式输入到闭合期间检测器所做的全部工作，加起来只有几毫秒，并且分散在数秒的输出过程中。

以下两项优化经过测量后被否决：

- **字面量预检查**（每条规则声明一个必需的字面量；输入中不含该字面量时跳过正则）。典型片段只会命中 2.2% 的规则，看起来这能跳过大部分工作，但原型只快了 1.2×：预检查必须确认某个字面量*不存在*，这意味着 `String.includes` 要扫描整个输入，开销与正则处于同一量级。开销还均匀分布在 300 多条规则上（最昂贵的一条也只占 1.3%），不存在可以针对性优化的热点。
- **更低的截断上限。** 在 6 KB 时，最坏的单次调用快了 2.4×，同家族准确率甚至略有上升，但 coverage 下降了 2 个百分点。20 KB 的调用在每个 fence 中只发生一次（在 `finalize` 时），因此上限保持为 20 KB。

<span id="supported-languages"></span>

## 支持的语言

共 42 种语言，全部使用 Shiki 语言 id。`*` 标记拥有 `definitive` 特征的语言（一旦匹配即可确定语言，例如 `<?php`、`let mut`、`tell application "…"`、`@import("std")`）。

| 分组          | 语言                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C 家族        | `c` · `cpp`\* · `objective-c`\*                                                                                                                              |
| ECMAScript    | `javascript` · `typescript` · `jsx` · `tsx`                                                                                                                  |
| JVM / .NET    | `java`\* · `csharp`\* · `kotlin`\* · `groovy`\* · `scala`\*                                                                                                  |
| 现代类 C 语言 | `go`\* · `rust`\* · `swift`\* · `zig`\* · `dart`\*                                                                                                           |
| 标记 / 文档   | `html`\* · `xml`\* · `markdown`                                                                                                                              |
| 数据 / 配置   | `json` · `yaml` · `toml`\* · `ini`                                                                                                                           |
| 样式表        | `css` · `scss`\* · `less`\*                                                                                                                                  |
| 单文件组件    | `vue`\* · `svelte`\*                                                                                                                                         |
| 独立语言      | `sql`\* · `vb`\* · `python`\* · `ruby`\* · `matlab`\* · `julia`\* · `php`\* · `asm`\* · `lua` · `powershell`\* · `bash`\* · `applescript`\* · `dockerfile`\* |

<span id="known-limitations"></span>

## 已知限制

- **区分 `.ts` 与 `.js` 需要类型语法。** 没有类型注解的 TS 片段会得到 `language: null, candidates: ['javascript', 'typescript']`。这是有意为之。
- **`html` 与 `xml` 只靠规则区分。** highlight.js 对两者使用同一个 grammar，因此帮不上忙；就高亮而言，这种区分很少有影响。
- **GitHub 语料库上各语言的百分比波动很大**：每种语言 7–15 个文件足以暴露结构性问题，但不足以确定精确的比率。Less 的严格 precision 较低（57%）：只使用嵌套、不使用 `@variables` 的 Less 文件与 SCSS 或 CSS 无法区分，但它仍然留在样式表家族之内。
- **流式期间在家族内部细化是正常现象。** TSX 文件在出现第一个 JSX 标签之前都是合法的 TypeScript，因此判定会从 `typescript` 变为 `tsx`。Shiki 的 TS grammar 能正确高亮这部分内容，所以这不算闪烁；测试只禁止跨家族翻转。
- **从文件中间截取的片段可能落入错误的家族**（本地随机采样的宽松 precision 为 97.9%）：包含 SQL 字符串的 Python 切片、形似 JSON 的 Python dict 字面量、从 `<style>` 块内部开始的 HTML 切片。这些切片确实就是另一种语言的内容。流式输入的 fence 从代码开头开始，因此不会出现这种情况。
- **不处理家族内部的混淆**：`build.gradle.kts` 会被检测为 `groovy`（Gradle DSL 块看起来完全相同），这对高亮几乎没有影响。

<span id="footguns"></span>

## 避坑指南

- **`null` 是正常结果，不是错误。** 大多数简短或通用的片段（`npm install foo`、单独一行 `class Shape {}`）会刻意保持 `null`。请渲染为纯文本；如果你掌握额外信息（例如文件名），可以从 `candidates` 中挑选。不要默认把 `candidates[0]` 当作答案，那样会丢掉检测器专门为之设计的 precision。
- **传入累积文本，而不是增量。** 检测器无法跟踪增量：先 `update('let x')` 再 `update(' = 1')`，两次传入的是互不相关的文本。每个增量都会被当作一段新文本并重置检测器，因此判定永远不会超出单个增量所能提供的信息。
- **每个代码块使用一个检测器。** 检测器跟踪的是单段不断增长的文本。复用它处理下一个 fence 是可行的（非延伸文本会触发重置），但更长的替换文本要等到下一次尾部检查（增长 256 个字符或文本长度的 1/32 以内）、增长检查点或 `finalize` 才会被发现，在此之前仍保留旧文本的判定。如果你知道某个代码块已被重新生成或替换，请调用 `reset()`，它不必等待上述检查。
- **fence 闭合时调用 `finalize`。** 在此之前，判定可能只基于前缀，而已锁定的判定永远不会重新检测。在文本相同的重新渲染中重复调用 `finalize` 开销很小。
- **面对跨家族的新判定，除非它明显更好，否则 `finalize` 会保留原有判定。** 如果一个代码块流式期间被判定为 YAML，结束时 shell 内容多于 YAML，它仍然保持 `yaml`。这是预期行为；如果你想要不受历史影响的一次性判定，请使用 `detectLanguage(full)`。
- **`html` 与 `xml` 容易混淆。** 类 XHTML 片段或 SVG 片段可能返回其中任意一个。请把两者都映射到标记语言的 grammar，而不是根据两者的区别分支处理。
- **`normalizeCodeLanguage` 返回 `null` 表示“不在这 42 种之内”，而不是“不是真实存在的语言”。** `haskell` 和 `jsonc` 在两个高亮器中都是有效名称。要把 fence 的 info string 转换为高亮器名称，请改用 `normalizeHighlightJsLanguage` 或 `normalizeShikiLanguage`：它们会转换两个高亮器拼写不同的名称，并原样传递其他名称；如果遇到 `null` 就回退为纯文本，这些名称就会丢失。
- **转换函数返回的名称并不代表 grammar 已注册。** `toShikiLanguage`、`toHighlightJsLanguage`、`normalizeShikiLanguage` 与 `normalizeHighlightJsLanguage` 返回的是名称，而不是保证：Shiki 需要把该语言加载到高亮器中，highlight.js 需要注册对应的 grammar（尤其是 Zig，它从未内置）。请检查 `hljs.getLanguage(name)` 或 Shiki 实例已加载的语言，并回退为纯文本。
- **不要修改结果对象。** 结果会被缓存并按引用共享；未知结果是冻结对象，在严格模式下向其数组 push 元素会抛出异常。

<span id="benchmarks"></span>

## 基准测试

GitHub 语料库上的测量是 evidence harness（`src/evidence/*.evidence.ts`），与 engine 存放「为门禁提供依据、本身不做门禁」的数据的方式相同：它们只打印表格、不做断言，不在测试套件的 `include` 范围内，也不属于发布包。

```bash
# 将手工挑选的 GitHub 语料库（126 个文件）下载到系统临时目录下的一个目录中
node packages/code-language-detector/scripts/fetch-github-corpus.mjs [corpus-dir]

# 按语言统计一次性检测准确率，以及流式行为：首次得到正确判定所需行数、
# 跨家族翻转、整文件开销和 finalize 准确率
pnpm --filter @ai-markdown/code-language-detector evidence
```

语料库目录默认为 `os.tmpdir()` 下的 `code-language-detector-corpus`；如果使用其他目录，把它传给下载脚本，并通过 `CORPUS_DIR` 传给 harness。`CORPUS_FILES_PER_LANGUAGE` 限制流式测量中每种语言的样本数（默认 25）。下载时只替换脚本自身管理的语言子目录，目录中的其他内容保持不变；每个文件都按 `github-curated.tsv` 钉住的 commit 获取，因此多次运行测量的是同样的内容。

语料库文件属于各自的仓库，并继续适用这些仓库的许可证。它们只下载到本地用于测量，不要提交到本仓库。

<span id="adding-rules"></span>

## 添加规则

1. 在 `src/rules/<language>.ts` 中添加一条 `DetectionRule`；如果是新文件，在 `src/rules/index.ts` 中注册。
2. 在 `src/__tests__/fixtures.ts` 中添加一个正例样本，**同时**添加一个最容易与之混淆的语言的样本。
3. 运行 `pnpm --filter @ai-markdown/code-language-detector test`。规则卫生测试会强制要求：id 唯一、不使用 `g`/`y` flag、没有嵌套量词、`definitive` 语言的分数为正、`excludes` 只用于锚定在开头的规则，以及在病态输入上不会发生灾难性回溯。如果 false positive rate 高于 0、precision 低于 100%，或 coverage 低于其基线（coverage 提升时请同步提高基线），`fixture metrics` 测试就会失败。
4. **运行 evidence harness（见[基准测试](#benchmarks)），确认流式跨家族翻转率没有上升。** 这一步不可省略。宽泛的规则很容易修好一个用例却弄坏另一个：`md-heading`（以 `# ` 开头的行）曾把带注释块的 YAML 判成 markdown，`ini-key-value`（`key = value`）差点污染了一大批语言。两次都是流式测量发出了警报，单元测试和合成测试装置都没有发现。
5. 当改动涉及语料库覆盖的某种语言时，检查一次性检测准确率表。对于新语言，请把热门项目中承载业务逻辑的文件加入 `scripts/github-curated.tsv`（钉到固定 commit），在 `CodeLanguage` 中添加成员并在 `src/aliases.ts` 中添加其常见名称，在 `src/popularity.ts` 中为其设置流行度值（有测试检查每种语言都有该值），如果它有近亲语言，还要在 `src/families.ts` 中为其指定家族；转换函数的测试会检查 Shiki 是否打包了该 id，以及 highlight.js 是否认识映射后的名称。

添加规则之前，先问自己：这个模式是否高度体现该语言的特征，或者至少能大幅缩小候选范围？许多语言共有的关键字（`if`、`for`、`while`、`class`、`return`）不应写进规则。

把规则标记为 `definitive` 之前，先问自己：这种写法是否可能出现在**其他语言的字符串、注释或 import 语句中**？如果可能，先用后行断言、行首锚点或命令位置排除这些形式，否则就不要将其标记为 definitive。谨慎使用 `i` flag：大小写本身就是信息（`FROM node:20` 是 Dockerfile，`from os` 是 Python；`$Name =` 是 PowerShell，`$name =` 是 PHP）。

<span id="versioning"></span>

## 版本策略

本包独立于 `@ai-markdown/react` 发布版本进行版本管理。规则变更可能改变某些输入的检测结果；测试装置门禁确保这些变更不会在测试装置上新增 false positive，也不会降低 precision。

<span id="license"></span>

## 开源协议

MIT。C、C++ 与 Objective-C 的区分模式以及 MATLAB 的 `%` 注释规则源自 GitHub Linguist 的启发式规则（MIT）；相关归属详见 [LICENSE](https://github.com/ai-markdown/ai-markdown/blob/main/packages/code-language-detector/LICENSE)。

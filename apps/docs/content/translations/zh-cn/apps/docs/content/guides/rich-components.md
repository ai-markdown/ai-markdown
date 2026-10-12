# 代码块、图表、图片与表格

这些组件入口从 3.3.0 起提供。[自己写渲染器或适配器](#build-a-renderer-or-an-adapter)一节介绍的 `@ai-markdown/core/components` 共用函数以 3.4.0 为准。

这些组件直接注册到 Markdown 即可使用，不需要自己提取 AST、再包一层组件或增加 provider。React 使用 `customComponents`，Vue 使用 `components`。基础 Markdown 入口保持独立。

<span id="react"></span>

## React

默认代码块内置 Mermaid，请先安装 `mermaid@^11.17.2`：

```tsx
import AIMarkdown from '@ai-markdown/react';
import { MarkdownCodeBlock, MarkdownImage, MarkdownTable } from '@ai-markdown/react/components';
import '@ai-markdown/react/components/styles.css'; // 可选默认样式

const components = { pre: MarkdownCodeBlock, img: MarkdownImage, table: MarkdownTable };

<AIMarkdown content={content} streaming={streaming} customComponents={components} />;
```

Mermaid 是代码块内置的语言渲染器，由显式的 `mermaid` 围栏触发。引擎在客户端按需加载，服务端和首次 hydration 都输出源码。复制始终使用最新原始源码，包含末尾换行，不受高亮节流、格式化或当前预览模式影响。

文档流式输出期间，图表源码通常只是不完整的前缀，所以解析失败不会报错：代码块继续显示源码，或者显示上一次渲染成功的图表。两次尝试之间的间隔由 `mermaidIntervalMs` 决定。流式结束后会用最终源码再渲染一次，这次失败才显示 Mermaid 给出的错误信息。引擎模块下载失败时，组件会间隔 1.5 秒重试三次，之后显示“Diagram engine could not load.”和重试按钮。

<span id="vue"></span>

## Vue

```vue
<script setup lang="ts">
import { AIMarkdown } from '@ai-markdown/vue';
import { MarkdownCodeBlock, MarkdownImage, MarkdownTable } from '@ai-markdown/vue/components';
import '@ai-markdown/vue/components/styles.css';

const components = { pre: MarkdownCodeBlock, img: MarkdownImage, table: MarkdownTable };
</script>

<template>
  <AIMarkdown :content="content" :streaming="streaming" :components="components" />
</template>
```

组件本身是同步声明的普通 Vue 组件。Markdown 通过声明的 props 传入 `node`、`streaming` 和 `metadata`，其他元素属性走 attrs，已渲染的子内容走默认 slot，无需额外适配 scoped slot。

<span id="extend-a-code-language"></span>

## 扩展代码语言

工厂在模块作用域创建一次。每个返回的组件拥有自己的配置，不会改动其他 Markdown 实例的语言注册表。

```tsx
import { createMarkdownCodeBlock, type CodeRendererInput } from '@ai-markdown/react/components/code';

function StatusPreview({ code, active }: CodeRendererInput) {
  return <output hidden={!active}>{code}</output>;
}
const AppCode = createMarkdownCodeBlock({
  renderers: { status: StatusPreview, mermaid: false },
  formatJson: true,
  expandNestedJson: false,
});
// customComponents={{ pre: AppCode }}
```

Vue 从 `@ai-markdown/vue/components/code` 导出同名工厂，语言渲染器是声明相应输入 props 的 Vue 组件。语言键会去除首尾空格并转小写；自定义项覆盖内置项，`false` 禁用指定语言渲染器，未知语言回退普通代码。自动语言检测只用于高亮和格式化，绝不会把未标注的代码提升为图表。

渲染器接收 `code`、`language`、文档级 `streaming`、`colorScheme`、`active` 和不透明的 `resetKey`。追加源码保留组件实例，替换源码会切换代次。自定义异步渲染器需要在停用、代次变化和卸载时取消或使旧任务失效；组件渲染异常会回退源码，但自行启动的 Promise 仍需自行处理错误。`documentId` 变化时，自带的代码块也会开始新的代次，所以同一位置上的另一篇文档不会被当成追加。两篇文档的 id 和内容都完全相同时，请用不同的 Markdown key 重建生命周期。

中性组件默认配置为 `defaultExpanded: true`、`autoDetectUnknownLanguage: true`、`highlightIntervalMs: 50`、`mermaidIntervalMs: 300`、`formatJson: false`、`expandNestedJson: false`。React 的优先级是工厂显式选项、既有 `codeBlock` behavior group、默认值；group 传输仍按整组替换。Vue 通过工厂配置，`colorScheme` 接受 `'light'`、`'dark'` 或响应式 getter。仅修改 CSS 不会自动改变 Mermaid 图表主题。

没有标注语言的代码块在流式输出过程中就会检测语言。`streaming` 描述的是整个文档，并不表示某个围栏已经闭合，所以代码块的文本连续 300 毫秒没有变化时，就按已完成判定并显示语言，即使文档的其余部分还在输出。文本被替换后检测重新开始。

语法高亮是可选增强。`highlight(code, language)` 返回 React 节点或 Vue VNode；没有驱动时仍可正常显示、选择和复制纯文本。以下是 React 使用可信 highlight.js 实例的示例：

```tsx
import hljs from 'highlight.js/lib/common';
import 'highlight.js/styles/github.css';

const HighlightedCode = createMarkdownCodeBlock({
  highlight(code, language) {
    if (!hljs.getLanguage(language)) return code;
    const html = hljs.highlight(code, { language }).value;
    return <span dangerouslySetInnerHTML={{ __html: html }} />;
  },
});
```

Vue 可返回 `h('span', { innerHTML: html })`。这里只能传可信高亮器的输出，不能传原始 Markdown。异步加载语法的驱动需要管理自己的响应式加载状态；Mantine 继续使用应用原有的 highlighter provider。

<span id="imports-without-mermaid"></span>

## 不安装 Mermaid

`mermaid: false` 是运行时开关，打包器仍可能解析默认代码入口里的动态 import。完全不需要 Mermaid 的应用，请使用不引用图表驱动的入口：

```ts
import { MarkdownCodeBlock, createMarkdownCodeBlock } from '@ai-markdown/react/components/code/plain';
import { MarkdownImage } from '@ai-markdown/react/components/image';
import { MarkdownTable } from '@ai-markdown/react/components/table';
```

Vue 提供相同子路径。普通代码入口仍支持自定义语言渲染器；图片和表格入口不引用 Mermaid。默认代码入口的 `preloadCodeAssets()` 可以提前加载引擎，请处理加载失败时的 Promise 拒绝。

<span id="image-preview"></span>

## 图片预览

普通图片在 hydration 后变成可用键盘操作的预览触发器。Enter 打开弹层，Escape 或关闭按钮退出并恢复焦点；预览按 [rc-image](https://github.com/react-component/image) 的体验实现：全屏暗色遮罩、两侧切图、底部悬浮工具栏，支持水平/垂直翻转、左右旋转、缩放。缩放范围为 1–50 倍，每步乘/除 1.5；滚轮和双击围绕指针缩放，拖拽越界后回弹，触摸支持平移和双指缩放。切图会重置变换，保留独立加载/错误反馈、焦点限制和背景滚动锁。React/Mantine 直接使用 rc-image 内核，Vue 通过原生 dialog 实现同一套交互规则。预览挂到 body，不破坏段落结构。

链接、按钮以及对应交互 role 内的图片保留原有行为，动态修改 role 也会重新判断。预览使用浏览器实际选中的 `currentSrc`，没有时才用已清洗的 `src`，支持响应式图片。`src`/`srcSet` 变化会关闭预览；图片属性和事件仍落在实际 img 上。没有新增高清地址解析器或第二次 URL 策略处理。

<span id="table-export"></span>

## 表格导出

表格保留原有子内容以及自定义 `th`/`td`，外层提供可键盘聚焦的横向滚动、复制 TSV 和下载 UTF-8 BOM CSV。点击时同步取得当前已提交表格的快照，后续流式更新不会修改已经启动的导出。

导出使用处理和清洗后的 Markdown 语义：链接标签、行内代码文本、图片 alt、换行以及只出现一次的 TeX 数学注解。自定义单元格额外插入的按钮等 UI 不会进入导出；标点可能已经受到排版插件处理。公式形态的文本会加前导单引号以供电子表格按文字处理，负数仍保留数值。这个策略与分隔符、引号和换行的转义分别执行。

仅支持没有合并单元格的矩形表格导出；不支持的结构仍可正常显示和滚动，导出按钮禁用并显示原因。本组件不提供排序、编辑、分页或虚拟化。

<span id="mantine-and-styling"></span>

## Mantine 与默认样式

`@ai-markdown/react-mantine/components` 提供同名的三个注册组件和代码块工厂。普通代码和内置 Mermaid 保留原来的高亮 provider、JSON 默认值及图表交互；显式语言扩展使用中性源码/复制外框。图片与 React 使用相同的 rc-image 内核和预览样式，表格使用共享 React 组件；除原有 Mantine 样式外，可导入 `@ai-markdown/react/components/styles.css`。

默认 CSS 是可选的，以 `aimd-*` 类限定范围。代码块、表格和图片反馈区域暴露 `--aimd-border`、`--aimd-surface`、`--aimd-text`。React 组件跟随 Markdown 主题，也会使用 Mantine 解析后的主题；Vue 代码块使用工厂主题配置，表格和图片反馈区域继承上层 `[data-color-scheme="dark"]` 或 `[data-mantine-color-scheme="dark"]`。应用可以直接覆盖类和变量，不需要为改样式再包组件。

`pre` 注册项负责普通围栏代码；单独的 `code` 注册项仍用于行内代码和回退的非标准 pre 结构，不会自动组合进增强代码块。带额外节点属性或非标准子结构的 pre 保留原来的渲染结果。

## 图片图标与分组预览

服务端渲染的图片在 JavaScript 加载前保持可见。水合后，缩略图加载时显示 `image` 占位图标，失败时显示 `image-off` 和图片说明。可预览的图片在悬浮或键盘聚焦时显示入口：单图使用 `image-play`，多图使用 `gallery-thumbnails`。

通过工厂配置语义图标，返回的组件可以直接注册，无需再次包装：

```tsx
import { createMarkdownImage } from '@ai-markdown/react/components/image';

const AppImage = createMarkdownImage({
  icons: {
    placeholder: <span>加载中</span>,
    error: AssetUnavailableIcon,
    preview: ViewPhotoIcon,
    gallery: OpenAlbumIcon,
  },
});
// customComponents={{ img: AppImage }}
```

React 支持节点或组件；Vue 的同名工厂从 `@ai-markdown/vue/components/image` 导出，接受 Vue 组件或 `h(...)` 创建的 VNode。Mantine 从 `@ai-markdown/react-mantine/components` 导出工厂，与 React 共用 rc-image 预览。未配置的图标保留默认值，`null` 可以隐藏图标。图标仅作装饰，按钮保留无障碍名称；自定义图标内不要放交互控件。

默认将同一文档内已加载、可预览的图片组成画廊，顺序与页面一致。单独使用的 Markdown 实例是一篇文档；在 `AIMarkdownDocuments` 内共用同一个显式 `documentId` 的实例也是一篇文档，所以协调输出的各个分段共用一个画廊。加载中、加载失败和链接中的图片不会加入；不同文档互不混组。预览支持上/下一张、左右方向键、缩放、旋转和翻转。选中图片被移除时关闭预览，Esc 关闭后焦点回到最初打开预览的图片。

`group: false` 可关闭分组；`group: '[data-photo-album]'` 可按最近的、匹配业务选择器的祖先元素分组，找不到匹配祖先时按单图处理。排版根节点不参与分组，自定义 `Typography` 组件不需要任何标记。`preview: false` 仅关闭预览，保留加载/错误反馈。

可选默认样式提供 `.aimd-image`、`.aimd-image-cover`、`.aimd-image-feedback`、`.aimd-image-icon`，水合后的缩略图状态由 `data-status="loading|ready|error"` 标记，可直接覆盖样式。

工具栏也支持通过 `icons` 配置图标或组件：`close`、`prev`、`next`、`flipX`、`flipY`、`rotateLeft`、`rotateRight`、`zoomIn`、`zoomOut`。导入组件样式即可使用全屏预览布局；自行提供样式时需覆盖 `.aimd-image-preview-*`。

<span id="build-a-renderer-or-an-adapter"></span>

## 自己写渲染器或适配器

`@ai-markdown/core/components` 包含 React、Vue 和 Mantine 组件共用的逻辑，不含任何框架或 DOM 类型。编写自定义语言渲染器、替换某个自带组件，或者为其他框架编写组件时，都可以使用它。`@ai-markdown/core` 因语言检测函数而依赖 `@ai-markdown/code-language-detector`。

| 用途                       | 导出                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| 读取 `pre` 节点            | `extractCode`、`normalizeRenderers`                                                       |
| 区分追加和替换             | `extendsCode`                                                                             |
| 编写代码块                 | `createCodeBlockSession`                                                                  |
| 对显示的代码节流           | `nextCodeFrame`、`createCodeFrame`                                                        |
| 检测未标注的语言           | `createCodeLanguageTracker`                                                               |
| 格式化 JSON                | `createJsonCompletenessScanner`、`jsonLooksComplete`、`prettyPrintJson`                   |
| 渲染 Mermaid 图表          | `createDiagramController`                                                                 |
| 在内置图表之外调用 Mermaid | `mermaidRenderQueue`、`ensureMermaidInitialized`、`getMermaidMaxTextSize`                 |
| 导出表格                   | `projectTable`、`serializeTable`                                                          |
| 图片分组和变换             | `getImageGallery`、`zoomImage`、`reboundImage`、`imagePinchCenter`、`imageTransformStyle` |

<span id="append-or-rewrite"></span>

### 追加还是替换

渲染器收到的 `code` 是代码块的 hast 文本，它的末尾总有一个 Markdown 源码里没有的换行。因此落在一行中间的 chunk 会把 `ab\n` 变成 `abc\n`，直接做前缀判断时，几乎每个 chunk 都会被当成替换。`extendsCode` 比较时不计这个换行：

```ts
import { extendsCode } from '@ai-markdown/core/components';

extendsCode('abc\n', 'ab\n'); // true：追加
'abc\n'.startsWith('ab\n'); // false
extendsCode('ax\n', 'ab\n'); // false：替换
```

渲染器在两次更新之间保留了工作成果（例如增量解析器或定时器）时，都应该用它来判断。自带的代码块已经用它决定 `resetKey`，只需要知道何时重新开始的渲染器观察 `resetKey` 即可。

<span id="a-code-block-of-your-own"></span>

### 自己写代码块

自带的代码块都建立在 `createCodeBlockSession` 之上。每个代码块一个会话，它把代码块的源码变成要显示的内容：交给高亮器的文本、语言，以及代码块被替换时会变化的代次。

```ts
import { createCodeBlockSession } from '@ai-markdown/core/components';

const session = createCodeBlockSession(() => rerender());

// 渲染时调用，服务端渲染也可以：
const input = {
  code, // 来自 extractCode(node)
  language, // 围栏语言，没有时为 ''
  streaming,
  autoDetect: true,
  formatJson: false,
  expandNestedJson: false,
  highlightIntervalMs: 50,
};
const { text, language: shownLanguage, generation } = session.read(input);

// 这次渲染显示之后：
session.commit(input);

// 卸载时：
session.dispose();
```

- `text` 是当前源码，有两种例外。文档流式输出期间，`highlightIntervalMs` 之内的多次追加共用一帧，所以 `text` 可能是较早的前缀；替换、语言变化和流式结束会立即显示当前源码。设置了 `formatJson` 且代码块完整时，JSON 会被格式化。
- `language` 是围栏语言；围栏没有语言且设置了 `autoDetect` 时是检测到的语言。较短的代码块在文本连续 300 毫秒没有变化后得到语言。
- 源码被替换、围栏语言变化，或可选的 `identity` 字段变化时，`generation` 加一；追加不改变它。它变化时应重置代码块自己的状态，例如“已复制”提示。
- 相同的输入 `read` 给出相同的结果，并且不记录任何东西，所以被丢弃的渲染没有影响。`commit` 记录源码，让语言探测器查看它，并启动计时器；提交或计时器改变结果时，传给 `createCodeBlockSession` 的回调会执行。从不调用 `commit` 的宿主总是读到当前源码。
- 复制时请使用原始的 `code`，不要用 `text`。

React 应用可以调用 `@ai-markdown/react/components/code/plain` 导出的 `useCodeBlock(input)`，它返回同样的三个字段，并负责提交和清理。组成会话的零件也单独导出，供只需要其中一项的宿主使用：`nextCodeFrame` 和 `createCodeFrame`（显示节流）、`createCodeLanguageTracker`（检测和静止计时）、`createJsonCompletenessScanner` 和 `prettyPrintJson`。

<span id="a-diagram-renderer"></span>

### 图表渲染器

`createDiagramController` 实现了 [React](#react) 一节描述的渲染策略：流式期间不报错，结束后做一次纠正渲染，下载重试次数有上限，输入不变时不重复渲染。宿主把输入的每次变化传给 `update`，并按收到的状态绘制。

```ts
import { createDiagramController } from '@ai-markdown/core/components';

const controller = createDiagramController(
  () => import('mermaid').then((module) => module.default),
  ({ view, loadFailed }) => {
    if (view.kind === 'diagram') {
      host.innerHTML = view.svg;
      view.bind?.(host);
    } else if (view.kind === 'error') {
      showError(view.message); // 纯文本
    } else {
      showSource(); // 还没有渲染出任何图表
    }
    showRetry(loadFailed || view.kind === 'error');
  }
);

controller.update({ code, dark, streaming, active, interval: 300 });
controller.retry(); // 由重试按钮调用
controller.dispose(); // 卸载时调用
```

`view.svg` 是 Mermaid 在 `strict` 或 `sandbox` 安全级别下的输出，应作为 HTML 插入。`view.message` 是文本，应作为文本节点插入。`active: false` 表示宿主正在显示别的内容，期间不进行渲染尝试。下载重试用尽后 `loadFailed` 为 true，`retry()` 会以新的重试次数重新开始。

<span id="calling-mermaid-yourself"></span>

### 自己调用 Mermaid

Mermaid 只有一份全局配置和一个全局渲染器。如果页面在这些组件之外也渲染 Mermaid，请把那部分工作放进同一个队列，否则它的 `initialize` 可能在我们的初始化和渲染之间改掉主题：

```ts
import mermaid from 'mermaid';
import { ensureMermaidInitialized, getMermaidMaxTextSize, mermaidRenderQueue } from '@ai-markdown/core/components';

const owner = {}; // 每个图表实例一个
await mermaidRenderQueue.enqueue(owner, async () => {
  ensureMermaidInitialized(mermaid, dark);
  if (code.length > getMermaidMaxTextSize(mermaid)) throw new Error('Diagram source is too large.');
  const { svg } = await mermaid.render(id, code);
  draw(svg);
});
// 卸载时：
mermaidRenderQueue.cancel(owner);
```

- 队列一次只运行一个任务，每个 owner 最多保留一个等待中的任务。同一个 owner 再次入队会替换等待中的任务，被替换的那次调用不执行任务，直接完成。
- `ensureMermaidInitialized` 保留应用传给 `mermaid.initialize` 的配置，把 `loose`、`antiscript` 或未设置的 `securityLevel` 提升为 `strict`，不改动 `sandbox`，并且只在应用没有选择主题时跟随明暗配色。没有需要修改的配置项时它什么也不做。
- `getMermaidMaxTextSize` 返回实际生效的 `maxTextSize`。渲染前请先检查：超过上限时 `mermaid.render` 会返回一张占位图，不会抛出错误。
- 队列属于一份 `@ai-markdown/core`。只有打包器把组件和应用解析到同一份 core 时，它才能让两边的工作串行执行。

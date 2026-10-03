# 代码块、图表、图片与表格

这些新增入口目前可在仓库构建中使用，将随下一次版本发布提供；已发布的 3.2.2 包尚未包含它们。

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

渲染器接收 `code`、`language`、文档级 `streaming`、`colorScheme`、`active` 和不透明的 `resetKey`。追加源码保留组件实例，替换源码会切换代次。自定义异步渲染器需要在停用、代次变化和卸载时取消或使旧任务失效；组件渲染异常会回退源码，但自行启动的 Promise 仍需自行处理错误。两个业务文档内容完全相同时，请用不同的 Markdown key 重建生命周期。React 还会读取文档上下文；Vue 应用替换文档时建议按文档身份设置 key。

中性组件默认配置为 `defaultExpanded: true`、`autoDetectUnknownLanguage: true`、`highlightIntervalMs: 50`、`mermaidIntervalMs: 300`、`formatJson: false`、`expandNestedJson: false`。React 的优先级是工厂显式选项、既有 `codeBlock` behavior group、默认值；group 传输仍按整组替换。Vue 通过工厂配置，`colorScheme` 接受 `'light'`、`'dark'` 或响应式 getter。仅修改 CSS 不会自动改变 Mermaid 图表主题。

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

默认将最近 Markdown 排版根节点内已加载、可预览的图片组成画廊，顺序与页面一致。加载中、加载失败和链接中的图片不会加入；不同 Markdown 根节点互不混组。预览支持上/下一张、左右方向键、缩放、旋转和翻转。选中图片被移除时关闭预览，Esc 关闭后焦点回到最初打开预览的图片。

`group: false` 可关闭分组；`group: '[data-photo-album]'` 可指定业务容器作为分组边界。自定义排版根节点可添加 `data-aimd-image-scope` 来启用自动分组；找不到分组容器时按单图处理。`preview: false` 仅关闭预览，保留加载/错误反馈。

可选默认样式提供 `.aimd-image`、`.aimd-image-cover`、`.aimd-image-feedback`、`.aimd-image-icon`，水合后的缩略图状态由 `data-status="loading|ready|error"` 标记，可直接覆盖样式。

工具栏也支持通过 `icons` 配置图标或组件：`close`、`prev`、`next`、`flipX`、`flipY`、`rotateLeft`、`rotateRight`、`zoomIn`、`zoomOut`。导入组件样式即可使用全屏预览布局；自行提供样式时需覆盖 `.aimd-image-preview-*`。

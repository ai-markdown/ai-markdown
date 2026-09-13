# Vue 快速开始

使用 Vue `^3.5.0`。服务端与构建环境需要 Node `^20.19.0 || >=22.12.0`。Vue 3.5 提供了用于服务端与水合标识对齐的 `useId()` API。

## 安装

```bash
pnpm add @ai-markdown/vue vue@^3.5.0 katex
```

## 渲染 Markdown

```vue
<script setup lang="ts">
import { ref } from 'vue';
import AIMarkdown from '@ai-markdown/vue';
import '@ai-markdown/vue/styles.css';
import 'katex/dist/katex.min.css';

const content = ref('# Answer\n\n**Markdown**, $x^2$ and 中文.');
</script>

<template>
  <AIMarkdown :content="content" />
</template>
```

将累积的完整字符串作为 `content` 传入。由应用负责数据分帧、请求取消与重试。基础样式文件提供代码块、表格样式和光标动画；KaTeX CSS 需单独引入。

Vue 适配器使用 `components` 选项和具名元素插槽进行定制。它不提供 React 上下文 Hooks、`blockMemo` 属性、React 排版变体或 Mantine 集成。Nuxt 特定的打包方式以及与 KeepAlive / Suspense 的组合需要单独的集成支持。

## 下一步

[流式渲染](vue-streaming.md)、[自定义渲染](vue-customization.md)、[服务端渲染与生命周期](vue-ssr.md)，或查看 [Vue 参考](../reference/vue.md)。

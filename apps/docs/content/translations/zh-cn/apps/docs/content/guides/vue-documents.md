# Vue 文档与引用

当一份文档需要由多个独立渲染器展示时，使用 Vue 的 `AIMarkdownDocuments`，并给各部分传入相同的显式 `document-id`。网络分块通常只需累积成一个字符串，不能直接当作文档分段；先阅读[文档与引用](documents-and-references.md)。

## 在章节间共享定义

```vue
<script setup lang="ts">
import { ref } from 'vue';
import AIMarkdown, { AIMarkdownDocuments } from '@ai-markdown/vue';
import '@ai-markdown/vue/styles.css';

const sections = ref([
  { id: 'claim', content: 'A claim[^source] and [site][url].' },
  { id: 'sources', content: '[^source]: Shared citation\n\n[url]: https://example.com' },
]);
</script>

<template>
  <AIMarkdownDocuments>
    <AIMarkdown
      v-for="(section, index) in sections"
      :key="section.id"
      :content="section.content"
      document-id="answer-1"
      :document-index="index"
    />
  </AIMarkdownDocuments>
</template>
```

## 文档身份与贡献

每个组件仍解析自己的字符串，容器不会拼接被截断的代码围栏、公式或表格。同一容器内，相同的显式 ID 用于共享引用；另一个容器即使用了相同 ID，也属于独立文档。

`key` 应跟随章节身份，`documentIndex` 表示章节当前位置。更新或删除 `sections` 中的条目，会相应更新共享定义。引用可以先于定义出现；片段挂载并提交后，注册表提供链接目标、全局脚注编号和出现序号。切换 `documentId` 会释放旧注册，卸载会释放贡献与订阅。不要原地修改注册表内部对象。

## Vue 特有行为

Vue 不暴露 React 的 `blockMemo`，协调并不依赖该属性。`preserveOrphanReferences` 默认 false，由每个渲染器单独决定；Vue 文档容器没有 React 那组孤立引用策略属性。

## 让章节依次显示

在同一容器内为每个章节使用 `AIMarkdownSmoothStream`，并传入相同的显式文档 ID。`coordinate` 默认为 `true`，也可以通过 `useDocumentSmoothStream` 接入自定义包装器。

- 空内容挂载的章节需要等前面的章节停止生成并显示完毕。
- 已有内容的章节挂载时直接显示已有文本。
- 显示顺序由注册顺序决定；`documentIndex` 只调整引用顺序，不调整显示轮次。
- 同一次注册完成后不会重新排队。需要开始全新队列时，应使用新的组件身份。
- `:coordinate="false"` 关闭轮流呈现，但保留基础渲染器的文档引用身份。

用 `waiting` 插槽显示等待状态，`cursor` 插槽提供当前章节的光标。节奏预设和自定义组合式函数见 [Vue 流式指南](vue-streaming.md)。

## SSR 与验证

SSR 和首次水合只使用本地内容与脚注，不发布跨片段贡献；共享定义在挂载提交后才可见。如果纯服务端输出就需要解析全部引用，请用一个组件渲染完整文档。测试应覆盖晚到定义、定义替换、文档切换、实例隔离和卸载，不能用引擎解析测试代替 Vue 生命周期测试。

继续阅读 [Vue SSR](vue-ssr.md)与[文档概念](documents-and-references.md)。

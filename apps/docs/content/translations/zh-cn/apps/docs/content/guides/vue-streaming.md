# Vue 流式渲染

使用响应式状态保存完整 Markdown 源文本和生产端状态。先完成 [Vue 接入](getting-started.md#vue-35)，传输术语和取消语义见[流式输入](streaming-input.md)。普通更新传入完整的 `content`；需要平滑动画时使用 `AIMarkdownSmoothStream`。

## 基础流式更新

```vue
<script setup lang="ts">
import { ref } from 'vue';
import AIMarkdown from '@ai-markdown/vue';
import '@ai-markdown/vue/styles.css';

const content = ref('');
const streaming = ref(false);

function start() {
  content.value = '';
  streaming.value = true;
}

function append(decodedText: string) {
  if (streaming.value) content.value += decodedText;
}

function finish() {
  streaming.value = false;
}

// Connect these functions to your transport's start, decoded-text and finish events.
// Abort that transport as well when cancelling; finish() only updates renderer state.
</script>

<template>
  <AIMarkdown :content="content" :streaming="streaming" />
</template>
```

`streaming` 控制忙碌状态和光标呈现，不是增量解析开关；客户端的 `incrementalParse` 默认已为 `true`。渲染数学时，还需按接入指南导入 KaTeX 样式。

## 启用平滑呈现

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { AIMarkdownSmoothStream } from '@ai-markdown/vue';
import '@ai-markdown/vue/styles.css';

const content = ref('');
const streaming = ref(true);
// Append decoded text to content.value; set streaming.value = false when finished.
</script>

<template>
  <AIMarkdownSmoothStream :content="content" :streaming="streaming" pacing="balanced" />
</template>
```

`pacing` 接受 `smooth`、`balanced`（组件默认值）或 `responsive`。初始内容直接显示，包括 SSR 与重新挂载；后续追加可以逐步显示，替换则直接切换到新内容。生产端结束后可能仍有积压文本；显示状态的 `streaming` 在积压排空后才结束。

通过组件模板 ref 可调用 `flush()`。生产端仍活跃时，它保留最后一个尚未确认的字素；调用它不代表生产端结束。

<span id="build-a-custom-wrapper-with-a-live-getter"></span>

## 自定义包装器

在 setup 中调用 `useSmoothStream`，传入返回最新配置值的 getter。应用 ref 应在 getter 内读取 `.value`，不要捕获初始化对象。返回的 content 和 streaming 是只读 computed ref，渲染函数使用 `.value`，模板可解包顶层 ref。

`useDocumentSmoothStream` 额外接收 `documentId` 和可选的 `coordinate`，并返回 computed ref `pending`。它在 `AIMarkdownDocuments` 范围内按文档排队；不需要排队时设 `coordinate: false`。

```vue
<script setup lang="ts">
import { ref } from 'vue';
import AIMarkdown, { useSmoothStream } from '@ai-markdown/vue';
import '@ai-markdown/vue/styles.css';

const source = ref('');
const producing = ref(true);
const { content, streaming, flush } = useSmoothStream(() => ({
  content: source.value,
  streaming: producing.value,
  pacing: 'responsive',
}));
</script>

<template>
  <AIMarkdown :content="content" :streaming="streaming" />
  <button type="button" @click="flush">Reveal available text</button>
</template>
```

## 结束、替换与卸载

`flush()` 显示当前可释放的内容，但活跃流最后一个未确认字素仍可能保留；它不会中止传输。初始内容与 SSR 不从空字符串回放。替换源文本会直接切换内容；卸载释放控制器、观察和协调成员关系。文档身份或协调资格变化会释放旧订阅。

组合式函数应在组件 setup 调用，控制器及观察器在挂载后创建。组件本身不发出完成事件；若需要监听呈现结束，使用自定义包装器观察返回状态。详见 [Vue 参考](../reference/vue.md)。

## 定制光标

Vue 在流式状态下默认启用光标。使用 `:streaming-cursor="false"` 关闭，或通过 `cursor` 插槽定制。默认动画遵循减少动态效果的系统偏好。代码、数学、图片等不支持的尾部会隐藏测量光标，不会将它放到前面的段落上。

`waiting` 插槽用于文档轮流呈现：只有位于 `AIMarkdownDocuments` 内、且前面的平滑参与者尚未完成时才显示。独立平滑组件不会等待其他消息。

参阅 [Vue 示例](storybook:vue/)、[文档协调](vue-documents.md)和[完整 API 参考](../reference/vue.md#smooth-streaming-and-turn-taking)。

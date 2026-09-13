# Vue 流式渲染

普通流式更新只需要改变完整的 `content`，并用 `streaming` 表示生产端状态。需要平滑动画时，使用 `AIMarkdownSmoothStream`。

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

初始内容直接显示，后续确认的追加按字素簇呈现。生产端结束后仍可能有积压文本；返回的 streaming 状态在呈现排空后才结束。光标默认开启，等待第一个字符时应用可显示自己的占位。

<span id="build-a-custom-wrapper-with-a-live-getter"></span>

## 自定义包装器

在 setup 中调用 `useSmoothStream`，传入返回最新配置值的 getter。应用 ref 应在 getter 内读取 `.value`，不要捕获初始化对象。返回的 content 和 streaming 是只读 computed ref，渲染函数使用 `.value`，模板可解包顶层 ref。

`useDocumentSmoothStream` 额外接收 documentId 和 coordinate，并返回 pending。它在 `AIMarkdownDocuments` 范围内按文档排队；不需要排队时设 `coordinate: false`。

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

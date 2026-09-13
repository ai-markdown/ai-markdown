# Vue 自定义渲染与样式定制

控制视觉外观优先使用 CSS，构建可复用的 Vue 渲染器使用 `components` 映射，局部覆盖特定标签则使用具名元素插槽。这些机制属于 Vue 原生体系；React 的 `customComponents`、排版变体（typography variants）与上下文 Hooks 属于不同的接口契约。

<span id="start-with-the-wrapper"></span>

## 从外层容器开始

导入 `@ai-markdown/vue/styles.css` 可以获得基础表格/代码块布局以及光标动画。直接在 `AIMarkdown` 上设置 `class` 或 `style` 可以控制根容器的样式，这些属性会自动透传到外层容器。该外层容器为光标建立了相对定位（relative positioning）上下文；改变其 `position` 属性可能会影响光标几何测量与定位计算。

当应用程序自身已具备完整视觉样式规范时，该基础样式表为可选引入。KaTeX 的样式表需要独立引入。React 的 `--aim-*` 设计变量变量体系并非 Vue 的样式 API。

<span id="map-an-element-to-a-vue-component"></span>

## 将 HTML 元素映射到 Vue 组件

以下完整的渲染函数示例演示了如何替换链接元素，同时保留转换后的子节点：

```ts
import { defineComponent, h } from 'vue';
import AIMarkdown from '@ai-markdown/vue';

const AppLink = defineComponent({
  inheritAttrs: false,
  props: ['node', 'streaming', 'metadata'],
  setup(_props, { attrs, slots }) {
    return () => h('a', { ...attrs, class: 'answer-link' }, slots.default?.());
  },
});

const components = { a: AppLink };

export default defineComponent({
  setup() {
    return () => h(AIMarkdown, { content: '[Read more](https://example.com)', components });
  },
});
```

被映射的组件会接收清洗后的标准 HTML 属性，外加 `node`、`streaming` 和 `metadata`。请显式声明你所使用的上下文 props，避免它们作为未声明的透传属性意外掉落到最终生成的 DOM 元素上。默认插槽（default slot）包含了已完成转换的 Vue 子节点；请谨慎且有目的地透传相关属性。

<span id="override-an-element-with-a-scoped-slot"></span>

## 使用作用域插槽覆盖元素

对于包含任意 VNode 子节点的情况，使用渲染函数插槽可以避免将子 VNode 误当作模板字符串拼接：

```ts
import { defineComponent, h } from 'vue';
import AIMarkdown, { type MarkdownElementContext } from '@ai-markdown/vue';

export default defineComponent({
  setup() {
    return () =>
      h(
        AIMarkdown,
        { content: '**Hello**', metadata: 'Answer preview' },
        {
          strong: ({ children, metadata }: MarkdownElementContext) =>
            h('strong', { title: String(metadata ?? '') }, children),
        }
      );
  },
});
```

同名的元素插槽优先级高于 `components` 映射配置中的对应条目。`metadata` 是由应用程序掌控并直接透传给映射组件和元素插槽的数据；它不是从 Markdown 文本内容中解析出来的。

<span id="keep-output-policy-explicit"></span>

## 保持明确的输出策略

Markdown 文本不会被当作 Vue 模板进行二次解析编译。即使开发者放宽了 HTML 清洗规则，适配器也会主动拒绝事件监听属性（如 `onClick`）和底层 DOM 插入属性。自定义组件和插槽均被视为受信任的应用程序代码，因此其自身的渲染输出安全性完全由组件实现方负责。

关于共享清洗器与最终 URL 校验策略的详细说明，请参阅 [URL 清洗规范](url-sanitization.md)；关于 Vue 全部配置项接口，请参阅 [Vue Props 参考](../reference/vue.md#component-props)。在使用过程中请保持清洗规则 schema 与配置映射对象不可变（immutable）；当配置含义发生变更时，应通过替换整个新对象来进行更新。

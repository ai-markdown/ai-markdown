# Vue custom rendering and styling

Use CSS for presentation, `components` for reusable Vue renderers, and named element slots for local overrides. These APIs belong to Vue; React's `customComponents`, typography variants and context hooks are different contracts.

## Start with the wrapper

Import `@ai-markdown/vue/styles.css` for base table/code layout and cursor animation. Set `class` or `style` on `AIMarkdown` to style the root wrapper. These attributes fall through. The wrapper establishes relative positioning for the cursor; changing its `position` can change cursor geometry.

The base stylesheet is optional when your application supplies presentation. KaTeX's stylesheet is separate. React's `--aim-*` token reference is not a Vue styling API.

## Map an element to a Vue component

This complete render-function example replaces links while preserving the converted children:

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

Mapped components receive sanitized attributes. The context values `node`, `streaming` and `metadata` are opt-in: the renderer passes each one only to a component that declares it as a prop, so an undeclared context value never falls through to the DOM as an attribute. The default slot contains converted Vue children; forward attributes deliberately.

## Override an element with a scoped slot

For arbitrary VNode children, a render-function slot avoids treating child VNodes as template strings:

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

An element slot takes precedence over the matching `components` entry. `metadata` is application-owned data passed through to mapped components and element slots; it is not parsed from Markdown.

## Keep output policy explicit

Markdown is not interpreted as a Vue template. The adapter rejects event attributes and DOM insertion properties even if a broadened sanitizer admits them. Custom components and slots are trusted application code, so their own output remains their responsibility.

Use [URL sanitization](url-sanitization.md) for the shared sanitizer and final URL policy, and the [Vue props reference](../reference/vue.md#component-props) for the Vue configuration surface. Keep schemas and configuration maps immutable while in use; replace them when their meaning changes.

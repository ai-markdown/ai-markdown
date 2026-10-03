# React custom components

React uses `customComponents` and React children. Vue uses `components` or named element slots with `MarkdownElementContext`. See the [Vue guide](../reference/vue.md#custom-vue-components-and-slots) and [package setup](getting-started.md).

`customComponents` lets you replace the React renderer for an HTML element produced by the Markdown pipeline. Use it for links, images, tables, headings, task controls, and code blocks that need application behavior. The parser still owns Markdown syntax; your component receives the resulting element's attributes, React children, and an optional hast `node`.

```tsx
import AIMarkdown, { type AIMarkdownCustomComponents } from '@ai-markdown/react';

const COMPONENTS = {
  a: ({ node, children, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
} satisfies AIMarkdownCustomComponents;

<AIMarkdown content="Read [the guide](/guide)." customComponents={COMPONENTS} />;
```

This first example opens every link in a new tab. The external-link recipe below makes that policy conditional. In either case, destructure `node` before forwarding DOM props: it is syntax-tree metadata, not an HTML attribute. Preserve attributes such as `id`, `title`, and `data-footnote-ref` when your replacement should retain ordinary link behavior.

The type aliases the local, vendored Markdown wrapper's `Components` type. Typical keys include `a`, `img`, `p`, `pre`, `code`, `blockquote`, `h1`–`h6`, lists, and table elements. GFM adds `del` and task-list `input`; optional syntax adds `mark`, `dl`, `dt`, and `dd`. Generated KaTeX markup also passes through element rendering, so a broad `span` override must tolerate math output.

A custom renderer runs after the normal HTML and URL policy. URLs you introduce yourself inside that renderer do not travel back through the pipeline. Keep application-generated destinations under your own policy; see [URL sanitization](url-sanitization.md).

## Recipes

### Lazy-load images

```tsx
const components: AIMarkdownCustomComponents = {
  img: ({ src, alt, title }) => <img src={src} alt={alt ?? ''} title={title} loading="lazy" decoding="async" />,
};
```

The `alt` prop can be undefined for unlabeled images — coerce to `''` for accessibility.

### Open external links in a new tab, keep internal links in-tab

For a site that uses relative paths for internal navigation, an HTTP(S) check is a useful small policy. It classifies absolute HTTP(S) links as external, including same-origin absolute links. If your content uses those for internal navigation, compare against an application-configured origin as well.

```tsx
const COMPONENTS = {
  a: ({ node, href, children, ...props }) => {
    const external = /^https?:\/\//i.test(href ?? '');
    return (
      <a {...props} href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {children}
      </a>
    );
  },
} satisfies AIMarkdownCustomComponents;
```

Fragment links stay in the current tab. Forwarding the remaining attributes preserves footnote IDs and accessibility metadata. Router-specific components can use the same decision, provided their props accept the attributes you forward.

### Wrap tables for horizontal scroll on mobile

```tsx
const components: AIMarkdownCustomComponents = {
  table: ({ children }) => (
    <div className="table-scroll-wrapper">
      <table>{children}</table>
    </div>
  ),
};
```

### Render task-list checkboxes as toggleable controls

GFM checkboxes arrive with `disabled` set. Merely changing `checked` to `defaultChecked` leaves them disabled if the rest of the props still includes that attribute. Remove it explicitly, keep local state, and synchronize that state when the Markdown's checked value changes:

```tsx
import { useEffect, useState } from 'react';

type TaskInputProps = React.ComponentPropsWithoutRef<'input'>;

function TaskInput({ checked, disabled, type, ...props }: TaskInputProps) {
  const [selected, setSelected] = useState(Boolean(checked));
  useEffect(() => setSelected(Boolean(checked)), [checked]);
  if (type !== 'checkbox') return <input {...props} type={type} disabled={disabled} />;
  return (
    <input
      {...props}
      type="checkbox"
      checked={selected}
      onChange={(event) => setSelected(event.currentTarget.checked)}
      aria-label={props['aria-label'] ?? 'Markdown task'}
    />
  );
}

const COMPONENTS = {
  input: ({ node, ...props }) => <TaskInput {...props} />,
} satisfies AIMarkdownCustomComponents;
```

This changes the displayed control only; it does not edit `content`. Persist changes through an application callback carried by [metadata](metadata-context.md), with a stable task identifier and an accessible name derived from your data. A source offset can locate a task within one parsed revision, but it is not a durable ID across source edits or preprocessing.

### Custom code block with copy button (React, no Mantine)

A `pre` renderer usually receives a React `<code>` element as its child. `String(children)` therefore produces an object description rather than the code text, and putting those children inside another `<code>` creates nested code elements. Read the textual hast child and preserve the original React children for display:

```tsx
import { useRef, useState } from 'react';
import { useAIMarkdownState, type AIMarkdownCustomComponents } from '@ai-markdown/react';

type PreRenderer = NonNullable<AIMarkdownCustomComponents['pre']>;

const CopyablePre: PreRenderer = ({ node, children, ...props }) => {
  const { streaming } = useAIMarkdownState();
  const preRef = useRef<HTMLPreElement>(null);
  const [feedback, setFeedback] = useState('');
  const code = node?.children.length === 1 ? node.children[0] : undefined;
  const source =
    code?.type === 'element' && code.tagName === 'code' && code.children.every((child) => child.type === 'text')
      ? code.children.map((child) => (child.type === 'text' ? child.value : '')).join('')
      : undefined;

  async function copy() {
    try {
      await navigator.clipboard.writeText(source ?? preRef.current?.textContent ?? '');
      setFeedback('Copied');
    } catch {
      setFeedback('Copy failed; select and copy the code manually.');
    }
  }

  return (
    <div className="code-block">
      <button type="button" onClick={copy} disabled={streaming}>
        Copy code
      </button>
      <span role="status">{feedback}</span>
      <pre {...props} ref={preRef}>
        {children}
      </pre>
    </div>
  );
};

const COMPONENTS = { pre: CopyablePre } satisfies AIMarkdownCustomComponents;
```

The toolbar sits outside `<pre>`, so whitespace rules do not format the button as source text and the fallback copy does not include toolbar labels. The extracted value retains the parser's trailing newline. Avoid `trim()` or `trimEnd()` unless removing whitespace is an explicit product choice. This copies parsed code text; if you need byte-for-byte source-file slices, preserve the original input and its preprocessing map separately.

`streaming` disables copying in this recipe. That is an application decision: another UI may allow copying partial code. Clipboard access can fail, so the example reports failure instead of silently claiming success.

### Add anchor links to headings

```tsx
const components: AIMarkdownCustomComponents = {
  h2: ({ children, id }) => (
    <h2 id={id}>
      {id && (
        <a href={`#${id}`} className="heading-anchor">
          #
        </a>
      )}
      {children}
    </h2>
  ),
};
```

This renderer preserves an existing `id`; it does not create one. The shipped pipeline does not include a heading-slug plugin, so ordinary Markdown headings have no automatic slug. IDs admitted from source HTML are namespaced by `documentId` — see [Architecture](architecture.md#documentid-and-clobber-prefix) for how multi-document pages avoid id collisions.

---

## Reference stability matters

`customComponents` participates in the block-memo cache. The library internally stabilizes it via deep-equal (`useStableValue`), so an inline object will be tolerated — but the deep compare on every render isn't free. The recommended pattern is module scope or `useMemo`:

```tsx
// ⚠️ Re-created every render — internal deep-equal catches it, but pays a deep-compare cost.
<AIMarkdown content={c} customComponents={{ a: MyLink }} />;

// ✅ Stable identity, zero overhead.
const COMPONENTS = { a: MyLink } satisfies AIMarkdownCustomComponents;
<AIMarkdown content={c} customComponents={COMPONENTS} />;
```

The component functions themselves should also be stable. A `function MyLink() {…}` declaration or a `const MyLink = (props) => …` at module scope is fine. Defining the function inside the parent's render body recreates it every frame:

```tsx
// ⚠️ New MyLink reference every render.
function Parent({ content }) {
  const MyLink = (props) => <a {...props} target="_blank" />;
  return <AIMarkdown content={content} customComponents={{ a: MyLink }} />;
}
```

---

## Interaction with Mantine defaults

`@ai-markdown/react-mantine` ships its own `customComponents.pre` that powers code highlighting, Mermaid, and JSON pretty-print. Caller-provided components are **merged on top** of the Mantine defaults — your overrides take precedence:

```tsx
// Mantine handles <pre>, you handle <a>:
<MantineAIMarkdown content={c} customComponents={{ a: MyLink }} />

// Mantine still handles <pre> — your <a> override doesn't affect it.
```

If you supply `pre` yourself, you fully replace Mantine's code-block pipeline:

```tsx
// ⚠️ Disables Mantine's CodeHighlight, Mermaid, JSON pretty-print.
<MantineAIMarkdown content={c} customComponents={{ pre: MyPlainPre }} />
```

That's sometimes what you want (you have your own highlighter) — just be aware of the consequence.

The reverse holds too: because Mantine's `pre` renders the fenced block through its own `CodeHighlight` / Mermaid / JSON pipeline, it does **not** mount the `code` element inside — so a `customComponents.code` override only reaches **inline** code (`` `like this` ``), never fenced blocks. To customize fenced-block rendering under `@ai-markdown/react-mantine`, override `pre` (and take over highlighting), or use the `codeBlock` group prop (`defaultExpanded`, `autoDetectUnknownLanguage`) documented in the package README.

---

## Accessing the underlying mdast/hast node

The optional `node` prop is a hast Element, not an mdast Markdown node. It describes the HTML-side element supplied to this renderer. Use this when you need information beyond the standard HTML attributes. Always optional-chain — `node` can be `undefined` for synthetic elements (e.g. nodes emitted by a custom remark plugin without position info, or library-internal placeholder elements), and `node.position` is itself optional even when `node` is present.

```tsx
const components: AIMarkdownCustomComponents = {
  code: ({ node, className, children }) => {
    const language = className?.replace('language-', '');
    const sourceOffset = node?.position?.start?.offset;
    // …use language and sourceOffset for analytics, syntax highlighting, etc.
    return <code className={className}>{children}</code>;
  },
};
```

`node.position` tracks the location in the preprocessed Markdown passed to the parser — useful for selective behaviors (e.g. "only show the line number for code blocks in the first 100 chars of the document").

### Generating ids that share the document namespace

The library namespaces every clobberable attribute (`id="…"` / `href="#…"`) with a per-document prefix so footnote anchors and hash hrefs don't collide across `<AIMarkdown>` instances. If your custom component emits its own ids — e.g. anchor links on headings — you should use the same prefix instead of inventing one. Read `clobberPrefix` from the document context:

```tsx
import { useAIMarkdownDocument } from '@ai-markdown/react';

import { Children, isValidElement, type ReactNode } from 'react';

function textOf(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child);
      return isValidElement<{ children?: ReactNode }>(child) ? textOf(child.props.children) : '';
    })
    .join('');
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const components: AIMarkdownCustomComponents = {
  h2: ({ children }) => {
    const { clobberPrefix } = useAIMarkdownDocument();
    const text = textOf(children);
    const id = `${clobberPrefix}heading-${slugify(text) || 'section'}`;
    return (
      <h2 id={id}>
        <a href={`#${id}`} className="heading-anchor">
          #
        </a>
        {children}
      </h2>
    );
  },
};
```

The exact byte form of `clobberPrefix` (long ids get MurmurHash3-shortened to keep HTML compact) is not part of the stability contract — always read it from `useAIMarkdownDocument()`, never recompute from `documentId`.

---

## Footguns

### Call Hooks before conditional returns

Custom components are called by `react-markdown` per node. They can use Hooks like any React component — but every code path must reach the same number of Hook calls in the same order. The usual rules-of-Hooks apply:

```tsx
// ⚠️ Calling a Hook conditionally breaks rules-of-Hooks.
const components: AIMarkdownCustomComponents = {
  a: ({ href }) => {
    if (!href) return null;
    const { colorScheme } = useAIMarkdownTheme(); // Hook after conditional return
    return <a href={href}>{colorScheme}</a>;
  },
};

// ✅ Hooks first, conditional later.
const components: AIMarkdownCustomComponents = {
  a: ({ href }) => {
    const { colorScheme } = useAIMarkdownTheme();
    if (!href) return null;
    return <a href={href}>{colorScheme}</a>;
  },
};
```

### Don't mutate `node.properties` from a custom component

`node` is shared across renders when block-memoization caches a block. Mutating it (`node.properties.className = …`) bleeds into future renders that hit the cache, causing intermittent visual bugs. Treat `node` as read-only.

### Heavy work in render → measure first

Custom components render when React needs to update them, including changed block inputs, state, or context. If a component does expensive work (syntax highlighting, code formatting, large regex), memoize the work by the input(s) that actually drive it:

```tsx
import { useMemo } from 'react';

const components: AIMarkdownCustomComponents = {
  code: ({ node, children, ...props }) => {
    const text = node?.children.every((child) => child.type === 'text')
      ? node.children.map((child) => (child.type === 'text' ? child.value : '')).join('')
      : null;
    const highlighted = useMemo(() => (text === null ? null : expensiveHighlight(text)), [text]);
    return highlighted === null ? (
      <code {...props}>{children}</code>
    ) : (
      <code {...props} dangerouslySetInnerHTML={{ __html: highlighted }} />
    );
  },
};
```

`expensiveHighlight` stands for a trusted highlighter that escapes source text in its HTML output. HTML introduced by a custom component is outside the Markdown sanitizer; do not pass raw code directly to `dangerouslySetInnerHTML`. The fallback preserves non-text code children instead of flattening their markup.

Block memoization reuses the React element subtree for a cache hit. A custom component can still re-render because of its own state or a context subscription; caching the element does not freeze its Hooks or descendants. Per-component `useMemo` matters mainly when the block _does_ change but the expensive sub-computation should be reused (e.g. content changed but the code language didn't).

## Heading identity and component verification

The slug example demonstrates namespace composition only. Two headings with the same text still produce the same ID; non-Latin text also needs a slug policy that retains Unicode or a stable ID supplied by your application. Do not increment a module-global counter during render: concurrent or abandoned renders can consume numbers without committing a heading. For durable deep links, assign IDs from persistent document data.

When checking a replacement, include the constructs whose attributes it may receive: an ordinary link, a hash link, a repeated footnote reference, a fenced block, inline code, and raw `<pre>` HTML. Check that the original text survives, that controls can be operated by keyboard, and that changing metadata updates the callback without requiring a new component function.

Source pointers: [`markdown/Markdown.tsx`](../../../../packages/react/src/components/markdown/Markdown.tsx) owns JSX conversion; [`crossChunkPlaceholders.tsx`](../../../../packages/react/src/components/crossChunkPlaceholders.tsx) adapts coordinated references to the same component map; [`PreCode.tsx`](../../../../packages/react-mantine/src/components/customized/PreCode.tsx) demonstrates guarded extraction of code blocks.

# React TypeScript generics

These metadata generics and definition factories belong to `@ai-markdown/react`. Vue exposes `AIMarkdownProps`, `MarkdownComponents` and a `MarkdownElementContext` whose metadata is `unknown`. See the [Vue guide](../reference/vue.md#api-and-distribution) and [package setup](getting-started.md).

The React adapter has one component generic: `TMetadata`. It describes the value supplied through `metadata`, while ordinary props describe theme, lifecycle, pipeline choices, and rendering slots. There is no configuration generic in v2.

```ts
function AIMarkdown<TMetadata extends AIMarkdownMetadata = AIMarkdownMetadata>(
  props: AIMarkdownProps<TMetadata>
): ReactElement;
```

`AIMarkdownMetadata` extends `Record<string, any>` and imposes no required application fields. A normal interface such as `{ messageId: string }` can be used directly. The component can infer that interface from `metadata`; an explicit type argument is useful when you want the object checked against a shared contract.

The consumer hook's type argument is separate. `useAIMarkdownMetadata<ChatMeta>()` tells TypeScript how to treat the nearest context value, but it cannot prove that the provider supplied that shape. Centralize this assertion in an application hook and keep its runtime absent-value handling explicit.

For v1 code, remove the first generic argument: `AIMarkdownProps<MyConfig, MyMeta>` becomes `AIMarkdownProps<MyMeta>`. Behavior extensions now use wrapper props and provider groups, as shown below and in the [migration guide](migrating-to-v2.md).

## Extending metadata

```tsx
import { useRef } from 'react';
import AIMarkdown, { useAIMarkdownMetadata, type AIMarkdownMetadata } from '@ai-markdown/react';

interface ChatMeta extends AIMarkdownMetadata {
  messageId: string;
  onCopyCode: (code: string) => void;
}

function MyCodeBlock({ children }: { children?: React.ReactNode }) {
  const pre = useRef<HTMLPreElement>(null);
  const meta = useAIMarkdownMetadata<ChatMeta>();
  //                                  ^^^^^^^^ caller-asserted
  return (
    <div>
      <button type="button" onClick={() => meta?.onCopyCode(pre.current?.textContent ?? '')}>
        Copy
      </button>
      <pre ref={pre}>{children}</pre>
    </div>
  );
}

function App({ msg, onCopy }: { msg: { id: string; content: string }; onCopy: (c: string) => void }) {
  return (
    <AIMarkdown<ChatMeta>
      content={msg.content}
      metadata={{ messageId: msg.id, onCopyCode: onCopy }}
      customComponents={{ pre: MyCodeBlock }}
    />
  );
}
```

TS will infer `ChatMeta` from `metadata`'s shape in most positions; explicit is safer for the reasons below.

> Metadata has no default fallback. If the provider passes no `metadata`, the hook returns `undefined` regardless of the asserted type. Always optional-chain.

---

## The assertion problem, and where it lives now

`useAIMarkdownMetadata<T>()` is a **caller assertion**, not a derived type. TypeScript can't verify that the `<AIMarkdown>` provider above was actually given a `ChatMeta`-shaped value — if you assert wrong, `meta.messageId` looks fine at compile time but evaluates to `undefined` at runtime.

The cure is the same **wrapper-hook pattern** as always: pin the assertion once, next to where the value is provided, and export a narrowed hook:

```ts
// my-app/markdown/meta.ts
import { useAIMarkdownMetadata } from '@ai-markdown/react';
import type { ChatMeta } from './types';

export const useChatMeta = () => useAIMarkdownMetadata<ChatMeta>();
```

Every custom component imports `useChatMeta()`; the assertion lives in one file.

For **behavior groups** — the v2 successor of the extended config — the same pattern is the _only_ channel, and it's baked into the API shape. `useAIMarkdownBehaviors()` is non-generic: it returns the three core switches plus an opaque extension record, and the single type assertion happens inside the wrapper's narrow hook. This is exactly what `@ai-markdown/react-mantine` ships for its `codeBlock` group:

```ts
// Equivalent narrow-hook pattern; use the package hook in application code.
export function useMantineCodeBlockOptions(): Required<MantineCodeBlockOptions> {
  const behaviors = useAIMarkdownBehaviors();
  // The single assertion: the `codeBlock` group key is owned by this
  // package, contributed by `MantineAIMarkdown` via its behaviors Provider.
  const group = behaviors.codeBlock as Partial<MantineCodeBlockOptions> | undefined;
  return useMemo(
    () => ({
      defaultExpanded: group?.defaultExpanded ?? true,
      autoDetectUnknownLanguage: group?.autoDetectUnknownLanguage ?? true,
      languageFormat:
        group?.languageFormat === MantineLanguageFormat.Shiki
          ? MantineLanguageFormat.Shiki
          : MantineLanguageFormat.HighlightJs,
      formatJson: group?.formatJson ?? true,
      expandNestedJson: group?.expandNestedJson ?? true,
      highlightIntervalMs:
        Number.isFinite(group?.highlightIntervalMs) && group!.highlightIntervalMs! >= 0
          ? group!.highlightIntervalMs!
          : 50,
      mermaidIntervalMs:
        Number.isFinite(group?.mermaidIntervalMs) && group!.mermaidIntervalMs! >= 0 ? group!.mermaidIntervalMs! : 300,
    }),
    [group]
  );
}
```

Group defaults are applied here too — the hook is the one place both the assertion and the defaults live. See [Extending via a Sub-package](extending-via-subpackage.md) for the full wrapper recipe.

---

## Available type imports

```ts
import type {
  // Component props
  AIMarkdownProps,
  AIMarkdownDocumentsProps,

  // Metadata
  AIMarkdownMetadata,

  // Context payloads (narrow-hook return shapes)
  AIMarkdownDocumentInfo,
  AIMarkdownThemeInfo,
  AIMarkdownStateCore,
  AIMarkdownBehaviorsCore,
  AIMarkdownStateGroups,
  AIMarkdownBehaviorGroups,
  AIMarkdownExtensionGroups,
  AIMarkdownAggregate,

  // Engine plugins (values live in '@ai-markdown/react/plugins')
  AIMarkdownEnginePlugin,
  AIMarkdownEnginePluginName,

  // define* factory fragments
  AIMarkdownThemeProps,
  AIMarkdownBehaviorProps,
  AIMarkdownPipelineProps,

  // Stability firewall (wrapper reuse)
  AIMarkdownStabilityTable,

  // Customization
  AIMarkdownCustomComponents,
  AIMarkdownTypographyProps,
  AIMarkdownTypographyComponent,
  AIMarkdownExtraStylesProps,
  AIMarkdownExtraStylesComponent,
  AIMarkdownVariant,
  AIMarkdownColorScheme,

  // Streaming cursor
  AIMarkdownStreamingCursorProps,
  AIMarkdownStreamingIndicatorProps,
  AIMarkdownStreamingIndicatorComponent,

  // Pipeline
  AIMDContentPreprocessor,

  // Sanitization
  UrlTransform, // tracks react-markdown
  SanitizeSchema, // tracks rehype-sanitize

  // Cross-chunk registry (read-only)
  Registry,
  ChunkData,
  FootnoteDef,
  LinkDef,
  RefRecord,
  RefKind,
} from '@ai-markdown/react';
```

Mantine package additionally exports:

```ts
import type {
  MantineAIMarkdownProps, // extends AIMarkdownProps<TMetadata> with `codeBlock`
  MantineAIMarkdownMetadata,
  MantineCodeBlockOptions,
  MantineBehaviorProps, // widened defineMantineBehaviors input
} from '@ai-markdown/react-mantine';

// A value export (an enum), also usable as the type of `codeBlock.languageFormat`:
import { MantineLanguageFormat } from '@ai-markdown/react-mantine';
```

---

## API stability of `UrlTransform` and `SanitizeSchema`

Both types are **aliases** that track their upstream package shapes:

- `UrlTransform` — follows `react-markdown`'s shape.
- `SanitizeSchema` — follows `rehype-sanitize`'s shape (specifically `typeof defaultSchema`).

These types **may change with the upstream packages' major versions**. The library re-exports them so consumers don't need a direct dependency on the upstream packages for type imports; the trade-off is that if `rehype-sanitize` ships a major bump that changes the schema shape, `SanitizeSchema` here changes in lockstep.

Build your sanitize schema via [`extendSanitizeSchema`](url-sanitization.md#sanitizeschema-gate-1-via-extendsanitizeschema) rather than hand-typing the schema literal — the helper insulates you from most upstream shape changes.

---

## Footguns

### Asserting a wider `TMetadata` than the provider supplies

```tsx
// Provider:
<AIMarkdown content={c} metadata={{ messageId: '1' }} />; // ← no onCopyCode

// Consumer:
const meta = useAIMarkdownMetadata<ChatMeta>();
meta?.onCopyCode; // undefined at runtime, but TS shows the function type
```

TS won't catch this. The wrapper-hook pattern doesn't make the assertion _safe_ — it makes the mismatch findable, because provider and assertion live next to each other in one file.

### Passing v1.x-style generic arguments

```tsx
<AIMarkdown<MyConfig, ChatMeta> … /> // ✗ compile error in v2 — one parameter only
<AIMarkdown<ChatMeta> … />           // ✓
```

Same for `MantineAIMarkdownProps<MyMantineConfig, MyMeta>` → `MantineAIMarkdownProps<MyMeta>`. If you're mid-migration, the [migration guide](migrating-to-v2.md#generic-signature-mapping-ts-users) has the full signature table (including the removed `PartialDeep` export).

### Scattering `as` assertions at read sites

If you find yourself writing `behaviors.myGroup as MyGroupOptions` in more than one file, you've skipped the narrow hook. Centralize: one hook, one assertion, defaults applied inside it (bare `??` fallbacks at multiple read sites will drift — see [Extending via a Sub-package](extending-via-subpackage.md#footguns)).

## Preserve inference in wrappers

A wrapper can extend `AIMarkdownProps<TMetadata>` and forward the metadata parameter unchanged. If you memoize a generic component, retain its callable signature when exposing it; otherwise consumers may lose the ability to supply an explicit metadata type argument.

```tsx
import { memo } from 'react';
import AIMarkdown, { type AIMarkdownMetadata, type AIMarkdownProps } from '@ai-markdown/react';

interface MessageMarkdownProps<T extends AIMarkdownMetadata> extends AIMarkdownProps<T> {
  compact?: boolean;
}

function MessageMarkdownImpl<T extends AIMarkdownMetadata = AIMarkdownMetadata>({
  compact,
  ...props
}: MessageMarkdownProps<T>) {
  return (
    <div data-compact={compact || undefined}>
      <AIMarkdown<T> {...props} />
    </div>
  );
}

export const MessageMarkdown = memo(MessageMarkdownImpl) as typeof MessageMarkdownImpl;
```

The final assertion restores the wrapper's own generic function signature. It does not validate metadata at runtime and should not be used to claim that unrelated props are compatible.

## Check fragments without widening away useful types

For a custom component map, use `satisfies AIMarkdownCustomComponents` to check element keys and props while keeping the object's inferred shape. For a callback, annotate `UrlTransform` instead of writing `node: unknown` and later passing it to `defaultUrlTransform`. The exported type includes the read-only hast element expected by that callback.

`defineTheme`, `defineBehaviors`, and `definePipeline` return the same object after shallow `Object.freeze`. They check the fragment's declared fields; they do not merge defaults, deep-freeze nested values, or validate a configuration read from JSON. Decode persisted settings at the application boundary and map plugin names to the exported catalog objects before passing them to the component.

Optional fields deserve particular care in group hooks. `{ ...defaults, ...group }` allows an explicitly supplied `undefined` to overwrite a default. Resolve supported fields individually or skip undefined entries, as the Mantine hook does. A return type of `Required<Group>` must describe the value actually returned.

## Other typed streaming surfaces

The React adapter also exports `AIMarkdownSmoothStreamProps<TMetadata>`, `UseSmoothStreamOptions`, `UseSmoothStreamResult`, and `UseDocumentSmoothStreamOptions`. The smooth shell preserves the same metadata generic; the hooks operate on strings and lifecycle state and do not need one. Controller types (`SmoothStreamController`, `SmoothStreamOptions`, `SmoothStreamPacing`, `SmoothStreamPacingParams`) describe the framework-independent pacing layer.

The authoritative exported names are in [`react/src/index.tsx`](../../../../packages/react/src/index.tsx), with payload types in [`context.tsx`](../../../../packages/react/src/context.tsx). The [subpackage guide](extending-via-subpackage.md) shows how a wrapper's props, group hook, and widened factory fit together.

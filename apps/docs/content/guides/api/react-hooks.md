# React hooks and providers

Context hooks read the surrounding React renderer tree. The stability helpers can be used in other React components too. For component props, see the [React props reference](react-props.md). For pacing hooks, see the [smooth streaming API](../smooth-streaming.md#api-reference); for registry access, see [`useDocumentRegistry`](../../reference/react.md#usedocumentregistrydocumentid). Vue has [separate setup composables](../../reference/vue.md#composable-reference).

## Hooks

State is split across **five per-system contexts**. Each narrow hook subscribes to one system, so updates to unrelated contexts do not themselves notify that hook. Normal parent rendering still applies. All throw if called outside the provider boundary (except `useAIMarkdownMetadata`, which returns `undefined` when no metadata was provided).

### The five narrow hooks

| Hook                                 | Returns                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| `useAIMarkdownState()`               | `{ streaming, …extension state groups }`                                     |
| `useAIMarkdownTheme()`               | `{ fontSize, variant, colorScheme }`                                         |
| `useAIMarkdownDocument()`            | `{ documentId, documentIdExplicit, clobberPrefix, scope }`                   |
| `useAIMarkdownBehaviors()`           | `{ blockMemo, incrementalParse, preserveOrphanReferences, …wrapper groups }` |
| `useAIMarkdownMetadata<TMetadata>()` | `TMetadata \| undefined`                                                     |

```tsx
import type { PropsWithChildren } from 'react';
import { useAIMarkdownState, useAIMarkdownTheme } from '@ai-markdown/react';

function CustomCodeBlock({ children }: PropsWithChildren) {
  const { streaming } = useAIMarkdownState();
  const { colorScheme } = useAIMarkdownTheme();

  if (streaming) {
    return <pre className={`streaming ${colorScheme}`}>{children}</pre>;
  }
  return <pre className={colorScheme}>{children}</pre>;
}
```

Field reference:

| Field                                                         | Hook                       | Type                    | Description                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------- | -------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `streaming`                                                   | `useAIMarkdownState()`     | `boolean`               | Whether content is being streamed.                                                                                                                                                                                                                                                                                                                                                   |
| `fontSize`                                                    | `useAIMarkdownTheme()`     | `string`                | Resolved CSS font-size value.                                                                                                                                                                                                                                                                                                                                                        |
| `variant`                                                     | `useAIMarkdownTheme()`     | `AIMarkdownVariant`     | Active typography variant.                                                                                                                                                                                                                                                                                                                                                           |
| `colorScheme`                                                 | `useAIMarkdownTheme()`     | `AIMarkdownColorScheme` | Active color scheme.                                                                                                                                                                                                                                                                                                                                                                 |
| `documentId`                                                  | `useAIMarkdownDocument()`  | `string`                | Stable id for the logical markdown document — caller-supplied or auto-generated via `useId()`.                                                                                                                                                                                                                                                                                       |
| `documentIdExplicit`                                          | `useAIMarkdownDocument()`  | `boolean`               | Whether `documentId` was explicitly supplied by the caller (vs. auto-generated). Internal coordination signal — `useDocumentRegistry` uses it so an auto-generated id never opts a standalone chunk into cross-chunk coordination. Most custom components can ignore this.                                                                                                           |
| `clobberPrefix`                                               | `useAIMarkdownDocument()`  | `string`                | URI-safe id prefix derived from `documentId` (with MurmurHash3 → Base62 shortening applied for >16-char ids), used by every clobberable HTML attribute (`id=…` / `href="#…"`). Read this from the hook rather than recomputing locally when writing components that emit anchors — the prefix's exact byte form is not part of the stability contract and may shift across versions. |
| `scope`                                                       | `useAIMarkdownDocument()`  | `object`                | Identity of the document, for state that belongs to the document rather than to one renderer (a `WeakMap` key, for example). Renderers sharing an explicit `documentId` inside `<AIMarkdownDocuments>` share one object; any other renderer has its own. The supplied image component groups its gallery by it.                                                                      |
| `blockMemo` / `incrementalParse` / `preserveOrphanReferences` | `useAIMarkdownBehaviors()` | `boolean`               | The resolved behavior switches — same names as the flat props.                                                                                                                                                                                                                                                                                                                       |

### `useAIMarkdown()` — the aggregate

Inside a custom renderer, import `useAIMarkdown` from `@ai-markdown/react` and read the aggregate:

```tsx
const { document, metadata, state, theme, behaviors } = useAIMarkdown();
```

Subscribes to **all five contexts** and re-renders on ANY change — including every `streaming` flip. It serves teaching code and low-frequency components; performance-sensitive components should use the narrow hooks.

### `useAIMarkdownMetadata<TMetadata>()`

Read application data from the metadata context. The hook returns `TMetadata | undefined`; its generic is a compile-time assertion and cannot verify which component supplied the value.

```tsx
import { useRef, type PropsWithChildren } from 'react';
import { useAIMarkdownMetadata, type AIMarkdownMetadata } from '@ai-markdown/react';

interface MyMetadata extends AIMarkdownMetadata {
  onCopyCode: (source: string) => void;
}

function CustomCodeBlock({ children }: PropsWithChildren) {
  const preRef = useRef<HTMLPreElement>(null);
  const metadata = useAIMarkdownMetadata<MyMetadata>();
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          metadata?.onCopyCode(preRef.current?.textContent ?? '');
        }}
      >
        Copy
      </button>
      <pre ref={preRef}>{children}</pre>
    </div>
  );
}
```

This small renderer extracts the visible code text from the actual `<pre>` and keeps the button outside it. `String(children)` would stringify React elements rather than recover their code. For transformed displays, preserve original source from the hast node instead; the [custom component guide](https://ai-markdown.github.io/docs/guides/custom-components/) provides that fuller recipe.

Metadata is passed through without a deep-equality wrapper. Reuse a stable object when values have not changed; use a new object when reactive metadata changes. A stable container holding callbacks or an external store is useful for high-frequency application data, but mutating a ref alone does not notify a React view.

### `useStableValue<T>(value: T)`

Returns a referentially stable version of `value`. On each render the new value is deep-compared (via `lodash/isEqual`) against the previous committed value. If they are structurally equal, the previous reference is returned, so downstream `useMemo`/`useEffect` dependencies can retain their identity. The retained reference advances after commit, not during an abandoned render. Do not mutate a retained object in place; supply a new value when its meaning changes.

```tsx
import { useStableValue } from '@ai-markdown/react';

export function useStableConfig(config: { compact: boolean }) {
  return useStableValue(config);
}
```

### `useStableRecord(record, table)`

The stability firewall used internally, exported for wrapper authors. Returns a referentially stable version of `record` according to a per-key `AIMarkdownStabilityPolicy` table:

- `DEEP_EQUAL` — restore the previous reference when the new value is deep-equal (plain-data props).
- `WARN_ONLY` — pass through, but warn in dev after repeated identity flips (functions/components, where deep comparison is meaningless).
- `PASS_THROUGH` — declared exemption, no stabilization (e.g. `metadata`).

Only keys declared in the table are returned; keys outside the table are dropped. Keep the table stable and treat retained values as immutable.

A wrapper builds a table only for the object props it terminates itself (e.g. mantine's `codeBlock`); props forwarded to `<AIMarkdown>` ride the React adapter's firewall untouched.

```tsx
import { useStableRecord, AIMarkdownStabilityPolicy, type AIMarkdownStabilityTable } from '@ai-markdown/react';

interface PanelOptions {
  compact: boolean;
}

const TABLE: AIMarkdownStabilityTable<{ panel: Partial<PanelOptions> | undefined }> = {
  panel: AIMarkdownStabilityPolicy.DEEP_EQUAL,
};

export function usePanelOptions(panel: Partial<PanelOptions> | undefined) {
  return useStableRecord({ panel }, TABLE);
}
```

## Additive Providers

The React adapter exports two stackable Providers — `AIMarkdownBehaviorsProvider` and `AIMarkdownStateProvider` — so wrappers and applications can transport their own extension groups through the React adapter's contexts. Stack the Provider **outside** `<AIMarkdown>`; consumers still see exactly one context:

```tsx
import { useMemo } from 'react';
import AIMarkdown, {
  AIMarkdownBehaviorsProvider,
  type AIMarkdownBehaviorGroups,
  type AIMarkdownProps,
} from '@ai-markdown/react';

type MyMarkdownProps = AIMarkdownProps & { panel?: { compact: boolean } };

const NO_GROUPS: AIMarkdownBehaviorGroups = Object.freeze({});

function MyMarkdown({ panel, ...rest }: MyMarkdownProps) {
  // Absent prop → contribute NO group (an outer app-level Provider's
  // `panel` group then stays visible); present prop wins via inner-wins.
  const groups = useMemo<AIMarkdownBehaviorGroups>(() => (panel != null ? { panel } : NO_GROUPS), [panel]);
  return (
    <AIMarkdownBehaviorsProvider value={groups}>
      <AIMarkdown {...rest} />
    </AIMarkdownBehaviorsProvider>
  );
}
```

- **Built-in React prop keys are locked.** Behaviors (`blockMemo`, `incrementalParse`, `preserveOrphanReferences`) and state (`streaming`) cannot be injected from outside — type-forbidden, unconditionally overwritten by the prop-resolved values at the innermost merge, and warned about in dev.
- Multi-level wrappers stack naturally; for a duplicated group key the inner layer wins.
- `AIMarkdownStateProvider` carries extension lifecycle states (aborted, reasoning, tool-call-in-progress, …). Group members must be message-lifecycle frequency — frame-rate data (per-token progress etc.) still goes through metadata's stable-container pattern.
- Apply group defaults inside your wrapper's narrow hook exactly once (the pattern behind mantine's `useMantineCodeBlockOptions()`); bare `??` fallbacks at multiple read sites will drift.

### Group-key registry

Group keys share one namespace per context (behaviors, state) across every wrapper layer and the application — a duplicated key resolves by inner-wins **silently**, so this registry is the collision governance, the same way the [React props reference](../../reference/react.md#props-api-reference) governs flat prop names. Wrapper packages: register your keys here via PR before shipping. Applications: use app-scoped names (`chatPanel`, not `panel`) to stay clear of future wrapper keys.

| Group key   | Context   | Owner                        |
| ----------- | --------- | ---------------------------- |
| `codeBlock` | behaviors | `@ai-markdown/react-mantine` |

**Reservation policy**: the React adapter will not promote a registered group key into a core-locked key (the `never`-typed lock) within a stable major release line (prerelease APIs can still change) — promotion retroactively breaks every downstream compile that used the key, so it is by definition a major-version change.

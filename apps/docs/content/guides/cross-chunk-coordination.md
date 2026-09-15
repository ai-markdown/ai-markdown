# React documents and references

The examples and registry hook below use React. Vue supplies its own `AIMarkdownDocuments` and `AIMarkdown` with the same explicit document ID model and the same wrapper-level `preserveOrphanReferences` (both adapters resolve the wrapper value first), but no React registry hook. See the [Vue guide](../reference/vue.md#multiple-chunks-in-one-document) and [package setup](getting-started.md).

A logical document can be displayed by several `<AIMarkdown>` instances: for example, independently updated answer sections with references to a shared citation list. Each instance parses its own Markdown. `<AIMarkdownDocuments>` connects their reference definitions and footnote numbering when they share an explicit, non-empty `documentId`.

This is a reference-coordination layer, not a parser for arbitrarily split transport data. Accumulate SSE/token deltas into one string for the usual chat interface. Use multiple renderers only when each chunk is a meaningful Markdown unit: a fence, paragraph, table, or emphasis span cannot begin in one renderer and finish in another.

```tsx
import AIMarkdown, { AIMarkdownDocuments } from '@ai-markdown/react';

interface Message {
  id: string;
  chunks: { id: string; markdown: string }[];
}

function StreamedMessage({ message }: { message: Message }) {
  return (
    <AIMarkdownDocuments>
      {message.chunks.map((chunk, index) => (
        <AIMarkdown key={chunk.id} content={chunk.markdown} documentId={message.id} documentIndex={index} />
      ))}
    </AIMarkdownDocuments>
  );
}
```

The wrapper allows a footnote reference in one chunk to find a later definition, and lets link and image references resolve a definition supplied elsewhere. Without it, unresolved reference syntax follows standalone Markdown behavior, generally remaining literal text; it does not inherently become an empty link or disappear.

Keep `blockMemo` enabled (the default). Coordination belongs to that rendering path; `blockMemo={false}` selects the legacy standalone path and loses shared numbering, reference resolution, and the aggregate footer.

## When to use

| Scenario                                                                                      | Use `<AIMarkdownDocuments>`?                                                                  |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Single `<AIMarkdown>` per logical document (most non-streaming apps)                          | **No** — overhead with no benefit                                                             |
| One `<AIMarkdown>` per chat message, references stay within the message                       | **No**                                                                                        |
| Streamed message split into multiple `<AIMarkdown>` instances (each a complete Markdown unit) | **Yes** — same `documentId` across chunks                                                     |
| Multiple distinct messages on the same page, each with its own internal references            | **No** — but auto-generated `documentId` namespaces still prevent cross-message id collisions |
| One conceptual document split visually (collapsible sections, virtualized list rows)          | **Yes** if references span the splits                                                         |

---

## The `documentId` rule

`documentId` is the **id namespace** for clobberable attributes (`id="…"`, `href="#…"`). Two semantics:

1. **Within a single document**, the prefix ensures footnote backrefs and anchor links navigate correctly.
2. **Between documents on the same page**, distinct prefixes prevent `<a href="#fn-1">` from one message hijacking the `<li id="fn-1">` in another.

When you wrap chunks in `<AIMarkdownDocuments>` and pass the same `documentId`, the wrapper allocates a shared `Registry` keyed by that id, and the chunks see each other's contributions.

### Long ids are auto-hashed

If you pass UUIDs / nanoids (>16 chars), the library hashes them via MurmurHash3 → Base62 so the rendered HTML stays compact:

```text
documentId="550e8400-e29b-41d4-a716-446655440000"
  → state.documentId is the raw value
  → state.clobberPrefix becomes "Abc123-user-content-" (≤6-char hash)
  → registry keying uses the raw value
```

The shortening is purely a **rendered-HTML** concern. `useDocumentRegistry(documentId)` and `state.documentId` see the raw value, so deep linking and registry interop are unaffected.

### Auto-generated ids

Omit `documentId` and the library calls `useId()` to generate one. SSR-safe, stable across re-renders of the same instance. Different `<AIMarkdown>` instances get different ids — which is what you want for standalone mode, and exactly what you **don't** want for chunked-streaming mode.

> **The single most common mistake**: wrapping chunks in `<AIMarkdownDocuments>` but forgetting to pass a shared `documentId`. Auto-generated ids namespace standalone HTML, but omitted `documentId` opts the renderer out of the shared registry. Pass the same explicit id to join it; an empty string or null also opts out.

---

## What gets coordinated

Three forms of reference are coordinated through two namespaces. Footnotes have their own labels; links and images share the same Markdown link-definition namespace:

| Kind      | Markdown syntax                           | Coordinated across chunks?                                |
| --------- | ----------------------------------------- | --------------------------------------------------------- |
| Footnote  | `[^label]` + `[^label]: text`             | ✅ Numbering, anchor href, backref href, aggregate footer |
| Link ref  | `[click][label]` + `[label]: url "title"` | ✅ URL + title resolution                                 |
| Image ref | `![alt][label]` + `[label]: url "title"`  | ✅ URL + title resolution                                 |

**Inline links** (`[click](https://…)`) and **inline images** (`![alt](https://…)`) need no coordination — they carry their URL inline. The registry only matters for reference-style markup.

The footnote section is rendered **once** at the end of the document's last chunk, aggregating definitions from all chunks. There's no per-chunk footnote footer — the wrapper's `AggregateFootnotesIfLast` component detects when its chunk is the last one and emits the full footnote list. If chunk order changes (chunks unmount/remount during streaming), the footer follows the new "last" chunk automatically.

Definitions are document-wide wherever they are written. A link definition or footnote definition placed inside a footnote body (`[^a]: see [x]` followed by an indented `[x]: /url`) is claimed and contributed like a top-level one, so a sibling chunk's `[x]` resolves against it. Footnote bodies are harvested from the chunk's rendered output and keyed by the same encoded id fragment the footer's `<li id>` carries, so labels with non-ASCII characters or percent-escapes (`[^中文]`, `[^a%41]`) keep their bodies in the aggregate footer. Only the synthesized footer is harvested: a raw `<section data-footnotes>` an author writes in Markdown is content and never supplies a body.

A footnote referenced only from inside another footnote's body follows standalone numbering: it is numbered after every flow reference, in the order the footer renders the bodies that mention it, and listed in the aggregate footer at that position. Such a nested occurrence is not an inline mark, so it is not counted by `getRefsForLabel` and receives no per-occurrence backref; the footer emits the single bare backref for the label.

---

## `<AIMarkdownDocuments>` props

| Prop                       | Type        | Default | Purpose                                                                                                                                                                                                                                                                                                                                        |
| -------------------------- | ----------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preserveOrphanReferences` | `boolean`   | `true`  | **Unconditionally** overrides each chunk's own `preserveOrphanReferences` prop. When `true`, orphan `[^label]: …` definitions (no matching `[^label]`) are protected from being silently dropped by `mdast-util-to-hast`. Crucial for streaming — references may arrive in a later chunk.                                                      |
| `smoothTurnTaking`         | `boolean`   | `true`  | Wrapper-level switch for smooth-stream turn-taking: `<AIMarkdownSmoothStream>` chunks sharing this `documentId` type one at a time in mount order. `false` disables the gate wholesale (every chunk paces independently). Details and escape hatches: [smooth streaming → turn-taking](smooth-streaming.md#multi-chunk-documents-turn-taking). |
| `children`                 | `ReactNode` | —       | The `<AIMarkdown>` instances to coordinate                                                                                                                                                                                                                                                                                                     |

```tsx
<AIMarkdownDocuments preserveOrphanReferences={true}>{children}</AIMarkdownDocuments>
```

Note that `preserveOrphanReferences` on the wrapper **wins over** the same prop on each chunk. This is by design: the wrapper-level policy is usually what you want consistent across chunks.

### Nested wrappers throw (dev) / degrade (prod)

```tsx
// Dev: throws an error immediately.
// Prod: console.errors, renders children, inner wrapper is a no-op.
<AIMarkdownDocuments>
  <AIMarkdownDocuments>{children}</AIMarkdownDocuments>
</AIMarkdownDocuments>
```

The split is intentional — surfacing the bug in dev, surviving in prod. Don't nest wrappers; if you have nested coordinated scopes (rare), the outer wrapper is always the canonical one for everything under it.

---

## Reading the registry: `useDocumentRegistry`

```ts
function useDocumentRegistry(documentId: string | undefined): Registry | null;
```

Returns:

- The shared `Registry` if both (a) called inside `<AIMarkdownDocuments>` and (b) `documentId` is non-empty.
- `null` otherwise — treat as "run the standalone path; no coordination."

> ℹ️ **The hook can allocate a scope, but does not register or publish.** Calling `useDocumentRegistry(documentId)` can create an empty registry during render. The wrapper caches a `WeakRef` so concurrent renders and mounted consumers holding the object share its identity, while a discarded render cannot leave the object strongly retained by the wrapper. Garbage collection can reclaim an unused shell; a finalizer removes its stale cache key without deleting a newer scope for that id. Registered chunks still use explicit, microtask-deferred release for prompt eviction. GC timing is not part of reference resolution or registration correctness.

```tsx
import { useDocumentRegistry, defaultUrlTransform } from '@ai-markdown/react';

function BacklinkPanel({ documentId, label }: { documentId: string; label: string }) {
  const registry = useDocumentRegistry(documentId);
  if (!registry) return null;

  const def = registry.resolveLinkDef(label);
  if (!def) return <span>(unresolved: {label})</span>;

  // ⚠️ def.url is the RAW destination from the contributing chunk — the
  // registry does not sanitize. Run your own policy (here the library's
  // default allowlist) before rendering it as an attribute; a chunk can
  // define `[evil]: javascript:alert(1)`.
  const href = defaultUrlTransform(def.url, 'href', { type: 'element', tagName: 'a', properties: {}, children: [] });
  return (
    <a href={href || undefined} title={def.title}>
      {label}
    </a>
  );
}
```

### `Registry` surface (read-only)

| Field/Method                                        | Returns                                        | Purpose                                                                                                                                                                                                                                            |
| --------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chunkOrder`                                        | `readonly symbol[]`                            | Chunk identifiers in documentIndex order, with mount order as fallback/tie-breaker                                                                                                                                                                 |
| `chunkData`                                         | `ReadonlyMap<symbol, ChunkData>`               | Per-chunk refs/defs/linkDefs                                                                                                                                                                                                                       |
| `labelSet`                                          | `{ footnoteLabels, linkLabels }` (ReadonlySet) | Union of own-def labels across chunks                                                                                                                                                                                                              |
| `version`                                           | `number`                                       | Monotonic counter; bumped on every mutation                                                                                                                                                                                                        |
| `subscribe(cb)`                                     | unsubscribe function                           | Wake-up on registry mutations                                                                                                                                                                                                                      |
| `subscribeLabel(kind, label, cb)`                   | unsubscribe function                           | Observe one normalized `link` or `footnote` label's indexed selectors; links and images share the link channel                                                                                                                                     |
| `canonicalFootnoteFor(label)`                       | `symbol \| null`                               | Which chunk owns the canonical def for this footnote                                                                                                                                                                                               |
| `canonicalLinkFor(label)`                           | `symbol \| null`                               | Same, for link defs                                                                                                                                                                                                                                |
| `globalNumber(label)`                               | `number \| null`                               | Document-wide footnote number for a label                                                                                                                                                                                                          |
| `resolveLinkDef(label)`                             | `LinkDef \| null`                              | Cross-chunk link definition lookup                                                                                                                                                                                                                 |
| `getRefsForLabel(label)`                            | `number`                                       | Count of **footnote** marks pointing at this label in flow text. A reference inside another footnote's body (`RefRecord.nestedIn`) is numbered but not counted; link/image refs aren't counted either — there's no equivalent counter API for them |
| `globalOccurrenceForRef(chunkSym, label, localIdx)` | `number \| null`                               | Map a chunk-local ref occurrence to its document-wide index                                                                                                                                                                                        |

Mutator methods (`registerChunk`, `allocateSymbol`, etc.) are intentionally **not** on the public `Registry` type. The renderer drives those internally; exposing them would let consumer code corrupt refcounts, version bumps, or numbering invariants.

### What's NOT exposed

A few internals are deliberately kept off the public surface — useful to know so you don't go looking for them:

- **Per-chunk `Symbol`** — every chunk allocates a unique `Symbol` to identify itself inside the registry. There's no hook to read your own chunk's symbol from a custom component. If you need chunk-scoped behavior, derive it from `useAIMarkdownDocument().documentId` (shared across chunks) plus your own scoping logic.
- **Per-chunk URL policy / cross-chunk URL sanitization context** — the cross-chunk placeholders run their own per-attribute `urlTransform` pass using each consuming chunk's `urlTransform` + `sanitizeSchema`. The mechanism is internal; you control behavior by passing those props to each `<AIMarkdown>`, not by hooking into the cross-chunk machinery.
- **Mutator methods on `Registry`** — see the note above. Only selectors, `subscribe` and `subscribeLabel` are public.

If you find yourself wanting one of these, the supported path is usually to drive the same behavior from the public surfaces (`documentId`, `metadata`, `urlTransform`, `sanitizeSchema`, the public `Registry` selectors). If that's genuinely insufficient, open an issue describing the use case.

### Reactively reading the registry

`Registry` is mutated outside React's render flow. To re-render a component when it changes, subscribe via `useSyncExternalStore`:

```tsx
import { useSyncExternalStore } from 'react';
import { useDocumentRegistry, type Registry } from '@ai-markdown/react';

function useRegistryVersion(registry: Registry | null): number {
  return useSyncExternalStore(
    (cb) => (registry ? registry.subscribe(cb) : () => {}),
    () => registry?.version ?? 0,
    () => 0 // Server and hydration start before contribution effects.
  );
}

function FootnoteCount({ documentId }: { documentId: string }) {
  const registry = useDocumentRegistry(documentId);
  useRegistryVersion(registry); // re-render when version bumps
  return <span>{registry?.labelSet.footnoteLabels.size ?? 0} footnotes</span>;
}
```

### Recipe: backlink panel via `resolveLinkDef`

Renders a sidebar listing every cross-chunk link reference and its resolved URL — useful for "where do my citations point" inspection or building an attribution panel.

```tsx
import { useSyncExternalStore } from 'react';
import { useDocumentRegistry, defaultUrlTransform } from '@ai-markdown/react';

// urlTransform's third argument is the hast node; a minimal stand-in is fine.
const A_NODE: Parameters<typeof defaultUrlTransform>[2] = {
  type: 'element',
  tagName: 'a',
  properties: {},
  children: [],
};

function BacklinkPanel({ documentId, labels }: { documentId: string; labels: string[] }) {
  const registry = useDocumentRegistry(documentId);
  useRegistryVersion(registry);

  if (!registry) return null;

  return (
    <aside>
      <h3>References</h3>
      <ul>
        {labels.map((label) => {
          const def = registry.resolveLinkDef(label);
          if (!def) return <li key={label}>{label} — unresolved</li>;
          // ⚠️ def.url is RAW — the registry stores destinations unsanitized
          // and the library's placeholders sanitize at render time. Do the
          // same here (correct key for the attribute you render) — see the
          // url-sanitization docs.
          const href = defaultUrlTransform(def.url, 'href', A_NODE);
          return (
            <li key={label}>
              <a href={href || undefined} title={def.title}>
                {label}
              </a>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
```

### Recipe: per-label footnote-number badge

Renders the document-wide footnote number for a given label (e.g. show `[3]` next to a citation tooltip).

```tsx
function FootnoteBadge({ documentId, label }: { documentId: string; label: string }) {
  const registry = useDocumentRegistry(documentId);
  useRegistryVersion(registry);
  const n = registry?.globalNumber(label) ?? null;
  return n === null ? null : <sup>[{n}]</sup>;
}
```

`globalNumber` resolves the document-wide ordinal across all chunks — so this badge stays consistent even if the same label is referenced multiple times in different chunks.

### Recipe: counting refs per label

`getRefsForLabel(label)` returns the **footnote** mark count across the document's flow text (references written inside another footnote's body are excluded). Useful for a "this footnote is cited N times" indicator.

```tsx
function FootnoteUsage({ documentId, label }: { documentId: string; label: string }) {
  const registry = useDocumentRegistry(documentId);
  useRegistryVersion(registry);
  const n = registry?.getRefsForLabel(label) ?? 0;
  return <span>{n === 0 ? 'unused' : `cited ${n}×`}</span>;
}
```

Link/image refs have no equivalent counter API — derive that yourself from `registry.chunkData` if you need it.

---

## Streaming patterns

The two cross-document patterns are also named in [Streaming chat: end-to-end](streaming-chat-example.md) and [Streaming & performance](streaming-and-performance.md) — same `Approach A` / `Approach B`, in the same direction (A = growing, B = chunked). The cross-chunk doc leads with B because that's the pattern that actually needs coordination.

### Approach B: one `<AIMarkdown>` per logical Markdown chunk (chunked)

```tsx
function StreamedMessage({ chunks, id, done }: { chunks: string[]; id: string; done: boolean }) {
  return (
    <AIMarkdownDocuments>
      {chunks.map((chunk, i) => (
        <AIMarkdown
          key={i}
          content={chunk}
          documentId={id}
          documentIndex={i}
          streaming={!done && i === chunks.length - 1}
        />
      ))}
    </AIMarkdownDocuments>
  );
}
```

Only the **last** chunk's `streaming` is true. Earlier chunks are finalized.

### Approach A: re-rendering the same `<AIMarkdown>` with growing content

```tsx
function GrowingMessage({ content, done }: { content: string; done: boolean }) {
  return <AIMarkdown content={content} streaming={!done} />;
}
```

No wrapper needed — there's only one instance. Block-level memoization minimizes re-render work; the entire document is one logical chunk. This is the **simpler** pattern when you control content assembly upstream.

### Variant: hybrid (chunked + virtualization)

Virtualization changes which contributions exist. `documentIndex` preserves the order of **mounted** chunks; it does not retain definitions, refs, or numbering from chunks that have unmounted. Consequently, a reference can become unresolved when its definition scrolls out of the mounted window, and the aggregate footer belongs to the last registered chunk rather than necessarily the final chunk in your full data set.

Use a virtualizer only when these lifetime semantics fit the application. Keep required definition-bearing chunks mounted, or keep a complete renderer mounted if the whole document must remain navigable. Reserving an ordinal alone cannot supply missing content.

For a virtualized row, the renderer-facing contract is:

```tsx
function DocumentRow({ id, index, markdown }: { id: string; index: number; markdown: string }) {
  return <AIMarkdown content={markdown} documentId={id} documentIndex={index} />;
}
```

The surrounding virtualizer owns its scroll container, total-height spacer, absolute row positioning, measurements, and stable keys. Place one `<AIMarkdownDocuments>` above the mounted rows. The row's React key should identify the logical chunk even when it moves; `documentIndex` describes its current document position.

By default, registration order is mount order. A released chunk that later remounts would otherwise be appended to the registry's order, potentially moving its footnotes and footer into the middle of the visual document. Supplying a stable ordinal fixes this ordering problem. Indexed chunks sort ahead of unindexed chunks; equal indices and unindexed chunks use mount order. Supply indices consistently for predictable ordering.

Smooth-stream turn-taking has its own mount-ordered queue. `documentIndex` does not reorder that queue; see [smooth streaming](smooth-streaming.md#chunks-inserted-out-of-mount-order).

## Lifecycle: how chunks register with the registry

Registration and contribution are commit-time effects. A render prepares trees and contribution data; other renderers observe them only after effects publish them.

1. The renderer obtains the registry for the current explicit document id and allocates its chunk identity through the registration lifecycle. Identity is paired with that registry so switching documents cannot publish an old symbol into a different store.
2. Registration publishes the chunk's own definition labels and optional `documentIndex`. These labels let other chunks parse references that would otherwise remain unresolved.
3. Contribution effects publish parsed reference information, link definitions, and processed footnote bodies. A contribution fingerprint skips unchanged writes; a parent render does not necessarily mutate the store.
4. Cleanup releases the symbol's reference count. Deletion is deferred to a microtask and rechecks the count, allowing Strict Mode's effect cleanup/setup cycle to retain the same live entry.
5. Releasing the last registered chunk invokes the registry's empty callback and removes it from the wrapper map. A later mount starts a fresh document registry. Speculative shells that never registered a chunk are weakly cached and can be garbage-collected once no render or consumer holds them.

The aggregate footer and reference placeholders subscribe to the resulting store. Label subscriptions avoid waking an unrelated reference when its selected URL or numbering did not change; document-wide views still need global subscriptions. See the notification-routing section below for the distinction.

### Server rendering and the first client frame

On the server, contribution effects do not run. Each chunk therefore renders with standalone semantics: local definitions resolve locally and local footnote marks agree with their local footer. A definition located only in another chunk is unavailable, so its reference remains unresolved during this phase.

The first client render starts from the same empty registry, preserving hydration agreement. A hydration render also reads no registry state at all, so the agreement holds when chunks sit in separate `<Suspense>` boundaries and one boundary hydrates after its siblings have already committed and registered their labels: the late chunk still produces the server's bytes rather than a resolved reference that React would have to regenerate. After hydration completes and effects register and contribute, references resolve against the canonical definitions in document order, footnotes receive shared numbers, and local footers give way to the aggregate footer. A client-only render behaves the same way without the hydration step: its first committed frame is the standalone output and the resolved output follows once the effects have run. If cross-chunk resolution must be present in server HTML, render one complete Markdown string instead of expecting effects to run on the server.

## Footguns

### Forgetting to share `documentId` across chunks

```tsx
// ⚠️ Each chunk auto-generates its own id → no coordination.
<AIMarkdownDocuments>
  {chunks.map((c, i) => <AIMarkdown key={i} content={c} />)}
</AIMarkdownDocuments>

// ✅ Share the id.
<AIMarkdownDocuments>
  {chunks.map((c, i) => <AIMarkdown key={i} content={c} documentId={messageId} />)}
</AIMarkdownDocuments>
```

### Sharing `documentId` _without_ the wrapper

```tsx
// ⚠️ Same documentId across instances, but no <AIMarkdownDocuments> → references still don't coordinate.
{
  chunks.map((c, i) => <AIMarkdown key={i} content={c} documentId={messageId} />);
}
```

The wrapper is what binds chunks together. The id alone only aligns ids — it doesn't share a registry.

### Mutating registry-returned objects

```tsx
// ⚠️ Mutating a returned LinkDef.
const def = registry?.resolveLinkDef('docs');
if (def) def.url = '...'; // shared across all consumers; corrupts other components

// ✅ Treat registry-returned data as read-only.
const def = registry?.resolveLinkDef('docs');
const myUrl = def?.url; // read only
```

The TypeScript types are `readonly` where it matters, but JavaScript doesn't enforce that at runtime.

### Expecting `Registry` to update _during_ a render

The registry is mutated by chunk mount/render effects, which happen **after** the render that triggered them commits. A component that reads `registry.canonicalFootnoteFor(label)` during its first render may see `null` even though the def exists — because the def-contributing chunk's effect hasn't fired yet. Subscribe via `useSyncExternalStore` (as shown above) to re-render when the registry settles.

### Using a non-stable `documentId`

```tsx
// ⚠️ A new id every render → registries pile up.
<AIMarkdown content={c} documentId={`msg-${Date.now()}`} />

// ✅ Stable id per logical document.
<AIMarkdown content={c} documentId={message.id} />
```

The wrapper does evict empty registries, but the perf cost of allocate/teardown on every render is real and the `version` bumps would saturate any subscribed component.

### Nesting `<AIMarkdownDocuments>`

Already covered above — dev throws, prod degrades. Don't.

### Label notification routing

Placeholders use `subscribeLabel` and a scalar snapshot instead of receiving every registry notification. Link observers wake when their canonical owner, URL or title changes. Footnote observers wake when the canonical owner, number, reference count or per-chunk occurrence range changes, including indirect renumbering after another label is inserted earlier in document order. Labels are normalized by the same identifier rules as the selectors.

Each microtask compares the observed labels against the current ordered index before invoking any callbacks. Multiple same-label placeholders share that comparison. Net-zero changes can produce no label callback; global `subscribe` still observes every mutation batch and is required for raw chunk data, footnote bodies and aggregate views. Unsubscribing the last listener removes the label group. Index rebuilding and comparison across subscribed labels still cost work; this removes unrelated callback fanout, not every document-wide scan.

## Checking a coordinated integration

Verify more than the happy path: add a definition after its reference, edit its URL/title, insert an earlier footnote, remove the canonical definition, and remount a chunk with its original `documentIndex`. Test link and image references using the same label, since both select from the link namespace. Check that separate document ids never exchange definitions.

For a custom registry reader, always subscribe before relying on later contributions. The first `BacklinkPanel` example demonstrates URL selection only; combine it with `useRegistryVersion` for live updates, as in the full sidebar recipe. `defaultUrlTransform` supplies the library's default URL policy for your manually constructed link; it does not reproduce an arbitrary consuming chunk's custom schema or transform.

Implementation references: [document wrapper](../../../../packages/react/src/components/AIMarkdownDocuments.tsx), [registry](../../../../packages/engine/src/components/documentRegistry.ts), and [render lifecycle](../../../../packages/react/src/components/MarkdownContent.tsx).

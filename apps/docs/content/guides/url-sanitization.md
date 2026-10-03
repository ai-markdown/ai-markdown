# URL Sanitization & Custom Schemes

The two-stage policy is shared by React and Vue. Examples use React imports; Vue exports `extendSanitizeSchema`, `defaultUrlTransform` and `UrlTransform` from its root and accepts `:sanitize-schema` and `:url-transform`. See the [Vue guide](../reference/vue.md#component-props) and [package setup](getting-started.md).

URL handling has two stages. The sanitize schema first decides which HTML elements, attributes, and protocols survive. The render-time `urlTransform` then evaluates each surviving URL-bearing attribute. To allow a private protocol such as `myapp:`, configure both stages for the particular attribute that needs it.

These stages have different outputs. A schema rejection can remove an attribute before your callback runs. A callback can return an empty string, `null`, or `undefined`; these values should not be described as interchangeable HTML. A legal empty destination is also different from a blocked destination. This guide explains that distinction, shows a typed extension recipe, and describes how the same policy applies to coordinated references.

## The two-gate model

```text
LLM-emitted URL string
        │
        ▼
┌────────────────────────────────────┐
│ Gate 1: rehype-sanitize schema      │  Per-protocol allowlist
│  • protocols.href / .src / .cite    │
│  • runs FIRST (in the rehype chain, │
│    during parseStage)               │
│  • drops the URL if its protocol    │
│    isn't on the allowlist           │
└────────────────────────────────────┘
        │
        ▼
┌────────────────────────────────────┐
│ Gate 2: urlTransform                │  Per-attribute rewriter
│  • receives (url, key, node)         │
│  • runs SECOND (at render time, in   │
│    renderHastSubtree)                │
│  • returns the rewritten URL, or     │
│    '' / null / undefined to drop     │
└────────────────────────────────────┘
        │
        ▼
  Rendered <a>/<img>/etc.
```

**Both** gates must permit a URL for it to render. Allowing only one is the most common mistake — see [Footguns](#footguns).

> The ordering above is the **actual execution order** inside the pipeline: `rehype-sanitize` runs as part of the rehype plugin chain (`MarkdownContent.tsx`), and `urlTransform` runs later, during per-attribute traversal in `renderHastSubtree`. The numbering reflects the order URLs actually traverse, not just a conceptual layering.

### Default allowlist

`defaultUrlTransform` recognizes these explicit schemes:

```text
http  https  irc  ircs  mailto  xmpp
```

Other explicit schemes, including `javascript:`, `data:`, `vbscript:`, and `file:`, return an empty string from the default transform. Relative paths, protocol-relative URLs, fragments, and query strings are also accepted by that transform. Gate 1 has separate per-attribute protocol lists, so this list is not a promise that every scheme is valid for every HTML attribute.

---

## Allowing a custom scheme

For an application deep link, allow the protocol on `href` and keep image policy unchanged. Give the callback the exported `UrlTransform` type so its `node` argument has the correct hast shape:

```tsx
import AIMarkdown, { defaultUrlTransform, extendSanitizeSchema, type UrlTransform } from '@ai-markdown/react';

const SCHEMA = extendSanitizeSchema((draft) => {
  draft.protocols ??= {};
  draft.protocols.href = [...(draft.protocols.href ?? []), 'myapp'];
});

const URL_TRANSFORM: UrlTransform = (url, key, node) => {
  if (key === 'href' && /^myapp:/i.test(url)) return url;
  return defaultUrlTransform(url, key, node);
};

function App({ content }: { content: string }) {
  return <AIMarkdown content={content} sanitizeSchema={SCHEMA} urlTransform={URL_TRANSFORM} />;
}
```

`[Open item](myapp://items/42)` can now reach your link renderer. To support the protocol on `src` too, add it to `draft.protocols.src` and explicitly permit the `src` key in the callback. A protocol rule does not validate an application's host, route, or item identifier; add those checks when your deep-link handler requires them.

Keep both values at module scope when policy is fixed. If policy depends on application settings, memoize the schema and callback with those settings as dependencies. A real policy change must reach the renderer; preserving an obsolete function for performance would preserve the obsolete policy as well.

## `urlTransform` (Gate 2)

A function receiving the URL plus contextual metadata; returns a rewritten URL, an empty string, or no value as described below.

```ts
import type { Element } from 'hast';

type UrlTransform = (url: string, key: string, node: Readonly<Element>) => string | null | undefined;
```

| Parameter | Meaning                                                                                                                       |
| --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `url`     | The URL after parsing, normalization, schema filtering, and any hash rebasing                                                 |
| `key`     | Attribute name — `'href'`, `'src'`, `'cite'`, etc.                                                                            |
| `node`    | The hast `Element` carrying the attribute, typed as `Readonly` — useful when policy depends on tag name or sibling attributes |

The return value can be:

- The rewritten URL (a non-empty string) — used as-is.
- `null` or `undefined` — no URL value is supplied for the rendered attribute.
- `''` — an empty URL value. Serialization and browser behavior depend on the element and React; do not use it as a synonym for an absent attribute when that distinction matters.

`Readonly` is a TypeScript contract, not runtime freezing. Do not mutate the node or its properties from your callback. A callback should compute a return value from its arguments and policy, without depending on how many times a cached tree has been visited.

### Key-aware policies

A common need: permit `myapp:` on `<a href>` but not on `<img src>` (which would let an LLM embed a tracker pixel). The `key` parameter is exactly for this:

```ts
const URL_TRANSFORM: UrlTransform = (url, key, node) => {
  if (key === 'href' && /^myapp:/i.test(url)) return url;
  // src/cite paths still go through the default allowlist
  return defaultUrlTransform(url, key, node);
};
```

### Composing with `defaultUrlTransform`

`defaultUrlTransform` is the library's built-in safe transform — applying the GitHub allowlist. Compose with it rather than reimplementing:

```ts
// ✅ Whitelist your scheme; defer everything else to the default.
const URL_TRANSFORM: UrlTransform = (url, key, node) =>
  /^myapp:/i.test(url) ? url : defaultUrlTransform(url, key, node);

// ⚠️ Reimplementing the safe set yourself — easy to miss a scheme.
const URL_TRANSFORM = (url) => {
  if (/^(myapp|https?|mailto):/i.test(url)) return url; // forgot irc, ircs, xmpp
  return '';
};
```

### Setting `urlTransform={null}`

Passing `null` is equivalent to omitting the prop entirely — `<AIMarkdown>` falls back to `defaultUrlTransform` (the React adapter normalizes the absent value before forwarding it). There is no "disable the per-attribute pass" mode; the urlTransform stage always runs. If you need to widen the allowlist, compose with `defaultUrlTransform` as shown above.

---

## `sanitizeSchema` (Gate 1, via `extendSanitizeSchema`)

`extendSanitizeSchema` hands you a deep clone of the library default. Mutate it freely or return a replacement — the clone never aliases the singleton.

```ts
import { extendSanitizeSchema } from '@ai-markdown/react';

// Mutate-style (recommended for additive changes).
const SCHEMA = extendSanitizeSchema((s) => {
  s.protocols!.href!.push('myapp');
  s.protocols!.src!.push('myapp');
  s.tagNames!.push('my-widget');
  s.attributes!['my-widget'] = ['dataId', 'dataMode'];
});

// Return-style alternative (when you need a wider replacement).
const RETURNED_SCHEMA = extendSanitizeSchema((s) => ({
  ...s,
  tagNames: [...(s.tagNames ?? []), 'my-widget'],
}));
```

> ⚠️ **Return-style does no merging.** Whatever object you return is used as the schema verbatim. If you write `({ ...s, protocols: { href: ['myapp'] } })` thinking "I'll add one protocol", you'll actually **replace the entire `protocols` object** — replacing the inherited `href` list and removing the explicit `src` and other protocol restrictions. Mutate-style is safer for additive changes (push to existing arrays); reserve return-style for the rare case where you genuinely want to replace the whole schema and you accept the responsibility of re-supplying every field.

### Why use the helper instead of building a schema from scratch?

The library default extends `rehype-sanitize`'s `defaultSchema` with renderer-specific allowances and a raw-text stripping policy:

| Addition                                                                                | Why it's needed                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<mark>` tag allowance                                                                  | For `==highlight==` syntax to render                                                                                                                                                                                                                                                         |
| Math className allowlist on `<code>` (`math-inline`, `math-display`)                    | For `remark-math` to mark code spans as math before `rehype-katex` consumes them. KaTeX's own output classes (`katex`, `katex-html`, …) are not in this allowlist — they survive because `rehype-katex` runs _after_ `rehype-sanitize`, so those classes aren't yet present at sanitize time |
| Cross-chunk coordination tags (`cross-chunk-link`, `cross-chunk-image`, `footnote-sup`) | For [cross-chunk references](cross-chunk-coordination.md) to resolve correctly                                                                                                                                                                                                               |

Hand-rolling a schema (`{ ...defaultSchema, … }`) **silently drops these** — `==highlight==` becomes plain text, math may remain code text instead of becoming a formula, and cross-chunk placeholders can be removed. `extendSanitizeSchema` always works on a clone of the **library**'s default (not `rehype-sanitize`'s), so these survive.

### Inspecting the default schema

The helper itself is the cleanest introspection path:

```ts
extendSanitizeSchema((s) => {
  console.log('library default sanitize schema:', s);
});
```

`s` is the deep clone — log it once at module load to learn what's allowed, then write your real override.

<span id="why-isnt-the-default-schema-exported-as-a-value"></span>

### Why use the helper instead of importing the default schema?

The React and Vue adapters expose the extension helper; engine also exports its frozen default schema. The obvious extension pattern — `{ ...sanitizeSchema, protocols: { ...sanitizeSchema.protocols, href: [...] } }` — is a shallow spread. A shallow spread retains nested object and array references. The engine singleton is now deep-frozen, so mutating one of those shared arrays can throw rather than producing an independent schema. Deep cloning provides a mutable graph with no shared nested state. `extendSanitizeSchema` always works on a deep clone, so this entire class of bug is impossible by construction.

---

## Reference stability — asymmetric handling

Both props participate in the block-memo cache, but they are stabilized **differently**:

| Prop             | Tracked by                                 | Library safety net                                                |
| ---------------- | ------------------------------------------ | ----------------------------------------------------------------- |
| `urlTransform`   | Identity only                              | None — a new function reference flushes the entire markdown cache |
| `sanitizeSchema` | Identity AND deep-equal (`useStableValue`) | A new-but-deep-equal schema collapses to the previous reference   |

Why asymmetric: function identity can't be deep-compared (two closures with identical bodies are always non-equal), so `urlTransform` _cannot_ have a safety net. Schemas are plain data, so deep-equal is meaningful.

**Implication**: defining `urlTransform` inline `urlTransform={(url) => …}` discards the block-memo cache on every render. Defining `sanitizeSchema` inline doesn't flush the cache, but pays a per-render cost: each `extendSanitizeSchema((s) => …)` call does a `cloneDeep` of the library default schema _plus_ the subsequent `useStableValue` runs a deep-equal against the prior value. Both passes walk the entire schema (protocols / attributes / ancestors / tagNames). Module-scope avoids both.

```tsx
// ⚠️ Anti-pattern — discards the entire markdown cache every render.
<AIMarkdown
  urlTransform={(url, k, n) => /* … */}
  sanitizeSchema={extendSanitizeSchema((s) => /* … */)}
/>

// ✅ Module-scope, no per-render overhead.
const URL_TRANSFORM = (url, k, n) => /* … */;
const SCHEMA = extendSanitizeSchema((s) => /* … */);

<AIMarkdown urlTransform={URL_TRANSFORM} sanitizeSchema={SCHEMA} />
```

In development the library `console.warn`s after detecting 3+ identity flips on either prop. The warning compiles to dead code in production builds.

---

## Cross-chunk symmetry

When chunks are wrapped in `<AIMarkdownDocuments>`, references that resolve **across chunks** (chunk A defines `[evil]: javascript:…`, chunk B writes `[click][evil]`) go through both gates **at render time** in the consuming chunk. The same `urlTransform` and `sanitizeSchema` you pass to `<AIMarkdown>` apply to cross-chunk references. The per-attribute `key` is honored: a key-aware policy that permits a scheme on `<a>` but not `<img>` will produce identical behavior whether the reference is in-chunk or cross-chunk.

This means **a permissive `urlTransform` in one chunk does not leak across chunks** — every consumer applies its own policy independently. This is intentional; an attacker who controls one chunk should not be able to inject URLs that bypass another chunk's policy.

---

## Regex-escaping for scheme names

A literal `+` or `.` must be escaped when written in a regular expression. In `/^web+app:/i`, the `+` repeats the preceding `b`; it matches `webapp:` or `webbapp:`, not the intended `web+app:`.

```ts
const WRONG = /^web+app:/i;
const CORRECT = /^web\+app:/i;
```

A hyphen is literal outside a character class. Inside a character class it can define a range, so its placement or escaping matters. Do not describe all three characters as having the same regular-expression behavior.

For a dynamically configured scheme list, avoid building a regex from unescaped input. Extract and compare the scheme as data:

```ts
const EXTRA_SCHEMES = new Set(['myapp', 'web+share']);
const URL_TRANSFORM: UrlTransform = (url, key, node) => {
  const colon = url.indexOf(':');
  const scheme = colon < 0 ? '' : url.slice(0, colon).toLowerCase();
  if (key === 'href' && EXTRA_SCHEMES.has(scheme)) return url;
  return defaultUrlTransform(url, key, node);
};
```

The matching Gate 1 schema still needs those same protocol names. This is a policy for known application protocols, not a general URL parser.

## Footguns

### Allowing only one gate

```ts
// ⚠️ Gate 2 (urlTransform) permits 'myapp:', but Gate 1 (sanitize schema) still drops it.
const URL_TRANSFORM = (url) => (/^myapp:/.test(url) ? url : defaultUrlTransform(url, ...));
// No matching extendSanitizeSchema → URL silently disappears in the rendered output.
```

Symptom: the link/image is in your markdown, the consumer's URL transform clearly allows it, but the final `href`/`src` is empty.

```ts
// ⚠️ Gate 1 (sanitize schema) permits 'myapp', but Gate 2 (urlTransform) still rewrites to ''.
const SCHEMA = extendSanitizeSchema((s) => {
  s.protocols!.href!.push('myapp');
});
// No urlTransform override → defaultUrlTransform rewrites 'myapp:…' to ''.
```

Same symptom. Always extend both gates in lockstep.

### Reassigning the local schema parameter inside `extendSanitizeSchema`

```ts
// ⚠️ Does nothing — JS only rebinds the local variable.
const SCHEMA = extendSanitizeSchema((s) => {
  s = { ...completelyNewSchema }; // ← local rebind, not a mutation
});
// SCHEMA === the unmodified clone.

// ✅ Either mutate the original draft …
const SCHEMA = extendSanitizeSchema((s) => {
  s.tagNames!.push('my-tag');
});

// ✅ … or return the new object explicitly.
const SCHEMA = extendSanitizeSchema((s) => ({ ...s, ...overrides }));
```

### Trusting `def.url` from `useDocumentRegistry` without sanitizing

`Registry.resolveLinkDef(label).url` is the **raw** destination from the contributing chunk — the registry stores definitions unsanitized (since 2.4.3; earlier versions pre-filtered with the `'href'` key, which collapsed blocked and empty URLs and double-applied rewriting transforms). The library's own placeholders run the full two-gate check at render time with the correct attribute key. Anything that reads `def.url` directly — a backlink panel, analytics, dev tooling — must do the same before rendering it as an `href`/`src`; a chunk can define `[evil]: javascript:alert(1)`.

Defensive pattern:

```ts
// Synthesize a minimal hast Element for the call — urlTransform's signature
// requires a node, and most policies only read `node.tagName` / `node.properties`.
const syntheticNode = { type: 'element', tagName: 'img', properties: {}, children: [] } as const;

const def = registry?.resolveLinkDef(label);
if (def) {
  const safeUrl = myUrlTransform(def.url, 'src', syntheticNode); // your policy, correct key
  // …use safeUrl (an empty result means "blocked": omit the attribute)
}
```

### Throwing inside the `extendSanitizeSchema` modifier

The helper has no try/catch. A throw propagates uncaught to the call site. This is intentional — module-scope use means a thrown error surfaces at startup, which is the correct failure mode. But if you call `extendSanitizeSchema` from a render path (don't), a throw will crash the component.

### Forgetting that arrays in the schema are `readonly`-typed but mutable at runtime

The helper returns the upstream `Schema` shape, whose fields can be optional. A TypeScript error about a possibly undefined `protocols` or `href` requires initialization or a justified non-null assertion. It is unrelated to readonly typing: `!` removes `null`/`undefined` from the expression's type and cannot make a readonly array mutable.

```ts
const SCHEMA = extendSanitizeSchema((draft) => {
  draft.protocols ??= {};
  draft.protocols.href = [...(draft.protocols.href ?? []), 'myapp'];
});
```

The default draft already contains the usual protocol lists, so the shorter `draft.protocols!.href!.push('myapp')` also works with the current type and default schema. Use the expanded form when writing a reusable helper that may operate on other schemas.

## Final-element policy for cross-chunk references

The registry stores the raw destination so the consuming chunk can apply its own policy exactly once. At resolution, the engine builds the final `a` or `img`, normalizes its URL, applies the schema, rebases a hash destination, and then calls the URL transform. Since 2.12, that resolution also respects final-tag membership, allowed attributes, and ancestor constraints. Checking only `protocols.href` would miss those parts of the standalone policy.

Consequently, `urlTransform` may never see a URL that Gate 1 removed. It cannot restore a stripped attribute merely by allowing its protocol. If an entire link element is disallowed, the result can preserve its text or strip its contents according to the schema; an image has no equivalent text-child fallback. Test the final DOM shape, not only whether your callback ran.

The engine's private placeholder tags are also checked for provenance between raw-HTML expansion and sanitization. Authored `<cross-chunk-link>` or `<footnote-sup>` HTML is not a supported way to create a coordinated reference. The shipped renderer creates and verifies its own credential; ordinary React integrations do not configure it.

## Keep the policy boundary explicit

Schema customization replaces the supplied schema; the React adapter does not merge it with defaults afterward. `extendSanitizeSchema` starts you from the complete library schema, but returning a different object or deleting material can still remove its invariants. In particular, removing a `protocols` restriction is not the same operation as blocking all protocols on that attribute.

The default schema strips certain raw-text elements together with their content, including `script`, `style`, `title`, and `iframe`. KaTeX renders after sanitization, using the admitted math markers. A custom component or downstream HTML injection creates output outside that earlier sanitize pass. Assess such output at the point you introduce it.

For a policy regression check, cover an HTTP link, a relative path, a query containing a colon, a namespaced hash, your private scheme, a blocked scheme, and a legal empty destination. Repeat link and image cases in standalone and coordinated mode, and verify policy changes without changing Markdown source. This catches callback composition, attribute-key, and stale-cache errors independently.

Implementation: [`pluginChain.ts`](../../../../packages/engine/src/components/pluginChain.ts), [`extendSanitizeSchema.ts`](../../../../packages/engine/src/components/extendSanitizeSchema.ts), [`resolveCrossChunkReference.ts`](../../../../packages/engine/src/components/resolveCrossChunkReference.ts), and [`markdown/transform.ts`](../../../../packages/engine/src/components/markdown/transform.ts).

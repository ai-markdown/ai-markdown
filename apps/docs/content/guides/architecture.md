# Architecture Overview

## Interactive architecture snapshots

These two diagrams were generated with [Birdview](https://github.com/Qiuner/birdview) 0.2.1 on September 21, 2026, from an agent-authored map checked against source revision `b3473a473236ac643e26656897e0a12e5badb6e6`. They are documentation snapshots, not live dependency analysis or a required development workflow.

- [Product runtime architecture](../../public/architecture/birdview/runtime.html): the seven product modules and their runtime dependencies.
- [Development and delivery](../../public/architecture/birdview/development.html): examples, documentation, benchmarks, corpus and release tooling, with product packages shown as a single reference node.

Both viewers support Chinese and English and work offline. Use their language selector to switch the diagram content. The [source data and provenance](../../public/architecture/birdview/README.md) are retained alongside the HTML; viewing or building this documentation does not require Birdview. The source code and maintained explanation below take precedence if a snapshot becomes stale.

The repository separates Markdown computation from React and Vue rendering. `@ai-markdown/engine` owns normalization, parsing, tree transformation, incremental state, and document registries. The shared `@ai-markdown/core` adds pipeline sessions, block planning, contribution publishing, aggregate footnote HAST and smooth reveal coordination. `@ai-markdown/react` consumes those results as a React adapter, supplies contexts and slots, and manages render caches. `@ai-markdown/react-mantine` composes the React adapter's public API to provide Mantine typography and code/diagram UI.

Read this guide when tracing a rendering defect, changing an optimization, or building an integration. The important distinction is between an input changing, a syntax tree being recomputed, a block plan being rebuilt, and a React consumer rendering. Those are separate events with different dependencies. A context update need not reparse Markdown, and a successful incremental parse does not make all remaining work proportional to the latest token.

## Shared core and framework adapters

The legacy v2.14.1 release completed the private-runtime split. In stable 3.0.0, that implementation is the public `@ai-markdown/core`, while the React implementation is `@ai-markdown/react`. Core depends on engine; adapters declare both core and engine as exact-version external dependencies. Mantine is a peer-based integration over React. [The migration guide](framework-transition.md) lists consumer import and stylesheet changes.

Shared core owns computation sessions, not React lifecycle. `MarkdownContent` keeps one pipeline session and planner per instance, resets retained state on render-policy invalidation, and delegates parsing without moving registration into render. `useRegistryContribution` invokes the shared publisher only after commit. React still owns cached nodes, context subscriptions, SSR/hydration behavior (a hydration render reads no registry state, so a chunk whose Suspense boundary hydrates after its siblings still matches the server) and cursor DOM measurement. The [shared core module map](../../../../packages/core/README.md#responsibility-and-dependency-direction) is the source guide for this layer.

## Vue adapter

The current stable `@ai-markdown/vue` adapter uses the same pipeline sessions and contribution preparation as React. It does not use the block planner: the plan keys React's per-block render cache, and Vue instead converts each frame's whole HAST to VNodes and lets Vue's patcher diff the result. It keeps AST and registry identities outside deep reactive proxies, selects stable plugin/schema inputs through computed refs, and publishes only after mount. Registry notifications reach a chunk through identity-stable computeds (phantom targets and the resolved facts behind its placeholders), so a publish elsewhere in the document re-parses or re-renders a chunk only when something it waits on or shows has changed. VNode conversion clones HAST before final URL policy; resolved cross-chunk links/images use the shared resolver. SSR and initial hydration do not allocate registries. Vue 3.5 useId supplies stable automatic IDs, and DOM observers belong to the Vue cursor component. See the [Vue reference](../reference/vue.md) and [shared API contracts](api/core-engine-contracts.md).

## The React component tree

```text
<AIMarkdown>
  <AIMarkdownMetadataProvider>          ← Context for opaque user metadata
    <AIMarkdownProvider>                ← Four per-system contexts: document / state / theme / behaviors
      <Typography>                      ← Configurable wrapper (default | Mantine | custom)
        <ExtraStyles?>                  ← Optional CSS-scope wrapper
          <AIMarkdownContent>           ← The actual markdown renderer
            ↳ react-markdown (vendored) with remark/rehype pipeline
            ↳ block-level memoization
            ↳ cross-chunk placeholder resolution
        </ExtraStyles?>
      </Typography>
    </AIMarkdownProvider>
  </AIMarkdownMetadataProvider>
</AIMarkdown>
```

Each layer has a single, documented responsibility:

| Layer                          | Responsibility                                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `<AIMarkdown>`                 | Single-point flat-prop resolution against shipped defaults, preprocessing pipeline orchestration, the stability firewall            |
| `<AIMarkdownMetadataProvider>` | Isolate opaque user data from the render-facing contexts                                                                            |
| `<AIMarkdownProvider>`         | Hold the resolved document/state/theme/behaviors payloads (four contexts; state and behaviors merge outer additive-Provider groups) |
| `<Typography>`                 | Apply font-family, base font-size, theme class names; inject CSS custom properties via `style`                                      |
| `<ExtraStyles>`                | Optional CSS-scope wrapper (used by Mantine integration for em-based token overrides)                                               |
| `<AIMarkdownContent>`          | Vendor-forked react-markdown pipeline + block memoization + cross-chunk resolution                                                  |

---

## Why five contexts?

The resolved values are split into five per-system contexts — document, metadata, state, theme, behaviors — each with its own narrow hook (`useAIMarkdownDocument()`, `useAIMarkdownMetadata()`, `useAIMarkdownState()`, `useAIMarkdownTheme()`, `useAIMarkdownBehaviors()`), plus the aggregate `useAIMarkdown()` that subscribes to all five.

The split matches change frequency. **Metadata** (user callbacks, ids, app-level data) typically rebuilds every render — a parent rebuilding `metadata={{ onCopy, messageId }}` is normal React usage — so it lives alone and the markdown body doesn't subscribe to it. **`streaming`** is the most frequently flipping field in the library, so it lives in the state context and a flip wakes only `useAIMarkdownState()` subscribers. Theme values, behavior switches, and document identity change rarely and don't ride along with either.

If everything lived in one context (the v1.x render-state design), every metadata change or `streaming` flip would re-render every consumer. With the split, components re-render only when their own system changes, and block-level memoization stays effective.

See [Metadata Context](metadata-context.md) for the consumer-side implications.

---

## The render pipeline

The shipped path has a render phase and a commit phase. Parsing and planning compute the current output. Effects publish committed contributions to the cross-chunk registry, which can cause another render with newly available definitions.

```text
Raw accumulated content
  │
  ├─ built-in append-aware LaTeX normalization
  └─ caller string preprocessors, in order
  │
Preprocessed source
  │
  ├─ coordinated mode: scan own definition labels
  ├─ read currently registered labels / determine phantom suffix
  │
  ├─ full parse, or verified prefix + parsed/transformed tail
  │    remark parse → remark transforms → remark-rehype
  │    → raw HTML expansion → engine-tag provenance check
  │    → sanitize schema → footer adornment → hash rebasing
  │    → KaTeX → image unwrapping
  │
Full-document mdast + hast
  │
  ├─ plan blocks (reuse eligible retained prefix plans)
  ├─ render cache hits / convert misses to React elements
  │    URL transform runs during hast traversal for conversion
  └─ render local or aggregate footnotes and source-tail signal
  │
React commit
  └─ effects register the chunk and publish changed refs/defs
       → registry notifications → affected consumers render again
```

### Stage A: Content preprocessing

The React adapter creates one incremental LaTeX preprocessor per mounted instance and memoizes the preprocessing result by source and caller-preprocessor identity. The built-in function protects supported code regions, normalizes math delimiters, distinguishes currency, escapes math pipes, and truncates incomplete display-math tails where the grammar permits an opener. It runs independently of the `streaming` flag.

Caller preprocessors receive the normalized complete string and run in order. They can alter source positions and the append relationship between consecutive parser inputs. A source append does not guarantee a parser-input append if a preprocessor rewrites earlier text or removes a synthetic closer. See [content preprocessors](content-preprocessors.md).

### Stage B: Parse and transform

`buildCoreRemarkPlugins` defines the canonical order: GFM and math; selected highlight and definition-list syntax; breaks, emoji, paragraph squeezing and the two CJK parsing extensions; then selected comment removal, SmartyPants (preceded by the engine's CJK-aware quote pairing, so a straight quote beside CJK text is curled in the right direction before SmartyPants runs) and pangu transforms. The caller's `enginePlugins` array chooses membership, not ordering.

`remark-rehype` converts Markdown nodes to HTML nodes. Custom handlers preserve orphan footnote bodies when requested and emit coordinated reference placeholders when a registry is present. Phantom definitions allow the Markdown parser to recognize references whose definitions are currently supplied by another chunk. They are auxiliary parser input, not caller-authored content.

The rehype chain expands raw HTML, checks engine-placeholder provenance, sanitizes, normalizes footnote presentation, rebases hash links, renders KaTeX, and unwraps image-only paragraphs. Sanitization precedes KaTeX: the schema preserves the math marker classes that KaTeX consumes, not a full allowlist of the generated formula markup.

With incremental parsing enabled, `advanceIncrementalParse` owns both parse and transform. It may retain a verified prefix and run these stages only for the tail. On a failed gate or unsupported seam, it returns a full parse. The output contract includes node positions, because downstream cache keys and custom components can read them.

### Stage C: Cross-chunk contributions

The definition scan is coordinated-mode-only and append-aware. Registration and publication happen in effects, not during the syntax-tree calculation. The registration effect allocates the chunk symbol and records its ordering and own labels. A subsequent committed render can publish the parsed references and definition bodies under that symbol.

`useRegistryContribution` commits through a runtime contribution session, which compares a fingerprint of references, definitions, labels and phantom targets, together with the parse-policy dependency tuple. Equal contributions are not republished. Footnote bodies are harvested from post-pipeline hast so their math, raw HTML, and definition-list formatting survives aggregation. Link destinations enter the registry raw; the consuming renderer applies its own final-element policy.

### Stage D: Block planning

`buildBlocks` uses top-level hast and mdast attribution to build render items. It tracks source text, position, duplicate occurrence, reference dependencies, and special footer/inline output. Generated nodes without usable source positions cannot simply be discarded; raw HTML can also make one source block own multiple HTML siblings or swallow later source.

`createBlockPlanner` reuses plans only where retained mdast and hast node identities establish a compatible prefix. Reference-bearing prefixes can be reused, but their tail planning receives full-document reference context so ranks and occurrence counts remain correct. Raw HTML and definition regions use conservative complete planning. Top-level traversal remains proportional to the block count, and reference-context walks can still visit the full mdast.

### Stage E: Per-block render + memoization

The per-instance cache keys a rendered subtree by source identity, position and relevant context. The renderer builds a new live cache while consulting the previous one, so blocks removed from the new plan do not stay retained indefinitely. Output-policy changes invalidate the cache synchronously before it is read; waiting for an effect would allow one stale committed frame.

A hit returns a previously created React node. This skips JSX conversion for the unchanged block, but descendants remain ordinary React components: local state, context updates, or external-store subscriptions can still render them. Block memoization caches conversion work, not all future behavior of that subtree.

### Stage F: Per-attribute URL transform

The URL callback executes during the conversion traversal for a cache miss, before the resulting React element renders. It is not a separate pass after React has rendered the document. Gate 1 already filtered the tree through `rehype-sanitize`; Gate 2 receives the surviving URL attribute and can rewrite it.

Coordinated link/image placeholders resolve after the main tree's rehype passes, so their final `a` or `img` repeats the equivalent schema and URL-policy steps at resolution time. This includes tag/attribute/ancestor constraints and hash rebasing. The registry is shared data, not a shared permission policy; each consuming chunk uses its own props.

## `documentId` and clobber prefix

Markdown footnotes and hash links emit `<li id="…">` and `<a href="#…">` with auto-generated ids. Without namespacing, two `<AIMarkdown>` instances on the same page would collide:

```html
<!-- Message 1 -->
<a href="#user-content-fn-1">[1]</a>
<li id="user-content-fn-1">…definition A…</li>

<!-- Message 2 -->
<a href="#user-content-fn-1">[1]</a>
<!-- ← scrolls to message 1's footnote! -->
<li id="user-content-fn-1">…definition B…</li>
```

The fix: prefix every clobberable attribute with a per-document namespace. `<AIMarkdown>` accepts `documentId` (or generates one via `useId()`) and derives `clobberPrefix` from it:

```ts
clobberPrefix = `${encodeURIComponent(shortenDocumentId(documentId))}-user-content-`;
```

Long ids (>16 chars) are hashed via MurmurHash3 → Base62 before encoding, to keep the rendered HTML compact when consumers pass UUIDs/nanoids. The shortening only affects the rendered prefix — `useAIMarkdownDocument().documentId` retains the raw value, so registry keying and consumer code reading `documentId` see the original. Ill-formed UTF-16 ids (unpaired surrogates, e.g. from a string truncated mid-emoji upstream) are always hashed regardless of length — over their raw UTF-16 code units with a domain-separating seed — so they derive a valid prefix instead of throwing `URIError`, and distinct corrupted ids keep distinct prefixes (up to the same 2^32 hash bound long ids always had). The raw value in `useAIMarkdownDocument().documentId` is still untouched, and dev builds log a warning pointing at the upstream corruption.

**Chunks of the same logical document share `documentId`**, so their prefixes align. This is the bridge between [`<AIMarkdownDocuments>`](cross-chunk-coordination.md) and cross-chunk anchor navigation.

---

## The cross-chunk registry

Located at `packages/engine/src/components/documentRegistry.ts` (framework-agnostic; React re-exports its read-side public types). Key invariants:

1. **Per-`documentId` partitioning**. The wrapper holds a `Map<documentId, Registry>`. Each unique id gets its own registry.
2. **Symbol-keyed contributions**. Each chunk allocates a `Symbol(reactId)` on mount and contributes to the registry under that symbol. The symbol is the chunk's identity for the registry's lifetime.
3. **Refcount + microtask cleanup**. `releaseSymbol` decrements a refcount and schedules deletion via `queueMicrotask`. This survives React 19 Strict Mode (mount → unmount → mount within a frame) without losing the chunk's identity.
4. **Monotonic version counter**. A notifying mutation bumps `version`; global subscribers wake via microtask-coalesced fanout. Label subscribers compare indexed selector snapshots and wake only for their affected label.
5. **labelSet derivation**. `labelSet.{footnoteLabels, linkLabels}` is the union of own-def labels across all live chunks. Used by Stage B's phantom-def injection to know which orphan refs to protect.
6. **Last-chunk eviction**. When the final chunk releases its symbol and the registry becomes empty, an `onEmpty` callback fires, removing the registry from the wrapper's Map. The next mount with the same id allocates a fresh registry. Registry and smooth-coordinator caches use weak references, so allocations from abandoned renders do not remain strongly owned by the wrapper. Mounted consumers retain live scopes; finalization removes collected cache keys with an identity guard.

The `Registry` interface exposes only read methods + selectors. Mutators (`registerChunk`, `allocateSymbol`, `releaseSymbol`, `contributeLabels`, `contributeChunkData`) live on the internal `RegistryInternal` interface, which is **not** re-exported from the package barrel. Consumer code can't directly drive the registry — only the renderer can.

---

## Block memoization invariants

Shared planning and fingerprints live in `packages/core/src/blockPlan.ts` and `blockPlanner.ts`; React node caching stays in `packages/react/src/components/blockMemo.ts`. Plan items use framework-neutral `key` values. The invariants:

1. **Planning is hast-driven with mdast attribution.** Only actual HTML-side output becomes a render item. Positions, ranges, generated nodes and raw-HTML ownership determine how that output maps to source; do not assume every mdast child produces exactly one element.
2. **Two-tier offset lookup**. Position metadata (`startOffset`, `startLine`) goes into the cache key so identical content at different positions doesn't false-cache.
3. **Swap-and-discard semantics**. The plan is rebuilt every render; the prior cache is consulted by key, then discarded blocks are dropped.
4. **Synchronous dependency invalidation.** The main G3 check compares 12 render-policy dependencies; a separate orphan-policy check also clears affected cached output. The important invariant is timing: invalidate before this render reads cached nodes.
5. **`globalCtx` is the union of ref/def contributors.** Tainted blocks include this in their cache key.

These invariants are enforced by tests (`byteEquivalence.test.tsx` is the harness that verifies byte-identical output across every plugin permutation and `blockMemo` on/off).

Before changing planning or rendering, read the [shared core contracts](../../../../packages/core/README.md#planning-and-rendering-contracts). They document cache identity, ownership and commit timing; no untracked local design file is required.

---

## Sanitization architecture

The library default schema deep-clones and freezes an extension of `rehype-sanitize`'s `defaultSchema`. Its renderer-specific material includes:

- The `<mark>` tag for `==highlight==`.
- `math-inline` and `math-display` classes on `<code>` (the markers `remark-math` emits before `rehype-katex` consumes them). KaTeX's own output classes (`katex`, `katex-html`, …) are not in this allowlist — they survive because `rehype-katex` runs after `rehype-sanitize` in the rehype chain.
- Cross-chunk coordination tags: `cross-chunk-link`, `cross-chunk-image`, `footnote-sup`.

Hand-rolling a schema via `{ ...defaultSchema, … }` silently drops these. `extendSanitizeSchema` always works on a deep clone of the **library**'s default (not `rehype-sanitize`'s), so the additions survive.

The library default is **not** exported as a value from `@ai-markdown/react` — only the helper. This prevents the shallow-spread footgun by construction on the consumer-facing surface: there's no `sanitizeSchema` constant in the core API to shallow-spread _from_. (`@ai-markdown/engine` does export the singleton, because core builds its pipeline from it; it is deep-frozen; use the extension helper to obtain a mutable independent draft.)

See [URL Sanitization & Custom Schemes](url-sanitization.md) for the two-gate model.

---

## The Mantine integration

`@ai-markdown/react-mantine` is a thin wrapper that:

1. Ships the `codeBlock` behavior group (`defaultExpanded`, `autoDetectUnknownLanguage`, `languageFormat`, `formatJson`, `expandNestedJson`, `highlightIntervalMs`, `mermaidIntervalMs`) — contributed through the additive `AIMarkdownBehaviorsProvider`, read via `useMantineCodeBlockOptions()`.
2. Provides `MantineAIMarkdownTypography` (uses Mantine's `<Typography>`).
3. Provides `MantineAIMDefaultExtraStyles` (CSS scoping for em-based Mantine token overrides).
4. Overrides `customComponents.pre` with `MantineAIMPreCode` (CodeHighlight + Mermaid + JSON pretty-print), which identifies unlabelled blocks with `@ai-markdown/code-language-detector` when `autoDetectUnknownLanguage` is on.
5. Auto-detects the color scheme from Mantine's provider (`useMantineColorScheme`), resolving `auto` against the system query with `useSyncExternalStore` so the first client frame is already correct.

Every one of these uses **public** extension points from core. No internal access. See [Extending via a Sub-package](extending-via-subpackage.md) for the template.

---

## React 19 specifics

- `useId()` powers the auto-generated `documentId` — SSR-safe, stable across re-renders, distinct per component instance.
- React 19's Strict Mode double-mount semantics are handled by the microtask-deferred cleanup in `documentRegistry` (releaseSymbol → microtask → identity check → maybe delete).
- React 19 is the declared peer requirement. The implementation also uses `useSyncExternalStore` for registry/controller subscriptions and `useInsertionEffect` for cursor styles; the presence of an older Hook is not evidence of support for an older React major.

---

## Why a vendored `react-markdown`?

The library imports `react-markdown` as an internal module, split along the engine boundary: the pure pipeline half (processor, transform, the parse/transform stages) lives in `packages/engine/src/components/markdown/`, and the React half (`renderHastSubtree`, the `<Markdown>` component) stays in `packages/react/src/components/markdown/`. This is a vendored fork: source is bundled and adapted for the library’s needs, with the repository’s attribution retained:

- Block-level memoization needs control over the conversion stage (`toJsxRuntime`) that the upstream component encapsulates.
- The pipeline is exposed as **three independent stages** (parse, plan, render) so block memoization can intercept between stages.
- Cross-chunk placeholder elements need custom handlers in the mdast → hast conversion that aren't available on the upstream component.

The fork is intentional and the surface area is small. Consumers don't need to install `react-markdown` themselves — the library's wrapper is the only required dependency.

---

## Module layout

```text
packages/engine/src/                ← @ai-markdown/engine (framework-agnostic)
├── index.ts                    ← explicit public algorithm exports for core and adapters
├── plugins/
│   ├── catalog.ts              ← the five sealed engine plugins + defaultEnginePlugins
│   └── defs.ts                 ← AIMarkdownEnginePlugin type + seal brand
├── preprocessors/
│   ├── index.ts                ← preprocessing pipeline orchestrator
│   ├── defs.ts                 ← AIMDContentPreprocessor type
│   ├── latex.ts                ← built-in LaTeX normalizer
│   └── remend.ts               ← remend streaming-repair preprocessor
├── fixtures/                   ← shared streaming payload fixtures (tests + stories)
├── experiments/prefixFreeze/   ← freeze-boundary measurement study
└── components/
    ├── incrementalParse/       ← splice engine + arbiter harness + fuzz batteries
    │   ├── computeFreezeBoundary.ts ← resume orchestration and boundary selection
    │   ├── freezeScanState.ts / freezeLineSyntax.ts / freezeLineTransition.ts
    │   ├── spliceParse.ts       ← splice orchestration and fallback order
    │   └── prefixInjection.ts / spliceCoordinates.ts / spliceHtmlGuards.ts / prefixAlignment.ts
    ├── markdown/               ← pure pipeline half of the vendored react-markdown
    │                             (processor, transform, parse/transform stages)
    ├── smoothStream/controller.ts ← framework-agnostic pacing controller
    ├── pluginChain.ts          ← remark/rehype chain assembly
    ├── collectDefLabels.ts     ← def-label scanner
    ├── extractDefBodiesFromHast.ts / extractContributions.ts
    ├── documentRegistry.ts     ← cross-chunk shared state (pure data structure)
    ├── sanitizeSchema.ts       ← library default schema
    ├── extendSanitizeSchema.ts ← public schema-extension helper
    ├── crossChunkUrlSanitize.ts ← cross-chunk URL filter
    ├── customMdastHandlers.ts  ← mdast → hast handlers (phantom defs, footnote sup, …)
    ├── rehypeRebaseHashLinks.ts / rehypeFooterAdorn.ts
    ├── remarkInjectPhantomDefs.ts
    ├── hastPredicates.ts       ← shared hast detection helpers
    ├── normalizeId.ts / shortenDocumentId.ts / devStageTimings.ts
    └── …
```

```text
packages/core/src/                 ← @ai-markdown/core (framework-independent)
├── index.ts                       ← explicit public orchestration exports
├── coordinationPreparation.ts     ← phantom targets and shared policy decisions
├── pipelineSession.ts             ← one consumer’s parse session
├── blockPlan.ts / blockPlanner.ts ← neutral plan and retained-plan reuse
├── contribution.ts                ← committed publication
├── aggregateFootnotes.ts          ← aggregate footer HAST
├── cloneHastForRender.ts           ← render-owned structural clone
├── smoothCoordinator.ts           ← document reveal queue
└── tailSignal.ts                  ← source-tail classification

packages/vue/src/                  ← @ai-markdown/vue (Vue 3.5)
├── index.ts                       ← components, composables and shared helpers
├── AIMarkdown.ts                  ← props and Vue lifecycle
├── useMarkdownChunk.ts            ← per-chunk session/planner integration
├── documents.ts                   ← provider and document scopes
├── render.ts                      ← HAST to VNodes, components and slots
├── smooth.ts                      ← smooth component and composables
├── cursor.ts                      ← DOM cursor and observer lifecycle
├── types.ts                       ← public props and element context
└── styles.css                     ← base presentation
```

```text
packages/react/src/                  ← @ai-markdown/react (React)
├── index.tsx                   ← <AIMarkdown> + public API re-exports
├── defs.ts                     ← prop payload types, variant/scheme types
├── resolveFlatProps.ts         ← single-point flat-prop resolution vs shipped defaults
├── context.tsx                 ← five contexts + narrow hooks + additive Providers
├── define.ts                   ← defineTheme / defineBehaviors / definePipeline factories
├── plugins/index.ts            ← /plugins subpath (re-exports the engine catalog)
├── hooks/
│   ├── useStableRecord.ts      ← stability firewall (table-driven, policy per prop)
│   ├── useStableValue.ts       ← deep-equal reference stabilizer
│   └── useReferenceFlipWarning.ts ← dev-only identity-flip detector
├── components/
│   ├── MarkdownContent.tsx     ← the actual markdown renderer
│   ├── markdown/               ← React half of the vendored react-markdown
│   │                             (renderHastSubtree, <Markdown>)
│   ├── typography/             ← default typography variant
│   ├── blockMemo.ts            ← block-level memoization
│   ├── AIMarkdownDocuments.tsx ← cross-chunk wrapper (React shell over the registry)
│   ├── crossChunkPlaceholders.tsx ← placeholder element renderers
│   ├── streamingCursor/        ← streaming cursor feature
│   └── smoothStream/           ← useSmoothStream / useDocumentSmoothStream / coordinator
└── typings/                    ← ambient type shims
```

```text
packages/react-mantine/src/
├── index.tsx                   ← barrel
├── defs.tsx                    ← codeBlock group type + shipped defaults, metadata type
├── define.ts                   ← defineMantineBehaviors (widened factory)
├── MantineAIMarkdown.tsx       ← wrapper component (firewall + behaviors Provider)
├── components/
│   ├── typography/
│   │   └── MantineTypography.tsx
│   ├── extra-styles/
│   │   └── DefaultExtraStyles.tsx
│   └── customized/
│       └── PreCode.tsx          ← CodeHighlight + Mermaid + JSON
└── hooks/
    ├── useMantineCodeBlockOptions.ts
    └── useMantineAIMarkdownMetadata.ts
```

`packages/remark-mark-highlight` is the independently versioned remark plugin consumed by engine, the sixth public package. `packages/code-language-detector` is the independently versioned, dependency-free language detector consumed by react-mantine, the seventh public package. `packages/react/plugins` is only an export subpath.

Storybook apps live in `apps/storybook-{hub,react,vue}`, with shared helpers in `tooling/storybook-kit`. Those workspaces, the corpus, benchmarks and archived prototypes are private. See [development commands](development-commands.md) for package-filtered builds and tests.

## Package boundary and verification ownership

Engine and core expose documented public adapter contracts that follow semantic versioning from 3.0.0. Core pins the engine to its exact release-train version. A React design-system wrapper should import the React adapter's stable props, hooks and helper re-exports. A non-React adapter that imports engine primitives owns the assembly and validation of its pipeline.

The principal verification layers answer different questions:

| Layer                              | Question                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| Core byte-equivalence tests        | Does memoized standalone rendering match the non-memoized path?                       |
| Engine splice equivalence          | Do incremental mdast/hast, including positions, match a fresh full parse?             |
| Boundary direction and conformance | Can an accepted prefix change under a later hazard?                                   |
| Sensitivity / anti-vacuity checks  | Would a planted error be caught, and did the optimization actually run?               |
| Browser stories                    | Do contexts, cursor placement, queues and DOM output work through real React commits? |
| Browser benchmarks                 | What cost and responsiveness does a particular workload exhibit?                      |

A performance measurement is not an equivalence proof, and a green equivalence test is not a bound on latency. Current release verification is described in [soak coverage](soak-coverage.md); historical experiments retain the evidence and limitations of their original measurements.

## Where to investigate a defect

For a changed character, inspect preprocessing before the parser. For a different node shape, compare full and incremental parse output before React conversion. For a stale element after a policy or definition update, inspect block-context keys, synchronous invalidation, and contribution fingerprints. For correct trees but unexpected UI, inspect the custom component and the contexts it subscribes to.

Keep the original accumulated frame sequence when reporting a stream defect. Two streams with the same final text can take different intermediate boundaries; a final document alone may not reproduce a seam error. Include plugin selection, schema, preprocessors, `documentId`, chunk order, and whether the behavior survives `incrementalParse={false}`. Do not disable `blockMemo` when testing whether coordinated output is equivalent: that changes the coordination path itself.

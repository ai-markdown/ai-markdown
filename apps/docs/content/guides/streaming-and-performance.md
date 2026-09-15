# React streaming and performance

The `blockMemo` prop, hooks and profiling examples below are React-specific. Vue shares the incremental engine and core pipeline/contribution sessions. It does not use the block planner or React’s per-block render cache: each frame’s HAST is converted to VNodes and Vue’s patcher compares the result. See the [Vue guide](../reference/vue.md#component-props) and [package setup](getting-started.md).

Streaming repeatedly renders a growing Markdown document. Engine provides append-aware preprocessing and verified incremental parsing; React uses the shared core block planner and caches rendered React nodes. The `streaming` prop describes lifecycle state; it does not enable those optimizations. `blockMemo` and `incrementalParse` are both on by default.

This guide explains which work each mechanism saves and which changes invalidate it. It also covers cross-chunk costs, stable prop references, profiling, and the Mantine code-display cadence. The goal is to identify the expensive stage in your workload rather than infer performance from a flag or from a single historical benchmark.

## The streaming flag

```tsx
<AIMarkdown content={chunk} streaming={!done} />
```

`streaming` is a plain boolean exposed via the `useAIMarkdownState()` narrow hook. The React adapter uses the flag to mount the cursor slot and expose a source-tail signal; custom components can also read it. Mantine uses it for code-display scheduling and diagram/language-detection behavior. The parser optimization gates are separate.

Since the v2 context split, a `streaming` flip wakes **only `useAIMarkdownState()` subscribers** — components that read other narrow hooks (`useAIMarkdownTheme()`, `useAIMarkdownBehaviors()`, …) no longer re-render on stream start/end. The aggregate `useAIMarkdown()` subscribes to all five contexts and _does_ re-render on every flip; keep it out of per-block components.

### Common uses

```tsx
import { useAIMarkdownState } from '@ai-markdown/react';

function CodeWithCopy({ children, onCopy }: { children?: React.ReactNode; onCopy: () => void }) {
  const { streaming } = useAIMarkdownState();
  return (
    <div>
      {!streaming && (
        <button type="button" onClick={onCopy}>
          Copy
        </button>
      )}
      <pre>{children}</pre>
    </div>
  );
}
```

- **Hide interactive UI while streaming** — copy buttons, edit buttons, expand buttons. Mid-stream code is rarely actionable.
- **Show typing/streaming cursor** at the end of partial content. The cursor element receives `display: inline-block` and a CSS blink animation; toggled off when `streaming === false`.
- **Skip animations** during streaming — e.g. Mermaid diagrams fade in only after streaming completes; mid-stream renders show source.
- **Defer heavy rehydration** — components that produce side effects (analytics, route prefetch) can skip while content is mutating.

### What `streaming` does NOT do

It does **not** alter the parsing pipeline. The same remark/rehype plugins run; the same sanitization applies. Block-memoization is on whether or not `streaming === true`. It does not select a different Markdown grammar. Lifecycle-driven UI, including the cursor and Mantine code handling, can still change when the flag changes.

---

## Block-level memoization

When `blockMemo` is `true` (the default), the rendering pipeline:

1. Parses the markdown to **mdast** (Markdown AST) and **hast** (HTML AST) in one unified pass.
2. Splits the hast into per-block units — each top-level child that maps 1:1 with an mdast block (paragraphs, headings, code blocks, lists, tables, …) plus an optional synthetic footnote section.
3. Memoizes each block's React subtree, keyed by:
   - `raw` (the source text of the block)
   - `occurrence` index (for blocks with identical text — e.g. multiple `---` HRs)
   - `ctx` digest (for blocks that depend on cross-block syntax like footnote refs / link defs)
   - `startOffset` and `startLine` (so identical content at different positions don't false-cache)

A cache hit returns the existing `ReactNode` and skips its hast-to-JSX conversion. Unchanged element identity reduces reconciliation work, while descendants can still update through local state, context, or an external-store subscription. Output is **byte-identical** to the disabled path.

### What invalidates a block

| Change                                                                   | Affects                                               |
| ------------------------------------------------------------------------ | ----------------------------------------------------- |
| Block's raw text changes                                                 | Just that block                                       |
| Block's position changes (lines/offset shift due to insertion before it) | Each repositioned block (position is part of the key) |
| `customComponents` reference changes                                     | All blocks                                            |
| `urlTransform` reference changes                                         | All blocks                                            |
| `sanitizeSchema` deep-equal changes                                      | All blocks                                            |
| Footnote/link/image definition or reference added/removed anywhere       | All blocks containing refs/defs (via `ctx` digest)    |
| Standard prose block (no refs/defs)                                      | Unaffected by ref/def changes elsewhere               |

The last point is the key win: in a chat document with a footnote at the end, typing into the body **doesn't** invalidate the footnote block's cache, and adding the footnote at the end **doesn't** invalidate prose blocks that don't reference it.

### Disabling block memoization

Set `blockMemo={false}` to opt out:

```tsx
<AIMarkdown content={c} blockMemo={false} />
```

Output is **structurally** unchanged for standalone use. Performance regresses to a full pipeline pass on every render. Useful for:

- Debugging — if you suspect a custom remark/rehype plugin interacts badly with the plan abstraction (rare), this is the escape hatch to confirm.
- Environments where the `useRef`-backed cache is undesirable.
- A/B comparing cost.

In production for streaming workloads: **leave it on**.

> ⚠️ **Cross-chunk coordination requires `blockMemo` to stay `true`.** When the flag is `false`, the renderer takes the legacy path which **does not wire `Registry` through**. Wrapping `<AIMarkdown>` in `<AIMarkdownDocuments>` while keeping `blockMemo={false}` silently degrades — cross-chunk references remain unresolved with standalone semantics and the document-wide aggregate footer is not produced. If you need cross-chunk behavior, keep block memoization enabled (the default).

---

## Incremental parse (prefix-freeze)

> The `incrementalParse` prop (v1.x: `config.incrementalParseEnabled`) — default `true` since v1.8.0 (opt-in and experimental before that). Effective only when `blockMemo` is `true`.

Block memoization removes re-_render_ work, but `unified.parse` still runs over the **full document** every streaming frame — for long documents the parse/transform stages dominate the per-token budget (see Profiling below). Incremental parsing attacks exactly that: when content grows by appends (the normal streaming shape), the renderer freezes the **stable prefix** of the document at a verified-safe boundary, re-parses only the tail, and splices the previous frame's trees with the tail's.

```tsx
// On by default — pass `false` only as an escape hatch:
<AIMarkdown content={content} streaming={!done} incrementalParse={false} />
```

### The freeze boundary

A boundary is the last **confirmed blank line** (its terminating newline must exist — a trailing partial line may still receive characters) outside fenced code, additionally blocked by:

- **Unbalanced raw HTML / open `<!--` comment** — an unclosed container makes rehype-raw reparent every later sibling into it (the v1.5.1 swallow class), so prefix _text_ stability does not imply prefix _output_ stability.
- **Open `$$` flow math** — remark-math swallows blank lines until the closing delimiter.
- **List / footnote-definition / definition-list continuation context** — CommonMark lists are not terminated by blank lines (not even two); later indented lines retroactively extend them. With the `definitionList` plugin enabled, a `: description` line can additionally claim the paragraph above it **across one blank line**, so a single-blank candidate only settles once the next line is confirmed unable to become a `: ` line.
- **Reference taint** — micromark resolves reference-ness at parse time: a late `[label]:` (or `[^label]:`) definition retargets earlier literal `[text]`. Every reference-style candidate in the prefix — link, image, and footnote alike — must resolve against a _settled_ definition (one already followed by a blank line). Labels match with micromark's own Unicode case folding; link and footnote labels are separate namespaces.

The splice runs the tail through the same plugin chain and re-bases tail positions into document coordinates. Prefix link/image definitions are re-injected in front of the tail so its references still resolve, then stripped from the output. **Footnotes splice too** (v2): footnote numbering, footer membership/order, and backref ids are whole-document state inside mdast-util-to-hast, so the engine replays the prefix's footnote **event sequence** (definitions and references ×occurrence, in document order) at the tail head — the tail run's handlers rebuild that state exactly and regenerate the complete document footer, whose positions are then rewritten back into document coordinates (injected-def segments map per segment; tail-native ones take the ordinary shift). Sanitize-stripped prefix nodes (HTML comments, `<?…?>`, `<script>`) are handled by a separator-alignment model rather than a fallback. The contract — enforced by a dedicated falsification suite (`spliceEquivalence.test.ts`), not assumed — is that the spliced `{mdast, hast}` is **deep-equal, positions included**, to a full parse of the same content. Block-memo cache keys are position-based, so the two optimizations compose: frozen blocks stay cache hits.

**Cross-chunk mode** (`<AIMarkdownDocuments>`) is eligible too (v2): each chunk's registry-driven phantom-definition suffix is handed to the engine as an always-tail input — the append gate and boundary scan see the chunk's own text alone, so phantom churn (labels arriving/leaving as sibling chunks stream) re-parses only the tail. Refs resolved by phantoms can never freeze (their definitions are never in the chunk's own text, so the reference taint keeps them tail-side), which is what makes suffix churn safe by construction.

### Automatic fallback (when the flag does nothing)

Every frame re-checks a gate chain; any failure silently takes the ordinary full-parse path for that frame — output is always identical either way:

| Condition                                                                           | Why                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content change is not a pure append                                                 | Includes Stage-A preprocessor rewrites near the stream end (e.g. unclosed-`$$` truncation, or an active tail-repair preprocessor closing `**bold` — see [content preprocessors](content-preprocessors.md)) |
| No freeze-safe boundary yet                                                         | e.g. one giant paragraph, an open fence/container since the start, or an unresolved reference pinning the taint                                                                                            |
| A definition nested in a container (`> [a]: /url`, `> [^x]: …`) spanning the prefix | Its source cannot be re-injected verbatim with column fidelity — the frame full-parses (`uninjectable`)                                                                                                    |
| The prefix/tail hast layout falls outside the separator-alignment model             | Defensive escape hatch; the arbiter keeps the modeled set honest                                                                                                                                           |
| Plugin arrays / handlers / `documentId` changed identity                            | The engine's own deps check — wider than the block-memo cache flush                                                                                                                                        |

SSR always takes the full path (per-request state starts empty), so server output is untouched by the flag.

### Measured effect

On the Storybook benchmark payloads, the freeze boundary covers ~73–87% of realistic LLM streaming content, cutting the parse+transform stages to roughly the tail's share. Measured in a real browser (see [Benchmark](benchmark.md) for full tables and methodology): **83–94% less pipeline stage time in the historical July 2026 runs** — footnote-bearing payloads included since v2 (84% with the defs tail on, identical to plain payloads) — and with both flags on, 16×-payload p50 commit time drops from 32.4 ms to 7.5 ms. Coordinated documents measure smaller (26% at 1× — short per-chunk documents, cross-references pinned by design) and scale the same way. Use the `IncrementalParseCompare` / `BoostCompare` / `CrossChunkIncrementalCompare` stories to measure your own payloads.

### Footguns

- **Boundary advancement lags one frame by design.** The splice boundary is `min(current, previous frame's)` — the previous boundary is the one whose stability the falsification property actually guarantees for the previous frame's trees. Don't "optimize" the `min` away: a shortcut reference rendered literal last frame must not be frozen the moment its definition arrives.
- **Unresolved references pin the boundary.** A `[text]` or `[^note]` whose definition hasn't arrived (and settled behind a blank line) holds the boundary below it — everything after re-parses each frame until it settles. In cross-chunk mode, refs to labels defined in OTHER chunks stay pinned permanently (their definitions never appear in this chunk's text); that is the correctness mechanism, not a bug — but it means chunks that open with a cross-reference see little splice benefit.
- The tail re-parse still costs O(tail); a document that never emits a blank line degrades gracefully to full parses.
- **Very long GFM tables parse quadratically, and a streaming table is one block.** The upstream table tokenizer (`micromark-extension-gfm-table` 2.1.1, pulled in by `remark-gfm`) rebuilds its event list per row, so parse time grows with the square of the row count. Measured in this repository with plain `remark-parse` + `remark-gfm` (Node 24, no ai-markdown code involved): 500 rows 69 ms, 1000 rows 151 ms, 2000 rows 533 ms, 4000 rows 2.1 s. The freeze boundary cannot split a table, so while a table is still streaming every appended row re-parses the whole table. The cost you see depends on row count, append cadence and device: at 500 rows each streamed row already re-parses for ~70 ms on a desktop CPU. If a model can emit long tables, split them into separate messages or documents (`<AIMarkdownDocuments>` chunks each parse only their own table) or paginate on the application side. The engine does not work around this upstream behaviour.

---

## Reference stability across props

Block-memoization treats several props as cache dependencies. A new identity on any of them invalidates the entire document cache:

| Prop                   | Stability-firewall policy                      | Best practice                                         |
| ---------------------- | ---------------------------------------------- | ----------------------------------------------------- |
| `content`              | Not in the table — strings deep-equal by value | Plain string, no special handling                     |
| `customComponents`     | `DEEP_EQUAL` backstop                          | Module scope or `useMemo` for zero-overhead           |
| `contentPreprocessors` | `WARN_ONLY` — function array can't be compared | Module scope or dependency-correct memoization        |
| `urlTransform`         | `WARN_ONLY` — functions can't be deep-compared | Module scope or dependency-correct memoization        |
| `sanitizeSchema`       | `DEEP_EQUAL` backstop                          | Module scope **recommended**                          |
| `enginePlugins`        | `DEEP_EQUAL` (elements are module singletons)  | Module scope                                          |
| `metadata`             | `PASS_THROUGH` — deliberately exempted         | Doesn't affect block-memo (lives in separate context) |

(Policies come from the React adapter's `useStableRecord` table — the single stabilization boundary; see [Extending via a Sub-package](extending-via-subpackage.md) for how wrappers reuse it.)

### The function-valued exception (`urlTransform`, `contentPreprocessors`)

The `WARN_ONLY` rows have no safety net. Function identity can't be deep-compared (two closures with identical bodies are always non-equal), so an inline `urlTransform={(url) => …}` discards the entire cache on every parent render — and unlike the deep-equal'd props, there's no recovery.

```tsx
// ⚠️ Effectively disables block memoization for the whole document.
function MyApp() {
  return <AIMarkdown content={c} urlTransform={(url) => (/^myapp:/.test(url) ? url : '')} />;
}

// ✅ Module scope — stable, cache stays warm.
const URL_TRANSFORM: UrlTransform = (url, key, node) =>
  key === 'href' && /^myapp:/i.test(url) ? url : defaultUrlTransform(url, key, node);
function MyApp() {
  return <AIMarkdown content={c} urlTransform={URL_TRANSFORM} />;
}
```

Development builds emit a rate-limited `console.warn` after 3+ identity flips on a `WARN_ONLY` prop (and after 3+ deep-equal _restores_ on a `DEEP_EQUAL` prop — the caller is inlining objects and paying one comparison per frame). The warnings are dead-code-eliminated in production.

---

## The `useStableValue` hook

```ts
function useStableValue<T>(value: T): T;
```

Returns a referentially stable version of `value` by deep-comparing (via lodash `isEqual`) against the previous render's value. If equal, the previous reference is returned; otherwise the new value is captured.

Use it when you can't memoize a complex prop at the parent and want to break a chain of unnecessary re-renders downstream:

```tsx
import { useStableValue } from '@ai-markdown/react';

function MyChat({ rawMeta }: { rawMeta: ChatMeta }) {
  const stableMeta = useStableValue(rawMeta);
  // stableMeta keeps the same reference across renders as long as rawMeta is deep-equal.
  return <AIMarkdown content={c} metadata={stableMeta} />;
}
```

Cost: an `isEqual` on every render. Cheap for small objects; not cheap for arbitrary blobs. Don't apply blindly — use the existing reference if it's already stable.

---

## Streaming patterns

Two main approaches, named consistently with [Streaming chat: end-to-end](streaming-chat-example.md):

### Approach A — single `<AIMarkdown>` with growing content

```tsx
function GrowingMessage({ content, done }: { content: string; done: boolean }) {
  return <AIMarkdown content={content} streaming={!done} />;
}
```

Simpler and usually faster — one instance, one cache, no wrapper. Use this when you control content assembly upstream of `<AIMarkdown>` and don't need to virtualize chunks. **Start here unless you have a concrete reason to chunk.**

### Approach B — chunked, with `<AIMarkdownDocuments>`

```tsx
<AIMarkdownDocuments>
  {chunks.map((chunk, i) => (
    <AIMarkdown key={i} content={chunk} documentId={messageId} streaming={!done && i === chunks.length - 1} />
  ))}
</AIMarkdownDocuments>
```

Each chunk has its own block-memo cache. Cross-chunk references coordinate via [`<AIMarkdownDocuments>`](cross-chunk-coordination.md). Use when virtualizing, when the server emits logical chunks, or when each chunk needs its own metadata.

### Variant: streaming cursor

```tsx
import AIMarkdown, { AIMarkdownStreamingCursor } from '@ai-markdown/react';

function StreamingMessage({ content, done }: { content: string; done: boolean }) {
  return <AIMarkdown content={content} streaming={!done} streamingCursor={AIMarkdownStreamingCursor} />;
}
```

The `streamingCursor` slot renders the given component after the content while `streaming === true` and unmounts it when streaming ends. The built-in `AIMarkdownStreamingCursor` positions an indicator right after the **last rendered character**, entirely at the DOM layer — the markdown source, the parse pipeline, and the block-memo cache are untouched, so incremental parsing keeps its append gate and no block is invalidated by the cursor.

**Full documentation: [Streaming cursor](streaming-cursor.md)** — hide conditions, the custom-indicator contract, stall behavior, RTL/SSR/chunked-mode details, known boundaries, and footguns. What matters for _this_ document is the performance contract: the slot component is compared by identity (define it at module scope, like `Typography`), and the cursor adds zero work to the parse/memoization pipeline.

> ⚠️ **Do not append a cursor character to `content`** (the `content + '▍'` pattern previously documented here). It defeats incremental parsing on every frame — `c1 + '▍'` → `c1 + delta + '▍'` is never a pure append, so the engine silently falls back to a full parse — and the character can land inside unclosed math or mermaid fences, corrupting their source.

---

## Profiling

Separate these stages when profiling; their cost depends on which paths are eligible:

1. Parsing and transforming — the full source on a fallback, or the unfrozen tail on a successful splice.
2. Walking mdast/hast to build the block plan — proportional to number of blocks.
3. Constructing React elements for cache misses, then React updates and browser layout. A small source delta can change a large block or reference context.

That is the full-parse baseline, not the complete current cost model. Incremental parsing can reduce (1) to the active tail, and retained-prefix planning can reduce repeated per-block work in (2). Top-level traversal, some reference-context walks, caller preprocessing, registry notifications, React work, and layout remain. A single growing paragraph can keep most of the source in the active tail.

If profiling shows `<AIMarkdown>` as the bottleneck:

1. Check that `customComponents`, `urlTransform`, `sanitizeSchema`, `enginePlugins`, `contentPreprocessors` are all module-scope or stable. Inline props are the most common cause of perf regressions.
2. Compare `incrementalParse={false}` first while keeping memoization enabled. Use `blockMemo={false}` only as a standalone diagnostic: it also disables incremental parsing and coordination, so it changes more than one variable.
3. Profile with React DevTools — a tree with most blocks under "Did not render" is healthy.

### Built-in stage timing (dev builds only)

In development builds, the block-memo render path emits one
[`performance.measure`](https://developer.mozilla.org/docs/Web/API/Performance/measure)
entry per pipeline stage per content change, named:

```
ai-markdown:stage:scan       # incremental-parse boundary detector (only when
                             # incrementalParse routes through the engine)
ai-markdown:stage:parse      # unified.parse — full document, or TAIL-ONLY when
                             # incremental parsing spliced this frame
ai-markdown:stage:transform  # remark/rehype transformer run (same full/tail split)
ai-markdown:stage:build      # block-plan construction
ai-markdown:stage:render     # per-block render with cache lookup
```

This is how to answer "which stage eats the budget" without guessing —
the numbers map 1:1 onto the (1)/(2)/(3) split above. Two supported ways
to read them:

- **DevTools Performance panel**: record a session; the measures appear in
  the User Timing track. No wiring needed — emission is always on in dev,
  which is a deliberate choice traded against a few `performance.*` calls
  per token.
- **A live `PerformanceObserver`** for `entryTypes: ['measure']`, filtering
  by the `ai-markdown:stage:` prefix (the built-in Storybook benchmark's
  "Pipeline stages" panel does exactly this).

Delivery semantics to know before wiring your own reader: each entry is
**cleared from the global User Timing buffer immediately after emission**,
so the buffer never grows from render work. Already-registered observers
still receive every entry (delivery is queued at creation), but
`performance.getEntriesByType('measure')` from the console and
late-attached `buffered: true` observers will see nothing — attach your
observer before streaming starts. Production builds emit nothing and pay
one boolean check per stage.

### Validating output equivalence

If you suspect `blockMemo` enabled is producing different output than disabled, the library's test suite includes a `byteEquivalence.test.tsx` harness that asserts byte-identical HTML across every plugin permutation. Failures should be reported as bugs.

---

## Footguns

### Per-render closure-as-prop

Already covered above for `urlTransform`. The same anti-pattern applies to any prop with reference identity:

```tsx
import AIMarkdown, { type AIMarkdownCustomComponents, type AIMDContentPreprocessor } from '@ai-markdown/react';
import { highlight, pangu } from '@ai-markdown/react/plugins';

// ⚠️ All of these are new objects/functions every render.
function Bad({ content }: { content: string }) {
  return (
    <AIMarkdown
      content={content}
      customComponents={{
        a: ({ href, children }) => (
          <a href={href} className="link">
            {children}
          </a>
        ),
      }}
      contentPreprocessors={[(c) => c.trim()]}
      enginePlugins={[highlight, pangu]}
    />
  );
}

// ✅ Hoist — define once at module scope.
const Link = ({ href, children }: { href?: string; children?: React.ReactNode }) => (
  <a href={href} className="link">
    {children}
  </a>
);
const trim: AIMDContentPreprocessor = (c) => c.trim();

const COMPONENTS: AIMarkdownCustomComponents = { a: Link };
const PREPROCESSORS: AIMDContentPreprocessor[] = [trim];
const PLUGINS = [highlight, pangu];

function Good({ content }: { content: string }) {
  return (
    <AIMarkdown
      content={content}
      customComponents={COMPONENTS}
      contentPreprocessors={PREPROCESSORS}
      enginePlugins={PLUGINS}
    />
  );
}
```

The `useStableValue` deep-equal safety net rescues `customComponents` and the others — but the deep-compare itself costs time, and `urlTransform` has no safety net at all.

### Disabling block-memo as a "perf fix"

If something feels slow, the instinct may be to disable block-memo to "see if it helps." Almost always:

- Disabling it makes things **slower**, not faster, for streaming content.
- The actual culprit is usually a non-stable prop reference (above).
- Disable `blockMemo` only for debugging correctness issues.

### Building a giant single-block document

Block memoization wins by dividing work into many small caches. If your content is one giant paragraph with no blank lines (one block from CommonMark's perspective), there's nothing to subdivide and memoization can't help. This is rare in practice — LLM output is almost always multi-block — but for pathological inputs the per-frame cost is dominated by parsing, not by render.

### Mistaking `streaming` for an in-progress signal that pauses rendering

`streaming === true` does not delay rendering. Content is rendered immediately as it arrives. The flag communicates lifecycle and controls associated UI. For buffered delivery, batch upstream updates with a bounded flush interval and flush on completion; a trailing debounce can postpone output indefinitely under continuous input. For visual typewriter pacing, use [smooth streaming](smooth-streaming.md), which tracks source completion and reveal completion separately.

## Mantine code display cadence

Ordinary streaming code blocks coalesce appended display updates with `codeBlock.highlightIntervalMs` (default 50 ms). The first frame, static content, completion, replacements and language changes bypass the wait. A pending deadline is not postponed by further appends, so continuous input still makes progress. Set the interval to 0 for every input update; non-finite or negative values fall back to the default. Mermaid blocks have their own, longer interval, `codeBlock.mermaidIntervalMs` (default 300 ms), because each attempt is a synchronous diagram layout; the final source always renders once streaming ends. Browser timers can fire later when the main thread is busy or a tab is backgrounded, so the interval is a scheduling target, not a hard latency guarantee.

The copy control reads the latest unformatted source independently of the displayed snapshot. Each block retains only its latest highlighting result, keyed by code, language, color scheme and highlighter function identity; outer adapter Provider renders therefore do not repeat identical highlighting. Adapter/theme changes still invalidate the result. Mermaid keeps its separate serial render queue.

Retained reference-bearing prefix blocks can now reuse their block plans. Tail planning uses full-document reference context whenever the prefix contains references, preserving global context, ranks and occurrence counts. Raw HTML and definition ownership still use the conservative full planner. This reduces repeated per-block planning; document context walks and top-level array work remain.

## Separate performance from delivery semantics

Use the full accumulated source as `content`. If a network reader receives three pieces `"Hel"`, `"lo"`, and `" world"`, the renderer should normally receive `"Hel"`, `"Hello"`, and `"Hello world"`. Feeding only the latest piece is replacement, not append-only streaming. Likewise, a changing React key unmounts the instance and discards its caches even if the text is append-only.

Application batching can be a valid optimization when update frequency exceeds the useful paint cadence. It trades freshness for fewer updates; block memoization does not make that trade unnecessary. Measure arrival-to-display delay as well as pipeline time, and deliver the final accumulated value immediately when the transport completes. Do not use an unbounded debounce for a continuously active stream.

A smooth reveal intentionally adds visual updates between network arrivals. Its prefix often qualifies for incremental parsing, but a freeze-safe boundary is still required. A long unfinished fence, an unresolved early reference, or a rewriting preprocessor can keep frames on the full path. “Append-only” is the first gate, not a guarantee that the whole frame is constant-time.

## A repeatable investigation

1. Record package versions and the exact accumulated source sequence. Preserve replacements and completion events.
2. Measure the default standalone path with stable component and policy references.
3. Disable only `incrementalParse` to isolate parse reuse while keeping block memoization and coordination semantics available.
4. For standalone output, compare `blockMemo={false}` separately. Do not interpret this comparison as a coordinated-mode performance toggle.
5. Use stage timing to attribute parse/transform/plan/conversion cost, then a production browser workload to inspect layout and responsiveness.
6. Recheck correctness on the same frame sequence. A fast result that omitted content is a failed run.

The [historical benchmark tables](benchmark.md) record a specific development-build experiment. The [browser harness](../../../../benchmarks/README.md) measures published build entries and has explicit pacing and measurement limits. Neither supplies a universal frame-rate guarantee or proves that all cost is proportional to the newest token.

## Context and cache boundaries

A new metadata reference wakes metadata consumers without invalidating the parse/block cache. A new `urlTransform` reference invalidates rendered output even if the function body looks unchanged. A new preprocessor-array reference reruns preprocessing, but a primitive string that remains equal by value can still leave downstream memos intact. A changed slot component type can remount the subtree rather than merely invalidate a block.

Use `useStableRecord` to understand these policies, not to suppress real updates. `DEEP_EQUAL` restores a previous reference only for equal values; it cannot rescue a newly created component function. `WARN_ONLY` diagnoses identity churn without altering it. `PASS_THROUGH` leaves opaque metadata untouched. Keep expensive work inside custom renderers memoized by its actual input, and keep their subscriptions as narrow as practical.

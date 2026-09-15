# Content Preprocessors

Preprocessing runs in the shared engine. The examples use React imports; Vue exports `createRemendPreprocessor` and `AIMDContentPreprocessor` from `@ai-markdown/vue` and accepts `:content-preprocessors`. See the [Vue guide](../reference/vue.md#component-props) and [package setup](getting-started.md).

A content preprocessor is a synchronous `(content: string) => string` function. It runs before Markdown parsing and is suitable for source-format cleanup: removing a known frontmatter header, translating an application marker, or normalizing a controlled dialect. It receives text, not syntax nodes or React context.

```tsx
import AIMarkdown, { type AIMDContentPreprocessor } from '@ai-markdown/react';

const stripFrontmatter: AIMDContentPreprocessor = (content) => {
  if (!content.startsWith('---\n')) return content;
  const end = content.indexOf('\n---\n', 3);
  return end < 0 ? content : content.slice(end + 5);
};
const PREPROCESSORS = [stripFrontmatter];

<AIMarkdown content={raw} contentPreprocessors={PREPROCESSORS} />;
```

This example deliberately handles a narrow LF-delimited frontmatter format. It keeps incomplete headers intact and does not claim to parse YAML. Define both the function and its array once, or memoize them when they depend on application settings. The API accepts synchronous results only; fetch data or perform asynchronous normalization before supplying `content`.

## Execution order

The outer React component removes every document-leading byte order mark (U+FEFF), applies the built-in LaTeX stage, then calls your preprocessors in array order. Each function receives the preceding function's output:

```ts
// With contentPreprocessors={[a, b, c]}:
const result = c(b(a(latexNormalizedContent)));
```

The BOM strip runs before every other stage and removes the whole run of U+FEFF characters at the start of the content, however many there are. The Markdown parser ignores one leading BOM but reports node positions as if it were not there, while the incremental parser, the block planner and the definition scanner pair those positions with the source string; stripping the characters first keeps both coordinate systems identical. Removing the whole run is a deliberate preprocessing contract rather than raw-parser equivalence: a raw parse of `\uFEFF\uFEFF# Heading` keeps the second BOM as text and yields a paragraph, whereas the pipeline treats a run of leading BOMs as an encoding artifact and renders the heading, and the result no longer depends on how many BOMs a re-encoded file or a re-prefixed stream frame carried. A U+FEFF anywhere else is ordinary text and passes through unchanged. Your preprocessors never see the leading BOMs.

The built-in stage recognizes supported math delimiters and currency, protects code regions, normalizes bracket-delimited math, and escapes math pipes so they do not become GFM table separators. Inline `$x$` and `\(x\)` normalize to the inline `$$x$$` representation consumed by the configured `remark-math` instance (`singleDollarTextMath: false`). Display math uses line-oriented delimiters. Do not assume the caller slot receives the original dollar spelling.

Known HTML tags are protected from math processing as well (`<span>$</span>100` keeps its dollar). A tag has to parse as one — CommonMark attribute syntax, with `>` allowed nowhere inside it — and never crosses a blank line, so `a<b` in prose does not shield the formula after it.

The literal-content tags `<code>`, `<pre>`, `<kbd>`, `<samp>`, `<math>` and `<svg>` protect their whole paired region, and an opening tag whose closer has not arrived protects everything after it to the end of the input. That is the streaming contract: the closer may still be on its way, and converting a `$` inside the region before it lands would rewrite bytes that later turn out to be code. The same rule applies to a tag that never closes, so in `Use the <code> tag. Then $x^2$` the formula stays literal text for the rest of the document. Mention such a tag as inline code (`` `<code>` ``) or escape it (`&lt;code&gt;`) and the math after it renders.

The stage is inert until the document contains a math delimiter: a `$`, `\[` or `\(` anywhere in the input. Other LaTeX commands are not triggers, because outside a delimited formula they are prose. One visible consequence: the underscore in `\text{a_b}` is escaped only once a delimiter exists somewhere in the document; before that, the input is returned unchanged, and the incremental preprocessor transforms the earlier text when the first delimiter arrives. Both entries produce the same bytes for the same complete input.

Inline math is line-local. A single `$` that is still unpaired when its line ends (`quoted in US$ per unit`) is literal text: it does not open a formula, and pipes on later lines — a table three paragraphs down — are left alone. Only an unpaired `$` on the last line of the input, the streaming tail, has the pipes after it escaped until the line completes.

Unclosed display-math truncation is based on the source grammar, not the `streaming` prop: preprocessing does not receive that flag. It can therefore affect an incomplete static document too. Since the line-start fixes, a doubled dollar in the middle of a prose line is not treated as an opening display block merely because it is unpaired. Such a mid-line `$$` is also bounded by its paragraph, as in remark-math: if the paragraph ends (a blank line) before a closing `$$` arrives, it is literal text and does not pair with the opener of a later display block, so `It costs $$100 per month.` followed by a real `$$ … $$` block no longer truncates that block. Only a line-start `$$` runs on across blank lines, and only such a block, still open at the end of the input, is truncated.

Each mounted React renderer owns one append-aware LaTeX preprocessor. It reuses a verified prefix when possible and resets on non-append input; its result must equal the stateless `preprocessLaTeX` result for the same complete input. Your functions still receive the entire normalized string on every content change. The incremental parser cannot remove the cost of those full-string passes.

An empty input bypasses the preprocessing call in the React adapter. A preprocessor is consequently not a reliable place to manufacture an empty-message placeholder. Render that placeholder in the application.

## Built-in optional: streaming tail repair (`createRemendPreprocessor`)

While a response streams, the tail of the source is frequently mid-construct — `**bold` without its closer, an unterminated `` `code `` span, a half-typed `[link](url`. By default those frames render literally (asterisks and all) until the closing bytes arrive. The library ships an opt-in factory wrapping [`remend`](https://www.npmjs.com/package/remend) (the markdown-termination engine extracted from Vercel's Streamdown; zero-dependency, Apache-2.0) that completes the unterminated syntax so every frame renders styled:

```tsx
import AIMarkdown, { createRemendPreprocessor } from '@ai-markdown/react';

// Module scope — see “Reference stability” below.
const PREPROCESSORS = [createRemendPreprocessor()];

<AIMarkdown content={streamed} streaming contentPreprocessors={PREPROCESSORS} />;
```

The factory is opt-in at runtime. Whether unused repair code is removed from a particular application bundle depends on the published build and the consuming bundler; inspect the built bundle before claiming a size reduction.

What it repairs: bold/italic/bold-italic, inline code, strikethrough, links, images (incomplete images are **dropped**, not placeholder-rendered), setext-heading ambiguity, stray `>`/`~` false positives. It is intended to preserve already complete Markdown, but its repair rules are dependency-version-specific. Keep representative completed and intentionally incomplete inputs in your integration checks when upgrading it.

Two defaults differ from stock `remend`, one overridable and one not:

- `linkMode: 'text-only'` (overridable) — remend's own default substitutes a `streamdown:incomplete-link` placeholder URL for half-streamed links, but this library's URL sanitizer strips unknown protocols, which would leave a dead `<a>` for the duration of the stream. Text-only renders the link text plainly until the real URL arrives. Pass `{ linkMode: 'protocol' }` if you handle the placeholder scheme yourself.
- `katex`/`inlineKatex`: forced **off** (not overridable, removed from the option type) — the built-in LaTeX preprocessor runs first and already owns `$`/`$$` handling, including truncating unclosed `$$` tails. Two writers on the same delimiters would fight.

### Interactions with the streaming optimizations

- **Block-level memoization** (`blockMemo`, default on): zero conflict. Repairs only affect the tail; earlier blocks' bytes — and therefore their memoized hast — are untouched.
- **Incremental parsing** (`incrementalParse`): partial discount. A frame whose tail was repaired is not a byte-append of the previous frame, so the engine's append gate falls back to a full parse for exactly the frames sitting inside an unterminated construct. The fallback is per-frame, not sticky — splicing resumes as soon as the construct closes in the real bytes. Typical prose streams degrade on a minority of frames; heavily-inline content degrades more. Both flags stay correct in combination; you are trading some splice hits for mid-stream visual completeness.

### Footguns

- **Create the preprocessor once** (module scope or `useMemo`). A fresh factory call per render defeats `contentPreprocessors`' stable-value memoization and re-runs the whole pipeline every frame.
- **Measure repair cost over the whole input.** The caller slot invokes remend with the complete string on each update. The current dependency is remend 1.3.1, which includes scanning changes; older timing anecdotes do not establish its present cost. Profile long prose, code-heavy input, and incomplete inline syntax under your actual reveal cadence.
- **Don't apply it to static content.** A document that legitimately ends inside an unterminated marker (a trailing lone `*`) gets it closed. Reserve it for streaming UIs, or swap it out when `streaming` flips false (see the streaming-state pattern below).
- **Repair runs after `preprocessLaTeX`** (it lives in the caller slot). In the rare mid-stream frame where an unterminated code span contains currency (`` `$100 and… ``), the LaTeX pass may escape the `$` before the span is closed by the repair — a transient artifact on that frame only; it self-heals when the real closing backtick streams in.

---

## Recipes

### Strip YAML frontmatter

```ts
const stripFrontmatter: AIMDContentPreprocessor = (content) => {
  if (!content.startsWith('---\n')) return content;
  const end = content.indexOf('\n---\n', 3);
  return end === -1 ? content : content.slice(end + 5);
};
```

The opening check limits this transform to a header at offset zero, and the closing search avoids consuming a partial header. Add explicit CRLF or end-of-file closing-marker support if your source format requires it. Neither this implementation nor an arbitrary regex is a general frontmatter parser.

### Normalize curly quotes back to straight

The library enables SmartyPants by default, which converts straight quotes to curly. If your downstream tooling (e.g. an `<input>` autocomplete) expects straight quotes, undo it _before_ the pipeline sees them by filtering `smartypants` out of `enginePlugins` (see [the filter idiom](cjk-typography.md#engineplugins-replaces-the-array)) — preprocessors run too early to undo decisions the remark plugins haven't made yet.

### Auto-link bare URLs that the model emitted without `<…>`

GFM already auto-links `https://…` in paragraph text. But some model outputs include URLs glued to surrounding punctuation (`see https://example.com.`) that GFM splits awkwardly. A preprocessor can rewrite these into explicit autolinks:

```ts
const explicitAutolinks: AIMDContentPreprocessor = (content) =>
  content.replace(/(?<![<\(\[\w])(https?:\/\/[^\s<>"]+?)(?=[.,;:?!]?(?:\s|$))/g, '<$1>');
```

### Convert `\n\n\n+` (too many blank lines) to standard paragraph breaks

```ts
const normalizeBlankLines: AIMDContentPreprocessor = (content) => content.replace(/\n{3,}/g, '\n\n');
```

Apply this only to a source format where those blank lines are expendable. The global replacement also changes fenced code and can affect list layout and source positions. Fewer source bytes do not by themselves establish a cache improvement; benchmark the resulting stream, including transitions as a blank-line run grows.

### Replace `[[wikilink]]` syntax with standard markdown links

```ts
const wikiLinks: AIMDContentPreprocessor = (content) =>
  content.replace(/\[\[([^\]]+)\]\]/g, (_, name) => `[${name}](/wiki/${encodeURIComponent(name)})`);
```

A common request for assistants that produce Obsidian-style output. The preprocessor approach keeps the rest of the pipeline (sanitization, custom components, KaTeX) working unchanged.

### Translate LLM-specific markers ("[end of stream]", citation tags, etc.)

```ts
const stripStreamMarkers: AIMDContentPreprocessor = (content) =>
  content.replace(/\[end of stream\]\s*$/i, '').replace(/<\/citation>/g, '');
```

Useful when an upstream LLM emits sentinels you don't want surfaced.

### Multi-step pipeline

```ts
const pipeline: AIMDContentPreprocessor[] = [
  stripFrontmatter,
  normalizeBlankLines,
  stripStreamMarkers,
  wikiLinks,
];

<AIMarkdown content={raw} contentPreprocessors={pipeline} />
```

Compose by ordering, not by combining functions inside one preprocessor — this keeps each step testable in isolation.

---

## Reference stability

`contentPreprocessors` is a **`WARN_ONLY`** prop in the stability firewall (see [streaming and performance → the function-valued exception](streaming-and-performance.md#the-function-valued-exception-urltransform-contentpreprocessors)): a function array cannot be deep-compared, so there is no deep-equal safety net. An inline array is a fresh identity every render — it re-runs preprocessing on a parent render even when source text is unchanged; downstream work is invalidated when the resulting string or other dependencies actually change; development builds warn after a few identity flips. Use a stable module binding for fixed transforms, or `useMemo`/`useCallback` with complete dependencies for dynamic ones:

```ts
// ✅ Stable identity — the chain runs only when `content` changes.
const PREPROCESSORS: AIMDContentPreprocessor[] = [stripFrontmatter, normalizeBlankLines];

function App({ content }) {
  return <AIMarkdown content={content} contentPreprocessors={PREPROCESSORS} />;
}
```

A function declaration is stable only if its enclosing scope is stable. A function declared inside a component is recreated on that component's render. Memoize a closure when it must capture state; do not freeze an old closure merely to keep a cache warm.

---

## When a preprocessor is the wrong tool

Preprocessors operate on raw text. They can't see the parsed AST, can't inspect what's a code block vs a paragraph, and can't avoid affecting content inside fenced code:

````markdown
Look at this output:

```text
---
my-frontmatter-looking-block
---
```
````

A `stripFrontmatter` preprocessor that runs `content.replace(/^---[\s\S]*?---\n/, '')` against this input… is fine here (the `---` is not at the start). But a less careful regex might munge the fenced block. For changes to element presentation, use `customComponents`, which receives the parsed element. A true syntax transformation needs an AST-aware pipeline and a corresponding correctness contract.

The React adapter exposes a sealed plugin selection, not arbitrary remark/rehype injection. The boundary scanner and equivalence tests cover that selected grammar. A [React integration package](extending-via-subpackage.md) composes public slots and providers; it does not open a hidden plugin slot. Propose a new syntax feature upstream, or own a separate engine integration and its validation when a different grammar is required.

---

## Footguns

### Mutating shared state inside a preprocessor

Preprocessors are called during render. Mutating module-level state from inside one causes inconsistencies under React's concurrent rendering (an aborted render may have partially mutated and never rolled back):

```ts
// ⚠️ Mutating shared state inside a preprocessor.
let callCount = 0;
const counting: AIMDContentPreprocessor = (content) => {
  callCount++; // visible to other parts of the app, not safe under concurrent rendering
  return content;
};

// ✅ Preprocessors should be pure.
```

### Preprocessor that depends on streaming-state

If your transformation differs based on `streaming === true/false`, encoding that into a preprocessor is awkward — preprocessors don't receive render state. Two cleaner options:

1. **Keep the transformation in the preprocessor unconditionally.** Most cleanup transforms (frontmatter strip, blank-line normalize) are safe to run on partial streamed input.
2. **Move the decision to the call site.** Pre-compute the desired `content` string upstream of `<AIMarkdown>`.

```tsx
function StreamingDoc({ rawContent, isStreaming }) {
  const content = useMemo(() => (isStreaming ? rawContent : finalCleanup(rawContent)), [rawContent, isStreaming]);
  return <AIMarkdown content={content} streaming={isStreaming} />;
}
```

### Preprocessor that's expensive on long inputs

The library re-runs the preprocessor chain whenever `content` changes — which during streaming is on every chunk. A preprocessor that does `O(n²)` work per call will be the dominant cost.

For very large documents, use cheap, single-pass regex transforms; profile with React DevTools before optimizing.

## Stream-only repair with explicit completion behavior

Select between stable arrays at the call site when repair should stop at completion:

```tsx
import AIMarkdown, { createRemendPreprocessor } from '@ai-markdown/react';

const REPAIR = [createRemendPreprocessor()];

function RepairedMessage({ content, pending }: { content: string; pending: boolean }) {
  return <AIMarkdown content={content} streaming={pending} contentPreprocessors={pending ? REPAIR : undefined} />;
}
```

The final update intentionally re-evaluates the original source without synthetic closers. If that source ends in incomplete syntax, the final visual result can change. Keep repair active after completion only when completing such syntax is part of your application's contract.

With smooth streaming, decide whether repair follows source completion or visible-reveal completion. Applying it after `useSmoothStream` with the returned `streaming` flag keeps intermediate revealed prefixes repaired while the backlog drains. Applying it before pacing repairs a different string and can produce different intermediate frames.

## Verification and source locations

For each transform, test empty input, partial headers or markers, a completed document, and the same text inside code fences. For streaming use, compare a sequence of accumulated prefixes rather than independent deltas. Include a replacement update: append-aware functions must discard stale state when a message is regenerated.

The orchestration lives in [`preprocessors/index.ts`](../../../../packages/engine/src/preprocessors/index.ts), with the per-instance wrapper created in [`react/src/index.tsx`](../../../../packages/react/src/index.tsx). [`latex.ts`](../../../../packages/engine/src/preprocessors/latex.ts) owns normalization and its incremental implementation; [`remend.ts`](../../../../packages/engine/src/preprocessors/remend.ts) fixes the repair options. The LaTeX entry-equivalence and soft-atom differential suites test the built-in implementations against their reference paths. They do not validate arbitrary caller functions.

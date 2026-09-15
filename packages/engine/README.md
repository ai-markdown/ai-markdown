# @ai-markdown/engine

[Documentation](https://ai-markdown.github.io/docs/engine/) · [Examples](https://ai-markdown.github.io/examples/) · [Website](https://ai-markdown.github.io/)

[![@ai-markdown/engine stable](https://img.shields.io/npm/v/@ai-markdown/engine?label=npm&color=blue)](https://www.npmjs.com/package/@ai-markdown/engine?activeTab=versions)
[![@ai-markdown/engine monthly downloads](https://img.shields.io/npm/dm/@ai-markdown/engine?label=downloads%2Fmonth&color=blue)](https://www.npmjs.com/package/@ai-markdown/engine)
[![TypeScript declarations included](https://img.shields.io/badge/TypeScript-included-3178c6?logo=typescript&logoColor=white)](https://github.com/ai-markdown/ai-markdown/tree/main/packages/engine)
[![MIT license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/ai-markdown/ai-markdown/blob/main/LICENSE)

> **Since 3.0.0:** React and Vue adapters share the public `@ai-markdown/core` and `@ai-markdown/engine` packages. See the [migration guide](https://ai-markdown.github.io/docs/guides/framework-transition/).

`@ai-markdown/engine` contains the string and syntax-tree processing used by ai-markdown: LaTeX preprocessing, the unified plugin chain, incremental parsing, and shared reference bookkeeping. It has no React dependency. A framework adapter supplies component lifecycle, DOM rendering, context subscriptions, and any presentation such as syntax highlighting.

**This is the algorithm layer for adapter authors.** Shared core, React and Vue consume it at the exact same train version. The public root exports parsing, preprocessing, registry and policy contracts; fixtures and private registry containers are excluded. Public contracts follow semantic versioning from 3.0.0; breaking changes require a new major version. Applications should install `@ai-markdown/react` or `@ai-markdown/vue`; see [Getting started](https://ai-markdown.github.io/docs/guides/getting-started/).

The examples below demonstrate individual entry points. They do not assemble a complete framework adapter: URL transformation, coordinated placeholder rendering, effect timing, and CSS remain the adapter's responsibility.

## What's inside

Everything is exported from the package root (`import { … } from '@ai-markdown/engine'`); the barrel is grouped by layer:

| Layer                    | Modules                                                                                                                                                          | Highlights                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preprocessors            | `preprocessors/latex`, `preprocessors/remend`, `preprocessAIMDContent`                                                                                           | `preprocessLaTeX(text)` (currency `$`, `\[…\]` / `\(…\)` normalization, code-fence and inline-code protection), `createIncrementalLatexPreprocessor()` for append-only streams, `remend` for unterminated-markup mending                                                                                                                                                                                                                                                                                                                                        |
| Incremental parsing      | `incrementalParse/*`                                                                                                                                             | `advanceIncrementalParse(state, content, options)` — the prefix-freeze engine: a line scanner decides a verified-safe freeze boundary, only the tail re-parses, and the two trees are spliced; every frame is deep-equal to a full parse (enforced by the arbiter suites) or falls back to one                                                                                                                                                                                                                                                                  |
| Pipeline assembly        | `markdown/*`, `pluginChain`, `plugins/catalog`, `customMdastHandlers`, `remarkInjectPhantomDefs`, `rehypeRebaseHashLinks`, `rehypeFooterAdorn`, `rehypeRawGuard` | `buildCoreRemarkPlugins` / `buildCoreRehypePlugins` / `buildCoreRemarkRehypeOptions` — the shared chains used by the React and Vue renderers; the sealed engine-plugin catalog (`highlight`, `definitionList`, `removeComments`, `smartypants`, `pangu`, `defaultEnginePlugins`); `EngineRawHtmlDepthError`, thrown by the chain's guarded raw-HTML step when element nesting exceeds `RAW_HTML_MAX_DEPTH` (256; see below) or the step's own walk exhausts the call stack (the guard itself is internal)                                                       |
| Cross-chunk coordination | `documentRegistry`, `collectDefLabels`, `extractContributions`, `extractDefBodiesFromHast`, `crossChunkUrlSanitize`                                              | `createRegistry()` — the per-document store that numbers footnotes and resolves link definitions across chunks; `resolveCrossChunkReference()` applies the schema, hash rebasing and URL transform to a resolved cross-chunk link or image, the same gates the standalone pipeline applies; `sanitizeCrossChunkUrl()` is deprecated: it runs only the protocol gate and the URL transform on a bare URL (no hash rebasing, no `title`/`alt` handling), is not on the adapters' render path, and stays exported through 3.x — use `resolveCrossChunkReference()` |
| Sanitization             | `sanitizeSchema`, `extendSanitizeSchema`, `markdown/urlTransform`                                                                                                | The library default `rehype-sanitize` schema (read-only singleton — clone with `extendSanitizeSchema`), `defaultUrlTransform`                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Streaming                | `smoothStream/controller`                                                                                                                                        | `createSmoothStreamController()` — the framework-agnostic typewriter pacing state machine behind `<AIMarkdownSmoothStream>`, with `SMOOTH_STREAM_PACING_PRESETS`                                                                                                                                                                                                                                                                                                                                                                                                |
| Leaves                   | `hastPredicates`, `normalizeId`, `shortenDocumentId`, `devStageTimings`                                                                                          | Small pure helpers; the shared test corpus stays source-only and is not exported                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

For definition-label scanning, use `collectDefLabels(source, { math: true })` or `createDefLabelScanner({ math: true })` when the rendering pipeline includes `remark-math`, as the shipped React and Vue adapters do. Omitting options preserves the original CommonMark + GFM grammar without math. This grammar selection keeps display-math contents separate from real link and footnote definitions.

## Install

```bash
npm install @ai-markdown/engine
```

Dual ESM/CJS build with types for both. ESM keeps pipeline dependencies external. The CJS build bundles ESM-only default-export plugins so Node receives callable plugins and does not try to resolve the import-only `remend` entry through `require`. Bundled third-party licenses ship in `dist/THIRD_PARTY_LICENSES.txt`. No React dependency. The only peer is `katex` (`^0.16 || ^0.17`, **optional** — needed only if you render math). The pipeline also receives KaTeX transitively through `rehype-katex`. If your application imports KaTeX CSS, declare KaTeX directly so the import resolves independently of dependency hoisting. A tree-only consumer does not need to load a browser stylesheet.

## Example: the LaTeX preprocessor on its own

```ts
import { preprocessLaTeX } from '@ai-markdown/engine';

preprocessLaTeX('Price is $100, and \\(x^2\\) is inline math.');
// → 'Price is \\$100, and $$x^2$$ is inline math.'
// (currency `$` escaped; `\\(…\\)` normalized to the `$$…$$` form remark-math's inline rule accepts)
```

The same function runs inside `@ai-markdown/react` before every parse; the incremental variant (`createIncrementalLatexPreprocessor`) reuses work across append-only frames.

## Example: driving the incremental parser

```ts
import {
  advanceIncrementalParse,
  buildCoreRemarkPlugins,
  buildCoreRehypePlugins,
  buildCoreRemarkRehypeOptions,
  defaultEnginePlugins,
  sanitizeSchema,
  type IncrementalParseState,
  type AdvanceOptions,
} from '@ai-markdown/engine';

const remarkPlugins = buildCoreRemarkPlugins(defaultEnginePlugins);
const rehypePlugins = buildCoreRehypePlugins(sanitizeSchema, 'example-user-content-');
const remarkRehypeOptions = buildCoreRemarkRehypeOptions(true);
const options: AdvanceOptions = {
  remarkPlugins,
  rehypePlugins,
  remarkRehypeOptions,
  // Keep this key stable until a pipeline input changes.
  depsKey: [remarkPlugins, rehypePlugins, remarkRehypeOptions],
  defListEnabled: true, // defaultEnginePlugins includes definitionList.
};

let state: IncrementalParseState | null = null;
for (const frame of ['# Hello', '# Hello\n\nworld', '# Hello\n\nworld and more']) {
  const result = advanceIncrementalParse(state, frame, options);
  state = result.nextState;
  // result.hast — the full-document hast for this frame
  // result.usedIncremental / result.boundary — whether the frame spliced, and where
}
```

`AdvanceOptions` is documented in `incrementalParse/advanceIncrementalParse.ts`; the React renderer's `MarkdownContent` is the reference consumer.

## Verification

The incremental engine ships with a five-layer equivalence stack (fixture pins, fuzz arbiter, direction battery, exhaustive census, arbiter-sensitivity meta-suite) plus a six-leg release-gate soak (`scripts/soak/soak.sh`, with a complete release profile and fresh seed base); the full record lives in `src/experiments/prefixFreeze/README.md`. Every reachable divergence found so far is pinned as a deterministic test.

## Runtime support

Pure computation over strings and syntax trees: no DOM access, no
Node-only APIs, and no unguarded environment reads. Runs in browsers,
Node, workers, and embedded JS runtimes (e.g. Hermes/JavaScriptCore).

### Nesting depth bound

Every walker after the raw-HTML step recurses once per nesting level, so a
frame of a few hundred to a few thousand nested tags exhausts the call stack
somewhere between the HTML reparse and the adapter renderer, and where
depends on the engine. The raw-HTML step therefore measures element nesting
iteratively as soon as the tree is reparsed and throws
`EngineRawHtmlDepthError` past `RAW_HTML_MAX_DEPTH` (256). First failing
depth on nested `<div>`, measured with `scripts/measure-raw-depth.mjs`
(2026-09-11, Playwright, default stacks; approximate, stack limits move
with JIT state):

| Browser  | Raw step (`hast-util-from-parse5`) | Vue adapter | React adapter                       |
| -------- | ---------------------------------- | ----------- | ----------------------------------- |
| Chromium | ~1920                              | ~1024       | above the raw step (it fails first) |
| Firefox  | ~8193                              | ~2048       | ~4864                               |
| WebKit   | ~8193                              | ~4096       | above the raw step (it fails first) |

The bound sits four-fold below the shallowest of these and far above
ordinary content (64 nested lists is depth 128). Consumers of
`createPipelineSession` in `@ai-markdown/core` render such a frame as
plain text; a hand-assembled pipeline sees the error. Re-run the script
when a renderer or a browser changes.

## Versioning

Lockstep with `@ai-markdown/react`, which pins this package **exactly** — engine and shared core expose explicit adapter contracts that follow semantic versioning from 3.0.0 (see the status note above). Release notes: [release highlights](https://ai-markdown.github.io/docs/guides/release-highlights/).

## Package family

| Package                                                                                                  | Role                                                                                                        | Version policy                                            |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [`@ai-markdown/core`](https://www.npmjs.com/package/@ai-markdown/core)                                   | Framework-independent sessions, block planning, contributions and smooth coordination                       | Release train; exact engine dependency                    |
| [`@ai-markdown/react`](https://www.npmjs.com/package/@ai-markdown/react)                                 | The React renderer — `<AIMarkdown>`, `<AIMarkdownSmoothStream>`, `<AIMarkdownDocuments>`, hooks, providers  | Release train                                             |
| [`@ai-markdown/vue`](https://www.npmjs.com/package/@ai-markdown/vue)                                     | Vue 3.5 renderer — components, scoped slots, SSR/hydration and smooth composables                           | Release train; exact core and engine dependencies         |
| [`@ai-markdown/react-mantine`](https://www.npmjs.com/package/@ai-markdown/react-mantine)                 | Mantine UI bindings — themed typography, code-highlight tabs, Mermaid, color-scheme wiring                  | Release train; compatible React 3.x peer                  |
| [`@ai-markdown/engine`](https://www.npmjs.com/package/@ai-markdown/engine)                               | Framework-agnostic engine — incremental parsing, LaTeX preprocessing, plugin pipeline, cross-chunk registry | Release train; pinned exactly by shared core and adapters |
| [`@ai-markdown/remark-mark-highlight`](https://www.npmjs.com/package/@ai-markdown/remark-mark-highlight) | remark plugin for `==mark==` highlight syntax                                                               | Independent semver                                        |

## Owning incremental state

Keep one parse state per logical input stream. Supply the full current source to `advanceIncrementalParse`, then retain only its returned `nextState` for the next frame. A replacement or a safety-gate failure can select a full parse; `usedIncremental: false` is an expected result, not itself an error. The returned hast still represents the whole current document.

A scan checkpoint inside the state is advanced in place when the next frame resumes it. Feed each state to exactly one successor frame: reusing one state for two different continuations leaves the checkpoint describing the first continuation, and the second can then freeze a prefix the fresh scan would not. The React and Vue adapters keep one linear state per chunk and clear it when a frame throws.

A successful splice depends on both source continuity and pipeline compatibility. If your selected plugins, schema, namespace, or conversion options change, update the dependency key as well. Mutating a plugin array in place while retaining its identity can make a hand-built adapter reuse state under the wrong assumptions. The example creates its pipeline once and enables definition-list handling consistently in both parsing options and plugin selection.

Two options declare grammar capabilities the boundary scanner cannot see in the plugin array. `gfmTaskListItems: true` says the chain parses GFM task-list items, which lets a proven checkbox leave the reference taint; leave it out for a chain without remark-gfm. `mathFlow` has three states. `true` declares remark-math: a `$$` region is verbatim math and nothing inside it is scanned. `false` declares its absence: `$$` lines are ordinary paragraph text. Omitted means unknown, and the scanner then takes the union of both grammars — the region still holds every freeze candidate until its closer, and its lines are also scanned as text for references, html and fences. Omitted is correct whichever grammar your chain has and is the right choice when you do not know; it freezes less around `$$` and never releases a task box there, so declare the real value when you do know. Each of the three states is part of the retained state, and switching between any two drops the retained trees like a dependency-key change. The React and Vue adapters pass `gfmTaskListItems: true` and `mathFlow: true` because `buildCoreRemarkPlugins` always includes remark-gfm and remark-math.

`advanceIncrementalParse` does not implicitly apply every preprocessing convenience exposed by core. Normalize raw input first when you need the core LaTeX behavior, and retain a separate incremental LaTeX preprocessor per stream if using its stateful form. User transforms run on the normalized string in core; reproducing only the parse call is not necessarily equivalent to reproducing the React adapter's entire input pipeline.

## Adapter responsibilities

The hast tree is an intermediate representation, not finished HTML or React output. The rehype sanitizer runs in the chain, while URL transformation is a later rendering concern. A direct consumer must apply the relevant URL policy to surviving URL attributes and must preserve convergence if it revisits a retained tree.

Cross-chunk coordination requires more than creating a registry. Core registers chunks and contributes processed data after commit, subscribes to document and label changes, renders placeholders under the consuming chunk's policy, and emits one aggregate footer. Engine-built private placeholder tags also use a provenance boundary in the shipped pipeline. A hand-assembled chain without the matching credential lifecycle is not a drop-in coordinated renderer.

Use the React adapter as a source-level reference when building another host, and give that host its own lifecycle and equivalence tests. The [architecture guide](https://ai-markdown.github.io/docs/guides/architecture/) traces the stage order, while [soak coverage](https://ai-markdown.github.io/docs/guides/soak-coverage/) distinguishes a successful oracle comparison from evidence that an optimized path was exercised.

## Repository commands

After installing workspace dependencies, build with `pnpm --filter @ai-markdown/engine build` and type-check with `pnpm --filter @ai-markdown/engine typecheck`. The package's `fuzz:splice` command runs the splice property suite; `soak:coverage` validates the coverage map. Development soak runs use the smoke profile, and reused diagnostic seeds are marked as replay runs. Only complete release evidence can establish a release PASS.

The experimental README preserves the original L0–L4 study and later verification history. Its historical counts and tiers are not substitutes for the current production scanner, coverage map, or release runner configuration.

## License

MIT

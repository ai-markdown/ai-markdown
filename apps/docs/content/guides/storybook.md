# Interactive examples

AI Markdown has one Storybook catalog per rendering framework and a composition entry that presents them together. React and Mantine share the React renderer. Vue runs independently with its own preview and browser tests. Engine and core contracts remain in their package documentation and independent test suites.

## Run locally

Install dependencies and start the catalogs:

```bash
pnpm install
pnpm storybook
```

The composition entry opens at `http://localhost:6006`, React at `http://localhost:6007`, and Vue at `http://localhost:6008`. The combined command waits for the React and Vue indexes and preview endpoints before starting the composition entry. This lets Storybook recognize the local catalogs as public references and fetch their indexes without credentials across ports. The `[storybook]` launch and HTTP-readiness messages show this sequence explicitly; concurrent Storybook banners and later compilation messages are not an ordering contract. The command starts all three servers; stop it with Ctrl+C. Shutdown waits for the owned process groups, then force-stops any remaining descendants after a three-second grace period. Ports are fixed: an occupied requested port causes startup to fail rather than silently selecting 6009 or another port. Stop the owning session before retrying; the launcher never kills an unrelated process just because it owns a port. To work on one renderer, use `pnpm storybook:react` or `pnpm storybook:vue`.

Development commands resolve the engine, core, highlight, React, Mantine and Vue entry points used by the catalogs directly to workspace source, including the imported renderer styles. No initial package build or separate build watcher is required. Saving those sources triggers Vite updates or a preview reload; a reload can reset the current example state. Static builds retain public package export resolution and build the packages first, so published entry points and generated styles are still exercised.

The React catalog contains Playground, Basics, Customization, Streaming, Documents, Integrations/Mantine, Performance Lab and QA. Vue uses the same capability categories where supported. Vue does not provide Mantine widgets or React render-count instrumentation. Composition groups are navigation boundaries: controls, theme state and replay clocks are not synchronized across frameworks.

## Chapter structure and renderer comparison

React is the reference for the information architecture. Its catalog separates usage chapters (Basics, Customization, Streaming and Documents), optional integrations, performance instruments and QA regressions. A QA test count is not a measure of how much public usage documentation exists. Both renderers use the same chapter order and provide an Introduction and Playground. Storybook requires inline sort configuration, so each preview declares that order; static acceptance compares the resulting shared chapter sequence to prevent drift.

The following 19 usage chapters, including Playground, exist under identical titles in both catalogs. Their example counts can differ, but a visitor can switch frameworks without relearning where a capability lives.

| Shared chapter                      | Behavior to explore in Vue                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| Playground                          | Edit the accumulated source and rendering flags                              |
| Basics/Markdown Basics              | Corpus headings, emphasis, tables, tasks and quotes                          |
| Basics/Math                         | Inline/display KaTeX output and its stylesheet requirement                   |
| Basics/CJK & International Text     | International punctuation and emphasis fixtures                              |
| Basics/Footnotes & Definition Lists | Standalone footnotes, backlinks and semantic definition lists                |
| Basics/Engine Plugins               | Defaults, highlight-only and empty plugin selections; reactive switching     |
| Customization/Custom Components     | Mapped components, scoped slots, attribute forwarding and slot precedence    |
| Customization/Metadata              | Reactive metadata/streaming context in component props and slot arguments    |
| Customization/URL Sanitization      | Default unsafe-scheme blocking and a stricter custom URL policy              |
| Customization/Content Preprocessors | Source transformation before parsing                                         |
| Customization/Orphan References     | Preserve or hide an uncited definition, then add/remove its reader           |
| Streaming/Streaming Basics          | Accumulated corpus replay, producer completion, cancellation and replacement |
| Streaming/Incremental Parsing       | Compare incremental/full parsing across snapshots and replacement            |
| Streaming/Smooth Streaming          | Composable flush, pacing, producer completion and initial snapshots          |
| Streaming/Streaming Cursor          | Custom marker and prose/code/math tail transitions                           |
| Streaming/Turn Taking               | Finish or unmount a predecessor to admit a queued successor                  |
| Streaming/Error Recovery            | Compare opt-in remend repair with unmodified incomplete Markdown             |
| Documents/Cross-Chunk Coordination  | Late definitions, repeated footnote occurrences and valid backlinks          |
| Documents/Definition Lifecycle      | Definition updates, removal, restoration and document isolation              |

Shared chapter names do not imply identical adapter APIs. Vue receives element context through props/scoped slots. Its standalone `preserveOrphanReferences` defaults to `false`; inside `AIMarkdownDocuments` the wrapper prop of the same name (default `true`) wins over each chunk's own prop, as in React. Smooth turn order is registration order, while `documentIndex` orders references. Flushing an unfinished smooth stream retains its final tentative grapheme until another append or producer completion confirms it.

The remaining React chapters have explicit framework or verification responsibilities:

| React chapters                                                                                 | Vue boundary                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Customization/Theming/Font Size & Color Scheme; Design Tokens; Custom Typography & ExtraStyles | Vue has a base stylesheet and ordinary class/style customization, but does not export React typography variants, design tokens or the extra-style registry. The Vue preview theme controls its surrounding canvas. |
| Customization/Extending/Contexts & Hooks; Define Factories                                     | Vue context is documented under Custom Components and Metadata; smooth composables are under Smooth Streaming. React provider hooks and definition factories are not Vue exports.                                  |
| Integrations/Mantine (including its QA chapters)                                               | React-only integration. No Vue UI-library package is implied.                                                                                                                                                      |
| Performance Lab/Streaming Comparisons; Cross-Chunk Stress                                      | React profiling instruments remain in React. Vue retains Performance Lab/DOM Update for explicit DOM commit measurement.                                                                                           |
| QA (incremental parsing, cursor, turn-taking, state isolation and other regressions)           | Vue keeps its own relevant regressions and browser lifecycle suite. Shared engine correctness stays in engine tests; copying React-only instrumentation would not add equivalent Vue coverage.                     |

Each Vue usage chapter has a Docs description. Controls edit useful props; buttons exercise mounted lifecycle transitions. The static acceptance check requires all 19 shared chapter titles in both indexes, so accidental catalog drift fails verification.

### Compare individual examples

Within the shared chapters, Vue now includes the same focused scenarios as React for table alignment and task-list state; CJK punctuation and RTL direction; streaming math and footnotes; Smartypants, Pangu and comment-removal comparisons; and custom URL schemes. These supplement the overview examples rather than adding new top-level groups.

Plugin comparisons retain the other defaults while omitting one plugin. Their content Controls update both panels. Syntax and typography fixtures intentionally contain precise punctuation, CJK/RTL text and literal code; references to React inside those fixtures are test data, not Vue installation guidance. Streaming feature examples replay a fixed sample with explicit replay/complete/cancel buttons and do not expose an ineffective content Control.

The custom-scheme comparison illustrates both sanitizer and URL-transform gates: allowing `app:` in a transform alone does not restore a URL the sanitizer already removed. The example extends only the selected scheme, keeps unrelated schemes blocked, and never launches a custom application.

### Updated Vue links

The former combined Vue pages have been split. Bookmarks using `basics-markdown`, `customization-components-and-slots`, `customization-element-context`, `streaming-replay`, `streaming-controls-and-cursor`, `documents-coordination`, `documents-cross-chunk-references` or `basics-plugin-configuration` story IDs must be updated to the chapter containing that example. For example, `customization-element-context--reactive-context` is now `customization-metadata--reactive-context`. No automatic redirect is provided. Repository acceptance links use the new IDs.

## Choose a sample

General-purpose examples use complete excerpts from `corpus/documents/markdown.md`, `code.md`, `math.md` and `mermaid.md`. The private Storybook kit selects sections by explicit headings and fails if those boundaries disappear. It does not maintain another handwritten copy of the same Markdown. Shared excerpts keep React, Vue and Mantine demonstrations comparable without requiring identical generated IDs or DOM wrappers.

Purpose-built inputs remain appropriate when their exact syntax is the subject of the example: CJK and RTL typography, footnote ordering, separately mounted cross-chunk definitions, unsafe URL policies, malformed streaming tails, code collapse thresholds, nested JSON formatting and lifecycle regressions. These fixtures should identify the behavior they exercise. Their strings are test inputs, not installation instructions or benchmark claims.

The general excerpts avoid the remote-image and malformed-input sections of the full corpus. Assets used by browser regressions are served locally. Do not introduce remote image/font dependencies into general examples: offline static builds and reproducible tests must render the same content.

## Browser verification

```bash
pnpm typecheck:storybook
pnpm test:storybook:react
pnpm test:storybook:vue
# Both renderer suites, sequentially:
pnpm test:storybook
# Development composition, source updates and shutdown (ports 6006–6008 must be free):
pnpm test:storybook:dev
```

The development check temporarily edits and restores renderer, core, engine and Vue stylesheet sources to verify browser updates without restarting the servers. Run it in an idle checkout; do not edit those files or run other browser suites concurrently. It also checks that Ctrl+C releases all three listening ports, while process-supervisor fixtures cover resistant descendants and startup failures.

Vue explicitly uses `vue-component-meta` for build-time component documentation instead of the deprecated `vue-docgen-api` default. Server-side experimental docgen is not enabled.

React's suite includes Mantine. Each project loads its own Storybook configuration and runs its own `play` assertions in Chromium. The composition entry does not execute referenced suites. QA navigation remains visible locally; setting `STORYBOOK_DOCS_EXPORT=1` hides QA in public navigation while preserving its indexed stories and assertions. Deliberate `!test` exclusions for isolated profiling instruments remain exclusions.

The accessibility addon currently reports findings in `todo` mode. A successful browser suite is not a claim of complete accessibility conformance. Independent core contracts, React lifetime/GC tests, Vue SSR/hydration/stress tests and engine soak remain separate verification responsibilities.

## Build a portable static site

```bash
STORYBOOK_DOCS_EXPORT=1 pnpm build:storybook
pnpm test:storybook:site
```

The result is one directory that must be deployed together:

```text
storybook-static/
  index.html          # Composition entry
  react/              # React and Mantine catalog
  vue/                # Vue catalog
```

The hub references `./react` and `./vue`, allowing the complete directory to live under a version or preview prefix. The smoke command serves it under `/preview/storybook/` and checks both direct iframe entries, refreshes, composed navigation, live Vue Controls updates and the React isolated-performance iframe target. Keep all three builds from the same commit. For a deliberately separate deployment, set `STORYBOOK_REACT_URL` and `STORYBOOK_VUE_URL` while building the hub; those overrides must point at the matching version or PR preview.

The build command first builds the public packages, then clears `storybook-static`, builds the hub, then builds both children. Upload the complete directory only after all builds and smoke checks succeed. No hosting provider, public domain or release archive policy is implied by this build layout.

## Repository ownership and links

Stories stay in `packages/react/stories`, `packages/react-mantine/stories` and `packages/vue/stories`. Renderer configurations live in `apps/storybook-*`. `tooling/storybook-kit` contains framework-neutral corpus excerpts and explicit React/Vue helper subpaths. These workspaces are private and excluded from the public package build, packcheck and npm release train.

React's former `Core/...` sidebar names now describe capabilities directly; the composition entry supplies the React group. Mantine moved under `Integrations/Mantine`. Old story URLs containing `core-` or `mantine-` must be updated; isolated iframe references in this repository use the new IDs. Story IDs are derived from titles and export names, so renaming either requires checking embedded links and browser regressions.

Installation, public API, architecture and migration guidance belong in the documentation and package READMEs. Storybook supplies interactive examples and short explanations with links to those guides. Shared documentation links are centralized in the private kit so they can later target the dedicated documentation site.

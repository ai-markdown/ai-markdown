# Release history

This document records the user-visible changes, implementation fixes, and verification evidence for each release. Entries are grouped by release line and listed newest first. Use the [Git history](https://github.com/ai-markdown/ai-markdown/commits/main/) for individual commits and the [releases page](https://github.com/ai-markdown/ai-markdown/releases) for published release records.

Read an entry as a statement about that version. Older configuration names, dependency choices, default values, soak sizes, and performance measurements remain here so an upgrade can be understood in context. For the current API, use the [React](../reference/react.md), [Vue](../reference/vue.md) and [Mantine](../reference/react-mantine.md) references and the [guide directory](index.md); for a 1.x upgrade, start with the [migration mapping](migrating-to-v2.md).

Verification counts are historical results reported for the corresponding candidate. They are not newly executed checks for this documentation revision. Likewise, a clean fuzz or soak campaign establishes the result for its input families and configuration; later entries explain where expanding those families exposed additional defects.

## 3.0.2 — Cross-chunk definitions and cursor positioning

### 3.0.2

This patch release aligns engine, core, React, Mantine, and Vue at `3.0.2`. The independently versioned highlight plugin remains at `1.0.2`.

- **Math-aware definitions:** React and Vue now scan cross-chunk link and footnote definitions with the same math grammar as rendering. Links defined after a math block resolve correctly, and footnote-like text inside math no longer creates dangling references. The engine scanner exposes an optional `math` flag; calls without options retain their existing grammar, and custom parser callbacks remain supported.
- **React footnotes:** Coordinated footnote marks now respect `urlTransform` and custom `sup` and `a` components, including globally numbered references.
- **Vue streaming cursor:** Cursor positioning accounts for container borders in LTR, RTL, and uniformly scaled layouts.

The scanner contracts and their Chinese translations have been updated to explain the optional grammar setting.

## 3.0.1 — Rendering and streaming correctness

### 3.0.1

This patch release aligns the engine, core, React, Mantine and Vue packages at `3.0.1`. The independent highlight plugin remains at `1.0.2`. It corrects streaming math, footnote coordination, delayed React hydration and Vue invalidation while preserving the existing package entry points.

The full release-profile engine soak passed all six legs and **84/84 shards** with fresh seed `202739110`, in 10,338 seconds. The tested source stayed unchanged throughout the campaign. All 2,127 unit tests passed, together with build, type and public API checks; the full preflight also covered packed consumers, Storybook, document lifetime and Vue browser checks in Chromium, Firefox and WebKit. Release evidence is validated against the final versioned candidate before publication.

#### Engine fixes

Corrections in the built-in LaTeX preprocessor, shared remark chain, raw-HTML step and incremental-parse identity tuple change rendered bytes for the affected inputs.

- A stray single `$` (`quoted in US$ per unit`) no longer makes every `|` after it, for the rest of the document, a `\vert{}`. Inline math is line-local, so an unpaired `$` on a finished line is literal. The unclosed-delimiter scan is kind-aware now: a `$x$` inside a `$$` block is content rather than a closer, and a display block that is still streaming with a `$x$` inside it is truncated like any other open block.
- A mid-line `$$` (`It costs $$100 per month.`) is bounded by its paragraph, as in remark-math. It no longer pairs with the opener of a later display block, so the block and everything after it survive; a genuinely open trailing block is still truncated.
- The lexer's HTML-tag match requires CommonMark attribute syntax and never crosses a blank line. `a<b` in prose no longer shields the math after it, and a document with many unclosed `<b` is scanned in linear time (8000 lines: 315 ms to 4 ms). Quoted attribute values may not contain `>`, as before.
- Currency escaping on a very long line is linear again (a 240 KB line with 32k `$`: 2.7 s to 11 ms), byte-identical.
- `removeComments` removes only html nodes that consist of complete comments: `<details>` blocks with a comment inside, `<!-- note --> visible text` and `<div title="<!-- keep -->">` keep their content and attributes, because rehype-raw tokenizes the embedded comments and the sanitizer drops them. The plugin never edits an html node's value, so node positions stay exact for the splice path. A comment-only block still disappears. The engine no longer depends on `remark-remove-comments`.
- The `smartypants` plugin curls quotes beside CJK text by pairing before SmartyPants runs, so `中文"引号"中文` renders `中文 “引号” 中文` and `中文'引号'中文` renders `中文‘引号’中文` instead of two closers. The pair state runs per block across inline markup, so `中文'*引号*'中文` and a quote closed after a soft line break pair too. Quotes with no CJK neighbour are still SmartyPants' (`it's`, `'90s`, `"quoted" text` are unchanged). The chain order stays `removeComments`, `smartypants`, `pangu`; an earlier attempt that moved pangu first fixed the double-quote case but padded each straight `'` on its own (`中文 ’ 引号 ’ 中文`).
- A `$$` block opened inside a list item no longer swallows the document after the list while it is unclosed: `- Item\n\n  $$\n  x\n\nAfter the list.` used to be truncated to `- Item`. The item is read from the lines above the opener (its marker and content indent), and the item's end ends the block, as it does for remark-math; a top-level fence indented one to three spaces with an unindented body and closer is unaffected. The incremental preprocessor passes its frozen prefix so both entry points read the same lines, and the pipe-escaping pass refuses a pair crossing the item's end.
- Stage A removes every document-leading byte order mark, not just the first. With one stripped there and a second dropped by micromark, `\uFEFF\uFEFF# Heading` rendered a heading and `\uFEFF\uFEFF[x]: /url` became a definition (a raw parse of either is a paragraph), while three BOMs left one in the text. Normalizing the whole run is an explicit preprocessing contract, not raw-micromark equivalence for multi-BOM input; a U+FEFF anywhere else stays text. The definition-label scanner, when driven directly with raw BOM-led input, now takes a full-parse path that equals `collectDefLabels` exactly instead of stripping one BOM itself and letting its parser strip another.
- Raw HTML nested past the engine's depth bound no longer takes the adapter subtree down. The engine's raw-HTML step now measures element nesting with an iterative walk as soon as the tree is reparsed and rejects a frame deeper than `RAW_HTML_MAX_DEPTH` (256, set four-fold below the shallowest measured overflow: Vue's mount in Chromium at about 1,000 nested `<div>`, with Firefox and WebKit higher; `scripts/measure-raw-depth.mjs` reproduces the table) before sanitize, KaTeX, the planner or a renderer recurse into it. As a safety net the step's own stack exhaustion, recognised by error name and message in V8, JavaScriptCore and Firefox (`InternalError: too much recursion`), is reported the same way. Both surface as `EngineRawHtmlDepthError`, an intentional public addition to `@ai-markdown/engine` alongside the optional nested-reference metadata described below; the guard itself stays internal. Ordinary nesting such as 64 levels of lists, blockquotes or divs is unaffected. The shared pipeline session renders that one frame as an escaped plain-text paragraph and parses the next frame normally. Only that error is degraded: a throwing remark or rehype plugin or handler supplied by the host, and any `RangeError` that is not that overflow, propagate out of `parse` as before. The Vue browser suite covers the degraded frame and the recovery in Chromium, Firefox and WebKit.
- Toggling the definition-list plugin between frames re-parses the document instead of splicing the new tail against trees parsed under the other grammar profile: `defListEnabled` is now part of the incremental engine's deps key (the boundary scanner's checkpoint already refused to resume across the flip; the retained trees did not).
- Development builds report an engine invariant: a cross-chunk phantom label that the chunk also defines itself. The phantom label sets are excluded from the deps key on the premise that a phantom is never locally defined; the check is a set intersection against the boundary scanner's confirmed definitions and costs nothing in production.

- The raw pending-closer helper recognizes a single document-leading BOM, matching micromark, so a completed fence does not receive an invented trailing closer.
- Pipe escaping uses the same ordered flow-block spans as the unclosed-delimiter scan. A same-line `$$…$$` inside an open flow block no longer makes a later prose table row get escaped differently by full and incremental preprocessing. Dedent-closed list math follows the same rule.

#### Cross-chunk coordination

Four corrections to how a chunk publishes its footnote and link definitions to the shared registry and how the aggregate footer is assembled. They affect only documents rendered under `<AIMarkdownDocuments>`; standalone output is unchanged.

- A footnote label containing a valid percent-escape (`[^a%41]`) keeps its body in the aggregate footer. The harvest decoded the footer's `<li id>` fragment (`a%41` to `aA`) while the registry keyed the definition by the source identifier, so the two never met and the footer rendered an empty item. Both sides now use the encoded fragment, `footnoteSafeId(sourceIdentifier)`. `sourceIdFromFootnoteLiId` still decodes for the streaming cursor's DOM lookup.
- A link definition or footnote definition written inside a footnote body is contributed to the registry. The label scanner already claimed it, so sibling chunks phantom-injected a label that no chunk ever resolved. A differential test now requires the scanner, the full collector and the contribution extractor to report the same label set at every streamed prefix.
- A footnote referenced only from another footnote's body appears in the aggregate footer with standalone numbering (after every flow reference, in footer order). Nested references are contributed with the new optional `RefRecord.nestedIn` field; they take part in `globalNumber` but not in `getRefsForLabel` or occurrence ranges, so no backref points at a mark id that no inline sup carries. `buildAggregateTree` orders entries by global number. The engine API snapshot gains the additive field.
- Footnote bodies are harvested only from the synthesized footer, recognized by the shared `isFootnoteSection` predicate (tag, attribute and no source position) and read as `section > ol > li`, first item per id. A raw `<section data-footnotes>` an author writes, or a raw `<li id="fn-…">` inside a definition body that HTML parsing hoists next to the real item, no longer replaces a definition body.

#### React

- Multiple images sharing a source line retain every rendered sibling when the planner reuses a Markdown node, avoiding a development invariant failure and incomplete reused output.
- Empty `#` links remain empty fragments when cross-chunk hash links are rebased.

- Coordinated chunks (`<AIMarkdownDocuments>` with a shared `documentId`) each wrapped in their own `<Suspense>` boundary hydrate without a recoverable "Hydration failed" error when one boundary hydrates after its siblings have registered: the hydration render reads no registry state, so it matches the server's literal `[^a]` / `[link][x]`, and the registry resolves them right after hydration as before.

#### Vue

- A registry notification no longer re-parses every chunk in an `AIMarkdownDocuments` tree. One append to one of N chunks parses that chunk once; other chunks parse only when a label they wait on appears, and re-render only when a footnote number or link destination they show changes (measured: an append to the last of 5 chunks ran 6 parses, now 1). The Vue chunk also no longer runs the block planner on every frame; nothing in the adapter read its plan. A standalone client mount parses its first frame once instead of twice: the incremental path is chosen by environment at setup, as in React, rather than after mount.

- Vue uses collision-free URL/title snapshots when resolving references, works without `crypto.randomUUID` in insecure contexts, and keeps internal coordination and pacing props off the DOM. Cursor-tail markers are emitted only while the cursor is present.

#### Mantine and release tooling

- Grammar-on-demand highlighters work through nested Mantine providers. Mermaid header controls ship inline SVG icons.
- Release verification uses read-only permissions; publication alone receives write and OIDC permissions. Recovery rejects a workflow ref that cannot produce provenance for the intended release tag.
- Soak impact compares workflow Node versions per job, and release version updates rewrite only current installation guides rather than historical release records.
- Bundled React-derived code includes its upstream MIT notice.

#### Known performance limits

Very large GFM tables retain an upstream quadratic parsing cost. Task-list checkboxes can conservatively prevent incremental prefix reuse; rendering stays correct. See [streaming and performance](streaming-and-performance.md) for guidance.

## 3.0.0 — Stable release and final candidate

### 3.0.0

The stable train aligns `@ai-markdown/engine`, `@ai-markdown/core`, `@ai-markdown/react`, `@ai-markdown/react-mantine` and `@ai-markdown/vue` at `3.0.0`. Applications install React or Vue directly; Mantine integration remains React-only. The independent highlight plugin remains `1.0.2`. See [Getting started](https://github.com/ai-markdown/ai-markdown/blob/v3.0.0/docs/getting-started.md) and the [package migration guide](https://github.com/ai-markdown/ai-markdown/blob/v3.0.0/docs/framework-transition.md) for installation and the legacy scope mapping.

The public core and engine contracts, React root/plugins, Mantine and Vue declarations are covered by checked API snapshots. Public contracts follow semantic versioning from this stable line. Stable Mantine declares a `^3.0.0` React adapter peer; core and engine remain exact train dependencies. ESM/CJS, development/production entries and public stylesheets retain the RC API shape.

Node consumers require `^20.19.0 || >=22.12.0`, matching the CJS dependencies' `require(ESM)` requirements. Packed consumers are checked at both declared lower bounds and Node 24. Vue functional acceptance covers Chromium, Firefox and WebKit; forced-GC lifetime checks remain Chromium-specific. Nuxt, KeepAlive and Suspense integration remain outside the advertised Vue coverage.

The fresh RC engine campaign passed all six legs and **84/84 shards** on clean commit `e575f03`, with seed `202689100`, in 10,917 seconds. A subsequent ANSI-log parsing fix (`2cdbf9a`) lets the aggregator read colored Vitest verdicts while preserving failed-verdict rejection and all structured evidence checks. The maintainer explicitly authorized reusing that ancestor campaign for the parser-only fix through human release review; the conservative automated evidence-coverage check was not overridden or reported as passing. See [release acceptance](https://github.com/ai-markdown/ai-markdown/blob/v3.0.0/docs/releasing-3.0.md) for publication gates and records.

### 3.0.0-rc.1

The five-package train moves to a release candidate with the same runtime APIs as beta.2. Node support is corrected to `^20.19.0 || >=22.12.0`: earlier Node 20 versions cannot load the ESM dependencies from the CJS entry. The independent highlight plugin receives the same metadata correction in `1.0.2`.

Release gates now include React, React plugins and Mantine declaration snapshots, packed consumers at both declared Node lower bounds and Node 24, and the Vue functional browser suite in Firefox and WebKit alongside Chromium. The generated core contribution/aggregate correctness test receives a 30-second timeout to tolerate CI startup overhead while preserving its full workload.

The [RC release workflow](https://github.com/ai-markdown/ai-markdown/actions/runs/34491579512) passed automated verification and human soak review, then published all six package versions through OIDC. Registry checks confirmed the expected dist-tags, tarball hashes and provenance source. Fresh npm downloads passed ESM/CJS, React/Mantine/Vue SSR, CSS, declarations and the Vue 3.5.0 consumer checks. See the [3.0 release checklist](releasing-3.0.md) for the recorded soak exception and stable promotion gates.

## Find the release line relevant to your upgrade

| Release line | Main changes                                                                                                | Current guide                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 2.12–2.13    | Reference fidelity, source-preserving JSON, waiting slots, code-display coalescing, selective notifications | [Cross-chunk coordination](cross-chunk-coordination.md), Mantine README                  |
| 2.10–2.11    | Deadline pacing and LaTeX soft-atom handling; private-tag provenance                                        | [Smooth streaming](smooth-streaming.md), [preprocessors](content-preprocessors.md)       |
| 2.5–2.9      | Grammar coverage, scanner correctness, oracle and soak improvements                                         | [Architecture](architecture.md), [soak coverage](soak-coverage.md)                       |
| 2.4          | Repository-wide correctness review, SSR and cache fixes, lazy code assets                                   | [URL policy](url-sanitization.md), [streaming performance](streaming-and-performance.md) |
| 2.0–2.3      | Flat configuration, cursor and smoothing surfaces, engine package split                                     | [Migration](migrating-to-v2.md), [cursor](streaming-cursor.md)                           |
| 1.2–1.8      | Initial integration, coordination, customization, incremental parsing rollout                               | Historical entries below; use current guides for implementation                          |

Patch headings identify fixes or maintenance; minor headings introduce features or broader compatible changes. Exact rendered bytes and default visual values are not a blanket semver guarantee.

## 3.0.0 prereleases — Framework adapters and shared contracts

### 3.0.0-beta.2 — Vue 3.5 adapter and explicit shared APIs

This beta introduces `@ai-markdown/vue` for Vue 3.5 and later within the 3.x major. Install it with `@beta`. Engine, core, React, React Mantine, and Vue now share the `3.0.0-beta.2` train; the independently versioned highlight plugin remains at `1.0.1`. React continues to target 19.x. The explicit `beta` npm tag is verified for each train package. If npm assigns `latest` during Vue's first publication, that initial `latest → 3.0.0-beta.2` mapping is retained by maintainer decision; this exception does not apply to later prereleases or other packages.

The Vue adapter includes Markdown rendering, sanitized cross-chunk references and footnotes, SSR/hydration, custom components and slots, smooth streaming with document turn-taking, and streaming cursors. Coordinated footnote marks honor URL transforms and custom `sup`/anchor rendering. Browser verification covers definition changes, document isolation, source replacement, cancellation, and unmount cleanup. Nuxt, KeepAlive, Suspense, and non-Chromium browser integration remain unverified.

Core sessions and planners now have named public contracts, and engine root exports are explicit. The public `isEnginePlugin` guard replaces reliance on internal plugin-stage metadata. Consumers of beta.1 should review the [API contracts](api/core-engine-contracts.md) and update imports of helpers removed from the public root. Cloning render-owned URL metadata prevents adapters from mutating parser or registry trees shared with other consumers.

Core has an independent build/typecheck/test gate with 91 tests, including fixed-seed state sequences for pipeline invalidation, contribution reconstruction, aggregation ownership, and coordinator cleanup. The Vue Chromium gate includes 24 document lifecycles and 288 append updates, verifies subscription release, and checks that document registries and coordinators can be collected while their provider stays mounted. A temporary retained-registry fault was detected by this check.

Release soak is now impact-based. PR checks show whether the cumulative candidate needs engine soak; engine-impacting releases require local evidence and a maintainer's `soak-approval` confirmation before npm publication. Core and adapter checks remain independently required. See [soak coverage](soak-coverage.md) for trigger rules and evidence validation.

Candidate `4841b087c36979277a9b9747687ad94674694891` passed all nine CI checks and a fresh six-leg release-profile soak: **84/84 shards**, seed base `202669090`, clean worktree, and `repositoryChanged: false`. The local release validator accepted the complete evidence against the candidate. The campaign took about 2 hours 52 minutes. Release preparation adds documentation and publication handling; engine-impacting follow-ups invalidate this evidence.

### 3.0.0-beta.1 — ai-markdown scope and public shared core

The first new-scope beta moves the repository to `ai-markdown/ai-markdown` and publishes `@ai-markdown/engine`, `@ai-markdown/core`, `@ai-markdown/react` and `@ai-markdown/react-mantine` on one version train. Install the framework packages with `@beta`; the independent `@ai-markdown/remark-mark-highlight` plugin retains its 1.x version.

The old React core becomes `@ai-markdown/react`. The previously private runtime becomes the new shared `@ai-markdown/core`, an external exact-version dependency alongside engine. React component/hook names, plugin and typography subpaths, Mantine stylesheet behavior, ESM/CJS and development/production entries are retained. React peers are bounded to the verified 19.x major.

Public core exports are explicitly listed. Registry registration/publication is exposed through `RegistryController`; contribution sessions accept a minimal write capability. Smooth coordinators return the documented public interface. Internal registry containers and scenario fixtures are no longer public engine exports. Beta adapter APIs may evolve before stable 3.0.0.

Vue remains a private lifecycle/SSR preparation prototype. A complete Vue renderer and the dedicated documentation site are subsequent milestones. See [the migration guide](framework-transition.md) for old/new package paths and [the architecture guide](architecture.md) for package ownership.

The full preflight passed **152 test files / 1,982 tests**, plus the Chromium concurrent-document lifetime regression and external packed-consumer checks (ESM/CJS, development conditions, SSR, CSS/plugin paths and TypeScript declarations). All six GitHub CI jobs passed for the candidate “feat: migrate to ai-markdown packages and public shared core beta”. Its fresh six-leg release soak passed **84/84 shards**, using seed base `202659090`, with `repositoryChanged: false` and a clean candidate. Run ID: `new-scope-3.0.0-beta.1-20260908T223231Z-9dae734-1278142`.

Final release preparation adds only this verification record and first-publication authentication in the workflow. The first beta can use `FIRST_PUBLISH_NPM_TOKEN` to create the five new npm packages from CI with explicit provenance; subsequent tags use the configured trusted publishers. GitHub marks this release as a prerelease; npm uses `beta` for the four train packages.

## 2.14.x — Final ai-react-markdown release line

### 2.14.1 — Release abandoned document scopes and share preparation decisions

- Fix document registries and smooth coordinators retained by a long-lived wrapper after React abandons a render before registration. Weak scope caches preserve live consumer identity while allowing unused allocations to be collected; explicit final-release eviction remains in place.
- Add a real Chromium regression covering StrictMode, Suspense/transition aborts, same-document sibling identity, active ownership and unmount collection. Run it in local preflight, browser CI and the release workflow.
- Extract phantom-target derivation, handler/body-harvest policy and contribution invalidation keys into the private runtime. Both React rendering paths consume the shared decisions; public React/Mantine configuration and types remain compatible.
- Add a private Vue 3 lifecycle prototype that verifies two-chunk definition sharing, reactive updates, document switching, SSR preparation and cleanup. Vue remains outside the legacy published packages; this experiment is not a complete Vue renderer or a public new-scope release.
- Update lifecycle documentation and record the shared preparation contracts and remaining DOM/hydration work.

Validation: full local preflight passed **152 test files / 1,982 tests**, plus the explicit Chromium garbage-collection regression. Public `.d.ts` and `.d.cts` entry declarations remain byte-identical to 2.14.0. The fresh, six-leg release soak passed all **84 shards** on clean source commit `5da773e5faa54c029d17c070710f5cb79426dd71`, using seed base `202649080`; the final report records `repositoryChanged: false` and aggregation reports PASS. Run ID: `legacy-patch-2.14.1-20260908T114553Z-5da773e-920560`. Final release preparation changes only this verification record.

### 2.14.0 — Shared runtime extraction before the ai-markdown migration

- Establish the final planned legacy release under `ai-react-markdown`. Existing React/Mantine imports, stylesheet paths and public configuration remain compatible; the new organization/scope migration follows separately.
- Extract framework-neutral pipeline sessions, block planning and fingerprints, committed contribution publishing, aggregate footnote HAST, source-tail classification and smooth reveal coordination into a private runtime workspace.
- Keep React components, contexts, lifecycle hooks, node caching and DOM cursor work in the existing core adapter. Bundle runtime into core; retain engine as an external, exact-version dependency and reject private runtime imports in distribution artifacts.
- Add a headless consumer exercising actual production/development ESM and CJS entries without UI framework imports, alongside session fallback/reset, publication timing and aggregate immutability checks.
- Correct the engine's CommonJS handling of ESM-only default-export plugins and the import-only `remend` entry.
- Document the extracted contracts, intended new package mapping, remaining second-framework validation and dedicated documentation-site scope in the [transition guide](framework-transition.md).

Validation: full local preflight passed with **149 test files / 1,974 tests**, including browser stories, declaration/package checks and production/development runtime distributions. All six CI jobs passed on the verified source commit. An isolated tarball consumer passed four ESM/CJS server-rendering parity cases without installing the private runtime; published entry declarations (`.d.ts` and `.d.cts`) remain byte-identical to 2.13.3.

The fresh-seed, six-leg release soak passed **all 84 shards** in 2 hours 52 minutes. It ran in a clean, detached worktree pinned to `9c216fa2a4d1cdc6bc246d1b107d484b46f75d26`, with seed base `202629080` and 14 shards per leg. The final report records `repositoryChanged: false`; aggregation confirms `Release soak: PASS`. Run ID: `legacy-final-2.14.0-20260908T075407Z-9c216fa-757019`. Final release preparation adds only this verification record; production source is unchanged from the soaked candidate.

## 2.13.x — Less repeated streaming work

### 2.13.3 — Documentation aligned with the implementation

- Rewrite the developer guides and package READMEs with fuller explanations of rendering stages, customization contracts, defaults, and implementation boundaries.
- Provide a complete streaming chat example covering incremental SSE framing, UTF-8 decoding, cancellation, explicit completion, and error handling.
- Clarify cross-chunk reference lifetimes and ordering, smooth-stream completion, URL sanitization, CJK parsing, and source-preserving Mantine code presentation.
- Correct outdated API examples, benchmark interpretations, release-history statements, and Markdown formatting while retaining historical measurements and verification records.
- Publish the standalone highlight plugin's updated README as `@ai-react-markdown/remark-mark-highlight@1.0.1`. No runtime source changes in this release.

Validation: full local preflight passed with **147 test files / 1,963 tests**, including browser stories, plus packaging and type checks. The documentation pass also checked key TypeScript examples, 27 SSE/protocol/route cases, and 306 local links and anchors.

### 2.13.2 — Streaming repair and dependency maintenance

- Update the optional streaming repair preprocessor to remend 1.3.1, including Safari compatibility, emphasis/math handling and faster scanning of incomplete code blocks.
- Update the CJK plugins while retaining their parsing-only entry points, and refresh Mermaid and the Mantine integration dependencies.

### 2.13.1 — Correct references across uncertain block boundaries

- Keep streamed reference links and footnotes correct when definitions arrive after mixed table, raw HTML and math content. Definition-shaped text in an uncertain block no longer freezes an earlier unresolved reference prematurely.

### 2.13.0 — Coalesced highlights and selective reference updates

- Coalesce ordinary streaming code display updates with `codeBlock.highlightIntervalMs` (default 50 ms, 0 disables); preserve immediate final frames and copying of the latest source.
- Route placeholder notifications through label subscriptions, including indirect footnote renumbering and occurrence changes.
- Reuse retained reference prefix plans while carrying full document context into tail planning.
- Separate freeze checkpoint state, line grammar and line transitions, and separate splice injection, coordinates, HTML guards and seam alignment. Existing entry points and transition bodies are preserved.

## 2.12.x — Faithful content and less repeated streaming work

### 2.12.0 — Reference fidelity, explicit queue waiting, and streaming efficiency

**Cross-chunk references now preserve the final link/image policy.** Resolved
references honor the final element's sanitizer tag, attribute, protocol and
ancestor constraints. Hash destinations use the document prefix before the URL
callback runs, and escaped or character-reference labels retain a separate lookup
identifier. Full, collapsed and shortcut references work across chunks without
using decoded display text as the registry key.

**Code display and copying preserve the source.** JSON formatting retains numeric
tokens, duplicate keys and key order instead of round-tripping numbers through
JavaScript Number. The copy button copies the original code text. New optional
`codeBlock.formatJson` and `codeBlock.expandNestedJson` flags both default to
`true`; disable nested expansion for formatting alone, or disable formatting to
show the source. Raw pre/code structures with nested markup, sibling text or
additional attributes retain their normal rendering. Non-append code replacements
also restart language auto-detection, including same-length replacements.

**Pre-mounted empty chunks can explicitly wait for their input.** Set
`smoothWaiting` on `AIMarkdownSmoothStream`, or `waiting` on
`useDocumentSmoothStream`, from the first mount while awaiting the request.
Clear it when streaming starts or an empty result completes. The default remains
`false`: an empty, non-streaming chunk is a completed result. Completion is still
sticky, and `documentIndex` does not reorder smooth turns.

**Repeated work is reduced without changing the pacing law.** Registry queries
share a lazy per-version index; reference placeholders select the values they
render. Core reuses context-free prefix plans retained by the incremental engine,
while reference and raw-HTML regions retain conservative planning. Definition and
JSON completeness scans keep append state. Mermaid serializes initialization,
parsing and rendering while retaining only the latest pending task per instance.
The smooth controller consumes its grapheme queue with a cursor instead of
copying the remaining backlog on each frame. Global registry notifications,
top-level plan traversal and ordinary code highlighting still have work left to
optimize; this release does not claim an entirely tail-only render path.

Validation: full preflight passed with **143 test files / 1,905 tests**, including
Chromium stories. The standard, fresh-seed **six-leg release soak passed all 84
shards**, with no source changes during the run. Release preparation changes only
versions, workspace lock metadata and documentation; production source matches the
soaked candidate. The release workflow reruns its quality and packaging gates
before publishing engine, core and mantine together.

## 2.11.x — A tag inside a formula is still one formula

### 2.11.0 — Soft atoms, and a credential for the engine's own tags

**`$$ a <br> b $$` used to render as `<br> b $$`.** Not while streaming — in
a finished document. A multi-line display block with a `<br>` on any line
lost its head _and_ its tail; a paired tag inside a table-cell formula
(`| $a <b>x</b> b$ |`) rewrote the row's trailing pipe into `\vert{}` and
destroyed the row. Nothing errored. The corpus had carried the inline case
(`$x <br> y$`) as a known gap since 2.10.1; the display cases were found
while writing the plan for it.

The cause was one lexer doing two jobs with one field. `splitByProtectedRegions`
marked every protected region — fenced code, code spans, `<code>…</code>`
regions, and every whitelisted HTML tag — as the same kind of thing, and the
transform chain ran on each stretch of text between them in isolation. That
is right for code: a code span both **masks** its bytes (never rewrite them)
and **delimits** the analysed text (a `$` before a code span cannot pair
with one after it). An inline tag needs only the first. Treating it as a
boundary cut `$$ a ` and ` b $$` into two texts, each with an unclosed `$$`,
and the streaming protection truncated each from its own delimiter.

2.11.0 separates the two jobs. The lexer's segments are now a discriminated
union — `text`, `code`, `literal`, `multilineTag`, `tag` — and `processSlice`
classifies them three ways:

| Class         | Members                                                                | Effect on the analysed text                                                                                                                   |
| ------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| hard boundary | fenced code, code spans, literal elements, tags spanning a line ending | unchanged: ends the analysed text. Treating code as a maskable atom was measured wrong twice and stays a boundary                             |
| soft atom     | every other single-line tag                                            | replaced in the text by one private-use code unit, restored in order after the chain; the tag's own bytes are never rewritten                 |
| element scope | a soft opener and its closer on the same line of the same run          | the inner text is its own run, processed recursively; the finished element is one atom outside, so `<span>$</span>100` still isolates its `$` |

Scopes pair top-of-stack only (`<b><i></b></i>` is not repaired), stop at
line endings under the shared `\n` / `\r\n` / `\r` rule, and cap at depth 8
with suppressed openers kept on the stack so a same-name closer cannot
steal an outer level's. The mask is chosen from the **complete** input of
the public call — never per slice — because the incremental wrapper
processes a freeze candidate and a tail separately while the stateless path
sees the whole document, and an alphabet exhausted only across their union
would have let the two entry points diverge. When all 6400 private-use code
points occur, or restoration finds its invariant violated, the call takes
the legacy path for the whole source and the incremental lineage stays
there until a non-append reset — same-call, so every frame still equals
`preprocessLaTeX(full)`.

**Output changes, all approved.** A formula containing a tag now reaches
KaTeX with the tag inside it and renders as garbled math (`<` and `>` as
relations) rather than being deleted — the owner's decision: garbled beats
silent. The streaming truncation of an unclosed `$$` now covers the whole
block instead of leaking the tag and the text after it. A `$$` right after
a tag or a code span on the same line no longer opens a math flow (it never
could). Same-line dollar parity, `\[ … \]` conversion and the unclosed-tail
pipe escaping now see across a tag. A lone `\r` is a line ending for the
truncation scan, as it already was for every other scanner in the file.
`$5 <b>and</b> $6` is unchanged. Everything is byte-identical for input with
neither a tag nor a code boundary.

That last sentence is a gate, not a claim: `latexSoftAtoms.differential.test.ts`
runs the legacy arm (kept verbatim inside `processSlice`) against the new
arm over the shared fixture module, the six committed corpus documents and
4000 seeded fuzz samples, classifies every difference into a named class,
and fails on any unclassified change or any change in the no-tag /
no-boundary class. The fuzz alphabet gained the shapes it had never held —
a same-line paired tag, a tag inside a formula, the `<span>$</span>100`
idiom, a private-use code unit, a CRLF line — so the entry-point
equivalence fuzz cannot pass vacuously. A report-only twin
(`latexSoftAtoms.evidence.ts`, 60 × 400) records per-class counts and both
arms' non-idempotence rates for `gate-evidence.sh`.

**The engine's placeholder tags can no longer be forged from raw HTML.**
`footnote-sup`, `cross-chunk-link` and `cross-chunk-image` are admitted by
the sanitize schema so the cross-chunk handlers' output can reach its React
placeholders — and so could an authored `<footnote-sup label="a">`, which
arrived at the placeholder with a `label`, took the `fnref-a` anchor the
footer's backref points to, and polluted block dependency sets. Two layers
now tell genuine from forged. The property **name**: `hast-util-raw`
re-emits existing element nodes as parser tokens without the tokenizer, so
a camelCase `engineProvenance` survives, while authored attributes come
back lowercased and can never produce it (pinned against the installed
fork). The property **value**: one per-instance credential, 128 bits from
Web Crypto, stamped by the handlers and checked by `rehypeVerifyEngineTags`
between `rehypeRaw` and `rehypeSanitize`; genuine instances lose it and
pass, every other instance is unwrapped the way sanitize treats a
disallowed element. The credential never reaches the DOM, caches or logs.
Without Web Crypto the value is unique but not secret and the name layer
keeps holding — standalone rendering is untouched, forged instances are
still unwrapped, one dev-only diagnostic — and production is proven inert
by execution (`assert-prod-diagnostic-inert.mjs`), not by string absence,
because core's build deliberately does not treeshake.

Public call shapes are preserved. `buildCoreRehypePlugins(schema, prefix)`
still returns today's chain with no verifier; pass a third argument
`{ provenance }` **and** put the same string in your `remarkRehypeOptions`
(`CrossChunkHandlerOptions.provenance`) to enable it in a hand-assembled
pipeline. The shipped renderer always does.

---

## 2.10.x — Delimiters stop deleting what follows them

### 2.10.1 — A price stopped deleting the rest of the page

**`The server costs $$100 per month.` used to remove everything after that
sentence.** Not during streaming — in a finished, static document. The
currency rule escapes a single `$` only, so the doubled one read as an
opening display-math delimiter, and the streaming protection that hides an
incomplete formula truncated from there to the end of the file. Nothing
errored; the document was valid markdown, just not the one anyone wrote.

The protection itself is right and stays. What was wrong is where it fired.
remark-math's `mathFlow` is a leaf block: it opens only on a line whose first
non-space character starts the run, indented at most three spaces. The
implementation truncated on any unpaired `$$` anywhere, including mid-line,
where nothing can be swallowed and so nothing needs protecting. The
function's own first sentence had said "at the start of a line" all along.

Boundaries were calibrated against remark-math rather than reasoned about,
each shape checked by appending a heading and a paragraph and looking at
whether they landed inside the math node:

| Shape                            | mathFlow opens     | Truncates now |
| -------------------------------- | ------------------ | ------------- |
| `$$` at 0–3 spaces of indent     | yes                | yes           |
| `$$` at 4 spaces, or after a tab | no — indented code | no            |
| `$$` anywhere mid-line           | no                 | no            |

Three existing tests changed, and each was checked against remark-math before
being touched rather than edited to match the new code: all three pinned
over-truncation of mid-line delimiters, and all three parse cleanly with
nothing swallowed.

**A second fix repairs a regression the first one introduced.** Changing what
truncation does without changing what the flag beside it claims left
`truncatedAtSeamStart` arming on tails that are no longer cut, and the
incremental preprocessor trimmed a newline the stateless one keeps — a
byte-equality divergence between the two entry points, which is the one
contract that file cannot break:

```
$a$\n    $$     stateless  $$a$$\n    $$     incremental  $$a$$    $$
$a$\n\t$$       stateless  $$a$$\n\t$$       incremental  $$a$$\t$$
```

The five-leg soak ran clean for the recorded campaign over that divergence. It surfaced only
because an unrelated design task was probing the incremental path for its own
reasons. The gate has no leg that fuzzes the two preprocessor entry points
against each other — `fuzz` covers incremental _parse_ equivalence, a
different pair — and the shapes needed are `freezeThreshold: 0` crossed with
an indent variant, a corner the seeded legs do not reach. Recorded as a gap;
the leg is not built here.

Ten new pins across both fixes, in both directions: the shapes that must no
longer truncate, and the indents that still must.

Nothing else in the published packages changed. The rest of this release is a
new corpus package and its gates, which ship to nobody: four layers of
markdown, code, mermaid and math test material — 1139 KaTeX identifiers
derived from KaTeX's own tables, all 31 mermaid diagram types parse-verified,
and 75 math cases collected from real use rather than read off the source.
Two of those cases carry expectations this repo had no word for: `repair`,
which asserts that a loosely written form and a normalised one render the
same, and `ambig`, which asserts only that an ambiguous input is resolved
reproducibly.

---

### 2.10.0 — The typewriter stops classifying pauses

**One behavior change reaches every host, tuned or not: `balanced`'s
maximum reveal lag moves from an internal 1.2s to a preset-level 2.5s
promise** (`maxLagMs`, a new optional field on `SmoothStreamPacingParams`;
smooth 3.5s, responsive 0.8s). The lag is pay-per-use — a fine-grained
stream never comes near it — but a coarse feed that used to stall now
buffers up to 1.3 seconds deeper and plays through. If your product depended
on the old ceiling, override `maxLagMs`.

The smooth-stream controller's pacing law is rebuilt. The old adaptive
jitter buffer carried a hidden cliff: its EMA horizon doubled as a pause
classifier, so a stream whose chunks arrived more than ~1.8s apart — a
dev-server or proxy buffering an SSE feed into two-second lumps — never
formed a cadence estimate at all. Each lump poured out in ~180ms and the
screen sat dead until the next one: the exact "chunky typewriter" the
feature exists to prevent, produced by the feature. The water-level
control law compounded it: its steady state hoards the buffer and
releases a fixed dribble per period, so raising the buffer ceiling added
lag without adding smoothness.

The replacement is a completion-deadline law over a gap-quantile window:
every inter-arrival gap is kept (there is no pause classifier — a pause
is just a gap the lag cap makes irrelevant), the expected delivery
interval is a high quantile of the recent window, and everything on hand
is revealed at constant rate so it lands just as the next chunk is
expected. Two slow gaps are enough to adapt to a coarser feed; a 2.2s
lump train now reads as an even typewriter about a second behind, where
it used to spend half its time frozen. End-of-stream drains are sized for
rate continuity — at most about twice the stream's measured throughput,
clamped to `[drainMs, 3 × drainMs]` — so a server that flushes its
remainder in one closing lump no longer ends the message with a 15×
pour.

`emaTauMs` is deprecated and read by nothing (kept in the exported preset
objects so their shape is unchanged); `correctionTauMs` now times only
the very first lump of a stream. Known boundary, documented rather than
patched: a single oversized chunk landing in a fine-grained stream
reveals in one fast frame proportional to its size — the law keeping its
promise to stay current — and a fine stream punctuated by frequent
multi-second pauses remains unsmoothing physics (bridging a 2s hole
requires 2s of stock). Presets were re-approved by eye against coarse and
transition calibration arms added to the Storybook lane.

---

## 2.9.x — Enumeration gives way to derivation

### 2.9.1 — The name list the fix was keyed on was the scanner's own belief

2.9.0's headline change replaced a four-name poison with parse5's rule for a stray end tag: no matching open element, so the token is dropped and the text on either side of it merges. The rule was the right key. What the code read to apply it was `openStack` — **the scanner's model of parse5's open-element stack**, not parse5's — and a model is exactly where a rule-keyed defence can still be keyed on the wrong thing.

The two stacks agree except on names parse5 never pushes under. There are two, reached by unrelated mechanisms: `<frame>`, whose start tag parse5 discards outside a frameset, and `<image>`, which parse5 rewrites to `img` so that an element appears and one named `image` never does. In both cases the scanner pushed, the end tag matched its own stack, popped, and armed nothing — while parse5 dropped the end tag and merged. `<frame>\n</frame>\n\n` froze all 18 of 18 bytes with the newline between the tags a live root text node that grows on the next append. **This shipped from long before 2.6.0, byte-identical on 2.8.2 and 2.9.0.** The unbalanced `<frame>` was safe only by the accident the code already records for an unclosed `<body>` — a phantom on the stack blocks candidates — which is why the balanced pair is where it lived.

**Three instruments each said "covered", each for a different reason, and that is the part worth keeping.** 2.9.0's own release notes end with "`frame` stays out, because parse5 ignores it outside a frameset and builds no element at all" — a defence keyed on `frameset` against a hazard spelled `frame`, and putting `<frameset>` in the document is what makes the boundary safe. The construct-axis probe had **measured** both names, into an `unmeasurable` bucket, with the mechanism written out correctly; nothing read the bucket, and a third answer nobody asks a question of is a comment. And the census alphabet partitions names by their membership across the scanner's own lists, so `frame` sat in one 39-name equivalence class with `div` and `image` was in no list at all — the gate could not have reached either.

The poison is now keyed on the consequence the four original names are one mechanism of: parse5 builds no element under this tag name. Membership is measured rather than asserted, over a 146-name pool in both contexts the scanner distinguishes, with both directions and the context split asserted empty; the trailing-partial-line opener list is derived from it instead of transcribed, having already fallen two names behind. Cost: **none** — 0 of 6,060 pinned corpus entries move in either direction, and neither name occurs anywhere in the fuzz generators, so no past green run is invalidated.

**The ledger of things not fixed was emptied first.** Four items had been standing as "recorded, not resolved", and none of them survived being looked at again.

Three of the scanner's eight name lists were still self-certifying — the derived census alphabet partitions names by their membership across those lists, so a distinction the scanner has wrongly failed to make is equally absent from the corpus meant to catch it, and **F19 lived on one of them**. All three now have adapters measuring the list's own claim: a scope barrier stops parse5's walk so the end tag is discarded and a marker lands inside the wrapper; foreign content really self-closes a `<g/>`; a stray table part foster-parents a later table's cell text out of its element. Dangerous direction empty on all three, and each namespace carries an anti-vacuity control — the scope probe took three wrong constructions to get right and **every one of them printed an empty dangerous set**.

The state-directed search had named three abstract states as never reached, while saying in its own output that it could not tell an alphabet gap from an impossible state. All three were alphabet gaps, and they were never search-only: the fragment token list is the CENSUS's alphabet too, so the release gate **had never once built a GFM table**, and `tableMaybeOpen` — a conjunct of the seal-release predicate — was reached by nothing in the repo. With three tokens added the declared domain is fully reachable at depth 3, so it contains no dead cells.

The splice's block-final/interior classifier had lost its last deterministic killer, because the branch is reachable from a document only through a first freeze and a sound seal refuses every first freeze that could carry one — each seal fix had taken a witness with it, and three harvests against the fixed scanner correctly returned nothing. The guard moved to the classifier's contract instead of the path to it. The mutant that survived every harvest now reds, verified both ways. The test says out loud that it does not claim the state is reachable.

And the name band turned out to have a second cut stride the gate never passed either, found by auditing the first. Passing it costs 2.7x on that band — about 8% of the census leg — for 2.8x the cut schedules on the band that reaches tag names, where F13, F19 and F28 all lived.

**Two more came out of the same audit, both in the safe direction and both free.** parse5 carries a `formElement` pointer that only `</form>` clears, so an implicitly-closed form leaves it set and a later `<form>` is ignored — the standing proof that enumerating parser conditions cannot be made complete. The scanner never modelled it. What kept it latent was an unrelated modelling choice pointing at the hazard by coincidence, and the mitigation for that coincidence failing was a comment asking whoever changed it next to also add a guard: **a condition on a future change, owned by nobody and checked by nothing.** The rule is modelled directly now, at a measured cost of zero. Verifying that it is load-bearing took two attempts — popping the open-element stack without decrementing the counts is not implied-end-tag modelling, and it reports exactly the boundary a working guard would.

And the snapshot gate compared sets where it meant multisets, which is one gap wearing two descriptions: a subset check cannot see a swap between duplicate signatures, and cannot see an addition at all. Both directions now count. Said plainly because a free tightening is the kind that gets believed without evidence — no verdict moves anywhere, and no document was found where the old check is quiet and the new one fires. That is a gap coded around, not a gap witnessed.

### What is NOT outstanding

Four items stay recorded after this release, and none of them is a deferral. They are listed here so the next person does not read the ledger as unpaid debt:

- `annotation-xml` is treated as an HTML integration point unconditionally, where the spec conditions it on `encoding`. **Fixing this would widen boundaries** — the current reading over-blocks, which is the safe side. It is a precision item that trades safety for freeze rate, not a defect.
- The retired seal-release enumeration stays one more version. It is the live half of the containment tripwire that just gained a coverage floor; deleting it now would remove the net immediately after measuring it.
- Three items are **limits of a measurement, not work items**: an SVG `title` really is a scope barrier but the adapter's raw-text guard is measured in the HTML namespace; `caption`, `td` and `th` need a `<table>` ancestor that answers the scope walk before they can; and the splice classifier's position-less sibling case is not a legal shape to build synthetically. Deleting these entries would not remove the limits, only the record of them.

That last group is the point of the discipline rather than an exception to it. F28 was found because a probe had honestly recorded `frame` and `image` as names it could not decide — **an empty "cannot decide" list is not a repository without blind spots, it is one that stopped asking.**

Three smaller corrections ride along, all of the same family. The release gate had quietly stopped running the full census — `CENSUS_STRIDE` went from 1 to 3 in the commit that fixed two _other_ knobs for running CI's values, while three comments went on describing full-stride as a gate property; it is back to 1. The seal-release containment sweep asserted that a dev-build tripwire stayed silent without ever reporting that it had applied, so it now counts its own evaluations (862 over 6,060 scans) and holds them over a floor. And the gate script itself turned out not to run on one of the two machines the gate runs on — the second one has no zsh, which is the real reason every split release gate since 2.8.1 was hand-assembled from the script's env lines rather than run from it.

### 2.9.0 — The enumeration that leaked five times is replaced by a derivation

The seal-release predicate decides whether a line pins the seam between a frozen prefix and its tail. It was an ENUMERATION of "lines that emit no top-level node", and its default was _not listed ⇒ release_. That default leaked five times over eighteen months — comment-only lines, whole-line stray closers, definition continuations, lazy continuations of a resumed footnote body, and finally whole-line `<!DOCTYPE html>`, truncated `<!DOCTYPE`, `<html>` and `<head>`. Each fix added a member; none of them changed the shape that produced the next one.

**It is now derived.** Three layers, each answering a question about the line rather than recognising it: does this line start a block (micromark's own content-construct answer), is that block's type wrap-visible, and does it survive to emit a parse5 node. A resumable-context gate runs before all of it — below a footnote definition, a link definition, or an open container, only a provable interruption releases, at any indent. **Unknown in any layer withholds**, which inverts the default that produced the leaks. Migration was a differential tripwire: derived and enumeration computed in parallel over the pinned corpus across three lineages, with the containment `derived ⇒ enumeration` asserted and its violating quadrant hard-failing. That quadrant stayed empty at every stage; the other divergences were triaged, and four of them were the enumeration being wrong.

**Those four are the finding, and they arrived after the hunt for them had come up empty.** The design's second adversarial review went looking for a fifth member, found none, and recorded the class as closed. It was not: `<!DOCTYPE html>` and its three siblings released the seam while parse5 leaves no node for any of them — the doctype dropped in the fragment context, a document-structure start tag discarded with its attributes merged onto the element that already exists. They are inert today, but only because a _second_ mechanism's poison happens to cover all four, which is a coincidence rather than a design. The predicate was wrong on four line shapes for as long as it existed. The general lesson is in the deviation ledger: **an empty member hunt is not a closed class** — a hunt samples shapes, while this failure class was defined by a default, and no amount of sampling bounds a complement.

**Three deferred fixes ship with it**, because this is the change that already needed the release gate. A PI's residue text node no longer changes identity under append — and it is fixed _by_ the derivation rather than by anything aimed at it, which is the clearest evidence the three were one disease. A defence keyed on four names (`DOCUMENT_STRUCTURE_NAMES`) is re-keyed on the rule that produced the hazard: parse5 discards every end tag with no matching open element, and the invariant is a text node it leaves between two constructs, at EOF, growing under append — `<area>`, a void _start_ tag, is in that family, so the shape was never "stray end tags". And `VOID_TAGS` gains `basefont`, `bgsound` and `keygen`, with the omission now an asserted empty set rather than a comment; `frame` stays out, because parse5 ignores it outside a frameset and builds no element at all.

Cost: three of 6,060 pinned corpus entries move down, none up; the realistic-document freeze rate is byte-unchanged on both lineages.

**A fourth defect fell out of running the gate with its knobs finally connected.** A link reference definition is a block construct — micromark decides it before inline parsing, where a backtick is an ordinary character and a code span does not yet exist. The scanner blanks intra-line code spans so its inline extractions do not act on content micromark reads as code, then handed that same blanked line to the definition decision. Masking deletes content, and the deleted content is exactly what invalidates a definition: `[x]: /u` followed by a code span registered a definition that micromark calls a paragraph with a live shortcut reference, so the scanner froze a document whose first text node splits the moment a colliding definition arrives. Three shapes fixed, including a definition registered under the wrong identifier because the label itself was masked. The corpus moved by exactly zero — it is blind to the whole class, so the regression harness could never have found it. This is the same keying error as the other three, in a new place: **a block-level question asked of a line an inline pass had rewritten.** Four occurrences now share that form, and what they share is that the defence and the hazard were keyed on different things while the wrong key kept returning plausible answers.

It surfaced only because three separate wiring changes landed this week — the raw-frozen property, all six configurations instead of a hashed one per document, and the fragment band reaching depth four at gate scale. A review had found that the release gate never passed two of its own expensive knobs; this is what was behind them.

**The verification instruments were rebuilt first, and they are what found most of this.** A construct-axis probe table measures where micromark and parse5 part on a construct's terminator and its content governance, over a closed operator set, and any cell whose grammars disagree must name the scanner member claiming they agree — a disagreement recorded as prose protected nothing twice, so the table is an obligation rather than a document. Four of the scanner's eight name lists are now falsified against measured grammar behaviour rather than trusted; the other four are marked self-certifying where a reader meets them. The bounded-exhaustive census leg gained a property that does not depend on the splice engaging — the previous one was structurally blind to an entire defect class for that reason — plus all six configurations and an alphabet derived from the scanner's own taxonomy. A state-directed search over abstract scan-checkpoint signatures reaches in two tokens a witness the surface enumeration needs eight to construct. And the raw-mode gate lost an exemption any document could forge in 24 bytes: it keyed on a rendered wrapper, so `<section data-footnotes>` written by an author removed the author's own content from both sides of the identity and silenced planted defects on every configuration.

---

## 2.8.x — The deferred cuts close

### 2.8.2 — Two long-standing streaming defects, found by the corpus that could finally see them

The v2.8.1 ledger left two debts. Paying them down found a bug; the release gate then found two more — both of them real, user-visible streaming defects that every version up to and including 2.8.1 carried. All three ship fixed.

**A scope barrier discards the end tags markdown generates, too (F19).** `hast-util-raw` serialises the mdast before re-parsing it, so a `>` becomes a real `<blockquote>` element, a `#` becomes `<h1>`, `*a*` becomes `<em>` — tags that never appear in the source. When an HTML scope barrier (`<table>`, `<marquee>`, `<object>`, `<applet>`) is still open as one of those generated end tags fires, parse5 discards the end tag by the same scope walk the scanner already documents for source tags — but since the discarded tag was never in the source, no closing walk ever runs and the raw stream stays perfectly balanced. No amount of tag-balance work can see it. Streamed consequence, measured on the real incremental path: `*<object>*` then `</object>` then a tail paragraph renders the tail nested inside a top-level `<em>` on a full parse and as a plain sibling `<p>` incrementally — every engaged frame diverges. The scanner now poisons from a confirmed line that leaves a barrier open outside a column-0 HTML block, the one position with no generated element around it. Cost: three of 6,060 pinned entries move down, none up; the realistic-document freeze rate is unchanged at 63.82%. Ledger row F19.

**A raw-text block can outlive the tokenizer state that backs it (F20).** `</script/>` closes the element for parse5 — the slash is a bogus self-closing flag it ignores — while CommonMark's type-1 end condition wants the literal `</script>`, so micromark's block runs on. The scanner masks raw-construct scanning while that block is open, on the premise that both grammars agree every byte until the closer is content; past a desync the mask hides tags parse5 really acts on, including the bogus opener inside a later `<pre>` that F13 exists to catch. The `pre` then swallows the rest of the document. This is F17's missing half: its exemption for block-opened regions rested on "their close is tracked exactly", which is true of parse5's close and false of micromark's — and the mask asks micromark. Three of six configurations engage on the reproducer and 100% of their engaged frames diverge. Fixed by tying the mask to both grammars (`mdType1RawText && !inRawTextTok`), no new state. Ledger row F20.

**A fourth member of the seal-release enumeration falls (F18).** Adversarial review of the derived-seal-release design constructed the shape the F16 fix's own `indent >= 4` conjunct still let through: a lazy continuation of a footnote body resumed across a blank (`[^a]: note`, blank, indented `cont`, then `lazy tail` at indent 0 or 2) emits no node yet released the seal. Unlike F19 and F20 this one is model-level, and the measurement says so non-vacuously: 11 append schedules × 6 configurations engage the incremental path on every schedule and none diverges, because sanitize happens to mask the difference. The fix rests on the "masking is not a safety argument" rule rather than an incident. The clause is now interruption logic, not an indent test: below a resumable footnote, only a blank-preceded ≤3-indent block start escapes withholding — any other non-blank line keeps the seal, indent-independent. The general lesson is in the ledger: an indent-conditioned "emits no node" clause is inherently wrong. Ledger row F18; four flip/control pins; baseline moved by zero entries.

**The corpus learns the composite shapes it was blind to.** Five confirmed v2.8.1-campaign defects had moved the 6,000-entry pinned corpus by exactly nothing — the generators never composed the ingredients. Eight composite families land (three new: `preBogusOpener`, `sealReleasePiercer`, `rawTextRunOn`; five folded into the mechanism-owning families), each with measured REACH (generated shape vs one-byte control flips the scanner's boundary — e.g. a `<pre>`-held PI opener 0 vs 22, a masked doctype 0 vs 10, a wrapped def title under a remnant 0 vs 39) and a measured density cost (untouched families keep ~88% of their sampling; every pinned-seed marker clears the RUNS/60 floor). The seal-piercer family distinguishes the F18-fixed tree from the unfixed one, and a new `containerHeldRemnant` family pins today's root-approximation behavior — those rows are the ones a future derived-seal swap must move DOWN, and the regen rule records it. The split-vs-fold criterion, all numbers, and the tree attribution are in GRAMMAR-COVERAGE's composite-families note.

The derived-seal-release design itself (three-layer L1×L2×L3 conjunction, unknown-withholds default, differential-tripwire migration) survived two adversarial review rounds — the first of which found F18 — and is finalized as a design; implementation is scheduled separately.

### 2.8.1 — The review pays its way: two streaming defects, an honest ledger, and a regime that can no longer pass vacuously

A full-mainline external review (v2.5.5..v2.8.0, differential A/B measurement against live micromark/parse5) found three blockers and a set of structural weaknesses in the verification regime. Everything it found ships fixed here; nothing was deferred.

**Two real streaming defects, both invisible to every net.**

- `<pre>` is a CommonMark type-1 name but NOT a parse5 raw-text element — parse5 tokenizes its content in the DATA state, so `<?x` or `</3` inside `<pre>` really opens a bogus comment that swallows the `>` of `</pre>` and the element eats the rest of the document. The P4a phantom-opener gate assumed type-1 implies raw text and removed the poison that had been covering this by accident. The type-1 member now carries parse5 raw-ness (`raw: boolean`, false only for `pre`), and the gate reads the member. The pinned corpus moved by exactly zero bytes under the fix — the family was corpus-invisible, which is why P4a's acceptance never saw it. Deviation-ledger row F13.
- A container line makes a refused type-7 tag line undecidable: micromark's tagName carries a `!parser.lazy` exception nobody had modelled, so `> quoted` then `<x-y/>` opens a container-held html block (lazy continuation) and `> # h` then `<x-y/>` opens a top-level multi-line one — 16 of 21 container prefixes diverged, unpoisoned, and the streamed counterexample rewrote a frozen prefix on a one-character append. The pipe class's answer applies: a sticky `containerMaybeOpen` marker (same five reset sites as `tableMaybeOpen`) poisons the refused tag line instead of verdicting. The 29-class battery's oracle was itself blind here — it read only root children, so container-held html was invisible and four rows were pinned to the wrong measured answer; it now walks the whole tree. Ledger row F14.

**The record gets corrected.** The v2.8.0 release-run failure was NOT node V8 drift: measured on a single node, the corpus fingerprint flips with the type-7 sticky-residue fix's generator edit alone. The real rule — any edit to `fuzzGenerators.ts`/`pinnedCorpus.ts` regenerates `boundaryBaseline.json` in the same commit, increases attributed — is now written in the harness header, the coverage doc, and CI, and the 12 increases the post-release regen absorbed are attributed to the corpus-composition change they actually were. One consequence worth stating plainly: the v2.8.0 tag's own tree carries a red `boundaryDiff` (baseline one generator-edit behind its corpus); HEAD was and is green.

**The verification regime can no longer pass vacuously.** A planted total splice collapse used to pass every gate but one: the conformance sweep's engagement floor was structurally unreachable (memo-hit frames counted as engagement; empty tails guaranteed 4 probes/doc), and the K=4 census had no floor at all. Now: engagement counts only non-empty-tail splices, the census asserts a ratio floor, `assertStreamEquivalence` requires engagement by default (poison-to-zero pins opt out EXPLICITLY — the sweep found two dead pins whose live assertion is now the poison itself), and the two v2.8.0 regression pins that could not fail (one never spliced; one over-determined) got discriminating replacements. The boundary-diff net's fingerprint is a regen trigger, not an escape hatch: per-sample content hashes keep the increases red line armed across corpus-composition changes — the exact bypass through which a test-only commit once absorbed 645 unattributed increases. The (P) identity oracles gate for the first time: soak leg 5 runs the conformance sweep under `ORACLE_RAW=1` with an ENFORCED exemption allowlist, whose predicates survived an adversarial audit (~50k probes, 6,880 streamed documents, zero engine divergences) and were head-anchored + refusal-gated as a result — a genuinely new divergence family now fails instead of hiding in an 80%+ amnesty zone.

**Model-contract fixes on the P side (both over-block direction, both flip-pinned):** `definitelyInsideTable` now honours its own under-claim contract (truncated `<table` openers no longer count — parse5 discarded them); the seal release predicate no longer releases on a line that is only a stray closing tag (parse5 emits no node for it, so the trailing text can still grow). And on the M side, the one-line interrupt table learned its two-line failure modes: a bare list marker cannot interrupt an open paragraph (lazy continuation — the wrong `false` used to sign-flip through the setext row into an under-claim), and a setext-leftover row inside a live table is a table row, not an underline (it no longer disarms `tableMaybeOpen`). A three-head × 25-class two-line battery pins all of it against live micromark.

**Precision recovery, attributed:** `tableMaybeOpen` no longer arms from html-owned pipe carriers (`<!-- a|b -->` cannot be a table row) — the raised boundaries are stream-verified byte-by-byte; the one carrier that does not recover (`<![CDATA[a|b]]>`) is held at 0 by reference taint, independently, and is pinned as such.

**Surface and hygiene:** four zero-consumer engine barrel exports step back inside (measured surface diff on the built d.ts: exactly those four); the fork-chain pin goes exact; `documentIndex` joins the root README's props table; the formElement entry now tells the truth (the close-walk guard is the whole mitigation — mutation-verified — and the schema pin is a drift tripwire, not a second guard; sanitize masking was falsified as a defense by the audit); release-highlights' own 2.8.0 section catches up with its third soak fix.

Verification: engine 1019 / core 455 green at every commit; boundaryDiff green throughout with all movement attributed; five-leg fresh-seed soak split across two machines (fuzz + scanner local, direction + census + the new raw-gated leg 5 on a larger runner) — result recorded below at release time.

### 2.8.0 — Exact type 7, the poison retirements, and the last accidents become design

The three items 2.7.0 deferred with evidence, each landed as its own gated sequence — plus the class of "safe by accident" facts converted into named guards with tripwires.

**Exact §4.6 type 7** (the cut the plan said would need its own release — this is it). `isType7Line` transcribes micromark's complete-tag automaton state for state, and the conformance pin runs against the LIVE remark-parse, so a micromark upgrade fails a test instead of drifting: quoted attribute values may contain `>` (`<span title="a>b">` alone on a line IS a block — the hole the retired run flag existed to cover), unquoted values chain `=` (looser than the spec's written grammar — measured, matched deliberately), `<a b=/>` is complete, closing raw-text names ARE type 7 (`</style>` — the coverage table's old "paragraph as end tags" note was wrong, and harmless only under the flag's blanket), and `<style/>` dispatches past the raw-name check.

**The interrupt condition is the half nobody had written down.** Type 7 "cannot interrupt a paragraph" really means micromark's CONTENT construct — and the old `prevLineWasText` gate ("any non-blank line") refused after headings, thematic breaks, terminator lines and fence closes, all measured type-7-OPENING. `prevLineOpenContent` derives the exact answer per line class (29-class battery pinned against remark-parse); the one class a line model cannot settle — a pipe line: GFM table row (opens) versus pipe-bearing paragraph (cannot), decided lines earlier by a header/delimiter pair — arms a sticky marker (`tableMaybeOpen`) instead: a table continuation row needs no pipe at all, so the marker rides across every content line until a blank disarms it, and any tag line refused under it poisons. Neither direction of approximation was safe here: under-claiming the member re-opens the masking hole, over-claiming can shadow a real type-1 block behind a phantom run.

**With the hole closed, the flag dies.** Migration B's kept rows (masking, fence/math suppression with its backstop, seam set/clear, truncated-open revertibility) migrate to the member one commit each, movements attributed per sample with the engine-probe battery (benign-201 +94 = a backticked tag that really is a code span; hazard-518 +107 = a paragraph `<span` truncation reverting at its blank); `mayBeRawToMicromark` is deleted; and the ambiguous-starter hazard poison retires with the ambiguity itself — 69 pinned boundaries rise across 34 documents, the freeze-rate recovery this stage existed for, 602 engine probes, zero defects.

**P3b ships all three poison retirements — with the release soak setting the F6 recovery's true boundary.** The double-escape ladder is tracked exactly (`double` implies `escaped`; `</script>` while double steps back to escaped with the element open and counted; `-->` exits both levels, parse5-verified). How much recovery that buys was decided by measurement, twice: the first landing was reverted on the splice-side counterexample (the crossing element swallows the inter-block wrap separator — an extra root `"\n"` at frame 20, reproduced red and fixed by the new `rawTextRegionCrossesOut` guard), and this release's own fresh-seed soak then found the scanner-side hole behind it (three direction-battery shards): a MULTI-LINE tangle necessarily crosses micromark blocks, and sanitize stripping the crossing element is an ERASURE whose merge reaches backward past earlier boundaries — the F9/F11 class, so it poisons document-wide, and only a tangle resolving on its opening line recovers. The `--!>` and PI/CDATA first-`>` disagreements go WINDOW-EXACT: parse5 leaves the construct early, micromark's block runs to its own terminator, and the window between the closers poisons only when it can hold bytes parse5 acts on — a markup-free window is parse5 TEXT that converges at the terminator, its remnant owned by the blocker-6 seam (`floatingResidue` now takes the INTERSECTION of the two grammars' comment states). Along the way the p5 bogus-comment overlay is honestly paired with md types 3/4/5 — the last "one field serving two grammars" asymmetry in the raw-construct machine — and that pairing's soak-found corollary landed too: a 2-5 opener inside a type-6/7 run no longer steals the member (the run's identity survives; the parse5 half lives on the overlay), closing a phantom-math hole the deleted run flag had been masking.

**The formElement accidents become designed guards.** Design §2.1's enumeration counterexample stayed latent through two coincidences: the end-tag walk never models implied end tags (the implicitly-closed `<form>` stays counted), and `form` is absent from the default sanitize allowlist. Both are now named guards with tripwire tests — modelling implied end tags or allowing `form` fails a test that says exactly what must ship with the change.

**And the release soak earned its keep, again — three times.** The first four-leg run (seeds 20282500-series) failed four shards on the two holes above, and the re-run caught a third: a GFM table continuation row needs no pipe, so the per-line pipe test under-poisoned refused tag lines one row later — that is where `tableMaybeOpen` went sticky. All three were structurally invisible to the per-commit gates (the boundary-diff corpus and 495 unit tests never held the shapes; the splice guard cannot protect the boundary itself). All three fixed, the exact failing seeds replayed clean at full scale, and the gate re-run on fresh seeds before release.

Verification: preflight all green; conformance oracles zero-defect at ORACLE_RUNS=800 twice; every boundary movement engine-probed (1000+ probes across the attribution batches, zero defects); the failing soak seeds replayed clean; four-leg fresh-seed soak clean for the recorded campaign at scaled size (larger runner, seeds 20286000-series) on the tree carrying all three soak-found fixes.

## 2.7.x — Two grammars, two models

### 2.7.0 — The freeze scanner is split along the seam every bug lived on

Eighteen commits, each gated by the 2.6.0 instruments (boundary diff at every step, conformance oracles at every stage, an adversarial oracle review before each design landed). The refactor the instruments were built for: the scanner's single line model — one set of fields serving both micromark and parse5, the root cause named by every deviation-ledger row — becomes two per-grammar models with the blockers as relations between them.

**Reference resolution moves out** (`referenceTaint.ts`): blocker 5's definition/reference grammar and per-line collection leave `processConfirmedLine` as a pure move — strict zero delta across all 6060 pinned boundaries, the first real code change judged by the harness instead of by argument.

**(P) becomes `P5Tok`** — a partition of parse5's tokenizer macro-states ({data, comment, rawText, script, bogus}), with the within-tag attribute position as a separate overlay because it measurably co-exists with any of them. Three review blockers reshaped this on the way in, each verified before adoption: the raw-text state is a MASK, not a blocker (while set, nothing reaches the balance — so a state the model believes in but parse5 is not in makes candidates MORE likely to survive); the tag position is not a tokenizer state; the inline latch must be captured at open. Where the old model would have held two facts at once, the migration poisons the line instead of choosing silently.

**The foreign-content subsystem collapses to two directions.** The six-symbol exact model (breakout list, integration points, the pop) existed to say precisely when HTML rules resume inside `<svg>`/`<math>` — and being exact there was the F1/F2/F5 family. Now: a self-closing tag is honoured only for the foreign roots themselves, and a raw-text element start near foreign content POISONS — the review measured that either exact answer was a shipped bug in one direction (its blocker: an over-claimed tokenizer switch RAISED the boundary 0→36 on `<svg><title><div></title></svg>`, because the un-switched `<div>` on the open stack was the only protection). Cost quantified: 30 boundary decreases, all on the 12 corpus documents carrying self-closed svg children.

**(M) becomes `MdBlock`** — one union for micromark's open flow construct (fence, math, html types 1–7), where eleven fields stood. The type-7 member is entered by the deliberately approximate `TYPE7_LINE_RE` (exact §4.6 type 7 stays cut), and one run flag survives BY DESIGN: `mayBeRawToMicromark`, the conservative cover for that approximation's attribute hole — the review measured four boundary rises from migrating its consumers naively, one of which deleted a phase-poison backstop, and a new corpus family (`nonType6QuotedGt`) now stands guard over exactly that hole. Along the way the phantom raw-construct openers died (`<!--\n<?x` used to hold two blocks open at once; both grammars call those bytes text) — 8 boundary increases, each run through the engine probe battery.

**parse5's comment state gets its own field.** `--!>` closes a comment for parse5 and not for CommonMark; that divergence is now a RELATION between `p5Tok` and `mdBlock` — poisoned where it opens, pinned by test, with neither field able to release a block while the other grammar is still inside.

**One retirement attempted, measured, and reverted in one sitting** — recorded as prominently as the things that shipped: tracking the script double-escape ladder to let the boundary recover after the divergence window is sound at the scanner layer, but micromark cuts TWO raw blocks where parse5 builds ONE element across them, and the splice's seam synthesis double-counts a separator on the far side. The streamed counterexample is pinned in the test file; the remaining blocker-7 poisons stay until the splice models raw-block-crossing elements. What shipped instead is the safe sliver: `-->` exactly exits the escaped state.

**And the release soak earned its keep one more time.** The first four-leg run on the merged result found a regression the per-commit gates were structurally blind to: a stray `-->` — text to both grammars, and a no-op under the old per-field `commentOpen = false` — hit an UNGUARDED member clear in the new union and released a type-1 block's `html{1}` (the `</script/>` upstream is not CommonMark's literal closer, so that block must run to EOF and keep blocking). Boundary 170 where the pre-fold scanner held 0; a one-character append rewrote the frozen region. Both comment close sites now clear only their own member, every other clear site audited branch-guarded, the shrunk document pinned with stream equivalence — and the division of labour held exactly as documented: the pinned diff corpus and 958 unit tests never saw the shape; only fresh seeds did.

Verification: preflight at 1590 tests; conformance oracles zero-defect at every stage; the boundary diff's four planted mutations still caught; four-leg fresh-seed soak clean for the recorded campaign on the merged result including the fix — with the census leg now hash-scattered (a ×1.5 wall-clock spread between shards, measured r=0.980 against predicted per-shard cost, dropped to 1.004).

## 2.6.x — Instruments before surgery

### 2.6.0 — The freeze scanner gets conformance oracles, a pinned diff corpus, and an opaque checkpoint

No runtime behaviour changes in this release — it is the prerequisite and instrumentation stage (P0 + P1) of a planned refactor that will split the freeze scanner's single line model into two per-grammar models. Everything here exists so that the stages that DO change behaviour can be judged by machines instead of by argument.

**`FreezeScanCheckpoint` is now an opaque token.** The checkpoint's 42-field shape was published through `dist/index.d.ts` — reachable via `computeFreezeBoundary`'s signature and `IncrementalParseState.scanCheckpoint` — so every internal field the refactor deletes would have been a breaking change to a public 2.x type. The public type now carries only a structural brand key (`'~freezeScanCheckpoint'` — a `unique symbol` would be nominal-incompatible across the dual `.d.ts`/`.d.cts` entries); the real shape lives in an intra-package interface the d.ts rollup cannot reach. The one production consumer that read fields (`phantomSuffixCloser`) now calls a narrow accessor, `pendingFenceCloser`, which keeps the phase-trust and column-0-only decisions inside the scanner module. If you were reaching into the checkpoint from outside: those fields were never API, and the type now says so.

**Table D closes a documentation debt the safety argument rested on.** Freeze candidates sit only at confirmed blank lines; the justification is "every construct whose semantics span a blank line is handled". That enumeration existed nowhere. `GRAMMAR-COVERAGE.md` now tables it in three groups — blocks the blank sits inside (fences, math, HTML types 1–5, the blocker-3 continuations, the parse5-side crossings), content after the blank that re-parses content before it (the def-list back-claim, reference retargeting, the erasure merges, the seam), and constructs the grammar itself stops at the blank — each row naming the covering mechanism. Adding a syntax extension to the chain now means adding rows first.

**Conformance oracles (new, test-only).** The authoritative instrument streams a document and then the document plus an adversarial probe tail through the real engine and deep-equals the result against a fresh full parse — positions included, never gated on whether the splice engaged. The probe battery includes the shapes no generator was producing: `<form>` after an implicitly-closed form, table parts, definitions colliding with labels the prefix actually used. A micromark-layer span oracle attributes failures to the markdown grammar; a differential parse5-layer identity oracle keeps the `formElement`-class latent divergences visible (sanitize masks the element difference — and `sanitizeSchema` is a public prop, so "masked" is not "gone").

Building the instruments produced three measured findings worth more than the instruments:

- **The safety contract is the scanner's boundary PLUS the splice-side guards.** A bare "prefix and tail parse independently and concatenate" identity fails for tails the splice legitimately refuses — a `<td>` tail diverges after ANY paragraph prefix, because a tail-alone fragment parse still starts in parse5's "in template" mode while the full parse long since popped to "in body". An oracle unaware of this either cries wolf or silently masks the F8 family.
- **A conformance oracle can overclaim.** The first sweep anchored its comparison on the bare prefix and produced ~3.7k uniform firings at soak scale — all noise: the scanner grants a boundary given every confirmed line of the snapshot (blockers 3 and 4 settle candidates on evidence PAST the boundary), and the engine cuts the snapshot's parse, never a parse of the bare prefix. Re-anchored, the same 2×2000-document sweep reports zero firings and zero defects. The bad-oracle entry is recorded with the same weight as a bug.
- **The fixture library contained zero link reference definitions.** Measured while validating the harness with planted mutations: freezing past a RESOLVED link reference — the (R) dimension of the safety condition — was exercised by almost nothing. Three purpose-built documents now pin it by name.

**The boundary-diff harness runs on every test invocation.** 6060 pinned boundaries (17 frozen fixture documents + 3 reference-resolution documents + 2000 pinned-seed fuzz samples, each under the three production grammar profiles) are compared against a committed baseline: any boundary INCREASE fails until the baseline is deliberately regenerated alongside a ledger entry naming the fixed under-block; decreases print a histogram and pass. The harness was not trusted until it failed on purpose — four planted mutations (a `blankRun` off-by-one, a dropped blocker, a dropped poison, a dropped definition registration), four caught.

Verification: preflight at 1581 tests; the conformance sweep at 2×2000 documents on two seeds, zero defects; the four-leg fresh-seed soak clean for the recorded campaign.

## 2.5.x — Chunk order you control

### 2.5.5 — Order, mode, and phase: three things a line scanner cannot count

**Also in this release: `<svg><template>` no longer crashes the render.** Any markdown containing that raw-HTML pair threw `TypeError: Cannot read properties of undefined (reading 'nodeName')` out of `hast-util-from-parse5` — streaming irrelevant, the full parse threw too, and `rehype-parse` users are equally affected upstream. Root cause: the converter reads `.content` on every element named `template`, but parse5 — per the HTML spec — attaches template contents only to an HTML-namespace template; inside `<svg>`/`<math>` a `<template>` is an ordinary foreign element whose `.content` is undefined. Upstream has not shipped a release in eighteen months, so the engine now depends on a three-package fork chain under the `ai-markdown` GitHub organization — [`@ai-markdown/rehype-raw`](https://github.com/ai-markdown/rehype-raw) → [`@ai-markdown/hast-util-raw`](https://github.com/ai-markdown/hast-util-raw) → [`@ai-markdown/hast-util-from-parse5`](https://github.com/ai-markdown/hast-util-from-parse5) — where the two outer packages differ from upstream by exactly one `package.json` alias line each, and the innermost carries the one-line guard plus five regression tests. The forks follow upstream versioning (8.0.5 / 9.1.3 / 7.0.3 = upstream + fix), publish via npm trusted publishing with provenance, and will be deprecated in favour of upstream the moment the fix lands there. An engine-level regression (`svgTemplateCrash.test.ts`) pins the behaviour so a dependency change that silently swaps the chain back turns the crash into a red test instead of a production incident.

Seven shipped under-blocks, all pre-existing (each verified against v2.5.4 by swapping the fixed file back out), found not by more fuzzing but by a chain of new instruments: an adversarial design review said the parse5-side model was missing tree construction; measuring that claim produced a counterexample the hand-written conditions had missed; sweeping the counterexample's identity over a prefix/tail matrix found the first bug; and each fix's fresh-seed soak surfaced the next. Every step opened by a new judge, none by re-running an old one harder.

**The scope walk (`<div><table></div></table>`, family: `marquee`/`object`/`template`/`applet`).** The HTML spec resolves most end tags by walking DOWN the open-element stack and stopping at a scope barrier; if no match is found first, the end tag is a parse error and is IGNORED — the element stays open. `</div>` is discarded because `table` is a barrier, `</table>` pops only the table, and the div swallows the rest of the document. The scanner counted `div` 1−1, `table` 1−1, reported balance, and froze. A name→count bag cannot see this, because _what sits between an open and its close_ is exactly the information a bag throws away. The scanner now keeps an ordered `openStack` and resolves end tags through a scope walk — removing ONLY the matched element, because block names pop through where formatting names run the adoption agency instead, and modelling the first under-counts the second (measured: it turned four fixtures into fresh under-blocks before being narrowed).

**The mode capture (`a` + blank + `<title>` + blank + `*b*` — sixteen bytes).** `startTagInTemplate` routes `script`/`style`/`title`/`noframes` straight to "in head" without first popping the template insertion mode, unlike every other start tag, which pops, pushes "in body" and reprocesses. So when one of them opens a raw-text region, `_switchToTextParsing` captures IN_BODY in the full parse and IN_TEMPLATE in the tail's independent parse; the first stray end tag restores the captured mode, and from there `</p>` synthesizes an empty paragraph on one side and is ignored on the other. Fixed at the splice layer: the tail bails to a full parse when its leading html run opens one of the four with the capture still live and no honest closer inside the run. `textarea`/`iframe`/`noembed`/`xmp` take the default branch, capture the converged mode, and are measured safe. One iteration was needed on the fix itself: deciding "a generic start tag already popped the mode" requires knowing which `<…>` are markup, and a `<div>` inside `<![CDATA[…]]>` is not — parse5 ends a bogus comment at the first `>`, so the question is regex-undecidable and the bail now refuses to conclude convergence whenever a raw construct precedes the opener.

**The phase splits (thirty bytes: `x <!D y` + newline + `<!DOCTYPE>`).** Blocker 7 poisoned a paragraph-inline `<!--` that fails to close on its own line; `<?`, `<!` + letter and `<![CDATA[` had the same shape and no rule. Two failure modes stack. micromark's block scan interrupts the paragraph at the next line, so a doctype sitting there never reaches the scanner's tag scan and its document-structure poison never fires. And parse5 reads the whole cross-line construct as one bogus comment — a node the sanitize pass removes, merging the text on either side, and the merge reaches BACKWARD: in the fuzz counterexample the merged separator sat forty bytes before the construct, inside the frozen region. That is why the completion uses the document-wide poison rather than the from-here-on one: an opener-offset poison was tried and measurably did not cover it.

**The blank-line phase split (sixty-three bytes, and a ONE-character append rewrote the frozen region).** A type-6 html block ends at a blank line; parse5's RAWTEXT state runs on to the literal end tag. After the blank every line lives in both grammars at once — micromark opens fresh blocks whose element nodes `hast-util-raw` pushes straight into the tree while the same bytes are raw text to parse5, so their end tags close nothing. `<iframe>` + blank + `*b*\n<div>…</div>\n</iframe>` left the div open swallowing the document while the scanner, suppressing every tag under `rawTextOpen`, called it balanced. Poisoned at the blank; type-1 blocks are exempt because a blank does not end them — there the two grammars agree, which is why an unclosed `<script>` still streams.

**And a sixth, from the scaled gate itself (`<template>` in a container).** A `<template>` block vanishes whole: `hast-util-from-parse5` hangs its children off `.content` rather than `.children`, and the sanitize pass drops the element — so nothing of it reaches the output. With a blank line on each side that erasure is invisible, which is exactly what an earlier sweep sampled when it recorded template as harmless. Directly under a list item or blockquote line, the vanishing block lets the container swallow the paragraphs that follow, and a ONE-character append rewrites the frozen region through lazy continuation. `<template>` start tags now poison document-wide — the second erasure kind beside the document-structure names, and the third time this week a "measured harmless" verdict was refuted by a corpus that reached one more layout.

**And a seventh, predicted by the sixth's own fix comment.** The paragraph-inline `<!--` poison was gated on a proxy (`htmlFlowSinceBlank`) that any `<letter` line start sets — so `<b>x</b> <!-- comment…` (a paragraph; `b` is not a type-6 name) suppressed its own protection, and 173 of 200 bytes froze across the erasure merge. The F9 fix had deliberately left the comment poison alone, writing that "the corpus carries the shapes that would catch it if that ever stops" — one scaled-soak leg later, it did. The gate is now the exact line-start check the proxy was approximating, and the poison is document-wide like its siblings.

Three regression files (`scopeBarrierEndTag`, `headRoutedCapture`, `rawConstructPhase`), five new generator families, and ledger rows F7–F12 in `GRAMMAR-COVERAGE.md` — including the correction of that file's own false lemma, which had asserted misnested elements were "reached only through unbalanced `<b>`/`<i>`, which block on tag balance anyway". Verification: preflight at 1547 tests; the four-leg fresh-seed soak clean for the recorded campaign; and the scaled gate — 400k splice-fuzz samples, 600k direction prefixes, the K=4 census at full enumeration — on twelve seeds never used before.

### 2.5.4 — The foreign-content model was a bag where the grammar is a stack

Three under-blocks that had already shipped, from two unrelated root causes, both surfaced by finishing the corpus work 2.5.3 started. The first: the fuzz corpus had never contained an `<svg>` or a `<math>`, so `inForeignContent()` never returned true under fuzz and both foreign branches of the scanner — `honoursSelfClosing()` and `htmlRulesApply()` — had shipped unexercised since they were written.

Adding the corpus family took one shard to produce a counterexample, shrunk to 58 bytes:

```
<svg><b></b><textarea>
x
</textarea></svg>

[a]: /u

Term
```

The `<b>` is a _breakout_ start tag. parse5's "in foreign content" insertion mode POPS the foreign root off its stack when one arrives and processes the tag as HTML — but the scanner modelled foreign-content depth as `tagBalance.get('svg') > 0`, a name→count bag, and a bag cannot express a pop it never saw. It kept reporting "still in foreign content" for the rest of the run, with two consequences:

- **`htmlRulesApply()` kept saying "foreign rules", so the `<textarea>` never opened `rawTextOpen`** — and the inline raw-text poison added in 2.5.3 never fired. A fix from the previous release, bypassed by a stale model rather than by a new construct.
- **`honoursSelfClosing()` honoured a flag parse5 IGNORES.** After the pop, `<svg><div></div><a/></svg>` leaves `<a>` genuinely open in parse5, swallowing everything after it, while the scanner counted no open element at all.

`popForeignRoots()` models the pop. It clears the roots only, where the spec pops every foreign element down to the integration point — deliberately less, because leaving the foreign children counted keeps `openTotal` at or above parse5's stack depth, which is the over-blocking side. Fixed with it: `HTML_INTEGRATION_POINTS` omitted `title`, although an SVG `title` IS an HTML integration point, so a self-closing tag inside `<svg><title>` was skipped where HTML rules open an element. (`annotation-xml` stays in the list unconditionally; it qualifies only when its `encoding` is `text/html`, and treating it as one always over-blocks.)

Documents that contain no `<svg>` or `<math>` are bit-for-bit unaffected — every branch here is gated behind `inForeignContent()`, and the whole boundary-assertion suite reports identical numbers.

The first fix was incomplete in a way worth naming: it lived in `applyTag`, and VOID start tags never reach `applyTag` — the caller skips them. `br`, `hr`, `img`, `embed` and `meta` are all breakout names, so `<svg><br><a/></svg>` still honoured the flag. Ten of twelve direction-battery shards said so. That shape is the second shipped under-block, not merely an incomplete patch: 2.5.3 had no pop at all, so it was wrong there too — the partial fix simply failed to cover it. The pop is decided by the tag NAME alone, and the spec pops _before_ processing the tag, so whether the tag itself joins the stack is irrelevant; it now runs at the skip sites too.

**A second, unrelated family came out of the same corpus work: parse5's script-data escape states.** Inside `<script>`, a `<!--` enters "script data escaped", and a nested `<script` then enters "double escaped" — where `</script>` no longer ends the element, it only steps back to escaped. CommonMark has no such notion: a type-1 block ends at the first line holding the literal closer. After

```
<script>
<!--<script>
</script>
```

micromark says the block is over and a following `$$` opens flow math, while parse5 says the script is still open and swallows it. This is the third shipped under-block, and it has nothing to do with foreign content — it came out of the same week's corpus work, not the same defect. Unlike the foreign-content cases this one cannot be modelled away — the scanner would still have to pick one grammar and be wrong under the other — so it poisons, which is exactly what blocker 7 exists for. Seven of twelve fuzz shards.

Two other paths were swept and came back clean, each safe for a reason belonging to a _different_ blocker, which is why they are now pinned rather than trusted:

- **Foster parenting.** Text directly inside `<table>` is moved out in front of the table and MERGES with the text node already there — the same retroactive shape as the 2.5.3 doctype family. It holds because an open `<table>` keeps `openTotal` above zero, so the boundary is already parked in front of the merge target before the fostered text exists.
- **`<template>` in the content.** `rehype-raw` parses in fragment mode with a `<template>` context, so a nested template pushes another insertion mode; its children land in a content fragment that never reaches hast, and the sanitize schema drops the element.

New in this release: `packages/engine/src/components/incrementalParse/GRAMMAR-COVERAGE.md`, which enumerates the two source grammars entry by entry — CommonMark's seven html block types with their start/end/interrupt conditions, parse5's markup-swallowing tokenizer states crossed with element name _and position_, and the insertion modes that erase or move nodes — against what the scanner does about each and whether the corpus can reach it. It also carries the deviation ledger and the ground facts the whole analysis rests on (fragment mode, `<template>` context, `scriptingEnabled: false`, and a sanitize schema that lifts the children of a disallowed element).

The soak battery grew a fourth leg. The `collectDefLabels` lineage runs the scanner with `mathFlow` and `referenceTaint` off and had a fuzz suite that the release script never invoked; it does now. The `remarkInjectPhantomDefs` lineage turned out to be covered already — `spliceFuzz`'s third property drives `runCrossChunk`, which calls `phantomSuffixCloser` on every frame.

The fuzz corpus also grew enough to expose a fragility in its own scaffolding. The coverage meters require every generator family to be sampled at least `RUNS/60` times, and that floor does not scale with the number of families — so each new family dilutes all the others. Growing the raw-HTML pool from 38 to 49 weights took the failure rate across twelve seeds from 1-in-12 to 4-in-12. The default sample count is now 300 rather than 120, at which all twelve clear. Separately, the benign family's engagement floor was 0.3 while the converged value is 0.29-0.32 — a floor sitting on the mean, failing perhaps half of all seeds by construction, on a suite whose whole point is that the soak runs FRESH seeds. It is 0.2 now, which still makes a collapse unmissable.

One methodological note, because it is the more useful half of this release. Every deviation here was first classified as harmless, twice, on the strength of hand-built sweeps: 3140 shapes for the foreign-content cases ("deviates but is absorbed downstream"), and a further matrix for the script-escape family ("real but stable, because a stream only appends"). Both readings were reasonable and both were wrong, and in each case the fuzz corpus refuted them within one shard of the family being added — by crossing it with a link definition, or with a `$$` block, combinations no hand-written matrix contained. **A sweep that confirms a deviation is harmless is much weaker evidence than a sweep that finds nothing at all**, because the shapes you build by hand are drawn from the same understanding that produced the deviation.

### 2.5.3 — Four families of freeze-scanner under-block, found by closing three holes in the fuzz corpus

All fixes, all pre-existing, and none of them reachable by the corpus that had been guarding this code. The work began as an attempt to add two generator families and ended as four defect families, because the blind spots in the corpus and the blind spots in the scanner had grown from the same set of examples.

The corpus holes came first, and each was confirmed by a mutation that the entire 784-test engine suite waved through:

- **No `<!` + letter shape existed at all.** Every `<!` form in the generators was `<!--`, `<!-`, `<! x >` or `<![CDATA[` — comment, bogus comment, CDATA. The declaration opener and its cross-line carry were unreachable.
- **CDATA was only ever self-contained.** The single generator was `<![CDATA[<div>data</div>]]> trailing prose`, so the arm that carries `cdataOpen` past end-of-line never ran. (`<?x >` in `OVERLAP_OPENERS` does carry `piOpen` across a line, which is why processing instructions were already covered.)
- **Raw-text elements appeared only as block-level runs**, never opened inline in a paragraph and spanning a line ending.

What those shapes then exposed:

- **parse5 erases the document-structure tokens, and the erasure is RETROACTIVE.** `<!DOCTYPE …>`, `<html>`, `<head>`, `<body>`, `<frameset>` and their end tags are absorbed by the "before html" / "in head" / "in body" insertion modes and emit no node into the fragment; the text nodes on either side then MERGE into one whose span starts BEFORE the construct. Every other invariant in the line model assumes a confirmed line only affects itself and what follows, so a `<!DOCTYPE>` arriving later rewrote hast the scanner had already frozen (a fence/doctype seam changed the top-level text node at index 1 from `"\n"` to `"\n\n"`).

  The original reproduction contained a three-backtick line, a blank, a five-backtick line, another blank, `<!DOCTYPE>`, and `e`; expressing those lines explicitly avoids opening a code fence around the rest of this release record. Counter-intuitively an UNCLOSED `<body>` was already safe by accident — it left `openTotal` at 1, which blocked candidates for an unrelated reason — so only the BALANCED form reached zero and froze across. These names now poison the document; measured over 38 400 shapes, and a doctype inside a fence, an indented block or an inline code span still freezes exactly as before.

- **A closing tag with attributes swallowed a real opening tag.** The tag regex ends a match at the first `>`, so `</t <div a="">` matched as one closing tag whose "attributes" were ` <div a=""`; the paragraph-context rule then skipped the whole span. micromark does not: it backtracks the invalid closing tag to literal text and re-scans from inside it, where `<div a="">` is a REAL html-text tag that parse5 opens. The scan now rewinds past the tag NAME instead of skipping the match.
- **Type-1 html blocks (`<script`, `<pre`, `<style`, `<textarea`) have block boundaries unlike every other html block, and neither half was modelled.** Type 1 ends at the line holding its literal closer rather than at a blank, but `htmlFlowReal` was "sticky to the blank" — so the line after `</script>` was still read as a real html-flow run, where parse5 accepts end tags with attributes, and `p <div> x </div a="b"> y` had its `</div a="b">` counted as a real close. micromark sees a fresh PARAGRAPH there, where that text is literal and the `<div>` stays OPEN; freezing past it nested the whole rest of the document inside that div.

  Conversely a BLANK LINE does not end type 1 — only the literal closer or EOF — so an unterminated block (`<script></script >` never closes: CommonMark wants the literal `</script>`, and the space makes it text) had its raw content read as markup. And inside such a block the balance scan is blind, since `rawTextOpen` suppresses its tags, so `openTotal` read 0 and a candidate looked perfectly balanced. The type-6 case is the control and still freezes: type 6 really does run to the blank, so the same `</div a="b">` really is a close there.

- **An inline raw-text span crosses two grammars that disagree about where it ends.** `title`, `noframes` and `iframe` are RAWTEXT/RCDATA to parse5 and type-6 names to CommonMark, and parse5 lifts them out of the flow. Opened inline and spanning a line ending, that rewrites the paragraph they sat in (`p<title>` + newline + `</title>` + blank: the `<p>` goes from children [`p`, `"\n"`] at 0-8 to [`p`, `"\n\n"`] at 0-19 on any append). Worse, `</title a>` is literal paragraph text to micromark but a valid end tag to parse5's tokenizer, so the scanner held `rawTextOpen` across it and suppressed a `<div>` the real parse leaves open. Scope was measured rather than assumed — 40 tag names × 7 shapes, then 12 × 10 — and is exactly those three names, only inline, only across a line ending.

One methodological note worth keeping, because it cost a round: the first type-1 guard asked "did the run start on this line", reading `htmlFlowSinceBlank` — a field ANY `<tag` line start sets as an over-approximation. An `<embed` line (neither a type-6 name nor a complete type-7 line, so a paragraph to micromark) opened the run and hid the real type-1 block behind it. Type 1 may interrupt a paragraph; the question that matters is whether a real html block is already open. Replacing the proxy with `htmlFlowReal` fixed two further counterexamples that had been filed as a separate family.

Freeze rate is unchanged on ordinary documents: 17 realistic shapes — prose, headings, lists, tables, math, fences, references, footnotes, raw HTML, closed `<script>`/`<pre>`, inline tags — all report the identical boundary. The cost falls only on documents that genuinely contain a bare block-level doctype, a balanced `<head>`/`<body>`, an unterminated type-1 block, or an inline raw-text span across a line.

Verification: every fixed shape is a deterministic pin (77 new regression assertions across three files, red before the fix); full preflight at 1491 tests; the release soak's three legs clean; and a scaled run at 400 000 splice-fuzz samples over twelve FRESH seeds, 600 000 direction-battery prefixes over twelve independent chains, and the K=4 census promoted from stride-2 sampling to full enumeration — 36 shards, no failures. Fresh seeds rather than a longer run of the same chain is the point: every defect here was a shape the corpus could already generate and had simply never sampled.

### 2.5.2 — Two pieces of logic that were kept identical by hand now have one definition

No behaviour change and no new capability: a scan of the repository for code that had accreted into "remember to update both places", and the two cases where that was true.

- **The LaTeX transform chain existed twice.** `preprocessLaTeX` (stateless) and the incremental preprocessor's per-slice function each wrote out the same eight steps in the same order — the latter's own JSDoc described itself as "the exact per-segment pipeline of `preprocessLaTeX`". Byte-equality between them is load-bearing, since the incremental wrapper freezes a prefix of the stateless output, so a step added to one and not the other is a correctness bug rather than a tidiness problem. `preprocessLaTeX` is now its whole-string early-exit plus a delegation; that early-exit is the only thing that ever genuinely differed and stays outside the shared chain, because a slice must not re-decide it (`\text{a_b}` in a trigger-free slice still transforms when the full string carries a `$` elsewhere).
- **The `<li>` tail scan existed twice**, one copy on each side of the 2.3.0 package split. Both encode the same fact about `mdast-util-to-hast` — `state.wrap` interleaves `\n` text nodes among an `<li>`'s block children, so the meaningful tail is never simply the last child — and both need it for symmetric reasons: core's aggregate footer appends a backref there, the engine's body extractor strips one and has to find the same node again. Each copy documented half the reason. Both now live in `hastPredicates`, where the split already put the hast helpers shared across it.

Verification, since "refactor" is exactly the claim that deserves evidence: the LaTeX change is 1.15M samples byte-equal against the pre-refactor implementation (hand corpus of 49 hazard pieces plus all 2401 ordered pairs, 250k piece sequences, 400k raw-character strings over the delimiter alphabet, 250k prose-with-LaTeX), with the differential itself mutation-checked. Both changes: full preflight at 1414 tests, LaTeX property suite at 10 000 streams, and the release soak's three legs (splice fuzz 50k / direction battery 20k / K=4 census) clean.

### 2.5.1 — A resumed stream stops breaking emoji, and one HTML table stops disabling the freeze for a whole document

All fixes. The three items the 2.5.0 backlog had left open, each verified as a real defect before being touched — two of the seven candidates turned out not to be, and are recorded as such rather than fixed.

- **A resumed smooth stream revealed broken grapheme clusters.** `finish()`, `snap()` and a finished `flush()` confirm the source's end unconditionally, which is right at the time: a finished stream owes the caller every byte it has. But a round ends between tool calls and then continues, and an offset that was a source end need not be a cluster boundary of the longer string — while `hold`, which exists to protect confirmed boundaries, never saw these ones. Three left-context rules broke there: a lone high surrogate completed by the next round (`"👩‍👧‍👦x"` resumed at 4 segmented as `["\uDC67‍", "👦", "x"]` and revealed the family in visibly broken pieces), a regional-indicator run resumed at an odd position (GB12/GB13 pair flags off from the START of the run, so `"🇺🇸🇬🇧🇫🇷"` resumed at 2 read 🇸 and 🇬 as one flag), and a leading ZWJ or combining mark.

  Rather than enumerate UAX #29's left-context rules, a resume now discards the scheduled backlog and re-segments from `visibleEnd` — the only settled offset — through a bounded lookback window; grapheme breaking is a finite-state process, so a window that starts mid-cluster re-synchronises within a cluster or two. Regional indicators are the one rule a window cannot recover, so the anchor walks their whole run. Steady-state streaming pays nothing.

- **One well-formed HTML table disabled freezing for the rest of the document.** A stray table part (`<td>`, `<tr>`, `<col>` …) outside a table re-routes how parse5 builds every later table, so 2.4.4 taught the scanner to poison its candidates from such a tag onwards. Neither that check nor the splice's asked whether the part was actually stray — so `<table><tr><td>a</td></tr></table>` took the boundary to 0 from the table onwards (43 for the same prose without it) and to zero incremental frames on every schedule, with no way back: `phasePoisonedAt` only ever moves down. A `<details>` wrapping a table did it too. Both checks are now positional — the scanner against `tagBalance`, the open-element model the straddle bail already trusts, read only to SUPPRESS a poison so a miscount leaves the old over-blocking behaviour in place; the splice carrying table depth across raw values, since `hast-util-raw` feeds them all to one parse5. Five table shapes now run 142–183 incremental frames each.
- **Resolving a cross-chunk footnote left every later footnote numbered wrong.** The block cache's footnote rank models `state.footnoteOrder`, whose position is what a coordinated render bakes into each mark as `localNumber`. Phantom labels never enter footnoteOrder, but the rank counted them: with `[^A]` supplied by another chunk and `[^B]` local, B's baked number is 1 while A is phantom and 2 once A's definition arrives — and B's rank, counting A both times, stayed 1. Same raw, same offset, same key, so the cache kept serving a superscript reading 1 under a footer numbering it 2.
- **perf:** the swallowed-extent taint test is a binary search instead of a scan (it was O(taint nodes × raw-HTML blocks) on the streaming hot path — 14% of `buildBlocks` on a document with 200 definitions and 120 containers).
- **Examined and kept, with the reasoning now in the code so reviews stop re-filing them:** the mermaid popup's same-origin blob URL (script that reaches the DOM already holds the page's origin — inline `on*` handlers inserted via `innerHTML` are not inert, only `<script>` is, so the popup adds nothing a DOMPurify bypass would not already have; the `noopener` comment no longer claims to answer this); and `==highlight==` keeping CommonMark's unpatched flanking, where `**` and `~~` pair next to full-width punctuation and `==` does not — `==` is neither CommonMark nor GFM, and its value is rendering the same way in Obsidian and VitePress, which relaxing it here would break. `apps/docs/content/guides/cjk-typography.md` documents the limitation and three working shapes.
- **Also measured and NOT changed:** merging the two walks over a raw-HTML container's subtree. Replacing one walk with a bare traversal costs the same as removing it outright (0.199 ms vs 0.203 ms), so the traversal is free and the cost is entirely per-node work — a merge saves nothing.

Verification: every fixed shape is a deterministic pin, red on 2.5.0; release soak (splice fuzz 50k / direction battery 20k / K=4 census) clean on the final engine; full preflight at 1414 tests.

### 2.5.0 — Second review round of 2.4.5: five parse5-model gaps in the freeze scanner, an escape-blind `$$` in the LaTeX pass, and `documentIndex`

The one new API is `documentIndex` (last bullet); everything else is a fix.

A second seven-track review at 2.4.5 (`project-review-2026-08-19-r2.md`) — its P1 section, all reproduced with the equivalence oracle, plus what the adversarial re-checks of the fixes turned up. First batch, engine only:

- **P1 — LaTeX display `$$` did not honour `\$`.** `LATEX_BLOCK_REGEX`'s display branch had no escape guard while every other `$` reader did: `Cost \$$x$ each. … | table | … $$` paired the escaped `$` with the real `$$` far below and rewrote every `|` of the table to `\vert{}` (stateless output was wrong, and the incremental wrapper — whose quiescence probe honours escapes — froze the prefix and then disagreed with the full run). Both display delimiters now use exactly the probe's lexicon: a `$$` preceded by an EVEN run of backslashes is a delimiter, nothing else matters (a `(?<![\\$])` guard was tried first and disagreed on `$$$$` / `\$$$` — caught by the re-check; 645k random frames byte-equal after).
- **P1 (regression of 2.4.5's cross-line tag fix) — attribute quotes across the line ending.** The cross-line-tag model ended the tag at the next line's first `>` and poisoned on any quote before it. parse5 keeps tokenizing an attribute VALUE across line endings: `<hr title="` + `\n<p></div>` leaves the outer div open (the `>` is a value byte), and `<div\n  class="a">` — the most common wrapped-attribute shape — was poisoned for the rest of the stream (froze 0.4% of a document instead of 96%). The scanner now carries parse5's attribute-area state (`outside` / after `=` / unquoted / inside `"` or `'`) across lines: a `>` ends the tag only outside a quoted value; a value still open at the blank line poisons.
- **P1 — parse5 bogus comments.** In a real html-flow run `<!` (not `<!--` / declaration / CDATA) and `</` + non-letter open a bogus comment eaten to the next `>` — a `</div>` inside is comment text; the scanner counted it as a close.
- **P1 — RAWTEXT / RCDATA elements in the type-6 list.** `title`, `iframe`, `noframes`, `xmp`, `noembed`, `noscript` are ordinary html blocks to micromark but text to parse5: `<div>\n<title>\n</div>\n</title>` closed the outer div in the balance. The scanner now holds a raw-text element open until its own end tag and ignores every other tag and comment token inside (`plaintext` never ends: poisoned).
- **P1 — a lone `\r` is a line ending to the scanner too.** 2.4.5 fixed the splice's line counter; the scanner still split on `\n` only, so `a\r` + a fence / `$$` opener sat inside one paragraph line and a candidate landed inside the open block. Lines now end at `\r\n`, `\r` or `\n` (a lone `\r` as the very last byte is not confirmed).
- **Pre-existing, from the re-checks:** the self-closing flag on a NON-void element is ignored by parse5 in HTML content (`<div/>`, `<title/>`, `<p/>` open — the scanner skipped them and froze past a div that swallowed the tail; foreign content, its roots and everything below an HTML integration point / breakout tag modelled); `<div a=<` (a `<` in the attribute area) was not counted as an open (the truncated-tag anchor is now the last `<` that starts a tag NAME); a `>` inside a quoted attribute value on the tag's OWN line ended the tag (`</div a=">` — parse5 keeps eating to the closing quote; the tag line is now walked with the same attribute-value state machine, and a tag left open there carries its state to the next line); `<title>` & co. inside `<svg>`/`<math>` are foreign elements (no raw-text switch there, only below an integration point); and `noscript` was briefly modelled as raw text — hast-util-raw runs parse5 with `scriptingEnabled: false`, so its content is ordinary HTML (caught by the batch review before release).
- **Pre-existing — a closing tag with attributes is not a closing tag to micromark.** CommonMark's html-text (and type-7 flow) accept `</name` + optional whitespace + `>` only, so `p <div> x </div a="b"> y` is literal text: parse5 never sees the close and the `<div>` wraps everything after it, while the scanner counted the close and froze past it. Closing tags carrying attributes are now applied only inside a real html-flow run (type 6 admits them — `</div a="b">` on its own line is html flow because `div` is a type-6 name; `</span a="b">` is not, and is paragraph text).
- Fuzz corpus: dangling-open-quote / paired-quote / bogus-comment / raw-text-element / lone-CR families with coverage meters — the four blind spots the review listed as the reason these shapes passed every soak.

The review's P2/P3 items, second batch (no engine parse-layer change):

- **Cross-chunk pre-check matched the wrong form of a label.** micromark keeps backslashes in a reference's `identifier` (`[^a\*b]` → `a\*b`; only `label` is unescaped) and the registry keys are built from it — but the PASS 0.5 substring pre-check unescaped the source first, so every label holding an escaped punctuation character missed for good and the cross-chunk reference rendered literally. `normalizeForMatch` is now `normalizeId` (2.4.5's narrowing kept the wrong premise).
- **LaTeX pass:** the currency-escape parity check re-scanned the processed line on every match — O(line²) on a line with many currency hits (an 8 KB row: 100 ms per frame, 1 ms now, incremental bare-`$` counter); the incremental tail pass ran the unclosed-`$$` scan twice when the tail starts with `$$` (the streaming display block's steady state).
- **Sanitize schema:** the engine's exported `sanitizeSchema` is deep-frozen (the README called it a read-only singleton; `tagNames.push('script')` used to widen the sanitizer process-wide — the `extendSanitizeSchema` draft stays mutable); raw-text elements (`style`, `title`, `textarea`, `noframes`, `noembed`, `xmp`, `iframe`, `plaintext`) are stripped WITH their content instead of unwrapped (`<style>a{b:c}</style>` no longer leaves `a{b:c}` as body text); the Footguns note says that adding a tag admits its whole semantics.
- **Coordinated footnotes:** a chunk's very first frame (no chunk symbol yet) shows a known global number instead of nothing (SSR shipped a footer backref to no anchor); the aggregate footer's tree is built only by the last chunk (every chunk rebuilt it on every registry version — O(N²) on mount).
- **Mantine:** mermaid re-asserts `securityLevel: 'strict'` whenever `mermaidAPI.getConfig()` reports otherwise, not only on a theme flip (a host that goes `loose` for `click` interactions would otherwise feed un-purified SVG into our `innerHTML`); the light card uses scheme-independent theme tokens (`--mantine-color-black` / `-white`) so a dark Provider with `colorScheme="light"` keeps its icons visible, and the dark hover rule is restored; JSON pretty-print expands string values that are JSON DOCUMENTS (the tool-transcript shape) but no longer rewrites `"true"` / `"123"` / `"null"` into other types — `deep-parse-json` dropped for a small local expander; the mermaid "open in a new window" action is a real header button and the SVG container carries no ARIA role (both `role="button"` and `role="img"` would make mermaid's own `graphics-document` semantics and accTitle/accDescr presentational); the definition list uses logical properties (RTL mirrors it).
- **Release workflow:** a pre-release train (`x.y.z-beta.1`) publishes under its pre-id dist-tag (`beta` / `rc` / `next`) instead of taking `latest`; the train-tag check also verifies core's exact `workspace:*` pin on engine and that the `remark-mark-highlight` version engine expands to already exists on npm.
- **Engine API note:** `lastRegionStart` and `DEF_LINE_START_RE` (`@internal`, "exported for tests only") left the engine package root — they were reachable through `export *`; nothing in the repo or the docs used them from the barrel.
- **Docs / repo hygiene:** `custom-components.md` says that overriding `pre` under Mantine also means `customComponents.code` never mounts for fenced blocks; `sanitizeSchema` gate anchor and Gate numbering in the generics guide; `#install` badge links; dark token examples in `design-tokens.md` match the shipped values; `SECURITY.md` / `apps/docs/content/guides/index.md` ask for exact versions; `core/plugins/package.json` stub for resolvers that ignore the exports map; `assert-dist-clean` covers `dist/plugins/*`; `.gitignore` covers `.impeccable/` and the scheduler lock; `pnpm bench` runs the Vitest micro-benchmark and `benchmark.md` says which numbers are a dated snapshot; `collectDefLabels`'s test-only helpers left the package root; a paragraph's truncated `<td b` is poisoned only once a later `>` confirms it as a tag; the LaTeX code-span search recognizes CR / CRLF blank lines like the scanner.

Third batch — the cache/streaming defects the review filed under P2:

- **An unclosed raw-HTML container escaped the per-block fingerprint.** Mid-stream, rehype-raw reparents the following siblings into an unclosed `<details>` / `<div>`; the container's own mdast node is an empty `html` node, so every taint fact derived from it came out empty and the block fell back to the un-fingerprinted cache key. An equal-length edit BEFORE the container could then change a footnote number baked INSIDE it and the stale subtree stayed cached (the mark resolved to a null global occurrence and vanished).

  The container now reads its taint footprint from the HAST subtree it actually swallowed — the placeholders' labels and baked `localOccurrence` / `localUrl`, the standalone footnote marks — which is exactly what the cached ReactNode holds. A swallowed standalone LINK or IMAGE reference renders as a plain `<a href>` / `<img src>` that the subtree scan cannot tell from an inline link, so the block is additionally marked tainted when any reference or definition in the source falls inside the swallowed extent — otherwise a definition sitting _before_ the container (outside the digest's hashed range) could change the rendered href with every cache-key component unchanged.

- **…and it swallowed the footnote section too.** The synthesized `<section data-footnotes>` inside a container is not a top-level plan item, so coordinated mode's "skip the local footer, the aggregate renders it" rule never fired: the document showed two `<section data-footnotes>` with colliding `li` ids, and the marks' `href` had two candidate targets. Coordinated renders now strip the swallowed section from that block's subtree; standalone renders keep it where the full parse puts it.
- **Smooth streaming: a frame cut inside a surrogate pair revealed a partial cluster.** The lone high surrogate is a grapheme cluster of its own, so the cluster before it was confirmed — and the completed pair then merged the two, leaving the revealed prefix inside the merged cluster (`👩‍👧‍👦x` cut at UTF-16 index 5 revealed `👩‍`; also `👍` + skin tone, regional-indicator flag pairs). The module's contract says that never happens, and the repo's own streaming simulator slices by UTF-16 index, so this was the default path. Two clusters now stay tentative when the source ends on a dangling high surrogate whose predecessor could absorb the completed character.

- **New optional prop `documentIndex` — chunk order stops depending on mount order.** Cross-chunk state (footnote numbering, which chunk renders the aggregate footer) follows the order chunks register in, which was mount order. A virtualized transcript breaks that: a message scrolled out of view unmounts and, scrolling back, re-registers _after_ the chunks that stayed mounted — footnotes renumber and the footer moves into the middle of the document (`useId` is position-derived, so a remounted chunk cannot reclaim its slot on its own). Pass any stable per-chunk ordinal and the registry keeps chunks sorted by it. Optional, and omitting it keeps the previous behaviour exactly; chunks that supply an index sort ahead of chunks that do not, so a partial rollout degrades predictably. The cross-chunk guide's "on the roadmap" note is now the documented prop.

Verification: every fixed shape is a deterministic pin (red on 2.4.5); release soak (splice fuzz 50k / direction battery 20k / K=4 census, LaTeX incremental property suite at 10 000 streams) clean on the final engine; five oracle passes over the fixes.

## 2.4.x — The project-review sweep

### 2.4.5 — Full review of 2.4.3: a truncated end tag zeroed the tag balance, lone-CR line numbers, code spans across paragraphs

(There is no 2.4.4 — the number was skipped.) A six-track review at 2.4.3 (engine parse, engine preprocessors, core, mantine + plugin, security, infra + docs); the P1 was reproduced with the equivalence oracle before it was fixed. One P1, five P2, a set of P3s — plus what the adversarial review of the batch itself turned up:

- **P1 — A line-truncated end tag was counted on the spot.** `para </style` (no `>` on the line) decremented the balance immediately, while the open-direction truncation had been pended-and-reverted since 2.4.0. To micromark that text is prose; to parse5 the `<style>` element is still open (RAWTEXT waits for the `>`) — so the next blank line read as balanced and the boundary crossed a still-open element (splice: the tail is a paragraph; full parse: the tail is swallowed as raw text — `<textarea>` too; container tags happened to be caught by a later separator-count bail, at the price of a permanent full-parse lineage).

  A truncated end tag is now never counted where it appears: in paragraph context it is treated as prose (a block-indent `>` on the next line is a blockquote; the 4+-space continuation shape that would complete it is not modelled — over-block); inside an html-flow run it is pended and applied only when a later line of the run brings the `>` (parse5 completes the end tag there); at the blank it is dropped unapplied — the element stays counted, over-block. The fuzz corpus gains the truncated-close shape (`proseTruncatedClose` meter) — it only had truncated opens, which is why fuzz and soak never saw this.

- **P1 (found by the adversarial review of this batch, pre-existing) — the line after a truncated tag is attribute garbage up to its first `>`.** Inside an html-flow run, a line ending inside a tag (`<div`, `</div`, `<br` — open, close or void) leaves parse5's tokenizer in that tag: on the next line everything up to the first `>` belongs to it, so a real-looking `</div>` there completes _that_ tag and does not close the outer element — the scanner counted it as a close and froze past a still-open `<div>` / `<details>` (`<div>\n<div>\n</div\n</div>`, `<div>\n<br\n</div>`; visible at 1-char slices, hidden at coarser ones by a bail that needs the previous frame to have swallowed already).

  The scanner now tracks "inside a cross-line tag" — gated on the run being a _real_ micromark html block start (type 6 / type 1 / a paragraph-not-interrupting type 7; a paragraph starting `</i` or `<br` is not one, and the next line's `<div>` / `<!--` there are real blocks — the oracle re-check caught the looser gate swallowing them): a following line without `>` gets no tag scan at all; the line with the `>` completes the pending close and scans only the text after it; a quote before that `>` poisons (parse5 is inside an attribute value — which `>` ends the tag is unknowable), and so does a de-indent below the truncated line (a list item's html block may have ended there, where hast-util-raw resets the tokenizer and the next `<div>` is real).

  Fuzz corpus: `crossLineTagGarbage` family. Also from the release soak's direction battery (pre-existing): a stray table-part tag (`<td>`, `<tr>`, `<col>` …) now poisons the scanner's candidates from the tag on — the splice already bailed on it in the frozen prefix (2.4.3), so no output changed, but a `<td>` prefix could still "freeze" a table whose parse5 shape depends on the tail, and every frame paid a scan + tail parse + splice attempt that the bail then discarded.

- **P2 — A lone `\r` is a line ending.** The splice's line rebase counted `\n` only; micromark counts `\r`, `\r\n` and `\n` as one line ending each, so every lone `\r` in the frozen prefix left the tail's `position.line` one short (offsets and structure were right — consumers reading `position.line` got the wrong line). 2.4.2 stripped the `\r` of CRLF for the scanner; the counter now matches micromark for all three.
- **P2 — LaTeX preprocessor: a code span cannot cross a blank line.** Two lone backticks in different paragraphs were paired as one span, and every `$…$` between them stayed unconverted (rendered as literal dollars). The closer search now stops at the first blank line — the inline sibling of 2.4.2's fence-closer fix.
- **P2 — Coordinated block-memo fingerprint gains the chunk-local footnote state.** The cached node bakes the engine's per-chunk `localOccurrence` / `localNumber` for footnote marks (a running counter over the preceding refs); an equal-length in-place edit upstream (`[^x]`→`[^w]`) left a later block's raw, position and registry answers unchanged and the stale occurrence resolved to a null global occurrence — the mark vanished and did not heal. The fingerprint now carries each ref label's prior-occurrence count and first-appearance rank (JSON-encoded, `fl:` part), precomputed once over the mdast in document order per ref node — mirroring the engine's counter exactly (definition bodies are footer-rendered and skipped; a definition met first takes part in the rank; a range-fallback block that maps several hast siblings to one mdast node cannot double-count). Append-only streams were never affected.
- **P2 — Incremental LaTeX wrapper: failed freezes back off, a lone backtick no longer freezes the rest of the stream.** When the freeze candidate is never quiescent (an early stray `$` such as `US$` keeps delimiter parity odd for every later slice; a lone backtick latched the dangling-run hazard for the whole active region), every append paid three whole-document passes — 3.2× / 1.8× the stateless cost on a 42 KB document streamed 600 times, exactly on the documents the optimization exists for. Three changes, no API change: a failed attempt now waits until the active region has doubled before the next one (failed-attempt cost is a geometric series; freezing later never changes output — every frame still equals `preprocessLaTeX(full)`); the backtick hazard releases at a blank line (a code span cannot cross one — see the preprocessor fix above — so a blank settles every run before it, and lines after it are safe cuts again); the tail pass skips the quiescence probes it never read.

  Measured after: stray `$` 1.03×, lone backtick 0.06×, clean 0.06×. A shorter "fallback cut" was designed, implemented, and dropped on review: quiescence is segment-granular (plain prose is one segment) and the unfrozen prefix before trouble is under the attempt threshold anyway — the backoff alone gets to the stateless cost. Tests: `@internal` `onAttempt` hook pins the logarithmic attempt bound and the freeze progress; the equivalence suites run with backoff off (`@internal backoff: false`) so 1-char chunkings keep exercising every cut rule.

- **P2 — `esbuild` override bounded above** (`>=0.28.1 <0.29`) like the file's other overrides — esbuild is 0.x, a lockfile re-resolution could have swapped the verified 0.28 for an untested 0.29.
- **P3:** `normalizeForMatch` strips only backslash + ASCII-punctuation escapes (a literal `\` in a label made the cross-chunk pre-check miss it); the currency-escape pass no longer splits the whole remainder into lines on every match; a footnote mark whose label is numbered but whose own occurrence is not in the registry — transiently (a later-mounted chunk repeating the label) or permanently (a ref inside a footnote definition body: contributions skip definition bodies) — now shows the global number (without an id — no footer backref targets it, and a chunk-local id would collide with another chunk's real mark) instead of rendering nothing; mantine's `pre` override tolerates a string `className`; the mermaid "view SVG" window opens with `noopener`; the mermaid dark header icon uses a static dark token (explicit `colorScheme="dark"` under a light Provider left it invisible); the release workflow also checks that mantine's core peer range moved with the train; engine README (`katex` is an optional peer; the pipeline table lists exported symbols only), `SECURITY.md` (supported versions; `urlTransform={null}` is not an escape hatch — it means default), eslint config pointer.

Not changed on purpose: workflow action SHA pinning and the `packageManager` integrity hash — the supply-chain hardening group already declined by design in 2.4.0.

Verification: every fixed shape is a deterministic pin (red on 2.4.3); release soak (splice fuzz 50k / direction battery 20k / K=4 census, plus the def-label 30k leg and the LaTeX incremental property suite at 10 000 streams) clean on the final engine.

### 2.4.3 — Full review of 2.4.2: registry URLs stored raw, two parse5 tree-construction quirks, nested-list fences in the LaTeX pass

A seven-track review at 2.4.2 (engine parse and runtime layers, core, mantine + remark plugin, a sanitization track, infra + docs). No P0; four P1s, all reproduced and fixed:

- **Cross-chunk definition URLs enter the registry raw.** A contribute-time `urlTransform` pre-pass collapsed a protocol-blocked URL to `''` before the render-time gate could tell blocked (attribute absent) from legally empty (`href=""`) — undoing 2.4.2's distinction the moment the registry landed (the DOM flipped from `<a>` to `<a href="">` in front of the user) — and ran a rewriting transform twice where standalone runs it once. The render-time `sanitizeCrossChunkUrl` gate is now the single point of enforcement; `extractContributions` no longer takes a `urlTransform` option (engine API).
- **Splice — parse5 tree-construction quirks.** A stray `</br>` becomes a `<br>` and a stray `</p>` an empty `<p>` in a full parse (HTML's two end-tag synthesis exceptions); the tail-only parse opens in a mode that drops them until the first element start tag, so the incremental frame lost the element (`x\n\n</br>\n\ny`, also behind a leading comment or PI). A stray table-part tag (`<td>`, `<tr>`, `<col>` …) outside any table re-routes how every later GFM table is built (cell text foster-parented to the root, skeleton gone) — for the rest of the document. Both now bail to a full parse: any such tag in the tail's leading run of html blocks, and any table-part tag anywhere in the frozen prefix.
- **LaTeX preprocessor — fences at any indentation.** A fence two list levels deep sits at column 4; the 0–3 space rule (measured from column 0, not from the list container) rejected it and `$` inside the block was rewritten (`~~~` blocks; backtick fences escaped only by luck). Openers are accepted at any indentation; a closer must sit at most 3 columns deeper than its opener (CommonMark's container-relative rule — a ` ```` line inside a column-0 fence is content, and treating it as a closer would expose the block's body). Indented code blocks remain unmodelled (indistinguishable from a list continuation paragraph without a container model) and are pinned as a known limitation.
- **Docs:** `Registry.resolveLinkDef(label).url` is now documented as RAW — the recipes in the cross-chunk and URL-sanitization guides sanitize before rendering it, and the `resolveLinkDef` JSDoc says so.
- **P2/P3:** the raw-html block-memo digest hashes the swallowed extent's source (an equal-length single-frame replacement inside an unclosed `<details>` was a stale cache hit); a failed `highlight.js` download retries like mermaid's; `ci.yml` declares `permissions: contents: read` and its overrides comment matches the script; `sanitizeCrossChunkUrl` treats an explicit `protocols: undefined` as no restriction like upstream; `snap()` is documented as outside the trailing-grapheme hold-back promise; the "default schema not exported as a value" claim is scoped to `@ai-react-markdown/core` (the engine exports it read-only); the mermaid shared-singleton `securityLevel` premise is documented.

Verification: generator family `treeQuirkArb` + census token `</br>` (the 2.4.2 splice fails the new pins), release soak (splice fuzz 50k / direction battery 20k / K=4 census) clean on the final engine.

### 2.4.2 — Full review of 2.4.1: two silent equivalence forks and the byte-parity leftovers

A five-track read-only review of the whole repository at 2.4.1 (engine parse layer with a real-plugin-chain fuzz, engine streaming layer, core, mantine + plugin, infra + docs). The release gate was green and the two 2.4.1 fixes held; the review found two P1 breaks of the splice-equals-full-parse promise plus a set of narrower defects. All fixed:

- **P1 — Unicode whitespace lines were treated as blank lines.** The freeze scanner used JS `trim()` to detect blank lines; micromark only knows U+0020 / U+0009. A line holding only U+3000 (full-width space — common in CJK output) or NBSP is a lazy paragraph continuation, so the boundary landed inside an unfinished paragraph (splice: two `<p>`; full parse: one). The same JS-vs-micromark gap sat on the fence/math closer check (` ```␠NBSP ` is not a closer). Both use an ASCII-only test now.
- **P1 — A reference label spanning a soft line break escaped reference taint.** `see [foo\nbar] end` never matched the per-line bracket scan, the paragraph froze, and a later `[foo bar]: /url` retargeted frozen literal text into a link. The scanner now carries a paragraph's unclosed `[` across lines and taints the joined label (over-block-safe; a blockquote continuation's `>` marker is dropped so the label can still resolve).
- **Follow-ups from the adversarial review of these fixes:** every remaining JS `trim()` in the scanner is ASCII-only too (a definition rest ending in NBSP registered a ghost definition; a full-width space before a paragraph-inline `<!--` skipped the divergence poison; label normalization now matches micromark's byte-for-byte), and a _failed_ inline link (`[foo](bad url)` — space in a bare destination) keeps `[foo]` tainted as the live shortcut reference micromark makes of it, instead of being skipped as a link.
- **Splice:** an html block whose trailing end tags parse5 drops (`</details>\n</details>`) leaves a positioned whitespace-only remnant the full parse later merges into the seam separator; the cut bails to a full parse instead of rebuilding it wrong. `rebaseTree` tolerates a consumer plugin's half-built `position` instead of throwing out of the render path.
- **Splice, from the release soak (pre-existing on 2.4.1):** an html block parse5 drops outright (a stray `</details>` line) leaves no node, so the separators around it merge into one text — the trailing rebuild emitted two, and a position-less KaTeX block after it paired with the dropped block and was frozen twice. Both paths bail to a full parse.
- **LaTeX preprocessor:** a fence line with trailing text (` ``` not-a-closer `) is no longer a closer, and a backtick fence whose info string holds a backtick is not an opener — the old rule inverted the open/close phase for the rest of the document.
- **Byte parity, coordinated vs standalone:** a linked image alone in a paragraph (`[![pic](url)][ref]`) is unwrapped through the link placeholder too; a legal empty destination (`[x]: <>`) keeps `href=""` while only a protocol-blocked URL drops the attribute (the two used to collapse); the resolved footnote mark writes `data-footnote-ref=""` like the server branch; the block-memo fingerprint cannot collide on a `|` inside a URL or title; a block with a half-built mdast position renders uncached instead of vanishing; a contribute under a released chunk symbol is ignored so the registry still empties.
- **Mantine:** language auto-detection re-schedules after a non-streaming replacement (it stayed "unknown" for good); the JSON pretty-print gate requires balanced brackets, so pretty-printed JSON is no longer re-parsed on nearly every streamed chunk; a failed `import('mermaid')` on the end-of-stream pass keeps the current view and retries the download (bounded) instead of showing a permanent Render Error.
- **Engine API note:** `sanitizeCrossChunkUrl` (engine barrel) now returns `string | null` — `null` for a protocol-blocked URL (render the attribute absent), `''` for a legal empty destination. `@ai-react-markdown/core` pins the engine exactly; direct engine importers see the widened type.
- **Infra / docs:** a package tag (`core-vX.Y.Z`) for a lockstep package is refused by the release workflow (it would bypass the train's lockstep check); the `qs` / `brace-expansion` overrides get the upper bound the file's own policy calls for; the four packages declare `engines.node >=20`; CRLF lines are scanned without their `\r` so every line-anchored rule judges like LF; version-script header, `RegistryInternal` export comments, remark-mark-highlight parity-pin wording, and the core README's `blockMemo` output-invariance claim (standalone only) corrected. The streaming cursor's animation names derive from its style fingerprint (bumped to `v2`, so a page mixing versions never resolves the other version's keyframes).

Not changed on purpose: `snap()` (content replacement) still does not fire `onSmoothDrained` — that is the documented contract; the LaTeX single-character lookbehinds and the currency-escape pass stay as they are (no user-visible error was constructed).

Verification: generator-first — new fuzz families (`unicodeBlank`, `crossLineRef`) and census tokens made the 2.4.1 scanner self-report both P1s before the fix; every fixed shape is a deterministic pin (red on 2.4.1); release soak (splice fuzz 50k / direction battery 20k / K=4 census) clean on the final engine.

### 2.4.1 — Post-release review of 2.4.0: two engine regressions and the SSR byte-identity gaps

A second adversarial review pass over the 2.4.0 diff (probes plus a mini-fuzz over the newly introduced constructs, every failure minimized and replayed on 2.3.3 to separate regressions from pre-existing bugs). Two regressions and a set of pre-existing gaps, all fixed:

- **Regression — the phantom-suffix closer could open a block.** 2.4.0 closed an open fence/math block before appending the coordinated sentinel definitions; for a fence opened INSIDE a list item that later de-indented content had already ended, or one closed by a ≥4-space closer the scanner cannot see, the emitted closer opened a _new_ fence around the sentinel lines (sentinel text in the code block, cross-chunk refs lost — worse than the bug it replaced). Closers are now emitted only for column-0 openers, which are provably top-level; the arbiter harness asserts every closer is output-neutral.
- **Regression — the truncated-tag revert could drop a real tag** whose `>` sat inside a code-span mask (`<div x="\`">b\``: micromark parses the tag first), and skipped the seam-remnant check while the phantom open was counted. Both under-blocks closed; a real tag whose `<`is outside every mask is now counted even when its`>` is inside one.
- **Pre-existing under-blocks fixed:** tags on a line touched by a raw construct were never scanned (`?><details>` after a terminator, `<details> <?php` before an opener); whitespace-only floating remnant after a stray end tag counts as seam remnant; a stray end tag's dropped-tag remnant right after a frozen element or definition was duplicated by the splice (the cut now freezes a trailing literal only when it is that html block's own text; a tail led by such a block merges its remnant, and a tail led by a dropped `<div` opener bails to a full parse instead of guessing — the last two surfaced by the release soak once the shape entered the fuzz corpus); the terminator-mention guard missed `[ __aimd_…]`.
- **Coordinated placeholders now match standalone byte-for-byte** in the four cases the 2.4.0 claim missed — footnote ids are percent-encoded like mdast-util-to-hast's (`[^注]` / `[^a%b]` anchors work; the aggregate footer uses the same encoding), an image reference alone in a paragraph is unwrapped, URLs go through `normalizeUri`, and a blocked URL leaves the attribute off instead of `href=""`. Two of these were also wrong on the client's resolved path since coordination shipped.
- **Mantine:** language auto-detection restarts when a block is replaced mid-stream (regenerate) instead of keeping the previous block's label; a failed lazy `import('mermaid')` / `import('highlight.js')` is retried instead of cached forever.
- Docs: `--aim-spacing-sm` consumers, mantine tab labels are lower-cased.

Verification: release soak (splice fuzz 50k / direction battery 20k / K=4 census) clean on the final engine; every fixed shape is a deterministic pin.

### 2.4.0 — Sixty-three findings from a whole-repository review, fixed in one train

A full review of the four packages (engine / core / mantine / remark-mark-highlight), the Storybook suite, the docs and the release pipeline produced 66 findings — no P0, six P1. This release closes 63 of them (two supply-chain hardening items were declined by design; one style finding was rejected as an intentional visual choice). Grouped by what a consumer can observe:

**Incremental parsing (engine) — correctness**

- **Three freeze-boundary under-blocks, all in shapes no fuzz generator could reach.** The line scanner modelled comment/PI terminators after micromark but missed closers that overlap their opener (`<!-->`, `<!--->`, line-start `<?>`), ignored the places where parse5 — which decides the final HTML — disagrees with CommonMark (`--!>` closes a comment for parse5 only; a `<?…` / `<![CDATA[…` bogus comment ends at its first `>`), and registered link definitions whose destination micromark rejects (`[a]: /u(x`, `[a]: <u<v>`) as ghost defs that released reference taint early.

  Each let a boundary freeze past a really-open `<details>` (the swallow class) or let a later real definition retarget frozen text. Overlapping closers are now closed on the spot; two-grammar divergences poison the phase (sticky over-block, never a guess); the destination check runs micromark's own grammar. The fix went generator-first: the fuzz families and the exhaustive census alphabet were extended so the OLD scanner fails within ~30 samples — which surfaced two more pre-existing under-blocks (`<!-- c --> tail` seam remnant; the same overlapping `-->` hidden inside an already-open comment) and, under adversarial review, two follow-ups (backslash escapes in destinations; residue after an overlapping closer).

  Every counterexample is a deterministic pin.

- **`if x<y then` prose no longer disables the splice for the rest of the stream.** A line-truncated `<x` counted as an open tag forever; paragraph-line truncations are now reverted at the paragraph's blank line unless a `>` confirmed them (html-flow truncations stay counted — parse5 really keeps tokenizing those).
- Splice guards: the terminator-mention guard is case-folded like micromark's label matching; the injection walk uses filter semantics and bails on a position-disordered plugin tree instead of silently skipping a definition.
- **Verification:** the release soak (50k splice fuzz across 12 seeds, 20k direction battery, K=4 exhaustive census across 12 shards on the enlarged 27-token alphabet) ran clean on the final engine; the fuzz corpus gained overlapping-terminator, raw-text-block, invalid-destination and prose-truncation families with coverage meters.

**Cross-chunk coordination**

- **Padded / soft-broken reference labels resolve in coordinated mode.** `normalizeId` now delegates to micromark's `normalizeIdentifier` (trim + ASCII-only whitespace folding); before, `[ foo ]` or a label broken at a soft line ending looked up `' FOO '` against a def keyed `'FOO'` and fell back to literal text — in coordinated mode only.
- **The phantom-definition suffix survives an open code fence.** A streaming frame that ends inside an unclosed ``` or `$$` block used to swallow the appended sentinel definitions — visible as sentinel text inside the code block, and every cross-chunk reference in the chunk falling back to `[text][label]` for the whole block. The engine now emits an output-neutral closer for the open block first (same fence char/length, at the opener's indent), only when the scanner's phase is trusted.
- **Coordinated server rendering keeps its marks and links.** With an empty registry (server, first client frame) the placeholders now fall back to the chunk's own standalone facts — local footnote number, own link/image definition — so a wrapped chunk's server output is byte-identical to its standalone render (pinned) and hydration is mismatch-free; document-wide numbering and canonical links take over once the chunks register. Cross-chunk references still render literally until then (documented).
- Runtime prop changes no longer leave stale output behind caches: flipping `preserveOrphanReferences` at runtime refreshes the synthetic footer (block cache flushed on the policy change); the legacy `blockMemo: false` path applies orphan protection too, so `blockMemo` is genuinely output-invariant in standalone rendering; swapping the sanitize schema / rehype chain at runtime re-publishes footnote bodies to the registry (the contribute fingerprint compares the parse-input chain by identity).
- `<AIMarkdownSmoothStream smoothCoordination={null}>` now falls to the default (`true`) per the library-wide null rule instead of silently switching turn-taking off. `Registry.releaseSymbol` ignores an unbalanced extra release instead of parking the refcount below zero and leaking the chunk.

**Streaming behaviors**

- `useSmoothStream().flush()` keeps the grapheme discipline mid-stream: it reveals everything confirmed and holds the trailing grapheme exactly as the animation does (a surrogate half or a growing emoji ZWJ sequence never reaches the parser); `streaming={false}` or the next append confirms it.
- The identity-flip dev warning restarts its count for flips more than 10 s apart, so three legitimate theme switches minutes apart no longer read as "changing on every render". `clobberPrefix` is memoized per document id.

**Mantine package**

- **`mermaid` and `highlight.js` are loaded on demand.** The ~1.5 MB mermaid module was a static import on the default `pre` component's chain — every consumer's main bundle carried it; it now loads on the first diagram that renders (the source view covers the load), and the root `highlight.js` entry (every language) is no longer imported at all — Mantine's own adapter already degrades unknown languages to plaintext, and auto-detection loads the full build when first needed. Apps that prefer eager loading call the new `preloadMantineCodeAssets()` at startup (or import the modules themselves).
- Auto-detection runs on a doubling schedule (early guess at ~32 characters, corrective re-run each time the block doubles, final verdict at end of stream) instead of re-scoring every language on every streamed chunk; JSON pretty-print lands as soon as the block looks complete instead of on every chunk of an incomplete one.
- The fence language is matched case-insensitively (` ```Mermaid ` renders a diagram); the SVG object URL is revoked when a popup blocker returns null; the chart-type tag uses Mantine light-theme tokens; a render that raced another instance's theme re-initialization is re-asserted; explicit `undefined` in the `codeBlock` group no longer punches through the defaults; code text is joined without invented line breaks. The MermaidCode streaming contract now has a browser-level QA story against the real renderer.

**Docs, tests, infrastructure**

- README/docs corrections: `smoothTurnTaking` in the wrapper API tables, definition-aware cursor behavior, `contentPreprocessors` is WARN_ONLY, design-token defaults and consumers, SmartyPants substitutions, the mantine default export, the Packages table lists `remark-mark-highlight`, and a virtualization caveat for chunk remounts (registration order drives numbering and footer placement).
- Tests: the CJK regression stories share one fixture and assert; CrossChunkStress asserts on the DOM what its header claims; remark-mark-highlight pins its interaction with remark-gfm; two QA stories drive runtime prop flips through real React commits.
- Release pipeline: the train tag verifies all three lockstep versions; the release job runs the root typecheck like CI; release-notes extraction warns instead of silently falling back; core and mantine tarballs ship a LICENSE; all four exports maps share one shape and export `./package.json`; mantine's build asserts a `process.env`-free dist.

## 2.3.x — The framework-agnostic engine

### 2.3.3 — Footnote definitions written above their references, and a blanked `fontSize`

Two edge-case fixes. First, in standalone rendering with the default `preserveOrphanReferences`, a footnote definition that appeared **above** its first reference was registered twice: the orphan-protection pass and mdast-util-to-hast's default reference handler judge "already registered?" by two different pieces of state (`footnoteOrder` vs `footnoteCounts`), so the footer emitted a duplicate `<li>` with a colliding DOM id and the superscript marker numbered by array length instead of position. The orphan pass now seeds the reference counter to `0` alongside its order push — zero, not one, so a never-referenced definition still emits no dangling backref and pure-orphan output stays byte-identical. Coordinated (`AIMarkdownDocuments`) rendering and the incremental splice replay are provably unaffected; the fix shipped with a standalone-mode regression battery and a clean run of the full three-leg release soak (50k splice fuzz, 20k direction battery, K=4 exhaustive census).

Second, `fontSize=""` — a blanked text input, or an empty string from an untyped caller — was forwarded verbatim into `--aim-font-size-root`. An empty custom property is CSS's _guaranteed-invalid_ value, so the entire `--aim-*` size scale (and the Mantine wrapper's overrides chained off it) silently collapsed to browser defaults. The empty string now joins `null`/`undefined` in resolving to the rem default, while `fontSize={0}` still means `0px`.

### 2.3.2 — Mermaid diagram controls work without a pointer

The Mantine Mermaid block's interactive surface was pointer-only: the rendered diagram opened in a new window on click but sat outside the tab order, and the two icon-only controls (show source, copy) exposed no accessible names. The diagram container is now a focusable `role="button"` that activates on Enter or Space, and both controls carry explicit `aria-label`s — keyboard and screen-reader users get the same interaction path pointer users always had. First external contribution, by @alectimison-maker. (#31)

### 2.3.1 — An unpaired surrogate in `documentId` no longer crashes the render

A consumer-supplied `documentId` containing an unpaired UTF-16 surrogate — typically a string truncated mid-emoji by an upstream pipeline — made the clobber-prefix derivation throw `URIError: URI malformed` synchronously, taking down the whole render before any markdown was parsed. The failure was length-dependent: ids over 16 chars survived only because the hash path's `TextEncoder` lossily folds lone surrogates to U+FFFD. Ill-formed ids of any length now route to the hash path over their raw UTF-16 code units with a domain-separating seed, so they render, stay deterministic, and distinct corrupted ids keep distinct prefixes — a lossy-projection fix was explicitly rejected because it silently merges ids truncated at different points. Well-formed ids derive byte-identical prefixes to 2.3.0. Dev builds log a once-per-id warning pointing at the upstream corruption, and the engine now exports `hasLoneSurrogate` as the single owner of the detection semantics. (#32)

### 2.3.0 — The engine moves into its own package; two long-latent splice seam bugs die on the way out

The Markdown engine — incremental parsing, LaTeX preprocessing, the definition/footnote machinery, and the sealed plugin pipeline — now lives in **`@ai-react-markdown/engine`**, a framework-agnostic package with zero React anywhere in its dependency tree. `@ai-react-markdown/core` consumes it and keeps a byte-identical public surface: every import you have today keeps working, nothing is renamed, and the runtime output is equivalent down to the parse tree. This is the structural prerequisite for non-React adapters (a Vue package is the motivating case) and, further out, embedded-runtime use — the engine is pure computation over strings and syntax trees, with no DOM access and no Node-only APIs on any runtime path.

- **What moved**: the splice/freeze incremental engine and its entire verification arsenal (fuzz batteries, exhaustive census, arbiter harness, soak scripts), the preprocessors (LaTeX, remend), the remark/rehype chain assembly with the sealed plugin catalog, sanitize schema machinery, the cross-chunk definition registry, and the pure parse/transform stages of the vendored react-markdown. The React half — rendering, hooks, block memoization, smooth streaming's React layer, the streaming cursor — stays in core. Core's runtime dependency list drops from 30 packages to 4.
- **Versioning**: the engine versions in lockstep with core and mantine, and core pins it exactly (`2.3.0`, not a caret range) — the engine's internal API carries no stability promise before 3.0.0, so a range would let a future engine drift under an older core. Treat the engine as core's internal supplier; depend on it directly only if you are building a framework adapter.
- **Two pre-existing engine bugs fixed** — found by a 1.7M-sample fresh-seed fuzz campaign run to validate the split, both reproduced byte-identically on 2.2.1 (they date back to the incremental engine's introduction, and their discovery doubles as the strongest byte-equivalence evidence for the migration itself):
  - **A processing-instruction-headed raw block could swallow trailing text.** parse5 ends a `<?…` bogus comment at the first `>` while micromark's flow construct runs to `?>`; a PI containing an interior `>` (`<?instr <b> ?> after the pi`) leaves a position-less text remnant that the splice cut could strand — the frozen side dropped it and the tail re-parse couldn't reproduce it. The cut now detects stranded remnants past the cut point and falls back to a full parse for that frame.
  - **An interior raw literal could lose its source position.** A positioned text between two elements of one html block (`</details>` text `<embed/>`, where sanitize strips the embed) was fed through the merge path that models block-final literals, shedding its trailing newline and dropping its position — a hazard for block-memo cache keying. A classifier now separates interior literals (kept verbatim, own separator) from block-final ones (merged with the seam, position dropped, as the full parse does), keyed on whether the literal's source ends at its owner's end.
- **Verification**: the full release gate (splice fuzz 50k, direction battery 20k, K=4 census across 12 shards, def-scanner 30k, LaTeX 5000 streams) plus a 1.5M-sample re-run of every discovery seed batch — all clean; the counterexamples are pinned as ~50ms deterministic tests; preflight 1153 tests across 70 files. Two independent review rounds (architecture + adversarial mutation testing) signed off, with the mutation pass confirming each half of the seam fix is guarded by its own pin.

## 2.2.x — Document-level turn-taking

### 2.2.1 — The streaming cursor follows footnote definitions; turn-taking polish

Two user-visible fixes, no engine changes:

- **The streaming cursor now follows a streaming footnote definition into the footer.** Definitions render in the relocated end-of-document footer, so the DOM tail and the source tail diverge — the cursor used to blink at the body tail while a citation footer streamed (the standard LLM ending). The renderer now derives the tail kind from the parse tree it is already holding (lazy continuation lines, blockquoted/listed/nested definitions all classified by micromark's own decisions, phantom injections filtered) and stamps a hidden same-commit marker the cursor reads: the indicator anchors inside the RIGHT footer entry by label (footer order is first-reference order, not source order), skips the backref arrows, returns to the body when prose resumes, and hides for tails it cannot truthfully point at — a streaming link-reference definition (renders nothing) or a definition whose footer entry lives in another chunk under cross-chunk coordination.

  A token-by-token citation Demo story shows the whole behavior live.

- **Turn-taking: an empty chunk released after its source ended no longer flashes one frame of cursor** (the release handshake's forced beat is scoped to non-empty backlogs), and the dev-only stuck-flag warning's judgment moved into a unit-tested pure function.

### 2.2.0 — Multi-chunk smooth streams reveal as one typewriter

Smooth-streaming chunks that share a `documentId` under `<AIMarkdownDocuments>` now coordinate automatically: a chunk that mounts with empty content waits until every earlier chunk is done (source ended AND reveal drained), then plays its backlog out through the normal drain law — one typewriter, one cursor, even when the sources stream concurrently. No engine, controller, `useSmoothStream`, or registry changes; the gate is a thin coordination layer on top.

- **`useDocumentSmoothStream`**: `useSmoothStream` plus the gate, same props-shaped result for custom wrappers (`<MantineAIMarkdown {...smooth} documentId={id} />`). Without a `documentId` or outside the wrapper it degrades byte-identically to `useSmoothStream`. The shell routes through it automatically.
- **Safe by construction for real chat UIs**: non-empty mounts pass through ungated (hydration, virtualized scroll-back, and mid-stream remounts keep their instant snap — nothing blanks out or replays); completion is sticky (a tool-call round 2 never re-hides a successor's visible text); unmounting releases successors (virtualization can't deadlock the queue); different `documentId`s are independent queues; a chunk whose stream ends without producing text still passes its turn.
- **Escape hatches and observability**: per-chunk `smoothCoordination={false}` (releases immediately even mid-gate — the escape for chunks inserted out of mount order), wholesale `smoothTurnTaking={false}` on the wrapper, and a dev-only warning when the queue is stuck behind a predecessor whose `streaming` flag was never flipped false (heartbeat-based, so a slow model that is still emitting never trips it).
- **Verification**: three design-review rounds before implementation, two implementation-review rounds plus a final audit after; a seven-story convergence-only browser suite covers sequencing with a single-cursor latch, release-animates-not-snaps, sticky-done overlap, virtualization scroll-away/back, dual-document independence, the wedged-queue escape, and the zero-notify empty chunk — the last falsification-verified (an edge-driven done regression turns it red). Full preflight: 1119 tests. Engine byte-untouched, so no soak gate applies.

## 2.1.x — Smooth streaming

### 2.1.0 — Typewriter pacing on an adaptive jitter buffer; the per-frame hot path goes fully incremental

New feature surface plus a three-front performance campaign. The `feat!` marker on the pacing-law commit is an iteration on a surface that never shipped — nothing in this release breaks against 2.0.3.

- **Smooth streaming**: `<AIMarkdownSmoothStream>` reveals bursty token chunks as a steady grapheme-by-grapheme typewriter. Three layers — a framework-free `createSmoothStreamController` (no React/DOM dependency), a `useSmoothStream` hook whose props-shaped result spreads into any wrapper (`<MantineAIMarkdown {...smooth} />`), and the shell with the full `<AIMarkdown>` surface plus two props: `smoothPacing` and `onSmoothDrained`. The controller is an adaptive jitter buffer: irregular-sampling EMAs track the source's arrival rate and burst interval, the target buffer sits at ~one burst (the causality floor for smoothing), and a stamped deadline drains the backlog within `drainMs` of stream end — fast models no longer sit at a fixed window of lag, slow models are not outrun into a stall-pop rhythm.

  Pauses never enter the cadence estimates (a tool-call gap is not a rhythm), and NaN/Infinity in any knob falls back instead of poisoning the law. The tuning surface is three presets — `'smooth'` / `'balanced'` (default) / `'responsive'` — the audio-plugin buffer convention; numeric per-field overrides live on the controller, with the bundles exported as `SMOOTH_STREAM_PACING_PRESETS`.

- **Contract details that matter in real chat UIs**: mount and content replacement snap (SSR hydration is byte-identical, virtualized lists never replay the animation); `finish` is re-enterable for multi-round tool-call flows; the held-back trailing grapheme means surrogate pairs and emoji ZWJ sequences never reach the parser as halves; the shell keeps `streaming` true downstream until the reveal drains (the cursor doesn't unmount mid-animation) and `onSmoothDrained` fires exactly once per stream round. Hardened by a five-round review campaign — StrictMode-revivable disposal, drained-latch arming on backlog formation, and a feedforward-pinning test band all landed red-first.
- **Coordinated-mode def scanning is now incremental in both directions** (the former Documents+smooth footgun is gone): the fast-path probe requires the full `]:` definition signature, so bulleted link lists, task boxes, and reference lists — the shapes AI output is dense with — never leave the fast path; and when a definition block genuinely streams (a citation footer), a freeze-boundary prefix cache re-parses only the live tail (~30ms → ~0.8ms per append on a 12k-char chunk). `computeFreezeBoundary` gains a scanner grammar profile (`mathFlow` / `referenceTaint` opt-outs) with engine defaults byte-identical; verified by a new fuzz suite over the engine's hazard corpora plus grammar-verified pinned counterexamples.
- **The built-in LaTeX preprocessor is append-aware per renderer instance**: byte-identical output to the stateless run (early-exit quirks included), with streaming appends re-processing only the active tail — ~2ms → ~20µs per append on a 15k math-dense stream, and even a degenerate open-fence stream beats the old path. No public API change; direct `preprocessLaTeX` callers are untouched. The remaining O(full-prefix) per-frame cost is user-supplied `contentPreprocessors` — keep them cheap or internally append-aware ([docs](smooth-streaming.md)).
- **Verification**: full preflight (1097 tests) plus the release-gate soak — splice fuzz 50k fresh-seed, direction battery 20k, def-scanner fuzz 30k, LaTeX incremental fuzz 5000 streams, and the complete K=4 census across 12 shards — all clean. New guide: [Smooth streaming](smooth-streaming.md).

## 2.0.x — The flat props API

### 2.0.3 — Props-API surface hardening from the dual-review campaign

No engine changes — the parse/splice pipeline is byte-identical to 2.0.2. All fixes target the v2 prop/context surface, found by a two-agent review (implementation + architecture) with an adversarial re-review of the fixes:

- **Library-wide null guard completed**: the rule "explicitly passing `null` counts as absent" now covers every prop, not just the engine slice. Previously an untyped/serialized caller (RSC, persistence) passing `Typography: null` crashed the render, and `null` on `fontSize` / `streaming` / `variant` / `colorScheme` punched through the shipped defaults. TS prop types still exclude `null` — the guard is runtime defense-in-depth.
- **Mantine no longer dead-ends the app-level `codeBlock` channel**: with no `codeBlock` prop, `<MantineAIMarkdown>` used to contribute an empty placeholder group that silently shadowed an outer `AIMarkdownBehaviorsProvider`'s group under the inner-wins merge. An absent prop now contributes no group key at all; the documented wrapper examples follow the same pattern.
- **Seal runtime gate checks both keys**: `enginePlugins` sanitization now requires the public `'~sealed'` marker AND the internal stage metadata, so a stage-only structural mimic is rejected like a type-level forge (dev warning either way).
- **Governance**: the core README gains a group-key registry with a 2.x reservation policy (core will not promote a registered group key into a core-locked key within the major line); the execution plan gains Appendix B recording every implementation deviation; new contract tests pin plugin-chain order independence and the export surface (v1 symbols stay deleted). Storybook labels and JSDoc no longer mention v1-era prop names.

### 2.0.2 — Incremental-parse hardening round two: precise guards replace the coarse bail

Seven engine fixes (six reachable in shipped 2.0.1; none are 2.0.1 regressions), found and verified by four 300k-sample fresh-seed sharded soaks — the final one fully clean. Highlights:

- **Freeze-boundary detector, blocker 7**: a `$$` math or ``` fence open glued under an html-flow-looking line is only certainly swallowed at top level — in a container it really opens, and the tracker's open/close phase inverts permanently. Suppressed opens now poison later freeze candidates (sticky, over-block only). Same mechanism covers a paragraph-inline `<!--` that never closes (literal text to micromark, but previously scanned as comment interior — real markup went uncounted) and 4-indented lines glued after a fence close (indented code that merges across blank lines).
- **Splice layer**: the seam-separator run-length model now credits wrap separators merged into raw trailing literals (correct arithmetic instead of a bail); position-less content texts must sit directly after their owning element (anything text-preceded is the tail's own stripped-construct remnant — freezing it duplicated it); a frozen html child ending in a stripped construct (`…-->`) bails the trailing rebuild (its interior whitespace merges into the seam separator invisibly).
- **Net effect**: the coarse cut-ends-position-less bail from 2.0.1 is removed; benign-document incremental coverage comes back above the pre-2.0.1 ceiling (paired fuzz: benign 0.4291 → 0.4395, hazard 0.3020 → 0.3466) with all seven counterexamples pinned.

### 2.0.1 — Splice-layer hardening; first-party `==mark==` plugin; type-dependency fixes

- **Engine fixes** (all pre-existing — reachable in shipped 1.8.0, found by an enlarged sharded soak; none are 2.0.0 regressions): four incremental-parse splice divergences in three classes are closed with structural bails to the full parse. A raw trailing literal merging its wrap separator could mispair a position-less KaTeX span (duplicated seam separator); a frozen cut ending in a position-less node escaped the positioned-containment cross-check (misplaced math block); and an unclosed inline `<details>` makes parse5 hoist a root element that swallows later siblings, so an mdast-clean freeze boundary was not hast-clean (duplicated tail content). Counterexamples are pinned; measured coverage cost is ~1pp of incremental-frame ratio on benign-shaped documents. Verified by the full three-leg soak plus a 300k-sample fresh-seed run — both clean.
- **Plain-Node CJS `require()` works** — the 2.0.0 known issue is resolved. The unmaintained `remark-mark-highlight` dependency is replaced by first-party [`@ai-react-markdown/remark-mark-highlight`](https://www.npmjs.com/package/@ai-react-markdown/remark-mark-highlight) (independently versioned, dual ESM/CJS): byte-compatible with the upstream's 0.1.1 output, pinned by a 50-case parity corpus generated against the upstream before the swap.
- **Published types resolve under strict resolvers**: `@types/hast` moves to `dependencies` — the shipped d.ts imports from `hast`, and with the package absent, pnpm/PnP consumers got TS2307 (or a silent `any` with `skipLibCheck`).

### 2.0.0 — Props/config API v2: flat props, sealed engine plugins, five contexts

**Breaking.** The 1.x `config` / `defaultConfig` object channel is removed outright — no compatibility layer. Every removed symbol has a one-to-one destination with runnable before/after code in the [migration guide](migrating-to-v2.md); the engine itself is untouched (the produced plugin chain is byte-equivalent, enforced by the independent-mirror suite and a fresh full soak).

- **Input surface**: 18 flat props resolved once against shipped defaults — explicit (`v != null`) beats default, `null` counts as absent (an RSC serialization guard). The behavior switches become `blockMemo` / `incrementalParse` / `preserveOrphanReferences`; note the absence-semantics flip — an omitted `incrementalParse` now means the shipped default (**on**), where a 1.x custom `defaultConfig` omitting the field silently meant off. The two selection enums collapse into `enginePlugins`, accepting core-sealed plugin objects from the new `@ai-react-markdown/core/plugins` subpath (`highlight`, `definitionList`, `smartypants`, `pangu`, `removeComments`, `defaultEnginePlugins`); chain position comes from plugin metadata, never array order. `defineTheme` / `defineBehaviors` / `definePipeline` package integration-time fragments as frozen spreads, and reference stabilization is consolidated into one table-driven firewall (`useStableRecord` + `AIMarkdownStabilityPolicy`, exported for wrapper reuse).
- **Output surface**: the render-state context and its caller-asserted `TConfig` generic (`useAIMarkdownRenderState`) are replaced by five per-system contexts with narrow hooks — `useAIMarkdownDocument` / `Metadata` / `State` / `Theme` / `Behaviors` — plus a `useAIMarkdown()` aggregate. `streaming` flips now wake ONLY state subscribers (pinned by a browser-run story test). Wrappers and apps extend through additive `AIMarkdownBehaviorsProvider` / `AIMarkdownStateProvider` stacked outside `<AIMarkdown>`, with the core keys triple-locked (type-level `never`, spread order, dev warning) and misuse outside `<AIMarkdown>` throwing exactly like the narrow hooks promise.
- **mantine**: `codeBlock` becomes a flat behavior-group prop read through `useMantineCodeBlockOptions()` (the single assertion-and-defaults site); `defineMantineBehaviors` is the widened factory; the render-config trio (`MantineAIMarkdownRenderConfig`, `defaultMantineAIMarkdownRenderConfig`, `useMantineAIMarkdownRenderState`) is gone. Generic signatures change positionally: `AIMarkdownProps<TConfig, TMetadata>` → `AIMarkdownProps<TMetadata>`.
- **Engine fix** (reachable in shipped 1.8.0, found by the release-gate soak): an html-flow run that swallows non-tag lines leaves balanced floating remnant whose rehype-raw seam depends on what follows — a tail flipping between definition and paragraph could reshape the frozen region. The freeze-boundary detector gains blocker 6 (raw-remnant seam): candidates adjacent to such a run are rejected until later content pins the seam, hardened through adversarial review (multi-line raw constructs on the settle line; no-hast-output lines no longer release). Over-block only — output correctness, not output shape. Full three-leg soak (50k fuzz, 20k direction prefixes, K=4 census ×12 shards) clean on the final detector.
- **Docs**: all three READMEs and every `docs/` page migrated; `apps/docs/content/guides/migrating-to-v2.md` is the complete old→new mapping; `apps/docs/content/guides/typescript-generics.md` shrinks to the metadata generic; `apps/docs/content/guides/extending-via-subpackage.md` is rewritten around behavior groups + additive Providers, mirroring the mantine implementation.
- **Known issue** (pre-existing, unchanged from 1.8.0): plain-Node CJS `require('@ai-react-markdown/core')` fails because the `remark-mark-highlight` dependency ships no `require` condition; bundler and ESM consumers are unaffected. A first-party replacement subpackage is planned.

---

## 1.8.x — Incremental parsing by default

### 1.8.0 — `incrementalParseEnabled` defaults to `true`

- `config.incrementalParseEnabled` flips from opt-in to on-by-default, and drops its EXPERIMENTAL label. The promotion criteria were met by the 1.6.1 verification campaign and its soak record (50k fuzz samples, 20k direction-battery prefixes, exhaustive K=4 census — all clean): append-only streaming now freezes the stable document prefix and re-parses only the tail out of the box, cutting per-frame parse/transform cost by 83–94% on the benchmark payloads.
- No rendered output changes. The engine's contract — spliced trees deep-equal to a full parse, positions included — is enforced per-frame by the splice-equivalence suite, and every unsafe frame still silently falls back to the ordinary full parse (non-append changes, no freeze-safe boundary, container-nested definitions, SSR).
- Opting out: pass `config={{ incrementalParseEnabled: false }}`. Note for sub-package authors: the field stays optional in `AIMarkdownRenderConfig`, and a custom `defaultConfig` that omits it still resolves to `false` at the engine gate — set it explicitly to `true` to match the new library default.
- Docs updated throughout (READMEs, `apps/docs/content/guides/streaming-and-performance.md`, `apps/docs/content/guides/benchmark.md`); historical entries below keep their original default-`false` wording.

---

## 1.7.x — Streaming cursor

### 1.7.0 — Inline streaming cursor

- New `streamingCursor` slot on `<AIMarkdown>` plus an exported `AIMarkdownStreamingCursor` shell: while `streaming === true`, an indicator renders right after the **last streamed character** and stays visibly alive through token stalls — the user can tell "still generating" from "stuck" even when no new content arrives. Everything happens at the DOM layer (a whitelist walk to the last text node, Range measurement of its final character — surrogate-pair aware — and an imperative `transform` kept in sync by a pre-paint MutationObserver plus ResizeObserver/`fonts.ready`), so the content string, the parse pipeline, and the block-memo cache are untouched: incremental parsing keeps its append gate, pinned by a dedicated browser regression story. The previously documented `content + '▍'` pattern is retired for exactly that reason — it silently forced a full parse every frame.
- The default indicator is a blinking dot sized to the current line that cross-fades into a two-tone spinner ring after 5 s of silence and springs back when tokens resume — pure CSS (opacity/transform only, no layout properties), `prefers-reduced-motion` aware, `aria-hidden`, copy-safe (never inside the text flow), with keyframes deduped into one `document.head` tag via `useInsertionEffect`. Custom visuals plug in through the `indicator` contract (`{ width, height, lastMutationAt }`). Un-anchorable tails (code fences, KaTeX output, SVG, raw HTML, void elements — or empty content before the first token) hide the cursor for those frames; it reappears when a text tail returns. RTL anchors on the correct side, ancestor `transform: scale` is compensated, and SSR emits only an inert wrapper (no hydration jump).
- Hardened by three review rounds before merge: an RTL overlap, a layout snap from the typography `:last-child` margin trim (the rule is now a separate Baseline-2023-safe ruleset in core and mantine so the last real block stays margin-free while the zero-height cursor wrapper is mounted), and a sub-millisecond Chromium timer early-fire that could permanently suppress the stall state (found via a flaky story, fixed by re-check-and-re-arm with deadline stamping) were all closed; an empirical browser torture pass (concurrent instances, morphing tails, 1 ms streams, mid-stream resets) found no further defects. Seven browser smokes ship as permanent regression fixtures alongside the node-environment suites.
- Docs: `apps/docs/content/guides/streaming-and-performance.md`'s "Variant: streaming cursor" section now documents the built-in slot (with a warning on why appending a cursor character breaks incremental parsing), and the end-to-end chat example adopts it.

---

## 1.6.x — Incremental parsing

### 1.6.1 — Incremental-parse verification campaign, CI browser gate

- The incremental-parse engine (still `config.incrementalParseEnabled`, still default `false`) went through a machine-driven verification campaign that found and fixed **18 real correctness bugs** — every one reachable only with the flag ON, so the shipped default behavior is unchanged, but flag-on consumers get materially more correct output. Each bug is pinned verbatim (document + streaming schedule) as a permanent regression fixture. Breakdown: 4 detector under-blocks (code-span masking inside html-flow continuation lines; a stale continuation verdict when a list interrupts a paragraph or follows a closed fence/math line; a sticky flow flag suppressing a real `$$` open after a comment terminator or an ambiguous non-block tag; `$$$$` opening a length-4 math fence), 5 malformed-definition registrations (def-shaped lines in html-flow text, footnote defs wrongly chaining, destination-less `[label]:`, garbage after the destination, titles left open at end-of-line), 1 reference under-taint (a def-shaped paragraph continuation line dropping its live `[label]` ref), and 8 splice-layer divergences around hast-util-raw's less-traveled output shapes (root-position anchoring, html-block trailing-literal position lifecycle, seam merges around tokenizer-dropped raw constructs and footer-only tails).
- The falsification suite behind it is four layers on one shared arbiter oracle: a property-based **fuzz** arbiter (fast-check generators biased at the detector's documented approximations), a **bounded-exhaustive census** (every ≤K-token sequence over a 24-token markdown-hot alphabet × every 2-cut schedule — a census, not a sample, within the bound), a **direction battery** that turns the detector's "only ever over-blocks" claim into a bombarded property, and a **sensitivity meta-suite** that plants known faults and asserts the arbiter catches them (so a green soak means something). A Stryker mutation audit is recorded alongside. The campaign's soak record: 50k fuzz samples, 20k direction-battery prefixes, and the full K=4 census, all clean after the fixes. The study directory (`src/experiments/prefixFreeze/`) documents the whole thing.
- **CI now runs the Storybook browser smokes.** The root vitest config's `storybook` project renders every story in headless Chromium — the only gate that exercises real browser DOM — but `pnpm -r test` never reached it (the project lives at the workspace root). It gets a dedicated CI matrix task and runs inline in the release workflow before publish, closing a known gate gap.
- `@ai-react-markdown/mantine`'s mermaid renderer was refactored behavior-preservingly: its three-boolean lifecycle state collapses into one view phase machine, `mermaid.initialize` is cached per theme, and an unchanged `(code, theme)` pair skips a redundant re-render — the streaming/regenerate/theme-flip behavior shipped in 1.5.1 is unchanged, verified live.
- Housekeeping: the streaming benchmark stories single-source their comparison-axis definitions and share their control rows and replay shell; dev-dependency security advisories (`qs`, `esbuild`) are resolved via scoped overrides (dev-only chains, nothing ships); CI actions moved to their Node 24 targets.

### 1.6.0 — Experimental prefix-freeze parsing for streaming

- New `config.incrementalParseEnabled` (default `false`, requires `blockMemoEnabled`): during append-only streaming, the renderer freezes the stable prefix of the document at a verified-safe boundary, re-parses only the tail, and splices the previous frame's mdast/hast with the tail's — cutting the per-frame parse/transform cost to roughly the tail's share (83–94% less pipeline stage time measured on the benchmark payloads — exceeding the measurement study's 70–89% parse-only estimate; the freeze boundary covers ~73–87% of realistic LLM output). Block-memo cache keys are position-based, so the two optimizations compose: frozen blocks stay cache hits.
- Safety is falsified, not assumed: a splice-equivalence suite asserts the spliced trees are deep-equal (positions included) to a full parse, per streaming frame, across the plugin-permutation catalog and adversarial fixtures (loose lists, rehype-raw swallow containers, open `$$` math, late reference/footnote definitions, definition-list term claims, Unicode case-folded labels, CRLF). A Storybook play test additionally pins the live-DOM equality of flag-on vs flag-off streams in a real browser.
- **Footnotes splice** instead of forcing per-frame full parses. Footnote numbering, footer membership/order, and backref ids are whole-document state inside mdast-util-to-hast, so the engine replays the prefix's footnote event sequence (definitions and references ×occurrence, in document order) at the tail head — the tail run rebuilds that state exactly, regenerates the complete document footer, and the footer's positions are rewritten back into document coordinates by a dual rule (injected-def segments per segment, tail-native the ordinary shift). The withDefs benchmark corpus flips from "measures the fallback" to >50% spliced frames; a footnote-heavy browser smoke pins live-DOM equality under StrictMode.
- **Cross-chunk (`<AIMarkdownDocuments>`) documents splice** too. Each chunk's registry-driven phantom-definition suffix is handed to the engine as an always-tail input: the append gate and boundary scan see the chunk's own text alone, so phantom churn (labels arriving/leaving as sibling chunks stream) re-parses only the tail. The reference taint is the correctness backstop — a phantom's definition is never in the chunk's own text, so phantom-resolved refs never enter the frozen prefix. A dedicated `CrossChunkIncrementalCompare` story and a coordinated browser smoke ship alongside the arbiter's suffix-churn scenarios.
- **Sanitize-stripped prefix nodes splice** (HTML comments, `<?…?>` bogus comments, `<script>`): their orphaned wrap separators are re-derived by a separator-run alignment model instead of tripping a full-parse fallback (which used to fire on every frame whose frozen prefix held one).
- Every frame still re-checks a gate chain and silently falls back to the ordinary full parse when it can't prove safety: non-append content changes, no freeze-safe boundary yet, a container-nested definition that can't be re-injected verbatim, or a hast layout outside the alignment model. SSR always takes the full path. See the new "Incremental parse (prefix-freeze)" section in `apps/docs/content/guides/streaming-and-performance.md`.
- New opt-in `createRemendPreprocessor()` — streaming tail repair built on Vercel Streamdown's zero-dependency `remend` engine: unterminated `**bold`/`` `code ``/`~~strike~~`/links render styled mid-stream instead of literal. Exposed as an optional helper (actual bundle inclusion depends on the package build and consumer bundler), no-op on well-formed text (final frames identical), `linkMode` defaults to text-only under our URL sanitizer, math completion permanently off (the built-in LaTeX preprocessor owns `$`). Composes freely with block-memo; with incremental parsing, only the frames inside an unterminated construct fall back. See `apps/docs/content/guides/content-preprocessors.md`.
- Dev stage telemetry gains an `ai-markdown:stage:scan` measure (the boundary detector), and `parse`/`transform` now report tail-only time when a frame spliced. The `BlockMemoComparison` benchmark story gains an `incremental` toggle on the block-memo side.
- Hardened before release by a recall-biased multi-angle review plus a same-day polishing pass: six probe-confirmed detector corners closed (indented-code merges, def-shaped continuation lines, blockquote-nested definitions, mid-line `$$`, backtick-bearing fence info strings, html block types 3–5) and every one turned into a permanent arbiter fixture; the v1-era footnote bypass became fence/code-span aware (later removed entirely when v2's injection replay made footnotes splice); the detector gained checkpoint incremental scanning (scan stage 9→4 ms at 4×, 84→13 ms at 16×) with a resume-vs-fresh equivalence property test; the plugin chain was single-sourced (`pluginChain.ts`) with a directional consistency pin against the experiment record; and `apps/docs/content/guides/benchmark.md` ships recalibrated real-browser numbers (84%/94% pipeline savings, boost p50 32→7.5 ms — unchanged by the hardening).
- The v2 splice capabilities went through the same discipline before release: two further adversarial review rounds (8 + 4 independent finder angles, every engine claim probe-tested against the arbiter) closed two probe-confirmed correctness holes — the injection text itself introduced continuation context the detector never modeled (a trailing footnote-def body could swallow indented tail content; a definition-list `: desc` could claim the injected block through the compressed join), both neutralized by a sentinel terminator definition appended to every injection, plus a mention-gate so a document literally writing the sentinel label falls back instead of mis-resolving — and one probe-confirmed regression (documents OPENING with a table silently never spliced).

  Hardening along the way: injection plans are cached and advanced incrementally (removing an O(stream²) per-frame walk), the engine got a throw fence (a mid-frame error can no longer strand a stale scan checkpoint), SSR renders skip the engine's seed scan entirely, and the detector checkpoint no longer retains a copy of the document (~2–3× doc size per mounted instance reclaimed).

- Storybook gains a full comparison matrix: `IncrementalParseCompare`, `BoostCompare` (everything-on vs legacy), their process-isolated variants, and a `VerificationPlayground` with a live freeze-boundary bar — each same-page comparison carries a per-frame DOM-equality verifier (clobber prefixes normalized).
- The measurement study behind the design ships as `packages/engine/src/experiments/prefixFreeze/` (in `packages/core` before the 2.x engine split) (ablation ladder L0–L4 with falsification tables — including why the double-blank-line rule that inspired this feature freezes 0% of typical single-blank LLM output).

## 1.5.x — Mantine 9

### 1.5.1 — Streaming robustness: raw-HTML swallow and mermaid lifecycle

- Core's block-memo cache no longer freezes stale content when a streaming document contains an unclosed raw-HTML container (`<details>` before its `</details>` arrives — but any container tag qualifies). rehype-raw's HTML parsing reparents every following sibling into the open container, including the synthetic footnote section, while the block's source-level cache identity stays byte-identical; the first swallowed snapshot used to become a permanent cache hit, leaving a duplicated footnote section trapped inside the container and freezing trailing content mid-stream. Raw-HTML blocks now carry a structural digest of their rendered subtree, so the cache invalidates exactly while swallowing is in effect and recovers in one frame once the close tag lands. Markdown-native blocks skip the digest walk entirely — no new per-frame cost on large deterministic subtrees like KaTeX output.
- `@ai-react-markdown/mantine`'s mermaid renderer is now streaming-aware. While `streaming` is true, parse failures on truncated code are silent: the raw source shows as a plain code block until the first prefix parses, then the last good SVG stays up and refreshes on each subsequent success — no more "Mermaid Render Error" flashes mid-stream. When streaming ends, one corrective pass runs on the final code; its failure is the only one allowed to replace a rendered diagram. A `streaming` false→true edge is treated as a new generation (chat "regenerate" reuses the same component instance) and resets the warm-up state, so a new stream never shows the previous generation's stale diagram or error tab. Static (non-streaming) rendering keeps the original conservative rule: a rendered diagram is never clobbered by a later transient failure.
- `mermaid.render` no longer receives the host element: the host is hidden during warm-up, and `display: none` zeroes mermaid's getBBox text measurement — one-shot static renders came out as ~16px SVGs. Rendering through mermaid's own body-temp path decouples measurement from container visibility; `suppressErrorRendering` additionally keeps mermaid's temp nodes from accumulating in `document.body` when a draw-phase error slips past `parse`.
- Storybook gains a `Mantine/MantineAIMarkdown → Streaming` story that streams a mermaid-heavy document token by token; `content` is a control, so arbitrary markdown can be streamed for eyeballing.

### 1.5.0 — `@ai-react-markdown/mantine` moves to Mantine 9

- `@ai-react-markdown/mantine` now requires `@mantine/core` and `@mantine/code-highlight` `^9.0.0` as peers (tested against 9.4.1). No API changes on our side — the package's surface survives every Mantine 9 breaking change untouched. Consumers inherit Mantine 9's defaults: `md` (8px) default radius, solid light-variant colors (Mantine's `v8CssVariablesResolver` restores the 8.x look), and a React 19.2 floor.
- If you install `@mantine/hooks` yourself, note that `@mantine/core@9` pins its hooks peer to the exact matching version — keep the three `@mantine/*` packages on one version.
- Core is unchanged in behavior. One internal type adaptation for `@types/hast` ≥3.0.5: the aggregated footnote footer's `<li>` numbering is now stored as a string in hast (`value: "3"` instead of `value: 3`) — the rendered DOM is byte-identical.
- Core's optional `katex` peer widens to `^0.16.0 || ^0.17.0`. The range previously excluded 0.17 (a `^0.16.0` range does not match 0.17 under 0.x semver), so npm users on katex 0.17 hit spurious `ERESOLVE` conflicts — even though the library is continuously tested against 0.17.

## 1.4.x — Customization surface hardening

The 1.4 line opened up the customization surface (URL sanitization, document namespacing, design tokens) and put guardrails around it so consumers can extend safely.

### 1.4.9 — Dual dev/prod builds; streaming re-parse eliminated

- The package now ships separate development and production builds behind the `development` exports condition, and the published files contain no `process.env` reads at all — consumers without a bundler (import maps, plain `<script type="module">`, CDN ESM) no longer crash on `process is not defined`. A post-build assertion keeps the dist permanently free of env reads. See the README's "Development vs production builds" section for the SSR and Jest footguns that come with conditional exports.
- Streaming no longer pays a second full markdown parse per token. Standalone chunks skip the definition-label scan entirely; coordinated chunks (`documentId` under `<AIMarkdownDocuments>`) gate it behind an append-aware scanner that re-scans only the region since the last blank line, and only when a line-start `[` could introduce a new definition. The label set keeps its object identity when unchanged, so per-token re-registration and downstream memo invalidation stop too.
- `urlTransform` application is now convergent: original URLs are stashed on first transform and every pass recomputes from the original, so a memoized (re-entered) hast tree can never be double-transformed. Internal defensive tree clones are skipped when the tree is caller-owned — the common path allocates nothing.
- Development builds emit per-stage `performance.measure` entries (`ai-markdown:stage:parse|transform|build|render`) for pipeline profiling in the DevTools Performance panel; production builds compile the entire gate away.

### 1.4.8 — Automated GitHub releases

- Pushing a `v*` tag now also publishes the matching GitHub release, with notes lifted from this file's section for that version (falling back to auto-generated notes). The npm publish and the GitHub release are a single CI step away from one tag push. No library runtime changes.

### 1.4.7 — Dev-mode diagnostics; provenance-attested publishing

- A footnote id with malformed percent-encoding now logs a development-mode warning instead of degrading silently (the aggregated footer renders an empty entry for that label — previously with no signal as to why).
- First release published via npm trusted publishing (OIDC): both tarballs carry provenance attestation linking them to the exact source commit and CI run. No npm token exists anywhere in the pipeline.
- `@ai-react-markdown/mantine` gained an SSR smoke-test suite and a typecheck gate in CI (no runtime changes).

### 1.4.6 — Cross-chunk registry gated on explicit `documentId`

- Cross-chunk coordination now activates only when the consumer passes `documentId` explicitly. Previously an omitted `documentId` was defaulted to `useId()` before reaching `useDocumentRegistry`, so a standalone chunk wrapped in `<AIMarkdownDocuments>` wrongly took the coordination path — and a stray raw placeholder tag in such a chunk could open an orphan registry shell that was never evicted (no paired `registerChunk`).
- `documentId` is now resolved at a single point (the render-state provider), which threads a `documentIdExplicit` flag through state to `useDocumentRegistry` and the placeholder components. `AIMarkdownRenderState.documentIdExplicit` is optional for 1.x compatibility.

### 1.4.5 — Token surface for `default` variant

- Spacing, font-size, and heading tokens in the default variant now consume `--aim-font-size-root`. Changing the `fontSize` prop scales the root-anchored spacing and type dimensions — no per-token override needed for size-coherent themes.
- New customization tokens: `--aim-font-weight-strong` (shared by all headings + `<th>`, default `700`) and `--aim-katex-font-size` (defaults to `--aim-font-size-root` so math stays at component-root size regardless of parent context).

> See [Design Tokens](design-tokens.md) for the full token surface.

### 1.4.4 — Cross-chunk URL XSS sealed; public surface narrowed

- Cross-chunk link/image references now run a **second** per-attribute sanitization pass at render time. Previously, a permissive `urlTransform` in one chunk could leak `javascript:`/`data:` URLs into another chunk that defined them, bypassing the consuming chunk's policy. Now every consumer applies its own gates independently — defense-in-depth across chunk boundaries.
- The `Registry` type exposed via `useDocumentRegistry` is narrowed to a read-only surface. Mutator methods (`registerChunk`, `allocateSymbol`, `releaseSymbol`, …) are no longer part of the public type, so consumer code can't accidentally corrupt refcounts or numbering invariants.
- `sanitizeSchema`'s public type tightening — pairs with the read-only `Registry` narrowing.

### 1.4.3 — `urlTransform` + `sanitizeSchema` documented

- Comprehensive JSDoc on both props: reference-stability requirements, composition with `defaultUrlTransform`, regex-escaping for scheme names (`/^web\+app:/i` vs the silent broadening of `/^web+app:/i`), and the asymmetric stability model (function identity vs deep-equal data).

### 1.4.2 — Long `documentId` shortening

- `documentId` values >16 chars (UUIDs, nanoids) are hashed via MurmurHash3 → Base62 down to ≤6 chars **inside the rendered `id="…"` / `href="#…"` prefix only**. State (`state.documentId`) and registry keying use the raw value, so deep linking and `useDocumentRegistry(documentId)` are unaffected. Pure rendered-HTML compactness win.

### 1.4.1 — Mantine README + package metadata

- Mantine package README fleshed out with code-highlight adapter setup, Mermaid features, color-scheme integration, and the full Mantine-extended config table.

### 1.4.0 — `urlTransform` + `sanitizeSchema` props exposed

- New props on `<AIMarkdown>` for the two-gate sanitization model.
- `extendSanitizeSchema((draft) => Schema | void)` helper introduced — a mutate-and-return factory that hands the caller a deep clone of the library default. Library invariants (cross-chunk tag allowlist, KaTeX className allowlist, `<mark>` permission) survive automatically.
- The library default schema is **not** exported as a value from `@ai-react-markdown/core` to prevent the shallow-spread footgun (`{ ...sanitizeSchema, … }` aliases nested arrays); the engine package exports it read-only for the renderer.

> See [URL Sanitization & Custom Schemes](url-sanitization.md) for the full two-gate model and reference-stability rules.

---

## 1.3.x — Cross-chunk coordination

The 1.3 line introduced the largest feature in the library to date: coordinated rendering of chunked markdown documents.

### 1.3.0 — Cross-chunk references

- `<AIMarkdownDocuments>` wrapper component — opt-in, scoped per `documentId`.
- Footnotes, link references (`[label]: …`), and image references coordinate across chunks. A footnote in chunk B can resolve to a definition in chunk D; their numbering is document-wide, not chunk-local.
- Per-document `Registry` shared via React context. Symbol-keyed contributions with refcount + microtask-deferred cleanup — survives React 19 Strict Mode's double-mount semantics without losing chunk identity.
- Aggregate footnote footer renders once at the **last** chunk of the document; reorders automatically as chunks mount/unmount during streaming.
- Per-document id namespace via `documentId` prop (auto-generated via `useId()` when omitted) — prevents footnote backref collisions when multiple `<AIMarkdown>` instances render on the same page.

> See [Cross-chunk Coordination](cross-chunk-coordination.md) for the full model.

### 1.3.0 — Block-level memoization

Shipped alongside cross-chunk in the same minor bump:

- `blockMemoEnabled` config field (default `true`). The renderer splits each document into per-block units and memoizes each block's React subtree by source identity (`raw + occurrence + ctx + position`). Unchanged blocks during streaming skip `toJsxRuntime` and React reconcile work entirely.
- Output is **byte-identical** to the disabled path — verified by a `byteEquivalence.test.tsx` harness covering every plugin permutation.
- The pipeline was refactored into **three independent stages** (parse, plan, render) so memoization could intercept between stages without modifying the upstream `react-markdown` API.

> See [Streaming & Performance](streaming-and-performance.md) for the consumer-side reference-stability rules.

---

## 1.2.x — Streaming-safety improvements

The 1.2 line was about making the renderer robust to mid-stream input (partial LaTeX blocks, transient Mermaid parse failures, etc.).

### Highlights from the 1.2 patch series

- **Unclosed `$$` math blocks are truncated** during streaming so `mathFlow` doesn't swallow the rest of the document while the model is mid-token.
- **`|` characters inside unclosed LaTeX blocks are escaped** so a streaming token containing `\frac{a|b}{c}` doesn't break GFM table parsing in surrounding content.
- **LaTeX streaming edge cases hardened** — currency `$5.99` reliably stays prose; bracket delimiters (`\(…\)`, `\[…\]`) normalize correctly even when only one half has arrived.
- **Mermaid race conditions fixed** on rapid re-renders — concurrent re-renders no longer collide on the same diagram id.
- **Mermaid last-successful-render preserved across transient parse failures** during streaming. As the model emits a partial diagram, the previous fully-rendered diagram stays visible until the new one is valid; the rendered output never flashes to source-code fallback unless the diagram is truly broken at completion.
- **Mermaid `securityLevel` tightened** from `'loose'` to `'strict'` — a defense-in-depth refinement against malicious diagram content.
- **HTML-comment containers protected** so `<!-- inline comment -->` inside content doesn't accidentally enable raw-HTML injection paths.
- **Vite SSR + pnpm ESM resolution failure for lodash-es** worked around by bundling — fixes a class of "works in dev, breaks in prod" issues that previously bit consumers using strict-isolation installers.

### 1.2.0 — Initial public release

- Two-package monorepo: `@ai-react-markdown/core` (React, independent of a UI library) and `@ai-react-markdown/mantine` (Mantine UI integration).
- GFM (tables, strikethrough, task lists, autolinks).
- LaTeX math via KaTeX with smart preprocessing (currency $, mhchem, bracket delimiters, pipe escaping).
- Emoji shortcodes (`:smile:`).
- CJK-friendly line breaking + optional pangu auto-spacing.
- Extra syntax: `==highlight==`, definition lists.
- SmartyPants typography, HTML comment removal.
- Streaming-aware context.
- Custom typography variant + color schemes.
- Custom components (per HTML element override).
- Metadata context separate from render state.
- TypeScript generics for extended config + metadata.
- Mermaid diagrams with dark/light theme switching, source toggle, copy, open-in-new-window.
- Syntax highlighting via `@mantine/code-highlight` (highlight.js).
- JSON pretty-print (deep-parse of nested JSON-encoded strings).
- Mantine color-scheme auto-detection.

---

## Themes across versions

### 1. Streaming correctness spans more than the parser

The history covers input normalization, boundary scanning, tree splicing, block identity, registry state, and asynchronous presentation. A stale reference or diagram can arise even when the final source parses correctly. That is why fixes repeatedly add intermediate-frame comparisons and lifecycle tests alongside final-output assertions.

The 1.3 block cache reduced repeated React element construction; the 1.6–1.8 incremental work reduced repeated parsing and transformation. Later releases made their eligibility and invalidation rules more precise. These optimizations are designed to fall back when safety cannot be established, not to promise that arbitrary input has no possible crash or expensive path.

### 2. Customization has explicit ownership

Typography, design tokens, element renderers, metadata, URL policy, and preprocessors each have a separate contract. The 1.4 series exposed and documented these surfaces, while 2.0 replaced the shared config bag with flat props and narrow contexts. A wrapper owns its behavior-group defaults; core owns its locked behavior and lifecycle keys; the engine owns the supported grammar.

This separation explains both the supported extension paths and their limits. A preprocessor changes source before parsing, a custom component changes presentation after sanitization, and a private URL scheme must pass both gates. None is a general-purpose replacement for arbitrary remark/rehype plugin injection into the verified incremental pipeline.

### 3. Integrations compose the public React API

Mantine supplies typography, extra styles, a pre renderer, and a behavior group around core. Since 2.0, additive providers and widened factories replace the old defaultConfig mechanism. The 2.3 engine split did not require React integrations to become engine consumers: core continues to expose the props, hooks, and types they need.

A non-React adapter has a different responsibility and stability boundary. It consumes the engine directly, pins an exact version, and owns rendering and lifecycle equivalence. The engine's public availability on npm should not be read as a stable product API before 3.0.0.

### 4. Verification grows with the reachable grammar

Repeated clean runs can miss a shape that no generator emits. Several releases therefore expanded the grammar corpus first, demonstrated a failure in the old implementation, and then added the fix and permanent regression. Sensitivity tests and anti-vacuity floors distinguish an exercised optimized path from a passing full-parse fallback.

Keep historical sample counts and mutation results attached to their original configuration. The current [coverage map](soak-coverage.md) and runner define present release evidence, while the [experiment record](../../../../packages/engine/src/experiments/prefixFreeze/README.md) explains how that evidence developed.

### 5. Compatibility follows the public surface

Public prop and hook names have a semver contract. Visual default values, exact HTML serialization, internal registry details, and pre-3.0 engine exports have narrower guarantees. Read [the stability table](api-conventions.md#stability-policy) when choosing what to pin in an integration or assert in an application test.

## What's been intentionally deferred

This section describes current boundaries, replacing older planning notes that became stale as features and CI were added.

- **Open parse-plugin injection remains outside core's public API.** The sealed catalog allows selection of known constructs whose boundary behavior is verified. New grammar needs corresponding scanner and oracle coverage before joining that catalog.
- **Direct default-schema export remains absent from core.** Use `extendSanitizeSchema` to obtain a mutable deep clone. Engine exports the deeply frozen singleton for its consumers, but sharing nested arrays through a shallow copy is not a customization mechanism.
- **Registry mutation remains internal.** Public consumers can read selectors and subscribe globally or by label. Registration, symbol allocation, release, numbering, and contribution writes remain renderer-owned so custom components cannot bypass their invariants.
- **Arbitrary syntax split across components is not coordinated.** Cross-chunk footnotes, link references, and image references are supported, including processed footnote bodies. That feature does not join half a fence or paragraph from another renderer. Accumulate transport deltas or use deliberate logical Markdown chunks.
- **Browser benchmark budgets are not automatic release gates.** CI and release workflows do exist and their badges are present. The separate browser benchmark workflow is manual-only; its historical automatic collection plan was withdrawn. Read the benchmark README before interpreting its measurements.

If a boundary prevents a concrete integration, describe the source shape, lifecycle, expected output, and current result in an issue. That provides a reviewable basis for changing a contract without treating an obsolete historical deferral as a permanent design decision.

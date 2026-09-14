# API conventions and stability

This page collects the contracts that hold across the guides: what stays stable under minor versions, how the shared packages relate to the adapters, how the examples are written, and how to check a guide against the implementation. Task-oriented pages are listed in the [guide directory](index.md).

## Stability policy

Public APIs follow semantic versioning from 3.0.0. Upgrade the release-train packages together. The table below describes the stable React API policy; earlier prereleases may have different contracts. Vue has a separate public prop/type surface documented in its [reference](../reference/vue.md).

| Surface                                                                                                              | Stability under minor versions                                                      |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Component props (`AIMarkdownProps`, `MantineAIMarkdownProps`)                                                        | Stable. Additions are non-breaking; renames/removals require a major bump           |
| Hook signatures (the five narrow hooks, `useAIMarkdown`, `useDocumentRegistry`, `useStableValue`, `useStableRecord`) | Stable                                                                              |
| Flat prop **names** and **roles** (incl. the sealed plugin names)                                                    | Stable                                                                              |
| Flat prop **default values**                                                                                         | May shift under minor bumps as defaults evolve — override what you need locked      |
| CSS custom property **names** (e.g. `--aim-spacing-md`)                                                              | Stable                                                                              |
| CSS custom property **default values**                                                                               | May shift under minor bumps as the visual design evolves                            |
| `UrlTransform`, `SanitizeSchema` types                                                                               | Track upstream `react-markdown` / `rehype-sanitize`; may change with their majors   |
| `Registry` interface                                                                                                 | Stable read-only surface; mutator methods are intentionally not exported            |
| Internal byte-for-byte HTML output                                                                                   | Not stable — prefer semantic assertions for application tests; use semantic queries |
| Everything exported by `@ai-markdown/engine`                                                                         | Stable documented public contracts from 3.0.0 — see below                           |

When in doubt, pin your overrides explicitly rather than relying on defaults.

## Shared packages

`@ai-markdown/core` owns framework-independent sessions, planning, contributions and smooth coordination; `@ai-markdown/engine` owns parsing, tree algorithms and registry primitives. Both are public packages with explicit exports. Installing `@ai-markdown/react` or `@ai-markdown/vue` resolves both as exact-version dependencies. Adapter authors can use them directly, keeping the five release-train packages (engine, core, react, vue and react-mantine) aligned at the same exact train version. Breaking changes to their documented public contracts require a new major version; the React package supplies the component and hook API used in the application guides. The documented contracts themselves are listed in [Core and engine contracts](api/core-engine-contracts.md).

## Conventions used in the guides

- **Code blocks** are labeled by purpose. Complete recipes include their required imports; smaller fragments assume the surrounding application values, and wrapper templates use explicitly named placeholder modules. Install the package peers and import required CSS before using them.
- **Footguns** sections, where present, collect anti-patterns and stability traps. For symptoms and fixes across adapters, see [Troubleshooting](troubleshooting.md).
- `// ✅` and `// ⚠️` callouts mark recommended vs anti-pattern code lines.
- Where a behavior is shared by `@ai-markdown/react` and `@ai-markdown/react-mantine`, the example uses `AIMarkdown` (React adapter); apply identically to `MantineAIMarkdown`.

## Reporting issues with these docs

If you find a documented API that doesn't behave as described, or a customization recipe that breaks at a version boundary, please open an issue with:

- the document name and section,
- the exact package version (`@ai-markdown/react@x.y.z` …),
- a minimal reproduction,
- the observed vs expected behavior.

Issue tracker: <https://github.com/ai-markdown/ai-markdown/issues>

## Reading the implementation alongside the guides

Follow a value through its owner before changing its documentation. Public props are resolved in the React adapter; syntax and incremental algorithms belong to engine; pipeline sessions, plans and contribution orchestration belong to shared core; React providers, effects, and cached element construction belong to the React adapter; Mantine owns its code presentation and group defaults. An export in engine is not automatically a supported React API.

| Question                                   | Implementation to inspect                                | Guide to keep aligned                      |
| ------------------------------------------ | -------------------------------------------------------- | ------------------------------------------ |
| What does an omitted prop do?              | React prop resolver and the wrapper's parameter defaults | Package props reference, migration guide   |
| When can an old parse or block be reused?  | Incremental advance, block planner, MarkdownContent      | Architecture, streaming and performance    |
| Which chunk owns a reference?              | Document registry and consuming placeholder              | Cross-chunk coordination, URL sanitization |
| What text is displayed or copied?          | Engine preprocessor chain and Mantine code renderer      | Content preprocessors, Mantine reference   |
| When is a streamed result complete?        | Transport state, smooth controller, document queue       | Chat example, smooth streaming             |
| What proves an optimization was exercised? | Coverage map, oracle tests, soak manifests               | Soak coverage, experimental record         |

When contributing documentation, retain useful examples and historical measurements, but identify their version and scope. Verify current API names, defaults, relative links, and commands against this checkout. A successful build establishes that package artifacts compile; it does not by itself validate every prose claim or performance estimate.

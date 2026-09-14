# Installation

Choose the adapter for your application, then follow its quick start. Each quick start includes the install command, required CSS and a complete first render.

## Start with your framework

| Application               | Follow this guide                                   |
| ------------------------- | --------------------------------------------------- |
| React 19 with your own UI | [React quick start](react-quick-start.md)           |
| Vue 3.5 with your own UI  | [Vue quick start](vue-quick-start.md)               |
| React 19 with Mantine 9   | [Mantine quick start](react-mantine-quick-start.md) |

You normally install one framework adapter and its peer dependencies. Core and engine are installed automatically. Choose Mantine when your React application needs that integration's typography, code highlighting and diagrams.

Once the first render works, continue to [React streaming chat](streaming-chat-example.md) or [Vue streaming](vue-streaming.md). The rest of this page is a reference for package selection, compatibility and existing installations.

## Current release

ai-markdown renders accumulated Markdown in React 19 or Vue 3.5. Both adapters use the same parsing engine and shared orchestration; their components, customization and lifecycle APIs follow their host framework. This guide targets the `3.0.1` package train. For a stable release, install without a dist-tag to select `latest`. Pin an exact version and retain your lockfile for reproducible integrations; prerelease testing requires an explicit candidate version.

## Choose a package

| Package                              | Install directly when…                                                            | Public entries                        |
| ------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------- |
| `@ai-markdown/react`                 | Building a React application                                                      | Root, `/plugins`, `/typography/*.css` |
| `@ai-markdown/vue`                   | Building a Vue 3.5 application                                                    | Root, `/styles.css`                   |
| `@ai-markdown/react-mantine`         | Adding Mantine 9 typography, code highlighting and Mermaid to React               | Root, `/styles.css`                   |
| `@ai-markdown/core`                  | Building a framework adapter that needs sessions, plans and document coordination | Root                                  |
| `@ai-markdown/engine`                | Building an adapter or a string/AST pipeline                                      | Root                                  |
| `@ai-markdown/remark-mark-highlight` | Adding `==mark==` to an independent unified pipeline                              | Root                                  |

Every package also exposes `/package.json`. Import only public entries; `src/` and internal `dist/` paths are not supported application imports. `@ai-markdown/react/plugins` is a subpath of the React package, not a separate package to install. Vue exports its sealed plugins from its root.

React and Vue each depend on matching exact versions of core and engine. Core depends on engine. Mantine declares a compatible React adapter peer; see its [peer requirements](../reference/react-mantine.md#peer-dependencies) and upgrade those two together. Applications normally install only their adapter and its peers. The highlight plugin is an engine dependency and is versioned separately from the framework train.

The legacy `@ai-react-markdown/core` was a React renderer; its replacement is `@ai-markdown/react`. The new `@ai-markdown/core` has no React components or Vue components. See the [migration guide](framework-transition.md) before renaming existing imports.

## Runtime requirements

Server/build consumers require Node `^20.19.0 || >=22.12.0`. The CJS output loads ESM dependencies through Node's `require(ESM)` support; earlier Node 20/22 releases can fail with `ERR_REQUIRE_ESM`. Repository contributors use the versions in [`.nvmrc`](../../../../.nvmrc) and [`package.json`](../../../../package.json).

React requires React and React DOM 19. Vue requires `^3.5.0`; Mantine is a React integration using Mantine 9. The framework quick starts below include their required peers and stylesheet imports. KaTeX is an optional peer: declare it directly when importing its stylesheet for math, rather than relying on hoisting.

Browser API requirements and hydration boundaries are documented in the [React](../reference/react.md#compatibility) and [Vue](../reference/vue.md#requirements-and-dependencies) references. Shared parsing does not imply identical framework or browser behavior.

## React 19

Follow the [React quick start](react-quick-start.md) for installation, required stylesheets and a complete minimal example.

## Vue 3.5

Follow the [Vue quick start](vue-quick-start.md) for installation, required stylesheets and a complete minimal example.

## React with Mantine 9

Follow the [Mantine quick start](react-mantine-quick-start.md) for installation, required stylesheets and a complete minimal example.

## React and Vue API differences

| Task                           | React / React Mantine                                             | Vue                                                                                   |
| ------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Render current source          | `content={content}`                                               | `:content="content"`                                                                  |
| Set producer state             | `streaming={streaming}`                                           | `:streaming="streaming"`                                                              |
| Select engine features         | Catalog from `@ai-markdown/react/plugins`                         | Catalog from `@ai-markdown/vue`                                                       |
| Replace HTML element rendering | `customComponents` map of React components                        | `components` map or named element slots; slot wins                                    |
| Read metadata and stream state | `useAIMarkdownMetadata`, `useAIMarkdownState`                     | Mapped component props or slot context                                                |
| Style the wrapper              | `Typography`, `ExtraStyles`, `fontSize`, `variant`, `colorScheme` | Base CSS and wrapper `class` / `style`                                                |
| Show streaming cursor          | Opt in with `streamingCursor={AIMarkdownStreamingCursor}`         | Enabled by default; disable with `:streaming-cursor="false"`; customize `cursor` slot |
| Smooth a source                | `AIMarkdownSmoothStream`, hooks accepting current option objects  | `AIMarkdownSmoothStream`, setup composables accepting live getters                    |
| Customize smooth waiting UI    | `waiting` prop                                                    | `waiting` slot                                                                        |
| Share references               | React `AIMarkdownDocuments` with explicit `documentId`            | Vue `AIMarkdownDocuments` with explicit `document-id`                                 |
| Retain orphan references       | Renderer prop and document-provider policy                        | Per-renderer `preserveOrphanReferences` (default `false`)                             |
| Toggle rendered block cache    | `blockMemo` prop                                                  | No `blockMemo` prop                                                                   |

Both adapters enable incremental parsing by default on the client. Both accept `enginePlugins`, `contentPreprocessors`, `sanitizeSchema` and `urlTransform`, but share only the documented contracts, not every prop or default. Keep plugin arrays and policy objects stable until configuration changes. Selecting plugins replaces the enabled set; it does not append arbitrary remark plugins.

## Streaming input and document boundaries

Pass one complete accumulated string per message. Your application owns transport decoding, framing, cancellation and retries; `streaming` reports producer state rather than enabling incremental parsing.

Read [Streaming input](streaming-input.md) for completion and smooth reveal, and [Documents and references](documents-and-references.md) when one logical document intentionally spans multiple renderers. Then follow the [React chat recipe](streaming-chat-example.md) or [Vue streaming guide](vue-streaming.md).

## Run the examples in this repository

```bash
pnpm install --frozen-lockfile
pnpm storybook
```

The hub runs on port 6006, React on 6007 and Vue on 6008. Development resolves workspace source and styles directly; no preliminary package build is required. `pnpm storybook:react` and `pnpm storybook:vue` start one catalog. Static builds use public package exports and build dependencies first.

Public packages live under `packages/*`. The `apps/storybook-*` apps, `tooling/storybook-kit`, corpus, benchmarks and archived prototypes are private workspaces. See [Interactive examples](storybook.md) and [Development commands](development-commands.md) for build and validation commands.

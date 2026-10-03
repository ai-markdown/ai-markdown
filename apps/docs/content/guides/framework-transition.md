# From ai-react-markdown to ai-markdown

**Upgrade from legacy v2.14.1 to stable 3.0.0 under `@ai-markdown`.** The GitHub repository has moved to `ai-markdown/ai-markdown`. Package names, directory ownership and shared-core distribution change together. React components, hooks, configuration names and stylesheet behavior retain their existing shape.

The first beta established the new package boundaries. Beta.2 added the Vue adapter and narrowed the advanced engine/core APIs. This guide records the changes introduced in stable 3.0.0. For current versions, peer ranges and installation commands, use [Getting started](getting-started.md). All published versions of the four legacy `@ai-react-markdown` packages now carry package-specific migration notices. Existing versions and Git tags remain available; their dist-tags and tarballs are unchanged. The legacy line receives no new features; critical fixes are considered as needed.

## Package and import mapping

| Legacy package or path                          | New package or path                        | Responsibility                                                                   |
| ----------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------- |
| `@ai-react-markdown/engine`                     | `@ai-markdown/engine`                      | Grammar, tree transforms, incremental algorithms, registry and URL primitives    |
| Private `@ai-react-markdown/runtime`            | `@ai-markdown/core`                        | Sessions, plans, committed contributions, aggregate HAST and reveal coordination |
| `@ai-react-markdown/core`                       | `@ai-markdown/react`                       | React components, hooks, contexts, node caches and DOM integration               |
| `@ai-react-markdown/core/plugins`               | `@ai-markdown/react/plugins`               | React-facing plugin and preprocessing exports                                    |
| `@ai-react-markdown/core/typography/<name>.css` | `@ai-markdown/react/typography/<name>.css` | Existing typography stylesheets                                                  |
| `@ai-react-markdown/mantine`                    | `@ai-markdown/react-mantine`               | Mantine typography and code/diagram presentation                                 |
| `@ai-react-markdown/mantine/styles.css`         | `@ai-markdown/react-mantine/styles.css`    | Mantine integration stylesheet                                                   |
| `@ai-react-markdown/remark-mark-highlight`      | `@ai-markdown/remark-mark-highlight`       | Independently versioned unified plugin                                           |

**The old React core becomes `react`, not the new shared `core`.** Applications should install the framework package. Engine and shared core are normal dependencies and arrive automatically. Custom adapter authors can depend on both explicitly. No alias wrapper joins the old and new graphs; update application imports and integration dependencies together.

Vue has no legacy React import mapping. Install `@ai-markdown/vue` with Vue `^3.5.0`, import `@ai-markdown/vue/styles.css`, and use the [Vue setup](getting-started.md#vue-35). React components and hooks cannot be migrated by substituting `/vue` in every import.

## React installation and API continuity

```bash
pnpm remove @ai-react-markdown/core
pnpm add @ai-markdown/react react@^19 react-dom@^19
```

```tsx
import AIMarkdown from '@ai-markdown/react';
import '@ai-markdown/react/typography/default.css';

export function Answer({ content, streaming }: { content: string; streaming: boolean }) {
  return <AIMarkdown content={content} streaming={streaming} />;
}
```

Continue passing the complete accumulated Markdown string. `AIMarkdown`, the narrow hooks, `AIMarkdownDocuments`, component slots and flat configuration names retain their React API. Existing custom typography uses the same variant filename under the new package path. Import `createRemendPreprocessor` from the React root and sealed plugin objects from `@ai-markdown/react/plugins`. The `/plugins` entry exports the catalog and its types, not preprocessors. Vue exports its catalog and preprocessor helpers from `@ai-markdown/vue` directly.

React 19 is the supported initial peer range. ESM/CJS, development/production conditions, declarations and the React `use client` directive are retained. KaTeX remains an optional peer; install it and import its stylesheet when using math rendering, following the [React reference](../reference/react.md). Custom renderers must still apply the documented final-element URL policy.

## Mantine integration

```bash
pnpm remove @ai-react-markdown/mantine
pnpm add @ai-markdown/react @ai-markdown/react-mantine
```

Keep the existing React 19, Mantine 9 and highlight.js peers. The initial 3.0.0 integration declared the React adapter peer `^3.0.0`; later releases may raise the minimum. Upgrade the two together using the current reference. Import `@ai-markdown/react-mantine/styles.css` after the Mantine styles and retain the providers shown in the [Mantine reference](../reference/react-mantine.md). `MantineAIMarkdown`, `codeBlock` and caller slot precedence are unchanged.

The integration remains React-specific; it cannot render Vue nodes. Mermaid loading and the optional math stylesheet follow the existing integration behavior.

## Shared core ownership

The legacy split extracted reusable computation before changing public imports. The new core now ships separately, with an explicit export list, instead of being bundled into React. Engine and core are exact-version dependencies of the adapter. They do not import React, Vue or DOM APIs; adapters may consume engine directly without routing every primitive through a core re-export.

Core owns pipeline sessions, phantom preparation, block planning, contribution fingerprints, post-transform body harvesting, aggregate footnote HAST, smooth queue state and source-tail classification. It returns syntax trees and coordination facts. React owns nodes, cached React output, context subscriptions, provenance credentials, lifecycle timing, final placeholder conversion and DOM cursor measurement.

`createRegistry` exposes engine's `RegistryController` write contract without private subscriber/refcount containers. Core's contribution publisher requires only a `ContributionRegistry` capability. `createSmoothCoordinator` exposes documented state and methods through `SmoothCoordinator`. These type boundaries do not deep-freeze returned values. The [core README](../../../../packages/core/README.md) documents ownership, invalidation and read-only snapshot rules.

## Cross-chunk references and SSR

Keep the existing logical `documentId`, stable chunk identity and document ordering when changing imports. `AIMarkdownDocuments` still scopes coordination. Registration and contribution publication occur in committed lifecycle work; parsing and planning must not publish. A discarded concurrent render cannot retain a permanently owned document scope.

SSR does not run the registration effects and retains local footnote behavior. The host chooses one-shot parsing for server output; a later client frame must establish its own session and registration. Do not serialize a mutable registry or planner from one request into another. Stable v3 retains the React SSR behavior; Vue also supports server rendering and initial hydration before mounted coordination becomes active.

## Public API and release policy

Engine, core, react and react-mantine started one version train at `3.0.0-beta.1`; Vue joined at `3.0.0-beta.2`. All five follow the stable `3.0.0` train on npm `latest`. The highlight plugin remains on its independent 1.x line; the existing rehype/raw forks retain their own repositories and upstream-related versions. Subsequent prereleases must not move npm `latest` or become stable GitHub releases. Vue’s first publication retained the initial `latest → 3.0.0-beta.2` mapping by maintainer decision; that historical mapping is superseded by stable publication. The [release record](release-highlights.md#300-beta2--vue-35-adapter-and-explicit-shared-apis) documents that exception.

Documented engine/core contracts follow semantic versioning from 3.0.0. Test fixtures and implementation containers are excluded from the public root. Framework apps should avoid importing source paths or undocumented helpers. Release verification includes signature review, supported consumer checks and the complete release gate. See the [shared API contracts](api/core-engine-contracts.md) and [architecture guide](architecture.md).

The repository transfer and first publication of all five train packages are complete. npm registry metadata checked on 2026-09-11 reports `latest → 3.0.0` for [engine](https://registry.npmjs.org/@ai-markdown%2Fengine), [core](https://registry.npmjs.org/@ai-markdown%2Fcore), [React](https://registry.npmjs.org/@ai-markdown%2Freact), [Vue](https://registry.npmjs.org/@ai-markdown%2Fvue) and [Mantine](https://registry.npmjs.org/@ai-markdown%2Freact-mantine). Publishing additional packages still requires package-specific credentials and trusted-publisher setup; repository ownership alone does not configure it.

## Validation and second-framework limits

Shared-core tests load production/development ESM and CJS in fresh Node processes, reject framework resolution and execute parsing/planning without browser globals. Session tests compare incremental output with a full engine pipeline and cover reset, fallback and explicit contribution timing. React tests cover node identity, SSR, Strict Mode, coordination and browser interaction. Published artifacts must additionally resolve outside the workspace, including declarations, plugin entries and CSS paths.

The [Vue adapter](../reference/vue.md) now consumes the same preparation contracts and supplies VNode conversion, scoped references, SSR hydration, component/slot extension and streaming UI. It requires Vue `^3.5.0`; its first stable release was 3.0.0. The former prototype is archived. See the [API contracts](api/core-engine-contracts.md) for stable contracts and the advanced API changes since beta.1.

Vue is part of the published stable release train. Functional integration checks cover Chromium, Firefox and WebKit; forced-GC lifecycle checks remain Chromium-specific. Nuxt-specific integration and KeepAlive/Suspense combinations still require their own coverage before being advertised.

## Documentation site

Use the [documentation site](https://ai-markdown.github.io/docs/) for current integration guides and API references, package READMEs for minimal setup, and [Storybook](storybook.md) for interactive examples.

Package READMEs continue to include complete installation, minimal examples, environment requirements and important limitations. Legacy 1.x-to-2.x guidance remains historical material; new users should start with the current framework README and this migration guide.

# Documentation site

The independent documentation site uses [Astro Starlight](https://starlight.astro.build/getting-started/) in the private `apps/docs` workspace. React and Vue have separate API entries; Mantine is a React integration. Application guides are organized by reader task; API reference, integration development and contributor material have separate navigation groups. English keeps unprefixed URLs; Simplified Chinese uses `/zh-cn/`.

## Run and build

Use the repository's pinned Node and pnpm versions, then run:

```bash
pnpm install
pnpm dev:docs          # Astro development server, normally http://localhost:4321
pnpm check:docs    # Astro content/configuration diagnostics
pnpm build:docs    # Static output in apps/docs/dist, including Pagefind search
pnpm test:docs     # Link transformation tests and built-site link/anchor checks
pnpm preview:docs  # Serve the production build locally
```

No renderer package build is required. The site renders documentation and code excerpts; Storybook remains responsible for live framework examples. Search is generated during the production build; verify it with `pnpm preview:docs`.

## One source per document

- `apps/docs/content/guides/*.md` and `apps/docs/content/guides/api/*.md` are the canonical usage, architecture and maintenance guides.
- `apps/docs/content/reference/{react,vue,react-mantine}.md` own the full adapter references. Their routes remain `/docs/react/`, `/docs/vue/` and `/docs/react/mantine/`.
- Adapter package READMEs contain installation, a minimal example and documentation links. Core, engine and the independently versioned highlight plugin still use their package READMEs as their reference sources.
- `apps/docs/content/` owns the documentation overview, example directory and translations. English and Chinese homepage routes share `apps/docs/src/components/Home.astro`; the Examples routes share `Examples.astro`.
- `apps/docs/scripts/content.mjs` maps these sources to routes and generates Starlight frontmatter with an edit link to the canonical file. The adapter references declare their former README paths as source aliases, so existing README links and fragments still resolve to the full site reference.
- `apps/docs/src/content/docs/` is generated and ignored by Git. Do not edit it. Development watches canonical sources and regenerates changed pages, including additions and deletions.

The sidebar groups application guides by task and labels framework-specific APIs explicitly. Keep API reference, integration-author guides and contributor workflows separate from onboarding. Do not label React hooks or typography recipes as shared capabilities.

New top-level guides and API guides are included automatically. Add their navigation entries in `apps/docs/scripts/navigation.mjs`. Internal planning/review directories are excluded. Retained release history is identified by version and is separate from current integration guidance.

## Keep current versions accurate

The [package requirements page](getting-started.md) names the current train. `pnpm version-packages <version>` updates that statement along with allowlisted React install and peer snippets in English and Chinese. Avoid repeating the train version in other introductory prose; link to the requirements page or the relevant peer table instead.

`pnpm test:release-control` checks the requirements statement against the root manifest and the integration peer snippets against Mantine's manifest. It also exercises candidate-to-stable updates on the actual requirements page while keeping release history unchanged. These checks cover the version statements and peer snippets, not every API or external dependency requirement: review framework and Node requirements when their manifests change.

Historical releases, migration records and benchmark measurements keep their original versions. Do not add them to the updater's current-guide allowlist. Published npm README snapshots belong to their original tarballs; changing a repository README does not replace an already published version.

## Links and deployment paths

Rendered Markdown links, reference links and raw HTML links to included documents become site routes. Source-code links remain GitHub links. Absolute GitHub `blob/main` links to included documents also become site routes. Code blocks are never rewritten. Edit links always target canonical sources.

Configure a static deployment through environment variables at build time:

| Variable             | Purpose                                                                | Default                                         |
| -------------------- | ---------------------------------------------------------------------- | ----------------------------------------------- |
| `DOCS_SITE_URL`      | Absolute site origin for canonical URLs and sitemap generation         | Unset for local development                     |
| `DOCS_BASE`          | URL path prefix, such as `/preview/`                                   | `/`                                             |
| `DOCS_STORYBOOK_URL` | Matching Storybook composition root, with `react/` and `vue/` children | Example links open local Storybook instructions |

```bash
DOCS_SITE_URL=https://docs.example.com DOCS_BASE=/preview/ pnpm build:docs
DOCS_BASE=/preview/ pnpm test:docs
```

API declaration snapshots live in `tooling/api-reports/` and are verified by `pnpm check:public-api`. Release automation reads `apps/docs/content/guides/release-highlights.md`. The root `docs/` directory is retired.

Upload all of `apps/docs/dist/` together. Its HTML, assets and Pagefind index are one build. Configure the host's not-found page using `404.html`; this is a static multi-page site, so do not rewrite every unknown path to the homepage. The repository CI builds and checks the documentation under a prefix and retains the static artifact.

The optional Sites configuration in `apps/docs/.openai/hosting.json` identifies the private preview. It does not define the project's public documentation domain. Storybook-to-guide links use the public organization documentation site.

## Homepage, themes and languages

The site root `/` is a standalone project homepage. `/docs/` is the documentation overview, and guides and package references live below that path (for example `/docs/react/` and `/docs/guides/getting-started/`). `DOCS_BASE` remains an optional deployment prefix for the whole site, so `/preview/` produces `/preview/` and `/preview/docs/`.

The shared header provides Docs navigation, search, a language menu and Starlight's Auto / Light / Dark selector on both the homepage and documentation pages. Auto follows the system color scheme; explicit choices persist across navigation and reloads. The language menu switches between English and Simplified Chinese while retaining the equivalent page.

Language configuration lives in `apps/docs/src/i18n/config.mjs`. English is the `root` locale, so English URLs have no `/en/` prefix. Custom navigation translations live in `apps/docs/src/content/i18n/`; Starlight supplies the standard UI translations.

To add another documentation language, add its locale configuration and translated guides under `apps/docs/content/translations/<locale>/`, mirroring the canonical repository paths (for example `fr/apps/docs/content/guides/getting-started.md` or `fr/apps/docs/content/reference/vue.md`). Keep the leading H1 and the original source-relative links. Generated pages use `/<locale>/docs/...`; missing translations use Starlight's English fallback. Both published locales have homepage and Examples routes. Add equivalent standalone routes before publishing any further locale. Chinese articles include the full guidance and original code examples; translated historical records retain the versions, measurements and conditions of their source. Use the explicit `english:` link prefix only when intentionally linking to English content. Storybook catalogs currently retain their English controls and story names. The documentation tests require a Chinese source for every English topic and verify localized routes, links and search indexes.

## GitHub Pages

`.github/workflows/pages.yml` builds the homepage, documentation and composed Storybook from the same commit. Pull requests validate and upload the assembled artifact; pushes to `main` and manual runs on `main` also deploy it. PR artifacts are downloadable builds, not hosted PR preview URLs.

Enable **Settings → Pages → Build and deployment → GitHub Actions**. `actions/configure-pages` supplies the actual origin and base path, including a configured custom domain. No domain is hardcoded in the workflow. On the default project URL, the homepage is `/ai-markdown/`, documentation is `/ai-markdown/docs/`, and the examples page is `/ai-markdown/examples/`, which embeds the composed Storybook catalog served from `/ai-markdown/storybook/`.

Reproduce the combined build from the repository root:

```bash
export DOCS_SITE_URL=https://ai-markdown.github.io
export DOCS_BASE=/ai-markdown/
export DOCS_STORYBOOK_URL=https://ai-markdown.github.io/ai-markdown/storybook/
pnpm check:docs
pnpm build:docs
STORYBOOK_DOCS_EXPORT=1 pnpm build:storybook
pnpm test:storybook:site
pnpm assemble:pages
DOCS_DIST=_site pnpm test:docs
```

`_site/` is ignored and contains the docs build at its root and the entire Storybook build in `storybook/`. The link check validates documentation links against this assembled directory, including same-origin links into the React and Vue catalogs. Pages receives one artifact only after both builds and their checks pass. Never deploy the docs and Storybook separately to the same Pages site: each deployment replaces the site's artifact.

## Organization root website

The public homepage is **`https://ai-markdown.github.io/`**. Its publishing repository is `ai-markdown/ai-markdown.github.io`, as required for GitHub organization sites. That repository calls this repository's reusable Pages workflow and checks out application source from `ai-markdown/ai-markdown`. It checks for source changes approximately every 15 minutes (scheduled runs may be delayed); manual dispatch publishes immediately. No cross-repository write credential is stored.

The organization deployment uses `/` as its base: `/docs/` contains documentation, `/examples/` embeds the full Storybook UI with framework switches, and `/storybook/` remains available for direct links and standalone use. The existing project deployment under `/ai-markdown/` remains a working mirror. Both deployments derive their base from their own Pages settings.

### Verify both public deployments

The organization root and project mirror are separate workflow runs. A successful project Pages deployment does not mean the root website has received the same source yet.

After merging a documentation update, let the organization publishing schedule run or dispatch it explicitly:

```bash
gh workflow run publish.yml --repo ai-markdown/ai-markdown.github.io --ref main
gh run list --repo ai-markdown/ai-markdown.github.io --workflow publish.yml --limit 3
```

Wait for that run to succeed. Compare `/source-commit.txt` on the organization root with the intended source commit, then open the changed documentation pages. Verify `/ai-markdown/source-commit.txt` and the corresponding pages independently for the project mirror. Check Examples and its embedded Storybook as part of the assembled site; a docs-only local build does not establish that the catalog is deployed.

## Navigation and reading paths

`apps/docs/scripts/navigation.mjs` owns the bilingual sidebar labels and the previous/next links for framework tutorials. Organize application guides by reader task: getting started, streaming, content and styling, integrations and performance, then API reference. Keep integration-author and contributor material in their own groups. Add each canonical topic exactly once; translated routes use the same structure.

`apps/docs/scripts/content.mjs` generates localized reading-path links with the deployment base. Keep framework quick starts pointed at their own streaming or integration guide, rather than the next framework in sidebar order. `navigation.test.mjs` checks topic coverage and framework paths in English and Chinese at both root and project URLs.

# 文档站点

独立的文档站点在私有的 `apps/docs` 工作区中使用 [Astro Starlight](https://starlight.astro.build/getting-started/) 构建。React 和 Vue 拥有独立的 API 入口；Mantine 属于 React 集成。应用指南按读者任务组织，API 参考、集成开发和贡献者资料分别分组。英文保持无前缀的 URL；简体中文使用 `/zh-cn/`。

<span id="run-and-build"></span>

## 运行与构建

使用代码库固定的 Node 和 pnpm 版本，然后运行：

```bash
pnpm install
pnpm dev:docs          # Astro development server, normally http://localhost:4321
pnpm check:docs    # Astro content/configuration diagnostics
pnpm build:docs    # Static output in apps/docs/dist, including Pagefind search
pnpm test:docs     # Link transformation tests and built-site link/anchor checks
pnpm preview:docs  # Serve the production build locally
```

无需预先构建渲染器相关包。该站点负责渲染文档与代码片段；Storybook 仍负责交互式框架示例。搜索索引在生产构建期间生成；可使用 `pnpm preview:docs` 检验搜索效果。

<span id="one-source-per-document"></span>

## 单一文档源原则

- `apps/docs/content/guides/*.md` 与 `apps/docs/content/guides/api/*.md` 是规范的使用指南、架构文档与维护指南。
- `apps/docs/content/reference/{react,vue,react-mantine}.md` 拥有完整的适配器参考文档。它们的路由保持为 `/docs/react/`、`/docs/vue/` 和 `/docs/react/mantine/`。
- 适配器相关包的 README 包含安装步骤、最小示例及文档链接。Core、engine 和独立版本发布的高亮插件仍以各自包的 README 作为参考文档源。
- `apps/docs/content/` 拥有文档总览、示例目录及翻译文件。英文和中文首页路由共享 `apps/docs/src/components/Home.astro`；示例路由共享 `Examples.astro`。
- `apps/docs/scripts/content.mjs` 将这些源文件映射为路由，并生成带有规范文件编辑链接的 Starlight frontmatter。适配器参考文档将其旧的 README 路径声明为源别名，以便原有的 README 链接和锚点仍能解析到完整的站点参考文档。
- `apps/docs/src/content/docs/` 是由脚本生成并被 Git 忽略的目录。请勿手动编辑。开发模式会监视规范源文件，并重新生成发生变动的页面，包括文件的添加与删除。

侧边栏按任务组织应用指南，并明确标注框架专用 API。API 参考、集成开发与贡献者工作流独立分组，不放在入门路径中。不要将 React Hook 或排版方案标为共享能力。

新增的顶层指南与 API 指南会自动包含进来。在 `apps/docs/scripts/navigation.mjs` 中添加对应的导航条目。内部规划与审查目录会被排除在外。保留的发布历史按版本划分，与当前的集成指南相互独立。

<span id="keep-current-versions-accurate"></span>

## 保持当前版本准确

[包安装要求页面](getting-started.md)说明了如何查询当前版本与兼容范围。`pnpm version-packages <version>` 会更新英文页面的当前版本说明，以及中英文允许列表内的 React 安装与对等依赖代码片段。避免在其他引导文案中重复出现该版本号；改用链接指向安装要求页面或相关对等依赖表格。

`pnpm test:release-control` 会对照根目录清单核验安装要求说明，并对照 Mantine 清单核验集成对等依赖代码片段。它还会在真实的安装要求页面上测试候选版到稳定版的更新流程，同时保持发布历史不变。这些检查覆盖了版本声明与对等依赖代码片段，并非涵盖每个 API 或外部依赖项要求：当外部清单变更时，仍需人工核查框架与 Node 版本要求。

历史发布记录、迁移指南与基准测试数据保留其原始版本。不要将它们添加到更新器的当前指南白名单中。已发布的 npm README 快照属于原始 tarball 产物；修改代码库中的 README 并不会替换已发布的版本。

<span id="links-and-deployment-paths"></span>

## 链接与部署路径

文档中指向所收录文档的 Markdown 链接、引用链接与原生 HTML 链接均会转换为站点内部路由。源码链接保持为 GitHub 链接。指向收录文档的绝对 GitHub `blob/main` 链接也会转换为站点内部路由。代码块内容绝不被重写。编辑链接始终指向规范源文件。

在构建时通过环境变量配置静态部署：

| 环境变量             | 用途                                                               | 默认值                          |
| -------------------- | ------------------------------------------------------------------ | ------------------------------- |
| `DOCS_SITE_URL`      | 规范 URL（canonical URL）与站点地图（sitemap）生成的绝对站点源地址 | 本地开发时未设置                |
| `DOCS_BASE`          | URL 路径前缀，例如 `/preview/`                                     | `/`                             |
| `DOCS_STORYBOOK_URL` | 匹配的 Storybook 组合根地址，包含 `react/` 和 `vue/` 子路径        | 示例链接打开本地 Storybook 说明 |

```bash
DOCS_SITE_URL=https://docs.example.com DOCS_BASE=/preview/ pnpm build:docs
DOCS_BASE=/preview/ pnpm test:docs
```

API 类型声明快照保存在 `tooling/api-reports/` 目录下，并通过 `pnpm check:public-api` 进行验证。发布自动化工具会读取 `apps/docs/content/guides/release-highlights.md`。根目录下的 `docs/` 目录已被废弃。

请将 `apps/docs/dist/` 下的所有文件一并上传。其 HTML、静态资源与 Pagefind 索引构成了单次构建的完整整体。使用 `404.html` 配置托管服务的未找到页面；这是一个静态多页站点，请勿将所有未知路径重定向到首页。代码库 CI 会在特定前缀下构建并检查文档，并保留静态构建产物。

`apps/docs/.openai/hosting.json` 中的可选 Sites 配置标识了私有预览环境，并不定义项目的公开文档域名。Storybook 指向指南的链接使用公开组织文档站点。

<span id="homepage-themes-and-languages"></span>

## 首页、主题与多语言

站点根路径 `/` 是独立的项目首页。`/docs/` 是文档总览页面，各类指南与相关包参考文档位于该路径下方（例如 `/docs/react/` 和 `/docs/guides/getting-started/`）。`DOCS_BASE` 作为整个站点的可选部署前缀依然有效，例如 `/preview/` 会生成 `/preview/` 和 `/preview/docs/`。

共享头部在首页与文档页面上均提供文档导航、搜索、语言菜单以及 Starlight 的自动/浅色/深色主题切换选项。自动模式遵循系统色彩偏好；显式选择的主题在跨页面导航与刷新后依然保留。语言菜单可在保持对等页面的同时在英文与简体中文之间切换。

语言配置位于 `apps/docs/src/i18n/config.mjs` 中。英文为 `root` 语言环境，因此英文 URL 没有 `/en/` 前缀。自定义导航翻译位于 `apps/docs/src/content/i18n/`；Starlight 提供标准的界面翻译。

若需添加其他文档语言，请在 `apps/docs/content/translations/<locale>/` 下添加对应的区域配置和翻译指南，严格镜像代码库的规范路径（例如 `fr/apps/docs/content/guides/getting-started.md` 或 `fr/apps/docs/content/reference/vue.md`）。保留首行 H1 标题以及原有的相对源文件链接。生成的页面使用 `/<locale>/docs/...`；缺失翻译的页面会使用 Starlight 的英文回退。已发布的两种语言环境均提供首页与示例路由。在发布任何新语言环境之前，请先添加对等的独立路由。中文文章包含完整说明和原有代码示例；历史记录保留原文的版本、测量数据和适用条件。只有在明确需要链接到英文内容时，才使用 `english:` 链接前缀。Storybook 目录目前保留其英文控件与 Story 名称。文档测试要求每个英文主题都有对应的中文源文件，并验证本地化路由、链接及搜索索引。

<span id="github-pages"></span>

## GitHub Pages

`.github/workflows/pages.yml` 从同一提交中同时构建首页、文档与组合后的 Storybook。Pull Request 会验证并上传组合构建产物；推送到 `main` 分支及在 `main` 上的手动运行还会触发部署。PR 产物是可下载的构建文件，而非托管的 PR 预览 URL。

在代码仓库中启用 **Settings → Pages → Build and deployment → GitHub Actions**。`actions/configure-pages` 会提供实际的源地址与基本路径，包括已配置的自定义域名。工作流中未硬编码任何域名。在默认的项目 URL 下，首页为 `/ai-markdown/`，文档为 `/ai-markdown/docs/`，示例页面为 `/ai-markdown/examples/`，该页面嵌入了托管在 `/ai-markdown/storybook/` 的组合 Storybook 目录。

在代码库根目录下复现组合构建：

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

`_site/` 目录被 Git 忽略，其根目录下包含文档构建，`storybook/` 目录下包含完整的 Storybook 构建。链接检查会对照该组合目录验证文档链接，包括指向 React 和 Vue 目录的同源链接。Pages 仅在两套构建及其检查全部通过后才会接收单一构建产物。切勿将文档与 Storybook 分别单独部署到同一个 Pages 站点：每次部署都会完全替换该站点的构建产物。

<span id="organization-root-website"></span>

## 组织根域名网站

公开首页地址为 **`https://ai-markdown.github.io/`**。其发布仓库为 `ai-markdown/ai-markdown.github.io`，符合 GitHub 组织站点的要求。该仓库调用本仓库的可复用 Pages 工作流，并从 `ai-markdown/ai-markdown` 检出应用源码。它大约每 15 分钟检查一次源码变动（定时运行可能存在延迟）；手动调度则会立即触发发布。未存储跨仓库的写凭据。

组织部署使用 `/` 作为根路径：`/docs/` 包含文档，`/examples/` 嵌入带有框架切换功能的完整 Storybook 界面，`/storybook/` 仍可用于直接链接与独立使用。现有的位于 `/ai-markdown/` 下的项目部署保持为镜像站点。两套部署各自从自身的 Pages 设置中推导根路径。

<span id="verify-both-public-deployments"></span>

### 验证两处公开部署

组织根站点与项目镜像站点属于独立的两次工作流运行。项目 Pages 部署成功并不意味着组织根域名网站已接收到相同的源码。

合并文档更新后，等待组织发布定时任务运行或显式触发调度：

```bash
gh workflow run publish.yml --repo ai-markdown/ai-markdown.github.io --ref main
gh run list --repo ai-markdown/ai-markdown.github.io --workflow publish.yml --limit 3
```

等待该运行成功完成。将组织根站点上的 `/source-commit.txt` 与预期的源码提交进行比对，然后打开修改后的文档页面。对于项目镜像站点，独立验证 `/ai-markdown/source-commit.txt` 及对应页面。检查示例页面及其嵌入的 Storybook，确认其作为组合站点的一部分正常工作；仅在本地进行文档构建并不能保证组件目录已成功部署。

## 导航与阅读路径

`apps/docs/scripts/navigation.mjs` 统一管理中英文侧边栏名称，以及框架教程的上一页、下一页链接。应用指南按读者任务组织：开始使用、流式体验、内容与样式、集成与性能、API 参考。集成开发者与贡献者资料分别分组。每个主题只列一次，翻译页面沿用相同结构。

`apps/docs/scripts/content.mjs` 根据语言和部署前缀生成阅读路径。框架快速开始的下一页应指向对应的流式或集成教程，不要直接跳到另一个框架。`navigation.test.mjs` 检查目录覆盖，以及根域名和仓库子路径下的中英文阅读顺序。

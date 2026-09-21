# Architecture snapshots generated with Birdview

These standalone, bilingual diagrams were generated with [Birdview](https://github.com/Qiuner/birdview), not maintained by an automatic repository workflow. The module descriptions and source evidence were authored by an agent and checked against the repository; the renderer does not infer or prove architecture.

这两张双语交互图由 **Birdview 生成**，作为架构文档快照保存。模块与证据由 agent 整理并核对；项目不安装 Birdview 技能，不要求开发时更新地图或记录活动。

| Snapshot                              | Viewer                               | Source                               | Map / revision                |
| ------------------------------------- | ------------------------------------ | ------------------------------------ | ----------------------------- |
| Product runtime / 产品运行时          | [runtime.html](runtime.html)         | [runtime.json](runtime.json)         | `ai-markdown-workspace` / 6   |
| Development and delivery / 开发与交付 | [development.html](development.html) | [development.json](development.json) | `ai-markdown-development` / 5 |

- Generated: **2026-09-21**.
- Project ID: `ai-markdown`.
- Source baseline: `b3473a473236ac643e26656897e0a12e5badb6e6`.
- Birdview version: **0.2.1**; renderer commit: `0d110767a04c047e10cea35210980edb1c7b3001`.
- Product view: 7 modules, 8 relationships. Development view: 8 nodes, 13 relationships.
- Chinese is the base language; the viewer's language selector switches titles, nodes, relationships and evidence to English. Paths, symbols and IDs remain unchanged.
- Evidence paths are relative to the ai-markdown repository root, not this directory. Source file references are snapshots and may become stale.
- Development relationships include build inputs and verification/publishing responsibilities; they do not assert runtime dependencies or that a release was executed.

Open either HTML file in a browser. The files embed their data, viewer, styles and icons; no server, network assets or installed skill are required. GitHub's source viewer does not execute the HTML; download it or use the documentation site links.

## Optional regeneration

Only regenerate when a documentation update calls for it. Keep both translations and increment the affected map revision when editing JSON. Update the source baseline after checking evidence against a newer checkout. This is not a per-change requirement.

Use a separate checkout of Qiuner/birdview at the renderer commit above, outside this repository, and install its dependencies with `npm ci --ignore-scripts`. From the ai-markdown repository root, set `BIRDVIEW_RENDERER` to that checkout and run:

```sh
node "$BIRDVIEW_RENDERER/scripts/validate.mjs" apps/docs/public/architecture/birdview/runtime.json --authoring --bilingual
node "$BIRDVIEW_RENDERER/scripts/render.mjs" apps/docs/public/architecture/birdview/runtime.json apps/docs/public/architecture/birdview/runtime.html
node "$BIRDVIEW_RENDERER/scripts/validate.mjs" apps/docs/public/architecture/birdview/development.json --authoring --bilingual
node "$BIRDVIEW_RENDERER/scripts/render.mjs" apps/docs/public/architecture/birdview/development.json apps/docs/public/architecture/birdview/development.html
```

Check the source evidence and both languages in a browser before replacing the snapshots. Structural validation is not proof of architectural correctness. The diagrams are summaries, not exhaustive import graphs or deployment records.

## Licensing

Project-authored map data follows the repository's license. The generated viewers include Birdview's MIT-licensed runtime and third-party icons; their notices are embedded in each HTML and also retained in [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).

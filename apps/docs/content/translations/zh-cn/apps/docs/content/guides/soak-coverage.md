# 压测覆盖映射

发布压测（release soak）将有状态的增量实现与更简单的无状态参考实现（oracle）进行比对。仅当优化路径确实被执行时，相等的断言才具有实际意义。因此，每个条目都同时记录了参考实现以及反虚无条件（anti-vacuity condition）——即受测路径确实参与计算的可测量要求。

机器可读的配置源文件是 [`scripts/soak/coverage-map.json`](../../../../scripts/soak/coverage-map.json)。其验证脚本 [`assert-coverage-map.mjs`](../../../../scripts/soak/assert-coverage-map.mjs) 会检查引用的源码与测试用例是否存在，并确保每个发布测试分支都有明确的归属。

<span id="coverage-by-optimization"></span>

## 按优化特性的测试覆盖

| 条目           | 无状态参考实现               | 发布测试分支     | 反虚无条件要求                       |
| -------------- | ---------------------------- | ---------------- | ------------------------------------ |
| 增量解析       | 全新全量解析                 | `fuzz`           | 增量帧比例与生成族底线               |
| 恢复冻结扫描   | 全新边界扫描                 | `fuzz`、`census` | 非零参与度与穷尽 P3                  |
| 冻结方向       | 危险期之后的全局解析         | `dir`、`oracle`  | 边界与文档探测底线                   |
| 定义标签扫描器 | 全量 `collectDefLabels` 解析 | `scanner`        | 每一个快照上的危险与安全数据流       |
| LaTeX 预处理器 | 无状态 `preprocessLaTeX`     | `latex`          | 每种配置下的冻结、回退与组合接缝底线 |

这六个测试分支名称是测试运行器的标识符，并非可互换的测试分类。例如，恢复扫描器同时由随机拼接流与有界穷尽普查进行测试；定义扫描器拥有独立的测试分支，因为其配置与输出契约与渲染解析器不同。

<span id="adding-or-changing-an-entry"></span>

## 新增或修改条目

每个有状态或增量条目都必须指明其无状态参考实现、CI 测试用例、发布压测分支以及反虚无条件。在引入优化时应同步添加该映射，随后确认对应的测试在可能产生陈旧状态的中间快照处比对了输出结果。

在植入故障能使属性断言或参与度断言失败之前，新增的条目是不完整的。如果实现在每一帧都静默回退，仅仅与参考实现比对仍可能保持通过状态。反之，单独的覆盖率计数器也无法证明正确性。必须同时保留两项检查，并在因失败发现新的输入族时记录回归测试用例。

<span id="run-profiles-and-evidence"></span>

## 运行配置与测试证据

开发环境运行使用 `SOAK_PROFILE=smoke`。使用先前发现的种子进行诊断重跑时，额外设置 `RUN_KIND=replay`。这些运行有助于排查故障；切勿将其作为全新的正式发布测试轮次提交。

只有完整的发布配置才能生成发布合格（PASS）结论。运行器会输出 `.soak-logs/<run-id>/manifest.json` 与 `result.json`，其中记录了聚合器所需的运行标识与测试结果。在代码库根目录下检查完整或拆分后的测试结果：

```sh
pnpm --filter @ai-markdown/engine soak:aggregate -- \
  .soak-logs/<main-run-id> .soak-logs/<census-run-id>
```

请将占位符目录替换为实际的运行目录。切勿根据部分通过的日志就推断发布合格：聚合器会跨所有必需的测试分支与拆分运行综合检查测试证据。针对单个失败种子进行诊断的重放测试不能替代使用全新随机种子的完整发布配置测试。

<span id="related-records"></span>

## 相关记录

[前缀冻结实验](../../../../packages/engine/src/experiments/prefixFreeze/README.md)阐述了边界研究与验证技术栈的演进历程。[架构设计全景](architecture.md)指明了生产流水线架构。发布说明中的历史压测规模描述的是当时的特定发布；当前的覆盖映射表与运行器定义了当前的发布契约。

<span id="when-a-release-needs-engine-soak"></span>

## 何时发布需要引擎压测

这六个测试分支执行的是引擎测试。它们并不直接验证 core 的状态管理或框架适配器。仅限于 core、React、Vue、Mantine、文档或包版本元数据的改动，使用其对应的 CI 门禁进行验证，本身不需要额外启动引擎压测轮次。

`pnpm check:soak-impact` 比较已提交的候选版本与最近的前序统一发布标签。可用 `--base <commit-or-tag> --head <commit>` 检查指定祖先区间。PR CI 累计评估检出的合并候选版本，发布 CI 重新评估最终候选版本。报告分别列出完整 soak 和有界 smoke 的原因：

| 变更                                                                                                           | 所需验证                                     |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 引擎/highlight 实现、运行时导出、生成器、oracle、六项测试、fuzz 测试、语料、构建配置与依赖、采样预算或发布契约 | 本地完整 release-profile soak 与发布审批     |
| Vitest 及其执行依赖、包管理器/安装机制、验证任务的 Node 版本、执行器/报告工具，或字面量缓存/并发/超时设置      | 自动运行六项 smoke（`pnpm test:soak-smoke`） |
| core/适配器/UI/文档、普通单测、benchmark、独立 evidence、Stryker 工具、影响判定/审批规则及其控制测试           | 对应的常规 CI 检查                           |

单独升级测试框架不会使引擎的大规模随机/穷举覆盖失效，但必须证明新工具能正确执行全部六项测试。Smoke 使用两个分片、两个 worker、固定重放 seed、每项 fuzz 1,000 个样本、oracle 100 个样本，以及 K=2 的 census/name 范围。它保留原有断言与防空转阈值，并校验测试数量、实际环境和结构化报告，不能替代完整的新 seed 发布测试。CI 和发布验证均按判定自动执行 smoke，失败会阻止验证通过。若同时存在两类变更，CI 跑 smoke，完整发布门禁也仍然生效。

依赖影响沿历史 lockfile 的传递依赖和本地 workspace 依赖追踪。运行时与生成器依赖优先，即使测试工具也使用它们。完整依赖图只排除已知开发测试工具与 `@types/*`；未知引擎开发依赖仍需完整 soak。仅影响 Stryker 的补丁与无关 override 不触发 soak；影响引擎/构建图的补丁需要完整 soak，影响执行工具的补丁需要 smoke。解析策略以 frozen lockfile 的实际依赖图为准。排除引擎 workspace 或无法解析依赖影响时保守要求完整 soak。引擎引用的生成器即使在 `packages/engine` 之外，其源码变化也会被追踪。`corpus/documents` 属于验证输入，不是普通文档。

六项测试使用 `packages/engine/vitest.config.ts`。仅字面量缓存、worker、并行和超时设置可单独走 smoke；setup、alias、测试筛选、计算表达式与未知配置变化仍要求完整 soak。根目录/Storybook、highlight 单测、benchmark、mutation 与独立 evidence 配置由各自 CI 验证。控制测试检查引擎与插件模块没有导入被排除的测试/benchmark/evidence 入口。注释和被擦除的 TypeScript 类型不触发 soak。

判定规则和控制测试由 `pnpm test:soak-control` 验证；算法 soak 本身不会执行这些规则。执行器、元数据和聚合工具变化另需 smoke。采样脚本、共享 soak 契约、release profile 和未知 soak 脚本仍触发完整测试。Node 固定版本按引擎验证任务（含 matrix）比较，无关文档任务不触发 smoke；删除或更名验证任务需要兼容性验证。

CI 分别显示 **FULL required before release**、**SMOKE verified** 或 **NOT REQUIRED**。判定或 smoke 失败会使检查失败。成功的判定不代表完整 soak 已通过。没有前序发布标签时需要初次完整验证，非法 Git 区间会使检查失败。仅完整 soak 要求会触发现有的人工发布审批。

验证已提交的发布候选版本和本地完整测试证据：

```sh
pnpm check:release-soak --evidence .soak-logs/<run-id>
```

发布验证始终使用干净检出的 `HEAD` 及其前序统一版本发布标签；它不接受自定义的基准或候选版本覆盖参数。探索性的区间比对请使用 `check:soak-impact`。对于拆分运行的测试轮次，可在 `--evidence` 后指定多个目录。该命令会检查发布配置，并要求每个受测提交都必须是候选版本的祖先提交，且中间不存在影响引擎的改动。文档、适配器或仅工具变化可复用有效的完整测试证据；工具变化还必须通过有界 smoke，本地发布验证器也会按判定运行它。新增影响引擎的改动则需要启动全新的完整测试轮次。请妥善保存测试清单与报告以供发布审查人员查验。它们是生成的测试证据，不是需要提交到代码库的源文档。

<span id="manual-release-approval"></span>

## 人工发布批准

发布工作流首先完成其自动化质量检查，并在工作流摘要中报告对比基准、候选提交 SHA 以及压测触发原因。如果需要压测，一个独立的任务会等待 GitHub 环境 `soak-approval` 的人工审批。发布取决于自动化验证的通过，并在需要时取决于人工审批的通过。被拒绝、取消或缺失的审批均无法完成发布。对于没有引擎影响的发布，会自动跳过该审批任务。

在批准之前，审查人员必须确认候选版本已通过 `pnpm check:release-soak` 校验，且完整的全新测试轮次已顺利通过所有必需的测试分支。在审批评论中注明受测的提交 SHA、测试运行标识符以及报告位置或结果摘要。批准即代表对测试证据进行了核验；CI 不会主动去检查仅保存在开发者本地机器上的文件。如果测试证据未通过，请拒绝该任务，并在修复候选版本后重新启动发布流程。

代码仓库管理员必须配置 **Settings → Environments → soak-approval → Required reviewers**。仅仅在 YAML 中引用该环境并不会开启必需的人工审查。当前的维护模式允许发布发起人自行审批其运行；管理员绕过机制已被禁用。审批任务与 npm 发布任务相互独立，因此不会为现有的 npm Trusted Publisher 配置增加环境要求。手动执行发布恢复同样遵循该门禁。

# 开发命令

在执行 `pnpm install --frozen-lockfile` 之后，在代码库根目录下运行以下命令。公开的相关包位于 `packages/*` 目录下；Storybook 应用、共享工具链、语料库与基准测试工作区属于私有工作区。各脚本按功能划分定义在根目录的 `package.json` 中。

<span id="everyday-development"></span>

## 日常开发

| 命令                                          | 适用范围与前置要求                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `pnpm storybook`                              | 使用工作区源码启动 React、Vue 及组合入口。无需预先构建相关包。                                |
| `pnpm storybook:react` / `pnpm storybook:vue` | 启动单一渲染器的组件目录。                                                                    |
| `pnpm build`                                  | 构建全部六个公开相关包并执行其分发断言。不包含 Storybook 和基准测试应用。                     |
| `pnpm lint` / `pnpm lint:fix`                 | 检查 ESLint 规范 / 自动修复可修复项。                                                         |
| `pnpm format:check` / `pnpm format`           | 检查格式化 / 使用 Prettier 重新格式化文件。                                                   |
| `pnpm typecheck`                              | 同时运行工作区和 Storybook 的类型检查。需先构建相关包。                                       |
| `pnpm typecheck:packages`                     | 递归执行工作区类型检查，包含公开相关包、语料库和基准测试应用。                                |
| `pnpm typecheck:storybook`                    | Storybook 配置、Stories、共享工具链与根目录 Vitest 配置的类型检查。                           |
| `pnpm test:unit`                              | 使用各相关包自身配置递归运行工作区单元测试套件。需先构建相关包。不运行 Storybook 浏览器套件。 |

`test:unit` 会清除 `CORE_SEQUENCE_SEED`、`CORE_SEQUENCE_PATH` 与 `CORE_SEQUENCE_RUNS` 环境变量，使聚合测试门禁使用源码中提交的核心序列预算。若需进行定向重放，请直接使用 core 相关包的测试，具体见[核心测试](core-testing.md)。根目录的 Vitest 配置仍可用于针对性运行，但 CI 和预检会执行 `test:unit`，随后执行独立的 Storybook 套件。

<span id="focused-validation"></span>

## 专项验证

| 命令                          | 验证内容                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check:overrides`        | 工作区依赖覆盖（overrides）配置。                                                                                                     |
| `pnpm check:public-api`       | 构建后的 engine、core 和 Vue 公开类型声明快照与边界规则。需要构建产物；`--update` 可重写快照供审查。这不是针对每个包的 API 快照门禁。 |
| `pnpm test:core-contracts`    | 独立的 core 验证门禁：构建其依赖闭包，检查类型并使用受保护的序列设置运行所有 core 测试。                                              |
| `pnpm test:command-control`   | 预检快速失败行为、构建复用机制及受保护的单元测试设置。                                                                                |
| `pnpm test:soak-control`      | 压测运行器控制逻辑与改动影响分类。不会启动实际压测。                                                                                  |
| `pnpm test:release-control`   | 发布认证与发布控制逻辑。不会发布相关包。                                                                                              |
| `pnpm packcheck`              | 对所有公开相关包分发产物执行 attw 与 publint 检查。需要先完成构建。                                                                   |
| `pnpm test:packed-consumers`  | 打包并在隔离环境中安装相关包，验证运行时与类型入口点。需要构建产物及依赖安装网络访问权限。                                            |
| `pnpm test:document-lifetime` | Chromium 下 React 并发文档所有权与垃圾回收回归测试。                                                                                  |
| `pnpm test:vue-browser`       | Chromium 下 Vue 服务端渲染、水合及浏览器适配器回归测试。                                                                              |

在运行浏览器检查前，请先使用 `pnpm exec playwright install chromium` 安装浏览器。适配器浏览器检查需要已构建的相关包依赖；Vue 检查还会读取其生成的 CSS 样式。

<span id="storybook-validation-and-export"></span>

## Storybook 验证与静态导出

| 命令                                                    | 运行内容                                                                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm test:storybook`                                   | 依次运行 React/Mantine 和 Vue 的浏览器 Story 测试套件。                                                                                          |
| `pnpm test:storybook:react` / `pnpm test:storybook:vue` | 运行单一渲染器的浏览器 Story 测试套件。                                                                                                          |
| `pnpm test:storybook:dev`                               | 进程管理回归测试、开发组合、源码/CSS 热更新与关闭检查。要求端口 6006–6008 保持空闲。该命令会临时修改并还原源文件，请在空闲的代码检出分支上运行。 |
| `pnpm build:storybook`                                  | 构建公开相关包，然后生成组合后的静态站点。                                                                                                       |
| `pnpm build:storybook --skip-build`                     | 复用当前源码已构建的相关包。仅跳过相关包构建，不跳过站点构建。切勿在分发产物陈旧或缺失时使用。                                                   |
| `pnpm test:storybook:site`                              | 验证嵌套部署路径下的现有静态导出，包括导航、Controls 面板与隔离 iframe。                                                                         |

若需导出公开文档，使用 `STORYBOOK_DOCS_EXPORT=1 pnpm build:storybook`。目录结构与部署细节请参阅 [Storybook](storybook.md)。

<span id="full-local-preflight"></span>

## 完整本地预检

```bash
pnpm preflight
```

预检会在遇到第一个失败步骤时立即终止。它会依次检查配置、Lint 与代码格式化；构建一次公开相关包；检查所有类型与公开 API 快照；运行控制与单元测试；验证打包分发产物与外部使用端；运行浏览器 Stories；导出并验证静态站点；验证开发模式；最后运行 React 生命周期与 Vue 浏览器回归测试。

构建、工作区类型检查与单元测试步骤覆盖了与独立 core 门禁相同的核心检查，无需重复构建与重新运行 core。CI 保留了一个独立的纯 core 任务，用于验证该相关包能够独立完成验证。发布验证同样使用共享的单元测试与类型检查命令。

预检需要已安装 Chromium、空闲的 Storybook 端口以及干净的检出状态。它不会安装依赖、修改版本、发布相关包、运行性能基准测试或启动长时间压测。它不能替代发布工作流中的压测决策与批准流程。

<span id="engine-soak"></span>

## 引擎压测（Soak）

| 命令                                               | 用途                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `pnpm check:soak-coverage`                         | 验证压测覆盖映射表。                                                                       |
| `pnpm check:soak-impact`                           | 报告自前一个版本标签以来的改动是否需要压测；支持 `--base` 和 `--head` 参数用于自定义审计。 |
| `pnpm check:release-soak --evidence <run-dir>...`  | 验证干净的发布候选版本，并在需要时验证本地发布的测试证据。                                 |
| `pnpm --filter @ai-markdown/engine soak`           | 启动引擎压测运行器。                                                                       |
| `pnpm --filter @ai-markdown/engine soak:watch`     | 读取压测执行进度。                                                                         |
| `pnpm --filter @ai-markdown/engine soak:aggregate` | 聚合并验证运行结果。                                                                       |
| `pnpm --filter @ai-markdown/engine fuzz:splice`    | 运行专项拼接模糊测试（splice fuzz test）。                                                 |

压测配置与测试证据要求请参阅[压测覆盖](soak-coverage.md)。引擎的 `soak:coverage` 是检查覆盖映射表的本地入口。

<span id="performance-and-versions"></span>

## 性能测试与版本管理

| 命令                              | 用途                                                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `pnpm bench:unit`                 | Vitest 微基准测试；当前为 LaTeX 预处理器。                                                                                   |
| `pnpm bench:web`                  | 生产环境浏览器基准测试场景。                                                                                                 |
| `pnpm bench:web:selftest`         | 验证浏览器基准测试套件本身。                                                                                                 |
| `pnpm bench:web:scale`            | 文档规模伸缩性测试，每 24 个字符推送一次。                                                                                   |
| `pnpm bench:web:scale:cold`       | 文档规模伸缩性测试，单次完整更新。                                                                                           |
| `pnpm bench:web:scale:steps`      | 文档规模伸缩性测试，固定 100 次更新。                                                                                        |
| `pnpm version-packages <version>` | 重写根目录和五个统一版本发布相关包的版本及相关引用。高亮插件保持独立版本。该命令不会发布；执行后需同步 lockfile 并进行审查。 |

在解读性能测试结果前，请参阅[浏览器基准测试指南](../../../../benchmarks/README.md)。实际的 npm 发布属于发布工作流的职责范畴。

<span id="compatibility-aliases"></span>

## 兼容别名

现有命令仍受支持。新文档和 CI 使用以下规范名称：

| 现有命令              | 规范命令              |
| --------------------- | --------------------- |
| `build-storybook`     | `build:storybook`     |
| `test:storybook-dev`  | `test:storybook:dev`  |
| `test:storybook-site` | `test:storybook:site` |
| `bench`               | `bench:unit`          |

`typecheck` 现已覆盖工作区与 Storybook。使用 `typecheck:storybook` 可限定在旧的较窄范围。根目录不提供有歧义的 `test` 别名：请明确选择单元测试、Storybook、适配器或完整预检。

<span id="stable-v3-compatibility"></span>

## 稳定版 v3 兼容性

`pnpm test:vue-browser:compat` 会在 Firefox 与 WebKit 下运行 Vue 的水合、引用、自定义、平滑流式、光标和卸载契约。请使用 `pnpm exec playwright install firefox webkit --with-deps` 安装它们。Chromium 命令保留了额外的强制 GC 压力检查。CI 和 Release 还在 Node 20.19.0、22.12.0 和 24.20.0 上运行打包使用端测试；前两者为声明的运行时最低版本要求。这些任务在工作区外使用真实的 tarball 包执行。

# 核心契约与状态序列验证

`@ai-markdown/core` 是一个独立的、框架中立的相关包，其测试用例与实现代码存放在一起。引擎的六阶段压测（soak）验证了解析算法，但并不能替代对核心状态、缓存、发布机制或清理逻辑的检查。同样，该验证门禁并不证明 React/Vue DOM 行为、水合（hydration）或宿主生命周期的正确性，这些仍需要适配器层自身的测试来保障。

<span id="running-the-gate"></span>

## 运行验证门禁

在代码库根目录下运行：

```bash
pnpm install --frozen-lockfile
pnpm test:core-contracts
```

该命令会构建 core 及其工作区依赖项，检查 core 的 TypeScript 类型，并运行 core 的所有测试。它不需要预先构建 React/Vue 相关包，也不需要加载根目录的 Storybook 项目。测试还会直接运行实际的 ESM/CJS 开发与生产入口，无需依赖 UI 框架或浏览器全局对象。

独立的验证门禁在专用的 `core-contracts` CI 任务中执行。根目录的 `preflight` 预检与 Release 工作流通过共享的相关包构建、工作区类型检查和 `test:unit` 步骤覆盖相同的检查，无需重复构建或测试 core。聚合单元测试命令同样会保护序列设置。任何非零退出码都会导致验证失败。完整命令清单请参阅[开发命令](development-commands.md)。

<span id="coverage-ownership"></span>

## 测试覆盖职责归属

| Core 模块                           | 核心内部的主要测试                                        | 验证的契约内容                                                                  |
| ----------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `pipelineSession`                   | `runtime.test.ts`、`stateSequences.test.ts`               | 增量与全量等价性、追加与替换、配置与文档切换、重置、单次解析、失败后的恢复机制  |
| `blockPlan` / `blockPlanner`        | `blockPlan.test.ts`、`blockPlanner.test.ts`、状态序列测试 | 块/引用上下文、指纹、六种插件配置、保留前缀复用、幻影策略变更、与全量规划的对比 |
| `coordinationPreparation`           | `coordinationPreparation.test.ts`                         | 幻影集合、处理器/提取策略、涵盖影响正文输入的贡献标识元组                       |
| `contribution`                      | `runtime.test.ts`、状态序列测试                           | 显式发布、抑制重复提交、定义更新与移除、注册表与注册项变更、策略失效            |
| `aggregateFootnotes`                | `aggregateFootnotes.test.ts`、runtime、状态序列测试       | 顺序排序、重复引用反向链接、孤立项策略、释放后的聚合、输出归属与前缀隔离        |
| `cloneHastForRender`                | `cloneHastForRender.test.ts`                              | 冻结输入、隔离 URL 元数据、按需共享嵌套数据                                     |
| `tailSignal`                        | `tailSignal.test.ts`                                      | MDAST 尾部分类、嵌套下探、排除幻影节点                                          |
| `coordinator` / `smoothCoordinator` | `smoothCoordinator.test.ts`、状态序列测试                 | 轮流调度、完成状态保持、引用计数、延迟释放、通知合并、心跳与最终清理            |
| 公共分发边界                        | `runtime.test.ts`、构建检查                               | 无框架或 DOM 依赖的实际入口；无实现容器的类型声明                               |

此前位于 React 的 blockMemo 测试套件中的纯规划器、协调器、尾部推导以及块规划/指纹测试，现已归入 core 中。React 保留了渲染缓存、组件输出、聚合脚注组件以及尾部 DOM 标记测试，用于验证适配器集成。ReactNode 缓存测试不应仅仅为了简化目录归属而移入 core。

<span id="fixed-seed-state-combinations"></span>

## 固定种子状态组合测试

`stateSequences.test.ts` 使用三个默认随机种子：`20260909`、`20260910` 和 `20260911`。每个种子驱动三个属性测试，每个属性生成 24 个序列，每个序列包含 24–48 个随机操作。强制操作前缀可以防止测试序列完全跳过主要状态维度。贡献与聚合属性测试设有每种子 30 秒的超时时间，因为它们在每次操作后都会重建两个注册表；其他测试保持正常的超时设置。这是一个有边界的正确性验证预算，不是性能阈值，不会削减种子数量、序列数量或操作数量。

1. **流水线 / 规划器**：交错执行追加、替换、配置/文档切换、重置和单次解析。将每一帧与独立的引擎全量解析进行对比，然后将保留的规划器与完整的 `buildBlocks` 规划进行比对。
2. **贡献 / 聚合**：在两个注册表之间更新三个片段，移除定义，切换文档，注销/重新注册片段，以及替换流水线配置。在每一步将持久化发布与全新注册表、全量解析和新发布器进行对比。同时断言重复提交不会导致版本递增，释放操作会清空注册表状态与标签。
3. **轮流呈现协调器**：与仅包含顺序、引用计数和已完成集合的独立参考模型进行比对。检查前序阻塞、重复注册、完成、释放以及微任务内的重新激活。最后验证状态是否为空，已取消订阅的观察者不会再收到通知。

重建对比主要用于检测跨帧的陈旧状态和失效处理失误。如果纯聚合算法的两种使用方式存在共同缺陷，这类对比可能无法察觉，因此编号、反向链接和所有权还配有独立断言和明确的预期结果。这既不是 Markdown/状态序列的穷尽测试，也不是长时运行的内存压力测试。

<span id="reproducing-failures-and-extending-coverage"></span>

## 复现失败用例与扩展覆盖

fast-check 失败时会报告种子、收缩路径（shrink path）和最小化操作序列。请先构建构建产物，然后使用失败时给出的参数进行重现。仅将收缩路径应用于对应的属性：

```bash
CORE_SEQUENCE_SEED=20260909 CORE_SEQUENCE_RUNS=24 CORE_SEQUENCE_PATH='replace-with-reported-path' \
  pnpm --filter @ai-markdown/core exec vitest run src/stateSequences.test.ts \
  -t 'contribution/aggregate'
```

移除 `CORE_SEQUENCE_PATH` 可以重跑整个种子的测试。增加 `CORE_SEQUENCE_RUNS` 可以进行更大规模的本地测试。正式验证门禁会清除这三个环境变量，始终使用源码中提交的默认值，防止开发者的本地调试设置无意中降低 CI 覆盖力度。

在添加公共状态或缓存依赖时，请补充对应的操作和显式断言。新增模块时需同步更新覆盖表。本处未列出具体的测试覆盖率百分比：测试证据由行为契约和断言组成，尚未生成行/分支覆盖率报告。

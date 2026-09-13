# 版本发布指南

本指南描述当前的标准发布工作流。有关最初的稳定版晋级及其特定审查例外，请参阅 [3.0 发布验收记录](releasing-3.0.md)。历史上的例外处置不构成未来发布的授权依据。

<span id="prepare-a-version"></span>

## 准备发布版本

确定下一个版本号，设置 `NEXT_VERSION`，然后更新包清单与 lockfile：

```bash
pnpm version-packages "${NEXT_VERSION:?Set NEXT_VERSION to the intended release version}"
pnpm install
```

审查完整的变更 diff，包括相关包的对等依赖范围与当前文档。在 `release-highlights.md` 中的 `### <version>` 标题下补充发布说明：发布工作流会自动提取该段落，直到下一个三级标题为止。在更新当前指南时，请完整保留历史版本的说明。

<span id="candidate-acceptance"></span>

## 候选版本验收

每次发布都必须使用全新的版本号与 Git 标签。在验证候选版本之前，必须先更新相关包版本、lockfile 与当前文档；已发布的版本与 Git 标签具有不可变性。

1. 在最终源码上运行 `pnpm preflight`。它覆盖了构建、Lint、代码格式化、类型声明、单元与控制测试、tarball 打包、使用端集成、Storybook 以及浏览器/生命周期检查。
2. 确保 CI 测试全部通过，包括打包使用端的 Node 矩阵测试与 core 契约任务。
3. 提交干净的候选版本并运行 `pnpm check:soak-impact`。当引擎变动影响需要进行压测时，请遵循[压测覆盖与审批](soak-coverage.md)，并使用 `pnpm check:release-soak --evidence .soak-logs/<run-id>` 验证其测试证据。当前发布配置覆盖全部六个测试分支与 84 项逻辑任务。
4. 为验证通过的版本打上 Git 标签。发布工作流必须通过自动化验证，并在需要时通过人工 `soak-approval` 审查。妥善留存已审查的测试证据。
5. 对现有相关包采用 Trusted Publishing。预发布版本推送到对应的 `beta` 或 `rc` 渠道；稳定发布版本推送到 `latest`。独立插件遵循自身的版本号与分发渠道。对于现有包，保持引导认证（bootstrap authentication）处于关闭状态。
6. 发布完成后必须执行注册表与使用端验证。工作流在创建 GitHub Release 之前会归档其验证报告；只读验证工作流可对现有发布重新执行检查。

本地测试通过并不能替代远程 CI、已发布产物验证或必要的人工审查。在测试运行与证据标识符生成后，请如实记录其实际 URL 与标识。

<span id="promote-a-candidate"></span>

## 晋级候选版本

将已发布的候选版本安装到具有代表性的 React、Mantine 和 Vue 应用程序中，记录运行时版本、SSR/水合以及流式输出结果，并预留充分的反馈观察期。首先解决候选版本中暴露的回归问题，确定新的稳定版本号，更新统一版本发布与集成对等依赖范围，并验证生成的 tarball 包。针对最终提交的候选版本重新评估压测影响。稳定发布使用 npm `latest` 渠道并创建非预发布的 GitHub Release。保留现有的标签与构建产物；对于已发布产物中的缺陷，应通过发布新的补丁版本或候选版本来修复。

<span id="repeatable-published-artifact-verification"></span>

## 可复现的已发布产物验证

在发布之后，发布工作流会在创建 GitHub Release 之前运行 `pnpm test:published-release "$RELEASE_TAG"`。它会下载 npm 构建产物并在工作区外部进行安装，复用打包使用端探测机制来验证 ESM/CJS、开发条件导出、React/Mantine/Vue SSR、CSS、类型声明、私有 API 边界以及 Vue 3.5.0 的正常使用。稳定版统一版本发布验证还会不带版本锁定地安装所有包，并验证 npm 是否解析并选中了预期的发布版本。RC 验证使用精确构建产物，并检查预发布渠道而不会变动 `latest` 指向。

将 `RELEASE_TAG` 设置为一个现有的 Git 标签（其预期的 npm 渠道仍指向该版本），然后运行：

```bash
pnpm test:published-release "${RELEASE_TAG:?Set RELEASE_TAG to an existing release tag}" .local-notes/published-release
```

独立相关包发布会检查自身的元数据与溯源信息，并与该标签下记录的发布版本一同进行测试。

请使用现有标签以及包含完整 Git 历史的代码检出。对于这些注册表检查，不需要在本地构建工作区或安装依赖项。Node 版本必须满足相关包的 engine 范围要求；系统中必须安装并可用 `npm`、`pnpm`、`git` 和 `tar`。独立插件的版本直接读取自该标签下的 package.json，而非硬编码版本。GitHub 的 `Verify published release` 工作流为现有标签提供了相同的只读检查，无需执行发布操作，也无需压测批准。

验证流程会检查 npm 渠道、依赖项与 engine 元数据、tarball SHA-512，以及溯源仓库、工作流、源码标签、提交 SHA 与 tarball 主题。这属于溯源**内容与源码一致性**验证，而非加密 Sigstore 签名校验。复用的插件版本与发布重试会保留其原始溯源调用；原始源码必须是祖先提交且相关包实现源码未发生变更。独立版本发布的插件在复用其现有构建产物时允许顶层 README 存在差异；实现变更仍必须升级版本。统一版本发布相关包还额外要求包清单与 lockfile 输入保持不变。切勿要求复用的构建产物包含当前工作流运行的名称。

注册表可见性检查最多重试 12 次，每次尝试间隔 5 秒，单次请求超时时间为 30 秒。持续不匹配会导致验证失败。生成的 JSON 报告会记录目标 SHA、Node 版本、源码调用、哈希值与测试结果（包括失败时的部分结果）。CI 会将其归档为 `published-release-verification`。重试操作可以验证已有的上传内容，并保留已发布的 GitHub Release 完整无损。在恢复未完成的上传时，请从发布标签运行发布工作流，以使新的溯源记录该标签；切勿移动已有标签或覆盖已发布的 npm 版本。历史审计要求预期渠道仍指向该版本；一旦后续的新发布推进了渠道指向，较早的历史审计会按预期在渠道检查项上报错失败。

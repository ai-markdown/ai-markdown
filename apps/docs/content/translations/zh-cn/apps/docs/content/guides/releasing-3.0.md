# 3.0 版本发布验收记录

**历史记录**：本页面记录了最初 `3.0.0` 版本晋级及其验收测试证据。当前标准发布流程请参阅[版本发布指南](releasing.md)。在该次版本晋级中，engine、core、React、React/Mantine 以及 Vue 均以 `3.0.0` 版本发布到 npm `latest` 渠道；独立版本发布的高亮插件版本为 `1.0.2`。这并不代表当下的 npm 渠道状态。后续版本的更新情况请参阅[版本更新亮点](release-highlights.md)。[稳定发布版本](https://github.com/ai-markdown/ai-markdown/releases/tag/v3.0.0)及其[发布工作流](https://github.com/ai-markdown/ai-markdown/actions/runs/34494100859)已成功执行完毕。精确版本安装与默认 npm 安装均通过了已发布使用端检查。

<span id="compatibility-contract"></span>

## 兼容性契约

- 公开 Node 使用端要求 `^20.19.0 || >=22.12.0`。早期 Node 20 版本在 CJS 输出加载 ESM 依赖项时会报错。CI 在打包后的使用端环境中对 Node 20.19.0、22.12.0 和 24.20.0 进行了完整测试。
- React 需要 React 19；Vue 需要 `^3.5.0`。Mantine 集成遵循其声明的对等依赖范围，且仅适用于 React。打包使用端测试在工作区外部验证了 ESM/CJS、类型声明、样式表以及 React/Mantine/Vue 服务端渲染（SSR）。
- 类型声明快照覆盖 engine、core、React、React 插件、Mantine 与 Vue。已记录的公开契约自 3.0.0 起遵循语义化版本规范；破坏性变更需要升级主版本。
- Vue 浏览器测试套件覆盖 Chromium、Firefox 与 WebKit 环境下的水合、引用、更新、平滑流式、光标排版与卸载。强制 GC 生命周期断言仍仅在 Chromium 下运行。这并不代表支持 Nuxt、KeepAlive 或 Suspense。

<span id="candidate-acceptance"></span>

## 候选版本验收

请使用[当前候选版本验收流程](releasing.md#candidate-acceptance)。已完成的 3.0.0 正式发布切勿重新发布。

<span id="stable-promotion"></span>

## 晋级稳定版

RC 晋级至 3.0.0 的流程已完成。相对于 `3.0.0-rc.1`，稳定版的改动仅限于版本元数据、稳定对等依赖范围与文档更新。运行时源码未发生任何改动。在该次晋级中，Mantine 声明 React 适配器对等依赖为 `^3.0.0`；core 和 engine 保持为严格的统一版本发布依赖。

对于后续的版本晋级，请遵循[版本发布指南](releasing.md#promote-a-candidate)。

<span id="recorded-rc-acceptance-and-review-exception"></span>

## 记录的 RC 验收与审查例外

全新的测试轮次 `rc1-acceptance-20260910T102525Z-e575f03` 在随机种子 `202689100` 下测试了干净的提交 “chore(release): prepare 3.0.0-rc.1 compatibility gates”，涵盖全部 84 项测试任务。该轮测试耗时 10,917 秒全部通过，且 `repositoryChanged: false`。原始测试报告完整保存在维护者的本地归档中。

提交 “fix(soak): normalize terminal colors before checking verdicts” 修复了证据聚合器中的 ANSI 字符规范化问题，并补充了带颜色判定结果的回归测试。在该候选版本下，全部 37 项压测控制测试均顺利通过。修复后的聚合器原封不动地接受了原始测试报告，但由于聚合器机制发生了变动，严格的候选版本覆盖门禁仍判定祖先提交的测试证据无效。

2026-09-10，维护者通过人工审查明确批准接受该祖先测试轮次的证据。由于替代测试运行被中断，未能生成有效测试证据。这是一次专门针对 ANSI 判定解析修复的特定例外处置；它并未变更未来的改动影响规则，也未变更所需的审查环境配置。

在通过人工审查后，[RC 发布工作流](https://github.com/ai-markdown/ai-markdown/actions/runs/34491579512)成功执行完成。全部五个 `3.0.0-rc.1` 相关包与插件 `1.0.2` 均通过 OIDC 完成发布。已发布的 tarball 包顺利通过完整性与溯源一致性检查、ESM/CJS、React/Mantine/Vue SSR、CSS、类型声明以及 Vue 3.5.0 的安装使用测试。随后的稳定版工作流顺利完成了 `3.0.0` 的发布与验证。

<span id="repeatable-published-artifact-verification"></span>

## 可复现的已发布产物验证

请使用[当前验证流程](releasing.md#repeatable-published-artifact-verification)。当新版本推进了渠道指向后，旧版本的标签在执行渠道检查时会按预期失败。

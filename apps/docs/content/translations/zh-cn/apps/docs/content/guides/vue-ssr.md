# Vue SSR 与生命周期

Vue 适配器支持基于 Vue `^3.5.0` 的服务端渲染（SSR）与客户端水合（Hydration）。在服务端渲染与首次客户端渲染中，必须使用相同的初始内容与应用程序组件结构。Vue 的 `useId()` 提供了应用局部唯一的 ID，能够在跨服务端与客户端边界时保持一致匹配。

<span id="what-the-server-renders"></span>

## 服务端渲染机制

服务端采用全量解析模式并渲染出真实的 Vue VNode 树。它不会通过 `v-html` 或 `innerHTML` 注入 Markdown 解析结果。平滑流式组件在服务端会完整渲染其初始内容；组件仅在客户端挂载完成后，才开始对后续追加的新增内容进行动画播放。

在 SSR 渲染以及首帧水合渲染期间，文档贡献（document contributions）既不会被注册，也不会被发布。每个片段在初始阶段仅包含局部的引用和脚注。跨片段的引用解析仅在挂载阶段完成贡献提交（commit）后才会开始。当仅在服务端运行且需要完整解析文档内所有全局定义时，请使用单一渲染器传入完整源内容进行解析。

<span id="own-state-at-the-right-lifetime"></span>

## 在正确的生命周期内管理状态

在 `setup` 期间调用平滑流式的组合式函数（composables）时，应传入包裹实时状态的 getter 函数。适配器在组件挂载时创建浏览器控制器与监听器（watchers），并在组件卸载时释放它们。光标观察器（cursor observers）与浏览器动画帧（animation frames）同样会在组件卸载时释放。

对于属于同一逻辑片段的内容请使用稳定的组件 key，而对于新一轮跨片段协调则使用新的组件实例。文档切换时会主动释放先前的注册状态。请将应用持有的可变文档状态限制在单次请求或持有该状态的组件内部，不要在并发 SSR 请求之间共享。

如果围绕 core 构建底层封装，请将语法树（trees）、注册表（registries）与协调器（coordinators）存放在 Vue 的浅层引用（shallow refs / `shallowRef`）中。深层响应式代理（deep reactive proxies）会改变对象引用，影响共享层对引用稳定性的判断。详细机制请参阅 [Core 与 Engine 契约](api/core-engine-contracts.md)。

<span id="supported-integration-evidence"></span>

## 验证范围与支持依据

代码库测试套件覆盖了在 Chromium、Firefox 与 WebKit 上的独立水合、文档引用与文档切换、自定义渲染、平滑等待/排空以及光标行为。有界内存占用与强制垃圾回收（forced-GC）检查属于 Chromium 专属测试。构建打包后的独立使用测试在工作区外部对 ESM/CJS、类型声明、CSS 和服务端渲染进行了端到端验证。

这些验证并不等同于对 Nuxt 专属打包方案或 KeepAlive/Suspense 复合特性的支持保证。在将这些特定集成形态视为受支持之前，需要补充针对性测试。具体的执行命令与精确测试范围请参阅 [Vue 验证参考](../reference/vue.md#verification-and-scope)。

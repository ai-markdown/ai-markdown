# 开发框架适配器

Core 与 Engine 提供无 React/Vue 依赖的解析和协调；宿主负责框架转换、生命周期、样式、订阅与 DOM 测量。

## 从独立会话开始

为每个独立 Markdown 单元建立一个 host，安装匹配版本的 core/engine。下面的函数返回渲染用 HAST，不发布文档贡献，也不创建 DOM。

```bash
pnpm add @ai-markdown/core @ai-markdown/engine unist-util-visit
```

```ts
import { cloneHastForRender, createPipelineSession } from '@ai-markdown/core';
import {
  buildCoreRemarkPlugins,
  buildCoreRehypePlugins,
  buildCoreRemarkRehypeOptions,
  buildTransform,
  defaultEnginePlugins,
  defaultUrlTransform,
  preprocessAIMDContent,
  sanitizeSchema,
} from '@ai-markdown/engine';
import { visit } from 'unist-util-visit';

export function createMarkdownHost(documentId: string, clobberPrefix: string) {
  const session = createPipelineSession();
  const remarkPlugins = buildCoreRemarkPlugins(defaultEnginePlugins);
  const rehypePlugins = buildCoreRehypePlugins(sanitizeSchema, clobberPrefix);
  const remarkRehypeOptions = buildCoreRemarkRehypeOptions(true);
  const targetPhantoms = { missingFootnotes: new Set<string>(), missingLinks: new Set<string>() };
  const transform = buildTransform({
    urlTransform: defaultUrlTransform,
    allowedElements: undefined,
    disallowedElements: undefined,
    allowElement: undefined,
    skipHtml: true,
    unwrapDisallowed: undefined,
  });

  return {
    render(source: string, incrementalParse = false) {
      const trees = session.parse({
        content: preprocessAIMDContent(source),
        targetPhantoms,
        remarkPlugins,
        rehypePlugins,
        remarkRehypeOptions,
        preserveForBodyHarvest: false,
        documentId,
        provenance: 'standalone-example',
        incrementalParse,
        defListEnabled: true,
      });
      const tree = cloneHastForRender(trees.hast);
      visit(tree, transform);
      return tree;
    },
    reset() {
      session.reset();
    },
  };
}
```

为文档提供稳定、唯一且可用于属性的 clobberPrefix；服务端与水合保持同一身份。示例中的固定 provenance 只适用于独立路径，协调适配器需要每实例凭据，并让验证器与处理器一致使用它。

## 树的所有权

默认完整解析适合 SSR，客户端保留 host 后可选择增量帧。修改策略时重置状态，配置未变化时保持插件和 schema 身份稳定。会话拥有解析树，渲染修改前克隆；任意嵌套插件数据不保证完全复制。

块规划是可选的。React 使用块缓存，Vue 转换整帧树。缓存有效性还取决于引用、位置、URL 策略与组件身份。

## 协调生命周期

准备阶段只推导目标、解析和规划。commit/mount 后注册、订阅并发布已提交贡献；跨片段目的地址经共享解析器清洗与重写。末尾合格片段生成汇总脚注，不修改共享正文。

文档切换或卸载必须退订并配对释放注册、平滑成员。服务器请求之间不共享可变状态。独立示例不包含此协调实现。

## 验证宿主

测试追加、替换、策略变化、晚到定义、文档切换与卸载。额外运行真实 SSR/水合、浏览器光标与打包使用方检查。引擎等价性测试不能证明转换器和宿主生命周期正确。

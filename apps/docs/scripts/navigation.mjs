// Reader-facing navigation is shared by both locales. Slugs remain stable.
function page(slug, label, chinese) {
  return { slug, label, translations: { 'zh-CN': chinese } };
}

export const sidebar = [
  {
    label: 'Getting started',
    translations: { 'zh-CN': '开始使用' },
    collapsed: false,
    items: [
      page('docs', 'Introduction', '介绍'),
      page('docs/guides/getting-started', 'Installation', '安装与选择框架'),
      page('docs/guides/react-quick-start', 'React quick start', 'React 快速开始'),
      page('docs/guides/vue-quick-start', 'Vue quick start', 'Vue 快速开始'),
      page('docs/guides/react-mantine-quick-start', 'Mantine quick start', 'Mantine 快速开始'),
      page('docs/examples', 'Playgrounds & examples', '交互示例'),
      page('docs/guides', 'Find a guide', '按任务查找'),
    ],
  },
  {
    label: 'Streaming',
    translations: { 'zh-CN': '流式体验' },
    collapsed: false,
    items: [
      page('docs/guides/streaming-input', 'Input & completion', '输入与完成状态'),
      page('docs/guides/streaming-chat-example', 'React chat recipe', 'React 流式聊天'),
      page('docs/guides/smooth-streaming', 'React smooth streaming', 'React 平滑输出'),
      page('docs/guides/streaming-cursor', 'React streaming cursor', 'React 流式光标'),
      page('docs/guides/vue-streaming', 'Vue streaming', 'Vue 流式输出'),
      page('docs/guides/documents-and-references', 'Shared documents & references', '文档与共享引用'),
      page('docs/guides/cross-chunk-coordination', 'React document coordination', 'React 文档协调'),
      page('docs/guides/vue-documents', 'Vue document coordination', 'Vue 文档协调'),
    ],
  },
  {
    label: 'Content & styling',
    translations: { 'zh-CN': '内容与样式' },
    collapsed: true,
    items: [
      page('docs/guides/configuration', 'Configure rendering', '配置渲染'),
      page('docs/guides/markdown-features', 'Markdown syntax', 'Markdown 语法'),
      page('docs/guides/cjk-typography', 'CJK & mixed-language text', '中日韩与混合排版'),
      page('docs/guides/content-preprocessors', 'Content preprocessing', '内容预处理'),
      page('docs/guides/rich-components', 'Code, diagrams, images & tables', '代码块、图表、图片与表格'),
      page('docs/guides/custom-components', 'React custom components', 'React 自定义组件'),
      page('docs/guides/custom-typography', 'React typography', 'React 排版'),
      page('docs/guides/design-tokens', 'React CSS variables', 'React CSS 变量'),
      page('docs/guides/vue-customization', 'Vue components & styles', 'Vue 组件与样式'),
      page('docs/guides/url-sanitization', 'Links & HTML safety', '链接与 HTML 安全'),
    ],
  },
  {
    label: 'Integrations & performance',
    translations: { 'zh-CN': '集成与性能' },
    collapsed: true,
    items: [
      page('docs/guides/mantine-code-blocks', 'Mantine code & diagrams', 'Mantine 代码块与图表'),
      page('docs/guides/react-ssr', 'React SSR & hydration', 'React SSR 与水合'),
      page('docs/guides/vue-ssr', 'Vue SSR & lifecycle', 'Vue SSR 与生命周期'),
      page('docs/guides/rendering-and-performance', 'Rendering costs', '渲染开销'),
      page('docs/guides/streaming-and-performance', 'React incremental rendering', 'React 增量渲染'),
    ],
  },
  {
    label: 'API reference',
    translations: { 'zh-CN': 'API 参考' },
    collapsed: true,
    items: [
      page('docs/react', 'React components', 'React 组件'),
      page('docs/guides/api/react-props', 'React props', 'React 属性'),
      page('docs/guides/api/react-hooks', 'React hooks & providers', 'React Hooks 与 Provider'),
      page('docs/guides/metadata-context', 'React metadata', 'React 元数据'),
      page('docs/guides/typescript-generics', 'React TypeScript types', 'React TypeScript 类型'),
      page('docs/vue', 'Vue API', 'Vue API'),
      page('docs/react/mantine', 'Mantine API', 'Mantine API'),
      page('docs/guides/api-conventions', 'API stability & conventions', 'API 稳定性与约定'),
    ],
  },
  {
    label: 'Help & upgrades',
    translations: { 'zh-CN': '排查与升级' },
    collapsed: true,
    items: [
      page('docs/guides/troubleshooting', 'Troubleshooting', '常见问题排查'),
      page('docs/guides/framework-transition', 'Package migration', '包名迁移'),
      page('docs/guides/migrating-to-v2', 'Upgrade from 1.x', '从 1.x 升级'),
      page('docs/guides/release-highlights', 'Release notes', '版本更新'),
    ],
  },
  {
    label: 'Build an integration',
    translations: { 'zh-CN': '开发集成' },
    collapsed: true,
    items: [
      page('docs/core', 'Core API', 'Core API'),
      page('docs/engine', 'Engine API', 'Engine API'),
      page('docs/guides/api/core-engine-contracts', 'Core & Engine contracts', 'Core 与 Engine 契约'),
      page('docs/guides/building-an-adapter', 'Framework adapters', '开发框架适配器'),
      page('docs/guides/extending-via-subpackage', 'React integrations', '开发 React 集成'),
      page('docs/plugins/highlight', 'Standalone highlight plugin', '独立高亮插件'),
      page('docs/plugins/code-language-detector', 'Code language detector', '代码语言探测器'),
    ],
  },
  {
    label: 'Contributing',
    translations: { 'zh-CN': '参与贡献' },
    collapsed: true,
    items: [
      page('docs/guides/development-commands', 'Development commands', '开发命令'),
      page('docs/guides/architecture', 'Architecture', '内部架构'),
      page('docs/guides/documentation-site', 'Documentation & deployment', '文档维护与部署'),
      page('docs/guides/storybook', 'Storybook development', 'Storybook 开发'),
      page('docs/guides/benchmarking', 'Run benchmarks', '运行性能测试'),
      page('docs/guides/core-testing', 'Core tests', 'Core 测试'),
      page('docs/guides/soak-coverage', 'Soak coverage', '压测覆盖'),
      page('docs/guides/releasing', 'Release process', '发布流程'),
      page('docs/guides/releasing-3.0', '3.0 release archive', '3.0 发布验收档案'),
      page('docs/guides/benchmark', 'Historical measurements', '历史性能记录'),
    ],
  },
];

const links = new Map(sidebar.flatMap((group) => group.items).map((item) => [item.slug, item]));

// Keep each framework tutorial on its own reading path instead of advancing
// from the React quick start directly into the Vue quick start.
const paths = {
  docs: [false, 'docs/guides/getting-started'],
  'docs/guides/getting-started': ['docs', 'docs/guides'],
  'docs/guides/react-quick-start': ['docs/guides/getting-started', 'docs/guides/streaming-chat-example'],
  'docs/guides/streaming-chat-example': ['docs/guides/react-quick-start', 'docs/guides/smooth-streaming'],
  'docs/guides/smooth-streaming': ['docs/guides/streaming-chat-example', 'docs/guides/streaming-cursor'],
  'docs/guides/streaming-cursor': ['docs/guides/smooth-streaming', 'docs/guides/custom-components'],
  'docs/guides/vue-quick-start': ['docs/guides/getting-started', 'docs/guides/vue-streaming'],
  'docs/guides/vue-streaming': ['docs/guides/vue-quick-start', 'docs/guides/vue-customization'],
  'docs/guides/vue-customization': ['docs/guides/vue-streaming', 'docs/guides/vue-ssr'],
  'docs/guides/vue-ssr': ['docs/guides/vue-customization', 'docs/vue'],
  'docs/guides/react-mantine-quick-start': ['docs/guides/getting-started', 'docs/guides/mantine-code-blocks'],
  'docs/guides/mantine-code-blocks': ['docs/guides/react-mantine-quick-start', 'docs/react/mantine'],
  'docs/guides/custom-components': ['docs/guides/streaming-cursor', 'docs/guides/custom-typography'],
  'docs/guides/custom-typography': ['docs/guides/custom-components', 'docs/guides/design-tokens'],
};

export function readingNavigation(slug, locale, base = '/') {
  const canonical = locale ? slug.replace(`${locale}/`, '') : slug;
  const path = paths[canonical];
  if (!path) return {};
  const link = (target) => {
    if (target === false) return false;
    const item = links.get(target);
    if (!item) throw new Error(`Unknown reading-path target: ${target}`);
    return {
      label: locale === 'zh-cn' ? item.translations['zh-CN'] : item.label,
      link: `${base}${locale ? `${locale}/` : ''}${target}/`,
    };
  };
  return { prev: link(path[0]), next: link(path[1]) };
}

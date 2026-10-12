// @vitest-environment jsdom
//
// Every supplied component takes its own `labels`. The defaults are English;
// these tests replace them and check what is on screen.
import { afterEach, expect, test, vi } from 'vitest';
import { createApp, h, nextTick, ref, type App, type VNode } from 'vue';
import { AIMarkdown } from '../AIMarkdown';
import { createMarkdownCodeBlock } from './code';
import { createMarkdownImage } from './image';
import { createMarkdownTable } from './table';

const mermaidMock = vi.hoisted(() => ({ maxTextSize: undefined as number | undefined }));
vi.mock('mermaid', () => {
  const siteConfig = () => ({
    securityLevel: 'strict',
    theme: 'base',
    darkMode: false,
    suppressErrorRendering: true,
    maxTextSize: mermaidMock.maxTextSize,
  });
  return {
    default: {
      initialize: () => {},
      // No text of its own: the label has to supply it.
      parse: () => Promise.reject(new Error('')),
      render: () => Promise.reject(new Error('')),
      mermaidAPI: { getSiteConfig: siteConfig, getConfig: siteConfig },
    },
  };
});

// jsdom has the dialog element but not its modal methods.
HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
  this.removeAttribute('open');
};

let app: App | undefined;
let container: HTMLElement | undefined;
afterEach(() => {
  app?.unmount();
  container?.remove();
  app = container = undefined;
  mermaidMock.maxTextSize = undefined;
});

const settle = async () => {
  for (let i = 0; i < 8; i++) await nextTick().then(() => Promise.resolve());
};
const show = async (render: () => VNode) => {
  const scope = (container = document.createElement('div'));
  document.body.append(scope);
  app = createApp({ render });
  app.mount(scope);
  await settle();
  return scope;
};
const markdown = (content: string, props: Record<string, unknown>) =>
  h(AIMarkdown, { content, streamingCursor: false, ...props });

test('code block: the toolbar uses the supplied text, and a function follows reactive state', async () => {
  const language = ref('zh');
  const Code = createMarkdownCodeBlock({
    renderers: { demo: { render: () => h('output', 'preview') } },
    labels: () =>
      language.value === 'zh'
        ? {
            actions: '代码块操作',
            plainText: '纯文本',
            copy: '复制代码',
            showSource: '显示源码',
            showPreview: '显示预览',
            collapse: '收起',
          }
        : {},
  });
  const scope = await show(() => markdown('```demo\nx\n```\n\n```\n?\n```', { components: { pre: Code } }));
  const toolbars = [...scope.querySelectorAll('.aimd-toolbar')];
  expect(toolbars[0].getAttribute('aria-label')).toBe('代码块操作');
  expect([...toolbars[0].querySelectorAll('button')].map((button) => button.textContent)).toEqual([
    '复制代码',
    '显示源码',
    '收起',
  ]);
  expect(toolbars[1].querySelector('span')?.textContent).toBe('纯文本');
  toolbars[0].querySelectorAll('button')[1].click();
  await settle();
  expect(toolbars[0].querySelectorAll('button')[1].textContent).toBe('显示预览');
  // The function was read inside the render, so the ref is one of its dependencies.
  language.value = 'en';
  await settle();
  expect([...scope.querySelectorAll('.aimd-toolbar')].map((bar) => bar.querySelector('button')?.textContent)).toEqual([
    'Copy code',
    'Copy code',
  ]);
});

test('diagram: waiting, a failure with no engine text, and an oversized source', async () => {
  const Code = createMarkdownCodeBlock({
    mermaidIntervalMs: 0,
    diagramLabels: {
      waiting: '等待图表…',
      renderFailed: '无法渲染此图表。',
      retry: '重试',
      tooLarge: (length, limit) => `源码 ${length} 个字符，超过上限 ${limit}。`,
    },
  });
  const streaming = ref(true);
  const scope = await show(() =>
    markdown('```mermaid\ngraph TD;\nA-->B;', { streaming: streaming.value, components: { pre: Code } })
  );
  expect(scope.querySelector('.aimd-diagram [role="status"]')?.textContent).toBe('等待图表…');
  streaming.value = false;
  await settle();
  expect(scope.querySelector('.aimd-diagram [role="alert"] p')?.textContent).toBe('无法渲染此图表。');
  expect(scope.querySelector('.aimd-diagram [role="alert"] button')?.textContent).toBe('重试');
  mermaidMock.maxTextSize = 5;
  (scope.querySelector('.aimd-diagram [role="alert"] button') as HTMLButtonElement).click();
  await settle();
  expect(scope.querySelector('.aimd-diagram [role="alert"] p')?.textContent).toBe('源码 17 个字符，超过上限 5。');
});

test('table: the toolbar and the reason an export is refused use the supplied text', async () => {
  const Table = createMarkdownTable({
    labels: {
      actions: '表格操作',
      copy: '复制表格',
      download: '下载 CSV',
      scrollRegion: '可滚动表格',
      mergedCells: '含合并单元格',
    },
  });
  const content = ref('| a | b |\n| - | - |\n| 1 | 2 |');
  const scope = await show(() => markdown(content.value, { components: { table: Table } }));
  expect(scope.querySelector('.aimd-toolbar')?.getAttribute('aria-label')).toBe('表格操作');
  expect([...scope.querySelectorAll('.aimd-toolbar button')].map((button) => button.textContent)).toEqual([
    '复制表格',
    '下载 CSV',
  ]);
  expect(scope.querySelector('.aimd-table-scroll')?.getAttribute('aria-label')).toBe('可滚动表格');
  expect(scope.querySelector('[role="status"]')?.textContent).toBe('');
  // Raw HTML with a merged cell: core reports the code, the component supplies the words.
  content.value = '<table><tr><td colspan="2">x</td></tr></table>';
  await settle();
  expect(scope.querySelector('[role="status"]')?.textContent).toBe('含合并单元格');
  expect((scope.querySelector('.aimd-toolbar button') as HTMLButtonElement).title).toBe('含合并单元格');
});

test('image: the thumbnail uses the supplied text', async () => {
  const Image = createMarkdownImage({
    labels: { loading: '图片加载中…', loadFailed: '图片无法加载。', open: (alt) => `预览图片：${alt}` },
  });
  const scope = await show(() =>
    markdown('![一只猫](https://example.test/cat.png)\n\n![狗](https://example.test/dog.png)', {
      components: { img: Image },
    })
  );
  expect(scope.querySelector('.aimd-image-feedback')?.textContent).toBe('图片加载中…');
  const [cat, dog] = scope.querySelectorAll('img');
  cat.dispatchEvent(new Event('load'));
  dog.dispatchEvent(new Event('error'));
  await settle();
  expect(scope.querySelector('button.aimd-image-trigger')?.getAttribute('aria-label')).toBe('预览图片：一只猫');
  expect(scope.querySelector('.aimd-image-feedback[role="alert"]')?.textContent).toBe('图片无法加载。 狗');
});

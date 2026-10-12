// @vitest-environment jsdom
//
// Every supplied component takes its own `labels`. The defaults are English;
// these tests replace them and check that no default text is left on screen.
import { afterEach, expect, test, vi } from 'vitest';
import { act, createContext, useContext, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
// Imported by package name, like the components themselves, so both share one React context.
import { AIMarkdown } from '@ai-markdown/react';
import { createMarkdownCodeBlock } from './code';
import { createMarkdownImage } from './image';
import { createMarkdownTable } from './table';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

let root: Root | undefined;
let container: HTMLElement | undefined;
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = container = undefined;
  mermaidMock.maxTextSize = undefined;
});

const show = async (ui: ReactNode) => {
  const scope = (container = document.createElement('div'));
  document.body.append(scope);
  root = createRoot(scope);
  const render = async (next: ReactNode) => {
    await act(async () => root!.render(next));
    for (let i = 0; i < 4; i++) await act(async () => {});
  };
  await render(ui);
  return { scope, render };
};

test('code block: the toolbar uses the supplied text, and a function that reads context follows a language switch', async () => {
  // The function runs during render, so it can read the application's i18n context.
  // That also re-renders blocks the Markdown memo would otherwise leave alone.
  const Language = createContext('zh');
  function useCodeLabels() {
    return useContext(Language) === 'zh'
      ? {
          actions: '代码块操作',
          plainText: '纯文本',
          copy: '复制代码',
          showSource: '显示源码',
          showPreview: '显示预览',
          collapse: '收起',
          expand: '展开',
        }
      : {};
  }
  const Code = createMarkdownCodeBlock({
    renderers: { demo: () => <output>preview</output> },
    labels: useCodeLabels,
  });
  const view = (language: string) => (
    <Language.Provider value={language}>
      <AIMarkdown content={'```demo\nx\n```\n\n```\n?\n```'} customComponents={{ pre: Code }} />
    </Language.Provider>
  );
  const { scope, render } = await show(view('zh'));
  const toolbars = [...scope.querySelectorAll('.aimd-toolbar')];
  expect(toolbars[0].getAttribute('aria-label')).toBe('代码块操作');
  expect([...toolbars[0].querySelectorAll('button')].map((button) => button.textContent)).toEqual([
    '复制代码',
    '显示源码',
    '收起',
  ]);
  // The second block has no language and nothing the detector can place.
  expect(toolbars[1].querySelector('span')?.textContent).toBe('纯文本');
  await act(async () => toolbars[0].querySelectorAll('button')[1].click());
  expect(toolbars[0].querySelectorAll('button')[1].textContent).toBe('显示预览');
  await render(view('en'));
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
  const view = (streaming: boolean) => (
    <AIMarkdown content={'```mermaid\ngraph TD;\nA-->B;'} streaming={streaming} customComponents={{ pre: Code }} />
  );
  const { scope, render } = await show(view(true));
  expect(scope.querySelector('.aimd-diagram [role="status"]')?.textContent).toBe('等待图表…');
  await render(view(false));
  expect(scope.querySelector('.aimd-diagram [role="alert"] p')?.textContent).toBe('无法渲染此图表。');
  expect(scope.querySelector('.aimd-diagram [role="alert"] button')?.textContent).toBe('重试');
  mermaidMock.maxTextSize = 5;
  await act(async () => (scope.querySelector('.aimd-diagram [role="alert"] button') as HTMLButtonElement).click());
  for (let i = 0; i < 4; i++) await act(async () => {});
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
  const { scope, render } = await show(
    <AIMarkdown content={'| a | b |\n| - | - |\n| 1 | 2 |'} customComponents={{ table: Table }} />
  );
  expect(scope.querySelector('.aimd-toolbar')?.getAttribute('aria-label')).toBe('表格操作');
  expect([...scope.querySelectorAll('.aimd-toolbar button')].map((button) => button.textContent)).toEqual([
    '复制表格',
    '下载 CSV',
  ]);
  expect(scope.querySelector('.aimd-table-scroll')?.getAttribute('aria-label')).toBe('可滚动表格');
  expect(scope.querySelector('[role="status"]')?.textContent).toBe('');
  // Raw HTML with a merged cell: core reports the code, the component supplies the words.
  await render(
    <AIMarkdown content={'<table><tr><td colspan="2">x</td></tr></table>'} customComponents={{ table: Table }} />
  );
  expect(scope.querySelector('[role="status"]')?.textContent).toBe('含合并单元格');
  expect((scope.querySelector('.aimd-toolbar button') as HTMLButtonElement).title).toBe('含合并单元格');
});

test('image: the thumbnail and the preview toolbar use the supplied text', async () => {
  const Image = createMarkdownImage({
    labels: { loading: '图片加载中…', open: (alt) => `预览图片：${alt}`, close: '关闭预览', zoomIn: '放大' },
  });
  const { scope } = await show(
    <AIMarkdown content={'![一只猫](https://example.test/cat.png)'} customComponents={{ img: Image }} />
  );
  expect(scope.querySelector('.aimd-image-feedback')?.textContent).toBe('图片加载中…');
  await act(async () => scope.querySelector('img')!.dispatchEvent(new Event('load')));
  const trigger = scope.querySelector('button.aimd-image-trigger') as HTMLButtonElement;
  expect(trigger.getAttribute('aria-label')).toBe('预览图片：一只猫');
  await act(async () => trigger.click());
  const names = [...document.querySelectorAll('.aimd-image-preview [aria-label]')].map((node) =>
    node.getAttribute('aria-label')
  );
  // The close button is named by text for screen readers, not by an attribute.
  expect(document.querySelector('.aimd-image-preview-close')?.textContent).toBe('关闭预览');
  expect(names).toContain('放大');
  // An entry that was not overridden keeps its default.
  expect(names).toContain('Zoom out');
});

// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
// Imported by package name, like the component itself, so both share one React context.
import { AIMarkdown } from '@ai-markdown/react';
import { createMarkdownCodeBlock, createPeleLoader } from './code';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mermaidMock = vi.hoisted(() => ({
  renders: [] as string[],
  /** The rejection message for a source, or null when it parses. */
  rejects: (_code: string): string | null => null,
}));
vi.mock('mermaid', () => {
  const siteConfig = () => ({ securityLevel: 'strict', theme: 'base', darkMode: false, suppressErrorRendering: true });
  return {
    default: {
      initialize: () => {},
      parse: (code: string) => {
        const reason = mermaidMock.rejects(code);
        return reason === null ? Promise.resolve(true) : Promise.reject(new Error(reason));
      },
      render: (_id: string, code: string) => {
        mermaidMock.renders.push(code);
        return Promise.resolve({
          svg: `<svg data-mock-diagram="${mermaidMock.renders.length}"></svg>`,
          diagramType: 'flowchart',
        });
      },
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
  mermaidMock.renders.length = 0;
  mermaidMock.rejects = () => null;
});

const Block = createMarkdownCodeBlock({ mermaidIntervalMs: 0 });
const fence = (body: string) => `\`\`\`mermaid\n${body}`;
const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => {});
};
const mount = async (content: string, streaming: boolean, block = Block) => {
  const scope = (container = document.createElement('div'));
  document.body.append(scope);
  root = createRoot(scope);
  const render = async (next: string, live: boolean) => {
    await act(async () => {
      root!.render(<AIMarkdown content={next} streaming={live} customComponents={{ pre: block }} />);
    });
    await settle();
  };
  await render(content, streaming);
  return {
    render,
    diagram: () => scope.querySelector('[data-mock-diagram]')?.getAttribute('data-mock-diagram'),
    status: () => scope.querySelector('.aimd-diagram [role="status"]')?.textContent,
    alert: () => scope.querySelector('.aimd-diagram [role="alert"] p')?.textContent,
    retry: () => scope.querySelector('.aimd-diagram [role="alert"] button') as HTMLButtonElement | null,
  };
};

test('a streamed diagram waits quietly, keeps the last diagram, and reports only the final source', async () => {
  mermaidMock.rejects = (code) => (code.includes('A--\n') || code.includes('BROKEN') ? 'Parse error on line 2' : null);
  const view = await mount(fence('graph TD;\nA--'), true);
  // The prefix does not parse: no error while the document streams.
  expect(view.status()).toBe('Waiting for diagram…');
  expect(view.alert()).toBeUndefined();
  await view.render(fence('graph TD;\nA-->B;'), true);
  expect(view.diagram()).toBe('1');
  // A later chunk breaks the source again: the diagram stays up.
  await view.render(fence('graph TD;\nA-->B;\nBROKEN'), true);
  expect(view.diagram()).toBe('1');
  expect(view.alert()).toBeUndefined();
  // The stream ends on a source that does not parse: now the error replaces the diagram.
  await view.render(fence('graph TD;\nA-->B;\nBROKEN'), false);
  expect(view.diagram()).toBeUndefined();
  expect(view.alert()).toBe('Parse error on line 2');
});

test('a static failure offers a retry, and the same source is not rendered twice', async () => {
  mermaidMock.rejects = () => 'Parse error on line 1';
  const view = await mount(fence('graph TD;\nA-->B;'), false);
  expect(view.alert()).toBe('Parse error on line 1');
  mermaidMock.rejects = () => null;
  await act(async () => view.retry()!.click());
  await settle();
  expect(view.diagram()).toBe('1');
  await view.render(fence('graph TD;\nA-->B;'), false);
  expect(mermaidMock.renders).toHaveLength(1);
});

test('uses an optional engine without rendering through Mermaid', async () => {
  const render = vi.fn(() => ({ svg: '<svg data-mock-diagram="pele"></svg>', type: 'flowchart' }));
  const block = createMarkdownCodeBlock({ mermaidEngine: createPeleLoader(async () => ({ render })) });
  const view = await mount(fence('graph LR; A-->B;'), false, block);
  expect(view.diagram()).toBe('pele');
  expect(render).toHaveBeenCalledOnce();
  expect(mermaidMock.renders).toEqual([]);
});

test('false disables the diagram and leaves ordinary source controls', async () => {
  await mount(fence('graph LR; A-->B;'), false, createMarkdownCodeBlock({ mermaidEngine: false }));
  expect(container?.querySelector('.aimd-diagram')).toBeNull();
  expect(container?.querySelector('code')?.textContent).toContain('A-->B');
  expect(mermaidMock.renders).toEqual([]);
});

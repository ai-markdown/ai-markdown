// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { createApp, h, nextTick, ref, type App } from 'vue';
import { AIMarkdown } from '../AIMarkdown';
import { createMarkdownCodeBlock } from './code';

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

let app: App | undefined;
let container: HTMLElement | undefined;
afterEach(() => {
  app?.unmount();
  container?.remove();
  app = container = undefined;
  mermaidMock.renders.length = 0;
  mermaidMock.rejects = () => null;
});

const Block = createMarkdownCodeBlock({ mermaidIntervalMs: 0 });
const fence = (body: string) => `\`\`\`mermaid\n${body}`;
const settle = async () => {
  for (let i = 0; i < 8; i++) await nextTick().then(() => Promise.resolve());
};
const mount = async (content: string, streaming: boolean) => {
  const scope = (container = document.createElement('div'));
  document.body.append(scope);
  const props = ref({ content, streaming });
  // The cursor needs ResizeObserver, which jsdom does not have.
  app = createApp({
    render: () => h(AIMarkdown, { ...props.value, streamingCursor: false, components: { pre: Block } }),
  });
  app.mount(scope);
  await settle();
  return {
    render: async (next: string, live: boolean) => {
      props.value = { content: next, streaming: live };
      await settle();
    },
    diagram: () => scope.querySelector('[data-mock-diagram]')?.getAttribute('data-mock-diagram'),
    status: () => scope.querySelector('.aimd-diagram [role="status"]')?.textContent,
    alert: () => scope.querySelector('.aimd-diagram [role="alert"] p')?.textContent,
    retry: () => scope.querySelector('.aimd-diagram [role="alert"] button') as HTMLButtonElement | null,
  };
};

test('a streamed diagram waits quietly, keeps the last diagram, and reports only the final source', async () => {
  mermaidMock.rejects = (code) => (code.includes('A--\n') || code.includes('BROKEN') ? 'Parse error on line 2' : null);
  const view = await mount(fence('graph TD;\nA--'), true);
  expect(view.status()).toBe('Waiting for diagram…');
  expect(view.alert()).toBeUndefined();
  await view.render(fence('graph TD;\nA-->B;'), true);
  expect(view.diagram()).toBe('1');
  await view.render(fence('graph TD;\nA-->B;\nBROKEN'), true);
  expect(view.diagram()).toBe('1');
  expect(view.alert()).toBeUndefined();
  await view.render(fence('graph TD;\nA-->B;\nBROKEN'), false);
  expect(view.diagram()).toBeUndefined();
  expect(view.alert()).toBe('Parse error on line 2');
});

test('a static failure offers a retry, and the same source is not rendered twice', async () => {
  mermaidMock.rejects = () => 'Parse error on line 1';
  const view = await mount(fence('graph TD;\nA-->B;'), false);
  expect(view.alert()).toBe('Parse error on line 1');
  mermaidMock.rejects = () => null;
  view.retry()!.click();
  await settle();
  expect(view.diagram()).toBe('1');
  await view.render(fence('graph TD;\nA-->B;'), false);
  expect(mermaidMock.renders).toHaveLength(1);
});

// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { act, useEffect, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
// Imported by package name, like the component itself, so both share one React context.
import { AIMarkdown } from '@ai-markdown/react';
import {
  MarkdownCodeBlock,
  createMarkdownCodeBlock,
  type CodeRendererInput,
  type MarkdownCodeBlockProps,
} from './code-plain';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLElement | undefined;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

const mount = (pre: ComponentType<MarkdownCodeBlockProps> = MarkdownCodeBlock) => {
  const scope = (container = document.createElement('div'));
  document.body.append(scope);
  root = createRoot(scope);
  const render = (content: string) =>
    act(async () => {
      root!.render(<AIMarkdown content={content} streaming customComponents={{ pre }} />);
    });
  /** Feeds the document four characters at a time, so most chunks end in the middle of a line. */
  const stream = async (content: string) => {
    let frames = 0;
    for (let end = 4; end < content.length + 4; end += 4, frames++) {
      await render(content.slice(0, Math.min(end, content.length)));
    }
    return frames;
  };
  return { render, stream, label: () => scope.querySelector('.aimd-toolbar > span')?.textContent };
};

const wait = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

describe('a code block that streams in mid-line chunks', () => {
  test('keeps one custom renderer mounted', async () => {
    const seen = { mounts: 0, resetKeys: new Set<string>() };
    function Demo(props: CodeRendererInput) {
      seen.resetKeys.add(props.resetKey);
      useEffect(() => {
        seen.mounts++;
      }, []);
      return <div>{props.code.length}</div>;
    }
    const lines = Array.from({ length: 8 }, (_, i) => `node_${i} --> node_${i + 1} with a label\n`).join('');
    const frames = await mount(createMarkdownCodeBlock({ renderers: { demo: Demo } })).stream(`\`\`\`demo\n${lines}`);
    expect(frames).toBeGreaterThan(50);
    expect(seen.mounts).toBe(1);
    expect(seen.resetKeys.size).toBe(1);
  });

  test('throttles highlight to the configured interval', async () => {
    let calls = 0;
    const Block = createMarkdownCodeBlock({ highlightIntervalMs: 60_000, highlight: (code) => (calls++, code) });
    const lines = Array.from({ length: 20 }, (_, i) => `const value${i} = compute(${i});\n`).join('');
    const frames = await mount(Block).stream(`\`\`\`js\n${lines}`);
    expect(frames).toBeGreaterThan(100);
    // The first frame, plus the frame React renders when the block mounts on the client.
    expect(calls).toBeLessThan(5);
  });
});

describe('unlabelled code block language', () => {
  const block = (body: string) => `\`\`\`\n${body}`;

  // The replacement is longer than the old text by less than minGrowthChars (80), so the detector's
  // own checkpoint does not run and only a new detector can drop the old verdict.
  test('a replaced block shows the language of its new text, not the old verdict', async () => {
    const typescript = Array.from({ length: 4 }, (_, i) => `export const value${i}: number = ${i} as number;`).join(
      '\n'
    );
    const python = Array.from(
      { length: 4 },
      (_, i) => `def handler_${i}(request):\n    import os\n    return None`
    ).join('\n');
    const view = mount();
    await view.render(block(typescript));
    expect(view.label()).toBe('typescript');
    await view.render(block(python));
    expect(view.label()).toBe('python');
  });

  // The streaming detector looks again only after 80 more characters, and the document-level
  // streaming flag does not say that this fence has closed. A block that has stopped changing
  // is judged as complete instead.
  test('a short block is labelled once its text settles, while the document still streams', async () => {
    const view = mount();
    await view.stream('Run this:\n\n```\ndef add(a, b):\n    return a + b\n\nprint(add(1, 2))\n```\n\nMore prose.');
    await wait(100); // the pending 50 ms frame
    await wait(400); // the 300 ms settle
    expect(view.label()).toBe('python');
  });
});

describe('shared highlighting adapters', () => {
  test('Shiki receives TSX without lossy highlight.js conversion; the new adapter wins over legacy', async () => {
    const { CodeLanguageFormat } = await import('@ai-markdown/core/components');
    const languages: string[] = [];
    const Block = createMarkdownCodeBlock({
      highlighter: {
        languageFormat: CodeLanguageFormat.Shiki,
        highlight: ({ code, language }) => {
          languages.push(language);
          return { tokens: [{ text: code, color: '#ff0000' }] };
        },
      },
      highlight: () => {
        throw new Error('legacy must not execute');
      },
    });
    await mount(Block).render('```tsx\nconst view = <Widget />;\n```');
    expect(languages).toContain('tsx');
    expect(container?.querySelector('code span')?.textContent).toContain('<Widget />');
    expect(container?.querySelector('Widget')).toBeNull();
  });
  test('async preparation renders latest source and falls back after failure', async () => {
    const { CodeLanguageFormat } = await import('@ai-markdown/core/components');
    let done!: () => void;
    const Block = createMarkdownCodeBlock({
      highlightIntervalMs: 0,
      highlighter: {
        languageFormat: CodeLanguageFormat.Shiki,
        prepare: () =>
          new Promise<void>((resolve) => {
            done = resolve;
          }),
        highlight: ({ code }) => ({ tokens: [{ text: code }] }),
      },
    });
    const view = mount(Block);
    await view.render('```tsx\nconst old = <Old />;\n```');
    expect(container?.querySelector('code')?.getAttribute('data-highlight-status')).toBe('loading');
    await view.render('```tsx\nconst latest = <Latest />;\n```');
    await act(async () => {
      done();
    });
    expect(container?.querySelector('code')?.getAttribute('data-highlight-status')).toBe('ready');
    expect(container?.querySelector('code')?.textContent).toContain('<Latest />');
  });
  test('legacy callbacks keep their default names but may explicitly select Shiki', async () => {
    const { CodeLanguageFormat } = await import('@ai-markdown/core/components');
    const names: string[] = [];
    const Block = createMarkdownCodeBlock({
      languageFormat: CodeLanguageFormat.Shiki,
      highlight: (code, language) => {
        names.push(language);
        return code;
      },
    });
    await mount(Block).render('```vue\n<template>Hello</template>\n```');
    expect(names).toContain('vue');
  });
});

test('server rendering never prepares async engines and escapes plaintext fallback', async () => {
  const { renderToString } = await import('react-dom/server');
  const { CodeLanguageFormat } = await import('@ai-markdown/core/components');
  let prepared = 0;
  const pre = createMarkdownCodeBlock({
    highlighter: {
      languageFormat: CodeLanguageFormat.Shiki,
      prepare: async () => {
        prepared++;
      },
      highlight: ({ code }) => ({ tokens: [{ text: code }] }),
    },
  });
  const html = renderToString(
    <AIMarkdown content={'```tsx\n<script>unsafe</script>\n```'} customComponents={{ pre }} />
  );
  expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('data-highlight-status="loading"');
  expect(prepared).toBe(0);
});

test('incremental sessions survive StrictMode and release every allocated backend', async () => {
  const { StrictMode } = await import('react');
  const { CodeLanguageFormat } = await import('@ai-markdown/core/components');
  const disposed = new Set<number>();
  let created = 0;
  const Block = createMarkdownCodeBlock({
    highlightIntervalMs: 0,
    highlighter: {
      languageFormat: CodeLanguageFormat.Pierre,
      highlight: () => {
        throw new Error('stateless path must not run');
      },
      createSession: () => {
        const id = ++created;
        return {
          highlight: ({ code }) => ({ tokens: [{ text: code, color: '#123456' }] }),
          dispose: () => {
            disposed.add(id);
          },
        };
      },
    },
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  for (const code of ['const first = 1;', 'const first = 1;\nconst second = 2;']) {
    await act(async () =>
      root!.render(
        <StrictMode>
          <AIMarkdown content={'```ts\n' + code} streaming customComponents={{ pre: Block }} />
        </StrictMode>
      )
    );
    expect(container.querySelector('code')?.textContent).toContain(code);
    expect(container.querySelector('code')?.getAttribute('data-highlight-status')).toBe('ready');
  }
  await act(async () => root!.unmount());
  root = undefined;
  expect(created).toBeGreaterThan(0);
  expect(disposed.size).toBe(created);
});

test('hydrates a preloaded mutable adapter without allocating on the server or resetting for Markdown appends', async () => {
  const { renderToString } = await import('react-dom/server');
  const { hydrateRoot } = await import('react-dom/client');
  const { CodeLanguageFormat } = await import('@ai-markdown/core/components');
  let created = 0;
  const codes: string[] = [],
    recoveries: unknown[] = [];
  const pre = createMarkdownCodeBlock({
    highlightIntervalMs: 0,
    highlighter: {
      languageFormat: CodeLanguageFormat.Pierre,
      isReady: () => true,
      highlight: () => {
        throw new Error('render must not mutate the engine');
      },
      createSession: () => {
        created++;
        return {
          highlight: ({ code }) => {
            codes.push(code);
            return { tokens: [{ text: code, color: '#123456' }] };
          },
          dispose() {},
        };
      },
    },
  });
  const view = (body: string, streaming = false) => (
    <AIMarkdown
      content={'```tsx\n' + body}
      streaming={streaming}
      streamingCursor={() => null}
      customComponents={{ pre }}
    />
  );
  container = document.createElement('div');
  container.innerHTML = renderToString(view('a'));
  document.body.append(container);
  expect(created).toBe(0);
  await act(async () => {
    root = hydrateRoot(container!, view('a'), { onRecoverableError: (error) => recoveries.push(error) });
  });
  for (const body of ['ab', 'abc', 'abc\nnext']) await act(async () => root!.render(view(body, true)));
  expect(recoveries).toEqual([]);
  expect(created).toBe(1);
  expect(codes).toContain('ab\n');
  expect(codes).toContain('abc\n');
  expect(container.querySelector('code')?.textContent).toBe('abc\nnext\n');
});

// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { createApp, defineComponent, h, nextTick, onMounted, ref, type App, type Component } from 'vue';
import { AIMarkdown } from '../AIMarkdown';
import { MarkdownCodeBlock, createMarkdownCodeBlock } from './code-plain';

let app: App | undefined;
let container: HTMLElement | undefined;

afterEach(() => {
  app?.unmount();
  container?.remove();
  app = undefined;
  container = undefined;
});

const mount = (pre: Component = MarkdownCodeBlock) => {
  const scope = (container = document.createElement('div'));
  document.body.append(scope);
  const content = ref('');
  // The cursor needs ResizeObserver, which jsdom does not have.
  app = createApp({
    render: () =>
      h(AIMarkdown, { content: content.value, streaming: true, streamingCursor: false, components: { pre } }),
  });
  app.mount(scope);
  const render = async (next: string) => {
    content.value = next;
    await nextTick();
  };
  /** Feeds the document four characters at a time, so most chunks end in the middle of a line. */
  const stream = async (next: string) => {
    let frames = 0;
    for (let end = 4; end < next.length + 4; end += 4, frames++)
      await render(next.slice(0, Math.min(end, next.length)));
    return frames;
  };
  return { render, stream, label: () => scope.querySelector('.aimd-toolbar > span')?.textContent };
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)).then(nextTick);

describe('a code block that streams in mid-line chunks', () => {
  test('keeps one custom renderer mounted', async () => {
    let mounts = 0;
    const resetKeys = new Set<string>();
    const Demo = defineComponent({
      props: {
        code: String,
        language: String,
        streaming: Boolean,
        colorScheme: String,
        active: Boolean,
        resetKey: { type: String, required: true },
      },
      setup(props) {
        onMounted(() => mounts++);
        return () => (resetKeys.add(props.resetKey), h('div', String(props.code?.length)));
      },
    });
    const lines = Array.from({ length: 8 }, (_, i) => `node_${i} --> node_${i + 1} with a label\n`).join('');
    const frames = await mount(createMarkdownCodeBlock({ renderers: { demo: Demo } })).stream(`\`\`\`demo\n${lines}`);
    expect(frames).toBeGreaterThan(50);
    expect(mounts).toBe(1);
    expect(resetKeys.size).toBe(1);
  });

  test('another document at the same position is another block, even when its text continues', async () => {
    let mounts = 0;
    const Demo = defineComponent({
      props: { code: String, resetKey: String },
      setup(props) {
        onMounted(() => mounts++);
        return () => h('div', props.code);
      },
    });
    const pre = createMarkdownCodeBlock({ renderers: { demo: Demo } });
    const scope = (container = document.createElement('div'));
    document.body.append(scope);
    const state = ref({ documentId: 'first', content: '```demo\nimport a\n```' });
    app = createApp({
      render: () => h(AIMarkdown, { ...state.value, streamingCursor: false, components: { pre } }),
    });
    app.mount(scope);
    await nextTick();
    expect(mounts).toBe(1);
    // The same document growing: one renderer.
    state.value = { documentId: 'first', content: '```demo\nimport a\nimport b\n```' };
    await nextTick();
    expect(mounts).toBe(1);
    // Another message whose block starts with the same text.
    state.value = { documentId: 'second', content: '```demo\nimport a\nimport b\nimport c\n```' };
    await nextTick();
    await nextTick();
    expect(mounts).toBe(2);
  });

  test('throttles highlight to the configured interval', async () => {
    let calls = 0;
    const Block = createMarkdownCodeBlock({ highlightIntervalMs: 60_000, highlight: (code) => (calls++, code) });
    const lines = Array.from({ length: 20 }, (_, i) => `const value${i} = compute(${i});\n`).join('');
    const frames = await mount(Block).stream(`\`\`\`js\n${lines}`);
    expect(frames).toBeGreaterThan(100);
    expect(calls).toBeLessThan(5);
  });
});

describe('unlabelled code block language', () => {
  const block = (body: string) => `\`\`\`\n${body}`;

  // The replacement is longer than the old text by less than minGrowthChars (80), so the detector's
  // own checkpoint does not run and only the reset can drop the old verdict.
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
  test('Shiki receives TSX without lossy conversion; adapter wins over legacy', async () => {
    const { CodeLanguageFormat } = await import('@ai-markdown/core/components');
    const names: string[] = [];
    const Block = createMarkdownCodeBlock({
      highlighter: {
        languageFormat: CodeLanguageFormat.Shiki,
        highlight: ({ code, language }) => {
          names.push(language);
          return { tokens: [{ text: code, color: '#ff0000' }] };
        },
      },
      highlight: () => {
        throw new Error('legacy must not execute');
      },
    });
    await mount(Block).render('```tsx\nconst view = <Widget />;\n```');
    expect(names).toContain('tsx');
    expect(container?.querySelector('code span')?.textContent).toContain('<Widget />');
    expect(container?.querySelector('Widget')).toBeNull();
  });
  test('async preparation renders latest source', async () => {
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
    await wait(0);
    expect(container?.querySelector('code')?.getAttribute('data-highlight-status')).toBe('loading');
    await view.render('```tsx\nconst latest = <Latest />;\n```');
    done();
    await wait(0);
    expect(container?.querySelector('code')?.getAttribute('data-highlight-status')).toBe('ready');
    expect(container?.querySelector('code')?.textContent).toContain('<Latest />');
  });
  test('legacy callbacks can explicitly select Shiki names', async () => {
    const { CodeLanguageFormat } = await import('@ai-markdown/core/components');
    const names: string[] = [];
    await mount(
      createMarkdownCodeBlock({
        languageFormat: CodeLanguageFormat.Shiki,
        highlight: (code, language) => {
          names.push(language);
          return code;
        },
      })
    ).render('```vue\n<template>Hello</template>\n```');
    expect(names).toContain('vue');
  });
});

test('server rendering never prepares async engines and escapes plaintext fallback', async () => {
  const { createSSRApp } = await import('vue');
  const { renderToString } = await import('@vue/server-renderer');
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
  const html = await renderToString(
    createSSRApp({
      render: () => h(AIMarkdown, { content: '```tsx\n<script>unsafe</script>\n```', components: { pre } }),
    })
  );
  expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('data-highlight-status="loading"');
  expect(prepared).toBe(0);
});

test('hydrates a preloaded mutable adapter and preserves its session across Markdown appends', async () => {
  const { createSSRApp } = await import('vue');
  const { renderToString } = await import('@vue/server-renderer');
  const { CodeLanguageFormat } = await import('@ai-markdown/core/components');
  let created = 0;
  const warnings: string[] = [],
    codes: string[] = [];
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
  const body = ref('a'),
    streaming = ref(false);
  const host = {
    render: () =>
      h(AIMarkdown, {
        content: '```tsx\n' + body.value,
        streaming: streaming.value,
        streamingCursor: false,
        components: { pre },
      }),
  };
  container = document.createElement('div');
  container.innerHTML = await renderToString(createSSRApp(host));
  document.body.append(container);
  expect(created).toBe(0);
  app = createSSRApp(host);
  app.config.warnHandler = (message) => warnings.push(message);
  app.mount(container);
  await nextTick();
  streaming.value = true;
  for (const next of ['ab', 'abc', 'abc\nnext']) {
    body.value = next;
    await nextTick();
  }
  expect(warnings.filter((message) => /hydration/i.test(message))).toEqual([]);
  expect(created).toBe(1);
  expect(codes).toContain('ab\n');
  expect(codes).toContain('abc\n');
  expect(container.querySelector('code')?.textContent).toBe('abc\nnext\n');
});

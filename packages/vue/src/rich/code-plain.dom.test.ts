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

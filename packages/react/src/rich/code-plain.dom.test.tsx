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

import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import type { Element, Root } from 'hast';
import { visit } from 'unist-util-visit';
import rehypeTaskListLabels from './rehypeTaskListLabels';

async function inputs(source: string) {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype).use(rehypeTaskListLabels);
  const tree = (await processor.run(processor.parse(source))) as Root;
  const result: Element[] = [];
  visit(tree, 'element', (node) => {
    if (node.tagName === 'input') result.push(node);
  });
  return result.map((node) => node.properties);
}

describe('task list accessible names', () => {
  it('names nested status controls independently and preserves checked state', async () => {
    expect(await inputs('- [x] **Parent** [link](https://example.com)\n  - [ ] Child')).toEqual([
      { type: 'checkbox', checked: true, disabled: true, ariaLabel: 'Parent link' },
      { type: 'checkbox', checked: false, disabled: true, ariaLabel: 'Child' },
    ]);
  });
  it('handles loose items and image alternatives', async () => {
    const result = await inputs('- [ ] ![Diagram](test.png)\n\n  More text\n\n- [ ]');
    expect(result.map((node) => node.ariaLabel)).toEqual(['Diagram More text']);
  });
  it('provides a fallback for a task with no text alternative', async () => {
    expect((await inputs('- [ ] ![](image.png)'))[0].ariaLabel).toBe('Task');
  });
  it('preserves an explicit author label and is idempotent', () => {
    const input: Element = {
      type: 'element',
      tagName: 'input',
      properties: { type: 'checkbox', disabled: true, ariaLabel: 'Authored' },
      children: [],
    };
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'li',
          properties: { className: ['task-list-item'] },
          children: [input, { type: 'text', value: 'Item' }],
        },
      ],
    };
    rehypeTaskListLabels()(tree);
    rehypeTaskListLabels()(tree);
    expect(input.properties.ariaLabel).toBe('Authored');
  });
});

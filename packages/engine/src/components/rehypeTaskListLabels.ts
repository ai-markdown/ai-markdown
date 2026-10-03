import type { Element, ElementContent, Root } from 'hast';
import { visit } from 'unist-util-visit';

/** Name task status controls from their own item, excluding nested lists. */
export default function rehypeTaskListLabels() {
  return (tree: Root) => {
    visit(tree, 'element', (item: Element) => {
      if (
        item.tagName !== 'li' ||
        !Array.isArray(item.properties.className) ||
        !item.properties.className.includes('task-list-item')
      )
        return;
      const text = (nodes: ElementContent[]): string =>
        nodes
          .map((node) => {
            if (node.type === 'text') return node.value;
            if (node.type !== 'element' || ['ul', 'ol', 'input'].includes(node.tagName)) return '';
            if (node.tagName === 'img') return String(node.properties.alt ?? '');
            return text(node.children);
          })
          .join('');
      const label = text(item.children).replace(/\s+/g, ' ').trim() || 'Task';
      const children = item.children.flatMap((node) =>
        node.type === 'element' && node.tagName === 'p' ? node.children : [node]
      );
      for (const node of children) {
        if (
          node.type !== 'element' ||
          node.tagName !== 'input' ||
          node.properties.type !== 'checkbox' ||
          !node.properties.disabled
        )
          continue;
        if (!node.properties.ariaLabel && !node.properties.ariaLabelledBy) node.properties.ariaLabel = label;
      }
    });
  };
}

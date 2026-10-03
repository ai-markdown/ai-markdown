import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AIMarkdown from '../index';

test('task labels survive the production pipeline and omit nested task text', () => {
  const html = renderToStaticMarkup(<AIMarkdown content={'- [x] **Parent**\n  - [ ] Child'} />);
  expect(html).toContain('aria-label="Parent"');
  expect(html).toContain('aria-label="Child"');
  expect(html).not.toContain('aria-label="Parent Child"');
});

test('default code is keyboard reachable without changing custom renderer HAST', () => {
  const content = '```js\nconst x = 1;\n```';
  expect(renderToStaticMarkup(<AIMarkdown content={content} />)).toContain('<pre tabindex="0">');
  const html = renderToStaticMarkup(
    <AIMarkdown
      content={content}
      customComponents={{
        pre: ({ node, children }) => {
          expect(node?.properties).not.toHaveProperty('tabIndex');
          return <pre tabIndex={-1}>{children}</pre>;
        },
      }}
    />
  );
  expect(html).toContain('<pre tabindex="-1">');
});

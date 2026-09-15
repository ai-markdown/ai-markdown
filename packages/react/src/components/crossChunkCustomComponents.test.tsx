// @vitest-environment jsdom
/**
 * `customComponents` overrides for `a` / `img` must apply to elements that
 * cross-chunk link and image references resolve to, not only to same-chunk
 * elements. Before the fix `renderResolvedReference` called `toJsxRuntime`
 * without `components`, so a `SafeLink` wrapper covered `[x](url)` but not
 * `[x][label]` defined in another chunk.
 */
import { afterEach, beforeEach, expect, test } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import AIMarkdown, { AIMarkdownDocuments } from '../index';
import type { Components } from './markdown';

// `node` is stripped before spreading so the DOM element never receives a
// hast object as an attribute.
const customComponents: Components = {
  a: ({ node: _node, children, ...props }) => (
    <a data-custom="a" {...props}>
      {children}
    </a>
  ),
  img: ({ node: _node, ...props }) => <img data-custom="img" {...props} />,
};

let container: HTMLDivElement;
let root: Root;
const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let previousActEnvironment: boolean | undefined;
beforeEach(() => {
  previousActEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  environment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

const definitions = [
  '[target]: https://example.com/target "Target title"',
  '[pic]: https://example.com/pic.png',
  '',
  'Local [inline](https://example.com/local) link.',
].join('\n');
const references = 'See [the **target**][target] and ![a picture][pic].';

test('customComponents a/img apply to cross-chunk references and to the local link', async () => {
  await act(async () => {
    root.render(
      <AIMarkdownDocuments>
        <div data-definition>
          <AIMarkdown documentId="custom" content={definitions} customComponents={customComponents} />
        </div>
        <div data-reference>
          <AIMarkdown documentId="custom" content={references} customComponents={customComponents} />
        </div>
      </AIMarkdownDocuments>
    );
  });

  const reference = container.querySelector('[data-reference]')!;
  const link = reference.querySelector('a');
  expect(link).not.toBeNull();
  expect(link!.getAttribute('data-custom')).toBe('a');
  expect(link!.getAttribute('href')).toBe('https://example.com/target');
  expect(link!.getAttribute('title')).toBe('Target title');
  // The already-rendered link children survive the override.
  expect(link!.innerHTML).toBe('the <strong>target</strong>');

  const image = reference.querySelector('img');
  expect(image).not.toBeNull();
  expect(image!.getAttribute('data-custom')).toBe('img');
  expect(image!.getAttribute('src')).toBe('https://example.com/pic.png');
  expect(image!.getAttribute('alt')).toBe('a picture');

  const local = container.querySelector('[data-definition] a');
  expect(local).not.toBeNull();
  expect(local!.getAttribute('data-custom')).toBe('a');
  expect(local!.getAttribute('href')).toBe('https://example.com/local');
});

test('customComponents a/img apply on the localUrl fallback (registry not yet populated)', () => {
  // A server render never runs effects, so the registry stays empty and the
  // placeholders render from the definition the chunk itself carries.
  const content = ['[own]: https://example.com/own "Own"', '', '[text][own] ![alt][own]'].join('\n');
  const html = renderToString(
    <AIMarkdownDocuments>
      <AIMarkdown documentId="fallback" content={content} customComponents={customComponents} />
    </AIMarkdownDocuments>
  );
  expect(html).toContain('data-custom="a"');
  expect(html).toContain('href="https://example.com/own"');
  expect(html).toContain('>text</a>');
  expect(html).toContain('data-custom="img"');
  expect(html).toContain('src="https://example.com/own"');
  expect(html).toContain('alt="alt"');
});

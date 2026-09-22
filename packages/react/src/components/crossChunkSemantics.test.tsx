// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import AIMarkdown from '../index';
import { AIMarkdownDocuments } from './AIMarkdownDocuments';

let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
});

function semantics(element: HTMLElement) {
  return {
    links: [...element.querySelectorAll('a[href]')]
      .filter((a) => !a.hasAttribute('data-footnote-ref') && !a.hasAttribute('data-footnote-backref'))
      .map((a) => ({ text: a.textContent, href: a.getAttribute('href') })),
    marks: [...element.querySelectorAll('a[data-footnote-ref]')].map((a) => ({
      text: a.textContent,
      href: a.getAttribute('href'),
    })),
    notes: [...element.querySelectorAll('li[id*="-user-content-fn-"]')].map((li) => {
      const body = li.cloneNode(true) as HTMLElement;
      body.querySelectorAll('[data-footnote-backref]').forEach((a) => a.remove());
      return body.textContent?.trim();
    }),
  };
}

const cases = [
  { name: 'footnote', chunks: ['See [^x].\n', '\n[^x]: hello'], text: null },
  { name: 'full link reference', chunks: ['[click][x]\n', '\n[x]: https://example.com'], text: 'click' },
  { name: 'shortcut link reference', chunks: ['[x]\n', '\n[x]: https://example.com'], text: 'x' },
  { name: 'collapsed link reference', chunks: ['[x][]\n', '\n[x]: https://example.com'], text: 'x' },
];
for (const { name, chunks, text } of cases) {
  test(`mounted cross-chunk semantics: ${name}`, async () => {
    const single = document.createElement('div');
    single.innerHTML = renderToStaticMarkup(<AIMarkdown content={chunks.join('')} documentId="doc" />);
    const expected = {
      links: text === null ? [] : [{ text, href: 'https://example.com' }],
      notes: text === null ? ['hello'] : [],
      marks: text === null ? [{ text: '1', href: '#doc-user-content-fn-x' }] : [],
    };
    // Both paths must contain the intended content, not merely agree on absence.
    expect(semantics(single)).toEqual(expected);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <AIMarkdownDocuments>
          {chunks.map((content, index) => (
            <AIMarkdown key={index} content={content} documentId="doc" documentIndex={index} />
          ))}
        </AIMarkdownDocuments>
      );
    });
    expect(semantics(container)).toEqual(expected);
    expect(semantics(container)).toEqual(semantics(single));

    // Prove that this observer catches lost output and corrupted link facts.
    for (const defect of ['missing', 'text', 'destination'] as const) {
      if (text === null && defect !== 'missing') continue;
      const damaged = container.cloneNode(true) as HTMLElement;
      const target = damaged.querySelector(text === null ? 'li[id*="-user-content-fn-"]' : 'a[href]');
      expect(target).not.toBeNull();
      if (defect === 'missing') target!.remove();
      if (defect === 'text') target!.textContent = 'wrong text';
      if (defect === 'destination') target!.setAttribute('href', 'https://wrong.example');
      expect(semantics(damaged), defect).not.toEqual(expected);
    }
  });
}

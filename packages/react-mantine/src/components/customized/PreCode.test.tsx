import { describe, expect, test } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ReactNode } from 'react';
import { MantineProvider } from '@mantine/core';
import {
  CodeHighlightAdapterProvider,
  createHighlightJsAdapter,
  type CodeHighlightAdapter,
} from '@mantine/code-highlight';
import hljs from 'highlight.js';
import MantineAIMarkdown from '../../MantineAIMarkdown';
import { MantineLanguageFormat } from '../../defs';
import { jsonLooksComplete } from './PreCode';

const adapter = createHighlightJsAdapter(hljs);
const stripTags = (html: string) => html.replace(/<[^>]+>/g, '');
const render = (ui: ReactNode) =>
  renderToString(
    <MantineProvider>
      <CodeHighlightAdapterProvider adapter={adapter}>{ui}</CodeHighlightAdapterProvider>
    </MantineProvider>
  );

describe('jsonLooksComplete (v2.4.1 review: the pretty-print gate)', () => {
  test('balanced values pass', () => {
    expect(jsonLooksComplete('{"a":{"b":1}}')).toBe(true);
    expect(jsonLooksComplete('[1, [2, 3]]\n')).toBe(true);
    expect(jsonLooksComplete('{\n  "a": {\n    "b": 1\n  }\n}')).toBe(true);
  });
  test('an in-progress pretty-printed prefix ending on a closing bracket does not pass', () => {
    expect(jsonLooksComplete('{\n  "a": {\n    "b": 1\n  }')).toBe(false);
    expect(jsonLooksComplete('{\n  "items": [\n    {"x": 1}')).toBe(false);
  });
  test('brackets inside strings are ignored; unterminated strings fail', () => {
    expect(jsonLooksComplete('{"a": "}"}')).toBe(true);
    expect(jsonLooksComplete('{"a": "\\"}"}')).toBe(true);
    expect(jsonLooksComplete('{"a": "}')).toBe(false);
  });
  test('shapes without a closing bracket at the end never pass', () => {
    expect(jsonLooksComplete('{"a": 1')).toBe(false);
    expect(jsonLooksComplete('42')).toBe(false);
    expect(jsonLooksComplete('')).toBe(false);
  });
});

// Unlabelled blocks the detector places with confidence, and one it must not.
const PYTHON = ['import os', 'import sys', '', 'def main(argv):', '    for path in argv:', '        print(path)'].join(
  '\n'
);
const VUE = [
  '<template>',
  '  <p class="greeting">{{ message }}</p>',
  '</template>',
  '',
  '<script setup lang="ts">',
  "const message = 'hi';",
  '</script>',
].join('\n');
const AMBIGUOUS = 'x = 1';
const fence = (body: string) => '```\n' + body + '\n```';
const AUTODETECT = { autoDetectUnknownLanguage: true };

/** An adapter that records the language names the highlighter is asked for. */
function recordingAdapter(): { adapter: CodeHighlightAdapter; languages: string[] } {
  const languages: string[] = [];
  return {
    languages,
    adapter: {
      getHighlighter:
        () =>
        ({ code, language }) => {
          if (language) languages.push(language);
          return { highlightedCode: code, isHighlighted: false };
        },
    },
  };
}
const renderWith = (ui: ReactNode, codeAdapter: CodeHighlightAdapter) =>
  renderToString(
    <MantineProvider>
      <CodeHighlightAdapterProvider adapter={codeAdapter}>{ui}</CodeHighlightAdapterProvider>
    </MantineProvider>
  );

describe('language auto-detection (server render)', () => {
  test('an unlabelled block is labelled and highlighted on the first render', () => {
    const html = render(<MantineAIMarkdown content={fence(PYTHON)} codeBlock={AUTODETECT} />);
    expect(html).toMatch(/>python</);
    expect(html).toContain('hljs-keyword');
  });

  test('the option is off by default: the block stays plaintext with no language tab', () => {
    const html = render(<MantineAIMarkdown content={fence(PYTHON)} />);
    expect(html).not.toMatch(/>python</);
    expect(html).not.toContain('hljs-keyword');
  });

  test('when the detector abstains the block stays "unknown"', () => {
    const { adapter: codeAdapter, languages } = recordingAdapter();
    const html = renderWith(<MantineAIMarkdown content={fence(AMBIGUOUS)} codeBlock={AUTODETECT} />, codeAdapter);
    expect(html).not.toContain('CodeHighlightTabs');
    expect(languages.every((language) => language === 'plaintext')).toBe(true);
  });

  test('highlight.js names by default; the label keeps the detected name', () => {
    const { adapter: codeAdapter, languages } = recordingAdapter();
    const html = renderWith(<MantineAIMarkdown content={fence(VUE)} codeBlock={AUTODETECT} />, codeAdapter);
    expect(html).toMatch(/>vue</);
    expect(languages).toContain('xml');
    expect(languages).not.toContain('vue');
  });

  test('the Shiki format passes Shiki ids', () => {
    const { adapter: codeAdapter, languages } = recordingAdapter();
    renderWith(
      <MantineAIMarkdown
        content={fence(VUE)}
        codeBlock={{ autoDetectUnknownLanguage: true, languageFormat: MantineLanguageFormat.Shiki }}
      />,
      codeAdapter
    );
    expect(languages).toContain('vue');
    expect(languages).not.toContain('xml');
  });

  test('an unrecognised format falls back to highlight.js names', () => {
    const { adapter: codeAdapter, languages } = recordingAdapter();
    renderWith(
      <MantineAIMarkdown
        content={fence(VUE)}
        codeBlock={{
          autoDetectUnknownLanguage: true,
          languageFormat: 'hljs' as unknown as MantineLanguageFormat,
        }}
      />,
      codeAdapter
    );
    expect(languages).toContain('xml');
  });

  test('an explicit fence language is never re-detected, and reaches the highlighter in its naming', () => {
    const { adapter: codeAdapter, languages } = recordingAdapter();
    const html = renderWith(
      <MantineAIMarkdown content={'```vue\n' + PYTHON + '\n```'} codeBlock={AUTODETECT} />,
      codeAdapter
    );
    // The label keeps the name as written; highlight.js has no vue grammar, so it highlights xml.
    expect(html).toMatch(/>vue</);
    expect(languages).toContain('xml');
    expect(languages).not.toContain('python');
  });

  test('explicit fence names written by models are translated for each highlighter', () => {
    const cases: [fence: string, format: MantineLanguageFormat, highlighter: string][] = [
      ['objc', MantineLanguageFormat.HighlightJs, 'objectivec'],
      ['objc', MantineLanguageFormat.Shiki, 'objective-c'],
      ['txt', MantineLanguageFormat.HighlightJs, 'plaintext'],
      ['txt', MantineLanguageFormat.Shiki, 'text'],
      ['Makefile', MantineLanguageFormat.Shiki, 'make'],
      ['haskell', MantineLanguageFormat.Shiki, 'haskell'],
    ];
    for (const [fence, languageFormat, highlighter] of cases) {
      const { adapter: codeAdapter, languages } = recordingAdapter();
      const html = renderWith(
        <MantineAIMarkdown content={'```' + fence + '\nx = 1\n```'} codeBlock={{ languageFormat }} />,
        codeAdapter
      );
      expect(languages, `${fence} under ${languageFormat}`).toContain(highlighter);
      expect(html, `${fence} keeps its label`).toContain(`>${fence.toLowerCase()}<`);
    }
  });
});

describe('json pretty-print while streaming', () => {
  test('a complete json block is pretty-printed mid-stream; an unbalanced prefix is left verbatim', () => {
    const done = render(<MantineAIMarkdown content={'```json\n{"a":{"b":1}}\n```'} streaming />);
    expect(stripTags(done)).toContain('&quot;b&quot;: 1');
    const partial = render(<MantineAIMarkdown content={'```json\n{"a":{"b":1}\n```'} streaming />);
    expect(stripTags(partial)).toContain('{&quot;a&quot;:{&quot;b&quot;:1}');
    expect(stripTags(partial)).not.toContain('&quot;b&quot;: 1');
  });
});

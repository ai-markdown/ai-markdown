import hljs from 'highlight.js';
import {
  CodeLanguageFormat,
  createPierreHighlightAdapter,
  type CodeHighlightAdapter,
} from '@ai-markdown/core/components';
import type { Highlighter, BundledLanguage } from 'shiki';
export type DemoEngine = 'highlight.js' | 'Shiki' | 'Pierre' | 'Pierre (full frame)' | 'Plain' | 'Legacy';
export type DemoScenario =
  'engines' | 'languages' | 'streaming' | 'loading' | 'failure' | 'theme' | 'behaviors' | 'renderers' | 'legacy';
export const samples: Record<string, string> = {
  tsx: 'export const Greeting = ({ name }: { name: string }) => <strong>Hello {name}</strong>;',
  jsx: 'export const Greeting = ({ name }) => <strong>Hello {name}</strong>;',
  vue: '<template><h1>{{ title }}</h1></template>\n<script setup>const title = "Hello";</script>',
  svelte: '<script>let count = 0;</script>\n<button on:click={() => count++}>{count}</button>',
  objc: '#import <Foundation/Foundation.h>\n@interface Greeting : NSObject\n@end',
  txt: '<b>This remains plain text.</b>',
  unknown: '<script>alert("never executed")</script>',
  '': 'export interface User { name: string; age: number; }\nexport const user: User = { name: "Ada", age: 37 };',
  '?': '',
  json: '{"large":9007199254740993,"nested":"{\\"enabled\\":true}"}',
  demo: 'Preview and source share this original text.',
  broken: 'The renderer deliberately fails; source remains available.',
};
export const fence = (language: string, code = samples[language] ?? samples.tsx) =>
  '```' + (language === '?' ? '' : language) + '\n' + code + '\n```';
export const languageDocument = Object.keys(samples)
  .filter((key) => !['json', 'demo', 'broken'].includes(key))
  .map((lang) => '### ' + (lang || 'Auto detection') + '\n\n' + fence(lang))
  .join('\n\n');
export const behaviorDocument =
  fence('json') +
  '\n\n' +
  fence('typescript', Array.from({ length: 32 }, (_, i) => `export const value${i}: number = ${i};`).join('\n'));
export const rendererDocument = fence('demo') + '\n\n' + fence('broken') + '\n\n' + fence('mermaid', 'graph TD; A-->B');
export const scenarioText: Record<DemoScenario, string> = {
  engines: 'Switch engines on the same TSX source. Plain mode invokes no highlighter.',
  languages:
    'Compare explicit names, automatic detection, empty input and unknown languages. The table shows each target spelling before rendering.',
  streaming:
    'Start, pause, resume, finish, replace source or switch document. Copy always uses the current original source.',
  loading:
    'A fresh adapter delays preparation. Switch language or theme while loading to exercise stale-result protection.',
  failure: 'Preparation intentionally fails. Retry creates a healthy adapter; source remains readable throughout.',
  theme: 'Switch light/dark while using any engine, including during delayed preparation.',
  behaviors: 'JSON formatting preserves large numbers. Expand/collapse the long block and copy original source.',
  renderers: 'Custom preview, source switch, failing preview fallback and disabled Mermaid renderer.',
  legacy:
    'The existing callback / Mantine Provider remains usable. Default callback language names stay highlight.js-compatible.',
};
export function highlightLegacy(code: string, language: string) {
  return hljs.getLanguage(language) ? hljs.highlight(code, { language }).value : undefined;
}
/** Runtime is shared; each demo owns readiness so delay/failure remain reproducible. */
let shikiInitialization: Promise<Highlighter> | undefined;
export function loadDemoShiki(): Promise<Highlighter> {
  return (shikiInitialization ??= import('shiki').then(({ createHighlighter }) =>
    createHighlighter({
      themes: ['github-light-high-contrast', 'github-dark-high-contrast'],
      langs: [],
    })
  ));
}
export function createDemoHighlighter(engine: DemoEngine, delay = 0, fail = false): CodeHighlightAdapter | undefined {
  if (engine === 'Plain' || engine === 'Legacy') return;
  if (engine === 'Pierre' || engine === 'Pierre (full frame)') {
    return createPierreHighlightAdapter({
      incremental: engine === 'Pierre',
      load: async () => {
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        if (fail) throw new Error('Simulated WASM download failure');
        const [runtime, light, dark] = await Promise.all([
          import('@pierre/highlights'),
          import('@pierre/highlights/themes/github-light-high-contrast'),
          import('@pierre/highlights/themes/github-dark-high-contrast'),
        ]);
        return { ...runtime, themes: { light: light.default, dark: dark.default } };
      },
    });
  }
  let highlighter: Highlighter | undefined;
  const loaded = new Set<string>();
  const format = engine === 'Shiki' ? CodeLanguageFormat.Shiki : CodeLanguageFormat.HighlightJs;
  const adapter: CodeHighlightAdapter = {
    languageFormat: format,
    supports: (language) =>
      !['plaintext', 'text', 'unknown', 'demo', 'broken', 'mermaid'].includes(language) &&
      (engine === 'Shiki' || Boolean(hljs.getLanguage(language))),
    isReady: ({ language }) => loaded.has(language),
    prepare: async ({ language }) => {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (fail) throw new Error('Simulated grammar download failure');
      if (engine === 'Shiki') {
        highlighter = await loadDemoShiki();
        const { bundledLanguages } = await import('shiki');
        if (language in bundledLanguages) await highlighter.loadLanguage(language as BundledLanguage);
      }
      loaded.add(language);
    },
    highlight: ({ code, language, colorScheme }) => {
      if (engine !== 'Shiki') return { html: hljs.highlight(code, { language }).value };
      if (!highlighter?.getLoadedLanguages().includes(language)) return;
      const result = highlighter.codeToTokens(code, {
        lang: language as BundledLanguage,
        theme: colorScheme === 'dark' ? 'github-dark-high-contrast' : 'github-light-high-contrast',
      });
      return {
        tokens: result.tokens.flatMap((line, index) => [
          ...(index ? [{ text: '\n' }] : []),
          ...line.map((token) => ({ text: token.content, color: token.color, fontStyle: token.fontStyle })),
        ]),
      };
    },
  };
  // highlight.js is synchronous unless the story explicitly demonstrates preparation.
  if (engine === 'highlight.js' && !delay && !fail) {
    delete adapter.prepare;
    delete adapter.isReady;
  }
  return adapter;
}

export interface HighlightDemoState {
  content: string;
  streaming: boolean;
  colorScheme: 'light' | 'dark';
  engine: DemoEngine;
  highlighter?: CodeHighlightAdapter;
  document: number;
  scenario: DemoScenario;
}

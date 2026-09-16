import hljs from 'highlight.js';
import { bundledLanguagesInfo } from 'shiki';
import { describe, expect, it } from 'vitest';
import { normalizeCodeLanguage } from '../aliases';
import { toHighlightJsLanguage, toShikiLanguage } from '../converters';
import { normalizeHighlightJsLanguage, normalizeShikiLanguage } from '../highlighterNames';
import { CodeLanguage } from '../language';

/** Plain-text names Shiki handles itself, without a bundled grammar */
const SHIKI_PLAIN_TEXT = new Set(['text', 'plaintext', 'txt', 'plain']);
const shikiKnows = (name: string) =>
  SHIKI_PLAIN_TEXT.has(name) || bundledLanguagesInfo.some((info) => info.id === name || info.aliases?.includes(name));

/** Names outside the 42 languages that models commonly write, with both expected results */
const COMMON_NAMES: readonly [name: string, highlightJs: string, shiki: string][] = [
  ['txt', 'plaintext', 'text'],
  ['Plain', 'plaintext', 'text'],
  ['', 'plaintext', 'text'],
  ['console', 'shell', 'shellsession'],
  ['objective-c++', 'objectivec', 'objective-cpp'],
  ['batch', 'dos', 'bat'],
  ['makefile', 'makefile', 'make'],
  ['coffee', 'coffeescript', 'coffee'],
  ['fortran', 'fortran', 'fortran-free-form'],
  ['delphi', 'delphi', 'pascal'],
  ['viml', 'vim', 'viml'],
  ['jinja2', 'django', 'jinja'],
  ['mathematica', 'mathematica', 'wolfram'],
  ['lisp', 'lisp', 'common-lisp'],
  ['proto', 'protobuf', 'proto'],
  ['patch', 'diff', 'diff'],
  ['ex', 'elixir', 'elixir'],
  ['pl', 'perl', 'perl'],
  ['ndjson', 'json', 'jsonl'],
];

describe('normalizeHighlightJsLanguage / normalizeShikiLanguage', () => {
  it('resolve the names of the 42 languages through the converters', () => {
    for (const language of Object.values(CodeLanguage)) {
      expect(normalizeHighlightJsLanguage(language)).toBe(toHighlightJsLanguage(language));
      expect(normalizeShikiLanguage(language)).toBe(toShikiLanguage(language));
    }
    expect(normalizeHighlightJsLanguage(' Objc ')).toBe('objectivec');
    expect(normalizeHighlightJsLanguage('Vue')).toBe('xml');
    expect(normalizeShikiLanguage('objc')).toBe('objective-c');
    expect(normalizeShikiLanguage('PY')).toBe('python');
  });

  it('translate common names outside the 42 languages', () => {
    for (const [name, highlightJs, shiki] of COMMON_NAMES) {
      expect(normalizeHighlightJsLanguage(name), JSON.stringify(name)).toBe(highlightJs);
      expect(normalizeShikiLanguage(name), JSON.stringify(name)).toBe(shiki);
    }
  });

  it('only produce names the highlighters know, for every listed common name', () => {
    for (const [name] of COMMON_NAMES) {
      const highlightJs = normalizeHighlightJsLanguage(name);
      expect(
        hljs.getLanguage(highlightJs),
        `highlight.js name ${highlightJs} for ${JSON.stringify(name)}`
      ).toBeDefined();
      const shiki = normalizeShikiLanguage(name);
      expect(shikiKnows(shiki), `Shiki name ${shiki} for ${JSON.stringify(name)}`).toBe(true);
    }
  });

  it('never translate a name the 42 languages already claim', () => {
    for (const [name] of COMMON_NAMES) expect(normalizeCodeLanguage(name), JSON.stringify(name)).toBe(null);
  });

  it('pass any other name through, lower-cased and trimmed', () => {
    for (const name of ['haskell', 'GraphQL', ' jsonc ', 'json5', 'mermaid', 'some-future-language']) {
      const expected = name.trim().toLowerCase();
      expect(normalizeHighlightJsLanguage(name)).toBe(expected);
      expect(normalizeShikiLanguage(name)).toBe(expected);
    }
  });
});

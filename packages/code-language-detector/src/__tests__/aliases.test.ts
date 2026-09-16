import hljs from 'highlight.js';
import { bundledLanguagesInfo } from 'shiki';
import { describe, expect, it } from 'vitest';
import { normalizeCodeLanguage } from '../aliases';
import { toHighlightJsLanguage, toShikiLanguage } from '../converters';
import { CodeLanguage } from '../language';

const ALL = Object.values(CodeLanguage);

/** Where toHighlightJsLanguage deliberately loses information, and what the name resolves back to */
const LOSSY_HIGHLIGHT_JS: ReadonlyMap<CodeLanguage, CodeLanguage> = new Map([
  [CodeLanguage.Html, CodeLanguage.Xml],
  [CodeLanguage.Vue, CodeLanguage.Xml],
  [CodeLanguage.Svelte, CodeLanguage.Xml],
  [CodeLanguage.Jsx, CodeLanguage.JavaScript],
  [CodeLanguage.Tsx, CodeLanguage.TypeScript],
]);

/** highlight.js aliases that resolve somewhere other than the grammar they are registered on */
const HIGHLIGHT_JS_EXCEPTIONS: ReadonlyMap<string, CodeLanguage | null> = new Map<string, CodeLanguage | null>([
  // An exact CodeLanguage value wins over the alias
  ['html', CodeLanguage.Html],
  ['jsx', CodeLanguage.Jsx],
  ['tsx', CodeLanguage.Tsx],
  ['toml', CodeLanguage.Toml],
  // XML-serialized HTML is an HTML document
  ['xhtml', CodeLanguage.Html],
  // Related but distinct languages, deliberately not mapped
  ['jsp', null],
  ['mm', null],
  ['obj-c++', null],
  ['objective-c++', null],
  ['pluto', null],
  // JSON supersets with their own Shiki grammars; passing the name through keeps them
  ['jsonc', null],
  ['json5', null],
]);

describe('normalizeCodeLanguage', () => {
  it('resolves every CodeLanguage value to itself', () => {
    for (const language of ALL) expect(normalizeCodeLanguage(language)).toBe(language);
  });

  it('ignores case and surrounding whitespace', () => {
    expect(normalizeCodeLanguage('  TypeScript \n')).toBe(CodeLanguage.TypeScript);
    expect(normalizeCodeLanguage('Objective-C')).toBe(CodeLanguage.ObjectiveC);
    expect(normalizeCodeLanguage('\tPY')).toBe(CodeLanguage.Python);
    expect(normalizeCodeLanguage('C#')).toBe(CodeLanguage.CSharp);
  });

  it('composes with the converters', () => {
    expect(toHighlightJsLanguage(normalizeCodeLanguage('py')!)).toBe('python');
    expect(toShikiLanguage(normalizeCodeLanguage('objectivec')!)).toBe('objective-c');
    expect(normalizeCodeLanguage('x86asm')).toBe(CodeLanguage.Assembly);
    expect(normalizeCodeLanguage('vbnet')).toBe(CodeLanguage.VisualBasic);
  });

  it('an exact value wins over a highlighter alias', () => {
    expect(normalizeCodeLanguage('html')).toBe(CodeLanguage.Html);
    expect(normalizeCodeLanguage('jsx')).toBe(CodeLanguage.Jsx);
    expect(normalizeCodeLanguage('tsx')).toBe(CodeLanguage.Tsx);
    expect(normalizeCodeLanguage('toml')).toBe(CodeLanguage.Toml);
  });

  it('round-trips the Shiki name of every language', () => {
    for (const language of ALL) expect(normalizeCodeLanguage(toShikiLanguage(language))).toBe(language);
  });

  it('round-trips the highlight.js name of every language except the documented lossy ones', () => {
    for (const language of ALL) {
      const expected = LOSSY_HIGHLIGHT_JS.get(language) ?? language;
      expect(normalizeCodeLanguage(toHighlightJsLanguage(language)), `${language}`).toBe(expected);
    }
  });

  it('resolves every highlight.js alias of the mapped grammars', () => {
    let checked = 0;
    for (const language of ALL) {
      if (LOSSY_HIGHLIGHT_JS.has(language)) continue;
      const name = toHighlightJsLanguage(language);
      const grammar = hljs.getLanguage(name);
      if (!grammar) continue; // zig: not built into highlight.js
      for (const alias of grammar.aliases ?? []) {
        const expected = HIGHLIGHT_JS_EXCEPTIONS.has(alias) ? HIGHLIGHT_JS_EXCEPTIONS.get(alias) : language;
        expect(normalizeCodeLanguage(alias), `highlight.js alias ${alias} of ${name}`).toBe(expected);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(40);
  });

  it('resolves every Shiki id and alias of the 42 languages', () => {
    for (const language of ALL) {
      const info = bundledLanguagesInfo.find((entry) => entry.id === language || entry.aliases?.includes(language));
      expect(info, `${language} is not bundled in Shiki`).toBeDefined();
      for (const name of [info!.id, ...(info!.aliases ?? [])]) {
        expect(normalizeCodeLanguage(name), `Shiki name ${name}`).toBe(language);
      }
    }
  });

  it('leaves ambiguous names unresolved', () => {
    for (const name of [
      'm',
      's',
      'sc',
      'conf',
      'cfg',
      'console',
      'sass',
      'gradle',
      'jsonl',
      'mipsasm',
      'jsonc',
      'json5',
    ]) {
      expect(normalizeCodeLanguage(name), name).toBe(null);
    }
  });

  it('returns null for names outside the 42 languages', () => {
    for (const name of ['mermaid', 'haskell', '', '   ', 'text', 'constructor', '__proto__']) {
      expect(normalizeCodeLanguage(name), JSON.stringify(name)).toBe(null);
    }
  });
});

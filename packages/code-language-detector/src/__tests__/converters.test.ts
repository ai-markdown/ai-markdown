import hljs from 'highlight.js';
import { bundledLanguages } from 'shiki';
import { describe, expect, it } from 'vitest';
import { toHighlightJsLanguage, toShikiLanguage } from '../converters';
import { CodeLanguage } from '../language';

const ALL = Object.values(CodeLanguage);

describe('toShikiLanguage', () => {
  it('is the identity', () => {
    for (const language of ALL) expect(toShikiLanguage(language)).toBe(language);
  });

  it('returns a bundled Shiki language id or alias for every language', () => {
    for (const language of ALL) {
      expect(Object.hasOwn(bundledLanguages, toShikiLanguage(language)), `${language} is not bundled in Shiki`).toBe(
        true
      );
    }
  });
});

describe('toHighlightJsLanguage', () => {
  it('returns a registered highlight.js language for every language except zig', () => {
    for (const language of ALL) {
      if (language === CodeLanguage.Zig) continue;
      const name = toHighlightJsLanguage(language);
      expect(hljs.getLanguage(name), `${language} → ${name} is not a highlight.js language`).toBeDefined();
    }
  });

  it('maps zig to zig, which highlight.js does not ship but third-party grammars register', () => {
    expect(toHighlightJsLanguage(CodeLanguage.Zig)).toBe('zig');
    expect(hljs.getLanguage('zig')).toBeUndefined();
  });

  it('renames the languages highlight.js spells differently', () => {
    expect(toHighlightJsLanguage(CodeLanguage.ObjectiveC)).toBe('objectivec');
    expect(toHighlightJsLanguage(CodeLanguage.VisualBasic)).toBe('vbnet');
    expect(toHighlightJsLanguage(CodeLanguage.Assembly)).toBe('x86asm');
    expect(toHighlightJsLanguage(CodeLanguage.Jsx)).toBe('javascript');
    expect(toHighlightJsLanguage(CodeLanguage.Tsx)).toBe('typescript');
  });

  it('maps html, vue and svelte to the xml grammar', () => {
    // highlight.js has no Vue or Svelte grammar; xml highlights their <script>
    // and <style> blocks as JavaScript and CSS sub-languages.
    expect(toHighlightJsLanguage(CodeLanguage.Html)).toBe('xml');
    expect(toHighlightJsLanguage(CodeLanguage.Vue)).toBe('xml');
    expect(toHighlightJsLanguage(CodeLanguage.Svelte)).toBe('xml');
    expect(hljs.getLanguage('vue')).toBeUndefined();
    expect(hljs.getLanguage('svelte')).toBeUndefined();
  });

  it('keeps every other language unchanged', () => {
    const renamed = new Set<string>(['objective-c', 'vb', 'asm', 'jsx', 'tsx', 'html', 'vue', 'svelte']);
    for (const language of ALL) {
      if (renamed.has(language)) continue;
      expect(toHighlightJsLanguage(language)).toBe(language);
    }
  });
});

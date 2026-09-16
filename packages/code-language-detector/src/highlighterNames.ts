import { normalizeCodeLanguage } from './aliases';
import { toHighlightJsLanguage, toShikiLanguage } from './converters';

/** One language's name in each highlighter */
interface HighlighterNames {
  highlightJs: string;
  shiki: string;
}

const PLAIN_TEXT: HighlighterNames = { highlightJs: 'plaintext', shiki: 'text' };

/**
 * Names models commonly write for languages outside the 42, where the two
 * highlighters spell the language differently or only one of them knows the
 * name. A name both highlighters already accept as written (`haskell`,
 * `graphql`, `jsonc`) is not listed: it passes through unchanged.
 *
 * Every target is checked against highlight.js's registered grammars and
 * Shiki's bundled languages by the tests.
 */
const OTHER_LANGUAGES: ReadonlyMap<string, HighlighterNames> = new Map([
  // No highlighting wanted. Shiki treats `text` as plain text without loading a grammar.
  ...spellings(['', 'text', 'txt', 'plain', 'plaintext', 'none', 'nohighlight', 'output'], PLAIN_TEXT),
  // A terminal transcript with prompts and output, not a script.
  ...spellings(['console', 'shellsession', 'shell-session', 'sh-session'], {
    highlightJs: 'shell',
    shiki: 'shellsession',
  }),
  // Objective-C++, which Shiki highlights with its own grammar.
  ...spellings(['objective-c++', 'objective-cpp', 'objc++', 'obj-c++', 'objcpp', 'mm'], {
    highlightJs: 'objectivec',
    shiki: 'objective-cpp',
  }),
  ...spellings(['batch', 'bat', 'cmd', 'dos'], { highlightJs: 'dos', shiki: 'bat' }),
  ...spellings(['makefile', 'make', 'mk', 'mak'], { highlightJs: 'makefile', shiki: 'make' }),
  ...spellings(['coffeescript', 'coffee', 'cson'], { highlightJs: 'coffeescript', shiki: 'coffee' }),
  ...spellings(['fortran', 'f90', 'f95'], { highlightJs: 'fortran', shiki: 'fortran-free-form' }),
  ...spellings(['pascal', 'delphi', 'dpr'], { highlightJs: 'delphi', shiki: 'pascal' }),
  ...spellings(['vim', 'viml', 'vimscript'], { highlightJs: 'vim', shiki: 'viml' }),
  // highlight.js files Jinja under its Django template grammar.
  ...spellings(['jinja', 'jinja2', 'django'], { highlightJs: 'django', shiki: 'jinja' }),
  ...spellings(['mathematica', 'wolfram', 'wl', 'mma'], { highlightJs: 'mathematica', shiki: 'wolfram' }),
  ...spellings(['lisp', 'common-lisp'], { highlightJs: 'lisp', shiki: 'common-lisp' }),
  ...spellings(['protobuf', 'proto'], { highlightJs: 'protobuf', shiki: 'proto' }),
  ...spellings(['diff', 'patch'], { highlightJs: 'diff', shiki: 'diff' }),
  ...spellings(['elixir', 'ex', 'exs'], { highlightJs: 'elixir', shiki: 'elixir' }),
  ...spellings(['perl', 'pl', 'pm'], { highlightJs: 'perl', shiki: 'perl' }),
  // One JSON value per line; highlight.js has no line-delimited variant, and its JSON grammar reads each line.
  ...spellings(['jsonl', 'ndjson'], { highlightJs: 'json', shiki: 'jsonl' }),
]);

function spellings(names: readonly string[], target: HighlighterNames): [string, HighlighterNames][] {
  return names.map((name) => [name, target]);
}

/**
 * The Shiki language name for a language name as a model or a person writes it
 * in a code fence (`py`, `objc`, `C++`, `txt`, `haskell`).
 *
 * Case-insensitive; surrounding whitespace is ignored. A name of one of the 42
 * detected languages resolves through {@link normalizeCodeLanguage} and
 * {@link toShikiLanguage}; a common name outside them whose Shiki spelling
 * differs is translated (`makefile` → `make`, `batch` → `bat`, `txt` → `text`);
 * any other name comes back lower-cased as written, since it may well be a
 * language Shiki knows. An empty name is plain text.
 *
 * The result is a name, not a guarantee that the language is loaded.
 */
export function normalizeShikiLanguage(name: string): string {
  const key = name.trim().toLowerCase();
  const language = normalizeCodeLanguage(key);
  if (language) return toShikiLanguage(language);
  return OTHER_LANGUAGES.get(key)?.shiki ?? key;
}

/**
 * The highlight.js language name for a language name as a model or a person
 * writes it in a code fence (`py`, `objc`, `Vue`, `txt`, `haskell`).
 *
 * Case-insensitive; surrounding whitespace is ignored. A name of one of the 42
 * detected languages resolves through {@link normalizeCodeLanguage} and
 * {@link toHighlightJsLanguage} (so `vue` becomes `xml`); a common name outside
 * them whose highlight.js spelling differs is translated (`viml` → `vim`,
 * `txt` → `plaintext`); any other name comes back lower-cased as written. An
 * empty name is plain text.
 *
 * The result is a name, not a guarantee that the grammar is registered: check
 * `hljs.getLanguage(name)`.
 */
export function normalizeHighlightJsLanguage(name: string): string {
  const key = name.trim().toLowerCase();
  const language = normalizeCodeLanguage(key);
  if (language) return toHighlightJsLanguage(language);
  return OTHER_LANGUAGES.get(key)?.highlightJs ?? key;
}

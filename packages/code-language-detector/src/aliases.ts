import { CodeLanguage, type LanguageId } from './language';

/**
 * Names people and tools use for the 42 languages, lowercase, mapped to the
 * language they mean.
 *
 * Sources: the aliases highlight.js registers for its grammars (plus the
 * grammar names that differ from ours: `objectivec`, `vbnet`, `x86asm`), the
 * ids and aliases in Shiki's `bundledLanguagesInfo`, and common spellings in
 * code fence info strings and file extensions.
 *
 * Only names that unambiguously mean one of the 42 languages are listed; the
 * enum values themselves are matched before this table. Names deliberately
 * left out, so they resolve to `null` and callers can pass them through to a
 * highlighter unchanged:
 *   - `m`: Objective-C and MATLAB both use `.m`, and highlight.js resolves `m`
 *     to Mercury.
 *   - `s`: assembly for GNU as, but a single letter says too little.
 *   - `sc`: Scala worksheets, but also SuperCollider.
 *   - `conf`, `cfg`: nginx, Apache and countless other formats, rarely INI.
 *   - `console`: a shell session with prompts and output; both highlighters
 *     have a separate shell-session grammar.
 *   - `sass`: the indented syntax is not SCSS, and Shiki has its own grammar.
 *   - `jsp`: HTML with embedded Java, which highlight.js files under `java`.
 *   - `mm`, `obj-c++`, `objective-c++`: Objective-C++, which Shiki highlights
 *     with a separate grammar; highlight.js files them under `objectivec`.
 *   - `pluto`: a Lua superset, which highlight.js files under `lua`.
 *   - `gradle`: a build script in Groovy or Kotlin; highlight.js has a
 *     dedicated grammar.
 *   - `jsonc`, `json5`: JSON supersets with their own Shiki grammars; mapped to
 *     `json`, a Shiki user would lose them. highlight.js knows both names as
 *     aliases of `json`, so passing them through works for either highlighter.
 *   - `jsonl`, `mipsasm`, `shellsession`, `objective-cpp`, `vue-html` and other
 *     Shiki ids that name a related but distinct language.
 */
const ALIASES: ReadonlyMap<string, LanguageId> = new Map<string, LanguageId>([
  // ECMAScript
  ['js', 'javascript'],
  ['mjs', 'javascript'],
  ['cjs', 'javascript'],
  // Fence info string for Node.js snippets; not a highlighter alias.
  ['node', 'javascript'],
  ['ts', 'typescript'],
  ['mts', 'typescript'],
  ['cts', 'typescript'],

  // Data and configuration
  ['yml', 'yaml'],
  // Java .properties files are key=value lines; Shiki files them under `ini`.
  ['properties', 'ini'],

  // Markup and documents
  ['htm', 'html'],
  // XML-serialized HTML: the content is an HTML document, although highlight.js files it under `xml`.
  ['xhtml', 'html'],
  // XML dialects that highlight.js files under `xml`.
  ['svg', 'xml'],
  ['rss', 'xml'],
  ['atom', 'xml'],
  ['xsd', 'xml'],
  ['xsl', 'xml'],
  ['xjb', 'xml'],
  // Windows Script Files are XML documents wrapping script blocks.
  ['wsf', 'xml'],
  // Property lists in code fences are XML plists; the old ASCII format is rare.
  ['plist', 'xml'],
  ['md', 'markdown'],
  ['mkd', 'markdown'],
  ['mkdown', 'markdown'],

  // C family
  // A header can be C, C++ or Objective-C; like highlight.js (and the detector's own tie-break), C is the default.
  ['h', 'c'],
  ['c++', 'cpp'],
  ['cc', 'cpp'],
  ['cxx', 'cpp'],
  ['hpp', 'cpp'],
  ['hh', 'cpp'],
  ['hxx', 'cpp'],
  ['h++', 'cpp'],
  ['objc', 'objective-c'],
  ['obj-c', 'objective-c'],
  ['objectivec', 'objective-c'],

  // JVM and .NET
  ['cs', 'csharp'],
  ['c#', 'csharp'],
  ['kt', 'kotlin'],
  ['kts', 'kotlin'],
  ['ktm', 'kotlin'],
  ['ktx', 'kotlin'],

  // Modern C-like
  ['golang', 'go'],
  ['rs', 'rust'],

  // Independent
  ['py', 'python'],
  ['python3', 'python'],
  // GYP build files are Python literals; highlight.js files them under `python`.
  ['gyp', 'python'],
  ['ipython', 'python'],
  ['rb', 'ruby'],
  // CocoaPods and Thor files are Ruby DSLs, irb is the Ruby REPL; highlight.js files all three under `ruby`.
  ['gemspec', 'ruby'],
  ['podspec', 'ruby'],
  ['thor', 'ruby'],
  ['irb', 'ruby'],
  // SQL dialect names used as fence info strings.
  ['mysql', 'sql'],
  ['postgres', 'sql'],
  ['postgresql', 'sql'],
  ['plpgsql', 'sql'],
  ['vbnet', 'vb'],
  ['visual-basic', 'vb'],
  // VBA is not VB.NET, but it is Visual Basic syntax, and neither highlighter has a separate VBA grammar.
  ['vba', 'vb'],
  // GNU Octave is largely MATLAB-compatible, and neither highlighter has an Octave grammar.
  ['octave', 'matlab'],
  ['jl', 'julia'],
  ['assembly', 'asm'],
  ['x86asm', 'asm'],
  ['nasm', 'asm'],

  // Shells, scripting hosts and build files
  ['ps1', 'powershell'],
  ['pwsh', 'powershell'],
  // PostScript also uses .ps, but both highlighters file `ps` under PowerShell.
  ['ps', 'powershell'],
  ['sh', 'bash'],
  ['zsh', 'bash'],
  ['shell', 'bash'],
  ['shellscript', 'bash'],
  ['osascript', 'applescript'],
  ['docker', 'dockerfile'],
]);

const LANGUAGE_IDS: ReadonlySet<string> = new Set(Object.values(CodeLanguage));

/**
 * Resolves a language name as written by a person or another tool (a code
 * fence info string, a file extension, a highlight.js or Shiki name or alias)
 * to a `CodeLanguage`.
 *
 * Case-insensitive; surrounding whitespace is ignored. An exact `CodeLanguage`
 * value always wins over an alias: `html` is `CodeLanguage.Html` even though
 * highlight.js lists `html` as an alias of `xml`, and likewise `jsx`, `tsx` and
 * `toml`.
 *
 * Returns `null` when the name means none of the 42 languages. That does not
 * mean the name is invalid: `haskell` is a perfectly good highlighter language.
 * Pass the original name through to the highlighter in that case.
 */
export function normalizeCodeLanguage(name: string): CodeLanguage | null {
  const key = name.trim().toLowerCase();
  // The enum values are exactly the LanguageId literals, so both casts are type-level only.
  if (LANGUAGE_IDS.has(key)) return key as CodeLanguage;
  return (ALIASES.get(key) as CodeLanguage | undefined) ?? null;
}

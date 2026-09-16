/**
 * The languages this package can detect.
 *
 * Every value is a Shiki language id, so a detected language can be handed to
 * Shiki as is (see `toShikiLanguage`). highlight.js names a few of them
 * differently; use `toHighlightJsLanguage` for that.
 */
export enum CodeLanguage {
  // ECMAScript
  JavaScript = 'javascript',
  TypeScript = 'typescript',
  Jsx = 'jsx',
  Tsx = 'tsx',
  // Data and configuration
  Json = 'json',
  Yaml = 'yaml',
  Toml = 'toml',
  Ini = 'ini',
  // Markup and documents
  Html = 'html',
  Xml = 'xml',
  Markdown = 'markdown',
  // Stylesheets
  Css = 'css',
  Scss = 'scss',
  Less = 'less',
  // Single-file components
  Vue = 'vue',
  Svelte = 'svelte',
  // C family
  C = 'c',
  Cpp = 'cpp',
  ObjectiveC = 'objective-c',
  // JVM and .NET
  Java = 'java',
  CSharp = 'csharp',
  Kotlin = 'kotlin',
  Groovy = 'groovy',
  Scala = 'scala',
  // Modern C-like
  Go = 'go',
  Rust = 'rust',
  Swift = 'swift',
  Zig = 'zig',
  Dart = 'dart',
  // Independent
  Python = 'python',
  Ruby = 'ruby',
  Php = 'php',
  Lua = 'lua',
  Sql = 'sql',
  VisualBasic = 'vb',
  Matlab = 'matlab',
  Julia = 'julia',
  Assembly = 'asm',
  // Shells, scripting hosts and build files
  PowerShell = 'powershell',
  Bash = 'bash',
  AppleScript = 'applescript',
  Dockerfile = 'dockerfile',
}

/**
 * The internal spelling of a language: the literal union of the enum values
 * (`'javascript' | 'typescript' | …`).
 *
 * Rule files, families and the popularity table are written with string
 * literals so they stay readable. `CodeLanguage` is assignable to this type,
 * so public results flow back into internal helpers without a cast; the other
 * direction happens once, at the public boundary in `detector.ts`.
 *
 * Internal modules import this module with `import type` only. That keeps the
 * enum (which is not erasable TypeScript) out of their runtime import graph,
 * so the dev scripts can load the sources with Node's native type stripping.
 */
export type LanguageId = `${CodeLanguage}`;

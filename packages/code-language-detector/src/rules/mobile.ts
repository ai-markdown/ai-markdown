import type { DetectionRule } from '../types';

/**
 * Kotlin / Swift / Dart.
 * These three share many keywords with Java / TS (fun/func, val/var, class),
 * so every rule picks combinations unique to its language where possible and gives lookalike languages a
 * negative score.
 */
export const mobileRules: DetectionRule[] = [
  // ── Kotlin ──────────────────────────────────────────────────────
  {
    id: 'kt-fun',
    pattern: /^[ \t]*(?:(?:private|public|internal|suspend|override|inline)\s+)*fun\s+\w+\s*\(/m,
    scores: { kotlin: 10, java: -3 },
  },
  {
    id: 'kt-val-decl',
    // Only Kotlin / Scala have `val` (Swift uses let). Leading modifiers are allowed:
    // in real Kotlin classes `private val` is far more common than a bare `val`
    pattern: /^[ \t]*(?:(?:private|public|internal|protected|override|open|const|lateinit)\s+){0,3}val\s+\w+/m,
    scores: { kotlin: 7, scala: 4, java: -2, typescript: -2 },
  },
  {
    id: 'kt-lateinit',
    pattern: /\blateinit\s+var\b/,
    scores: { kotlin: 10 },
    definitive: 'kotlin',
  },
  {
    id: 'kt-class-primary-ctor',
    // `class Foo(ctx: Context)` primary constructor: unique to Kotlin / Scala;
    // in TS / Java a class name cannot be followed directly by a parameter list
    pattern:
      /^[ \t]*(?:(?:data|open|abstract|internal|private|public|sealed)\s+){0,3}class\s+\w+\s*(?:<[^>\n]{0,40}>)?\s*\(\s*(?:(?:private|val|var|override)\s+){0,2}\w+\s*:\s*[A-Z]/m,
    scores: { kotlin: 7, scala: 5, typescript: -3, java: -3 },
  },
  {
    id: 'kt-data-class',
    pattern: /\bdata\s+class\s+\w+/,
    scores: { kotlin: 11, java: -4 },
    definitive: 'kotlin',
  },
  {
    id: 'jvm-sealed-class',
    // sealed class is valid in Kotlin / C# / Java 17, so unlike data class it cannot belong to one language
    pattern: /\bsealed\s+(?:class|interface)\s+\w+/,
    scores: { kotlin: 5, csharp: 5, java: 3 },
  },
  {
    id: 'kt-safe-call',
    pattern: /\?\.\w+|\?:\s*\w|\.let\s*\{|\bcompanion\s+object\b/,
    scores: { kotlin: 6 },
  },
  {
    id: 'kt-println',
    // Kotlin uses a bare println, Java uses System.out.println
    pattern: /^[ \t]*println\s*\(/m,
    scores: { kotlin: 7, java: -2 },
  },

  {
    id: 'kt-package-no-semicolon',
    // Kotlin package names are dotted with no semicolon: right between Java (semicolon required) and Go
    // (a single word)
    pattern: /^[ \t]*package\s+[a-z][\w.]*\.[\w]+[ \t]*$/m,
    scores: { kotlin: 9, java: -2, go: -2 },
  },
  {
    id: 'kt-import-no-semicolon',
    // A dotted import without a semicolon has the same form in Kotlin / Scala / Python, so the scores are split
    // equally; the actual owner is decided by unique evidence such as scala-import-selector and py-from-import
    pattern: /^[ \t]*import\s+[a-z][\w.]*\.[\w*]+[ \t]*$/m,
    scores: { kotlin: 3, scala: 3, python: 3, java: -2 },
  },
  {
    id: 'kt-class-inherit-colon',
    pattern: /^[ \t]*(?:(?:open|abstract|internal|private)\s+)*class\s+\w+(?:\([^)\n]{0,120}\))?\s*:\s*[A-Z]\w*/m,
    scores: { kotlin: 7, swift: 4, java: -2, typescript: -2 },
  },
  {
    id: 'kt-when-expression',
    pattern: /\bwhen\s*(?:\([^)\n]{0,60}\))?\s*\{/,
    scores: { kotlin: 7 },
  },
  {
    id: 'kt-nullable-type',
    // Nullable type annotations such as Bundle? / String? are shared by Kotlin and Swift
    pattern: /:\s*[A-Z]\w*\?(?:\s*[=),{]|$)/m,
    scores: { kotlin: 5, swift: 4, typescript: -2 },
  },

  // ── Swift ───────────────────────────────────────────────────────
  {
    id: 'sw-func',
    pattern: /^[ \t]*(?:(?:public|private|internal|override|static|class)\s+)*func\s+\w+\s*\(/m,
    scores: { swift: 10, kotlin: -3 },
  },
  {
    id: 'sw-init',
    // A `public init(...)` initializer is unique to Swift: TS writes constructor, and Kotlin's init is a block
    // without parameters
    pattern: /^[ \t]*(?:(?:public|private|internal|fileprivate|required|convenience|override)\s+){0,3}init\s*\(/m,
    scores: { swift: 8, typescript: -3 },
  },
  {
    id: 'sw-kt-scalar-type',
    // `: Int` / `: Bool` / `: Double`: primitive type names of Swift / Kotlin / Scala; TS writes them in lowercase
    pattern: /:\s*(?:Int(?:8|16|32|64)?|UInt(?:8|16|32|64)?|Double|Float|Bool|CGFloat)\b(?![.(])/,
    scores: { swift: 4, kotlin: 4, scala: 3, typescript: -3 },
  },
  {
    id: 'sw-guard-let',
    pattern: /\bguard\s+let\s+\w+|\bif\s+let\s+\w+\s*=/,
    scores: { swift: 11 },
    definitive: 'swift',
  },
  {
    id: 'sw-attribute',
    pattern: /@(?:IBOutlet|IBAction|objc|State|Published|escaping|MainActor)\b/,
    scores: { swift: 10 },
  },
  {
    id: 'sw-optional-type',
    pattern: /:\s*\[?[A-Z]\w*\]?\?(?:\s*[=){,]|$)/m,
    scores: { swift: 5, kotlin: 2 },
  },
  {
    id: 'sw-import-foundation',
    pattern: /^[ \t]*import\s+(?:Foundation|UIKit|SwiftUI|Combine)\b/m,
    scores: { swift: 11 },
    definitive: 'swift',
  },

  {
    id: 'sw-class-inherit',
    pattern: /^[ \t]*(?:(?:final|open|public|private)\s+)*(?:class|struct|enum)\s+\w+\s*:\s*[A-Z]\w*/m,
    scores: { swift: 6, kotlin: 3, typescript: -2 },
  },
  {
    id: 'sw-import-single-word',
    // A Swift import is followed by a single capitalised module name, with no dot and no semicolon
    pattern: /^[ \t]*import\s+[A-Z]\w*[ \t]*$/m,
    scores: { swift: 7, kotlin: -1 },
  },
  {
    id: 'sw-xctest',
    pattern: /\bXCT(?:Assert|Fail|Unwrap)\w*\s*\(|:\s*XCTestCase\b/,
    scores: { swift: 12 },
    definitive: 'swift',
  },
  {
    id: 'sw-final-class-struct',
    pattern: /^[ \t]*(?:final\s+class|struct|extension|protocol)\s+\w+/m,
    scores: { swift: 6, kotlin: -1, typescript: -2 },
  },
  {
    id: 'sw-string-interpolation',
    pattern: /\\\([\w.]+\)/,
    scores: { swift: 7 },
  },
  {
    id: 'kt-suspend-coroutine',
    pattern: /\bsuspend\s+fun\b|\b(?:launch|runBlocking|withContext)\s*[({]/,
    scores: { kotlin: 9 },
  },

  // ── Dart ────────────────────────────────────────────────────────
  {
    id: 'dart-main-void',
    pattern: /^[ \t]*void\s+main\s*\(\s*\)\s*(?:async\s*)?\{/m,
    scores: { dart: 9, java: -2 },
  },
  {
    id: 'dart-widget-build',
    pattern: /Widget\s+build\s*\(\s*BuildContext|\bStatelessWidget\b|\bStatefulWidget\b/,
    scores: { dart: 12 },
    definitive: 'dart',
  },
  {
    id: 'dart-import-package',
    pattern: /^[ \t]*import\s+['"](?:package:|dart:)/m,
    scores: { dart: 12 },
    definitive: 'dart',
  },
  {
    id: 'dart-final-const',
    pattern: /^[ \t]*(?:final|const)\s+\w+(?:<[^>\n]{0,40}>)?\s+\w+\s*=/m,
    scores: { dart: 5 },
  },
  {
    id: 'dart-part-directive',
    // part 'x.dart'; / part of 'x.dart'; / part of library_name; split a Dart library across files
    pattern: /^part[ \t]+(?:of[ \t]+)?(?:['"][^'"\n]{1,200}\.dart['"]|[a-z_][\w.]{0,80})[ \t]*;/m,
    scores: { dart: 14, java: -6 },
    definitive: 'dart',
  },
  {
    id: 'dart-factory-constructor',
    // factory Name(...) / factory Name.named(...): no other language has a factory keyword
    pattern: /^[ \t]*(?:const[ \t]+)?factory[ \t]+[A-Z]\w{0,60}(?:\.\w{1,60})?[ \t]*\(/m,
    scores: { dart: 12, java: -4 },
    definitive: 'dart',
  },
  {
    id: 'dart-named-param',
    // Must directly follow the opening parenthesis of a parameter list. It used to match any `{ word word }`,
    // so `{ return 0 }` in any language was taken for Dart named parameters.
    pattern: /\(\s*\{\s*(?:required\s+)?[A-Za-z_]\w*\??\s+\w+(?:\s*=\s*[^,}\n]{1,40})?\s*[,}]/,
    scores: { dart: 4 },
  },
];

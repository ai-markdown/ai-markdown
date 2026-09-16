import type { DetectionRule } from '../types';

/**
 * Java and C# overlap heavily in syntax (class / public / using-import / annotations),
 * so nearly every rule here also gives the other a negative score, and combined evidence separates them.
 */
export const javaRules: DetectionRule[] = [
  {
    id: 'java-main',
    pattern: /\bpublic\s+static\s+void\s+main\s*\(/,
    scores: { java: 11, csharp: -3 },
    definitive: 'java',
  },
  {
    id: 'java-sysout',
    pattern: /\bSystem\.(?:out|err)\.print(?:ln|f)?\s*\(/,
    scores: { java: 11, csharp: -4 },
    definitive: 'java',
  },
  {
    id: 'java-package-decl',
    // A dotted package name with a semicolon, which separates it from Go's `package main`
    pattern: /^[ \t]*package\s+[a-z][\w.]*\s*;/m,
    scores: { java: 9, go: -4 },
  },
  {
    id: 'java-import',
    pattern: /^[ \t]*import\s+(?:static\s+)?(?:java|javax|android|org|com)\.[\w.]+\s*;/m,
    scores: { java: 9, csharp: -2 },
  },
  {
    id: 'java-annotation',
    pattern: /^[ \t]*@(?:Override|Deprecated|SuppressWarnings|Test|Entity|Service|Component|Autowired)\b/m,
    scores: { java: 8 },
  },
  {
    id: 'java-generic-collection',
    pattern: /\b(?:List|Map|Set|ArrayList|HashMap|HashSet)\s*<[^>\n]{0,60}>\s+\w+/,
    scores: { java: 6, csharp: 2 },
  },
  {
    id: 'java-class-decl',
    pattern: /^[ \t]*(?:public|private|protected)?\s*(?:final\s+|abstract\s+)?class\s+\w+/m,
    // A bare class is valid in JS/TS/Java/C#/Dart, so the split must be equal:
    // scoring only java/csharp would leave javascript out of the candidates of a plain JS class snippet
    scores: { java: 4, csharp: 4, typescript: 4, javascript: 4, dart: 3 },
    description: 'Common across languages; only narrows the candidates, does not separate them',
  },
  {
    id: 'java-throws',
    pattern: /\)\s*throws\s+\w+(?:Exception|Error)\b/,
    scores: { java: 8, csharp: -2 },
  },
  {
    id: 'java-string-fmt',
    pattern: /\bString\.(?:format|valueOf|join)\s*\(/,
    scores: { java: 6, csharp: -1 },
  },
];

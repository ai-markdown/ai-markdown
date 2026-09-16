import type { DetectionRule } from '../types';

export const goRules: DetectionRule[] = [
  {
    id: 'go-package',
    pattern: /^[ \t]*package\s+[a-z]\w*\s*$/m,
    scores: { go: 11 },
    definitive: 'go',
    description: "Go's package declaration has no semicolon, which separates it cleanly from Java's package a.b.c;",
  },
  {
    id: 'go-unquoted-dotted-import',
    // Counter-evidence: Go import paths must be quoted, so an unquoted dotted import means this is not Go.
    // The negative score has to outweigh go-package's 11 points, so the definitive rule drops out of the
    // "only surviving definitive" check.
    // No semicolon allowed at the end of the line, which rules out Java (handled by the java-import rule).
    pattern: /^[ \t]*import\s+[a-z][\w]*\.[\w.*{}, ]{1,120}[ \t]*$/m,
    scores: { go: -14, scala: 4, kotlin: 4 },
  },
  {
    id: 'go-func',
    pattern: /^[ \t]*func\s+(?:\([^)\n]{0,60}\)\s*)?\w+\s*\(/m,
    scores: { go: 9 },
  },
  {
    id: 'go-short-decl',
    // Only requires one word character before :=. The previous \w{1,60} consumed up to 60 characters at every
    // position before failing and was the slowest of all rules (0.4ms on 20K input), without being any stricter
    pattern: /\w\s*:=\s*\S/,
    scores: { go: 6 },
  },
  {
    id: 'go-err-check',
    pattern: /if\s+err\s*!=\s*nil/,
    scores: { go: 10 },
  },
  {
    id: 'go-import-block',
    pattern: /^[ \t]*import\s+\(\s*$/m,
    scores: { go: 8 },
  },
  {
    id: 'go-defer-go',
    pattern: /^[ \t]*(?:defer|go)\s+\w+[.(]/m,
    scores: { go: 7 },
  },
  {
    id: 'go-fmt',
    pattern: /\bfmt\.(?:Print|Sprint|Errorf)\w*\(/,
    scores: { go: 9 },
  },
  {
    id: 'go-chan-make',
    pattern: /\bmake\(\s*(?:chan|\[\]|map\[)/,
    scores: { go: 8 },
  },
  {
    id: 'go-struct-interface',
    pattern: /^[ \t]*type\s+\w+\s+(?:struct|interface)\s*\{/m,
    scores: { go: 9, typescript: -3 },
  },
];

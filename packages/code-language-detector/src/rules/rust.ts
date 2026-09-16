import type { DetectionRule } from '../types';

export const rustRules: DetectionRule[] = [
  {
    id: 'rs-fn',
    pattern: /^[ \t]*(?:pub\s+)?(?:async\s+)?fn\s+\w+/m,
    scores: { rust: 10 },
  },
  {
    id: 'rs-let-mut',
    pattern: /\blet\s+mut\s+\w+/,
    scores: { rust: 10 },
    definitive: 'rust',
  },
  {
    id: 'rs-macro-call',
    pattern: /\b(?:println|print|format|vec|panic|write|assert(?:_eq|_ne)?)!\s*[([]/,
    scores: { rust: 10 },
    definitive: 'rust',
  },
  {
    id: 'rs-use-path',
    // `use std::` is not valid C++ (C++ writes using), so cpp gets a strong negative score along the way:
    // otherwise the line `use std::collections::HashMap;` also fires cpp-std-namespace,
    // and the very first streamed line ties cpp with rust
    pattern: /^[ \t]*use\s+(?:std|crate|self|super)::/m,
    scores: { rust: 10, cpp: -12, c: -3 },
    definitive: 'rust',
  },
  {
    id: 'rs-std-module-path',
    // Rust standard library module paths: std::collections:: / std::fmt:: / std::io:: and so on.
    // In C++, std:: is followed directly by a type or function (std::vector, std::cout)
    // and rarely by another :: level (the exceptions are chrono / filesystem, deliberately not listed here)
    pattern:
      /\bstd::(?:collections|fmt|io|env|fs|path|process|sync|time|mem|cmp|ops|iter|rc|cell|net|error|convert|str|vec|option|result|marker|any|hash|ffi|os|borrow|boxed|char|num|ptr|slice|alloc|thread|future|task|pin)::\w/,
    scores: { rust: 6, cpp: -10 },
  },
  {
    id: 'rs-attribute',
    pattern: /^[ \t]*#\[[\w()\s,:"=]{1,120}\]/m,
    scores: { rust: 8 },
  },
  {
    id: 'rs-impl',
    pattern: /^[ \t]*impl(?:<[^>\n]{0,40}>)?\s+\w+/m,
    scores: { rust: 9 },
  },
  {
    id: 'rs-result-option',
    pattern: /\b(?:Result|Option)\s*<[^>\n]{0,60}>/,
    scores: { rust: 5 },
  },
  {
    id: 'rs-match-arm',
    pattern: /^[ \t]*match\s+[\w.&*]+\s*\{/m,
    scores: { rust: 6 },
  },
  {
    id: 'rs-ref-borrow',
    pattern: /&(?:mut\s+)?self\b|->\s*(?:Result|Option|Self|&|String|Vec)\b/,
    scores: { rust: 7 },
  },
  {
    id: 'rs-unwrap-expect',
    pattern: /\.(?:unwrap|expect)\(\s*\)?|\?;\s*$/m,
    scores: { rust: 5 },
  },
  {
    id: 'rs-derive',
    pattern: /#\[derive\(/,
    scores: { rust: 10 },
    definitive: 'rust',
  },
];

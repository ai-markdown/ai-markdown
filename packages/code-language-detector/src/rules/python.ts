import type { DetectionRule } from '../types';

export const pythonRules: DetectionRule[] = [
  {
    id: 'py-def',
    // The trailing colon is the key: without it this is just an ordinary function declaration that may belong to
    // another language
    pattern: /^[ \t]*def\s+\w+\s*\([^)\n]{0,200}\)\s*(?:->[^\n:]{0,60})?:/m,
    scores: { python: 10 },
    definitive: 'python',
  },
  {
    id: 'py-class-colon',
    pattern: /^[ \t]*class\s+\w+\s*(?:\([^)\n]{0,120}\))?\s*:/m,
    scores: { python: 9 },
  },
  {
    id: 'py-from-import',
    // Only Python writes from x import y
    pattern: /^[ \t]*from\s+[\w.]{1,80}\s+import\s/m,
    scores: { python: 8 },
  },
  {
    id: 'py-import-single',
    // Single-segment import os / import numpy as np. The dotted import a.b.c is left to the equal split in
    // kt-import-no-semicolon: Kotlin / Scala use that shape too
    pattern: /^[ \t]*import\s+[a-z_]\w{0,40}(?:\s+as\s+\w{1,40})?[ \t]*$/m,
    scores: { python: 6 },
  },
  {
    id: 'py-import-dotted-as',
    // import matplotlib.pyplot as plt: Kotlin supports as aliases too; Scala uses =>
    pattern: /^[ \t]*import\s+[a-z_][\w.]{1,80}\s+as\s+\w{1,40}[ \t]*$/m,
    scores: { python: 5, kotlin: 2 },
  },
  {
    id: 'py-dunder',
    pattern: /\b__(?:name|main|init|file|doc)__\b/,
    scores: { python: 8 },
  },
  {
    id: 'py-decorator',
    pattern: /^[ \t]*@[\w.]+(?:\([^)\n]{0,120}\))?\s*$/m,
    scores: { python: 4, java: 2, typescript: 1 },
  },
  {
    id: 'py-elif',
    pattern: /^[ \t]*elif\s|:\s*$\n[ \t]+\S/m,
    scores: { python: 4 },
  },
  {
    id: 'py-literals',
    // A lone None/True is not enough to decide, so the score is low and has to combine with other evidence
    pattern: /\b(?:None|True|False)\b/,
    scores: { python: 2 },
  },
  {
    id: 'py-fstring',
    pattern: /\bf["'][^"'\n]{0,120}\{/,
    scores: { python: 6 },
  },
  {
    id: 'py-self-param',
    pattern: /\bdef\s+\w+\s*\(\s*self\b|^\s*self\.\w+/m,
    scores: { python: 6 },
  },
  {
    id: 'py-print-call',
    pattern: /^[ \t]*print\s*\(/m,
    scores: { python: 3 },
  },
  {
    id: 'py-type-hint',
    // Lowercase builtin generics, the capitalized aliases from typing, and bare primitives in parameter position
    // (`name: str,`)
    pattern:
      /:\s*(?:list|dict|set|tuple|str|int|float|bool)\s*\[|\b(?:Optional|Union|Dict|Tuple|Callable|Iterable|Sequence|Mapping)\[|\(\s*\w+\s*:\s*(?:str|int|float|bool|bytes)\s*[,)=]/,
    scores: { python: 5 },
  },
  {
    id: 'py-shebang',
    pattern: /^#!.*\bpython[23]?\b/,
    scores: { python: 12 },
    definitive: 'python',
  },
];

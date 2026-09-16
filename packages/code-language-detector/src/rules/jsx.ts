import type { DetectionRule } from '../types';

/**
 * JSX / TSX. Same strategy as JS/TS:
 * JSX syntax itself only narrows the candidates to jsx + tsx; whether the code is typed is left to the
 * rules in typescript.ts.
 */
export const jsxRules: DetectionRule[] = [
  {
    id: 'jsx-return-element',
    pattern: /return\s*\(\s*\n?\s*</,
    scores: { jsx: 6, tsx: 5 },
  },
  {
    id: 'jsx-className',
    pattern: /\bclassName\s*=\s*[{"']/,
    scores: { jsx: 9, tsx: 8, javascript: -4, typescript: -4, html: -3 },
    description: 'className is JSX-only; HTML writes class',
  },
  {
    id: 'jsx-expression-attr',
    pattern: /<[A-Za-z][\w.]*\s+[\w-]+=\{/,
    scores: { jsx: 9, tsx: 8, javascript: -4, typescript: -4, html: -2 },
  },
  {
    id: 'jsx-component-tag',
    // A capitalised tag name means nothing in HTML; it marks a React component
    pattern: /<[A-Z][\w.]*(?:\s[^>\n]{0,120})?\/?>/,
    scores: { jsx: 7, tsx: 6, javascript: -3, typescript: -3, html: -2 },
  },
  {
    id: 'jsx-fragment',
    pattern: /<>\s*$|^\s*<\/>/m,
    scores: { jsx: 8, tsx: 7, javascript: -3, typescript: -3 },
  },
  {
    id: 'jsx-react-import',
    pattern: /^[ \t]*import\s+(?:React|\{[^}\n]*\buseState\b)/m,
    scores: { jsx: 6, tsx: 5 },
  },
  {
    id: 'jsx-hook-call',
    pattern: /\bconst\s*\[\s*\w+\s*,\s*set[A-Z]\w*\s*\]\s*=\s*useState/,
    scores: { jsx: 7, tsx: 6 },
  },
];

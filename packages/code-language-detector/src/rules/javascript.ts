import type { DetectionRule } from '../types';

/**
 * What the JS rules are for: narrowing the candidates down to javascript / typescript, not telling the two
 * apart. That is left to the TS-only syntax in typescript.ts (which also gives javascript negative scores).
 */
export const javascriptRules: DetectionRule[] = [
  {
    id: 'js-shebang',
    // `#!/usr/bin/env node`; bun / tsx / deno also run TS directly, so TS keeps a few points
    pattern: /^#!.*\b(?:node|bun|tsx|deno)\b/,
    scores: { javascript: 8, typescript: 3 },
  },
  {
    id: 'js-arrow',
    // The parenthesized parameter list is confined to one line, so [^)]* cannot span lines and amplify backtracking
    pattern: /(?:\([^)\n]{0,200}\)|\b[A-Za-z_$][\w$]{0,60})\s*=>/,
    scores: { javascript: 4, typescript: 4 },
    description: 'Arrow function: only locates the JS family, does not separate JS/TS',
  },
  {
    id: 'js-const-let',
    pattern: /^[ \t]*(?:const|let)\s+[A-Za-z_$][\w$]*/m,
    scores: { javascript: 3, typescript: 3 },
  },
  {
    id: 'js-import-from',
    pattern: /^[ \t]*import\s[^\n;]*\sfrom\s+['"]/m,
    scores: { javascript: 4, typescript: 4 },
  },
  {
    id: 'js-export',
    pattern: /^[ \t]*export\s+(?:default|const|function|class|\{)/m,
    scores: { javascript: 4, typescript: 4 },
  },
  {
    id: 'js-require',
    pattern: /\brequire\(\s*['"]/,
    scores: { javascript: 6, typescript: 1 },
    description: 'CommonJS require, rare in TS projects',
  },
  {
    id: 'js-module-exports',
    pattern: /\bmodule\.exports\b/,
    scores: { javascript: 7, typescript: -2 },
  },
  {
    id: 'js-console',
    pattern: /\bconsole\.(?:log|error|warn|info|debug)\s*\(/,
    scores: { javascript: 4, typescript: 4 },
  },
  {
    id: 'js-template-literal',
    pattern: /`[^`\n]*\$\{/,
    scores: { javascript: 3, typescript: 3 },
  },
  {
    id: 'js-use-strict',
    pattern: /^[ \t]*['"]use strict['"]\s*;?/m,
    scores: { javascript: 5, typescript: -1 },
  },
  {
    id: 'js-function-decl',
    // The function keyword is too common across languages (PHP, Lua and others have it), so it only scores low
    pattern: /\bfunction\s*\*?\s*[A-Za-z_$][\w$]*\s*\(/,
    scores: { javascript: 3, typescript: 3, php: 1, lua: 1 },
  },
  {
    id: 'js-async-await',
    pattern: /\basync\s+(?:function|\(|[A-Za-z_$][\w$]*\s*=>)|\bawait\s+[A-Za-z_$(]/,
    scores: { javascript: 3, typescript: 3, python: 1 },
  },
  {
    id: 'js-iife',
    // (function () { ... })() / (() => { ... })(): the classic wrapper of a browser script
    pattern:
      /^[ \t]*[;!]?\(\s*(?:async\s+)?(?:function\s*\*?\s*\w{0,40}\s*\(|\([^)\n]{0,60}\)\s*=>)|^\s*\}\)\(\);?[ \t]*$/m,
    scores: { javascript: 5, typescript: 5 },
  },
  {
    id: 'js-browser-globals',
    // DOM / BOM APIs only appear in the JS family; split equally between JS and TS
    pattern:
      /\b(?:document\.(?:querySelector(?:All)?|getElementById|createElement|addEventListener|body)|window\.(?:addEventListener|location|localStorage|requestAnimationFrame)|typeof\s+(?:window|document)\b)/,
    scores: { javascript: 6, typescript: 6 },
  },
  {
    id: 'js-nullish-optional-chain',
    pattern: /\?\?=?[^=]|\?\.[A-Za-z_$[(]/,
    scores: { javascript: 3, typescript: 3 },
  },
];

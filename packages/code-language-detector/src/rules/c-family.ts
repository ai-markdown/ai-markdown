import type { DetectionRule } from '../types';

/**
 * C / C++ / C#.
 * The C++ discrimination patterns follow GitHub Linguist's `named_patterns.cpp`
 * (lib/linguist/heuristics.yml, MIT License). Those patterns have been validated on real repositories,
 * which makes them more reliable than a keyword list made up on the spot.
 *
 * The key trade-off: `#include` on its own does not separate C from C++, so a match scores both,
 * and only std:: / template< / namespace / a C++ standard library header clearly tips it towards C++.
 */
export const cFamilyRules: DetectionRule[] = [
  {
    id: 'c-include',
    pattern: /^[ \t]*#\s*include\s*[<"]/m,
    scores: { c: 7, cpp: 7 },
    description: 'Does not separate C/C++; it pins the candidates to these two',
  },
  {
    id: 'c-define',
    pattern: /^[ \t]*#\s*(?:define|ifndef|ifdef|endif|pragma)\b/m,
    scores: { c: 5, cpp: 5 },
  },
  {
    id: 'cpp-std-namespace',
    pattern: /\bstd::\w+/,
    scores: { cpp: 11, c: -6 },
    definitive: 'cpp',
  },
  {
    id: 'cpp-stdlib-header',
    // The header list from Linguist's named_patterns.cpp
    pattern:
      /^[ \t]*#\s*include\s*<(?:cstdint|cstdio|cstring|string|vector|map|list|array|bitset|queue|stack|forward_list|unordered_map|unordered_set|memory|algorithm|(?:i|o|io)stream)>/m,
    scores: { cpp: 10, c: -5 },
  },
  {
    id: 'cpp-template',
    pattern: /^[ \t]*template\s*</m,
    scores: { cpp: 10, c: -5 },
  },
  {
    id: 'cpp-namespace',
    pattern: /^[ \t]*(?:using[ \t]+)?namespace\s+\w+/m,
    scores: { cpp: 8, csharp: 3, c: -4 },
  },
  {
    id: 'cpp-access-label',
    pattern: /^[ \t]*(?:private|public|protected):\s*$/m,
    scores: { cpp: 8, c: -4 },
  },
  {
    id: 'cpp-cout',
    pattern: /\b(?:cout|cerr|cin)\s*(?:<<|>>)/,
    scores: { cpp: 10, c: -5 },
  },
  {
    id: 'c-printf-malloc',
    pattern: /\b(?:printf|fprintf|malloc|calloc|free|memcpy|strlen)\s*\(/,
    scores: { c: 6, cpp: 1 },
  },
  {
    id: 'c-int-main',
    pattern: /\bint\s+main\s*\(\s*(?:void|int\s+argc|\))/,
    // int main() is equally common in C and C++; split equally so no false margin is fabricated
    scores: { c: 6, cpp: 6 },
  },
  {
    id: 'c-struct-typedef',
    pattern: /^[ \t]*typedef\s+struct\b|^[ \t]*struct\s+\w+\s*\{/m,
    scores: { c: 5, cpp: 3 },
  },

  // ── C# ──────────────────────────────────────────────────────────
  {
    id: 'cs-using-system',
    pattern: /^[ \t]*using\s+System(?:\.[\w.]+)?\s*;/m,
    scores: { csharp: 11, java: -6, cpp: -2 },
    definitive: 'csharp',
  },
  {
    id: 'cs-console',
    pattern: /\bConsole\.(?:WriteLine|Write|ReadLine)\s*\(/,
    scores: { csharp: 11, java: -4 },
    definitive: 'csharp',
  },
  {
    id: 'cs-namespace-block',
    pattern: /^[ \t]*namespace\s+[A-Z][\w.]*\s*[{;]/m,
    scores: { csharp: 8, java: -3 },
  },
  {
    id: 'cs-property',
    pattern: /\{\s*get;\s*(?:set;\s*)?\}/,
    scores: { csharp: 10, java: -3 },
  },
  {
    id: 'cs-var-keyword',
    pattern: /^[ \t]*var\s+\w+\s*=\s*new\s+\w+/m,
    scores: { csharp: 6, java: -1 },
  },
  {
    id: 'cs-string-interpolation',
    pattern: /\$"[^"\n]{0,120}\{/,
    scores: { csharp: 8 },
  },
];

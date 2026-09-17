import type { DetectionRule } from '../types';

/** PHP / Ruby / Lua / PowerShell: each has strong signatures of its own */
export const scriptingRules: DetectionRule[] = [
  // ── PHP ─────────────────────────────────────────────────────────
  {
    id: 'php-open-tag',
    pattern: /<\?php\b/,
    scores: { php: 14 },
    definitive: 'php',
  },
  {
    id: 'php-leading-open-tag',
    // A snippet that opens with <?php is a PHP file; namespaces, docblocks and return types can outscore the tag
    // for TypeScript, C# or Java, which structurally cannot start this way.
    pattern: /^\s*<\?php\b/,
    scores: { php: 4 },
    excludes: ['javascript', 'typescript', 'jsx', 'tsx', 'csharp', 'java'],
  },
  {
    id: 'php-var-sigil',
    // No i flag: a capitalised `$Foo = ` is the PowerShell convention and is left to ps-var-assign
    pattern: /\$[a-z_]\w*\s*=\s*[^=\n]/,
    scores: { php: 4, powershell: 2, bash: 1 },
  },
  {
    id: 'php-arrow-call',
    pattern: /\$\w+->\w+\s*\(/,
    scores: { php: 9 },
  },
  {
    id: 'php-echo-namespace',
    pattern: /^[ \t]*(?:echo\s+\$|use\s+[A-Z]\w*\\|namespace\s+[A-Z]\w*\\)/m,
    scores: { php: 8 },
  },
  {
    id: 'php-array-arrow',
    pattern: /=>\s*[^=\n]{1,60},?\s*$/m,
    scores: { php: 2, ruby: 1 },
  },

  // ── Ruby ────────────────────────────────────────────────────────
  {
    id: 'rb-def-end',
    pattern: /^[ \t]*def\s+\w+[?!]?(?:\([^)\n]{0,80}\))?\s*$/m,
    scores: { ruby: 9, python: -3 },
    description: 'Ruby def has no trailing colon, which separates it from Python def ...:',
  },
  {
    id: 'rb-shebang',
    pattern: /^#!.*\bruby\b/,
    scores: { ruby: 12 },
    definitive: 'ruby',
  },
  {
    id: 'rb-end-keyword',
    pattern: /^[ \t]*end\s*$/m,
    scores: { ruby: 5, lua: 3 },
  },
  {
    id: 'rb-puts',
    pattern: /^[ \t]*puts\s+\S/m,
    scores: { ruby: 9 },
  },
  {
    id: 'rb-block-params',
    // A character class instead of (?:,\s*\w+)*, to avoid a nested quantifier
    pattern: /\bdo\s*\|[\w\s,]{1,60}\|/,
    scores: { ruby: 10 },
    definitive: 'ruby',
  },
  {
    id: 'rb-symbol-hash',
    pattern: /[:{,]\s*\w+:\s*[^:\s][^\n,}]{0,60}[,}]|\B:[a-z_]\w*\b/,
    scores: { ruby: 3 },
  },
  {
    id: 'rb-magic-comment',
    // # frozen_string_literal: true and Sorbet's # typed: strict are Ruby file headers
    pattern:
      /^#[ \t]*(?:frozen_string_literal:[ \t]*(?:true|false)|typed:[ \t]*(?:ignore|false|true|strict|strong))[ \t]*$/m,
    scores: { ruby: 12, yaml: -4 },
    definitive: 'ruby',
  },
  {
    id: 'rb-require-relative',
    pattern: /^[ \t]*require(?:_relative)?\s+['"]/m,
    scores: { ruby: 7 },
  },
  {
    id: 'rb-instance-var',
    pattern: /@\w+\s*=|\battr_(?:accessor|reader|writer)\b/,
    scores: { ruby: 6 },
  },

  // ── Lua ─────────────────────────────────────────────────────────
  {
    id: 'lua-local',
    pattern: /^[ \t]*local\s+\w+\s*=/m,
    scores: { lua: 9 },
  },
  {
    id: 'lua-function-end',
    pattern: /^[ \t]*(?:local\s+)?function\s+[\w.:]+\s*\([^)\n]{0,80}\)\s*$/m,
    scores: { lua: 7, javascript: -2 },
  },
  {
    id: 'lua-then-end',
    pattern: /\bthen\s*$|\bnil\b|\bipairs\s*\(|\bpairs\s*\(/m,
    scores: { lua: 5 },
  },
  {
    id: 'lua-concat',
    pattern: /\.\.\s*["'\w]|~=/,
    scores: { lua: 4 },
  },

  // ── PowerShell ──────────────────────────────────────────────────
  {
    id: 'ps-cmdlet',
    // Only cmdlets in command position count: at a line start, or after a pipe / assignment / bracket.
    // `'Set-Cookie'` in quotes, `// Test-Driven` in a comment and the HTTP header `Set-Cookie:`
    // are far more common in JS / curl than real PowerShell, and all used to be detected as powershell 0.95
    pattern:
      /(?:^[ \t]*|[|=({;&][ \t]*)(?:Get|Set|New|Remove|Add|Write|Read|Out|Import|Export|Invoke|Test|Start|Stop|Restart|Select|Where|ForEach|Format|ConvertTo|ConvertFrom|Join|Split|Copy|Move|Push|Pop|Install|Update|Register|Enable|Disable|Resolve|Measure|Wait|Clear)-[A-Z]\w+(?![\w-]*[:'"])/m,
    scores: { powershell: 10, bash: -3 },
    definitive: 'powershell',
  },
  {
    id: 'ps-shebang',
    pattern: /^#!.*\bpwsh\b/,
    scores: { powershell: 12 },
    definitive: 'powershell',
  },
  {
    id: 'ps-function-verb-noun',
    // A hyphenated function name is invalid in JS / PHP / Lua and unique to PowerShell
    pattern: /^[ \t]*function\s+[A-Z]\w*-[A-Z]\w*\s*[({]/m,
    scores: { powershell: 10, javascript: -4, php: -3 },
    definitive: 'powershell',
  },
  {
    id: 'ps-comparison-op',
    // `($a -ne $b)`: -eq/-ne inside parentheses is PowerShell; bash's operators of the same name go inside [ ]
    pattern: /\(\s*\$\w+\s+-(?:eq|ne|gt|lt|ge|le|like|notlike|match|contains|notcontains|in|notin)\s/,
    scores: { powershell: 8, bash: -2 },
  },
  {
    id: 'ps-logical-op',
    // -not is left out: `find . -not -path` is everyday bash
    pattern: /\s-(?:and|or)\s/,
    scores: { powershell: 4 },
  },
  {
    id: 'ps-var-assign',
    // `$Name = ...`: assigning a capitalised variable is the PowerShell convention; PHP variables are
    // conventionally lowercase
    pattern: /^[ \t]*\$[A-Z]\w*\s*=\s*[^=\n]/m,
    scores: { powershell: 5, php: 1 },
  },
  {
    id: 'ps-block-comment',
    // `<# … #>` block comments are unique to PowerShell
    pattern: /^[ \t]*<#|#>[ \t]*$/m,
    scores: { powershell: 9 },
  },
  {
    id: 'ps-here-string',
    // The opening `@"` ends its line and the closing `"@` sits alone on a line. The closing half must not be
    // relaxed to a `"@` at a line start, otherwise `"@types/node":` in package.json would match too
    pattern: /@["'][ \t]*$|^[ \t]*["']@[ \t]*$/m,
    scores: { powershell: 8 },
  },
  {
    id: 'ps-param-block',
    pattern: /^[ \t]*param\s*\(|\[CmdletBinding\(\)\]|\[Parameter\(/m,
    scores: { powershell: 10, bash: -2 },
  },
  {
    id: 'ps-pipeline-object',
    pattern: /\|\s*(?:Where|Select|ForEach|Sort)-Object\b/,
    scores: { powershell: 10, bash: -3 },
  },
  {
    id: 'ps-type-accelerator',
    pattern: /\[(?:string|int|bool|array|hashtable|PSCustomObject)\]\s*\$/i,
    scores: { powershell: 8, bash: -2 },
  },
  {
    id: 'ps-automatic-var',
    pattern: /\$(?:PSItem|_|null|true|false|Host|Error)\b/,
    scores: { powershell: 5, bash: -1 },
  },
];

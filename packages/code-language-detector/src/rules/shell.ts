import type { DetectionRule } from '../types';

export const shellRules: DetectionRule[] = [
  {
    id: 'sh-shebang',
    pattern: /^#!.*\b(?:bash|sh|zsh|dash|ksh)\b/,
    scores: { bash: 12 },
    definitive: 'bash',
  },
  {
    id: 'sh-double-bracket',
    pattern: /\[\[\s+[^\]\n]{1,120}\]\]/,
    scores: { bash: 8 },
  },
  {
    id: 'sh-set-opts',
    pattern: /^[ \t]*set\s+-[euxo]+\b/m,
    scores: { bash: 9 },
  },
  {
    id: 'sh-var-expansion',
    // A bare $ is not enough; require an explicit expansion such as ${VAR} or $VAR
    pattern: /\$\{[A-Za-z_][\w]*[^}\n]{0,60}\}|\$[A-Za-z_][\w]*\b/,
    scores: { bash: 3, powershell: 1 },
  },
  {
    id: 'sh-export-assign',
    pattern: /^[ \t]*(?:export|local|readonly)\s+[A-Za-z_]\w*=/m,
    scores: { bash: 8 },
  },
  {
    id: 'sh-then-fi',
    pattern: /^[ \t]*(?:then|fi|elif|esac|done)\b\s*$/m,
    scores: { bash: 7 },
  },
  {
    id: 'sh-if-bracket',
    pattern: /^[ \t]*if\s+\[/m,
    scores: { bash: 7 },
  },
  {
    id: 'sh-pipe-common-cmd',
    pattern: /\|\s*(?:grep|awk|sed|sort|uniq|head|tail|xargs|jq|wc)\b/,
    scores: { bash: 6 },
  },
  {
    id: 'sh-command-substitution',
    pattern: /\$\([^)\n]{1,120}\)/,
    scores: { bash: 5 },
  },
  {
    id: 'sh-common-binaries',
    pattern: /^[ \t]*(?:sudo\s+)?(?:apt|yum|brew|npm|pnpm|yarn|git|docker|kubectl|curl|chmod|mkdir)\s+\S/m,
    scores: { bash: 4 },
  },
];

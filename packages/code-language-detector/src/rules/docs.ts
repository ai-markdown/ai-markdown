import type { DetectionRule } from '../types';

/** Dockerfile / Markdown: just as common in code fences, but long without rules */
export const docsRules: DetectionRule[] = [
  // ── Dockerfile ──────────────────────────────────────────────────
  {
    id: 'docker-from',
    // An image reference with a tag (`node:20`) or a registry path (`ghcr.io/x/y`) can only be a Dockerfile.
    // A bare `FROM users` / `FROM base AS build` has the same form as SQL's `FROM users AS u`,
    // so it is split out into the weak rule below
    pattern: /^[ \t]*FROM\s+(?:--platform=\S+\s+)?[\w.\-@]*[/:][\w.\-/:@]*(?:\s+AS\s+\w+)?[ \t]*$/im,
    scores: { dockerfile: 12 },
    definitive: 'dockerfile',
  },
  {
    id: 'docker-from-bare',
    // A lone `FROM ubuntu` cannot tell an image name from an SQL table name,
    // so it only scores weakly and the following RUN / COPY make up the rest. No i flag: a lowercase from
    // looks more like Python / SQL
    pattern: /^[ \t]*FROM\s+[a-z][\w.-]*(?:\s+AS\s+\w+)?[ \t]*$/m,
    scores: { dockerfile: 6 },
  },
  {
    id: 'docker-instructions',
    pattern: /^[ \t]*(?:RUN|COPY|ADD|CMD|ENTRYPOINT|EXPOSE|WORKDIR|ENV|ARG|VOLUME|LABEL|USER|HEALTHCHECK)\s+\S/m,
    scores: { dockerfile: 8 },
  },
  {
    id: 'docker-syntax-directive',
    pattern: /^#[ \t]*syntax=[\w./-]{1,80}dockerfile/m,
    scores: { dockerfile: 14, bash: -6 },
    definitive: 'dockerfile',
  },
  {
    id: 'docker-run-line',
    // The commands after RUN look like shell, and a long RUN block fires the shell rules; an uppercase RUN at the
    // start of a line is not a shell command, so a snippet that has one is not a shell script.
    pattern: /^RUN\s+\S/m,
    scores: { dockerfile: 4, bash: -12 },
  },
  {
    id: 'docker-exec-form',
    pattern: /^[ \t]*(?:CMD|ENTRYPOINT)\s*\[\s*"/m,
    scores: { dockerfile: 9 },
  },

  // ── Markdown ────────────────────────────────────────────────────
  {
    id: 'md-heading',
    // Weak evidence: `# text` is a comment in YAML / Shell / Python / Ruby,
    // and a high score would turn a commented YAML file into markdown. The real separation comes from the
    // structures unique to Markdown below: fences, links, tables.
    pattern: /^#{1,6}\s+\S/m,
    scores: { markdown: 3 },
    description: 'Weak evidence: # comments look the same in many languages',
  },
  {
    id: 'md-multi-level-heading',
    // Only headings of two different levels in the same snippet look like a real Markdown document
    pattern: /^#{1,3}\s+\S[^\n]{0,200}\n(?:[^\n]{0,200}\n){0,20}?#{2,6}\s+\S/m,
    scores: { markdown: 7 },
  },
  {
    id: 'md-front-matter',
    // A --- block of key: value lines that closes and is followed by prose or a heading is front matter. A second
    // YAML document would continue with keys, a list or another ---.
    pattern:
      /^---[ \t]*\n(?:[\w-]{1,40}:[^\n]{0,300}\n){1,40}---[ \t]*\n(?:[ \t]*\n){0,3}(?![ \t]*(?:[\w-]{1,40}:|- |---))[ \t]*[^\s#]/,
    scores: { markdown: 12, yaml: -8 },
  },
  {
    id: 'doc-comment-lines',
    // Three /// or //! lines in a row are Rust, Swift, Dart, C# or Zig documentation comments. Their Markdown is
    // not a Markdown document, and a Markdown document never has such lines.
    pattern: /^[ \t]*\/\/[/!][^\n]*\n[ \t]*\/\/[/!][^\n]*\n[ \t]*\/\/[/!]/m,
    scores: { markdown: -12 },
  },
  {
    id: 'docstring-opening',
    // A snippet that opens with a triple-quoted string is a Python or Julia docstring: the Markdown in it describes
    // code. A Markdown document never starts with three quotes.
    pattern: /^"""[^\n]*\n/,
    scores: { python: 2, julia: 2 },
    excludes: ['markdown'],
  },
  {
    id: 'md-fence',
    pattern: /^[ \t]*```/m,
    scores: { markdown: 9 },
  },
  {
    id: 'md-inline-code',
    // Inline code wrapped in backticks hardly ever appears in other languages
    pattern: /(?:^|[\s(（])`[^`\n]{1,80}`(?:[\s.,;:)）]|$)/m,
    // Technical comments often quote identifiers in backticks too, so this is only medium evidence
    scores: { markdown: 4 },
  },
  {
    id: 'hash-comment-banner',
    // A banner with hashes on both ends such as `## Section ##` is how code comments are written.
    // Strictly speaking it is also a valid Markdown ATX heading, but hardly anyone writes that in modern Markdown.
    pattern: /^[ \t]*#{2,}[ \t]+[^#\n]{1,120}[ \t]#{2,}[ \t]*$/m,
    scores: { markdown: -6, julia: 2, python: 2, ruby: 2, bash: 2 },
  },
  {
    id: 'hash-comment-wrapped',
    // Two consecutive level-one `# ` lines, the first fairly long and the second starting in lowercase: a
    // wrapped prose comment. Markdown almost never has two level-one headings in a row, let alone a second one
    // starting in lowercase. A lower bar than comment-block-hash's "three consecutive lines", aimed at
    // comment headers of only two lines.
    pattern: /^#[ \t]+[^\n#]{20,200}\n#[ \t]+[a-z`(]/m,
    scores: { markdown: -7, yaml: 2, bash: 2, python: 2, ruby: 2 },
  },
  {
    id: 'comment-block-hash',
    // Three consecutive lines starting with # are a comment block, not Markdown headings
    // (Markdown rarely has three headings in a row). This is the key counter-evidence that separates
    // YAML/Shell comment blocks from Markdown documents.
    pattern: /^[ \t]*#[^\n]{0,200}\n[ \t]*#[^\n]{0,200}\n[ \t]*#/m,
    scores: { markdown: -7, yaml: 3, bash: 2, python: 2 },
  },
  {
    id: 'md-link-or-image',
    pattern: /!?\[[^\]\n]{1,120}\]\([^)\n]{1,200}\)/,
    scores: { markdown: 7 },
  },
  {
    id: 'md-emphasis',
    pattern: /\*\*[^*\n]{1,120}\*\*|(?:^|\s)_[^_\n]{1,120}_(?:\s|$)/m,
    scores: { markdown: 5 },
  },
  {
    id: 'md-blockquote',
    pattern: /^[ \t]*>\s+\S/m,
    scores: { markdown: 5 },
  },
  {
    id: 'md-table',
    pattern: /^[ \t]*\|[^\n]{3,200}\|[ \t]*$\n[ \t]*\|[\s:|-]{3,200}\|/m,
    scores: { markdown: 9 },
  },
  {
    id: 'md-task-list',
    pattern: /^[ \t]*[-*]\s+\[[ xX]\]\s/m,
    scores: { markdown: 8, yaml: -2 },
  },
];

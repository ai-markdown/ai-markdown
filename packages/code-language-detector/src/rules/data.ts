import type { DetectionRule } from '../types';

/**
 * JSON is mainly decided by the JSON.parse special case in the detector. Only weak rules remain here, which
 * produce candidates when parsing fails but the text still looks like a data format.
 */
/**
 * One line of a YAML mapping: `key:` followed by an optional value. Several consecutive lines of this shape are a
 * structural feature of YAML, but the following kinds of code look the same and are excluded per line with
 * lookaheads:
 *   - The line ends in `;` or `,`: CSS properties, JS / Go / Rust / Ruby object or struct literals
 *   - The value is only a type name: TS interface fields (`id: string`), Python dataclasses (`name: str`)
 *   - The value is a generic or subscripted type: `List[int]`, `Array<string>`, `Record<K, V>`
 *   - A colon directly followed by a colon: C++ / Rust `::` paths
 * Every quantifier is bounded and none are nested, to stay within the rule hygiene constraints.
 */
const YAML_TYPE_NAMES =
  'str|int|float|bool|bytes|string|number|boolean|any|unknown|void|never|object|' +
  'Int|Long|Double|Float|Bool|Boolean|String|Unit|Any|Date';
const YAML_MAPPING_LINE =
  '[ \\t]*[\\w.-]{1,60}:(?!:)' +
  '(?![^\\n]{0,200}[;,][ \\t]*$)' +
  `(?![ \\t]*(?:${YAML_TYPE_NAMES})\\b[ \\t]*(?:[=|?)]|$))` +
  '(?![ \\t]*[A-Za-z_][\\w.]{0,40}[[<])' +
  '(?:[ \\t][^\\n]{0,200})?';

export const dataRules: DetectionRule[] = [
  {
    id: 'json-quoted-key',
    pattern: /^[ \t]*"[\w$-]+"\s*:\s*(?:"|\d|\{|\[|true|false|null)/m,
    scores: { json: 6, yaml: 1 },
  },
  {
    id: 'json-inline-quoted-keys',
    // No line anchor: JSON minified onto one line (a common shape of API payloads in agent output)
    // cannot match the two ^…/m rules above
    pattern: /\{"[\w$-]{1,60}"\s*:|,\s*"[\w$-]{1,60}"\s*:\s*[^,\s]/,
    scores: { json: 7, yaml: -2 },
  },
  {
    id: 'json-multiple-quoted-keys',
    // Two consecutive "key": value lines are a very strong JSON signal; YAML is almost never written like this
    pattern: /"[\w$-]+"\s*:\s*[^\n]{1,120}\n\s*"[\w$-]+"\s*:/,
    scores: { json: 8, yaml: -2 },
  },
  {
    id: 'json-assignment-negative',
    // `X = {` / `X = [`: JSON / YAML have no assignment (an = inside quotes never appears at the line start).
    // Python dict literals and JS object literals with quoted keys look exactly like JSON,
    // and the three json rules above all fire on the same structure, so this negative score must outweigh their sum
    pattern: /^[ \t]*(?:(?:const|let|var|val|final|static|export|public|private)\s+){0,2}\$?[\w.]+\s*=\s*[{[]/m,
    scores: { json: -14, yaml: -4 },
  },
  {
    id: 'yaml-document-start',
    // A --- line opens a YAML document, but it also opens and closes Markdown front matter, so the score is split
    // equally; md-front-matter tells them apart once the block has closed.
    pattern: /^---\s*$/m,
    scores: { yaml: 5, markdown: 5 },
  },
  {
    id: 'yaml-key-value',
    // YAML syntax is very permissive, so a single match scores low; it needs several independent pieces of evidence
    pattern: /^[ \t]*[\w.-]+:\s+(?:[^\s{[][^\n]{0,120})$/m,
    scores: { yaml: 3 },
  },
  {
    id: 'yaml-mapping-run',
    // Three consecutive `key: value` lines: yaml-key-value scores only once, so dozens of mapping lines still count as
    // one piece of evidence and stay capped below 0.72 by the single-evidence cap. This structural rule provides a
    // second independent piece of evidence.
    // Lookalike code forms are excluded per line (see the comment on YAML_MAPPING_LINE).
    pattern: new RegExp(`^${YAML_MAPPING_LINE}\\n${YAML_MAPPING_LINE}\\n${YAML_MAPPING_LINE}$`, 'm'),
    scores: { yaml: 8 },
  },
  {
    id: 'yaml-unquoted-phrase',
    // `name: Build and test`: an unquoted multi-word phrase as the value, which only YAML writes;
    // TS type annotations / JS object literal values never contain "letters space letters".
    // Only inline whitespace after the colon: `\s+` would span lines and count Python's `else:` plus the next line
    pattern: /^[ \t]*[\w.-]+:[ \t]+[A-Za-z][\w.-]*[ \t]+[A-Za-z][^\n:]{0,80}$/m,
    scores: { yaml: 4 },
  },
  {
    id: 'yaml-nested-block',
    pattern: /^[ \t]*[\w.-]+:\s*$\n[ \t]+[\w.-]+:/m,
    scores: { yaml: 5 },
  },
  {
    id: 'yaml-ci-keywords',
    // GitHub Actions / GitLab CI are the most common YAML in code fences
    pattern: /^[ \t]*(?:steps|jobs|stages|services|runs-on|uses|needs|with|env|on):\s*$|^[ \t]*-\s+uses:\s+\S/m,
    scores: { yaml: 8 },
  },
  {
    id: 'yaml-embedded-script',
    // Two ways CI configuration embeds shell: the GitHub Actions `run: |` block scalar, and the command list under
    // GitLab CI's `script:`. The shell inside fires set -e, ${VAR}, then/fi and other bash rules that each add up,
    // which on a large file is enough to outweigh the YAML structural evidence that only scores once.
    // A shell script itself never contains `run: |`, so bash gets a large negative score.
    pattern:
      /^[ \t]*(?:-[ \t]+)?(?:run|script|command|shell|entrypoint):[ \t]*[|>][-+]?[ \t]*$|^[ \t]*(?:script|before_script|after_script):[ \t]*\n[ \t]*-[ \t]+\S/m,
    scores: { yaml: 6, bash: -12, powershell: -8 },
  },
  {
    id: 'yaml-sequence-of-mappings',
    // `- insert:` followed by a more deeply indented key or list item: YAML's sequence-of-mappings structure.
    // A Markdown list item does not end in `key:` followed by an indented `key:`.
    pattern: /^[ \t]*-[ \t]+[\w.-]{1,60}:[ \t]*\n[ \t]+(?:-[ \t]+)?[\w.-]{1,60}:/m,
    scores: { yaml: 8, markdown: -3 },
  },
  {
    id: 'yaml-list-item',
    pattern: /^[ \t]*-\s+[\w"'[{]/m,
    scores: { yaml: 3, markdown: 2 },
  },
  {
    id: 'ini-section-header',
    // [section] alone on its line, followed by key = value: the signature structure of INI/TOML
    pattern: /^[ \t]*\[[\w.$:-]{1,60}\][ \t]*$/m,
    scores: { ini: 9 },
  },
  {
    id: 'ini-key-value',
    // Weak evidence: almost every language has `key = value`. The main evidence is the [section] rule above;
    // this one only adds a little when the snippet already looks like INI. A high score would pollute a wide range
    // of other languages.
    pattern: /^[ \t]*[\w.-]{1,60}[ \t]*=[ \t]*[^=\n]{1,120}$/m,
    scores: { ini: 2 },
  },
  {
    id: 'ini-continuation-value',
    // key = followed by indented continuation lines (tox, setup.cfg, configparser). TOML requires a value on the line.
    pattern: /^[\w.-]{1,60}[ \t]*=[ \t]*\n(?:[ \t]{2,}\S[^\n]{0,200}\n){1,40}/m,
    scores: { ini: 8, toml: -6 },
  },
  {
    id: 'ini-unquoted-text-value',
    // key=unquoted text with a space: TOML needs quotes around such a string, shells and Python reject it
    // A spaced operator (a = b + c) is an expression, not text.
    pattern:
      /^[\w.-]{1,60}[ \t]*=[ \t]*(?![^\n]{0,240}[ \t][-+*/%<>|^][ \t])[A-Za-z][^"'\n[{=]{0,120}[ \t][A-Za-z(][^\n=]{0,120}$/m,
    scores: { ini: 5, toml: -5 },
  },
  {
    id: 'yaml-anchor',
    pattern: /^[ \t]*[\w.-]+:\s*[&*]\w+/m,
    scores: { yaml: 7 },
  },
];

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Run from a package after tsdown. With `sourcemap: true` the bundled
// declarations end in a sourceMappingURL comment, but no declaration map is
// written (rolldown/tsdown#1091). Remove the comment wherever its target is
// missing, so a published declaration never points at an absent file.
const COMMENT = /\n\/\/# sourceMappingURL=(\S+)\s*$/;
for (const name of readdirSync('dist', { recursive: true }).map(String)) {
  if (!/\.d\.c?ts$/.test(name)) continue;
  const file = join('dist', name);
  const text = readFileSync(file, 'utf8');
  const target = text.match(COMMENT)?.[1];
  if (target && !existsSync(join(file, '..', target))) writeFileSync(file, text.replace(COMMENT, '\n'));
}

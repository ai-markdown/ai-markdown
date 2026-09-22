/* global process, console */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import { inspect } from './impact.mjs';
const root = fileURLToPath(new URL('../..', import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args[0] !== '--evidence' || args.length < 2 || args.slice(1).some((arg) => arg.startsWith('--')))) {
  throw new Error(
    'Usage: check-release-soak [--evidence <run-dir>...]. Release validation always checks HEAD against the preceding train tag; use check:soak-impact for custom audit ranges.'
  );
}
if (execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) {
  throw new Error('Release soak validation requires a clean worktree. Commit the candidate first.');
}
const result = inspect(undefined, 'HEAD', root);
console.log(JSON.stringify(result, null, 2));
let smokeRequired = result.smokeRequired;
if (!result.required) {
  console.log('Full release soak: NOT REQUIRED for this change range. Normal CI gates still apply.');
} else {
  const at = args.indexOf('--evidence');
  const directories = at < 0 ? [] : args.slice(at + 1).map((dir) => resolve(dir));
  if (!directories.length)
    throw new Error('Engine soak required. Run the release profile locally, then provide --evidence <run-dir>...');
  for (const directory of directories) {
    const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'));
    const tested = manifest.repository?.commit;
    if (!tested) throw new Error('Evidence has no source commit');
    // Tool-only follow-ups are covered by the smoke below. Engine, generator
    // and oracle changes still invalidate the full campaign evidence.
    const followup = inspect(tested, result.head, root);
    smokeRequired ||= followup.smokeRequired;
    if (followup.required)
      throw new Error(`Soak evidence does not cover the candidate: ${followup.reasons.join('; ')}`);
  }
  execFileSync(
    process.execPath,
    [resolve(root, 'scripts/soak/soak-aggregate.mjs'), '--profile', 'release', ...directories],
    { cwd: root, stdio: 'inherit' }
  );
  console.log('Release soak: candidate covered by validated local evidence.');
}
if (smokeRequired)
  execFileSync(process.execPath, [resolve(root, 'scripts/soak/smoke.mjs')], { cwd: root, stdio: 'inherit' });

/* global process, console */
import { execFileSync } from 'node:child_process';
import { URL, fileURLToPath } from 'node:url';

// Keep one package build per run. Unit tests include all core contracts;
// typecheck covers their declarations as well as adapters and Storybook.
const steps = [
  ['check:overrides'],
  ['check:soak-coverage'],
  ['lint'],
  ['format:check'],
  ['build'],
  ['typecheck'],
  ['check:public-api'],
  ['test:command-control'],
  ['test:soak-control'],
  ['test:perf-control'],
  ['test:release-control'],
  ['test:unit'],
  ['packcheck'],
  ['test:packed-consumers'],
  ['test:storybook'],
  ['build:storybook', '--skip-build'],
  ['test:storybook:site'],
  ['test:storybook:dev'],
  ['test:document-lifetime'],
  ['test:vue-browser'],
  ['test:vue-browser:compat'],
];
for (const args of steps) {
  console.log(`\n[preflight] ${args.join(' ')}`);
  try {
    execFileSync('pnpm', ['run', ...args], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, ...(args[0] === 'build:storybook' ? { STORYBOOK_DOCS_EXPORT: '1' } : {}) },
      stdio: 'inherit',
    });
  } catch (error) {
    process.exitCode = error.status || 1;
    break;
  }
}

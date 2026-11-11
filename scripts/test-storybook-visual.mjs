import { URL } from 'node:url';
/* global process, console */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const { image, playwrightVersion } = JSON.parse(
  readFileSync(new URL('../tests/visual/environment.json', import.meta.url))
);
const version = JSON.parse(readFileSync(new URL('../node_modules/playwright/package.json', import.meta.url))).version;
if (version !== playwrightVersion)
  throw new Error('Update tests/visual/environment.json alongside Playwright and review new baselines.');
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--update-snapshots')) throw new Error('Only --update-snapshots is supported.');
const testArgs = ['node_modules/playwright/cli.js', 'test', '--config=tests/visual/playwright.config.mjs', ...args];
// CI already runs in this exact image; local runs still use the same Docker pin.
const inPinnedContainer = process.env.AIMD_BROWSER_IMAGE === image;
const result = inPinnedContainer
  ? spawnSync(process.execPath, testArgs, { stdio: 'inherit' })
  : spawnSync(
      'docker',
      [
        'run',
        '--rm',
        '--init',
        '--ipc=host',
        '--platform=linux/amd64',
        '--user',
        `${process.getuid()}:${process.getgid()}`,
        '-e',
        'HOME=/tmp',
        '-v',
        `${resolve('.')}:/work`,
        '-w',
        '/work',
        image,
        'node',
        ...testArgs,
      ],
      { stdio: 'inherit' }
    );
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;

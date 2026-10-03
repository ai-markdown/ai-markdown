import { URL } from 'node:url';
/* global process, console */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const image =
  'mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27';
const version = JSON.parse(readFileSync(new URL('../node_modules/playwright/package.json', import.meta.url))).version;
if (version !== '1.63.0')
  throw new Error('Update the pinned visual-test image alongside Playwright and review new baselines.');
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--update-snapshots')) throw new Error('Only --update-snapshots is supported.');
const result = spawnSync(
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
    'node_modules/playwright/cli.js',
    'test',
    '--config=tests/visual/playwright.config.mjs',
    ...args,
  ],
  { stdio: 'inherit' }
);
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;

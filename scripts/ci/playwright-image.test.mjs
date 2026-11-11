import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { playwrightImage } from './playwright-image.mjs';

const fixture = (version) => `lockfileVersion: '9.0'
importers:
  .:
    devDependencies:
      playwright:
        specifier: ^1.60.0
        version: ${version}
  packages/example:
    devDependencies:
      playwright:
        specifier: ^1.50.0
        version: 1.50.0
packages:
  playwright@1.60.1:
    resolution: {integrity: ignored}
`;

test('uses the locked root version, not the manifest range or another workspace', () => {
  assert.equal(playwrightImage(fixture('1.60.1')), 'mcr.microsoft.com/playwright:v1.60.1-noble');
  assert.equal(
    playwrightImage(fixture('1.64.1').replaceAll('\n', '\r\n')),
    'mcr.microsoft.com/playwright:v1.64.1-noble'
  );
});

test('rejects missing, ambiguous, or non-release versions instead of choosing latest', () => {
  for (const source of [
    '',
    fixture('latest'),
    fixture('1.64.1-beta.1'),
    fixture('1.64.1; echo injected'),
    fixture('1.64.1').replace('      playwright:', '      other:'),
    fixture('1.64.1').replace(
      '  packages/example:',
      '      playwright:\n        specifier: ^1.64.1\n        version: 1.64.1\n  packages/example:'
    ),
  ])
    assert.throws(() => playwrightImage(source), /Expected one exact root Playwright/);
});

test('the current lockfile produces a versioned official image', () => {
  assert.match(
    playwrightImage(readFileSync('pnpm-lock.yaml', 'utf8')),
    /^mcr\.microsoft\.com\/playwright:v\d+\.\d+\.\d+-noble$/
  );
});

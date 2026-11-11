import process from 'node:process';
import console from 'node:console';
import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Read only the root importer's direct dependency, without installing packages
// just to choose the job container. Fail closed if the lockfile shape changes.
export function playwrightImage(lockfile, visualEnvironment) {
  const root = lockfile.match(/^ {2}\.:\r?\n([\s\S]*?)(?=^ {2}\S|^\S|(?![\s\S]))/m)?.[1];
  const versions = [
    ...(root ?? '').matchAll(/^ {6}playwright:\r?\n {8}specifier: [^\r\n]+\r?\n {8}version: (\d+\.\d+\.\d+)\r?$/gm),
  ];
  if (versions.length !== 1) throw new Error('Expected one exact root Playwright version in pnpm-lock.yaml');
  const version = versions[0][1];
  const tag = `mcr.microsoft.com/playwright:v${version}-noble`;
  if (visualEnvironment?.playwrightVersion === version) {
    if (
      !visualEnvironment.image.startsWith(`${tag}@sha256:`) ||
      !/^sha256:[a-f0-9]{64}$/.test(visualEnvironment.image.split('@')[1])
    ) {
      throw new Error('Invalid pinned visual-test image');
    }
    return visualEnvironment.image;
  }
  return tag;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const image = playwrightImage(
    readFileSync('pnpm-lock.yaml', 'utf8'),
    JSON.parse(readFileSync('tests/visual/environment.json', 'utf8'))
  );
  console.log(image);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `image=${image}\n`);
}

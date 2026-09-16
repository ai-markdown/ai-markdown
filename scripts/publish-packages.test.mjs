/* global process */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  chmodSync,
  rmSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

for (const version of ['3.0.0-beta.2', '3.0.0-rc.1', '3.0.0']) {
  test(`publication channels and scoped bootstrap credentials (${version})`, () => {
    const root = mkdtempSync(join(tmpdir(), 'aimd-publish-auth-'));
    try {
      mkdirSync(join(root, 'scripts'));
      mkdirSync(join(root, 'bin'));
      mkdirSync(join(root, 'state'));
      mkdirSync(join(root, 'runner'));
      for (const script of ['publish-packages.mjs', 'check-release.mjs', 'release-packages.mjs'])
        copyFileSync(resolve('scripts', script), join(root, 'scripts', script));
      const rootManifest = JSON.parse(readFileSync('package.json', 'utf8'));
      rootManifest.version = version;
      writeFileSync(join(root, 'package.json'), JSON.stringify(rootManifest));
      const packages = [
        'engine',
        'core',
        'react',
        'react-mantine',
        'vue',
        'remark-mark-highlight',
        'code-language-detector',
      ];
      for (const name of packages) {
        mkdirSync(join(root, 'packages', name), { recursive: true });
        const manifest = JSON.parse(readFileSync(resolve('packages', name, 'package.json'), 'utf8'));
        if (!['remark-mark-highlight', 'code-language-detector'].includes(name)) manifest.version = version;
        if (name === 'react-mantine')
          manifest.peerDependencies['@ai-markdown/react'] = version.includes('-') ? version : `^${version}`;
        writeFileSync(join(root, 'packages', name, 'package.json'), JSON.stringify(manifest));
      }
      const command = `#!/usr/bin/env node
import fs from 'node:fs'; import path from 'node:path';
const args = process.argv.slice(2), tool = path.basename(process.argv[1]);
if (args.includes('pack')) process.exit(0);
let name;
if (tool === 'npm') {
  name = 'vue';
  const config = process.env.NPM_CONFIG_USERCONFIG;
  if (!config || !fs.readFileSync(config, 'utf8').includes('$'+'{FIRST_PUBLISH_NPM_TOKEN}')) throw Error('missing isolated placeholder config');
} else {
  name = args[args.indexOf('--filter') + 1].split('/').pop();
  if (process.env.NPM_CONFIG_USERCONFIG) throw Error('bootstrap credential leaked to OIDC subprocess');
}
fs.writeFileSync(path.join('state', name), tool);
`;
      for (const name of ['pnpm', 'npm']) {
        const file = join(root, 'bin', name);
        writeFileSync(file, command);
        chmodSync(file, 0o755);
      }
      const mock = `import fs from 'node:fs';
globalThis.fetch = async (url) => {
 const decoded = decodeURIComponent(url).replace('https://registry.npmjs.org/', '');
 const name = decoded.replace('-/package/', '').split('/')[1];
 const pkg = JSON.parse(fs.readFileSync('packages/' + name + '/package.json'));
 const published = fs.existsSync('state/' + name);
 const tags = { [pkg.version.includes('-') ? pkg.version.split('-')[1].split('.')[0] : 'latest']: pkg.version };
 if (process.env.SIMULATE_LATEST === name) tags.latest = pkg.version;
 if (decoded.startsWith('-/package/')) return Response.json(tags);
 if (!published) return new Response('', { status: 404 });
 const manifest = { name: pkg.name, version: pkg.version, dist: { tarball: 'https://example.invalid/packed.tgz' } };
 return Response.json(decoded.split('/').length > 2 ? manifest : { versions: { [pkg.version]: manifest } });
};`;
      writeFileSync(join(root, 'mock.mjs'), mock);
      const env = {
        ...process.env,
        PATH: join(root, 'bin') + ':' + process.env.PATH,
        RUNNER_TEMP: join(root, 'runner'),
        FIRST_PUBLISH_NPM_TOKEN: 'test-placeholder-only',
        FIRST_PUBLISH_PACKAGE: '@ai-markdown/vue',
        // Simulate the release workflow running from the pushed tag, which is
        // the ref provenance must record. Set explicitly: a CI runner's own
        // GITHUB_REF (a pull request or branch ref) would otherwise leak in.
        GITHUB_ACTIONS: 'true',
        GITHUB_REF: 'refs/tags/v' + version,
      };
      delete env.NPM_CONFIG_USERCONFIG;
      execFileSync(
        process.execPath,
        ['--import', join(root, 'mock.mjs'), 'scripts/publish-packages.mjs', 'v' + version],
        { cwd: root, env, stdio: 'pipe', timeout: 15000 }
      );
      assert.equal(readFileSync(join(root, 'state/vue'), 'utf8'), 'npm');
      for (const name of packages.filter((name) => name !== 'vue'))
        assert.equal(readFileSync(join(root, 'state', name), 'utf8'), 'pnpm');
      assert(!readdirSync(join(root, 'runner/first-publish-packs')).includes('first-publish.npmrc'));
      const run = (name) =>
        execFileSync(
          process.execPath,
          ['--import', join(root, 'mock.mjs'), 'scripts/publish-packages.mjs', 'v' + version],
          { cwd: root, env: { ...env, SIMULATE_LATEST: name }, stdio: 'pipe', timeout: 15000 }
        );
      if (version === '3.0.0-beta.2')
        assert.match(run('vue').toString(), /Retaining approved first-publication latest tag/);
      if (version.includes('-')) {
        assert.throws(() => run('react'), /remove the unintended latest dist-tag/);
        if (version !== '3.0.0-beta.2') assert.throws(() => run('vue'), /remove the unintended latest dist-tag/);
      } else assert.match(run('react').toString(), /Verified installer metadata and latest tag/);
      // Existing packages must all publish through OIDC without bootstrap secrets.
      for (const name of packages) rmSync(join(root, 'state', name));
      const oidcEnv = { ...env };
      delete oidcEnv.FIRST_PUBLISH_NPM_TOKEN;
      delete oidcEnv.FIRST_PUBLISH_PACKAGE;
      execFileSync(
        process.execPath,
        ['--import', join(root, 'mock.mjs'), 'scripts/publish-packages.mjs', 'v' + version],
        { cwd: root, env: oidcEnv, stdio: 'pipe', timeout: 15000 }
      );
      for (const name of packages) assert.equal(readFileSync(join(root, 'state', name), 'utf8'), 'pnpm');
      // A workflow_dispatch run started from a branch would attach provenance
      // naming refs/heads/<branch>, which scripts/check-published-release.mjs
      // rejects. The upload must fail before the first publish subprocess.
      for (const name of packages) rmSync(join(root, 'state', name));
      const branchEnv = { ...oidcEnv, GITHUB_REF: 'refs/heads/main' };
      assert.throws(
        () =>
          execFileSync(
            process.execPath,
            ['--import', join(root, 'mock.mjs'), 'scripts/publish-packages.mjs', 'v' + version],
            { cwd: root, env: branchEnv, stdio: 'pipe', timeout: 15000 }
          ),
        (error) => {
          assert.match(error.stderr.toString(), /provenance must reference the release tag \(refs\/tags\/v/);
          assert.match(error.stderr.toString(), /Refusing to upload from refs\/heads\/main/);
          return true;
        }
      );
      assert.deepEqual(readdirSync(join(root, 'state')), [], 'no package may be uploaded from a branch ref');
      // Outside GitHub Actions there is no workflow ref to record; the check
      // stays out of the way of the mocked local runs above.
      const localEnv = { ...branchEnv };
      delete localEnv.GITHUB_ACTIONS;
      execFileSync(
        process.execPath,
        ['--import', join(root, 'mock.mjs'), 'scripts/publish-packages.mjs', 'v' + version],
        { cwd: root, env: localEnv, stdio: 'pipe', timeout: 15000 }
      );
      for (const name of packages) assert.equal(readFileSync(join(root, 'state', name), 'utf8'), 'pnpm');
      // Everything is now published, so a branch-ref recovery run has nothing
      // to upload and finishes on the skip path without touching the check.
      const recovery = execFileSync(
        process.execPath,
        ['--import', join(root, 'mock.mjs'), 'scripts/publish-packages.mjs', 'v' + version],
        { cwd: root, env: branchEnv, stdio: 'pipe', timeout: 15000 }
      ).toString();
      for (const name of packages) assert.match(recovery, new RegExp(`Already published: @ai-markdown/${name}@`));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

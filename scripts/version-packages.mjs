#!/usr/bin/env node
/* global process, console */

// Sync all versions across the monorepo.
//
// Usage: node scripts/version-packages.mjs <new-version>
//
// - Updates "version" in every LOCKSTEP package (engine, core, react, react-mantine — the
//   release train); independently versioned packages (remark-mark-highlight)
//   are reported and skipped
// - For integration lockstep packages, updates peerDependencies["@ai-markdown/react"] to ^<new-version>
// - Rewrites React version references in README files and an allowlist of guides
//   (install snippets, examples)

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const newVersion = process.argv[2];
if (!newVersion) {
  console.error('Usage: node scripts/version-packages.mjs <new-version>');
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(newVersion)) {
  console.error(`Invalid version: "${newVersion}". Expected format: x.y.z or x.y.z-tag`);
  process.exit(1);
}

const ROOT = resolve(import.meta.dirname, '..');
const PACKAGES_DIR = join(ROOT, 'packages');
const REACT_PKG_NAME = '@ai-markdown/react';

// Release-train LOCKSTEP set: these ship together at the train version and
// get their React peer range rewritten. Every other workspace package (e.g.
// plugin packages like @ai-markdown/remark-mark-highlight) versions
// INDEPENDENTLY: it is skipped here, published from a train tag only when
// its own version was bumped (`pnpm publish -r` skips already-published
// versions), or standalone via a `<pkg>-vX.Y.Z` tag.
const LOCKSTEP = new Set([
  REACT_PKG_NAME,
  '@ai-markdown/core',
  '@ai-markdown/react-mantine',
  '@ai-markdown/engine',
  '@ai-markdown/vue',
]);

// Update root package.json
const rootPkgPath = join(ROOT, 'package.json');
const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf-8'));
const rootOldVersion = rootPkg.version;
rootPkg.version = newVersion;
writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + '\n');
console.log(`${rootPkg.name} (root): ${rootOldVersion} → ${newVersion}`);

// Update each package
const packageDirs = readdirSync(PACKAGES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

for (const dir of packageDirs) {
  const pkgPath = join(PACKAGES_DIR, dir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const oldVersion = pkg.version;

  if (pkg.private) {
    console.log(`${pkg.name}: ${oldVersion} (private workspace — not published)`);
    continue;
  }

  if (!LOCKSTEP.has(pkg.name)) {
    console.log(`${pkg.name}: ${oldVersion} (independent — not part of the release train)`);
    continue;
  }

  pkg.version = newVersion;

  // For integration packages, sync peerDependencies on React
  if (pkg.name !== REACT_PKG_NAME && pkg.peerDependencies?.[REACT_PKG_NAME]) {
    pkg.peerDependencies[REACT_PKG_NAME] = newVersion.includes('-') ? newVersion : `^${newVersion}`;
  }

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`${pkg.name}: ${oldVersion} → ${newVersion}`);
}

// Sync React version references in READMEs, adapter references and allowlisted guides
// (peer-dep install snippets like `"@ai-markdown/react": "^1.4.5"` and inline
// examples like `@ai-markdown/react@1.4.5`) so docs don't drift behind
// releases. The peer snippet is rewritten to the same range package.json
// receives (exact for a pre-release, caret otherwise), whether or not the
// current text carries a caret: a pre-release snippet has none, and leaving
// it caret-less on the following stable bump is how the docs drifted before.
//
// Guides are an explicit allowlist, never a directory glob: release notes,
// migration guides, release records and any guide that describes a specific
// past release (release-highlights.md, migrating-to-v2.md,
// framework-transition.md, releasing-3.0.md, architecture.md's "stable
// @ai-markdown/vue@3.0.0 adapter") carry version references that must stay
// as written. Add a guide here only when its install or peer snippet is
// meant to move with every train version.
const GUIDES_DIR = join(ROOT, 'apps', 'docs', 'content', 'guides');
const TRANSLATED_CONTENT_DIR = join(
  ROOT,
  'apps',
  'docs',
  'content',
  'translations',
  'zh-cn',
  'apps',
  'docs',
  'content'
);
const TRACKING_GUIDES = ['extending-via-subpackage.md', 'getting-started.md'];
const readmePaths = [
  join(ROOT, 'README.md'),
  ...packageDirs.map((dir) => join(PACKAGES_DIR, dir, 'README.md')),
  ...TRACKING_GUIDES.map((name) => join(GUIDES_DIR, name)),
  ...['react', 'vue', 'react-mantine'].map((name) => join(ROOT, 'apps', 'docs', 'content', 'reference', `${name}.md`)),
  ...TRACKING_GUIDES.map((name) => join(TRANSLATED_CONTENT_DIR, 'guides', name)),
  ...['react', 'vue', 'react-mantine'].map((name) => join(TRANSLATED_CONTENT_DIR, 'reference', `${name}.md`)),
];
const VERSION = String.raw`\d+\.\d+\.\d+(?:-[\w.]+)?`;
const peerRange = newVersion.includes('-') ? newVersion : `^${newVersion}`;
const README_PATTERNS = [
  [new RegExp(`("${REACT_PKG_NAME}":\\s*")\\^?${VERSION}(")`, 'g'), `$1${peerRange}$2`],
  [new RegExp(`(${REACT_PKG_NAME}@)${VERSION}`, 'g'), `$1${newVersion}`],
];
for (const readmePath of readmePaths) {
  if (!existsSync(readmePath)) continue;
  const before = readFileSync(readmePath, 'utf-8');
  let after = before;
  for (const [pattern, replacement] of README_PATTERNS) {
    after = after.replace(pattern, replacement);
  }
  // The requirements page names the checkout's train explicitly. Keep the
  // versioned statement narrow so historical release descriptions never move.
  if (readmePath === join(GUIDES_DIR, 'getting-started.md')) {
    after = after.replace(
      new RegExp('This guide targets the `' + VERSION + '` package train\\.'),
      'This guide targets the `' + newVersion + '` package train.'
    );
  }
  if (after !== before) {
    writeFileSync(readmePath, after);
    console.log(`${readmePath.slice(ROOT.length + 1)}: Current version refs → ${newVersion}`);
  }
}

console.log('\nDone. Run `pnpm install` to update the lockfile.');

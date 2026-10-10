/* global process, console */

/**
 * Proves, by EXECUTION, that the provenance fallback diagnostic cannot fire
 * from the production artifact.
 *
 * Why not a string-absence check: the build removes the folded dev-only
 * branch today, but whether dead code is dropped is the bundler's choice and
 * the string may legitimately reappear in `dist/index.js`. The contract
 * this script enforces is "not executable in production", never "absent
 * from the bundle".
 *
 * Two child processes, each with `globalThis.crypto` removed so the
 * fallback path is taken, each rendering a coordinated tree through
 * react-dom/server and capturing `console.error`:
 *   - the production entry (`dist/index.js`) must emit NO diagnostic;
 *   - the development entry (`dist/index.dev.js`) must emit it (proves the
 *     probe actually reaches the fallback path — a silent production run
 *     would otherwise be indistinguishable from a broken probe).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = 'credential is unique but not secret';

function probe(entry) {
  const script = `
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
    const errors = [];
    console.error = (...args) => { errors.push(args.map(String).join(' ')); };
    const React = await import('react');
    const { renderToString } = await import('react-dom/server');
    const core = await import(${JSON.stringify(entry)});
    const AIMarkdown = core.default;
    const { AIMarkdownDocuments } = core;
    const html = renderToString(
      React.createElement(
        AIMarkdownDocuments,
        null,
        React.createElement(AIMarkdown, { content: 'See [^a].\\n\\n[^a]: note', documentId: 'm' })
      )
    );
    process.stdout.write(JSON.stringify({ html, errors }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: pkgDir,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    console.error(`assert-prod-diagnostic-inert: probe of ${entry} failed to run:\n${result.stderr}`);
    process.exit(1);
  }
  const out = JSON.parse(result.stdout);
  if (!out.html.includes('note')) {
    console.error(`assert-prod-diagnostic-inert: probe of ${entry} did not render the document.`);
    process.exit(1);
  }
  return out.errors.filter((e) => e.includes(MARKER)).length;
}

const prod = probe('./dist/index.js');
const dev = probe('./dist/index.dev.js');

if (prod !== 0) {
  console.error(
    `assert-prod-diagnostic-inert: the production entry emitted the provenance fallback diagnostic ${prod} time(s); ` +
      'the NODE_ENV gate in src/components/provenance.ts is not folded.'
  );
  process.exit(1);
}
if (dev === 0) {
  console.error(
    'assert-prod-diagnostic-inert: the development entry emitted no fallback diagnostic — the probe is not reaching the fallback path, so the production result proves nothing.'
  );
  process.exit(1);
}

/* global process, console, fetch, AbortSignal */

/**
 * Downloads the hand-picked GitHub corpus into a local directory, for the
 * evidence harnesses in `src/evidence/`. Two lists make two splits:
 *   - `tune`: `github-tune.tsv`, the files rules were designed against
 *   - `holdout`: `github-holdout.tsv`, never used to design rules
 *
 * Usage: node scripts/fetch-github-corpus.mjs [corpus directory]
 *
 * The directory defaults to a folder under the OS temp directory, the same
 * default the harnesses read. Files land in `<split>/<language>/`; those
 * language directories are replaced on every run, and nothing else in the
 * directory is touched. Every file is fetched at the commit its list pins, so
 * the corpus does not move with upstream.
 *
 * The downloaded files remain under their repositories' licenses. Keep the
 * corpus directory out of this repository.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_CORPUS_DIR = join(tmpdir(), 'code-language-detector-corpus');

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h') || args.length > 1) {
  console.log('Usage: node scripts/fetch-github-corpus.mjs [corpus directory]');
  console.log(`Default directory: ${DEFAULT_CORPUS_DIR}`);
  process.exit(args.length > 1 ? 1 : 0);
}
const out = resolve(args[0] || DEFAULT_CORPUS_DIR);

const here = dirname(fileURLToPath(import.meta.url));
const LISTS = { tune: 'github-tune.tsv', holdout: 'github-holdout.tsv' };
const entries = Object.entries(LISTS).flatMap(([split, list]) =>
  readFileSync(join(here, list), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('#'))
    .map((line) => {
      const [language, repo, commit, path] = line.split('\t');
      if (!language || !repo || !/^[0-9a-f]{40}$/.test(commit ?? '') || !path)
        throw new Error(`Malformed line in ${list}: ${JSON.stringify(line)}`);
      return { split, language, repo, commit, path };
    })
);

for (const directory of new Set(entries.map((entry) => join(entry.split, entry.language)))) {
  rmSync(join(out, directory), { recursive: true, force: true });
  mkdirSync(join(out, directory), { recursive: true });
}

const CONCURRENCY = 8;
const ATTEMPTS = 3;
let ok = 0;
const failures = [];
let next = 0;

async function worker() {
  while (next < entries.length) {
    const { split, language, repo, commit, path } = entries[next++];
    const name = `${repo.replace('/', '_')}__${path.replace(/[/ ]/g, '_')}`;
    const url = `https://raw.githubusercontent.com/${repo}/${commit}/${path.split('/').map(encodeURIComponent).join('/')}`;
    // raw.githubusercontent.com times out now and then; a pinned commit makes a retry safe.
    for (let attempt = 1; ; attempt += 1) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        writeFileSync(join(out, split, language, name), await response.text());
        ok += 1;
        break;
      } catch (error) {
        if (attempt < ATTEMPTS) continue;
        failures.push(`${repo} ${path}: ${error instanceof Error ? error.message : String(error)}`);
        break;
      }
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

for (const failure of failures) console.error(`failed: ${failure}`);
console.log(`Fetched ${ok} of ${entries.length} files into ${out}`);
if (failures.length > 0) process.exit(1);

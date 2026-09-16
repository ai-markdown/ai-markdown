/**
 * Shared helpers for the evidence harnesses. The corpus layout is
 * `<root>/<languageId>/<any file name>`: the directory name is the ground truth.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CodeLanguage } from '../language';

/** Where `scripts/fetch-github-corpus.mjs` writes by default */
const DEFAULT_CORPUS_DIR = join(tmpdir(), 'code-language-detector-corpus');

/** The corpus directory: `CORPUS_DIR`, or the fetch script's default */
export function corpusRoot(): string {
  return resolve(process.env.CORPUS_DIR || DEFAULT_CORPUS_DIR);
}

const KNOWN: ReadonlySet<string> = new Set(Object.values(CodeLanguage));

/**
 * The language directories of a corpus. Directories whose name is not a language id are skipped. Throws when there
 * are none, so a missing fetch fails with instructions instead of printing an empty report.
 */
export function corpusLanguages(root: string): CodeLanguage[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    // reported below
  }
  const languages = entries
    .filter((entry) => KNOWN.has(entry) && statSync(join(root, entry)).isDirectory())
    .sort() as CodeLanguage[];
  if (languages.length === 0) {
    throw new Error(
      `Corpus directory ${root} does not exist or has no language directories. ` +
        'Fetch it first with `node scripts/fetch-github-corpus.mjs [directory]`, and pass a non-default directory as CORPUS_DIR.'
    );
  }
  return languages;
}

/** The files of one language directory, as paths, in a stable order */
export function corpusFiles(root: string, language: string): string[] {
  return readdirSync(join(root, language))
    .filter((name) => !name.startsWith('.'))
    .sort()
    .map((name) => join(root, language, name));
}

/** Reads a corpus file as text, or returns null for unreadable, binary or nearly empty files */
export function readCorpusText(path: string): string | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  if (text.includes('\0') || text.trim().length < 60) return null;
  return text;
}

/**
 * Samples evenly from one language's file list and deduplicates by "the first three non-empty lines".
 *
 * Deduplication matters: a corpus can contain many files generated from one template (a local corpus once held
 * dozens of near-identical `*.i18n.yaml` pair records, four comment lines plus two hash lines). Without it, 24 of
 * the 25 YAML files a streaming run picked were that template, and the YAML row only said whether that one
 * template was detected.
 *
 * Sampling order: first by an even stride, then the remaining files fill in, so the limit is still reached after
 * deduplication, and the result is deterministic (the same file list always gives the same sample).
 */
export function pickDistinct(files: readonly string[], limit: number): string[] {
  const step = Math.max(1, Math.floor(files.length / limit));
  const ordered = [...files.filter((_, i) => i % step === 0), ...files.filter((_, i) => i % step !== 0)];

  const seen = new Set<string>();
  const picked: string[] = [];
  for (const file of ordered) {
    if (picked.length >= limit) break;
    const text = readCorpusText(file);
    if (text === null) continue;
    const head = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join('\n');
    if (seen.has(head)) continue;
    seen.add(head);
    picked.push(file);
  }
  return picked;
}

/** Formats a ratio as a percentage, or an em dash when the denominator is 0 */
export function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`;
}

/** The value at quantile q of an ascending array */
export function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(Math.floor(sorted.length * q), sorted.length - 1)];
}

/** Prints one line. `console.*` output of a passing vitest case is discarded. */
export function print(line = ''): void {
  process.stdout.write(`${line}\n`);
}

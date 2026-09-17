/**
 * EVIDENCE HARNESS — not a test. Run it with
 * `pnpm --filter @ai-markdown/code-language-detector evidence` after fetching the corpus.
 *
 * One-shot detection accuracy on the hand-picked GitHub corpus
 * (`scripts/github-curated.tsv`). The corpus exists to cover languages that a
 * synthetic fixture set cannot represent honestly: Objective-C, Zig, Scala,
 * MATLAB, Julia, Assembly, AppleScript, Vue, Svelte, Less and VB had no real
 * samples before, only handwritten fixtures, and handwritten samples lean
 * systematically towards textbook style.
 *
 * Each snippet is the start of a file, 8 to 35 lines long, which is what an
 * agent streams into a code fence. "strict" counts only the exact language as
 * correct; "loose" also accepts a language of the same family (`.ts` detected
 * as `javascript`), which barely affects highlighting. Streaming behaviour is
 * measured separately in `streaming.evidence.ts`.
 */
import { it } from 'vitest';
import { detectLanguage } from '../detector';
import { sameFamily } from '../families';
import type { CodeLanguage } from '../language';
import { join } from 'node:path';
import {
  CORPUS_SPLITS,
  corpusFiles,
  corpusLanguages,
  corpusRoot,
  pct,
  print,
  quantile,
  readCorpusText,
} from './corpus';

// Fixed-seed pseudo-random snippet lengths, reset for each split, so runs are comparable
const SEED = 20260916;
let seed = SEED;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

/** The first 8 to 35 lines of a file, or null when the file is too short to say anything */
function headSnippet(text: string): string | null {
  const lines = text.split('\n');
  if (lines.length < 5) return null;
  const snippet = lines
    .slice(0, 8 + Math.floor(rand() * 28))
    .join('\n')
    .trim();
  return snippet.length < 40 ? null : snippet;
}

interface LanguageStat {
  language: CodeLanguage;
  files: number;
  detected: number;
  strict: number;
  loose: number;
  wrong: { got: string; head: string }[];
}

for (const split of CORPUS_SPLITS) {
  it(`one-shot accuracy on the GitHub corpus (${split})`, () => {
    const root = join(corpusRoot(), split);
    seed = SEED;
    const stats: LanguageStat[] = [];
    const timings: number[] = [];

    for (const language of corpusLanguages(root)) {
      const stat: LanguageStat = { language, files: 0, detected: 0, strict: 0, loose: 0, wrong: [] };
      for (const file of corpusFiles(root, language)) {
        const text = readCorpusText(file);
        const snippet = text === null ? null : headSnippet(text);
        if (!snippet) continue;
        stat.files += 1;

        const started = performance.now();
        const result = detectLanguage(snippet);
        timings.push(performance.now() - started);

        if (result.language === null) continue;
        stat.detected += 1;
        if (result.language === language) {
          stat.strict += 1;
          stat.loose += 1;
        } else if (sameFamily(result.language, language)) {
          stat.loose += 1;
        } else {
          stat.wrong.push({ got: result.language, head: snippet.slice(0, 64).replace(/\n/g, '\\n') });
        }
      }
      stats.push(stat);
    }

    const sum = (pick: (stat: LanguageStat) => number) => stats.reduce((total, stat) => total + pick(stat), 0);
    const files = sum((stat) => stat.files);
    const detected = sum((stat) => stat.detected);
    const strict = sum((stat) => stat.strict);
    const loose = sum((stat) => stat.loose);

    print(`\nGitHub corpus · one-shot detection · ${files} snippets from ${root}\n`);
    print(
      `${'language'.padEnd(14)} ${'files'.padStart(5)} ${'detected'.padStart(9)} ${'strict'.padStart(8)} ${'loose'.padStart(8)}`
    );
    for (const stat of stats) {
      print(
        `${stat.language.padEnd(14)} ${String(stat.files).padStart(5)} ${pct(stat.detected, stat.files).padStart(9)}` +
          ` ${pct(stat.strict, stat.detected).padStart(8)} ${pct(stat.loose, stat.detected).padStart(8)}`
      );
    }
    print(`\n  strict precision   ${pct(strict, detected)} (${strict}/${detected})`);
    print(`  loose precision    ${pct(loose, detected)} (${loose}/${detected})`);
    print(`  coverage           ${pct(detected, files)} (${detected}/${files})`);
    timings.sort((a, b) => a - b);
    if (timings.length > 0) {
      print(
        `  time per detection p50 ${quantile(timings, 0.5).toFixed(3)}ms · p95 ${quantile(timings, 0.95).toFixed(3)}ms`
      );
    }

    const wrong = stats.flatMap((stat) => stat.wrong.map((entry) => ({ language: stat.language, ...entry })));
    if (wrong.length > 0) {
      print(`\nCross-family misdetections (${wrong.length}, first 12):`);
      for (const entry of wrong.slice(0, 12)) {
        print(`  .${entry.language} detected as ${entry.got}: ${JSON.stringify(entry.head)}`);
      }
    }
  });
}

/**
 * EVIDENCE HARNESS — not a test. Run it with
 * `pnpm --filter @ai-markdown/code-language-detector evidence` after fetching the corpus.
 *
 * Streaming behaviour on the GitHub corpus. It answers three questions:
 *   1. When code arrives line by line, how many lines until the verdict is right? (How soon the reader sees correct
 *      highlighting.)
 *   2. Does a cross-family misdetection ever show up along the way? (Whether the highlighting flickers.)
 *   3. What does streaming a whole file cost in total, and is the verdict right once the fence closes?
 *
 * Questions 1 and 2 only look at the first 40 lines: a code fence longer than that should have been detected long
 * before. Question 3 streams each whole file (one update per line, as an agent would emit it) and then calls
 * finalize on the complete text. Files are deduplicated by their first three non-empty lines, so shared license
 * headers collapse; `CORPUS_FILES_PER_LANGUAGE` caps the sample per language (default 25).
 *
 * This is the measurement to re-run after changing a rule: broad rules easily fix one case and break another, and
 * the cross-family rate here is what caught that before, when unit tests and synthetic fixtures did not.
 */
import { it } from 'vitest';
import { sameFamily } from '../families';
import type { CodeLanguage } from '../language';
import { StreamingLanguageDetector } from '../streaming';
import { join } from 'node:path';
import {
  CORPUS_SPLITS,
  corpusFiles,
  corpusLanguages,
  corpusRoot,
  pct,
  pickDistinct,
  print,
  quantile,
  readCorpusText,
} from './corpus';

for (const split of CORPUS_SPLITS) {
  it(`streaming behaviour on the GitHub corpus (${split})`, () => {
    const root = join(corpusRoot(), split);
    const perLanguage = Number(process.env.CORPUS_FILES_PER_LANGUAGE ?? 25);
    if (!Number.isInteger(perLanguage) || perLanguage < 1)
      throw new Error(
        `CORPUS_FILES_PER_LANGUAGE must be a positive integer, got ${JSON.stringify(process.env.CORPUS_FILES_PER_LANGUAGE)}`
      );
    /** Questions 1 and 2 only look at this many lines */
    const MAX_LINES = 40;

    interface Row {
      language: CodeLanguage;
      /** Line of the first same-family verdict; null when the first MAX_LINES lines never produced one */
      firstCorrectLine: number | null;
      /** Lines at which streaming showed a cross-family misdetection */
      crossFamilyAt: number[];
      /** finalize on the first MAX_LINES lines named a language of the right family */
      finalCorrect: boolean;
      finalLanguage: CodeLanguage | null;
      /** Whole-file run: characters streamed */
      wholeLength: number;
      /** Whole-file run: update calls */
      wholeUpdates: number;
      /** Whole-file run: total time spent in update and finalize */
      wholeMs: number;
      /** Whole-file run: finalize named a language of the right family */
      wholeCorrect: boolean;
      wholeDetected: boolean;
    }

    const rows: Row[] = [];

    for (const language of corpusLanguages(root)) {
      for (const file of pickDistinct(corpusFiles(root, language), perLanguage)) {
        const text = readCorpusText(file);
        if (text === null) continue;
        const allLines = text.split('\n');
        const lines = allLines.slice(0, MAX_LINES);
        if (lines.length < 5) continue;

        const row: Row = {
          language,
          firstCorrectLine: null,
          crossFamilyAt: [],
          finalCorrect: false,
          finalLanguage: null,
          wholeLength: text.length,
          wholeUpdates: 0,
          wholeMs: 0,
          wholeCorrect: false,
          wholeDetected: false,
        };

        const streaming = new StreamingLanguageDetector();
        for (let i = 0; i < lines.length; i += 1) {
          const prefix = lines.slice(0, i + 1).join('\n');
          if (prefix.trim().length === 0) continue;
          const result = streaming.update(prefix);
          if (result.language === null) continue;

          if (sameFamily(result.language, language)) {
            if (row.firstCorrectLine === null) row.firstCorrectLine = i + 1;
          } else {
            row.crossFamilyAt.push(i + 1);
          }
        }
        const final = streaming.finalize(lines.join('\n'));
        row.finalLanguage = final.language;
        row.finalCorrect = final.language !== null && sameFamily(final.language, language);

        // Whole file: prefixes are built outside the timed region, so only detector work is measured
        const prefixes: string[] = [];
        let offset = 0;
        for (const line of allLines) {
          offset += line.length + 1;
          prefixes.push(text.slice(0, Math.min(offset, text.length)));
        }
        const whole = new StreamingLanguageDetector();
        const started = performance.now();
        for (const prefix of prefixes) whole.update(prefix);
        const wholeFinal = whole.finalize(text);
        row.wholeMs = performance.now() - started;
        row.wholeUpdates = prefixes.length;
        row.wholeDetected = wholeFinal.language !== null;
        row.wholeCorrect = wholeFinal.language !== null && sameFamily(wholeFinal.language, language);

        rows.push(row);
      }
    }

    const detected = rows.filter((row) => row.firstCorrectLine !== null);
    const withCross = rows.filter((row) => row.crossFamilyAt.length > 0);
    const finalOk = rows.filter((row) => row.finalCorrect);
    const linesToDetect = detected.map((row) => row.firstCorrectLine as number).sort((a, b) => a - b);

    print(`Streaming benchmark (line by line, up to ${perLanguage} files per language, first ${MAX_LINES} lines)\n`);
    print(`${rows.length} files from ${root}\n`);
    print('Key metrics:');
    print(
      `  cross-family misdetection   ${pct(withCross.length, rows.length)}  (${withCross.length}/${rows.length} files showed a verdict that would make the highlighting flicker)`
    );
    print(`  final verdict correct       ${pct(finalOk.length, rows.length)}  (${finalOk.length}/${rows.length})`);
    print(
      `  detected within ${MAX_LINES} lines     ${pct(detected.length, rows.length)}  (${detected.length}/${rows.length})`
    );
    if (linesToDetect.length > 0) {
      print('\nLines until the first correct verdict:');
      print(
        `  p50 ${quantile(linesToDetect, 0.5)} · p90 ${quantile(linesToDetect, 0.9)} · max ${linesToDetect[linesToDetect.length - 1]}`
      );
    }

    print(
      `\n${'language'.padEnd(14)} ${'files'.padStart(5)} ${'detected'.padStart(9)} ${'cross-family'.padStart(13)} ${'median line'.padStart(12)}`
    );
    const byLanguage = new Map<CodeLanguage, Row[]>();
    for (const row of rows) byLanguage.set(row.language, [...(byLanguage.get(row.language) ?? []), row]);
    for (const [language, list] of [...byLanguage.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const ok = list.filter((row) => row.firstCorrectLine !== null);
      const cross = list.filter((row) => row.crossFamilyAt.length > 0);
      const median = ok.length
        ? String(ok.map((row) => row.firstCorrectLine as number).sort((a, b) => a - b)[Math.floor(ok.length / 2)])
        : '—';
      print(
        `${language.padEnd(14)} ${String(list.length).padStart(5)} ${pct(ok.length, list.length).padStart(9)} ${pct(cross.length, list.length).padStart(13)} ${median.padStart(12)}`
      );
    }

    if (withCross.length > 0) {
      print('\nFiles with a cross-family misdetection:');
      for (const row of withCross.slice(0, 10)) {
        print(
          `  .${row.language} detected as another family at line ${row.crossFamilyAt.join(',')}, final ${row.finalLanguage}`
        );
      }
    }

    if (rows.length > 0) {
      const costs = rows.map((row) => row.wholeMs).sort((a, b) => a - b);
      const wholeOk = rows.filter((row) => row.wholeCorrect).length;
      const wholeDetected = rows.filter((row) => row.wholeDetected).length;
      const meanKb = rows.reduce((total, row) => total + row.wholeLength, 0) / rows.length / 1024;
      const meanUpdates = rows.reduce((total, row) => total + row.wholeUpdates, 0) / rows.length;
      print('\nWhole files streamed line by line, then finalized:');
      print(`  mean size ${meanKb.toFixed(1)}KB · mean ${Math.round(meanUpdates)} update calls per file`);
      print(
        `  total detection time per file   p50 ${quantile(costs, 0.5).toFixed(1)}ms · p90 ${quantile(costs, 0.9).toFixed(1)}ms · max ${costs[costs.length - 1].toFixed(1)}ms`
      );
      print(`  finalize detected               ${pct(wholeDetected, rows.length)}  (${wholeDetected}/${rows.length})`);
      print(`  finalize same-family correct    ${pct(wholeOk, wholeDetected)}  (${wholeOk}/${wholeDetected})`);
    }
  });
}

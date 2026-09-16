# @ai-markdown/code-language-detector

[Documentation](https://ai-markdown.github.io/docs/plugins/code-language-detector/) · [Examples](https://ai-markdown.github.io/examples/) · [Website](https://ai-markdown.github.io/)

[![@ai-markdown/code-language-detector latest](https://img.shields.io/npm/v/@ai-markdown/code-language-detector/latest?label=npm%20latest&color=blue)](https://www.npmjs.com/package/@ai-markdown/code-language-detector?activeTab=versions)
[![@ai-markdown/code-language-detector monthly downloads](https://img.shields.io/npm/dm/@ai-markdown/code-language-detector?label=downloads%2Fmonth&color=blue)](https://www.npmjs.com/package/@ai-markdown/code-language-detector)
[![TypeScript declarations included](https://img.shields.io/badge/TypeScript-included-3178c6?logo=typescript&logoColor=white)](https://github.com/ai-markdown/ai-markdown/tree/main/packages/code-language-detector)
[![MIT license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/ai-markdown/ai-markdown/blob/main/packages/code-language-detector/LICENSE)

Heuristic language detection for code blocks that carry no language tag, such as an unlabelled Markdown code fence in LLM output. It returns an id you can hand to Shiki or highlight.js.

The main use case is **streamed agent output**: code arrives line by line, the detector has to produce a usable verdict before the block is complete, and it must not change its mind back and forth along the way, because every flip makes the highlighting flicker.

The guiding principle is **better to say "I don't know" than to guess wrong**. When the evidence is weak the result is `language: null` plus a short candidate list, not a forced pick.

- Zero runtime dependencies, synchronous, about 315 regex rules over 42 languages.
- Streaming detector with four stability strategies; 0 cross-family flips on the reproducible corpus.
- Converters to Shiki and highlight.js language names, and normalizers that map language names written by people, models and tools to a `CodeLanguage` or to the name a highlighter uses.

## Install

```bash
npm install @ai-markdown/code-language-detector
```

Dual ESM/CJS build: both `import` and `require` work, types included for both.

## Use

### One-shot detection

```ts
import { detectLanguage } from '@ai-markdown/code-language-detector';

const result = detectLanguage(code);
// {
//   language: 'rust',              // CodeLanguage.Rust, or null when the evidence is not enough
//   confidence: 1,                 // 0..1; a language is only named at 0.8 and above
//   candidates: ['rust'],          // best first, at most four, present even when language is null
//   evidence: ['rs-fn', 'rs-let-mut', ...], // rule ids, for debugging
// }

const lang = result.language ?? 'text';
```

`language` is a `CodeLanguage` enum member. Its values are the Shiki language ids, so `result.language === 'rust'` and `result.language === CodeLanguage.Rust` are the same check.

### Streaming

```ts
import { StreamingLanguageDetector } from '@ai-markdown/code-language-detector';

const detector = new StreamingLanguageDetector();

// On every chunk, pass the complete code accumulated so far, not the delta.
// Most calls return the cached result without detecting anything.
onChunk((accumulated) => {
  render(detector.update(accumulated).language ?? 'text');
});

// When the fence closes, detect once more on the complete content.
onFenceClose((full) => {
  render(detector.finalize(full).language ?? 'text');
});
```

Use one detector per code block. Calling `update` or `finalize` again with the same text (a re-render) returns the cached result without detecting.

### Cache across renders

```ts
import { DetectionCache } from '@ai-markdown/code-language-detector';

const cache = new DetectionCache(500); // LRU, keyed by a content hash
const result = cache.detect(code); // the same content is detected once
```

### Converters

```ts
import { detectLanguage, toHighlightJsLanguage, toShikiLanguage } from '@ai-markdown/code-language-detector';

const { language } = detectLanguage(code);

// Shiki: the ids already match
const html = language ? await codeToHtml(code, { lang: toShikiLanguage(language), theme }) : escape(code);

// highlight.js: a few names differ, and a grammar may not be registered
const name = language ? toHighlightJsLanguage(language) : null;
const highlighted = name && hljs.getLanguage(name) ? hljs.highlight(code, { language: name }).value : escape(code);
```

| `CodeLanguage`          | `toHighlightJsLanguage`     | Why                                                                                                                                                                                        |
| ----------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `objective-c`           | `objectivec`                | highlight.js name                                                                                                                                                                          |
| `vb`                    | `vbnet`                     | highlight.js name                                                                                                                                                                          |
| `asm`                   | `x86asm`                    | highlight.js name                                                                                                                                                                          |
| `jsx` / `tsx`           | `javascript` / `typescript` | highlight.js only has these as aliases; spelled out so registration of aliases does not matter                                                                                             |
| `html`, `vue`, `svelte` | `xml`                       | `html` is an alias of `xml`. There is no Vue or Svelte grammar; `xml` highlights `<script>` as JavaScript and `<style>` as CSS sub-languages, where `javascript` would mangle the template |
| `zig`                   | `zig`                       | Not built into highlight.js, but third-party grammar packages register it under this name; check `hljs.getLanguage` and fall back to plain text                                            |
| everything else         | unchanged                   |                                                                                                                                                                                            |

### Normalizing language names

Models and people write language names on code fences that a highlighter may spell differently or not know at all: `objc`, `txt`, `Makefile`, `console`. `normalizeHighlightJsLanguage` and `normalizeShikiLanguage` map such a name to the name the highlighter library uses. Both ignore case and surrounding whitespace and always return a string:

- A name of one of the 42 languages resolves through `normalizeCodeLanguage` and the matching converter, so `objc` becomes `objectivec` for highlight.js and `objective-c` for Shiki, and `vue` becomes `xml` for highlight.js.
- A common name outside the 42 whose spelling differs between the highlighters is translated by a small table that covers plain text, shell sessions, batch files, Makefiles, CoffeeScript, Fortran, Delphi, Vim script, Jinja, Mathematica, Common Lisp, Protocol Buffers, patches, Elixir, Perl, NDJSON and Objective-C++.
- Any other name comes back lower-cased as written (`haskell`, `jsonc`), because it may well be a language the highlighter knows.

| Fence name                     | `normalizeHighlightJsLanguage` | `normalizeShikiLanguage` |
| ------------------------------ | ------------------------------ | ------------------------ |
| `objc`                         | `objectivec`                   | `objective-c`            |
| `vue`                          | `xml`                          | `vue`                    |
| `txt`, `text`, `plain`, empty  | `plaintext`                    | `text`                   |
| `console`                      | `shell`                        | `shellsession`           |
| `batch`, `bat`, `cmd`          | `dos`                          | `bat`                    |
| `Makefile`                     | `makefile`                     | `make`                   |
| `coffee`                       | `coffeescript`                 | `coffee`                 |
| `viml`                         | `vim`                          | `viml`                   |
| `jinja2`                       | `django`                       | `jinja`                  |
| `proto`                        | `protobuf`                     | `proto`                  |
| `patch`                        | `diff`                         | `diff`                   |
| `ndjson`                       | `json`                         | `jsonl`                  |
| `mm`, `objective-c++`          | `objectivec`                   | `objective-cpp`          |
| `haskell`, `jsonc` (any other) | lower-cased only               | lower-cased only         |

```ts
import { detectLanguage, normalizeHighlightJsLanguage } from '@ai-markdown/code-language-detector';

// A fence with an info string: trust it, and only detect when there is none
const language = info || detectLanguage(code).language;
const hljsName = language ? normalizeHighlightJsLanguage(language) : 'plaintext';
const highlighted = hljs.getLanguage(hljsName) ? hljs.highlight(code, { language: hljsName }).value : escape(code);
```

The result is a name, not a guarantee that the grammar is registered or loaded: check `hljs.getLanguage(name)` or your Shiki instance's loaded languages, and fall back to plain text.

`normalizeCodeLanguage` answers a different question: which of the 42 languages a name means. It resolves a name written by a person or another tool (a fence info string, a file extension, a highlight.js or Shiki name or alias) to a `CodeLanguage`, or returns `null` when the name means none of them. It also ignores case and surrounding whitespace, and an exact `CodeLanguage` value always wins over an alias (`html` is `Html`, even though highlight.js files `html` under `xml`).

```ts
import { normalizeCodeLanguage } from '@ai-markdown/code-language-detector';

normalizeCodeLanguage('py'); // CodeLanguage.Python
normalizeCodeLanguage('x86asm'); // CodeLanguage.Assembly
normalizeCodeLanguage('haskell'); // null: not one of the 42
```

Ambiguous names resolve to `null` on purpose: `m` (Objective-C or MATLAB), `s`, `sc`, `conf`, `cfg`, `console` (a shell session, not a script), `sass` (the indented syntax is not SCSS), `gradle`, `jsp`, and Objective-C++ (`mm`). `h` resolves to C. `jsonc` and `json5` also resolve to `null`: they are JSON supersets with their own Shiki grammars, and highlight.js registers both as aliases of `json`, so passing them through to the highlighter works for both. The highlighter-name functions translate `console` and the Objective-C++ names, and pass `jsonc` and `json5` through.

## API

| Export                                    | What                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `detectLanguage(code)`                    | One-shot detection, returns `LanguageDetectionResult`                                                              |
| `StreamingLanguageDetector`               | `update(code)`, `finalize(code)`, `reset()`, `current`; options below                                              |
| `DetectionCache`                          | `new DetectionCache(limit = 500)`, `detect(code)`, `clear()`, `size`                                               |
| `toShikiLanguage(language)`               | Shiki language id (identity)                                                                                       |
| `toHighlightJsLanguage(language)`         | highlight.js language name (see the table above)                                                                   |
| `normalizeHighlightJsLanguage(name)`      | highlight.js language name for a name written on a fence; names it does not know come back lower-cased as written  |
| `normalizeShikiLanguage(name)`            | Shiki language name for a name written on a fence; names it does not know come back lower-cased as written         |
| `normalizeCodeLanguage(name)`             | `CodeLanguage` for a name, extension or highlighter alias; `null` when it names none of the 42                     |
| `CodeLanguage`                            | String enum of the 42 languages; values are Shiki ids                                                              |
| `LanguageDetectionResult` (type)          | `{ language: CodeLanguage \| null; confidence; candidates: readonly CodeLanguage[]; evidence: readonly string[] }` |
| `StreamingLanguageDetectorOptions` (type) | `lockConfidence` (0.9), `growthRatio` (0.5), `minGrowthChars` (80), `familySwitchMargin` (0.1)                     |

Result objects are shared between callers (the unknown result is frozen); treat them as read-only.

## How it works

```
code → rules score every language ─ high confidence ─→ language
                                  └ ambiguous ───────→ language: null, candidates: [2–4 languages]
                                  └ no evidence ─────→ language: null, candidates: []
```

JSON is special-cased: an object or array that `JSON.parse` accepts is `json` at 0.98. Everything else is scored by the rules. Input over 20,000 characters is inspected by its first and last 10,000.

### Design principles

**There is only one kind of rule.** A "definitive" rule is an ordinary rule with a high weight and a `definitive` mark (`<?php`, `let mut`, `System.out.println`). With a single code path there is never a case of "a strong rule fired but the scores say otherwise" that would need arbitration.

**A definitive rule only boosts when it is unique.** Confidence is raised to 0.95 only when exactly one definitive language survives (languages pushed below zero by negative scores do not count) and it is also the top-scoring language. Strong signatures of two languages at once (a Python file holding an SQL string) mean the evidence contradicts itself, so ordinary scoring applies. Picking "the first definitive rule that fired" would make the boosted language depend on the order the rule files are concatenated.

**Definitive rules must be narrow.** Almost every 0.95 misdetection found in review came from a definitive rule written too broadly: `SELECT … FROM` swallowed `import { Select } from '…'` and Drizzle's `select().from()`; the `Verb-Noun` cmdlet shape swallowed `'Set-Cookie'` in JS; `activate$` swallowed `source venv/bin/activate`; two lines of `int a = 1;` were taken for the assembly `int` interrupt instruction; `Eigen::Matrix<…>` matched Julia's `::Matrix`. Before marking a rule definitive, exclude **the most common lookalike of that form in other languages** (inside quotes, inside comments, outside command position).

**Syntax that is equally valid in several languages must score them equally.** This is the most important lesson. `int main()` is as common in C as in C++; scoring C 7 and C++ 5 fabricates a 2-point margin and turns an ambiguous `#include <stdio.h>` snippet into a confident misdetection. The same holds for `function foo()` across JS/TS and for the annotation `(name: String)` across TS/Swift/Kotlin. **Only a rule that really tells two languages apart may score them unequally.** The margin comes back from genuine discriminators instead: lowercase primitive types (`: string`, `Map<string, number>`) and `const x: T` exist only in TS; `: Int`, `init(`, `val` and `lateinit` only in Swift or Kotlin.

**Negative weights do most of the disambiguation.** `interface Foo` gives typescript +9 and javascript −8; a JSX tag gives jsx +9 and javascript −4 (JSX does not run as plain JS). With positive scores alone, "JS that happens to contain the word interface" and real TS cannot be told apart.

**Structural impossibility uses `excludes`, not a negative score.** A negative score expresses a tendency, and enough positive evidence adds up past it: the hundreds of TS lines in a Svelte component's `<script lang="ts">` block fire a dozen TS rules, typescript reaches 80 points against svelte's 49, and whether the counter-score is −6, −12 or −40 is a bet. A snippet that starts with a `<script>` tag, however, structurally cannot be a JS/TS file, so that rule removes those languages from the ranking with `excludes`. Because `excludes` is so blunt, the rule hygiene test only allows it on rules anchored at the start of the snippet (`^`, no `m` flag); there is exactly one.

**Code inside comments and strings is not evidence.** Agent output is full of comments and strings that contain other languages: a JSDoc line `* Usage: <script src="x.js">`, a test asserting `toContain('<style>')`, a CSS comment saying "put this in a `<style>` tag". The HTML tag rules therefore require the tag not to be on a comment line (not starting with `/*`, `*`, `//` or `#`) and not to follow a quote directly. Shell embedded in CI configuration (`run: |` blocks) belongs to the same category and gets a large negative bash score from `yaml-embedded-script`.

**Confidence is not a linear function of the score.** It is a weighted sum of the score (0.55), the margin over the runner-up (0.30) and how spread out the evidence is (0.15). A single piece of evidence is capped at 0.72, and very short snippets are discounted. Score and margin go through a square root, so "just past the threshold" already earns a reasonable medium confidence.

**Ties fall back to popularity.** Languages are ranked by score, then by the number of independent pieces of evidence, then by popularity, and popularity only matters when the first two are exactly tied. The ranked values are TIOBE Index shares (retrieved 2026-09), which point the right way for lookalikes: JavaScript 2.76 > TypeScript 0.43, so without type evidence the tie goes to javascript; C 10.28 > C++ 8.67, so a bare `#include` goes to c. Both are the more conservative choice. TIOBE counts search results, which differ a lot from what appears in code fences (TypeScript ranks below Visual Basic; bash, JSON, YAML and HTML are not ranked at all), so the 18 unranked languages use values estimated from how common they are in code fences. Changing these values cannot change any verdict that has evidence behind it.

**Candidates have an absolute floor.** A relative floor (40% of the best score) is not enough on its own: the 1–2 points one rule adds to a language in passing can clear it when total scores are low. A candidate also needs at least 3 points, and there are at most four.

The C and C++ discrimination patterns, and the Objective-C ones, follow [GitHub Linguist](https://github.com/github-linguist/linguist)'s `named_patterns.cpp` and `named_patterns.objectivec` heuristics (MIT License), which have been validated on real repositories.

### Streaming strategies

`StreamingLanguageDetector` follows one growing text and applies four strategies:

- **Confidence only goes up.** A re-detection with lower confidence is ignored, so evidence diluted halfway through a block does not drop the verdict back to `null`.
- **Switching families costs a margin.** When two verdicts both clear the high-confidence line but point at different language families, the evidence contradicts itself; the new verdict must beat the old confidence by `familySwitchMargin` (0.1). Refinement within a family, such as `typescript → tsx`, is not restricted.
- **High confidence locks.** From `lockConfidence` (0.9) on, appended content is not re-detected.
- **Growth threshold.** Until the text has grown by `minGrowthChars` (80) characters and by `growthRatio` (50%) since the last checkpoint, `update` returns the cached result without looking at the text. Checkpoints grow geometrically, so the whole stream costs a handful of detections.

`finalize` re-detects on the complete content but **does not overwrite unconditionally**: if the complete content yields no language, the streamed verdict stays; a refinement within the family is adopted; a switch to another family still has to beat the margin. An earlier version let `finalize` overwrite, and GitHub Actions files whose first 30 lines were steadily `yaml` accumulated enough bash evidence in their `run: |` blocks to jump to `bash` at the moment the fence closed.

Language families: JavaScript/TypeScript/JSX/TSX · C/C++/Objective-C · HTML/XML/Vue/Svelte · CSS/SCSS/Less · JSON/YAML/TOML/INI · Bash/PowerShell · Java/Kotlin/Groovy/Scala · MATLAB/Julia. Confusion inside a family barely affects highlighting.

**Following one text.** An input that does not extend the followed text (`startsWith` fails) is a different text and resets the detector. Looking at the content costs time proportional to its length even for a single character when the caller builds the text with `+=`, because V8 flattens that string on first access; doing it on every call would make a token-by-token stream quadratic (a 200 KB block would take seconds instead of milliseconds). The detector therefore looks at the content on a geometric schedule. Once the text has grown by 256 characters, or by 1/32 of its length when that is more, since the last check, a tail check compares the last 64 characters of the last checked input at the same offset; a replacement longer than the followed text, such as a regenerated block, resets the detector within that much growth. The whole text is compared when the input is not longer than the followed text, at growth checkpoints and in `finalize`, which also catches a replacement that happens to repeat those 64 characters. The stream as a whole costs linear time. After `finalize`, the identical text returns the cached result, an extension resumes streaming with the current verdict, and anything else resets.

## Accuracy and performance

All accuracy numbers below were measured while the detector was developed as a prototype. Two sets are reproducible from this repository: the synthetic fixtures (the `fixture metrics` test gates them on every run) and the hand-picked GitHub corpus (see [Benchmarks](#benchmarks)). The local-corpus sets were measured on a private collection of source files and cannot be regenerated.

**Synthetic fixtures** (78 samples imitating real code fences, 20 of which should stay silent). Reproducible; enforced by the test suite.

| Metric              | Value         |
| ------------------- | ------------- |
| False positive rate | 0.0% (0/20)   |
| Precision           | 100% (58/58)  |
| Coverage            | 74.4% (58/78) |

**GitHub corpus** (`scripts/github-curated.tsv`: 126 files, 121 usable, 11 languages that the local corpus had no samples of). Reproducible: every file is pinned to a commit. The list was **picked by hand**: the top repositories per language by stars, then only source files that carry business logic (the lichess tournament module, the Spark scheduler, ghostty's terminal parser, tigerbeetle's storage layer, SDWebImage's cache, YesPlayMusic pages, …), excluding tests, examples, demos, documentation, vendored third-party code, VBA (not VB.NET) and malware source collections. Snippets are taken from the start of each file; "loose" accepts a language of the same family.

| Language    | Files   | Detected  | Strict    | Loose    | Streaming cross-family |
| ----------- | ------- | --------- | --------- | -------- | ---------------------- |
| objective-c | 11      | 100%      | 100%      | 100%     | 0%                     |
| vue         | 9       | 100%      | 100%      | 100%     | 0%                     |
| zig         | 15      | 93.3%     | 100%      | 100%     | 0%                     |
| matlab      | 13      | 92.3%     | 100%      | 100%     | 0%                     |
| julia       | 11      | 90.9%     | 100%      | 100%     | 0%                     |
| applescript | 8       | 87.5%     | 100%      | 100%     | 0%                     |
| asm         | 7       | 85.7%     | 100%      | 100%     | 0%                     |
| vb          | 14      | 78.6%     | 100%      | 100%     | 0%                     |
| svelte      | 8       | 75.0%     | 100%      | 100%     | 0%                     |
| scala       | 13      | 69.2%     | 100%      | 100%     | 0%                     |
| less        | 12      | 58.3%     | 57.1%     | 100%     | 0%                     |
| **Total**   | **121** | **84.3%** | **97.1%** | **100%** | **0%**                 |

The streaming column and the figures below come from `src/evidence/streaming.evidence.ts` over the same corpus (100 files after de-duplicating shared file headers, first 40 lines fed line by line): 0% cross-family flips, first correct verdict at line 7 (p50) / 21 (p90), 92% detected within 40 lines, 94% correct after `finalize`.

Handwritten samples lean systematically towards textbook style. The first run of this corpus exposed Svelte components starting with `<script lang="ts">`, Julia docstrings whose body is Markdown, single-segment Scala package names colliding with Go's `package main`, and MS-DOS assembly written in MASM syntax; the synthetic fixtures had caught none of them. **Validate a new language on real project code.**

**Local corpus** (prototype only, not reproducible; de-duplicated by the first three lines of each file, snapshot and fixture files excluded, ground truth from file extensions):

| Sampling                                | Strict precision | Loose precision | Coverage |
| --------------------------------------- | ---------------- | --------------- | -------- |
| Start of file (closest to a code fence) | 92.7%            | **100%**        | 79.4%    |
| Anywhere in the file                    | 89.5%            | 97.9%           | 72.4%    |

| Streaming (289 files, first 40 lines line by line) | Value              |
| -------------------------------------------------- | ------------------ |
| Cross-family flips (highlighting flicker)          | **0.0%** (0/289)   |
| Lines until the first correct verdict              | p50 **5** · p90 19 |
| Detected within 40 lines                           | 84.1%              |
| Final verdict correct                              | 88.6%              |

| Whole large files (204 files over 8 KB, detected in one call, as at `finalize`) | Value                               |
| ------------------------------------------------------------------------------- | ----------------------------------- |
| Same-family correct                                                             | **100%**                            |
| Detected                                                                        | 93.6%                               |
| Time per call                                                                   | 5.6 ms mean (input capped at 20 KB) |

Before the CI-embedded-shell and `excludes` fixes, the whole-file figure was 94.8%: the `run: |` blocks of GitHub Actions workflows turned 7 YAML files into bash, and one Svelte component became typescript through its script block. A streaming evaluation that only looks at the first 40 lines cannot see this class of problem.

### Performance

| Scenario                                                                                      | Time                                      | Source                      |
| --------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------- |
| One detection, typical fence (8–36 lines)                                                     | p50 0.28 ms · p95 0.6 ms                  | GitHub corpus, reproducible |
| One detection at the 20 KB cap                                                                | 5.6–7.7 ms                                | Local corpus                |
| **All detection work for one fence streamed line by line** (mean 14.7 KB, 456 `update` calls) | **p50 4.9 ms · p90 8.4 ms · max 10.7 ms** | GitHub corpus, reproducible |

Measured on an Apple M3 Max with Node 24. The last row is the one that matters for streaming: the growth threshold is geometric and locking stops re-detection, so everything the detector does while a fence streams and closes adds up to a few milliseconds spread over seconds of output.

Two optimizations were tried and rejected on measurements:

- **Literal pre-checks** (each rule declares a required literal; skip the regex when the input lacks it). A typical snippet fires only 2.2% of the rules, so this looked like it would skip most of the work, but the prototype got 1.2× faster: the pre-check has to establish that a literal is _absent_, which means `String.includes` scans the whole input, the same order of cost as the regex. The cost is also spread evenly over the 300+ rules (the most expensive one is 1.3%), so there is no hot spot to optimize.
- **A lower truncation cap.** At 6 KB the worst single call is 2.4× faster and same-family accuracy even rises slightly, but coverage drops by 2 points. The 20 KB call happens once per fence, at `finalize`, so the cap stays at 20 KB.

## Supported languages

42 languages, all with Shiki language ids. `*` marks languages that have `definitive` signatures (a match settles the language, such as `<?php`, `let mut`, `tell application "…"`, `@import("std")`).

| Group             | Languages                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C family          | `c` · `cpp`\* · `objective-c`\*                                                                                                                              |
| ECMAScript        | `javascript` · `typescript` · `jsx` · `tsx`                                                                                                                  |
| JVM / .NET        | `java`\* · `csharp`\* · `kotlin`\* · `groovy`\* · `scala`\*                                                                                                  |
| Modern C-like     | `go`\* · `rust`\* · `swift`\* · `zig`\* · `dart`\*                                                                                                           |
| Markup / docs     | `html`\* · `xml`\* · `markdown`                                                                                                                              |
| Data / config     | `json` · `yaml` · `toml`\* · `ini`                                                                                                                           |
| Stylesheets       | `css` · `scss`\* · `less`\*                                                                                                                                  |
| Single-file comps | `vue`\* · `svelte`\*                                                                                                                                         |
| Independent       | `sql`\* · `vb`\* · `python`\* · `ruby`\* · `matlab`\* · `julia`\* · `php`\* · `asm`\* · `lua` · `powershell`\* · `bash`\* · `applescript`\* · `dockerfile`\* |

## Known limitations

- **Telling `.ts` from `.js` needs type syntax.** A TS snippet without type annotations yields `language: null, candidates: ['javascript', 'typescript']`. This is by design.
- **`html` and `xml` are separated by rules only.** highlight.js uses one grammar for both, so it cannot help; for highlighting the distinction rarely matters.
- **Per-language percentages on the GitHub corpus move a lot**: 7–15 files per language are enough to expose structural problems, not to pin a precise rate. Less has a low strict precision (57%): a Less file that only nests and uses no `@variables` is indistinguishable from SCSS or CSS, but it stays within the stylesheet family.
- **Refinement within a family while streaming is normal.** A TSX file is valid TypeScript until its first JSX tag, so the verdict moves from `typescript` to `tsx`. Shiki's TS grammar highlights that part correctly, so this is not flicker; the tests only forbid cross-family flips.
- **Snippets cut from the middle of a file can land in the wrong family** (97.9% loose precision on local random sampling): a Python slice that holds an SQL string, a Python dict literal shaped like JSON, an HTML slice that starts inside a `<style>` block. Those slices really are the other language's content. A streamed fence starts at the beginning of the code, so this does not happen there.
- **Confusion within a family is not handled**: `build.gradle.kts` is detected as `groovy` (the Gradle DSL blocks look the same), which barely affects highlighting.

## Footguns

- **`null` is a normal result, not an error.** Most short or generic snippets (`npm install foo`, a lone `class Shape {}`) stay `null` on purpose. Render plain text, or pick from `candidates` if you have extra information such as a file name. Do not treat `candidates[0]` as the answer by default; that throws away the precision the detector is built for.
- **Feed the accumulated text, not deltas.** The detector cannot follow deltas: `update('let x')` then `update(' = 1')` are unrelated texts. Each delta is treated as a new text and resets the detector, so the verdict never gets past what a single delta shows.
- **One detector per code block.** The detector follows a single growing text. Reusing it for the next fence works (a non-extension resets it), but a longer replacement is only noticed at the next tail check, within 256 characters or 1/32 of the text of growth, or at a growth checkpoint or `finalize`, and the verdict for the old text stays until then. If you know a block was regenerated or replaced, call `reset()`, which does not wait for either check.
- **Call `finalize` when the fence closes.** Until then the verdict may be based on a prefix, and a locked verdict never re-detects. `finalize` is cheap to repeat on re-renders with the same text.
- **`finalize` keeps a cross-family verdict unless the new one is clearly better.** If a block streamed as YAML finishes with more shell than YAML, it stays `yaml`. That is intended; use `detectLanguage(full)` if you want the one-shot verdict regardless of history.
- **`html` and `xml` are easy to confuse.** An XHTML-like or SVG fragment may come back as either. Map both to a markup grammar rather than branching on the difference.
- **`normalizeCodeLanguage` returning `null` means "not one of the 42", not "not a real language".** `haskell` and `jsonc` are valid in both highlighters. To turn a fence's info string into a highlighter name, use `normalizeHighlightJsLanguage` or `normalizeShikiLanguage` instead: they translate the names the highlighters spell differently and pass other names through, where falling back to plain text on `null` would lose them.
- **A converter name is not a registered grammar.** `toShikiLanguage`, `toHighlightJsLanguage`, `normalizeShikiLanguage` and `normalizeHighlightJsLanguage` return names, not guarantees: Shiki needs the language loaded into the highlighter, and highlight.js needs the grammar registered (Zig in particular is never built in). Check `hljs.getLanguage(name)` or your Shiki instance's loaded languages, and fall back to plain text.
- **Do not mutate results.** They are cached and shared by reference; the unknown result is frozen and pushing into its arrays throws in strict mode.

## Benchmarks

The GitHub corpus measurements are evidence harnesses (`src/evidence/*.evidence.ts`), the same arrangement the engine uses for numbers that justify a gate rather than gate anything: they print tables, assert nothing, sit outside the test suite's `include`, and are not part of the published package.

```bash
# Download the hand-picked GitHub corpus (126 files) into a directory under the OS temp dir
node packages/code-language-detector/scripts/fetch-github-corpus.mjs [corpus-dir]

# One-shot accuracy per language, and streaming behaviour: lines until the first correct verdict,
# cross-family flips, whole-file cost and finalize accuracy
pnpm --filter @ai-markdown/code-language-detector evidence
```

The corpus directory defaults to `code-language-detector-corpus` under `os.tmpdir()`; pass another one to the fetch script and as `CORPUS_DIR` to the harnesses. `CORPUS_FILES_PER_LANGUAGE` caps the streaming sample per language (default 25). The fetch replaces the language subdirectories it owns, leaves the rest of the directory alone, and reads every file at the commit `github-curated.tsv` pins, so repeated runs measure the same bytes.

The corpus files belong to their repositories and remain under those repositories' licenses. They are downloaded for local measurement only; do not commit them to this repository.

## Adding rules

1. Add a `DetectionRule` to `src/rules/<language>.ts`; for a new file, register it in `src/rules/index.ts`.
2. Add a positive sample to `src/__tests__/fixtures.ts`, **and** a sample of the language it is most easily confused with.
3. Run `pnpm --filter @ai-markdown/code-language-detector test`. The rule hygiene test enforces unique ids, no `g`/`y` flags, no nested quantifiers, positive scores for `definitive` languages, `excludes` only on start-anchored rules, and no catastrophic backtracking on pathological input. The `fixture metrics` test fails if the false positive rate rises above 0, precision drops below 100%, or coverage drops below its baseline (raise the baseline when coverage improves).
4. **Run the evidence harnesses (see [Benchmarks](#benchmarks)) and confirm the streaming cross-family rate did not rise.** This step is not optional. Broad rules easily fix one case and break another: `md-heading` (a line starting with `# `) once turned YAML with a comment block into markdown, and `ini-key-value` (`key = value`) nearly polluted a whole range of languages. Both times the streaming measurement raised the alarm; unit tests and synthetic fixtures did not.
5. Check the one-shot accuracy table when a change touches one of the corpus languages. For a new language, add business-logic files from popular projects to `scripts/github-curated.tsv` (pinned to a commit), add the member to `CodeLanguage` and its common names to `src/aliases.ts`, give it a popularity value in `src/popularity.ts` (a test checks every language has one) and a family in `src/families.ts` if it has close relatives; the converter tests check that Shiki bundles the id and highlight.js knows the mapped name.

Before adding a rule, ask: is this pattern highly characteristic of the language, or does it at least narrow the candidates a lot? Keywords shared by many languages (`if`, `for`, `while`, `class`, `return`) do not belong in rules.

Before marking a rule `definitive`, ask: can this form appear **inside another language's strings, comments or imports**? If so, exclude those forms first with a lookbehind, a line-start anchor or command position, or do not mark it definitive. Be careful with the `i` flag: case is information (`FROM node:20` is a Dockerfile, `from os` is Python; `$Name =` is PowerShell, `$name =` is PHP).

## Versioning

This package versions independently of the `@ai-markdown/react` release train. Rule changes can change detection results for some inputs; the fixture gate keeps them from adding false positives or reducing precision on the fixtures.

## License

MIT. The C, C++ and Objective-C discrimination patterns and the MATLAB `%` comment rule derive from GitHub Linguist's heuristics (MIT); see [LICENSE](https://github.com/ai-markdown/ai-markdown/blob/main/packages/code-language-detector/LICENSE) for attribution.

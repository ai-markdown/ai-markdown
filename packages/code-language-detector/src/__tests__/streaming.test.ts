import { afterEach, describe, expect, it, vi } from 'vitest';
import * as detector from '../detector';
import { sameFamily } from '../families';
import { DetectionCache, hashCode, StreamingLanguageDetector } from '../streaming';
import { positives } from './fixtures';

// Wrap the real detectLanguage in a spy so tests can count how often the
// streaming detector actually runs detection. Behaviour is unchanged.
vi.mock('../detector', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../detector')>();
  return { ...actual, detectLanguage: vi.fn(actual.detectLanguage) };
});

const detections = vi.mocked(detector.detectLanguage);

afterEach(() => {
  detections.mockClear();
});

/** Simulates streaming: accumulates line by line and returns the complete prefix at every step */
function prefixes(code: string): string[] {
  const lines = code.split('\n');
  return lines.map((_, i) => lines.slice(0, i + 1).join('\n'));
}

describe('streaming: verdict stability', () => {
  for (const fixture of positives) {
    it(`${fixture.name} fed line by line never crosses language families`, () => {
      const streaming = new StreamingLanguageDetector();
      const wrong: string[] = [];

      for (const prefix of prefixes(fixture.code)) {
        const result = streaming.update(prefix);
        // null is allowed (not enough evidence yet), and so is refinement within
        // a family: the first lines of a TSX file are valid TypeScript, so
        // typescript before the first JSX tag is a correct verdict given the
        // evidence, and Shiki's ts grammar highlights that part correctly too.
        // What is unacceptable is a cross-family misdetection, which breaks the
        // highlighting entirely.
        if (result.language !== null && fixture.expected !== null && !sameFamily(result.language, fixture.expected)) {
          wrong.push(`${result.language}@line ${prefix.split('\n').length}`);
        }
      }

      expect(
        wrong,
        `cross-family misdetections while streaming: ${wrong.join(', ')} (expected ${fixture.expected})`
      ).toEqual([]);
    });
  }
});

describe('streaming: eventual consistency', () => {
  for (const fixture of positives) {
    it(`${fixture.name} finalize agrees with one-shot detection`, () => {
      const streaming = new StreamingLanguageDetector();
      for (const prefix of prefixes(fixture.code)) streaming.update(prefix);

      const streamed = streaming.finalize(fixture.code);
      const oneShot = detector.detectLanguage(fixture.code);

      expect(
        streamed.language,
        'streaming to the end and finalizing should give the same language as detecting the complete code'
      ).toBe(oneShot.language);
    });
  }
});

describe('StreamingLanguageDetector behaviour', () => {
  const rust = `use std::collections::HashMap;

pub fn tally(words: &[&str]) -> HashMap<String, usize> {
    let mut counts = HashMap::new();
    counts
}`;

  it('locks after high confidence, so appended content is not re-detected', () => {
    const streaming = new StreamingLanguageDetector({ lockConfidence: 0.9 });
    const first = streaming.update(rust);
    expect(first.language).toBe('rust');
    expect(first.confidence).toBeGreaterThanOrEqual(0.9);

    // Append a large block that would dilute the Rust evidence; once locked the
    // result must not change.
    const polluted = `${rust}\n${'// filler comment line\n'.repeat(100)}`;
    const after = streaming.update(polluted);
    expect(after.language, 'a locked verdict must not change because content was appended').toBe('rust');
  });

  it('confidence only goes up, so the highlighting does not flicker while streaming', () => {
    const streaming = new StreamingLanguageDetector({ lockConfidence: 2 }); // locking disabled
    // A lone interface is a single piece of evidence and capped at 0.72; this
    // needs TS with enough evidence.
    const strongCode =
      'interface User {\n  id: string\n}\n\nexport function greet(u: User): string {\n  return u.id\n}';
    streaming.update(strongCode);
    const strong = streaming.current;
    expect(strong.language).toBe('typescript');

    // Continue the same text with content that weakens the evidence; it must
    // not wash out the existing high-confidence result. (The detector follows
    // one growing text, so the weaker content has to extend the stronger one.)
    const weak = `${strongCode}\ndef f(x):\n    return x\n\ndef g(y):\n    return y\n\nimport os\nfrom typing import List\n`;
    expect(detector.detectLanguage(weak).confidence, 'setup: the extension must lower the confidence').toBeLessThan(
      strong.confidence
    );
    const after = streaming.update(weak);
    expect(after.language).toBe('typescript');
    expect(after.confidence).toBeGreaterThanOrEqual(strong.confidence);
  });

  it('finalize can override the verdict given while streaming', () => {
    const streaming = new StreamingLanguageDetector();
    // The first lines only carry JS features
    const head = 'const cache = new Map()';
    streaming.update(head);
    // The complete content, an extension of the streamed prefix, adds a type
    // annotation.
    const final = streaming.finalize(`${head}\nconst sizes: Map<string, number> = new Map()`);
    expect(final.language).toBe('typescript');
  });

  it('reset returns to the initial state', () => {
    const streaming = new StreamingLanguageDetector();
    streaming.update(rust);
    streaming.reset();
    expect(streaming.current.language).toBe(null);
    expect(streaming.current.candidates).toEqual([]);
  });

  it('feeding token by token does not detect on every call', () => {
    let calls = 0;
    const streaming = new StreamingLanguageDetector({ minGrowthChars: 80 });
    const code = 'def hello(name: str) -> str:\n    return f"hi {name}"\n';

    for (let i = 1; i <= code.length; i += 1) {
      const before = streaming.current;
      const after = streaming.update(code.slice(0, i));
      if (after !== before) calls += 1;
    }

    expect(
      calls,
      `feeding character by character changed the result ${calls} times; the growth threshold should block most of them`
    ).toBeLessThan(10);
  });
});

describe('StreamingLanguageDetector follows one growing text', () => {
  const rust =
    'use std::collections::HashMap;\n\nfn main() {\n    let mut m = HashMap::new();\n    println!("{:?}", m);\n}';

  /** Pads or cuts `code` to exactly `length` characters with trailing blank lines */
  function toLength(code: string, length: number): string {
    return code.length >= length ? code.slice(0, length) : code + '\n'.repeat(length - code.length);
  }

  it('an equal-length replacement mid-stream starts over instead of hitting the cache', () => {
    const python = 'def load(path):\n    with open(path) as f:\n        return f.read()\n';
    const length = Math.max(rust.length, python.length);
    const first = toLength(rust, length);
    const replacement = toLength(python, length);
    expect(replacement.length).toBe(first.length);

    const streaming = new StreamingLanguageDetector();
    expect(streaming.update(first).language).toBe('rust');

    detections.mockClear();
    const result = streaming.update(replacement);
    expect(detections, 'a same-length text with different content must be detected').toHaveBeenCalledTimes(1);
    expect(result.language).toBe('python');
  });

  it('a replacement followed by finalize adopts the new text’s language across families', () => {
    const python = 'def load(path):\n    with open(path) as f:\n        return f.read()\n';
    const streaming = new StreamingLanguageDetector();
    // Rust is locked at high confidence; a cross-family finalize on the same
    // text would be held back by familySwitchMargin.
    expect(streaming.update(rust).language).toBe('rust');

    expect(streaming.finalize(python).language).toBe('python');
    expect(streaming.current.language).toBe('python');
  });

  it('a replacement of equal length followed by finalize adopts the new text’s language', () => {
    const python = 'def load(path):\n    with open(path) as f:\n        return f.read()\n';
    const length = Math.max(rust.length, python.length);
    const streaming = new StreamingLanguageDetector();
    expect(streaming.update(toLength(rust, length)).language).toBe('rust');

    expect(streaming.finalize(toLength(python, length)).language).toBe('python');
  });

  it('repeated finalize on the same text is idempotent and does not re-run detection', () => {
    const streaming = new StreamingLanguageDetector();
    streaming.update(rust);

    detections.mockClear();
    const first = streaming.finalize(rust);
    expect(detections).toHaveBeenCalledTimes(1);

    const second = streaming.finalize(rust);
    const third = streaming.finalize(rust);
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(detections, 'finalize on the already finalized text must return the cached result').toHaveBeenCalledTimes(1);

    // update with the same text after finalize is a re-render as well
    expect(streaming.update(rust)).toBe(first);
    expect(detections).toHaveBeenCalledTimes(1);
  });

  it('a stream that resumes after finalize keeps the result and follows the normal streaming rules', () => {
    const streaming = new StreamingLanguageDetector();
    const final = streaming.finalize(rust);
    expect(final.language).toBe('rust');

    // Extends the finalized text with content that carries no evidence of its
    // own: without the resume rule this would reset and fall back to unknown.
    const resumed = `${rust}\n// trailing note`;
    const afterResume = streaming.update(resumed);
    expect(afterResume).toBe(final);

    // Normal streaming rules apply again: a finalize on the longer text
    // re-detects rather than being treated as a repeat.
    detections.mockClear();
    expect(streaming.finalize(resumed).language).toBe('rust');
    expect(detections).toHaveBeenCalledTimes(1);
  });
  it('a longer replacement is caught at the next growth checkpoint', () => {
    const streaming = new StreamingLanguageDetector();
    expect(streaming.update(rust).language).toBe('rust');

    // Longer than the followed text by more than minGrowthChars and growthRatio, so this call is a checkpoint and
    // the content is compared.
    const python = `def load(path):\n    with open(path) as f:\n        return f.read()\n${'# note\n'.repeat(30)}`;
    expect(python.length).toBeGreaterThan(rust.length * 1.5 + 80);
    expect(streaming.update(python).language).toBe('python');
  });

  it('a longer replacement between checkpoints is caught by the next tail check', () => {
    const streaming = new StreamingLanguageDetector();
    const followed = toLength(`${rust}\n${'// ok\n'.repeat(200)}`, 1000);
    expect(streaming.update(followed).language).toBe('rust');

    // 300 characters longer: past the tail-check stride (256), short of the next growth checkpoint (500), and not a
    // continuation of the followed text.
    const python = toLength(
      `import os\n\ndef load(path):\n    with open(path) as f:\n        return f.read()\n${'# note\n'.repeat(200)}`,
      1300
    );
    expect(streaming.update(python).language).toBe('python');
  });

  it('a replacement shorter than the tail-check stride waits for the next check', () => {
    const streaming = new StreamingLanguageDetector();
    expect(streaming.update(toLength(rust, 1000)).language).toBe('rust');
    const python = toLength('import os\n\ndef load(path):\n    return os.path.exists(path)\n', 1100);
    // 100 characters of growth: no tail check yet, so the verdict is still the followed text's
    expect(streaming.update(python).language).toBe('rust');
    // finalize always compares the whole text
    expect(streaming.finalize(python).language).toBe('python');
  });

  it('content checks stay off the per-token path, so a long stream costs linear time', () => {
    const unit = 'fn main() {\n    let mut m = HashMap::new();\n    println!("{:?}", m);\n}\n';
    const text = unit.repeat(Math.ceil(200_000 / unit.length));
    // Best of three: a GC pause or a shared CI core can inflate one run, and the minimum is the reading noise
    // cannot inflate. Comparing the whole text on every call is quadratic here and takes seconds; the checkpoint
    // design takes milliseconds.
    let best = Number.POSITIVE_INFINITY;
    for (let run = 0; run < 3; run += 1) {
      const streaming = new StreamingLanguageDetector();
      let accumulated = '';
      const started = performance.now();
      for (let i = 0; i < text.length; i += 4) {
        accumulated += text.slice(i, i + 4);
        streaming.update(accumulated);
      }
      streaming.finalize(accumulated);
      best = Math.min(best, performance.now() - started);
    }
    expect(best).toBeLessThan(1000);
  });
});

describe('DetectionCache', () => {
  it('detects the same code only once', () => {
    const cache = new DetectionCache();
    const code = 'package main\n\nfunc main() {}\n';

    const a = cache.detect(code);
    const b = cache.detect(code);

    expect(a, 'should return the same object reference, i.e. a cache hit').toBe(b);
    expect(cache.size).toBe(1);
  });

  it('evicts old entries past the limit', () => {
    const cache = new DetectionCache(3);
    for (let i = 0; i < 5; i += 1) cache.detect(`let x${i} = ${i}`);
    expect(cache.size).toBeLessThanOrEqual(3);
  });

  it('clear empties the cache', () => {
    const cache = new DetectionCache();
    cache.detect('package main\n\nfunc main() {}\n');
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('the hash differs for different content and is stable for the same content', () => {
    expect(hashCode('abc')).toBe(hashCode('abc'));
    expect(hashCode('abc')).not.toBe(hashCode('abd'));
    expect(hashCode('ab')).not.toBe(hashCode('abc'));
  });
});

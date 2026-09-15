/**
 * Incremental LaTeX preprocessor: the whole contract is BYTE-EQUALITY with
 * `preprocessLaTeX(full)` at every append — including the original's
 * whole-string early-exit quirks. Pinned counterexamples come from the
 * design review (B1–B5); the property suite replays seeded random streams
 * with 1-char chunking that splits every straddle-able token.
 */
import { describe, expect, test } from 'vitest';
import { preprocessLaTeX, createIncrementalLatexPreprocessor } from './latex';
import { testEnv } from '../components/incrementalParse/spliceArbiterHarness';

/** Replay `chunks` as an append stream, asserting byte-equality per step.
 *  `freezeThreshold: 0` forces a freeze attempt on EVERY call — without it,
 *  short counterexamples never leave the full-reprocess fallback and the
 *  pins pass vacuously; `backoff: false` for the same reason (a failed
 *  attempt would otherwise skip the next ones and 1-char chunkings would
 *  stop exercising the cut rules). Backoff can only freeze LESS, so passing
 *  here implies passing with it on — the P2-3 suite covers the on-state. */
function replay(chunks: string[]): void {
  const incremental = createIncrementalLatexPreprocessor({ freezeThreshold: 0, backoff: false });
  let acc = '';
  for (const chunk of chunks) {
    acc += chunk;
    expect(incremental(acc)).toBe(preprocessLaTeX(acc));
  }
}

/** Replay a full document split into fixed-size chunks. */
function replaySized(doc: string, size: number): void {
  const chunks: string[] = [];
  for (let i = 0; i < doc.length; i += size) chunks.push(doc.slice(i, i + size));
  replay(chunks);
}

describe('createIncrementalLatexPreprocessor — pinned counterexamples', () => {
  test('B1: latent multi-line html tag — `>` arriving later protects a $ before the cut', () => {
    // The tag's attribute spans lines; before `>` arrives the `$5` is
    // currency-escaped, after it arrives the whole tag region is protected
    // and `$5` stays raw. A cut between the two frames would freeze the
    // escaped form. (`$x$` gives the stream a trigger so the gate is open.)
    replay(['$x$ math\nx\n<span title="a $5\n', 'ok">y $1 tail\n']);
  });

  test('B2: a lone `$` on a finished line is settled — the next line freezes past it', () => {
    // The scan used to toggle across newlines, so the lone `$` made the NEXT
    // line's pipe part of an unclosed tail (`\vert{}`) and the counterexample
    // was that a raw per-line cut disagreed. A single `$` is line-local now
    // (findUnclosedDelimiter), so both sides leave the pipe alone; the
    // replay still owes byte-equality, and the pipe must really survive.
    replay(['price $ one\n', 'a | b\n']);
    expect(preprocessLaTeX('price $ one\na | b\n')).toBe('price $ one\na | b\n');
  });

  test('B5: currency escaping rewrites the `$` token stream', () => {
    // Raw text has two `$` (looks paired); the transform escapes `$1`
    // (currency) leaving ONE live `$` — the active pipe is inside the
    // unclosed tail in the full run.
    replay(['$1\nx$ y\n', 'a | b\n']);
  });

  test('B3: truncateUnclosedLatexBlock trimEnd crosses the seam', () => {
    // Full run: `hello\n$$\nx` → truncate strips the unclosed `$$` AND
    // trimEnd()s the segment → `hello`. A frozen `hello\n` must be trimmed
    // at COMPOSE time only — the block closes later and the untrimmed
    // frozen bytes become correct again.
    replay(['hello\n', '$$\nx', '\n$$\ntail $z$\n']);
  });

  test('B4: late trigger — a `$` arriving after bare \\text{a_b} transforms the prefix', () => {
    // While the accumulated string has no trigger, the original early-exits
    // with the identity (underscore NOT escaped). The first `$` flips the
    // whole document into the transform regime retroactively.
    replay(['\\text{a_b}\n', 'plain prose\n', 'now $x$\n']);
  });

  test('dangling backtick run pairs with a later run and re-segments the past', () => {
    // The lone backtick's span, once closed frames later, swallows the `$`
    // that was previously transformed as math.
    replay(['use ` for $x$\n', 'more prose\n', 'and close `\n']);
  });

  test('late-closing \\[ and \\text{', () => {
    replay(['before $a$\n\\[x\n', 'y\\]\nafter $b$\n']);
    replay(['before $a$\n\\text{foo\n', 'bar}\nafter $b$\n']);
  });

  test('split closing </code> tag keeps the literal region protected', () => {
    replay(['<code>$not math$</co', 'de> after $real$\n']);
  });

  test('image-form ![x] does not count as a convertible bracket', () => {
    replay(['see !\\[img\\] and $m$\n\n', 'tail $n$\n']);
  });

  test('CRLF variants of the seam-sensitive cases', () => {
    replay(['price $ one\r\n', 'a | b\r\n']);
    replay(['hello\r\n', '$$\r\nx', '\r\n$$\r\n']);
    replay(['$x$ math\r\nx\r\n<span title="a $5\r\n', 'ok">y\r\n']);
  });

  test('unclosed fence and unclosed literal tag degrade gracefully', () => {
    replay(['$a$\n\n```\ncode $x\n', 'more $y\n', '```\n\n$b$\n']);
    replay(['$a$\n\n<pre>$not\n', 'math\n', '</pre>\n$b$\n']);
  });

  test('identical input replays the cached output (StrictMode idempotence)', () => {
    const incremental = createIncrementalLatexPreprocessor();
    const doc = 'x $a$\n\ny $4.2M z\n';
    const first = incremental(doc);
    expect(incremental(doc)).toBe(first);
    expect(first).toBe(preprocessLaTeX(doc));
  });

  test('non-append input (regeneration / older replay) resets cleanly', () => {
    const incremental = createIncrementalLatexPreprocessor();
    const a = 'first message $x$\n\nwith text\n';
    incremental(a);
    const b = 'rewritten $y$ body\n';
    expect(incremental(b)).toBe(preprocessLaTeX(b));
    // Older content (a discarded-render replay) is a non-append too.
    expect(incremental(a.slice(0, 10))).toBe(preprocessLaTeX(a.slice(0, 10)));
  });
});

describe('createIncrementalLatexPreprocessor — failed-freeze backoff and blank-line hazard release (2026-08-19 review P2-3)', () => {
  /** Stream `doc` in `size`-char appends through a threshold-0 instance
   *  (backoff ON), asserting byte-equality per step; returns attempt count
   *  and total frozen bytes. */
  function replayCounting(doc: string, size: number): { attempts: number; frozen: number } {
    let attempts = 0;
    let frozen = 0;
    const incremental = createIncrementalLatexPreprocessor({
      freezeThreshold: 0,
      onAttempt: ({ frozenBytes }) => {
        attempts++;
        frozen += frozenBytes;
      },
    });
    for (let i = size; i < doc.length + size; i += size) {
      const acc = doc.slice(0, i);
      expect(incremental(acc)).toBe(preprocessLaTeX(acc));
    }
    return { attempts, frozen };
  }
  /** Replay with backoff ON and assert that at least one freeze happened. */
  function replayFreezing(chunks: string[]): void {
    let frozen = 0;
    const incremental = createIncrementalLatexPreprocessor({
      freezeThreshold: 0,
      onAttempt: ({ frozenBytes }) => {
        frozen += frozenBytes;
      },
    });
    let acc = '';
    for (const chunk of chunks) {
      acc += chunk;
      expect(incremental(acc)).toBe(preprocessLaTeX(acc));
    }
    expect(frozen).toBeGreaterThan(0);
  }
  const PARA = 'plain prose keeps flowing here with $x^2$ and \\(y\\) inline.\n\n';

  test('a permanent hazard early in the document: byte-equal, and attempts stay logarithmic', () => {
    // An unclosed `\[` stays convertible for as long as the stream runs (its
    // `\]` may arrive on any later line), so the last-cut candidate is never
    // quiescent. Before: every frame re-scanned the whole active region and
    // re-ran the candidate for nothing. Now failed attempts back off (active
    // must double), so their count is O(log n) — not O(frames).
    //
    // This fixture used to be a stray `US$`; that is no longer a hazard (a
    // single `$` is line-local — see the next test), which is why the
    // permanently-open shape had to be swapped for a real one.
    const doc = 'intro line one.\n\nan open \\[ bracket today\n\n' + PARA.repeat(120);
    const frames = Math.ceil(doc.length / 16);
    const { attempts } = replayCounting(doc, 16);
    expect(attempts).toBeLessThan(Math.log2(doc.length) + 12);
    expect(attempts).toBeLessThan(frames / 8);
  });

  test('a stray `$` on a finished line is not a hazard: the stream keeps freezing past it', () => {
    // Inline `$…$` never spans a line ending, so a bare `$` on a finished
    // line can never be paired by a later append. It used to keep the
    // delimiter parity odd for every later slice, so nothing after it ever
    // froze — and every `|` after it was rewritten to `\vert{}`. The
    // fixture was `US$`; a currency code before `$` is now escaped as
    // currency, so `lone $` carries the bare `$` instead.
    const doc = 'intro line one.\n\nprice in lone $ today\n\n' + PARA.repeat(120);
    const { frozen } = replayCounting(doc, 16);
    expect(frozen).toBeGreaterThan(doc.length - 2 * PARA.length);
    // A table after the stray `$` survives, frame by frame.
    replayFreezing(['Prices are quoted in lone $ per unit.\n\n', '| a | b |\n|---|---|\n', '| 1 | 2 |\n']);
    // …while a `$` on the LAST line is still open until its line ends.
    replay(['lone $ first\n\n$a | b', ' | c$\n']);
  });

  test('a latent `<b` in prose settles at the next blank line: the stream keeps freezing past it', () => {
    // `a<b` opens a viable tag start whose `>` never comes. A tag cannot
    // cross a blank line, so the paragraph end settles it; before, only a
    // `>` somewhere later did, and nothing after the `<` ever froze.
    const doc = 'intro line one.\n\nwhen a<b we have $x^2$ and more\n\n' + PARA.repeat(120);
    const { frozen } = replayCounting(doc, 16);
    expect(frozen).toBeGreaterThan(doc.length - 2 * PARA.length);
    replayFreezing(['when a<b we have $x^2$ and\n\n', 'c>d is not a closer $y$\n\n', 'tail $z$\n']);
    // …while a real multi-line tag still waits for its `>` (B1).
    replay(['<span title="multi\n', 'line $5">\n', 'after $x$\n']);
    replay(['<span title="multi\n<b>$$x</b>\n', 'line $5">\n\n']);
  });

  test('a mid-line `$$` settles at its paragraph end: the display block after it streams and freezes', () => {
    // Byte-equal at every frame, and the finished document keeps its block
    // and the text after it (the price used to pair with the block's
    // opener and everything from the block onwards was truncated).
    const chunks = ['It costs $$100 per month.\n\n', '$$\nE = mc^2\n', '$$\n\n', 'After the block.\n'];
    replay(chunks);
    replayFreezing([PARA.repeat(4), ...chunks, PARA.repeat(4)]);
    expect(preprocessLaTeX(chunks.join(''))).toBe(chunks.join(''));
    // The blank line is what settles it: without one the `$$` stays open
    // into the next line and pairs with the block's opener, as it always did.
    replay(['It costs $$100 | per month.\n', '$$\nE | F\n', '$$\n']);
  });

  test('a lone backtick: the hazard latch releases at the next blank line and the stream keeps freezing', () => {
    // A code span cannot cross a blank line, so a lone backtick on a
    // finished paragraph can never be re-paired by a later append: lines
    // after the blank are safe cuts again. Byte-equality is the contract.
    const doc = 'Press the ` key to open the palette.\n\n' + PARA.repeat(120);
    const { attempts, frozen } = replayCounting(doc, 16);
    // Progress: nearly the whole document froze (before: nothing after the
    // backtick, ever). Under backoff a HIGH attempt count is the second
    // progress signal — attempts run every frame only while freezes keep
    // succeeding; without the release every attempt fails and the count
    // collapses to O(log n).
    expect(frozen).toBeGreaterThan(doc.length - 2 * PARA.length);
    expect(attempts).toBeGreaterThan(Math.ceil(doc.length / 16) / 3);
    // Oracle pins: a lone run, then a blank, then a run of the same length —
    // never a pair; the prefix freezes.
    replayFreezing(['use ` for $x$\n\n', 'more\n', 'close `\n']);
    // A mid-line ``` run and a later line-start ``` fence: the blank line
    // between them settles the first run (it cannot pair across the blank).
    replayFreezing(['x ``` y\n\n', '```\ncode $z\n```\n', 'tail ``` $w$\n']);
    // The counterexample from the property suite: an EMPTY remainder after
    // a segment's last `\n` must not count as a blank line (it is the start
    // of a line that continues in the next segment).
    replay(['prose `$1,000.50\n<code>x</code>\n<span title="a\nb">tail\n', '`<co']);
    // Whitespace after a protected span on the same line is not a blank line
    // either — that partial line must not release the latch.
    replay(['a ` b\n<code>x</code>   \n$y$ z ` w\n', ' `\n']);
    // Two paragraphs, one lone backtick each — never a pair; math between converts.
    replay(['a ` b\n\n$e^{i\\pi}$ here\n\nc ` d\n', ' more $x$\n']);
  });

  test('a long streaming `$$` block: attempts inside it back off, freezing resumes after it closes', () => {
    const block = '$$\n' + '\\int_0^1 x^{2}\\,dx + \\sum_{k=1}^{n} k \\\\\n'.repeat(80);
    // Enough tail after the block for the active region to reach the next
    // attempt size (backoff waits for it to double after the last failure —
    // the recovery lag is the price of the geometric bound).
    const doc = PARA.repeat(20) + block + '$$\n\n' + PARA.repeat(120);
    const blockOpenAt = PARA.length * 20;
    const blockCloseAt = blockOpenAt + block.length + 3;
    let attemptsInsideBlock = 0;
    let frozen = 0;
    let streamed = 0;
    const incremental = createIncrementalLatexPreprocessor({
      freezeThreshold: 0,
      onAttempt: ({ frozenBytes }) => {
        frozen += frozenBytes;
        if (streamed > blockOpenAt && streamed < blockCloseAt) attemptsInsideBlock++;
      },
    });
    for (let i = 24; i < doc.length + 24; i += 24) {
      const acc = doc.slice(0, i);
      streamed = acc.length;
      expect(incremental(acc)).toBe(preprocessLaTeX(acc));
    }
    // Inside the open block every attempt fails: logarithmic, not per frame.
    expect(attemptsInsideBlock).toBeLessThan(Math.log2(block.length) + 4);
    // The prefix froze before the block opened, and the block itself once
    // the next attempt fired after it closed.
    expect(frozen).toBeGreaterThan(PARA.length * 18 + block.length);
  });

  test('r2 P1-1: an escaped `\\$` next to a `$` never freezes as a display opener', () => {
    // The escape-blind display opener paired with the `$$` arriving later
    // and rewrote the frozen `|` — 8-byte counterexample.
    replay(['\\$$|$\n', '$$']);
    replay(['Cost \\$$x$ each.\n\n| a | b |\n| --- | --- |\n\n', '$$\nE\n$$\n']);
    // The display delimiter lexicon must be EXACTLY findUnclosedDelimiterStart's
    // (even backslash run = delimiter; a preceding `$` is irrelevant): a
    // `(?<![\\$])` guard disagreed on these (oracle re-check).
    for (const doc of [
      'a $$$$ |b\n\n$$',
      '\\$$$x$$ a|b\n\n$$',
      '$$a|\\$$$ b\n\n$$',
      '$$a\\$$$|b\n\n$$',
      '$$$$|\n\n$$',
      'aaa$$$$  |\n\n$$$$\n\n',
      '$$|a\\\\$$$\n\n$$x^2 a|',
      '$$$\\\\$$$$|\\\\\\\\ \n\nx^2$$\\\\\\\\',
      'a \\\\$$b|c$$ d\n\n$$',
    ]) {
      for (const size of [1, 2, 3]) {
        const chunks: string[] = [];
        for (let i = 0; i < doc.length; i += size) chunks.push(doc.slice(i, i + size));
        replay(chunks);
      }
    }
  });

  test('backoff resets on non-append input', () => {
    let attempts = 0;
    const incremental = createIncrementalLatexPreprocessor({ freezeThreshold: 0, onAttempt: () => attempts++ });
    const stuck = 'US$ stuck\n\n' + PARA.repeat(40);
    for (let i = 8; i < stuck.length + 8; i += 8) incremental(stuck.slice(0, i));
    const before = attempts;
    // Regeneration: a fresh document must attempt immediately again.
    const fresh = 'fresh $x$ start\n\n' + PARA;
    incremental(fresh);
    expect(attempts).toBe(before + 1);
    expect(incremental(fresh)).toBe(preprocessLaTeX(fresh));
  });

  test('backoff on: seeded streams still equal the full run (backoff can only freeze less)', () => {
    // A small backoff-ON replay over mixed content, complementing the
    // threshold-0/backoff-OFF property suite below.
    const doc =
      'intro $a$ text\n\nUS$ price\n\n' +
      PARA.repeat(6) +
      'x ` y\n\n' +
      PARA.repeat(6) +
      '$$\nblock\n$$\n\n' +
      PARA.repeat(6);
    for (const size of [1, 5, 33]) {
      const incremental = createIncrementalLatexPreprocessor({ freezeThreshold: 0 });
      for (let i = size; i < doc.length + size; i += size) {
        const acc = doc.slice(0, i);
        expect(incremental(acc)).toBe(preprocessLaTeX(acc));
      }
    }
  });
});

describe('createIncrementalLatexPreprocessor — property fuzz', () => {
  // mulberry32, deterministic. Pieces bias toward every construct the safe
  // cut interacts with; 1-char and tiny chunkings split straddle-able
  // tokens (`\`+`[`, `<sp`+`an>`, `$`+`$`, backtick runs, `</co`+`de>`).
  const PIECES = [
    'prose text ',
    '\n',
    '\n\n',
    '\r\n',
    '$',
    '$$\n',
    '$x^2$ ',
    '$$\\int_0^1 x\\,dx$$\n',
    '\\[',
    '\\]',
    '\\(y\\) ',
    '\\ce{H2O} ',
    '$\\ce{CO2}$ ',
    '\\text{a_b} ',
    '\\text{open',
    '} ',
    '$4.2M revenue ',
    '$1,000.50 ',
    '| a | b |\n',
    '`',
    '``x``',
    '`code $x$` ',
    '```\nfenced $f\n```\n',
    '~~~\ntilde $t\n~~~\n',
    '<span>',
    '</span>',
    '<span title="multi\nline $5">',
    '<code>$c$</code>',
    '<pre>$p',
    '</pre>',
    '!\\[img\\] ',
    '\\\\',
    '   indented\n',
  ];
  let seed = 0x1a7e | 0;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Scale for the soak gate via LATEX_FUZZ_STREAMS (default keeps the unit
  // suite fast); TIMEOUT scales along.
  const STREAMS = Number(testEnv('LATEX_FUZZ_STREAMS') ?? 60);
  const FUZZ_TIMEOUT_MS = Math.max(120_000, STREAMS * 250);

  test(
    'seeded random streams equal the full run at every append',
    () => {
      for (let stream = 0; stream < STREAMS; stream++) {
        const pieceCount = 10 + Math.floor(rand() * 30);
        let doc = '';
        for (let i = 0; i < pieceCount; i++) doc += PIECES[Math.floor(rand() * PIECES.length)];
        // Three chunkings per doc: tiny (splits every token), medium, large.
        for (const size of [1 + Math.floor(rand() * 2), 7, 64]) {
          replaySized(doc, size);
        }
      }
    },
    FUZZ_TIMEOUT_MS
  );

  test(
    'long streams cross the freeze threshold and stay byte-identical',
    () => {
      const longStreams = Math.max(6, Math.floor(STREAMS / 10));
      for (let stream = 0; stream < longStreams; stream++) {
        const pieceCount = 250 + Math.floor(rand() * 100);
        let doc = '';
        for (let i = 0; i < pieceCount; i++) doc += PIECES[Math.floor(rand() * PIECES.length)];
        replaySized(doc, 48);
      }
    },
    FUZZ_TIMEOUT_MS
  );
});

describe('seam flag tracks actual truncation', () => {
  // `truncatedAtSeamStart` used to arm on any unclosed `$$` with a blank
  // prefix. Once `truncateUnclosedLatexBlock` learned that only a line-start
  // `$$` at 0-3 spaces opens a math flow, the flag kept arming on tails that
  // are NOT truncated — a tab, or four spaces — and the wrapper trimmed a
  // newline the stateless path keeps.
  //
  // Byte equality between the two entry points is the one contract this file
  // cannot break, and the five-leg soak ran ALL CLEAN over the divergence.
  // These pin the shapes it missed.
  test.each([
    ['four-space indent', '$a$\n    $$'],
    ['tab indent', '$a$\n\t$$'],
    ['three-space indent still truncates', '$a$\n   $$'],
    ['mixed leading whitespace', '$a$\n  \t $$'],
    ['zero indent still truncates', '$a$\n$$'],
  ])('stateless and incremental agree: %s', (_name, input) => {
    const incremental = createIncrementalLatexPreprocessor({ freezeThreshold: 0 });
    expect(incremental(input)).toBe(preprocessLaTeX(input));
  });

  test('shrunk out of the entry-point fuzz leg: blank line, space-tab indent, content after', () => {
    // Found 2026-09-03 by re-introducing the defect and letting fast-check
    // minimise. Sixteen characters, and unlike the five above it opens on a
    // BLANK line, mixes a space with a tab, and carries content after the
    // delimiter — the five were written from the diagnosis, this one was
    // found.
    //
    // It is a REPLAY, not a single call, and that is the point: written as
    // `incremental(doc)` in one shot it passes even against the defect,
    // because nothing has frozen yet and the seam correction has no frozen
    // output to trim. The counterexample needs the cut to have landed on an
    // earlier frame, which is the schedule the fuzz leg drew ([2,1,1,25])
    // and the reason a hunting suite finds shapes a hand-written pin does
    // not.
    replay(['\n ', '\t', '$', '$ E = mc^2\n\n']);
  });
});

describe('an indented $$ opener bounded by its container: both entry points agree', () => {
  // The scan ends an indented flow opener's block at the first line
  // indented less than the opener (`dedentEnds`), so a list item's open
  // math no longer swallows the paragraph after the list. The verdict is
  // append-stable — a non-blank line's indent is fixed once its first ink
  // character is in, and a partial line of spaces is no verdict — which is
  // what lets the wrapper freeze on it. These replay the shapes 1-char at
  // a time (every straddle of the opener, the blank line and the dedent)
  // and in chunks, and pin the settled output.

  const REVIEWER = '- Item\n\n  $$\n  x\n\nAfter the list.';

  test('the reviewer case: byte-equal per frame, and the last frame keeps the paragraph', () => {
    replaySized(REVIEWER, 1);
    replay(['- Item\n\n', '  $$\n', '  x\n', '\n', 'After the list.']);
    expect(preprocessLaTeX(REVIEWER)).toBe(REVIEWER);
    // Prefixes are truncated as streaming tails until the dedent lands.
    expect(preprocessLaTeX('- Item\n\n  $$\n  x\n\n')).toBe('- Item');
    expect(preprocessLaTeX('- Item\n\n  $$\n  x\n\nA')).toBe('- Item\n\n  $$\n  x\n\nA');
  });

  test('a truly unclosed tail inside the item: byte-equal, still truncated at the end', () => {
    const doc = '- Item\n\n  $$\n  x';
    replaySized(doc, 1);
    expect(preprocessLaTeX(doc)).toBe('- Item');
  });

  test('a dedent without a blank line, and a following list item', () => {
    for (const doc of ['- Item\n\n  $$\n  x\nAfter the list.', '- Item\n\n  $$\n  x\n- Next\n\nAfter']) {
      replaySized(doc, 1);
      expect(preprocessLaTeX(doc)).toBe(doc);
    }
  });

  test('the item block does not pair with a later top-level block, and the stream freezes past it', () => {
    const chunks = ['- Item\n\n  $$\n  a | b\n\n', 'After | text\n\n', '$$\n| c |\n', '$$\n\n', 'tail $z$\n'];
    replay(chunks);
    replaySized(chunks.join(''), 1);
    // Backoff off so an attempt runs on every frame: the candidate holding
    // the item's block is quiescent once the dedent has landed (the block
    // is settled), so the wrapper freezes past it instead of re-scanning
    // the whole document on every later frame.
    let frozen = 0;
    const incremental = createIncrementalLatexPreprocessor({
      freezeThreshold: 0,
      backoff: false,
      onAttempt: ({ frozenBytes }) => {
        frozen += frozenBytes;
      },
    });
    let acc = '';
    for (const chunk of chunks) {
      acc += chunk;
      expect(incremental(acc)).toBe(preprocessLaTeX(acc));
    }
    expect(frozen).toBeGreaterThanOrEqual(chunks[0].length + chunks[1].length);
    expect(preprocessLaTeX(chunks.join(''))).toBe(
      '- Item\n\n  $$\n  a \\vert{} b\n\nAfter | text\n\n$$\n\\vert{} c \\vert{}\n$$\n\ntail $$z$$\n'
    );
  });

  test('blockquote and same-line openers: byte-equal, nothing truncated (pinned)', () => {
    for (const doc of ['> $$\nx\n\nAfter', '> $$\n> x\n\nAfter', '- $$ x\n\nAfter']) {
      replaySized(doc, 1);
      expect(preprocessLaTeX(doc)).toBe(doc);
    }
  });

  test('entry-floor evidence counterexample: a mid-line $$ inside the block must not pair past the dedent', () => {
    // Found by latexEntryFloor.evidence.ts once the scan ended the block at
    // the dedent. The regex pair pass is lazy: inside `   $$ x^2` the
    // `$$\int$$` on the next line pairs the block's opener with its own
    // first token, so its second token was later paired with the `$$`
    // after the dedent and the table pipes between them were escaped —
    // stateless only, because the incremental path had already frozen the
    // settled block and saw that `$$` as a lone opener. The pair pass now
    // ends the block where the scan does. (The harness's shape had no list
    // above the opener; with the container read from the lines above, it
    // only reproduces inside an item, so the opener sits under `- p`.)
    const doc =
      '- p\n   $$ x^2\n    $$\\int_0^1 x\\,dx$$\n    price in US$ today\n $4.2M revenue\n\t | --- | --- |\n$$\n';
    replaySized(doc, 1);
    replay([
      '- p\n   $$ x^2\n    $$\\int_0^1 x\\,dx$$\n    price in US$ today\n $4.2M revenue\n',
      '\t | --- | --- |\n$$\n',
    ]);
    // `US$` is escaped as currency (CURRENCY_SUFFIX_REGEX), like the `$4.2M`
    // under it; neither changes where the block ends.
    expect(preprocessLaTeX(doc)).toBe(
      '- p\n   $$ x^2\n    $$\\int_0^1 x\\,dx$$\n    price in US\\$ today\n \\$4.2M revenue\n\t | --- | --- |'
    );
  });

  test('top-level openers indented 1-3 spaces with unindented bodies and closers: byte-equal, prose kept', () => {
    // Reviewer repro: an indent-only container rule ended `  $$` at `x+y`
    // and truncated `After` from the real closer on. The wrapper passes the
    // frozen prefix so the tail run reads the same (absent) list marker.
    for (const indent of [' ', '  ', '   ']) {
      const doc = `${indent}$$\nx+y\n$$\n\nAfter\n\n$$\nE\n$$\n\nMore`;
      replaySized(doc, 1);
      replay([`${indent}$$\nx+y\n`, '$$\n\nAfter\n\n', '$$\nE\n$$\n\nMore']);
      expect(preprocessLaTeX(doc)).toBe(doc);
      replaySized(`prose $x$\n\n${indent}$$\nx+y\n$$\nAfter`, 1);
    }
    // Four spaces: an indented code block, no math and nothing truncated.
    const code = 'prose $x$\n\n    $$\nx+y\n$$\n\nAfter';
    replaySized(code, 1);
    expect(preprocessLaTeX(code)).toBe('prose $$x$$\n\n    $$\nx+y\n$$\n\nAfter');
  });

  test('the item context survives a freeze cut inside the item', () => {
    // A cut can land between `- Item` and the opener; the tail run then
    // begins at the indented `$$` and must still see the marker line in
    // the frozen prefix. Backoff off so every frame attempts a freeze.
    const doc = '- Item\n\nfirst $x$ paragraph\n\n- Item two\n  more text\n\n  $$\n  x\n\nAfter the list.\n';
    replaySized(doc, 1);
    replaySized(doc, 7);
    expect(preprocessLaTeX(doc)).toBe(
      '- Item\n\nfirst $$x$$ paragraph\n\n- Item two\n  more text\n\n  $$\n  x\n\nAfter the list.\n'
    );
  });

  test('a block ended by a dedent before any `$$` follows: a later `$$` is a fresh opener, and the frozen block keeps its bytes', () => {
    // The pipe pass used to enter a block only through a `$$…$$` regex
    // pair. On the early frame there is no pair yet and the block's pipe
    // stayed literal; once `$$\nx\n$$` arrived, a pair spanned the dedent
    // and escaped a block that an earlier frame had already frozen. The
    // pass now escapes a block from the scan's verdict alone, so the
    // block is `\vert{}` from the frame its dedent lands, and the later
    // `$$` opens its own block.
    const head = '- Item\n\n  $$\n  | a |\n\nAfter\n\n';
    const tail = '$$\nx\n$$\n';
    const doc = head + tail;
    expect(preprocessLaTeX(head)).toBe('- Item\n\n  $$\n  \\vert{} a \\vert{}\n\nAfter\n\n');
    expect(preprocessLaTeX(doc)).toBe('- Item\n\n  $$\n  \\vert{} a \\vert{}\n\nAfter\n\n$$\nx\n$$\n');
    replaySized(doc, 1);
    for (const line of doc.split(/(?<=\n)/)) expect(line).not.toBe('');
    replay(doc.split(/(?<=\n)/));
    replay([head, tail]);
    replay(['- Item\n\n  $$\n  | a |\n\nAfter', '\n\n', '$$\nx\n', '$$\n']);
    replay(['- Item\n\n  $$\n  | a |\n\nAfter', '\n\n$$', '\nx\n$$\n']);
    for (const options of [{ freezeThreshold: 0 }, {}] as const) {
      const incremental = createIncrementalLatexPreprocessor(options);
      for (const cut of [head.length - 2, head.length, head.length + 2]) {
        const a = doc.slice(0, cut);
        expect(incremental(a)).toBe(preprocessLaTeX(a));
        expect(incremental(doc)).toBe(preprocessLaTeX(doc));
      }
    }
  });

  test('CRLF and a partial next line of spaces', () => {
    replaySized('- Item\r\n\r\n  $$\r\n  x\r\n\r\nAfter the list.', 1);
    replaySized('- Item\n\n  $$\n  x\n\n  \n  \nAfter', 1);
    replaySized('- Item\n\n  $$\n  x\n\n\tAfter', 1);
  });
});

/**
 * Coordination under load: 30 chunks in one document, then 60 chunks across
 * three documents. These are the scale cases — the per-chunk fingerprint
 * cache, the phantom-def injection, and the per-documentId registry isolation
 * all have to hold when the chunk count stops being a handful.
 *
 * They live in the Performance Lab rather than under Documents because they
 * teach nothing about the API: the small scenarios next door do that, and a
 * 60-chunk wall of prose is a measurement, not an example.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import AIMarkdown from '../../src';
import { AIMarkdownDocuments } from '../../src/components/AIMarkdownDocuments';
import { WithScheme } from '@ai-markdown/storybook-kit/react/colorScheme';

const meta: Meta<typeof AIMarkdownDocuments> = {
  title: 'Performance Lab/Cross-Chunk Stress',
  component: AIMarkdownDocuments,
  parameters: {
    // Sixty stacked documents each render their own footnote <section>, which
    // trips landmark-unique. That duplication IS the scenario — the isolation
    // being verified is exactly that each document keeps its own footer.
    a11y: { test: 'off' },
  },
};
export default meta;
// ─── Stress: 30 chunks, single document ──────────────────────────────────────
//
// One document split into exactly 30 streaming chunks. Mix of paragraph,
// heading, list, code, table, math, raw HTML, footnote refs/defs, link defs,
// and image refs scattered across chunks. Verifies:
//   - aggregate footer renders only at chunk 30
//   - per-chunk fingerprint cache stays stable as chunks mount in order
//   - phantom-def injection covers chunks that ref labels defined later
//   - multi-ref to the same label keeps global numbering consistent
//
// Label set: footnote labels `note-1`..`note-6`, link labels `ref-1`..`ref-4`,
// image label `img-1`. Some labels are referenced multiple times.

function buildThirtyChunkSingleDoc(): string[] {
  // Exactly 30 chunks. Each entry is the full markdown for one chunk; chunks
  // may contain multiple paragraphs separated by `\n\n` internally.
  return [
    // 1
    '# A Long Streaming Response\n\nBroken into 30 short chunks to exercise per-chunk coordination.',
    // 2
    'Section 1 introduces the concept of streaming with [^note-1] embedded references.',
    // 3
    '## Architecture\n\nSee the [overview docs][ref-1] for the high-level shape.',
    // 4
    'Each chunk is parsed independently. Refs to [^note-2] inside a chunk that has no local def get phantom-injected.',
    // 5
    '## Use cases\n\n1. **Token streaming** — chunks arrive over time and mount in order.\n2. **Stable IDs** — `useId` gives each chunk a deterministic React key.\n3. **Coordinated footers** — only the last chunk renders the aggregate.',
    // 6
    'When a model emits [^note-3] in the middle of streaming, the renderer handles it gracefully.',
    // 7
    '## Implementation notes\n\nThe [API reference][ref-2] covers the full surface.',
    // 8
    'Internally we rely on a few invariants:\n\n- Each chunk subscribes to the registry via `useSyncExternalStore`.\n- Contributions are guarded by a fingerprint to avoid re-entry.\n- Phantom defs carry a sentinel URL so the registry can ignore them.',
    // 9
    'The [glossary][ref-3] disambiguates terms used here.',
    // 10
    'Concept: a *block* is one top-level hast element. Block-level memoization keys by `(raw, occurrence, ctx, position)`.',
    // 11
    'Concept: a *fingerprint* is a stable string capturing the registry slice a block depends on.',
    // 12
    'See [^note-4] for a deeper discussion of cache invariants.',
    // 13
    'Another paragraph that does not reference anything in particular. Just prose for bulk.',
    // 14
    'And another. Streaming responses often look like this — many short paragraphs in sequence.',
    // 15
    '## Edge cases',
    // 16
    'Edge case A: raw HTML — <span>inline span</span>.',
    // 17
    'Edge case B: code block:\n\n```ts\nexport function f(x: number) {\n  return x + 1;\n}\n```',
    // 18
    'Edge case C: GFM tables:\n\n| col A | col B |\n| ----- | ----- |\n| 1     | 2     |\n| 3     | 4     |',
    // 19
    'Edge case D: math: $$\\sum_{i=0}^{n} i = \\frac{n(n+1)}{2}$$',
    // 20
    '## Wrap up',
    // 21
    'Multiple refs to the same label sanity-check global numbering: [^note-1] and [^note-3] appear in two places each.',
    // 22
    'And one image reference for completeness: ![lazy preview][img-1]',
    // 23
    'See [^note-5] and the [conclusion][ref-4] for the summary.',
    // 24
    'Final remark before the def chunks: [^note-6] is intentionally only ever referenced once.',
    // 25
    '[^note-1]: First footnote — referenced multiple times across the doc.\n\n[^note-2]: Second footnote — referenced once.',
    // 26
    '[^note-3]: Third footnote — referenced twice including at the wrap-up.\n\n[^note-4]: Fourth footnote — discusses cache invariants and TAINT semantics.',
    // 27
    '[^note-5]: Fifth footnote — covers the wrap-up case.\n\n[^note-6]: Sixth footnote — singleton ref, included for coverage.',
    // 28
    '[ref-1]: https://example.com/docs "Overview documentation"\n\n[ref-2]: https://example.com/api "API reference"',
    // 29
    '[ref-3]: https://example.com/glossary\n\n[ref-4]: https://example.com/conclusion',
    // 30
    '[img-1]: https://picsum.photos/seed/ai-markdown-stress/200/300',
  ];
}

const THIRTY_CHUNKS: string[] = buildThirtyChunkSingleDoc();

export const ThirtyChunksSingleDoc: StoryObj<typeof meta> = {
  render: () => (
    <WithScheme>
      {(colorScheme) => (
        <AIMarkdownDocuments>
          {THIRTY_CHUNKS.map((c, i) => (
            <AIMarkdown key={i} content={c} documentId="msg-stress-30" colorScheme={colorScheme} />
          ))}
        </AIMarkdownDocuments>
      )}
    </WithScheme>
  ),
  // Keeps the chunk count in the story name truthful. This lives in `play`
  // rather than in render: a render-phase throw takes the story down with a
  // React error boundary instead of reporting a failed expectation.
  play: async () => {
    await expect(THIRTY_CHUNKS).toHaveLength(30);
  },
};

// ─── Stress: 60 chunks, three documents ──────────────────────────────────────
//
// Three independent documents (msg-stress-A/B/C), 20 chunks each, 60 total.
// The play asserts, on the rendered DOM:
//   - per-documentId registry isolation: exactly one aggregate footer per
//     document, each holding only its own three definitions (`a`/`b`/`c`
//     are reused across documents on purpose — a leak would surface as a
//     wrong body / a fourth <li> / a merged footer)
//   - the aggregate footer sits at the end of each document's last chunk
//     (footers appear in document order, after every chunk of their doc)
//   - cross-document refs never resolve to another document's defs (each
//     document's two `[glossary][site]` links point at ITS glossary URL)
// The fixture-length checks keep the chunk counts in the story names honest.
// Numbering per document (1..3 in first-reference order) is covered by the
// coordination stories; not re-asserted here.

function buildDocChunks(tag: string): string[] {
  // Exactly 20 chunks per document. Chunks 1-17 are body content, 18-20 are defs.
  const body: string[] = [
    `# Document ${tag}`,
    `First chunk of ${tag}. Intro paragraph with a ref [^a].`,
    `Section overview for ${tag}. References [^b] and the [glossary][site].`,
    `Paragraph 4 of ${tag}. Plain prose, no refs.`,
    `Paragraph 5 of ${tag}. A list:\n\n- alpha\n- beta\n- gamma`,
    `Section 6 of ${tag} references [^b] again to test ref-count > 1.`,
    `Paragraph 7 of ${tag}. Some \`inline code\` and a back-ref to [^a].`,
    `## Subsection in ${tag}\n\nA shortish heading break.`,
    `Paragraph 9 of ${tag}. Plain prose, no refs.`,
    `Paragraph 10 of ${tag}. Plain prose, no refs.`,
    `Paragraph 11 of ${tag} references the [glossary][site] a second time.`,
    `Paragraph 12 of ${tag}. Plain prose, no refs.`,
    `Paragraph 13 of ${tag}. Plain prose, no refs.`,
    `Paragraph 14 of ${tag}. Plain prose, no refs.`,
    `Paragraph 15 of ${tag}. A code block:\n\n\`\`\`\nhello ${tag}\n\`\`\``,
    `Paragraph 16 of ${tag}. Plain prose, no refs.`,
    `Final body paragraph in ${tag}, with a last ref [^c].`,
  ];
  const defs: string[] = [
    `[^a]: Footnote A in ${tag}.`,
    `[^b]: Footnote B in ${tag}.`,
    `[^c]: Footnote C in ${tag}.\n\n[site]: https://example.com/${tag.toLowerCase()}/glossary "${tag} glossary"`,
  ];
  return [...body, ...defs];
}

const DOC_A: string[] = buildDocChunks('A');
const DOC_B: string[] = buildDocChunks('B');
const DOC_C: string[] = buildDocChunks('C');

export const SixtyChunksThreeDocs: StoryObj<typeof meta> = {
  render: () => (
    <WithScheme>
      {(colorScheme) => (
        <AIMarkdownDocuments>
          {DOC_A.map((ch, i) => (
            <AIMarkdown key={`a-${i}`} content={ch} documentId="msg-stress-A" colorScheme={colorScheme} />
          ))}
          {DOC_B.map((ch, i) => (
            <AIMarkdown key={`b-${i}`} content={ch} documentId="msg-stress-B" colorScheme={colorScheme} />
          ))}
          {DOC_C.map((ch, i) => (
            <AIMarkdown key={`c-${i}`} content={ch} documentId="msg-stress-C" colorScheme={colorScheme} />
          ))}
        </AIMarkdownDocuments>
      )}
    </WithScheme>
  ),
  // 20 chunks × 3 documents = the 60 the story name claims. Same reasoning as
  // ThirtyChunksSingleDoc for asserting here instead of throwing in render.
  play: async ({ canvasElement }) => {
    for (const doc of [DOC_A, DOC_B, DOC_C]) {
      await expect(doc).toHaveLength(20);
    }
    // One aggregate footer per document, in document order, each with only
    // its own three definitions.
    const footers = () => Array.from(canvasElement.querySelectorAll('section[data-footnotes]'));
    await waitFor(() => expect(footers()).toHaveLength(3));
    const tags = ['A', 'B', 'C'];
    footers().forEach((footer, i) => {
      const items = Array.from(footer.querySelectorAll('li'));
      expect(items, `footer ${tags[i]} li count`).toHaveLength(3);
      const text = footer.textContent ?? '';
      expect(text).toContain(`Footnote A in ${tags[i]}`);
      expect(text).toContain(`Footnote C in ${tags[i]}`);
      for (const other of tags.filter((t) => t !== tags[i])) {
        expect(text, `footer ${tags[i]} must not carry ${other} bodies`).not.toContain(`in ${other}.`);
      }
      // The footer is rendered by the document's LAST chunk: every chunk root
      // of that document precedes it, and the next document's first chunk
      // (or nothing) follows it.
      const roots = Array.from(canvasElement.querySelectorAll('.aim-typography-root'));
      const footerRoot = footer.closest('.aim-typography-root');
      expect(footerRoot).not.toBeNull();
      const rootIndex = roots.indexOf(footerRoot as Element);
      // 20 chunks per doc → the footer root is the 20th root of its document.
      expect(rootIndex, `footer ${tags[i]} root position`).toBe(i * 20 + 19);
    });
    // Cross-document link resolution: two `[glossary][site]` refs per doc,
    // each resolving to that document's own glossary URL.
    for (const tag of tags) {
      const links = canvasElement.querySelectorAll(`a[href="https://example.com/${tag.toLowerCase()}/glossary"]`);
      expect(links, `glossary links for ${tag}`).toHaveLength(2);
    }
  },
};

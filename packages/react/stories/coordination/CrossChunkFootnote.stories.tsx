import type { Meta, StoryObj } from '@storybook/react-vite';
import AIMarkdown from '../../src';
import { AIMarkdownDocuments } from '../../src/components/AIMarkdownDocuments';
import { WithScheme } from '@ai-markdown/storybook-kit/react/colorScheme';
import { docsLink } from '@ai-markdown/storybook-kit/common/docsLinks';

/**
 * Several `<AIMarkdown>` chunks that share one `documentId` behave as a single
 * document: footnote numbering, link references, and image references resolve
 * across chunk boundaries even when a reference arrives before its definition.
 */
const meta: Meta<typeof AIMarkdownDocuments> = {
  title: 'Documents/Cross-Chunk Coordination',
  tags: ['autodocs'],
  component: AIMarkdownDocuments,
  parameters: {
    a11y: { test: 'error' },
    docs: {
      description: {
        component: [
          'A long answer often arrives as several messages, each rendered by its own',
          '`<AIMarkdown>`. Left alone those are separate documents: chunk 3 cannot see the',
          'footnote chunk 5 defines, and two chunks that both write `[^1]` would fight over',
          'the same anchor ids.',
          '',
          'Wrap them in `<AIMarkdownDocuments>` and give every chunk the **same**',
          '`documentId`, and they behave as one document again:',
          '',
          '```tsx',
          '<AIMarkdownDocuments>',
          '  {messages.map((m) => (',
          '    <AIMarkdown key={m.id} documentId="answer-42" content={m.text} />',
          '  ))}',
          '</AIMarkdownDocuments>',
          '```',
          '',
          'What coordination buys, concretely:',
          '',
          '- **Footnote numbering is global.** Markers are numbered in reference order',
          '  across the whole document, and a label cited twice in different chunks keeps',
          '  one number.',
          '- **References resolve across chunks.** A footnote, link, or image reference in',
          '  an early chunk finds its definition in a later one, in either direction.',
          '- **One footer, at the end.** The aggregate footnote section renders once, under',
          '  the last chunk, with a back-reference arrow per occurrence.',
          '- **Anchors stay namespaced.** Ids are prefixed per `documentId`, so clicking a',
          "  marker in one answer never jumps into another answer's footnotes.",
          '',
          'The id is per *document*, not per React instance — that is the whole reason the',
          'prop is called `documentId`. Chunks of one answer share a value; two different',
          'answers on the same page must not.',
          '',
          '`preserveOrphanReferences` is the companion switch, and on this wrapper it is',
          '**unconditional**: whatever the wrapper says overrides every chunk below it, and',
          'omitting it reads as an explicit `true`. It has to default that way here —',
          'mid-stream, a definition whose citation lives in a chunk that has not arrived is',
          'the normal case, not an error. See the Customization → Orphan References story',
          'for what the switch does on its own.',
          '',
          `See ${docsLink('cross-chunk-coordination', 'cross-chunk coordination')} for the registry model,`,
          'the override chain, and the ordering guarantees.',
        ].join('\n'),
      },
    },
  },
};
export default meta;

/**
 * The smallest case that needs coordination: the reference is in the first
 * chunk, its definition in the second. Both carry `documentId="msg-1"`.
 *
 * The marker renders as footnote 1 and links into a footer that only exists
 * because the second chunk contributed a definition. Render these two strings
 * as independent `<AIMarkdown>` elements without the wrapper and you get the
 * opposite: chunk 1 shows a marker pointing nowhere, and chunk 2's definition
 * is an orphan.
 */
export const TwoChunks: StoryObj<typeof meta> = {
  render: () => (
    <WithScheme>
      {(colorScheme) => (
        <AIMarkdownDocuments>
          <AIMarkdown content="See [^x] for details." documentId="msg-1" colorScheme={colorScheme} />
          <AIMarkdown
            content={'More text continues.\n\n[^x]: detailed footnote content.'}
            documentId="msg-1"
            colorScheme={colorScheme}
          />
        </AIMarkdownDocuments>
      )}
    </WithScheme>
  ),
};

/**
 * A single `<AIMarkdown>`, no wrapper, one footnote definition and nothing
 * citing it. The note still renders, because orphan protection is on by
 * default.
 *
 * This is the baseline the coordinated stories build on: mid-stream, a
 * definition without a reference is a document that is not finished yet, not a
 * document with a mistake in it. The Customization → Orphan References story
 * shows the same document with the protection switched off.
 */
export const OrphanDef: StoryObj<typeof meta> = {
  render: () => (
    <WithScheme>
      {(colorScheme) => (
        <AIMarkdown
          content={'Body text.\n\n[^x]: orphan note still rendered (Direction A).'}
          colorScheme={colorScheme}
        />
      )}
    </WithScheme>
  ),
};

/**
 * Five chunks exercising every kind of cross-chunk reference at once — the
 * shape a real multi-message answer ends up with, where the prose comes first
 * and the definitions trail at the end.
 *
 * References live in chunks 1–3, definitions in chunks 4–5, and each of the
 * three reference kinds crosses the boundary: a footnote (`[^markdown]`,
 * `[^streaming]`), a link reference (`[docs]`, `[api]`), and an image
 * reference (`[arch-img]`, resolving to a seeded Picsum photo).
 *
 * Two details are worth checking rather than taking on trust:
 *
 * - `[^markdown]` is cited in chunk 1 **and** chunk 2 and keeps a single
 *   number in both places. Numbering follows the order labels are first
 *   referenced, not the order references appear, so the second citation reads
 *   1 rather than 3.
 * - The footer at the bottom carries one back-reference arrow per occurrence,
 *   including one per citation of the twice-cited label — so a reader who
 *   followed either marker down can get back to where they were.
 */
export const FiveChunksScattered: StoryObj<typeof meta> = {
  render: () => (
    <WithScheme>
      {(colorScheme) => (
        <AIMarkdownDocuments>
          <AIMarkdown
            documentId="msg-2"
            colorScheme={colorScheme}
            content={[
              '# Introduction',
              '',
              'The system uses [^markdown] for content rendering and [^streaming] for partial',
              'updates. See the [reference docs][docs] for more.',
            ].join('\n')}
          />
          <AIMarkdown
            documentId="msg-2"
            colorScheme={colorScheme}
            content={[
              '## Architecture',
              '',
              'Components are composed [^markdown] hierarchically. The illustrative photo below',
              'resolves from a reference defined in a later chunk:',
              '',
              '![Illustrative photo][arch-img]',
            ].join('\n')}
          />
          <AIMarkdown
            documentId="msg-2"
            colorScheme={colorScheme}
            content={[
              '## Usage example',
              '',
              'The [`AIMarkdown`][api] component accepts these props. Refer back to',
              '[^streaming] for related concepts.',
            ].join('\n')}
          />
          <AIMarkdown
            documentId="msg-2"
            colorScheme={colorScheme}
            content={[
              '[^markdown]: GitHub-flavored Markdown spec, plus a few extensions for AI',
              '    rendering scenarios.',
              '',
              '[docs]: https://example.com/docs "Project documentation"',
            ].join('\n')}
          />
          <AIMarkdown
            documentId="msg-2"
            colorScheme={colorScheme}
            content={[
              '[^streaming]: Token-by-token streaming support for LLM outputs.',
              '',
              '[arch-img]: https://picsum.photos/seed/ai-markdown-reference/200/300 "Illustrative photo"',
              '',
              '[api]: https://example.com/api',
            ].join('\n')}
          />
        </AIMarkdownDocuments>
      )}
    </WithScheme>
  ),
};

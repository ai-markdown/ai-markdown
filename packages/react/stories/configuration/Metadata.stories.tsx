import type { ComponentPropsWithoutRef } from 'react';
import '../../src/components/typography/variants/all.scss';
import AIMarkdown, { useAIMarkdownMetadata, type AIMarkdownCustomComponents } from '../../src/index';
import { ThemedAIMarkdown } from '../_shared/ThemedAIMarkdown';
import { baseReactMeta, type ReactMeta, type ReactStory } from '../_shared/meta';
import { docsLink } from '@ai-markdown/storybook-kit/common/docsLinks';

/**
 * Handing application data to a custom component without threading it through
 * the markdown.
 */
const meta: ReactMeta = {
  ...baseReactMeta,
  title: 'Customization/Metadata',
  tags: ['autodocs'],
  component: AIMarkdown,
  parameters: {
    a11y: { test: 'error' },
    controls: { include: ['content', 'metadata'] },
    docs: {
      description: {
        component: [
          'A custom component renders one markdown element and knows nothing about the',
          'application around it. `metadata` is the channel that closes that gap: whatever',
          'you pass goes into a dedicated React context, and any component in the tree',
          'reads it back with `useAIMarkdownMetadata<T>()`.',
          '',
          '```tsx',
          'type CitationMetadata = { citations: Record<string, { index: number; source: string }> };',
          '',
          'const CitedLink = (props) => {',
          '  const { citations } = useAIMarkdownMetadata<CitationMetadata>() ?? { citations: {} };',
          '  // …decorate the link when its href is a known citation',
          '};',
          '',
          '<AIMarkdown content={md} metadata={METADATA} customComponents={{ a: CitedLink }} />',
          '```',
          '',
          'The context is separate from the other four on purpose: metadata changes do not',
          'invalidate the renderer, so passing a new object re-renders the components that',
          'read it and nothing else.',
          '',
          '**`metadata` is deliberately never stabilized.** Every other object-valued prop',
          "crosses the library's stability firewall — some deep-compared, some warned",
          'about — and `metadata` is the one declared exemption (`PASS_THROUGH`). Its shape',
          'is opaque and potentially large, so a deep compare would have unbounded cost',
          'and the library refuses to guess. That makes reference stability *your*',
          'responsibility: hoist the object to module scope, or memoize it. Passing a fresh',
          'object literal on every render re-renders every metadata consumer in the',
          'document, forever. This is a design decision, not an oversight — please do not',
          'file it as a performance bug.',
          '',
          `See ${docsLink('metadata-context', 'the metadata context guide')} for the typing pattern and`,
          `${docsLink('typescript-generics', 'TypeScript generics')} for pinning \`TMetadata\` once at the wrapper.`,
        ].join('\n'),
      },
    },
  },
};

export default meta;

/** The caller-asserted metadata shape. A type alias, so it satisfies the generic's constraint. */
type CitationMetadata = {
  citations: Record<string, { index: number; source: string }>;
};

/**
 * An anchor that upgrades itself into a citation when the document's metadata
 * knows its href. Links the metadata says nothing about render untouched —
 * the component has to work for both, because the markdown decides which
 * links appear and the application decides which ones it can annotate.
 *
 * The hook returns `undefined` when no `metadata` prop was passed, regardless
 * of the asserted type: `TMetadata` is an assertion about what the provider
 * received, not something TypeScript can verify. Hence the `?.` chain.
 */
const CitedLink = ({ node: _node, children, ...props }: ComponentPropsWithoutRef<'a'> & { node?: unknown }) => {
  const metadata = useAIMarkdownMetadata<CitationMetadata>();
  const citation = props.href ? metadata?.citations?.[props.href] : undefined;
  return (
    <a {...props} title={citation?.source ?? props.title}>
      {children}
      {citation ? (
        <sup
          style={{
            border: '1px solid currentColor',
            borderRadius: 3,
            fontSize: '0.7em',
            marginInlineStart: 3,
            padding: '0 4px',
          }}
        >
          {citation.index}
        </sup>
      ) : null}
    </a>
  );
};

const COMPONENTS: AIMarkdownCustomComponents = { a: CitedLink };

/** Module scope, per the exemption described in the header. */
const CITATION_METADATA: CitationMetadata = {
  citations: {
    'https://example.com/smith2024': { index: 1, source: 'Smith, A. et al. (2024). Adaptive jitter buffering.' },
    'https://example.com/lee2025': { index: 2, source: 'Lee, B. (2025). Typewriter pacing in production chat.' },
  },
};

const CITED_DOC: string = [
  '# Perceived latency',
  '',
  'Adaptive buffering measurably improves perceived latency in text streams',
  '([Adaptive jitter buffering](https://example.com/smith2024)), and the effect',
  'holds across device classes',
  '([Typewriter pacing](https://example.com/lee2025)).',
  '',
  'The [workshop notes](https://example.com/embedded-notes) are not in the',
  'citation index, so that link renders exactly as the markdown wrote it — the',
  'component only decorates what the metadata claims to know.',
  '',
  'Contact [the maintainers](mailto:support@example.com) about missing entries.',
].join('\n');

/**
 * The markdown carries plain links; the metadata carries the bibliography.
 * Two of the four links match an entry in the citation index and pick up a
 * numbered badge plus a `title` with the full source; the other two are left
 * alone.
 *
 * Edit the `metadata` control to see it live — add the
 * `https://example.com/embedded-notes` key and the third link joins the index,
 * or delete a key and its badge disappears. Nothing about the markdown
 * changes; the same document renders differently because the application knows
 * more.
 *
 * Editing the control also demonstrates the cost the exemption buys you: the
 * controls panel hands over a brand-new object each time, every consumer
 * re-renders, and that is exactly what would happen in an app that built the
 * object inline in render.
 */
export const MetadataDrivenComponents: ReactStory = {
  args: { content: CITED_DOC, metadata: CITATION_METADATA },
  render: (args) => (
    <ThemedAIMarkdown content={args.content ?? ''} metadata={args.metadata} customComponents={COMPONENTS} />
  ),
};

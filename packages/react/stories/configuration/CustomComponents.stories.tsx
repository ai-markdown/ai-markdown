import { useState, type ComponentPropsWithoutRef } from 'react';
import '../../src/components/typography/variants/all.scss';
import AIMarkdown, { type AIMarkdownCustomComponents } from '../../src/index';
import { ThemedAIMarkdown } from '../_shared/ThemedAIMarkdown';
import { WithScheme } from '@ai-markdown/storybook-kit/react/colorScheme';
import { baseReactMeta, type ReactMeta, type ReactStory } from '../_shared/meta';
import { docsLink } from '@ai-markdown/storybook-kit/common/docsLinks';
import { LINKED_PROSE_DOC } from '@ai-markdown/storybook-kit/common/fixtures';
import { StreamingReplay, ThemedReplayButton } from '@ai-markdown/storybook-kit/react/streaming';
import { getStreamingTheme } from '@ai-markdown/storybook-kit/react/theme';

/**
 * Replacing the renderer for an individual markdown element, and the
 * reference-stability rule that decides whether the replacement is cheap or
 * ruinous.
 */
const meta: ReactMeta = {
  ...baseReactMeta,
  title: 'Customization/Custom Components',
  tags: ['autodocs'],
  component: AIMarkdown,
  parameters: {
    a11y: { test: 'error' },
    controls: { include: ['content'] },
    docs: {
      description: {
        component: [
          '`customComponents` is a map from markdown element name to the React component',
          'that renders it. Anything `react-markdown` names is replaceable — `a`, `pre`,',
          '`code`, `table`, `img`, headings — and your component receives the ordinary DOM',
          'props for that element plus a `node` field carrying the hast node it came from.',
          '',
          '```tsx',
          "const BadgedLink = (props: ComponentPropsWithoutRef<'a'>) => <a {...props} />;",
          'const COMPONENTS = { a: BadgedLink, pre: CopyPre };',
          '',
          '<AIMarkdown content={md} customComponents={COMPONENTS} />',
          '```',
          '',
          '**Define the map and the components at module scope.** The prop crosses the',
          "library's stability firewall as a `DEEP_EQUAL` entry, so a fresh object literal",
          'with the same component references still restores the previous identity — but a',
          'component *defined inside render* is a new function on every parent render, the',
          'deep compare sees a genuine change, and the block-memo cache is discarded for',
          'the whole document on every keystroke of a stream. If the components have to be',
          'built from props, wrap the map in `useMemo` or `useStableRecord` rather than',
          'writing it inline.',
          '',
          `See ${docsLink('custom-components', 'custom components')} for the element list and the`,
          `${docsLink('architecture', 'architecture guide')} for where the override sits in the pipeline.`,
        ].join('\n'),
      },
    },
  },
};

export default meta;

/**
 * An anchor that keeps every prop it was given and appends an outbound marker.
 * Spreading `props` first is the whole trick: `href`, `title`, and the
 * sanitized attributes arrive already filtered by both URL gates, and dropping
 * them would quietly undo that work.
 *
 * `node` is pulled out of the props before the spread — it is the hast node,
 * useful for reading the source position or the raw attributes, and React
 * would warn about it as an unknown DOM attribute if it were forwarded.
 */
const BadgedLink = ({ node: _node, children, ...props }: ComponentPropsWithoutRef<'a'> & { node?: unknown }) => (
  <a {...props}>
    {children}
    <sup aria-hidden style={{ fontSize: '0.75em', marginInlineStart: 2, opacity: 0.7 }}>
      ↗
    </sup>
  </a>
);

/**
 * A code block wrapped in a positioned container with a copy button. The
 * button reads the rendered text back out of the DOM — the `<pre>` is its own
 * next sibling — rather than re-deriving it from the hast node, so it stays
 * correct for whatever the fence held, including content still arriving.
 *
 * `navigator.clipboard` is missing in insecure contexts and in some test
 * environments, so the write is guarded — the button still renders and still
 * gives feedback, it just has nothing to write to.
 */
const CopyPre = ({ node: _node, children, ...props }: ComponentPropsWithoutRef<'pre'> & { node?: unknown }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={(event) => {
          const pre = event.currentTarget.nextElementSibling;
          const text = pre?.textContent ?? '';
          void navigator.clipboard?.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        }}
        style={{
          background: 'transparent',
          border: '1px solid currentColor',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 11,
          inlineSize: 'auto',
          insetBlockStart: 6,
          insetInlineEnd: 6,
          opacity: 0.7,
          padding: '2px 8px',
          position: 'absolute',
          zIndex: 1,
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre {...props}>{children}</pre>
    </div>
  );
};

/** The map itself is a module constant — see the stability note in the header. */
const COMPONENTS: AIMarkdownCustomComponents = { a: BadgedLink, pre: CopyPre };

/**
 * Two overrides at once over a document full of links and fences. Every link
 * carries the outbound marker, and every code block grows a copy button that
 * reads its own rendered text.
 *
 * Look at what the overrides did *not* have to do: the `mailto:` link and the
 * `https` links arrive with their `href` already through both sanitization
 * gates, and the fences arrive with their `language-*` class names already on
 * the inner `<code>`. An override replaces a renderer, not the pipeline that
 * feeds it.
 */
export const CustomLinkAndPre: ReactStory = {
  args: { content: LINKED_PROSE_DOC.replace('[](https://example.test/c)', '[Example C](https://example.test/c)') },
  render: (args) => <ThemedAIMarkdown content={args.content ?? ''} customComponents={COMPONENTS} />,
};

/**
 * The same overrides under a live stream. This is where the module-scope rule
 * stops being pedantry: the content prop changes several times a second, and
 * every one of those renders re-reads `customComponents`. With the map and its
 * components hoisted, the deep compare short-circuits on identity and the
 * block-memo cache survives the whole stream; with them written inline, each
 * token would rebuild every block in the document.
 *
 * The copy button stays usable mid-stream — it reads the DOM at click time, so
 * it copies whatever has arrived so far rather than a stale snapshot.
 */
export const StreamingSafe: ReactStory = {
  args: { content: LINKED_PROSE_DOC.replace('[](https://example.test/c)', '[Example C](https://example.test/c)') },
  parameters: {
    a11y: { test: 'error' },
    chromatic: { disableSnapshot: true },
  },
  render: (args) => (
    <WithScheme>
      {(colorScheme) => (
        <StreamingReplay
          text={args.content ?? ''}
          options={{ chunkSizeMin: 4, chunkSizeMax: 18, chunkDelayMin: 20, chunkDelayMax: 70 }}
          style={{ color: getStreamingTheme(colorScheme).text }}
          renderButton={(streaming, restart) => <ThemedReplayButton streaming={streaming} onRestart={restart} />}
        >
          {(content, streaming) => (
            <AIMarkdown
              content={content}
              streaming={streaming}
              colorScheme={colorScheme}
              customComponents={COMPONENTS}
            />
          )}
        </StreamingReplay>
      )}
    </WithScheme>
  ),
};

import '../../src/components/typography/variants/all.scss';
import AIMarkdown from '../../src/index';
import { WithScheme } from '@ai-markdown/storybook-kit/react/colorScheme';
import { baseReactMeta, type ReactMeta, type ReactStory } from '../_shared/meta';
import { docsLink } from '@ai-markdown/storybook-kit/common/docsLinks';
import { StreamingReplay, ThemedReplayButton } from '@ai-markdown/storybook-kit/react/streaming';
import { DEFINITION_LIST_DOC, FOOTNOTES_DOC } from '@ai-markdown/storybook-kit/common/fixtures';
import { getStreamingTheme } from '@ai-markdown/storybook-kit/react/theme';

/**
 * Two list-shaped extensions: GFM footnotes and PHP-Markdown-Extra
 * definition lists.
 */
const meta: ReactMeta = {
  ...baseReactMeta,
  title: 'Basics/Footnotes & Definition Lists',
  tags: ['autodocs'],
  component: AIMarkdown,
  parameters: {
    // 'error' holds here, which is worth a note because it looks like it
    // should not: the library's default `--aim-color-anchor` misses 4.5:1
    // against white, and it fires on ordinary links elsewhere in this
    // Storybook. Neither link shape in a footnoted document trips the rule —
    // the superscript marker and the `↩` back-reference are both evaluated as
    // exempt by axe's color-contrast check. Neither fixture in the two static
    // stories carries an ordinary inline link, so nothing here is masking a
    // violation. Add one and expect this to drop back to 'todo'.
    //
    // The streaming story overrides this to 'todo' — see the note there.
    a11y: { test: 'error' },
    controls: { include: ['content'] },
    docs: {
      description: {
        component: [
          'Footnotes come from GitHub Flavored Markdown and are always on. Every',
          'definition in the document is collected into one footer section, the markers',
          'are renumbered in the order the references appear in the prose, and each',
          'generated id is namespaced with the document id so two documents on the same',
          'page cannot collide.',
          '',
          'Definition lists are the `definitionList` engine plugin, which is part of the',
          'default plugin set. Turn it off and the same source renders as ordinary',
          'paragraphs with literal colons — see **Basics/Engine Plugins** for the',
          'side-by-side. For footnotes that have to survive being split across streamed',
          `chunks, see ${docsLink('cross-chunk-coordination', 'cross-chunk coordination')}.`,
        ].join('\n'),
      },
    },
  },
};

export default meta;

/**
 * Numeric labels, word labels, multi-paragraph definitions, and a definition
 * carrying a fenced code block.
 *
 * The rendered numbers come from reference order, not from the labels: the
 * definition labelled `[^setup]` is footnote 2 because its reference is the
 * second one in the prose. A label referenced twice keeps one entry in the
 * footer and gets a second back-reference arrow.
 */
export const Footnotes: ReactStory = {
  args: {
    content: FOOTNOTES_DOC,
  },
};

/**
 * A term on its own line, its definitions on the lines below opened with
 * `: `. One term can take several definitions, a definition can wrap across
 * lines, and both the term and the definition accept inline formatting.
 *
 * This syntax is the `definitionList` engine plugin. It is in the default
 * set, so it works without configuration — but the moment you pass an
 * `enginePlugins` array you replace that set wholesale, and leaving this
 * plugin out of your array turns the `: ` lines back into literal text.
 */
export const DefinitionLists: ReactStory = {
  args: {
    content: DEFINITION_LIST_DOC,
  },
};

/**
 * The same footnote document delivered token by token. Watch the footer
 * section: markers appear as soon as their reference is typed, and the
 * numbering stays stable as later definitions arrive — a footnote never
 * renumbers itself out from under the reader mid-stream, because the number
 * is fixed by reference order and references only ever arrive in order.
 *
 * Press **Restart** to replay. The cadence is seeded, so every replay
 * delivers the identical arrival pattern.
 */
export const FootnotesStreaming: ReactStory = {
  args: {
    content: FOOTNOTES_DOC,
  },
  parameters: {
    a11y: { test: 'error' },
    controls: { include: ['content'] },
  },
  render: (args) => (
    <WithScheme>
      {(colorScheme) => (
        <StreamingReplay
          text={args.content ?? ''}
          style={{ color: getStreamingTheme(colorScheme).text }}
          renderButton={(streaming, restart) => <ThemedReplayButton streaming={streaming} onRestart={restart} />}
        >
          {(content, streaming) => (
            <AIMarkdown {...args} content={content} streaming={streaming} colorScheme={colorScheme} />
          )}
        </StreamingReplay>
      )}
    </WithScheme>
  ),
};

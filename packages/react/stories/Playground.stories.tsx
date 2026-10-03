import React from 'react';
import 'katex/dist/katex.min.css';
import '../src/components/typography/variants/all.scss';
import AIMarkdown from '../src/index';
import { WithScheme } from '@ai-markdown/storybook-kit/react/colorScheme';
import { baseReactMeta, type ReactMeta, type ReactStory } from './_shared/meta';
import { reactArgTypes } from '@ai-markdown/storybook-kit/react/argTypes';
import { StreamingReplay, ThemedReplayButton } from '@ai-markdown/storybook-kit/react/streaming';
import { GFM_BASICS, KITCHEN_SINK } from '@ai-markdown/storybook-kit/common/fixtures';
import { getStreamingTheme } from '@ai-markdown/storybook-kit/react/theme';

/**
 * Editable source and common `<AIMarkdown>` rendering options. Start
 * here to try the component against your own content: paste markdown into
 * `content`, flip the behavior flags, switch the theme from the toolbar.
 *
 * The feature branches below split the same surface into one story per
 * capability, each with its controls narrowed to the props that matter there.
 */
const meta: ReactMeta = {
  ...baseReactMeta,
  title: 'Playground',
  tags: ['autodocs'],
  component: AIMarkdown,
  parameters: {
    a11y: { test: 'error' },
  },
  argTypes: {
    ...reactArgTypes,
    variant: { control: 'select', options: ['default'], description: 'Typography variant name.' },
  },
};

export default meta;

/** Static render of the GFM baseline — edit `content` to render your own. */
export const Default: ReactStory = {
  args: {
    content: GFM_BASICS,
  },
};

/**
 * The same component fed token by token. The payload is the showcase
 * document — prose, four fenced blocks, a table, display and inline math, a
 * task list, and footnotes — so the replay shows how each of those block
 * types behaves while its own source is still arriving. One of those fences
 * is mermaid source, which stays a code block here: core ships no diagram
 * renderer, so it is the Mantine branch that draws it.
 *
 * Watch how incomplete constructs settle. An open code fence can already
 * render code text; the LaTeX preprocessor handles incomplete display-math
 * tails separately. The `streaming` flag does not select those parse rules.
 *
 * Hit **Restart** to replay. `content` is a control, so you can stream any
 * markdown you paste in.
 */
export const Streaming: ReactStory = {
  args: {
    content: KITCHEN_SINK,
    fontSize: '',
  },
  // One mechanism for hiding the live `streaming` control in replay stories:
  // `table.disable` removes it from the controls panel AND the docs table
  // (a `controls.exclude` next to it was redundant).
  argTypes: {
    streaming: { table: { disable: true } },
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

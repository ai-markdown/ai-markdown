import type { Meta, StoryObj } from '@storybook/react-vite';
import MantineAIMarkdown from '../../src/index';
import { withMantineProvider } from '../decorators';
import { reactArgTypes } from '@ai-markdown/storybook-kit/react/argTypes';

export type MantineMeta = Meta<typeof MantineAIMarkdown>;
export type MantineStory = StoryObj<typeof MantineAIMarkdown>;

/**
 * Core's controls plus the one prop the Mantine wrapper adds. `variant` is
 * deliberately absent: the wrapper substitutes its own Typography, so a
 * typography-variant control would be inert here.
 */
export const mantineArgTypes: NonNullable<MantineMeta['argTypes']> = {
  ...reactArgTypes,
  codeBlock: {
    control: 'object',
    description:
      'Code-block behavior group (`defaultExpanded`, `autoDetectUnknownLanguage`, `highlightJs`, `mermaidIntervalMs`, …). ' +
      'Replaces atomically; omitted fields fall to the shipped defaults.',
  },
};

/**
 * Everything a Mantine meta shares. Same rule as `baseReactMeta`: spread it,
 * then write `title` and `tags` as literal properties.
 *
 * No themed render wrapper here — `<MantineAIMarkdown>` reads Mantine's
 * provider color scheme itself, so it follows the provider the decorator
 * sets up. That automatic tracking is a feature of the package, not scaffolding to
 * work around.
 */
export const baseMantineMeta: Partial<MantineMeta> = {
  component: MantineAIMarkdown,
  decorators: [withMantineProvider],
  argTypes: mantineArgTypes,
};

export { storyTheme } from './theme';

import React from 'react';
import MantineAIMarkdown from '../src/index';
import 'katex/dist/katex.min.css';
import { baseMantineMeta, type MantineMeta, type MantineStory } from './_shared/meta';
import { expect, waitFor } from 'storybook/test';
import { CJK_EMPHASIS_REGRESSION, GFM_BASICS } from '@ai-markdown/storybook-kit/common/fixtures';

/**
 * The Mantine wrapper with common rendering controls, including
 * `codeBlock`. Color scheme follows the toolbar through Mantine's own
 * provider, so there is no `colorScheme` prop to set here.
 */
const meta: MantineMeta = {
  ...baseMantineMeta,
  title: 'Integrations/Mantine/Playground',
  tags: ['autodocs'],
  component: MantineAIMarkdown,
  parameters: {
    a11y: { test: 'error' },
  },
  render: (args) => <MantineAIMarkdown {...args} />,
};

export default meta;

/** The GFM baseline, rendered through Mantine's typography and code blocks. */
export const Default: MantineStory = {
  args: {
    content: GFM_BASICS,
  },
};

/**
 * The CJK emphasis fix, verified through the Mantine wrapper too — the
 * correction lives in the shared engine, so the wrapper must inherit it.
 * The React story under Basics covers the same ground for readers; this one
 * exists to catch a regression that only shows up here. The fixture is
 * shared with React: nine `**…**` pairs against CJK
 * punctuation, three of them with `~~` nested inside, plus ONE escaped
 * `\*\*` that must stay literal. The play asserts exactly that shape.
 */
export const CJKRenderErrorFix: MantineStory = {
  tags: ['qa'],
  args: {
    content: CJK_EMPHASIS_REGRESSION,
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelectorAll('strong')).toHaveLength(9));
    expect(canvasElement.querySelectorAll('del')).toHaveLength(3);
    // The one deliberately escaped pair renders as literal asterisks; every
    // other `**` must have become emphasis (the regression shows up as
    // literal `**` runs next to CJK punctuation).
    expect((canvasElement.textContent?.match(/\*\*/g) ?? []).length).toBe(1);
  },
};

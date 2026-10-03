/**
 * QA: a RUNTIME flip of `preserveOrphanReferences` must re-render the
 * synthetic footnote footer (2026-08 project review, core-render-03).
 *
 * The orphan policy is a to-hast input: it changes footer membership (and,
 * with a def written above its reference, the sup numbering) without
 * touching the mdast the block-memo ctx is derived from. The footer slot
 * was keyed by that ctx alone, so after a flip the pipeline produced a new
 * hast while the memo kept serving the stale footer — indefinitely on
 * static content. `MarkdownContent` now flushes the block cache when the
 * effective policy changes; this story drives the flip through real React
 * commits (SSR cannot re-render an instance) and asserts the DOM follows.
 */
import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within, userEvent } from 'storybook/test';
import AIMarkdown from '../../src';

/** One cited note and one orphan: BOTH policies render a footer, so a stale
 *  memo slot is observable as the wrong `<li>` count (a pure-orphan document
 *  would simply have no footer to serve stale). */
const CONTENT = [
  'The paragraph cites one note[^used] and leaves the other unreferenced.',
  '',
  '[^used]: Cited body.',
  '[^orphan]: Orphan body.',
].join('\n');

function OrphanFlipHarness() {
  const [preserve, setPreserve] = useState(true);
  return (
    <div>
      <button type="button" onClick={() => setPreserve((p) => !p)}>
        flip preserveOrphanReferences
      </button>
      <output data-testid="policy">{String(preserve)}</output>
      {/* Static content, block-memo on (default): the only thing that
          changes between renders is the policy. */}
      <AIMarkdown content={CONTENT} preserveOrphanReferences={preserve} />
    </div>
  );
}

const meta: Meta<typeof OrphanFlipHarness> = {
  title: 'QA/Orphan Policy Flip',
  tags: ['qa'],
  component: OrphanFlipHarness,
  parameters: {
    // Behavioral assertion, not a visual.
    chromatic: { disableSnapshot: true },
    a11y: { test: 'error' },
  },
};
export default meta;

type Story = StoryObj<typeof OrphanFlipHarness>;

export const FooterFollowsTheFlip: Story = {
  render: () => <OrphanFlipHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const flip = canvas.getByRole('button', { name: 'flip preserveOrphanReferences' });
    const footer = () => canvasElement.querySelector('section[data-footnotes]');

    const liCount = () => footer()?.querySelectorAll('li').length ?? -1;

    // Protection on: the cited note AND the orphan render.
    await waitFor(() => expect(liCount()).toBe(2));

    // Off: only the cited note may remain (a stale slot keeps serving 2).
    await userEvent.click(flip);
    await waitFor(() => expect(canvas.getByTestId('policy').textContent).toBe('false'));
    await waitFor(() => expect(liCount()).toBe(1));

    // Back on: the orphan returns (the slot may not serve the "off" render).
    await userEvent.click(flip);
    await waitFor(() => expect(canvas.getByTestId('policy').textContent).toBe('true'));
    await waitFor(() => expect(liCount()).toBe(2));
  },
};

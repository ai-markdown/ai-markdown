/**
 * QA: a RUNTIME plugin/schema swap must refresh the aggregate footnote footer
 * (2026-08 project review, core-render-05).
 *
 * In coordinated mode the defining chunk publishes each footnote body's
 * post-pipeline hast (`bodyHast`) to the registry, and the last chunk
 * renders the aggregate footer from it. The contribute effect fingerprints
 * SOURCE facts (labels, def text, urls) to avoid re-publishing every
 * streaming frame — so a schema/rehype swap that re-parsed the chunk but
 * changed no source fact left the registry holding bodyHast from the OLD
 * chain, and
 * the footer disagreed with the body until some label changed. The effect
 * now compares the parse-input chain by identity as well; this story
 * drives the swap through real React commits and asserts the footer follows.
 */
import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within, userEvent } from 'storybook/test';
import AIMarkdown, { extendSanitizeSchema } from '../../src';
import { AIMarkdownDocuments } from '../../src/components/AIMarkdownDocuments';

// A rehype-level swap: remark-level plugin changes alter the mdast, which the
// contribute fingerprint already hashes (def bodies are stringified mdast).
// The blind spot is anything that changes bodyHast WITHOUT changing the mdast
// — the sanitize schema, rehype plugins — so the harness swaps the schema.
// Both values are module constants (stability firewall).
const NO_KBD = extendSanitizeSchema((draft) => {
  draft.tagNames = (draft.tagNames ?? []).filter((t) => t !== 'kbd');
});
const DOC = 'plugin-swap-refresh';

function PluginSwapHarness() {
  const [allowKbd, setAllowKbd] = useState(true);
  return (
    <div>
      <button type="button" onClick={() => setAllowKbd((v) => !v)}>
        toggle kbd in sanitize schema
      </button>
      <output data-testid="kbd">{String(allowKbd)}</output>
      <AIMarkdownDocuments>
        <AIMarkdown documentId={DOC} content="The claim[^n] is cited here." />
        {/* Defining chunk (and last chunk → renders the aggregate footer).
            The footnote BODY carries raw <kbd>, kept or stripped by the
            schema — same mdast either way. */}
        <AIMarkdown
          documentId={DOC}
          content={'[^n]: Press <kbd>Ctrl</kbd> to continue.'}
          sanitizeSchema={allowKbd ? undefined : NO_KBD}
        />
      </AIMarkdownDocuments>
    </div>
  );
}

const meta: Meta<typeof PluginSwapHarness> = {
  title: 'QA/Plugin Swap Refresh',
  tags: ['qa'],
  component: PluginSwapHarness,
  parameters: {
    // Behavioral assertion, not a visual.
    chromatic: { disableSnapshot: true },
    a11y: { test: 'error' },
  },
};
export default meta;

type Story = StoryObj<typeof PluginSwapHarness>;

export const AggregateFooterFollowsTheSchemaSwap: Story = {
  render: () => <PluginSwapHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole('button', { name: 'toggle kbd in sanitize schema' });
    const footerKbd = () => canvasElement.querySelector('section[data-footnotes] kbd');
    const footerLi = () => canvasElement.querySelector('section[data-footnotes] li');

    // kbd allowed: the aggregate footer body renders <kbd>.
    await waitFor(() => expect(footerLi()).not.toBeNull());
    await waitFor(() => expect(footerKbd()).not.toBeNull());

    // Stripped: the chunk re-parses under the new schema — the footer must
    // lose the <kbd> (a stale bodyHast in the registry keeps it).
    await userEvent.click(toggle);
    await waitFor(() => expect(canvas.getByTestId('kbd').textContent).toBe('false'));
    await waitFor(() => expect(footerKbd()).toBeNull());
    expect(footerLi()?.textContent).toContain('Ctrl');

    // Back: it must return.
    await userEvent.click(toggle);
    await waitFor(() => expect(canvas.getByTestId('kbd').textContent).toBe('true'));
    await waitFor(() => expect(footerKbd()).not.toBeNull());
  },
};

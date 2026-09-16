/**
 * QA: the code-block renderer while a block streams. Auto-detection labels a
 * block as soon as the evidence is conclusive, never swaps that label for an
 * unrelated language mid-stream, and starts over when a regenerate replaces
 * the block; JSON pretty-print lands as soon as the block looks complete
 * rather than when the whole message ends.
 */
import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within, userEvent } from 'storybook/test';
import MantineAIMarkdown, { type MantineCodeBlockOptions } from '../src/index';
import { withMantineProvider } from './decorators';

const SQL_BODY = [
  'SELECT u.id, u.name, COUNT(o.id) AS orders',
  'FROM users u',
  'LEFT JOIN orders o ON o.user_id = u.id',
  'WHERE u.created_at > NOW() - INTERVAL 30 DAY',
  'GROUP BY u.id, u.name',
  'HAVING COUNT(o.id) > 2',
  'ORDER BY orders DESC',
  'LIMIT 50;',
].join('\n');

/** Unlabelled fence, cut at growing prefixes; the last frame ends the stream. */
const AUTODETECT_FRAMES: Array<{ content: string; streaming: boolean }> = [
  { content: '```\n' + SQL_BODY.slice(0, 40), streaming: true },
  { content: '```\n' + SQL_BODY.slice(0, 80), streaming: true },
  { content: '```\n' + SQL_BODY.slice(0, 160), streaming: true },
  { content: '```\n' + SQL_BODY + '\n```\n\nstill typing prose, done.', streaming: false },
];

const JSON_DOC = '```json\n{"a": 1, "nested": "{\\"b\\": [1, 2]}"}\n```\n\nThe message keeps going';
const JSON_FRAMES: Array<{ content: string; streaming: boolean }> = [
  { content: JSON_DOC.slice(0, 20), streaming: true }, // inside the JSON, incomplete
  { content: JSON_DOC, streaming: true }, // block complete, message still streaming
  { content: JSON_DOC + ' and ends.', streaming: false },
];

function Harness({ frames, codeBlock }: { frames: typeof JSON_FRAMES; codeBlock?: Partial<MantineCodeBlockOptions> }) {
  const [step, setStep] = useState(0);
  const frame = frames[Math.min(step, frames.length - 1)];
  return (
    <div>
      <button type="button" onClick={() => setStep((s) => Math.min(s + 1, frames.length - 1))}>
        next frame
      </button>
      <output data-testid="step">{step}</output>
      <MantineAIMarkdown content={frame.content} streaming={frame.streaming} codeBlock={codeBlock} />
    </div>
  );
}

const meta: Meta<typeof Harness> = {
  title: 'Integrations/Mantine/QA/Code Block Streaming',
  tags: ['qa'],
  component: Harness,
  decorators: [withMantineProvider],
  parameters: { chromatic: { disableSnapshot: true }, a11y: { test: 'off' } },
};
export default meta;

type Story = StoryObj<typeof Harness>;

const AUTODETECT = { autoDetectUnknownLanguage: true };
/** The tab label is the detected language; a block with no language has no tab strip. */
const tabLabel = (canvasElement: HTMLElement) =>
  canvasElement.querySelector('.mantine-CodeHighlightTabs-file, [class*="CodeHighlightTabs-file"]')?.textContent ?? '';

export const AutodetectLabelsEarlyAndHolds: Story = {
  render: () => <Harness frames={AUTODETECT_FRAMES} codeBlock={AUTODETECT} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const next = canvas.getByRole('button', { name: 'next frame' });
    const stepIs = (n: number) => waitFor(() => expect(canvas.getByTestId('step').textContent).toBe(String(n)));

    // Every prefix is either still unlabelled or already `sql`: the detector
    // abstains until the evidence is conclusive and never flips in between.
    await stepIs(0);
    expect(['', 'sql']).toContain(tabLabel(canvasElement));
    for (const step of [1, 2]) {
      await userEvent.click(next);
      await stepIs(step);
      expect(['', 'sql']).toContain(tabLabel(canvasElement));
    }
    await waitFor(() => expect(tabLabel(canvasElement)).toBe('sql'));

    await userEvent.click(next);
    await stepIs(3);
    expect(tabLabel(canvasElement)).toBe('sql');
  },
};

const PY_BODY = ['import os', 'import sys', '', 'def main(argv):', '    for path in argv:', '        print(path)'].join(
  '\n'
);
/** A regenerate on the same block: the SQL block is REPLACED by a same-length
 *  Python block while still streaming (same source offset → same PreCode
 *  instance). The old verdict must not survive the swap. */
const REGENERATE_FRAMES: Array<{ content: string; streaming: boolean }> = [
  { content: '```\n' + SQL_BODY, streaming: true },
  { content: '```\n' + PY_BODY.padEnd(SQL_BODY.length, ' '), streaming: true }, // same-length replacement must also reset
  { content: '```\n' + PY_BODY + '\n```\n', streaming: false },
];

export const AutodetectRestartsOnRegenerate: Story = {
  render: () => <Harness frames={REGENERATE_FRAMES} codeBlock={AUTODETECT} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const next = canvas.getByRole('button', { name: 'next frame' });
    const stepIs = (n: number) => waitFor(() => expect(canvas.getByTestId('step').textContent).toBe(String(n)));

    await stepIs(0);
    await waitFor(() => expect(tabLabel(canvasElement)).toBe('sql'));

    // Swap to a different, same-length block: the SQL verdict must go away,
    // even though Python sits in another language family.
    await userEvent.click(next);
    await stepIs(1);
    await waitFor(() => expect(tabLabel(canvasElement)).toBe('python'));

    await userEvent.click(next);
    await stepIs(2);
    expect(tabLabel(canvasElement)).toBe('python');
  },
};

export const JsonPrettyPrintsWhenTheBlockCompletes: Story = {
  render: () => <Harness frames={JSON_FRAMES} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const next = canvas.getByRole('button', { name: 'next frame' });
    const stepIs = (n: number) => waitFor(() => expect(canvas.getByTestId('step').textContent).toBe(String(n)));
    const codeText = () => canvasElement.querySelector('pre code, code')?.textContent ?? '';

    await stepIs(0);
    // Incomplete prefix: rendered raw, no pretty-print attempted.
    expect(codeText()).toContain('{"a": 1');

    // Block complete while the MESSAGE still streams → already pretty-printed
    // (nested JSON string expanded, 2-space indent).
    await userEvent.click(next);
    await stepIs(1);
    await waitFor(() => expect(codeText()).toContain('"nested": {'));
    expect(codeText()).toContain('\n  "a": 1');
  },
};

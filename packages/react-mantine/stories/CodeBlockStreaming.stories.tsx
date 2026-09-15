/**
 * QA: the code-block renderer's streaming schedule (2026-08 project review,
 * pkg-small-06 follow-up): auto-detection gives an EARLY label, corrects it
 * on doubling, and settles at end of stream; JSON pretty-print lands as soon
 * as the block looks complete rather than when the whole message ends.
 * Runs against the real highlight.js in the browser.
 */
import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within, userEvent } from 'storybook/test';
import hljs from 'highlight.js';
import MantineAIMarkdown, { type MantineCodeBlockOptions } from '../src/index';
import { withMantineProvider } from './decorators';

// highlight.js's whole-registry autodetection is noisy by nature (the option
// is documented as best-effort); this SQL snippet is one it classifies
// stably at the end (`pgsql`) while guessing differently on short prefixes.
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

/** Unlabelled fence, cut at doubling prefixes; the last frame ends the stream. */
const AUTODETECT_FRAMES: Array<{ content: string; streaming: boolean }> = [
  { content: '```\n' + SQL_BODY.slice(0, 40), streaming: true }, // ≥ 32 chars → early guess
  { content: '```\n' + SQL_BODY.slice(0, 80), streaming: true }, // doubled → correction
  { content: '```\n' + SQL_BODY.slice(0, 160), streaming: true }, // doubled again
  { content: '```\n' + SQL_BODY + '\n```\n\nstill typing prose, done.', streaming: false }, // final verdict
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

const AUTODETECT = { autoDetectUnknownLanguage: true, highlightJs: hljs };

export const AutodetectEarlyThenCorrected: Story = {
  render: () => <Harness frames={AUTODETECT_FRAMES} codeBlock={AUTODETECT} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const next = canvas.getByRole('button', { name: 'next frame' });
    const stepIs = (n: number) => waitFor(() => expect(canvas.getByTestId('step').textContent).toBe(String(n)));
    // The tab label is the detected language; "unknown" is the no-language label.
    const label = () =>
      canvasElement.querySelector('.mantine-CodeHighlightTabs-file, [class*="CodeHighlightTabs-file"]')?.textContent ??
      '';
    const anyLabel = () => canvasElement.textContent ?? '';

    // Frame 0 (40 chars): an EARLY guess replaces "unknown" before the stream ends.
    await stepIs(0);
    await waitFor(() => expect(label() || anyLabel()).not.toContain('unknown'), { timeout: 15_000 });
    await waitFor(() => expect(label()).not.toBe(''), { timeout: 15_000 });

    // Final frame: the verdict on the full block.
    await userEvent.click(next);
    await userEvent.click(next);
    await userEvent.click(next);
    await stepIs(3);
    await waitFor(() => expect(label()).toBe('pgsql'), { timeout: 15_000 });
  },
};

const PY_BODY = ['import os', 'import sys', '', 'def main(argv):', '    for path in argv:', '        print(path)'].join(
  '\n'
);
/** A regenerate on the same block: the SQL block is REPLACED by a same-length
 *  Python block while still streaming (same source offset → same PreCode
 *  instance). The old guess must not survive the swap. */
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
    const label = () =>
      canvasElement.querySelector('.mantine-CodeHighlightTabs-file, [class*="CodeHighlightTabs-file"]')?.textContent ??
      '';

    await stepIs(0);
    await waitFor(() => expect(label()).toBe('pgsql'), { timeout: 15_000 });

    // Swap to a different, same-length block: the SQL guess must go away.
    await userEvent.click(next);
    await stepIs(1);
    await waitFor(() => expect(label()).not.toBe('pgsql'), { timeout: 15_000 });

    // Final verdict is for the Python text, whatever hljs calls it — never pgsql.
    await userEvent.click(next);
    await stepIs(2);
    await new Promise((r) => setTimeout(r, 500));
    expect(label()).not.toBe('pgsql');
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

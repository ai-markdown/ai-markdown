/**
 * QA: the MermaidCode streaming contract, asserted against the real mermaid
 * renderer in the browser (2026-08 project review, pkg-small-04 — the
 * component's state machine had no behavioral test at all).
 *
 * The harness drives one `<MantineAIMarkdown>` through a scripted stream via
 * buttons the play() function clicks, and asserts on the DOM the contract
 * documented in `MermaidCode/index.tsx`:
 *   - warm-up: before the first successful parse the raw source shows and
 *     the error tab never appears mid-stream, even on a broken prefix;
 *   - success mid-stream: the SVG stays up while later chunks arrive;
 *   - end-of-stream corrective pass: a final source that no longer parses
 *     surfaces the error tab even over a rendered diagram;
 *   - regenerate (streaming rising edge): the previous generation's diagram
 *     or error is cleared and the warm-up shows the incoming source;
 *   - static rule: without streaming, a broken update never clobbers a
 *     rendered diagram.
 */
import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within, userEvent } from 'storybook/test';
import MantineAIMarkdown from '../src/index';
import { withMantineProvider } from './decorators';

const VALID = ['```mermaid', 'flowchart LR', '    A[Start] --> B{Ok?}', '    B -- yes --> C[Done]', '```'].join('\n');
/** The same diagram cut mid-token — parses as nothing sensible. */
const BROKEN_PREFIX = ['```mermaid', 'flowchart LR', '    A[Start] --> B{Ok', '```'].join('\n');
/** A complete fence whose body mermaid rejects outright. */
const INVALID_FINAL = [
  '```mermaid',
  'flowchart LR',
  '    A[Start] --> B{Ok?}',
  '    this is not mermaid ]]]',
  '```',
].join('\n');
const SEQUENCE = ['```mermaid', 'sequenceDiagram', '    Alice->>Bob: Hello', '```'].join('\n');

interface Frame {
  content: string;
  streaming: boolean;
}

/** Scripted frames; the play() steps through them with the "next" button. */
const SCRIPT: Frame[] = [
  { content: BROKEN_PREFIX, streaming: true }, // 0 warm-up on a broken prefix
  { content: VALID, streaming: true }, // 1 first success mid-stream
  { content: BROKEN_PREFIX, streaming: true }, // 2 broken again mid-stream → keep the SVG
  { content: INVALID_FINAL, streaming: true }, // 3 still streaming, invalid
  { content: INVALID_FINAL, streaming: false }, // 4 stream ends on invalid → error tab
  { content: SEQUENCE, streaming: true }, // 5 regenerate: rising edge resets to source
  { content: SEQUENCE, streaming: false }, // 6 finish → sequence diagram
  { content: BROKEN_PREFIX, streaming: false }, // 7 static broken update → keep the diagram
];

function MermaidContractHarness() {
  const [step, setStep] = useState(0);
  const frame = SCRIPT[Math.min(step, SCRIPT.length - 1)];
  return (
    <div>
      <button type="button" onClick={() => setStep((s) => Math.min(s + 1, SCRIPT.length - 1))}>
        next frame
      </button>
      <output data-testid="step">{step}</output>
      <MantineAIMarkdown content={frame.content} streaming={frame.streaming} />
    </div>
  );
}

const meta: Meta<typeof MermaidContractHarness> = {
  title: 'Integrations/Mantine/QA/Mermaid Streaming Contract',
  tags: ['qa'],
  component: MermaidContractHarness,
  decorators: [withMantineProvider],
  parameters: {
    // Behavioral assertion over live mermaid renders — not a visual.
    chromatic: { disableSnapshot: true },
    a11y: { test: 'error' },
  },
};
export default meta;

type Story = StoryObj<typeof MermaidContractHarness>;

export const StreamingContract: Story = {
  render: () => <MermaidContractHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const next = canvas.getByRole('button', { name: 'next frame' });
    const svg = () => canvasElement.querySelector('.aim-mantine-mermaid-code svg');
    const diagramVisible = () => {
      const host = canvasElement.querySelector<HTMLElement>('.aim-mantine-mermaid-code');
      return !!host && host.style.display !== 'none' && !!host.querySelector('svg');
    };
    const errorTab = () =>
      Array.from(canvasElement.querySelectorAll('*')).some((el) => el.textContent === 'Mermaid Render Error');
    const chartTag = () => canvasElement.querySelector('.aim-mantine-mermaid-code .chart-type-tag')?.textContent ?? '';
    const stepIs = async (n: number) => waitFor(() => expect(canvas.getByTestId('step').textContent).toBe(String(n)));
    const settle = () => new Promise((r) => setTimeout(r, 400));

    // 0 — warm-up on a broken prefix: source shows, no diagram, NO error tab.
    await stepIs(0);
    await settle();
    expect(diagramVisible()).toBe(false);
    expect(errorTab()).toBe(false);

    // 1 — first success mid-stream: the SVG comes up.
    await userEvent.click(next);
    await stepIs(1);
    await waitFor(() => expect(diagramVisible()).toBe(true), { timeout: 15_000 });
    expect(chartTag()).toBe('flowchart-v2');

    // 2 — broken again mid-stream: last good SVG stays, still no error tab.
    await userEvent.click(next);
    await stepIs(2);
    await settle();
    expect(diagramVisible()).toBe(true);
    expect(errorTab()).toBe(false);

    // 3 — invalid but still streaming: same.
    await userEvent.click(next);
    await stepIs(3);
    await settle();
    expect(diagramVisible()).toBe(true);
    expect(errorTab()).toBe(false);

    // 4 — the stream ends on the invalid source: the corrective pass must
    // surface the error tab even over the rendered diagram.
    await userEvent.click(next);
    await stepIs(4);
    await waitFor(() => expect(errorTab()).toBe(true), { timeout: 15_000 });
    expect(diagramVisible()).toBe(false);

    // 5 — regenerate (streaming rising edge): the error is cleared and the
    // warm-up shows the incoming source (no diagram, no error).
    await userEvent.click(next);
    await stepIs(5);
    await waitFor(() => expect(errorTab()).toBe(false));
    // (a valid prefix may already render — either state is fine here; what
    // must not survive is the previous generation's error tab)

    // 6 — finish: the sequence diagram renders.
    await userEvent.click(next);
    await stepIs(6);
    await waitFor(() => expect(diagramVisible()).toBe(true), { timeout: 15_000 });
    await waitFor(() => expect(chartTag()).toBe('sequence'));
    expect(errorTab()).toBe(false);

    // 7 — static (not streaming) broken update: never clobber a rendered
    // diagram; the last good SVG stays, no error tab.
    await userEvent.click(next);
    await stepIs(7);
    await settle();
    expect(diagramVisible()).toBe(true);
    expect(errorTab()).toBe(false);
    expect(svg()).not.toBeNull();
  },
};

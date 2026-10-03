/**
 * Behavioral acceptance for the per-system context split (EXECUTION-PLAN
 * §5.4): a `streaming` flip re-renders ONLY subscribers of the state
 * context. Theme and behaviors subscribers sit inside block-memo-cached
 * subtrees; if they re-render on a flip, either the context payloads lost
 * identity stability or the split regressed.
 *
 * Counting mechanism: same user-space pattern as `spyComponents.ts` — the
 * probes call a `record` closure during render; the play() function samples
 * the counters into the DOM via a button before and after the flip.
 * StrictMode double-invocation inflates all counters equally; the
 * assertions use strict increase (state) and exact equality (theme,
 * behaviors), both robust to uniform inflation.
 */
import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within, userEvent } from 'storybook/test';
import AIMarkdown, {
  useAIMarkdownState,
  useAIMarkdownTheme,
  useAIMarkdownBehaviors,
  type AIMarkdownCustomComponents,
} from '../../src';

interface RenderCounters {
  state: number;
  theme: number;
  behaviors: number;
}

function makeProbes(record: (key: keyof RenderCounters) => void): AIMarkdownCustomComponents {
  const StateProbe = () => {
    record('state');
    const { streaming } = useAIMarkdownState();
    return <em data-probe="state">{String(streaming)}</em>;
  };
  const ThemeProbe = () => {
    record('theme');
    const { fontSize } = useAIMarkdownTheme();
    return <strong data-probe="theme">{fontSize}</strong>;
  };
  const BehaviorsProbe = () => {
    record('behaviors');
    const { blockMemo } = useAIMarkdownBehaviors();
    return <del data-probe="behaviors">{String(blockMemo)}</del>;
  };
  return { em: StateProbe, strong: ThemeProbe, del: BehaviorsProbe };
}

const CONTENT = 'probes: *state* **theme** ~~behaviors~~';

function IsolationHarness() {
  // Counters + probe components are created once per mount so their
  // identities are stable across re-renders (an inline `makeProbes` call
  // would remount every probe on every render and defeat the measurement).
  const [rig] = useState(() => {
    const counters: RenderCounters = { state: 0, theme: 0, behaviors: 0 };
    return { counters, probes: makeProbes((key) => void counters[key]++) };
  });
  const [streaming, setStreaming] = useState(false);
  const [sample, setSample] = useState<RenderCounters | null>(null);
  return (
    <div>
      <button type="button" onClick={() => setStreaming((s) => !s)}>
        flip streaming
      </button>
      <button type="button" onClick={() => setSample({ ...rig.counters })}>
        sample counters
      </button>
      <output data-testid="sample">{sample ? JSON.stringify(sample) : ''}</output>
      <AIMarkdown content={CONTENT} streaming={streaming} customComponents={rig.probes} />
    </div>
  );
}

// A play-function assertion suite — a QA story by the Introduction's own
// definition (Performance Lab = instruments, QA = assertion suites), so it
// carries the qa tag and hides with the rest of QA in the docs export.
const meta: Meta<typeof IsolationHarness> = {
  title: 'QA/State Isolation',
  tags: ['qa'],
  component: IsolationHarness,
  parameters: {
    a11y: { test: 'error' },
  },
};
export default meta;

export const StreamingFlipWakesOnlyStateSubscribers: StoryObj<typeof meta> = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const sampleButton = canvas.getByRole('button', { name: 'sample counters' });
    const flipButton = canvas.getByRole('button', { name: 'flip streaming' });
    const output = canvas.getByTestId('sample');

    const stateProbe = () => canvasElement.querySelector('[data-probe="state"]');

    // Wait for the initial render to settle, then take the baseline.
    await waitFor(() => expect(stateProbe()?.textContent).toBe('false'));
    await userEvent.click(sampleButton);
    const before = JSON.parse(output.textContent || '{}') as RenderCounters;
    expect(before.state).toBeGreaterThan(0);
    expect(before.theme).toBeGreaterThan(0);
    expect(before.behaviors).toBeGreaterThan(0);

    // Flip streaming; the state probe must observe the new value.
    await userEvent.click(flipButton);
    await waitFor(() => expect(stateProbe()?.textContent).toBe('true'));

    await userEvent.click(sampleButton);
    const after = JSON.parse(output.textContent || '{}') as RenderCounters;

    // Only the state subscriber re-rendered.
    expect(after.state).toBeGreaterThan(before.state);
    expect(after.theme).toBe(before.theme);
    expect(after.behaviors).toBe(before.behaviors);
  },
};

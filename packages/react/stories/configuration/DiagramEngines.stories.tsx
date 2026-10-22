import { useMemo } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { AIMarkdown } from '@ai-markdown/react';
import { createMarkdownCodeBlock } from '@ai-markdown/react/components/code';
import { DiagramEnginesDemo, type DiagramDemoState } from '@ai-markdown/storybook-kit/react/diagramEngines';
import type { DiagramDemoEngine, DiagramDemoScenario } from '@ai-markdown/storybook-kit/common/diagramEngines';
import { expect, waitFor, within, userEvent } from 'storybook/test';
import '@ai-markdown/react/components/styles.css';
function Document(state: DiagramDemoState) {
  const pre = useMemo(
    () => createMarkdownCodeBlock({ mermaidEngine: state.engine, mermaidFallback: state.fallback }),
    [state.engine, state.fallback]
  );
  return (
    <AIMarkdown
      key={state.document}
      content={state.content}
      streaming={state.streaming}
      colorScheme={state.colorScheme}
      customComponents={{ pre }}
    />
  );
}
function Demo(props: { initialEngine?: DiagramDemoEngine; scenario?: DiagramDemoScenario }) {
  return <DiagramEnginesDemo {...props} renderDocument={(state) => <Document {...state} />} />;
}
export default { title: 'Customization/Diagram Engines', component: Demo, tags: ['autodocs'] } satisfies Meta<
  typeof Demo
>;
type Story = StoryObj<typeof Demo>;
const rendered: Story['play'] = async ({ canvasElement }) => {
  await waitFor(() => expect(canvasElement.querySelector('.aimd-diagram-viewport svg')).not.toBeNull(), {
    timeout: 20000,
  });
};
export const Mermaid: Story = { args: { initialEngine: 'Mermaid' }, play: rendered };
export const Pele: Story = { args: { initialEngine: 'Pele' }, play: rendered };
export const Ondine: Story = { args: { initialEngine: 'Ondine' }, play: rendered };
export const Streaming: Story = { args: { initialEngine: 'Ondine', scenario: 'streaming' }, play: rendered };
export const FinalError: Story = {
  args: { scenario: 'invalid' },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('[role="alert"]')).not.toBeNull());
  },
};
export const FailureAndRetry: Story = {
  args: { scenario: 'failure' },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('[role="alert"]')).not.toBeNull(), { timeout: 15000 });
    const c = within(canvasElement);
    await userEvent.click(c.getByText('Restore connection, then retry diagram'));
    await userEvent.click(c.getByText('Retry diagram'));
    await rendered!({ canvasElement } as Parameters<NonNullable<Story['play']>>[0]);
  },
};
export const UnsupportedFallback: Story = {
  args: { initialEngine: 'Ondine flowchart only' },
  play: async ({ canvasElement }) => {
    await rendered!({ canvasElement } as Parameters<NonNullable<Story['play']>>[0]);
    await userEvent.selectOptions(within(canvasElement).getByLabelText('Diagram type'), 'sequence');
    await waitFor(
      () => expect(canvasElement.querySelector('.aimd-diagram-viewport svg')?.classList.contains('ondine')).toBe(false),
      { timeout: 20000 }
    );
  },
};
export const Disabled: Story = {
  args: { initialEngine: 'Disabled' },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('.aimd-diagram')).toBeNull();
    await expect(canvasElement.textContent).toContain('A[Source]');
  },
};

export const ThemesAndDocuments: Story = {
  args: { initialEngine: 'Pele' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const engine of ['Pele', 'Ondine']) {
      await userEvent.selectOptions(canvas.getByLabelText('Diagram engine'), engine);
      const prefix = engine.toLowerCase();
      await waitFor(
        () => expect(canvasElement.querySelector('.aimd-diagram-viewport svg')?.classList.contains(prefix)).toBe(true),
        { timeout: 20000 }
      );
      await userEvent.click(canvas.getByText('Toggle theme'));
      await waitFor(() =>
        expect(
          (canvasElement.querySelector('.aimd-diagram-viewport svg') as SVGElement)?.style.getPropertyValue(
            `--${prefix}-bg`
          )
        ).toBe('#242424')
      );
      await userEvent.click(canvas.getByText('New document'));
      await waitFor(() => expect(canvasElement.querySelector('.aimd-diagram-viewport svg')).not.toBeNull());
      await userEvent.click(canvas.getByText('Toggle theme'));
      await waitFor(() =>
        expect(
          (canvasElement.querySelector('.aimd-diagram-viewport svg') as SVGElement)?.style.getPropertyValue(
            `--${prefix}-bg`
          )
        ).toBe('#ffffff')
      );
    }
  },
};

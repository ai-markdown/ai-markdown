import React from 'react';
import { Button } from '@mantine/core';
import MantineAIMarkdown from '../src/index';
import 'katex/dist/katex.min.css';
import { baseMantineMeta, type MantineMeta, type MantineStory } from './_shared/meta';
import { MERMAID_STATIC_DOC } from './_shared/fixtures';
import { StreamingReplay } from '@ai-markdown/storybook-kit/react/streaming';

/**
 * Mermaid diagrams, which the Mantine package renders and core does not.
 */
const meta: MantineMeta = {
  ...baseMantineMeta,
  title: 'Integrations/Mantine/Mermaid Diagrams',
  tags: ['autodocs'],
  component: MantineAIMarkdown,
  parameters: {
    a11y: { test: 'error' },
    docs: {
      description: {
        component: [
          'A fenced block tagged `mermaid` renders as a diagram. The React adapter leaves it as a code',
          'block — diagram rendering pulls in a large dependency, so it lives in the',
          'Mantine package rather than in the base renderer.',
          '',
          'The streaming behavior is the part worth watching. A diagram that is still',
          'being written is, by definition, syntactically invalid most of the time, so the',
          'renderer shows the raw source until a prefix parses, then swaps to the SVG and',
          'refreshes after successful render attempts. Streaming attempts are throttled',
          'by `codeBlock.mermaidIntervalMs` (300 ms by default), with a final attempt',
          'when streaming ends. Incomplete syntax normally keeps the current preview;',
          'oversized input can show an error even while streaming.',
        ].join('\n'),
      },
    },
  },
  render: (args) => <MantineAIMarkdown {...args} />,
};

export default meta;

/**
 * Two finished diagrams, rendered without any streaming involved — a flowchart
 * and a sequence diagram, which take different paths through mermaid and
 * report different chart types.
 *
 * Each rendered diagram carries header controls:
 *
 * - **The chart-type tag** on the left. It is not parsed out of the source by
 *   this package; it is whatever `mermaid.render()` reported as the diagram
 *   type, so it is the renderer's own account of what it just drew.
 * - **A source toggle.** It swaps the SVG for the mermaid source as a code
 *   block, with a control to swap back. The SVG stays mounted underneath —
 *   hidden, not unmounted — which is what lets the toggle return instantly and
 *   what keeps the render target alive for later updates.
 * - **A copy button**, which copies the mermaid source rather than the SVG.
 *
 * The header’s open action opens the SVG in a new browser tab, with a
 * background colour matched to the current scheme so a dark-theme diagram is
 * not white-on-white. Enter and Space do the same thing from the keyboard.
 *
 * **The diagrams follow the theme.** Flip the toolbar to dark and they are
 * re-rendered by mermaid with its dark palette — new SVG markup, not a CSS
 * filter over the old one. That is why the switch is not instantaneous: it is
 * a full re-render per diagram, and mermaid's config is a module-level
 * singleton, so the theme is re-asserted before each render attempt.
 */
export const FlowchartAndSequence: MantineStory = {
  args: {
    content: MERMAID_STATIC_DOC,
    streaming: false,
  },
};

/**
 * Streaming demo focused on the Mantine-specific renderers — mermaid diagrams
 * and highlighted code — arriving token by token.
 *
 * What to watch while it streams:
 * - Mermaid blocks show their raw source (plain code block) until the first
 *   render succeeds, then switch to the live SVG. Further attempts are throttled
 *   (300 ms by default), with a final attempt when streaming ends. Ordinary
 *   parse failures during streaming are suppressed; size-limit errors can
 *   appear before the stream ends.
 * - Code blocks re-highlight as lines arrive.
 *
 * Edit `content` in the Controls panel to stream your own markdown.
 */
export const Streaming: MantineStory = {
  args: {
    content: [
      '# Diagrams arriving a token at a time',
      '',
      'The flowchart below takes shape as the stream lands: raw source first, then a',
      'diagram once rendering succeeds, with later attempts throttled while streaming.',
      '',
      '```mermaid',
      'flowchart LR',
      '    A[Question] --> B{Needs a tool?}',
      '    B -- yes --> C[Call the tool]',
      '    B -- no --> D[Answer directly]',
      '    C --> E[Merge results]',
      '    D --> E',
      '    E --> F[Reply]',
      '```',
      '',
      'An ordinary paragraph sits between the two diagrams, to show that the blocks',
      'around a diagram keep rendering normally while it streams: **bold text**,',
      '`inline code`, and an inline formula $E = mc^2$.',
      '',
      '```python',
      'def fibonacci(n: int) -> int:',
      '    a, b = 0, 1',
      '    for _ in range(n):',
      '        a, b = b, a + b',
      '    return a',
      '```',
      '',
      '## Second diagram: a sequence',
      '',
      '```mermaid',
      'sequenceDiagram',
      '    participant U as User',
      '    participant A as Assistant',
      '    participant T as Tool',
      '    U->>A: Ask a question',
      '    A->>T: Run a search',
      '    T-->>A: Return results',
      '    A-->>U: Stream the answer',
      '```',
      '',
      '| Stage | What is on screen |',
      '| ----- | ----------------- |',
      '| Before the first parseable prefix | the mermaid source, as a code block |',
      '| Mid-stream | the most recent diagram that rendered |',
      '| After the stream ends | the corrective render of the final source |',
      '',
      'Once the stream finishes, every diagram should settle on its final shape.',
      '',
    ].join('\n'),
    fontSize: '',
  },
  argTypes: {
    streaming: { table: { disable: true } },
  },
  parameters: {
    a11y: { test: 'error' },
  },
  render: (args) => (
    <StreamingReplay
      text={args.content ?? ''}
      renderButton={(streaming, restart) => (
        <Button size="xs" color="blue.8" variant={streaming ? 'default' : 'filled'} onClick={restart} mb={12}>
          {streaming ? 'Streaming…' : 'Restart'}
        </Button>
      )}
    >
      {(content, streaming) => <MantineAIMarkdown {...args} content={content} streaming={streaming} />}
    </StreamingReplay>
  ),
};

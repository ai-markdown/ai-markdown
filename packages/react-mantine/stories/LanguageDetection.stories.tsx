import React, { useMemo, useState } from 'react';
import { Badge, Code, Group, SegmentedControl, Stack, Table, Text, TextInput, Textarea } from '@mantine/core';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import {
  detectLanguage,
  normalizeCodeLanguage,
  normalizeHighlightJsLanguage,
  normalizeShikiLanguage,
  toHighlightJsLanguage,
  toShikiLanguage,
} from '@ai-markdown/code-language-detector';
import MantineAIMarkdown from '../src/index';
import { baseMantineMeta, type MantineMeta, type MantineStory } from './_shared/meta';

const DETECTOR_DOCS_URL = 'https://ai-markdown.github.io/docs/plugins/code-language-detector/';

/**
 * `@ai-markdown/code-language-detector` on its own, and what the Mantine code
 * block does with its verdict.
 */
const meta: MantineMeta = {
  ...baseMantineMeta,
  title: 'Integrations/Mantine/Language Detection',
  tags: ['autodocs'],
  component: MantineAIMarkdown,
  parameters: {
    a11y: { test: 'error' },
    controls: { disable: true },
    docs: {
      description: {
        component: [
          '`@ai-markdown/code-language-detector` names the language of a code block that',
          'arrived without an info string. It is a set of about 315 weighted regex rules',
          'over 42 languages: synchronous, dependency-free, and cheap enough to run during',
          'render.',
          '',
          'It is built to **abstain rather than guess**. A language is only named at',
          'confidence 0.8 or above; below that the result is `language: null` with a short',
          'candidate list, and the block stays plain text. A wrong label colours code as',
          'something it is not, which reads worse than no colour at all.',
          '',
          'The Mantine package runs it for fences with no info string unless',
          '`codeBlock.autoDetectUnknownLanguage` is `false` (it is on by default), and uses its',
          'name normalizers for every fence, labelled or not, to translate the name into',
          "the highlighter's spelling.",
          '',
          '```tsx',
          '<MantineAIMarkdown content={md} /> // detection is on by default',
          'const NO_DETECTION = { autoDetectUnknownLanguage: false }; // module constant',
          '<MantineAIMarkdown content={md} codeBlock={NO_DETECTION} />',
          '```',
          '',
          `See the [code-language-detector documentation](${DETECTOR_DOCS_URL}) for the full API,`,
          'the streaming detector, and how the rules are scored.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

// ---------------------------------------------------------------------------
// Playground
// ---------------------------------------------------------------------------

const PRESETS = {
  python: {
    label: 'Python',
    code: `from dataclasses import dataclass


@dataclass
class Reading:
    sensor: str
    celsius: float


def warmest(readings: list[Reading]) -> Reading | None:
    """Return the warmest reading, or None for an empty list."""
    if not readings:
        return None
    return max(readings, key=lambda r: r.celsius)
`,
  },
  tsx: {
    label: 'TSX',
    code: `import { useState } from 'react';

type Props = { label: string; step?: number };

export function Counter({ label, step = 1 }: Props) {
  const [count, setCount] = useState<number>(0);
  return (
    <div className="counter">
      <span>{label}</span>
      <button onClick={() => setCount((n) => n + step)}>{count}</button>
    </div>
  );
}
`,
  },
  rust: {
    label: 'Rust',
    code: `use std::collections::HashMap;

fn word_counts(text: &str) -> HashMap<&str, usize> {
    let mut counts = HashMap::new();
    for word in text.split_whitespace() {
        *counts.entry(word).or_insert(0) += 1;
    }
    counts
}
`,
  },
  sql: {
    label: 'SQL',
    code: `SELECT c.name, COUNT(o.id) AS order_count
FROM customers AS c
LEFT JOIN orders AS o ON o.customer_id = c.id
WHERE c.created_at >= '2026-01-01'
GROUP BY c.name
HAVING COUNT(o.id) > 3
ORDER BY order_count DESC;
`,
  },
  yaml: {
    label: 'YAML',
    code: `name: nightly-report
on:
  schedule:
    - cron: '0 3 * * *'
jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build the report
        run: make report
`,
  },
  vue: {
    label: 'Vue SFC',
    code: `<template>
  <ul class="todo-list">
    <li v-for="item in items" :key="item.id">{{ item.title }}</li>
  </ul>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const items = ref([{ id: 1, title: 'Water the plants' }]);
</script>

<style scoped>
.todo-list {
  padding-left: 1rem;
}
</style>
`,
  },
  ambiguous: {
    label: 'Ambiguous',
    code: `x = 1
`,
  },
} as const;

type PresetId = keyof typeof PRESETS;

const PRESET_OPTIONS = (Object.keys(PRESETS) as PresetId[]).map((value) => ({ value, label: PRESETS[value].label }));

/** Module constant: the group is compared by value. */
const AUTODETECT = { autoDetectUnknownLanguage: true };

/** A fence one backtick longer than any run inside the text, so edited text cannot close it early. */
const wrapInUnlabelledFence = (text: string) => {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}\n${text.replace(/\n$/, '')}\n${fence}\n`;
};

const ValueRow = ({ name, children }: { name: string; children: React.ReactNode }) => (
  <Table.Tr>
    <Table.Th scope="row" w={180}>
      {name}
    </Table.Th>
    <Table.Td>{children}</Table.Td>
  </Table.Tr>
);

const PlaygroundDemo = () => {
  const [preset, setPreset] = useState<PresetId>('python');
  const [text, setText] = useState<string>(PRESETS.python.code);
  const result = useMemo(() => detectLanguage(text), [text]);
  const content = useMemo(() => wrapInUnlabelledFence(text), [text]);

  const selectPreset = (value: string) => {
    const id = value as PresetId;
    setPreset(id);
    setText(PRESETS[id].code);
  };

  return (
    <Stack gap="md">
      <SegmentedControl aria-label="Sample" data={PRESET_OPTIONS} value={preset} onChange={selectPreset} />
      <Textarea
        label="Code to detect"
        value={text}
        onChange={(event) => setText(event.currentTarget.value)}
        autosize
        minRows={6}
        maxRows={18}
        spellCheck={false}
        styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
      />

      <Text size="sm" fw={600}>
        <Code>detectLanguage(text)</Code>, recomputed on every edit
      </Text>
      <Table withTableBorder variant="vertical" layout="fixed">
        <Table.Tbody>
          <ValueRow name="language">
            {result.language ? (
              <Badge color="dark" tt="none" data-testid="verdict">
                {result.language}
              </Badge>
            ) : (
              <Text size="sm" data-testid="verdict">
                no verdict
              </Text>
            )}
          </ValueRow>
          <ValueRow name="confidence">
            <Code data-testid="confidence">{result.confidence.toFixed(2)}</Code>
          </ValueRow>
          <ValueRow name="candidates">
            {result.candidates.length ? (
              <Group gap={6}>
                {result.candidates.map((candidate) => (
                  <Badge key={candidate} variant="default" tt="none">
                    {candidate}
                  </Badge>
                ))}
              </Group>
            ) : (
              <Text size="sm">none</Text>
            )}
          </ValueRow>
          <ValueRow name="evidence">
            {result.evidence.length ? (
              <Group gap={6}>
                {result.evidence.map((rule) => (
                  <Code key={rule}>{rule}</Code>
                ))}
              </Group>
            ) : (
              <Text size="sm">none</Text>
            )}
          </ValueRow>
          <ValueRow name="toHighlightJsLanguage">
            <Code data-testid="hljs-name">{result.language ? toHighlightJsLanguage(result.language) : '—'}</Code>
          </ValueRow>
          <ValueRow name="toShikiLanguage">
            <Code data-testid="shiki-name">{result.language ? toShikiLanguage(result.language) : '—'}</Code>
          </ValueRow>
        </Table.Tbody>
      </Table>

      <Text size="sm" fw={600}>
        The same text in an unlabelled fence, rendered with{' '}
        <Code>codeBlock={'{{ autoDetectUnknownLanguage: true }}'}</Code>
      </Text>
      {/*
        Keyed on the text so every edit mounts a fresh block. The code block keeps
        one streaming detector per instance, and that detector deliberately holds
        its verdict when new text only extends the old one — right for a stream,
        but here it would let the tab label drift from the one-shot verdict above.
      */}
      <MantineAIMarkdown key={text} content={content} codeBlock={AUTODETECT} />
    </Stack>
  );
};

/** The tab label is the detected language; a block with no language has no tab strip. */
const tabLabel = (canvasElement: HTMLElement) =>
  canvasElement.querySelector('.mantine-CodeHighlightTabs-file, [class*="CodeHighlightTabs-file"]')?.textContent ?? '';

/**
 * Pick a sample or type your own code, and read what the detector concludes.
 *
 * The table is the raw `detectLanguage` result. `evidence` lists the ids of the
 * rules that touched the winning language, with a leading `-` on
 * counter-evidence; it is there for debugging a misdetection, not for
 * branching on.
 *
 * Below it, the same text goes through `<MantineAIMarkdown>` as a fence with no
 * info string. The tab label is the detector's own name for the language, and
 * the highlighter receives the converted name: the TSX sample is labelled `tsx`
 * and highlighted as `typescript`, the Vue component is labelled `vue` and
 * highlighted as `xml`. highlight.js knows TSX only as an alias of TypeScript
 * and has no Vue grammar at all; `xml` highlights the template and hands the
 * `<script>` and `<style>` blocks to their own grammars.
 *
 * The **Ambiguous** sample, `x = 1`, is valid in half a dozen languages. The
 * detector returns no verdict, and the block renders as plain text with no tab
 * strip.
 */
export const Playground: MantineStory = {
  parameters: {
    // Trialled at 'error' and reverted: `color-contrast`, and only on the
    // highlight.js token spans inside the rendered code block. The
    // `atom-one-light` theme this Storybook registers puts several token
    // colours below 4.5:1 against the block's #f8f9fa background — measured
    // here at 3.47:1 for tag names (#e45649) and 3.04:1 for strings and
    // attributes (#50a14f). That is the third-party palette the Code Blocks
    // story documents; a story whose point is a highlighted detected block
    // cannot render its way out of it. The rest of this story passes at
    // 'error', and Fence Name Mapping stays there.
    a11y: { test: 'todo' },
  },
  render: () => <PlaygroundDemo />,
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('the default Python sample is detected and labelled', async () => {
      expect(canvas.getByTestId('verdict').textContent).toBe('python');
      await waitFor(() => expect(tabLabel(canvasElement)).toBe('python'));
    });

    await step('the ambiguous sample abstains and renders without a tab strip', async () => {
      await userEvent.click(canvas.getByRole('radio', { name: 'Ambiguous' }));
      await waitFor(() => expect(canvas.getByTestId('verdict').textContent).toBe('no verdict'));
      expect(canvas.getByTestId('hljs-name').textContent).toBe('—');
      await waitFor(() => expect(tabLabel(canvasElement)).toBe(''));
    });

    await step('the TSX sample is labelled tsx and highlighted as typescript', async () => {
      await userEvent.click(canvas.getByRole('radio', { name: 'TSX' }));
      await waitFor(() => expect(canvas.getByTestId('verdict').textContent).toBe('tsx'));
      expect(canvas.getByTestId('hljs-name').textContent).toBe('typescript');
      await waitFor(() => expect(tabLabel(canvasElement)).toBe('tsx'));
    });

    await step('the Vue sample is labelled vue and highlighted as xml', async () => {
      await userEvent.click(canvas.getByRole('radio', { name: 'Vue SFC' }));
      await waitFor(() => expect(canvas.getByTestId('verdict').textContent).toBe('vue'));
      expect(canvas.getByTestId('hljs-name').textContent).toBe('xml');
      expect(canvas.getByTestId('shiki-name').textContent).toBe('vue');
      await waitFor(() => expect(tabLabel(canvasElement)).toBe('vue'));
    });
  },
};

// ---------------------------------------------------------------------------
// Fence name mapping
// ---------------------------------------------------------------------------

const FENCE_NAMES = [
  'py',
  'JS',
  'objc',
  'c++',
  'txt',
  'console',
  'Makefile',
  'bat',
  'viml',
  'jinja2',
  'haskell',
  'jsonc',
  'vue',
  'zig',
] as const;

const Mapped = ({ value, testId }: { value: string | null; testId?: string }) => (
  <Code data-testid={testId}>{value === null ? 'null' : value}</Code>
);

const MappingRow = ({ name, testIdPrefix }: { name: string; testIdPrefix?: string }) => (
  <Table.Tr>
    <Table.Th scope="row">
      <Code>{name === '' ? '(empty)' : name}</Code>
    </Table.Th>
    <Table.Td>
      <Mapped value={normalizeCodeLanguage(name)} testId={testIdPrefix && `${testIdPrefix}-code`} />
    </Table.Td>
    <Table.Td>
      <Mapped value={normalizeHighlightJsLanguage(name)} testId={testIdPrefix && `${testIdPrefix}-hljs`} />
    </Table.Td>
    <Table.Td>
      <Mapped value={normalizeShikiLanguage(name)} testId={testIdPrefix && `${testIdPrefix}-shiki`} />
    </Table.Td>
  </Table.Tr>
);

const MappingHead = () => (
  <Table.Thead>
    <Table.Tr>
      <Table.Th scope="col">Fence name</Table.Th>
      <Table.Th scope="col">normalizeCodeLanguage</Table.Th>
      <Table.Th scope="col">normalizeHighlightJsLanguage</Table.Th>
      <Table.Th scope="col">normalizeShikiLanguage</Table.Th>
    </Table.Tr>
  </Table.Thead>
);

const FenceNameMappingDemo = () => {
  const [name, setName] = useState('Objective-C++');

  return (
    <Stack gap="md">
      <Text size="sm">
        <Code>normalizeCodeLanguage</Code> returns <Code>null</Code> when a name is not one of the 42 languages the
        detector knows. The two highlighter functions always return a string: a name neither of their tables knows is
        passed through lower-cased, because the highlighter may well have a grammar for it.
      </Text>

      <Text size="sm" fw={600}>
        Names models commonly write on fences
      </Text>
      <Table.ScrollContainer minWidth={560}>
        <Table withTableBorder striped>
          <MappingHead />
          <Table.Tbody>
            {FENCE_NAMES.map((fenceName) => (
              <MappingRow key={fenceName} name={fenceName} testIdPrefix={`row-${fenceName}`} />
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <TextInput
        label="Try a fence name"
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
        spellCheck={false}
        maw={320}
      />
      <Table.ScrollContainer minWidth={560}>
        <Table withTableBorder>
          <MappingHead />
          <Table.Tbody>
            <MappingRow name={name} testIdPrefix="custom" />
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
};

/**
 * The names models actually write on fences, run through the three name
 * functions.
 *
 * `normalizeCodeLanguage` answers "which of the 42 languages is this?", so
 * `haskell` and `console` come back `null`: the first is outside the set, and
 * the second is a shell session rather than a script. The highlighter functions
 * answer "what does this highlighter call it?", which is why the same
 * `console` becomes `shell` for highlight.js and `shellsession` for Shiki, and
 * why `haskell` and `jsonc` pass straight through.
 *
 * The Mantine code block runs every fence name through one of the two
 * highlighter functions, chosen by `codeBlock.languageFormat`, before handing
 * it to the highlighter.
 */
export const FenceNameMapping: MantineStory = {
  render: () => <FenceNameMappingDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    expect(canvas.getByTestId('row-objc-code').textContent).toBe('objective-c');
    expect(canvas.getByTestId('row-objc-hljs').textContent).toBe('objectivec');
    expect(canvas.getByTestId('row-objc-shiki').textContent).toBe('objective-c');
    expect(canvas.getByTestId('row-haskell-code').textContent).toBe('null');
    expect(canvas.getByTestId('row-haskell-hljs').textContent).toBe('haskell');

    const input = canvas.getByLabelText('Try a fence name');
    await userEvent.clear(input);
    await userEvent.type(input, 'Makefile');
    await waitFor(() => expect(canvas.getByTestId('custom-hljs').textContent).toBe('makefile'));
    expect(canvas.getByTestId('custom-shiki').textContent).toBe('make');
    expect(canvas.getByTestId('custom-code').textContent).toBe('null');
  },
};

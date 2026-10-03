/**
 * The measurement bench behind `apps/docs/content/guides/benchmark.md`: same content, same
 * scenario, two render paths, one A/B per story. Every number the benchmark
 * document quotes is reproducible from this file — the export names are the
 * document's vocabulary, so they outlive any retitling.
 */

import React from 'react';
import type { StoryObj } from '@storybook/react-vite';
import AIMarkdown from '../../src/index';
import 'katex/dist/katex.min.css';
import '../../src/components/typography/variants/all.scss';
import { WithScheme } from '@ai-markdown/storybook-kit/react/colorScheme';
import type { ReactMeta } from '../_shared/meta';
import { reactArgTypes } from '@ai-markdown/storybook-kit/react/argTypes';
import { StreamingPlayground } from '../streaming/StreamingPlayground';
import { BlockMemoComparison } from '../streaming/BlockMemoComparison';
import { IncrementalParseComparison } from '../streaming/IncrementalParseComparison';
import { CrossChunkIncrementalComparison } from '../streaming/CrossChunkIncrementalComparison';
import { IsolatedComparison } from '../streaming/IsolatedComparison';
import { IsolatedSide } from '../streaming/IsolatedSide';
import { DEFAULT_PAYLOAD } from '../streaming/scenarios';

const meta: ReactMeta = {
  title: 'Performance Lab/Streaming Comparisons',
  component: AIMarkdown,
  parameters: {
    a11y: { test: 'error' },
  },
  argTypes: {
    ...reactArgTypes,
    variant: { control: 'select', options: ['default'], description: 'Typography variant name.' },
  },
  render: (args) => <WithScheme>{(colorScheme) => <AIMarkdown {...args} colorScheme={colorScheme} />}</WithScheme>,
};

export default meta;
type Story = StoryObj<typeof AIMarkdown>;

/** Shared scaffolding for the streaming comparison stories (eight use it) — args/argTypes/
 *  parameters are identical by design (review finding S5); each story only
 *  contributes its render. */
const comparisonStoryBase = {
  args: {
    content: DEFAULT_PAYLOAD,
  },
  argTypes: {
    content: {
      control: 'text',
      description: 'Markdown payload streamed by every scenario. Edit to test your own content.',
    },
    streaming: { table: { disable: true } },
  },
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Partial<Story>;

export const StreamingStress: Story = {
  args: {
    content:
      '# Markdown 脚注功能测试文档\n\n这是一个用于验证编辑器是否支持脚注（Footnotes）语法的测试文档。\n\n## 一、 基础引用\n这里是一个简单的脚注引用[^1]。\n这里是一个使用文本作为标识符的脚注引用[^ref]。\n\n## 二、 连续引用与重复引用\n脚注标识符不一定要按数字顺序排列，渲染时通常会自动重新编号。\n这是第三个脚注[^3]。\n我们可以再次引用第一个脚注[^1]，大多数渲染器会正确指向同一个注释。\n\n## 三、 多行与复杂内容\n脚注内可以包含多段文字或代码块[^complex]。\n\n## 四、 列表中的应用\n* 列表项一 [^item-1]\n* 列表项二 [^item-2]\n\n---\n\n## 脚注定义区\n(通常建议放在文档末尾，但其实写在文档任何位置都可以)\n\n[^1]: 这是第一个脚注的简单描述。\n[^ref]: 脚注标识符可以使用字母或单词，但在预览中通常会被转换成数字。\n[^3]: 乱序编写的脚注定义。\n\n[^complex]: 这是复杂脚注的第一段。\n\n    这是复杂脚注的第二段，通过缩进（4个空格或1个制表符）来包含在同一个脚注中。\n    \n    ```python\n    def hello():\n        print("Hello from a footnote!")\n    ```\n\n[^item-1]: 关于列表项一的补充说明。\n[^item-2]: 关于列表项二的补充说明。',
  },
  argTypes: {
    content: {
      control: 'text',
      description: 'Markdown payload streamed by every scenario. Edit to test your own content.',
    },
    streaming: { table: { disable: true } },
  },
  render: (args, context) => (
    <WithScheme>
      {(colorScheme) => (
        <StreamingPlayground
          colorScheme={colorScheme}
          showProfiler={false}
          initialScenario="randomTokens"
          payload={args.content ?? DEFAULT_PAYLOAD}
          autoStart={context.globals.autoStart !== 'off'}
        />
      )}
    </WithScheme>
  ),
};

export const StreamingProfiler: Story = {
  ...comparisonStoryBase,
  render: (args, context) => (
    <WithScheme>
      {(colorScheme) => (
        <StreamingPlayground
          colorScheme={colorScheme}
          showProfiler
          initialScenario="ultraFast"
          payload={args.content ?? DEFAULT_PAYLOAD}
          autoStart={context.globals.autoStart !== 'off'}
        />
      )}
    </WithScheme>
  ),
};

/**
 * Side-by-side comparison of the same content streamed through both render
 * paths simultaneously. Left column has `blockMemo: true` (default);
 * right column has it explicitly disabled. Each column has its own
 * `<React.Profiler>` boundary measuring commit cost in isolation, plus a
 * summary banner that reports the cumulative commit-time savings.
 *
 * The realistic-LLM scenario (`randomTokens`, 2-8 char chunks every 15-60ms)
 * is the most representative of real chat-UI rendering pressure.
 */
export const BlockMemoCompare: Story = {
  ...comparisonStoryBase,
  render: (args, context) => (
    <WithScheme>
      {(colorScheme) => (
        <BlockMemoComparison
          colorScheme={colorScheme}
          initialScenario="randomTokens"
          payload={args.content ?? DEFAULT_PAYLOAD}
          autoStart={context.globals.autoStart !== 'off'}
        />
      )}
    </WithScheme>
  ),
};

/**
 * A/B for `incrementalParse` — BOTH columns run block-memo; the only
 * difference is the incremental-parse flag. The attribution-clean signal is
 * the per-side scan/parse/transform stage table (instance-scoped via the
 * stage channel's documentId): with the flag on, parse should drop to the
 * tail's share on append-heavy scenarios. A built-in verifier deep-compares
 * the two columns' live DOM every streamed frame — the mismatch counter
 * staying 0 is the splice-equivalence contract observed end-to-end. Flip
 * `defs` ON to watch the footnote fallback disengage the feature honestly.
 */
export const IncrementalParseCompare: Story = {
  ...comparisonStoryBase,
  render: (args, context) => (
    <WithScheme>
      {(colorScheme) => (
        <IncrementalParseComparison
          colorScheme={colorScheme}
          initialScenario="randomTokens"
          payload={args.content ?? DEFAULT_PAYLOAD}
          autoStart={context.globals.autoStart !== 'off'}
        />
      )}
    </WithScheme>
  ),
};

/**
 * Cross-chunk (coordinated) A/B for `incrementalParse` — each side is
 * an `<AIMarkdownDocuments>` document rendered as three chunks sharing one
 * documentId, streamed sequentially. Chunks 2/3 reference labels defined in
 * chunk 1, so the flag-on side's parse inputs carry a registry-driven
 * phantom suffix that churns mid-stream — the exact regime v1 excluded.
 * Per-frame DOM equality between the sides (clobber prefixes normalized)
 * must stay at 0 mismatches.
 */
export const CrossChunkIncrementalCompare: Story = {
  ...comparisonStoryBase,
  render: (args, context) => (
    <WithScheme>
      {(colorScheme) => (
        <CrossChunkIncrementalComparison
          colorScheme={colorScheme}
          initialScenario="randomTokens"
          payload={args.content ?? DEFAULT_PAYLOAD}
          autoStart={context.globals.autoStart !== 'off'}
        />
      )}
    </WithScheme>
  ),
};

/**
 * BOOST A/B — everything on vs everything off: (block-memo + incremental
 * parse) against the legacy full pipeline. This is the end-to-end "what do
 * consumers actually gain" comparison; the commit-total delta is the
 * headline (the legacy side emits no stage timings, so per-stage
 * attribution lives in {@link BlockMemoCompare} and
 * {@link IncrementalParseCompare} — use those to see WHERE the win comes
 * from). The per-frame DOM-equality verifier crosses all three output
 * contracts at once: legacy ≡ block-memo ≡ spliced.
 */
export const BoostCompare: Story = {
  ...comparisonStoryBase,
  render: (args, context) => (
    <WithScheme>
      {(colorScheme) => (
        <IncrementalParseComparison
          colorScheme={colorScheme}
          initialScenario="randomTokens"
          payload={args.content ?? DEFAULT_PAYLOAD}
          variant="boost"
          autoStart={context.globals.autoStart !== 'off'}
        />
      )}
    </WithScheme>
  ),
};

/**
 * Process-ISOLATED variant of {@link BoostCompare} — (memo+incremental) vs
 * legacy, each side in its own renderer process. Same loopback requirements
 * and same cross-origin limitation (no DOM-equality verifier) as the other
 * isolated stories.
 */
export const BoostCompareIsolated: Story = {
  ...comparisonStoryBase,
  // Out of the test run, not out of the sidebar. The loopback iframes cannot
  // hand-shake under vitest's browser mode, so the story renders its "not
  // ready" panel and asserts nothing — collecting it buys a slow no-op.
  tags: ['!test'],
  render: (args) => (
    <WithScheme>
      {(colorScheme) => (
        <IsolatedComparison
          colorScheme={colorScheme}
          initialScenario="randomTokens"
          payload={args.content ?? DEFAULT_PAYLOAD}
          axis="boost"
        />
      )}
    </WithScheme>
  ),
};

/**
 * Process-ISOLATED variant of {@link IncrementalParseCompare}: each side runs
 * in its own cross-site iframe (separate renderer processes), so the per-side
 * stage panels are trustworthy without instance scoping and fps / slow frames
 * / long tasks become genuinely per-side. What this variant CANNOT do is the
 * same-page per-frame DOM-equality verification — the frames are cross-origin
 * by design; use {@link IncrementalParseCompare} for that. Same loopback
 * requirements as {@link BlockMemoCompareIsolated}.
 */
export const IncrementalParseCompareIsolated: Story = {
  ...comparisonStoryBase,
  tags: ['!test'],
  render: (args) => (
    <WithScheme>
      {(colorScheme) => (
        <IsolatedComparison
          colorScheme={colorScheme}
          initialScenario="randomTokens"
          payload={args.content ?? DEFAULT_PAYLOAD}
          axis="incrementalParse"
        />
      )}
    </WithScheme>
  ),
};

/**
 * Process-ISOLATED variant of {@link BlockMemoCompare}: each side runs in a
 * cross-site iframe (`localhost` vs `127.0.0.1`), which Chrome's Site
 * Isolation places in separate renderer processes — no shared main thread,
 * GC, or frame loop between the sides, so fps / slow frames / long tasks
 * become genuinely per-side. See IsolatedComparison.tsx for the full
 * tradeoff notes. Keep both stories: same-page = fairest JS-layer A/B;
 * isolated = the only shape that answers per-side browser-level questions.
 */
export const BlockMemoCompareIsolated: Story = {
  ...comparisonStoryBase,
  tags: ['!test'],
  render: (args) => (
    <WithScheme>
      {(colorScheme) => (
        <IsolatedComparison
          colorScheme={colorScheme}
          initialScenario="randomTokens"
          payload={args.content ?? DEFAULT_PAYLOAD}
        />
      )}
    </WithScheme>
  ),
};

/**
 * One SIDE of {@link BlockMemoCompareIsolated} — loaded by that story's
 * iframes with config in the URL (`bmcMode` / `bmcSpy` / `bmcScheme`).
 * Also usable standalone to profile a single render path in isolation.
 */
export const BlockMemoSide: Story = {
  // Not a story anyone browses — it is the iframe PAYLOAD the isolated
  // harness loads by URL. Out of the sidebar and out of the test run; the
  // `iframe.html?id=…` entry point is unaffected, and the index still lists
  // it, which is what the host needs.
  tags: ['!dev', '!test'],
  args: {
    content: '',
  },
  parameters: {
    controls: { disable: true },
    layout: 'fullscreen',
  },
  render: () => <IsolatedSide />,
};

import React, { type CSSProperties } from 'react';
import '../../src/components/typography/variants/all.scss';
import AIMarkdown, { defineBehaviors, definePipeline, defineTheme } from '../../src/index';
import { ThemedAIMarkdown } from '../_shared/ThemedAIMarkdown';
import { useStoryColorScheme, PAGE_PALETTE } from '@ai-markdown/storybook-kit/react/colorScheme';
import { baseReactMeta, type ReactMeta, type ReactStory } from '../_shared/meta';
import { docsLink } from '@ai-markdown/storybook-kit/common/docsLinks';
import { PROSE_SAMPLE } from '@ai-markdown/storybook-kit/common/fixtures';
import { getStreamingTheme } from '@ai-markdown/storybook-kit/react/theme';

/**
 * Packaging integration-time configuration into frozen, reusable fragments.
 */
const meta: ReactMeta = {
  ...baseReactMeta,
  title: 'Customization/Extending/Define Factories',
  tags: ['autodocs'],
  component: AIMarkdown,
  parameters: {
    a11y: { test: 'error' },
    controls: { include: ['content'] },
    docs: {
      description: {
        component: [
          'Most applications decide their markdown configuration once and then pass the',
          'same values at every call site. `defineTheme`, `defineBehaviors`, and',
          '`definePipeline` are the packaging unit for that: each takes a fragment of the',
          'prop surface and returns it frozen, typed, and reference-stable.',
          '',
          '```tsx',
          "const THEME = defineTheme({ fontSize: 15, variant: 'default' });",
          'const BEHAVIORS = defineBehaviors({ blockMemo: true });',
          'const PIPELINE = definePipeline({ contentPreprocessors: [redact] });',
          '',
          '// Runtime-varying props go AFTER the spreads — later props win.',
          '<AIMarkdown content={md} {...THEME} {...BEHAVIORS} {...PIPELINE} colorScheme={scheme} />',
          '```',
          '',
          '### What they are not',
          '',
          'Each factory is **identity, types, and `Object.freeze`** — nothing else. No',
          'default-filling or merging. Freezing mutates the supplied object in place. The name says `define` rather than',
          '`create` for that reason: it declares data, it does not manufacture a live',
          'object. Passing the same fields as bare props is always legal and behaves',
          'identically; the factories are sugar.',
          '',
          '### What they buy',
          '',
          '- **Reference stability**, which is the practical reason to use them. Object and',
          '  function identities can invalidate render caches. Hoist constant fragments',
          '  to module scope; calling a factory with a fresh object during every render',
          '  does not memoize it. Deep-equal supported props may retain their identity.',
          '- **Excess-property checking**, which is why they are not generic. Passing',
          '  `blockMemo` to `defineTheme` is a compile error rather than a silently ignored',
          '  key — a generic signature would infer the type from your literal and let it',
          '  through.',
          '- **Freezing**, which turns "somebody mutated the shared config at runtime" into',
          '  a failure in strict mode. The freeze is shallow; nested values remain your responsibility.',
          '',
          'The split into three is the system boundary, not an arbitrary grouping: theme is',
          'presentation, behaviors are engine switches, pipeline is what processes content.',
          'Wrappers widen the factory for their own extension fields —',
          "`defineMantineBehaviors` accepts `codeBlock`, which core's `defineBehaviors`",
          'rejects.',
          '',
          `See ${docsLink('typescript-generics', 'TypeScript & generics')} for how the non-generic`,
          `signatures achieve the excess-property check, and ${docsLink('architecture', 'the architecture overview')}`,
          'for the five-system split the three factories cut along.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/**
 * Module scope, which is the whole point — these three objects are created
 * once for the lifetime of the page.
 */
const THEME = defineTheme({ fontSize: '1rem', variant: 'default', colorScheme: 'light' });
const BEHAVIORS = defineBehaviors({ blockMemo: true, incrementalParse: true });
const PIPELINE = definePipeline({ contentPreprocessors: [] });

const FRAGMENTS: readonly (readonly [string, object])[] = [
  ['defineTheme', THEME],
  ['defineBehaviors', BEHAVIORS],
  ['definePipeline', PIPELINE],
];

/** A live readout: what each fragment holds, and whether it is actually frozen. */
const FragmentTable = () => {
  const scheme = useStoryColorScheme();
  const theme = getStreamingTheme(scheme);
  const cell: CSSProperties = {
    borderBottom: `1px solid ${theme.panelBorder}`,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 12,
    padding: '6px 8px',
    textAlign: 'left',
    verticalAlign: 'top',
  };
  return (
    <table style={{ borderCollapse: 'collapse', color: PAGE_PALETTE[scheme].text, marginTop: 16, width: '100%' }}>
      <thead>
        <tr>
          <th style={{ ...cell, color: theme.textMuted }}>Factory</th>
          <th style={{ ...cell, color: theme.textMuted }}>Value</th>
          <th style={{ ...cell, color: theme.textMuted }}>Object.isFrozen</th>
        </tr>
      </thead>
      <tbody>
        {FRAGMENTS.map(([name, value]) => (
          <tr key={name}>
            <td style={cell}>{name}</td>
            <td style={cell}>{JSON.stringify(value)}</td>
            <td style={cell}>{String(Object.isFrozen(value))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

/**
 * The three fragments spread into one component, with a readout of what they
 * contain and the `Object.isFrozen` verdict on each.
 *
 * The rendered document is unremarkable, and that is the honest result: these
 * factories change nothing about output. Spreading `{...THEME}` produces
 * exactly what writing `fontSize="1rem" variant="default"` would. What changes
 * is that the values now have one identity for the life of the module instead
 * of a new one per render, and that a typo in a field name is caught at the
 * factory call rather than ignored at the prop boundary.
 *
 * The ordering rule is live here, and you can see it work. `THEME` carries
 * `colorScheme: 'light'`, yet flipping the toolbar to dark still darkens this
 * story — because the wrapper applies the toolbar's value *after* the spreads,
 * and later props win. Ordinary JSX precedence, and it is how a
 * runtime-switchable field coexists with an integration-time default: put the
 * default in the factory, and let the live value override it downstream.
 *
 * `Object.isFrozen` reads `true` for all three, so a later
 * `THEME.fontSize = '2rem'` throws in strict mode rather than silently
 * retheming every document in the application.
 */
export const ComposedProps: ReactStory = {
  args: { content: PROSE_SAMPLE },
  render: (args) => (
    <div>
      <ThemedAIMarkdown content={args.content ?? ''} {...THEME} {...BEHAVIORS} {...PIPELINE} />
      <FragmentTable />
    </div>
  ),
};

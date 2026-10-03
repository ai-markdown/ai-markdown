import React, { type CSSProperties, type ReactNode } from 'react';
import '../../src/components/typography/variants/all.scss';
import AIMarkdown, {
  AIMarkdownBehaviorsProvider,
  useAIMarkdown,
  useAIMarkdownBehaviors,
  type AIMarkdownCustomComponents,
} from '../../src/index';
import { ThemedAIMarkdown } from '../_shared/ThemedAIMarkdown';
import { useStoryColorScheme, PAGE_PALETTE } from '@ai-markdown/storybook-kit/react/colorScheme';
import { SideBySide } from '@ai-markdown/storybook-kit/react/layouts';
import { StreamingReplay, ThemedReplayButton } from '@ai-markdown/storybook-kit/react/streaming';
import { baseReactMeta, type ReactMeta, type ReactStory } from '../_shared/meta';
import { docsLink } from '@ai-markdown/storybook-kit/common/docsLinks';
import { getStreamingTheme } from '@ai-markdown/storybook-kit/react/theme';

/**
 * What a custom component can read about the document it is rendering inside.
 */
const meta: ReactMeta = {
  ...baseReactMeta,
  title: 'Customization/Extending/Contexts & Hooks',
  tags: ['autodocs'],
  component: AIMarkdown,
  parameters: {
    a11y: { test: 'error' },
    controls: { include: ['content'] },
    docs: {
      description: {
        component: [
          'A custom component is rendered deep inside the markdown tree, with no prop path',
          'back to the call site. Five contexts close that gap, each with a narrow hook:',
          '',
          '| Hook | Gives you | Changes |',
          '| --- | --- | --- |',
          '| `useAIMarkdownDocument()` | `documentId`, whether it was explicit, the clobber prefix | Effectively never |',
          '| `useAIMarkdownTheme()` | Resolved `fontSize`, `variant`, `colorScheme` | On theme changes |',
          '| `useAIMarkdownState()` | `streaming`, plus any state extension groups | Per message lifecycle |',
          '| `useAIMarkdownBehaviors()` | The three engine switches, plus behavior groups | Effectively never |',
          '| `useAIMarkdownMetadata()` | Whatever you passed as `metadata` | Whenever you change it |',
          '',
          'They are separate contexts on purpose. A component that only needs `streaming`',
          'should not re-render because the metadata object changed, and vice versa.',
          '',
          '`useAIMarkdown()` is the aggregate: it returns all five at once and is the right',
          'choice for teaching, debugging, and low-frequency components. **It subscribes to',
          'all five contexts**, so it re-renders on every `streaming` flip and every',
          'metadata change. In a component rendered once per document that is free; in one',
          'rendered per list item during a stream it is not. Reach for a narrow hook there.',
          '',
          'Document, state, theme and behavior hooks require their provider boundary.',
          '`useAIMarkdownMetadata` instead returns `undefined` when no metadata was provided.',
          'The narrow hooks limit context notifications; ordinary parent renders still apply.',
          '',
          '### Contributing your own groups',
          '',
          '`AIMarkdownBehaviorsProvider` and `AIMarkdownStateProvider` stack **outside**',
          '`<AIMarkdown>` and add named groups to the context a consumer reads. This is how',
          'a wrapper package ships configuration of its own — the Mantine package',
          'contributes `codeBlock` exactly this way — and it works just as well for',
          'application-level groups.',
          '',
          'The core keys are locked: `blockMemo`, `incrementalParse`,',
          '`preserveOrphanReferences`, and `streaming` are type-forbidden in a group value,',
          'and core re-applies its own resolution last so an outer layer cannot win even at',
          'runtime. Nesting merges, and the inner layer wins for a duplicated group name.',
          '',
          `See ${docsLink('extending-via-subpackage', 'extending via a subpackage')} for the full wrapper`,
          `recipe and ${docsLink('metadata-context', 'metadata context')} for the fifth system, which has`,
          'its own stability rules.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

const badgeStyle = (background: string, color: string): CSSProperties => ({
  background,
  borderRadius: 4,
  color,
  display: 'inline-block',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 11,
  marginRight: 6,
  padding: '1px 6px',
});

const Badges = ({ children }: { children: ReactNode }) => <div style={{ marginBottom: 6 }}>{children}</div>;

/**
 * A blockquote that reports what the aggregate hook can see from where it
 * sits. Module scope, because a component identity created during render
 * remounts the whole document on every frame.
 */
const ReportingBlockquote: NonNullable<AIMarkdownCustomComponents['blockquote']> = ({ children }) => {
  const { document, state, theme, behaviors } = useAIMarkdown();
  const scheme = useStoryColorScheme();
  const storyTheme = getStreamingTheme(scheme);
  const badge = badgeStyle(storyTheme.panelBorder, PAGE_PALETTE[scheme].text);
  return (
    <blockquote style={{ borderLeft: `3px solid ${storyTheme.panelBorder}`, margin: 0, paddingLeft: 12 }}>
      <Badges>
        <span style={badge}>streaming: {String(state.streaming)}</span>
        <span style={badge}>colorScheme: {theme.colorScheme}</span>
        <span style={badge}>fontSize: {theme.fontSize}</span>
        <span style={badge}>blockMemo: {String(behaviors.blockMemo)}</span>
        <span style={badge}>documentId explicit: {String(document.documentIdExplicit)}</span>
      </Badges>
      {children}
    </blockquote>
  );
};

const REPORTING_COMPONENTS: AIMarkdownCustomComponents = { blockquote: ReportingBlockquote };

const HOOKS_DOC = [
  '# Reading the render context',
  '',
  'Everything a custom component needs to adapt is available through a hook.',
  '',
  '> This blockquote is a custom component. The badges above its text are read',
  '> live from the aggregate hook — nothing was passed to it as a prop.',
  '',
  'Watch the `streaming` badge while the text is arriving, then again once the',
  'stream ends.',
].join('\n');

/**
 * A custom `blockquote` that reads the render context and shows what it found.
 *
 * Nothing here is passed down as a prop. The component is handed to
 * `customComponents` and rendered by the markdown tree, and everything on those
 * badges — the streaming flag, the resolved font size, whether the document id
 * was explicit — comes from `useAIMarkdown()` at its own position in the tree.
 *
 * Press Restart and watch `streaming` go `true` during the reveal and `false`
 * when it settles. That flag is the reason this whole surface exists: it is how
 * a component knows to hide its copy button, skip an entrance animation, or
 * render a cursor while text is still arriving.
 *
 * `colorScheme` and `fontSize` are **resolved** values, not the raw props. A
 * numeric `fontSize` has already become a `px` string by the time it reaches
 * here, which is what you want when you are about to compute a size from it.
 *
 * This component uses the aggregate hook because it displays all five systems
 * at once — which is exactly the case the aggregate is for. A blockquote that
 * only cared about `streaming` should call `useAIMarkdownState()` and re-render
 * far less often.
 */
export const HooksInCustomComponents: ReactStory = {
  args: { content: HOOKS_DOC },
  parameters: {
    a11y: { test: 'error' },
  },
  render: (args) => (
    <StreamingReplay
      text={args.content ?? ''}
      renderButton={(streaming, restart) => <ThemedReplayButton streaming={streaming} onRestart={restart} />}
    >
      {(content, streaming) => (
        <ThemedAIMarkdown
          content={content}
          streaming={streaming}
          customComponents={REPORTING_COMPONENTS}
          documentId="contexts-and-hooks-demo"
        />
      )}
    </StreamingReplay>
  ),
};

/** The group an application contributes, frozen and defined once. */
const CITATION_GROUP = Object.freeze({ citations: Object.freeze({ style: 'numeric', showSource: true }) });

interface CitationOptions {
  style: string;
  showSource: boolean;
}

/**
 * The single assertion site for this group — the pattern every wrapper follows.
 * `useAIMarkdownBehaviors()` returns an opaque record, so exactly one place
 * narrows it and applies the defaults; read sites call this hook and never
 * re-derive defaults with `??`, which is how two copies of a default start
 * drifting apart.
 */
const useCitationOptions = (): CitationOptions => {
  const behaviors = useAIMarkdownBehaviors();
  const group = behaviors.citations as Partial<CitationOptions> | undefined;
  return { style: 'plain', showSource: false, ...group };
};

const CitationAwareEm: NonNullable<AIMarkdownCustomComponents['em']> = ({ children }) => {
  const { style, showSource } = useCitationOptions();
  const scheme = useStoryColorScheme();
  const storyTheme = getStreamingTheme(scheme);
  return (
    <em>
      {children}
      <span style={{ ...badgeStyle(storyTheme.panelBorder, storyTheme.textMuted), marginLeft: 6, marginRight: 0 }}>
        style={style} · showSource={String(showSource)}
      </span>
    </em>
  );
};

const PROVIDER_COMPONENTS: AIMarkdownCustomComponents = { em: CitationAwareEm };

const PROVIDER_DOC = [
  '# Application-level groups',
  '',
  'Both panels render *this emphasised span* through the same custom component.',
  'Only the configuration above them differs.',
].join('\n');

/**
 * The same custom component under two different provider stacks.
 *
 * **Left: no provider.** `useCitationOptions()` finds no `citations` group and
 * falls back to the defaults it declares — `plain` and `false`.
 *
 * **Right: wrapped in `AIMarkdownBehaviorsProvider`** with a `citations` group.
 * The component reads the contributed values without anyone having threaded a
 * prop through the markdown tree to reach it.
 *
 * That is the whole mechanism a wrapper package uses. `@ai-markdown/react-mantine`
 * contributes its `codeBlock` group this way, from inside its own component, so
 * a consumer sets it with an ordinary prop and the code-block renderer reads it
 * five levels down.
 *
 * Two details that are easy to get wrong. The Provider goes **outside**
 * `<AIMarkdown>`, not inside — core merges the outer context into what it
 * provides downward, so a consumer still sees one context rather than two. And
 * the group value must be reference-stable: `CITATION_GROUP` is frozen at
 * module scope, because an inline object literal would give the context a new
 * identity on every render and re-render every subscriber with it.
 *
 * Core's own keys cannot be contributed this way. `blockMemo`,
 * `incrementalParse`, `preserveOrphanReferences`, and `streaming` are
 * type-forbidden in a group value, and core re-applies its resolution last, so
 * an outer layer that tried would lose at runtime as well as at compile time.
 */
export const AdditiveProviders: ReactStory = {
  args: { content: PROVIDER_DOC },
  render: (args) => (
    <SideBySide
      leftLabel="no provider — the hook's own defaults"
      rightLabel="AIMarkdownBehaviorsProvider value={{ citations }}"
      left={<ThemedAIMarkdown content={args.content ?? ''} customComponents={PROVIDER_COMPONENTS} />}
      right={
        <AIMarkdownBehaviorsProvider value={CITATION_GROUP}>
          <ThemedAIMarkdown content={args.content ?? ''} customComponents={PROVIDER_COMPONENTS} />
        </AIMarkdownBehaviorsProvider>
      }
    />
  ),
};

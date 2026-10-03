/**
 * Main Mantine integration component for AI markdown rendering.
 *
 * Wraps the core {@link AIMarkdown} component with Mantine-specific defaults:
 * - {@link MantineAIMarkdownTypography} as the typography wrapper
 * - {@link MantineAIMDefaultExtraStyles} as the extra styles wrapper
 * - {@link MantineAIMPreCode} as the default `<pre>` component (with syntax
 *   highlighting via Mantine's CodeHighlight and mermaid diagram support)
 * - Automatic color scheme detection from Mantine's provider, with `auto`
 *   resolved against the system preference on the first client frame
 *
 * @module MantineAIMarkdown
 */

import { memo, useMemo } from 'react';
import { AIMarkdown } from '@ai-markdown/react';
import {
  type AIMarkdownProps,
  type AIMarkdownCustomComponents,
  type AIMarkdownBehaviorGroups,
  type AIMarkdownStabilityTable,
  AIMarkdownBehaviorsProvider,
  AIMarkdownStabilityPolicy,
  useStableRecord,
  useStableValue,
} from '@ai-markdown/react';
import MantineAIMarkdownTypography from './components/typography/MantineTypography';
import MantineAIMDefaultExtraStyles from './components/extra-styles/DefaultExtraStyles';
import { MantineAIMarkdownMetadata, MantineCodeBlockOptions } from './defs';
import { MarkdownCodeBlock } from './rich/code';
import { useMantineComputedColorScheme } from './hooks/useMantineComputedColorScheme';

/**
 * Props for the {@link MantineAIMarkdown} component.
 *
 * Extends {@link AIMarkdownProps} with the mantine behavior groups.
 * All core props (`content`, `streaming`, `fontSize`, `enginePlugins`, etc.)
 * are inherited.
 *
 * @typeParam TMetadata - Metadata type, defaults to {@link MantineAIMarkdownMetadata}.
 */
export interface MantineAIMarkdownProps<
  TMetadata extends MantineAIMarkdownMetadata = MantineAIMarkdownMetadata,
> extends AIMarkdownProps<TMetadata> {
  /**
   * Code-block behavior group (Behaviors system). The group value replaces
   * atomically; omitted fields resolve to the shipped defaults inside
   * `useMantineCodeBlockOptions()`. `null` counts as absent. When absent,
   * this wrapper contributes NO `codeBlock` group, so a group provided by
   * an outer app-level `AIMarkdownBehaviorsProvider` passes through; when
   * present, this prop wins over any outer group (inner-wins merge).
   */
  codeBlock?: Partial<MantineCodeBlockOptions>;
}

/**
 * Stable empty CONTRIBUTION for the absent-prop case. Deliberately carries
 * no `codeBlock` key at all: contributing `codeBlock: {}` would shadow a
 * group provided by an outer app-level `AIMarkdownBehaviorsProvider`
 * (inner-wins merge) even though this wrapper has nothing to say — the
 * documented app-level extension path would silently go dead.
 */
const NO_GROUPS: AIMarkdownBehaviorGroups = Object.freeze({});

/**
 * Mantine's stability-firewall table — one row today: `codeBlock` is the
 * only object prop this wrapper TERMINATES (consumes in its own machinery).
 * Forwarded object props ride core's firewall untouched; the merged
 * `customComponents` derived below is caught by core's wall.
 */
const MANTINE_STABILITY_TABLE: AIMarkdownStabilityTable<{
  codeBlock: Partial<MantineCodeBlockOptions> | undefined;
}> = {
  codeBlock: AIMarkdownStabilityPolicy.DEEP_EQUAL,
};

/**
 * Default custom component overrides applied by the Mantine integration.
 *
 * Overrides the `<pre>` element to extract code blocks and render them via
 * {@link MantineAIMPreCode}, which provides syntax highlighting, expand/collapse,
 * and mermaid diagram support. Falls back to a plain `<pre>` when the child
 * is not a recognized code element.
 */
const DefaultCustomComponents: AIMarkdownCustomComponents = {
  pre: MarkdownCodeBlock,
};

/**
 * Inner (non-memoized) implementation of the Mantine AI markdown component.
 *
 * Merges caller-provided `customComponents` with the Mantine defaults (the caller's
 * overrides take precedence). Automatically resolves the color scheme from Mantine's
 * provider (`useMantineComputedColorScheme`) when no explicit `colorScheme` prop is provided.
 *
 * @typeParam TMetadata - Metadata type.
 */
const MantineAIMarkdownComponent = <TMetadata extends MantineAIMarkdownMetadata = MantineAIMarkdownMetadata>({
  Typography = MantineAIMarkdownTypography,
  ExtraStyles = MantineAIMDefaultExtraStyles,
  customComponents,
  colorScheme,
  codeBlock,
  ...props
}: MantineAIMarkdownProps<TMetadata>) => {
  const stableCustomComponents = useStableValue(customComponents);

  const usedComponents = useMemo(() => {
    return stableCustomComponents ? { ...DefaultCustomComponents, ...stableCustomComponents } : DefaultCustomComponents;
  }, [stableCustomComponents]);

  const computedColorScheme = useMantineComputedColorScheme();

  // Mantine's stability firewall: `codeBlock` is terminated here (it feeds
  // the behaviors Provider below, not the core prop surface).
  const stable = useStableRecord({ codeBlock }, MANTINE_STABILITY_TABLE);

  // Contribute the group through the additive behaviors Provider — firewall
  // output used directly, record identity memoized so the context value
  // stays stable across unrelated re-renders. `null`/absent prop ≡ no
  // contribution (NOT an empty group): an outer app-level Provider's
  // `codeBlock` group then stays visible; when the prop IS present the
  // inner-wins merge gives this wrapper's value precedence. The narrow hook
  // fills the defaults for the no-group-anywhere case.
  const behaviorGroups = useMemo<AIMarkdownBehaviorGroups>(
    () => (stable.codeBlock != null ? { codeBlock: stable.codeBlock } : NO_GROUPS),
    [stable.codeBlock]
  );

  return (
    <AIMarkdownBehaviorsProvider value={behaviorGroups}>
      <AIMarkdown<MantineAIMarkdownMetadata>
        Typography={Typography}
        ExtraStyles={ExtraStyles}
        customComponents={usedComponents}
        colorScheme={colorScheme ?? computedColorScheme}
        {...props}
      />
    </AIMarkdownBehaviorsProvider>
  );
};

/**
 * Mantine-integrated AI markdown renderer.
 *
 * A memoized wrapper around the core `<AIMarkdown>` component that provides
 * Mantine-themed typography, code highlighting (via `@mantine/code-highlight`),
 * mermaid diagram rendering, and automatic color scheme detection.
 *
 * This is the default export of `@ai-markdown/react-mantine`.
 *
 * @example
 * ```tsx
 * import MantineAIMarkdown from '@ai-markdown/react-mantine';
 *
 * function Chat({ content }: { content: string }) {
 *   return <MantineAIMarkdown content={content} />;
 * }
 * ```
 */
export const MantineAIMarkdown = memo(MantineAIMarkdownComponent);

MantineAIMarkdown.displayName = 'MantineAIMarkdown';

export default MantineAIMarkdown as typeof MantineAIMarkdownComponent;

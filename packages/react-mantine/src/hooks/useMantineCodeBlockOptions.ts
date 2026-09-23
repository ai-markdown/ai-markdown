/**
 * Narrow hook for the mantine `codeBlock` behavior group.
 *
 * This is THE single type-assertion site for the group (the pattern that
 * retires the public caller-asserted `TConfig` generic): the opaque
 * extension record from `useAIMarkdownBehaviors()` is narrowed here, and
 * group defaults are applied here — read sites must consume this hook and
 * never re-apply defaults with bare `??` (multiple read sites duplicating
 * defaults will drift).
 *
 * @module hooks/useMantineCodeBlockOptions
 */

import { useMemo } from 'react';
import { useAIMarkdownBehaviors } from '@ai-markdown/react';
import { defaultMantineCodeBlockOptions, MantineLanguageFormat, type MantineCodeBlockOptions } from '../defs';

const LANGUAGE_FORMATS = new Set<unknown>(Object.values(MantineLanguageFormat));

/**
 * Read the resolved code-block options from the behaviors context.
 *
 * Group values replace atomically at the transport layer; defaults are
 * filled in here, so a partial group (e.g. `codeBlock={{ defaultExpanded:
 * false }}`) resolves the omitted fields to the shipped defaults.
 *
 * Must be called inside a `<MantineAIMarkdown>` (or any `<AIMarkdown>`
 * wrapped in the mantine Provider stack) — throws outside, same contract
 * as the core narrow hooks.
 */
export function useMantineCodeBlockOptions(
  overrides?: Partial<MantineCodeBlockOptions>
): Required<MantineCodeBlockOptions> {
  const behaviors = useAIMarkdownBehaviors();
  // The single assertion: the `codeBlock` group key is owned by this
  // package, contributed by `MantineAIMarkdown` via its behaviors Provider.
  const group = behaviors.codeBlock as Partial<MantineCodeBlockOptions> | undefined;
  return useMemo(() => {
    // Field-wise `??` rather than a spread: `codeBlock={{ defaultExpanded:
    // undefined }}` type-checks, and a spread would let that explicit
    // undefined punch through the default while the signature promises
    // `Required<…>` (2026-08 project review, pkg-small-12).
    const resolved = { ...defaultMantineCodeBlockOptions } as Required<MantineCodeBlockOptions>;
    for (const key of Object.keys(defaultMantineCodeBlockOptions) as Array<keyof MantineCodeBlockOptions>) {
      const value = overrides?.[key] ?? group?.[key];
      if (value !== undefined) (resolved as Record<string, unknown>)[key] = value;
    }
    if (!Number.isFinite(resolved.highlightIntervalMs) || resolved.highlightIntervalMs < 0) {
      resolved.highlightIntervalMs = defaultMantineCodeBlockOptions.highlightIntervalMs!;
    }
    if (!Number.isFinite(resolved.mermaidIntervalMs) || resolved.mermaidIntervalMs < 0) {
      resolved.mermaidIntervalMs = defaultMantineCodeBlockOptions.mermaidIntervalMs!;
    }
    if (!LANGUAGE_FORMATS.has(resolved.languageFormat)) {
      resolved.languageFormat = defaultMantineCodeBlockOptions.languageFormat!;
    }
    return resolved;
  }, [group, overrides]);
}

/**
 * Type definitions for the sealed engine plugin system (v2 input surface).
 *
 * An "engine plugin" is a first-class, core-exported description of one
 * configurable entry in the unified plugin chain. The five shipped plugins
 * replace the two v1.x enums (`AIMarkdownRenderExtraSyntax` /
 * `AIMarkdownRenderDisplayOptimizeAbility`) as the public way to select
 * optional parse-level capability.
 *
 * ## Why the set is sealed
 *
 * The incremental (prefix-freeze) parse engine's boundary scanner is
 * syntax-aware — it must know the boundary rules of every multiline
 * construct in the chain (see `computeFreezeBoundary`'s `defListEnabled`
 * option). Open plugin injection would void the engine's verification
 * record (50k-sample fuzz, direction batteries, byte equivalence), so
 * plugins are born where the certification rig lives: `packages/react`.
 * Wrappers curate (bundle default sets, filter, facade sugar); consumers
 * select. New parse-level capability lands via an upstream PR into core.
 * Third-party *content* extension stays open through `contentPreprocessors`
 * and `customComponents`.
 *
 * ## Seal mechanics
 *
 * The seal is a type-level contract and design declaration, not runtime
 * tamper-proofing — the same guarantee class as `Object.freeze`. The
 * `'~sealed'` marker key makes accidental construction a type error while
 * keeping the type structural, which is required for the type to remain
 * assignable across the package's two build entries (the root entry and
 * the `/plugins` subpath must stay mutually assignable whether or not the
 * build duplicates this declaration per entry; a `unique symbol` brand
 * would break the duplicated case. Current output happens to declare it
 * once — both React entries re-export it from this package's single
 * declaration file — an implementation detail the seal deliberately does
 * not lean on). A second, runtime gate
 * (`getEnginePluginInternals`, enforced in `sanitizeEnginePlugins`)
 * additionally rejects any object that lacks EITHER the marker or the
 * internal stage metadata, so a type-level forge is dropped at runtime
 * with a dev warning. Deliberately forging both keys voids the engine's
 * verification record.
 *
 * @module plugins/defs
 */

/**
 * Names of the shipped engine plugins. Closed to third-party EXTENSION (see
 * module docs), but an OPEN set across 2.x versions: new plugin names may be
 * added in minor releases. Do not write exhaustive `switch` statements or
 * `Record<AIMarkdownEnginePluginName, …>` maps over this union — both break
 * on the next addition. Feature-test with `Set`/`includes` instead.
 */
export type AIMarkdownEnginePluginName = 'highlight' | 'definitionList' | 'smartypants' | 'pangu' | 'removeComments';

/**
 * A sealed engine plugin. Values are core-exported singletons from
 * `@ai-markdown/react/plugins`; pass them to the `enginePlugins` prop
 * of `<AIMarkdown>`.
 *
 * - Passing an array replaces the default set wholesale (array-atomic
 *   semantics); omitting the prop means `defaultEnginePlugins` (all five).
 * - The produced chain position of each plugin comes from canonical
 *   per-stage tables keyed by name (`pluginChain.ts`) — the order of the
 *   user-supplied array is irrelevant.
 * - Duplicate members are deduplicated with a dev warning.
 * - Serializing plugin objects is unsupported; transport
 *   {@link AIMarkdownEnginePlugin.name} instead and map names back to the
 *   exported singletons at the edge (remote-config scenarios).
 */
export interface AIMarkdownEnginePlugin {
  /** Stable identifier; the serialization escape hatch. */
  readonly name: AIMarkdownEnginePluginName;
  /**
   * @internal Type-level seal — constructible only inside core. Third-party
   * construction (including deliberately forging this marker) voids the
   * incremental engine's verification record.
   */
  readonly '~sealed': 'ai-react-markdown/engine-plugin';
}

/**
 * Chain stage a plugin belongs to. Determines the plugin's splice position
 * in the produced remark chain — user array order never does.
 * @internal
 */
export type EnginePluginStage = 'extraSyntax' | 'displayOptimize';

/**
 * Runtime metadata carried by every sealed plugin object. Not part of the
 * public type — internal consumers read it through
 * {@link getEnginePluginInternals}.
 * @internal
 */
export interface EnginePluginInternals {
  readonly stage: EnginePluginStage;
}

/**
 * Read a sealed plugin's internal metadata. Returns `null` for objects that
 * do not carry it (a forged or foreign object) so callers can reject them
 * defensively instead of crashing.
 * @internal
 */
export function getEnginePluginInternals(plugin: AIMarkdownEnginePlugin): EnginePluginInternals | null {
  const candidate = plugin as unknown as (Partial<EnginePluginInternals> & Partial<AIMarkdownEnginePlugin>) | null;
  // Both keys are required, so the runtime gate matches the type-level seal:
  // an object carrying only the public `'~sealed'` marker (a deliberate
  // forge) or only the internal `stage` (an untyped structural mimic) is
  // rejected either way.
  return candidate != null && candidate['~sealed'] === 'ai-react-markdown/engine-plugin' && candidate.stage != null
    ? (candidate as EnginePluginInternals)
    : null;
}

/** Validate the shipped plugin contract without exposing its stage metadata.
 * This is a configuration guard, not a security credential. Constructing or
 * serializing plugin objects is unsupported; select the exported catalog.
 */
export function isEnginePlugin(value: unknown): value is AIMarkdownEnginePlugin {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AIMarkdownEnginePlugin & EnginePluginInternals>;
  const stages: Record<AIMarkdownEnginePluginName, EnginePluginStage> = {
    highlight: 'extraSyntax',
    definitionList: 'extraSyntax',
    removeComments: 'displayOptimize',
    smartypants: 'displayOptimize',
    pangu: 'displayOptimize',
  };
  return (
    candidate['~sealed'] === 'ai-react-markdown/engine-plugin' &&
    typeof candidate.name === 'string' &&
    Object.hasOwn(stages, candidate.name) &&
    candidate.stage === stages[candidate.name]
  );
}

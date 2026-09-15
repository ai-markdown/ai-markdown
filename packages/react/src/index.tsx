/**
 * @ai-markdown/react
 *
 * A batteries-included React component for rendering AI-generated markdown
 * with first-class support for LaTeX math, GFM, CJK text, syntax highlighting,
 * and streaming content.
 *
 * ## Quick Start
 *
 * ```tsx
 * import AIMarkdown from '@ai-markdown/react';
 * import '@ai-markdown/react/typography/default.css';
 *
 * function App() {
 *   return <AIMarkdown content="Hello **world**!" />;
 * }
 * ```
 *
 * @module @ai-markdown/react
 */

'use client';

import { useMemo, useState, memo, type ComponentType, type CSSProperties } from 'react';
import AIMarkdownProvider, { AIMarkdownMetadataProvider } from './context';
import { AIMDContentPreprocessor } from '@ai-markdown/engine';
import useStableValue from './hooks/useStableValue';
import { preprocessAIMDContent } from '@ai-markdown/engine';
import { createIncrementalLatexPreprocessor } from '@ai-markdown/engine';
import AIMarkdownContent from './components/MarkdownContent';
import {
  AIMarkdownCustomComponents,
  AIMarkdownMetadata,
  AIMarkdownTypographyComponent,
  AIMarkdownExtraStylesComponent,
  AIMarkdownVariant,
  AIMarkdownColorScheme,
} from './defs';
import type { SanitizeSchema } from '@ai-markdown/engine';
import type { UrlTransform } from './components/markdown';
import useStableRecord, { AIMarkdownStabilityPolicy, type AIMarkdownStabilityTable } from './hooks/useStableRecord';
import { resolveEngineValues } from './resolveFlatProps';
import type { AIMarkdownEnginePlugin } from '@ai-markdown/engine';
import DefaultTypography from './components/typography/Default';
import { useDocumentSmoothStream } from './components/smoothStream/useDocumentSmoothStream';
import type { SmoothStreamPacing } from '@ai-markdown/engine';

/**
 * Props for the `<AIMarkdown>` component.
 *
 * @typeParam TMetadata - Custom metadata type (extends {@link AIMarkdownMetadata}).
 */
export interface AIMarkdownProps<TMetadata extends AIMarkdownMetadata = AIMarkdownMetadata> {
  /**
   * Arbitrary consumer data delivered to custom components through the
   * metadata context (`useAIMarkdownMetadata`). Deliberately never
   * stabilized by the library — see the firewall table (`PASS_THROUGH`).
   */
  metadata?: TMetadata;
  /**
   * Whether content is actively being streamed (e.g. token-by-token from an LLM).
   * When `true`, the flag is propagated via context so custom components can adapt
   * their behavior (show cursors, disable copy buttons, skip animations, etc.).
   * Defaults to `false`. `null` (from untyped/serialized callers) counts as absent.
   */
  streaming?: boolean;
  /**
   * Base font size for the rendered output.
   * Accepts a CSS length string (e.g. `'14px'`, `'0.875rem'`) or a number
   * which is treated as pixels. Defaults to `'0.9375rem'`. `null` (from
   * untyped/serialized callers) and `''` count as absent.
   */
  fontSize?: number | string;
  /** Raw markdown content to render. */
  content: string;
  /**
   * Additional preprocessors to run on the raw markdown before rendering.
   * These run *after* the built-in LaTeX preprocessor. The package ships an
   * optional streaming tail-repair factory for this slot —
   * {@link createRemendPreprocessor} (see apps/docs/content/guides/content-preprocessors.md).
   */
  contentPreprocessors?: AIMDContentPreprocessor[];
  /**
   * Custom `react-markdown` component overrides.
   * Use this to replace the default renderers for specific HTML elements
   * (e.g. code blocks, links, images).
   */
  customComponents?: AIMarkdownCustomComponents;
  /**
   * Typography wrapper component. Receives `fontSize`, `variant`, and `colorScheme`.
   * Defaults to the built-in {@link DefaultTypography}; `null` counts as absent.
   *
   * `children` may be a Fragment (the rendered content plus the optional
   * `streamingCursor` slot) — implementations must render `children`
   * verbatim; `Children.only` / `cloneElement`-style handling will break.
   */
  Typography?: AIMarkdownTypographyComponent;
  /**
   * Optional extra style wrapper component rendered between the typography
   * wrapper and the markdown content. Useful for injecting additional
   * CSS scope or theme providers.
   *
   * Same `children` contract as `Typography`: may be a Fragment; render it
   * verbatim.
   */
  ExtraStyles?: AIMarkdownExtraStylesComponent;
  /** Typography variant name. Defaults to `'default'`; `null` counts as absent. */
  variant?: AIMarkdownVariant;
  /** Color scheme name. Defaults to `'light'`; `null` counts as absent. */
  colorScheme?: AIMarkdownColorScheme;
  /**
   * Stable identifier for the *logical markdown document* this `<AIMarkdown>`
   * is rendering. Used as the id namespace for all clobberable attributes
   * (`id`, hash hrefs) so two documents on the same page do not cross-link —
   * e.g. clicking a footnote `[^1]` in message A will not scroll to the
   * `[^1]` definition in message B.
   *
   * Why `documentId` and not `instanceId`: when one logical document is
   * split across multiple `<AIMarkdown>` instances (chunked / streamed
   * rendering), every chunk should share the SAME `documentId` so their
   * id-prefixes line up. The id is per-document, not per-React-instance.
   *
   * When omitted, an id is auto-generated via React's `useId()` (SSR-safe
   * and stable across re-renders). `null` and the empty string `''` both
   * count as omitted — they fall to the auto-generated id AND opt the
   * instance out of cross-chunk coordination (an auto id never opens a
   * registry), so `documentId={maybeEmpty}` silently renders standalone.
   * Pass an explicit value when you need deterministic ids (snapshot
   * tests, cross-component deep links) or when multiple instances render
   * the same logical document.
   *
   * Consumer-supplied values pass through `encodeURIComponent` at the prefix
   * construction site, so any string is safe — including ids with reserved
   * characters like `:`, `/`, or spaces. Even ill-formed UTF-16 (an unpaired
   * surrogate from a string truncated mid-emoji upstream) is accepted: such
   * ids are hashed into the prefix, keeping distinct ids on distinct
   * prefixes (up to the same 2^32 hash bound long ids always had).
   * Dev builds log a warning when this happens, since
   * the corruption usually indicates an upstream bug worth fixing.
   */
  documentId?: string;
  /**
   * This chunk's position in the DOCUMENT, when several `<AIMarkdown>`
   * instances share a `documentId` inside `<AIMarkdownDocuments>`.
   *
   * Cross-chunk state (footnote numbering, which chunk renders the
   * aggregate footer) follows the order chunks register in. Without this
   * prop that is MOUNT order, which is correct as long as chunks mount once
   * in document order — the common case, so the prop is optional and the
   * default behaviour is unchanged.
   *
   * Pass it when chunks can mount out of order or remount: a **virtualized
   * transcript** that unmounts messages scrolled out of view re-registers
   * them at the end when they scroll back, which renumbers footnotes and
   * moves the aggregate footer under whichever chunk registered last. Any
   * stable per-chunk ordinal works (the message's index in your list).
   *
   * Ignored outside `<AIMarkdownDocuments>` (a standalone document is its
   * own chunk 0).
   */
  documentIndex?: number;
  /**
   * Override the per-attribute URL rewriter (Gate 2 of the two-gate model).
   * Runs at render time during the hast traversal in `renderHastSubtree`,
   * after Gate 1 (`rehype-sanitize` schema) has already filtered URLs by
   * protocol allowlist in the rehype plugin chain.
   *
   * The default allowlist mirrors `react-markdown` / GitHub: `http`,
   * `https`, `irc`, `ircs`, `mailto`, `xmpp`. Anything else is rewritten
   * to `''`.
   *
   * **Recommended pattern**: compose with the exported
   * {@link defaultUrlTransform} so the built-in XSS protections survive,
   * and define the result at module scope so its identity is stable across
   * renders:
   *
   * ```ts
   * import AIMarkdown, { defaultUrlTransform } from '@ai-markdown/react';
   *
   * const ALLOWED = /^(myapp|tel):/i;
   * const URL_TRANSFORM = (url, key, node) =>
   *   ALLOWED.test(url) ? url : defaultUrlTransform(url, key, node);
   *
   * function App() {
   *   return <AIMarkdown urlTransform={URL_TRANSFORM} ... />;
   * }
   * ```
   *
   * **Regex-escaping**: scheme names per RFC 3986 may contain `+`, `-`, and
   * `.` (e.g. `web+app`, `coap+tcp`). All three are regex metacharacters,
   * so write `/^web\+app:/i` rather than `/^web+app:/i`. The latter would
   * match URLs starting with `we`, `wee`, `weee`, … and silently broaden
   * the allowlist.
   *
   * **Reference stability matters.** The block-memo cache treats this prop
   * as a dependency. Defining the function inline (`urlTransform={(url) =>
   * …}`) creates a new closure on every parent render, discards the cache
   * for the entire markdown document on each render, and effectively
   * disables block-level memoization. In development the library will
   * `console.warn` if it detects this pattern.
   *
   * Allowing a protocol here is necessary but **not sufficient** to render
   * a link — Gate 1 (`rehype-sanitize` schema) also enforces its own
   * protocol allowlist and runs first. See the `sanitizeSchema` prop on
   * this component and the {@link extendSanitizeSchema} helper for Gate 1.
   *
   * **API stability**: the `UrlTransform` type tracks the upstream
   * `react-markdown` shape and may change with its major versions.
   *
   * `null` is accepted and means the same as omitting the prop: the
   * built-in `defaultUrlTransform` runs. It is not a way to disable the
   * per-attribute pass (see SECURITY.md and the URL sanitization guide);
   * the vendored `Markdown` options type admits `null` for the same reason.
   */
  urlTransform?: UrlTransform | null;
  /**
   * Override the `rehype-sanitize` schema applied to the rendered output.
   * The library default extends `rehype-sanitize`'s own `defaultSchema`
   * with the `<mark>` tag, the `math-inline` / `math-display` className
   * markers `remark-math` emits on `<code>` (KaTeX's own output classes
   * survive separately because `rehype-katex` runs after `rehype-sanitize`),
   * and the cross-chunk coordination tags (`cross-chunk-link`,
   * `cross-chunk-image`, `footnote-sup`). The default is not exported as a
   * value — see {@link extendSanitizeSchema} for how to inspect or extend
   * it safely.
   *
   * **Recommended pattern**: build the schema with {@link extendSanitizeSchema}
   * (mutate-and-return form) so those library additions stay intact, and
   * define the result at module scope:
   *
   * ```ts
   * import AIMarkdown, { extendSanitizeSchema } from '@ai-markdown/react';
   *
   * const SCHEMA = extendSanitizeSchema((s) => {
   *   s.protocols.href.push('myapp');
   *   s.protocols.src.push('myapp');
   * });
   *
   * function App() {
   *   return <AIMarkdown sanitizeSchema={SCHEMA} ... />;
   * }
   * ```
   *
   * **Footgun**: hand-rolling a schema (e.g. spreading from
   * `rehype-sanitize`'s `defaultSchema` directly) silently drops the
   * cross-chunk tag allowlist — coordinated multi-chunk rendering will then
   * lose its placeholders. Prefer the helper unless you have a specific
   * reason to opt out.
   *
   * **Reference stability matters.** An inline call
   * (`sanitizeSchema={extendSanitizeSchema((s) => { … })}`) is mitigated by
   * the stability firewall's `DEEP_EQUAL` policy (`useStableRecord` +
   * `CORE_STABILITY_TABLE`: an equal-but-new object is replaced by the
   * previous reference), but the safer pattern is still module-scope.
   * Development builds will `console.warn` on repeated identity flips.
   *
   * **API stability**: the `SanitizeSchema` type tracks the upstream
   * `rehype-sanitize` shape and may change with its major versions.
   */
  sanitizeSchema?: SanitizeSchema;
  /**
   * Streaming cursor slot. While `streaming === true`, the given component
   * is rendered after the markdown content — inside the typography wrapper
   * and both providers — and unmounted when `streaming` is `false` or the
   * prop is omitted. No props are injected; the slot only controls WHEN and
   * WHERE the component renders.
   *
   * Pass the exported {@link AIMarkdownStreamingCursor} for the built-in
   * inline self-positioning cursor (optionally wrapped at module scope to
   * bind a custom `indicator`):
   *
   * ```tsx
   * import AIMarkdown, { AIMarkdownStreamingCursor } from '@ai-markdown/react';
   *
   * <AIMarkdown content={content} streaming={!done} streamingCursor={AIMarkdownStreamingCursor} />
   * ```
   *
   * **Reference stability matters.** Like `Typography`, this is compared by
   * identity in the memo wrapper — define the component at module scope, not
   * inline.
   */
  streamingCursor?: ComponentType;
  /**
   * Sealed engine plugin selection (v2 input surface; Engine-plugins system).
   * Accepts core-exported sealed plugins only — import them from
   * `@ai-markdown/react/plugins`. Third-party content extension goes
   * through `contentPreprocessors` + `customComponents`.
   *
   * - Absent → `defaultEnginePlugins` (all five, parity with the shipped
   *   config defaults). Passing an array replaces the set wholesale
   *   (array-atomic semantics).
   * - Each plugin's position in the produced chain comes from canonical
   *   per-stage tables keyed by name; the order of this array is
   *   irrelevant. Duplicates are deduplicated with a dev warning.
   * - Turn one off: `enginePlugins={defaultEnginePlugins.filter((p) => p !== pangu)}`.
   *
   * "Explicit" is `v != null` — passing `null` counts as absent (guards
   * serialization boundaries materializing "not passed" as `null`).
   */
  enginePlugins?: readonly AIMarkdownEnginePlugin[];
  /**
   * Behaviors system: block-level memoization. Output-invariant in
   * standalone rendering — flipping it changes no rendered byte (orphan
   * protection included). When `true` (default), the renderer splits the
   * document into per-block units and memoizes each block's subtree by
   * source identity, so unchanged blocks skip render work during streaming.
   * When `false`, the legacy bare flow runs the full pipeline every render.
   * Cross-chunk coordination (`<AIMarkdownDocuments>`) is wired through the
   * block-memo path only — with `false`, refs across chunks do not resolve.
   *
   * `null` counts as absent (falls to the default). @default true
   */
  blockMemo?: boolean;
  /**
   * Behaviors system: incremental (prefix-freeze) parsing for streaming
   * content. Output-invariant (enforced by the splice-equivalence suites).
   * When the content grows by appends, the engine freezes the verified
   * prefix and re-parses only the tail; a per-frame gate chain silently
   * falls back to the full parse whenever splicing is not provably safe.
   * Effective only while `blockMemo` is `true`; SSR always full-parses.
   *
   * `null` counts as absent (falls to the default). @default true
   */
  incrementalParse?: boolean;
  /**
   * Behaviors system: protect orphan reference definitions (footnote/link
   * defs with no matching reference yet) in incomplete/streaming documents.
   * Affects output. Override chain: an `<AIMarkdownDocuments>` wrapper's
   * same-named prop (omission ≡ explicit `true`) unconditionally wins for
   * all chunks under it > this prop > the shipped default.
   *
   * `null` counts as absent (falls to the default). @default true
   */
  preserveOrphanReferences?: boolean;
}

/**
 * The record of object-valued props that crosses the stability firewall.
 * `metadata` is generic at the component level; the firewall treats it as
 * opaque (`PASS_THROUGH`), so the base type is used here.
 */
interface CoreStabilizedProps {
  enginePlugins: readonly AIMarkdownEnginePlugin[] | undefined;
  sanitizeSchema: SanitizeSchema | undefined;
  customComponents: AIMarkdownCustomComponents | undefined;
  contentPreprocessors: AIMDContentPreprocessor[] | undefined;
  urlTransform: UrlTransform | null | undefined;
  Typography: AIMarkdownTypographyComponent;
  ExtraStyles: AIMarkdownExtraStylesComponent | undefined;
  streamingCursor: ComponentType | undefined;
  metadata: AIMarkdownMetadata | undefined;
}

/**
 * The stability firewall's policy table — the complete roster of
 * object-valued props (EXECUTION-PLAN §3.9). `Required<Record<…>>` makes a
 * missing row a compile error, so exemption (`PASS_THROUGH`) and omission
 * are distinguishable. Each prop is stabilized exactly once, here at its
 * terminus; below this wall internal code trusts reference equality
 * outright.
 */
const CORE_STABILITY_TABLE: AIMarkdownStabilityTable<CoreStabilizedProps> = {
  // Elements are module singletons; per-element === short-circuits the deep compare.
  enginePlugins: AIMarkdownStabilityPolicy.DEEP_EQUAL,
  sanitizeSchema: AIMarkdownStabilityPolicy.DEEP_EQUAL,
  customComponents: AIMarkdownStabilityPolicy.DEEP_EQUAL,
  // Function array — deep-comparing closures is meaningless; contract requires stable refs.
  contentPreprocessors: AIMarkdownStabilityPolicy.WARN_ONLY,
  urlTransform: AIMarkdownStabilityPolicy.WARN_ONLY,
  // Component values: carrier-tier enforcement unified here.
  Typography: AIMarkdownStabilityPolicy.WARN_ONLY,
  ExtraStyles: AIMarkdownStabilityPolicy.WARN_ONLY,
  streamingCursor: AIMarkdownStabilityPolicy.WARN_ONLY,
  // Deliberate exemption: opaque shape, potentially huge, unbounded
  // comparison cost — stabilization is the consumer's responsibility.
  metadata: AIMarkdownStabilityPolicy.PASS_THROUGH,
};

/**
 * Root component that preprocesses markdown content and renders it through
 * a configurable remark/rehype pipeline wrapped in typography and style layers.
 */
const AIMarkdownComponent = <TMetadata extends AIMarkdownMetadata = AIMarkdownMetadata>({
  streaming,
  content,
  fontSize,
  contentPreprocessors,
  customComponents,
  metadata,
  Typography,
  ExtraStyles,
  variant,
  colorScheme,
  documentId,
  documentIndex,
  urlTransform,
  sanitizeSchema,
  streamingCursor,
  enginePlugins,
  blockMemo,
  incrementalParse,
  preserveOrphanReferences,
}: AIMarkdownProps<TMetadata>) => {
  // ── Library-wide explicitness guard (EXECUTION-PLAN §3.7) ──
  // "Explicit" is `v != null` for EVERY prop, not just the engine slice:
  // serialization boundaries (RSC, persistence) materialize "not passed" as
  // `null`, and JS destructure defaults only cover `undefined`. `??` (not a
  // destructure default) is therefore the only correct default site. The
  // TS prop types still exclude `null` — this guard is runtime
  // defense-in-depth for untyped/serialized callers.
  const usedStreaming = streaming ?? false;
  const usedVariant = variant ?? 'default';
  const usedColorScheme = colorScheme ?? 'light';
  // Normalize fontSize: number -> px string, null/undefined/'' -> default rem
  // value. Branch on `== null` (not truthiness) so `fontSize={0}` resolves
  // to `'0px'`; `''` is excluded by an explicit check because it is not a CSS
  // length. It would reach the Typography root as an empty
  // `--aim-font-size-root`, i.e. the guaranteed-invalid value, and every
  // variable chained off it — core's `--aim-*` scale and the Mantine
  // wrapper's `--mantine-*` overrides — would collapse to browser defaults.
  const usedFontSize =
    fontSize == null || fontSize === '' ? '0.9375rem' : typeof fontSize === 'number' ? `${fontSize}px` : fontSize;

  // documentId is forwarded RAW (possibly undefined) to the render-state
  // provider, which is the single point that resolves the useId() fallback
  // and derives `documentIdExplicit`. Defaulting here too would (a) duplicate
  // the fallback the provider already performs and (b) erase the "consumer
  // supplied an id?" signal before it reaches `useDocumentRegistry` — an
  // auto-generated id would then wrongly opt a standalone chunk into
  // cross-chunk coordination when nested under `<AIMarkdownDocuments>`.

  // ── Stability firewall (EXECUTION-PLAN §3.9) ──
  // Single table-driven boundary for all object-valued props. Per-key policy
  // lives in CORE_STABILITY_TABLE next to the roster type; the dev probes
  // (flip-rate for WARN_ONLY keys, deep-equal-restore for DEEP_EQUAL keys)
  // live inside the hook, replacing the old pre-stabilization
  // useReferenceFlipWarning calls. `metadata` crosses as PASS_THROUGH — the
  // deliberate exemption (opaque, potentially huge, unbounded comparison
  // cost) is now a declared policy row instead of an absence.
  // `?? undefined` collapses `null` from untyped callers to `undefined` so
  // the record matches its declared types and downstream `??`/conditional
  // sites see exactly one absent value. `urlTransform` rides through as-is —
  // its public type admits `null` (same null≡absent semantics), and its
  // single consumption site below already normalizes with `?? undefined`.
  const stable = useStableRecord<CoreStabilizedProps>(
    {
      enginePlugins: enginePlugins ?? undefined,
      sanitizeSchema: sanitizeSchema ?? undefined,
      customComponents: customComponents ?? undefined,
      contentPreprocessors: contentPreprocessors ?? undefined,
      urlTransform,
      Typography: Typography ?? DefaultTypography,
      ExtraStyles: ExtraStyles ?? undefined,
      streamingCursor: streamingCursor ?? undefined,
      metadata: metadata ?? undefined,
    },
    CORE_STABILITY_TABLE
  );
  const { Typography: TypographySlot, ExtraStyles: ExtraStylesSlot, streamingCursor: StreamingCursor } = stable;

  // Single-point resolution of the engine-consumed fields: explicit prop
  // (`v != null`) over shipped default. Both the internal pipeline props and
  // the behaviors-context payload derive from this one resolution.
  const resolvedEngine = useMemo(
    () =>
      resolveEngineValues({
        blockMemo,
        incrementalParse,
        preserveOrphanReferences,
        enginePlugins: stable.enginePlugins,
      }),
    [blockMemo, incrementalParse, preserveOrphanReferences, stable.enginePlugins]
  );

  // Run the preprocessing pipeline (LaTeX normalization + user preprocessors).
  // The LaTeX stage is a per-instance append-aware wrapper: byte-identical
  // to the stateless preprocessLaTeX, but streaming appends re-process only
  // the active tail instead of the whole document (relevant at per-frame
  // reveal rates under smooth streaming). Identity-stable across renders,
  // so the memo deps stay clean; same-source calls replay a cached output
  // (StrictMode-safe), non-append content resets its state.
  const [latexPreprocessor] = useState(() => createIncrementalLatexPreprocessor());
  const usedContent = useMemo(
    () => (content ? preprocessAIMDContent(content, stable.contentPreprocessors, latexPreprocessor) : content),
    [content, stable.contentPreprocessors, latexPreprocessor]
  );

  // Stabilize the inline style passed to Typography; otherwise its memo wrapper
  // breaks on every parent render even when the font-size hasn't changed.
  const typographyStyle = useMemo(() => ({ '--aim-font-size-root': usedFontSize }) as CSSProperties, [usedFontSize]);

  // The streaming-cursor slot must be a DOM sibling of the rendered blocks
  // (its shell finds the content root via `parentElement`), so it renders
  // inside the same JSX parent as the content — the ExtraStyles wrapper when
  // present, the typography root otherwise.
  const contentBody = (
    <>
      <AIMarkdownContent
        content={usedContent}
        customComponents={stable.customComponents}
        urlTransform={stable.urlTransform ?? undefined}
        sanitizeSchema={stable.sanitizeSchema}
        blockMemo={resolvedEngine.blockMemo}
        incrementalParse={resolvedEngine.incrementalParse}
        preserveOrphanReferences={resolvedEngine.preserveOrphanReferences}
        enginePlugins={resolvedEngine.enginePlugins}
        documentIndex={documentIndex}
      />
      {usedStreaming && StreamingCursor ? <StreamingCursor /> : null}
    </>
  );

  return (
    <AIMarkdownMetadataProvider<TMetadata> metadata={stable.metadata as TMetadata | undefined}>
      <AIMarkdownProvider
        streaming={usedStreaming}
        fontSize={usedFontSize}
        variant={usedVariant}
        colorScheme={usedColorScheme}
        documentId={documentId}
        blockMemo={resolvedEngine.blockMemo}
        incrementalParse={resolvedEngine.incrementalParse}
        preserveOrphanReferences={resolvedEngine.preserveOrphanReferences}
      >
        <TypographySlot
          fontSize={usedFontSize}
          variant={usedVariant}
          colorScheme={usedColorScheme}
          // Inject CSS custom properties onto the Typography root element.
          // --aim-font-size-root: absolute font-size anchor so inner CSS can
          //   bypass em-compounding in deeply nested markdown structures.
          // See AIMarkdownTypographyProps.style JSDoc for the full variable list.
          style={typographyStyle}
        >
          {ExtraStylesSlot ? <ExtraStylesSlot>{contentBody}</ExtraStylesSlot> : contentBody}
        </TypographySlot>
      </AIMarkdownProvider>
    </AIMarkdownMetadataProvider>
  );
};

/**
 * A React component for rendering AI-generated markdown with rich formatting support.
 *
 * Features:
 * - GFM (tables, strikethrough, task lists, autolinks)
 * - LaTeX math rendering via KaTeX
 * - Emoji shortcodes
 * - CJK-friendly line breaking and spacing
 * - Configurable syntax extensions (highlight, definition lists, super/subscript)
 * - Configurable display optimizations (SmartyPants, pangu, comment removal)
 * - Streaming-aware rendering
 * - Customizable typography, color scheme, and component overrides
 *
 * @example
 * ```tsx
 * import { highlight, definitionList } from '@ai-markdown/react/plugins';
 *
 * <AIMarkdown
 *   content={markdownString}
 *   streaming={isStreaming}
 *   colorScheme="dark"
 *   enginePlugins={[highlight, definitionList]}
 * />
 * ```
 */
const AIMarkdown = memo(AIMarkdownComponent);
AIMarkdown.displayName = 'AIMarkdown';

export default AIMarkdown as typeof AIMarkdownComponent;

// ── Smooth-stream shell ─────────────────────────────────────────────────────
// Lives here (not in components/smoothStream/) because it renders
// <AIMarkdown>: a separate module importing from this index would form an
// import cycle. The controller/hook layers stay framework-free/React-only
// respectively so the future engine split can lift them wholesale.

/**
 * Props for {@link AIMarkdownSmoothStream}: the full `<AIMarkdown>`
 * surface plus `smooth*`-prefixed pacing knobs (prefixed so future base
 * props can never collide with the shell's additions).
 */
export interface AIMarkdownSmoothStreamProps<
  TMetadata extends AIMarkdownMetadata = AIMarkdownMetadata,
> extends AIMarkdownProps<TMetadata> {
  /**
   * Pacing preset — the whole tuning surface at this level: `'smooth'`
   * (extra buffer, almost never runs dry between server flushes),
   * `'balanced'` (default: minimal lag that still bridges typical
   * bursts), `'responsive'` (lowest lag, accepts occasional pauses).
   * The reveal rate itself is adaptive — it tracks the source's measured
   * arrival cadence — so there are no numeric speed props here; advanced
   * numeric overrides live on `createSmoothStreamController`.
   */
  smoothPacing?: SmoothStreamPacing;
  /**
   * Fires when the post-stream drain completes (once per stream round);
   * content replacement never fires it. Correctness is identity-insensitive
   * (read through a latest-ref), but an inline closure still defeats this
   * shell's `memo` — prefer a stable reference.
   *
   * Under document turn-taking, a gated chunk drains only after its turn:
   * this can fire long after the source stream ended — and a regeneration
   * that happened entirely while the chunk was still gated is invisible to
   * the reveal, so the eventual drain DOES fire it (the finally-revealed
   * message did complete).
   */
  onSmoothDrained?: () => void;
  /**
   * Default `true`. Inside `<AIMarkdownDocuments>`, chunks sharing a
   * `documentId` take turns revealing (one typewriter, one cursor); see
   * {@link useDocumentSmoothStream}. Set `false` to keep this chunk's
   * reveal independent — it neither waits for predecessors nor blocks
   * successors (the escape hatch for chunks inserted out of mount order,
   * e.g. a regenerated middle message). Coordination also requires an
   * explicit `documentId` prop; without one this flag is moot.
   */
  smoothCoordination?: boolean;
  /** Reserve the document queue slot while awaiting input; clear on start
   * or completion of an empty result. Does not display a streaming cursor. */
  smoothWaiting?: boolean;
}

/**
 * `<AIMarkdown>` with built-in typewriter pacing: the incoming `content`
 * is revealed grapheme-by-grapheme at a backlog-adaptive rate, and the
 * revealed prefix is what actually renders. Because the prefix grows
 * append-only, every frame rides the incremental-parse fast path.
 *
 * `streaming` semantics shift one step: the value you pass marks the
 * SOURCE stream's liveness; the inner component (and so the cursor slot
 * and context consumers) sees `streaming === true` until the reveal has
 * also drained — the cursor must not unmount while pixels still move.
 *
 * Footgun: `blockMemo={false}` also disables incremental parsing, which
 * turns per-frame reveals into per-frame full reparses. Leave block-memo
 * on (the default) when smoothing.
 *
 * For custom composition (mantine wrapper, skip-animation buttons), use
 * {@link useDocumentSmoothStream} (coordinated) or {@link useSmoothStream}
 * (standalone) directly — either result spreads into any wrapper.
 *
 * @example
 * ```tsx
 * <AIMarkdownSmoothStream
 *   content={accumulated}
 *   streaming={!done}
 *   streamingCursor={AIMarkdownStreamingCursor}
 * />
 * ```
 */
const AIMarkdownSmoothStreamComponent = <TMetadata extends AIMarkdownMetadata = AIMarkdownMetadata>({
  smoothPacing,
  onSmoothDrained,
  smoothCoordination,
  smoothWaiting,
  content,
  streaming,
  ...rest
}: AIMarkdownSmoothStreamProps<TMetadata>) => {
  // §3.7: `??` is the only correct default site — a destructuring default
  // leaves an explicit `null` (RSC / serialization boundaries materialize
  // "not passed" as null) in place, and `null ? … : …` then silently turned
  // coordination OFF, the opposite of the documented default (2026-08
  // project review, core-api-01).
  const coordinate = smoothCoordination ?? true;
  const smooth = useDocumentSmoothStream({
    // The same documentId the inner <AIMarkdown> receives below — the only
    // public supply path for the id, so shell auto-wiring cannot drift.
    // Withholding it (opt-out, or no id at all) degrades the hook to plain
    // useSmoothStream behavior.
    documentId: coordinate ? rest.documentId : undefined,
    content,
    streaming,
    pacing: smoothPacing,
    onDrained: onSmoothDrained,
    waiting: smoothWaiting,
  });
  return <AIMarkdown {...rest} content={smooth.content} streaming={smooth.streaming} />;
};

const AIMarkdownSmoothStreamMemo = memo(AIMarkdownSmoothStreamComponent);
AIMarkdownSmoothStreamMemo.displayName = 'AIMarkdownSmoothStream';
export const AIMarkdownSmoothStream = AIMarkdownSmoothStreamMemo as typeof AIMarkdownSmoothStreamComponent;

// ── Public API re-exports ───────────────────────────────────────────────────

// Types
export type { AIMDContentPreprocessor };
export type { RemendPreprocessorOptions } from '@ai-markdown/engine';
export type {
  AIMarkdownCustomComponents,
  AIMarkdownMetadata,
  AIMarkdownTypographyProps,
  AIMarkdownTypographyComponent,
  AIMarkdownExtraStylesProps,
  AIMarkdownExtraStylesComponent,
  AIMarkdownVariant,
  AIMarkdownColorScheme,
} from './defs';

// Hooks -- for custom components to access metadata
export { useAIMarkdownMetadata } from './context';
export { useStableValue };

// ── v2 output surface (EXECUTION-PLAN props-api v2) ─────────────────────────

// Five narrow hooks + the aggregate. `useAIMarkdownMetadata` (above) is the
// fifth narrow hook — it predates v2 and keeps its generic.
export {
  useAIMarkdownDocument,
  useAIMarkdownTheme,
  useAIMarkdownState,
  useAIMarkdownBehaviors,
  useAIMarkdown,
} from './context';

// Additive (stackable) Providers — extension-group transport for wrappers
// and applications. Stack OUTSIDE <AIMarkdown>; see each Provider's JSDoc.
export { AIMarkdownBehaviorsProvider, AIMarkdownStateProvider } from './context';
export type {
  AIMarkdownDocumentInfo,
  AIMarkdownThemeInfo,
  AIMarkdownStateCore,
  AIMarkdownBehaviorsCore,
  AIMarkdownStateGroups,
  AIMarkdownBehaviorGroups,
  AIMarkdownExtensionGroups,
  AIMarkdownAggregate,
} from './context';

// ── v2 input surface (EXECUTION-PLAN props-api v2) ──────────────────────────

// Sealed engine plugin type. The plugin VALUES live in the
// `@ai-markdown/react/plugins` subpath (see `enginePlugins` prop JSDoc);
// only the type travels through the root entry.
export type { AIMarkdownEnginePlugin, AIMarkdownEnginePluginName } from '@ai-markdown/engine';

// `define*` factories — frozen, typed, reference-stable flat prop fragments.
export { defineTheme, defineBehaviors, definePipeline } from './define';
export type { AIMarkdownThemeProps, AIMarkdownBehaviorProps, AIMarkdownPipelineProps } from './define';

// Stability firewall — exported for wrapper reuse: a wrapper builds a table
// only for object props it terminates (e.g. mantine's `codeBlock`);
// forwarded props ride core's firewall untouched.
export { AIMarkdownStabilityPolicy, default as useStableRecord } from './hooks/useStableRecord';
export type { AIMarkdownStabilityTable } from './hooks/useStableRecord';

// Content preprocessors — opt-in factories for the `contentPreprocessors`
// prop. Tree-shakeable: `remend` only enters a consumer bundle when this
// factory is imported.
export { createRemendPreprocessor } from '@ai-markdown/engine';

// URL handling — primitives for the `urlTransform` prop and a factory
// helper for the `sanitizeSchema` prop on `<AIMarkdown>`.
//
// `urlTransform` has no helper because composition with `defaultUrlTransform`
// is already the natural JS pattern (one-line closure). `extendSanitizeSchema`
// is the ONLY supported way to build a custom sanitize schema — it hands the
// caller a deep clone of the library default (which itself includes invariants
// like the cross-chunk tag allowlist and KaTeX className allowlist), so direct
// mutation is safe and the invariants are preserved automatically. The library
// default schema is intentionally NOT exported as a value to prevent the
// classic shallow-spread footgun (`{ ...sanitizeSchema }` aliases nested
// arrays). Consumers who want to read default values can invoke the helper
// with a logging modifier — see `extendSanitizeSchema`'s JSDoc for the
// recipe. Only the `SanitizeSchema` type is exported, for callers building
// typed helpers around the prop.
export { defaultUrlTransform } from './components/markdown';
export type { UrlTransform } from './components/markdown';
export { extendSanitizeSchema } from '@ai-markdown/engine';
export type { SanitizeSchema } from '@ai-markdown/engine';

// Streaming cursor — positioner shell for the `streamingCursor` slot, plus
// the indicator contract for custom visuals.
export { AIMarkdownStreamingCursor } from './components/streamingCursor';
export type {
  AIMarkdownStreamingCursorProps,
  AIMarkdownStreamingIndicatorProps,
  AIMarkdownStreamingIndicatorComponent,
} from './components/streamingCursor';

// Smooth streaming — the shell component is defined above; these are the
// composable layers beneath it (framework-free controller + React hook).
export { createSmoothStreamController, SMOOTH_STREAM_PACING_PRESETS } from '@ai-markdown/engine';
export type {
  SmoothStreamController,
  SmoothStreamOptions,
  SmoothStreamPacing,
  SmoothStreamPacingParams,
} from '@ai-markdown/engine';
export { useSmoothStream } from './components/smoothStream/useSmoothStream';
export type { UseSmoothStreamOptions, UseSmoothStreamResult } from './components/smoothStream/useSmoothStream';
export { useDocumentSmoothStream } from './components/smoothStream/useDocumentSmoothStream';
export type { UseDocumentSmoothStreamOptions } from './components/smoothStream/useDocumentSmoothStream';

// Cross-chunk coordination wrapper + hook
export { AIMarkdownDocuments, useDocumentRegistry } from './components/AIMarkdownDocuments';
export type { AIMarkdownDocumentsProps } from './components/AIMarkdownDocuments';
// Registry types — consumers writing typed helpers around useDocumentRegistry
// (`function helper(r: Registry)`) need these. The Registry shape itself is a
// public contract: we maintain backwards compat across minor versions.
export type { Registry, ChunkData, FootnoteDef, LinkDef, RefRecord, RefKind } from '@ai-markdown/engine';

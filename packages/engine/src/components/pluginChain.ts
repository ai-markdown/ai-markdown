/**
 * THE single source of the production plugin chain.
 *
 * `MarkdownContent`'s memos, the splice-equivalence arbiter's option
 * catalog (`incrementalParse/testPluginCatalog.ts`), and the prefixFreeze
 * experiment harness all build their chains HERE — plugin-order drift
 * between the renderer and its verification suites previously required
 * hand-synchronized copies, and a missed copy would silently leave the
 * arbiter testing a non-production pipeline.
 *
 * Two deliberate NON-consumers, kept as independent mirrors on purpose:
 * - `byteEquivalence.test.tsx`'s `legacyPlugins()` — it is the REFERENCE
 *   implementation the new pipeline is compared against; importing this
 *   module would make that comparison circular.
 * - `positionPropagation.test.ts` — it pins the position-retention
 *   contract of the exact stack and must fail loudly when the stack
 *   changes, not silently follow it.
 *
 * @module components/pluginChain
 */

import rehypeKatex from 'rehype-katex';
import rehypeRawGuard from './rehypeRawGuard';
import rehypeUnwrapImages from 'rehype-unwrap-images';
import { rehypeUnwrapCrossChunkImages } from './rehypeUnwrapCrossChunkImages';
import rehypeSanitize from 'rehype-sanitize';
import { rehypeVerifyEngineTags } from './rehypeVerifyEngineTags';
import remarkBreaks from 'remark-breaks';
import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly';
import remarkCjkFriendlyGfmStrikethrough from 'remark-cjk-friendly-gfm-strikethrough/parseOnly';
import remarkEmoji from 'remark-emoji';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { remarkDefinitionList, defListHastHandlers } from 'remark-definition-list';
import { remarkMark as remarkMarkHighlight } from '@ai-markdown/remark-mark-highlight';
import remarkSqueezeParagraphs from 'remark-squeeze-paragraphs';
import remarkSmartypants from 'remark-smartypants';
import remarkPangu from 'remark-pangu';
import remarkStripComments from './remarkStripComments';
import remarkCjkQuotes from './remarkCjkQuotes';

import type { PipelineOptions as MarkdownOptions } from './markdown';
import rehypeRebaseHashLinks from './rehypeRebaseHashLinks';
import rehypeFooterAdorn from './rehypeFooterAdorn';
import rehypeTaskListLabels from './rehypeTaskListLabels';
import type { SanitizeSchema } from './extendSanitizeSchema';
import type { AIMarkdownEnginePlugin, AIMarkdownEnginePluginName } from '../plugins/defs';

export type RemarkPlugins = NonNullable<MarkdownOptions['remarkPlugins']>;
export type RehypePlugins = NonNullable<MarkdownOptions['rehypePlugins']>;
export type RemarkRehypeOptions = NonNullable<MarkdownOptions['remarkRehypeOptions']>;

/**
 * Per-stage chain tables: sealed plugin name → unified plugin, in CANONICAL
 * chain order. The tables (not the caller's array order) fix each plugin's
 * splice position — required for the produced-chain byte-equivalence
 * guarantee to be checkable. The heavy unified imports stay in THIS module
 * so the `/plugins` subpath catalog remains a lightweight descriptor set.
 */
const EXTRA_SYNTAX_CHAIN: ReadonlyArray<readonly [AIMarkdownEnginePluginName, RemarkPlugins[number]]> = [
  ['highlight', remarkMarkHighlight as RemarkPlugins[number]],
  ['definitionList', remarkDefinitionList as RemarkPlugins[number]],
];
// The `smartypants` plugin is two transformers. SmartyPants decides whether
// a straight quote opens or closes by the token before it, and a CJK
// character is a word to it, so in `中文"引号"中文` both quotes closed.
// Running pangu first cured the double quote (its spacing put a space
// before each one) but pangu pads every straight `'` on its own, so the
// single-quote form came out as `中文 ’ 引号 ’ 中文`. `remarkCjkQuotes` curls
// the quotes that touch a CJK character by pairing, before SmartyPants, and
// SmartyPants then only sees the Latin ones; pangu runs last, on curly
// quotes, which it pads (`“`/`”`) or leaves alone (`‘`/`’`) as its own
// rules say. A name may appear more than once here: the filter below keeps
// every row whose name is selected, in table order.
const DISPLAY_OPTIMIZE_CHAIN: ReadonlyArray<readonly [AIMarkdownEnginePluginName, RemarkPlugins[number]]> = [
  ['removeComments', remarkStripComments as RemarkPlugins[number]],
  ['smartypants', remarkCjkQuotes as RemarkPlugins[number]],
  ['smartypants', remarkSmartypants as RemarkPlugins[number]],
  ['pangu', remarkPangu as RemarkPlugins[number]],
];

/** The always-on remark chain with plugin-gated extras spliced at their
 *  contractual positions. ORDER IS LOAD-BEARING — see the arbiter suite. */
export function buildCoreRemarkPlugins(enginePlugins: readonly AIMarkdownEnginePlugin[]): RemarkPlugins {
  const selected = new Set<string>(enginePlugins.map((plugin) => plugin.name));
  return [
    // --- Core plugins (always active) ---
    remarkGfm,
    [
      remarkMath,
      {
        // Disable single-dollar inline math to avoid conflicts with currency
        // signs and other dollar usages; the preprocessor converts $...$ to $$...$$.
        singleDollarTextMath: false,
      },
    ],
    // --- Selectable extra syntax plugins (canonical table order) ---
    ...EXTRA_SYNTAX_CHAIN.filter(([name]) => selected.has(name)).map(([, plugin]) => plugin),
    // --- Formatting & normalization ---
    remarkBreaks,
    remarkEmoji,
    remarkSqueezeParagraphs,
    remarkCjkFriendly,
    remarkCjkFriendlyGfmStrikethrough,
    // --- Selectable display optimizations (canonical table order) ---
    ...DISPLAY_OPTIMIZE_CHAIN.filter(([name]) => selected.has(name)).map(([, plugin]) => plugin),
  ] as RemarkPlugins;
}

export interface CoreRehypePluginsOptions {
  /**
   * Per-pipeline provenance credential. Installs `rehypeVerifyEngineTags`
   * between `rehypeRaw` and `rehypeSanitize` so that only placeholder
   * elements stamped with this exact value by the cross-chunk handlers
   * survive; put the SAME value in the remark-rehype options
   * (`CrossChunkHandlerOptions.provenance`). Omitting `options` keeps the
   * chain exactly as before — no verifier — which is the documented
   * escape-hatch behaviour for hand-assembled pipelines; the shipped
   * renderer always passes a credential.
   */
  provenance: string;
}

/** The rehype chain. `clobberPrefix` namespaces ids per instance; pass ''
 *  for unprefixed output (test harnesses). */
export function buildCoreRehypePlugins(
  sanitizeSchema: SanitizeSchema,
  clobberPrefix: string,
  options?: CoreRehypePluginsOptions
): RehypePlugins {
  return [
    // Allow raw HTML through so rehype-sanitize can handle it. The guard
    // reports the step's own stack overflow on hostile nesting as
    // EngineRawHtmlDepthError (see rehypeRawGuard); nothing else changes.
    [rehypeRawGuard, { passThrough: [] }],
    // Unwrap forged engine placeholders BEFORE sanitize admits their tag
    // names. Only when the caller holds a credential (see the option's doc).
    ...(options
      ? [
          [
            rehypeVerifyEngineTags,
            {
              provenance: options.provenance,
              ...(sanitizeSchema.ancestors?.a || sanitizeSchema.ancestors?.img ? { referenceAncestors: true } : {}),
            },
          ],
        ]
      : []),
    // Sanitize HTML while allowing <mark> (highlight), KaTeX class names,
    // and any extra protocols the caller permitted via the `sanitizeSchema`
    // prop. Override `clobberPrefix` with the instance-scoped value — the
    // spread order is intentional: our prefix wins over any caller-supplied
    // prefix on the schema.
    [rehypeSanitize, { ...sanitizeSchema, clobberPrefix }],
    // Normalize the auto-generated `<section data-footnotes>`: strip the
    // sr-only `<h2>Footnotes</h2>` label and prepend `<hr>`. Keeps standalone
    // single-doc rendering visually consistent with the cross-chunk aggregate
    // footer (which builds the same shape from scratch).
    rehypeFooterAdorn,
    rehypeTaskListLabels,
    // Re-prefix intra-document hash hrefs so they match the ids that
    // rehype-sanitize just clobbered. Must use the SAME prefix as the schema
    // above.
    [rehypeRebaseHashLinks, { prefix: clobberPrefix }],
    rehypeKatex,
    rehypeUnwrapImages,
    // Same unwrap for `<cross-chunk-image>` placeholders (coordinated mode);
    // no-op on standalone documents.
    rehypeUnwrapCrossChunkImages,
  ] as RehypePlugins;
}

/** Base remark-rehype options (before the standalone/coordinated handler
 *  merge that `MarkdownContent`'s pipeline memo layers on top). */
export function buildCoreRemarkRehypeOptions(enableDefinitionList: boolean): RemarkRehypeOptions {
  return {
    allowDangerousHtml: true,
    // Suppress mdast-util-to-hast's `user-content-` prefix on footnote
    // ids/hrefs; rehype-sanitize will apply the same prefix downstream
    // and `rehypeRebaseHashLinks` mirrors it onto matching hash hrefs.
    // Without this, ids would end up double-prefixed
    // (`user-content-user-content-fn-x`).
    clobberPrefix: '',
    handlers: {
      // Inject definition-list HAST handlers when the extension is active.
      ...(enableDefinitionList ? defListHastHandlers : {}),
    },
  };
}

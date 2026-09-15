/** Framework-independent algorithm contracts for ai-markdown adapters.
 * Public contracts follow semantic versioning from 3.0.0. Test fixtures and
 * implementation registry storage are intentionally source-only, outside
 * this root entry.
 */

// ── M3: incremental-parse engine + definition machinery ──────────────────
export { advanceIncrementalParse, computeFreezeBoundary } from './components/incrementalParse';
export type {
  AdvanceOptions,
  AdvanceResult,
  FreezeBoundaryOptions,
  IncrementalParseState,
  IncrementalStage,
} from './components/incrementalParse';
export {
  collectDefLabels,
  createDefLabelScanner,
  type DefLabels,
  type DefLabelGrammarOptions,
  type DefLabelScanner,
  type DefLabelScannerOptions,
} from './components/collectDefLabels';
export {
  extractDefBodiesFromHast,
  footnoteSafeId,
  sourceIdFromFootnoteLiId,
} from './components/extractDefBodiesFromHast';
export { extractContributions } from './components/extractContributions';
export type { Contribution, ExtractContributionsOptions } from './components/extractContributions';
export { createRegistry } from './registry';
export type { Registry, RegistryController, ChunkData, FootnoteDef, LinkDef, RefKind, RefRecord } from './registry';

// ── M2: pipeline assembly ────────────────────────────────────────────────
export {
  buildTransform,
  createProcessor,
  defaultUrlTransform,
  parseStage,
  transformStage,
} from './components/markdown';
export type {
  AllowElement,
  Deprecation,
  ParsedMarkdown,
  PipelineOptions,
  TransformContext,
  UrlTransform,
} from './components/markdown';
export { buildCoreRehypePlugins, buildCoreRemarkPlugins, buildCoreRemarkRehypeOptions } from './components/pluginChain';
export type {
  CoreRehypePluginsOptions,
  RehypePlugins,
  RemarkPlugins,
  RemarkRehypeOptions,
} from './components/pluginChain';
export {
  rehypeVerifyEngineTags,
  ENGINE_PLACEHOLDER_TAGS,
  ENGINE_PROVENANCE_PROPERTY,
  type RehypeVerifyEngineTagsOptions,
} from './components/rehypeVerifyEngineTags';
export {
  default as rehypeRebaseHashLinks,
  type RehypeRebaseHashLinksOptions,
} from './components/rehypeRebaseHashLinks';
export { default as rehypeFooterAdorn } from './components/rehypeFooterAdorn';
export { EngineRawHtmlDepthError } from './components/rehypeRawGuard';
export { buildPhantomSuffix, phantomSuffixCloser } from './components/remarkInjectPhantomDefs';
export type { PhantomLabels } from './components/remarkInjectPhantomDefs';
export { buildCrossChunkHandlers } from './components/customMdastHandlers';
export type { CrossChunkHandlerOptions } from './components/customMdastHandlers';
export { sanitizeCrossChunkUrl } from './components/crossChunkUrlSanitize';
export type { UrlAttrKey, UrlAttrTag } from './components/crossChunkUrlSanitize';
export { resolveCrossChunkReference } from './components/resolveCrossChunkReference';
export { isEnginePlugin } from './plugins/defs';
export type { AIMarkdownEnginePlugin, AIMarkdownEnginePluginName } from './plugins/defs';
export { defaultEnginePlugins, definitionList, highlight, pangu, removeComments, smartypants } from './plugins/catalog';

// ── M1: zero-dependency leaves ───────────────────────────────────────────
// Named (not star): isWhitespaceText is internal-only (2.8.1 surface trim).
export { isFootnoteSection, lastMeaningfulIdx } from './components/hastPredicates';
export { normalizeForMatch, normalizeId } from './components/normalizeId';
export { hasLoneSurrogate, shortenDocumentId } from './components/shortenDocumentId';
export {
  PIPELINE_STAGES,
  STAGE_MEASURE_PREFIX,
  measureStage,
  subscribeStageTimings,
} from './components/devStageTimings';
export type { PipelineStage } from './components/devStageTimings';
// Named (not star): mergeClassNameAllowlist is internal-only (2.8.1 surface
// trim) — consumers extend via extendSanitizeSchema below.
export { sanitizeSchema } from './components/sanitizeSchema';
export { extendSanitizeSchema } from './components/extendSanitizeSchema';
export type { SanitizeSchema } from './components/extendSanitizeSchema';
export { SMOOTH_STREAM_PACING_PRESETS, createSmoothStreamController } from './components/smoothStream/controller';
export type {
  SmoothStreamController,
  SmoothStreamOptions,
  SmoothStreamPacing,
  SmoothStreamPacingParams,
} from './components/smoothStream/controller';
export type { AIMDContentPreprocessor } from './preprocessors/defs';
export { default as preprocessAIMDContent } from './preprocessors';
// Named (not star): splitByProtectedRegions is an internal segmentation
// helper (2.8.1 surface trim).
export { preprocessLaTeX, createIncrementalLatexPreprocessor } from './preprocessors/latex';
export { createRemendPreprocessor } from './preprocessors/remend';
export type { RemendPreprocessorOptions } from './preprocessors/remend';

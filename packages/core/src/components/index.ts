export { defaultCodeBlockPolicy, resolveCodeBlockPolicy } from './codeBlockOptions';
export type { CodeBlockPolicy } from './codeBlockOptions';
export {
  CodeLanguageFormat,
  resolveCodeHighlightLanguage,
  resolveCodeHighlightInterval,
  createCodeHighlightSession,
} from './codeHighlight';
export type {
  CodeLanguageResolver,
  CodeHighlightToken,
  CodeHighlightResult,
  CodeHighlightRequest,
  CodeHighlightAdapter,
  CodeHighlightBackend,
  CodeHighlightInput,
  CodeHighlightSnapshot,
} from './codeHighlight';
/** Framework-independent contracts for the opt-in Markdown components. */
export { extractCode, normalizeRenderers, projectTable, serializeTable } from './nodes';
export type { CodeSource, TableProjection } from './nodes';
export { extendsCode } from './codeText';
export { createCodeLanguageTracker } from './codeLanguage';
export { createCodeBlockSession } from './codeBlock';
export type { CodeBlockInput, CodeBlockSnapshot } from './codeBlock';
export { createCodeFrame, nextCodeFrame } from './codeFrame';
export type { CodeFrame } from './codeFrame';
export { prettyPrintJson } from './formatJson';
export { createJsonCompletenessScanner, jsonLooksComplete } from './jsonCompleteness';
export { mermaidRenderQueue } from './renderQueue';
export { ensureMermaidInitialized, getMermaidMaxTextSize } from './mermaid';
export type { MermaidInitTarget } from './mermaid';

export interface CodeRendererInput {
  /** Raw accumulated source, including its trailing newline. */
  code: string;
  /** Explicit normalized fence language; detection never selects a renderer. */
  language: string;
  /** Document streaming state, not an inferred fence-completion flag. */
  streaming: boolean;
  colorScheme: 'light' | 'dark';
  active: boolean;
  /** Changes on source replacement or identity change; append preserves it. */
  resetKey: string;
}
export type { CodeBlockOptions } from './codeBlockOptions';
export { createDiagramController, diagramErrorText } from './diagram';
export type { DiagramEngine, DiagramState, DiagramRequest, DiagramView, DiagramError } from './diagram';
export {
  resolveLabels,
  defaultCodeBlockLabels,
  defaultDiagramLabels,
  defaultImageLabels,
  defaultTableLabels,
} from './labels';
export type {
  LabelsOption,
  CodeBlockLabels,
  DiagramLabels,
  ImageLabels,
  TableLabels,
  TableExportReason,
} from './labels';
export { lockImagePreviewScroll } from './scroll';
export { createImagePreviewController } from './imagePreview';
export type {
  ImagePreviewPhase,
  ImagePreviewState,
  ImagePreviewHost,
  ImagePreviewOptions,
  ImagePreviewAction,
  ImagePointer,
} from './imagePreview';
export { imageIconPaths, imageActionNames, getImageGallery } from './image';
export type { ImageIconName, ImageActionIconName, ImageLoadStatus, ImageGalleryItem, ImageGallery } from './image';
export {
  initialImageTransform,
  imageTransformStyle,
  zoomImage,
  imageWheelRatio,
  reboundImage,
  imagePinchCenter,
} from './imageTransform';
export type { ImageTransform, ImageGeometry } from './imageTransform';

export { createPierreHighlightAdapter } from './pierreHighlight';
export type { PierreHighlightRuntime, PierreLiveTokenizer, PierreHighlightToken } from './pierreHighlight';

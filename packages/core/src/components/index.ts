/** Framework-independent contracts for the opt-in Markdown components. */
export { extractCode, normalizeRenderers, projectTable, serializeTable } from './nodes';
export type { CodeSource, TableProjection } from './nodes';
export { createCodeFrame } from './codeFrame';
export type { CodeFrame } from './codeFrame';
export { prettyPrintJson } from './formatJson';
export { createJsonCompletenessScanner, jsonLooksComplete } from './jsonCompleteness';
export { createRenderQueue, mermaidRenderQueue } from './renderQueue';
export {
  ensureMermaidInitialized,
  getMermaidMaxTextSize,
  MERMAID_DEFAULT_MAX_TEXT_SIZE,
  resetMermaidInitializationForTests,
} from './mermaid';
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
export interface CodeBlockOptions {
  defaultExpanded?: boolean;
  autoDetectUnknownLanguage?: boolean;
  formatJson?: boolean;
  expandNestedJson?: boolean;
  highlightIntervalMs?: number;
  mermaidIntervalMs?: number;
}
export { createDiagramController } from './diagram';
export type { DiagramEngine, DiagramState, DiagramRequest } from './diagram';
export { lockImagePreviewScroll } from './scroll';
export { imageIconPaths, imageActionLabels, imageGroupSelector, getImageGallery } from './image';
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

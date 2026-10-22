export { MarkdownCodeBlock, createMarkdownCodeBlock, preloadCodeAssets } from './code';
export type {
  MarkdownCodeBlockOptions,
  CodeRendererInput,
  CodeBlockOptions,
  CodeBlockLabels,
  DiagramLabels,
  LabelsOption,
} from './code';
export { MarkdownImage, createMarkdownImage } from './image';
export type {
  MarkdownImageOptions,
  MarkdownImageIcon,
  MarkdownImagePreviewOptions,
  ImageIconName,
  ImageLabels,
} from './image';
export { MarkdownTable, createMarkdownTable } from './table';
export type { MarkdownTableOptions, TableLabels } from './table';
export type { MarkdownComponentProps } from './types';

export {
  CodeLanguageFormat,
  resolveCodeHighlightLanguage,
  createPierreHighlightAdapter,
} from '@ai-markdown/core/components';
export type {
  CodeHighlightAdapter,
  CodeHighlightResult,
  CodeHighlightRequest,
  CodeHighlightToken,
  CodeLanguageResolver,
} from '@ai-markdown/core/components';

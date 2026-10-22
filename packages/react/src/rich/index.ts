'use client';
export { MarkdownCodeBlock, createMarkdownCodeBlock, preloadCodeAssets } from './code';
export type {
  MarkdownCodeBlockProps,
  MarkdownCodeBlockOptions,
  CodeRendererInput,
  CodeBlockOptions,
  CodeBlockLabels,
  DiagramLabels,
  LabelsOption,
} from './code';
export { MarkdownImage, createMarkdownImage } from './image';
export type {
  MarkdownImageProps,
  MarkdownImageOptions,
  MarkdownImageIcon,
  ImageIconProps,
  ImageIconName,
  ImageLabels,
  MarkdownImagePreviewOptions,
} from './image';
export { MarkdownTable, createMarkdownTable } from './table';
export type { MarkdownTableProps, MarkdownTableOptions, TableLabels } from './table';

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

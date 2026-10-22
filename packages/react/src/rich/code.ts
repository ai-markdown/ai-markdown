'use client';
import { type DiagramLabels, type LabelsOption } from '@ai-markdown/core/components';
import { type MarkdownCodeBlockOptions as PlainCodeBlockOptions } from './code-plain';
import { loadMermaid } from './mermaid';
import { createConfiguredCodeBlock } from './codeFactory';
export type {
  MarkdownCodeBlockProps,
  CodeRendererInput,
  CodeBlockOptions,
  CodeBlockLabels,
  LabelsOption,
} from './code-plain';
export type { DiagramLabels } from '@ai-markdown/core/components';
export interface MarkdownCodeBlockOptions extends PlainCodeBlockOptions {
  /** Text of the built-in Mermaid renderer, as overrides of the English defaults. */
  diagramLabels?: LabelsOption<DiagramLabels>;
}
export { preloadCodeAssets, loadMermaid } from './mermaid';
export function createMarkdownCodeBlock(options: MarkdownCodeBlockOptions = {}) {
  return createConfiguredCodeBlock(options, loadMermaid);
}

export const MarkdownCodeBlock = createMarkdownCodeBlock();

export { createPeleLoader, createOndineLoader } from '@ai-markdown/core/components';
export type { DiagramEngineLoader } from '@ai-markdown/core/components';

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

'use client';
import { normalizeRenderers, type DiagramLabels, type LabelsOption } from '@ai-markdown/core/components';
import {
  createMarkdownCodeBlock as createPlain,
  type MarkdownCodeBlockOptions as PlainCodeBlockOptions,
} from './code-plain';
import { createMermaidRenderer } from './mermaid';
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
export { preloadCodeAssets } from './mermaid';
export function createMarkdownCodeBlock(options: MarkdownCodeBlockOptions = {}) {
  return createPlain({
    ...options,
    renderers: {
      mermaid: createMermaidRenderer(options.mermaidIntervalMs, options.diagramLabels),
      ...normalizeRenderers(options.renderers ?? {}),
    },
  });
}
export const MarkdownCodeBlock = createMarkdownCodeBlock();

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

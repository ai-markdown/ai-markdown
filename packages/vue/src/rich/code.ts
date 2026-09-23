import { normalizeRenderers } from '@ai-markdown/core/components';
import { createMarkdownCodeBlock as createPlain, type MarkdownCodeBlockOptions } from './code-plain';
import { createMermaidRenderer } from './mermaid';
export type { MarkdownCodeBlockOptions, CodeRendererInput, CodeBlockOptions } from './code-plain';
export { preloadCodeAssets } from './mermaid';
export function createMarkdownCodeBlock(options: MarkdownCodeBlockOptions = {}) {
  return createPlain({
    ...options,
    renderers: {
      mermaid: createMermaidRenderer(options.mermaidIntervalMs),
      ...normalizeRenderers(options.renderers ?? {}),
    },
  });
}
export const MarkdownCodeBlock = createMarkdownCodeBlock();

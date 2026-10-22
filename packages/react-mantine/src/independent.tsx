'use client';
import { createMantineMarkdown } from './createMantineMarkdown';
import { createMarkdownCodeBlock } from './rich/code-independent';
/** Create once. This entry never imports Mermaid or enables an implicit fallback. */
export function createMantineAIMarkdown(options: Parameters<typeof createMarkdownCodeBlock>[0]) {
  return createMantineMarkdown(createMarkdownCodeBlock(options));
}
export { createMarkdownCodeBlock } from './rich/code-independent';
export { createPeleLoader, createOndineLoader, preloadDiagramEngine } from '@ai-markdown/core/components';
export type { MantineAIMarkdownProps } from './createMantineMarkdown';
export type { MantineMarkdownCodeBlockOptions } from './rich/code-independent';

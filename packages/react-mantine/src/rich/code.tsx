'use client';
import { loadMermaid, preloadCodeAssets } from '@ai-markdown/react/components/code';
import { createConfiguredCodeBlock, type MantineMarkdownCodeBlockOptions } from './codeFactory';
export type { MantineMarkdownCodeBlockOptions, MarkdownCodeBlockProps, CodeRendererInput } from './codeFactory';
export function createMarkdownCodeBlock(options: MantineMarkdownCodeBlockOptions = {}) {
  return createConfiguredCodeBlock(options, loadMermaid);
}
export const MarkdownCodeBlock = createMarkdownCodeBlock();
/** Legacy preload swallows failures; the renderer can retry later. */
export function preloadMantineCodeAssets(load = loadMermaid): Promise<void> {
  return preloadCodeAssets(load).catch(() => undefined);
}

import {
  normalizeRenderers,
  type DiagramEngineLoader,
  type DiagramLabels,
  type LabelsOption,
} from '@ai-markdown/core/components';
import { createMarkdownCodeBlock as createPlain, type MarkdownCodeBlockOptions as PlainOptions } from './code-plain';
import { createDiagramRenderer } from './diagramRenderer';
export interface MarkdownCodeBlockOptions extends PlainOptions {
  diagramLabels?: LabelsOption<DiagramLabels>;
}
export function createConfiguredCodeBlock(options: MarkdownCodeBlockOptions, defaultEngine?: DiagramEngineLoader) {
  return createPlain({
    ...options,
    renderers: {
      mermaid:
        options.mermaidEngine === false
          ? false
          : createDiagramRenderer(
              options.mermaidIntervalMs,
              options.diagramLabels,
              options.mermaidEngine,
              defaultEngine,
              options.mermaidFallback
            ),
      ...normalizeRenderers(options.renderers ?? {}),
    },
  });
}
/** Engine-independent entry: no implicit engine or fallback. */
export function createMarkdownCodeBlock(
  options: MarkdownCodeBlockOptions & { mermaidEngine: DiagramEngineLoader | false }
) {
  return createConfiguredCodeBlock(options);
}
export { createPeleLoader, createOndineLoader, preloadDiagramEngine } from '@ai-markdown/core/components';
export type { DiagramEngineLoader, CodeRendererInput } from '@ai-markdown/core/components';

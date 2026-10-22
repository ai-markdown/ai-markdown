'use client';
import { createCachedDiagramLoader, preloadDiagramEngine } from '@ai-markdown/core/components';
import type { DiagramEngineLoader } from '@ai-markdown/core/components';
export const loadMermaid = createCachedDiagramLoader(() => import('mermaid').then((module) => module.default));
export function preloadCodeAssets(load: DiagramEngineLoader = loadMermaid): Promise<void> {
  return preloadDiagramEngine(load);
}

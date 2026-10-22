'use client';
import { useAIMarkdownBehaviors } from '@ai-markdown/react';
import {
  defaultDiagramLabels,
  diagramErrorText,
  resolveLabels,
  type CodeBlockOptions,
  type CodeRendererInput,
  type DiagramLabels,
  type LabelsOption,
  type DiagramEngineLoader,
} from '@ai-markdown/core/components';
import { useDiagram, DiagramViewport } from './diagram';
export function createDiagramRenderer(
  configuredInterval: number | undefined,
  configuredLabels: LabelsOption<DiagramLabels> | undefined,
  configuredEngine: DiagramEngineLoader | false | undefined,
  defaultEngine?: DiagramEngineLoader,
  configuredFallback?: boolean
) {
  return function DiagramRenderer(props: CodeRendererInput) {
    const group = useAIMarkdownBehaviors().codeBlock as CodeBlockOptions | undefined;
    const engine = configuredEngine ?? group?.mermaidEngine ?? defaultEngine;
    if (!engine) throw new Error('An explicit diagram engine is required');
    const { state, retry } = useDiagram({
      ...props,
      intervalMs: configuredInterval ?? group?.mermaidIntervalMs,
      load: engine,
      fallback:
        (configuredFallback ?? group?.mermaidFallback ?? true) && engine !== defaultEngine ? defaultEngine : undefined,
    });
    const { view, loadFailed } = state;
    const labels = resolveLabels(defaultDiagramLabels, configuredLabels);
    const waiting = view.kind === 'source' && !loadFailed;
    return (
      <div className="aimd-diagram" aria-busy={waiting}>
        <DiagramViewport className="aimd-diagram-viewport" view={view} />
        {waiting && <p role="status">{props.streaming ? labels.waiting : labels.rendering}</p>}
        {(view.kind === 'error' || loadFailed) && (
          <div role="alert">
            <p>{view.kind === 'error' ? diagramErrorText(view, labels) : labels.loadFailed}</p>
            <button type="button" onClick={retry}>
              {labels.retry}
            </button>
          </div>
        )}
      </div>
    );
  };
}

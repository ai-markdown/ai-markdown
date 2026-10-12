'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAIMarkdownBehaviors } from '@ai-markdown/react';
import type { CodeBlockOptions } from '@ai-markdown/core/components';
import {
  createDiagramController,
  defaultDiagramLabels,
  diagramErrorText,
  resolveLabels,
  type CodeRendererInput,
  type DiagramLabels,
  type DiagramState,
  type DiagramView,
  type LabelsOption,
} from '@ai-markdown/core/components';
let engine: ReturnType<typeof importMermaid> | undefined;
function importMermaid() {
  return import('mermaid').then((module) => module.default);
}
function loadMermaid() {
  return (engine ??= importMermaid().catch((error) => {
    engine = undefined;
    throw error;
  }));
}
/** Warm the optional engine without exposing its types in the public API. */
export function preloadCodeAssets(): Promise<void> {
  return loadMermaid().then(() => undefined);
}
type Diagram = Extract<DiagramView, { kind: 'diagram' }>;
function DiagramViewport({ diagram }: { diagram: Diagram }) {
  const target = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = target.current!;
    element.innerHTML = diagram.svg;
    diagram.bind?.(element);
    return () => {
      element.replaceChildren();
    };
  }, [diagram]);
  return <div ref={target} className="aimd-diagram-viewport" />;
}
/** Draws what core's `createDiagramController` publishes; the render policy is documented there. */
export function createMermaidRenderer(configuredInterval?: number, configuredLabels?: LabelsOption<DiagramLabels>) {
  return function MermaidRenderer(props: CodeRendererInput) {
    const group = useAIMarkdownBehaviors().codeBlock as CodeBlockOptions | undefined;
    const requestedInterval = configuredInterval ?? group?.mermaidIntervalMs ?? 300;
    const interval = Number.isFinite(requestedInterval) && requestedInterval >= 0 ? requestedInterval : 300;
    const [state, setState] = useState<DiagramState>({ view: { kind: 'source' }, loadFailed: false });
    const [controller] = useState(() => createDiagramController(loadMermaid, setState));
    useEffect(() => {
      controller.update({
        code: props.code,
        dark: props.colorScheme === 'dark',
        streaming: props.streaming,
        active: props.active,
        interval,
      });
    }, [controller, props.code, props.colorScheme, props.streaming, props.active, interval]);
    useEffect(() => () => controller.dispose(), [controller]);
    const { view, loadFailed } = state;
    const labels = resolveLabels(defaultDiagramLabels, configuredLabels);
    const waiting = view.kind === 'source' && !loadFailed;
    return (
      <div className="aimd-diagram" aria-busy={waiting}>
        {view.kind === 'diagram' && <DiagramViewport diagram={view} />}
        {waiting && <p role="status">{props.streaming ? labels.waiting : labels.rendering}</p>}
        {(view.kind === 'error' || loadFailed) && (
          <div role="alert">
            <p>{view.kind === 'error' ? diagramErrorText(view, labels) : labels.loadFailed}</p>
            <button type="button" onClick={() => controller.retry()}>
              {labels.retry}
            </button>
          </div>
        )}
      </div>
    );
  };
}

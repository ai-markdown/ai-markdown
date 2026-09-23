'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAIMarkdownBehaviors } from '@ai-markdown/react';
import type { CodeBlockOptions } from '@ai-markdown/core/components';
import { createDiagramController, type CodeRendererInput, type DiagramState } from '@ai-markdown/core/components';
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
function DiagramViewport({ state }: { state: DiagramState }) {
  const target = useRef<HTMLDivElement>(null);
  const { svg, bind } = state;
  useLayoutEffect(() => {
    const element = target.current!;
    element.innerHTML = svg;
    bind?.(element);
    return () => {
      element.replaceChildren();
    };
  }, [svg, bind]);
  return <div ref={target} className="aimd-diagram-viewport" />;
}
export function createMermaidRenderer(configuredInterval?: number) {
  return function MermaidRenderer(props: CodeRendererInput) {
    const group = useAIMarkdownBehaviors().codeBlock as CodeBlockOptions | undefined;
    const requestedInterval = configuredInterval ?? group?.mermaidIntervalMs ?? 300;
    const interval = Number.isFinite(requestedInterval) && requestedInterval >= 0 ? requestedInterval : 300;
    const [state, setState] = useState<DiagramState>({ status: 'loading', svg: '' });
    const [retry, setRetry] = useState(0);
    const [controller] = useState(() => createDiagramController(loadMermaid, setState));
    useEffect(() => {
      controller.update({
        code: props.code,
        dark: props.colorScheme === 'dark',
        streaming: props.streaming,
        active: props.active,
        resetKey: props.resetKey,
        interval,
      });
    }, [controller, props.code, props.colorScheme, props.streaming, props.active, props.resetKey, retry, interval]);
    useEffect(() => () => controller.dispose(), [controller]);
    return (
      <div className="aimd-diagram" aria-busy={state.status === 'loading'}>
        {state.svg && <DiagramViewport state={state} />}
        {state.status === 'loading' && !state.svg && (
          <p role="status">{props.streaming ? 'Waiting for diagram…' : 'Rendering diagram…'}</p>
        )}
        {state.status === 'error' && (
          <div role="alert">
            <p>{state.error}</p>
            <button type="button" onClick={() => setRetry((value) => value + 1)}>
              Retry diagram
            </button>
          </div>
        )}
      </div>
    );
  };
}

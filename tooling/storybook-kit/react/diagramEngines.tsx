import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  diagramEngines,
  diagramLoader,
  diagramSources,
  diagramFence,
  failingDiagramLoader,
  type DiagramDemoEngine,
  type DiagramDemoScenario,
} from '../common/diagramEngines';
import type { DiagramEngineLoader } from '@ai-markdown/core/components';
export interface DiagramDemoState {
  engine: DiagramEngineLoader | false | undefined;
  fallback: boolean;
  content: string;
  streaming: boolean;
  colorScheme: 'light' | 'dark';
  document: number;
}
export function DiagramEnginesDemo({
  initialEngine = 'Pele',
  scenario = 'static',
  renderDocument,
}: {
  initialEngine?: DiagramDemoEngine;
  scenario?: DiagramDemoScenario;
  renderDocument(state: DiagramDemoState): ReactNode;
}) {
  const [engine, setEngine] = useState(initialEngine),
    [type, setType] = useState<keyof typeof diagramSources>('flowchart');
  const [dark, setDark] = useState(false),
    [fallback, setFallback] = useState(true),
    [document, setDocument] = useState(0),
    [length, setLength] = useState(12);
  const failure = useMemo(() => failingDiagramLoader(diagramLoader('Pele') as DiagramEngineLoader), []);
  const source = scenario === 'invalid' ? diagramSources.invalid : diagramSources[type];
  const streaming = scenario === 'streaming' && length < source.length;
  useEffect(() => {
    if (!streaming) return;
    const id = setInterval(() => setLength((n) => n + 6), 180);
    return () => clearInterval(id);
  }, [streaming]);
  return (
    <section style={{ padding: 20, background: dark ? '#202020' : '#fff', color: dark ? '#eee' : '#111' }}>
      <label>
        Engine{' '}
        <select
          aria-label="Diagram engine"
          value={engine}
          onChange={(e) => setEngine(e.target.value as DiagramDemoEngine)}
        >
          {diagramEngines.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>{' '}
      <label>
        Type{' '}
        <select
          aria-label="Diagram type"
          value={type}
          onChange={(e) => setType(e.target.value as keyof typeof diagramSources)}
        >
          {Object.keys(diagramSources).map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>{' '}
      <button onClick={() => setDark((v) => !v)}>Toggle theme</button>{' '}
      <button onClick={() => setDocument((n) => n + 1)}>New document</button>{' '}
      <label>
        <input type="checkbox" checked={fallback} onChange={(e) => setFallback(e.target.checked)} /> Unsupported type
        fallback
      </label>
      {scenario === 'failure' && <button onClick={failure.repair}>Restore connection, then retry diagram</button>}
      <p>
        Each engine keeps its own layout. Only an identified unsupported type can fall back. Native mount/zoom and
        server SVG rendering are outside this integration.
      </p>
      {renderDocument({
        engine: scenario === 'failure' ? failure.load : diagramLoader(engine),
        fallback,
        content: diagramFence(streaming ? source.slice(0, length) : source),
        streaming,
        colorScheme: dark ? 'dark' : 'light',
        document,
      })}
    </section>
  );
}

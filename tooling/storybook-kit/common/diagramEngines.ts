import { createPeleLoader, createOndineLoader, type DiagramEngineLoader } from '@ai-markdown/core/components';
export const diagramEngines = ['Mermaid', 'Pele', 'Ondine', 'Disabled', 'Ondine flowchart only'] as const;
export type DiagramDemoEngine = (typeof diagramEngines)[number];
export const diagramSources = {
  flowchart: 'flowchart LR\n  A[Source] --> B{Engine}\n  B --> C[SVG]',
  sequence: 'sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Ready',
  class: 'classDiagram\n  Animal <|-- Duck',
  invalid: 'flowchart LR\n  A --> [',
};
const pele = createPeleLoader(() => import('pele'), { renderOptions: { fontSize: 16 } });
const ondine = createOndineLoader(async () => {
  const [{ create }, { wasm }] = await Promise.all([
    import('ondine/compiler/wasm'),
    import('ondine/compiler/wasm/all'),
  ]);
  return create({ modules: { all: wasm } });
});
const flowchart = createOndineLoader(async () => {
  const [{ create }, { wasm }] = await Promise.all([
    import('ondine/compiler/wasm'),
    import('ondine/compiler/wasm/flowchart'),
  ]);
  return create({ modules: { flowchart: wasm } });
});
export function diagramLoader(name: DiagramDemoEngine): DiagramEngineLoader | false | undefined {
  return name === 'Mermaid'
    ? undefined
    : name === 'Pele'
      ? pele
      : name === 'Ondine'
        ? ondine
        : name === 'Disabled'
          ? false
          : flowchart;
}
export const diagramFence = (source: string) => '```mermaid\n' + source + '\n```';
export type DiagramDemoScenario = 'static' | 'streaming' | 'invalid' | 'failure';
/** Stable per-demo loader; the button can repair it without replacing the session. */
export function failingDiagramLoader(base: DiagramEngineLoader) {
  let offline = true;
  return {
    repair: () => {
      offline = false;
    },
    load: async () => {
      if (offline) throw new Error('Demo offline');
      return base();
    },
  };
}

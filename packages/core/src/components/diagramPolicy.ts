import type { DiagramEngineLoader } from './diagram';

/** Raised only for an identified diagram type unavailable in the selected engine. */
export class UnsupportedDiagramError extends Error {
  constructor(readonly diagramType: string) {
    super(`Unsupported diagram type: ${diagramType}`);
    this.name = 'UnsupportedDiagramError';
  }
}
export const resolveDiagramInterval = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 300;

/** Shared per loader, not per component. Rejected imports are never retained. */
export function createCachedDiagramLoader(load: DiagramEngineLoader): DiagramEngineLoader {
  let pending: ReturnType<DiagramEngineLoader> | undefined;
  return () =>
    (pending ??= Promise.resolve()
      .then(load)
      .catch((error: unknown) => {
        pending = undefined;
        throw error;
      }));
}
export function preloadDiagramEngine(load: DiagramEngineLoader): Promise<void> {
  return Promise.resolve()
    .then(load)
    .then(() => undefined);
}

export interface DiagramInput {
  code: string;
  colorScheme: 'light' | 'dark';
  streaming: boolean;
  active: boolean;
  resetKey: string;
  intervalMs?: number;
  load: DiagramEngineLoader;
  /** Absent in engine-independent entry points. Only a classified unsupported type can use this. */
  fallback?: DiagramEngineLoader;
}

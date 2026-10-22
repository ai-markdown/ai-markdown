import type { DiagramEngineLoader } from './diagram';
import { createCachedDiagramLoader, UnsupportedDiagramError } from './diagramPolicy';

/** Structural subset; generic options preserve the installed engine's own parameter types. */
export interface SvgRendererModule<Options extends object = { idPrefix?: string; limit?: number }> {
  render(source: string, options?: Options): { svg: string; type?: string } | Promise<{ svg: string; type?: string }>;
}
export interface DiagramAdapterOptions<Options extends object> {
  renderOptions?: Omit<Options, 'idPrefix'>;
}
function createSvgLoader<Options extends object>(
  load: () => Promise<SvgRendererModule<Options>>,
  palette: 'pele' | 'ondine',
  options?: DiagramAdapterOptions<Options>
): DiagramEngineLoader {
  const renderOptions = { ...options?.renderOptions };
  const limit = (renderOptions as { limit?: number }).limit ?? 50_000;
  if (!Number.isFinite(limit) || limit < 0) throw new RangeError('Diagram limit must be a finite non-negative number');
  return createCachedDiagramLoader(async () => {
    const renderer = await load();
    return {
      kind: 'svg',
      palette,
      maxTextSize: limit,
      async render(id, code) {
        try {
          const result = await renderer.render(code, { ...renderOptions, idPrefix: id, limit } as Options);
          return { svg: result.svg, diagramType: result.type };
        } catch (error) {
          const diagnostic = error as { code?: unknown; type?: unknown } | null;
          if (diagnostic?.code === 'unsupported-diagram' && typeof diagnostic.type === 'string' && diagnostic.type)
            throw new UnsupportedDiagramError(diagnostic.type);
          throw error;
        }
      },
    };
  });
}
export function createPeleLoader<Options extends object>(
  load: () => Promise<SvgRendererModule<Options>>,
  options?: DiagramAdapterOptions<Options>
): DiagramEngineLoader {
  return createSvgLoader(load, 'pele', options);
}
export function createOndineLoader<Options extends object>(
  load: () => Promise<SvgRendererModule<Options>>,
  options?: DiagramAdapterOptions<Options>
): DiagramEngineLoader {
  return createSvgLoader(load, 'ondine', options);
}

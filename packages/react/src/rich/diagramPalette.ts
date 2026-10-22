import type { DiagramView } from '@ai-markdown/core/components';
/** Resolve native CSS overrides before filling missing values on this SVG. The values travel with SVG exports. */
export function applyDiagramPalette(host: HTMLElement, view: Extract<DiagramView, { kind: 'diagram' }>) {
  if (!view.palette) return;
  const svg = host.querySelector('svg');
  if (!svg) return;
  const dark = view.dark;
  const colors: Record<string, string> = dark
    ? {
        bg: '#242424',
        fg: '#eeeeee',
        line: '#cccccc',
        muted: '#bbbbbb',
        surface: '#303030',
        'surface-alt': '#404040',
        border: '#aaaaaa',
        accent: '#90b8ff',
      }
    : {
        bg: '#ffffff',
        fg: '#202020',
        line: '#333333',
        muted: '#555555',
        surface: '#f3f3f3',
        'surface-alt': '#e6e6e6',
        border: '#777777',
        accent: '#245db0',
      };
  const computed = host.ownerDocument.defaultView?.getComputedStyle(svg);
  for (const [key, fallback] of Object.entries(colors)) {
    const property = `--${view.palette}-${key}`;
    svg.style.setProperty(property, computed?.getPropertyValue(property).trim() || fallback);
  }
  svg.style.colorScheme = dark ? 'dark' : 'light';
}

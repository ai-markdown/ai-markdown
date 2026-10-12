import type { ImageActionIconName } from './image';

/**
 * The text of one component, as a partial override of its English defaults.
 * A function is read on every render, so it can follow an application's own
 * i18n state. This package ships no translations.
 */
export type LabelsOption<T> = Partial<T> | (() => Partial<T>);

/** The defaults with the supplied entries on top. An entry set to `undefined` keeps its default. */
export function resolveLabels<T extends object>(defaults: T, option?: LabelsOption<T>): T {
  const overrides = typeof option === 'function' ? option() : option;
  if (!overrides) return defaults;
  const labels = { ...defaults };
  for (const key of Object.keys(overrides) as Array<keyof T>) {
    const value = overrides[key];
    if (value !== undefined) labels[key] = value as T[keyof T];
  }
  return labels;
}

export interface CodeBlockLabels {
  /** Accessible name of the toolbar. */
  actions: string;
  /** Language shown for a block that has none. */
  plainText: string;
  copy: string;
  copied: string;
  copyFailed: string;
  showSource: string;
  showPreview: string;
  expand: string;
  collapse: string;
  /** Shown above the source when a language renderer throws. */
  previewFailed: string;
}
export const defaultCodeBlockLabels: Readonly<CodeBlockLabels> = Object.freeze({
  actions: 'Code block actions',
  plainText: 'text',
  copy: 'Copy code',
  copied: 'Copied',
  copyFailed: 'Copy failed',
  showSource: 'Show source',
  showPreview: 'Show preview',
  expand: 'Expand',
  collapse: 'Collapse',
  previewFailed: 'Preview failed. Source is available below.',
});

export interface DiagramLabels {
  /** Nothing has rendered yet and the document is still streaming. */
  waiting: string;
  /** Nothing has rendered yet and the source is complete. */
  rendering: string;
  /** The engine module could not be downloaded. */
  loadFailed: string;
  retry: string;
  /** The engine failed without a message of its own. */
  renderFailed: string;
  /** The source is longer than the engine's `maxTextSize`. */
  tooLarge: (length: number, limit: number) => string;
}
export const defaultDiagramLabels: Readonly<DiagramLabels> = Object.freeze({
  waiting: 'Waiting for diagram…',
  rendering: 'Rendering diagram…',
  loadFailed: 'Diagram engine could not load.',
  retry: 'Retry diagram',
  renderFailed: 'Mermaid could not render this diagram.',
  tooLarge: (length: number, limit: number) =>
    `Diagram source is ${length} characters, above mermaid's maxTextSize of ${limit}.`,
});

export interface ImageLabels extends Record<ImageActionIconName, string> {
  loading: string;
  loadFailed: string;
  /** Accessible name of the button that opens the preview. Receives the image's `alt`, which may be empty. */
  open: (alt: string) => string;
  /** Accessible name of a previewed image that has no `alt`. */
  preview: string;
  /** Accessible name of the preview toolbar. */
  actions: string;
}
export const defaultImageLabels: Readonly<ImageLabels> = Object.freeze({
  close: 'Close preview',
  prev: 'Previous image',
  next: 'Next image',
  rotateLeft: 'Rotate left',
  rotateRight: 'Rotate right',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  flipX: 'Flip horizontally',
  flipY: 'Flip vertically',
  loading: 'Loading image…',
  loadFailed: 'Image could not be loaded.',
  open: (alt: string) => `Preview image${alt ? `: ${alt}` : ''}`,
  preview: 'Image preview',
  actions: 'Image preview actions',
});

/** Why a table has no export. `projectTable` reports one of these; `TableLabels` has the text for each. */
export type TableExportReason =
  'mergedCells' | 'notRectangular' | 'unsupportedStructure' | 'unsupportedContent' | 'unavailable';

export interface TableLabels extends Record<TableExportReason, string> {
  /** Accessible name of the toolbar. */
  actions: string;
  copy: string;
  download: string;
  copied: string;
  copyFailed: string;
  /** Accessible name of the scrolling region. */
  scrollRegion: string;
}
export const defaultTableLabels: Readonly<TableLabels> = Object.freeze({
  actions: 'Table actions',
  copy: 'Copy table',
  download: 'Download CSV',
  copied: 'Table copied',
  copyFailed: 'Copy failed',
  scrollRegion: 'Scrollable table',
  mergedCells: 'Only tables without merged cells can be exported',
  notRectangular: 'Only rectangular tables can be exported',
  unsupportedStructure: 'Unsupported table structure',
  unsupportedContent: 'Unsupported table content',
  unavailable: 'Table source is unavailable',
});

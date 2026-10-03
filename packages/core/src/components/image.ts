/** Shared image semantics; no DOM or framework dependency. */
export type ImageActionIconName =
  'rotateLeft' | 'rotateRight' | 'zoomIn' | 'zoomOut' | 'close' | 'prev' | 'next' | 'flipX' | 'flipY';
export type ImageIconName = 'placeholder' | 'error' | 'preview' | 'gallery' | ImageActionIconName;
export type ImageLoadStatus = 'loading' | 'ready' | 'error';
/** Lucide paths supplied for the Markdown image skin (ISC license). */
export const imageIconPaths: Record<ImageIconName, readonly string[]> = {
  rotateLeft: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'],
  rotateRight: ['M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8', 'M21 3v5h-5'],
  zoomIn: ['M19 11a8 8 0 1 1 -16 0a8 8 0 1 1 16 0', 'M21 21L16.65 16.65', 'M11 8L11 14', 'M8 11L14 11'],
  zoomOut: ['M19 11a8 8 0 1 1 -16 0a8 8 0 1 1 16 0', 'M21 21L16.65 16.65', 'M8 11L14 11'],
  close: ['M18 6 6 18', 'm6 6 12 12'],
  prev: ['m15 18-6-6 6-6'],
  next: ['m9 18 6-6-6-6'],
  flipX: [
    'M8 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h3',
    'M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3',
    'M12 20v2',
    'M12 14v2',
    'M12 8v2',
    'M12 2v2',
  ],
  flipY: [
    'M21 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v3',
    'M21 16v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3',
    'M4 12H2',
    'M10 12H8',
    'M16 12h-2',
    'M22 12h-2',
  ],
  placeholder: [
    'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z',
    'M11 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
    'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21',
  ],
  error: [
    'm2 2 20 20M10.41 10.41a2 2 0 1 1-2.83-2.83m5.92 5.92L6 21m12-9 3 3',
    'M3.59 3.59A2 2 0 0 0 3 5v14a2 2 0 0 0 2 2h14c.55 0 1.052-.22 1.41-.59M21 15V5a2 2 0 0 0-2-2H9',
  ],
  gallery: ['M5 3h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z', 'M4 21h1m4 0h1m4 0h1m4 0h1'],
  preview: [
    'M15 15.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997a1 1 0 0 1-1.517-.86z',
    'M21 12.17V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6m-5 0 5-5',
    'M11 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
  ],
};
export const imageGroupSelector = '[data-aimd-image-scope], .aim-typography-root, .aimd-vue, .mantine-Typography-root';
export interface ImageGalleryItem {
  id: object;
  src: string;
  alt: string;
  /** DOM adapters provide document ordering without leaking DOM types. */
  precedes: (other: object) => boolean;
}
export interface ImageGallery {
  items: () => readonly ImageGalleryItem[];
  subscribe: (listener: () => void) => () => void;
  set: (item: ImageGalleryItem) => void;
  remove: (id: object) => void;
}
const galleries = new WeakMap<object, ImageGallery>();
/** Scope is an adapter-owned object, never a global document id. */
export function getImageGallery(scope: object): ImageGallery {
  const existing = galleries.get(scope);
  if (existing) return existing;
  const entries = new Map<object, ImageGalleryItem>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const gallery: ImageGallery = {
    items: () => [...entries.values()].sort((a, b) => (a.precedes(b.id) ? -1 : b.precedes(a.id) ? 1 : 0)),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(item) {
      const old = entries.get(item.id);
      if (old?.src === item.src && old?.alt === item.alt) return;
      entries.set(item.id, item);
      notify();
    },
    remove(id) {
      if (entries.delete(id)) notify();
    },
  };
  galleries.set(scope, gallery);
  return gallery;
}

export const imageActionLabels: Record<ImageActionIconName, string> = {
  close: 'Close preview',
  prev: 'Previous image',
  next: 'Next image',
  rotateLeft: 'Rotate left',
  rotateRight: 'Rotate right',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  flipX: 'Flip horizontally',
  flipY: 'Flip vertically',
};

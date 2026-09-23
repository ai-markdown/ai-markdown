/** Shared image semantics; no DOM or framework dependency. */
export type ImageIconName = 'placeholder' | 'error' | 'preview' | 'gallery';
export type ImageLoadStatus = 'loading' | 'ready' | 'error';
/** Lucide paths supplied for the Markdown image skin (ISC license). */
export const imageIconPaths: Record<ImageIconName, readonly string[]> = {
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

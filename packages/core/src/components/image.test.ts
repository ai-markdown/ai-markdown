import { describe, expect, it, vi } from 'vitest';
import { getImageGallery, type ImageGalleryItem } from './image';
describe('image gallery lifecycle', () => {
  const item = (id: { order: number }, src = 'photo'): ImageGalleryItem => ({
    id,
    src,
    alt: 'photo',
    precedes: (other) => id.order < (other as typeof id).order,
  });
  it('isolates roots, orders asynchronous loads by document order and preserves duplicate URLs', () => {
    const scope = {},
      gallery = getImageGallery(scope);
    const first = { order: 1 },
      last = { order: 3 },
      middle = { order: 2 };
    gallery.set(item(last));
    gallery.set(item(first));
    gallery.set(item(middle));
    expect(gallery.items().map((entry) => entry.id)).toEqual([first, middle, last]);
    expect(getImageGallery(scope)).toBe(gallery);
    expect(getImageGallery({}).items()).toEqual([]);
    first.order = 4;
    expect(gallery.items().map((entry) => entry.id)).toEqual([middle, last, first]);
  });
  it('notifies changes without re-emitting unchanged loads and removes departed images', () => {
    const gallery = getImageGallery({}),
      id = { order: 1 },
      listener = vi.fn();
    const unsubscribe = gallery.subscribe(listener);
    gallery.set(item(id));
    gallery.set(item(id));
    expect(listener).toHaveBeenCalledTimes(1);
    gallery.set(item(id, 'updated'));
    expect(gallery.items()[0].src).toBe('updated');
    gallery.remove(id);
    gallery.remove(id);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(gallery.items()).toEqual([]);
    unsubscribe();
    gallery.set(item(id));
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

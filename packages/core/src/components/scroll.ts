/** Structural browser target keeps the shared core independent of DOM libs.
 * Several React/Vue dialogs can coexist; the last owner restores scrolling. */
const locks = new WeakMap<object, { count: number; overflow: string }>();
export function lockImagePreviewScroll(target: { style: { overflow: string } }): () => void {
  let lock = locks.get(target);
  if (!lock) {
    lock = { count: 0, overflow: target.style.overflow };
    locks.set(target, lock);
  }
  lock.count++;
  target.style.overflow = 'hidden';
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--lock.count === 0) {
      if (target.style.overflow === 'hidden') target.style.overflow = lock.overflow;
      locks.delete(target);
    }
  };
}

/** Structural browser target keeps the shared core independent of DOM libs.
 * Several React/Vue dialogs can coexist; the last owner restores scrolling. */
const locks = new WeakMap<object, { count: number; overflow: string; paddingRight: string | undefined }>();
/**
 * Stops the page behind a preview from scrolling. `scrollbarWidth` is the
 * width of the scrollbar that hiding the overflow removes
 * (`window.innerWidth - document.documentElement.clientWidth`); the same width
 * is added as padding so the page does not shift sideways. Pass zero, or
 * nothing, when the scrollbar takes no space.
 */
export function lockImagePreviewScroll(
  target: { style: { overflow: string; paddingRight?: string } },
  scrollbarWidth = 0
): () => void {
  let lock = locks.get(target);
  if (!lock) {
    lock = { count: 0, overflow: target.style.overflow, paddingRight: target.style.paddingRight };
    locks.set(target, lock);
    if (scrollbarWidth > 0)
      target.style.paddingRight = lock.paddingRight
        ? `calc(${lock.paddingRight} + ${scrollbarWidth}px)`
        : `${scrollbarWidth}px`;
  }
  lock.count++;
  target.style.overflow = 'hidden';
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--lock.count === 0) {
      if (target.style.overflow === 'hidden') target.style.overflow = lock.overflow;
      target.style.paddingRight = lock.paddingRight;
      locks.delete(target);
    }
  };
}

/** Transform rules adapted from @rc-component/image 1.10.0 (MIT, Copyright (c) 2019-present react-component; see LICENSE).
 * Pure functions; `createImagePreviewController` applies them. */
export interface ImageTransform {
  x: number;
  y: number;
  rotate: number;
  scale: number;
  flipX: boolean;
  flipY: boolean;
}
export interface ImageGeometry {
  width: number;
  height: number;
  left: number;
  top: number;
  viewportWidth: number;
  viewportHeight: number;
}
export const initialImageTransform = (): ImageTransform => ({
  x: 0,
  y: 0,
  rotate: 0,
  scale: 1,
  flipX: false,
  flipY: false,
});
export function imageTransformStyle(transform: ImageTransform): string {
  const { x, y, scale, rotate, flipX, flipY } = transform;
  return `translate3d(${x}px, ${y}px, 0) scale3d(${flipX ? '-' : ''}${scale}, ${flipY ? '-' : ''}${scale}, 1) rotate(${rotate}deg)`;
}
const DEFAULT_SCALE_LIMITS = { min: 1, max: 50 };
/** Scales by `ratio` about a viewport point, keeping the image point under it in place, within `limits`. */
export function zoomImage(
  transform: ImageTransform,
  ratio: number,
  geometry: ImageGeometry,
  centerX = geometry.viewportWidth / 2,
  centerY = geometry.viewportHeight / 2,
  touch = false,
  limits: { min: number; max: number } = DEFAULT_SCALE_LIMITS
): ImageTransform {
  if (!Number.isFinite(ratio) || ratio <= 0) return transform;
  // A pinch may pass below the minimum while the fingers are down; `reboundImage` brings it back.
  const floor = touch ? 0.01 : limits.min;
  const scale = Math.min(limits.max, Math.max(floor, transform.scale * ratio));
  const difference = scale / transform.scale - 1;
  let x = transform.x - difference * (centerX - transform.x - geometry.left - geometry.width / 2);
  let y = transform.y - difference * (centerY - transform.y - geometry.top - geometry.height / 2);
  if (
    ratio < 1 &&
    scale === 1 &&
    geometry.width <= geometry.viewportWidth &&
    geometry.height <= geometry.viewportHeight
  )
    x = y = 0;
  return { ...transform, x, y, scale };
}
/**
 * The zoom factor for one wheel event. A full notch (100 pixels) is one 1.5x
 * step, and a smaller delta a proportional part of it.
 * - `mode` is `WheelEvent.deltaMode`. Some browsers and mice report lines or
 *   pages, not pixels: three lines or one page count as a notch.
 * - `pinch` is a trackpad pinch, which arrives as a wheel event with the
 *   control key set and small deltas. It scales continuously with the delta.
 * - `step` is what a full notch adds to the scale factor: 0.5 makes it 1.5x.
 */
export function imageWheelRatio(delta: number, mode = 0, pinch = false, step = 0.5): number {
  if (!Number.isFinite(delta) || delta === 0) return 1;
  if (pinch) return Math.min(1 + step, Math.max(1 / (1 + step), Math.exp(-delta / 100)));
  const pixels = mode === 1 ? (delta * 100) / 3 : mode === 2 ? delta * 100 : delta;
  const ratio = 1 + Math.min(Math.abs(pixels / 100), 1) * step;
  return pixels > 0 ? 1 / ratio : ratio;
}
/** Snap a moved image back inside the viewport, taking quarter turns into account. */
export function reboundImage(
  transform: ImageTransform,
  geometry: ImageGeometry,
  bounds: { left: number; top: number },
  minScale = 1
): ImageTransform {
  if (transform.scale < minScale) return { ...transform, x: 0, y: 0, scale: minScale };
  const rotated = transform.rotate % 180 !== 0;
  const width = (rotated ? geometry.height : geometry.width) * transform.scale;
  const height = (rotated ? geometry.width : geometry.height) * transform.scale;
  if (width <= geometry.viewportWidth && height <= geometry.viewportHeight) return { ...transform, x: 0, y: 0 };
  const fix = (position: number, start: number, size: number, viewport: number) => {
    const offset = (size - viewport) / 2;
    if (size > viewport) {
      if (start > 0) return offset;
      if (start < 0 && start + size < viewport) return -offset;
    } else if (start < 0 || start + size > viewport) return start < 0 ? offset : -offset;
    return position;
  };
  return {
    ...transform,
    x: fix(transform.x, bounds.left, width, geometry.viewportWidth),
    y: fix(transform.y, bounds.top, height, geometry.viewportHeight),
  };
}
/** Upstream pinch center weights each finger by how far it moved. */
export function imagePinchCenter(
  oldA: { x: number; y: number },
  oldB: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): { x: number; y: number } {
  const distanceA = Math.hypot(a.x - oldA.x, a.y - oldA.y),
    distanceB = Math.hypot(b.x - oldB.x, b.y - oldB.y);
  const ratio = distanceA + distanceB ? distanceA / (distanceA + distanceB) : 0;
  return { x: oldA.x + ratio * (oldB.x - oldA.x), y: oldA.y + ratio * (oldB.y - oldA.y) };
}

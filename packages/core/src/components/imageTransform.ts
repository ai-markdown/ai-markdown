/** Transform rules adapted from @rc-component/image 1.10.0 (MIT).
 * Keep the Vue adapter's gestures aligned with the upstream React engine. */
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
export function zoomImage(
  transform: ImageTransform,
  ratio: number,
  geometry: ImageGeometry,
  centerX = geometry.viewportWidth / 2,
  centerY = geometry.viewportHeight / 2,
  touch = false
): ImageTransform {
  if (!Number.isFinite(ratio) || ratio <= 0) return transform;
  const scale = Math.min(50, touch ? Math.max(0.01, transform.scale * ratio) : Math.max(1, transform.scale * ratio));
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
export function imageWheelRatio(delta: number): number {
  const ratio = 1 + Math.min(Math.abs(delta / 100), 1) * 0.5;
  return delta > 0 ? 1 / ratio : ratio;
}
/** Snap a moved image back inside the viewport, taking quarter turns into account. */
export function reboundImage(
  transform: ImageTransform,
  geometry: ImageGeometry,
  bounds: { left: number; top: number }
): ImageTransform {
  if (transform.scale < 1) return { ...transform, x: 0, y: 0, scale: 1 };
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

import { describe, expect, it } from 'vitest';
import {
  imagePinchCenter,
  imageTransformStyle,
  imageWheelRatio,
  initialImageTransform,
  reboundImage,
  zoomImage,
} from './imageTransform';
const box = { width: 600, height: 400, left: 200, top: 200, viewportWidth: 1000, viewportHeight: 800 };
describe('rc-image transform contract', () => {
  it('keeps the pointer anchored while scaling and clamps toolbar zoom to 1–50', () => {
    const zoomed = zoomImage(initialImageTransform(), 1.5, box, 700, 500);
    expect(zoomed).toMatchObject({ scale: 1.5, x: -100, y: -50 });
    expect(zoomImage(zoomed, 1 / 1.5, box, 700, 500)).toEqual(initialImageTransform());
    expect(zoomImage(initialImageTransform(), 100, box).scale).toBe(50);
    expect(zoomImage(initialImageTransform(), 0.1, box)).toEqual(initialImageTransform());
  });
  it('bounds wheel acceleration without discarding small trackpad movements', () => {
    expect(imageWheelRatio(-1000)).toBe(1.5);
    expect(imageWheelRatio(-10)).toBe(1.05);
    expect(imageWheelRatio(100)).toBe(1 / 1.5);
  });
  it('treats line and page wheel deltas as notches, and a trackpad pinch as continuous', () => {
    // Three lines, or one page, are the 100 pixels of one notch.
    expect(imageWheelRatio(3, 1)).toBe(1 / 1.5);
    expect(imageWheelRatio(-3, 1)).toBe(1.5);
    expect(imageWheelRatio(1, 1)).toBeCloseTo(1 / (1 + 1 / 6), 12);
    expect(imageWheelRatio(-1, 2)).toBe(1.5);
    expect(imageWheelRatio(-10, 0, true)).toBeCloseTo(Math.exp(0.1), 12);
    expect(imageWheelRatio(10, 0, true)).toBeCloseTo(Math.exp(-0.1), 12);
    expect(imageWheelRatio(-5000, 0, true)).toBe(1.5);
    expect(imageWheelRatio(0)).toBe(1);
    expect(imageWheelRatio(Number.NaN)).toBe(1);
  });
  it('takes its limits, its step and its smallest size from the caller', () => {
    const limits = { min: 0.5, max: 4 };
    expect(zoomImage(initialImageTransform(), 0.1, box, 500, 400, false, limits).scale).toBe(0.5);
    expect(zoomImage(initialImageTransform(), 100, box, 500, 400, false, limits).scale).toBe(4);
    expect(imageWheelRatio(-100, 0, false, 1)).toBe(2);
    expect(imageWheelRatio(50, 0, false, 1)).toBe(1 / 1.5);
    expect(imageWheelRatio(-5000, 0, true, 1)).toBe(2);
    const small = { ...initialImageTransform(), scale: 0.2, x: 30, y: 40 };
    expect(reboundImage(small, box, { left: 0, top: 0 }, 0.5)).toMatchObject({ scale: 0.5, x: 0, y: 0 });
  });
  it('keeps the point under the pointer fixed when the image is rotated or flipped', () => {
    // The image point under a viewport point P is found by undoing translate, scale/flip and rotation
    // about the layout centre. Zooming about P must leave that image point under P.
    const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const imagePoint = (t: ReturnType<typeof initialImageTransform>, px: number, py: number) => {
      const dx = (px - centre.x - t.x) / (t.scale * (t.flipX ? -1 : 1));
      const dy = (py - centre.y - t.y) / (t.scale * (t.flipY ? -1 : 1));
      const angle = (-t.rotate * Math.PI) / 180;
      return { x: dx * Math.cos(angle) - dy * Math.sin(angle), y: dx * Math.sin(angle) + dy * Math.cos(angle) };
    };
    for (const rotate of [0, 90, 180, 270, -90])
      for (const [flipX, flipY] of [
        [false, false],
        [true, false],
        [false, true],
        [true, true],
      ]) {
        const before = { ...initialImageTransform(), rotate, flipX, flipY, x: 40, y: -25, scale: 2 };
        const after = zoomImage(before, 1.5, box, 640, 310);
        const a = imagePoint(before, 640, 310),
          b = imagePoint(after, 640, 310);
        expect(b.x).toBeCloseTo(a.x, 9);
        expect(b.y).toBeCloseTo(a.y, 9);
      }
  });
  it('allows a pinch below 1x then rebounds at gesture end', () => {
    const pinched = zoomImage(initialImageTransform(), 0.5, box, 600, 500, true);
    expect(pinched.scale).toBe(0.5);
    expect(reboundImage(pinched, box, { left: 0, top: 0 })).toEqual(initialImageTransform());
  });
  it('centers a small image and constrains a large image at both viewport edges', () => {
    expect(reboundImage({ ...initialImageTransform(), x: 30, y: 40 }, box, { left: 230, top: 240 })).toEqual(
      initialImageTransform()
    );
    const large = { ...initialImageTransform(), scale: 3, x: 800, y: -800 };
    expect(reboundImage(large, box, { left: 400, top: -1000 })).toMatchObject({ x: 400, y: -200 });
    expect(reboundImage({ ...large, rotate: 90 }, box, { left: 400, top: -1300 })).toMatchObject({ x: 100, y: -500 });
  });
  it('uses the stationary finger as the zoom center for an asymmetric pinch', () => {
    expect(imagePinchCenter({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }, { x: 150, y: 0 })).toEqual({
      x: 0,
      y: 0,
    });
    expect(imagePinchCenter({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: -50, y: 0 }, { x: 150, y: 0 })).toEqual({
      x: 50,
      y: 0,
    });
  });
  it('rejects degenerate pinch ratios and retains flip/rotation through zoom', () => {
    const initial = { ...initialImageTransform(), rotate: 90, flipX: true };
    expect(zoomImage(initial, Infinity, box)).toEqual(initial);
    expect(zoomImage(initial, 0, box)).toEqual(initial);
    expect(imageTransformStyle(zoomImage(initial, 1.5, box))).toBe(
      'translate3d(0px, 0px, 0) scale3d(-1.5, 1.5, 1) rotate(90deg)'
    );
  });
});

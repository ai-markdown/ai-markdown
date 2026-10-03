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

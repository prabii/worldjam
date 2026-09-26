/**
 * Maps between the camera frame and the on-screen preview.
 *
 * The preview fills its view with `cover` scaling, so part of the frame is
 * cropped off-screen. Detections are normalised to the full upright frame;
 * everything drawn or tapped on screen must go through the same crop.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CoverMap {
  /** Frame-normalised box → view pixels. */
  boxToView(b: Box): Box;
  /** Frame-normalised point → view-normalised (0..1) point. */
  pointToView(x: number, y: number): { x: number; y: number };
  /** View-normalised point → frame-normalised point (for taps). */
  pointToFrame(x: number, y: number): { x: number; y: number };
}

/** @param frameAspect upright frame width / height */
export function coverMap(viewW: number, viewH: number, frameAspect: number): CoverMap {
  let scaleW = viewW;
  let scaleH = viewH;
  let offX = 0;
  let offY = 0;
  if (viewW > 0 && viewH > 0 && frameAspect > 0) {
    if (viewW / viewH > frameAspect) {
      scaleH = viewW / frameAspect;
      offY = (viewH - scaleH) / 2;
    } else {
      scaleW = viewH * frameAspect;
      offX = (viewW - scaleW) / 2;
    }
  }
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  return {
    boxToView: (b) => ({
      x: offX + b.x * scaleW,
      y: offY + b.y * scaleH,
      width: b.width * scaleW,
      height: b.height * scaleH,
    }),
    pointToView: (x, y) => ({
      x: viewW > 0 ? clamp01((offX + x * scaleW) / viewW) : x,
      y: viewH > 0 ? clamp01((offY + y * scaleH) / viewH) : y,
    }),
    pointToFrame: (x, y) => ({
      x: scaleW > 0 ? clamp01((x * viewW - offX) / scaleW) : x,
      y: scaleH > 0 ? clamp01((y * viewH - offY) / scaleH) : y,
    }),
  };
}

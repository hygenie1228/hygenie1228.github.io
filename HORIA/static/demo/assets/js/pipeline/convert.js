/**
 * Source conventions to three.js.
 *
 * There is deliberately very little here, and that is the finding rather than
 * an oversight: `transforms.json` is nerfstudio c2w/OpenGL, which is already
 * three.js's own convention, and `export_web_assets.py` converts the one input
 * that is not (the 4DGS orbit path, stored w2c/OpenCV) before it reaches the
 * browser. So the only conversion left is array-to-Matrix4.
 *
 * The check that proves all of this holds is in the plan: project the joints
 * through camera 22 and overlay the result on that camera's generated frame.
 * Re-run it after touching anything in this file.
 */
import { Color, Matrix4, Vector3 } from "../vendor/three.module.js";
import { clamp } from "./math.js";

/** Camera-to-world Matrix4 from the flat column-major array in cameras.json. */
export function matrixFromCamera(camera) {
  return new Matrix4().fromArray(camera.matrix);
}

/** World-space position of a camera, i.e. the translation column of its c2w. */
export function positionFromCamera(camera) {
  return new Vector3(camera.matrix[12], camera.matrix[13], camera.matrix[14]);
}

/**
 * Half-extents of a camera's image plane at `depth` metres in front of it.
 *
 * Straight from the pinhole model, so the frustum on screen has the same shape
 * as the real optics: this rig is 24.4° horizontal by 42.1° vertical, which is
 * much narrower than a frustum usually looks. Widening it would read better and
 * would be a lie, so the only knob the scene turns is `depth`.
 */
export function planeHalfExtents(camera, depth) {
  return {
    x: (depth * camera.width) / (2 * camera.fx),
    y: (depth * camera.height) / (2 * camera.fy),
  };
}

const colorCache = new Map();

/** Cached Color from a "#rrggbb" string — the palette has ~9 distinct values. */
export function color(hex) {
  let value = colorCache.get(hex);
  if (!value) {
    value = new Color(hex);
    colorCache.set(hex, value);
  }
  return value;
}

/** Reads a CSS custom property off :root as a Color, so tokens stay the source. */
export function tokenColor(name, fallback = "#ffffff") {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new Color(raw || fallback);
}

/** Joint positions of one frame as a flat Float32Array, ready for an attribute. */
export function frameJoints(skeleton, frame) {
  const clamped = clamp(frame, 0, skeleton.num_frames - 1);
  const source = skeleton.joints[clamped];
  const out = new Float32Array(skeleton.num_joints * 3);
  for (let i = 0; i < skeleton.num_joints; i += 1) {
    out[i * 3] = source[i][0];
    out[i * 3 + 1] = source[i][1];
    out[i * 3 + 2] = source[i][2];
  }
  return out;
}

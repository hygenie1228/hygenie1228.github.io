/**
 * Act 4: the 4D Gaussian reconstruction, standing where the skeleton stood.
 *
 * Act 3 and act 4 are the same shot. The camera does not move, the ring does
 * not recede, the twenty-four generated views keep playing — the *only* thing
 * that changes is that the stick figure and its point cloud are replaced by the
 * reconstruction they produced. Everything else staying put is what makes the
 * substitution legible as a substitution rather than as a new scene.
 *
 * That rules out the obvious construction, which is to fly the camera onto the
 * pose `orbit360_cam10/extri.yml` records and hang the render on that camera's
 * image plane. It is the tightest possible frame-lock and it was built that way
 * first, but it requires the camera to move, which is exactly what act 4 is not
 * allowed to do.
 *
 * So the render is a billboard instead: a plane at the subject's own world
 * position, turned to face the reader, sized so the reconstructed person comes
 * out life-size. The render's camera orbits while the reader's does not, so the
 * figure turns in place as it plays — which is a fair reading of what a 4D
 * reconstruction is for, and the caption says as much.
 */
import { DoubleSide, Group, Mesh, PlaneGeometry, Vector3 } from "../vendor/three.module.js";
import { NO_GLOW_LAYER } from "./bloom.js";
import { clamp } from "./math.js";
import { createMatteMaterial } from "./plane-material.js";

export function createFlight({ orbit, video, centre }) {
  if (!orbit?.cameras?.length) return null;

  const first = orbit.cameras[0];
  const firstPosition = new Vector3(first.matrix[12], first.matrix[13], first.matrix[14]);

  const target = centre ? new Vector3(centre[0], 1.0, centre[2]) : new Vector3(0, 1, 0);

  // Size the billboard so the reconstruction comes out life-size.
  //
  // The render's frame, at the distance the render camera stood from the
  // subject, covers a rectangle of this height in world units. Reproducing that
  // rectangle at the subject's position puts the reconstructed person at the
  // scale the skeleton it replaces was drawn at — which is the whole point of a
  // substitution the reader is meant to read as one.
  const orbitDistance = firstPosition.distanceTo(target);
  const fy = first.fy ?? 1664;
  const width = first.width ?? 704;
  const height = first.height ?? 1280;
  const planeHeight = (orbitDistance * height) / fy;
  const planeWidth = (planeHeight * width) / height;

  const rig = new Group();
  rig.name = "flight";
  rig.position.copy(target);

  const geometry = new PlaneGeometry(planeWidth, planeHeight);
  // The render and its RMBG-2.0 foreground matte share one vertically stacked
  // H.264 frame. `createMatteMaterial` samples both halves and composites the
  // black-backed RGB with premultiplied alpha. A separate alpha video would add
  // a decoder and a second clock; brightness-keying the black background could
  // not distinguish it from the subject's dark clothing.
  const material = createMatteMaterial();
  material.side = DoubleSide;
  // Attached now, replaced on `ready`: sampling an HTMLVideoElement before its
  // first frame is a WebGL INVALID_VALUE on every render until it arrives.
  //
  // The poster is cut from the orbit frame that matches act 3's default viewing
  // angle, not from frame 0. Frame 0 looks at the subject's back, so a reader
  // whose video is still loading would see the reconstruction facing the wrong
  // way — the exact thing the frame matching exists to prevent.
  material.uniforms.uMap.value = video.poster ?? null;
  const plane = new Mesh(geometry, material);
  plane.frustumCulled = false;
  plane.renderOrder = 2;
  plane.layers.set(NO_GLOW_LAYER);
  rig.add(plane);

  video.ready.then(
    (texture) => {
      material.uniforms.uMap.value = texture;
    },
    (error) => console.warn("[pipeline] 4DGS render unavailable", error),
  );

  // How far the render's camera has swung by each frame, in RADIANS, unwrapped
  // from frame 0. The unit is in the name and in this sentence because the last
  // accessor here returned radians, was consumed as degrees, and put the reader
  // 110 degrees from where they belonged once per loop.
  //
  // The clip covers 340 degrees, not 360, so the step from the last frame back
  // to the first is +20 degrees rather than a jump home — which is why the
  // caller accumulates *shortest* differences and gets a continuous turn across
  // the loop for free.
  const sweeps = [];
  {
    let previous = null;
    let total = 0;
    orbit.cameras.forEach((entry) => {
      const azimuth = Math.atan2(entry.matrix[14] - target.z, entry.matrix[12] - target.x);
      if (previous !== null) {
        let step = azimuth - previous;
        step -= Math.PI * 2 * Math.round(step / (Math.PI * 2));
        total += step;
      }
      previous = azimuth;
      sweeps.push(total);
    });
  }

  const facing = new Vector3();

  return {
    group: rig,
    target,
    numFrames: orbit.cameras.length,

    /**
     * @param {number} n frame index into the render
     * @returns {number} radians the render camera has swung since frame 0
     */
    sweepForFrame(n) {
      return sweeps[clamp(Math.round(n), 0, sweeps.length - 1)] ?? 0;
    },

    /**
     * @param {Vector3} viewer where the reader's camera is
     * @param {number} amount 0 the reconstruction is absent, 1 fully present
     */
    update(viewer, amount) {
      material.uniforms.uOpacity.value = amount;
      rig.visible = amount > 0.002;
      if (!rig.visible) return;
      // Yaw only. Tilting the billboard to face a camera that is above the
      // subject would lean the reconstructed person backwards.
      facing.set(viewer.x, target.y, viewer.z);
      rig.lookAt(facing);
    },

    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * The floor: a metal turntable at the centre, radial spokes and two rings.
 *
 * It is doing real work rather than decorating. Without it the ring of cameras
 * floats in an unreadable void — there is no horizon, no sense of scale, and no
 * way to see that the rig encircles the subject rather than sitting behind it.
 * Two rings mark the two radii that matter: the camera circle at its true
 * radius, and a small one at the subject's feet.
 *
 * The inner ring used to enclose nothing, which left the one place the reader
 * actually looks as the emptiest part of the frame — and left the subject with
 * no surface to stand on, so the whole scene read as floating rather than
 * standing. It is now a disc, drawn rather than lit; see the note on it below.
 *
 * Radius and centre come from cameras.json's `rig` block, so the floor tracks
 * the actual rig rather than restating a constant — and the turntable's own
 * radius additionally tracks the subject's measured sweep, passed in by
 * stage.js, so the plate holds the whole performance.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  SRGBColorSpace,
} from "../vendor/three.module.js";
import { NO_GLOW_LAYER } from "./bloom.js";
import { tokenColor } from "./convert.js";

const SPOKES = 48;
// The floor is orientation, not subject matter. It reads at a fraction of the
// ring's brightness or it competes with it.
const BASE_OPACITY = 0.4;
const RING_SEGMENTS = 96;
const INNER_RADIUS_FRACTION = 0.3;
const SPOKE_OUTER_FRACTION = 1.25;
// The turntable must hold the subject for the whole clip, and 0.3 of the rig
// radius was a guess about how far people wander that the joker scene walked
// straight off — most visibly in act 4, where the reconstruction slides
// across its billboard by the subject's full sweep. So the caller passes the
// sweep it knows (stage.js measures every joint of every frame, at drawn
// scale) and the plate takes it plus a stride of clearance; the fraction
// stays as the floor for scenes that stand still, and the cap keeps the
// plate reading as the small circle against the camera circle.
const DISC_CLEARANCE = 0.25;
const DISC_MAX_FRACTION = 0.6;
/**
 * The turntable: a dark machined plate, drawn rather than lit.
 *
 * It was metal with an environment map, and metal was the wrong answer twice
 * over. Act 4 originally composited its black-backed reconstruction additively,
 * so anything bright underneath was added to the subject rather than hidden by
 * it, and the overlap came out discoloured. The billboard now carries an
 * explicit RMBG matte, but the unlit plate remains the stable design. And a
 * mirror takes its colour from whatever it happens to be facing, which is why it
 * kept changing brightness and hue as the viewpoint moved.
 *
 * Unlit and dark solves the changing-light half and keeps the plate subordinate
 * to the reconstruction. What the metal was actually wanted for — being able to
 * see the floor turn — is done properly here by drawing marks on it. A mirror
 * only shows rotation if it has something to reflect; a dial always does.
 */
const DISC = {
  base: "#191c22",
  mid: "#15181d",
  rim: "#0e1014",
  mark: "rgba(152, 168, 198, 0.17)",
  tick: "rgba(152, 168, 198, 0.24)",
  // One ring, at the rim. Four concentric circles read as a target rather than a
  // turntable, and they were doing no work the rim ticks do not do better: a
  // circle is rotationally symmetric and cannot show a turn on its own.
  rings: [0.94],
  ticks: 48,
};
/** Texture size. The disc is a few hundred pixels across at most. */
const DISC_TEXTURE = 512;
const DISC_SEGMENTS = 96;
/**
 * A hair below the lines, which sit at y = 0. Coplanar they z-fight, and the
 * inner ring is exactly this disc's rim — so dropping the disc lets the ring
 * draw as its edge instead of fighting it.
 */
const DISC_DROP = 0.002;

/** Concentric rings and rim ticks on a dark plate — a dial, not a mirror. */
function turntableTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = DISC_TEXTURE;
  canvas.height = DISC_TEXTURE;
  const ctx = canvas.getContext("2d");
  const c = DISC_TEXTURE / 2;

  const wash = ctx.createRadialGradient(c, c, 0, c, c, c);
  wash.addColorStop(0, DISC.base);
  wash.addColorStop(0.72, DISC.mid);
  wash.addColorStop(1, DISC.rim);
  ctx.fillStyle = wash;
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = DISC.mark;
  ctx.lineWidth = 1.5;
  DISC.rings.forEach((r) => {
    ctx.beginPath();
    ctx.arc(c, c, c * r, 0, Math.PI * 2);
    ctx.stroke();
  });

  // The rim ticks are the part that makes rotation legible; the rings alone are
  // rotationally symmetric and would turn without appearing to.
  ctx.strokeStyle = DISC.tick;
  ctx.lineWidth = 2;
  for (let i = 0; i < DISC.ticks; i += 1) {
    const angle = (i / DISC.ticks) * Math.PI * 2;
    const inner = c * (i % 4 === 0 ? 0.8 : 0.87);
    ctx.beginPath();
    ctx.moveTo(c + inner * Math.cos(angle), c + inner * Math.sin(angle));
    ctx.lineTo(c + c * 0.94 * Math.cos(angle), c + c * 0.94 * Math.sin(angle));
    ctx.stroke();
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function createGround(rig, { subjectRadius = 0 } = {}) {
  const centre = rig?.centre ?? [0, 0, 0];
  const radius = rig?.radius ?? 3;
  const points = [];

  const spokeInner = Math.min(
    Math.max(radius * INNER_RADIUS_FRACTION, subjectRadius + DISC_CLEARANCE),
    radius * DISC_MAX_FRACTION,
  );
  const spokeOuter = radius * SPOKE_OUTER_FRACTION;
  for (let i = 0; i < SPOKES; i += 1) {
    const angle = (i / SPOKES) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    points.push(
      centre[0] + spokeInner * cos, 0, centre[2] + spokeInner * sin,
      centre[0] + spokeOuter * cos, 0, centre[2] + spokeOuter * sin,
    );
  }

  for (const ringRadius of [radius, spokeInner]) {
    for (let i = 0; i < RING_SEGMENTS; i += 1) {
      const a = (i / RING_SEGMENTS) * Math.PI * 2;
      const b = ((i + 1) / RING_SEGMENTS) * Math.PI * 2;
      points.push(
        centre[0] + ringRadius * Math.cos(a), 0, centre[2] + ringRadius * Math.sin(a),
        centre[0] + ringRadius * Math.cos(b), 0, centre[2] + ringRadius * Math.sin(b),
      );
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(points), 3));

  const material = new LineBasicMaterial({
    color: tokenColor("--pipeline-grid", "#26314a"),
    transparent: true,
    opacity: BASE_OPACITY,
    depthWrite: false,
    blending: AdditiveBlending,
  });

  const group = new Group();
  group.name = "ground";
  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;
  group.add(lines);

  const discGeometry = new CircleGeometry(spokeInner, DISC_SEGMENTS);
  const discMaterial = new MeshBasicMaterial({
    map: turntableTexture(),
    transparent: true,
  });
  const disc = new Mesh(discGeometry, discMaterial);
  disc.rotation.x = -Math.PI / 2;
  // Laid flat by rotating about X, so the plate's own spin is rotation about its
  // local Z. Setting `rotation.y` here would tilt it instead.
  disc.position.set(centre[0], -DISC_DROP, centre[2]);
  // A surface, not a line: bloom is for the wireframes.
  disc.layers.set(NO_GLOW_LAYER);
  // Writes no depth, and draws before everything else. The turntable is what the
  // subject stands *on* — scenery behind it, never an occluder of it — and
  // letting it into the depth buffer chewed the figure's feet into loose specks.
  //
  // The mechanism is worth knowing, because it will come back for anything else
  // drawn flat near this plane. A fat line is a screen-space expanded quad whose
  // four corners all carry the *endpoint's* depth. The foot bones are nearly
  // horizontal and seen from above, so that expansion runs mostly up-and-down the
  // screen — and on a floor plane, further down the screen means nearer the
  // camera. The lower half of each ribbon therefore landed on pixels where the
  // disc was closer than the depth the ribbon was carrying, and got rejected a
  // pixel at a time. Two millimetres of clearance could never have fixed it; the
  // ribbon's depth simply is not where the ribbon appears to be.
  discMaterial.depthWrite = false;
  disc.renderOrder = -1;
  group.add(disc);

  return {
    group,
    /**
     * Two amounts, because the grid and the turntable belong to different
     * moments. The grid is orientation and arrives with the scene; the disc is
     * the thing the subject stands on, so it arrives when the subject does —
     * act 1 is one camera and nothing else, and a bright ellipse beside it
     * competes for exactly the attention that act is spending.
     *
     * @param {number} value the grid
     * @param {number} discValue the turntable; defaults to the grid's
     */
    setOpacity(value, discValue = value) {
      material.opacity = value * BASE_OPACITY;
      discMaterial.opacity = discValue;
      disc.visible = discValue > 0.002;
      group.visible = value > 0.001 || disc.visible;
    },

    /**
     * Turn the plate. Only the plate: the spokes and rings are the rig's diagram
     * — where the cameras stand and how far out — and a diagram that rotates
     * would claim the rig moves, which it does not.
     *
     * @param {number} radians absolute angle, not a delta
     */
    setSpin(radians) {
      disc.rotation.z = radians;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      discGeometry.dispose();
      discMaterial.map?.dispose();
      discMaterial.dispose();
    },
  };
}

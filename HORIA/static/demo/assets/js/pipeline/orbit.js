/**
 * Drag-to-orbit, written by hand rather than vendoring OrbitControls.
 *
 * What this needs is a fraction of what OrbitControls does, and the difference
 * is not size but behaviour: here the storyboard's camera path owns the camera,
 * and dragging applies an *offset* on top of it. OrbitControls would want to
 * own the camera outright and would fight the path for it every frame.
 *
 * So: drag yaws and pitches around wherever the path currently is, releasing
 * coasts to a stop, and an idle auto-rotate drifts the yaw so a reader who never
 * touches it still sees the ring is three-dimensional.
 *
 * **Releasing used to ease the offset back to zero**, and that was wrong in a
 * way worth recording, because it is a reasonable-sounding design. The camera
 * belongs to the path, so an offset that returns home keeps every act
 * framed as composed — but a view that springs back the instant the reader lets
 * go reads as the drag being *undone*, and it moves the opposite way to the
 * hand, which is the one thing a direct-manipulation gesture must never do. It
 * survived as long as it did because the drag axes were also inverted, and two
 * inversions cancelled: the spring-back ran the way the hand had been pulling
 * and passed for momentum.
 *
 * Now the offset persists and only the velocity decays. The reader keeps the
 * viewpoint they chose. The one thing that takes it back is asking for step 1,
 * the composed opening shot — see `recentre`.
 *
 * Wheel and touch-scroll are left alone on purpose — they drive the page, and
 * capturing them to zoom would trap the reader in the section.
 *
 * This module imports nothing, so its feel can be checked without a browser —
 * which matters, because the direction of a gesture is not something a
 * screenshot can settle (a yaw about the rig centre moves the near half of the
 * ring one way and the far half the other):
 *
 *     node --input-type=module -e '
 *       import { createOrbitOffset } from "./assets/js/pipeline/orbit.js";
 *       const el = { style:{}, addEventListener:(t,f)=>(el["on"+t]=f), removeEventListener(){} };
 *       const o = createOrbitOffset(el, {});
 *       const send = (t,x,y,ts) => el["on"+t]({isPrimary:true, pointerId:1, clientX:x, clientY:y, timeStamp:ts, preventDefault(){}});
 *       send("pointerdown",500,400,0);
 *       for (let i=1;i<=10;i++) send("pointermove",500+i*30,400,i*16);
 *       send("pointerup",800,400,168);
 *       const before = o.state.yaw;
 *       for (let f=0;f<48;f++) o.update(1/60);
 *       console.log(o.state.yaw > before ? "coasts onward" : "reverses");
 *     '
 */
import { clamp, mix, shortestRadians, smoothstep } from "./math.js";

const MAX_PITCH = 0.9;
const DRAG_SPEED = 0.006;
/** How fast a released throw dies, per second (e-folding). */
const FLICK_DECAY = 3.4;
/** Radians per second a throw may carry, so a fast flick cannot spin the scene. */
const MAX_FLICK = 2.2;
/** Below this a coast is over, because it can no longer be seen. Roughly a third
 *  of the idle drift's own speed. */
const STILL = 0.02;
/**
 * A release this long after the last movement is a *placement*, not a throw.
 * Without it, dragging somewhere, pausing, and letting go coasts on a velocity
 * measured before the pause.
 */
const FLICK_WINDOW = 90;
/**
 * Seconds of stillness before the scene starts turning by itself, and seconds
 * more to reach full speed.
 *
 * Four was too long by the only measure that counts: a reader who lets go and
 * waits reads four seconds of nothing as the scene having stopped for good, and
 * the drift is meant to say the opposite — that this is a live 3D scene they can
 * keep pushing around.
 */
const IDLE_DELAY = 1;
// Short, because it is only there to keep the drift from starting with a jerk.
const IDLE_RAMP = 0.6;
const IDLE_SPEED = 0.055;
/** Fallback unwind time, if a caller does not say. Seconds. */
const RECENTRE_TIME = 1.2;

export function createOrbitOffset(element, { reducedMotion = false } = {}) {
  const state = { yaw: 0, pitch: 0, drift: 0 };
  let dragging = false;
  let pointerId = null;
  let lastX = 0;
  let lastY = 0;
  let idleFor = 0;
  let drifting = true;
  let velocityYaw = 0;
  let velocityPitch = 0;
  let lastMoveAt = 0;
  /** `{ from: {yaw, pitch, drift}, elapsed, duration }` while unwinding, else null. */
  let recentre = null;

  function onPointerDown(event) {
    if (!event.isPrimary) return;
    dragging = true;
    recentre = null;
    pointerId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    lastMoveAt = event.timeStamp;
    velocityYaw = 0;
    velocityPitch = 0;
    idleFor = 0;
    // Throws if the pointer is already gone — a synthetic event, a cancelled
    // gesture. Capture is an optimisation here (the listeners are on the
    // element either way), so losing it must not abort the drag.
    try {
      element.setPointerCapture?.(pointerId);
    } catch {
      /* not capturable; carry on */
    }
    element.style.cursor = "grabbing";
  }

  function onPointerMove(event) {
    if (!dragging || event.pointerId !== pointerId) return;
    // Both signs are "the scene follows the hand", which is the only one that
    // survives contact with a reader: drag right and the scene turns right,
    // drag down and it drops. They were both inverted, and the giveaway was
    // that letting go looked *correct* — release only eases the offset back to
    // zero, so a drag that ran backwards sprang back the way the reader had
    // been pulling and read as momentum.
    //
    // Yaw is positive-to-the-right because the stage places the camera at
    // `centre + (r cos A, 0, r sin A)`: increasing A slides the camera to its
    // own left, and a camera moving left is a scene moving right.
    const deltaYaw = (event.clientX - lastX) * DRAG_SPEED;
    // Pitch feeds the camera's *height*, so pulling down has to raise the eye:
    // the scene drops on screen only when the viewpoint climbs.
    //
    // Touch gets this too. It briefly did not, back when the canvas carried
    // `touch-action: pan-y` and a vertical drag both scrolled the page and tilted
    // the camera — one gesture doing two things. The gesture is wholly ours now,
    // so there is nothing to share it with.
    const deltaPitch = (event.clientY - lastY) * DRAG_SPEED;
    state.yaw += deltaYaw;
    state.pitch = clamp(state.pitch + deltaPitch, -MAX_PITCH, MAX_PITCH);

    // Throw speed, smoothed. A single pointer sample is noisy enough that the
    // last one alone decides whether a steady drag coasts or stops dead.
    const elapsed = Math.max((event.timeStamp - lastMoveAt) / 1000, 1 / 240);
    velocityYaw = mix(velocityYaw, clampFlick(deltaYaw / elapsed), 0.35);
    velocityPitch = mix(velocityPitch, clampFlick(deltaPitch / elapsed), 0.35);

    lastMoveAt = event.timeStamp;
    lastX = event.clientX;
    lastY = event.clientY;
    idleFor = 0;
    // Only once a drag is in progress, so a plain swipe still scrolls the page.
    event.preventDefault();
  }

  function onPointerUp(event) {
    if (event.pointerId !== pointerId) return;
    dragging = false;
    pointerId = null;
    // Let go after a pause, or with the motion preference set, and it simply
    // stays where it was put.
    if (reducedMotion || event.timeStamp - lastMoveAt > FLICK_WINDOW) {
      velocityYaw = 0;
      velocityPitch = 0;
    }
    element.releasePointerCapture?.(event.pointerId);
    element.style.cursor = "";
  }

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", onPointerUp);
  element.addEventListener("pointercancel", onPointerUp);
  // The canvas owns every touch on it. `pan-y` was the cautious choice — it let
  // the browser keep vertical scrolling so a reader could always swipe past a
  // section that fills the viewport — and it made the scene unusable on a phone:
  // the browser claims the gesture the moment it looks vertical and sends
  // `pointercancel`, so a swipe with any downward component scrolled the page and
  // did nothing to the scene. Almost every swipe has a downward component.
  //
  // The cost is that a reader cannot scroll past the section by swiping on the
  // canvas. They scroll past it on the step switcher instead, which is a wide band
  // across the bottom of the frame and is not the canvas.
  element.style.touchAction = "none";
  element.style.cursor = "grab";

  return {
    state,

    /** @param {number} delta seconds since the last frame */
    update(delta) {
      if (dragging) return;

      if (recentre) {
        // Timed, not exponential. Decay was the obvious way to write this and it
        // is the wrong shape for the job: it approaches zero without arriving, so
        // the offset was still a few degrees out when the camera finished walking
        // back to the opening keyframe. At act 1 the reader stands twelve degrees
        // round from the one camera on screen, which is close enough that a few
        // degrees of leftover bearing visibly changes how near that camera looks.
        // "Back where it started" has to mean exactly, and on time.
        recentre.elapsed += delta;
        const t = Math.min(recentre.elapsed / recentre.duration, 1);
        const k = 1 - smoothstep(t);
        state.yaw = recentre.from.yaw * k;
        state.pitch = recentre.from.pitch * k;
        state.drift = recentre.from.drift * k;
        if (t >= 1) recentre = null;
        return;
      }

      // Coast. The offset itself is kept — only the speed bleeds off — so the
      // scene rolls on the way the hand was going and stops there.
      if (velocityYaw || velocityPitch) {
        state.yaw += velocityYaw * delta;
        state.pitch = clamp(state.pitch + velocityPitch * delta, -MAX_PITCH, MAX_PITCH);
        const decay = Math.exp(-FLICK_DECAY * delta);
        velocityYaw = Math.abs(velocityYaw) < STILL ? 0 : velocityYaw * decay;
        velocityPitch = Math.abs(velocityPitch) < STILL ? 0 : velocityPitch * decay;
      }

      // The countdown deliberately keeps running through the coast, and this is
      // the whole reason a one-second delay used to feel like three.
      //
      // The coast reset it, on the reasoning that a throw is attention and the
      // auto-rotate should wait it out. But the coast does not end when it stops
      // being visible, it ends when the arithmetic runs out: from an ordinary
      // release it takes about two and a half seconds to decay to the old 1e-4
      // cutoff, nearly all of it at speeds no one can see. So the countdown had
      // not even started by the time the scene looked still.
      //
      // Letting both run at once costs nothing. The drift is 0.055 rad/s against
      // a throw an order of magnitude faster, so while the coast is still
      // visible the drift is lost inside it, and by the time the coast is gone
      // the drift is already at speed. `STILL` is a threshold you could see
      // rather than a number near zero, for the same reason.

      if (reducedMotion) {
        state.drift = 0;
        return;
      }
      if (!drifting) return;
      idleFor += delta;
      if (idleFor > IDLE_DELAY) {
        state.drift += IDLE_SPEED * delta * Math.min((idleFor - IDLE_DELAY) / IDLE_RAMP, 1);
      }
    },

    /**
     * Put the scene back where it started, easing rather than cutting.
     *
     * Step 1 is a composed shot of one object, and it stops being that as soon
     * as the reader has dragged the scene somewhere: clicking back to it left
     * the camera wherever it had been pushed, so the first step was the only one
     * that could not be returned to. Everything the reader has added — the drag,
     * the throw, and the accumulated idle rotation — comes off together.
     *
     * The two angles are folded to their shortest equivalent first. A scene left
     * drifting for two minutes has wound on several turns, and unwinding those
     * literally would spin it like a dial; the reader only ever asked for the
     * bearing back, and half a turn is the furthest that can ever be from here.
     */
    recentre(duration = RECENTRE_TIME) {
      // Folded to the shortest equivalent first. A scene left drifting for two
      // minutes has wound on more than a full turn, and unwinding that literally
      // would spin it like a dial when all that was asked for was the bearing
      // back.
      state.yaw = shortestRadians(state.yaw);
      state.drift = shortestRadians(state.drift);
      velocityYaw = 0;
      velocityPitch = 0;
      idleFor = 0;
      recentre = {
        from: { yaw: state.yaw, pitch: state.pitch, drift: state.drift },
        elapsed: 0,
        duration: Math.max(duration, 1 / 60),
      };
    },

    /**
     * Interacting with the scene counts as attention: the auto-rotate should not
     * fight it. Picking a camera is the only caller now — page scrolling used to
     * be one too, from when scroll position chose the step, and it froze the
     * scene for as long as anyone kept scrolling.
     */
    notifyActivity() {
      idleFor = 0;
    },

    /**
     * Picking a camera stops the idle drift.
     *
     * The whole point of a selection is that the view swings round to put that
     * camera nearest the screen; a rotation that keeps going afterwards would
     * carry the reader straight back off it. Clearing the selection starts the
     * drift again from a fresh idle countdown.
     */
    setDrifting(value) {
      if (value === drifting) return;
      drifting = value;
      idleFor = 0;
    },

    dispose() {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerUp);
      element.removeEventListener("pointercancel", onPointerUp);
      element.style.cursor = "";
    },
  };
}

function clampFlick(value) {
  return clamp(value, -MAX_FLICK, MAX_FLICK);
}

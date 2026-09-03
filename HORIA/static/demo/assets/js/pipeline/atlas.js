/**
 * One video, twenty-four planes.
 *
 * The ring needs all twenty-four generated views playing at once, and twenty-four
 * `<video>` elements is not an option: iOS Safari caps concurrent decodes in the
 * low single digits, and 24 × 704×1280 is ~24 MB before the reader has clicked
 * anything. So the views are pre-stacked into one 6×4 grid video and each plane
 * samples its own cell by UV offset.
 *
 * The second benefit is the one that is hard to buy any other way: because every
 * tile shares a single decode clock, the twenty-four views are frame-synced by
 * construction. Twenty-four separate elements would drift, and drift is exactly
 * what would undermine a multi-view consistency claim.
 *
 * When `masked` is set the atlas is twice as tall: the views fill the top half
 * and their foreground masks the bottom half, cell for cell. That lets a plane
 * show the view with its background (what the model produced) or the subject
 * alone (what the reconstruction was fit from) from a single decode — no second
 * video, and no alpha codec that browsers disagree about.
 *
 * All twenty-four planes share one Texture object, and the per-cell offset is
 * baked into each plane's UV attribute instead. The obvious alternative —
 * `texture.clone()` per cell, setting `offset`/`repeat` — is wrong twice over:
 * three.js applies those per *texture*, so each clone is a separate GPU texture
 * that uploads its own copy of the same decoded frame every frame. UVs are free.
 */
import {
  LinearFilter,
  NoColorSpace,
  SRGBColorSpace,
  TextureLoader,
  VideoTexture,
} from "../vendor/three.module.js";

/**
 * @param {object} options
 * @param {string} options.src           the atlas video
 * @param {string} [options.poster]      a still frame of the same atlas, same
 *   layout. Shown until the video has decoded, and the only thing a device that
 *   cannot afford the video has to fall back on.
 */
export function createAtlas({ src, poster, columns, rows, masked = false }) {
  const video = document.createElement("video");
  // Every attribute before `src`. Assigning src starts the resource selection
  // algorithm, and mutating the element afterwards — `crossOrigin` especially —
  // can leave the load stalled with neither `loadeddata` nor `error` ever
  // firing, which looks exactly like a missing file.
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  // No crossOrigin: this is a same-origin asset, and putting the request in
  // CORS mode would make it depend on the host sending
  // Access-Control-Allow-Origin — which a plain static host has no reason to.
  video.src = src;
  // Not in the DOM — it exists only as a decode source for the texture.
  video.style.display = "none";

  const base = new VideoTexture(video);
  base.colorSpace = SRGBColorSpace;
  base.minFilter = LinearFilter;
  base.magFilter = LinearFilter;
  base.generateMipmaps = false;

  /**
   * The sub-rectangle of the atlas holding cell `index`, in UV space.
   *
   * Texture V runs bottom-up while the grid was written top-down, hence the
   * flip on the row term. Getting this wrong stacks the ring vertically
   * mirrored, which is easy to miss because a standing figure is roughly
   * symmetric top to bottom in silhouette.
   */
  const gridRows = masked ? rows * 2 : rows;

  function uvRect(index) {
    return {
      x: (index % columns) / columns,
      y: 1 - (Math.floor(index / columns) + 1) / gridRows,
      width: 1 / columns,
      height: 1 / gridRows,
    };
  }

  /**
   * How far below a cell its mask sits, in UV. V runs bottom-up while the grid
   * was written top-down, so the mask — which is *lower* in the image — is at a
   * *smaller* V.
   */
  const maskOffset = masked ? -rows / gridRows : 0;

  // The video is ~1 MB and takes a moment; a still frame of the same atlas is
  // ~40 KB and lands almost immediately, so the ring shows real generated views
  // from the start rather than flat placeholder tiles. It is also what a
  // low-power path can use instead of decoding video at all.
  const posterTexture = poster
    ? new TextureLoader().load(poster, (texture) => {
        // A masked poster mixes display RGB and linear coverage in one image,
        // so it cannot be tagged wholly sRGB. Its custom shader decodes only
        // the RGB samples by hand and leaves the mask samples untouched.
        texture.colorSpace = masked ? NoColorSpace : SRGBColorSpace;
        texture.minFilter = LinearFilter;
        texture.magFilter = LinearFilter;
        texture.generateMipmaps = false;
      })
    : null;

  let started = false;

  // Nothing may sample the texture before the first frame exists: uploading an
  // HTMLVideoElement at readyState 0 is a WebGL INVALID_VALUE, and it happens
  // on every render between boot and the video arriving.
  const ready = new Promise((resolve, reject) => {
    if (video.readyState >= video.HAVE_CURRENT_DATA) {
      resolve(base);
      return;
    }
    video.addEventListener("loadeddata", () => resolve(base), { once: true });
    video.addEventListener(
      "error",
      () => reject(new Error(`atlas video failed to load: ${src}`)),
      { once: true },
    );
  });

  return {
    poster: posterTexture,
    ready,
    uvRect,
    maskOffset,

    /**
     * Autoplay of a muted inline video is allowed everywhere that matters, but
     * it can still be refused (battery saver, a Safari setting). A refusal is
     * not an error worth surfacing — the planes simply show the first frame.
     */
    play() {
      if (started) return;
      started = true;
      video.play().catch(() => {});
    },

    pause() {
      started = false;
      video.pause();
    },

    /**
     * Current frame index, or -1 when the video has not started.
     *
     * This is what everything else in the scene should be driven by. A wall
     * clock and a video clock do not agree: the video starts late, decodes at
     * its own pace and wraps its loop on its own schedule, so a skeleton
     * animated by `performance.now()` drifts against the views around it within
     * seconds. One decode clock keeps the twenty-four tiles in step with each
     * other; the same clock has to keep the rest of the scene in step with them.
     */
    frame(fps, frames) {
      if (!video.duration || video.readyState < 2) return -1;
      return Math.floor(video.currentTime * fps) % frames;
    },

    get currentTime() {
      return video.currentTime;
    },

    /**
     * Nudge this video onto another's clock.
     *
     * Seeking every frame would stutter, so it only corrects once the drift is
     * past a threshold a viewer could notice — a couple of frames.
     */
    follow(seconds, tolerance) {
      if (!video.duration || video.readyState < 2) return;
      const target = seconds % video.duration;
      if (Math.abs(video.currentTime - target) > tolerance) {
        video.currentTime = target;
      }
    },

    dispose() {
      video.pause();
      video.removeAttribute("src");
      video.load();
      base.dispose();
      posterTexture?.dispose();
    },
  };
}

/** The atlas grid, matching what .dev/tools/build_web_media.sh writes. */
export const ATLAS_GRID = { columns: 6, rows: 4 };

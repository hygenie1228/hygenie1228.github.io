/**
 * Bloom, hand-written so the vendored surface stays at one library.
 *
 * three.js ships UnrealBloomPass in examples/jsm, but taking it means taking
 * EffectComposer, RenderPass, ShaderPass, OutputPass, CopyShader and
 * LuminosityHighPassShader with it — eight files for one effect. This scene is
 * emissive wireframes and points on black, which is the easy case: there is
 * nothing to separate bright from dark because everything drawn *is* the
 * bright part. So there is no luminosity pre-pass here at all. Render to a
 * half-float target, blur it twice at two scales, add both back.
 *
 * Two scales rather than one: the tight blur thickens 1-pixel lines into
 * something readable (WebGL cannot draw thick lines — `linewidth` is ignored),
 * and the wide one gives the ring a little depth. Both are set low enough to do
 * only that job — the glow is meant to be the reason the lines are legible, not
 * something the viewer notices.
 *
 * **Only the line work glows.** Bloom is doing a specific job here — making a
 * one-pixel line legible — and photographic content does not need that job
 * done. Applied to the generated views, the conditioning tiles and the 4DGS
 * render it just reads as haze over a photograph. So the glow is gathered from
 * a second pass with those surfaces excluded, via NO_GLOW_LAYER, and added back
 * over the full-colour render.
 */
import {
  HalfFloatType,
  LinearFilter,
  Mesh,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
} from "../vendor/three.module.js";

const QUAD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Nine-tap Gaussian, run once per axis. Weights are a normalised sigma≈2 kernel.
const BLUR_FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uDirection;
  varying vec2 vUv;

  const float w0 = 0.2270270270;
  const float w1 = 0.1945945946;
  const float w2 = 0.1216216216;
  const float w3 = 0.0540540541;
  const float w4 = 0.0162162162;

  void main() {
    vec4 sum = texture2D(tDiffuse, vUv) * w0;
    sum += texture2D(tDiffuse, vUv + uDirection * 1.0) * w1;
    sum += texture2D(tDiffuse, vUv - uDirection * 1.0) * w1;
    sum += texture2D(tDiffuse, vUv + uDirection * 2.0) * w2;
    sum += texture2D(tDiffuse, vUv - uDirection * 2.0) * w2;
    sum += texture2D(tDiffuse, vUv + uDirection * 3.0) * w3;
    sum += texture2D(tDiffuse, vUv - uDirection * 3.0) * w3;
    sum += texture2D(tDiffuse, vUv + uDirection * 4.0) * w4;
    sum += texture2D(tDiffuse, vUv - uDirection * 4.0) * w4;
    gl_FragColor = sum;
  }
`;

const COMPOSITE_FRAGMENT = /* glsl */ `
  uniform sampler2D tBase;
  uniform sampler2D tTight;
  uniform sampler2D tWide;
  uniform float uTight;
  uniform float uWide;
  varying vec2 vUv;

  void main() {
    vec3 base = texture2D(tBase, vUv).rgb;
    vec3 glow = texture2D(tTight, vUv).rgb * uTight + texture2D(tWide, vUv).rgb * uWide;

    // Roll off only the glow. Tonemapping the whole frame also tonemapped the
    // generated views, which are photographs and already graded — it pulled the
    // colour out of them and left them milky.
    glow = glow / (glow + vec3(1.0));

    gl_FragColor = vec4(pow(min(base + glow, vec3(1.0)), vec3(1.0 / 2.2)), 1.0);
  }
`;

const TIGHT_DIVISOR = 2;
const WIDE_DIVISOR = 8;

/**
 * Objects on this layer are drawn but never contribute to the glow. The camera
 * must have it enabled; the glow pass turns it off.
 */
export const NO_GLOW_LAYER = 1;

export function createBloom(renderer, { tight = 0.09, wide = 0.07 } = {}) {
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadScene = new Scene();
  const quad = new Mesh(new PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  quadScene.add(quad);

  const targetOptions = {
    type: HalfFloatType,
    format: RGBAFormat,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: false,
  };
  // Multisampled, and this is the only antialiasing the scene gets. The renderer
  // is built with `antialias: true`, which applies to the default framebuffer —
  // and the scene is never drawn there. It is drawn here, composited, and only
  // the result reaches the canvas, so without this every edge in the 3D scene is
  // hard-aliased.
  //
  // It went unnoticed while the image planes were axis-aligned rectangles whose
  // edges sat exactly under the frustum lines that outline them. Rounding the
  // corners put an edge diagonally across pixels with nothing drawn over it, and
  // the stair-steps were suddenly the most visible thing about a camera.
  //
  // Only this one. `glow` feeds the blur, which is a far heavier low-pass than
  // multisampling, and paying for samples that are about to be smeared is waste.
  const base = new WebGLRenderTarget(1, 1, { ...targetOptions, depthBuffer: true, samples: 4 });
  const glow = new WebGLRenderTarget(1, 1, { ...targetOptions, depthBuffer: true });
  const tightA = new WebGLRenderTarget(1, 1, targetOptions);
  const tightB = new WebGLRenderTarget(1, 1, targetOptions);
  const wideA = new WebGLRenderTarget(1, 1, targetOptions);
  const wideB = new WebGLRenderTarget(1, 1, targetOptions);

  const blurMaterial = new ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, uDirection: { value: new Vector2() } },
    vertexShader: QUAD_VERTEX,
    fragmentShader: BLUR_FRAGMENT,
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
  });

  const compositeMaterial = new ShaderMaterial({
    uniforms: {
      tBase: { value: base.texture },
      tTight: { value: tightB.texture },
      tWide: { value: wideB.texture },
      uTight: { value: tight },
      uWide: { value: wide },
    },
    vertexShader: QUAD_VERTEX,
    fragmentShader: COMPOSITE_FRAGMENT,
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
  });

  function blit(material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, camera);
  }

  function blurInto(source, ping, pong, texelX, texelY) {
    blurMaterial.uniforms.tDiffuse.value = source;
    blurMaterial.uniforms.uDirection.value.set(texelX, 0);
    blit(blurMaterial, ping);

    blurMaterial.uniforms.tDiffuse.value = ping.texture;
    blurMaterial.uniforms.uDirection.value.set(0, texelY);
    blit(blurMaterial, pong);
  }

  return {
    setSize(width, height, pixelRatio) {
      const w = Math.max(1, Math.floor(width * pixelRatio));
      const h = Math.max(1, Math.floor(height * pixelRatio));
      base.setSize(w, h);
      glow.setSize(w, h);
      tightA.setSize(Math.ceil(w / TIGHT_DIVISOR), Math.ceil(h / TIGHT_DIVISOR));
      tightB.setSize(Math.ceil(w / TIGHT_DIVISOR), Math.ceil(h / TIGHT_DIVISOR));
      wideA.setSize(Math.ceil(w / WIDE_DIVISOR), Math.ceil(h / WIDE_DIVISOR));
      wideB.setSize(Math.ceil(w / WIDE_DIVISOR), Math.ceil(h / WIDE_DIVISOR));
    },

    render(scene, sceneCamera) {
      renderer.setRenderTarget(base);
      renderer.clear();
      renderer.render(scene, sceneCamera);

      // Second pass with the photographic surfaces masked out — this, not the
      // full frame, is what gets blurred and added back.
      const mask = sceneCamera.layers.mask;
      sceneCamera.layers.disable(NO_GLOW_LAYER);
      renderer.setRenderTarget(glow);
      renderer.clear();
      renderer.render(scene, sceneCamera);
      sceneCamera.layers.mask = mask;

      blurInto(glow.texture, tightA, tightB, 1 / tightA.width, 1 / tightA.height);
      blurInto(glow.texture, wideA, wideB, 1 / wideA.width, 1 / wideA.height);

      renderer.setRenderTarget(null);
      blit(compositeMaterial, null);
    },

    dispose() {
      [base, glow, tightA, tightB, wideA, wideB].forEach((target) => target.dispose());
      blurMaterial.dispose();
      compositeMaterial.dispose();
      quad.geometry.dispose();
    },
  };
}

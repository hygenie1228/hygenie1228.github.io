/**
 * The material a camera's image plane is drawn with.
 *
 * It exists because one plane has to be able to show two things from one
 * decode: the generated view as the model produced it, background and all
 * (act 3), and the same view cut down to the subject alone (act 4, which is
 * what the 4D Gaussians were actually fit from). The atlas carries the
 * foreground mask stacked underneath the views, so the choice is a uniform
 * rather than a second video.
 *
 * `MeshBasicMaterial` cannot sample a second place in the same texture, and
 * `onBeforeCompile` surgery on it would be more fragile than sixteen lines of
 * shader.
 *
 * Ordinary alpha blending, not additive. Additive was fine while every view was
 * matted onto black — black adds nothing — but the moment act 3 started showing
 * the backgrounds it turned every overlapping plane into a sum and the
 * photographs came out milky. So the mask becomes *alpha* instead: act 3 draws
 * the full frame opaque, act 4 dissolves the background away rather than adding
 * black over it, and in both the colours are the ones the model produced.
 */
import { NormalBlending, ShaderMaterial } from "../vendor/three.module.js";

const VERTEX = /* glsl */ `
  uniform float uMaskOffset;
  varying vec2 vUv;
  varying vec2 vMaskUv;
  void main() {
    vUv = uv;
    vMaskUv = vec2(uv.x, uv.y + uMaskOffset);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * sRGB to linear, by hand, because a `ShaderMaterial` has to.
 *
 * three.js tags these video textures `SRGBColorSpace` and the renderer encodes
 * linear back to sRGB on output — but the decode on the way *in* is injected into
 * `<map_fragment>`, which only built-in materials include. A custom shader that
 * samples raw hands stored sRGB values to a pipeline that thinks they are linear,
 * and the output encode then applies a second time. The picture comes out lifted,
 * worst in the shadows: a texel at 0.05 displays at 0.248, one at 0.2 at 0.485.
 * That is the "washed out" look, and it is arithmetic rather than taste.
 */
const SRGB_TO_LINEAR = /* glsl */ `
  vec3 srgbToLinear(vec3 c) {
    return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, step(c, vec3(0.04045)));
  }
`;

const FRAGMENT = /* glsl */ `
  ${SRGB_TO_LINEAR}
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uMatte;
  uniform float uHasMask;
  varying vec2 vUv;
  varying vec2 vMaskUv;

  void main() {
    vec3 color = srgbToLinear(texture2D(uMap, vUv).rgb) * uColor;
    // Only where a mask actually exists. Sampling outside the atlas would wrap
    // onto another camera's tile and cut the subject with a stranger's outline.
    //
    // Read raw, deliberately: this channel is coverage, not colour, and putting
    // a display transfer function through it would bend the edges of the matte.
    float mask = uHasMask > 0.5 ? texture2D(uMap, vMaskUv).r : 1.0;
    gl_FragColor = vec4(color, uOpacity * mix(1.0, mask, uMatte));
  }
`;

/**
 * @param {object} options
 * @param {Color} options.color tint used before a texture arrives
 * @param {number} options.maskOffset UV distance from a cell to its mask, 0 if none
 */
export function createPlaneMaterial({ color, maskOffset = 0 }) {
  return new ShaderMaterial({
    uniforms: {
      uMap: { value: null },
      uColor: { value: color.clone() },
      uOpacity: { value: 0 },
      uMatte: { value: 0 },
      uMaskOffset: { value: maskOffset },
      uHasMask: { value: maskOffset === 0 ? 0 : 1 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
  });
}

/**
 * The central 4DGS billboard's one-video RGB + matte material.
 *
 * `render_4dgs_atlas.mp4` is a 1x2 atlas: the black-backed RGB render fills the
 * top half and its RMBG-2.0 foreground matte fills the bottom half. Keeping them
 * in one H.264 stream gives colour and coverage one decoder and therefore one
 * clock, without depending on browser-specific alpha-video codecs. Its RGB-only
 * sibling exists solely for the no-WebGL fallback.
 *
 * The RGB is already matted onto black, so its antialiased edge colours carry
 * coverage in them. Blending remains premultiplied: multiplying those colours by
 * the explicit mask a second time would put a dark fringe around the subject.
 * The mask replaces only the old brightness-derived alpha, which could not tell
 * black clothing from black background.
 */
const MATTE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec2 vMaskUv;
  void main() {
    // Video textures use bottom-up UVs. The atlas was written top-down, so RGB
    // occupies v=.5..1 and its matching mask occupies v=0..0.5.
    vUv = vec2(uv.x, 0.5 + uv.y * 0.5);
    vMaskUv = vec2(uv.x, uv.y * 0.5);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const MATTE_FRAGMENT = /* glsl */ `
  ${SRGB_TO_LINEAR}
  uniform sampler2D uMap;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec2 vMaskUv;

  void main() {
    vec3 stored = texture2D(uMap, vUv).rgb;
    // Coverage is data, not display colour, so sample it raw rather than putting
    // the sRGB transfer function through its soft edge.
    float alpha = texture2D(uMap, vMaskUv).r;
    // Premultiplied throughout, so the fade scales both together.
    gl_FragColor = vec4(srgbToLinear(stored) * uOpacity, alpha * uOpacity);
  }
`;

export function createMatteMaterial() {
  return new ShaderMaterial({
    uniforms: {
      uMap: { value: null },
      uOpacity: { value: 0 },
    },
    vertexShader: MATTE_VERTEX,
    fragmentShader: MATTE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
    blending: NormalBlending,
  });
}

import { forwardRef, useMemo } from "react";
import { Effect } from "postprocessing";
import { Uniform, Vector2 } from "three";

/**
 * Film grain, as opposed to digital noise.
 *
 * The difference matters and is why the stock Noise effect read wrong:
 * that one adds independent white noise to every pixel, uniformly, which
 * is what a broken sensor looks like. Real grain is
 *
 *   - CLUMPED: silver halide crystals are bigger than one pixel, so the
 *     grain has a size and neighbouring pixels are correlated,
 *   - LUMINANCE-WEIGHTED: it peaks in the mid-tones and falls away in
 *     both the deep shadows and the highlights, rather than sitting
 *     hardest in the blacks,
 *   - mostly MONOCHROME, with only a trace of colour separation.
 *
 * All three are cheap to do and together they're the difference between
 * "grainy film" and "bad video".
 */
const fragment = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform float uGrainSize;
  uniform vec2 uResolution;

  // Hash without sine (Hoskins). The usual fract(sin(dot(...))) hash has
  // visible structure at these scales and was what turned the first
  // version of this pass into a woven plaid instead of grain.
  float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float grain(vec2 uv, float seed) {
    // uGrainSize is the grain's diameter in pixels
    vec2 p = uv * uResolution / uGrainSize;
    // Rotate the sampling lattice ~34 degrees. Grain cells aligned to the
    // pixel grid read as a regular weave no matter how good the hash is;
    // off-axis they read as clumps, which is what film actually does.
    // Deliberately NOT interpolated either — bilinear smoothing between
    // cells this small is the other half of what created the plaid.
    vec2 pr = vec2(p.x * 0.8253 - p.y * 0.5646, p.x * 0.5646 + p.y * 0.8253);
    float a = hash21(floor(pr) + seed);
    float b = hash21(floor(pr * 2.37 + 11.0) + seed);
    return (a * 0.68 + b * 0.32) * 2.0 - 1.0;
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    float t = floor(uTime * 24.0);       // grain resamples on frames, not smoothly
    float g = grain(uv, t * 7.13);

    // a trace of chroma separation — real film has three emulsion layers
    float gr = grain(uv, t * 7.13 + 31.0);
    float gb = grain(uv, t * 7.13 + 67.0);
    vec3 n = mix(vec3(g), vec3(gr, g, gb), 0.25);

    float lum = dot(inputColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    // peaks in the mid-tones, vanishes at pure black and pure white
    float weight = 4.0 * lum * (1.0 - lum);
    weight = pow(clamp(weight, 0.0, 1.0), 0.65);
    // keep a little life in the deep shadows so the water isn't sterile
    weight = max(weight, 0.18);

    outputColor = vec4(inputColor.rgb + n * uIntensity * weight, inputColor.a);
  }
`;

class FilmGrainEffect extends Effect {
  constructor({ intensity = 0.05, grainSize = 0.3 } = {}) {
    super("FilmGrainEffect", fragment, {
      uniforms: new Map([
        ["uTime", new Uniform(0)],
        ["uIntensity", new Uniform(intensity)],
        ["uGrainSize", new Uniform(grainSize)],
        ["uResolution", new Uniform(new Vector2(1, 1))],
      ]),
    });
  }

  update(renderer, inputBuffer, deltaTime) {
    this.uniforms.get("uTime").value += deltaTime;
  }

  setSize(width, height) {
    this.uniforms.get("uResolution").value.set(width, height);
  }
}

export const FilmGrain = forwardRef(function FilmGrain(
  { intensity = 0.01, grainSize = 1.6 },
  ref,
) {
  const effect = useMemo(
    () => new FilmGrainEffect({ intensity, grainSize }),
    [intensity, grainSize],
  );
  return <primitive ref={ref} object={effect} dispose={null} />;
});

export default FilmGrain;

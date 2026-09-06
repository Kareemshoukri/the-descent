import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useDive, darkness } from "../state/useDive";

/**
 * The water column itself, as a backdrop — not a flat background colour.
 *
 * A real underwater frame is never uniform: it is bright toward the
 * surface, near-black below, and broken up by soft shafts of surface
 * light that get weaker the deeper you go. A single flat clear-colour
 * (what this scene used to do) is the reason everything read as "black
 * void with a torch in it" rather than "water". This is one inverted
 * sphere with a gradient + noise shader, drawn behind everything and
 * excluded from fog so it keeps its own grading.
 */
const VERT = `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const FRAG = `
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform float uSurfaceLight;
  uniform float uAbove;
  uniform float uTime;
  varying vec3 vDir;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }
  /**
   * Caustics. The classic iterated-distortion trick: push a point around
   * with sin/cos of itself a few times and take the reciprocal distance,
   * which lands on the tangled bright web that refracted sunlight makes.
   * Far cheaper than tracing light through a surface, and at this scale
   * indistinguishable.
   */
  float caustic(vec2 p, float t){
    vec2 i = p;
    float c = 1.0;
    float inten = 0.0045;
    for (int n = 0; n < 4; n++){
      float tt = t * (1.0 - (3.5 / float(n + 1)));
      i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
      c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
    }
    c /= 4.0;
    c = 1.17 - pow(c, 1.4);
    return clamp(pow(abs(c), 6.5), 0.0, 1.0);
  }

  float fbm(vec2 p){
    float v = 0.0, amp = 0.5;
    for (int i = 0; i < 4; i++) { v += noise(p) * amp; p *= 2.02; amp *= 0.5; }
    return v;
  }

  void main() {
    // 0 straight down, 1 straight up
    float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
    float ang = atan(vDir.z, vDir.x);

    // The gradient is the whole look, so it is built from three pieces
    // rather than one pow(): a broad body, a tighter bloom concentrated
    // near the surface, and a slight lift toward the horizon. Real water
    // does not fade linearly — most of the light loss happens in the
    // first stretch below the surface, which a single curve flattens.
    float body     = pow(h, 2.2);
    float surface  = pow(smoothstep(0.45, 1.0, h), 2.6);
    float horizon  = pow(1.0 - abs(h - 0.5) * 2.0, 3.0) * 0.12;

    vec3 col = mix(uDeep, uShallow, clamp(body + surface * 0.55 + horizon, 0.0, 1.0));

    // Shafts of surface light. They RADIATE — narrower and more separated
    // near the top where they come through the surface, splaying and
    // dissolving as they descend — rather than running as parallel bands,
    // which is what made the old version read as a striped texture.
    float spread = mix(1.0, 3.4, 1.0 - h);
    float s1 = fbm(vec2(ang * 2.0 * spread + uTime * 0.012, h * 0.8));
    float s2 = fbm(vec2(ang * 4.3 * spread - uTime * 0.008, h * 0.5 + 11.0));
    float shaft = smoothstep(0.46, 0.92, s1) * 0.75 + smoothstep(0.55, 0.95, s2) * 0.4;
    // they only exist where the light does, and they fade out well before
    // the bottom of the frame instead of stopping at an edge
    shaft *= smoothstep(0.02, 0.7, h) * (0.35 + 0.65 * pow(h, 1.5));
    col += uShallow * shaft * uSurfaceLight * 0.7;

    // large-scale density variation so even the "empty" water has
    // structure — a perfectly smooth gradient is its own kind of tell
    float mottle = fbm(vec2(ang * 1.3 - uTime * 0.006, h * 2.0 + 3.0));
    col *= 0.88 + mottle * 0.24;

    // Water texture continues through the whole volume. This keeps the
    // opening frame from splitting into a flat turquoise lower half and a
    // separate surface band when the lens is just under the waterline.
    vec2 flowUv = vDir.xz / max(abs(vDir.y), 0.26) * 1.35;
    flowUv += vec2(sin(flowUv.y * 1.4 + uTime * 0.10), cos(flowUv.x * 1.1 - uTime * 0.08)) * 0.55;
    float flowA = fbm(flowUv * 0.72 + vec2(uTime * 0.012, -uTime * 0.008));
    float flowB = fbm(flowUv * 1.55 - vec2(uTime * 0.018, uTime * 0.011));
    float ribbons = smoothstep(0.48, 0.80, flowA) * (0.55 + 0.45 * flowB);
    col += vec3(0.018, 0.13, 0.105) * ribbons * (0.55 + 0.45 * uSurfaceLight);
    float foam = smoothstep(0.77, 0.94, flowB) * smoothstep(0.61, 0.88, flowA);
    col = mix(col, vec3(0.76, 0.92, 0.88), foam * 0.16 * (0.35 + 0.65 * uSurfaceLight));

    // Caustics on the ceiling. Projected onto the horizontal plane
    // overhead (direction divided by its own height), so the web
    // stretches toward the horizon exactly as a real one does instead of
    // sitting flat on the sky like a decal. Only above the eyeline, and
    // only while there is still surface light to make them.
    if (h > 0.5 && uSurfaceLight > 0.02) {
      // Clamped well away from zero. Dividing by a near-zero height
      // sends the UVs to infinity toward the horizon, and the web
      // aliases into a flat wash — which is what turned this into a
      // solid white band rather than a pattern.
      vec2 cuv = vDir.xz / max(vDir.y, 0.30) * 1.05;
      float ca = caustic(cuv, uTime * 0.32);
      float fade = smoothstep(0.54, 0.86, h) * uSurfaceLight;
      col += vec3(0.22, 0.66, 0.62) * ca * fade * 0.72;
    }

    // dither: at these very low light levels an 8-bit framebuffer bands
    // the gradient into visible steps, and no amount of grading fixes
    // that — it has to be broken up before quantisation
    float d = (hash(gl_FragCoord.xy) - 0.5) * (1.4 / 255.0);
    col += d;

    // Above the waterline this is SKY, not water: pale at the horizon,
    // deepening upward. Beat 01 sits above the surface, and the
    // underwater gradient read as night up there.
    if (uAbove > 0.001) {
      vec3 sky = mix(vec3(0.55, 0.74, 0.90), vec3(0.07, 0.28, 0.64), pow(h, 0.42));

      // Clouds, banded toward the horizon. Sampled on the same
      // divide-by-height projection as the caustics, and with the same
      // hard floor under the divisor: at 0.16 the UVs ran away toward
      // the horizon, the noise aliased, and the band of cloud turned
      // into a flat white haze across the whole skyline — which the
      // water then mirrored, and that is what made the sea read as snow.
      vec2 suv = vDir.xz / max(vDir.y, 0.34) * 0.55;
      float cl = fbm(suv * 0.9 + vec2(uTime * 0.004, uTime * 0.002));
      // and they start well above the horizon rather than sitting on it
      cl = smoothstep(0.46, 0.80, cl) * smoothstep(0.58, 0.74, h);
      float cl2 = fbm(suv * 2.1 - vec2(uTime * 0.006, 0.0));
      cl *= 0.55 + 0.45 * cl2;
      sky = mix(sky, vec3(0.94, 0.96, 0.99), cl * 0.7);

      // The sun, and the wash of light around it. Same direction the
      // water surface is lit from, so the specular on the waves and the
      // sun in the sky agree with each other.
      vec3 sunDir = normalize(vec3(-0.38, 0.72, -0.58));
      float sd = max(dot(normalize(vDir), sunDir), 0.0);
      sky += vec3(1.0, 0.96, 0.88) * pow(sd, 900.0) * 2.6;          // disc
      sky += vec3(1.0, 0.93, 0.80) * pow(sd, 34.0) * 0.34;          // glow
      sky += vec3(0.98, 0.92, 0.84) * pow(sd, 5.0) * 0.10;          // haze

      // a thin band of haze right on the horizon, where sea meets sky
      sky = mix(sky, vec3(0.72, 0.82, 0.90), pow(1.0 - abs(h - 0.5) * 2.0, 26.0) * 0.45);
      col = mix(col, sky, uAbove);
    }

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export default function WaterBackdrop() {
  const mat = useRef();

  const uniforms = useMemo(
    () => ({
      uShallow: { value: new THREE.Color("#55c5b6") },
      uDeep: { value: new THREE.Color("#02060f") },
      uSurfaceLight: { value: 1 },
      uAbove: { value: 0 },
      uTime: { value: 0 },
    }),
    [],
  );

  // the shallow tone is what the surface light is made of, so it fades
  // and cools with depth rather than staying a fixed blue
  const shallowShallow = useMemo(() => new THREE.Color("#19d5b0"), []);
  const shallowDeep = useMemo(() => new THREE.Color("#079f98"), []);
  const deepShallow = useMemo(() => new THREE.Color("#0b8990"), []);
  const deepDeep = useMemo(() => new THREE.Color("#01040a"), []);

  useFrame((state, dt) => {
    if (!mat.current) return;
    const { depth } = useDive.getState();
    const d = darkness(depth);
    uniforms.uTime.value = state.clock.elapsedTime;
    // colour falls off faster than the light does: a few metres down,
    // water is already properly blue even though it is still bright
    const dc = Math.pow(d, 0.6);
    uniforms.uShallow.value.copy(shallowShallow).lerp(shallowDeep, dc);
    uniforms.uDeep.value.copy(deepShallow).lerp(deepDeep, dc);
    // 1 at the surface, gone by 3 m — the camera crosses the plane at
    // about 1 m, so this hands over from sky to water as we submerge
    uniforms.uAbove.value = THREE.MathUtils.damp(
      uniforms.uAbove.value,
      1 - THREE.MathUtils.clamp(depth / 3, 0, 1),
      5,
      dt,
    );
    uniforms.uSurfaceLight.value = THREE.MathUtils.damp(
      uniforms.uSurfaceLight.value,
      Math.pow(1 - d, 1.3) * 0.9 + 0.06,
      3,
      dt,
    );
  });

  return (
    <mesh renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[60, 48, 32]} />
      <shaderMaterial
        ref={mat}
        uniforms={uniforms}
        vertexShader={VERT}
        fragmentShader={FRAG}
        side={THREE.BackSide}
        depthWrite={false}
        fog={false}
      />
    </mesh>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  ChromaticAberration,
  EffectComposer,
  SelectiveBloom,
  Vignette as PostVignette,
} from "@react-three/postprocessing";
import * as THREE from "three";
import Torch from "./Torch";
import Particles from "./Particles";
import Haze from "./Haze";
import Bubbles from "./Bubbles";
import WaterBackdrop from "./WaterBackdrop";
import WaterSurface from "./WaterSurface";
import CameraRig from "./CameraRig";
import PartLabels from "./PartLabels";
import FilmGrain from "./FilmGrain";
import { useDive, darkness, sectionAt } from "../state/useDive";
import { setDepth as setAudioDepth } from "../audio/audio";
import DeepSeaBeats from "./DeepSeaBeats";
import { compact } from "../quality";

/**
 * The water column: one colour ramp, sampled by depth.
 * Graded toward deep navy/indigo rather than teal — matching real
 * open-water reference, where red goes first and what survives at
 * depth is blue, not blue-green.
 */
const WATER = [
    { d: 0, c: "#22cdb0" },
    { d: 8, c: "#079e98" },
    { d: 18, c: "#076f8a" },
  { d: 40, c: "#165783" },
  { d: 70, c: "#0b2b4d" },
  { d: 95, c: "#04122a" },
  { d: 104, c: "#01060f" },
];

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

export function waterColour(depth, out = new THREE.Color()) {
  let i = 0;
  while (i < WATER.length - 2 && depth > WATER[i + 1].d) i++;
  const a = WATER[i];
  const b = WATER[i + 1];
  const t = THREE.MathUtils.clamp((depth - a.d) / (b.d - a.d), 0, 1);
  return out.copy(tmpA.set(a.c)).lerp(tmpB.set(b.c), t);
}

/** Renderer-level colour setup — filmic response so highlights (the beam,
 *  the lens, bloom) roll off instead of clipping to flat white. */
function ColourSetup() {
  const { gl } = useThree();
  gl.toneMapping = THREE.ACESFilmicToneMapping;
  gl.toneMappingExposure = 1.05;
  // beat 04 sections the torch with a clipping plane; local (per-material)
  // clipping has to be switched on at the renderer or the planes are ignored
  gl.localClippingEnabled = true;
  if ("outputColorSpace" in gl) gl.outputColorSpace = THREE.SRGBColorSpace;
  return null;
}

/**
 * A procedural environment map: a vertical blue gradient, brighter above.
 * Without one, the torch's real PBR metal has nothing to reflect and
 * reads as flat black plastic — an HDRI is normally where that comes
 * from, but this is generated in a few lines and needs no asset, no
 * network request, and is physically the right shape for underwater
 * (all the light comes from above).
 */
function WaterEnvironment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const w = 64;
    const h = 32;
    const data = new Float32Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      const v = 1 - y / (h - 1); // 1 at the top
      const t = Math.pow(v, 1.6);
      // a hot band just below the zenith stands in for the surface: it is
      // what a metal body actually reflects as a highlight, and without
      // something bright up there metal has nothing to show at all
      const band = Math.exp(-Math.pow((v - 0.88) / 0.1, 2)) * 2.4;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        data[i + 0] = 0.03 + t * 0.75 + band * 0.75;
        data[i + 1] = 0.07 + t * 1.15 + band * 0.9;
        data[i + 2] = 0.14 + t * 1.7 + band * 1.0;
        data[i + 3] = 1;
      }
    }
    const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.needsUpdate = true;

    const pmrem = new THREE.PMREMGenerator(gl);
    const rt = pmrem.fromEquirectangular(tex);
    scene.environment = rt.texture;

    return () => {
      scene.environment = null;
      rt.dispose();
      pmrem.dispose();
      tex.dispose();
    };
  }, [gl, scene]);
  return null;
}

export default function Scene() {
  const { scene } = useThree();
  const ambient = useRef();
  const sun = useRef();
  const col = useRef(new THREE.Color("#dfe7e6"));
  const rim = useRef();
  const ambCool = useRef(new THREE.Color("#7fb4d8"));
  const ambWarm = useRef(new THREE.Color("#c3d6e0"));
  const ambCol = useRef(new THREE.Color());
  const audioT = useRef(0);
  const inspect = useRef();
  const chromaOffset = useRef(new THREE.Vector2(0.0007, 0.00055));
  const [bloomTargets, setBloomTargets] = useState(null);

  const onTorchReady = useCallback((refs) => setBloomTargets(refs), []);

  useFrame((state, dt) => {
    const { depth, pointer } = useDive.getState();
    waterColour(depth, col.current);

    // the ambient light moves with the pointer. Physically this is the
    // surface light shifting as you turn — and practically it means the
    // torch's own highlights travel across its body as you move the
    // mouse, which is what stops a static object looking like a photo.
    audioT.current += dt;
    if (audioT.current > 0.2) {
      audioT.current = 0;
      setAudioDepth(depth);
    }

    // the backdrop sphere paints what you actually see; this is the
    // fallback behind it and, more importantly, the fog colour
    scene.background = null;
    if (!scene.fog) scene.fog = new THREE.FogExp2(col.current.getHex(), 0.02);
    scene.fog.color.copy(col.current);
    scene.fog.density = THREE.MathUtils.lerp(0.012, 0.055, darkness(depth));

    const day = 1 - darkness(depth);
    // reflections die with depth exactly like the light that makes them
    scene.environmentIntensity = 0.025 + day * 1.5;

    if (ambient.current) {
      ambient.current.intensity = THREE.MathUtils.damp(
        ambient.current.intensity,
        (0.025 + day * 1.2) * (1 + pointer.y * 0.18),
        4,
        dt,
      );
      // and cools slightly as the light source swings across
      ambCol.current
        .copy(ambCool.current)
        .lerp(ambWarm.current, THREE.MathUtils.clamp(pointer.x * 0.5 + 0.5, 0, 1));
      ambient.current.color.lerp(ambCol.current, 1 - Math.exp(-4 * dt));
    }
    if (rim.current) {
      rim.current.position.x = THREE.MathUtils.damp(rim.current.position.x, -4 + pointer.x * 5.5, 3, dt);
      rim.current.position.y = THREE.MathUtils.damp(rim.current.position.y, 3 + pointer.y * 3.5, 3, dt);
      rim.current.intensity = THREE.MathUtils.damp(
        rim.current.intensity,
        day * 1.25 * (0.75 + Math.abs(pointer.x) * 0.5),
        3,
        dt,
      );
    }
    // Beat 04's inspection light. At 40 m there is essentially no
    // ambient left, and the torch's own lamp is now pointing out of a
    // hole in its side rather than lighting anything useful — so a cut
    // housing at working depth is a dark grey shape. This is the lamp a
    // cutaway drawing implies and never shows: it rides just off the
    // camera, so whatever the section is facing is what gets lit, and it
    // exists only while the section is open.
    if (inspect.current) {
      const sec = sectionAt(depth);
      inspect.current.visible = sec > 0.01;
      if (inspect.current.visible) {
        inspect.current.position.copy(state.camera.position);
        inspect.current.position.y += 0.5;
        inspect.current.intensity = sec * 5.5;
      }
    }

    if (sun.current)
      sun.current.intensity = THREE.MathUtils.damp(sun.current.intensity, day * 2.0, 4, dt);

  });

  return (
    <>
      <ColourSetup />
      <WaterEnvironment />
      <WaterBackdrop />
      <WaterSurface />
      <DeepSeaBeats />
      <CameraRig targets={bloomTargets} />

      <ambientLight ref={ambient} intensity={1.2} color="#a8c8dc" />
      <directionalLight ref={sun} position={[-3.8, 7.2, -5.8]} intensity={2} color="#ffe6b8" />
      {/* rim: without it the torch is a black cutout against the water at
          depth — real objects underwater still catch a cold edge light
          from the surface glow behind and above them */}
      <directionalLight ref={rim} position={[-4, 3, -5]} intensity={1.5} color="#6aa8d8" />
      <pointLight ref={inspect} intensity={0} distance={9} decay={1.7} color="#cfe4f2" visible={false} />

      <Torch onReady={onTorchReady} />
      <Particles count={compact ? 350 : 900} />
      <Haze />
      {bloomTargets?.group && <Bubbles originRef={{ current: bloomTargets.group }} />}
      {bloomTargets?.parts && <PartLabels parts={bloomTargets.parts} />}

      {/* Selective bloom on the beam and lens only — independent of how
          bright the water is at this depth. GodRays used to run here too
          and was removed: its sampling kernel drew visible concentric
          rings around the lens, and perfect rings are the single most
          obvious "this is a 3D render" tell in the whole frame.

          The grain is a custom pass rather than the stock Noise effect:
          that one adds flat white noise to every pixel independently,
          which reads as a broken sensor. See FilmGrain.jsx. */}
      {bloomTargets && (
        <EffectComposer multisampling={0}>
            <SelectiveBloom
            selection={[bloomTargets.beam, bloomTargets.glow, bloomTargets.lensMesh].filter(Boolean)}
            lights={[bloomTargets.spot, bloomTargets.bounce].filter(Boolean)}
            intensity={0.85}
            luminanceThreshold={0}
            luminanceSmoothing={0.9}
            mipmapBlur={!compact}
            resolutionScale={compact ? 0.5 : 1}
            radius={0.35}
            />
            <PostVignette eskil={false} offset={0.18} darkness={0.38} />
            <ChromaticAberration
              offset={chromaOffset.current}
              radialModulation
              modulationOffset={0.22}
            />
            <FilmGrain intensity={0.014} grainSize={1.7} />
        </EffectComposer>
      )}
    </>
  );
}

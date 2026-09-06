import { useMemo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useDive, darkness } from "../state/useDive";

/** Soft round dot canvas texture with proper GPU disposal */
function useSoftDot() {
  const texture = useMemo(() => {
    const size = 64;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(
      size / 2, size / 2, 0,
      size / 2, size / 2, size / 2
    );
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }, []);

  // Dispose texture when component unmounts
  useEffect(() => {
    return () => texture.dispose();
  }, [texture]);

  return texture;
}

const VERT = `
  attribute float aSize;
  attribute float aSeed;
  attribute float aBrightness;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uScale;
  varying float vBrightness;

  void main() {
    vBrightness = aBrightness;
    vec3 pos = position;

    // Slow per-particle sway
    pos.x += sin(uTime * 0.15 + aSeed * 6.2831) * 0.4;
    pos.z += cos(uTime * 0.11 + aSeed * 6.2831) * 0.4;

    // Continuous rise-and-wrap on GPU
    pos.y = mod(position.y + uTime * 0.09 + aSeed * 14.0, 14.0) - 7.0;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // تم تقليل الحد الأقصى لحجم النقطة إلى 35.0 لحمايتها من التضخم أمام الكاميرا
    gl_PointSize = min(aSize * uPixelRatio * (uScale / -mvPosition.z), 35.0);
  }`;

const FRAG = `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vBrightness;

  void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(uColor, tex.a * uOpacity * vBrightness);
  }`;

export default function Particles({ count = 900 }) {
  const materialRef = useRef();
  const dot = useSoftDot();

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uPixelRatio: { value: 1 },
      uScale: { value: 90 },
      uMap: { value: dot },
      uColor: { value: new THREE.Color("#cfe8ff") },
    }),
    [dot]
  );

  const [positions, sizes, seeds, brightness] = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const seed = new Float32Array(count);
    const bright = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      pos[i * 3 + 0] = (Math.random() - 0.5) * 26;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 14;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 16;
      seed[i] = Math.random();
      
      // تم تصغير الحجم الأساسي (من 0.022 إلى 0.01) والحد الأقصى للتفاوت (من 0.11 إلى 0.04)
      size[i] = 0.01 + Math.pow(Math.random(), 3) * 0.04;
      
      bright[i] = 0.35 + Math.random() * 0.65;
    }
    return [pos, size, seed, bright];
  }, [count]);

  useFrame((state, dt) => {
    if (!materialRef.current) return;

    const u = materialRef.current.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    u.uPixelRatio.value = state.gl.getPixelRatio();
    u.uScale.value =
      state.size.height / 2 / Math.tan((state.camera.fov * Math.PI) / 360);

    const { depth, on } = useDive.getState();
    const twinkle = 0.85 + Math.sin(state.clock.elapsedTime * 0.6) * 0.15;
    
    u.uOpacity.value = THREE.MathUtils.damp(
      u.uOpacity.value,
      (on ? 0.3 : 0.09) * (0.25 + darkness(depth) * 0.75) * twinkle,
      3,
      dt
    );
  });

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aSize" args={[sizes, 1]} />
        <bufferAttribute attach="attributes-aSeed" args={[seeds, 1]} />
        <bufferAttribute attach="attributes-aBrightness" args={[brightness, 1]} />
      </bufferGeometry>
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={VERT}
        fragmentShader={FRAG}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
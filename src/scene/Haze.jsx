import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useDive, darkness } from "../state/useDive";
import { waterColour } from "./Scene";

/** Soft, low-contrast blob with a gentle falloff — deliberately much
 *  weaker at the center than the marine-snow dot. This is meant to be
 *  invisible as a shape and only readable as a drifting density change. */
function useHazeTexture() {
  return useMemo(() => {
    const size = 128;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    // A gaussian falloff, not a linear one. With a linear ramp the alpha
    // is still ~0.1 close to the sprite's edge and then stops, and the eye
    // reads that step as a circle — which is exactly what was showing up
    // as a faint disc hanging behind the torch. This is effectively zero
    // well before the edge, so there is no boundary to see.
    [
      [0, 0.45], [0.15, 0.385], [0.3, 0.241], [0.45, 0.111],
      [0.6, 0.037], [0.75, 0.009], [0.88, 0.002], [1, 0],
    ].forEach(([stop, a]) => g.addColorStop(stop, `rgba(255,255,255,${a})`));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }, []);
}

const COUNT = 9;

/**
 * Drifting fog — a handful of small, faint, NORMAL-blended (not additive)
 * sprites wandering through the mid-ground. Additive blending was tried
 * first and stacked into a blown-out white wash the moment two or three
 * overlapped; normal blending lets them veil what's behind them a little
 * instead of only ever adding brightness, which is what actually reads
 * as "drifting haze" rather than "someone smeared vaseline on the lens".
 * Kept small and sparse on purpose — this is meant to be felt, not seen.
 */
export default function Haze() {
  const tex = useHazeTexture();
  const bg = useRef(new THREE.Color());
  const tint = useRef(new THREE.Color());
  const refs = useRef([]);

  const instances = useMemo(() => {
    const arr = [];
    for (let i = 0; i < COUNT; i++) {
      arr.push({
        base: new THREE.Vector3(
          (Math.random() - 0.5) * 16 + 2,
          (Math.random() - 0.5) * 8,
          -3 - Math.random() * 8,
        ),
        amp: new THREE.Vector3(1 + Math.random(), 0.6 + Math.random() * 0.8, 1 + Math.random()),
        speed: 0.025 + Math.random() * 0.04,
        phase: Math.random() * Math.PI * 2,
        scale: 1.4 + Math.random() * 2,
      });
    }
    return arr;
  }, []);

  useFrame((state, dt) => {
    const { depth, on } = useDive.getState();
    const t = state.clock.elapsedTime;
    waterColour(depth, bg.current);
    tint.current.copy(bg.current).lerp(new THREE.Color("#ffffff"), 0.2);

    const target = (on ? 0.075 : 0.045) * (0.35 + darkness(depth) * 0.95);

    instances.forEach((inst, i) => {
      const s = refs.current[i];
      if (!s) return;
      s.position.set(
        inst.base.x + Math.sin(t * inst.speed + inst.phase) * inst.amp.x,
        inst.base.y + Math.sin(t * inst.speed * 0.7 + inst.phase * 1.3) * inst.amp.y,
        inst.base.z + Math.cos(t * inst.speed * 0.5 + inst.phase) * inst.amp.z,
      );
      s.material.color.copy(tint.current);
      s.material.opacity = THREE.MathUtils.damp(s.material.opacity, target, 2, dt);
    });
  });

  return (
    <>
      {instances.map((inst, i) => (
        <sprite key={i} ref={(el) => (refs.current[i] = el)} scale={[inst.scale, inst.scale, 1]}>
          <spriteMaterial
            map={tex}
            transparent
            opacity={0}
            depthWrite={false}
          />
        </sprite>
      ))}
    </>
  );
}

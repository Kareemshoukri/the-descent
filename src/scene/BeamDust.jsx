import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useDive, explodeAt } from "../state/useDive";
import { compact } from "../quality";

/**
 * The dust suspended inside the light shaft. This is now the PRIMARY
 * thing you see when the torch is on — the cone mesh behind it was
 * turned down to a faint fill, because a mesh has a straight silhouette
 * and a real beam has no edge at all. A beam is only visible because
 * particles are scattering light back at you, so making the particles
 * the beam (rather than a translucent triangle with particles inside)
 * is both closer to the physics and free of any hard boundary.
 *
 * Brightness falls off two ways: along the shaft (light gets weaker with
 * distance) and radially (so the outside of the cone dissolves rather
 * than stopping at a line). Both are recomputed every frame from each
 * particle's CURRENT position, not baked at spawn.
 */
const RADIUS = 3.1;
/** The shaft starts at the lens diameter, not at a point. */
const RADIUS0 = 0.28;
const LENGTH = 14;
const COUNT = compact ? 1400 : 4000;

function useSoftDot() {
  return useMemo(() => {
    const size = 48;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,0.5)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }, []);
}

function radiusAt(y) {
  const u = (LENGTH / 2 - y) / LENGTH; // 0 at the lens, 1 at the far end
  return RADIUS0 + (RADIUS - RADIUS0) * u;
}

export default function BeamDust() {
  const points = useRef();
  const dot = useSoftDot();

  const positions = useMemo(() => {
    const pos = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      // uniform along the length: real suspended dust is visible
      // throughout the shaft, not clustered at one end
      const y = LENGTH / 2 - Math.random() * LENGTH;
      const r = radiusAt(y) * Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      pos[i * 3 + 0] = r * Math.cos(a);
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = r * Math.sin(a);
    }
    return pos;
  }, []);

  const colors = useMemo(() => new Float32Array(COUNT * 3).fill(1), []);

  useFrame((state, dt) => {
    if (!points.current) return;
    const { on, mode, zoom, depth } = useDive.getState();
    // a long frame must not teleport every particle to the end of the
    // shaft at once — that recycles them into one travelling clump
    const step = Math.min(dt, 0.05);
    const pos = points.current.geometry.attributes.position.array;
    const col = points.current.geometry.attributes.color.array;

    for (let i = 0; i < COUNT; i++) {
      const xi = i * 3;
      const yi = xi + 1;
      const zi = xi + 2;
      pos[yi] -= step * 0.9;

      if (pos[yi] < -LENGTH / 2) {
        const r0 = RADIUS0 * Math.sqrt(Math.random());
        const a0 = Math.random() * Math.PI * 2;
        pos[xi] = r0 * Math.cos(a0);
        pos[yi] = LENGTH / 2 - 0.05;
        pos[zi] = r0 * Math.sin(a0);
      }

      // along the shaft
      const u = (LENGTH / 2 - pos[yi]) / LENGTH;
      let brightness = THREE.MathUtils.lerp(1.0, 0.3, u);

      // and radially — this is what removes the cone's edge: dust at the
      // outside of the shaft simply fades out instead of ending at a line
      const rMax = Math.max(radiusAt(pos[yi]), 0.001);
      const rf = Math.min(Math.hypot(pos[xi], pos[zi]) / rMax, 1);
      brightness *= 1 - rf * rf * 0.85;

      col[xi] = col[yi] = col[zi] = brightness;
    }
    points.current.geometry.attributes.position.needsUpdate = true;
    points.current.geometry.attributes.color.needsUpdate = true;

    const spread = THREE.MathUtils.lerp(0.4, 1.7, zoom);
    points.current.scale.set(spread, 1, spread);

    // matches the torch's own fade for beat 05: a shaft full of dust
    // across an exploded diagram is clutter
    const intensity =
      (on ? ([1, 0.6, 0.28, 1, 0.7][mode] ?? 1) : 0) * (1 - explodeAt(depth) * 0.9);
    points.current.material.opacity = THREE.MathUtils.damp(
      points.current.material.opacity,
      intensity * 0.75,
      6,
      dt,
    );
  });

  return (
    <points ref={points} position={[7, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={COUNT} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-color" count={COUNT} array={colors} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial
        map={dot}
        size={0.028}
        vertexColors
        sizeAttenuation
        transparent
        opacity={0}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

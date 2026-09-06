import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useDive, darkness } from "../state/useDive";
import { playBubble } from "../audio/audio";
import { compact } from "../quality";

const COUNT = compact ? 22 : 44;
const RANGE = 3.6;

export default function Bubbles({ originRef }) {
  const mesh = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const prevPointer = useRef({ x: 0, y: 0 });
  const stir = useRef(0);
  const nextSound = useRef(1.5);

  const seeds = useMemo(
    () =>
      Array.from({ length: COUNT }, () => ({
        x: (Math.random() - 0.5) * 0.55,
        z: (Math.random() - 0.5) * 0.55,
        y: Math.random() * RANGE - RANGE / 2,
        vx: 0,
        vz: 0,
        r: 0.012 + Math.pow(Math.random(), 2) * 0.055,
        speed: 0.3 + Math.random() * 0.5,
        wobble: 0.5 + Math.random() * 1.6,
        phase: Math.random() * Math.PI * 2,
        // Individual lag factor so each bubble responds at a unique rate
        reactionDelay: 0.4 + Math.random() * 0.8,
      })),
    [],
  );

  const material = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        transmission: compact ? 0 : 1,
        roughness: 0,
        metalness: 0,
        ior: 1.35,
        thickness: 0.01,
        iridescence: compact ? 0 : 1,
        iridescenceIOR: 1.3,
        iridescenceThicknessRange: [120, 520],
        envMapIntensity: 2.2,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        clearcoat: 1,
        clearcoatRoughness: 0,
      }),
    [],
  );

  useLayoutEffect(() => {
    if (!mesh.current) return;
    seeds.forEach((s, i) => {
      dummy.position.set(s.x, s.y, s.z);
      dummy.scale.setScalar(s.r);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  }, [seeds, dummy]);

  useFrame((state, dt) => {
    if (!mesh.current) return;
    if (originRef?.current) mesh.current.position.copy(originRef.current.position);

    const step = Math.min(dt, 0.05);
    const t = state.clock.elapsedTime;

    const { pointer, depth } = useDive.getState();

    const dx = pointer.x - prevPointer.current.x;
    const dy = pointer.y - prevPointer.current.y;
    prevPointer.current.x = pointer.x;
    prevPointer.current.y = pointer.y;

    const speedNow = Math.min(Math.hypot(dx, dy) / Math.max(step, 0.001), 6);
    stir.current = THREE.MathUtils.damp(stir.current, speedNow, 2.5, dt);

    for (let i = 0; i < COUNT; i++) {
      const s = seeds[i];

      // 1. Calculate distance between the pointer and this specific bubble
      const distToPointer = Math.hypot(s.x - pointer.x, s.y - pointer.y);

      // 2. Smooth proximity weight (bubbles closer to cursor react much stronger)
      const influenceRadius = 1.2;
      const proximity = Math.max(0, 1 - distToPointer / influenceRadius);
      const smoothInfluence = proximity * proximity; // Smooth falloff curve

      // 3. Individual carry strength based on bubble size & unique delay factor
      const carry = THREE.MathUtils.clamp(0.02 / s.r, 0.35, 2.4) * s.reactionDelay;

      // 4. Target force calculated specifically for this bubble
      const targetVx = dx * 8.0 * carry * smoothInfluence;
      const targetVz = dy * 3.5 * carry * smoothInfluence;

      // 5. Slowly damp current velocity toward the target velocity (creates the slow/delayed push effect)
      s.vx = THREE.MathUtils.damp(s.vx, s.vx + targetVx, 2.0, step);
      s.vz = THREE.MathUtils.damp(s.vz, s.vz + targetVz, 2.0, step);

      // Restoring pull back to center column
      s.vx += -s.x * 1.2 * step;
      s.vz += -s.z * 1.2 * step;

      // Smooth drag
      const drag = Math.exp(-2.2 * step);
      s.vx *= drag;
      s.vz *= drag;

      s.x += s.vx * step;
      s.z += s.vz * step;

      // Stirring lifts bubbles individually based on their proximity to the cursor
      const localStir = stir.current * (0.1 + smoothInfluence * 0.9);
      s.y += step * s.speed * (1 + localStir * 0.25);

      if (s.y > RANGE / 2) {
        s.y = -RANGE / 2;
        s.x = (Math.random() - 0.5) * 0.55;
        s.z = (Math.random() - 0.5) * 0.55;
        s.vx = 0;
        s.vz = 0;
      }

      // Wobble & deformation
      const w = s.wobble * (1 + localStir * 0.35);
      dummy.position.set(
        s.x + Math.sin(t * w + s.phase) * 0.035,
        s.y,
        s.z + Math.cos(t * w * 0.8 + s.phase) * 0.035,
      );

      const squash = 1 + Math.sin(t * w * 1.7 + s.phase) * 0.12;
      dummy.scale.set(s.r * squash, s.r / squash, s.r * squash);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
    }
    mesh.current.instanceMatrix.needsUpdate = true;

    // Sound logic
    if (depth > 1) {
      nextSound.current -= step;
      if (nextSound.current <= 0) {
        playBubble(0.5 + Math.random() * 0.5);
        if (Math.random() < 0.35) setTimeout(() => playBubble(0.4), 90 + Math.random() * 140);
        nextSound.current = (1.1 + Math.random() * 2.6) / (1 + stir.current * 0.8);
      }
    }

    material.opacity = THREE.MathUtils.damp(
      material.opacity,
      (compact ? 0.22 : 0.75) * THREE.MathUtils.clamp(depth / 3, 0, 1) * (0.45 + darkness(depth) * 0.55),
      3,
      dt,
    );
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, COUNT]} material={material} frustumCulled={false}>
      <sphereGeometry args={[1, compact ? 8 : 14, compact ? 6 : 10]} />
    </instancedMesh>
  );
}

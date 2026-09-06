import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { useDive } from "../state/useDive";

import { compact } from "../quality";
const MODEL_URL = `${import.meta.env.BASE_URL}models/manta-ray${compact ? "-mobile" : ""}.glb`;

function MantaModel() {
  const { scene, animations } = useGLTF(MODEL_URL);
  const root = useRef();
  const light = useRef();
  const time = useRef(0);
  // SkeletonUtils keeps the cloned mesh bound to its own animated bones.
  // The outer groups own staging; the imported hierarchy stays untouched.
  const model = useMemo(() => {
    const copy = clone(scene);
    copy.traverse((object) => {
      // The feeding animation extends beyond the rest-pose bounding sphere.
      if (object.isMesh) object.frustumCulled = false;
    });
    return copy;
  }, [scene]);
  const mixer = useMemo(() => new THREE.AnimationMixer(model), [model]);

  useEffect(() => {
    const action = mixer.clipAction(animations[0]);
    action.reset().setLoop(THREE.LoopRepeat, Infinity).play();
    mixer.update(0);
    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
    };
  }, [animations, mixer, model]);

  useFrame((state, dt) => {
    const { depth, on } = useDive.getState();
    const enter = THREE.MathUtils.smoothstep(depth, 103, 108);
    const leave = THREE.MathUtils.smoothstep(depth, 112, 117);
    const visible = depth > 103 && depth < 117;
    root.current.visible = visible;
    if (!visible) return;
    const step = Math.min(dt, 0.05);
    time.current += step;
    mixer.update(step);
    // Approach from the right, hold in the beam, then swim past on descent.
    // Scroll controls the encounter; the supplied 24-second clip keeps playing.
    root.current.position.set(
      0.55 + Math.sin(time.current * 0.2) * 0.12,
      0.35 + Math.sin(time.current * 0.4) * 0.06,
      -9.0 + enter * 7.5 - leave * 4.0,
    );
    root.current.rotation.set(0.65, -0.65 + leave * 0.3, -0.06);
    light.current.intensity = (on ? 7 : 0.3) * enter * (1 - leave);
  });

  return (
    <group ref={root} name="FISH_STAGE_SLOT" visible={false}>
      {/* Source export is in centimetres. Size covers the full feeding cycle. */}
      <group scale={0.0055}>
        <primitive object={model} position={[0, 0, 110]} dispose={null} />
      </group>
      <pointLight ref={light} position={[-0.5, 1.3, 2]} color="#b7dce9" distance={7} decay={2} intensity={0} />
    </group>
  );
}

export default function AnimatedManta() {
  const nearEncounter = useDive((state) => state.depth >= 70);
  const [requested, setRequested] = useState(nearEncounter);
  useEffect(() => {
    if (nearEncounter) setRequested(true);
  }, [nearEncounter]);
  // A local boundary keeps the torch and water live while the asset downloads.
  return <Suspense fallback={null}>{requested && <MantaModel />}</Suspense>;
}

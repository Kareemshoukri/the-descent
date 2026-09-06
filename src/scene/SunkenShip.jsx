import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useDive } from "../state/useDive";
import { prepareShip } from "./shipModel";

export const SEABED_Y = -2.3;
import { compact } from "../quality";
const MODEL_URL = `${import.meta.env.BASE_URL}models/dutch-ship${compact ? "-mobile" : ""}.glb`;

function ShipModel() {
  const { scene } = useGLTF(MODEL_URL);
  const model = useMemo(() => prepareShip(scene), [scene]);
  const root = useRef();
  const light = useRef();
  useFrame(() => {
    const { depth } = useDive.getState();
    const reveal = THREE.MathUtils.smoothstep(depth, 116, 126);
    root.current.visible = depth > 116;
    root.current.position.set(0.55, SEABED_Y - 0.04, -2.5 - (1 - reveal) * 14);
    // The torch is the only reveal light at the floor. A separate fill
    // would make the wreck visible before the user aims the beam.
    light.current.intensity = 0;
  });
  return (
    <group ref={root} name="WRECK_STAGE_SLOT" visible={false}>
      <primitive object={model} name="WRECK_MODEL_SLOT" dispose={null} />
      <pointLight ref={light} position={[-1, 3, 3]} color="#b2d9d2" intensity={0} distance={12} decay={2} />
    </group>
  );
}

export default function SunkenShip() {
  const nearWreck = useDive((state) => state.depth >= 95);
  const [requested, setRequested] = useState(nearWreck);
  useEffect(() => {
    if (nearWreck) setRequested(true);
  }, [nearWreck]);
  return <Suspense fallback={null}>{requested && <ShipModel />}</Suspense>;
}

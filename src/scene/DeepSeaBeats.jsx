import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useDive } from "../state/useDive";
import AnimatedManta from "./AnimatedManta";
import SunkenShip, { SEABED_Y } from "./SunkenShip";
import { activeWaterGpu } from "./waterGpu";
import { compact } from "../quality";

function Seabed() {
  const group = useRef();
  const material = useRef();
  const light = useRef();
  const geometry = useMemo(() => {
    const plane = new THREE.PlaneGeometry(50, 50, compact ? 80 : 160, compact ? 80 : 160);
    const positions = plane.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i);
      positions.setZ(i, Math.sin(x * 1.6 + Math.sin(y * 0.5)) * 0.035
        + Math.sin(y * 0.7 + x * 0.3) * 0.028);
    }
    plane.computeVertexNormals();
    return plane;
  }, []);
  useFrame(() => {
    const { depth } = useDive.getState();
    const reveal = THREE.MathUtils.smoothstep(depth, 116, 125);
    group.current.visible = reveal > 0.001;
    material.current.opacity = reveal;
    light.current.intensity = 0;
    const shader = material.current?.userData?.shader;
    if (shader && activeWaterGpu.current?.caustics) {
      shader.uniforms.uCaustics.value = activeWaterGpu.current.caustics;
    }
  });
  return (
    <group ref={group} visible={false} name="SEABED_STAGE">
      <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, SEABED_Y, -2.5]}>
        <meshStandardMaterial ref={material} color="#53736a" roughness={1} transparent opacity={0}
          onBeforeCompile={(shader) => {
            shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vSand;");
            shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvSand = position.xy;");
            shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec2 vSand; uniform sampler2D uCaustics;");
            shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
              float ripple = sin(vSand.x * 22.0 + sin(vSand.y * 1.7) * 2.0);
              float grain = fract(sin(dot(vSand, vec2(127.1, 311.7))) * 43758.5453);
              diffuseColor.rgb *= 0.88 + ripple * 0.08 + grain * 0.1;
              float gpuCaustic = texture2D(uCaustics, vSand / 16.0 + 0.5).r;
              diffuseColor.rgb += vec3(0.34, 0.56, 0.42) * gpuCaustic * 0.28;
              diffuseColor.a *= 1.0 - smoothstep(11.0, 24.0, length(vSand));`);
            shader.uniforms.uCaustics = { value: null };
            material.current.userData.shader = shader;
          }} />
      </mesh>
      <pointLight ref={light} position={[-1.5, 0.2, 0]} color="#86b7b0" intensity={0} distance={16} decay={2} />
      {[[ -2.7, -3.8, 0.25 ], [ 3, -2.6, 0.18 ], [ 2.1, -0.4, 0.12 ], [ -2, 0.1, 0.1 ], [ 3.8, -5.5, 0.3 ]].map(([x, z, s], i) => (
        <mesh key={i} position={[x, SEABED_Y + s * 0.25, z]} scale={[s * 1.5, s * 0.75, s]} rotation={[0.2, i, 0.1]}>
          <dodecahedronGeometry args={[1, 1]} />
          <meshStandardMaterial color="#354e47" roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

export default function DeepSeaBeats() {
  return <><AnimatedManta /><Seabed /><SunkenShip /></>;
}

import * as THREE from "three";

export function prepareShip(scene) {
  const model = scene.clone(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = 4.3 / Math.max(size.x, size.y, size.z);
  const normalized = new THREE.Group();
  normalized.scale.setScalar(scale);
  normalized.position.copy(center).multiplyScalar(-scale);
  normalized.add(model);
  const tilted = new THREE.Group();
  tilted.rotation.set(0.04, -1.08, -0.18);
  tilted.add(normalized);
  model.traverse((object) => {
    if (!object.isMesh) return;
    const weather = (source) => {
      const material = source.clone();
      material.color.lerp(new THREE.Color("#42655c"), 0.24);
      material.roughness = Math.max(material.roughness ?? 0.8, 0.84);
      material.envMapIntensity = 0.45;
      return material;
    };
    object.material = Array.isArray(object.material)
      ? object.material.map(weather) : weather(object.material);
  });
  // Ground after rotation so the tilted keel stays on the sand.
  tilted.updateMatrixWorld(true);
  box.setFromObject(tilted);
  tilted.position.y = -box.min.y;
  return tilted;
}
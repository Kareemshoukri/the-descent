import * as THREE from "three";

// Shared by the model, camera and accessible screen-space hit target.
// Geometry runs first (-2), camera/projection second (-1), then rendering.
export const switchScreen = {
  x: 0, y: 0, r: 18, live: false, hovered: false, keyboardFocus: false,
  held: false, suppressHover: false, press: null, activate: null, cancel: null,
};
export const switchFocus = {
  active: false,
  anchor: new THREE.Vector3(),
  cameraPosition: new THREE.Vector3(),
  cameraQuaternion: new THREE.Quaternion(),
};

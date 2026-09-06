// Preserve a chosen point through rotation, then dolly on its original ray.
// These two constraints keep an off-centre button under the pointer.
export function rotateAboutAnchor(group, localPoint, anchor, scratch) {
  scratch.copy(localPoint).applyQuaternion(group.quaternion);
  group.position.copy(anchor).sub(scratch);
}

export function dollyToAnchor(camera, start, orientation, anchor, progress) {
  camera.position.lerpVectors(start, anchor, progress);
  camera.quaternion.copy(orientation);
  camera.updateMatrixWorld(true);
}

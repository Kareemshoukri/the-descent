import { useRef } from "react";
import { dollyToAnchor } from "./switchFocusMath";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useDive, darkness, explodeAt, sectionAt } from "../state/useDive";
import { switchFocus, switchScreen } from "../state/switchScreen";

// Depth framing and a screen-anchored switch dolly.
const restPos = new THREE.Vector3();
const target = new THREE.Vector3();
const lookAt = new THREE.Vector3();
const buttonPos = new THREE.Vector3();
const cutUp = new THREE.Vector3();
const torchPos = new THREE.Vector3();

export default function CameraRig({ targets }) {
  const look = useRef(new THREE.Vector3(0, 0, 0));
  const hover = useRef(0);

  useFrame((state, dt) => {
    const { depth } = useDive.getState();
    const cam = state.camera;

    // Beat 01 sits above the waterline, looking slightly down at the torch
    // floating just beneath it. The dive then carries the camera below.
    const surf = 1 - THREE.MathUtils.clamp(depth / 4, 0, 1);
    const fit = Math.max(1, 0.88 / cam.aspect);
    restPos.set(0, 1.15 * surf * fit, (3.4 + darkness(depth) * 0.8) * fit);
    target.copy(restPos);
    lookAt.set(0, -0.28 * surf, 0);

    const floorT = THREE.MathUtils.smoothstep(depth, 116, 130);
    if (floorT > 0) {
      target.y -= floorT * 0.15;
      target.z += floorT * 1.4 * fit;
      lookAt.set(0.15 * floorT, -0.4 * floorT, -1.2 * floorT);
    }

    // Beat 05 — an exploded assembly needs to be seen end-on and whole.
    // In the resting shot the torch is large and off to one side, which
    // is right for the beam beats and useless for this one.
    // Beat 05 — push IN on the opened assembly rather than backing off.
    // The parts are spread wide, so this frames the internals across the
    // middle of the object instead of showing the whole thing small.
    // Beat 04 — the section. The cut is taken along the barrel's
    // centreline, so it only reads from above: at the resting eye level
    // you are looking edge-on at the open face and see almost nothing of
    // the inside. This lifts the camera over it and closes in, which is
    // how a cutaway is drawn in a manual for exactly the same reason.
    const sec = sectionAt(depth);
    if (sec > 0.001) {
      const e = sec * sec * (3 - sec * 2);
      // The cut is taken along the torch's OWN up axis, so where you have
      // to stand to see into it depends on how the torch is turned. A
      // fixed camera lift only works while the body happens to be the
      // right way up — spin it and you end up looking at the back of a
      // solid half. This moves the camera onto whichever side the open
      // face is actually pointing.
      if (targets?.group) {
        cutUp.set(0, 1, 0).applyQuaternion(targets.group.quaternion);
        // toward the viewer, never away: the cut can face into the screen
        // just as easily, and then the shot is of nothing at all
        if (cutUp.z < 0) cutUp.negate();
        cutUp.y = Math.abs(cutUp.y) * 0.85 + 0.5;
        cutUp.normalize();
        target.addScaledVector(cutUp, e * 1.35);
        // and frame the object itself. The torch does not sit at the
        // origin, so the resting aim leaves it well off to one side —
        // fine for a beam shot across the frame, useless for reading
        // components a few centimetres across.
        targets.group.getWorldPosition(torchPos);
        lookAt.lerp(torchPos, e * 0.9);
      } else {
        target.y += e * 1.05;
      }
      target.z -= e * 1.5;
      target.x += e * -0.35;
    }

    const ex = explodeAt(depth);
    if (ex > 0.001) {
      // Still closer than the resting shot — but the assembly opens
      // along a diagonal, so the frame also has to travel with it or the
      // battery tube simply leaves the picture.
      target.z -= ex * 0.3;
      target.x += ex * -0.95;
      target.y += ex * -0.55;
      lookAt.set(-1.15 * ex, -0.6 * ex, 0);
    }

    // A dolly along a FIXED ray with a FIXED camera orientation keeps
    // the switch at exactly the same NDC position, even off-centre.
    if (switchFocus.active) {
      hover.current = THREE.MathUtils.damp(hover.current, 1, 6, dt);
      dollyToAnchor(cam, switchFocus.cameraPosition, switchFocus.cameraQuaternion, switchFocus.anchor, hover.current * 0.48);
    } else {
      hover.current = 0;
      cam.position.lerp(target, 1 - Math.exp(-6 * dt));
      look.current.lerp(lookAt, 1 - Math.exp(-6 * dt));
      // Smooth quaternion return, including after a switch was clicked.
      const previous = cam.quaternion.clone();
      cam.lookAt(look.current);
      cam.quaternion.slerpQuaternions(previous, cam.quaternion.clone(), 1 - Math.exp(-6 * dt));
    }
    cam.updateMatrixWorld(true);

    // Project only AFTER both transforms. This also supplies a real DOM
    // button for keyboard, touch and stable pointer capture.
    if (targets?.button) {
      const button = targets.button;
      button.geometry.boundingBox.getCenter(buttonPos);
      button.localToWorld(buttonPos);
      const projected = buttonPos.clone().project(cam);
      const normal = new THREE.Vector3(0, 1, 0).transformDirection(button.matrixWorld);
      const facing = normal.dot(target.clone().copy(cam.position).sub(buttonPos).normalize());
      button.geometry.boundingBox.getSize(torchPos);
      button.getWorldScale(cutUp);
      const radius = Math.max(torchPos.x * cutUp.x, torchPos.z * cutUp.z) * 0.5;
      cutUp.setFromMatrixColumn(cam.matrixWorld, 0).multiplyScalar(radius).add(buttonPos).project(cam);
      switchScreen.x = (projected.x * 0.5 + 0.5) * state.size.width;
      switchScreen.y = (-projected.y * 0.5 + 0.5) * state.size.height;
      switchScreen.r = Math.max(18, Math.abs(cutUp.x - projected.x) * state.size.width * 0.5 + 8);
      switchScreen.live = projected.z > -1 && projected.z < 1 && facing > 0.08 && sec < 0.02 && ex < 0.02;
    }
  }, -1);

  return null;
}

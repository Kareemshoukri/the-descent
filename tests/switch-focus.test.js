import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { rotateAboutAnchor, dollyToAnchor } from '../src/scene/switchFocusMath.js';

test('off-centre switch stays under the pointer through tilted rotation and zoom', () => {
  for (const [width,height] of [[1440,900],[390,844],[1024,768]]) {
    const camera = new THREE.PerspectiveCamera(42,width/height,0.1,100);
    camera.position.set(0,1.15,3.4);
    camera.lookAt(0,-0.28,0);
    camera.updateMatrixWorld();
    const start=camera.position.clone(), orientation=camera.quaternion.clone();
    const group=new THREE.Group();
    group.position.set(-0.1,-0.08,0.15);
    group.rotation.set(-0.16,0.85,0);
    group.updateMatrixWorld();
    const local=new THREE.Vector3(0.29,0.18,0.02);
    const anchor=group.localToWorld(local.clone());
    const original=anchor.clone().project(camera);
    const normal=new THREE.Vector3(0,1,0).applyQuaternion(group.quaternion);
    const view=start.clone().sub(anchor).normalize();
    const tilted=view.clone().addScaledVector(new THREE.Vector3(0,1,0).applyQuaternion(orientation),0.23).normalize();
    const initial=group.quaternion.clone();
    const final=new THREE.Quaternion().setFromUnitVectors(normal,tilted).multiply(initial);
    for(let step=0;step<=120;step++) {
      const t=step/120;
      group.quaternion.slerpQuaternions(initial,final,t);
      rotateAboutAnchor(group,local,anchor,new THREE.Vector3());
      group.updateMatrixWorld();
      dollyToAnchor(camera,start,orientation,anchor,t*0.48);
      const actual=group.localToWorld(local.clone()).project(camera);
      assert.ok(Math.abs(actual.x-original.x)*width/2<0.01);
      assert.ok(Math.abs(actual.y-original.y)*height/2<0.01);
    }
    const tilt=THREE.MathUtils.radToDeg(tilted.angleTo(view));
    assert.ok(tilt>9 && tilt<16);
  }
});

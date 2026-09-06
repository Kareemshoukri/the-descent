import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AnimationMixer, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

test("manta skeleton deforms and the original 24-second clip loops", async () => {
  globalThis.ProgressEvent ??= class {
    constructor(type, init) { Object.assign(this, { type }, init); }
  };
  const bytes = readFileSync(new URL("../public/models/manta-ray.glb", import.meta.url));
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString("utf8", 20, 20 + length));
  const binary = bytes.subarray(28 + length);
  json.buffers = [{ byteLength: binary.length, uri: `data:application/octet-stream;base64,${binary.toString("base64")}` }];
  // Only replace materials for Node's lack of an image decoder.
  json.materials = [{}];
  delete json.images;
  delete json.textures;
  const { scene, animations } = await new GLTFLoader().parseAsync(JSON.stringify(json), "");
  assert.equal(animations.length, 1);
  assert.equal(animations[0].duration, 24);
  const model = clone(scene);
  let mesh, original;
  model.traverse((o) => { if (o.isSkinnedMesh) mesh = o; });
  scene.traverse((o) => { if (o.isSkinnedMesh) original = o; });
  assert.notEqual(mesh.skeleton.bones[0], original.skeleton.bones[0]);
  const mixer = new AnimationMixer(model);
  mixer.clipAction(animations[0]).play();
  const sample = (time) => {
    mixer.setTime(time);
    model.updateMatrixWorld(true);
    return mesh.getVertexPosition(100, new Vector3()).clone();
  };
  const start = sample(0);
  assert.ok(start.distanceTo(sample(3)) > 0.001);
  assert.ok(start.distanceTo(sample(24)) < 0.001);
  mixer.stopAllAction();
  mixer.uncacheRoot(model);
});

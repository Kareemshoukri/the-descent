import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { useDive, MODES, explodeAt, sectionAt } from "../state/useDive";
import BeamDust from "./BeamDust";
import { rotateAboutAnchor } from "./switchFocusMath";
import { playClick } from "../audio/audio";
import { scrollToDepth } from "../scroll/useScrollDepth";
import { beamScreen } from "../state/beamScreen";
import { switchScreen, switchFocus } from "../state/switchScreen";

import { compact } from "../quality";
const MODEL_URL = `${import.meta.env.BASE_URL}models/q930${compact ? "-mobile" : ""}.glb`;

/**
 * The torch's resting pose: off-centre and diagonal, entering from the
 * lower-left and aiming up and across the frame. Pointer aim (in
 * useFrame) is added on top of this bias.
 *
 * The yaw is intentionally large: the camera never rotates, so this is
 * what sends the beam sweeping ACROSS the frame — a small yaw instead
 * points it nearly down the lens axis at the camera, which collapses
 * the beam's cross-section (and the dust inside it) to almost nothing.
 */
/** reused every frame so the projection allocates nothing */
const tmpBeamPoint = new THREE.Vector3();
const tmpRadial = new THREE.Vector3();
const tmpDesired = new THREE.Vector3();
const tmpBtn = new THREE.Vector3();
const tmpOrigin = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpCutN = new THREE.Vector3();
const tmpCutP = new THREE.Vector3();

const BASE_YAW = 0.85;
const BASE_PITCH = -0.16;
const BASE_POS = [-1, -0.5, 0.9];

/** Longest dimension of the torch, in world units, after normalisation. */
const TARGET_LENGTH = 1.6;

/**
 * The visible cone(s) — a hot narrow core and a wider, dimmer glow.
 *
 * These are deliberately FAINT now. A cone mesh has a mathematically
 * straight silhouette and a real beam has no edge at all, so the mesh
 * is no longer what you're meant to see: it is a soft fill, and the
 * dust inside it (BeamDust) carries the actual shape. The edge is
 * additionally feathered by `edge` below, which fades the cone out
 * exactly where its surface turns away from the viewer — i.e. along
 * the silhouette, which is where a hard boundary would otherwise show.
 */
const beamMaterial = (falloff) =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color("#bcdcff") },
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewV;
      void main(){
        vUv = uv;
        vNormalV = normalMatrix * normal;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uOpacity;
      uniform vec3 uColor;
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewV;

      float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        float a = hash(i), b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
      }

      void main(){
        // vUv.y is 1 at the emitter end and 0 at the far end (three's
        // cone/cylinder UVs run bottom->top, and the top is the end
        // parented at the lens), so the bright end is vUv.y == 1.
        float d = 1.0 - vUv.y;               // 0 at the lens, 1 far away
        // Fade in across the first slice. The cone was previously at FULL
        // brightness right at its opening, which meant the rim of that
        // opening drew a hard circle behind the torch head — the geometry
        // announcing itself. Starting from zero there removes the edge
        // without touching how bright the shaft is anywhere else.
        float start = smoothstep(0.0, 0.07, d);
        float along = start * mix(1.0, ${falloff}, d);

        // silhouette feather — 0 where the surface is edge-on to the
        // camera (the hard outline), 1 where it faces us. This is what
        // dissolves the "triangle" into a shaft with no boundary.
        float edge = abs(dot(normalize(vNormalV), normalize(vViewV)));
        edge = pow(clamp(edge, 0.0, 1.0), 1.5);

        vec2 driftUv = vec2(vUv.x * 6.0, vUv.y * 3.0 - uTime * 0.12);
        float haze = noise(driftUv) * 0.5 + noise(driftUv * 2.3 + 4.0) * 0.25;
        float density = mix(0.65, 1.0, haze);

        gl_FragColor = vec4(uColor, along * edge * uOpacity * density);
      }`,
  });

export default function Torch({ onReady }) {
  const group = useRef();
  const beamRig = useRef();
  const beam = useRef();
  const glow = useRef();
  const spot = useRef();
  const bounce = useRef();
  const glare = useRef();
  const emitter = useRef();
  const pressAt = useRef(-99);
  const pressTravel = useRef(0);
  /** drag-to-spin: an offset added on top of the pointer aim */
  const spinYaw = useRef(0);
  const spinPitch = useRef(0);
  const spinVel = useRef({ y: 0, p: 0 });
  const drag = useRef(null);
  /** how much the pointer is allowed to aim the torch, 0 → 1 */
  const aimAmount = useRef(0);
  const explode = useRef(0);
  /** extra roll that turns the switch toward the camera when focused */
  const focusLocal = useRef(new THREE.Vector3());
  const focusRotation = useRef(new THREE.Quaternion());
  const restRotation = useRef(new THREE.Quaternion());
  const restEuler = useRef(new THREE.Euler());
  const focusAmt = useRef(0);
  /** extra yaw that turns the barrel side-on while focusing */
  const focusDepth = useRef(0);
  const now = useRef(0);
  const flicker = useRef(0);
  const beamMat = useMemo(() => beamMaterial(0.08), []);
  const glowMat = useMemo(() => beamMaterial(0.02), []);
  const section = useRef(0);
  /**
   * The section plane for beat 04. It lives in WORLD space — that is the
   * only space three's clipping understands — so it has to be rebuilt
   * each frame from the torch's own orientation, otherwise spinning the
   * body would slice it at a different angle every time. Parked far
   * above the model until the beat asks for it.
   */
  const clip = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), 99), []);

  const { scene: gltf } = useGLTF(MODEL_URL);

  /**
   * Normalise the export once: the model is modelled in millimetres with
   * its long axis on +Z (head at +Z), and this scene works in ~metre-ish
   * units with the beam on +X. Rather than hard-coding numbers that go
   * stale the moment the model is re-exported, this measures the actual
   * bounding box and derives the scale, rotation and lens position from
   * the geometry itself.
   */
  const { model, droplets, lensX, lensMesh, glassMat, parts, button, boot, pressDepth, allMats } = useMemo(() => {
    const root = gltf.clone(true);

    // head +Z -> +X
    root.rotation.set(0, Math.PI / 2, 0);
    root.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    root.scale.setScalar(TARGET_LENGTH / Math.max(size.x, size.y, size.z));
    root.updateMatrixWorld(true);

    const box2 = new THREE.Box3().setFromObject(root);
    const centre = box2.getCenter(new THREE.Vector3());
    root.position.sub(centre);
    root.updateMatrixWorld(true);

    // where the glass actually sits, so the beam starts at the real lens
    const finalBox = new THREE.Box3().setFromObject(root);

    let lens = null;
    let button = null;
    const parts = [];
    let boot = null;
    let pressDepth = 0.1;
    const allMats = new Set();
    const glass = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color("#dff1ff"),
      metalness: 0,
      roughness: 0.03,
      transmission: compact ? 0 : 1,
      thickness: 0.35,
      ior: 1.48,
      transparent: true,
      emissive: new THREE.Color("#9fd8ff"),
      emissiveIntensity: 0,
      envMapIntensity: 1.4,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
    });

    root.traverse((o) => {
      if (!o.isMesh) return;
      // The export contains a legacy assembled copy plus the named
      // `part_*` assembly used by the exploded and cutaway beats. Rendering
      // both copies creates the translucent duplicate seen above the torch.
      if (!o.name.startsWith("part_")) {
        o.visible = false;
        return;
      }
      o.castShadow = false;
      o.receiveShadow = false;
      if (o.name === "part_Lens_glass") {
        // the export carries no KHR_materials_transmission, so the
        // "Dispersed Glass" material arrives opaque — swap in real glass
        o.material = glass;
        lens = o;
      } else {
        if (o.name === "part_switch_button") {
          button = o;
          // Travel is a fraction of the button's own height, so it stays
          // correct whatever scale the model is re-exported at. This has
          // to be measured in the PARENT's space, because that is the
          // space `position` moves in — a world-space measurement would
          // come out ~9x too small once the root's scale is applied.
          o.geometry.computeBoundingBox();
          const h = o.geometry.boundingBox.getSize(new THREE.Vector3()).y;
          pressDepth = h * o.scale.y * 0.22;
        }
        if (o.name === "part_switch_boot") boot = o;
      }
      // Where this part sits along the barrel, for the exploded view.
      // The long axis is the children's LOCAL Z — the root is what gets
      // rotated to put the beam on +X, so inside it the geometry still
      // runs along Z exactly as it was modelled.
      o.geometry.computeBoundingBox();
      const cz = o.geometry.boundingBox.getCenter(new THREE.Vector3()).z * o.scale.z;
      parts.push({ obj: o, cz });

      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      mats.forEach((m) => {
        allMats.add(m);
        if (o.name !== "part_Lens_glass") m.envMapIntensity = 1.8;
        // The section plane is attached now and left attached for the
        // life of the scene. Adding or removing `clippingPlanes` changes
        // the material's shader and forces a recompile — doing that when
        // the cut starts would stall a frame right at the moment the
        // animation begins. Instead the plane is always bound and simply
        // parked clear of the model until beat 04 needs it.
        m.clippingPlanes = [clip];
        m.clipShadows = false;
        // Cut geometry is only solid-looking if you can see its far wall.
        // Backfaces on a closed opaque body are hidden anyway, so this
        // costs nothing when the torch is shut and is the whole reason
        // the open one reads as a hollow housing with parts in it rather
        // than a shape with a hole punched through it.
        // ...but not the glass. A transmissive material rendered on both
        // sides and then cut in half draws as a solid bright plate, and
        // it is in the bloom selection, so it came out as a white card
        // stuck on the front of the open head.
        if (o.name !== "part_Lens_glass") m.side = THREE.DoubleSide;
      });
    });

    const meanZ = parts.length
      ? parts.reduce((a, p) => a + p.cz, 0) / parts.length
      : 0;
    parts.forEach((p) => (p.spread = p.cz - meanZ));

    // Small raised beads on the upper shell and head. They live beside the
    // GLB inside the same draggable group, so they follow every rotation,
    // zoom and exploded transition without changing the source asset.
    const droplets = new THREE.Group();
    droplets.name = "SURFACE_DROPLETS";
    const dropGeometry = new THREE.SphereGeometry(1, 8, 6);
    const dropMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color("#e6ffff"),
      metalness: 0.02,
      roughness: 0.06,
      transmission: compact ? 0 : 0.28,
      thickness: 0.08,
      ior: 1.33,
      transparent: true,
      opacity: 0.86,
      clearcoat: 1,
      clearcoatRoughness: 0.025,
      envMapIntensity: 2.4,
    });
    const dropletSpecs = [
      [0.08, 0.78, 0.18, 1.15, 0.72, 0.82],
      [0.18, 0.75, -0.12, 0.78, 1.45, 0.76],
      [0.29, 0.78, 0.16, 0.92, 0.9, 0.82],
      [0.40, 0.73, -0.15, 0.72, 1.25, 0.72],
      [0.52, 0.77, 0.14, 1.18, 0.8, 0.8],
      [0.63, 0.74, -0.10, 0.74, 1.35, 0.75],
      [0.73, 0.76, 0.12, 0.96, 0.78, 0.78],
      [0.82, 0.72, -0.08, 0.7, 1.2, 0.7],
      [0.15, 0.64, 0.25, 0.62, 1.5, 0.66],
      [0.35, 0.63, 0.26, 0.52, 1.2, 0.62],
      [0.57, 0.65, 0.24, 0.68, 1.35, 0.64],
      [0.77, 0.61, 0.21, 0.5, 1.4, 0.6],
    ];
    for (const [tx, ty, tz, sx, sy, sz] of dropletSpecs) {
      const bead = new THREE.Mesh(dropGeometry, dropMaterial);
      bead.position.set(
        THREE.MathUtils.lerp(finalBox.min.x, finalBox.max.x, tx),
        THREE.MathUtils.lerp(finalBox.min.y, finalBox.max.y, ty),
        THREE.MathUtils.lerp(finalBox.min.z, finalBox.max.z, 0.5 + tz * 0.12),
      );
      const radius = Math.max(finalBox.getSize(new THREE.Vector3()).y * 0.025, 0.008);
      bead.scale.set(radius * sx, radius * sy, radius * sz);
      bead.renderOrder = 4;
      droplets.add(bead);
    }

    return {
      model: root,
      droplets,
      parts,
      button,
      boot,
      pressDepth,
      // the frontmost point of the assembled torch, not the glass: the
      // head sleeve overhangs the lens by a few mm, so anchoring to the
      // glass puts the emitter and the start of the beam INSIDE the metal
      lensX: finalBox.max.x + 0.01,
      lensMesh: lens,
      glassMat: glass,
      allMats: [...allMats],
    };
  }, [gltf, clip]);

  /**
   * Drag lives on the window, not on the mesh: once you've grabbed the
   * torch the gesture has to keep working when the pointer wanders off
   * it, which a mesh-local handler can't do.
   *
   * Tap vs drag is decided on release by how far the pointer travelled —
   * without that, every attempt to spin the body that happened to start
   * on the switch would also toggle the light.
   */
  useEffect(() => {
    const K = 0.005;
    const onMove = (e) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      d.x = e.clientX;
      d.y = e.clientY;
      d.moved += Math.abs(dx) + Math.abs(dy);
      // Clamped, because the switch has to stay reachable: spin far
      // enough and it ends up facing away from the camera, and the one
      // interaction the whole opening depends on becomes unclickable.
      spinYaw.current = THREE.MathUtils.clamp(spinYaw.current + dx * K, -1.2, 1.2);
      spinPitch.current = THREE.MathUtils.clamp(spinPitch.current + dy * K, -0.55, 0.55);
      // remember the last motion so the spin carries on after release
      spinVel.current.y = dx * K;
      spinVel.current.p = dy * K;
    };
    const onUp = (e) => {
      // Only cleanup lives here. The tap itself is handled by the mesh's
      // own onPointerUp (below) — routing it through a ref from inside
      // this effect silently called the ref's initial no-op instead.
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      document.body.classList.remove("is-grabbing");
      // a tap on the switch, not a drag that happened to start there
      if (e.type !== "pointercancel" && d.onSwitch && d.moved < 8) fireSwitch();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);


  // point the spot down the barrel, once
  useEffect(() => {
    if (!spot.current || !beamRig.current) return;
    const t = spot.current.target;
    t.position.set(24, 0, 0);
    beamRig.current.add(t);
  }, []);

  // hand the objects that should bloom (and the lights that shouldn't
  // leak into that pass) up to Scene, once they exist
  useEffect(() => {
    if (!onReady) return;
    onReady({
      beam: beam.current,
      glow: glow.current,
      lensMesh,
      emitter: emitter.current,
      button,
      parts,
      spot: spot.current,
      bounce: bounce.current,
      group: group.current,
    });
  }, [onReady, lensMesh]);

  useFrame((state, dt) => {
    const { pointer, on, mode, zoom, depth } = useDive.getState();
    // one clock, shared with the click handler below
    now.current = state.clock.elapsedTime;

    // Droplets belong to the above-water opening beat. They fade out as the
    // torch crosses the surface so they never read as bubbles inside it.
    const wet = 1 - THREE.MathUtils.smoothstep(depth, 0.35, 2.2);
    droplets.visible = wet > 0.001;
    if (droplets.children[0]?.material) droplets.children[0].material.opacity = 0.86 * wet;

    // aim: the beam follows the pointer, damped, on top of a diagonal
    // resting pose — this is the interaction the whole site rests on,
    // so it gets a spring, never a keyframe.
    if (group.current) {
      // While you're dragging the body, the aim is frozen at wherever it
      // was when the drag started. Otherwise the same gesture would spin
      // the torch AND swing the beam, and neither would feel controlled.
      const aim = drag.current ? drag.current.aim : pointer;

      // spin keeps going for a moment after release, then settles
      if (!drag.current) {
        spinYaw.current = THREE.MathUtils.clamp(spinYaw.current + spinVel.current.y, -1.2, 1.2);
        spinPitch.current = THREE.MathUtils.clamp(
          spinPitch.current + spinVel.current.p,
          -0.55,
          0.55,
        );
        // real dt, NOT a clamped one: exp() is already frame-rate
        // independent, and clamping the exponent makes the decay take
        // longer the slower the machine is — the torch would visibly
        // fail to settle back on a weak GPU.
        const decay = Math.exp(-5 * dt);
        spinVel.current.y *= decay;
        spinVel.current.p *= decay;
        // and it settles back to its resting pose over a few seconds —
        // slow enough to feel like the torch righting itself in the
        // water, fast enough that the switch always comes back to you
        const settle = Math.exp(-0.4 * dt);
        spinYaw.current *= settle;
        spinPitch.current *= settle;
      }

      // Before ignition the pointer does NOT aim the torch. Two reasons:
      // the storyboard's opening beat is idle drift plus drag-to-spin,
      // with the cursor only taking over the beam from frame 03 — and
      // more practically, pointer-aim made the switch a moving target.
      // Reaching for it rotated the torch away from you, on the one
      // small hit area the whole opening depends on.
      aimAmount.current = THREE.MathUtils.damp(aimAmount.current, on ? 1 : 0, 2.5, dt);
      const a = aimAmount.current;

      // Freeze the pose and camera once, not a feedback loop between two
      // independently moving targets. Rotate ABOUT the switch's centre.
      const canFocus = sectionAt(depth) < 0.02 && explodeAt(depth) < 0.02;
      const wanted = canFocus && !drag.current && !switchScreen.suppressHover &&
        (switchScreen.hovered || switchScreen.keyboardFocus || switchScreen.held);
      if (wanted && !switchFocus.active && button) {
        group.current.updateWorldMatrix(true, true);
        button.geometry.boundingBox.getCenter(tmpBtn);
        button.localToWorld(tmpBtn);
        switchFocus.anchor.copy(tmpBtn);
        focusLocal.current.copy(tmpBtn);
        group.current.worldToLocal(focusLocal.current);
        switchFocus.cameraPosition.copy(state.camera.position);
        switchFocus.cameraQuaternion.copy(state.camera.quaternion);
        // The actual switch cap normal is model +Y. Turn that normal
        // toward the captured viewing ray using a shortest-arc rotation.
        tmpRadial.set(0, 1, 0).transformDirection(button.matrixWorld);
        tmpDesired.copy(state.camera.position).sub(tmpBtn).normalize();
        // A slight upward tilt reveals the cap travel instead of a flat-on disc.
        tmpRight.set(0, 1, 0).applyQuaternion(state.camera.quaternion);
        tmpDesired.addScaledVector(tmpRight, 0.23).normalize();
        focusRotation.current.setFromUnitVectors(tmpRadial, tmpDesired)
          .multiply(group.current.quaternion);
        spinVel.current.y = spinVel.current.p = 0;
        focusDepth.current = depth;
        switchFocus.active = true;
      }
      // Scrolling away ends focus rather than dragging a macro shot
      // through the cutaway or anatomy stages.
      if (switchFocus.active && Math.abs(depth - focusDepth.current) > 1.5) switchScreen.suppressHover = true;
      if (!wanted || switchScreen.suppressHover) {
        switchFocus.active = false;
        if (!canFocus) switchScreen.hovered = false;
      }
      const focused = switchFocus.active;
      if (useDive.getState().switchHover !== focused) useDive.getState().setSwitchHover(focused);
      focusAmt.current = THREE.MathUtils.damp(focusAmt.current, focused ? 1 : 0, 6, dt);
      const yaw = BASE_YAW + aim.x * 0.55 * a + spinYaw.current;
      const pitch = BASE_PITCH - aim.y * 0.35 * a + spinPitch.current;
      restRotation.current.setFromEuler(restEuler.current.set(pitch, yaw, 0));
      const surface = Math.max(0, 1 - depth / 12);
      tmpOrigin.set(THREE.MathUtils.lerp(BASE_POS[0], -0.10, surface),
        THREE.MathUtils.lerp(BASE_POS[1], -0.24, surface) +
        Math.sin(state.clock.elapsedTime * 0.8) * 0.04 * surface,
        THREE.MathUtils.lerp(BASE_POS[2], 0.15, surface));
      if (focused) {
        group.current.quaternion.slerp(focusRotation.current, 1 - Math.exp(-8 * dt));
        rotateAboutAnchor(group.current, focusLocal.current, switchFocus.anchor, tmpBtn);
      } else {
        group.current.quaternion.slerp(restRotation.current, 1 - Math.exp(-4 * dt));
        group.current.position.lerp(tmpOrigin, 1 - Math.exp(-5 * dt));
      }
      group.current.updateWorldMatrix(true, true);
    }

    // Where the beam lands on screen, for the frame-03 text reveal. This
    // is the LIGHT's position, not the cursor's — the beam is damped, so
    // during a fast sweep the two are visibly in different places.
    if (beamRig.current) {
      tmpBeamPoint.set(4.5, 0, 0).applyMatrix4(beamRig.current.matrixWorld);
      tmpBeamPoint.project(state.camera);
      beamScreen.x = (tmpBeamPoint.x * 0.5 + 0.5) * 100;
      beamScreen.y = (-tmpBeamPoint.y * 0.5 + 0.5) * 100;
      beamScreen.live = true;
    }

    const m = MODES[mode];
    // the beam drops right back for the exploded view: beat 05 is a study
    // of the object, and a lit shaft full of dust across it is clutter
    let intensity = (on ? m.intensity : 0) * (1 - explode.current * 0.85);
    /**
     * The section needs its own, unequal, handling.
     *
     * Cutting the head open puts the camera inside the emitter. The
     * lamp, the bounce light and the additive glare sprites all live at
     * the lens, millimetres from freshly exposed interior walls, and at
     * working power they turned beat 04 into a white wedge with a torch
     * attached. But simply turning the light down takes the beam out of
     * the water with it, and beat 04 is still a lit torch at 40 m.
     *
     * So the two are separated: the beam keeps most of its strength
     * because it is far away and reads against the water, and everything
     * that illuminates the housing from point-blank range is shut almost
     * off. Physically this is what the reflector was doing all along —
     * pointing the light out of the front instead of around the inside.
     */
    const sec = section.current;
    const beamKeep = 1 - sec * 0.42;
    const inside = 1 - sec;
    intensity *= beamKeep;
    if (on && m.name === "STROBE") {
      flicker.current += dt;
      intensity *= flicker.current % 0.5 < 0.25 ? 1 : 0.05;
    }

    if (spot.current) {
      spot.current.intensity = THREE.MathUtils.damp(spot.current.intensity, intensity * 90 * inside, 6, dt);
      spot.current.angle = THREE.MathUtils.lerp(0.14, 0.6, zoom);
    }
    if (beam.current) {
      const u = beamMat.uniforms.uOpacity;
      // much fainter than before: the mesh is a fill, the dust is the beam
      u.value = THREE.MathUtils.damp(u.value, intensity * 0.11, 6, dt);
      beamMat.uniforms.uTime.value = state.clock.elapsedTime;
      const spread = THREE.MathUtils.lerp(0.4, 1.7, zoom);
      beam.current.scale.set(spread, 1, spread);
    }
    if (glow.current) {
      const u = glowMat.uniforms.uOpacity;
      u.value = THREE.MathUtils.damp(u.value, intensity * 0.045, 5, dt);
      glowMat.uniforms.uTime.value = state.clock.elapsedTime * 0.7;
      const spread = THREE.MathUtils.lerp(0.9, 2.6, zoom);
      glow.current.scale.set(spread, 1, spread);
    }
    if (bounce.current) {
      bounce.current.intensity = THREE.MathUtils.damp(
        bounce.current.intensity,
        intensity * 1.6 * inside,
        6,
        dt,
      );
    }
    // The interior is bare polished metal, and a mirror finish reflects
    // the environment's bright surface band straight back at the camera —
    // which is fine on a closed body seen from outside, and reads as a
    // blown-out plate the moment the housing is opened and those surfaces
    // face you at close range. Reflections come right down with the cut.
    if (allMats && allMats.length) {
      const env = THREE.MathUtils.lerp(1.8, 0.42, sec);
      for (let i = 0; i < allMats.length; i++) {
        if (allMats[i] !== glassMat) allMats[i].envMapIntensity = env;
      }
    }

    if (glassMat) {
      glassMat.emissiveIntensity = THREE.MathUtils.damp(
        glassMat.emissiveIntensity,
        on ? (0.8 + intensity * 6.5) * (1.0 - sec) : 0,
        6,
        dt,
      );
    }

    if (emitter.current) {
      emitter.current.material.opacity = THREE.MathUtils.damp(
        emitter.current.material.opacity,
        intensity * 0.34 * inside,
        8,
        dt,
      );
      const r = THREE.MathUtils.lerp(0.62, 1.35, zoom);
      emitter.current.scale.set(r, r, r);
    }

    // Beat 05 — the exploded view. Each part slides along the barrel in
    // proportion to where it already sits on it, which is what makes an
    // exploded diagram read as one object coming apart rather than a
    // pile of components. Depth drives it; it closes again as you pass.
    if (parts && parts.length) {
      const e = explodeAt(depth);
      if (e !== explode.current) {
        explode.current = THREE.MathUtils.damp(explode.current, e, 3, dt);
        for (let i = 0; i < parts.length; i++) {
          // Travel is capped. Spreading strictly in proportion to where a
          // part sits sends the two end pieces — the battery tube and the
          // glass — much further than anything else, and they leave the
          // frame while the interesting middle has barely opened. The cap
          // keeps the ends in shot and lets the internals separate fully.
          const raw = parts[i].spread * 2.9 * explode.current;
          parts[i].obj.position.z = THREE.MathUtils.clamp(raw, -9, 9);
        }
      }
    }

    // Beat 04 — the section. A plane sweeps down through the housing and
    // the near half of it stops being drawn, so you are looking into the
    // torch you were just holding rather than at a different model of it.
    //
    // Two things make it survive the rest of the scene. The plane's
    // normal is taken from the torch's own up axis, so however far you
    // have spun the body the cut still runs lengthwise along the barrel
    // instead of hacking across it at whatever angle the world happens to
    // be at. And the sweep is damped rather than snapped to the depth
    // curve, so scrubbing the scrollbar quickly still opens smoothly.
    if (group.current) {
      const target = sectionAt(depth);
      if (Math.abs(target - section.current) > 0.0005) {
        section.current = THREE.MathUtils.damp(section.current, target, 3.5, dt);
      }
      const s = section.current;
      // the torch's local +Y in world space — "up" as the torch sees it
      tmpCutN.set(0, 1, 0).applyQuaternion(group.current.quaternion).normalize();
      group.current.getWorldPosition(tmpCutP);
      // eased so it decelerates into the axis instead of arriving at full
      // speed and stopping dead
      const e = s * s * (3 - 2 * s);
      // 0.9 clears the model entirely (nothing cut); 0.0 is the barrel's
      // centreline, which is exactly where a technical section is taken
      tmpCutP.addScaledVector(tmpCutN, THREE.MathUtils.lerp(0.9, 0.0, e));
      clip.normal.copy(tmpCutN).negate();
      clip.constant = -clip.normal.dot(tmpCutP);
    }

    // the switch physically depresses and springs back: fast down, slower
    // release, driven off the clock rather than a per-frame decay so it
    // lasts the same wall-clock time regardless of frame rate
    if (button) {
      const held = switchScreen.held || (drag.current?.onSwitch && drag.current.moved < 8);
      const keyboardPulse = now.current - pressAt.current < 0.09;
      const pressed = held || keyboardPulse;
      pressTravel.current = THREE.MathUtils.damp(pressTravel.current, pressed ? 1 : 0, pressed ? 35 : 13, dt);
      const p = pressTravel.current;
      button.position.y = -p * pressDepth;
      if (boot) boot.position.y = -p * pressDepth * 0.45;
    }

    // lens backscatter: strongest when the beam is aimed back at the
    // viewer, which the pointer already controls — free interactivity
    if (glare.current && group.current) {
      const beamDir = new THREE.Vector3(1, 0, 0).applyQuaternion(group.current.quaternion);
      const lensWorld = glare.current.getWorldPosition(new THREE.Vector3());
      const toCam = state.camera.position.clone().sub(lensWorld).normalize();
      const facing = THREE.MathUtils.smoothstep(beamDir.dot(toCam), 0.05, 0.8);
      glare.current.scale.setScalar(THREE.MathUtils.lerp(1.1, 2.8, zoom));
      glare.current.material.opacity = THREE.MathUtils.damp(
        glare.current.material.opacity,
        intensity * facing * 0.3 * inside,
        5,
        dt,
      );
    }
  }, -2);

  /**
   * The switch fires on RELEASE, not on press — the storyboard is
   * specific about it ("press on mouse-down, ignite on release"), and it
   * is also what a real two-stage button does. The press animation and
   * the contact click happen on the way down; the light and the dive
   * happen on the way back up.
   */
  function fireSwitch() {
    playClick(false);
    const s = useDive.getState();
    if (!s.on) {
      switchScreen.suppressHover = true;
      switchScreen.keyboardFocus = false;
      s.setOn(true);
      s.setScrollLocked(false);
      s.setIgnitedAt(now.current);
      // 0.6s scripted descent, straight off the storyboard. It goes
      // through the scroller so scroll position and depth stay in
      // agreement afterwards.
      scrollToDepth(6, 0.6);
    } else {
      s.cycleMode();
    }
  }

  useEffect(() => {
    switchScreen.press = () => { pressAt.current = now.current; playClick(true); };
    switchScreen.activate = fireSwitch;
    switchScreen.cancel = () => { pressAt.current = -99; };
    return () => {
      switchScreen.press = switchScreen.activate = switchScreen.cancel = null;
      switchScreen.live = switchFocus.active = false;
    };
  }, []);

  const onPointerDown = (e) => {
    e.stopPropagation();
    // Once focused, anywhere near the button on screen counts as the
    // button — by then it is what fills that part of the frame, and
    // insisting the ray hit that exact mesh is how the click kept
    // getting lost as the torch rolled.
    const onSwitch =
      /switch/i.test(e.object.name) ||
      (focusAmt.current > 0.35 &&
        switchScreen.live &&
        Math.hypot(e.clientX - switchScreen.x, e.clientY - switchScreen.y) <
          Math.max(34, switchScreen.r * 2));
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      moved: 0,
      onSwitch,
      aim: { ...useDive.getState().pointer },
    };
    spinVel.current.y = 0;
    spinVel.current.p = 0;
    document.body.classList.add("is-grabbing");
    if (onSwitch) {
      // the button goes down now; the light waits for the release
      pressAt.current = now.current;
      playClick(true);
    }
  };

  const onOver = (e) => {
    const isSwitch = /switch/i.test(e.object.name);
    document.body.style.cursor = isSwitch ? "pointer" : "grab";
  };
  const onOut = () => {
    document.body.style.cursor = "";
  };

  const onWheel = (e) => {
    const s = useDive.getState();
    s.setZoom(s.zoom + e.deltaY * 0.0006);
  };

  const glareTex = useMemo(() => makeGlareTexture(), []);
  const scatterTex = useMemo(() => makeScatterTexture(), []);

  return (
    <group ref={group}>
      <primitive
        object={model}
        onPointerDown={onPointerDown}
        onPointerOver={onOver}
        onPointerOut={onOut}
        onWheel={onWheel}
      />
      <primitive object={droplets} />

      {/* everything light-related hangs off the real lens position */}
      <group ref={beamRig} position={[lensX, 0, 0]}>
        <pointLight
          ref={bounce}
          position={[-0.12, 0, 0]}
          distance={1.8}
          decay={2}
          color="#bfe0ff"
          intensity={0}
        />
        <spotLight
          ref={spot}
          position={[0.02, 0, 0]}
          angle={0.2}
          penumbra={0.9}
          distance={44}
          decay={1.3}
          color="#dcefff"
          intensity={0}
        />


        {/* Near-field scatter: the patch of water immediately in front
            of the lens lighting up. This is NOT the emitter — you can't
            see the emitter at all when the torch points away from you,
            which is the resting pose. What you can always see is the
            water it is lighting, so that's what this draws: wide, soft
            and dim, rather than the hard bright ball that used to sit
            on the front of the housing. */}
        <sprite ref={emitter} position={[0.16, 0, 0]} renderOrder={2}>
          <spriteMaterial
            map={scatterTex}
            color="#bcdcf5"
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>

        <sprite ref={glare} position={[0.012, 0, 0]} renderOrder={3}>
          <spriteMaterial
            map={glareTex}
            transparent
            opacity={0}
            depthWrite={false}
            depthTest={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>

        <mesh ref={beam} position={[7, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={beamMat} renderOrder={2}>
          <cylinderGeometry args={[0.28, 3.1, 14, 44, 1, true]} />
        </mesh>
        <mesh ref={glow} position={[7, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={glowMat} renderOrder={1}>
          <cylinderGeometry args={[0.4, 3.1, 14, 44, 1, true]} />
        </mesh>

        <BeamDust />
      </group>
    </group>
  );
}

function makeGlareTexture() {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,0.85)");
  g.addColorStop(0.28, "rgba(215,238,255,0.34)");
  g.addColorStop(1, "rgba(190,225,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Deliberately coreless: the falloff starts soft and never reaches full
 * white anywhere. A texture with a hot centre reads as a solid glowing
 * ball stuck to the torch; this one reads as lit water.
 */
function makeScatterTexture() {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,0.42)");
  g.addColorStop(0.25, "rgba(228,244,255,0.26)");
  g.addColorStop(0.6, "rgba(200,230,255,0.07)");
  g.addColorStop(1, "rgba(190,225,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

useGLTF.preload(MODEL_URL);

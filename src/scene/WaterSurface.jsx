import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Water } from "three/examples/jsm/objects/Water.js";
import { useDive } from "../state/useDive";
import { createWaterGpu, WATER_FIELD } from "./waterGpu";
import { compact } from "../quality";

/**
 * The surface, for beat 01.
 *
 * This is three's own `Water` object — which is exactly what the
 * WaterSurface component you linked wraps underneath (that library is a
 * copy-in TypeScript package that also pulls in @funtech-inc/use-shader-fx
 * and ships its own normal-map asset). Going straight to `Water` gets the
 * same rippling, reflecting surface with no new dependency, no TS in a
 * JSX project, and no asset to keep in sync.
 *
 * The normal map is generated here rather than shipped: summed sine waves
 * at INTEGER frequencies, so the height field is periodic and the texture
 * tiles seamlessly, then differenced into normals. A downloaded
 * waternormals.jpg would be one more thing to host for no gain.
 *
 * We sit under it looking up, so its underside is what matters. It is
 * hidden outright below a few metres — `Water` renders a reflection pass
 * every frame, and there is no reason to pay for that at 100 m.
 */

function makeWaterNormals(size = 256) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);

  // periodic height field: every frequency is an integer number of
  // cycles across the texture, which is what makes it tile
  const waves = [
    { fx: 2, fy: 1, amp: 1.0, ph: 0.0 },
    { fx: -1, fy: 3, amp: 0.7, ph: 1.7 },
    { fx: 4, fy: -2, amp: 0.45, ph: 3.1 },
    { fx: 3, fy: 5, amp: 0.3, ph: 0.6 },
    { fx: -6, fy: 2, amp: 0.2, ph: 2.2 },
    { fx: 7, fy: 6, amp: 0.12, ph: 4.4 },
  ];
  const h = (x, y) => {
    let v = 0;
    for (const w of waves) {
      v += w.amp * Math.sin(2 * Math.PI * (w.fx * x + w.fy * y) + w.ph);
    }
    return v;
  };

  const d = 1 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      // central differences -> gradient -> normal
      const dhdx = (h(u + d, v) - h(u - d, v)) / (2 * d);
      const dhdy = (h(u, v + d) - h(u, v - d)) / (2 * d);
      const n = new THREE.Vector3(-dhdx, -dhdy, 60).normalize();
      const i = (y * size + x) * 4;
      img.data[i + 0] = (n.x * 0.5 + 0.5) * 255;
      img.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      img.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

// Shared world-space waves keep the foam, geometry and lighting in phase.
const COAST_WAVES = `
  float coastHeight(vec2 p, float t) {
    return sin(dot(p, vec2(0.82, 0.57)) * 1.55 + t * 0.72) * 0.085
      + sin(dot(p, vec2(-0.45, 0.89)) * 2.8 - t * 0.83) * 0.043
      + sin(dot(p, vec2(0.32, -0.95)) * 6.4 + t * 1.28) * 0.016
      + sin(dot(p, vec2(0.91, 0.42)) * 11.7 - t * 1.61) * 0.006;
  }
  vec2 coastSlope(vec2 p, float t) {
    float e = 0.025;
    return vec2(coastHeight(p + vec2(e,0.0),t) - coastHeight(p - vec2(e,0.0),t),
      coastHeight(p + vec2(0.0,e),t) - coastHeight(p - vec2(0.0,e),t)) / (2.0*e);
  }
`;

const FOAM_VERTEX = `
  ${WATER_FIELD}
  ${COAST_WAVES}
  varying vec3 vWorldPosition;
  varying vec2 vSurfaceUv;
  void main() {
    vec3 p = position;
    vec2 worldUv = vec2(position.x, -position.y);
    p.z += coastHeight(worldUv, uTime) + rippleHeight(worldUv);
    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorldPosition = world.xyz;
    vSurfaceUv = position.xy;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FOAM_FRAGMENT = `
  ${COAST_WAVES}
  uniform float uTime;
  uniform float uFade;
  uniform float uLight;
  varying vec3 vWorldPosition;
  varying vec2 vSurfaceUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  void main() {
    vec2 p = vWorldPosition.xz;
    vec2 warp = vec2(
      noise(p * 0.34 + vec2(uTime * 0.018, -uTime * 0.012)),
      noise(p * 0.31 + vec2(-uTime * 0.014, uTime * 0.016))
    ) - 0.5;
    p += warp * 2.4;

    // Whitecaps form only on high, intersecting crests. Noise interrupts
    // their length and erodes their edges instead of drawing a full grid.
    float height = coastHeight(vWorldPosition.xz, uTime);
    float crest = smoothstep(0.075, 0.13, height);
    float patches = smoothstep(0.42, 0.72, noise(p * 1.6 - uTime * 0.06));
    float lace = noise(p * 19.0 + uTime * 0.09);
    float foam = crest * patches * smoothstep(0.24, 0.62, lace);
    // Fade the far edges so the foam dissolves into the turquoise surface.
    float edgeFade = 1.0 - smoothstep(14.0, 31.0, length(p));
    vec2 slope = coastSlope(vWorldPosition.xz, uTime);
    vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
    float sun = (0.3 + 0.7 * max(dot(normal, normalize(vec3(-0.38,0.72,-0.58))),0.0)) * uLight;
    float alpha = clamp(foam * edgeFade * uFade * (0.30 + 0.32 * sun), 0.0, 0.42);
    if (alpha < 0.012) discard;
    gl_FragColor = vec4(vec3(0.92, 0.985, 0.97) * (0.82 + 0.18 * sun), alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export default function WaterSurface() {
  const { scene, gl } = useThree();
  const ref = useRef();
  const normals = useMemo(() => makeWaterNormals(256), []);
  const gpu = useMemo(() => createWaterGpu(gl, compact), [gl]);
  const lastSimulation = useRef(-1);
  const lastPointer = useRef(new THREE.Vector2(99, 99));
  const foam = useMemo(() => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60, compact ? 160 : 320, compact ? 160 : 320),
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uFade: { value: 1 },
          uLight: { value: 1 },
          uRipple: gpu.uniforms.uRipple,
        },
        vertexShader: FOAM_VERTEX,
        fragmentShader: FOAM_FRAGMENT,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 2;
    return mesh;
  }, [gpu]);

  const water = useMemo(() => {
    const geo = new THREE.PlaneGeometry(60, 60, compact ? 160 : 320, compact ? 160 : 320);
    const w = new Water(geo, {
      textureWidth: compact ? 512 : 1024,
      textureHeight: compact ? 512 : 1024,
      waterNormals: normals,
      sunDirection: new THREE.Vector3(-0.38, 0.72, -0.58).normalize(),
      sunColor: 0xffe6b8,
      // brighter and bluer than a from-above setup would use: seen from
      // underneath, this is a lit ceiling, not a dark reflective pool
      waterColor: 0x008b93,
      // gentler than the default: at 5.2 the normals were thrashing hard
      // enough that the sun highlight landed on every wavelet at once
      distortionScale: 0.38,
      fog: true,
    });
    // Real waves. three's Water only ripples its NORMALS — the surface
    // itself stays dead flat, which is why the horizon read as a ruled
    // line. This displaces the geometry too, so the surface actually
    // undulates and the horizon has a swell in it. The plane lies in
    // local XY with +Z up, so displacement goes on z.
    w.material.vertexShader = w.material.vertexShader.replace(
      "void main() {",
      `${WATER_FIELD}
      ${COAST_WAVES}
      // Layered swell: a few big slow rollers with progressively finer,
      // faster chop riding on them, each running in its own direction.
      // Waves travelling in one direction read as corduroy — it is the
      // crossing directions that make water look like water.
      float waveH(vec2 p, float t){
        vec2 worldUv = vec2(p.x, -p.y);
        return coastHeight(worldUv, t) + rippleHeight(worldUv);
      }
      void main() {
        vec3 wavePos = position;
        wavePos.z += waveH(position.xy, time);
      `,
    );
    w.material.vertexShader = w.material.vertexShader
      .replace("mirrorCoord = modelMatrix * vec4( position, 1.0 );",
               "mirrorCoord = modelMatrix * vec4( wavePos, 1.0 );")
      .replace("vec4 mvPosition =  modelViewMatrix * vec4( position, 1.0 );",
               "vec4 mvPosition =  modelViewMatrix * vec4( wavePos, 1.0 );");

    // Visible world-scale ripples, rather than an ocean-sized normal map
    // whose /103 UV scale was essentially flat at this product scale.
    w.material.fragmentShader = w.material.fragmentShader.replace(
      "void main() {", `
      ${WATER_FIELD}
      ${COAST_WAVES}
      vec2 waterSlope(vec2 p, float t) {
        vec2 g = coastSlope(p,t);
        float e=0.03;
        g += vec2(rippleHeight(p+vec2(e,0.0))-rippleHeight(p-vec2(e,0.0)), rippleHeight(p+vec2(0.0,e))-rippleHeight(p-vec2(0.0,e))) / (2.0*e);
        g += vec2(0.7,0.5)*27.0*cos(dot(p,vec2(0.7,0.5))*27.0+t*1.9)*0.002;
        return g;
      }
      vec2 cellHash(vec2 p) {
        return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453);
      }
      float causticWeb(vec2 p, float t) {
        p += vec2(sin(p.y*1.7+t*0.35),cos(p.x*1.6-t*0.3))*0.68;
        p += vec2(sin(p.y*3.8-t*0.2),cos(p.x*3.2+t*0.25))*0.17;
        vec2 ip=floor(p), fp=fract(p);
        float first=8.0, second=8.0;
        for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) {
          vec2 o=vec2(float(x),float(y));
          vec2 seed=cellHash(ip+o);
          vec2 q=o+0.5+0.32*sin(t*0.5+6.2831*seed)-fp;
          float d=dot(q,q);
          if(d<first){second=first;first=d;}else{second=min(second,d);}
        }
        float edge=second-first;
        float aa=max(fwidth(edge),0.012);
        return 1.0-smoothstep(0.015,0.065+aa,edge);
      }
      void main() {
      `)
      .replace("getNoise( worldPosition.xz * size )", "getNoise( worldPosition.xz * size * 9.0 )")
      .replace("vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );",
        "vec2 slope=waterSlope(worldPosition.xz,time); vec3 surfaceNormal=normalize(vec3(-slope.x + noise.x*0.16,1.0,-slope.y + noise.y*0.16));")
      .replace("float rf0 = 0.3;", "float rf0 = 0.02;")
      .replace("float reflectance = rf0 + ( 1.0 - rf0 ) * pow( ( 1.0 - theta ), 5.0 );",
        "float reflectance = 0.025 + 0.22 * pow(1.0 - theta, 5.0);")
      .replace("vec3 scatter = max( 0.0, dot( surfaceNormal, eyeDirection ) ) * waterColor;",
        "vec3 scatter = waterColor * (0.60 + 0.25*max(0.0,dot(surfaceNormal,eyeDirection)));")
      .replace("sunLight( surfaceNormal, eyeDirection, 100.0, 2.0, 0.5, diffuseLight, specularLight );",
        "sunLight(surfaceNormal,eyeDirection,240.0,1.6,0.5,diffuseLight,specularLight);")
      .replace("vec3 outgoingLight = albedo;", `
        // The stock Water shader is tuned for a bright above-water view;
        // from underneath it lifts the red channel and turns turquoise
        // into grey. Grade the base reflection before adding the small
        // white foam highlights.
        albedo *= vec3(0.26, 0.88, 0.72);
        // Broad, warped flow bands are used for the surface sheen. The
        // old cellular web was too legible and made the sea look like a
        // projected decal instead of the soft, stretched shapes in the
        // coastal reference.
        float shallow=exp(-length(worldPosition.xz)*0.045);
        float above=smoothstep(-0.1,0.3,eye.y-worldPosition.y);
        vec2 fp=worldPosition.xz*0.62;
        fp += vec2(sin(fp.y*1.7+time*0.22),cos(fp.x*1.35-time*0.18))*0.85;
        float flow=0.5+0.5*sin(fp.x*2.35+sin(fp.y*1.2+time*0.16)*1.35+time*0.34);
        float flow2=0.5+0.5*sin((fp.x+fp.y)*3.1-time*0.21+sin(fp.x*1.9)*0.7);
        float sheen=smoothstep(0.68,0.96,flow)*0.72+smoothstep(0.74,0.985,flow2)*0.28;
        vec3 flowTint=vec3(0.035,0.50,0.43)+vec3(0.18,0.33,0.24)*sheen;
        vec3 outgoingLight=mix(albedo,flowTint,shallow*(1.0-reflectance)*above*0.17);
        float offshore = smoothstep(2.0, 21.0, length(worldPosition.xz) + sin(worldPosition.x*0.3)*2.0);
        vec3 coastalBody = mix(vec3(0.006,0.29,0.215), vec3(0.004,0.045,0.115), offshore);
        float faceLight = max(dot(surfaceNormal,normalize(vec3(-0.38,0.72,-0.58))),0.0);
        coastalBody *= 0.65 + faceLight * 0.5 + slope.x * 0.9;
        outgoingLight = mix(outgoingLight, coastalBody, above * 0.72);
        outgoingLight += specularLight * 0.34;
        // White foam gathers on intersecting crests: restrained, broken
        // lines that move with the same swell instead of a flat decal.
        float crest = 0.5 + 0.5 * sin(worldPosition.x * 1.4 + time * 0.9)
          * sin(worldPosition.z * 1.1 - time * 0.7);
        float crestFine = 0.5 + 0.5 * sin((worldPosition.x + worldPosition.z) * 3.8 + time * 1.4);
        float foam = smoothstep(0.94, 0.998, crest) * smoothstep(0.82, 0.985, crestFine);
        float foamBubbles = pow(max(0.0, sin(worldPosition.x * 7.0 - time * 0.32)
          * sin(worldPosition.z * 5.3 + time * 0.27)), 12.0);
        foam += foamBubbles * 0.18;
        float foamLight=0.35+0.65*max(dot(surfaceNormal,normalize(vec3(-0.38,0.72,-0.58))),0.0);
        foam *= shallow * above * 0.10 * foamLight;
        outgoingLight = mix(outgoingLight, vec3(0.92, 0.98, 0.96), foam);

        // Soft sky, cloud breaks and a warm sun glint stay visible in the
        // surface without relying on a bright mirror reflection of the torch.
        vec3 skyRay = reflect(-eyeDirection, surfaceNormal);
        vec3 reflectedSky = mix(vec3(0.25,0.38,0.52),vec3(0.04,0.14,0.32),smoothstep(0.0,0.8,skyRay.y));
        outgoingLight += reflectedSky * above * (0.04 + 0.16*pow(1.0-theta,3.0));
        float sunGlint=pow(max(dot(surfaceNormal,normalize(vec3(-0.38,0.72,-0.58))),0.0),42.0);
        outgoingLight += vec3(1.0,0.78,0.48) * sunGlint * above * 0.20;
      `)
      .replace("gl_FragColor = vec4( outgoingLight, alpha );", "float surfaceOpacity = mix(alpha, max(alpha,0.96), above * smoothstep(2.0,15.0,length(worldPosition.xz))); gl_FragColor = vec4(outgoingLight,surfaceOpacity);");

    w.rotation.x = -Math.PI / 2;
    // just overhead: the torch floats right under it at beat 01
    w.position.y = 2.4;
    w.material.transparent = true;
    // We look at this from BELOW. Rotated flat, its front face points up,
    // so from underneath it back-face culls to nothing — the surface was
    // simply not being drawn.
    w.material.side = THREE.DoubleSide;
    // smaller normal-map repeat = tighter chop riding on the big swell
    w.material.uniforms.size.value = 3.2;
    w.material.uniforms.uRipple = gpu.uniforms.uRipple;
    w.material.uniforms.uTime = gpu.uniforms.uTime;
    return w;
  }, [normals, gpu]);

  useEffect(() => {
    return () => {
      water.geometry.dispose();
      water.material.dispose();
      foam.geometry.dispose();
      foam.material.dispose();
      normals.dispose();
      gpu.dispose();
    };
  }, [water, foam, normals, gpu]);

  useFrame((state, dt) => {
    const { depth } = useDive.getState();

    // gone by ~14 m — and `visible = false` skips the whole reflection
    // render, not just the draw
    const near = 1 - THREE.MathUtils.clamp(depth / 14, 0, 1);
    const elapsed = state.clock.elapsedTime;
    const { pointer } = useDive.getState();
    if (near > 0.01 && Math.abs(pointer.x - lastPointer.current.x) + Math.abs(pointer.y - lastPointer.current.y) > 0.035) {
      gpu.drop(pointer.x * 5.2, -pointer.y * 5.2, 0.085, 0.045);
      lastPointer.current.set(pointer.x, pointer.y);
    }
    // Only the opening water and final seabed consume this simulation.
    if ((near > 0.01 || depth > 115) && elapsed - lastSimulation.current >= (compact ? 1 / 30 : 0)) {
      gpu.step(elapsed, 2);
      lastSimulation.current = elapsed;
    }
    water.visible = near > 0.01;
    foam.visible = water.visible;
    water.material.uniforms.time.value = elapsed;
    foam.material.uniforms.uTime.value = elapsed;
    foam.material.uniforms.uFade.value = 1 - THREE.MathUtils.smoothstep(depth, 0, 4.5);
    foam.material.uniforms.uLight.value = THREE.MathUtils.clamp(1 - depth / 3.5, 0, 1);
    if (!water.visible) return;

    // Beat 01 is ABOVE the surface: the plane sits at the torch's
    // waterline so it floats in it, and then rises past the camera as you
    // descend. The camera crossing the plane is the moment you go under —
    // it isn't faked with a transition, you actually pass through it.
    const t = THREE.MathUtils.clamp(depth / 4, 0, 1);
    water.position.y =
      THREE.MathUtils.lerp(-0.12, 1.95, t) + Math.max(0, depth - 4) * 0.35;
    foam.position.y = water.position.y + 0.014;
    // Nearly solid from above, where Water is designed to be seen and the
    // reflection is the whole point; translucent once we're under it,
    // where that same reflection would read as an opaque grey lid.
    // Opaque from above — you cannot see through a sea surface at a
    // glancing angle, and every percent of transparency here let the
    // bright backdrop sphere show through and lift the water toward
    // white. Translucent only once we are under it, where that same
    // reflection would read as a grey lid.
    water.material.uniforms.alpha.value = near * THREE.MathUtils.lerp(0.82, 0.28, t);
  });

  return (
    <>
      <primitive ref={ref} object={water} />
      <primitive object={foam} />
    </>
  );
}

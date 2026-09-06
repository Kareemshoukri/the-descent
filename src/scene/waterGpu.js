import * as THREE from "three";

// GPU height/velocity integration adapted from Martin Renou's threejs-caustics.
// BSD-3-Clause notice is distributed in public/licenses/threejs-caustics.txt.
export const WATER_FIELD = `
uniform sampler2D uRipple;
uniform float uTime;
float rippleHeight(vec2 p) {
  vec2 uv = p / 12.0 + 0.5;
  float edge = smoothstep(0.0, 0.08, min(min(uv.x, uv.y), min(1.0-uv.x, 1.0-uv.y)));
  return texture2D(uRipple, clamp(uv, 0.0, 1.0)).r * edge;
}
float seaHeight(vec2 p) {
  return sin(dot(p,vec2(0.82,0.57))*2.2+uTime*0.85)*0.055
    + sin(dot(p,vec2(-0.45,0.89))*3.7-uTime*1.05)*0.029
    + sin(dot(p,vec2(0.32,-0.95))*6.4+uTime*1.28)*0.014
    + sin(dot(p,vec2(0.91,0.42))*11.7-uTime*1.61)*0.006
    + sin(dot(p,vec2(-0.76,0.65))*18.6+uTime*1.9)*0.003
    + rippleHeight(p);
}
vec2 seaSlope(vec2 p) {
  float e = 0.023;
  return vec2(seaHeight(p+vec2(e,0.0))-seaHeight(p-vec2(e,0.0)),
    seaHeight(p+vec2(0.0,e))-seaHeight(p-vec2(0.0,e))) / (2.0*e);
}`;

export const activeWaterGpu = { current: null };

const QUAD = `varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`;
const UPDATE = `
uniform sampler2D uState;
uniform vec2 uTexel;
varying vec2 vUv;
void main(){
  vec2 info=texture2D(uState,vUv).rg;
  float average=(texture2D(uState,vUv-vec2(uTexel.x,0.0)).r
    +texture2D(uState,vUv+vec2(uTexel.x,0.0)).r
    +texture2D(uState,vUv-vec2(0.0,uTexel.y)).r
    +texture2D(uState,vUv+vec2(0.0,uTexel.y)).r)*0.25;
  info.g=(info.g+(average-info.r)*1.8)*0.993;
  info.r+=info.g;
  float edge=smoothstep(0.0,0.04,min(min(vUv.x,vUv.y),min(1.0-vUv.x,1.0-vUv.y)));
  gl_FragColor=vec4(info*mix(0.88,1.0,edge),0.0,1.0);
}`;
const DROP = `
uniform sampler2D uState;
uniform vec2 uCenter;
uniform float uStrength;
uniform float uRadius;
varying vec2 vUv;
void main(){
  vec4 info=texture2D(uState,vUv);
  float drop=max(0.0,1.0-length(uCenter-vUv)/uRadius);
  info.r+=(0.5-cos(drop*3.14159265)*0.5)*uStrength;
  gl_FragColor=info;
}`;

export function createWaterGpu(renderer, compact = false) {
  const resolution = compact ? 256 : 384;
  const supported = renderer.extensions.has("EXT_color_buffer_float");
  const flat = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
  flat.needsUpdate = true;
  const uniforms = { uRipple: { value: flat }, uTime: { value: 0 } };
  if (!supported) return { uniforms, caustics: null, step(){}, drop(){}, dispose(){flat.dispose();} };
  const options = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
  const buffers = [new THREE.WebGLRenderTarget(resolution,resolution,options),new THREE.WebGLRenderTarget(resolution,resolution,options)];
  let current = 0, initialized = false;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadGeometry = new THREE.PlaneGeometry(2,2);
  const update = new THREE.ShaderMaterial({vertexShader:QUAD,fragmentShader:UPDATE,uniforms:{uState:{value:null},uTexel:{value:new THREE.Vector2(1/resolution,1/resolution)}},depthTest:false,depthWrite:false});
  const drop = new THREE.ShaderMaterial({vertexShader:QUAD,fragmentShader:DROP,uniforms:{uState:{value:null},uCenter:{value:new THREE.Vector2()},uStrength:{value:0},uRadius:{value:0.02}},depthTest:false,depthWrite:false});
  const quad = new THREE.Mesh(quadGeometry,update);
  quad.frustumCulled = false;
  const passScene = new THREE.Scene();
  passScene.add(quad);
  const caustics = new THREE.WebGLRenderTarget(compact ? 1024 : 1536,compact ? 1024 : 1536,options);
  const causticGeometry = new THREE.PlaneGeometry(16,16,compact ? 192 : 320,compact ? 192 : 320);
  const causticMaterial = new THREE.ShaderMaterial({
    uniforms, depthTest:false, depthWrite:false, transparent:true, blending:THREE.AdditiveBlending, side:THREE.DoubleSide,
    vertexShader: `${WATER_FIELD}
      varying vec3 vOld; varying vec3 vNew;
      void main(){
        vec2 p=position.xy;
        vec2 slope=seaSlope(p);
        vec3 normal=normalize(vec3(-slope.x,1.0,-slope.y));
        vec3 ray=refract(normalize(vec3(0.38,-0.88,0.28)),normal,0.7504);
        vOld=vec3(p.x,0.0,p.y);
        float travel=(1.65+seaHeight(p))/max(0.1,-ray.y);
        vNew=vec3(p.x+ray.x*travel,0.0,p.y+ray.z*travel);
        gl_Position=vec4(vNew.x/8.0,vNew.z/8.0,0.0,1.0);
      }`,
    fragmentShader: `varying vec3 vOld; varying vec3 vNew;
      void main(){
        float oldArea=length(cross(dFdx(vOld),dFdy(vOld)));
        float newArea=max(length(cross(dFdx(vNew),dFdy(vNew))),0.000001);
        float focus=clamp(oldArea/newArea,0.0,12.0)*0.18;
        gl_FragColor=vec4(vec3(focus),1.0);
      }`,
  });
  const causticMesh = new THREE.Mesh(causticGeometry,causticMaterial);
  causticMesh.frustumCulled=false;
  const causticScene=new THREE.Scene();
  causticScene.add(causticMesh);
  const oldColor=new THREE.Color();
  const pending=[];
  function renderPass(material){
    material.uniforms.uState.value=buffers[current].texture;
    current=1-current;
    quad.material=material;
    renderer.setRenderTarget(buffers[current]);
    renderer.render(passScene,camera);
  }
  const api = {
    uniforms, caustics:caustics.texture,
    drop(x,z,strength=0.065,radius=0.02){
      if(Math.abs(x)<5.7 && Math.abs(z)<5.7 && pending.length<8) pending.push([x/12+0.5,z/12+0.5,strength,radius]);
    },
    step(time,steps){
      const previous=renderer.getRenderTarget();
      renderer.getClearColor(oldColor);
      const alpha=renderer.getClearAlpha();
      renderer.setClearColor(0,0);
      if(!initialized){for(const target of buffers){renderer.setRenderTarget(target);renderer.clear();}initialized=true;}
      for(const [x,y,strength,radius] of pending){
        drop.uniforms.uCenter.value.set(x,y);drop.uniforms.uStrength.value=strength;drop.uniforms.uRadius.value=radius;renderPass(drop);
      }
      pending.length=0;
      for(let i=0;i<steps;i++)renderPass(update);
      uniforms.uRipple.value=buffers[current].texture;
      uniforms.uTime.value=time;
      renderer.setRenderTarget(caustics);
      renderer.clear();
      renderer.render(causticScene,camera);
      renderer.setRenderTarget(previous);
      renderer.setClearColor(oldColor,alpha);
    },
    dispose(){
      buffers.forEach(t=>t.dispose());caustics.dispose();flat.dispose();
      quadGeometry.dispose();update.dispose();drop.dispose();causticGeometry.dispose();causticMaterial.dispose();
    },
  };
  activeWaterGpu.current = api;
  return api;
}

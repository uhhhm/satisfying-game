// Sky dome, sea, lights and the time-of-day palette.
import * as THREE from 'three';
import { clamp, lerp } from '../core/math';
import { U } from '../core/shaders';
import type { Island } from './island';

interface TOD {
  t: number;
  top: string; hor: string; sun: string; sunI: number; hemiS: string; hemiG: string; hemiI: number;
  fog: string; night: number; elev: number; deep: string; shallow: string;
}

const KEYS: TOD[] = [
  { t: 0.0, top: '#141c36', hor: '#334064', sun: '#9fb2e0', sunI: 0.35, hemiS: '#4a5a85', hemiG: '#2a2838', hemiI: 0.75, fog: '#2e3857', night: 1, elev: 0.6, deep: '#1b3550', shallow: '#2f5d74' },
  { t: 0.2, top: '#6f86b8', hor: '#f2c1a6', sun: '#ffc79a', sunI: 1.5, hemiS: '#b6c4e0', hemiG: '#8a7a6e', hemiI: 0.9, fog: '#e6c6b6', night: 0.15, elev: 0.15, deep: '#5c8fae', shallow: '#9fd1d0' },
  { t: 0.35, top: '#8bb4dc', hor: '#ebe6dc', sun: '#fff0d8', sunI: 2.4, hemiS: '#cfe0f0', hemiG: '#9a8f7e', hemiI: 1.0, fog: '#e1e4e1', night: 0, elev: 0.5, deep: '#5f9cbc', shallow: '#a9e0dc' },
  { t: 0.5, top: '#7cafdd', hor: '#e4ecef', sun: '#fffaf0', sunI: 2.6, hemiS: '#d2e4f2', hemiG: '#9d927f', hemiI: 1.0, fog: '#e2e9ec', night: 0, elev: 0.85, deep: '#5aa0c4', shallow: '#a6e3de' },
  { t: 0.68, top: '#87a3d0', hor: '#f6d6b2', sun: '#ffd39b', sunI: 2.3, hemiS: '#d8d6e6', hemiG: '#a08a74', hemiI: 0.95, fog: '#efd8c0', night: 0, elev: 0.38, deep: '#5e93b6', shallow: '#b2dccf' },
  { t: 0.8, top: '#4a5a90', hor: '#f0b09a', sun: '#ffbe9c', sunI: 1.05, hemiS: '#aeb0d8', hemiG: '#7a6a78', hemiI: 1.1, fog: '#b99aa6', night: 0.45, elev: 0.12, deep: '#3e6584', shallow: '#7aa9b2' },
  { t: 0.9, top: '#18213d', hor: '#3a4670', sun: '#a9bce8', sunI: 0.45, hemiS: '#5a6a98', hemiG: '#2e2c40', hemiI: 0.9, fog: '#2e3857', night: 1, elev: 0.6, deep: '#1b3550', shallow: '#2f5d74' },
  { t: 1.0, top: '#141c36', hor: '#334064', sun: '#9fb2e0', sunI: 0.35, hemiS: '#4a5a85', hemiG: '#2a2838', hemiI: 0.75, fog: '#2e3857', night: 1, elev: 0.6, deep: '#1b3550', shallow: '#2f5d74' },
];

const OVERCAST = { top: new THREE.Color('#aeb6bd'), hor: new THREE.Color('#d6d4cf'), fog: new THREE.Color('#cfccc6') };

const SKY_VS = `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const SKY_FS = `
varying vec3 vDir;
uniform vec3 uTop, uHor, uSun;
uniform vec3 uSunDir;
uniform float uNight, uTime;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -1.0, 1.0);
  float g = pow(clamp(h, 0.0, 1.0), 0.55);
  vec3 col = mix(uHor, uTop, g);
  col = mix(col, uHor * 0.92, smoothstep(0.0, -0.3, h));
  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSun * (pow(sd, 18.0) * 0.25 + pow(sd, 400.0) * 1.2) * (1.0 - uNight * 0.6);
  // stars
  if (uNight > 0.01) {
    vec3 sp = floor(d * 220.0);
    float s = hash(sp);
    float tw = 0.6 + 0.4 * sin(uTime * 2.0 + s * 50.0);
    float star = step(0.9965, s) * smoothstep(0.05, 0.3, h) * tw;
    col += vec3(1.0, 0.96, 0.9) * star * uNight * 0.9;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const SEA_VS = `
#include <common>
#include <fog_pars_vertex>
varying vec3 vWPos;
uniform float uTime;
void main() {
  vec3 p = position;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  wp.y += sin(wp.x * 0.35 + uTime * 0.9) * 0.025 + cos(wp.z * 0.3 + uTime * 0.7) * 0.025;
  vWPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const SEA_FS = `
#include <common>
#include <fog_pars_fragment>
varying vec3 vWPos;
uniform float uTime, uNight;
uniform vec3 uDeep, uShallow, uFoam, uSunCol, uSunDir;
uniform sampler2D uMask;
uniform vec4 uMaskRect; // x0, z0, size, unused
uniform vec4 uRipples[6]; // x, z, t0, strength
float hash2(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5); }
void main() {
  vec2 uv = (vWPos.xz - uMaskRect.xy) / uMaskRect.z;
  vec4 mk = texture2D(uMask, uv);
  float m = mk.r;
  float shallow = max(smoothstep(0.02, 0.6, m), smoothstep(0.05, 0.9, mk.g) * 0.55);
  vec3 col = mix(uDeep, uShallow, shallow);
  // lapping foam band near shore
  float band = smoothstep(0.32, 0.55, m) * (1.0 - smoothstep(0.62, 0.8, m));
  float wave = sin(m * 34.0 - uTime * 1.6) * 0.5 + 0.5;
  float foam = band * smoothstep(0.55, 0.95, wave);
  foam += smoothstep(0.78, 0.97, m) * 0.3;
  // gentle procedural wave highlights
  vec2 p = vWPos.xz * 0.7;
  float w = sin(p.x * 1.3 + uTime * 0.8) * sin(p.y * 1.1 - uTime * 0.6) + 0.5 * sin((p.x - p.y) * 2.1 + uTime * 1.3);
  float hl = smoothstep(1.32, 1.42, w) * (1.0 - shallow * 0.7);
  // sparkles toward the sun
  vec3 V = normalize(cameraPosition - vWPos);
  vec3 H = normalize(V + normalize(uSunDir));
  float glint = pow(max(H.y, 0.0), 260.0);
  float sp = step(0.985, hash2(floor(vWPos.xz * 6.0) + floor(uTime * 3.0)));
  col += uSunCol * (glint * 0.6 + sp * glint * 2.0);
  col += vec3(1.0) * hl * 0.035;
  // ripples (rain on sea, splashes)
  float rip = 0.0;
  for (int i = 0; i < 6; i++) {
    vec4 r = uRipples[i];
    float age = uTime - r.z;
    if (age > 0.0 && age < 2.5) {
      float d = length(vWPos.xz - r.xy);
      float rad = age * 1.6;
      rip += r.w * (1.0 - smoothstep(0.0, 0.12, abs(d - rad))) * (1.0 - age / 2.5);
    }
  }
  col = mix(col, uFoam, clamp(foam * 0.9 + rip * 0.5, 0.0, 1.0));
  float fres = pow(1.0 - max(V.y, 0.0), 3.0);
  col = mix(col, uDeep * 1.2 + 0.05, fres * 0.3);
  float alpha = mix(0.9, 0.62, shallow) + foam * 0.3;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  #include <fog_fragment>
}`;

export class Environment {
  sky: THREE.Mesh;
  sea: THREE.Mesh;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  fog: THREE.Fog;
  tod = 0.33;
  night = 0;
  vitality = 0; // 0 barren .. 1 lush, clears the overcast
  sunDir = new THREE.Vector3(0.5, 0.8, 0.3);
  maskCanvas: HTMLCanvasElement;
  maskTex: THREE.CanvasTexture;
  maskRect = new THREE.Vector4(-70, -85, 140, 0);
  private ripples: THREE.Vector4[];
  private ripIdx = 0;
  private skyU: Record<string, THREE.IUniform>;
  private seaU: Record<string, THREE.IUniform>;
  private cur = {
    top: new THREE.Color(), hor: new THREE.Color(), sun: new THREE.Color(), hemiS: new THREE.Color(),
    hemiG: new THREE.Color(), fog: new THREE.Color(), deep: new THREE.Color(), shallow: new THREE.Color(),
    sunI: 1, hemiI: 1, elev: 0.5,
  };

  constructor(scene: THREE.Scene) {
    this.fog = new THREE.Fog('#e1e4e1', 40, 140);
    scene.fog = this.fog;

    this.skyU = {
      uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSun: { value: new THREE.Color() },
      uSunDir: { value: this.sunDir }, uNight: { value: 0 }, uTime: U.uTime,
    };
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(500, 32, 16),
      new THREE.ShaderMaterial({ uniforms: this.skyU, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, fog: false }),
    );
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    this.maskCanvas = document.createElement('canvas');
    this.maskCanvas.width = this.maskCanvas.height = 512;
    this.maskTex = new THREE.CanvasTexture(this.maskCanvas);
    this.maskTex.colorSpace = THREE.NoColorSpace;
    this.ripples = Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, -100, 0));
    this.seaU = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() }, uFoam: { value: new THREE.Color('#f7fbfb') },
      uSunCol: { value: new THREE.Color() }, uSunDir: { value: this.sunDir }, uMask: { value: null },
      uMaskRect: { value: this.maskRect }, uNight: { value: 0 }, uRipples: { value: this.ripples },
    }]);
    this.seaU.uTime = U.uTime;
    this.seaU.uMask.value = this.maskTex;
    this.seaU.uMaskRect.value = this.maskRect;
    this.seaU.uRipples.value = this.ripples;
    this.seaU.uSunDir.value = this.sunDir;
    const seaMat = new THREE.ShaderMaterial({
      uniforms: this.seaU, vertexShader: SEA_VS, fragmentShader: SEA_FS, transparent: true, fog: true, depthWrite: false,
    });
    const seaGeo = new THREE.PlaneGeometry(900, 900, 120, 120);
    seaGeo.rotateX(-Math.PI / 2);
    this.sea = new THREE.Mesh(seaGeo, seaMat);
    this.sea.renderOrder = 1;
    this.sea.position.set(0, 0.0, -20);
    scene.add(this.sea);

    this.sun = new THREE.DirectionalLight('#fff', 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -16;
    sc.right = sc.top = 16;
    sc.near = 1;
    sc.far = 90;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 4;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight('#cfe0f0', '#9a8f7e', 1);
    scene.add(this.hemi);
  }

  /** Redraw the shallow-water mask from island footprints. */
  drawMask(islands: Island[]) {
    const c = this.maskCanvas;
    const g = c.getContext('2d')!;
    const S = c.width;
    const R = this.maskRect;
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = S;
    const tg = tmp.getContext('2d')!;
    tg.fillStyle = '#000';
    tg.fillRect(0, 0, S, S);
    tg.globalCompositeOperation = 'lighter';
    for (const isl of islands) {
      if (Math.abs(isl.cx - (R.x + R.z / 2)) > R.z * 0.6 + 15 || Math.abs(isl.cz - (R.y + R.z / 2)) > R.z * 0.6 + 15) continue;
      const sub = isl.rise.target < -0.5;
      // risen land → red channel (foam + shallows), submerged → green (a faint hint only)
      tg.fillStyle = sub ? 'rgb(0,255,0)' : 'rgb(255,0,0)';
      for (const t of isl.tiles) {
        const x = ((t.x + isl.cx - R.x) / R.z) * S;
        const y = ((t.z + isl.cz - R.y) / R.z) * S;
        tg.beginPath();
        tg.arc(x, y, (1.15 / R.z) * S, 0, Math.PI * 2);
        tg.fill();
      }
    }
    tg.globalCompositeOperation = 'source-over';
    g.fillStyle = '#000';
    g.fillRect(0, 0, S, S);
    g.filter = 'blur(7px)';
    g.drawImage(tmp, 0, 0);
    g.filter = 'none';
    // canvas y = world z, texture v flips: flipY default true matches uv.y=(z-z0)/size if we flip
    this.maskTex.flipY = false;
    this.maskTex.needsUpdate = true;
  }

  ripple(x: number, z: number, strength = 0.6) {
    const r = this.ripples[this.ripIdx];
    r.set(x, z, U.uTime.value, strength);
    this.ripIdx = (this.ripIdx + 1) % this.ripples.length;
  }

  update(dt: number, focus: THREE.Vector3) {
    void dt;
    const t = ((this.tod % 1) + 1) % 1;
    let a = KEYS[0], b = KEYS[1];
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (t >= KEYS[i].t && t <= KEYS[i + 1].t) {
        a = KEYS[i];
        b = KEYS[i + 1];
        break;
      }
    }
    const f = clamp((t - a.t) / Math.max(1e-4, b.t - a.t));
    const C = this.cur;
    const mix = (k: keyof TOD, out: THREE.Color) => out.set(a[k] as string).lerp(new THREE.Color(b[k] as string), f);
    mix('top', C.top); mix('hor', C.hor); mix('sun', C.sun); mix('hemiS', C.hemiS); mix('hemiG', C.hemiG);
    mix('fog', C.fog); mix('deep', C.deep); mix('shallow', C.shallow);
    C.sunI = lerp(a.sunI, b.sunI, f);
    C.hemiI = lerp(a.hemiI, b.hemiI, f);
    C.elev = lerp(a.elev, b.elev, f);
    this.night = lerp(a.night, b.night, f);

    // barren world: overcast sky that clears with vitality
    const oc = (1 - this.vitality) * 0.7 * (1 - this.night);
    C.top.lerp(OVERCAST.top, oc);
    C.hor.lerp(OVERCAST.hor, oc * 0.8);
    C.fog.lerp(OVERCAST.fog, oc * 0.8);
    C.deep.lerp(new THREE.Color('#7f98a6'), oc * 0.8);
    C.shallow.lerp(new THREE.Color('#b9c8c6'), oc * 0.8);
    C.sunI *= 1 - oc * 0.25;

    const az = t * Math.PI * 2 + 0.6;
    this.sunDir.set(Math.cos(az) * 0.8, 0.25 + C.elev * 0.9, Math.sin(az) * 0.6 + 0.4).normalize();

    this.skyU.uTop.value.copy(C.top);
    this.skyU.uHor.value.copy(C.hor);
    this.skyU.uSun.value.copy(C.sun);
    this.skyU.uNight.value = this.night;
    this.seaU.uDeep.value.copy(C.deep);
    this.seaU.uShallow.value.copy(C.shallow);
    this.seaU.uSunCol.value.copy(C.sun).multiplyScalar(0.6 * (1 - this.night * 0.7));
    this.seaU.uFoam.value.set('#f4f8f6').lerp(new THREE.Color('#9fb0cf'), this.night * 0.6);
    this.seaU.uNight.value = this.night;
    this.fog.color.copy(C.fog);
    this.sun.color.copy(C.sun);
    this.sun.intensity = C.sunI;
    this.hemi.color.copy(C.hemiS);
    this.hemi.groundColor.copy(C.hemiG);
    this.hemi.intensity = C.hemiI;
    U.uNight.value = this.night;

    // light follows the focus so the shadow map stays sharp where we play
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 40);
    this.sea.position.x = focus.x;
    this.sea.position.z = focus.z;
  }
}

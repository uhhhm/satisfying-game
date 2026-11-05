// Pooled CPU particles rendered as shaped point sprites.
import * as THREE from 'three';

export const SHAPE = { dot: 0, petal: 1, sparkle: 2, ring: 3, streak: 4, heart: 5, leaf: 6 } as const;

export interface Emit {
  x: number; y: number; z: number;
  vx?: number; vy?: number; vz?: number;
  life?: number;
  size?: number;
  color?: THREE.ColorRepresentation | THREE.Color;
  alpha?: number;
  gravity?: number;
  drag?: number;
  shape?: number;
  spin?: number;
  grow?: number; // size multiplier at end of life
  flutter?: number; // sideways sway for petals/leaves
}

const VS = `
attribute float aSize;
attribute float aAlpha;
attribute float aShape;
attribute float aRot;
attribute vec3 aColor;
varying float vAlpha;
varying float vShape;
varying float vRot;
varying vec3 vColor;
uniform float uScale;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = aSize * uScale / max(0.1, -mvPosition.z);
  vAlpha = aAlpha; vShape = aShape; vRot = aRot; vColor = aColor;
  #include <fog_vertex>
}`;
const VS_HEAD = `#include <common>\n#include <fog_pars_vertex>\n`;

const FS = `
#include <common>
#include <fog_pars_fragment>
varying float vAlpha;
varying float vShape;
varying float vRot;
varying vec3 vColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  p.y = -p.y;
  float c = cos(vRot), s = sin(vRot);
  vec2 r = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  float a = 0.0;
  if (vShape < 0.5) {
    a = 1.0 - smoothstep(0.2, 1.0, length(p));
  } else if (vShape < 1.5) { // petal
    vec2 q = r * vec2(1.0, 1.9);
    a = 1.0 - smoothstep(0.75, 0.95, length(q + vec2(0.0, 0.0)));
  } else if (vShape < 2.5) { // sparkle
    float d = length(p);
    float cross = max(1.0 - smoothstep(0.0, 0.16, abs(r.x)) , 1.0 - smoothstep(0.0, 0.16, abs(r.y)));
    a = max(cross * (1.0 - smoothstep(0.3, 1.0, d)), 1.0 - smoothstep(0.0, 0.35, d));
  } else if (vShape < 3.5) { // ring
    float d = length(p);
    a = smoothstep(0.62, 0.78, d) * (1.0 - smoothstep(0.82, 0.98, d));
  } else if (vShape < 4.5) { // streak
    a = (1.0 - smoothstep(0.0, 0.11, abs(p.x))) * (1.0 - smoothstep(0.55, 1.0, abs(p.y)));
  } else if (vShape < 5.5) { // heart
    vec2 q = r * 1.25;
    q.y += 0.25;
    float x2 = q.x * q.x;
    float h = q.y - sqrt(abs(q.x)) * 0.62;
    float v = x2 + h * h * 1.6;
    a = 1.0 - smoothstep(0.42, 0.52, v);
  } else { // leaf
    vec2 q = r * vec2(1.7, 1.0);
    a = (1.0 - smoothstep(0.7, 0.9, length(q))) ;
    a *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.06, abs(r.x)));
  }
  a *= vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
  #include <fog_fragment>
}`;

export class Particles {
  points: THREE.Points;
  private max: number;
  private n = 0;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private size0: Float32Array;
  private alpha: Float32Array;
  private alpha0: Float32Array;
  private shape: Float32Array;
  private rot: Float32Array;
  private spin: Float32Array;
  private life: Float32Array;
  private life0: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private grow: Float32Array;
  private flutter: Float32Array;
  private geo: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
  private tmpC = new THREE.Color();

  constructor(max: number, additive: boolean) {
    this.max = max;
    const f3 = () => new Float32Array(max * 3);
    const f1 = () => new Float32Array(max);
    this.pos = f3(); this.vel = f3(); this.col = f3();
    this.size = f1(); this.size0 = f1(); this.alpha = f1(); this.alpha0 = f1(); this.shape = f1();
    this.rot = f1(); this.spin = f1(); this.life = f1(); this.life0 = f1();
    this.grav = f1(); this.drag = f1(); this.grow = f1(); this.flutter = f1();
    const g = (this.geo = new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aShape', new THREE.BufferAttribute(this.shape, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 400 } }]),
      vertexShader: VS_HEAD + VS,
      fragmentShader: FS,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 12 : 10;
  }

  setScale(viewportH: number, fovDeg: number) {
    this.material.uniforms.uScale.value = viewportH / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(e: Emit) {
    let i: number;
    if (this.n < this.max) i = this.n++;
    else i = Math.floor(Math.random() * this.max); // overwrite randomly when full
    const i3 = i * 3;
    this.pos[i3] = e.x; this.pos[i3 + 1] = e.y; this.pos[i3 + 2] = e.z;
    this.vel[i3] = e.vx ?? 0; this.vel[i3 + 1] = e.vy ?? 0; this.vel[i3 + 2] = e.vz ?? 0;
    const c = e.color instanceof THREE.Color ? e.color : this.tmpC.set(e.color ?? '#ffffff');
    this.col[i3] = c.r; this.col[i3 + 1] = c.g; this.col[i3 + 2] = c.b;
    this.size0[i] = this.size[i] = e.size ?? 0.1;
    this.alpha0[i] = e.alpha ?? 1;
    this.alpha[i] = 0;
    this.shape[i] = e.shape ?? 0;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.spin[i] = e.spin ?? 0;
    this.life0[i] = this.life[i] = e.life ?? 1;
    this.grav[i] = e.gravity ?? 0;
    this.drag[i] = e.drag ?? 0.5;
    this.grow[i] = e.grow ?? 1;
    this.flutter[i] = e.flutter ?? 0;
  }

  update(dt: number, time: number) {
    let n = this.n;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove
        n--;
        this.copy(n, i);
        i--;
        continue;
      }
      const i3 = i * 3;
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= d;
      this.vel[i3 + 1] = this.vel[i3 + 1] * d - this.grav[i] * dt;
      this.vel[i3 + 2] *= d;
      const fl = this.flutter[i];
      const sway = fl ? Math.sin(time * 4 + i) * fl : 0;
      this.pos[i3] += (this.vel[i3] + sway) * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += (this.vel[i3 + 2] + sway * 0.6) * dt;
      this.rot[i] += this.spin[i] * dt;
      const t = 1 - this.life[i] / this.life0[i];
      // fade in fast, out smooth
      const fa = Math.min(1, t * 12) * (1 - Math.pow(t, 2.2));
      this.alpha[i] = this.alpha0[i] * fa;
      this.size[i] = this.size0[i] * (1 + (this.grow[i] - 1) * t);
    }
    this.n = n;
    const g = this.geo;
    g.setDrawRange(0, n);
    for (const k of ['position', 'aColor', 'aSize', 'aAlpha', 'aShape', 'aRot']) {
      const a = g.attributes[k] as THREE.BufferAttribute;
      a.needsUpdate = true;
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * a.itemSize);
    }
  }

  private copy(from: number, to: number) {
    const f3 = from * 3, t3 = to * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[t3 + k] = this.pos[f3 + k];
      this.vel[t3 + k] = this.vel[f3 + k];
      this.col[t3 + k] = this.col[f3 + k];
    }
    this.size[to] = this.size[from]; this.size0[to] = this.size0[from];
    this.alpha[to] = this.alpha[from]; this.alpha0[to] = this.alpha0[from];
    this.shape[to] = this.shape[from]; this.rot[to] = this.rot[from]; this.spin[to] = this.spin[from];
    this.life[to] = this.life[from]; this.life0[to] = this.life0[from];
    this.grav[to] = this.grav[from]; this.drag[to] = this.drag[from];
    this.grow[to] = this.grow[from]; this.flutter[to] = this.flutter[from];
  }

  get count() {
    return this.n;
  }
}

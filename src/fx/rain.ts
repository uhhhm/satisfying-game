// Rain streaks that fall from the cloud and splash on whatever is below.
import * as THREE from 'three';

const VS = `
#include <common>
#include <fog_pars_vertex>
attribute float aA;
varying float vA;
uniform float uScale;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = 0.42 * uScale / max(0.1, -mvPosition.z);
  vA = aA;
  #include <fog_vertex>
}`;
const FS = `
#include <common>
#include <fog_pars_fragment>
varying float vA;
uniform vec3 uColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float a = (1.0 - smoothstep(0.0, 0.07, abs(p.x))) * (1.0 - smoothstep(0.2, 1.0, abs(p.y)));
  a *= vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
  #include <fog_fragment>
}`;

export interface Drop {
  x: number; y: number; z: number; vy: number; gy: number; water: boolean;
}

export class Rain {
  points: THREE.Points;
  drops: Drop[] = [];
  private pos: Float32Array;
  private al: Float32Array;
  private max = 900;
  material: THREE.ShaderMaterial;

  constructor() {
    this.pos = new Float32Array(this.max * 3);
    this.al = new Float32Array(this.max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aA', new THREE.BufferAttribute(this.al, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 400 }, uColor: { value: new THREE.Color('#dfeaf5') } }]),
      vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, fog: true,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 11;
  }

  spawn(x: number, y: number, z: number, groundY: number, water: boolean) {
    if (this.drops.length >= this.max) return;
    this.drops.push({ x, y, z, vy: -9 - Math.random() * 4, gy: groundY, water });
  }

  /** Advances drops; returns the ones that landed this frame. */
  update(dt: number): Drop[] {
    const landed: Drop[] = [];
    const keep: Drop[] = [];
    for (const d of this.drops) {
      d.vy -= 12 * dt;
      d.y += d.vy * dt;
      if (d.y <= d.gy) landed.push(d);
      else keep.push(d);
    }
    this.drops = keep;
    const n = keep.length;
    for (let i = 0; i < n; i++) {
      const d = keep[i];
      this.pos[i * 3] = d.x;
      this.pos[i * 3 + 1] = d.y;
      this.pos[i * 3 + 2] = d.z;
      this.al[i] = Math.min(1, (d.y - d.gy) * 1.5) * 0.55;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aA as THREE.BufferAttribute).needsUpdate = true;
    return landed;
  }
}

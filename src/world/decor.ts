// Instanced decor with per-instance springs (scale + squash) and tile-follow offsets.
import * as THREE from 'three';
import { CFG } from '../core/config';
import { patchSway } from '../core/shaders';
import { DecorKind, DecorModel, buildDecorModels } from './models';

const CAPACITY: Partial<Record<DecorKind, number>> = {
  grass: 4000, flower: 2600, tulip: 1200, bush: 900, pine: 900, roundtree: 700, blossomtree: 500,
  mushroom: 900, reeds: 900, cattail: 700, rock: 900, shell: 500, beachgrass: 900, lilypad: 600,
  fern: 1200, birch: 500, goldflower: 80,
};

class Pool {
  meshes: THREE.InstancedMesh[] = [];
  cap: number;
  used = 0;
  free: number[] = [];
  px: Float32Array; py: Float32Array; pz: Float32Array;
  dy: Float32Array; // follow offset
  yaw: Float32Array; tilt: Float32Array; tiltDir: Float32Array;
  bs: Float32Array; sy: Float32Array; // base scale, vertical stretch
  s: Float32Array; v: Float32Array; tgt: Float32Array; delay: Float32Array;
  alive: Uint8Array;
  animating = new Set<number>();
  dirty = new Set<number>();

  constructor(public kind: DecorKind, model: DecorModel, mats: { tint: THREE.Material; fixed: THREE.Material }, scene: THREE.Object3D) {
    const cap = (this.cap = CAPACITY[kind] ?? 500);
    for (const part of model.parts) {
      const mesh = new THREE.InstancedMesh(part.geo, part.tint ? mats.tint : mats.fixed, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = model.shadow;
      mesh.receiveShadow = true;
      mesh.count = 0;
      mesh.visible = false;
      mesh.frustumCulled = false;
      // init colours
      const white = new THREE.Color(1, 1, 1);
      for (let i = 0; i < cap; i++) mesh.setColorAt(i, white);
      scene.add(mesh);
      this.meshes.push(mesh);
    }
    const f = () => new Float32Array(cap);
    this.px = f(); this.py = f(); this.pz = f(); this.dy = f();
    this.yaw = f(); this.tilt = f(); this.tiltDir = f();
    this.bs = f(); this.sy = f(); this.s = f(); this.v = f(); this.tgt = f(); this.delay = f();
    this.alive = new Uint8Array(cap);
  }
}

export interface DecorOpts {
  yaw?: number;
  scale?: number;
  stretch?: number;
  tint?: THREE.Color;
  delay?: number;
  tilt?: number;
  instant?: boolean;
}

export type DecorRef = { kind: DecorKind; id: number };

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export class DecorSystem {
  pools = {} as Record<DecorKind, Pool>;
  models: Record<DecorKind, DecorModel>;
  matTint: THREE.MeshStandardMaterial;
  matGlow: THREE.MeshStandardMaterial;
  matFixed: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Object3D) {
    this.models = buildDecorModels();
    // vertex colours * instance colour; tinted parts get instance colour
    this.matTint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
    this.matGlow = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
    this.matFixed = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
    patchSway(this.matTint);
    patchSway(this.matGlow, true);
    patchSway(this.matFixed);
    const glowKinds: DecorKind[] = ['flower', 'tulip', 'mushroom', 'goldflower'];
    for (const k of Object.keys(this.models) as DecorKind[]) {
      const tint = glowKinds.includes(k) ? this.matGlow : this.matTint;
      this.pools[k] = new Pool(k, this.models[k], { tint, fixed: this.matFixed }, scene);
    }
  }

  add(kind: DecorKind, x: number, y: number, z: number, o: DecorOpts = {}): DecorRef | null {
    const P = this.pools[kind];
    let id: number;
    if (P.free.length) id = P.free.pop()!;
    else if (P.used < P.cap) id = P.used++;
    else return null;
    P.px[id] = x;
    P.py[id] = y;
    P.pz[id] = z;
    P.dy[id] = 0;
    P.yaw[id] = o.yaw ?? Math.random() * Math.PI * 2;
    P.tilt[id] = o.tilt ?? Math.random() * 0.12;
    P.tiltDir[id] = Math.random() * Math.PI * 2;
    P.bs[id] = o.scale ?? 1;
    P.sy[id] = o.stretch ?? 1;
    P.s[id] = o.instant ? 1 : 0;
    P.v[id] = 0;
    P.tgt[id] = 1;
    P.delay[id] = o.delay ?? 0;
    P.alive[id] = 1;
    for (const m of P.meshes) {
      if (o.tint && m.material !== this.matFixed) m.setColorAt(id, o.tint);
      m.count = Math.max(m.count, id + 1);
      m.visible = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    P.animating.add(id);
    P.dirty.add(id);
    return { kind, id };
  }

  /** Give an instance a springy kick (e.g. touched by rain, tile hop). */
  kick(ref: DecorRef, v: number) {
    const P = this.pools[ref.kind];
    if (!P.alive[ref.id]) return;
    P.v[ref.id] += v;
    P.animating.add(ref.id);
  }

  setOffset(ref: DecorRef, dy: number) {
    const P = this.pools[ref.kind];
    if (!P.alive[ref.id]) return;
    P.dy[ref.id] = dy;
    P.dirty.add(ref.id);
  }

  setTint(ref: DecorRef, c: THREE.Color) {
    const P = this.pools[ref.kind];
    for (const m of P.meshes) {
      if (m.material !== this.matFixed) {
        m.setColorAt(ref.id, c);
        m.instanceColor!.needsUpdate = true;
      }
    }
  }

  setScale(ref: DecorRef, s: number) {
    const P = this.pools[ref.kind];
    P.tgt[ref.id] = s;
    P.animating.add(ref.id);
  }

  remove(ref: DecorRef) {
    const P = this.pools[ref.kind];
    P.tgt[ref.id] = 0;
    P.alive[ref.id] = 2; // dying
    P.animating.add(ref.id);
  }

  position(ref: DecorRef) {
    const P = this.pools[ref.kind];
    return new THREE.Vector3(P.px[ref.id], P.py[ref.id] + P.dy[ref.id], P.pz[ref.id]);
  }

  update(dt: number) {
    const k = CFG.decorK;
    const c = CFG.decorC;
    for (const kind in this.pools) {
      const P = this.pools[kind as DecorKind];
      if (!P.animating.size && !P.dirty.size) continue;
      for (const id of P.animating) {
        if (P.delay[id] > 0) {
          P.delay[id] -= dt;
          continue;
        }
        // integrate spring (sub-stepped)
        let s = P.s[id], v = P.v[id];
        const tg = P.tgt[id];
        const steps = Math.max(1, Math.ceil(dt * 240));
        const h = dt / steps;
        for (let i = 0; i < steps; i++) {
          v += ((tg - s) * k - v * c) * h;
          s += v * h;
        }
        P.s[id] = s;
        P.v[id] = v;
        P.dirty.add(id);
        if (Math.abs(v) < 0.001 && Math.abs(tg - s) < 0.001) {
          P.s[id] = tg;
          P.v[id] = 0;
          P.animating.delete(id);
          if (P.alive[id] === 2 && tg === 0) {
            P.alive[id] = 0;
            P.free.push(id);
          }
        }
      }
      for (const id of P.dirty) {
        const s = Math.max(0, P.s[id]) * P.bs[id];
        const v = P.v[id];
        // squash & stretch from spring velocity (volume-ish preserving)
        const st = Math.max(0.6, Math.min(1.5, 1 + v * 0.05));
        const sxz = 1 / Math.sqrt(st);
        _e.set(Math.cos(P.tiltDir[id]) * P.tilt[id], P.yaw[id], Math.sin(P.tiltDir[id]) * P.tilt[id]);
        _q.setFromEuler(_e);
        _p.set(P.px[id], P.py[id] + P.dy[id], P.pz[id]);
        _s.set(s * sxz, s * st * P.sy[id], s * sxz);
        _m.compose(_p, _q, _s);
        for (const m of P.meshes) m.setMatrixAt(id, _m);
      }
      if (P.dirty.size) for (const m of P.meshes) m.instanceMatrix.needsUpdate = true;
      P.dirty.clear();
    }
  }
}

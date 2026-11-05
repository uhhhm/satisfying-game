// Small lives that kinships and visitors bring: frogs, a villager, rabbits, hedgehogs, ducks,
// bees around a hive, and paper lanterns in a blossom tree. Each body is baked into one mesh.
import * as THREE from 'three';
import { Spring, pick, rand, randSoft } from '../core/math';
import { U } from '../core/shaders';
import { SHAPE } from '../fx/particles';
import type { Game } from '../game/game';
import type { VisitorKind } from './kinships';
import { bake, PartSpec } from './models';

export type CritterKind = 'frog' | 'villager' | VisitorKind;

export interface Critter {
  kind: CritterKind;
  g: THREE.Group;
  ii: number;
  tile: number;
  /** tiles it may wander between; empty = stays put */
  home: number[];
  from: THREE.Vector3;
  to: THREE.Vector3;
  hopT: number;
  hopDur: number;
  idle: number;
  yaw: number;
  jump: number;
  jumpV: number;
  pop: Spring;
  sq: Spring;
  t: number;
  hoverT: number;
}

interface Bee { ii: number; hive: THREE.Vector3; a: number; r: number; speed: number; h: number; s: Spring; ph: number }

const SPEC: Record<CritterKind, { hop: number; dur: [number, number]; idle: [number, number]; scale: number; voice: 'frog' | 'duck' | 'squeak' | 'chirp' }> = {
  frog: { hop: 0.22, dur: [0.35, 0.45], idle: [3, 8], scale: 2.1, voice: 'frog' },
  villager: { hop: 0.06, dur: [0.7, 0.9], idle: [2, 5], scale: 2.0, voice: 'chirp' },
  rabbit: { hop: 0.32, dur: [0.32, 0.42], idle: [1.5, 4], scale: 2.1, voice: 'squeak' },
  hedgehog: { hop: 0.05, dur: [0.6, 0.8], idle: [2, 5], scale: 2.1, voice: 'squeak' },
  duck: { hop: 0.07, dur: [0.5, 0.7], idle: [2, 5], scale: 2.0, voice: 'duck' },
};

const tmp = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();

export class Critters {
  list: Critter[] = [];
  private geos = {} as Record<CritterKind, THREE.BufferGeometry>;
  private mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  private glowMats: THREE.MeshStandardMaterial[] = [];
  private hiveGeo: THREE.BufferGeometry;
  private lanternGeo: THREE.BufferGeometry;
  private beeMesh: THREE.InstancedMesh;
  private bees: Bee[] = [];
  private props: { ii: number; g: THREE.Group; s: Spring; bob: THREE.Object3D[]; t: number }[] = [];

  constructor(private game: Game) {
    const ico = (r: number, d = 0) => new THREE.IcosahedronGeometry(r, d);
    const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
    const cone = (r: number, h: number, s = 5) => new THREE.ConeGeometry(r, h, s);
    const cyl = (a: number, b: number, h: number, s = 6) => new THREE.CylinderGeometry(a, b, h, s);
    const eyes = (x: number, y: number, z: number, r = 0.018): PartSpec[] => [
      { geo: ico(r), color: '#2f2a28', pos: [x, y, z] },
      { geo: ico(r), color: '#2f2a28', pos: [-x, y, z] },
    ];

    this.geos.frog = bake([
      { geo: ico(0.1, 1), color: '#86b86a', pos: [0, 0.07, 0], scale: [1.2, 0.7, 1.1] },
      { geo: ico(0.07, 1), color: '#cfe0a0', pos: [0, 0.05, 0.05], scale: [1, 0.6, 1] },
      { geo: ico(0.035, 1), color: '#9ac77c', pos: [0.05, 0.13, 0.06] },
      { geo: ico(0.035, 1), color: '#9ac77c', pos: [-0.05, 0.13, 0.06] },
      ...eyes(0.055, 0.145, 0.085, 0.014),
      { geo: ico(0.04), color: '#78a85e', pos: [0.1, 0.02, -0.04], scale: [1, 0.5, 1.6] },
      { geo: ico(0.04), color: '#78a85e', pos: [-0.1, 0.02, -0.04], scale: [1, 0.5, 1.6] },
    ]);
    this.geos.villager = bake([
      { geo: cyl(0.05, 0.085, 0.18, 7), color: pick(['#d98b6b', '#7fa7c9', '#9cc07a']), pos: [0, 0.09, 0] },
      { geo: cyl(0.052, 0.07, 0.07, 7), color: '#f6efe0', pos: [0, 0.1, 0.012] },
      { geo: ico(0.055, 1), color: '#f1cfb0', pos: [0, 0.23, 0] },
      { geo: cyl(0.1, 0.1, 0.015, 9), color: '#e7cf8a', pos: [0, 0.27, 0] },
      { geo: cyl(0.05, 0.06, 0.05, 8), color: '#e7cf8a', pos: [0, 0.3, 0] },
      ...eyes(0.02, 0.24, 0.05, 0.008),
    ]);
    this.geos.rabbit = bake([
      { geo: ico(0.09, 1), color: '#efe6da', pos: [0, 0.08, -0.02], scale: [1, 0.95, 1.25] },
      { geo: ico(0.06, 1), color: '#efe6da', pos: [0, 0.16, 0.08] },
      { geo: box(0.025, 0.12, 0.012), color: '#efe6da', pos: [0.025, 0.25, 0.06], rot: [0, 0, -0.15] },
      { geo: box(0.025, 0.12, 0.012), color: '#efe6da', pos: [-0.025, 0.25, 0.06], rot: [0, 0, 0.15] },
      { geo: box(0.014, 0.08, 0.004), color: '#f2b8c2', pos: [0.025, 0.25, 0.067], rot: [0, 0, -0.15] },
      { geo: box(0.014, 0.08, 0.004), color: '#f2b8c2', pos: [-0.025, 0.25, 0.067], rot: [0, 0, 0.15] },
      { geo: ico(0.035), color: '#ffffff', pos: [0, 0.1, -0.13] },
      { geo: ico(0.01), color: '#f2a0ae', pos: [0, 0.16, 0.135] },
      ...eyes(0.035, 0.18, 0.11, 0.011),
    ]);
    const spikes: PartSpec[] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const row = i % 2;
      spikes.push({ geo: cone(0.022, 0.08, 4), color: row ? '#7a5a42' : '#8c6a4f', pos: [Math.cos(a) * 0.07, 0.1 + row * 0.03, Math.sin(a) * 0.06 - 0.02], rot: [Math.sin(a) * -0.9 - 0.4, 0, -Math.cos(a) * 0.9] });
    }
    this.geos.hedgehog = bake([
      { geo: ico(0.1, 1), color: '#8c6a4f', pos: [0, 0.07, -0.02], scale: [1, 0.75, 1.2] },
      ...spikes,
      { geo: ico(0.05, 1), color: '#e2c8a6', pos: [0, 0.06, 0.09], scale: [0.9, 0.8, 1.2] },
      { geo: ico(0.014), color: '#2f2a28', pos: [0, 0.065, 0.155] },
      ...eyes(0.028, 0.085, 0.12, 0.01),
    ]);
    this.geos.duck = bake([
      { geo: ico(0.1, 1), color: '#fbf8f1', pos: [0, 0.08, 0], scale: [0.95, 0.8, 1.35] },
      { geo: cone(0.05, 0.09, 4), color: '#f1ece2', pos: [0, 0.12, -0.14], rot: [-1.2, 0, 0] },
      { geo: ico(0.055, 1), color: '#fbf8f1', pos: [0, 0.19, 0.08] },
      { geo: box(0.05, 0.016, 0.06), color: '#f2a65a', pos: [0, 0.18, 0.15] },
      { geo: cyl(0.008, 0.008, 0.06, 4), color: '#f2a65a', pos: [0.03, 0.01, 0] },
      { geo: cyl(0.008, 0.008, 0.06, 4), color: '#f2a65a', pos: [-0.03, 0.01, 0] },
      ...eyes(0.03, 0.205, 0.115, 0.009),
    ]);

    // a straw skep hive
    this.hiveGeo = bake([
      { geo: cyl(0.09, 0.12, 0.06, 9), color: '#e2b866', pos: [0, 0.03, 0] },
      { geo: cyl(0.08, 0.1, 0.06, 9), color: '#d8ab58', pos: [0, 0.09, 0] },
      { geo: cyl(0.055, 0.082, 0.06, 9), color: '#e2b866', pos: [0, 0.15, 0] },
      { geo: cyl(0.01, 0.05, 0.05, 9), color: '#d8ab58', pos: [0, 0.2, 0] },
      { geo: box(0.05, 0.035, 0.02), color: '#5a4030', pos: [0, 0.02, 0.105] },
      { geo: box(0.05, 0.12, 0.05), color: '#9a7350', pos: [0, -0.06, 0] },
    ]);
    // one paper lantern
    this.lanternGeo = new THREE.IcosahedronGeometry(0.06, 1).scale(1, 1.25, 1);

    const beeGeo = new THREE.IcosahedronGeometry(0.045, 0).scale(1, 0.8, 1.4);
    this.beeMesh = new THREE.InstancedMesh(beeGeo, new THREE.MeshStandardMaterial({ color: '#f4c84a', emissive: new THREE.Color('#5a4410'), roughness: 0.6, flatShading: true }), 240);
    this.beeMesh.count = 0;
    this.beeMesh.frustumCulled = false;
    game.scene.add(this.beeMesh);
  }

  private ground(ii: number, tile: number) {
    const isl = this.game.islands[ii];
    return isl.group.position.y + isl.tiles[tile].h + isl.base[tile];
  }

  // -------------------------------------------------------------- spawning
  spawn(kind: CritterKind, ii: number, tile: number, o: { home?: number[]; instant?: boolean; at?: THREE.Vector3; face?: THREE.Vector3 } = {}) {
    const isl = this.game.islands[ii];
    const mesh = new THREE.Mesh(this.geos[kind], this.mat);
    mesh.castShadow = true;
    const g = new THREE.Group();
    g.add(mesh);
    const p = o.at ? o.at.clone() : isl.worldPos(tile, new THREE.Vector3()).add(new THREE.Vector3(randSoft() * 0.3, 0, randSoft() * 0.3));
    p.y = this.ground(ii, tile);
    g.position.copy(p);
    const yaw = o.face ? Math.atan2(o.face.x - p.x, o.face.z - p.z) : Math.random() * Math.PI * 2;
    g.rotation.y = yaw;
    const c: Critter = {
      kind, g, ii, tile, home: o.home ?? [], from: p.clone(), to: p.clone(), hopT: 1, hopDur: 0.4,
      idle: rand(...SPEC[kind].idle), yaw, jump: 0, jumpV: 0, pop: new Spring(o.instant ? 1 : 0, 150, 9),
      sq: new Spring(0, 260, 12), t: Math.random() * 10, hoverT: -10,
    };
    c.pop.target = 1;
    if (!o.instant) c.pop.vel = 2;
    g.scale.setScalar(o.instant ? SPEC[kind].scale : 0.0001);
    this.game.scene.add(g);
    this.list.push(c);
    return c;
  }

  /** Let a critter roam a set of tiles (a visitor moving in). */
  setHome(c: Critter, tiles: number[]) {
    c.home = tiles.slice();
    c.idle = rand(0.6, 1.5);
  }

  /** A happy double hop with hearts. */
  cheer(c: Critter) {
    c.jumpV = 4.6;
    c.sq.vel = -6;
    const p = c.g.position;
    this.game.particles.emit({ x: p.x, y: p.y + 0.5, z: p.z, vy: 1.1, life: 1.4, size: 0.3, color: '#f49fae', shape: SHAPE.heart, drag: 1.4 });
    this.game.after(0.55, () => {
      c.jumpV = 3.6;
      c.sq.vel = -4;
      this.game.particles.emit({ x: p.x + 0.15, y: p.y + 0.55, z: p.z, vy: 1, life: 1.2, size: 0.22, color: '#f7c6d6', shape: SHAPE.heart, drag: 1.4 });
    });
    this.voice(c, 1.15);
  }

  voice(c: Critter, pitch = 1) {
    const p = c.g.position;
    this.game.sfx.critter(SPEC[c.kind].voice, this.game.pan(p.x, p.y, p.z), pitch * rand(0.95, 1.08));
  }

  /** A straw hive beside some flowers, with a few bees. */
  hive(ii: number, tile: number, local: [number, number], instant: boolean) {
    const isl = this.game.islands[ii];
    const t = isl.tiles[tile];
    const g = new THREE.Group();
    const m = new THREE.Mesh(this.hiveGeo, this.mat);
    m.castShadow = true;
    g.add(m);
    g.position.set(t.x + isl.cx + local[0], this.ground(ii, tile) + 0.2, t.z + isl.cz + local[1]);
    g.rotation.y = Math.atan2(local[0], local[1]);
    this.addProp(ii, g, 2.1, instant, []);
    const n = 3;
    for (let k = 0; k < n && this.bees.length < 240; k++) {
      const b: Bee = { ii, hive: g.position.clone().add(new THREE.Vector3(0, 0.25, 0)), a: Math.random() * 6, r: rand(0.35, 0.9), speed: rand(1.2, 2) * (Math.random() < 0.5 ? -1 : 1), h: rand(0.1, 0.4), s: new Spring(instant ? 1 : 0, 120, 9), ph: Math.random() * 6 };
      b.s.target = 1;
      this.bees.push(b);
    }
    this.beeMesh.count = this.bees.length;
  }

  /** Paper lanterns hung in a blossom tree; they glow at dusk. */
  lanterns(ii: number, tile: number, instant: boolean) {
    const isl = this.game.islands[ii];
    const t = isl.tiles[tile];
    const g = new THREE.Group();
    g.position.set(t.x + isl.cx, this.ground(ii, tile), t.z + isl.cz);
    const bob: THREE.Object3D[] = [];
    const cols = ['#ffd98a', '#f7a07a', '#fbe6c0'];
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.random() * 0.5;
      const mat = new THREE.MeshStandardMaterial({ color: cols[k % 3], emissive: new THREE.Color(cols[k % 3]), emissiveIntensity: 0.3, roughness: 0.7, flatShading: true });
      this.glowMats.push(mat);
      const l = new THREE.Mesh(this.lanternGeo, mat);
      l.position.set(Math.cos(a) * rand(0.32, 0.45), rand(0.55, 0.8), Math.sin(a) * rand(0.32, 0.45));
      l.userData.y = l.position.y;
      l.userData.ph = Math.random() * 6;
      g.add(l);
      bob.push(l);
    }
    this.addProp(ii, g, 1.55, instant, bob);
  }

  private addProp(ii: number, g: THREE.Group, scale: number, instant: boolean, bob: THREE.Object3D[]) {
    const s = new Spring(instant ? 1 : 0, 170, 10);
    s.target = 1;
    if (!instant) s.vel = 2;
    g.userData.scale = scale;
    g.scale.setScalar(instant ? scale : 0.0001);
    this.game.scene.add(g);
    this.props.push({ ii, g, s, bob, t: Math.random() * 10 });
  }

  /** Remove everything living on an unloaded island. */
  removeIsland(ii: number) {
    this.list = this.list.filter((c) => {
      if (c.ii !== ii) return true;
      c.g.parent?.remove(c.g);
      return false;
    });
    this.bees = this.bees.filter((b) => b.ii !== ii);
    this.beeMesh.count = this.bees.length;
    this.props = this.props.filter((p) => {
      if (p.ii !== ii) return true;
      p.g.parent?.remove(p.g);
      p.g.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m && this.glowMats.includes(m)) {
          this.glowMats.splice(this.glowMats.indexOf(m), 1);
          m.dispose();
        }
      });
      return false;
    });
  }

  // -------------------------------------------------------------- interaction
  private hit(c: Critter, ray: THREE.Ray, r = 0.42) {
    tmp.copy(c.g.position);
    tmp.y += 0.3;
    return ray.distanceSqToPoint(tmp) < r * r;
  }

  hover(ray: THREE.Ray) {
    for (const c of this.list) {
      if (this.hit(c, ray) && this.game.time - c.hoverT > 1.2 && c.jump <= 0) {
        c.hoverT = this.game.time;
        c.sq.vel = -3;
      }
    }
  }

  /** Returns the critter that was tapped, if any. */
  tryTap(ray: THREE.Ray): Critter | null {
    for (const c of this.list) {
      if (!this.hit(c, ray)) continue;
      c.jumpV = 4.4;
      c.sq.vel = -5;
      this.voice(c);
      const p = c.g.position;
      this.game.music.play(0.75, c.kind === 'frog' ? 'kalimba' : 'marimba', this.game.pan(p.x, p.y, p.z), 0.55);
      this.game.cloud.happy = 1;
      return c;
    }
    return null;
  }

  // -------------------------------------------------------------- update
  update(dt: number) {
    const g = this.game;
    const night = U.uNight.value;
    for (const m of this.glowMats) m.emissiveIntensity = 0.25 + night * 1.8;

    for (const c of this.list) {
      const S = SPEC[c.kind];
      const isl = g.islands[c.ii];
      c.t += dt;
      c.pop.update(dt);
      c.sq.update(dt);
      if (c.hopT < 1) {
        c.hopT = Math.min(1, c.hopT + dt / c.hopDur);
        const t = c.hopT;
        c.g.position.lerpVectors(c.from, c.to, t);
        c.g.position.y += Math.sin(t * Math.PI) * S.hop;
        if (c.hopT >= 1) c.sq.vel = -3.5;
      } else {
        c.idle -= dt;
        if (c.idle <= 0) {
          c.idle = rand(...S.idle);
          const opts = c.home.length
            ? isl.tiles[c.tile].neighbors.filter((j) => c.home.includes(j) && isl.stage[j] > 0 && Math.abs(isl.tiles[j].h - isl.tiles[c.tile].h) <= 0.5)
            : [];
          if (opts.length && Math.random() < 0.7) {
            const j = pick(opts);
            c.tile = j;
            c.from.copy(c.g.position);
            const p = isl.worldPos(j, new THREE.Vector3());
            c.to.set(p.x + randSoft() * 0.3, this.ground(c.ii, j), p.z + randSoft() * 0.3);
            c.hopT = 0;
            c.hopDur = rand(...S.dur);
            c.yaw = Math.atan2(c.to.x - c.from.x, c.to.z - c.from.z);
            c.sq.vel = 3;
          } else if (Math.random() < 0.5) {
            // look around, or a little hop on the spot
            c.yaw += randSoft() * 1.4;
            if (c.kind === 'frog' && Math.random() < 0.4) {
              c.jumpV = 2.6;
              if (Math.random() < 0.3) this.voice(c, 0.9);
            }
          }
        }
      }
      if (c.jumpV !== 0 || c.jump > 0) {
        c.jumpV -= 16 * dt;
        c.jump = Math.max(0, c.jump + c.jumpV * dt);
        if (c.jump <= 0 && c.jumpV < 0) {
          c.jumpV = 0;
          c.sq.vel = -4;
        }
      }
      c.g.rotation.y += (((c.yaw - c.g.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 6);
      const breathe = c.kind === 'frog' ? Math.sin(c.t * 5) * 0.03 : Math.sin(c.t * 2.2) * 0.015;
      const sq = c.sq.value + breathe;
      const s = S.scale * Math.max(0.0001, c.pop.value);
      c.g.scale.set(s * (1 - sq * 0.3), s * (1 + sq), s * (1 - sq * 0.3));
      (c.g.children[0] as THREE.Object3D).position.y = c.jump;
    }

    // bees: loops around their hive, dipping toward the flowers
    for (let i = 0; i < this.bees.length; i++) {
      const b = this.bees[i];
      b.s.update(dt);
      b.a += b.speed * dt;
      const r = b.r * (0.75 + 0.25 * Math.sin(b.a * 2.3 + b.ph));
      tmp.set(b.hive.x + Math.cos(b.a) * r, b.hive.y + b.h + Math.sin(b.a * 3.1 + b.ph) * 0.08, b.hive.z + Math.sin(b.a * 1.3) * r);
      const s = Math.max(0.0001, b.s.value) * (1 - night * 0.8);
      _q.setFromEuler(_e.set(0, -b.a * Math.sign(b.speed), 0));
      _m.compose(tmp, _q, _s.set(s, s, s));
      this.beeMesh.setMatrixAt(i, _m);
    }
    if (this.bees.length) this.beeMesh.instanceMatrix.needsUpdate = true;

    for (const p of this.props) {
      p.t += dt;
      if (!p.s.settled) {
        p.s.update(dt);
        p.g.scale.setScalar(Math.max(0.0001, p.s.value) * p.g.userData.scale);
      }
      for (const l of p.bob) {
        l.position.y = l.userData.y + Math.sin(p.t * 1.3 + l.userData.ph) * 0.03;
        l.rotation.z = Math.sin(p.t * 0.9 + l.userData.ph) * 0.12;
      }
    }
  }
}

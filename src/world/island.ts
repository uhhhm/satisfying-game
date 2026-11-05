// One island: tile rendering (instanced), per-tile springs, decor growth.
import * as THREE from 'three';
import { CFG } from '../core/config';
import { worldToHex, key } from '../core/hex';
import { RNG, Spring, clamp, pick, springStep as springStepLocal } from '../core/math';
import { patchCap, patchWater } from '../core/shaders';
import { DecorRef, DecorSystem } from './decor';
import { IslandData, TileData } from './gen';
import { DecorKind, FLOWER_COLORS, BLOSSOM_COLORS, PAL, buildTileGeometries } from './models';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const BLOOM_FLASH = new THREE.Color('#fff6dc');

const COL_BASE = -2.6;
const DECOR_SCALE = 1.75;
/** Every island rests at sea level once risen; decor is anchored there. */
const REST_Y = 0;

let sharedGeo: ReturnType<typeof buildTileGeometries> | null = null;

export class Island {
  group = new THREE.Group();
  caps: THREE.InstancedMesh;
  cols: THREE.InstancedMesh;
  water: THREE.InstancedMesh;
  n: number;
  // tile state
  moist: Float32Array;
  stage: Uint8Array;
  popY: Float32Array;
  popV: Float32Array;
  sq: Float32Array; // squash spring (xz scale offset)
  sqV: Float32Array;
  colT: Float32Array;
  colV: Float32Array;
  lush: Float32Array;
  flash: Float32Array;
  waterS: Float32Array;
  waterV: Float32Array;
  waterT: Float32Array;
  base: Float32Array; // cap baseline offset (ponds sink)
  alive: THREE.Color[];
  lushC: THREE.Color[];
  dryC: THREE.Color[];
  tileDecor: DecorRef[][] = [];
  hasTree: Uint8Array;
  active = new Set<number>();
  pendingHops: { i: number; t: number; v: number; flash: number }[] = [];
  rise = new Spring(-5, 12, 5.5);
  unlocked = false;
  regionDone: boolean[];
  complete = false;
  wet: Float32Array; // recent rain (for sheen)
  dryAttr: THREE.InstancedBufferAttribute;
  links!: THREE.InstancedMesh;
  private linkGeo: { ax: number; ay: number; az: number; bx: number; by: number; bz: number }[] = [];
  private linkIds = new Map<string, number>();
  private linkS = new Float32Array(0);
  private linkV = new Float32Array(0);
  private linkT = new Float32Array(0);
  private linksAnimating = false;
  private rng: RNG;
  private time = 0;

  constructor(public data: IslandData, public decor: DecorSystem, scene: THREE.Scene) {
    const T = data.tiles;
    this.n = T.length;
    this.rng = new RNG(data.def.seed * 31 + 7);
    if (!sharedGeo) sharedGeo = buildTileGeometries();
    const capMat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, flatShading: true });
    patchCap(capMat);
    const colMat = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true });
    const waterMat = new THREE.MeshStandardMaterial({
      color: PAL.water, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.88,
    });
    patchWater(waterMat);
    const capGeo = sharedGeo.cap.clone();
    this.dryAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.n).fill(1), 1);
    this.dryAttr.setUsage(THREE.DynamicDrawUsage);
    capGeo.setAttribute('aDry', this.dryAttr);
    this.caps = new THREE.InstancedMesh(capGeo, capMat, this.n);
    this.cols = new THREE.InstancedMesh(sharedGeo.col, colMat, this.n);
    this.water = new THREE.InstancedMesh(sharedGeo.water, waterMat, this.n);
    this.caps.castShadow = this.caps.receiveShadow = true;
    this.cols.castShadow = this.cols.receiveShadow = true;
    this.water.receiveShadow = true;
    for (const m of [this.caps, this.cols, this.water]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.water.renderOrder = 2;
    this.group.position.set(data.def.cx, this.rise.value, data.def.cz);
    scene.add(this.group);

    const f = () => new Float32Array(this.n);
    this.moist = f(); this.popY = f(); this.popV = f(); this.sq = f(); this.sqV = f();
    this.colT = f(); this.colV = f(); this.lush = f(); this.flash = f();
    this.waterS = f(); this.waterV = f(); this.waterT = f(); this.base = f(); this.wet = f();
    this.stage = new Uint8Array(this.n);
    this.hasTree = new Uint8Array(this.n);
    this.regionDone = data.regions.map(() => false);

    this.alive = [];
    this.lushC = [];
    this.dryC = [];
    for (const t of T) {
      const j = t.jitter;
      const r = new RNG(t.i * 977 + data.def.seed);
      const baseKey = t.pond ? 'marsh' : t.biome;
      const a = (PAL as any)[t.biome === 'beach' ? 'sand' : baseKey].clone() as THREE.Color;
      const l = (PAL as any)[t.biome === 'beach' ? 'sand' : baseKey + 'Lush'].clone() as THREE.Color;
      a.offsetHSL(r.soft() * 0.025, r.soft() * 0.06, r.soft() * 0.035);
      l.offsetHSL(r.soft() * 0.02, r.soft() * 0.05, r.soft() * 0.03);
      if (t.biome === 'beach') l.offsetHSL(0, 0.02, 0.02);
      this.alive.push(a);
      this.lushC.push(l);
      const d = PAL.dry.clone().offsetHSL(0, r.soft() * 0.02, (j - 0.5) * 0.06);
      this.dryC.push(d);
      this.tileDecor.push([]);
    }
    // initial matrices/colours
    for (let i = 0; i < this.n; i++) {
      this.writeTile(i);
      const t = T[i];
      const soil = (t.biome === 'beach' ? PAL.sand.clone().multiplyScalar(0.86) : PAL.soil.clone())
        .offsetHSL(0, 0, (t.jitter - 0.5) * 0.06);
      this.cols.setColorAt(i, soil);
      this.waterT[i] = 0;
    }
    this.cols.instanceColor!.needsUpdate = true;
    this.caps.instanceColor!.needsUpdate = true;
    this.buildLinks();
  }

  get tiles(): TileData[] {
    return this.data.tiles;
  }

  get cx() {
    return this.data.def.cx;
  }
  get cz() {
    return this.data.def.cz;
  }

  /** World-space top of a tile (including spring offset). */
  topY(i: number) {
    return this.group.position.y + this.tiles[i].h + this.popY[i] + this.base[i];
  }

  worldPos(i: number, out = new THREE.Vector3()) {
    const t = this.tiles[i];
    return out.set(t.x + this.cx, this.topY(i), t.z + this.cz);
  }

  tileAt(wx: number, wz: number): number {
    const [q, r] = worldToHex(wx - this.cx, wz - this.cz);
    const i = this.data.byKey.get(key(q, r));
    return i === undefined ? -1 : i;
  }

  /** Bounding radius in world units. */
  get radius() {
    return this.data.def.radius * 1.9;
  }

  regionProgress(r: number) {
    const tl = this.data.regions[r].tiles;
    let a = 0;
    for (const i of tl) if (this.stage[i] > 0) a++;
    return a / tl.length;
  }

  progress() {
    let a = 0;
    for (let i = 0; i < this.n; i++) if (this.stage[i] > 0) a++;
    return a / this.n;
  }

  lushness() {
    let a = 0;
    for (let i = 0; i < this.n; i++) a += this.stage[i];
    return a / (this.n * 3);
  }

  // ---------------------------------------------------------------- growth
  /** Move a tile to a stage, spawning decor. `quiet` skips spring kick (used on load). */
  setStage(i: number, stage: number, quiet = false) {
    const prev = this.stage[i];
    if (stage <= prev) return;
    const t = this.tiles[i];
    for (let s = prev + 1; s <= stage; s++) this.spawnStageDecor(i, s, quiet);
    this.stage[i] = stage;
    if (prev === 0) {
      this.colV[i] += quiet ? 0 : 0;
      if (quiet) this.colT[i] = 1;
      if (t.pond || t.river >= 0) {
        if (t.pond) this.base[i] = -0.14;
      }
      if (t.pond) this.waterT[i] = 1;
    }
    if (quiet) {
      this.lush[i] = this.lushTarget(i);
      if (this.waterT[i] > 0) this.waterS[i] = this.waterT[i];
      this.writeTile(i);
      return;
    }
    // springy kick
    this.popV[i] += prev === 0 ? CFG.tilePopImpulse * (0.85 + Math.random() * 0.3) : CFG.tileStageImpulse;
    this.sqV[i] -= prev === 0 ? 2.2 : 1.1;
    this.flash[i] = prev === 0 ? 1 : 0.5;
    this.active.add(i);
  }

  lushTarget(i: number) {
    return this.stage[i] <= 1 ? 0 : this.stage[i] === 2 ? 0.55 : 1;
  }

  /** Water channel between consecutive river tiles (k → k+1); k = last is the fall into the sea. */
  showLink(ri: number, k: number) {
    const id = this.linkIds.get(`${ri}:${k}`);
    if (id === undefined) return;
    this.linkT[id] = 1;
    this.linksAnimating = true;
  }

  private buildLinks() {
    let n = 0;
    for (const r of this.data.rivers) n += r.path.length;
    const geo = new THREE.BoxGeometry(1, 0.05, 1);
    this.links = new THREE.InstancedMesh(geo, this.water.material as THREE.Material, Math.max(1, n));
    this.links.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.links.frustumCulled = false;
    this.links.receiveShadow = true;
    this.links.renderOrder = 2;
    this.group.add(this.links);
    let id = 0;
    const T = this.tiles;
    this.data.rivers.forEach((rv, ri) => {
      rv.path.forEach((ti, k) => {
        const a = T[ti];
        let bx: number, bz: number, by: number;
        if (k < rv.path.length - 1) {
          const b = T[rv.path[k + 1]];
          bx = b.x; bz = b.z; by = b.h - 0.03 - 0.12;
        } else {
          // fall into the sea, away from the island centre
          const d = Math.hypot(a.x, a.z) || 1;
          bx = a.x + (a.x / d) * 1.6; bz = a.z + (a.z / d) * 1.6; by = -0.05;
        }
        const ay = a.h - 0.03 - 0.12;
        this.linkGeo.push({ ax: a.x, ay, az: a.z, bx, by, bz });
        this.linkIds.set(`${ri}:${k}`, id++);
      });
    });
    this.linkS = new Float32Array(id);
    this.linkV = new Float32Array(id);
    this.linkT = new Float32Array(id);
    for (let i = 0; i < id; i++) this.writeLink(i);
    this.links.count = id;
  }

  private writeLink(i: number) {
    const L = this.linkGeo[i];
    const s = Math.max(0.0001, this.linkS[i]);
    const dx = L.bx - L.ax, dz = L.bz - L.az, dy = L.by - L.ay;
    const len = Math.hypot(dx, dz);
    const mid = new THREE.Vector3((L.ax + L.bx) / 2, (L.ay + L.by) / 2 + 0.005, (L.az + L.bz) / 2);
    const yaw = Math.atan2(dx, dz);
    const pitch = -Math.atan2(dy, len);
    _q.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    _s.set(0.62 * s, 1, Math.hypot(len, dy) * (0.35 + 0.65 * s));
    _m.compose(mid, _q, _s);
    this.links.setMatrixAt(i, _m);
  }

  makeRiver(i: number) {
    this.waterT[i] = 1;
    this.base[i] = -0.12;
    this.active.add(i);
  }

  private slots(i: number) {
    // 7 candidate positions within the hex, shuffled per tile
    const r = new RNG(i * 131 + this.data.def.seed * 17 + this.tileDecor[i].length * 7);
    const out: [number, number][] = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.PI / 6 + r.soft() * 0.3;
      const d = 0.48 + r.soft() * 0.12;
      out.push([Math.cos(a) * d, Math.sin(a) * d]);
    }
    out.sort(() => r.next() - 0.5);
    return out;
  }

  private addDecor(i: number, kind: DecorKind, lx: number, lz: number, opts: { scale?: number; tint?: THREE.Color; delay?: number; instant?: boolean; stretch?: number } = {}) {
    const t = this.tiles[i];
    const y = REST_Y + t.h + this.base[i];
    const ref = this.decor.add(kind, t.x + this.cx + lx, y, t.z + this.cz + lz, {
      scale: (opts.scale ?? 1) * DECOR_SCALE,
      tint: opts.tint,
      delay: opts.instant ? 0 : opts.delay,
      instant: opts.instant,
      stretch: opts.stretch,
    });
    if (ref) this.tileDecor[i].push(ref);
    return ref;
  }

  private grassTint(i: number, lift = 0) {
    const c = this.alive[i].clone();
    const t = this.tiles[i];
    if (t.biome === 'beach') c.set('#c7cf8e');
    c.offsetHSL(0.01 + Math.random() * 0.02, 0.05, -0.08 + lift + Math.random() * 0.05);
    return c;
  }

  spawnStageDecor(i: number, stage: number, instant: boolean) {
    const t = this.tiles[i];
    const r = this.rng;
    const st = CFG.decorStagger;
    let d = instant ? 0 : 0.03;
    const next = () => (d += st * (0.7 + r.next() * 0.6));
    const rnd = () => (r.next() - 0.5) * 1.2;
    const S = this.slots(i);
    const slot = () => S.pop() ?? [rnd() * 0.8, rnd() * 0.8];
    const o = (extra: object = {}) => ({ instant, delay: next(), ...extra });
    const special = t.landmark !== null || t.wonder !== null;

    if (t.pond) {
      if (stage === 1) {
        for (let k = 0; k < 2; k++) {
          const [x, z] = slot();
          this.addDecor(i, 'lilypad', x * 0.7, z * 0.7 + 0.0, o({ tint: new THREE.Color('#8fc27a').offsetHSL(0, 0, rnd() * 0.08), scale: 0.8 + r.next() * 0.5 }));
        }
        this.decorYOffset(i, 0.02);
      } else if (stage === 2) {
        const [x, z] = slot();
        this.addDecor(i, 'lilypad', x * 0.7, z * 0.7, o({ tint: new THREE.Color('#9acb7e'), scale: 0.9 }));
        this.decorYOffset(i, 0.02);
        if (r.chance(0.5)) {
          const [x2, z2] = slot();
          this.addDecor(i, 'flower', x2 * 0.6, z2 * 0.6, o({ tint: new THREE.Color(pick(['#ffffff', '#f6b8c8'])), scale: 0.7, stretch: 0.25 }));
          this.decorYOffset(i, 0.02);
        }
      }
      return;
    }
    if (t.river >= 0 && !t.spring) {
      if (stage === 1) {
        const [x, z] = slot();
        this.addDecor(i, 'reeds', x * 1.05, z * 1.05, o({ tint: this.grassTint(i), scale: 0.8 }));
      }
      return;
    }
    const b = t.biome;
    if (stage === 1) {
      if (b === 'beach') {
        const n = 1 + (r.next() < 0.6 ? 1 : 0);
        for (let k = 0; k < n; k++) {
          const [x, z] = slot();
          this.addDecor(i, 'beachgrass', x, z, o({ tint: new THREE.Color('#c9cf8a').offsetHSL(0, 0, rnd() * 0.08), scale: 0.8 + r.next() * 0.4 }));
        }
        if (r.chance(0.35)) {
          const [x, z] = slot();
          this.addDecor(i, 'shell', x, z, o({ tint: new THREE.Color(pick(['#f7d9cf', '#fdf1e6', '#f1c7b6'])) }));
        }
        return;
      }
      const n = b === 'meadow' || b === 'blossom' ? 4 : 3;
      for (let k = 0; k < n; k++) {
        const [x, z] = slot();
        this.addDecor(i, 'grass', x, z, o({ tint: this.grassTint(i), scale: 0.8 + r.next() * 0.6 }));
      }
      if (b === 'forest') {
        const [x, z] = slot();
        this.addDecor(i, 'fern', x, z, o({ tint: this.grassTint(i, -0.03), scale: 0.8 + r.next() * 0.4 }));
      } else if (b === 'marsh') {
        const [x, z] = slot();
        this.addDecor(i, 'reeds', x, z, o({ tint: this.grassTint(i), scale: 0.9 }));
      } else if (b === 'highland' && r.chance(0.6)) {
        const [x, z] = slot();
        this.addDecor(i, 'rock', x, z, o({ tint: new THREE.Color('#c9c4bb').offsetHSL(0, 0, rnd() * 0.06), scale: 0.7 + r.next() * 0.6 }));
      }
      return;
    }
    if (stage === 2) {
      if (b === 'beach') {
        const [x, z] = slot();
        this.addDecor(i, r.chance(0.5) ? 'shell' : 'beachgrass', x, z, o({ tint: new THREE.Color('#f3dccb') }));
        return;
      }
      if (b === 'meadow' || b === 'blossom') {
        const n = 2 + Math.floor(r.next() * 3);
        const hue = pick(FLOWER_COLORS);
        for (let k = 0; k < n; k++) {
          const [x, z] = slot();
          const kind: DecorKind = r.chance(0.25) ? 'tulip' : 'flower';
          const c = new THREE.Color(r.chance(0.7) ? hue : pick(FLOWER_COLORS));
          this.addDecor(i, kind, x, z, o({ tint: c, scale: 0.75 + r.next() * 0.5 }));
        }
        if (r.chance(0.25) && !special) {
          const [x, z] = slot();
          this.addDecor(i, 'bush', x, z, o({ tint: this.grassTint(i, -0.02), scale: 0.8 + r.next() * 0.5 }));
        }
      } else if (b === 'forest') {
        const [x, z] = slot();
        const cap = new THREE.Color(pick(['#e07a5f', '#f2cc8f', '#d8a47f', '#e9c46a']));
        for (let k = 0; k < 1 + Math.floor(r.next() * 3); k++) {
          this.addDecor(i, 'mushroom', x + rnd() * 0.15, z + rnd() * 0.15, o({ tint: cap, scale: 0.7 + r.next() * 0.7 }));
        }
        const [x2, z2] = slot();
        this.addDecor(i, r.chance(0.6) ? 'bush' : 'fern', x2, z2, o({ tint: this.grassTint(i, -0.04), scale: 0.8 + r.next() * 0.4 }));
      } else if (b === 'marsh') {
        for (let k = 0; k < 2; k++) {
          const [x, z] = slot();
          this.addDecor(i, 'cattail', x, z, o({ scale: 0.8 + r.next() * 0.4 }));
        }
        const [x, z] = slot();
        this.addDecor(i, 'flower', x, z, o({ tint: new THREE.Color(pick(['#c9b6f0', '#a8d8f0', '#ffffff'])), scale: 0.8 }));
      } else if (b === 'highland') {
        for (let k = 0; k < 3; k++) {
          const [x, z] = slot();
          this.addDecor(i, 'flower', x, z, o({ tint: new THREE.Color(pick(['#ffffff', '#c9b6f0', '#fbe39a'])), scale: 0.55 + r.next() * 0.25 }));
        }
      }
      return;
    }
    if (stage === 3) {
      if (special) {
        const [x, z] = slot();
        this.addDecor(i, 'flower', x, z, o({ tint: new THREE.Color(pick(FLOWER_COLORS)) }));
        return;
      }
      const tree = this.pickTree(i);
      if (tree) this.plantTree(i, tree, instant);
      else {
        const [x, z] = slot();
        this.addDecor(i, 'bush', x, z, o({ tint: this.grassTint(i), scale: 1 + r.next() * 0.4 }));
      }
    }
  }

  pickTree(i: number): DecorKind | null {
    const b = this.tiles[i].biome;
    const r = this.rng;
    if (b === 'forest') return r.chance(0.55) ? 'pine' : r.chance(0.6) ? 'roundtree' : 'birch';
    if (b === 'blossom') return 'blossomtree';
    if (b === 'highland') return r.chance(0.55) ? 'pine' : null;
    if (b === 'meadow') return r.chance(0.4) ? (r.chance(0.6) ? 'roundtree' : 'birch') : null;
    if (b === 'marsh') return r.chance(0.3) ? 'birch' : null;
    return null;
  }

  treeTint(kind: DecorKind) {
    const r = this.rng;
    if (kind === 'willow') return new THREE.Color(pick(['#a9cf7a', '#b6d68a', '#9cc77a'])).offsetHSL(0, 0, r.soft() * 0.03);
    if (kind === 'blossomtree') return new THREE.Color(pick(BLOSSOM_COLORS)).offsetHSL(0, 0, r.soft() * 0.03);
    if (kind === 'pine') return new THREE.Color('#5f9a63').offsetHSL(r.soft() * 0.02, 0, r.soft() * 0.05);
    if (kind === 'birch') return new THREE.Color(pick(['#a9cf6e', '#c4d675', '#e9c46a'])).offsetHSL(0, 0, r.soft() * 0.03);
    return new THREE.Color(pick(['#7fb069', '#8cbf6a', '#6aa36b', '#9cc46e'])).offsetHSL(r.soft() * 0.02, 0, r.soft() * 0.04);
  }

  /** Plant a tree on the tile. Returns false if one exists. */
  plantTree(i: number, kind: DecorKind, instant = false, scaleMul = 1) {
    if (this.hasTree[i] >= 2) return false;
    const t = this.tiles[i];
    if (t.pond || t.river >= 0 || t.landmark) return false;
    const r = this.rng;
    const first = this.hasTree[i] === 0;
    const lx = first ? r.soft() * 0.15 : (r.next() - 0.5) * 0.9;
    const lz = first ? r.soft() * 0.15 : (r.next() - 0.5) * 0.9;
    this.addDecor(i, kind, lx, lz, {
      tint: this.treeTint(kind),
      scale: (0.95 + r.next() * 0.5) * scaleMul * (first ? 1 : 0.75),
      delay: instant ? 0 : 0.05,
      instant,
    });
    this.hasTree[i]++;
    return true;
  }

  /** Add one decor piece somewhere on a tile (kinships use this). `ring` keeps it near the edge. */
  sprout(i: number, kind: DecorKind, o: { tint?: THREE.Color; scale?: number; delay?: number; instant?: boolean; ring?: number; at?: [number, number] } = {}) {
    const r = this.rng;
    let lx: number, lz: number;
    if (o.at) [lx, lz] = o.at;
    else {
      const a = r.next() * Math.PI * 2;
      const d = (o.ring ?? 0.5) + r.soft() * 0.1;
      lx = Math.cos(a) * d;
      lz = Math.sin(a) * d;
    }
    const ref = this.addDecor(i, kind, lx, lz, { tint: o.tint, scale: o.scale, delay: o.delay, instant: o.instant });
    if (ref && (kind === 'lilypad' || this.tiles[i].pond)) this.decorYOffset(i, 0.02);
    return ref;
  }

  /** Decor kinds currently growing on a tile. */
  has(i: number, kind: DecorKind) {
    return this.tileDecor[i].some((r) => r.kind === kind);
  }

  private decorYOffset(i: number, dy: number) {
    // lily pads float on the water surface, slightly above the sunk cap
    const list = this.tileDecor[i];
    for (const ref of list) {
      if (ref.kind === 'lilypad' || ref.kind === 'flower') {
        const P = this.decor.pools[ref.kind];
        P.py[ref.id] = REST_Y + this.tiles[i].h - 0.035 + dy;
      }
    }
  }

  /** Queue a hop on a tile after `delay` seconds (used by ripples). */
  hop(i: number, delay: number, v: number, flash = 0.4) {
    this.pendingHops.push({ i, t: this.time + delay, v, flash });
  }

  // ---------------------------------------------------------------- render
  private writeTile(i: number) {
    const t = this.tiles[i];
    // anticipation: a nearly-soaked tile trembles just before it pops
    const m0 = this.moist[i];
    const quiver = this.stage[i] === 0 && m0 > 0.72 && this.wet[i] > 0.05
      ? Math.sin(this.time * 46 + i * 1.7) * 0.012 * ((m0 - 0.72) / 0.28) : 0;
    const top = t.h + this.popY[i] + this.base[i] + quiver;
    const sxz = 0.985 * (1 + this.sq[i]) + Math.abs(quiver) * 0.6;
    // cap
    _p.set(t.x, top, t.z);
    _s.set(sxz, 1 - this.sq[i] * 1.5, sxz);
    _m.compose(_p, _q.identity(), _s);
    this.caps.setMatrixAt(i, _m);
    // column (from deep base to under the cap)
    const colTop = top - 0.18;
    _p.set(t.x, COL_BASE, t.z);
    _s.set(0.985, Math.max(0.01, colTop - COL_BASE), 0.985);
    _m.compose(_p, _q, _s);
    this.cols.setMatrixAt(i, _m);
    // water disc
    const ws = Math.max(0.0001, this.waterS[i]);
    _p.set(t.x, t.h - 0.03 + (ws - 1) * 0.12, t.z);
    _s.set(ws * 1.02, 1, ws * 1.02);
    _m.compose(_p, _q, _s);
    this.water.setMatrixAt(i, _m);
    // colour
    const m = Math.min(1, this.moist[i]);
    _c.copy(this.dryC[i]).lerp(PAL.dryWet, m * 0.75 * (1 - this.colT[i]));
    _c2.copy(this.alive[i]).lerp(this.lushC[i], this.lush[i]);
    if (t.pond && this.stage[i] > 0) _c2.lerp(PAL.soilDark, 0.4);
    // wet sheen darkens living tiles a touch while raining on them
    _c2.multiplyScalar(1 - this.wet[i] * 0.12);
    _c.lerp(_c2, clamp(this.colT[i], 0, 1.1));
    if (this.flash[i] > 0) _c.lerp(BLOOM_FLASH, this.flash[i] * 0.55);
    this.caps.setColorAt(i, _c);
    this.dryAttr.setX(i, clamp(1 - this.colT[i]) * (1 - m * 0.5));
  }

  update(dt: number) {
    this.time += dt;
    this.rise.update(dt);
    const gy = this.rise.value;
    if (Math.abs(this.group.position.y - gy) > 1e-4) {
      this.group.position.y = gy;
    }
    // pending hops
    if (this.pendingHops.length) {
      const keep: typeof this.pendingHops = [];
      for (const h of this.pendingHops) {
        if (h.t <= this.time) {
          this.popV[h.i] += h.v;
          this.sqV[h.i] -= h.v * 0.5;
          this.flash[h.i] = Math.max(this.flash[h.i], h.flash);
          this.active.add(h.i);
          for (const ref of this.tileDecor[h.i]) this.decor.kick(ref, h.v * 2);
        } else keep.push(h);
      }
      this.pendingHops = keep;
    }
    if (this.linksAnimating) {
      let moving = false;
      for (let i = 0; i < this.linkS.length; i++) {
        if (this.linkT[i] === 0 && this.linkS[i] === 0) continue;
        const [s2, v2] = springStepLocal(this.linkS[i], this.linkV[i], this.linkT[i], 70, 8, dt);
        this.linkS[i] = s2;
        this.linkV[i] = v2;
        if (Math.abs(v2) > 0.001 || Math.abs(s2 - this.linkT[i]) > 0.001) moving = true;
        this.writeLink(i);
      }
      this.links.instanceMatrix.needsUpdate = true;
      this.linksAnimating = moving;
    }
    const k = CFG.tileK, c = CFG.tileC;
    const ck = CFG.colorK, cc = CFG.colorC;
    let any = false;
    for (const i of this.active) {
      any = true;
      // pop (y offset) spring toward 0
      let y = this.popY[i], v = this.popV[i];
      let s = this.sq[i], sv = this.sqV[i];
      let ct = this.colT[i], cv = this.colV[i];
      let ws = this.waterS[i], wv = this.waterV[i];
      const ctTarget = this.stage[i] > 0 ? 1 : 0;
      const steps = Math.max(1, Math.ceil(dt * 240));
      const h = dt / steps;
      for (let n = 0; n < steps; n++) {
        v += (-y * k - v * c) * h;
        y += v * h;
        sv += (-s * k * 0.8 - sv * c * 0.9) * h;
        s += sv * h;
        cv += ((ctTarget - ct) * ck - cv * cc) * h;
        ct += cv * h;
        wv += ((this.waterT[i] - ws) * 90 - wv * 9) * h;
        ws += wv * h;
      }
      this.popY[i] = y; this.popV[i] = v;
      this.sq[i] = s; this.sqV[i] = sv;
      this.colT[i] = ct; this.colV[i] = cv;
      this.waterS[i] = ws; this.waterV[i] = wv;
      this.lush[i] += (this.lushTarget(i) - this.lush[i]) * Math.min(1, dt * 3);
      this.flash[i] = Math.max(0, this.flash[i] - dt * 2.4);
      this.wet[i] = Math.max(0, this.wet[i] - dt * 0.6);
      // decor follows the cap
      const dy = y + this.base[i];
      for (const ref of this.tileDecor[i]) {
        if (ref.kind === 'lilypad') continue;
        this.decor.setOffset(ref, dy - (this.base[i]));
      }
      this.writeTile(i);
      const settled =
        Math.abs(v) < 0.002 && Math.abs(y) < 0.001 && Math.abs(sv) < 0.002 && Math.abs(s) < 0.001 &&
        Math.abs(ct - ctTarget) < 0.002 && Math.abs(cv) < 0.002 && this.flash[i] <= 0 &&
        Math.abs(ws - this.waterT[i]) < 0.002 && Math.abs(wv) < 0.002 &&
        Math.abs(this.lush[i] - this.lushTarget(i)) < 0.003 && this.wet[i] <= 0;
      if (settled) {
        this.popY[i] = 0;
        this.sq[i] = 0;
        this.colT[i] = ctTarget;
        this.lush[i] = this.lushTarget(i);
        this.writeTile(i);
        this.active.delete(i);
      }
    }
    if (any) {
      this.caps.instanceMatrix.needsUpdate = true;
      this.cols.instanceMatrix.needsUpdate = true;
      this.water.instanceMatrix.needsUpdate = true;
      this.caps.instanceColor!.needsUpdate = true;
      this.dryAttr.needsUpdate = true;
    }
  }

  /** Mark a tile as touched by moisture (for colour + sheen updates). */
  touch(i: number) {
    this.wet[i] = Math.min(1, this.wet[i] + 0.1);
    this.active.add(i);
  }
}

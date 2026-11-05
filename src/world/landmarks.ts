// Little buildings that assemble themselves, piece by piece, when a grove completes.
import * as THREE from 'three';
import { Spring, rand, randSoft } from '../core/math';
import { U } from '../core/shaders';
import { SHAPE } from '../fx/particles';
import type { Game } from '../game/game';
import type { LandmarkKind } from './gen';

interface Part {
  obj: THREE.Object3D;
  s: Spring;
  delay: number;
  base: THREE.Vector3;
  popped: boolean;
}

interface Built {
  group: THREE.Group;
  parts: Part[];
  spinners: { obj: THREE.Object3D; axis: 'x' | 'y' | 'z'; speed: number }[];
  smoke: THREE.Vector3[];
  bobbers: { obj: THREE.Object3D; phase: number; y: number }[];
  beams: THREE.Mesh[];
  ii: number;
  r: number;
  kind: LandmarkKind;
  t: number;
  order: number;
  flourished: boolean;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();
const glowMats: THREE.MeshStandardMaterial[] = [];
function mat(color: string, glow = false) {
  const k = color + (glow ? 'g' : '');
  let m = matCache.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true });
    if (glow) {
      m.emissive = new THREE.Color(color);
      m.emissiveIntensity = 0;
      glowMats.push(m);
    }
    matCache.set(k, m);
  }
  return m;
}

const C = {
  wall: '#f3ebdc', roof: '#d9826b', roof2: '#7f9cc4', wood: '#9a7350', woodDark: '#6e5039', stone: '#c9c3b8',
  stone2: '#aaa49a', window: '#ffd98a', red: '#e07a6b', white: '#fbf8f1', moss: '#8fb36e', lamp: '#ffe6a3', teal: '#6fb3a8',
};

type PartOpts = { rot?: [number, number, number]; scale?: [number, number, number]; glow?: boolean; parent?: THREE.Object3D; noPop?: boolean };

const box = (w: number, h: number, d: number) => {
  const gg = new THREE.BoxGeometry(w, h, d);
  gg.translate(0, h / 2, 0);
  return gg;
};
const cyl = (rt: number, rb: number, h: number, s = 8) => {
  const gg = new THREE.CylinderGeometry(rt, rb, h, s);
  gg.translate(0, h / 2, 0);
  return gg;
};
const cone = (r0: number, h: number, s = 8) => {
  const gg = new THREE.ConeGeometry(r0, h, s);
  gg.translate(0, h / 2, 0);
  return gg;
};
const prism = (w: number, h: number, d: number) => {
  const gg = new THREE.CylinderGeometry(0.5, 0.5, 1, 3);
  gg.rotateZ(Math.PI / 2);
  gg.rotateY(Math.PI / 2);
  gg.scale(d, h * 1.3, w);
  gg.translate(0, h * 0.32, 0);
  return gg;
};

export class Landmarks {
  built: Built[] = [];
  private beamMat: THREE.MeshBasicMaterial;
  constructor(private g: Game) {
    this.beamMat = new THREE.MeshBasicMaterial({ color: '#fff3c4', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  }

  build(ii: number, r: number, instant: boolean) {
    const g = this.g;
    const isl = g.islands[ii];
    const reg = isl.data.regions[r];
    const ti = reg.landmarkTile;
    const t = isl.tiles[ti];
    // clear small decor on the plot
    for (const ref of isl.tileDecor[ti]) g.decor.remove(ref);
    isl.tileDecor[ti] = [];

    const group = new THREE.Group();
    group.position.set(t.x + isl.cx, t.h, t.z + isl.cz);
    // face away from island centre (toward the view of the sea)
    const out = Math.atan2(t.x, t.z);
    group.rotation.y = out + randSoft() * 0.3;
    group.scale.setScalar(1.55);
    g.scene.add(group);
    const b: Built = { group, parts: [], spinners: [], smoke: [], bobbers: [], beams: [], ii, r, kind: reg.landmark, t: 0, order: 0, flourished: false };
    const add = (geo: THREE.BufferGeometry, color: string, pos: [number, number, number], o: PartOpts = {}) => this.part(b, instant, geo, color, pos, o);
    switch (reg.landmark) {
      case 'cottage': {
        add(box(0.78, 0.42, 0.58), C.wall, [0, 0, 0]);
        add(box(0.12, 0.2, 0.02), C.woodDark, [0.12, 0, 0.3]);
        add(box(0.12, 0.1, 0.02), C.window, [-0.2, 0.18, 0.3], { glow: true });
        add(box(0.02, 0.1, 0.12), C.window, [0.4, 0.18, 0], { glow: true });
        add(prism(0.62, 0.32, 0.9), pick2(C.roof, C.roof2, t.i), [0, 0.42, 0]);
        add(box(0.1, 0.24, 0.1), C.stone2, [-0.22, 0.55, -0.1]);
        b.smoke.push(new THREE.Vector3(-0.22, 0.85, -0.1));
        add(box(0.3, 0.05, 0.05), C.wood, [0.25, 0, 0.42]);
        break;
      }
      case 'windmill': {
        add(cyl(0.2, 0.3, 0.95, 8), C.wall, [0, 0, 0]);
        add(box(0.12, 0.2, 0.02), C.woodDark, [0, 0, 0.27]);
        add(box(0.08, 0.08, 0.02), C.window, [0, 0.55, 0.22], { glow: true });
        add(cone(0.27, 0.32, 8), C.roof, [0, 0.95, 0]);
        const hub = new THREE.Group();
        hub.position.set(0, 0.95, 0.27);
        group.add(hub);
        add(cyl(0.04, 0.04, 0.08, 6), C.wood, [0, 0, 0], { parent: hub, rot: [Math.PI / 2, 0, 0] });
        for (let k = 0; k < 4; k++) {
          const arm = new THREE.Group();
          arm.rotation.z = (k * Math.PI) / 2;
          hub.add(arm);
          add(box(0.04, 0.62, 0.02), C.wood, [0, 0.04, 0.04], { parent: arm });
          add(box(0.14, 0.42, 0.01), C.white, [0.08, 0.2, 0.05], { parent: arm });
        }
        b.spinners.push({ obj: hub, axis: 'z', speed: 0.9 });
        break;
      }
      case 'shrine': {
        add(box(0.5, 0.08, 0.5), C.stone2, [0, 0, 0]);
        add(cyl(0.06, 0.08, 0.32, 6), C.stone, [0, 0.08, 0]);
        add(box(0.24, 0.05, 0.24), C.stone, [0, 0.38, 0]);
        add(box(0.16, 0.16, 0.16), C.lamp, [0, 0.43, 0], { glow: true });
        add(cone(0.22, 0.14, 4), C.stone2, [0, 0.59, 0], { rot: [0, Math.PI / 4, 0] });
        add(cyl(0.02, 0.03, 0.06, 5), C.stone, [0, 0.73, 0]);
        add(box(0.06, 0.5, 0.06), C.red, [-0.3, 0, -0.18]);
        add(box(0.06, 0.5, 0.06), C.red, [0.3, 0, -0.18]);
        add(box(0.78, 0.06, 0.08), C.red, [0, 0.5, -0.18]);
        break;
      }
      case 'stones': {
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          const hh = rand(0.35, 0.55);
          add(box(0.12, hh, 0.16), C.stone, [Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5], { rot: [randSoft() * 0.1, -a, randSoft() * 0.08] });
        }
        add(box(0.42, 0.08, 0.28), C.stone2, [0, 0, 0]);
        add(cyl(0.05, 0.08, 0.05, 6), C.moss, [0.1, 0.08, 0.02]);
        add(new THREE.OctahedronGeometry(0.08, 0), '#bfe6ff', [0, 0.32, 0], { glow: true });
        break;
      }
      case 'greattree': {
        add(cyl(0.1, 0.18, 0.7, 7), C.wood, [0, 0, 0]);
        add(cyl(0.04, 0.06, 0.38, 5), C.wood, [0.12, 0.45, 0], { rot: [0, 0, -0.9] });
        const can = ['#7fb069', '#8cbf6a', '#6aa36b'];
        add(new THREE.IcosahedronGeometry(0.55, 1), can[0], [0, 1.05, 0]);
        add(new THREE.IcosahedronGeometry(0.38, 1), can[1], [0.42, 0.85, 0.12]);
        add(new THREE.IcosahedronGeometry(0.36, 1), can[2], [-0.38, 0.95, -0.1]);
        add(new THREE.IcosahedronGeometry(0.3, 1), can[1], [0.05, 1.45, 0.1]);
        // a little swing
        add(box(0.01, 0.4, 0.01), C.woodDark, [0.4, 0.25, 0.08]);
        add(box(0.01, 0.4, 0.01), C.woodDark, [0.58, 0.25, 0.08]);
        add(box(0.24, 0.03, 0.08), C.wood, [0.49, 0.24, 0.08]);
        break;
      }
      case 'well': {
        add(cyl(0.26, 0.28, 0.26, 10), C.stone, [0, 0, 0]);
        add(cyl(0.2, 0.2, 0.02, 10), '#6fb3c8', [0, 0.25, 0]);
        add(box(0.05, 0.55, 0.05), C.wood, [-0.25, 0.1, 0]);
        add(box(0.05, 0.55, 0.05), C.wood, [0.25, 0.1, 0]);
        add(prism(0.62, 0.18, 0.4), C.roof, [0, 0.63, 0]);
        add(cyl(0.05, 0.04, 0.07, 6), C.wood, [0.06, 0.38, 0]);
        break;
      }
      case 'lighthouse': {
        const H = [0, 0.25, 0.5, 0.75];
        add(cyl(0.34, 0.38, 0.12, 10), C.stone2, [0, 0, 0]);
        H.forEach((y, k) => add(cyl(0.2 - y * 0.06, 0.22 - y * 0.06, 0.25, 10), k % 2 ? C.red : C.white, [0, 0.12 + y, 0]));
        add(cyl(0.18, 0.18, 0.05, 10), C.woodDark, [0, 1.12, 0]);
        add(cyl(0.12, 0.12, 0.18, 8), C.lamp, [0, 1.17, 0], { glow: true });
        add(cone(0.17, 0.18, 10), C.red, [0, 1.35, 0]);
        const beamG = new THREE.ConeGeometry(0.6, 5, 16, 1, true);
        beamG.translate(0, -2.5, 0);
        beamG.rotateZ(Math.PI / 2);
        const beam = new THREE.Mesh(beamG, this.beamMat);
        const pivot = new THREE.Group();
        pivot.position.set(0, 1.26, 0);
        pivot.add(beam);
        group.add(pivot);
        b.beams.push(beam);
        b.spinners.push({ obj: pivot, axis: 'y', speed: 0.6 });
        break;
      }
      case 'pier': {
        for (let k = 0; k < 4; k++) {
          add(box(0.42, 0.04, 0.2), C.wood, [0, 0.04, 0.2 + k * 0.22]);
          add(cyl(0.025, 0.025, 0.5, 5), C.woodDark, [0.2, -0.42, 0.2 + k * 0.22]);
          add(cyl(0.025, 0.025, 0.5, 5), C.woodDark, [-0.2, -0.42, 0.2 + k * 0.22]);
        }
        const boat = new THREE.Group();
        boat.position.set(0.48, (-t.h + 0.03) / 1.55, 0.85);
        group.add(boat);
        add(box(0.22, 0.09, 0.56), C.teal, [0, 0, 0], { parent: boat });
        add(box(0.16, 0.02, 0.44), C.wood, [0, 0.08, 0], { parent: boat });
        add(box(0.01, 0.44, 0.01), C.woodDark, [0, 0.08, 0], { parent: boat });
        add(new THREE.ConeGeometry(0.16, 0.34, 3).translate(0, 0.17, 0), C.white, [0, 0.12, 0.04], { parent: boat, scale: [0.3, 1, 1] });
        b.bobbers.push({ obj: boat, phase: Math.random() * 6, y: boat.position.y });
        add(box(0.08, 0.08, 0.08), C.lamp, [0.2, 0.05, 0.86], { glow: true });
        break;
      }
      case 'pagoda': {
        add(box(0.5, 0.08, 0.5), C.stone2, [0, 0, 0]);
        let y = 0.08;
        for (let k = 0; k < 3; k++) {
          const s = 0.42 - k * 0.1;
          add(box(s, 0.2, s), C.wall, [0, y, 0]);
          add(box(0.06, 0.08, 0.01), C.window, [0, y + 0.06, s / 2], { glow: true });
          add(cone(s * 0.95, 0.16, 4), k % 2 ? C.roof : C.red, [0, y + 0.2, 0], { rot: [0, Math.PI / 4, 0] });
          y += 0.32;
        }
        add(cyl(0.015, 0.02, 0.25, 4), C.woodDark, [0, y - 0.1, 0]);
        break;
      }
      case 'barn': {
        add(box(0.8, 0.4, 0.56), '#c8563f', [0, 0, 0]);
        add(prism(0.6, 0.36, 0.86), '#7a4a3a', [0, 0.4, 0]);
        add(box(0.28, 0.3, 0.02), C.white, [0, 0, 0.29]);
        add(box(0.24, 0.26, 0.025), '#a8443a', [0, 0.02, 0.295]);
        add(box(0.03, 0.34, 0.03), C.white, [0, 0.0, 0.31], { rot: [0, 0, 0.72] });
        add(box(0.12, 0.1, 0.02), C.window, [0, 0.48, 0.29], { glow: true });
        add(cyl(0.11, 0.12, 0.55, 9), '#d9d2c4', [0.52, 0, -0.08]);
        add(cone(0.13, 0.14, 9), '#7a4a3a', [0.52, 0.55, -0.08]);
        break;
      }
      case 'haystack': {
        for (const [x, z, sc] of [[0, 0, 1], [0.34, 0.18, 0.75], [-0.3, 0.22, 0.65]] as const) {
          add(cyl(0.2 * sc, 0.24 * sc, 0.28 * sc, 9), '#e9c46a', [x, 0, z]);
          add(cone(0.22 * sc, 0.26 * sc, 9), '#f2d27a', [x, 0.28 * sc, z]);
        }
        add(box(0.04, 0.5, 0.04), C.woodDark, [-0.1, 0, -0.36]);
        add(box(0.24, 0.03, 0.03), C.woodDark, [-0.1, 0.38, -0.36]);
        add(new THREE.IcosahedronGeometry(0.07, 0), '#e9c46a', [-0.1, 0.46, -0.36]);
        add(box(0.1, 0.18, 0.06), '#7f9cc4', [-0.1, 0.22, -0.36]);
        break;
      }
      case 'igloo': {
        add(new THREE.SphereGeometry(0.38, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#f6fafc', [0, 0, 0]);
        add(new THREE.CylinderGeometry(0.15, 0.17, 0.26, 10, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(0, 0, 0.0), '#eef4f8', [0, 0, 0.42], { rot: [0, Math.PI / 2, 0] });
        add(box(0.16, 0.16, 0.02), C.window, [0, 0, 0.55], { glow: true });
        for (let k = 0; k < 3; k++) add(new THREE.TorusGeometry(0.38 - k * 0.1 - 0.05, 0.006, 3, 18), '#d7e4ec', [0, 0.1 + k * 0.1, 0], { rot: [Math.PI / 2, 0, 0], scale: [1, 1, 1] });
        break;
      }
      case 'cairn': {
        const sizes = [0.22, 0.18, 0.15, 0.12, 0.09];
        let y = 0;
        sizes.forEach((r0, k) => {
          add(new THREE.DodecahedronGeometry(r0, 0), k % 2 ? C.stone2 : C.stone, [randSoft() * 0.03, y + r0 * 0.55, randSoft() * 0.03], { scale: [1.2, 0.6, 1.1], rot: [0, k, 0] });
          y += r0 * 1.05;
        });
        add(new THREE.OctahedronGeometry(0.05, 0), '#bfe6ff', [0, y + 0.05, 0], { glow: true });
        break;
      }
      case 'stilthut': {
        for (const [x, z] of [[0.24, 0.2], [-0.24, 0.2], [0.24, -0.2], [-0.24, -0.2]] as const) add(cyl(0.025, 0.03, 0.34, 5), C.woodDark, [x, 0, z]);
        add(box(0.62, 0.04, 0.52), C.wood, [0, 0.34, 0]);
        add(cyl(0.22, 0.24, 0.26, 8), '#c9a77c', [0, 0.38, 0]);
        add(cone(0.36, 0.34, 8), '#b8945a', [0, 0.64, 0]);
        add(box(0.1, 0.14, 0.02), C.window, [0, 0.42, 0.23], { glow: true });
        for (let k = 0; k < 3; k++) add(box(0.12, 0.012, 0.04), C.wood, [0.32, 0.08 + k * 0.1, 0.24]);
        break;
      }
      case 'tent': {
        add(cyl(0.02, 0.02, 0.6, 5), C.woodDark, [0, 0, 0]);
        add(cone(0.42, 0.46, 6), '#f3e6cc', [0, 0.06, 0]);
        add(cone(0.43, 0.12, 6), '#d9826b', [0, 0.06, 0]);
        add(box(0.16, 0.22, 0.02), '#7a4a3a', [0, 0.06, 0.36], { rot: [-0.62, 0, 0] });
        add(box(0.5, 0.01, 0.34), '#c96a5a', [0.1, 0, 0.55]);
        add(box(0.4, 0.012, 0.24), '#e9c46a', [0.1, 0.002, 0.55]);
        add(box(0.06, 0.08, 0.06), C.lamp, [0.32, 0, 0.42], { glow: true });
        break;
      }
    }
    this.built.push(b);
    if (!instant) {
      const p = group.position.clone();
      for (let k = 0; k < 14; k++) {
        const a = Math.random() * Math.PI * 2;
        g.particles.emit({ x: p.x + Math.cos(a) * 0.5, y: p.y + 0.05, z: p.z + Math.sin(a) * 0.5, vx: Math.cos(a) * 0.8, vy: rand(0.2, 0.6), vz: Math.sin(a) * 0.8, life: 1.2, size: rand(0.25, 0.4), color: '#efe7d8', alpha: 0.5, drag: 2 });
      }
    }
  }

  /** Add one mesh to a landmark; it pops in on its turn (with a rising note) unless instant. */
  private part(b: Built, instant: boolean, geo: THREE.BufferGeometry, color: string, pos: [number, number, number], o: PartOpts = {}) {
    const m = new THREE.Mesh(geo, mat(color, o.glow));
    m.castShadow = true;
    m.receiveShadow = true;
    m.position.set(...pos);
    if (o.rot) m.rotation.set(...o.rot);
    const sc = new THREE.Vector3(...(o.scale ?? [1, 1, 1]));
    (o.parent ?? b.group).add(m);
    if (!o.noPop) {
      b.parts.push({ obj: m, s: new Spring(instant ? 1 : 0, 190, 11), delay: instant ? 0 : b.order++ * 0.16, base: sc, popped: instant });
      m.scale.copy(sc).multiplyScalar(instant ? 1 : 0.0001);
    } else m.scale.copy(sc);
    return m;
  }

  /**
   * A grove "flourishes" when a visitor moves in: its landmark gains a few homely touches,
   * assembled piece by piece like the building itself.
   */
  flourish(ii: number, r: number, instant: boolean) {
    const b = this.built.find((x) => x.ii === ii && x.r === r);
    if (!b || b.flourished) return;
    b.flourished = true;
    b.order = 0;
    const add = (geo: THREE.BufferGeometry, color: string, pos: [number, number, number], o: PartOpts = {}) => this.part(b, instant, geo, color, pos, o);
    const flowers = ['#f6b8c8', '#fbe39a', '#ffffff', '#c9b6f0', '#f49fae'];
    const pot = (x: number, z: number, k: number) => {
      add(cyl(0.05, 0.04, 0.07, 7), '#c98a6a', [x, 0, z]);
      add(new THREE.IcosahedronGeometry(0.045, 0), '#8fbf73', [x, 0.08, z]);
      add(new THREE.IcosahedronGeometry(0.025, 0), flowers[k % flowers.length], [x + 0.02, 0.12, z + 0.01]);
    };
    const pennant = (x: number, y: number, z: number, color: string) => {
      add(cyl(0.008, 0.01, 0.3, 4), C.woodDark, [x, y, z]);
      add(new THREE.ConeGeometry(0.06, 0.18, 3).rotateZ(-Math.PI / 2).translate(0.09, 0, 0), color, [x, y + 0.26, z], { scale: [1, 1, 0.25] });
    };
    switch (b.kind) {
      case 'cottage': {
        add(box(0.2, 0.04, 0.06), C.wood, [-0.2, 0.1, 0.33]);
        for (let k = 0; k < 3; k++) add(new THREE.IcosahedronGeometry(0.03, 0), flowers[k], [-0.26 + k * 0.06, 0.15, 0.34]);
        add(box(0.3, 0.03, 0.1), C.wood, [-0.15, 0.1, 0.55]);
        add(box(0.03, 0.1, 0.08), C.woodDark, [-0.27, 0, 0.55]);
        add(box(0.03, 0.1, 0.08), C.woodDark, [-0.03, 0, 0.55]);
        for (let k = 0; k < 4; k++) add(box(0.025, 0.14, 0.025), C.white, [0.5, 0, -0.3 + k * 0.2]);
        add(box(0.02, 0.025, 0.66), C.white, [0.5, 0.1, 0]);
        break;
      }
      case 'windmill': {
        pennant(0, 1.25, 0, C.red);
        add(new THREE.IcosahedronGeometry(0.08, 1), '#e9dcc0', [0.3, 0.06, 0.15], { scale: [1, 1.2, 1] });
        add(new THREE.IcosahedronGeometry(0.07, 1), '#e2d3b4', [0.38, 0.05, 0.02], { scale: [1, 1.2, 1] });
        pot(-0.32, 0.18, 1);
        break;
      }
      case 'well': {
        add(cyl(0.004, 0.004, 0.18, 3), C.woodDark, [0.06, 0.2, 0]);
        add(cyl(0.05, 0.04, 0.07, 8), C.wood, [0.06, 0.18, 0]);
        pot(0.34, 0.12, 0);
        pot(-0.32, -0.16, 3);
        pot(0.1, -0.36, 4);
        break;
      }
      case 'shrine': {
        for (const x of [-0.18, 0.18]) {
          add(cyl(0.004, 0.004, 0.08, 3), C.woodDark, [x, 0.42, -0.18]);
          add(new THREE.IcosahedronGeometry(0.05, 1), C.lamp, [x, 0.35, -0.18], { scale: [1, 1.25, 1], glow: true });
        }
        pot(0.3, 0.25, 0);
        break;
      }
      case 'stones': {
        add(new THREE.OctahedronGeometry(0.12, 0), '#bfe6ff', [0, 0.55, 0], { glow: true, scale: [1, 1.5, 1] });
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + 0.5;
          add(new THREE.IcosahedronGeometry(0.03, 0), flowers[k % flowers.length], [Math.cos(a) * 0.3, 0.03, Math.sin(a) * 0.3]);
        }
        break;
      }
      case 'greattree': {
        add(box(0.46, 0.035, 0.36), C.wood, [-0.05, 0.6, 0.22]);
        add(box(0.2, 0.16, 0.16), C.wall, [-0.1, 0.635, 0.2]);
        add(prism(0.22, 0.12, 0.24), C.roof, [-0.1, 0.795, 0.2]);
        add(box(0.06, 0.05, 0.01), C.window, [-0.1, 0.7, 0.285], { glow: true });
        add(box(0.012, 0.62, 0.012), C.woodDark, [0.1, 0, 0.42]);
        add(box(0.012, 0.62, 0.012), C.woodDark, [0.2, 0, 0.42]);
        for (let k = 0; k < 4; k++) add(box(0.11, 0.012, 0.012), C.wood, [0.15, 0.1 + k * 0.14, 0.42]);
        break;
      }
      case 'lighthouse': {
        pennant(0, 1.52, 0, '#7f9cc4');
        pot(0.4, 0.1, 2);
        pot(-0.36, 0.2, 0);
        break;
      }
      case 'pier': {
        add(box(0.12, 0.1, 0.12), C.wood, [-0.12, 0.08, 0.3]);
        add(box(0.1, 0.08, 0.1), C.woodDark, [-0.1, 0.18, 0.3]);
        add(cyl(0.006, 0.008, 0.5, 4), C.woodDark, [0.15, 0.08, 0.8], { rot: [0.9, 0, 0] });
        add(box(0.06, 0.08, 0.06), C.lamp, [-0.2, 0.08, 0.6], { glow: true });
        break;
      }
      case 'pagoda': {
        for (const [x, z] of [[0.24, 0.24], [-0.24, 0.24], [0.24, -0.24], [-0.24, -0.24]] as const) {
          add(new THREE.IcosahedronGeometry(0.04, 1), C.lamp, [x, 0.2, z], { scale: [1, 1.3, 1], glow: true });
        }
        pot(0.38, 0.05, 1);
        break;
      }
      case 'barn': {
        pennant(0.52, 0.66, -0.08, C.white);
        for (let k = 0; k < 3; k++) add(new THREE.IcosahedronGeometry(0.06, 1), ['#e98a3a', '#f2a65a', '#e07a3a'][k], [-0.45 + k * 0.13, 0.04, 0.42], { scale: [1.1, 0.8, 1.1] });
        break;
      }
      case 'haystack': {
        add(cyl(0.006, 0.006, 0.3, 3), C.woodDark, [0.15, 0.1, -0.36]);
        for (let k = 0; k < 3; k++) add(new THREE.IcosahedronGeometry(0.055, 1), ['#e98a3a', '#f2a65a', '#d9826b'][k], [0.2 + k * 0.1, 0.04, -0.15], { scale: [1.1, 0.8, 1.1] });
        pot(-0.4, -0.05, 4);
        break;
      }
      case 'igloo': {
        // a snowman keeps watch
        add(new THREE.IcosahedronGeometry(0.1, 1), '#f6fafc', [0.45, 0.08, 0.25]);
        add(new THREE.IcosahedronGeometry(0.07, 1), '#f6fafc', [0.45, 0.22, 0.25]);
        add(cone(0.015, 0.06, 4), '#f2a65a', [0.45, 0.22, 0.31], { rot: [Math.PI / 2, 0, 0] });
        add(cyl(0.05, 0.05, 0.06, 8), '#4b4f58', [0.45, 0.28, 0.25]);
        add(box(0.03, 0.12, 0.03), '#d9826b', [0.4, 0.14, 0.31], { rot: [0, 0, 0.3] });
        break;
      }
      case 'cairn': {
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          add(new THREE.IcosahedronGeometry(0.03, 0), flowers[k % flowers.length], [Math.cos(a) * 0.32, 0.03, Math.sin(a) * 0.32]);
        }
        add(cyl(0.006, 0.006, 0.38, 3), C.woodDark, [0.2, 0, 0]);
        add(box(0.12, 0.08, 0.005), '#7f9cc4', [0.26, 0.32, 0]);
        break;
      }
      case 'stilthut': {
        for (const x of [-0.28, 0.28]) {
          add(cyl(0.004, 0.004, 0.08, 3), C.woodDark, [x, 0.36, 0.26]);
          add(new THREE.IcosahedronGeometry(0.045, 1), C.lamp, [x, 0.3, 0.26], { scale: [1, 1.25, 1], glow: true });
        }
        pot(-0.36, -0.3, 2);
        break;
      }
      case 'tent': {
        pennant(0, 0.58, 0, '#7f9cc4');
        pot(-0.36, 0.3, 0);
        add(new THREE.TorusGeometry(0.07, 0.012, 4, 10), '#5a5048', [-0.25, 0.01, 0.6], { rot: [Math.PI / 2, 0, 0] });
        add(cyl(0.03, 0.03, 0.06, 6), '#c96a5a', [-0.25, 0.01, 0.6]);
        break;
      }
    }
  }

  /** Remove an unloaded island's landmarks. */
  removeIsland(ii: number) {
    this.built = this.built.filter((b) => {
      if (b.ii !== ii) return true;
      b.group.parent?.remove(b.group);
      // geometry is per part; materials are cached and shared, so they stay
      b.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      return false;
    });
  }

  update(dt: number) {
    const g = this.g;
    const night = U.uNight.value;
    for (const m of glowMats) m.emissiveIntensity = 0.15 + night * 1.6;
    this.beamMat.opacity = night * 0.18;
    for (const b of this.built) {
      b.t += dt;
      for (const p of b.parts) {
        if (p.delay > 0) {
          p.delay -= dt;
          continue;
        }
        if (!p.popped) {
          p.popped = true;
          p.s.target = 1;
          p.s.vel = 2;
          const wp = p.obj.getWorldPosition(new THREE.Vector3());
          const pan = g.pan(wp.x, wp.y, wp.z);
          const idx = b.parts.indexOf(p);
          g.sfx.tok(pan, 0.8 + idx * 0.05, 0.6);
          g.music.play(0, 'kalimba', pan, 0.55, 7 + Math.min(10, idx));
          for (let k = 0; k < 3; k++) {
            g.particles.emit({ x: wp.x, y: wp.y, z: wp.z, vx: randSoft(), vy: rand(0.5, 1.5), vz: randSoft(), life: 0.6, size: 0.12, color: '#fff6e0', alpha: 0.6, shape: SHAPE.sparkle, drag: 2 });
          }
        }
        if (Math.abs(p.s.value - 1) > 0.0005 || Math.abs(p.s.vel) > 0.0005) {
          p.s.update(dt);
          const v = p.s.vel;
          const st = Math.max(0.7, Math.min(1.4, 1 + v * 0.04));
          const s = Math.max(0.0001, p.s.value);
          p.obj.scale.set(p.base.x * s / Math.sqrt(st), p.base.y * s * st, p.base.z * s / Math.sqrt(st));
        }
      }
      for (const s of b.spinners) s.obj.rotation[s.axis] += dt * s.speed;
      for (const bb of b.bobbers) {
        bb.obj.position.y = bb.y + Math.sin(b.t * 1.4 + bb.phase) * 0.025;
        bb.obj.rotation.z = Math.sin(b.t * 1.1 + bb.phase) * 0.06;
      }
      if (b.smoke.length && Math.random() < dt * 2.2) {
        for (const sp of b.smoke) {
          const w = b.group.localToWorld(sp.clone());
          g.particles.emit({ x: w.x, y: w.y, z: w.z, vx: 0.15 + randSoft() * 0.05, vy: rand(0.35, 0.55), vz: randSoft() * 0.05, life: rand(2.5, 3.5), size: rand(0.14, 0.2), grow: 3, color: '#f2f0ec', alpha: 0.45, drag: 0.3 });
        }
      }
      if (night > 0.3 && Math.random() < dt * 0.6 * night) {
        // fireflies gather around lit buildings
        const p = b.group.position;
        g.glow.emit({ x: p.x + randSoft() * 0.8, y: p.y + rand(0.2, 0.9), z: p.z + randSoft() * 0.8, vx: randSoft() * 0.2, vy: 0.1, vz: randSoft() * 0.2, life: rand(2, 3.5), size: 0.12, color: '#ffe9a0', shape: SHAPE.dot, drag: 0.5, flutter: 0.3 });
      }
    }
  }
}

function pick2(a: string, b: string, i: number) {
  return i % 3 === 0 ? b : a;
}

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
  kind: LandmarkKind;
  t: number;
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
    const b: Built = { group, parts: [], spinners: [], smoke: [], bobbers: [], beams: [], ii, kind: reg.landmark, t: 0 };
    let order = 0;
    const add = (geo: THREE.BufferGeometry, color: string, pos: [number, number, number], o: { rot?: [number, number, number]; scale?: [number, number, number]; glow?: boolean; parent?: THREE.Object3D; noPop?: boolean } = {}) => {
      const m = new THREE.Mesh(geo, mat(color, o.glow));
      m.castShadow = true;
      m.receiveShadow = true;
      m.position.set(...pos);
      if (o.rot) m.rotation.set(...o.rot);
      const sc = new THREE.Vector3(...(o.scale ?? [1, 1, 1]));
      (o.parent ?? group).add(m);
      if (!o.noPop) {
        b.parts.push({ obj: m, s: new Spring(instant ? 1 : 0, 190, 11), delay: instant ? 0 : order++ * 0.16, base: sc, popped: instant });
        m.scale.copy(sc).multiplyScalar(instant ? 1 : 0.0001);
      } else m.scale.copy(sc);
      return m;
    };
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

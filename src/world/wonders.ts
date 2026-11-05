// Hidden wonders: revealed by blooming the right tile, collected by tapping.
import * as THREE from 'three';
import { Spring, rand, randSoft, pick } from '../core/math';
import { U } from '../core/shaders';
import { SHAPE } from '../fx/particles';
import type { Game } from '../game/game';
import type { WonderKind } from './gen';

export const WONDER_INFO: Record<WonderKind, { name: string; line: string; island: number; icon: string }> = {
  fox: { name: 'Sleeping Fox', line: 'Dreams of warm stones.', island: 0, icon: '🦊' },
  kite: { name: 'Lost Kite', line: 'Still remembers the wind.', island: 0, icon: '🪁' },
  snail: { name: 'Moss Snail', line: 'In no hurry at all.', island: 0, icon: '🐌' },
  fairyring: { name: 'Fairy Ring', line: 'Something danced here.', island: 1, icon: '🍄' },
  owl: { name: 'Old Owl', line: "Keeps the forest's secrets.", island: 1, icon: '🦉' },
  stag: { name: 'White Stag', line: 'Seen once, remembered always.', island: 1, icon: '🦌' },
  heron: { name: 'Grey Heron', line: 'Patient as a pond.', island: 2, icon: '🪶' },
  float: { name: 'Glass Float', line: 'Drifted in from far away.', island: 2, icon: '🫧' },
  turtle: { name: 'River Turtle', line: 'Older than the islands.', island: 2, icon: '🐢' },
  lantern: { name: 'Stone Lantern', line: 'Lit by someone kind.', island: 3, icon: '🏮' },
  moonlily: { name: 'Moon Lily', line: 'Blooms only at dusk.', island: 3, icon: '🪷' },
  bell: { name: 'Shrine Bell', line: 'One clear note for the valley.', island: 3, icon: '🔔' },
};
export const WONDER_ORDER: WonderKind[] = ['fox', 'kite', 'snail', 'fairyring', 'owl', 'stag', 'heron', 'float', 'turtle', 'lantern', 'moonlily', 'bell'];

interface W {
  kind: WonderKind;
  ii: number;
  tile: number;
  g: THREE.Group;
  anim: THREE.Object3D[];
  s: Spring;
  bounce: Spring;
  collected: boolean;
  t: number;
  glow: THREE.MeshStandardMaterial[];
  hoverT: number;
}

const M = (c: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, flatShading: true, ...o });

export class Wonders {
  list: W[] = [];
  constructor(private g: Game) {}

  reveal(ii: number, tile: number, instant: boolean) {
    const isl = this.g.islands[ii];
    const t = isl.tiles[tile];
    if (!t.wonder || this.list.some((w) => w.ii === ii && w.tile === tile)) return;
    const g = new THREE.Group();
    g.position.set(t.x + isl.cx + 0.15, t.h, t.z + isl.cz - 0.1);
    g.rotation.y = Math.random() * Math.PI * 2;
    const { anim, glow } = this.model(t.wonder, g);
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.g.scene.add(g);
    const collected = this.g.collected.has(t.wonder);
    const w: W = { kind: t.wonder, ii, tile, g, anim, s: new Spring(instant ? 1 : 0, 120, 8), bounce: new Spring(0, 200, 9), collected, t: 0, glow, hoverT: -10 };
    w.s.target = 1;
    g.scale.setScalar(instant ? 1 : 0.0001);
    this.list.push(w);
    if (!instant) {
      // a shimmer: something is here
      const pan = this.g.pan(g.position.x, g.position.y, g.position.z);
      this.g.after(0.5, () => {
        this.g.music.arpeggio('glass', 4, 0.12, 11, 0.4, pan);
        for (let k = 0; k < 18; k++) {
          this.g.glow.emit({ x: g.position.x, y: g.position.y + 0.3, z: g.position.z, vx: randSoft() * 1.5, vy: rand(0.5, 2), vz: randSoft() * 1.5, life: 1.4, size: 0.16, color: '#fff6d0', shape: SHAPE.sparkle, drag: 2 });
        }
      });
    }
  }

  /** A little "notice me" wiggle when the pointer passes over. */
  hover(ray: THREE.Ray) {
    for (const w of this.list) {
      const p = w.g.position.clone();
      p.y += 0.35;
      if (ray.distanceSqToPoint(p) < 0.6 * 0.6 && this.g.time - w.hoverT > 1.2) {
        w.hoverT = this.g.time;
        w.bounce.vel += 2.5;
        if (!w.collected) this.g.audio.note(this.g.audio.now + 0.01, 86, 0.25, 'glass', { pan: this.g.pan(p.x, p.y, p.z) });
      }
    }
  }

  tryTap(ray: THREE.Ray): boolean {
    for (const w of this.list) {
      const p = w.g.position.clone();
      p.y += 0.35;
      if (ray.distanceSqToPoint(p) < 0.6 * 0.6) {
        w.bounce.vel = 6;
        const pan = this.g.pan(p.x, p.y, p.z);
        if (!w.collected) {
          w.collected = true;
          this.g.collected.add(w.kind);
          this.g.music.arpeggio('bell', 9, 0.06, 7, 0.75, pan);
          this.g.music.swell(0.8);
          this.g.rig.punch(0.8);
          this.g.cloud.happy = 1;
          for (let k = 0; k < 30; k++) {
            const a = Math.random() * Math.PI * 2;
            this.g.glow.emit({ x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * rand(0.6, 2.2), vy: rand(1, 3), vz: Math.sin(a) * rand(0.6, 2.2), life: rand(1.2, 2), size: rand(0.12, 0.22), color: pick(['#fff3c8', '#ffe2ef', '#e2f6ff']), shape: SHAPE.sparkle, gravity: 1, drag: 1.4 });
          }
          this.g.ui.wonderFound(w.kind);
          this.g.save();
        } else {
          this.g.music.play(0.7, w.kind === 'bell' ? 'bell' : 'celesta', pan, 0.6);
        }
        if (w.kind === 'bell') this.g.audio.note(this.g.audio.now + 0.01, 50, 0.9, 'bell', { pan, send: 0.9 });
        return true;
      }
    }
    return false;
  }

  update(dt: number) {
    const night = U.uNight.value;
    for (const w of this.list) {
      w.t += dt;
      w.s.update(dt);
      w.bounce.update(dt);
      const s = Math.max(0.0001, w.s.value);
      const b = w.bounce.value;
      const S = 1.5;
      w.g.scale.set(S * s * (1 - b * 0.05), S * s * (1 + b * 0.12), S * s * (1 - b * 0.05));
      for (const m of w.glow) m.emissiveIntensity = 0.4 + night * 1.4 + Math.sin(w.t * 2) * 0.1;
      // idle animation per kind
      const a = w.anim;
      switch (w.kind) {
        case 'fox': a[0].scale.y = 1 + Math.sin(w.t * 1.6) * 0.04; if (a[1]) a[1].rotation.y = Math.sin(w.t * 0.8) * 0.15; break;
        case 'kite': a[0].rotation.z = Math.sin(w.t * 1.7) * 0.25; a[0].position.y = 0.95 + Math.sin(w.t * 1.1) * 0.08; break;
        case 'snail': w.g.position.x += Math.sin(w.t * 0.2) * dt * 0.01; a[0].rotation.x = Math.sin(w.t * 3) * 0.1; break;
        case 'owl': a[0].rotation.y = Math.sin(w.t * 0.5) * 0.7; break;
        case 'stag': a[0].rotation.x = Math.sin(w.t * 0.7) > 0.6 ? 0.5 : 0; break;
        case 'heron': a[0].rotation.x = Math.sin(w.t * 0.9) * 0.12; break;
        case 'float': a[0].position.y = 0.2 + Math.sin(w.t * 1.6) * 0.04; a[0].rotation.z = Math.sin(w.t * 1.1) * 0.1; break;
        case 'turtle': a[0].position.z = 0.18 + Math.sin(w.t * 0.6) * 0.03; break;
        case 'bell': a[0].rotation.z = Math.sin(w.t * 2.2) * 0.08 * (1 + Math.abs(b) * 4); break;
        case 'moonlily': a[0].rotation.y += dt * 0.2; break;
        case 'fairyring': a[0].rotation.y += dt * 0.15; break;
      }
      // uncollected wonders twinkle to invite a tap
      if (!w.collected && Math.random() < dt * 2.2) {
        const p = w.g.position;
        this.g.glow.emit({ x: p.x + randSoft() * 0.4, y: p.y + rand(0.3, 0.8), z: p.z + randSoft() * 0.4, vy: 0.3, life: 1.1, size: rand(0.12, 0.2), color: '#fff3c8', shape: SHAPE.sparkle, drag: 1 });
      }
    }
  }

  private model(kind: WonderKind, g: THREE.Group): { anim: THREE.Object3D[]; glow: THREE.MeshStandardMaterial[] } {
    const anim: THREE.Object3D[] = [];
    const glow: THREE.MeshStandardMaterial[] = [];
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, p: [number, number, number], r: [number, number, number] = [0, 0, 0], s: [number, number, number] = [1, 1, 1], parent: THREE.Object3D = g) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(...p);
      mesh.rotation.set(...r);
      mesh.scale.set(...s);
      parent.add(mesh);
      return mesh;
    };
    const sph = (r: number, d = 1) => new THREE.IcosahedronGeometry(r, d);
    const cyl = (a: number, b: number, h: number, n = 6) => new THREE.CylinderGeometry(a, b, h, n);
    const cone = (r: number, h: number, n = 5) => new THREE.ConeGeometry(r, h, n);
    const gm = (c: string) => {
      const m = M(c, { emissive: new THREE.Color(c), emissiveIntensity: 0.5 });
      glow.push(m);
      return m;
    };
    switch (kind) {
      case 'fox': {
        const orange = M('#e98a4f'), white = M('#fbf3e6'), dark = M('#4a3a33');
        const body = add(sph(0.2), orange, [0, 0.13, 0], [0, 0, 0], [1.3, 0.7, 1]);
        anim.push(body);
        const tailG = new THREE.Group();
        tailG.position.set(-0.18, 0.1, 0.05);
        g.add(tailG);
        anim.push(tailG);
        add(sph(0.11), orange, [0.05, 0, 0.16], [0, 0, 0], [0.9, 0.7, 1.8], tailG);
        add(sph(0.07), white, [0.18, 0, 0.3], [0, 0, 0], [1, 0.8, 1], tailG);
        const head = add(sph(0.12), orange, [0.22, 0.13, 0.08], [0, 0, 0], [1, 0.85, 1]);
        add(cone(0.05, 0.1, 4), orange, [0.26, 0.27, 0.12], [0, 0, -0.3]);
        add(cone(0.05, 0.1, 4), orange, [0.2, 0.27, 0.0], [0, 0, -0.3]);
        add(sph(0.03, 0), dark, [0.34, 0.1, 0.1]);
        void head;
        break;
      }
      case 'kite': {
        add(cyl(0.01, 0.015, 0.9), M('#9a7350'), [0, 0.45, 0]);
        const k = new THREE.Group();
        k.position.set(0, 0.95, 0);
        g.add(k);
        anim.push(k);
        add(new THREE.OctahedronGeometry(0.22, 0), M('#f49fae'), [0, 0, 0], [0, 0, 0], [0.8, 1.2, 0.08], k);
        add(new THREE.OctahedronGeometry(0.1, 0), M('#fbe39a'), [0, -0.05, 0.02], [0, 0, 0], [0.8, 1.2, 0.08], k);
        for (let i = 0; i < 4; i++) add(new THREE.OctahedronGeometry(0.04, 0), M(i % 2 ? '#a8d8f0' : '#fbe39a'), [0.03 * i, -0.3 - i * 0.1, 0], [0, 0, 0.8], [1, 0.6, 0.3], k);
        break;
      }
      case 'snail': {
        const s = new THREE.Group();
        g.add(s);
        anim.push(s);
        add(new THREE.TorusGeometry(0.09, 0.055, 6, 12), M('#d9a06b'), [0, 0.15, 0], [0, Math.PI / 2, 0], [1, 1, 1.2], s);
        add(sph(0.05), M('#e8c08f'), [0, 0.15, 0], [0, 0, 0], [0.6, 1, 1], s);
        add(sph(0.06), M('#c9d7a5'), [0, 0.04, 0.08], [0, 0, 0], [0.8, 0.5, 2.2], s);
        add(cyl(0.008, 0.008, 0.1, 4), M('#c9d7a5'), [0.03, 0.1, 0.2], [0.3, 0, 0], [1, 1, 1], s);
        add(cyl(0.008, 0.008, 0.1, 4), M('#c9d7a5'), [-0.03, 0.1, 0.2], [0.3, 0, 0], [1, 1, 1], s);
        break;
      }
      case 'fairyring': {
        const r = new THREE.Group();
        g.add(r);
        anim.push(r);
        const cap = gm('#fff1f4');
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2;
          const sc = 0.8 + (i % 3) * 0.2;
          add(cyl(0.018, 0.024, 0.08), M('#f4ede0'), [Math.cos(a) * 0.4, 0.04 * sc, Math.sin(a) * 0.4], [0, 0, 0], [sc, sc, sc], r);
          add(new THREE.SphereGeometry(0.05, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), cap, [Math.cos(a) * 0.4, 0.08 * sc, Math.sin(a) * 0.4], [0, 0, 0], [sc, sc, sc], r);
        }
        add(new THREE.OctahedronGeometry(0.06), gm('#e2f6ff'), [0, 0.3, 0], [0, 0, 0], [1, 1.4, 1], r);
        break;
      }
      case 'owl': {
        add(cyl(0.16, 0.2, 0.25, 7), M('#8b6a4e'), [0, 0.12, 0]);
        add(cyl(0.15, 0.15, 0.01, 7), M('#d9c3a0'), [0, 0.25, 0]);
        const o = new THREE.Group();
        o.position.set(0, 0.25, 0);
        g.add(o);
        anim.push(o);
        add(sph(0.12), M('#a68a6d'), [0, 0.12, 0], [0, 0, 0], [1, 1.25, 0.95], o);
        add(sph(0.09), M('#efe3cf'), [0, 0.16, 0.06], [0, 0, 0], [1, 0.8, 0.4], o);
        add(sph(0.03, 0), M('#3a3330'), [0.035, 0.18, 0.1], [0, 0, 0], [1, 1, 1], o);
        add(sph(0.03, 0), M('#3a3330'), [-0.035, 0.18, 0.1], [0, 0, 0], [1, 1, 1], o);
        add(cone(0.03, 0.06, 4), M('#a68a6d'), [0.07, 0.28, 0], [0, 0, -0.3], [1, 1, 1], o);
        add(cone(0.03, 0.06, 4), M('#a68a6d'), [-0.07, 0.28, 0], [0, 0, 0.3], [1, 1, 1], o);
        break;
      }
      case 'stag': {
        const w = M('#f3efe6'), ant = M('#c49a6c');
        add(sph(0.14), w, [0, 0.36, 0], [0, 0, 0], [0.9, 0.8, 1.6]);
        for (const [x, z] of [[0.07, 0.15], [-0.07, 0.15], [0.07, -0.15], [-0.07, -0.15]]) add(cyl(0.02, 0.018, 0.3, 4), w, [x, 0.15, z]);
        const head = new THREE.Group();
        head.position.set(0, 0.48, 0.2);
        g.add(head);
        anim.push(head);
        add(cyl(0.04, 0.05, 0.2, 5), w, [0, 0.06, 0.02], [0.4, 0, 0], [1, 1, 1], head);
        add(sph(0.07), w, [0, 0.18, 0.08], [0, 0, 0], [0.8, 0.8, 1.3], head);
        for (const s of [1, -1]) {
          add(cyl(0.008, 0.012, 0.22, 4), ant, [s * 0.05, 0.32, 0.05], [0, 0, -s * 0.4], [1, 1, 1], head);
          add(cyl(0.006, 0.008, 0.1, 4), ant, [s * 0.1, 0.36, 0.05], [0, 0, -s * 1.1], [1, 1, 1], head);
        }
        break;
      }
      case 'heron': {
        const grey = M('#b9c0c8'), white = M('#f1f3f4');
        add(cyl(0.008, 0.008, 0.32, 4), M('#d4a35a'), [0.03, 0.16, 0]);
        add(cyl(0.008, 0.008, 0.32, 4), M('#d4a35a'), [-0.03, 0.16, 0]);
        add(sph(0.1), grey, [0, 0.38, 0], [0.3, 0, 0], [0.8, 0.8, 1.5]);
        const n = new THREE.Group();
        n.position.set(0, 0.42, 0.1);
        g.add(n);
        anim.push(n);
        add(cyl(0.02, 0.025, 0.25, 5), white, [0, 0.12, 0.02], [0.2, 0, 0], [1, 1, 1], n);
        add(sph(0.04), white, [0, 0.25, 0.05], [0, 0, 0], [1, 1, 1], n);
        add(cone(0.015, 0.14, 4), M('#d4a35a'), [0, 0.25, 0.14], [Math.PI / 2, 0, 0], [1, 1, 1], n);
        break;
      }
      case 'float': {
        const f = new THREE.Group();
        g.add(f);
        anim.push(f);
        add(sph(0.18, 2), new THREE.MeshStandardMaterial({ color: '#a6e3e9', roughness: 0.1, transparent: true, opacity: 0.7, emissive: new THREE.Color('#5fb6c8'), emissiveIntensity: 0.3 }), [0, 0, 0], [0, 0, 0], [1, 1, 1], f);
        add(new THREE.TorusGeometry(0.18, 0.008, 4, 16), M('#c9a36b'), [0, 0, 0], [Math.PI / 2, 0, 0], [1, 1, 1], f);
        add(new THREE.TorusGeometry(0.18, 0.008, 4, 16), M('#c9a36b'), [0, 0, 0], [0, 0, 0], [1, 1, 1], f);
        break;
      }
      case 'turtle': {
        add(new THREE.SphereGeometry(0.2, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), M('#7fae8a'), [0, 0.03, 0], [0, 0, 0], [1, 0.7, 1.2]);
        add(cyl(0.2, 0.2, 0.03, 8), M('#c9b88a'), [0, 0.03, 0], [0, 0, 0], [1, 1, 1.2]);
        const h = add(sph(0.06), M('#a8c49a'), [0, 0.06, 0.25]);
        anim.push(h);
        for (const [x, z] of [[0.15, 0.15], [-0.15, 0.15], [0.15, -0.15], [-0.15, -0.15]]) add(sph(0.04, 0), M('#a8c49a'), [x, 0.02, z], [0, 0, 0], [1, 0.5, 1.4]);
        break;
      }
      case 'lantern': {
        const st = M('#c9c3b8');
        add(cyl(0.14, 0.18, 0.08, 6), st, [0, 0.04, 0]);
        add(cyl(0.05, 0.07, 0.35, 6), st, [0, 0.25, 0]);
        add(cyl(0.16, 0.12, 0.05, 6), st, [0, 0.44, 0]);
        add(new THREE.BoxGeometry(0.16, 0.14, 0.16), gm('#ffd98a'), [0, 0.53, 0]);
        add(cone(0.22, 0.14, 6), st, [0, 0.67, 0]);
        add(sph(0.03, 0), st, [0, 0.76, 0]);
        anim.push(g);
        break;
      }
      case 'moonlily': {
        const f = new THREE.Group();
        f.position.y = 0.05;
        g.add(f);
        anim.push(f);
        add(cyl(0.22, 0.22, 0.015, 9), M('#8fc27a'), [0, 0, 0], [0, 0, 0], [1, 1, 1], f);
        const pm = gm('#eef3ff');
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          add(sph(0.07), pm, [Math.cos(a) * 0.08, 0.06, Math.sin(a) * 0.08], [0, -a, 0.6], [1.4, 0.35, 0.6], f);
        }
        add(sph(0.04), gm('#fff1a8'), [0, 0.09, 0], [0, 0, 0], [1, 1, 1], f);
        break;
      }
      case 'bell': {
        const wood = M('#8b5e3c');
        add(new THREE.BoxGeometry(0.04, 0.55, 0.04), wood, [-0.2, 0.27, 0]);
        add(new THREE.BoxGeometry(0.04, 0.55, 0.04), wood, [0.2, 0.27, 0]);
        add(new THREE.BoxGeometry(0.55, 0.05, 0.06), wood, [0, 0.56, 0]);
        add(cone(0.28, 0.08, 4), M('#d9826b'), [0, 0.63, 0], [0, Math.PI / 4, 0], [1, 1, 0.5]);
        const b = new THREE.Group();
        b.position.set(0, 0.53, 0);
        g.add(b);
        anim.push(b);
        add(new THREE.CylinderGeometry(0.05, 0.11, 0.2, 10, 1, true), M('#d4a35a', { metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide }), [0, -0.12, 0], [0, 0, 0], [1, 1, 1], b);
        break;
      }
    }
    return { anim, glow };
  }
}

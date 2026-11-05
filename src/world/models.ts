// Procedural low-poly geometry built from primitives, baked with vertex colours
// and a per-vertex "sway" weight used by the wind shader.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RNG } from '../core/math';

type V3 = [number, number, number];

export interface PartSpec {
  geo: THREE.BufferGeometry;
  color: THREE.ColorRepresentation;
  pos?: V3;
  rot?: V3;
  scale?: V3;
}

/** Bake a list of primitives into one non-indexed geometry with colour + sway. */
export function bake(parts: PartSpec[], sway = 0, swayPow = 1.6): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const c = new THREE.Color();
  for (const p of parts) {
    let g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    e.set(...(p.rot ?? [0, 0, 0]));
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(...(p.pos ?? [0, 0, 0])), q, new THREE.Vector3(...(p.scale ?? [1, 1, 1])));
    g.applyMatrix4(m);
    c.set(p.color);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    for (const k of Object.keys(g.attributes)) {
      if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
    }
    geos.push(g);
  }
  const out = mergeGeometries(geos, false)!;
  out.computeBoundingBox();
  const bb = out.boundingBox!;
  const hgt = Math.max(0.001, bb.max.y);
  const pos = out.attributes.position;
  const sw = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const y = Math.max(0, pos.getY(i));
    sw[i] = sway * Math.pow(y / hgt, swayPow) * hgt;
  }
  out.setAttribute('aSway', new THREE.BufferAttribute(sw, 1));
  out.computeVertexNormals();
  out.computeBoundingSphere();
  return out;
}

const cone = (r: number, h: number, s = 5) => {
  const g = new THREE.ConeGeometry(r, h, s, 1);
  g.translate(0, h / 2, 0);
  return g;
};
const cyl = (rt: number, rb: number, h: number, s = 6) => {
  const g = new THREE.CylinderGeometry(rt, rb, h, s, 1);
  g.translate(0, h / 2, 0);
  return g;
};
const ico = (r: number, d = 0) => new THREE.IcosahedronGeometry(r, d);
const box = (w: number, h: number, d: number) => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  return g;
};
const dodec = (r: number) => new THREE.DodecahedronGeometry(r, 0);

export const PAL = {
  dry: new THREE.Color('#bbb2a6'),
  dryWet: new THREE.Color('#857668'),
  soil: new THREE.Color('#8a705c'),
  soilDark: new THREE.Color('#6d5747'),
  sand: new THREE.Color('#ead8ae'),
  meadow: new THREE.Color('#acd98c'),
  meadowLush: new THREE.Color('#c2e59a'),
  forest: new THREE.Color('#90c784'),
  forestLush: new THREE.Color('#7dba7c'),
  marsh: new THREE.Color('#a3d4b2'),
  marshLush: new THREE.Color('#97d0b8'),
  highland: new THREE.Color('#c6d0a8'),
  highlandLush: new THREE.Color('#b6d69c'),
  blossom: new THREE.Color('#d0e4a0'),
  blossomLush: new THREE.Color('#dcebb0'),
  water: new THREE.Color('#86cbd8'),
  trunk: '#8b6a4e',
  leaf: '#7fb069',
  stem: '#6f9f55',
  white: '#ffffff',
};

export const FLOWER_COLORS = ['#f6b8c8', '#fbe39a', '#ffffff', '#c9b6f0', '#f7c59f', '#a8d8f0', '#f49fae'];
export const BLOSSOM_COLORS = ['#f7c6d6', '#f3b2c8', '#fbd9e3', '#f0a9c0'];

export type DecorKind =
  | 'grass' | 'flower' | 'tulip' | 'bush' | 'pine' | 'roundtree' | 'blossomtree' | 'mushroom'
  | 'reeds' | 'cattail' | 'rock' | 'shell' | 'beachgrass' | 'lilypad' | 'fern' | 'birch' | 'goldflower' | 'willow'
  | 'pumpkin' | 'snowpine' | 'palm' | 'cactus';

export interface DecorModel {
  parts: { geo: THREE.BufferGeometry; tint: boolean }[];
  shadow: boolean;
}

function grassGeo(seed: number) {
  const r = new RNG(seed);
  const parts: PartSpec[] = [];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r.next();
    const d = r.range(0.02, 0.09);
    const h = r.range(0.16, 0.3);
    parts.push({
      geo: cone(0.028, h, 3),
      color: '#ffffff',
      pos: [Math.cos(a) * d, 0, Math.sin(a) * d],
      rot: [Math.sin(a) * 0.35, 0, Math.cos(a) * 0.35],
    });
  }
  return bake(parts, 0.12);
}

export function buildDecorModels(): Record<DecorKind, DecorModel> {
  const M = {} as Record<DecorKind, DecorModel>;
  M.grass = { parts: [{ geo: grassGeo(3), tint: true }], shadow: false };

  // flower: stem (fixed) + petals (tinted)
  const stem = bake([
    { geo: cyl(0.012, 0.016, 0.26, 4), color: PAL.stem },
    { geo: cone(0.04, 0.08, 3), color: PAL.stem, pos: [0.04, 0.06, 0], rot: [0, 0, -1.1] },
    { geo: ico(0.035, 0), color: '#f4d35e', pos: [0, 0.27, 0] },
  ], 0.18);
  const petals: PartSpec[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    petals.push({ geo: ico(0.05, 0), color: '#ffffff', pos: [Math.cos(a) * 0.055, 0.265, Math.sin(a) * 0.055], scale: [1, 0.45, 1] });
  }
  M.flower = { parts: [{ geo: stem, tint: false }, { geo: bake(petals, 0.18), tint: true }], shadow: false };

  const tstem = bake([
    { geo: cyl(0.014, 0.018, 0.3, 4), color: PAL.stem },
    { geo: cone(0.05, 0.16, 3), color: PAL.stem, pos: [0.03, 0, 0], rot: [0, 0, -0.3] },
  ], 0.18);
  M.tulip = {
    parts: [
      { geo: tstem, tint: false },
      { geo: bake([{ geo: cyl(0.065, 0.035, 0.11, 6), color: '#fff', pos: [0, 0.29, 0] }], 0.18), tint: true },
    ],
    shadow: false,
  };

  M.bush = {
    parts: [{
      geo: bake([
        { geo: ico(0.16, 0), color: '#fff', pos: [0, 0.13, 0] },
        { geo: ico(0.12, 0), color: '#f2f2f2', pos: [0.13, 0.09, 0.04] },
        { geo: ico(0.11, 0), color: '#e8e8e8', pos: [-0.11, 0.08, -0.06] },
      ], 0.05), tint: true,
    }],
    shadow: true,
  };

  const trunk = (h: number, r = 0.05) => ({ geo: cyl(r * 0.7, r, h, 5), color: PAL.trunk });
  M.pine = {
    parts: [
      { geo: bake([trunk(0.3)], 0.02), tint: false },
      {
        geo: bake([
          { geo: cone(0.32, 0.45, 6), color: '#e4e4e4', pos: [0, 0.2, 0] },
          { geo: cone(0.25, 0.4, 6), color: '#f2f2f2', pos: [0, 0.42, 0] },
          { geo: cone(0.17, 0.34, 6), color: '#ffffff', pos: [0, 0.64, 0] },
        ], 0.06), tint: true,
      },
    ],
    shadow: true,
  };
  M.roundtree = {
    parts: [
      { geo: bake([trunk(0.36, 0.06)], 0.02), tint: false },
      {
        geo: bake([
          { geo: ico(0.3, 1), color: '#ffffff', pos: [0, 0.55, 0] },
          { geo: ico(0.2, 1), color: '#eeeeee', pos: [0.18, 0.45, 0.08] },
          { geo: ico(0.18, 1), color: '#e6e6e6', pos: [-0.14, 0.62, -0.1] },
        ], 0.05), tint: true,
      },
    ],
    shadow: true,
  };
  M.birch = {
    parts: [
      { geo: bake([{ geo: cyl(0.035, 0.05, 0.6, 5), color: '#efe9df' }, { geo: box(0.07, 0.02, 0.07), color: '#4b4038', pos: [0, 0.2, 0] }], 0.02), tint: false },
      {
        geo: bake([
          { geo: ico(0.2, 0), color: '#ffffff', pos: [0, 0.68, 0], scale: [1, 1.4, 1] },
          { geo: ico(0.14, 0), color: '#eeeeee', pos: [0.1, 0.52, 0.05], scale: [1, 1.3, 1] },
        ], 0.06), tint: true,
      },
    ],
    shadow: true,
  };
  M.blossomtree = {
    parts: [
      {
        geo: bake([
          trunk(0.38, 0.06),
          { geo: cyl(0.02, 0.035, 0.25, 4), color: PAL.trunk, pos: [0.04, 0.3, 0], rot: [0, 0, -0.8] },
        ], 0.02), tint: false,
      },
      {
        geo: bake([
          { geo: ico(0.26, 1), color: '#ffffff', pos: [0, 0.55, 0], scale: [1.2, 0.85, 1.2] },
          { geo: ico(0.17, 1), color: '#f4f4f4', pos: [0.22, 0.5, 0.05], scale: [1.1, 0.8, 1.1] },
          { geo: ico(0.15, 1), color: '#eaeaea', pos: [-0.15, 0.62, -0.08] },
        ], 0.05), tint: true,
      },
    ],
    shadow: true,
  };
  // willow: a leaning trunk and a crown of drooping fronds (planted beside water)
  const fronds: PartSpec[] = [{ geo: ico(0.24, 1), color: '#ffffff', pos: [0.04, 0.66, 0], scale: [1.25, 0.6, 1.25] }];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const r = 0.2 + (i % 2) * 0.05;
    fronds.push({
      geo: cone(0.07, 0.36 + (i % 3) * 0.06, 4), color: i % 2 ? '#eeeeee' : '#f6f6f6',
      pos: [0.04 + Math.cos(a) * r, 0.7, Math.sin(a) * r], rot: [Math.PI + Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25],
    });
  }
  M.willow = {
    parts: [
      { geo: bake([{ geo: cyl(0.04, 0.065, 0.62, 5), color: PAL.trunk, rot: [0, 0, -0.12] }], 0.02), tint: false },
      { geo: bake(fronds, 0.09, 1.1), tint: true },
    ],
    shadow: true,
  };
  // pumpkin: ribbed, squat, with a curly stem (autumn)
  const ribs: PartSpec[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ribs.push({ geo: ico(0.075, 1), color: i % 2 ? '#ffffff' : '#eeeeee', pos: [Math.cos(a) * 0.05, 0.065, Math.sin(a) * 0.05], scale: [0.9, 0.85, 0.9] });
  }
  M.pumpkin = {
    parts: [
      { geo: bake(ribs, 0), tint: true },
      { geo: bake([{ geo: cyl(0.012, 0.018, 0.06, 5), color: '#6f8f4a', pos: [0, 0.12, 0], rot: [0, 0, 0.3] }, { geo: cone(0.03, 0.05, 3), color: '#7fb069', pos: [0.03, 0.13, 0], rot: [0, 0, -1.2] }], 0), tint: false },
    ],
    shadow: true,
  };
  // pine wearing snow on every tier (frost)
  M.snowpine = {
    parts: [
      { geo: bake([trunk(0.3)], 0.02), tint: false },
      {
        geo: bake([
          { geo: cone(0.32, 0.45, 6), color: '#e4e4e4', pos: [0, 0.2, 0] },
          { geo: cone(0.25, 0.4, 6), color: '#f2f2f2', pos: [0, 0.42, 0] },
          { geo: cone(0.17, 0.34, 6), color: '#ffffff', pos: [0, 0.64, 0] },
        ], 0.05), tint: true,
      },
      {
        geo: bake([
          { geo: cone(0.2, 0.12, 6), color: '#f6fafc', pos: [0, 0.53, 0] },
          { geo: cone(0.15, 0.1, 6), color: '#f6fafc', pos: [0, 0.73, 0] },
          { geo: cone(0.1, 0.12, 6), color: '#ffffff', pos: [0, 0.88, 0] },
        ], 0.05), tint: false,
      },
    ],
    shadow: true,
  };
  // palm: a leaning, segmented trunk, drooping fronds and a few coconuts (oasis)
  const palmTrunk: PartSpec[] = [];
  for (let i = 0; i < 6; i++) palmTrunk.push({ geo: cyl(0.04 - i * 0.003, 0.05 - i * 0.003, 0.14, 6), color: i % 2 ? '#a58660' : '#b4946c', pos: [i * 0.018, i * 0.13, 0], rot: [0, 0, -0.12] });
  const palmTop: PartSpec[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    palmTop.push({ geo: cone(0.06, 0.42, 3), color: i % 2 ? '#ffffff' : '#eeeeee', pos: [0.11 + Math.cos(a) * 0.04, 0.8, Math.sin(a) * 0.04], rot: [Math.sin(a) * 1.9, 0, -Math.cos(a) * 1.9], scale: [1, 1, 0.3] });
  }
  M.palm = {
    parts: [
      { geo: bake([...palmTrunk, { geo: ico(0.035, 0), color: '#8b6a4e', pos: [0.13, 0.77, 0.04] }, { geo: ico(0.035, 0), color: '#7a5a40', pos: [0.08, 0.76, -0.04] }], 0.03), tint: false },
      { geo: bake(palmTop, 0.12, 1.2), tint: true },
    ],
    shadow: true,
  };
  // cactus with a pink flower on top (oasis)
  M.cactus = {
    parts: [
      {
        geo: bake([
          { geo: cyl(0.06, 0.07, 0.42, 7), color: '#ffffff' },
          { geo: ico(0.06, 1), color: '#ffffff', pos: [0, 0.42, 0] },
          { geo: cyl(0.035, 0.035, 0.14, 6), color: '#eeeeee', pos: [0.08, 0.15, 0], rot: [0, 0, -1.4] },
          { geo: cyl(0.03, 0.035, 0.14, 6), color: '#eeeeee', pos: [0.14, 0.17, 0] },
          { geo: cyl(0.03, 0.035, 0.1, 6), color: '#e8e8e8', pos: [-0.07, 0.22, 0], rot: [0, 0, 1.4] },
          { geo: cyl(0.026, 0.03, 0.1, 6), color: '#e8e8e8', pos: [-0.12, 0.23, 0] },
        ], 0.01), tint: true,
      },
      { geo: bake([{ geo: ico(0.035, 0), color: '#f49fae', pos: [0, 0.49, 0], scale: [1, 0.6, 1] }, { geo: ico(0.015, 0), color: '#fbe39a', pos: [0, 0.51, 0] }], 0.01), tint: false },
    ],
    shadow: true,
  };
  M.mushroom = {
    parts: [
      { geo: bake([{ geo: cyl(0.025, 0.035, 0.1, 6), color: '#f4ede0' }], 0.02), tint: false },
      {
        geo: bake([
          { geo: new THREE.SphereGeometry(0.075, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), color: '#ffffff', pos: [0, 0.09, 0] },
        ], 0.02), tint: true,
      },
    ],
    shadow: false,
  };
  const reedParts: PartSpec[] = [];
  {
    const r = new RNG(5);
    for (let i = 0; i < 6; i++) {
      const a = r.next() * Math.PI * 2;
      const d = r.range(0, 0.1);
      reedParts.push({ geo: cone(0.015, r.range(0.25, 0.45), 3), color: '#ffffff', pos: [Math.cos(a) * d, 0, Math.sin(a) * d], rot: [r.range(-0.2, 0.2), 0, r.range(-0.2, 0.2)] });
    }
  }
  M.reeds = { parts: [{ geo: bake(reedParts, 0.16), tint: true }], shadow: false };
  M.cattail = {
    parts: [{
      geo: bake([
        { geo: cyl(0.01, 0.012, 0.42, 3), color: '#8fb36e' },
        { geo: cyl(0.025, 0.025, 0.09, 5), color: '#8a5a3b', pos: [0, 0.32, 0] },
        { geo: cyl(0.01, 0.012, 0.34, 3), color: '#8fb36e', pos: [0.05, 0, 0.02], rot: [0, 0, -0.12] },
        { geo: cyl(0.022, 0.022, 0.08, 5), color: '#8a5a3b', pos: [0.08, 0.26, 0.02], rot: [0, 0, -0.12] },
      ], 0.2), tint: false,
    }],
    shadow: false,
  };
  M.rock = {
    parts: [{
      geo: bake([
        { geo: dodec(0.14), color: '#ffffff', pos: [0, 0.07, 0], scale: [1.2, 0.7, 1] },
        { geo: dodec(0.08), color: '#eeeeee', pos: [0.13, 0.03, 0.05], scale: [1, 0.7, 1] },
      ], 0), tint: true,
    }],
    shadow: true,
  };
  M.shell = {
    parts: [{ geo: bake([{ geo: cone(0.05, 0.06, 6), color: '#ffffff', rot: [Math.PI / 2, 0, 0], pos: [0, 0.03, 0], scale: [1, 1, 0.5] }], 0), tint: true }],
    shadow: false,
  };
  const bg: PartSpec[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    bg.push({ geo: cone(0.02, 0.3 + (i % 3) * 0.06, 3), color: '#ffffff', pos: [Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04], rot: [Math.sin(a) * 0.6, 0, Math.cos(a) * 0.6] });
  }
  M.beachgrass = { parts: [{ geo: bake(bg, 0.2), tint: true }], shadow: false };
  const pad = new THREE.CylinderGeometry(0.16, 0.16, 0.015, 9, 1, false, 0.4, Math.PI * 2 - 0.6);
  M.lilypad = {
    parts: [{ geo: bake([{ geo: pad, color: '#ffffff' }], 0), tint: true }],
    shadow: false,
  };
  const fern: PartSpec[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    fern.push({ geo: cone(0.05, 0.3, 3), color: '#ffffff', pos: [Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05], rot: [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9], scale: [1, 1, 0.35] });
  }
  M.fern = { parts: [{ geo: bake(fern, 0.14), tint: true }], shadow: false };
  M.goldflower = {
    parts: [
      { geo: stem, tint: false },
      { geo: bake(petals.map((p) => ({ ...p, scale: [1.3, 0.5, 1.3] as V3 })), 0.18), tint: true },
    ],
    shadow: false,
  };
  return M;
}

/** Hex column (sides only) and bevelled cap. Unit circumradius. */
export function buildTileGeometries() {
  // columns: y in [0,1]
  const col = new THREE.CylinderGeometry(0.97, 0.97, 1, 6, 1, true);
  col.translate(0, 0.5, 0);
  // cap: bevelled top, top face at y=0
  const capTop = new THREE.CylinderGeometry(0.88, 0.97, 0.07, 6, 1, false);
  capTop.translate(0, -0.035, 0);
  const capSide = new THREE.CylinderGeometry(0.97, 0.97, 0.12, 6, 1, true);
  capSide.translate(0, -0.13, 0);
  const cap = mergeGeometries([capTop.toNonIndexed(), capSide.toNonIndexed()].map((g) => {
    g.deleteAttribute('uv');
    return g;
  }))!;
  cap.computeVertexNormals();
  const water = new THREE.CylinderGeometry(0.9, 0.9, 0.04, 6, 1, false);
  water.translate(0, -0.02, 0);
  return { col, cap, water };
}

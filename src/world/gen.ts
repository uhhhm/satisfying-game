// Deterministic island generation on a hex grid.
import { HEX_DIRS, hexToWorld, key } from '../core/hex';
import { Noise2D, RNG } from '../core/math';

export type Biome = 'beach' | 'meadow' | 'forest' | 'marsh' | 'highland' | 'blossom';
export type LandmarkKind =
  | 'cottage' | 'windmill' | 'shrine' | 'stones' | 'greattree' | 'well' | 'lighthouse' | 'pier' | 'pagoda';
export type WonderKind =
  | 'fox' | 'kite' | 'snail' | 'fairyring' | 'owl' | 'stag' | 'heron' | 'float' | 'turtle'
  | 'lantern' | 'moonlily' | 'bell';

export interface TileData {
  i: number;
  q: number;
  r: number;
  x: number; // local to island
  z: number;
  h: number;
  biome: Biome;
  region: number;
  coastDist: number;
  pond: boolean;
  river: number; // -1 none, else river index
  riverOrder: number; // step along river
  spring: boolean;
  wonder: WonderKind | null;
  landmark: LandmarkKind | null;
  neighbors: number[];
  jitter: number; // 0..1 stable per-tile random
}

export interface RiverData {
  path: number[]; // tile indices, source first
}

export interface IslandDef {
  id: number;
  name: string;
  seed: number;
  cx: number;
  cz: number;
  radius: number;
  theme: 'meadow' | 'forest' | 'lakes' | 'highland';
  ponds: number;
  springs: number;
  wonders: WonderKind[];
}

export interface IslandData {
  def: IslandDef;
  tiles: TileData[];
  regions: { tiles: number[]; landmarkTile: number; landmark: LandmarkKind; cx: number; cz: number }[];
  rivers: RiverData[];
  byKey: Map<string, number>;
  maxH: number;
}

export const ISLANDS: IslandDef[] = [
  { id: 0, name: 'Hearthmeadow', seed: 11, cx: 0, cz: 0, radius: 5.3, theme: 'meadow', ponds: 1, springs: 0, wonders: ['fox', 'kite', 'snail'] },
  { id: 1, name: 'Wildwood', seed: 23, cx: 31, cz: -13, radius: 6.9, theme: 'forest', ponds: 2, springs: 0, wonders: ['fairyring', 'owl', 'stag'] },
  { id: 2, name: 'Mirrormere', seed: 37, cx: 11, cz: -41, radius: 7.8, theme: 'lakes', ponds: 4, springs: 3, wonders: ['heron', 'float', 'turtle'] },
  { id: 3, name: 'Lanternfell', seed: 51, cx: -26, cz: -28, radius: 8.4, theme: 'highland', ponds: 2, springs: 2, wonders: ['lantern', 'moonlily', 'bell'] },
];

const STEP = 0.24;

export function generateIsland(def: IslandDef): IslandData {
  const rng = new RNG(def.seed * 7919);
  const noise = new Noise2D(def.seed);
  const noise2 = new Noise2D(def.seed + 99);
  const R = def.radius;
  const Rmax = Math.ceil(R * 1.5);
  const cand: { q: number; r: number; x: number; z: number; v: number }[] = [];
  for (let q = -Rmax; q <= Rmax; q++) {
    for (let r = -Rmax; r <= Rmax; r++) {
      if (Math.abs(q + r) > Rmax) continue;
      const [x, z] = hexToWorld(q, r);
      const d = Math.hypot(x, z) / (R * 1.732);
      const n = noise.fbm(x * 0.11 + 3.1, z * 0.11 - 1.7, 3);
      const v = 1 - d + n * 0.42;
      if (v > 0.16) cand.push({ q, r, x, z, v });
    }
  }
  // keep the component connected to the centre
  const cmap = new Map<string, number>();
  cand.forEach((c, i) => cmap.set(key(c.q, c.r), i));
  let start = 0;
  let best = 1e9;
  cand.forEach((c, i) => {
    const d = Math.hypot(c.x, c.z);
    if (d < best) {
      best = d;
      start = i;
    }
  });
  const keep = new Set<number>([start]);
  const stack = [start];
  while (stack.length) {
    const i = stack.pop()!;
    const c = cand[i];
    for (const [dq, dr] of HEX_DIRS) {
      const j = cmap.get(key(c.q + dq, c.r + dr));
      if (j !== undefined && !keep.has(j)) {
        keep.add(j);
        stack.push(j);
      }
    }
  }
  const kept = cand.filter((_, i) => keep.has(i));

  const tiles: TileData[] = kept.map((c, i) => ({
    i, q: c.q, r: c.r, x: c.x, z: c.z, h: 0, biome: 'meadow', region: 0, coastDist: 0,
    pond: false, river: -1, riverOrder: -1, spring: false, wonder: null, landmark: null,
    neighbors: [], jitter: rng.next(),
  }));
  const byKey = new Map<string, number>();
  tiles.forEach((t) => byKey.set(key(t.q, t.r), t.i));
  for (const t of tiles) {
    for (const [dq, dr] of HEX_DIRS) {
      const j = byKey.get(key(t.q + dq, t.r + dr));
      if (j !== undefined) t.neighbors.push(j);
    }
  }
  // coast distance via BFS
  const cd = new Array(tiles.length).fill(-1);
  const queue: number[] = [];
  for (const t of tiles) {
    if (t.neighbors.length < 6) {
      cd[t.i] = 0;
      queue.push(t.i);
    }
  }
  while (queue.length) {
    const i = queue.shift()!;
    for (const j of tiles[i].neighbors) {
      if (cd[j] < 0) {
        cd[j] = cd[i] + 1;
        queue.push(j);
      }
    }
  }
  tiles.forEach((t) => (t.coastDist = cd[t.i]));
  const maxCD = Math.max(...cd);

  // heights: terraced, rising inland
  const hScale = def.theme === 'highland' ? 2.9 : def.theme === 'lakes' ? 1.5 : def.theme === 'forest' ? 2.2 : 1.7;
  for (const t of tiles) {
    const n2 = noise2.fbm(t.x * 0.17, t.z * 0.17, 3);
    const inland = t.coastDist / Math.max(1, maxCD);
    let h = 0.22 + inland * hScale * (0.75 + n2 * 0.6) + n2 * 0.25;
    if (t.coastDist === 0) h = Math.min(h, 0.22 + rng.next() * 0.1);
    if (t.coastDist === 1) h = Math.min(h, 0.5);
    t.h = Math.max(0.2, Math.round(h / STEP) * STEP);
  }

  // rivers: spring on a high inland tile, descend toward the coast
  const rivers: RiverData[] = [];
  if (def.springs > 0) {
    const highs = tiles
      .filter((t) => t.coastDist >= Math.max(2, Math.floor(maxCD * 0.6)))
      .sort((a, b) => b.h - a.h || b.coastDist - a.coastDist);
    const chosen: TileData[] = [];
    for (const t of highs) {
      if (chosen.length >= def.springs) break;
      if (chosen.every((c) => Math.hypot(c.x - t.x, c.z - t.z) > 5)) chosen.push(t);
    }
    chosen.forEach((src, ri) => {
      const path = [src.i];
      let cur = src;
      src.spring = true;
      let guard = 0;
      while (cur.coastDist > 0 && guard++ < 40) {
        const opts = cur.neighbors
          .map((j) => tiles[j])
          .filter((n) => n.coastDist < cur.coastDist && n.river < 0 && !path.includes(n.i));
        if (!opts.length) break;
        opts.sort((a, b) => a.h - b.h + (rng.next() - 0.5) * 0.3);
        const nx = opts[0];
        nx.h = Math.min(nx.h, cur.h);
        path.push(nx.i);
        cur = nx;
      }
      path.forEach((ti, k) => {
        tiles[ti].river = ri;
        tiles[ti].riverOrder = k;
      });
      rivers.push({ path });
    });
  }

  // ponds: local minima inland (lakes theme grows them into small lakes)
  if (def.ponds > 0) {
    const inland = tiles.filter((t) => t.coastDist >= 2 && t.river < 0 && !t.spring);
    inland.sort((a, b) => a.h - b.h + (a.jitter - b.jitter) * 0.6);
    const ponds: TileData[] = [];
    for (const t of inland) {
      if (ponds.length >= def.ponds) break;
      if (ponds.every((p) => Math.hypot(p.x - t.x, p.z - t.z) > 4.5) &&
        !t.neighbors.some((j) => tiles[j].river >= 0)) ponds.push(t);
    }
    for (const p of ponds) {
      p.pond = true;
      if (def.theme === 'lakes') {
        for (const j of p.neighbors) {
          const n = tiles[j];
          if (n.coastDist >= 1 && n.river < 0 && !n.spring && rng.chance(0.45)) {
            n.pond = true;
            n.h = p.h;
          }
        }
      }
    }
  }

  // biomes
  const bnoise = new Noise2D(def.seed + 7);
  for (const t of tiles) {
    const b = bnoise.fbm(t.x * 0.2, t.z * 0.2, 2);
    const nearWater = t.pond || t.neighbors.some((j) => tiles[j].pond || tiles[j].river >= 0);
    let biome: Biome = 'meadow';
    if (t.coastDist === 0 && t.h <= 0.35) biome = 'beach';
    else if (def.theme === 'meadow') biome = b > 0.28 ? 'forest' : 'meadow';
    else if (def.theme === 'forest') biome = b < -0.3 ? 'meadow' : 'forest';
    else if (def.theme === 'lakes') biome = nearWater || b > 0.25 ? 'marsh' : b < -0.35 ? 'forest' : 'meadow';
    else biome = t.h > 2.1 ? 'highland' : b > 0.1 ? 'blossom' : b < -0.35 ? 'forest' : 'meadow';
    if (t.pond && biome === 'beach') biome = 'marsh';
    t.biome = biome;
  }

  // regions (k-means on world positions, farthest point init)
  const k = Math.max(3, Math.round(tiles.length / 13));
  const seeds: [number, number][] = [];
  seeds.push([tiles[Math.floor(rng.next() * tiles.length)].x, tiles[0].z]);
  while (seeds.length < k) {
    let bestT = tiles[0];
    let bestD = -1;
    for (const t of tiles) {
      const d = Math.min(...seeds.map((s) => Math.hypot(s[0] - t.x, s[1] - t.z)));
      if (d > bestD) {
        bestD = d;
        bestT = t;
      }
    }
    seeds.push([bestT.x, bestT.z]);
  }
  for (let it = 0; it < 6; it++) {
    for (const t of tiles) {
      let bi = 0, bd = 1e9;
      seeds.forEach((s, si) => {
        const d = Math.hypot(s[0] - t.x, s[1] - t.z);
        if (d < bd) {
          bd = d;
          bi = si;
        }
      });
      t.region = bi;
    }
    seeds.forEach((s, si) => {
      const mem = tiles.filter((t) => t.region === si);
      if (!mem.length) return;
      s[0] = mem.reduce((a, t) => a + t.x, 0) / mem.length;
      s[1] = mem.reduce((a, t) => a + t.z, 0) / mem.length;
    });
  }
  // drop empty regions, re-index
  const used = [...new Set(tiles.map((t) => t.region))].sort((a, b) => a - b);
  const remap = new Map(used.map((r, i) => [r, i]));
  tiles.forEach((t) => (t.region = remap.get(t.region)!));

  const regions = used.map((oldR, ri) => {
    const mem = tiles.filter((t) => t.region === ri);
    const cx = seeds[oldR][0];
    const cz = seeds[oldR][1];
    const coastal = mem.filter((t) => t.coastDist === 0).length / mem.length;
    const counts: Record<string, number> = {};
    mem.forEach((t) => (counts[t.biome] = (counts[t.biome] || 0) + 1));
    const dom = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as Biome;
    const eligible = mem.filter((t) => !t.pond && t.river < 0 && !t.spring);
    eligible.sort((a, b) => {
      const da = Math.hypot(a.x - cx, a.z - cz) - (coastal > 0.35 && a.coastDist === 0 ? 2 : 0);
      const db = Math.hypot(b.x - cx, b.z - cz) - (coastal > 0.35 && b.coastDist === 0 ? 2 : 0);
      return da - db;
    });
    const lt = eligible[0] ?? mem[0];
    let kind: LandmarkKind;
    if (lt.coastDist === 0 && coastal > 0.35) kind = rng.chance(0.6) ? 'lighthouse' : 'pier';
    else if (dom === 'forest') kind = rng.pick(['greattree', 'shrine', 'cottage'] as const);
    else if (dom === 'highland') kind = rng.pick(['stones', 'pagoda', 'windmill'] as const);
    else if (dom === 'blossom') kind = rng.pick(['pagoda', 'shrine', 'cottage'] as const);
    else if (dom === 'marsh') kind = rng.pick(['well', 'windmill', 'cottage'] as const);
    else kind = rng.pick(['cottage', 'windmill', 'well', 'cottage'] as const);
    lt.landmark = kind;
    return { tiles: mem.map((t) => t.i), landmarkTile: lt.i, landmark: kind, cx, cz };
  });
  // prefer variety: avoid repeating the same landmark more than twice
  const seen: Record<string, number> = {};
  for (const rg of regions) {
    seen[rg.landmark] = (seen[rg.landmark] || 0) + 1;
    if (seen[rg.landmark] > 2 && rg.landmark !== 'lighthouse') {
      const alt: LandmarkKind[] = ['cottage', 'well', 'windmill', 'shrine', 'stones', 'greattree'];
      rg.landmark = alt[(rg.landmarkTile + seen[rg.landmark]) % alt.length];
      tiles[rg.landmarkTile].landmark = rg.landmark;
    }
  }

  // wonders: spread out, inland-ish, different regions
  const wonderTiles: TileData[] = [];
  const pool = tiles
    .filter((t) => !t.pond && t.river < 0 && !t.spring && !t.landmark && t.coastDist >= 1)
    .sort((a, b) => a.jitter - b.jitter);
  for (const w of def.wonders) {
    const water = w === 'heron' || w === 'turtle' || w === 'float' || w === 'moonlily';
    let cands = pool.filter((t) => !wonderTiles.includes(t));
    if (water) {
      const wet = cands.filter((t) => t.neighbors.some((j) => tiles[j].pond || tiles[j].river >= 0) || t.coastDist === 1);
      if (wet.length) cands = wet;
    }
    const t = cands.find((c) =>
      wonderTiles.every((o) => Math.hypot(o.x - c.x, o.z - c.z) > 4 && o.region !== c.region)) ?? cands[0];
    if (t) {
      t.wonder = w;
      wonderTiles.push(t);
    }
  }

  const maxH = Math.max(...tiles.map((t) => t.h));
  return { def, tiles, regions, rivers, byKey, maxH };
}

// Small math helpers, seeded RNG, simplex noise and damped springs.

export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => clamp((v - a) / (b - a));
export const smooth = (t: number) => t * t * (3 - 2 * t);
export const TAU = Math.PI * 2;

/** Frame-rate independent exponential approach. */
export const damp = (a: number, b: number, lambda: number, dt: number) =>
  lerp(a, b, 1 - Math.exp(-lambda * dt));

/** Overshooting ease (for one-shot curves where a spring is awkward). */
export const easeOutBack = (t: number, s = 1.70158) => {
  const u = t - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
};
export const easeOutElastic = (t: number) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return Math.pow(2, -9 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
};
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

// ---------------------------------------------------------------- RNG
export class RNG {
  private s: number;
  constructor(seed = 1) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    // mulberry32
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number) {
    return Math.floor(this.range(a, b + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p: number) {
    return this.next() < p;
  }
  /** roughly gaussian in [-1,1] */
  soft() {
    return (this.next() + this.next() + this.next()) / 1.5 - 1;
  }
}

/** Global non-deterministic randomness for feel jitter. */
export const rand = (a = 0, b = 1) => a + (b - a) * Math.random();
export const randSoft = () => (Math.random() + Math.random() + Math.random()) / 1.5 - 1;
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

// ---------------------------------------------------------------- Simplex 2D
export class Noise2D {
  private perm = new Uint8Array(512);
  private grad = [
    [1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1],
  ];
  constructor(seed = 1) {
    const r = new RNG(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(r.next() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  get(xin: number, yin: number): number {
    const F2 = 0.5 * (Math.sqrt(3) - 1);
    const G2 = (3 - Math.sqrt(3)) / 6;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    const corner = (x: number, y: number, gi: number) => {
      let tt = 0.5 - x * x - y * y;
      if (tt < 0) return 0;
      tt *= tt;
      const g = this.grad[gi & 7];
      return tt * tt * (g[0] * x + g[1] * y);
    };
    n += corner(x0, y0, this.perm[ii + this.perm[jj]]);
    n += corner(x1, y1, this.perm[ii + i1 + this.perm[jj + j1]]);
    n += corner(x2, y2, this.perm[ii + 1 + this.perm[jj + 1]]);
    return 70 * n; // ~[-1,1]
  }
  fbm(x: number, y: number, oct = 4) {
    let a = 0.5, f = 1, s = 0, n = 0;
    for (let o = 0; o < oct; o++) {
      s += a * this.get(x * f, y * f);
      n += a;
      a *= 0.5;
      f *= 2;
    }
    return s / n;
  }
}

// ---------------------------------------------------------------- Springs
/**
 * Damped harmonic spring, integrated with fixed sub-steps so it stays stable
 * at any frame rate. `k` is stiffness, `c` damping. Values chosen in config.
 */
export class Spring {
  value: number;
  target: number;
  vel = 0;
  constructor(v = 0, public k = 170, public c = 14) {
    this.value = v;
    this.target = v;
  }
  update(dt: number) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = (this.target - this.value) * this.k - this.vel * this.c;
      this.vel += a * h;
      this.value += this.vel * h;
    }
    return this.value;
  }
  impulse(v: number) {
    this.vel += v;
  }
  snap(v: number) {
    this.value = this.target = v;
    this.vel = 0;
  }
  get settled() {
    return Math.abs(this.vel) < 0.002 && Math.abs(this.target - this.value) < 0.002;
  }
}

/** Integrate one spring step without object overhead (for big arrays). */
export function springStep(
  pos: number, vel: number, target: number, k: number, c: number, dt: number,
): [number, number] {
  const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const a = (target - pos) * k - vel * c;
    vel += a * h;
    pos += vel * h;
  }
  return [pos, vel];
}

export class Spring3 {
  x: Spring;
  y: Spring;
  z: Spring;
  constructor(x = 0, y = 0, z = 0, k = 120, c = 14) {
    this.x = new Spring(x, k, c);
    this.y = new Spring(y, k, c);
    this.z = new Spring(z, k, c);
  }
  setTarget(x: number, y: number, z: number) {
    this.x.target = x;
    this.y.target = y;
    this.z.target = z;
  }
  setParams(k: number, c: number) {
    this.x.k = this.y.k = this.z.k = k;
    this.x.c = this.y.c = this.z.c = c;
  }
  update(dt: number) {
    this.x.update(dt);
    this.y.update(dt);
    this.z.update(dt);
  }
  snap(x: number, y: number, z: number) {
    this.x.snap(x);
    this.y.snap(y);
    this.z.snap(z);
  }
}

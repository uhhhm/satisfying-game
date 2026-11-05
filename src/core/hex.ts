// Pointy-top axial hex grid helpers. Circumradius = 1 world unit.
export const SQRT3 = Math.sqrt(3);
export const HEX_DIRS: ReadonlyArray<[number, number]> = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

export const key = (q: number, r: number) => `${q},${r}`;

export function hexToWorld(q: number, r: number): [number, number] {
  return [SQRT3 * (q + r / 2), 1.5 * r];
}

export function worldToHex(x: number, z: number): [number, number] {
  const q = (SQRT3 / 3) * x - z / 3;
  const r = (2 / 3) * z;
  return hexRound(q, r);
}

export function hexRound(q: number, r: number): [number, number] {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return [rq, rr];
}

export const hexDist = (q1: number, r1: number, q2: number, r2: number) =>
  (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;

// Island themes: everything that gives an island its own identity lives in one data entry —
// palette, which plants grow, which landmarks it favours, its sky tint, musical key and ambience.
// The four authored themes keep the original look; the four "far" themes appear in endless mode.
import type { Timbre } from '../audio/engine';
import type { Biome, LandmarkKind } from './gen';
import type { DecorKind } from './models';
import { RNG } from '../core/math';

export type Theme = 'meadow' | 'forest' | 'lakes' | 'highland' | 'autumn' | 'frost' | 'ember' | 'oasis';
type Tinted = 'meadow' | 'forest' | 'marsh' | 'highland' | 'blossom' | 'sand';

export interface ThemeStyle {
  /** shown under the island name the first time you arrive */
  label: string;
  /** alive and lush colours per biome */
  colors?: Partial<Record<Tinted, [string, string]>>;
  soil?: string;
  water?: string;
  flowers?: string[];
  leaves?: string[];
  /** what grows on stage 3 and what a tap plants, per biome ([] = nothing) */
  trees?: Partial<Record<Biome, DecorKind[]>>;
  treeTints?: Partial<Record<DecorKind, string[]>>;
  /** a little extra sprinkle at stage 2 */
  extra?: Partial<Record<Biome, { kind: DecorKind; tints: string[]; chance: number; scale?: number }>>;
  landmarks?: Partial<Record<Biome, LandmarkKind[]>>;
  /** semitones from D */
  key: number;
  sky?: { color: string; amt: number };
  amb: { wind: number; birds: number; cicada: number; bubbles: number; tinkle: number; rustle: number };
  motes?: { colors: string[]; shape: 'leaf' | 'dot' | 'petal'; rate: number; rise: boolean };
  timbre?: Partial<Record<Biome, Timbre>>;
  names: [string[], string[]];
}

const AMB = { wind: 1, birds: 1, cicada: 0, bubbles: 0, tinkle: 0, rustle: 0 };

export const THEME_STYLE: Record<Theme, ThemeStyle> = {
  meadow: { label: 'a meadow isle', key: 0, amb: AMB, names: [['Clover', 'Dew', 'Lark', 'Honey', 'Sorrel'], ['mead', 'field', 'down', 'leigh']] },
  forest: { label: 'a wooded isle', key: 0, amb: AMB, names: [['Fern', 'Oak', 'Bracken', 'Hazel', 'Moss'], ['hollow', 'wood', 'shaw', 'grove']] },
  lakes: { label: 'an isle of pools', key: 0, amb: AMB, names: [['Reed', 'Willow', 'Still', 'Mere', 'Brook'], ['mere', 'water', 'pool', 'isle']] },
  highland: { label: 'a high isle', key: 0, amb: AMB, names: [['Thistle', 'Heather', 'Crag', 'Larch', 'Bell'], ['fell', 'top', 'crag', 'brae']] },

  autumn: {
    label: 'an autumn isle',
    colors: { meadow: ['#d6c27c', '#e2b862'], forest: ['#cf9a5c', '#c07c44'], highland: ['#c9b88a', '#d2a86a'], marsh: ['#b9c48a', '#c8b874'] },
    flowers: ['#f2a65a', '#e9c46a', '#d9826b', '#f4d35e', '#fbe39a', '#e07a5f'],
    leaves: ['#e9a14f', '#d9826b', '#e9c46a', '#c97a3a', '#f2c14e'],
    trees: { forest: ['roundtree', 'roundtree', 'birch'], meadow: ['roundtree', 'birch'], highland: ['birch'], marsh: ['birch'] },
    treeTints: { roundtree: ['#e07a3a', '#e9a14f', '#d4553a', '#e9c46a', '#d98a4a'], birch: ['#f2c14e', '#e9a14f', '#f4d35e'] },
    extra: { meadow: { kind: 'pumpkin', tints: ['#e98a3a', '#f2a65a', '#e07a3a'], chance: 0.35 }, forest: { kind: 'mushroom', tints: ['#d4553a', '#e9c46a'], chance: 0.4 } },
    landmarks: { meadow: ['barn', 'haystack', 'cottage'], forest: ['cottage', 'greattree', 'haystack'], highland: ['windmill', 'barn', 'stones'], marsh: ['well', 'barn', 'cottage'] },
    key: -5,
    sky: { color: '#f2c48a', amt: 0.16 },
    amb: { ...AMB, wind: 1.3, birds: 0.7, rustle: 1 },
    motes: { colors: ['#e9a14f', '#d9826b', '#e9c46a', '#c97a3a'], shape: 'leaf', rate: 3, rise: false },
    timbre: { meadow: 'marimba', forest: 'kalimba', highland: 'harp' },
    names: [['Amber', 'Rust', 'Copper', 'Maple', 'Russet', 'Harvest'], ['fold', 'wick', 'dale', 'combe', 'stead']],
  },
  frost: {
    label: 'a frost isle',
    colors: { meadow: ['#d8ece4', '#e8f5ef'], forest: ['#bfdcd2', '#acd0c4'], highland: ['#eef4f6', '#fbfdfe'], marsh: ['#cde8e2', '#dcf0ea'], sand: ['#e6e2da', '#eeeae2'] },
    soil: '#8c8a94',
    water: '#a6dbe8',
    flowers: ['#ffffff', '#c9e4f5', '#d9d0f5', '#a8d8f0', '#f6d6e4'],
    leaves: ['#eef5f8', '#d6e8ee', '#ffffff'],
    trees: { forest: ['snowpine', 'snowpine', 'birch'], meadow: ['snowpine', 'birch'], highland: ['snowpine'], marsh: ['birch'] },
    treeTints: { snowpine: ['#5f8f7a', '#6b9a86', '#58857a'], birch: ['#dfe9e0', '#c9dccf'] },
    extra: { highland: { kind: 'rock', tints: ['#e9eef2', '#dde4ea'], chance: 0.5 } },
    landmarks: { meadow: ['igloo', 'cairn', 'cottage'], forest: ['igloo', 'cairn', 'greattree'], highland: ['cairn', 'stones', 'igloo'], marsh: ['igloo', 'well', 'cairn'] },
    key: 3,
    sky: { color: '#d4e6f4', amt: 0.24 },
    amb: { ...AMB, wind: 1.8, birds: 0.3, tinkle: 1 },
    motes: { colors: ['#ffffff', '#eef6fb'], shape: 'dot', rate: 7, rise: false },
    timbre: { meadow: 'celesta', forest: 'glass', highland: 'bell', marsh: 'glass', beach: 'celesta' },
    names: [['Rime', 'Frost', 'Snow', 'Winter', 'Hoar', 'Pale'], ['holm', 'fell', 'mere', 'reach', 'skerry']],
  },
  ember: {
    label: 'an ember isle',
    colors: { meadow: ['#86b46e', '#74a862'], forest: ['#5f9460', '#4f8452'], highland: ['#5e5862', '#6c6572'], marsh: ['#6fa88a', '#5f9a7c'], sand: ['#55505a', '#5f5964'] },
    soil: '#3f3a42',
    water: '#72cbc0',
    flowers: ['#f49f6a', '#e9c46a', '#d9826b', '#c9b6f0', '#ffcf8a'],
    leaves: ['#86b46e', '#5f9460', '#ffcf8a'],
    trees: { forest: ['pine', 'roundtree'], meadow: ['roundtree'], highland: [], marsh: ['birch'] },
    treeTints: { roundtree: ['#5f9a63', '#6aa36b', '#4f8e5c'], pine: ['#4f8452', '#5a9060'] },
    extra: { forest: { kind: 'mushroom', tints: ['#8fe0e6', '#b8f0c8', '#a8d8f0'], chance: 0.65 }, meadow: { kind: 'fern', tints: ['#6aa36b'], chance: 0.4 } },
    landmarks: { meadow: ['stilthut', 'shrine', 'well'], forest: ['stilthut', 'greattree', 'shrine'], highland: ['stones', 'stilthut', 'cairn'], marsh: ['stilthut', 'well', 'shrine'] },
    key: -2,
    sky: { color: '#caa4b4', amt: 0.16 },
    amb: { ...AMB, wind: 0.6, birds: 0.5, bubbles: 1 },
    motes: { colors: ['#ffcf8a', '#ffb070', '#fff1a8'], shape: 'dot', rate: 2, rise: true },
    timbre: { meadow: 'kalimba', forest: 'glass', highland: 'bell', beach: 'marimba' },
    names: [['Cinder', 'Ash', 'Ember', 'Basalt', 'Smoke', 'Coal'], ['cove', 'key', 'isle', 'haven', 'rock']],
  },
  oasis: {
    label: 'an oasis isle',
    colors: { meadow: ['#a8d27c', '#8cc66a'], highland: ['#d9b48a', '#e2c19a'], marsh: ['#9fd4a8', '#8ccc9a'], sand: ['#efd8a6', '#f3e0b6'] },
    water: '#7fd8cf',
    flowers: ['#f49fae', '#fbe39a', '#f7c59f', '#ffffff', '#f6b8c8'],
    leaves: ['#a9cf6e', '#e9dcae', '#8cbf6a'],
    trees: { meadow: ['palm', 'palm', 'roundtree'], highland: ['cactus', 'palm'], beach: ['cactus', 'palm'], marsh: ['palm'] },
    treeTints: { palm: ['#8cbf6a', '#9cc46e', '#7fb069'], cactus: ['#7fb069', '#8cbf6a', '#6fa860'] },
    extra: { beach: { kind: 'cactus', tints: ['#7fb069', '#8cbf6a'], chance: 0.22, scale: 0.6 } },
    landmarks: { meadow: ['tent', 'well', 'cottage'], highland: ['tent', 'stones', 'pagoda'], beach: ['tent', 'well'], marsh: ['well', 'tent', 'cottage'] },
    key: 2,
    sky: { color: '#f4d8a2', amt: 0.2 },
    amb: { ...AMB, wind: 1.2, birds: 0.6, cicada: 1 },
    motes: { colors: ['#f3e0b4', '#fff3d0'], shape: 'dot', rate: 1.5, rise: false },
    timbre: { meadow: 'kalimba', beach: 'marimba', highland: 'harp' },
    names: [['Dune', 'Sun', 'Palm', 'Mirage', 'Saffron', 'Amber'], ['well', 'spring', 'sands', 'rest', 'oasis']],
  },
};

/** The far themes appear first, then everything rotates without repeating back to back. */
const FIRST_CYCLE: Theme[] = ['autumn', 'oasis', 'frost', 'meadow', 'ember', 'lakes', 'forest', 'highland'];
const ALL: Theme[] = FIRST_CYCLE.slice();

export function themeForEndless(n: number): Theme {
  if (n < FIRST_CYCLE.length) return FIRST_CYCLE[n];
  const cycle = Math.floor(n / ALL.length);
  const order = ALL.slice();
  const r = new RNG(777 + cycle * 31);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(r.next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  // never the same theme twice in a row across a cycle boundary
  const prev = themeForEndless(n - (n % ALL.length) - 1);
  if (order[0] === prev) [order[0], order[1]] = [order[1], order[0]];
  return order[n % ALL.length];
}

/** A name from the theme's word lists, avoiding ones already used. */
export function themedName(theme: Theme, seed: number, used: Set<string>) {
  const [a, b] = THEME_STYLE[theme].names;
  const r = new RNG(seed);
  for (let k = 0; k < 40; k++) {
    const n = a[Math.floor(r.next() * a.length)] + b[Math.floor(r.next() * b.length)];
    if (!used.has(n)) return n;
  }
  return a[Math.floor(r.next() * a.length)] + b[Math.floor(r.next() * b.length)] + ' ' + ['Minor', 'Major', 'Far', 'Little'][seed % 4];
}

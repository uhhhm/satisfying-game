// localStorage persistence.
import type { EcoSave } from './ecosystem';
const KEY = 'petrichor-save-v1';

export interface SaveData {
  v: number;
  unlocked: number;
  islands: { m: number[]; s: string; rd: boolean[]; rv: boolean[]; c: boolean }[];
  planted: [number, number, string][];
  wonders: string[];
  golden: number;
  goldenTiles: [number, number][];
  freePlay: boolean;
  tod: number;
  playTime: number;
  settings: { alwaysRain: boolean; muted: boolean; music: number; sfx: number; amb: number };
  /** kinships and visitors (absent in older saves) */
  eco?: EcoSave;
}

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    if (d.v !== 1 || !Array.isArray(d.islands)) return null;
    return d;
  } catch {
    return null;
  }
}

export function writeSave(d: SaveData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* storage full or blocked: play on */
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

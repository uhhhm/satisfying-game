// Kinships: little ecosystem rules. When two living things sit side by side, a third thing grows
// between them. Pure data here; the logic lives in game/ecosystem.ts.
import type { Timbre } from '../audio/engine';
import type { WonderKind } from './gen';

export type KinRule = 'hive' | 'hollow' | 'thicket' | 'reedbed' | 'garden' | 'lanterns';
export type VisitorKind = 'rabbit' | 'hedgehog' | 'duck';

export interface KinInfo {
  name: string;
  /** shown once discovered */
  line: string;
  /** shown before it's discovered: a gentle nudge, not an instruction */
  riddle: string;
  /** pictogram recipe, used in the journal and in visitors' thought bubbles */
  recipe: string;
  timbre: Timbre;
  visitor: VisitorKind;
}

export const KIN_ORDER: KinRule[] = ['hive', 'hollow', 'thicket', 'reedbed', 'garden', 'lanterns'];

export const KIN_INFO: Record<KinRule, KinInfo> = {
  hive: {
    name: 'Beehive', line: 'Three patches of flowers, side by side.', riddle: 'Flowers like company.',
    recipe: '🌼🌼🌼', timbre: 'marimba', visitor: 'rabbit',
  },
  hollow: {
    name: 'Fern Hollow', line: 'Something deep and green beside the water.', riddle: 'Deep green, by still water.',
    recipe: '🌳💧', timbre: 'kalimba', visitor: 'duck',
  },
  thicket: {
    name: 'Thicket', line: 'Three trees, close enough to whisper.', riddle: 'Trees whisper to trees.',
    recipe: '🌳🌳🌳', timbre: 'harp', visitor: 'hedgehog',
  },
  reedbed: {
    name: 'Reed Bed', line: 'Water with lush green banks.', riddle: 'Water wants green banks.',
    recipe: '💧🌿🌿', timbre: 'glass', visitor: 'duck',
  },
  garden: {
    name: 'Cottage Garden', line: 'Flowers all around a cottage.', riddle: 'A home among flowers.',
    recipe: '🏡🌷', timbre: 'celesta', visitor: 'rabbit',
  },
  lanterns: {
    name: 'Lantern Tree', line: 'A blossom tree beside a shrine.', riddle: 'Pink petals near a shrine.',
    recipe: '🌸⛩️', timbre: 'bell', visitor: 'rabbit',
  },
};

/** Which wonder appears the first time a kinship forms on a given island. */
export const KIN_WONDERS: Record<number, Partial<Record<KinRule, WonderKind>>> = {
  0: { garden: 'fox', hollow: 'snail' },
  1: { hollow: 'fairyring', thicket: 'owl' },
  2: { reedbed: 'heron', hollow: 'turtle' },
  3: { lanterns: 'lantern', reedbed: 'moonlily' },
};

/** These stay hidden under a random tile: lucky finds while raining. */
export const LUCKY_WONDERS = new Set<WonderKind>(['kite', 'stag', 'float', 'bell']);

/** The kinship that brings a wonder, if any. */
export function wonderSource(kind: WonderKind): { island: number; rule: KinRule } | null {
  for (const [island, map] of Object.entries(KIN_WONDERS)) {
    for (const [rule, w] of Object.entries(map)) if (w === kind) return { island: Number(island), rule: rule as KinRule };
  }
  return null;
}

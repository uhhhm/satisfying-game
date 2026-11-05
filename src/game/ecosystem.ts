// The living layer on top of rain-and-bloom.
//
// Kinships: when two living things sit side by side, a third thing grows between them (flowers
// clustered → a beehive; something lush beside water → a fern hollow and a frog; …). Rules are
// read off the board, never off a menu. They're purely additive: nothing decays, nothing is lost,
// and rain alone still restores every island.
//
// Visitors: after a grove is finished, now and then a small creature waits at its edge with a
// thought bubble showing a recipe. Make that kinship happen in the grove and it moves in, and the
// grove's landmark gains a few homely touches. Visitors never leave and can be ignored.
import * as THREE from 'three';
import { pick, rand, randSoft } from '../core/math';
import { SHAPE } from '../fx/particles';
import type { Game } from './game';
import type { Island } from '../world/island';
import type { TileData } from '../world/gen';
import type { DecorKind } from '../world/models';
import type { Critter } from '../world/critters';
import { FLOWER_COLORS } from '../world/models';
import { KIN_INFO, KIN_ORDER, KinRule, kinWonderFor } from '../world/kinships';

export interface Kin {
  ii: number;
  rule: KinRule;
  /** the tile the rule is anchored on (its grove is the kinship's grove) */
  anchor: number;
  /** the second tile involved (water, a flower patch, a blossom tree…); may equal anchor */
  payload: number;
  region: number;
}

interface Visitor {
  ii: number;
  region: number;
  rule: KinRule;
  tile: number;
  critter: Critter;
  bubble: HTMLElement | null;
  satisfied: boolean;
}

export interface EcoSave {
  kin: [number, KinRule, number, number][];
  /** island, grove, rule, tile, satisfied */
  vis: [number, number, KinRule, number, number][];
  /** totals from unloaded islands, and every kinship ever discovered */
  sk?: Partial<Record<KinRule, number>>;
  sr?: number;
  disc?: KinRule[];
}

const FLOWERY = new Set(['meadow', 'blossom', 'highland']);
// what a tile *could* become (used to pick requests that are possible)
const groundOK = (t: TileData) => !t.pond && t.river < 0 && !t.landmark && t.biome !== 'beach';
const floweryOK = (t: TileData) => groundOK(t) && FLOWERY.has(t.biome);
const waterOK = (t: TileData) => t.pond || t.river >= 0;
/** homes a garden can grow around */
const HOMES = ['cottage', 'barn', 'stilthut', 'tent', 'igloo'];
const isHome = (t: TileData) => !!t.landmark && HOMES.includes(t.landmark);

const tmp = new THREE.Vector3();

export class Ecosystem {
  kins: Kin[] = [];
  discovered = new Set<KinRule>();
  visitors: Visitor[] = [];
  private formed = new Set<string>();
  private queue: Kin[] = [];
  private celebrateT = 0;
  private scanT = 1;
  private visitT = 30;
  /** the first scan after starting is silent (catches up older saves without a parade) */
  private silent = true;
  private everVisited = false;
  /** kinships and residents on islands that have since been unloaded */
  settledKins: Partial<Record<KinRule, number>> = {};
  settledResidents = 0;

  constructor(private g: Game) {}

  // ---------------------------------------------------------------- live state
  private water(isl: Island, i: number) {
    const t = isl.tiles[i];
    return (t.pond && isl.stage[i] > 0) || (t.river >= 0 && isl.waterT[i] > 0);
  }
  private flowery(isl: Island, i: number) {
    return isl.stage[i] >= 2 && floweryOK(isl.tiles[i]);
  }
  private lush(isl: Island, i: number) {
    return groundOK(isl.tiles[i]) && (isl.stage[i] >= 3 || isl.hasTree[i] > 0);
  }
  private tree(isl: Island, i: number) {
    return groundOK(isl.tiles[i]) && isl.hasTree[i] > 0;
  }
  private built(isl: Island, i: number, kinds: string[]) {
    const t = isl.tiles[i];
    return !!t.landmark && kinds.includes(t.landmark) && isl.regionDone[t.region];
  }

  /** If `rule` holds at tile i right now, the payload tile; otherwise -1. */
  private test(rule: KinRule, isl: Island, i: number): number {
    const nb = isl.tiles[i].neighbors;
    switch (rule) {
      case 'hive':
        return this.flowery(isl, i) && nb.filter((j) => this.flowery(isl, j)).length >= 2 ? i : -1;
      case 'hollow': {
        if (!this.lush(isl, i)) return -1;
        return nb.find((j) => this.water(isl, j)) ?? -1;
      }
      case 'thicket':
        return this.tree(isl, i) && nb.filter((j) => this.tree(isl, j)).length >= 2 ? i : -1;
      case 'reedbed':
        return this.water(isl, i) && nb.filter((j) => groundOK(isl.tiles[j]) && isl.stage[j] >= 2).length >= 2 ? i : -1;
      case 'garden': {
        if (!this.built(isl, i, HOMES)) return -1;
        const f = nb.filter((j) => this.flowery(isl, j));
        return f.length >= 2 ? f[0] : -1;
      }
      case 'lanterns': {
        if (!this.built(isl, i, ['shrine', 'pagoda'])) return -1;
        return nb.find((j) => isl.has(j, 'blossomtree')) ?? -1;
      }
    }
  }

  /** Could `rule` ever form with its anchor inside grove r? (static, from the map) */
  private feasible(isl: Island, r: number, rule: KinRule) {
    const T = isl.tiles;
    return isl.data.regions[r].tiles.some((i) => {
      const t = T[i];
      const nb = t.neighbors.map((j) => T[j]);
      switch (rule) {
        case 'hive': return floweryOK(t) && nb.filter(floweryOK).length >= 2;
        case 'hollow': return groundOK(t) && nb.some(waterOK);
        case 'thicket': return groundOK(t) && nb.filter(groundOK).length >= 2;
        case 'reedbed': return waterOK(t) && nb.filter(groundOK).length >= 2;
        case 'garden': return isHome(t) && nb.filter(floweryOK).length >= 2;
        case 'lanterns': return (t.landmark === 'shrine' || t.landmark === 'pagoda') && nb.some(groundOK);
      }
    });
  }

  private key(ii: number, region: number, rule: KinRule) {
    return `${ii}:${region}:${rule}`;
  }

  // ---------------------------------------------------------------- per frame
  update(dt: number) {
    const g = this.g;
    if (!g.started) return;
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 0.5;
      this.scan(this.silent);
      this.silent = false;
    }
    // celebrations are spaced out so they never pile onto the same beat
    this.celebrateT -= dt;
    if (this.queue.length && this.celebrateT <= 0) {
      const k = this.queue.shift()!;
      this.celebrate(k, this.queue.length > 2);
      this.celebrateT = this.queue.length > 2 ? 0.6 : 1.3;
    }
    // now and then, a visitor
    this.visitT -= dt;
    if (this.visitT <= 0) this.visitT = this.trySpawnVisitor(g.focus) ? rand(50, 80) : 15;
    this.placeBubbles();
  }

  private scan(silent: boolean) {
    const g = this.g;
    for (let ii = 0; ii < g.islands.length; ii++) {
      const isl = g.islands[ii];
      if (!isl.unlocked || isl.group.position.y < -0.4) continue;
      for (let i = 0; i < isl.n; i++) {
        if (isl.stage[i] === 0) continue;
        const region = isl.tiles[i].region;
        for (const rule of KIN_ORDER) {
          const key = this.key(ii, region, rule);
          if (this.formed.has(key)) continue;
          const payload = this.test(rule, isl, i);
          if (payload < 0) continue;
          const kin: Kin = { ii, rule, anchor: i, payload, region };
          this.formed.add(key);
          this.kins.push(kin);
          if (silent) {
            this.discovered.add(rule);
            this.apply(kin, true);
          } else this.queue.push(kin);
        }
      }
    }
    if (silent) this.updateMusic();
  }

  // ---------------------------------------------------------------- forming
  private celebrate(kin: Kin, light: boolean) {
    const g = this.g;
    const isl = g.islands[kin.ii];
    const info = KIN_INFO[kin.rule];
    const first = !this.discovered.has(kin.rule);
    this.discovered.add(kin.rule);
    this.apply(kin, false);
    const p = isl.worldPos(kin.anchor, new THREE.Vector3());
    const pan = g.pan(p.x, p.y, p.z);
    // quieter than a bloom: a soft thup and a three-note motif in the kinship's own voice
    g.sfx.bloom(pan, 0.45, 1.25);
    g.music.arpeggio(info.timbre, 3, 0.12, 8 + KIN_ORDER.indexOf(kin.rule), light ? 0.3 : 0.42, pan);
    isl.hop(kin.anchor, 0, 1.1, 0.45);
    if (kin.payload !== kin.anchor) isl.hop(kin.payload, 0.12, 0.9, 0.35);
    const n = light ? 6 : 12;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      g.glow.emit({
        x: p.x + Math.cos(a) * 0.5, y: p.y + 0.15, z: p.z + Math.sin(a) * 0.5, vx: Math.cos(a) * 0.3, vy: rand(0.6, 1.2), vz: Math.sin(a) * 0.3,
        life: rand(1, 1.5), size: rand(0.1, 0.17), color: pick(['#fff3c8', '#e8ffd0', '#e2f6ff']), shape: SHAPE.sparkle, drag: 1.2,
      });
    }
    g.cloud.happy = Math.min(1, g.cloud.happy + 0.4);
    if (first) {
      g.music.swell(0.5);
      g.after(0.6, () => g.ui.kinFound(kin.rule));
    }
    this.satisfy(kin);
    this.updateMusic();
    g.save();
  }

  /** Spawn what a kinship brings. `instant` is used when loading a save. */
  private apply(kin: Kin, instant: boolean) {
    const g = this.g;
    const isl = g.islands[kin.ii];
    const { anchor: a, payload: b } = kin;
    let k = 0;
    const d = () => (instant ? 0 : 0.2 + k++ * 0.1);
    const toward = (from: number, to: number, dist: number): [number, number] => {
      const f = isl.tiles[from], t = isl.tiles[to];
      const dx = t.x - f.x, dz = t.z - f.z;
      const l = Math.hypot(dx, dz) || 1;
      return [(dx / l) * dist + randSoft() * 0.1, (dz / l) * dist + randSoft() * 0.1];
    };
    const world = (i: number) => isl.worldPos(i, new THREE.Vector3());
    const panAt = (i: number) => {
      const p = world(i);
      return g.pan(p.x, p.y, p.z);
    };
    switch (kin.rule) {
      case 'hive': {
        const nb = isl.tiles[a].neighbors.filter((j) => this.flowery(isl, j));
        const at = nb.length ? toward(a, nb[0], 0.42) : ([0.4, 0.1] as [number, number]);
        g.critters.hive(kin.ii, a, at, instant);
        for (let n = 0; n < 2; n++) isl.sprout(a, 'tulip', { tint: new THREE.Color(pick(FLOWER_COLORS)), delay: d(), instant, ring: 0.3 });
        if (!instant) g.sfx.critter('buzz', panAt(a));
        break;
      }
      case 'hollow': {
        isl.sprout(a, 'fern', { at: toward(a, b, 0.45), delay: d(), instant, tint: new THREE.Color('#7fb069') });
        isl.sprout(a, 'fern', { at: toward(a, b, 0.3), delay: d(), instant, tint: new THREE.Color('#8cbf6a') });
        const cap = new THREE.Color(pick(['#e07a5f', '#f2cc8f', '#e9c46a']));
        for (let n = 0; n < 3; n++) isl.sprout(a, 'mushroom', { at: toward(a, b, 0.55), delay: d(), instant, tint: cap, scale: rand(0.7, 1.1) });
        const pa = world(a), pb = world(b);
        g.critters.spawn('frog', kin.ii, a, { at: pa.clone().lerp(pb, 0.4), face: pb, instant });
        break;
      }
      case 'thicket': {
        const trees = [a, ...isl.tiles[a].neighbors.filter((j) => this.tree(isl, j)).slice(0, 2)];
        for (const t of trees) {
          isl.sprout(t, 'fern', { delay: d(), instant, ring: 0.55, tint: new THREE.Color('#7fb069') });
          isl.sprout(t, 'mushroom', { delay: d(), instant, ring: 0.5, tint: new THREE.Color(pick(['#e07a5f', '#f2cc8f'])) });
        }
        g.creatures.settle(world(a));
        if (!instant) g.after(0.5, () => g.sfx.critter('chirp', panAt(a)));
        break;
      }
      case 'reedbed': {
        const banks = isl.tiles[a].neighbors.filter((j) => groundOK(isl.tiles[j]) && isl.stage[j] >= 2).slice(0, 3);
        for (const j of banks) isl.sprout(j, 'cattail', { at: toward(j, a, 0.6), delay: d(), instant });
        if (isl.tiles[a].pond) {
          isl.sprout(a, 'lilypad', { delay: d(), instant, ring: 0.35, tint: new THREE.Color('#9acb7e') });
          isl.sprout(a, 'flower', { delay: d(), instant, ring: 0.35, tint: new THREE.Color('#ffffff'), scale: 0.7 });
        }
        const p = world(a);
        for (let n = 0; n < 2; n++) g.creatures.flier(p, pick(['#8fd0e8', '#7fc3d9', '#a8e0d8']), instant);
        break;
      }
      case 'garden': {
        for (let n = 0; n < 4; n++) {
          isl.sprout(b, 'tulip', { at: toward(b, a, -0.1 + n * 0.12), delay: d(), instant, tint: new THREE.Color(pick(FLOWER_COLORS)) });
        }
        isl.sprout(b, 'bush', { at: toward(b, a, 0.55), delay: d(), instant, tint: new THREE.Color('#86c06c'), scale: 0.9 });
        const home = isl.tiles[a].neighbors.filter((j) => groundOK(isl.tiles[j]));
        g.critters.spawn('villager', kin.ii, b, { home, instant });
        break;
      }
      case 'lanterns': {
        g.critters.lanterns(kin.ii, b, instant);
        if (!instant) {
          const p = world(b);
          for (let n = 0; n < 14; n++) {
            g.particles.emit({
              x: p.x + randSoft() * 0.6, y: p.y + rand(1, 1.6), z: p.z + randSoft() * 0.6, vx: randSoft() * 0.3, vy: -rand(0.3, 0.6), vz: randSoft() * 0.3,
              life: rand(2.5, 3.5), size: rand(0.12, 0.18), color: pick(['#f7c6d6', '#f3b2c8', '#fbd9e3']), shape: SHAPE.petal, spin: randSoft() * 3, flutter: 0.8, drag: 0.6, gravity: 0.2,
            });
          }
        }
        break;
      }
    }
    // some kinships are where a wonder has been waiting
    const wk = kinWonderFor(kin.ii, isl.data.def.theme, kin.rule, g.collected);
    if (wk && !g.wonders.list.some((w) => w.kind === wk)) {
      const onPayload = kin.rule === 'garden' || kin.rule === 'lanterns' || wk === 'turtle';
      const tile = onPayload ? b : a;
      const other = tile === a ? b : a;
      let at: [number, number];
      if (other !== tile) at = toward(tile, other, wk === 'turtle' ? 0.35 : -0.35);
      else {
        const nb = isl.tiles[tile].neighbors.find((j) => !waterOK(isl.tiles[j]));
        at = isl.tiles[tile].pond ? [0.08, -0.08] : nb !== undefined ? toward(tile, nb, 0.4) : [0.3, -0.2];
      }
      if (instant) g.wonders.reveal(kin.ii, tile, true, wk, at);
      else g.after(1.1, () => g.wonders.reveal(kin.ii, tile, false, wk, at));
    }
  }

  private updateMusic() {
    const residents = this.visitors.filter((v) => v.satisfied).length + this.settledResidents;
    this.g.music.layers.kin = this.discovered.size + Math.min(4, residents * 0.5);
  }

  // ---------------------------------------------------------------- visitors
  onRegionDone(ii: number, r: number) {
    void r;
    // a freshly finished grove is a likely place for someone to turn up
    if (ii === this.g.focus) this.visitT = Math.min(this.visitT, rand(5, 9));
  }

  private trySpawnVisitor(ii: number, force = false) {
    const g = this.g;
    const isl = g.islands[ii];
    if (!isl?.unlocked) return false;
    const waiting = this.visitors.filter((v) => !v.satisfied);
    if (!force && (waiting.length >= 2 || waiting.some((v) => v.ii === ii))) return false;
    if (!force && g.time < g.autopilotUntil) return false;
    const options: { r: number; rules: KinRule[] }[] = [];
    isl.data.regions.forEach((_, r) => {
      if (!isl.regionDone[r] || this.visitors.some((v) => v.ii === ii && v.region === r)) return;
      const rules = KIN_ORDER.filter((rule) =>
        !this.formed.has(this.key(ii, r, rule)) &&
        (g.seedsUnlocked || (rule !== 'thicket' && rule !== 'lanterns')) &&
        this.feasible(isl, r, rule));
      if (rules.length) options.push({ r, rules });
    });
    if (!options.length) return false;
    const { r, rules } = pick(options);
    // prefer kinships the player hasn't met yet: visitors are how new ones get taught
    const weighted = rules.flatMap((rule) => (this.discovered.has(rule) ? [rule] : [rule, rule, rule]));
    const rule = pick(weighted);
    const tiles = isl.data.regions[r].tiles.filter((i) => groundOK(isl.tiles[i]) && isl.stage[i] > 0 && !isl.tiles[i].wonder);
    const free = tiles.filter((i) => isl.hasTree[i] === 0);
    const tile = pick(free.length ? free : tiles.length ? tiles : isl.data.regions[r].tiles);
    this.addVisitor(ii, r, rule, tile, false, false);
    if (!this.everVisited) {
      this.everVisited = true;
      g.after(1.6, () => g.ui.toast(`<span class="ic">💭</span><span><b>A visitor</b><em>it's hoping for something in this grove</em></span>`, 'wonder'));
    }
    return true;
  }

  private addVisitor(ii: number, region: number, rule: KinRule, tile: number, satisfied: boolean, instant: boolean) {
    const g = this.g;
    const info = KIN_INFO[rule];
    const critter = g.critters.spawn(info.visitor, ii, tile, { instant, face: g.rig.camera.position });
    const v: Visitor = { ii, region, rule, tile, critter, bubble: null, satisfied };
    this.visitors.push(v);
    if (satisfied) {
      g.critters.setHome(critter, this.groveHome(ii, region));
      g.landmarks.flourish(ii, region, true);
      this.everVisited = true;
    } else {
      v.bubble = g.ui.bubble(info.recipe);
      if (!instant) {
        g.after(0.3, () => g.critters.voice(critter));
        const p = g.islands[ii].worldPos(tile, new THREE.Vector3());
        g.music.play(0.8, 'celesta', g.pan(p.x, p.y, p.z), 0.4);
      }
    }
    return v;
  }

  private groveHome(ii: number, r: number) {
    const isl = this.g.islands[ii];
    return isl.data.regions[r].tiles.filter((i) => groundOK(isl.tiles[i]));
  }

  private satisfy(kin: Kin) {
    const g = this.g;
    for (const v of this.visitors) {
      if (v.satisfied || v.ii !== kin.ii || v.region !== kin.region || v.rule !== kin.rule) continue;
      v.satisfied = true;
      if (v.bubble) {
        g.ui.bubbleHappy(v.bubble);
        v.bubble = null;
      }
      g.after(0.9, () => {
        g.critters.cheer(v.critter);
        const p = v.critter.g.position;
        g.music.arpeggio('celesta', 5, 0.08, 9, 0.5, g.pan(p.x, p.y, p.z));
      });
      // the grove flourishes: a soft wave, a little more green, and the landmark gains a few touches
      g.after(2.0, () => {
        const isl = g.islands[v.ii];
        const reg = isl.data.regions[v.region];
        const c = isl.tiles[reg.landmarkTile];
        for (const i of reg.tiles) {
          const t = isl.tiles[i];
          const dd = Math.hypot(t.x - c.x, t.z - c.z);
          isl.hop(i, dd / 9, 0.9, 0.3);
          if (isl.stage[i] === 1 && Math.random() < 0.5) g.after(dd / 9, () => g.grow(v.ii, i, 2, true));
        }
        g.landmarks.flourish(v.ii, v.region, false);
        g.music.swell(0.6);
      });
      g.after(3.4, () => g.critters.setHome(v.critter, this.groveHome(v.ii, v.region)));
      this.updateMusic();
    }
  }

  /** Tapping a waiting visitor makes the spots that would answer it shimmer. */
  onCritterTap(c: Critter) {
    const v = this.visitors.find((x) => x.critter === c && !x.satisfied);
    if (!v) return;
    const g = this.g;
    const isl = g.islands[v.ii];
    if (v.bubble) g.ui.bubblePulse(v.bubble);
    const T = isl.tiles;
    let n = 0;
    for (const i of isl.data.regions[v.region].tiles) {
      const t = T[i];
      const nb = t.neighbors.map((j) => T[j]);
      let ok = false;
      switch (v.rule) {
        case 'hive': ok = floweryOK(t) && nb.filter(floweryOK).length >= 2; break;
        case 'hollow': ok = groundOK(t) && nb.some(waterOK); break;
        case 'thicket': ok = groundOK(t) && nb.filter(groundOK).length >= 2; break;
        case 'reedbed': ok = waterOK(t); break;
        case 'garden': ok = floweryOK(t) && nb.some(isHome); break;
        case 'lanterns': ok = groundOK(t) && nb.some((x) => x.landmark === 'shrine' || x.landmark === 'pagoda'); break;
      }
      if (!ok || n > 8) continue;
      n++;
      const p = isl.worldPos(i, new THREE.Vector3());
      g.after(0.05 * n, () => {
        isl.hop(i, 0, 0.5, 0.35);
        for (let k = 0; k < 4; k++) {
          g.glow.emit({ x: p.x + randSoft() * 0.5, y: p.y + rand(0.1, 0.4), z: p.z + randSoft() * 0.5, vy: rand(0.4, 0.9), life: 1.1, size: 0.13, color: '#fff3c8', shape: SHAPE.sparkle, drag: 1.2 });
        }
      });
    }
  }

  private placeBubbles() {
    const g = this.g;
    const cam = g.rig.camera;
    for (const v of this.visitors) {
      if (!v.bubble) continue;
      tmp.copy(v.critter.g.position);
      tmp.y += 1.0;
      tmp.project(cam);
      const show = v.ii === g.focus && tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
      g.ui.placeBubble(v.bubble, (tmp.x * 0.5 + 0.5) * window.innerWidth, (-tmp.y * 0.5 + 0.5) * window.innerHeight, show);
    }
  }

  // ---------------------------------------------------------------- planting
  /** What a tap plants depends on where: blossom by shrines, willows by water, pines in the woods. */
  pickPlant(ii: number, i: number): DecorKind | null {
    const isl = this.g.islands[ii];
    const t = isl.tiles[i];
    const theme = isl.data.def.theme;
    const themed = isl.style.trees?.[t.biome];
    if (t.biome === 'beach') return theme === 'oasis' ? pick(['palm', 'cactus'] as const) : null;
    const nb = t.neighbors;
    if (t.biome === 'blossom' || nb.some((j) => this.built(isl, j, ['shrine', 'pagoda']))) return 'blossomtree';
    if (nb.some((j) => this.water(isl, j))) return theme === 'oasis' ? 'palm' : theme === 'frost' ? 'birch' : 'willow';
    if (themed?.length) return pick(themed);
    if (t.biome === 'forest') return pick(['pine', 'pine', 'roundtree', 'birch'] as const);
    if (t.biome === 'highland') return pick(['pine', 'blossomtree'] as const);
    if (t.biome === 'marsh') return pick(['willow', 'birch'] as const);
    return pick(['roundtree', 'roundtree', 'birch'] as const);
  }

  /** Forget an unloaded island's kinships and visitors (the journal keeps the counts). */
  removeIsland(ii: number) {
    for (const k of this.kins) if (k.ii === ii) this.settledKins[k.rule] = (this.settledKins[k.rule] ?? 0) + 1;
    this.kins = this.kins.filter((k) => k.ii !== ii);
    this.queue = this.queue.filter((k) => k.ii !== ii);
    this.visitors = this.visitors.filter((v) => {
      if (v.ii !== ii) return true;
      if (v.satisfied) this.settledResidents++;
      v.bubble?.remove();
      return false;
    });
    this.updateMusic();
  }

  /** How many of a kinship have ever formed, including on unloaded islands. */
  count(rule: KinRule) {
    return this.kins.filter((k) => k.rule === rule).length + (this.settledKins[rule] ?? 0);
  }

  // ---------------------------------------------------------------- debug
  debugVisitor() {
    const g = this.g;
    const order = [g.focus, ...g.islands.map((_, i) => i).filter((i) => i !== g.focus)];
    if (!order.some((ii) => this.trySpawnVisitor(ii, true))) this.g.ui.toast('<span><em>no grove here can host a visitor right now</em></span>', 'quiet');
  }

  // ---------------------------------------------------------------- save
  save(): EcoSave {
    return {
      sk: this.settledKins,
      sr: this.settledResidents,
      disc: [...this.discovered],
      kin: this.kins.map((k) => [k.ii, k.rule, k.anchor, k.payload]),
      vis: this.visitors.map((v) => [v.ii, v.region, v.rule, v.tile, v.satisfied ? 1 : 0]),
    };
  }

  load(d: EcoSave | undefined) {
    const g = this.g;
    if (!d) return;
    this.settledKins = typeof d.sk === 'object' && d.sk ? d.sk : {};
    this.settledResidents = d.sr ?? 0;
    for (const r of d.disc ?? []) if (KIN_INFO[r]) this.discovered.add(r);
    for (const [ii, rule, anchor, payload] of d.kin || []) {
      const isl = g.islands[ii];
      if (!isl?.unlocked || !KIN_INFO[rule] || anchor >= isl.n || payload >= isl.n) continue;
      const region = isl.tiles[anchor].region;
      const key = this.key(ii, region, rule);
      if (this.formed.has(key)) continue;
      const kin: Kin = { ii, rule, anchor, payload, region };
      this.formed.add(key);
      this.kins.push(kin);
      this.discovered.add(rule);
      this.apply(kin, true);
    }
    for (const [ii, region, rule, tile, sat] of d.vis || []) {
      const isl = g.islands[ii];
      if (!isl?.unlocked || !KIN_INFO[rule] || tile >= isl.n || region >= isl.data.regions.length) continue;
      if (this.visitors.some((v) => v.ii === ii && v.region === region)) continue;
      this.addVisitor(ii, region, rule, tile, !!sat, true);
    }
    this.updateMusic();
  }
}

// Orchestrates the world, the player, feedback, progression and saving.
import * as THREE from 'three';
import { CFG } from '../core/config';
import { U } from '../core/shaders';
import { clamp, damp, lerp, pick, rand, randSoft } from '../core/math';
import { AudioEngine, Timbre } from '../audio/engine';
import { Music } from '../audio/music';
import { Ambience, Sfx } from '../audio/sfx';
import { Environment } from '../world/env';
import { DecorSystem, DecorRef } from '../world/decor';
import { ISLANDS, generateIsland, islandDef, MAX_ISLANDS, Biome, WonderKind } from '../world/gen';
import { Island } from '../world/island';
import { FLOWER_COLORS } from '../world/models';
import { Landmarks } from '../world/landmarks';
import { Creatures } from '../world/creatures';
import { Wonders, WONDER_INFO } from '../world/wonders';
import { Particles, SHAPE } from '../fx/particles';
import { Rain } from '../fx/rain';
import { Post } from '../fx/post';
import { Cloud, Cloudlet } from './cloud';
import { CameraRig } from './camera';
import { Input } from './input';
import { UI } from '../ui/ui';
import { SaveData, loadSave, writeSave, clearSave } from './save';
import { DebugPanel } from '../ui/debug';

const TIMBRE: Record<Biome, Timbre> = {
  beach: 'marimba', meadow: 'marimba', forest: 'kalimba', marsh: 'glass', highland: 'celesta', blossom: 'harp',
};
const ISLAND_TOD = [0.34, 0.46, 0.6, 0.77];

const LEAF_COLORS = ['#9cc97a', '#7fb069', '#b3d985', '#c7d98a', '#86c06c'];
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

interface Later {
  t: number;
  fn: () => void;
}

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  rig: CameraRig;
  env: Environment;
  post: Post;
  decor: DecorSystem;
  particles: Particles;
  glow: Particles;
  rain: Rain;
  cloud: Cloud;
  cloudlets: Cloudlet[] = [];
  input: Input;
  audio: AudioEngine;
  music: Music;
  sfx: Sfx;
  amb: Ambience;
  landmarks: Landmarks;
  creatures: Creatures;
  wonders: Wonders;
  ui: UI;
  debug: DebugPanel | null = null;
  islands: Island[] = [];
  unlocked = 1;
  focus = 0;
  started = false;
  time = 0;
  playTime = 0;
  golden = 0;
  goldenFlowers: { isl: number; tile: number; ref: DecorRef }[] = [];
  collected = new Set<WonderKind>();
  planted: [number, number, string][] = [];
  riversFlowed: boolean[][] = [];
  zen = false;
  photo = false;
  freePlay = false;
  bloomCount = 0;
  tutorial = { hold: true, tap: false, spring: false };
  private later: Later[] = [];
  private raycaster = new THREE.Raycaster();
  private cloudTarget = new THREE.Vector3(0, 4, 0);
  private dropAcc = 0;
  private spreadAcc = 0;
  private saveAcc = 0;
  private cascading = new Set<string>();
  private lastFrame = performance.now();
  private focusPt = new THREE.Vector3();
  private seaPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.4);
  private fpsAcc = 0;
  private fpsN = 0;
  fps = 60;
  private pixelRatio = 1;
  private maxPixelRatio = 1.75;
  private rawDt = 1 / 60;
  lowfx = false;
  private lastRainOverWater = 0;
  private holdTime = 0;
  private rainbowCooldown = 0;
  private todTarget = ISLAND_TOD[0];
  private springStones: { ii: number; ri: number; tile: number; crystal: THREE.Mesh; mat: THREE.MeshStandardMaterial; t: number }[] = [];
  private tapHintShown = false;
  autopilotUntil = 0;
  private magnet = 0;
  private dripT = 3;
  private grade = { sat: 0.85, warm: 0 };

  constructor(public canvas: HTMLCanvasElement) {
    const params = new URLSearchParams(location.search);
    try {
      this.lowfx = params.has('lowfx') || localStorage.getItem('petrichor-lowfx') === '1';
    } catch {
      this.lowfx = params.has('lowfx');
    }
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.maxPixelRatio = this.lowfx ? 1 : 1.75;
    if (params.has('pr')) this.maxPixelRatio = Number(params.get('pr'));
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = !this.lowfx;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.env = new Environment(this.scene);
    this.decor = new DecorSystem(this.scene);
    this.particles = new Particles(2600, false);
    this.glow = new Particles(1800, true);
    this.scene.add(this.particles.points, this.glow.points);
    this.rain = new Rain();
    this.scene.add(this.rain.points);
    this.cloud = new Cloud(this.scene);

    this.audio = new AudioEngine();
    this.music = new Music(this.audio);
    this.sfx = new Sfx(this.audio);
    this.amb = new Ambience(this.audio);

    for (const def of ISLANDS) this.addIsland(def.id);
    this.landmarks = new Landmarks(this);
    this.creatures = new Creatures(this);
    this.wonders = new Wonders(this);
    this.post = new Post(this.renderer, this.scene, this.rig.camera, this.lowfx ? 0 : 4);
    this.ui = new UI(this);

    this.input = new Input(canvas);
    this.input.onTap = (ndc) => this.tap(ndc);
    this.input.onOrbit = (dx, dy) => {
      if (this.started) this.rig.orbit(dx, dy);
    };
    this.input.onZoom = (f) => {
      if (this.started) this.rig.zoom(f);
    };
    this.input.onFirstInteract = () => this.audio.start();

    window.addEventListener('resize', () => this.resize());
    this.resize();
    window.addEventListener('keydown', (e) => this.key(e));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.save();
    });
    window.addEventListener('beforeunload', () => this.save());

    // camera starts far and high for the title
    this.rig.dist.snap(95);
    this.rig.pitch.snap(1.05);
    this.rig.yaw.snap(0.2);
    this.cloud.setPosition(-30, 22, 18);

    const save = loadSave();
    if (save) this.applySave(save);
    this.redrawMask();
    if (new URLSearchParams(location.search).has('debug')) this.openDebug();
  }

  // ------------------------------------------------------------------ lifecycle
  start() {
    this.ui.showTitle(!!loadSave());
    const loop = () => {
      requestAnimationFrame(loop);
      const now = performance.now();
      const raw = (now - this.lastFrame) / 1000;
      this.lastFrame = now;
      const dt = Math.min(raw, 1 / 20);
      this.rawDt = raw;
      this.frame(dt * CFG.timeScale, dt);
    };
    requestAnimationFrame(loop);
  }

  /** Called by the title screen. */
  begin() {
    if (this.started) return;
    this.started = true;
    this.audio.start();
    this.music.start();
    this.rig.dist.target = this.unlocked > 1 ? 36 + this.islands[this.focus].data.def.radius * 1.7 : 40;
    this.rig.pitch.target = 0.9;
    this.rig.yaw.target = 0.55;
    const first = this.islands[0];
    if (!first.unlocked) {
      // the very first moment: the island breathes up out of the sea
      first.unlocked = true;
      this.after(0.4, () => {
        first.rise.target = 0;
        this.sfx.rumble(3.2);
        this.sfx.whoosh(2.6, 0.6);
        this.redrawMask();
        this.coastSplash(first);
      });
      this.after(2.2, () => this.ui.islandName(first.data.def.name));
      this.after(3.4, () => {
        if (this.tutorial.hold) this.ui.hint('hold', this.tutorialTile());
      });
    } else {
      this.ui.islandName(this.islands[this.focus].data.def.name);
    }
    this.cloud.bounce(1);
  }

  after(sec: number, fn: () => void) {
    this.later.push({ t: this.time + sec, fn });
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.rig.camera.aspect = w / h;
    this.rig.camera.updateProjectionMatrix();
    this.post.setSize(w, h, this.pixelRatio);
    const ph = h * this.pixelRatio;
    this.particles.setScale(ph, CFG.fov);
    this.glow.setScale(ph, CFG.fov);
    this.rain.material.uniforms.uScale.value = ph / (2 * Math.tan((CFG.fov * Math.PI) / 360));
  }

  openDebug() {
    if (!this.debug) this.debug = new DebugPanel(this);
    else this.debug.toggle();
  }

  key(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement) return;
    const k = e.key.toLowerCase();
    if (k === 'z') this.ui.toggleZen();
    else if (k === 'p') this.ui.togglePhoto();
    else if (k === 'j') this.ui.toggleJournal();
    else if (k === 'm') this.ui.toggleMute();
    else if (k === '`' || k === '~') this.openDebug();
    else if (k === 'escape') this.ui.closeAll();
    else if (k === ' ' && this.photo) this.ui.capture();
  }

  // ------------------------------------------------------------------ frame
  frame(dt: number, realDt: number) {
    this.time += dt;
    this.playTime += this.started ? realDt : 0;
    U.uTime.value = this.time;
    // fps meter
    this.fpsAcc += this.rawDt;
    this.fpsN++;
    if (this.fpsAcc > 0.5) {
      this.fps = this.fpsN / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsN = 0;
    }
    // scheduled callbacks
    if (this.later.length) {
      const due = this.later.filter((l) => l.t <= this.time);
      if (due.length) {
        this.later = this.later.filter((l) => l.t > this.time);
        for (const l of due) l.fn();
      }
    }

    this.updatePointer();
    const raining = this.started && this.input.raining && !this.photo;
    this.holdTime = raining ? this.holdTime + dt : 0;

    // cloud height hugs the terrain below
    // a cloud left alone gets sleepy; any touch wakes it
    const idle = (performance.now() - Math.max(this.input.lastMove, this.input.lastDown)) / 1000;
    const wasSleepy = this.cloud.sleep > 0.5;
    this.cloud.sleep = damp(this.cloud.sleep, this.started && idle > 25 && !raining ? 1 : 0, idle > 25 ? 0.4 : 6, dt);
    if (wasSleepy && this.cloud.sleep < 0.5) {
      this.cloud.bounce(1.2);
      this.sfx.ui(1.6);
    }
    this.cloud.update(dt, this.cloudTarget, raining, this.rig.camera, this.env.night);
    if (this.cloud.sleep > 0.8 && Math.random() < dt * 0.8) {
      const c = this.cloud.pos;
      this.particles.emit({ x: c.x + 0.6, y: c.y + 0.6, z: c.z, vx: 0.15, vy: 0.35, life: 2.6, size: rand(0.12, 0.2), grow: 1.8, color: '#ffffff', alpha: 0.8, shape: SHAPE.ring, flutter: 0.15, drag: 0.2 });
    }
    const cp = this.cloud.pos;
    const R = lerp(CFG.rainRadius, CFG.rainRadiusMax, this.cloud.charge);
    U.uCloud.value.set(cp.x, cp.z, R * 0.95, this.cloud.raining);
    if (this.photo) U.uCloud.value.z = 0.0001;

    if (raining) this.applyRain(dt, R);
    this.updateDrops(dt, raining, R);
    // baby clouds trail behind and help
    let leader = cp, lv = this.cloud.vel;
    for (const c of this.cloudlets) {
      c.update(dt, leader, lv, this.rig.camera, raining);
      const p = c.group.position;
      if (raining) {
        this.applyRain(dt, 1.1, p, 0.45);
        if (Math.random() < dt * 40) {
          const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.9;
          const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
          const gy = this.groundY(x, z);
          this.rain.spawn(x, p.y - 0.3, z, gy, gy < 0.1);
        }
      }
      leader = p;
      lv = this.cloud.vel;
    }
    if (!raining && this.cloud.charge > 0.55 && this.rainbowCooldown <= 0) {
      this.rainbow();
      this.rainbowCooldown = 6;
    }
    this.rainbowCooldown -= dt;
    // a resting cloud still drips now and then
    if (this.started && !raining && !this.photo) {
      this.dripT -= dt;
      if (this.dripT <= 0) {
        this.dripT = rand(1.5, 4.5);
        const gy = this.groundY(cp.x, cp.z);
        this.rain.spawn(cp.x + randSoft() * 0.4, cp.y - 0.6, cp.z + randSoft() * 0.4, gy, gy < 0.1 || this.isWaterAt(cp.x, cp.z), true);
      }
    }

    // slow life spread: living tiles gently wet their dry neighbours
    this.spreadAcc += dt;
    if (this.spreadAcc > 0.5) {
      this.spread(this.spreadAcc);
      this.spreadAcc = 0;
    }

    for (const isl of this.islands) isl.update(dt);
    this.decor.update(dt);
    this.landmarks.update(dt);
    this.updateSpringStones(dt);
    this.creatures.update(dt);
    this.wonders.update(dt);
    this.particles.update(dt, this.time);
    this.glow.update(dt, this.time);

    // camera follows the cloud softly around the focus island
    this.updateFocus();
    const fi = this.islands[this.focus];
    const fx = lerp(fi.cx, cp.x, CFG.camFollow);
    const fz = lerp(fi.cz, cp.z, CFG.camFollow);
    if (!this.photo) this.rig.target.setTarget(fx, 0.6, fz);
    this.rig.autoOrbit = this.zen && !this.input.holding ? 1 : 0;
    this.rig.update(dt);

    // world mood
    const vit = this.vitality();
    this.env.vitality = damp(this.env.vitality, vit, 0.8, dt);
    if (!this.ui.photoTodOverride) {
      if (this.freePlay) this.todTarget += dt / 600; // ten-minute days in free play
      else {
        const base = ISLAND_TOD[Math.min(this.focus, ISLAND_TOD.length - 1)];
        this.todTarget = this.focus === 3 ? lerp(0.77, 0.87, fi.progress()) : base;
      }
      // shortest path around the day circle
      let d = this.todTarget - this.env.tod;
      if (this.freePlay) this.env.tod += d * Math.min(1, dt * 0.5);
      else {
        d = ((d % 1) + 1.5) % 1 - 0.5;
        this.env.tod += d * Math.min(1, dt * 0.25);
      }
    }
    this.focusPt.set(this.rig.target.x.value, 0, this.rig.target.z.value);
    this.env.update(dt, this.focusPt);

    // audio state
    this.music.vitality = this.env.vitality;
    this.music.night = this.env.night;
    this.amb.life = this.env.vitality;
    this.amb.night = this.env.night;
    this.amb.setRain(this.started ? this.cloud.raining * (0.6 + this.cloud.charge * 0.6) : 0, this.lastRainOverWater);
    this.amb.update(dt, this.sfx);

    // post
    const u = this.post.u;
    u.uTime.value = this.time;
    this.grade.sat = damp(this.grade.sat, 0.78 + this.env.vitality * 0.3, 1, dt);
    this.grade.warm = damp(this.grade.warm, this.env.vitality * 0.8, 1, dt);
    if (!this.ui.photoGradeOverride) {
      u.uSat.value = this.grade.sat;
      u.uWarm.value = this.grade.warm;
    }
    u.uAmount.value = CFG.tiltShift * (this.ui.photoTiltOverride ?? 1);
    u.uBand.value = CFG.tiltBand;
    u.uGrain.value = CFG.grain;
    u.uVignette.value = CFG.vignette;
    u.uFlash.value = Math.max(0, u.uFlash.value - realDt * 1.5);
    // focus band follows the cloud's ground point on screen
    tmpV.set(cp.x, this.groundY(cp.x, cp.z), cp.z).project(this.rig.camera);
    const fy = clamp(tmpV.y * 0.5 + 0.5, 0.25, 0.75);
    u.uFocus.value = damp(u.uFocus.value, this.photo ? (this.ui.photoFocus ?? 0.5) : fy, 3, realDt);

    this.ui.update(realDt);
    this.post.render();

    // autosave
    this.saveAcc += realDt;
    if (this.saveAcc > 8 && this.started) {
      this.saveAcc = 0;
      this.save();
    }
    // adaptive resolution for slower machines
    this.adaptResolution();
  }

  private adaptCooldown = 3;
  private adaptResolution() {
    this.adaptCooldown -= 1 / Math.max(10, this.fps);
    if (this.adaptCooldown > 0) return;
    if (this.fps < 40 && this.pixelRatio > Math.min(0.85, this.maxPixelRatio)) {
      this.pixelRatio = Math.max(Math.min(0.85, this.maxPixelRatio), this.pixelRatio - 0.2);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.resize();
      this.adaptCooldown = 3;
    } else if (this.fps > 58 && this.pixelRatio < Math.min(window.devicePixelRatio || 1, this.maxPixelRatio) - 0.01) {
      this.pixelRatio = Math.min(Math.min(window.devicePixelRatio || 1, this.maxPixelRatio), this.pixelRatio + 0.1);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.resize();
      this.adaptCooldown = 5;
    } else this.adaptCooldown = 1;
  }

  vitality() {
    let bloomed = 0;
    for (const isl of this.islands) {
      if (!isl.unlocked) continue;
      for (let i = 0; i < isl.n; i++) bloomed += isl.stage[i] > 0 ? 1 : 0;
    }
    return 1 - Math.exp(-bloomed / 90);
  }

  private updateFocus() {
    const cp = this.cloud.pos;
    let best = this.focus, bd = 1e9;
    this.islands.forEach((isl, i) => {
      if (!isl.unlocked) return;
      const d = Math.hypot(cp.x - isl.cx, cp.z - isl.cz) - isl.radius;
      if (d < bd - (i === this.focus ? 3 : 0)) {
        bd = d;
        best = i;
      }
    });
    if (best !== this.focus) {
      this.focus = best;
      this.redrawMask();
      this.ui.islandName(this.islands[best].data.def.name);
    }
  }

  // ------------------------------------------------------------------ pointer
  private updatePointer() {
    if (!this.started) {
      const f = this.islands[this.focus];
      this.cloudTarget.set(f.cx - 2, 9, f.cz + 4);
      return;
    }
    if (this.photo) return;
    if (this.time < this.autopilotUntil) return;
    if (!this.input.hasPointer) {
      // idle drift above the focus island
      return;
    }
    this.raycaster.setFromCamera(this.input.ndc, this.rig.camera);
    let hit: THREE.Vector3 | null = null;
    let dist = Infinity;
    for (const isl of this.islands) {
      if (!isl.unlocked) continue;
      const hits = this.raycaster.intersectObject(isl.caps, false);
      if (hits.length && hits[0].distance < dist) {
        dist = hits[0].distance;
        hit = hits[0].point;
      }
    }
    if (!hit) {
      const p = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(this.seaPlane, p)) hit = p;
    }
    if (!hit) return;
    // keep the cloud within the archipelago
    const fi = this.islands[this.focus];
    tmpV2.set(hit.x - fi.cx, 0, hit.z - fi.cz);
    const maxR = fi.radius + 10;
    if (tmpV2.length() > maxR) tmpV2.setLength(maxR);
    let x = fi.cx + tmpV2.x, z = fi.cz + tmpV2.z;
    // magnetism: a resting cursor lets the rain drift toward the most nearly-finished dry tile
    const still = performance.now() - this.input.lastMove > 350;
    if (this.input.raining && still) {
      const R = lerp(CFG.rainRadius, CFG.rainRadiusMax, this.cloud.charge) * 1.5;
      let best = 0, bx = x, bz = z;
      for (const isl of this.islands) {
        if (!isl.unlocked || Math.hypot(x - isl.cx, z - isl.cz) > isl.radius + R) continue;
        for (let i = 0; i < isl.n; i++) {
          if (isl.stage[i] > 0) continue;
          const t = isl.tiles[i];
          const d = Math.hypot(t.x + isl.cx - x, t.z + isl.cz - z);
          if (d > R) continue;
          const score = (0.25 + isl.moist[i]) * (1 - d / R);
          if (score > best) {
            best = score;
            bx = t.x + isl.cx;
            bz = t.z + isl.cz;
          }
        }
      }
      this.magnet = damp(this.magnet, best > 0 ? 1 : 0, 2, 1 / 60);
      x = lerp(x, bx, 0.45 * this.magnet);
      z = lerp(z, bz, 0.45 * this.magnet);
    } else this.magnet = 0;
    const gy = Math.max(this.maxGroundNear(x, z, 1.6), 0.3);
    this.cloudTarget.set(x, gy + CFG.cloudHeight + this.cloud.charge * 0.5, z);
  }

  /** Top of terrain under a world point (sea level if none). */
  groundY(x: number, z: number) {
    for (const isl of this.islands) {
      const i = isl.tileAt(x, z);
      if (i >= 0 && isl.group.position.y > -0.5) return isl.topY(i);
    }
    return 0.02;
  }

  private maxGroundNear(x: number, z: number, r: number) {
    let m = this.groundY(x, z);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      m = Math.max(m, this.groundY(x + Math.cos(a) * r, z + Math.sin(a) * r));
    }
    return m;
  }

  /** Approximate screen pan for audio from a world position. */
  pan(x: number, y: number, z: number) {
    tmpV.set(x, y, z).project(this.rig.camera);
    return clamp(tmpV.x * 0.75, -0.9, 0.9);
  }

  // ------------------------------------------------------------------ rain
  private applyRain(dt: number, R: number, cp: THREE.Vector3 = this.cloud.pos, mul = 1) {
    let overWater = 0, n = 0;
    for (let ii = 0; ii < this.islands.length; ii++) {
      const isl = this.islands[ii];
      if (!isl.unlocked || isl.group.position.y < -0.4) continue;
      if (Math.hypot(cp.x - isl.cx, cp.z - isl.cz) > isl.radius + R + 2) continue;
      for (let i = 0; i < isl.n; i++) {
        const t = isl.tiles[i];
        const dx = t.x + isl.cx - cp.x, dz = t.z + isl.cz - cp.z;
        const d2 = dx * dx + dz * dz;
        const reach = R * 1.15;
        if (d2 > reach * reach) continue;
        const d = Math.sqrt(d2);
        let w = 1 - (d / reach) * (d / reach);
        if (w <= 0) continue;
        n++;
        if (t.pond || t.river >= 0) overWater++;
        const st = isl.stage[i];
        let rate = CFG.rainRate * w * dt * (0.8 + this.cloud.charge * 0.5) * mul;
        if (st > 0) rate *= CFG.livingRateMul;
        // magnetism: almost-there tiles soak faster, so strokes "finish" things
        if (st === 0 && isl.moist[i] > 0.6) rate *= CFG.magnetBoost;
        // drops patter on the plants: decor under the rain jiggles
        if (st > 0 && isl.tileDecor[i].length && Math.random() < dt * 5 * w * mul) {
          const refs = isl.tileDecor[i];
          this.decor.kick(refs[Math.floor(Math.random() * refs.length)], rand(0.6, 1.4));
        }
        if (st >= 3) {
          isl.touch(i);
          continue;
        }
        this.addMoisture(ii, i, rate);
        isl.touch(i);
      }
    }
    if (mul === 1) this.lastRainOverWater = n ? overWater / n : 0;
  }

  addMoisture(ii: number, i: number, amt: number) {
    const isl = this.islands[ii];
    isl.moist[i] = Math.min(CFG.stage3 + 0.2, isl.moist[i] + amt);
    const m = isl.moist[i];
    const st = isl.stage[i];
    if (st === 0 && m >= 1) this.bloom(ii, i);
    else if (st === 1 && m >= CFG.stage2) this.grow(ii, i, 2);
    else if (st === 2 && m >= CFG.stage3) this.grow(ii, i, 3);
  }

  private updateDrops(dt: number, raining: boolean, R: number) {
    const cp = this.cloud.pos;
    if (raining) {
      this.dropAcc += dt * CFG.dropsPerSec * (0.7 + this.cloud.charge * 0.8);
      while (this.dropAcc >= 1) {
        this.dropAcc -= 1;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * R * 0.9;
        const x = cp.x + Math.cos(a) * r;
        const z = cp.z + Math.sin(a) * r;
        const gy = this.groundY(x, z);
        const water = gy < 0.1 || this.isWaterAt(x, z);
        this.rain.spawn(x, cp.y - 0.5 - Math.random() * 0.3, z, water ? Math.max(gy, 0.02) : gy, water);
      }
    }
    const landed = this.rain.update(dt);
    for (const d of landed) {
      if (Math.random() < 0.5) {
        this.particles.emit({
          x: d.x, y: d.gy + 0.02, z: d.z, life: 0.35, size: d.water ? 0.2 : 0.12, color: d.water ? '#e8f4f8' : '#dfe6ea',
          alpha: 0.35, shape: SHAPE.ring, grow: 2.2,
        });
      }
      for (let k = 0; k < CFG.splashCount; k++) {
        if (Math.random() < 0.5) continue;
        this.particles.emit({
          x: d.x, y: d.gy + 0.03, z: d.z, vx: randSoft() * 0.8, vy: rand(1, 2.2), vz: randSoft() * 0.8,
          life: 0.3, size: 0.045, color: '#eef5fa', alpha: 0.8, gravity: 12, drag: 1,
        });
      }
      if (d.water && Math.random() < 0.08) this.env.ripple(d.x, d.z, 0.35);
      if (d.solo || Math.random() < 0.25) this.sfx.plip(this.pan(d.x, d.gy, d.z), d.water, d.solo ? 1.6 : 0.9);
    }
  }

  private isWaterAt(x: number, z: number) {
    for (const isl of this.islands) {
      const i = isl.tileAt(x, z);
      if (i >= 0) return isl.waterS[i] > 0.5;
    }
    return false;
  }

  private spread(dt: number) {
    for (let ii = 0; ii < this.islands.length; ii++) {
      const isl = this.islands[ii];
      if (!isl.unlocked) continue;
      for (let i = 0; i < isl.n; i++) {
        if (isl.stage[i] === 0) continue;
        for (const j of isl.tiles[i].neighbors) {
          if (isl.stage[j] === 0 && isl.moist[j] < 0.93) {
            isl.moist[j] += CFG.spreadRate * dt * (0.5 + isl.tiles[j].jitter);
            isl.active.add(j);
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------ growth + feedback
  bloom(ii: number, i: number, opts: { quietNote?: boolean; cascade?: boolean; source?: string } = {}) {
    const isl = this.islands[ii];
    if (isl.stage[i] > 0) return;
    isl.moist[i] = Math.max(isl.moist[i], 1);
    isl.setStage(i, 1);
    this.bloomCount++;
    const t = isl.tiles[i];
    const p = isl.worldPos(i, new THREE.Vector3());
    p.y = isl.group.position.y + t.h;
    const pan = this.pan(p.x, p.y, p.z);
    const h01 = t.h / Math.max(1, isl.data.maxH);

    // neighbours get a tiny shove so the pop feels physical — and a sip of water,
    // so soaked areas tend to finish in little chain reactions
    for (const j of t.neighbors) {
      isl.hop(j, 0.05 + Math.random() * 0.03, 0.55, 0.08);
      if (isl.stage[j] === 0 && isl.moist[j] > 0.75) this.after(0.12 + Math.random() * 0.1, () => this.addMoisture(ii, j, 0.09));
    }

    // sound: soft thup + a quantized note
    this.sfx.bloom(pan, opts.cascade ? 0.7 : 1, 0.85 + h01 * 0.4);
    if (!opts.quietNote) this.music.play(h01, TIMBRE[t.biome], pan, opts.cascade ? 0.75 : 0.95);

    // particles: leaves/petals burst + dust ring + sparkles
    const n = Math.round(CFG.petalCount * (opts.cascade ? 0.6 : 1));
    const flowery = t.biome === 'meadow' || t.biome === 'blossom';
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(0.6, 1.8);
      const petal = flowery && Math.random() < 0.45;
      this.particles.emit({
        x: p.x + Math.cos(a) * 0.3, y: p.y + 0.1, z: p.z + Math.sin(a) * 0.3,
        vx: Math.cos(a) * sp, vy: rand(2.2, 4.2), vz: Math.sin(a) * sp,
        life: rand(0.9, 1.6), size: petal ? rand(0.13, 0.2) : rand(0.12, 0.18),
        color: petal ? pick(FLOWER_COLORS) : t.biome === 'beach' ? pick(['#e9dcae', '#c9cf8a']) : pick(LEAF_COLORS),
        gravity: 4.5, drag: 2.2, shape: petal ? SHAPE.petal : SHAPE.leaf, spin: randSoft() * 8, flutter: 0.6,
      });
    }
    this.particles.emit({ x: p.x, y: p.y + 0.05, z: p.z, life: 0.55, size: 1.2, color: '#ffffff', alpha: 0.22, shape: SHAPE.ring, grow: 2.4 });
    for (let k = 0; k < CFG.sparkleCount * (opts.cascade ? 0.5 : 1); k++) {
      this.glow.emit({
        x: p.x + randSoft() * 0.6, y: p.y + rand(0.1, 0.6), z: p.z + randSoft() * 0.6,
        vy: rand(0.4, 1.2), life: rand(0.6, 1.2), size: rand(0.09, 0.18), color: '#fff3c8', alpha: 0.75, shape: SHAPE.sparkle, drag: 1,
      });
    }
    // every so often a bloom is a little luckier than the rest
    if (!opts.cascade && Math.random() < 0.04) {
      this.after(0.15, () => {
        this.music.arpeggio('celesta', 4, 0.05, 11, 0.45, pan);
        for (let k = 0; k < 16; k++) {
          const a = Math.random() * Math.PI * 2;
          this.glow.emit({ x: p.x, y: p.y + 0.3, z: p.z, vx: Math.cos(a) * rand(0.5, 1.6), vy: rand(1.5, 3), vz: Math.sin(a) * rand(0.5, 1.6), life: rand(1, 1.6), size: rand(0.12, 0.2), color: pick(['#ffe2ef', '#fff3c8', '#e2f6ff']), shape: SHAPE.sparkle, gravity: 1.2, drag: 1.5 });
        }
        this.creatures.onLush(ii, i, true);
      });
    }
    // camera: tiny downward nod
    this.rig.kick(randSoft() * 0.4, -1, randSoft() * 0.4);
    this.cloud.happy = Math.min(1, this.cloud.happy + 0.25);

    if (this.tutorial.hold) {
      this.tutorial.hold = false;
      this.ui.hint(null);
    }
    // second island: teach planting once a few tiles are alive
    if (this.tutorial.tap && ii >= 1 && !this.tapHintShown && !opts.cascade && !t.pond && t.river < 0) {
      this.tapHintShown = true;
      this.after(1.4, () => {
        if (this.tutorial.tap) this.ui.hint('tap', { isl: ii, tile: i });
      });
    }
    // ponds fill with a splash
    if (t.pond) {
      this.after(0.1, () => {
        this.sfx.splash(pan, 0.7);
        this.splashAt(p.x, p.y, p.z, 10);
        this.amb.ponds++;
      });
    }
    // hidden things
    if (t.wonder) this.wonders.reveal(ii, i, false);
    if (t.spring) this.flowRiver(ii, t.river);
    this.checkRegion(ii, t.region, i);
  }

  grow(ii: number, i: number, stage: number, quiet = false) {
    const isl = this.islands[ii];
    if (isl.stage[i] >= stage) return;
    isl.setStage(i, stage);
    if (quiet) return;
    const t = isl.tiles[i];
    const p = isl.worldPos(i, new THREE.Vector3());
    const pan = this.pan(p.x, p.y, p.z);
    this.sfx.rustle(pan, stage === 3 ? 1.2 : 0.8);
    this.music.play(t.h / Math.max(1, isl.data.maxH) + 0.25, stage === 3 ? 'kalimba' : TIMBRE[t.biome], pan, 0.55);
    for (let k = 0; k < 6; k++) {
      const flowery = stage === 2 && (t.biome === 'meadow' || t.biome === 'blossom');
      this.particles.emit({
        x: p.x + randSoft() * 0.4, y: p.y + 0.2, z: p.z + randSoft() * 0.4,
        vx: randSoft() * 0.8, vy: rand(1.5, 3), vz: randSoft() * 0.8, life: rand(0.8, 1.3), size: rand(0.1, 0.15),
        color: flowery ? pick(FLOWER_COLORS) : pick(LEAF_COLORS), gravity: 3.5, drag: 2.5,
        shape: flowery ? SHAPE.petal : SHAPE.leaf, spin: randSoft() * 6, flutter: 0.5,
      });
    }
    // rare golden flower on lush meadow-ish tiles
    if (stage === 2 && !t.landmark && !t.pond && t.river < 0 && t.biome !== 'beach' && Math.random() < 0.018) {
      this.after(0.4, () => this.spawnGolden(ii, i));
    }
    if (stage >= 2) this.creatures.onLush(ii, i);
  }

  spawnGolden(ii: number, i: number, instant = false) {
    const isl = this.islands[ii];
    const t = isl.tiles[i];
    const ref = this.decor.add('goldflower', t.x + isl.cx + randSoft() * 0.3, t.h, t.z + isl.cz + randSoft() * 0.3, {
      tint: new THREE.Color('#ffd65a'), scale: 1.25, instant,
    });
    if (!ref) return;
    this.goldenFlowers.push({ isl: ii, tile: i, ref });
    if (!instant) {
      const p = this.decor.position(ref);
      this.sfx.ui(1.5);
      for (let k = 0; k < 12; k++) {
        this.glow.emit({ x: p.x, y: p.y + 0.3, z: p.z, vx: randSoft() * 1.2, vy: rand(0.5, 1.5), vz: randSoft() * 1.2, life: 1.2, size: 0.15, color: '#ffe08a', shape: SHAPE.sparkle, drag: 2 });
      }
    }
  }

  /** Petals drifting down from the sky over an area for a while. */
  petalShower(cx: number, cz: number, radius: number, seconds: number, rate = 30) {
    const n = Math.round(seconds * rate);
    for (let k = 0; k < n; k++) {
      this.after((k / n) * seconds, () => {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius;
        this.particles.emit({
          x: cx + Math.cos(a) * r, y: rand(7, 10), z: cz + Math.sin(a) * r, vx: rand(0.2, 0.6), vy: -rand(0.6, 1.1), vz: randSoft() * 0.3,
          life: rand(6, 9), size: rand(0.14, 0.22), color: pick(FLOWER_COLORS), shape: SHAPE.petal, spin: randSoft() * 3, flutter: 0.9, drag: 0.2, gravity: 0.12,
        });
      });
    }
  }

  splashAt(x: number, y: number, z: number, n: number) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(0.5, 1.6);
      this.particles.emit({
        x, y: y + 0.05, z, vx: Math.cos(a) * s, vy: rand(2, 4), vz: Math.sin(a) * s, life: 0.7, size: rand(0.06, 0.11),
        color: '#e8f6fa', gravity: 10, drag: 0.8,
      });
    }
    this.particles.emit({ x, y: y + 0.03, z, life: 0.8, size: 1.2, color: '#ffffff', alpha: 0.6, shape: SHAPE.ring, grow: 2.5 });
  }

  private coastSplash(isl: Island) {
    let k = 0;
    for (const t of isl.tiles) {
      if (t.coastDist !== 0 || Math.random() < 0.5) continue;
      const delay = 0.5 + Math.random() * 1.2;
      this.after(delay, () => this.splashAt(t.x + isl.cx, 0.05, t.z + isl.cz, 4));
      if (k++ % 4 === 0) this.after(delay, () => this.env.ripple(t.x + isl.cx, t.z + isl.cz, 0.6));
    }
  }

  // ------------------------------------------------------------------ regions
  private checkRegion(ii: number, r: number, lastTile: number) {
    const isl = this.islands[ii];
    if (isl.regionDone[r]) return;
    const prog = isl.regionProgress(r);
    const key = `${ii}:${r}`;
    if (prog >= 1) {
      this.cascading.delete(key);
      this.completeRegion(ii, r, lastTile);
      return;
    }
    if (prog >= CFG.regionAutoComplete && !this.cascading.has(key)) {
      // finish the last few tiles for the player, as a rippling wave
      this.cascading.add(key);
      const src = isl.tiles[lastTile];
      const rest = isl.data.regions[r].tiles
        .filter((j) => isl.stage[j] === 0)
        .sort((a, b) => Math.hypot(isl.tiles[a].x - src.x, isl.tiles[a].z - src.z) - Math.hypot(isl.tiles[b].x - src.x, isl.tiles[b].z - src.z));
      rest.forEach((j, k) => {
        this.after(0.35 + k * 0.11, () => {
          if (isl.stage[j] === 0) this.bloom(ii, j, { cascade: true });
        });
      });
    }
  }

  completeRegion(ii: number, r: number, fromTile: number) {
    const isl = this.islands[ii];
    if (isl.regionDone[r]) return;
    isl.regionDone[r] = true;
    const reg = isl.data.regions[r];
    const lt = isl.tiles[reg.landmarkTile];
    const cx = lt.x, cz = lt.z;
    void fromTile;
    // ripple: every tile on the island hops as the wave passes
    for (let i = 0; i < isl.n; i++) {
      const t = isl.tiles[i];
      const d = Math.hypot(t.x - cx, t.z - cz);
      const inReg = t.region === r;
      const v = inReg ? 2.2 : Math.max(0, 1.1 - d * 0.08);
      if (v <= 0.05) continue;
      isl.hop(i, 0.25 + d / 11, v, inReg ? 0.7 : 0.25);
      // regions bloom a bit deeper as the wave passes
      if (inReg && isl.stage[i] === 1 && Math.random() < 0.4) {
        this.after(0.35 + d / 11, () => {
          isl.moist[i] = Math.max(isl.moist[i], CFG.stage2);
          this.grow(ii, i, 2, true);
        });
      }
    }
    const wx = cx + isl.cx, wz = cz + isl.cz;
    this.env.ripple(wx, wz, 0.9);
    this.music.swell(1);
    this.music.arpeggio('bell', 7, 0.085, 6, 0.6, this.pan(wx, 1, wz));
    if (!this.music.layers.drone) this.music.layers.drone = true;
    this.sfx.whoosh(1.6, 0.5);
    this.rig.punch(1.2);
    this.cloud.happy = 1;
    this.cloud.bounce(1.2);
    this.post.u.uFlash.value = 0.05;
    // sparkle fountain over the region
    for (const j of reg.tiles) {
      const p = isl.worldPos(j, new THREE.Vector3());
      const d = Math.hypot(isl.tiles[j].x - cx, isl.tiles[j].z - cz);
      this.after(0.25 + d / 11, () => {
        for (let k = 0; k < 4; k++) {
          this.glow.emit({
            x: p.x + randSoft() * 0.6, y: p.y + 0.2, z: p.z + randSoft() * 0.6, vy: rand(1, 2.4), life: rand(1, 2),
            size: rand(0.1, 0.2), color: pick(['#fff3c8', '#ffe2ef', '#e2f6ff']), shape: SHAPE.sparkle, drag: 1.4,
          });
        }
      });
    }
    // landmark assembles itself, life arrives
    this.after(0.9, () => this.landmarks.build(ii, r, false));
    this.after(2.2, () => this.creatures.onRegion(ii, r));
    this.ui.updateProgress();
    if (isl.regionDone.every(Boolean)) this.after(3.2, () => this.completeIsland(ii));
    this.save();
  }

  completeIsland(ii: number) {
    const isl = this.islands[ii];
    if (isl.complete) return;
    isl.complete = true;
    // a slow, island-wide wave and a chord swell
    for (let i = 0; i < isl.n; i++) {
      const t = isl.tiles[i];
      const d = Math.hypot(t.x, t.z);
      isl.hop(i, d / 7, 1.6, 0.5);
    }
    this.music.swell(2);
    this.music.arpeggio('glass', 12, 0.07, 4, 0.7);
    this.after(1.0, () => this.music.arpeggio('celesta', 10, 0.06, 9, 0.5));
    this.music.layers.harp = true;
    this.rig.punch(2);
    this.rig.dist.target = Math.min(this.rig.maxDist, this.rig.dist.target * 1.18);
    this.creatures.birdBurst(isl.cx, isl.cz, 14);
    this.petalShower(isl.cx, isl.cz, isl.radius * 0.8, 8, 25);
    this.ui.islandComplete(isl.data.def.name);
    this.after(2.2, () => this.addCloudlet(false));
    this.save();
    const next = ii + 1;
    if (next < this.islands.length && !this.islands[next].unlocked) {
      this.after(4.5, () => this.unlockIsland(next));
    } else if (next === ISLANDS.length && !this.freePlay) {
      this.after(5, () => this.finale());
    } else if (next >= ISLANDS.length && next < MAX_ISLANDS && this.islands.length <= next) {
      // the archipelago keeps growing, further out each time
      this.after(4.5, () => {
        this.addIsland(next);
        this.unlockIsland(next);
      });
    }
  }

  unlockIsland(ii: number, instant = false) {
    const isl = this.islands[ii];
    isl.unlocked = true;
    this.unlocked = Math.max(this.unlocked, ii + 1);
    if (instant) {
      isl.rise.snap(0);
      this.redrawMask();
      return;
    }
    // camera glides over, the land rises from the sea
    this.focus = ii;
    this.redrawMask();
    this.autopilotUntil = this.time + 4.2;
    this.cloudTarget.set(isl.cx, 6.5, isl.cz + 1);
    this.rig.target.setTarget(isl.cx, 0.6, isl.cz);
    this.rig.dist.target = 52;
    this.sfx.whoosh(3, 0.8);
    this.after(1.6, () => {
      isl.rise.target = 0;
      this.sfx.rumble(3.5);
      this.coastSplash(isl);
      this.redrawMask();
    });
    this.after(3.4, () => {
      this.ui.islandName(isl.data.def.name);
      this.rig.dist.target = 36 + isl.data.def.radius * 1.7;
    });
    // each island teaches one new thing
    if (ii === 1) {
      this.after(4.5, () => {
        this.cloud.setLeaf(true);
        this.cloud.bounce(1.5);
        this.sfx.tok(0, 1.3);
        this.music.arpeggio('kalimba', 5, 0.08, 8, 0.6);
        this.tutorial.tap = true;
      });
    }
    if (ii === 2) {
      this.after(4.5, () => {
        this.tutorial.spring = true;
        const src = isl.data.rivers[0]?.path[0];
        if (src !== undefined) this.ui.hint('hold', { isl: ii, tile: src });
      });
    }
    this.save();
  }

  finale() {
    this.freePlay = true;
    this.music.swell(2);
    this.music.arpeggio('bell', 14, 0.09, 3, 0.7);
    this.rig.dist.target = 110;
    for (const isl of this.islands) {
      for (let i = 0; i < isl.n; i++) {
        const t = isl.tiles[i];
        isl.hop(i, 0.5 + Math.hypot(t.x + isl.cx, t.z + isl.cz + 18) / 14, 1.2, 0.5);
      }
      this.creatures.birdBurst(isl.cx, isl.cz, 8);
    }
    const f = this.islands[this.focus];
    this.petalShower(f.cx, f.cz, f.radius, 16, 40);
    this.ui.finale();
    this.save();
    this.after(14, () => {
      if (this.islands.length < MAX_ISLANDS) {
        const n = this.islands.length;
        this.addIsland(n);
        this.unlockIsland(n);
      }
    });
  }

  addCloudlet(instant: boolean) {
    if (this.cloudlets.length >= 4) return;
    const from = this.cloudlets.length ? this.cloudlets[this.cloudlets.length - 1].group.position : this.cloud.pos;
    const c = new Cloudlet(this.scene, this.cloud.material, from.clone().add(new THREE.Vector3(0, 1.5, 0)), this.cloudlets.length);
    this.cloudlets.push(c);
    if (!instant) {
      const p = from;
      const pan = this.pan(p.x, p.y, p.z);
      this.music.arpeggio('celesta', 6, 0.07, 9, 0.6, pan);
      this.sfx.bloom(pan, 0.6, 2.2);
      this.cloud.happy = 1;
      this.cloud.bounce(1.5);
      for (let k = 0; k < 20; k++) {
        this.glow.emit({ x: p.x, y: p.y, z: p.z, vx: randSoft() * 2, vy: rand(0.5, 2), vz: randSoft() * 2, life: 1.3, size: 0.16, color: '#ffffff', shape: SHAPE.sparkle, drag: 2 });
      }
      this.ui.toast('<span class="ic">☁</span><span><b>A little cloud joined you</b><em>it rains where you rain</em></span>', 'wonder');
    }
  }

  /** Glide the cloud and camera to another island. */
  travelTo(i: number, hold = 1.8) {
    const isl = this.islands[i];
    if (!isl.unlocked) return;
    this.focus = i;
    this.redrawMask();
    this.autopilotUntil = this.time + hold;
    this.cloudTarget.set(isl.cx, 6.5, isl.cz + 1);
    this.rig.target.setTarget(isl.cx, 0.6, isl.cz);
    this.rig.dist.target = 36 + isl.data.def.radius * 1.7;
    this.ui.islandName(isl.data.def.name, isl.complete ? 'restored' : '');
  }

  get seedsUnlocked() {
    return this.unlocked >= 2;
  }

  redrawMask() {
    const f = this.islands[this.focus] ?? this.islands[0];
    this.env.maskRect.x = f.cx - 70;
    this.env.maskRect.y = f.cz - 70;
    this.env.drawMask(this.islands);
  }

  /** Generate + add island `i` to the world (submerged until unlocked). */
  addIsland(i: number) {
    const def = islandDef(i);
    const isl = new Island(generateIsland(def), this.decor, this.scene);
    isl.rise.snap(def.id === 0 ? -1.1 : -4.2);
    this.islands.push(isl);
    this.riversFlowed.push(isl.data.rivers.map(() => false));
    this.buildSpringStones(this.islands.length - 1);
    return isl;
  }

  private stoneMat = new THREE.MeshStandardMaterial({ color: '#b9b4ab', roughness: 0.9, flatShading: true });
  private buildSpringStones(ii: number) {
    const stoneMat = this.stoneMat;
    {
      const isl = this.islands[ii];
      isl.data.rivers.forEach((rv, ri) => {
        const ti = rv.path[0];
        const t = isl.tiles[ti];
        const g = new THREE.Group();
        g.position.set(t.x, t.h, t.z);
        const ring = 5;
        for (let k = 0; k < ring; k++) {
          const a = (k / ring) * Math.PI * 2;
          const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16, 0), stoneMat);
          st.position.set(Math.cos(a) * 0.42, 0.06, Math.sin(a) * 0.42);
          st.scale.set(1, 0.7 + (k % 2) * 0.4, 1);
          st.castShadow = true;
          g.add(st);
        }
        const mat = new THREE.MeshStandardMaterial({ color: '#bfefff', emissive: new THREE.Color('#7fd8ff'), emissiveIntensity: 0.8, roughness: 0.2, flatShading: true, transparent: true, opacity: 0.92 });
        const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), mat);
        crystal.position.y = 0.45;
        crystal.scale.set(1, 1.5, 1);
        g.add(crystal);
        isl.group.add(g);
        this.springStones.push({ ii, ri, tile: ti, crystal, mat, t: Math.random() * 6 });
      });
    }
  }

  private updateSpringStones(dt: number) {
    for (const s of this.springStones) {
      s.t += dt;
      const flowed = this.riversFlowed[s.ii][s.ri];
      const isl = this.islands[s.ii];
      s.crystal.rotation.y += dt * (flowed ? 0.4 : 1.1);
      const pulse = flowed ? 0.15 : 0.5 + 0.5 * Math.sin(s.t * 2.4);
      s.mat.emissiveIntensity = 0.5 + pulse * 0.9 + this.env.night;
      s.crystal.position.y = 0.45 + Math.sin(s.t * 1.7) * 0.06 + isl.popY[s.tile];
      if (isl.unlocked && isl.group.position.y > -0.3 && Math.random() < dt * (flowed ? 3 : 1.2)) {
        const p = isl.worldPos(s.tile, new THREE.Vector3());
        if (flowed) {
          this.particles.emit({ x: p.x + randSoft() * 0.15, y: p.y + 0.1, z: p.z + randSoft() * 0.15, vx: randSoft() * 0.6, vy: rand(1.5, 2.4), vz: randSoft() * 0.6, life: 0.7, size: 0.07, color: '#e6f8ff', gravity: 6, drag: 0.6 });
        } else {
          this.glow.emit({ x: p.x + randSoft() * 0.3, y: p.y + rand(0.4, 0.9), z: p.z + randSoft() * 0.3, vy: 0.4, life: 1.2, size: 0.14, color: '#bdf0ff', shape: SHAPE.sparkle, drag: 1 });
        }
      }
    }
  }

  // ------------------------------------------------------------------ rivers
  flowRiver(ii: number, ri: number, instant = false) {
    const isl = this.islands[ii];
    if (ri < 0 || this.riversFlowed[ii][ri]) return;
    this.riversFlowed[ii][ri] = true;
    this.amb.rivers++;
    const path = isl.data.rivers[ri].path;
    if (instant) {
      path.forEach((_, k) => isl.showLink(ri, k));
      for (const j of path) {
        isl.makeRiver(j);
        if (isl.stage[j] === 0) isl.setStage(j, 1, true);
        for (const n of isl.tiles[j].neighbors) if (isl.stage[n] === 0) isl.setStage(n, 1, true);
      }
      return;
    }
    this.tutorial.spring = false;
    this.ui.hint(null);
    this.music.swell(0.6);
    const t0 = isl.tiles[path[0]];
    const p0 = isl.worldPos(path[0], new THREE.Vector3());
    this.sfx.splash(this.pan(p0.x, p0.y, p0.z), 1);
    for (let k = 0; k < 16; k++) {
      this.glow.emit({ x: p0.x, y: p0.y + 0.3, z: p0.z, vx: randSoft() * 2, vy: rand(2, 4), vz: randSoft() * 2, life: 1.4, size: 0.18, color: '#bdf0ff', shape: SHAPE.sparkle, gravity: 3, drag: 1 });
    }
    void t0;
    // water runs downhill tile by tile, blooming both banks: an ascending/descending run of notes
    path.forEach((j, k) => {
      this.after(0.3 + k * 0.32, () => {
        isl.makeRiver(j);
        if (k > 0) isl.showLink(ri, k - 1);
        if (k === path.length - 1) this.after(0.3, () => isl.showLink(ri, k));
        isl.popV[j] += 1.2;
        const p = isl.worldPos(j, new THREE.Vector3());
        const pan = this.pan(p.x, p.y, p.z);
        this.splashAt(p.x, p.y - 0.1, p.z, 5);
        this.music.play(0, 'glass', pan, 0.6, 14 - Math.min(10, k));
        this.sfx.plip(pan, true, 1.5);
        if (isl.stage[j] === 0) this.bloom(ii, j, { quietNote: true, cascade: true });
        for (const n of isl.tiles[j].neighbors) {
          if (isl.stage[n] === 0) this.after(0.1 + Math.random() * 0.2, () => this.bloom(ii, n, { quietNote: true, cascade: true }));
          else if (isl.stage[n] === 1 && Math.random() < 0.5) this.after(0.2, () => this.grow(ii, n, 2, true));
        }
        if (k === path.length - 1) {
          // river meets the sea
          this.env.ripple(p.x, p.z, 1);
          this.sfx.splash(pan, 1.4);
          this.splashAt(p.x, 0.05, p.z, 14);
          this.music.arpeggio('glass', 6, 0.07, 7, 0.55, pan);
        }
      });
    });
  }

  // ------------------------------------------------------------------ taps
  tap(ndc: THREE.Vector2) {
    if (!this.started || this.photo) return;
    this.raycaster.setFromCamera(ndc, this.rig.camera);
    const ray = this.raycaster.ray;
    // wonders first, then golden flowers, then creatures, then tiles
    if (this.wonders.tryTap(ray)) return;
    for (let k = 0; k < this.goldenFlowers.length; k++) {
      const g = this.goldenFlowers[k];
      const p = this.decor.position(g.ref);
      p.y += 0.3;
      if (ray.distanceSqToPoint(p) < 0.35 * 0.35) {
        this.collectGolden(k);
        return;
      }
    }
    if (this.creatures.tryTap(ray)) return;
    let best: { ii: number; i: number; d: number } | null = null;
    for (let ii = 0; ii < this.islands.length; ii++) {
      const isl = this.islands[ii];
      if (!isl.unlocked || isl.group.position.y < -0.4) continue;
      const hits = this.raycaster.intersectObject(isl.caps, false);
      if (hits.length && hits[0].instanceId !== undefined && (!best || hits[0].distance < best.d)) {
        best = { ii, i: hits[0].instanceId, d: hits[0].distance };
      }
    }
    if (!best) {
      // tapped the sea: a plink and a ripple
      const p = new THREE.Vector3();
      if (ray.intersectPlane(this.seaPlane, p)) {
        this.env.ripple(p.x, p.z, 0.8);
        this.sfx.plip(this.pan(p.x, 0, p.z), true, 2);
        this.music.play(0.7, 'glass', this.pan(p.x, 0, p.z), 0.4);
      }
      return;
    }
    const { ii, i } = best;
    const isl = this.islands[ii];
    const t = isl.tiles[i];
    const p = isl.worldPos(i, new THREE.Vector3());
    if (isl.stage[i] > 0 && this.seedsUnlocked && !t.pond && t.river < 0 && !t.landmark) {
      const kind = isl.pickTree(i) ?? (t.biome === 'beach' ? null : pick(['roundtree', 'birch', 'bush'] as const));
      if (kind && isl.plantTree(i, kind)) {
        this.planted.push([ii, i, kind]);
        const pan = this.pan(p.x, p.y, p.z);
        this.sfx.tok(pan, 0.9 + Math.random() * 0.3);
        this.music.play(t.h / Math.max(1, isl.data.maxH) + 0.2, 'kalimba', pan, 0.8);
        isl.popV[i] += 1.4;
        isl.active.add(i);
        this.rig.kick(0, -0.6, 0);
        for (let k = 0; k < 8; k++) {
          this.particles.emit({ x: p.x, y: p.y + 0.15, z: p.z, vx: randSoft() * 1.2, vy: rand(1.5, 3), vz: randSoft() * 1.2, life: 0.9, size: 0.13, color: pick(LEAF_COLORS), shape: SHAPE.leaf, gravity: 4, drag: 2, spin: 6, flutter: 0.5 });
        }
        this.creatures.onTree(ii, i);
        if (this.tutorial.tap) {
          this.tutorial.tap = false;
          this.ui.hint(null);
        }
        return;
      }
    }
    // otherwise: a concentrated splash of rain on that tile
    const pan = this.pan(p.x, p.y, p.z);
    this.sfx.plip(pan, false, 2);
    this.splashAt(p.x, p.y, p.z, 6);
    this.cloud.bounce(0.5);
    isl.popV[i] -= 0.6;
    isl.active.add(i);
    this.addMoisture(ii, i, isl.stage[i] > 0 ? 0.3 : 0.55);
    for (const j of t.neighbors) this.addMoisture(ii, j, isl.stage[j] > 0 ? 0.08 : 0.18);
  }

  collectGolden(k: number) {
    const g = this.goldenFlowers[k];
    this.goldenFlowers.splice(k, 1);
    const p = this.decor.position(g.ref);
    this.decor.kick(g.ref, 8);
    this.after(0.25, () => this.decor.remove(g.ref));
    this.golden++;
    this.music.arpeggio('celesta', 9, 0.045, 10, 0.75, this.pan(p.x, p.y, p.z));
    this.cloud.happy = 1;
    for (let n = 0; n < 26; n++) {
      const a = Math.random() * Math.PI * 2;
      this.glow.emit({ x: p.x, y: p.y + 0.3, z: p.z, vx: Math.cos(a) * rand(0.5, 2), vy: rand(1, 3.5), vz: Math.sin(a) * rand(0.5, 2), life: rand(1, 1.8), size: rand(0.12, 0.22), color: pick(['#ffe08a', '#fff3c8', '#ffd65a']), shape: SHAPE.sparkle, gravity: 1.5, drag: 1.5 });
    }
    this.ui.golden(this.golden);
    this.save();
  }

  private rainbow() {
    this.creatures.rainbow(this.cloud.pos, this.rig.camera);
  }

  private tutorialTile() {
    const isl = this.islands[0];
    let best = 0, bd = 1e9;
    for (const t of isl.tiles) {
      const d = Math.hypot(t.x, t.z + 1);
      if (d < bd && !t.pond) {
        bd = d;
        best = t.i;
      }
    }
    return { isl: 0, tile: best };
  }

  // ------------------------------------------------------------------ save
  save() {
    if (!this.started) return;
    const data: SaveData = {
      v: 1,
      unlocked: this.unlocked,
      islands: this.islands.map((isl, ii) => ({
        m: Array.from(isl.moist, (m) => Math.round(m * 50) / 50),
        s: Array.from(isl.stage).join(''),
        rd: isl.regionDone.slice(),
        rv: this.riversFlowed[ii].slice(),
        c: isl.complete,
      })),
      planted: this.planted.slice(-600),
      wonders: [...this.collected],
      golden: this.golden,
      goldenTiles: this.goldenFlowers.map((g) => [g.isl, g.tile]),
      freePlay: this.freePlay,
      tod: this.env.tod,
      playTime: this.playTime,
      settings: { alwaysRain: this.input.alwaysRain, muted: this.audio.muted, music: CFG.musicVol, sfx: CFG.sfxVol, amb: CFG.ambVol },
    };
    writeSave(data);
  }

  private applySave(s: SaveData) {
    while (this.islands.length < Math.min(MAX_ISLANDS, s.unlocked)) this.addIsland(this.islands.length);
    this.unlocked = s.unlocked;
    this.freePlay = !!s.freePlay;
    this.golden = s.golden || 0;
    this.playTime = s.playTime || 0;
    for (const w of s.wonders || []) this.collected.add(w as WonderKind);
    if (s.settings) {
      this.input.alwaysRain = !!s.settings.alwaysRain;
      CFG.musicVol = s.settings.music ?? CFG.musicVol;
      CFG.sfxVol = s.settings.sfx ?? CFG.sfxVol;
      CFG.ambVol = s.settings.amb ?? CFG.ambVol;
      this.audio.applyVolumes();
      if (s.settings.muted) this.audio.setMuted(true);
    }
    s.islands.forEach((si, ii) => {
      const isl = this.islands[ii];
      if (!isl || ii >= s.unlocked) return;
      isl.unlocked = true;
      isl.rise.snap(0);
      si.m.forEach((m, i) => (isl.moist[i] = m));
      for (let i = 0; i < isl.n; i++) {
        const st = Number(si.s[i] || 0);
        if (st > 0) isl.setStage(i, st, true);
        if (st > 0 && isl.tiles[i].pond) this.amb.ponds++;
        isl.active.add(i);
      }
      (si.rv || []).forEach((f, ri) => f && this.flowRiver(ii, ri, true));
      si.rd.forEach((d, r) => {
        if (d) {
          isl.regionDone[r] = true;
          this.landmarks.build(ii, r, true);
          this.creatures.onRegion(ii, r, true);
        }
      });
      isl.complete = !!si.c;
      for (let i = 0; i < isl.n; i++) {
        const t = isl.tiles[i];
        if (t.wonder && isl.stage[i] > 0) this.wonders.reveal(ii, i, true);
      }
    });
    for (const [ii, i, kind] of s.planted || []) {
      if (this.islands[ii]?.plantTree(i, kind as any, true)) this.planted.push([ii, i, kind]);
    }
    for (const [ii, i] of s.goldenTiles || []) this.spawnGolden(ii, i, true);
    this.music.layers.drone = this.islands.some((isl) => isl.regionDone.some(Boolean));
    this.music.layers.harp = this.islands.some((isl) => isl.complete);
    if (this.seedsUnlocked) this.cloud.setLeaf(true);
    this.islands.forEach((isl) => isl.complete && this.addCloudlet(true));
    if (typeof s.tod === 'number') this.env.tod = s.tod;
    // focus the furthest unlocked island that isn't finished
    let f = 0;
    this.islands.forEach((isl, i) => {
      if (isl.unlocked && !isl.complete) f = i;
    });
    if (this.islands.every((x) => !x.unlocked || x.complete)) f = this.unlocked - 1;
    this.focus = f;
    const fi = this.islands[f];
    this.rig.target.snap(fi.cx, 0.6, fi.cz);
    this.cloudTarget.set(fi.cx, 6, fi.cz);
    this.cloud.setPosition(fi.cx - 5, 14, fi.cz + 4);
    this.autopilotUntil = 2.5;
    this.todTarget = ISLAND_TOD[Math.min(f, ISLAND_TOD.length - 1)];
    this.env.tod = this.freePlay ? this.env.tod : this.todTarget;
    if (this.freePlay) this.todTarget = this.env.tod;
    this.env.vitality = this.vitality();
  }

  resetProgress() {
    clearSave();
    location.reload();
  }

  get wonderInfo() {
    return WONDER_INFO;
  }
}

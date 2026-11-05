// Life that arrives as the world blooms: butterflies, birds, sheep, fish, fireflies, rainbows.
import * as THREE from 'three';
import { Spring, clamp, pick, rand, randSoft } from '../core/math';
import { U } from '../core/shaders';
import { SHAPE } from '../fx/particles';
import type { Game } from '../game/game';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();

function flapMaterial(color: THREE.ColorRepresentation, speed: number, amp: number) {
  const m = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float ph = float(gl_InstanceID) * 1.73;
         float fl = sin(uTime * ${speed.toFixed(2)} + ph) * ${amp.toFixed(2)};
         float ax = abs(transformed.x);
         transformed.y += ax * sin(fl);
         transformed.x *= cos(fl);`,
      );
  };
  return m;
}

interface Butterfly { p: THREE.Vector3; v: THREE.Vector3; home: THREE.Vector3; ground: number; t: number; scale: Spring }
interface Bird { p: THREE.Vector3; center: THREE.Vector3; r: number; ang: number; speed: number; h: number; leaving: number; life: number; scale: Spring; takeoff: number }
interface Sheep {
  g: THREE.Group; body: THREE.Mesh; head: THREE.Mesh; ii: number; tile: number;
  from: THREE.Vector3; to: THREE.Vector3; hopT: number; hopDur: number; idle: number; sq: Spring; yaw: number; jump: number; jumpV: number; pop: Spring;
}

export class Creatures {
  private bflyMesh: THREE.InstancedMesh;
  private birdMesh: THREE.InstancedMesh;
  private bflies: Butterfly[] = [];
  private birds: Bird[] = [];
  private sheep: Sheep[] = [];
  private fish: THREE.Mesh;
  private fishT = -1;
  private fishFrom = new THREE.Vector3();
  private fishTo = new THREE.Vector3();
  private nextFish = 6;
  private rainbowMesh: THREE.Mesh;
  private rainbowS = new Spring(0, 90, 9);
  private rainbowLife = 0;
  private sheepGeo: { body: THREE.BufferGeometry; head: THREE.BufferGeometry; leg: THREE.BufferGeometry };
  private sheepMats: { wool: THREE.Material; face: THREE.Material };
  private treesPlanted = 0;
  private t = 0;

  constructor(private g: Game) {
    // butterflies: two wings in the xz plane
    const bg = new THREE.BufferGeometry();
    const w = [
      0, 0, 0, 0.12, 0, -0.06, 0.1, 0, 0.08,
      0, 0, 0, -0.1, 0, 0.08, -0.12, 0, -0.06,
      0, 0, 0, 0.08, 0, 0.1, 0.03, 0, 0.13,
      0, 0, 0, -0.03, 0, 0.13, -0.08, 0, 0.1,
    ];
    bg.setAttribute('position', new THREE.Float32BufferAttribute(w, 3));
    bg.computeVertexNormals();
    this.bflyMesh = new THREE.InstancedMesh(bg, flapMaterial('#ffffff', 16, 1.0), 48);
    this.bflyMesh.count = 0;
    this.bflyMesh.frustumCulled = false;
    g.scene.add(this.bflyMesh);

    const birdG = new THREE.BufferGeometry();
    const bw = [
      0, 0, 0.08, 0.32, 0.0, -0.08, 0.05, 0, -0.06,
      0, 0, 0.08, -0.05, 0, -0.06, -0.32, 0.0, -0.08,
      0, 0.01, 0.1, 0.035, 0, -0.12, -0.035, 0, -0.12,
    ];
    birdG.setAttribute('position', new THREE.Float32BufferAttribute(bw, 3));
    birdG.computeVertexNormals();
    this.birdMesh = new THREE.InstancedMesh(birdG, flapMaterial('#f6f3ec', 7.5, 0.7), 64);
    this.birdMesh.count = 0;
    this.birdMesh.frustumCulled = false;
    this.birdMesh.castShadow = true;
    g.scene.add(this.birdMesh);

    this.sheepGeo = {
      body: new THREE.IcosahedronGeometry(0.17, 1),
      head: new THREE.BoxGeometry(0.11, 0.11, 0.13),
      leg: new THREE.CylinderGeometry(0.02, 0.02, 0.1, 4).translate(0, -0.05, 0),
    };
    this.sheepMats = {
      wool: new THREE.MeshStandardMaterial({ color: '#fbf8f2', roughness: 1, flatShading: true }),
      face: new THREE.MeshStandardMaterial({ color: '#4a4440', roughness: 0.9, flatShading: true }),
    };

    const fg = new THREE.ConeGeometry(0.06, 0.26, 5);
    fg.rotateX(Math.PI / 2);
    this.fish = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ color: '#f2a65a', roughness: 0.5, flatShading: true }));
    this.fish.visible = false;
    g.scene.add(this.fish);

    // rainbow arc
    const rg = new THREE.TorusGeometry(2.6, 0.32, 8, 48, Math.PI);
    const rm = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uA: { value: 0 } },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
      fragmentShader: `varying vec3 vP; uniform float uA;
        vec3 hsv(float h){ vec3 k = vec3(1.0, 2.0/3.0, 1.0/3.0); vec3 p = abs(fract(vec3(h) + k) * 6.0 - 3.0); return clamp(p - 1.0, 0.0, 1.0); }
        void main(){ float r = length(vP.xy); float t = clamp((r - 2.28) / 0.64, 0.0, 1.0);
          vec3 c = mix(vec3(1.0), hsv(0.83 - t * 0.83), 0.55);
          float edge = smoothstep(0.0, 0.2, t) * smoothstep(1.0, 0.8, t);
          float foot = smoothstep(0.0, 0.8, vP.y);
          gl_FragColor = vec4(c, uA * edge * foot * 0.5); }`,
    });
    this.rainbowMesh = new THREE.Mesh(rg, rm);
    this.rainbowMesh.visible = false;
    this.rainbowMesh.renderOrder = 13;
    g.scene.add(this.rainbowMesh);
  }

  // -------------------------------------------------------------- spawning hooks
  onLush(ii: number, i: number, force = false) {
    const isl = this.g.islands[ii];
    const t = isl.tiles[i];
    if (!force && !(t.biome === 'meadow' || t.biome === 'blossom' || t.biome === 'marsh')) return;
    if (this.bflies.length >= 48 || (!force && Math.random() > 0.22)) return;
    const p = isl.worldPos(i, new THREE.Vector3());
    const c = new THREE.Color(pick(['#fff2b3', '#ffffff', '#ffd1dc', '#cfe8ff', '#ffcf99', '#e6d4ff']));
    this.bflyMesh.setColorAt(this.bflies.length, c);
    if (this.bflyMesh.instanceColor) this.bflyMesh.instanceColor.needsUpdate = true;
    this.bflies.push({ p: p.clone().setY(p.y + 0.4), v: new THREE.Vector3(), home: p.clone(), ground: p.y, t: Math.random() * 100, scale: new Spring(0, 120, 8) });
    this.bflies[this.bflies.length - 1].scale.target = 1;
    this.bflyMesh.count = this.bflies.length;
  }

  onRegion(ii: number, r: number, instant = false) {
    const isl = this.g.islands[ii];
    const reg = isl.data.regions[r];
    const lt = isl.tiles[reg.landmarkTile];
    // a couple of birds circle each finished grove
    if (this.birds.length < 40) {
      for (let k = 0; k < 2; k++) this.addBird(new THREE.Vector3(lt.x + isl.cx, 0, lt.z + isl.cz), instant ? 0 : 1, -1);
    }
    // sheep graze on meadow groves
    const meadowish = reg.tiles.filter((j) => {
      const t = isl.tiles[j];
      return (t.biome === 'meadow' || t.biome === 'highland') && !t.pond && t.river < 0 && !t.landmark;
    });
    if (meadowish.length >= 4 && this.sheep.length < 18) {
      const n = meadowish.length > 8 ? 2 : 1;
      for (let k = 0; k < n; k++) this.addSheep(ii, pick(meadowish), instant);
    }
  }

  onTree(ii: number, i: number) {
    this.treesPlanted++;
    if (this.treesPlanted % 4 === 0 && this.birds.length < 48) {
      const p = this.g.islands[ii].worldPos(i, new THREE.Vector3());
      this.addBird(p, 1, -1);
    }
  }

  birdBurst(x: number, z: number, n: number) {
    for (let k = 0; k < n; k++) {
      const c = new THREE.Vector3(x + randSoft() * 4, 0, z + randSoft() * 4);
      this.addBird(c, 1, 9 + Math.random() * 5);
    }
  }

  private addBird(center: THREE.Vector3, takeoff: number, life: number) {
    if (this.birds.length >= 64) return;
    const gy = this.g.groundY(center.x, center.z);
    const b: Bird = {
      p: new THREE.Vector3(center.x, gy + 0.2, center.z),
      center: center.clone(), r: rand(2, 4.5), ang: Math.random() * Math.PI * 2, speed: rand(0.25, 0.45) * (Math.random() < 0.5 ? -1 : 1),
      h: rand(4.5, 7.5), leaving: 0, life, scale: new Spring(0, 100, 9), takeoff: takeoff ? 1 : 0,
    };
    b.scale.target = 1;
    if (!takeoff) {
      b.takeoff = 0;
      b.scale.snap(1);
    }
    this.birds.push(b);
    this.birdMesh.count = this.birds.length;
  }

  private addSheep(ii: number, tile: number, instant: boolean) {
    const isl = this.g.islands[ii];
    const g = new THREE.Group();
    const body = new THREE.Mesh(this.sheepGeo.body, this.sheepMats.wool);
    body.scale.set(1.15, 0.9, 1.35);
    body.position.y = 0.17;
    body.castShadow = true;
    const head = new THREE.Mesh(this.sheepGeo.head, this.sheepMats.face);
    head.position.set(0, 0.22, 0.22);
    head.castShadow = true;
    const tuft = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 0), this.sheepMats.wool);
    tuft.position.set(0, 0.07, -0.01);
    head.add(tuft);
    g.add(body, head);
    for (const [x, z] of [[0.08, 0.1], [-0.08, 0.1], [0.08, -0.1], [-0.08, -0.1]]) {
      const l = new THREE.Mesh(this.sheepGeo.leg, this.sheepMats.face);
      l.position.set(x, 0.1, z);
      g.add(l);
    }
    const p = isl.worldPos(tile, new THREE.Vector3());
    p.x += randSoft() * 0.3;
    p.z += randSoft() * 0.3;
    p.y = 0 + isl.tiles[tile].h;
    g.position.copy(p);
    const s: Sheep = {
      g, body, head, ii, tile, from: p.clone(), to: p.clone(), hopT: 1, hopDur: 0.45, idle: rand(1, 4),
      sq: new Spring(0, 260, 12), yaw: Math.random() * 6, jump: 0, jumpV: 0, pop: new Spring(instant ? 1 : 0, 150, 9),
    };
    s.pop.target = 1;
    g.scale.setScalar(instant ? 1 : 0.0001);
    this.g.scene.add(g);
    this.sheep.push(s);
    if (!instant) this.g.sfx.baa(this.g.pan(p.x, p.y, p.z), rand(0.95, 1.15));
  }

  hover(ray: THREE.Ray) {
    for (const s of this.sheep) {
      const p = s.g.position.clone();
      p.y += 0.3;
      if (ray.distanceSqToPoint(p) < 0.4 * 0.4 && s.sq.settled && s.jump <= 0) s.sq.vel = -3;
    }
  }

  tryTap(ray: THREE.Ray): boolean {
    for (const s of this.sheep) {
      const p = s.g.position.clone();
      p.y += 0.3;
      if (ray.distanceSqToPoint(p) < 0.4 * 0.4) {
        s.jumpV = 5.2;
        s.sq.vel = -6;
        const pan = this.g.pan(p.x, p.y, p.z);
        this.g.sfx.baa(pan, rand(1.0, 1.25));
        this.g.music.play(0.8, 'marimba', pan, 0.6);
        this.g.particles.emit({ x: p.x, y: p.y + 0.3, z: p.z, vy: 1.2, life: 1.2, size: 0.28, color: '#f49fae', shape: SHAPE.heart, drag: 1.5 });
        this.g.cloud.happy = 1;
        return true;
      }
    }
    return false;
  }

  rainbow(at: THREE.Vector3, cam: THREE.Camera) {
    const m = this.rainbowMesh;
    const away = new THREE.Vector3().subVectors(at, cam.position).setY(0).normalize();
    m.position.copy(at).addScaledVector(away, 2).setY(at.y - 3.2);
    m.lookAt(m.position.clone().sub(away));
    m.visible = true;
    this.rainbowS.snap(0.2);
    this.rainbowS.target = 1;
    this.rainbowLife = 3.5;
    this.g.music.arpeggio('glass', 5, 0.09, 9, 0.35);
  }

  // -------------------------------------------------------------- update
  update(dt: number) {
    this.t += dt;
    const g = this.g;
    const night = U.uNight.value;
    const cp = g.cloud.pos;

    // butterflies: wander around home, shy of rain
    for (let i = 0; i < this.bflies.length; i++) {
      const b = this.bflies[i];
      b.t += dt;
      b.scale.update(dt);
      const wander = new THREE.Vector3(Math.sin(b.t * 1.3 + i) * 1.4, Math.sin(b.t * 2.7 + i * 3) * 0.8, Math.cos(b.t * 1.1 + i * 2) * 1.4);
      const toHome = b.home.clone().sub(b.p).multiplyScalar(0.8);
      b.v.lerp(wander.add(toHome), Math.min(1, dt * 2));
      const dc = Math.hypot(b.p.x - cp.x, b.p.z - cp.z);
      if (g.cloud.raining > 0.3 && dc < 2.5) b.v.add(new THREE.Vector3(b.p.x - cp.x, 0, b.p.z - cp.z).normalize().multiplyScalar(2));
      b.p.addScaledVector(b.v, dt);
      b.p.y = clamp(b.p.y, b.ground + 0.25, b.ground + 1.3);
      const s = b.scale.value * (1 - night * 0.6);
      _e.set(0, Math.atan2(b.v.x, b.v.z), 0);
      _q.setFromEuler(_e);
      _s.set(s, s, s);
      _m.compose(b.p, _q, _s);
      this.bflyMesh.setMatrixAt(i, _m);
    }
    if (this.bflies.length) this.bflyMesh.instanceMatrix.needsUpdate = true;

    // birds: circle groves, burst birds leave after a while
    for (let i = this.birds.length - 1; i >= 0; i--) {
      const b = this.birds[i];
      b.scale.update(dt);
      b.ang += b.speed * dt;
      if (b.life > 0) {
        b.life -= dt;
        if (b.life <= 0) b.leaving = 0.001;
      }
      const tgt = new THREE.Vector3(b.center.x + Math.cos(b.ang) * b.r, b.h + Math.sin(b.ang * 2.3) * 0.4, b.center.z + Math.sin(b.ang) * b.r);
      if (b.leaving > 0) {
        b.leaving += dt;
        tgt.set(b.center.x + Math.cos(b.ang) * (b.r + b.leaving * 12), b.h + b.leaving * 3, b.center.z + Math.sin(b.ang) * (b.r + b.leaving * 12));
        if (b.leaving > 6) {
          this.birds.splice(i, 1);
          continue;
        }
      }
      const prev = b.p.clone();
      b.p.lerp(tgt, Math.min(1, dt * (b.takeoff ? 0.9 : 3)));
      if (b.takeoff && b.p.distanceTo(tgt) < 1) b.takeoff = 0;
      const dir = b.p.clone().sub(prev);
      _e.set(-dir.y * 2, Math.atan2(dir.x, dir.z), -b.speed * 0.8);
      _q.setFromEuler(_e);
      const s = b.scale.value;
      _s.set(s, s, s);
      _m.compose(b.p, _q, _s);
      this.birdMesh.setMatrixAt(i, _m);
    }
    this.birdMesh.count = this.birds.length;
    if (this.birds.length) this.birdMesh.instanceMatrix.needsUpdate = true;

    // sheep: graze, then hop to a neighbour tile
    for (const s of this.sheep) {
      const isl = g.islands[s.ii];
      s.pop.update(dt);
      s.sq.update(dt);
      let headY = 0.22;
      if (s.hopT < 1) {
        s.hopT = Math.min(1, s.hopT + dt / s.hopDur);
        const t = s.hopT;
        s.g.position.lerpVectors(s.from, s.to, t);
        s.g.position.y += Math.sin(t * Math.PI) * 0.28;
        if (s.hopT >= 1) {
          s.sq.vel = -4;
          if (Math.random() < 0.3) g.sfx.tok(g.pan(s.to.x, s.to.y, s.to.z), 0.5, 0.25);
        }
      } else {
        s.idle -= dt;
        // grazing head bob
        headY = 0.22 - (Math.sin(this.t * 3 + s.yaw) > 0.4 ? 0.07 : 0);
        if (s.idle <= 0) {
          s.idle = rand(2, 6);
          const opts = isl.tiles[s.tile].neighbors.filter((j) => {
            const t = isl.tiles[j];
            return isl.stage[j] > 0 && !t.pond && t.river < 0 && !t.landmark && Math.abs(t.h - isl.tiles[s.tile].h) <= 0.5;
          });
          if (opts.length && Math.random() < 0.75) {
            const j = pick(opts);
            s.tile = j;
            s.from.copy(s.g.position);
            const p = isl.worldPos(j, new THREE.Vector3());
            s.to.set(p.x + randSoft() * 0.3, 0 + isl.tiles[j].h, p.z + randSoft() * 0.3);
            s.hopT = 0;
            s.hopDur = rand(0.4, 0.55);
            s.yaw = Math.atan2(s.to.x - s.from.x, s.to.z - s.from.z);
            s.sq.vel = 3;
          } else if (Math.random() < 0.15) g.sfx.baa(g.pan(s.g.position.x, s.g.position.y, s.g.position.z), rand(0.9, 1.2));
        }
      }
      // tap jump
      if (s.jumpV !== 0 || s.jump > 0) {
        s.jumpV -= 16 * dt;
        s.jump = Math.max(0, s.jump + s.jumpV * dt);
        if (s.jump <= 0 && s.jumpV < 0) {
          s.jumpV = 0;
          s.sq.vel = -5;
        }
      }
      s.g.rotation.y += (((s.yaw - s.g.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 6);
      const sq = s.sq.value;
      const pop = Math.max(0.0001, s.pop.value);
      s.g.scale.set(1.4 * pop * (1 - sq * 0.3), 1.4 * pop * (1 + sq), 1.4 * pop * (1 - sq * 0.3));
      s.body.position.y = 0.17 + s.jump;
      s.head.position.y += (headY + s.jump - s.head.position.y) * Math.min(1, dt * 14);
    }

    // fish leap from the sea near the focus island
    this.nextFish -= dt * g.env.vitality;
    if (this.fishT < 0 && this.nextFish <= 0) {
      this.nextFish = rand(5, 12);
      const isl = g.islands[g.focus];
      const a = Math.random() * Math.PI * 2;
      const r = isl.radius + rand(1, 4);
      this.fishFrom.set(isl.cx + Math.cos(a) * r, -0.1, isl.cz + Math.sin(a) * r);
      this.fishTo.copy(this.fishFrom).add(new THREE.Vector3(randSoft() * 1.5, 0, randSoft() * 1.5));
      this.fishT = 0;
      this.fish.visible = true;
      (this.fish.material as THREE.MeshStandardMaterial).color.set(pick(['#f2a65a', '#e9c46a', '#9fc7d8', '#f4978e']));
      g.sfx.splash(g.pan(this.fishFrom.x, 0, this.fishFrom.z), 0.4);
      g.splashAt(this.fishFrom.x, 0, this.fishFrom.z, 5);
      g.env.ripple(this.fishFrom.x, this.fishFrom.z, 0.5);
    }
    if (this.fishT >= 0) {
      this.fishT += dt / 0.9;
      const t = this.fishT;
      const p = new THREE.Vector3().lerpVectors(this.fishFrom, this.fishTo, t);
      p.y = -0.1 + Math.sin(t * Math.PI) * 1.1;
      const prev = this.fish.position.clone();
      this.fish.position.copy(p);
      this.fish.lookAt(p.clone().add(p.clone().sub(prev)));
      if (t >= 1) {
        this.fishT = -1;
        this.fish.visible = false;
        g.sfx.splash(g.pan(p.x, 0, p.z), 0.5);
        g.splashAt(p.x, 0, p.z, 6);
        g.env.ripple(p.x, p.z, 0.5);
        g.music.play(0.9, 'glass', g.pan(p.x, 0, p.z), 0.3);
      }
    }

    // fireflies drift up from living tiles at dusk/night
    if (night > 0.2) {
      const isl = g.islands[g.focus];
      const n = dt * 18 * night;
      for (let k = 0; k < n + (Math.random() < n % 1 ? 1 : 0); k++) {
        const i = Math.floor(Math.random() * isl.n);
        if (isl.stage[i] < 1) continue;
        const p = isl.worldPos(i, new THREE.Vector3());
        g.glow.emit({
          x: p.x + randSoft() * 0.7, y: p.y + rand(0.15, 0.6), z: p.z + randSoft() * 0.7, vx: randSoft() * 0.15, vy: rand(0.05, 0.2), vz: randSoft() * 0.15,
          life: rand(3, 5), size: rand(0.12, 0.2), color: pick(['#fff1a8', '#e8ffb0', '#ffe39a']), alpha: 1, shape: SHAPE.dot, drag: 0.4, flutter: 0.25,
        });
      }
    }

    // rainbow
    if (this.rainbowLife > 0) {
      this.rainbowLife -= dt;
      this.rainbowS.update(dt);
      const s = Math.max(0.0001, this.rainbowS.value);
      this.rainbowMesh.scale.set(s, s, s);
      const a = Math.min(1, this.rainbowLife / 1.2) * Math.min(1, (3.5 - this.rainbowLife) * 3);
      (this.rainbowMesh.material as THREE.ShaderMaterial).uniforms.uA.value = a * (1 - night * 0.7);
      if (this.rainbowLife <= 0) this.rainbowMesh.visible = false;
    }
  }
}

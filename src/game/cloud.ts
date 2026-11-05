// The player: a soft, springy raincloud with a tiny face.
import * as THREE from 'three';
import { CFG } from '../core/config';
import { Spring, Spring3, clamp, rand } from '../core/math';

interface Puff {
  mesh: THREE.Mesh;
  off: THREE.Vector3;
  r: number;
  sp: Spring3;
  scale: Spring;
  phase: number;
}

export class Cloud {
  group = new THREE.Group();
  body: Spring3;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  puffs: Puff[] = [];
  material: THREE.MeshStandardMaterial;
  charge = 0; // 0..1 while holding
  raining = 0; // smoothed 0..1
  size = new Spring(1, 120, 9);
  private eyes: THREE.Mesh[] = [];
  private eyeOpen = new Spring(1, 300, 18);
  private blinkT = 2;
  private t = 0;
  private leaf: THREE.Group;
  private leafS = new Spring(0, 160, 10);
  private glowLight: THREE.PointLight;
  happy = 0;
  sleep = 0;
  wobble = new Spring(0, 140, 7);

  constructor(scene: THREE.Scene) {
    this.material = new THREE.MeshStandardMaterial({
      color: '#ffffff', roughness: 1, emissive: new THREE.Color('#e6eef7'), emissiveIntensity: 0.35,
    });
    this.material.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <opaque_fragment>',
        `{ float rim = pow(1.0 - abs(dot(normalize(normal), vec3(0.0,0.0,1.0))), 2.5);
           outgoingLight += vec3(1.0) * rim * 0.22; }
         #include <opaque_fragment>`,
      );
    };
    const geo = new THREE.IcosahedronGeometry(1, 3);
    const layout: [number, number, number, number][] = [
      [0, 0, 0, 0.78],
      [0.75, -0.12, 0.1, 0.58],
      [-0.72, -0.1, -0.05, 0.6],
      [0.28, 0.38, -0.12, 0.55],
      [-0.3, 0.32, 0.18, 0.5],
      [0.1, -0.15, 0.55, 0.5],
      [-0.1, -0.12, -0.55, 0.52],
      [1.25, -0.25, -0.15, 0.36],
      [-1.2, -0.28, 0.2, 0.34],
    ];
    layout.forEach(([x, y, z, r], i) => {
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.castShadow = true;
      const sp = new Spring3(x, y, z, CFG.puffK * (0.7 + (i % 4) * 0.15), CFG.puffC);
      this.puffs.push({ mesh, off: new THREE.Vector3(x, y, z), r, sp, scale: new Spring(r, 160, 9), phase: Math.random() * 10 });
      scene.add(mesh);
    });
    this.body = new Spring3(0, CFG.cloudHeight, 0, CFG.cloudK, CFG.cloudC);

    // eyes: little dark ovals that face the camera
    const eyeMat = new THREE.MeshBasicMaterial({ color: '#4a4f5c', depthTest: false });
    const eyeGeo = new THREE.SphereGeometry(0.1, 12, 8);
    for (let i = 0; i < 2; i++) {
      const e = new THREE.Mesh(eyeGeo, eyeMat);
      e.renderOrder = 20;
      this.eyes.push(e);
      this.group.add(e);
    }
    const cheekMat = new THREE.MeshBasicMaterial({ color: '#f6b8c8', transparent: true, opacity: 0.55, depthTest: false });
    for (let i = 0; i < 2; i++) {
      const ch = new THREE.Mesh(new THREE.CircleGeometry(0.11, 14), cheekMat);
      ch.renderOrder = 19;
      ch.name = 'cheek';
      this.group.add(ch);
    }
    // a leaf sprout appears once seeds are unlocked
    this.leaf = new THREE.Group();
    const leafMat = new THREE.MeshStandardMaterial({ color: '#86c06c', flatShading: true });
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.25, 4), leafMat);
    stem.position.y = 0.12;
    const l1 = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), leafMat);
    l1.scale.set(1.4, 0.35, 0.7);
    l1.position.set(0.12, 0.26, 0);
    l1.rotation.z = 0.4;
    const l2 = l1.clone();
    l2.position.set(-0.1, 0.22, 0);
    l2.rotation.z = -0.5;
    l2.scale.set(1.1, 0.3, 0.6);
    this.leaf.add(stem, l1, l2);
    this.leaf.scale.setScalar(0.0001);
    this.group.add(this.leaf);
    this.glowLight = new THREE.PointLight('#ffe8b0', 0, 9, 1.6);
    this.group.add(this.glowLight);
    scene.add(this.group);
  }

  setLeaf(on: boolean) {
    this.leafS.target = on ? 1 : 0;
  }

  setPosition(x: number, y: number, z: number) {
    this.body.snap(x, y, z);
    for (const p of this.puffs) p.sp.snap(x + p.off.x, y + p.off.y, z + p.off.z);
  }

  /** Little bounce, used for feedback. */
  bounce(v = 1) {
    this.size.impulse(v * 1.4);
    this.wobble.impulse(v * 3);
  }

  update(dt: number, target: THREE.Vector3, holding: boolean, camera: THREE.Camera, night: number) {
    this.t += dt;
    const b = this.body;
    b.setParams(CFG.cloudK, CFG.cloudC);
    b.setTarget(target.x, target.y, target.z);
    const px = b.x.value, pz = b.z.value;
    b.update(dt);
    this.vel.set((b.x.value - px) / Math.max(dt, 1e-4), 0, (b.z.value - pz) / Math.max(dt, 1e-4));
    this.pos.set(b.x.value, b.y.value, b.z.value);

    this.charge = holding ? Math.min(1, this.charge + dt / CFG.chargeTime) : Math.max(0, this.charge - dt * 1.5);
    this.raining += ((holding ? 1 : 0) - this.raining) * Math.min(1, dt * 8);
    this.size.target = 1 + this.charge * 0.32 - this.raining * 0.04;
    this.size.update(dt);
    this.wobble.update(dt);

    const size = this.size.value;
    const speed = this.vel.length();
    // grey-up slightly while raining: the cloud is "wringing out"
    const tint = 1 - this.raining * 0.13;
    this.material.color.setRGB(tint, tint * 1.01, tint * 1.04);
    this.material.emissiveIntensity = 0.35 + night * 0.25;

    for (const p of this.puffs) {
      const br = this.sleep > 0.3 ? 0.7 : 1.6;
      const breathe = 1 + Math.sin(this.t * br + p.phase * (1 - this.sleep * 0.8)) * (0.04 + this.sleep * 0.03) + Math.sin(this.t * 7 + p.phase) * 0.012 * this.raining;
      p.sp.setParams(CFG.puffK * (0.6 + p.r * 0.6), CFG.puffC);
      const flat = 1 - this.raining * 0.08;
      p.sp.setTarget(
        b.x.value + p.off.x * size,
        b.y.value + p.off.y * size * flat + Math.sin(this.t * 1.1 + p.phase) * 0.05,
        b.z.value + p.off.z * size,
      );
      p.sp.update(dt);
      p.scale.target = p.r * size * breathe;
      p.scale.update(dt);
      const w = 1 + this.wobble.value * 0.08 * Math.sin(p.phase * 3);
      p.mesh.position.set(p.sp.x.value, p.sp.y.value, p.sp.z.value);
      // stretch along motion
      const st = clamp(speed * 0.02, 0, 0.25);
      p.mesh.scale.set(p.scale.value * (1 + st) * w, p.scale.value * (1 - st * 0.5) / w, p.scale.value * (1 + st * 0.5) * w);
    }

    // face toward camera on the front of the main puff
    const main = this.puffs[0];
    const toCam = new THREE.Vector3().subVectors(camera.position, main.mesh.position);
    toCam.y *= 0.3;
    toCam.normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), toCam).normalize();
    // the face sits on whichever puff surface is closest to the camera near the middle
    let front = main.scale.value * 0.96;
    for (const p of this.puffs) {
      const rel = p.mesh.position.clone().sub(main.mesh.position);
      const lateral = rel.clone().addScaledVector(toCam, -rel.dot(toCam)).length();
      if (lateral < p.scale.value * 0.8) front = Math.max(front, rel.dot(toCam) + Math.sqrt(Math.max(0, p.scale.value ** 2 - lateral ** 2)) * 0.97);
    }
    const face = main.mesh.position.clone().addScaledVector(toCam, front);
    face.y -= main.scale.value * 0.05;
    // look slightly in the direction of travel
    const look = new THREE.Vector3(this.vel.x, 0, this.vel.z).multiplyScalar(0.015).clampLength(0, 0.06);

    // blink
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blinkT = rand(2.5, 6);
      this.eyeOpen.value = 0.1;
      this.eyeOpen.vel = 0;
    }
    const squint = Math.max(this.raining * 0.55 + this.happy * 0.6, this.sleep * 0.93);
    this.eyeOpen.target = 1 - squint;
    if (this.sleep > 0.5) this.blinkT = 3;
    this.eyeOpen.update(dt);
    this.happy = Math.max(0, this.happy - dt * 0.8);

    this.eyes.forEach((e, i) => {
      const side = i === 0 ? -1 : 1;
      e.position.copy(face).addScaledVector(right, side * 0.2 * size).add(look);
      e.position.y += 0.05 * size;
      e.lookAt(camera.position);
      const open = clamp(this.eyeOpen.value, 0.08, 1.2);
      e.scale.set(size * 0.9, size * open * 1.25, size * 0.5);
    });
    let ci = 0;
    for (const ch of this.group.children) {
      if (ch.name !== 'cheek') continue;
      const side = ci++ === 0 ? -1 : 1;
      ch.position.copy(face).addScaledVector(right, side * 0.38 * size).addScaledVector(toCam, -0.02).add(look);
      ch.position.y -= 0.07 * size;
      ch.lookAt(camera.position);
      ch.scale.setScalar(size * (0.7 + this.happy * 0.5 + this.raining * 0.2));
    }
    // leaf
    this.leafS.update(dt);
    const top = this.puffs[3];
    this.leaf.position.set(top.sp.x.value, top.sp.y.value + top.scale.value * 0.85, top.sp.z.value);
    this.leaf.rotation.z = Math.sin(this.t * 2.2) * 0.15 - this.vel.x * 0.02;
    this.leaf.rotation.x = this.vel.z * 0.02;
    this.leaf.scale.setScalar(Math.max(0.0001, this.leafS.value * 1.3));

    // a warm lantern glow under the cloud at night
    this.glowLight.position.copy(this.pos).setY(this.pos.y - 1.2);
    this.glowLight.position.sub(this.group.position);
    this.glowLight.intensity = night * 6;
  }
}

/** A baby cloud earned by restoring an island. Follows like a duckling, rains too. */
export class Cloudlet {
  group = new THREE.Group();
  pos: Spring3;
  private puffs: THREE.Mesh[] = [];
  private offs: THREE.Vector3[] = [];
  private eyes: THREE.Mesh[] = [];
  private pop = new Spring(0, 140, 8);
  private blink = Math.random() * 4;
  private eyeOpen = new Spring(1, 300, 18);
  private t = Math.random() * 10;
  raining = 0;

  constructor(scene: THREE.Scene, mat: THREE.Material, start: THREE.Vector3, public index: number) {
    const geo = new THREE.IcosahedronGeometry(1, 2);
    const layout: [number, number, number, number][] = [[0, 0, 0, 0.42], [0.36, -0.06, 0.05, 0.3], [-0.34, -0.05, -0.03, 0.3], [0.05, 0.2, -0.05, 0.28]];
    for (const [x, y, z, r] of layout) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.setScalar(r);
      m.castShadow = true;
      this.group.add(m);
      this.puffs.push(m);
      this.offs.push(new THREE.Vector3(x, y, z));
    }
    const eyeMat = new THREE.MeshBasicMaterial({ color: '#4a4f5c', depthTest: false });
    for (let i = 0; i < 2; i++) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 6), eyeMat);
      e.renderOrder = 20;
      this.group.add(e);
      this.eyes.push(e);
    }
    this.pos = new Spring3(start.x, start.y, start.z, 18 - index * 2.5, 6.5);
    this.pop.target = 1;
    this.group.scale.setScalar(0.0001);
    scene.add(this.group);
  }

  update(dt: number, leader: THREE.Vector3, leaderVel: THREE.Vector3, camera: THREE.Camera, raining: boolean) {
    this.t += dt;
    // trail behind the leader, against its motion, fanned out a little
    const back = leaderVel.clone().setY(0);
    if (back.lengthSq() < 0.01) back.set(Math.sin(this.t * 0.3 + this.index), 0, Math.cos(this.t * 0.3 + this.index));
    back.normalize().multiplyScalar(-1.4 - this.index * 0.15);
    const side = new THREE.Vector3(-back.z, 0, back.x).normalize().multiplyScalar(Math.sin(this.t * 0.7 + this.index * 2) * 0.5);
    this.pos.setTarget(leader.x + back.x + side.x, leader.y - 0.35 + Math.sin(this.t * 1.3 + this.index) * 0.15, leader.z + back.z + side.z);
    this.pos.update(dt);
    this.pop.update(dt);
    this.raining += ((raining ? 1 : 0) - this.raining) * Math.min(1, dt * 6);
    const s = Math.max(0.0001, this.pop.value);
    this.group.position.set(this.pos.x.value, this.pos.y.value, this.pos.z.value);
    this.group.scale.setScalar(s);
    this.puffs.forEach((p, i) => {
      const b = 1 + Math.sin(this.t * 2 + i) * 0.05;
      p.position.copy(this.offs[i]);
      p.position.y += Math.sin(this.t * 2.4 + i * 1.3) * 0.03;
      p.scale.setScalar([0.42, 0.3, 0.3, 0.28][i] * b);
    });
    const toCam = new THREE.Vector3().subVectors(camera.position, this.group.position);
    toCam.y *= 0.3;
    toCam.normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), toCam).normalize();
    this.blink -= dt;
    if (this.blink <= 0) {
      this.blink = rand(2, 5);
      this.eyeOpen.value = 0.1;
      this.eyeOpen.vel = 0;
    }
    this.eyeOpen.target = 1 - this.raining * 0.6;
    this.eyeOpen.update(dt);
    this.eyes.forEach((e, i) => {
      e.position.copy(toCam).multiplyScalar(0.42).addScaledVector(right, (i ? 1 : -1) * 0.12);
      e.position.y += 0.02;
      e.lookAt(camera.position);
      e.scale.set(1, clamp(this.eyeOpen.value, 0.08, 1.2) * 1.2, 0.5);
    });
  }

  bounce() {
    this.pop.vel += 3;
  }
}

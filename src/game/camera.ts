// Springy orbit camera with kicks, punches and soft following.
import * as THREE from 'three';
import { CFG } from '../core/config';
import { Spring, Spring3, clamp } from '../core/math';

export class CameraRig {
  camera: THREE.PerspectiveCamera;
  target: Spring3;
  yaw = new Spring(0.55, 40, 11);
  pitch = new Spring(0.88, 40, 11);
  dist = new Spring(48, 30, 10);
  kickOff = new Spring3(0, 0, 0, 220, 14);
  fovPunch = new Spring(0, 120, 9);
  autoOrbit = 0;
  minDist = 14;
  maxDist = 120;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CFG.fov, aspect, 0.5, 1200);
    this.target = new Spring3(0, 0.6, 0, 14, 7.5);
  }

  orbit(dx: number, dy: number) {
    this.yaw.target -= dx * 0.005;
    this.pitch.target = clamp(this.pitch.target + dy * 0.004, 0.42, 1.32);
  }

  zoom(f: number) {
    this.dist.target = clamp(this.dist.target * f, this.minDist, this.maxDist);
  }

  /** Small positional nudge, e.g. a bloom underneath. */
  kick(x: number, y: number, z: number) {
    const s = CFG.camKick;
    this.kickOff.x.impulse(x * s);
    this.kickOff.y.impulse(y * s);
    this.kickOff.z.impulse(z * s);
  }

  punch(amount: number) {
    this.fovPunch.impulse(-amount);
  }

  update(dt: number) {
    this.target.update(dt);
    if (this.autoOrbit) this.yaw.target += dt * 0.05 * this.autoOrbit;
    this.yaw.update(dt);
    this.pitch.update(dt);
    this.dist.update(dt);
    this.kickOff.update(dt);
    this.fovPunch.update(dt);
    const d = this.dist.value;
    const p = this.pitch.value;
    const y = this.yaw.value;
    const tx = this.target.x.value, ty = this.target.y.value, tz = this.target.z.value;
    this.camera.position.set(
      tx + Math.sin(y) * Math.cos(p) * d + this.kickOff.x.value,
      ty + Math.sin(p) * d + this.kickOff.y.value,
      tz + Math.cos(y) * Math.cos(p) * d + this.kickOff.z.value,
    );
    this.camera.lookAt(tx + this.kickOff.x.value * 0.5, ty + this.kickOff.y.value * 0.5, tz + this.kickOff.z.value * 0.5);
    const fov = CFG.fov + this.fovPunch.value;
    if (Math.abs(this.camera.fov - fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}

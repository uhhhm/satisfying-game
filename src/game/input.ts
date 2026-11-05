// Pointer / touch input: hold to rain, tap to act, drag-right / two fingers to orbit.
import * as THREE from 'three';

export class Input {
  ndc = new THREE.Vector2(0, 0);
  screen = new THREE.Vector2(0, 0);
  holding = false;
  hasPointer = false;
  lastMove = 0;
  onTap: ((ndc: THREE.Vector2) => void) | null = null;
  onOrbit: ((dx: number, dy: number) => void) | null = null;
  onZoom: ((f: number) => void) | null = null;
  onFirstInteract: (() => void) | null = null;
  enabled = true;
  alwaysRain = false;
  private downAt = 0;
  private downPos = new THREE.Vector2();
  private orbiting = false;
  private touches = new Map<number, { x: number; y: number }>();
  private pinchD = 0;
  private pinchA = 0;
  private interacted = false;
  private primaryId = -1;

  constructor(private el: HTMLElement) {
    el.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.onZoom?.(Math.exp(e.deltaY * 0.0012));
    }, { passive: false });
  }

  private setPos(e: PointerEvent) {
    const r = this.el.getBoundingClientRect();
    this.screen.set(e.clientX - r.left, e.clientY - r.top);
    this.ndc.set((this.screen.x / r.width) * 2 - 1, -(this.screen.y / r.height) * 2 + 1);
    this.hasPointer = true;
    this.lastMove = performance.now();
  }

  private down(e: PointerEvent) {
    if (!this.interacted) {
      this.interacted = true;
      this.onFirstInteract?.();
    }
    if (!this.enabled) return;
    this.el.setPointerCapture?.(e.pointerId);
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) {
        // second finger: switch from raining to camera gestures
        this.holding = false;
        this.orbiting = true;
        const [a, b] = [...this.touches.values()];
        this.pinchD = Math.hypot(a.x - b.x, a.y - b.y);
        this.pinchA = Math.atan2(b.y - a.y, b.x - a.x);
        return;
      }
    }
    if (e.button === 2 || e.button === 1 || (e.button === 0 && e.shiftKey)) {
      this.orbiting = true;
      this.downPos.set(e.clientX, e.clientY);
      return;
    }
    this.primaryId = e.pointerId;
    this.setPos(e);
    this.holding = true;
    this.downAt = performance.now();
    this.downPos.set(e.clientX, e.clientY);
  }

  private move(e: PointerEvent) {
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      const prev = this.touches.get(e.pointerId)!;
      const dy = e.clientY - prev.y;
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size >= 2) {
        const [a, b] = [...this.touches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        if (this.pinchD > 0) this.onZoom?.(this.pinchD / Math.max(1, d));
        let da = ang - this.pinchA;
        if (da > Math.PI) da -= Math.PI * 2;
        if (da < -Math.PI) da += Math.PI * 2;
        this.onOrbit?.(da * 220, dy * 0.5);
        this.pinchD = d;
        this.pinchA = ang;
        return;
      }
    }
    if (this.orbiting && e.pointerType !== 'touch') {
      this.onOrbit?.(e.movementX, e.movementY);
      return;
    }
    if (e.pointerType !== 'touch' || e.pointerId === this.primaryId) this.setPos(e);
  }

  private up(e: PointerEvent) {
    if (e.pointerType === 'touch') {
      this.touches.delete(e.pointerId);
      if (this.touches.size > 0) return;
    }
    if (this.orbiting) {
      this.orbiting = false;
      this.holding = false;
      return;
    }
    if (!this.holding) return;
    if (e.pointerId !== this.primaryId && e.pointerType === 'touch') return;
    this.holding = false;
    const dt = performance.now() - this.downAt;
    const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
    if (dt < 260 && moved < 12) this.onTap?.(this.ndc.clone());
    if (e.pointerType === 'touch') this.hasPointer = false;
  }

  get raining() {
    return this.enabled && (this.holding || (this.alwaysRain && this.hasPointer));
  }
}

// Tactile one-shots and the living ambient bed.
import { AudioEngine } from './engine';
import { rand } from '../core/math';

export class Sfx {
  private lastPlip = 0;
  private plipBudget = 0;
  constructor(private A: AudioEngine) {}

  private get ctx() {
    return this.A.ctx;
  }

  /** Soft "thup" of a tile popping alive. */
  bloom(pan = 0, size = 1, pitch = 1) {
    const ctx = this.ctx;
    const t = this.A.now + 0.005;
    const out = this.A.out(this.A.sfx, pan, 0.12, t, 0.4);
    // low thump
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f0 = 190 * pitch * rand(0.88, 1.12);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.42, t + 0.11);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.32 * size, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.25);
    // tiny bubble pop on top (rising)
    const p = ctx.createOscillator();
    p.type = 'sine';
    const pf = 520 * pitch * rand(0.85, 1.2);
    p.frequency.setValueAtTime(pf, t + 0.008);
    p.frequency.exponentialRampToValueAtTime(pf * 2.1, t + 0.04);
    const pg = ctx.createGain();
    pg.gain.setValueAtTime(0, t);
    pg.gain.linearRampToValueAtTime(0.09 * size, t + 0.012);
    pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    p.connect(pg).connect(out);
    p.start(t);
    p.stop(t + 0.1);
    // breathy leaf rustle
    this.noiseBurst(t, 0.06 * size, 0.09, 2400 * rand(0.8, 1.3), 0.8, out);
  }

  /** Smaller bump for growth stages. */
  rustle(pan = 0, amt = 1) {
    const t = this.A.now + 0.005;
    const out = this.A.out(this.A.sfx, pan, 0.15, t, 0.4);
    this.noiseBurst(t, 0.07 * amt, 0.16, 3200 * rand(0.7, 1.3), 0.7, out);
    this.noiseBurst(t + 0.03, 0.04 * amt, 0.1, 5200 * rand(0.8, 1.2), 1.2, out);
  }

  private noiseBurst(t: number, gain: number, dur: number, freq: number, q: number, out: AudioNode) {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.A.noisePink;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + dur * 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(bp).connect(g).connect(out);
    n.start(t, Math.random() * 3);
    n.stop(t + dur + 0.02);
  }

  /** A single raindrop. Soil = falling tick, water = rising bloop. */
  plip(pan: number, onWater: boolean, loud = 1) {
    const now = this.A.now;
    // budget: ~22 per second max so it stays a texture, not a buzz
    this.plipBudget = Math.min(4, this.plipBudget + (now - this.lastPlip) * 22);
    this.lastPlip = now;
    if (this.plipBudget < 1) return;
    this.plipBudget -= 1;
    const ctx = this.ctx;
    const t = now + rand(0, 0.03);
    const out = this.A.out(this.A.sfx, pan, 0.2, t, 0.15);
    const o = ctx.createOscillator();
    o.type = 'sine';
    const g = ctx.createGain();
    if (onWater) {
      const f = rand(700, 1500);
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * rand(1.6, 2.4), t + 0.035);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05 * loud, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    } else {
      const f = rand(1800, 4200);
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.5, t + 0.03);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.018 * loud, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    }
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.08);
  }

  /** Woody "tok" for planting and landmark parts. */
  tok(pan = 0, pitch = 1, vol = 1) {
    const ctx = this.ctx;
    const t = this.A.now + 0.005;
    const out = this.A.out(this.A.sfx, pan, 0.25, t, 0.3);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    const f = 620 * pitch * rand(0.94, 1.06);
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.06);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f * 1.5;
    bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.4 * vol, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(bp).connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.15);
    this.noiseBurst(t, 0.05 * vol, 0.025, 4000, 2, out);
  }

  /** Splash (sea or pond). */
  splash(pan = 0, size = 1) {
    const t = this.A.now + 0.005;
    const out = this.A.out(this.A.sfx, pan, 0.3, t, 0.8);
    this.noiseBurst(t, 0.1 * size, 0.35 * size, 1400, 0.6, out);
    for (let i = 0; i < 3; i++) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const tt = t + 0.05 + i * rand(0.03, 0.08);
      const f = rand(600, 1400);
      o.frequency.setValueAtTime(f, tt);
      o.frequency.exponentialRampToValueAtTime(f * 1.9, tt + 0.04);
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(0.04 * size, tt + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.07);
      o.connect(g).connect(out);
      o.start(tt);
      o.stop(tt + 0.1);
    }
  }

  /** Airy whoosh (island rising, travel). */
  whoosh(dur = 2.2, vol = 1) {
    const ctx = this.ctx;
    const t = this.A.now + 0.01;
    const out = this.A.out(this.A.sfx, 0, 0.6, t, dur + 1);
    const n = ctx.createBufferSource();
    n.buffer = this.A.noisePink;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(250, t);
    bp.frequency.exponentialRampToValueAtTime(1800, t + dur * 0.5);
    bp.frequency.exponentialRampToValueAtTime(400, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22 * vol, t + dur * 0.45);
    g.gain.linearRampToValueAtTime(0, t + dur);
    n.connect(bp).connect(g).connect(out);
    n.start(t, Math.random() * 2);
    n.stop(t + dur + 0.1);
  }

  /** Deep, soft rumble as land rises from the sea. */
  rumble(dur = 3) {
    const ctx = this.ctx;
    const t = this.A.now + 0.01;
    const out = this.A.out(this.A.sfx, 0, 0.4, t, dur + 1);
    const n = ctx.createBufferSource();
    n.buffer = this.A.noiseBrown;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(0, t + dur);
    n.connect(lp).connect(g).connect(out);
    n.start(t);
    n.stop(t + dur + 0.1);
  }

  /** Cute two-formant "mbaa" for sheep. */
  baa(pan = 0, pitch = 1) {
    const ctx = this.ctx;
    const t = this.A.now + 0.01;
    const dur = rand(0.45, 0.6);
    const out = this.A.out(this.A.sfx, pan, 0.2, t, dur + 0.3);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const f = 300 * pitch * rand(0.9, 1.15);
    o.frequency.setValueAtTime(f * 0.9, t);
    o.frequency.linearRampToValueAtTime(f, t + 0.08);
    o.frequency.linearRampToValueAtTime(f * 0.86, t + dur);
    const vib = ctx.createOscillator();
    const vg = ctx.createGain();
    vib.frequency.value = 7.5;
    vg.gain.value = f * 0.045;
    vib.connect(vg).connect(o.frequency);
    const mix = ctx.createGain();
    mix.gain.value = 1;
    const formants = [
      [850, 6, 1],
      [1450, 8, 0.6],
      [2600, 10, 0.25],
    ];
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.11, t + 0.06);
    g.gain.setValueAtTime(0.11, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const [ff, q, a] of formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = ff * rand(0.95, 1.05);
      bp.Q.value = q;
      const fg = ctx.createGain();
      fg.gain.value = a;
      o.connect(bp).connect(fg).connect(g);
    }
    g.connect(mix).connect(out);
    o.start(t);
    vib.start(t);
    o.stop(t + dur + 0.05);
    vib.stop(t + dur + 0.05);
  }

  /** Little "boop" for UI. */
  ui(pitch = 1) {
    const ctx = this.ctx;
    const t = this.A.now + 0.003;
    const out = this.A.out(this.A.sfx, 0, 0.2, t, 0.2);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(880 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(1320 * pitch, t + 0.04);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.15);
  }

  /** Camera shutter: soft mechanical click-clack. */
  shutter() {
    const t = this.A.now + 0.003;
    const out = this.A.out(this.A.sfx, 0, 0.15, t, 0.3);
    this.noiseBurst(t, 0.25, 0.03, 3000, 1.2, out);
    this.noiseBurst(t + 0.07, 0.18, 0.04, 2000, 1.2, out);
  }
}

/** Continuous ambient layers that crossfade with the state of the world. */
export class Ambience {
  private rainHiss: GainNode;
  private rainBody: GainNode;
  private sea: GainNode;
  private wind: GainNode;
  private river: GainNode;
  private crickets: GainNode;
  private riverFilter: BiquadFilterNode;
  life = 0; // 0..1
  night = 0;
  rivers = 0;
  ponds = 0;
  private nextBird = 3;
  private nextFrog = 6;
  private t = 0;

  constructor(private A: AudioEngine) {
    const ctx = A.ctx;
    const mk = (buf: AudioBuffer, type: BiquadFilterType, f: number, q: number) => {
      const src = A.noiseLoop(buf);
      const flt = ctx.createBiquadFilter();
      flt.type = type;
      flt.frequency.value = f;
      flt.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(flt).connect(g).connect(A.amb);
      return { g, flt };
    };
    this.rainHiss = mk(A.noisePink, 'bandpass', 4200, 0.6).g;
    this.rainBody = mk(A.noisePink, 'bandpass', 900, 0.8).g;
    const sea = mk(A.noiseBrown, 'lowpass', 520, 0.4);
    this.sea = sea.g;
    // sea swell LFOs
    for (const [fr, amt] of [[0.07, 0.1], [0.113, 0.06]]) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = fr;
      const lg = ctx.createGain();
      lg.gain.value = amt;
      lfo.connect(lg).connect(this.sea.gain);
      lfo.start();
    }
    const wind = mk(A.noisePink, 'bandpass', 500, 1.4);
    this.wind = wind.g;
    {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.045;
      const lg = ctx.createGain();
      lg.gain.value = 260;
      lfo.connect(lg).connect(wind.flt.frequency);
      lfo.start();
    }
    const river = mk(A.noiseWhite, 'bandpass', 800, 2.5);
    this.river = river.g;
    this.riverFilter = river.flt;

    // crickets: AM'd high sine pair
    this.crickets = ctx.createGain();
    this.crickets.gain.value = 0;
    this.crickets.connect(A.amb);
    for (const [f, rate, pan] of [[4700, 28, -0.5], [5100, 31, 0.6]]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const am = ctx.createGain();
      am.gain.value = 0;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = rate;
      const gate = ctx.createOscillator();
      gate.frequency.value = 0.7 + Math.random() * 0.4;
      const lg = ctx.createGain();
      lg.gain.value = 0.5;
      const gg = ctx.createGain();
      gg.gain.value = 0.5;
      lfo.connect(lg).connect(am.gain);
      gate.connect(gg).connect(am.gain);
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      const lvl = ctx.createGain();
      lvl.gain.value = 0.012;
      o.connect(am).connect(lvl).connect(p).connect(this.crickets);
      o.start();
      lfo.start();
      gate.start();
    }
  }

  setRain(intensity: number, overWater: number) {
    const t = this.A.now;
    this.rainHiss.gain.setTargetAtTime(intensity * 0.09, t, 0.25);
    this.rainBody.gain.setTargetAtTime(intensity * (0.1 + overWater * 0.08), t, 0.3);
  }

  update(dt: number, sfx: Sfx) {
    this.t += dt;
    const t = this.A.now;
    this.sea.gain.setTargetAtTime(0.22, t, 1);
    this.wind.gain.setTargetAtTime(0.09 * (1 - this.life * 0.7), t, 2);
    this.river.gain.setTargetAtTime(Math.min(1, this.rivers * 0.35) * 0.05, t, 1);
    if (Math.random() < dt * 4) this.riverFilter.frequency.setTargetAtTime(600 + Math.random() * 900, t, 0.08);
    this.crickets.gain.setTargetAtTime(this.night * this.life, t, 2);

    // birdsong rises with life and fades at night
    this.nextBird -= dt * (0.15 + this.life * 1.3) * (1 - this.night * 0.9);
    if (this.nextBird <= 0) {
      this.nextBird = 2 + Math.random() * 5;
      this.bird();
    }
    if (this.ponds > 0) {
      this.nextFrog -= dt * Math.min(1, this.ponds * 0.2) * (0.3 + this.night);
      if (this.nextFrog <= 0) {
        this.nextFrog = 4 + Math.random() * 8;
        this.frog();
      }
    }
    void sfx;
  }

  private bird() {
    const ctx = this.A.ctx;
    const t0 = this.A.now + 0.02;
    const pan = (Math.random() - 0.5) * 1.6;
    const out = this.A.out(this.A.amb, pan, 0.5, t0, 2);
    const kind = Math.floor(Math.random() * 3);
    const syll = 2 + Math.floor(Math.random() * 5);
    const base = 2400 + Math.random() * 2200;
    let t = t0;
    for (let i = 0; i < syll; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const d = kind === 0 ? 0.06 : kind === 1 ? 0.11 : 0.04;
      const f = base * (1 + (Math.random() - 0.5) * 0.25);
      o.frequency.setValueAtTime(f * (kind === 1 ? 0.8 : 1.2), t);
      o.frequency.exponentialRampToValueAtTime(f * (kind === 1 ? 1.25 : 0.7), t + d);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.025, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + d + 0.02);
      t += d + (kind === 2 ? 0.03 : 0.06 + Math.random() * 0.08);
    }
  }

  private frog() {
    const ctx = this.A.ctx;
    const t = this.A.now + 0.02;
    const out = this.A.out(this.A.amb, (Math.random() - 0.5) * 1.4, 0.35, t, 1);
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const tt = t + i * 0.28;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(130 + Math.random() * 40, tt);
      o.frequency.linearRampToValueAtTime(100, tt + 0.18);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 520;
      bp.Q.value = 3;
      const am = ctx.createGain();
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 26;
      const lg = ctx.createGain();
      lg.gain.value = 0.5;
      am.gain.value = 0.5;
      lfo.connect(lg).connect(am.gain);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(0.06, tt + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.2);
      o.connect(bp).connect(am).connect(g).connect(out);
      o.start(tt);
      lfo.start(tt);
      o.stop(tt + 0.22);
      lfo.stop(tt + 0.22);
    }
  }
}

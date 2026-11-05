// Generative ambient score. Player actions feed notes in; everything is
// quantized to D-major pentatonic and to the next 16th so nothing sounds wrong.
import { AudioEngine, Timbre, mtof } from './engine';
import { clamp } from '../core/math';

const PENTA = [0, 2, 4, 7, 9]; // D E F# A B
const ROOT = 62; // D4

interface Chord {
  name: string;
  notes: number[]; // pad voicing (midi)
  pcs: number[]; // pitch classes relative to D, used to bias melody
  bass: number;
}

const CHORDS: Chord[] = [
  { name: 'Dmaj9', notes: [50, 57, 61, 64, 66], pcs: [0, 4, 7, 2], bass: 38 },
  { name: 'Bm11', notes: [47, 54, 57, 62, 64], pcs: [9, 0, 4, 2], bass: 35 },
  { name: 'Gmaj9', notes: [43, 50, 59, 66, 69], pcs: [9, 0, 4, 7], bass: 31 },
  { name: 'Asus', notes: [45, 52, 59, 62, 66], pcs: [7, 2, 9], bass: 33 },
  { name: 'Dmaj9/F#', notes: [54, 57, 61, 64, 69], pcs: [0, 4, 7, 2], bass: 42 },
  { name: 'Em9', notes: [40, 47, 55, 62, 66], pcs: [2, 9, 0, 4], bass: 40 },
  { name: 'Gmaj9', notes: [43, 55, 59, 62, 66], pcs: [9, 0, 4, 7], bass: 31 },
  { name: 'Asus', notes: [45, 52, 57, 62, 64], pcs: [7, 2, 9, 0], bass: 33 },
];

interface QueuedNote {
  h: number; // 0..1 register hint
  timbre: Timbre;
  pan: number;
  vel: number;
  exact?: number; // explicit scale index
}

export class Music {
  bpm = 72;
  private step = 0; // 16th counter
  private nextTime = 0;
  private chordIdx = 0;
  private padBus: GainNode;
  private padFilter: BiquadFilterNode;
  private padVoices: { stop: (t: number) => void }[] = [];
  private queue: QueuedNote[] = [];
  private walk = 7;
  private lastPlayed = 0;
  activity = 0; // 0..1, rises with play
  layers = { drone: false, celesta: true, harp: false };
  vitality = 0; // world progress 0..1, opens the filter
  night = 0;
  private swellAmt = 0;
  private droneGain: GainNode | null = null;
  private timer: number | null = null;

  constructor(private A: AudioEngine) {
    const ctx = A.ctx;
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 700;
    this.padFilter.Q.value = 0.5;
    this.padBus = ctx.createGain();
    this.padBus.gain.value = 0.5;
    this.padFilter.connect(this.padBus);
    this.padBus.connect(A.music);
    const send = ctx.createGain();
    send.gain.value = 0.8;
    this.padBus.connect(send).connect(A.reverbIn);
  }

  /** Scale table spanning D3..D7. */
  private scaleMidi(i: number) {
    const oct = Math.floor(i / 5);
    return ROOT - 12 + oct * 12 + PENTA[((i % 5) + 5) % 5];
  }

  start() {
    if (this.timer !== null) return;
    this.nextTime = this.A.now + 0.1;
    this.startChord(this.nextTime);
    this.timer = window.setInterval(() => this.tick(), 25);
  }

  get sixteenth() {
    return 60 / this.bpm / 4;
  }

  /** Queue a note from a player action. h = register hint (0 low, 1 high). */
  play(h: number, timbre: Timbre, pan = 0, vel = 1, exact?: number) {
    this.activity = Math.min(1, this.activity + 0.06);
    if (this.queue.length > 7) this.queue.shift();
    this.queue.push({ h: clamp(h), timbre, pan, vel, exact });
  }

  /** Immediate (non-queued) arpeggio, used for big payoffs. */
  arpeggio(timbre: Timbre, count = 8, spacing = 0.075, startIdx = 8, vel = 0.8, pan = 0) {
    const t0 = this.quantize(this.A.now + 0.02, 2);
    const chord = CHORDS[this.chordIdx];
    let idx = startIdx;
    for (let i = 0; i < count; i++) {
      // walk up the scale, preferring chord tones
      idx += 1;
      while (!this.isChordTone(idx, chord) && Math.random() < 0.6) idx++;
      this.A.note(t0 + i * spacing, this.scaleMidi(idx), vel * (1 - i * 0.04), timbre, {
        pan: pan + (i / count - 0.5) * 0.6,
        detune: (Math.random() - 0.5) * 6,
      });
    }
  }

  /** A chord swell: opens the filter and raises pad gain for a few seconds. */
  swell(amount = 1) {
    this.swellAmt = Math.min(2, this.swellAmt + amount);
  }

  private isChordTone(idx: number, chord: Chord) {
    const pc = PENTA[((idx % 5) + 5) % 5];
    return chord.pcs.includes(pc);
  }

  private quantize(t: number, subdiv = 1) {
    const q = this.sixteenth * subdiv;
    const base = this.nextTime - this.sixteenth; // last scheduled grid point
    const n = Math.ceil((t - base) / q);
    return base + Math.max(0, n) * q;
  }

  private tick() {
    const A = this.A;
    const ahead = 0.12;
    while (this.nextTime < A.now + ahead) {
      this.onStep(this.nextTime);
      this.nextTime += this.sixteenth;
      this.step++;
    }
    // param smoothing
    this.activity *= 0.997;
    this.swellAmt *= 0.994;
    const cutoff = 520 + this.vitality * 900 + this.swellAmt * 1400 + this.activity * 300 - this.night * 150;
    this.padFilter.frequency.setTargetAtTime(cutoff, A.now, 0.6);
    this.padBus.gain.setTargetAtTime(0.38 + this.vitality * 0.12 + this.swellAmt * 0.16, A.now, 0.8);
  }

  private onStep(t: number) {
    const stepsPerChord = 32; // 2 bars of 4/4
    if (this.step > 0 && this.step % stepsPerChord === 0) {
      this.chordIdx = (this.chordIdx + 1) % CHORDS.length;
      this.startChord(t);
    }
    const chord = CHORDS[this.chordIdx];

    // player notes: one per 16th, two if backed up
    const n = this.queue.length > 4 ? 2 : 1;
    for (let i = 0; i < n && this.queue.length; i++) {
      const q = this.queue.shift()!;
      const strong = this.step % 4 === 0;
      let idx: number;
      if (q.exact !== undefined) idx = q.exact;
      else {
        const target = 5 + Math.round(q.h * 9);
        const stepChoices = [-2, -1, -1, 1, 1, 2, 0];
        idx = this.walk + stepChoices[Math.floor(Math.random() * stepChoices.length)];
        idx += Math.round((target - idx) * 0.3);
        if (strong && !this.isChordTone(idx, chord)) idx += Math.random() < 0.5 ? 1 : -1;
        idx = Math.max(3, Math.min(17, idx));
        if (idx === this.lastPlayed && Math.random() < 0.6) idx += Math.random() < 0.5 ? 1 : -1;
        this.walk = idx;
      }
      this.lastPlayed = idx;
      this.A.note(t + i * this.sixteenth * 0.5, this.scaleMidi(idx), q.vel * (strong ? 1 : 0.85), q.timbre, {
        pan: q.pan,
        detune: (Math.random() - 0.5) * 8,
      });
    }

    // generative celesta: density follows activity + vitality
    if (this.layers.celesta && this.step % 2 === 0) {
      const p = 0.015 + this.activity * 0.1 + this.vitality * 0.05;
      if (Math.random() < p) {
        const pcs = chord.pcs;
        const pc = pcs[Math.floor(Math.random() * pcs.length)];
        const pi = PENTA.indexOf(pc);
        const idx = (pi >= 0 ? pi : 0) + 5 * (2 + Math.floor(Math.random() * 2));
        this.A.note(t, this.scaleMidi(idx), 0.35 + Math.random() * 0.2, this.night > 0.5 ? 'glass' : 'celesta', {
          pan: (Math.random() - 0.5) * 1.2,
        });
      }
    }
    // gentle harp figure every other bar when unlocked
    if (this.layers.harp && this.step % 16 === 8 && Math.random() < 0.35 + this.vitality * 0.3) {
      const base = chord.notes;
      for (let i = 0; i < 4; i++) {
        this.A.note(t + i * this.sixteenth, base[(i + 1) % base.length] + 12, 0.3, 'harp', {
          pan: -0.3 + i * 0.2,
        });
      }
    }
  }

  private startChord(t: number) {
    const ctx = this.A.ctx;
    const chord = CHORDS[this.chordIdx];
    // release previous
    for (const v of this.padVoices) v.stop(t);
    this.padVoices = [];
    const att = 2.4;
    chord.notes.forEach((m, i) => {
      const f = mtof(m);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.06 - i * 0.005, t + att);
      g.connect(this.padFilter);
      const oscs: OscillatorNode[] = [];
      for (let k = 0; k < 2; k++) {
        const o = ctx.createOscillator();
        o.type = k === 0 ? 'triangle' : 'sine';
        o.frequency.value = f * (k === 1 ? 2 : 1);
        o.detune.value = (k === 0 ? -1 : 1) * (3 + Math.random() * 4);
        // slow tape-like wobble
        const lfo = ctx.createOscillator();
        const lg = ctx.createGain();
        lfo.frequency.value = 0.12 + Math.random() * 0.15;
        lg.gain.value = 4;
        lfo.connect(lg).connect(o.detune);
        lfo.start(t);
        const og = ctx.createGain();
        og.gain.value = k === 1 ? 0.25 : 1;
        o.connect(og).connect(g);
        o.start(t);
        oscs.push(o, lfo);
      }
      this.padVoices.push({
        stop: (ts: number) => {
          g.gain.cancelScheduledValues(ts);
          g.gain.setValueAtTime(g.gain.value, ts);
          g.gain.setTargetAtTime(0, ts, 1.4);
          for (const o of oscs) o.stop(ts + 7);
          setTimeout(() => g.disconnect(), (ts - this.A.now + 7.5) * 1000);
        },
      });
    });

    if (this.layers.drone) {
      if (!this.droneGain) {
        this.droneGain = ctx.createGain();
        this.droneGain.gain.value = 0;
        this.droneGain.connect(this.A.music);
      }
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = mtof(chord.bass);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.12, t + 1.5);
      g.gain.setTargetAtTime(0, t + 6.2, 0.8);
      o.connect(g).connect(this.droneGain);
      this.droneGain.gain.setTargetAtTime(0.7, t, 2);
      o.start(t);
      o.stop(t + 10);
    }
  }
}

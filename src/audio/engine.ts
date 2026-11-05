// Core Web Audio plumbing: buses, reverb, noise buffers and instrument voices.
import { CFG } from '../core/config';

export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export type Timbre = 'marimba' | 'kalimba' | 'glass' | 'celesta' | 'bell' | 'harp';

export class AudioEngine {
  ctx: AudioContext;
  master: GainNode;
  comp: DynamicsCompressorNode;
  music: GainNode;
  sfx: GainNode;
  amb: GainNode;
  reverbIn: GainNode;
  reverb: ConvolverNode;
  noiseWhite: AudioBuffer;
  noisePink: AudioBuffer;
  noiseBrown: AudioBuffer;
  muted = false;
  started = false;

  constructor() {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const ctx = this.ctx;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.01;
    this.comp.release.value = 0.25;

    // gentle master low-pass to keep everything soft
    const soft = ctx.createBiquadFilter();
    soft.type = 'lowpass';
    soft.frequency.value = 11000;
    soft.Q.value = 0.4;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(soft).connect(this.comp).connect(ctx.destination);

    this.music = ctx.createGain();
    this.sfx = ctx.createGain();
    this.amb = ctx.createGain();
    this.music.connect(this.master);
    this.sfx.connect(this.master);
    this.amb.connect(this.master);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(3.8, 2.6);
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 1;
    const revOut = ctx.createGain();
    revOut.gain.value = 0.55;
    this.reverbIn.connect(this.reverb).connect(revOut).connect(this.master);

    this.noiseWhite = this.makeNoise('white', 3);
    this.noisePink = this.makeNoise('pink', 5);
    this.noiseBrown = this.makeNoise('brown', 6);
    this.applyVolumes();
  }

  get now() {
    return this.ctx.currentTime;
  }

  start() {
    // never await resume(): some browsers only settle it on a later gesture
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    if (!this.started) {
      this.started = true;
      this.master.gain.cancelScheduledValues(this.now);
      this.master.gain.setValueAtTime(0, this.now);
      this.master.gain.setTargetAtTime(this.muted ? 0 : CFG.masterVol, this.now, 1.2);
      // keep trying to resume on any later gesture (iOS/Safari)
      const kick = () => {
        if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      };
      window.addEventListener('pointerdown', kick);
      window.addEventListener('keydown', kick);
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.master.gain.setTargetAtTime(m ? 0 : CFG.masterVol, this.now, 0.3);
  }

  applyVolumes() {
    const t = this.now;
    this.music.gain.setTargetAtTime(CFG.musicVol, t, 0.1);
    this.sfx.gain.setTargetAtTime(CFG.sfxVol, t, 0.1);
    this.amb.gain.setTargetAtTime(CFG.ambVol, t, 0.1);
    if (this.started && !this.muted) this.master.gain.setTargetAtTime(CFG.masterVol, t, 0.1);
  }

  private makeImpulse(seconds: number, decay: number) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // progressively darker tail: one-pole lowpass whose cutoff falls over time
        const a = 0.15 + 0.8 * t;
        lp = lp * a + (Math.random() * 2 - 1) * (1 - a);
        const pre = i < rate * 0.012 ? i / (rate * 0.012) : 1;
        d[i] = lp * Math.pow(1 - t, decay) * pre * 1.6;
      }
    }
    return buf;
  }

  private makeNoise(kind: 'white' | 'pink' | 'brown', seconds: number) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'white') d[i] = w * 0.5;
        else if (kind === 'pink') {
          b0 = 0.99886 * b0 + w * 0.0555179;
          b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856;
          b4 = 0.55 * b4 + w * 0.5329522;
          b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
          b6 = w * 0.115926;
        } else {
          last = (last + 0.02 * w) / 1.02;
          d[i] = last * 3.5;
        }
      }
      // crossfade ends so the loop is seamless
      const fade = Math.floor(rate * 0.05);
      for (let i = 0; i < fade; i++) {
        const t = i / fade;
        d[i] = d[i] * t + d[len - fade + i] * (1 - t);
      }
    }
    return buf;
  }

  /** Looping noise source → returns source + output gain. */
  noiseLoop(buf: AudioBuffer) {
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = 0.05;
    src.loopEnd = buf.duration;
    src.start(this.now, Math.random() * buf.duration * 0.9);
    return src;
  }

  /** Output stage for a one-shot voice: panner → bus + reverb send. */
  out(bus: AudioNode, pan: number, send: number, t: number, life: number) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p);
    p.connect(bus);
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = send;
      p.connect(s);
      s.connect(this.reverbIn);
      setTimeout(() => s.disconnect(), (t - this.now + life + 0.5) * 1000);
    }
    setTimeout(() => {
      g.disconnect();
      p.disconnect();
    }, (t - this.now + life + 0.5) * 1000);
    return g;
  }

  /** A pitched mallet/bell voice. */
  note(
    t: number, midi: number, vel: number, timbre: Timbre,
    opt: { pan?: number; send?: number; bus?: AudioNode; detune?: number } = {},
  ) {
    const ctx = this.ctx;
    const f = mtof(midi) * Math.pow(2, (opt.detune ?? 0) / 1200);
    const pan = opt.pan ?? 0;
    const bus = opt.bus ?? this.music;
    const P = TIMBRES[timbre];
    const life = P.decay * 1.5 + 0.1;
    const out = this.out(bus, pan, opt.send ?? P.send, t, life);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel * P.gain, t + P.attack);
    env.gain.setTargetAtTime(0, t + P.attack, P.decay / 4);
    env.connect(out);

    const o1 = ctx.createOscillator();
    o1.type = P.wave;
    o1.frequency.setValueAtTime(f * (1 + P.bend), t);
    o1.frequency.exponentialRampToValueAtTime(f, t + 0.05);

    if (P.fm > 0) {
      const mod = ctx.createOscillator();
      const mg = ctx.createGain();
      mod.frequency.value = f * P.fmRatio;
      mg.gain.setValueAtTime(f * P.fm, t);
      mg.gain.setTargetAtTime(0, t, P.decay / 6);
      mod.connect(mg).connect(o1.frequency);
      mod.start(t);
      mod.stop(t + life);
    }
    o1.connect(env);
    o1.start(t);
    o1.stop(t + life);

    if (P.partial > 0) {
      const o2 = ctx.createOscillator();
      const g2 = ctx.createGain();
      o2.frequency.value = f * P.partial;
      g2.gain.setValueAtTime(0, t);
      g2.gain.linearRampToValueAtTime(vel * P.gain * P.partialGain, t + 0.002);
      g2.gain.setTargetAtTime(0, t + 0.002, P.partialDecay / 4);
      o2.connect(g2).connect(out);
      o2.start(t);
      o2.stop(t + P.partialDecay * 2 + 0.05);
    }
    if (P.click > 0) {
      const n = ctx.createBufferSource();
      n.buffer = this.noiseWhite;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = Math.min(9000, f * 3);
      bp.Q.value = 1.5;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(vel * P.click, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      n.connect(bp).connect(ng).connect(out);
      n.start(t, Math.random());
      n.stop(t + 0.05);
    }
  }
}

interface TimbreParams {
  wave: OscillatorType;
  gain: number;
  attack: number;
  decay: number;
  partial: number;
  partialGain: number;
  partialDecay: number;
  fm: number;
  fmRatio: number;
  bend: number;
  click: number;
  send: number;
}

export const TIMBRES: Record<Timbre, TimbreParams> = {
  marimba: { wave: 'sine', gain: 0.26, attack: 0.004, decay: 0.9, partial: 3.93, partialGain: 0.35, partialDecay: 0.12, fm: 0, fmRatio: 1, bend: 0.01, click: 0.25, send: 0.35 },
  kalimba: { wave: 'sine', gain: 0.24, attack: 0.003, decay: 1.2, partial: 5.4, partialGain: 0.22, partialDecay: 0.08, fm: 0.4, fmRatio: 2, bend: 0.02, click: 0.3, send: 0.35 },
  glass: { wave: 'sine', gain: 0.2, attack: 0.006, decay: 2.2, partial: 2.76, partialGain: 0.25, partialDecay: 0.6, fm: 1.2, fmRatio: 3.5, bend: 0, click: 0.05, send: 0.6 },
  celesta: { wave: 'sine', gain: 0.17, attack: 0.004, decay: 1.6, partial: 4, partialGain: 0.3, partialDecay: 0.25, fm: 0.6, fmRatio: 4, bend: 0, click: 0.08, send: 0.55 },
  bell: { wave: 'sine', gain: 0.17, attack: 0.005, decay: 3.2, partial: 2.0, partialGain: 0.2, partialDecay: 1.2, fm: 2.2, fmRatio: 1.414, bend: 0, click: 0.02, send: 0.7 },
  harp: { wave: 'triangle', gain: 0.16, attack: 0.004, decay: 1.8, partial: 2, partialGain: 0.25, partialDecay: 0.3, fm: 0, fmRatio: 1, bend: 0.004, click: 0.1, send: 0.5 },
};

// Live tuning panel for feel parameters (toggle with ` or ?debug).
import GUI from 'lil-gui';
import { CFG } from '../core/config';
import type { Game } from '../game/game';

export class DebugPanel {
  gui: GUI;
  constructor(g: Game) {
    this.gui = new GUI({ title: 'Petrichor · tuning' });
    const gui = this.gui;
    const stats = { fps: '', particles: '' };
    const s = gui.addFolder('stats');
    s.add(stats, 'fps').listen().disable();
    s.add(stats, 'particles').listen().disable();
    setInterval(() => {
      stats.fps = `${g.fps.toFixed(0)} fps`;
      stats.particles = `${g.particles.count + g.glow.count} live`;
    }, 300);

    const t = gui.addFolder('tile pop');
    t.add(CFG, 'tileK', 40, 600, 1).name('stiffness');
    t.add(CFG, 'tileC', 2, 40, 0.1).name('damping');
    t.add(CFG, 'tilePopImpulse', 0, 8, 0.1).name('bloom impulse');
    t.add(CFG, 'tileStageImpulse', 0, 6, 0.1).name('growth impulse');
    t.add(CFG, 'colorK', 10, 200, 1).name('colour stiffness');
    t.add(CFG, 'colorC', 2, 30, 0.1).name('colour damping');

    const d = gui.addFolder('decor springs');
    d.add(CFG, 'decorK', 40, 600, 1).name('stiffness');
    d.add(CFG, 'decorC', 2, 40, 0.1).name('damping');
    d.add(CFG, 'decorStagger', 0, 0.2, 0.005).name('stagger (s)');
    d.add(CFG, 'windSway', 0, 3, 0.05).name('wind').onChange((v: number) => import('../core/shaders').then((m) => (m.U.uWind.value = v)));

    const r = gui.addFolder('rain + growth');
    r.add(CFG, 'rainRadius', 0.5, 4, 0.05).name('radius');
    r.add(CFG, 'rainRadiusMax', 0.5, 5, 0.05).name('radius (charged)');
    r.add(CFG, 'chargeTime', 0.5, 10, 0.1).name('charge time');
    r.add(CFG, 'rainRate', 0.2, 6, 0.05).name('soak rate');
    r.add(CFG, 'livingRateMul', 0, 2, 0.05).name('growth rate ×');
    r.add(CFG, 'magnetBoost', 1, 5, 0.05).name('magnet ×');
    r.add(CFG, 'spreadRate', 0, 0.2, 0.002).name('life spread');
    r.add(CFG, 'regionAutoComplete', 0.5, 1, 0.01).name('grove auto-finish');
    r.add(CFG, 'dropsPerSec', 0, 400, 1).name('drops / s');

    const c = gui.addFolder('cloud + camera');
    c.add(CFG, 'cloudK', 5, 200, 1).name('cloud stiffness');
    c.add(CFG, 'cloudC', 1, 30, 0.1).name('cloud damping');
    c.add(CFG, 'puffK', 5, 300, 1).name('puff stiffness');
    c.add(CFG, 'puffC', 1, 30, 0.1).name('puff damping');
    c.add(CFG, 'cloudHeight', 2, 8, 0.1).name('height');
    c.add(CFG, 'camKick', 0, 0.3, 0.005).name('camera kick');
    c.add(CFG, 'camFollow', 0, 1, 0.01).name('camera follow');
    c.add(CFG, 'fov', 12, 60, 0.5).name('fov');

    const p = gui.addFolder('particles');
    p.add(CFG, 'petalCount', 0, 60, 1).name('petals / bloom');
    p.add(CFG, 'sparkleCount', 0, 40, 1).name('sparkles / bloom');
    p.add(CFG, 'splashCount', 0, 8, 1).name('splash droplets');

    const fx = gui.addFolder('look');
    fx.add(CFG, 'tiltShift', 0, 3, 0.01).name('tilt-shift');
    fx.add(CFG, 'tiltBand', 0, 0.5, 0.005).name('focus band');
    fx.add(CFG, 'grain', 0, 0.15, 0.001);
    fx.add(CFG, 'vignette', 0, 1, 0.01);

    const a = gui.addFolder('audio');
    const av = () => g.audio.applyVolumes();
    a.add(CFG, 'masterVol', 0, 1, 0.01).name('master').onChange(av);
    a.add(CFG, 'musicVol', 0, 1, 0.01).name('music').onChange(av);
    a.add(CFG, 'sfxVol', 0, 1, 0.01).name('effects').onChange(av);
    a.add(CFG, 'ambVol', 0, 1, 0.01).name('ambience').onChange(av);

    const w = gui.addFolder('world');
    w.add(CFG, 'timeScale', 0.1, 3, 0.05).name('time scale');
    const actions = {
      'bloom focus island': () => {
        const isl = g.islands[g.focus];
        isl.tiles.forEach((t, i) => g.after(i * 0.02, () => g.bloom(g.focus, t.i, { cascade: true })));
      },
      'finish current grove': () => {
        const isl = g.islands[g.focus];
        const r = isl.regionDone.findIndex((x) => !x);
        if (r >= 0) isl.data.regions[r].tiles.forEach((j, k) => g.after(k * 0.05, () => g.bloom(g.focus, j, { cascade: true })));
      },
      'unlock next island': () => {
        const n = g.islands.findIndex((x) => !x.unlocked);
        if (n >= 0) g.unlockIsland(n);
      },
      'lush everything': () => {
        const isl = g.islands[g.focus];
        isl.tiles.forEach((t, i) => g.after(i * 0.01, () => {
          g.bloom(g.focus, t.i, { cascade: true, quietNote: true });
          g.grow(g.focus, t.i, 3, true);
        }));
      },
    };
    for (const k of Object.keys(actions)) w.add(actions, k as keyof typeof actions);
    for (const f of gui.folders) f.close();
    s.open();
  }
  toggle() {
    this.gui.show(this.gui._hidden);
  }
}

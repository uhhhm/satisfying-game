// Minimal DOM UI. Almost everything fades away when you're playing.
import * as THREE from 'three';
import { CFG } from '../core/config';
import type { Game } from '../game/game';
import type { WonderKind } from '../world/gen';
import { WONDER_INFO, WONDER_ORDER, FAR_WONDER_ORDER } from '../world/wonders';
import { ISLANDS } from '../world/gen';
import { THEME_STYLE, Theme } from '../world/themes';
import { KIN_INFO, KIN_ORDER, KinRule, wonderSource } from '../world/kinships';

const ICON = {
  journal: `<svg viewBox="0 0 24 24"><path d="M5 4.5c2.5-1 5-1 7 .8 2-1.8 4.5-1.8 7-.8v14c-2.5-1-5-1-7 .8-2-1.8-4.5-1.8-7-.8z"/><path d="M12 5.3v14"/></svg>`,
  photo: `<svg viewBox="0 0 24 24"><rect x="3.5" y="7" width="17" height="12" rx="3"/><circle cx="12" cy="13" r="3.4"/><path d="M8.5 7l1.4-2.2h4.2L15.5 7"/></svg>`,
  zen: `<svg viewBox="0 0 24 24"><path d="M12 20c-4-2-6-5-6-8 3 0 5 1.5 6 4 1-2.5 3-4 6-4 0 3-2 6-6 8z"/><path d="M12 16c-1.5-2-1.5-5 0-8 1.5 3 1.5 6 0 8z"/></svg>`,
  sound: `<svg viewBox="0 0 24 24"><path d="M5 10h3l4-3.5v11L8 14H5z"/><path class="w" d="M15.5 9.5c1.2 1.4 1.2 3.6 0 5M18 7.5c2.3 2.6 2.3 6.4 0 9"/></svg>`,
  settings: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2.6"/><path d="M12 3.5v2.3M12 18.2v2.3M3.5 12h2.3M18.2 12h2.3M6 6l1.6 1.6M16.4 16.4L18 18M6 18l1.6-1.6M16.4 7.6L18 6"/></svg>`,
  close: `<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg>`,
  drop: `<svg viewBox="0 0 24 24"><path d="M12 3.5c3 4 5.5 7 5.5 10a5.5 5.5 0 0 1-11 0c0-3 2.5-6 5.5-10z"/></svg>`,
};

export class UI {
  root: HTMLElement;
  photoTodOverride = false;
  photoGradeOverride = false;
  photoTiltOverride: number | null = null;
  photoFocus: number | null = null;
  private title!: HTMLElement;
  private nameEl!: HTMLElement;
  private hintEl!: HTMLElement;
  private hintTarget: { isl: number; tile: number } | null = null;
  private hud!: HTMLElement;
  private flower!: SVGElement;
  private dots!: HTMLElement;
  private buttons!: HTMLElement;
  private panel!: HTMLElement;
  private toasts!: HTMLElement;
  private photoBar!: HTMLElement;
  private idle = 0;
  private lastMouse = 0;
  private nameTimer = 0;
  private hintKind: string | null = null;
  private progressKey = '';

  constructor(private g: Game) {
    this.root = document.getElementById('ui')!;
    this.root.innerHTML = `
      <div id="title" class="title">
        <div class="t-inner">
          <div class="t-drop">${ICON.drop}</div>
          <h1>Petrichor</h1>
          <p class="t-sub">a little rain goes a long way</p>
          <p class="t-go"><span>touch to begin</span></p>
        </div>
      </div>
      <div id="iname" class="iname"><span class="n"></span><span class="s"></span></div>
      <div id="hint" class="hint"><div class="ring"></div><div class="ring r2"></div><div class="finger"></div></div>
      <div id="hud" class="hud fade">
        <svg id="flower" viewBox="-50 -50 100 100"></svg>
        <div id="dots" class="dots"></div>
      </div>
      <div id="btns" class="btns fade">
        <button data-a="journal" title="Journal (J)">${ICON.journal}</button>
        <button data-a="photo" title="Photo mode (P)">${ICON.photo}</button>
        <button data-a="zen" title="Zen mode (Z)">${ICON.zen}</button>
        <button data-a="sound" title="Sound (M)">${ICON.sound}</button>
        <button data-a="settings" title="Settings">${ICON.settings}</button>
      </div>
      <div id="bubbles" class="bubbles"></div>
      <div id="toasts" class="toasts"></div>
      <div id="panel" class="panel"></div>
      <div id="photobar" class="photobar">
        <div class="frame"><i></i><i></i><i></i><i></i></div>
        <div class="bar">
          <label>focus<input type="range" min="0.15" max="0.85" step="0.01" value="0.5" data-p="focus"></label>
          <label>blur<input type="range" min="0" max="2.5" step="0.01" value="1" data-p="blur"></label>
          <label>time<input type="range" min="0" max="1" step="0.001" value="0.4" data-p="tod"></label>
          <div class="filters">
            <button data-f="0" class="on">soft</button><button data-f="1">film</button><button data-f="2">dream</button><button data-f="3">mono</button>
          </div>
          <button class="shutter" data-p="shot" title="Capture (space)"></button>
          <button class="exit" data-p="exit">${ICON.close}</button>
        </div>
      </div>`;
    this.title = this.root.querySelector('#title')!;
    this.nameEl = this.root.querySelector('#iname')!;
    this.hintEl = this.root.querySelector('#hint')!;
    this.hud = this.root.querySelector('#hud')!;
    this.flower = this.root.querySelector('#flower')!;
    this.dots = this.root.querySelector('#dots')!;
    this.buttons = this.root.querySelector('#btns')!;
    this.panel = this.root.querySelector('#panel')!;
    this.toasts = this.root.querySelector('#toasts')!;
    this.photoBar = this.root.querySelector('#photobar')!;

    this.title.addEventListener('pointerdown', () => this.dismissTitle());
    this.buttons.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      this.g.sfx.ui(1);
      const a = b.dataset.a;
      if (a === 'journal') this.toggleJournal();
      else if (a === 'photo') this.togglePhoto();
      else if (a === 'zen') this.toggleZen();
      else if (a === 'sound') this.toggleMute();
      else if (a === 'settings') this.toggleSettings();
    });
    this.buttons.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.dots.addEventListener('click', (e) => {
      const d = (e.target as HTMLElement).closest('[data-i]') as HTMLElement | null;
      if (!d) return;
      this.travel(Number(d.dataset.i));
    });
    this.setupPhotoBar();
    window.addEventListener('pointermove', () => (this.lastMouse = performance.now()));
    this.updateMuteIcon();
  }

  // ------------------------------------------------------------- title
  showTitle(hasSave: boolean) {
    this.root.querySelector('.t-go span')!.textContent = hasSave ? 'touch to continue' : 'touch to begin';
    requestAnimationFrame(() => this.title.classList.add('show'));
  }

  private dismissTitle() {
    if (this.g.started) return;
    this.title.classList.remove('show');
    this.title.classList.add('gone');
    this.g.begin();
    setTimeout(() => this.title.remove(), 2000);
    this.updateProgress();
  }

  // ------------------------------------------------------------- moments
  islandName(name: string, sub = '') {
    const n = this.nameEl.querySelector('.n')!;
    const s = this.nameEl.querySelector('.s')!;
    n.textContent = name;
    s.textContent = sub;
    this.nameEl.classList.remove('show');
    void this.nameEl.offsetWidth;
    this.nameEl.classList.add('show');
    clearTimeout(this.nameTimer);
    this.nameTimer = window.setTimeout(() => this.nameEl.classList.remove('show'), 3800);
    this.updateProgress();
  }

  islandComplete(name: string) {
    this.islandName(name, 'restored');
  }

  finale() {
    this.islandName('The Archipelago', 'whole again · the days now turn on their own');
  }

  hint(kind: string | null, target?: { isl: number; tile: number }) {
    this.hintKind = kind;
    this.hintTarget = target ?? null;
    this.hintEl.classList.toggle('show', !!kind);
    this.hintEl.classList.toggle('tap', kind === 'tap');
  }

  toast(html: string, cls = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + cls;
    el.innerHTML = html;
    this.toasts.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => el.classList.remove('in'), 4200);
    setTimeout(() => el.remove(), 5200);
  }

  wonderFound(k: WonderKind) {
    const w = WONDER_INFO[k];
    this.toast(`<span class="ic">${w.icon}</span><span><b>${w.name}</b><em>${w.line}</em></span>`, 'wonder');
    this.updateProgress();
    if (this.panel.dataset.kind === 'journal') this.renderJournal();
  }

  kinFound(rule: KinRule) {
    const k = KIN_INFO[rule];
    this.toast(`<span class="ic kin">${k.recipe}</span><span><b>${k.name}</b><em>${k.line}</em></span>`, 'wonder');
    if (this.panel.dataset.kind === 'journal') this.renderJournal();
  }

  // ------------------------------------------------------------- visitor thought bubbles
  bubble(recipe: string) {
    const el = document.createElement('div');
    el.className = 'bubble';
    el.innerHTML = `<span class="b-in">${recipe}</span><i></i><i class="s"></i>`;
    this.root.querySelector('#bubbles')!.appendChild(el);
    requestAnimationFrame(() => setTimeout(() => el.classList.add('in'), 900));
    return el;
  }

  placeBubble(el: HTMLElement, x: number, y: number, show: boolean) {
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    el.classList.toggle('hide', !show);
  }

  bubblePulse(el: HTMLElement) {
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
  }

  /** The wish came true: the bubble turns into a heart and floats off. */
  bubbleHappy(el: HTMLElement) {
    el.querySelector('.b-in')!.textContent = '♥';
    el.classList.add('happy');
    setTimeout(() => el.classList.add('gone'), 1200);
    setTimeout(() => el.remove(), 2400);
  }

  golden(n: number) {
    this.toast(`<span class="ic">✿</span><span><b>Golden flower</b><em>${n} gathered</em></span>`, 'gold');
  }

  // ------------------------------------------------------------- progress
  updateProgress() {
    const g = this.g;
    const isl = g.islands[g.focus];
    const regs = isl.data.regions.length;
    const done = isl.regionDone.filter(Boolean).length;
    const key = `${g.focus}:${done}:${g.unlocked}:${isl.complete}`;
    if (key === this.progressKey) return;
    this.progressKey = key;
    let svg = '';
    for (let r = 0; r < regs; r++) {
      const a = (r / regs) * 360;
      const filled = isl.regionDone[r];
      svg += `<g transform="rotate(${a})"><path class="petal ${filled ? 'on' : ''}" style="--d:${r * 40}ms" d="M0 -8 C 10 -18, 9 -36, 0 -44 C -9 -36, -10 -18, 0 -8 Z"/></g>`;
    }
    svg += `<circle class="core ${isl.complete ? 'on' : ''}" r="8"/>`;
    this.flower.innerHTML = svg;
    this.dots.innerHTML = g.islands
      .map((x, i) => (x.unlocked ? `<button data-i="${i}" class="${i === g.focus ? 'cur' : ''} ${x.complete ? 'done' : ''}" title="${x.data.def.name}"></button>` : ''))
      .join('');
  }

  travel(i: number) {
    const g = this.g;
    if (!g.islands[i].unlocked) return;
    g.sfx.whoosh(1.4, 0.5);
    g.travelTo(i);
  }

  // ------------------------------------------------------------- panels
  closeAll() {
    this.panel.classList.remove('show');
    this.panel.dataset.kind = '';
    if (this.g.photo) this.togglePhoto();
  }

  toggleJournal() {
    if (this.panel.dataset.kind === 'journal') return this.closeAll();
    this.panel.dataset.kind = 'journal';
    this.renderJournal();
    this.panel.classList.add('show');
  }

  private renderJournal() {
    const g = this.g;
    const found = [...WONDER_ORDER, ...FAR_WONDER_ORDER].filter((k) => g.collected.has(k)).length;
    const farOpen = g.islands.length > ISLANDS.length;
    const cards = WONDER_ORDER.map((k) => {
      const w = WONDER_INFO[k];
      const has = g.collected.has(k);
      const seen = g.islands[w.island]?.unlocked;
      // an unfound wonder hints at where it comes from, once its island is up
      const src = wonderSource(k);
      const clue = !has && seen ? (src && g.eco.discovered.has(src.rule) ? `<span class="rc">${KIN_INFO[src.rule].recipe}</span>` : src ? 'somewhere alive' : 'a lucky find') : '';
      return `<div class="card ${has ? 'has' : ''}"><div class="ic">${has ? w.icon : seen ? '?' : '·'}</div><div class="nm">${has ? w.name : '&nbsp;'}</div><div class="ln">${has ? w.line : clue}</div></div>`;
    }).join('');
    const kinCount = (r: KinRule) => g.eco.count(r);
    const kinCards = KIN_ORDER.map((r) => {
      const k = KIN_INFO[r];
      const has = g.eco.discovered.has(r);
      return `<div class="card kin ${has ? 'has' : ''}"><div class="ic">${has ? k.recipe : '?'}</div><div class="nm">${has ? k.name : '&nbsp;'}</div><div class="ln">${has ? `${k.line}<br><span class="ct">× ${kinCount(r)}</span>` : k.riddle}</div></div>`;
    }).join('');
    const residents = g.eco.visitors.filter((v) => v.satisfied).length + g.eco.settledResidents;
    // far islands (endless mode): their own wonders, by theme
    const farCards = FAR_WONDER_ORDER.map((k) => {
      const w = WONDER_INFO[k];
      const has = g.collected.has(k);
      const seen = w.theme ? g.themesSeen.has(w.theme) : farOpen;
      const src = wonderSource(k);
      const clue = !has && seen ? (src && g.eco.discovered.has(src.rule) ? `<span class="rc">${KIN_INFO[src.rule].recipe}</span>` : src ? 'somewhere alive' : 'a lucky find') : !has && w.theme ? THEME_STYLE[w.theme].label : '';
      return `<div class="card ${has ? 'has' : ''}"><div class="ic">${has ? w.icon : seen ? '?' : '·'}</div><div class="nm">${has ? w.name : '&nbsp;'}</div><div class="ln">${has ? w.line : clue}</div></div>`;
    }).join('');
    const restored = g.islands.filter((x) => x.complete).length;
    const farThemes: Theme[] = ['autumn', 'frost', 'ember', 'oasis'];
    const metFar = farThemes.filter((t) => g.themesSeen.has(t)).length;
    const tiles = g.islands.reduce((a, isl) => a + (isl.unlocked ? Array.from(isl.stage).filter((s) => s > 0).length : 0), 0);
    const mins = Math.floor(g.playTime / 60);
    this.panel.innerHTML = `
      <button class="x">${ICON.close}</button>
      <h2>Journal</h2>
      <p class="stats"><span>${found}/${WONDER_ORDER.length + (farOpen ? FAR_WONDER_ORDER.length : 0)} wonders</span><span>✿ ${g.golden}</span><span>${tiles} tiles in bloom</span><span>${residents} ${residents === 1 ? 'neighbour' : 'neighbours'}</span><span>${mins} min of rain</span></p>
      <div class="cards">${cards}</div>
      <h3>Kinships <small>${g.eco.discovered.size}/${KIN_ORDER.length}</small></h3>
      <div class="cards">${kinCards}</div>
      ${farOpen ? `<h3>Far islands <small>${restored} restored · ${metFar}/4 new shores</small></h3>
      <div class="cards">${farCards}</div>` : ''}`;
    this.panel.querySelector('.x')!.addEventListener('click', () => this.closeAll());
  }

  toggleSettings() {
    if (this.panel.dataset.kind === 'settings') return this.closeAll();
    this.panel.dataset.kind = 'settings';
    const g = this.g;
    this.panel.innerHTML = `
      <button class="x">${ICON.close}</button>
      <h2>Settings</h2>
      <label class="row">music<input type="range" min="0" max="1" step="0.01" value="${CFG.musicVol}" data-s="musicVol"></label>
      <label class="row">effects<input type="range" min="0" max="1" step="0.01" value="${CFG.sfxVol}" data-s="sfxVol"></label>
      <label class="row">ambience<input type="range" min="0" max="1" step="0.01" value="${CFG.ambVol}" data-s="ambVol"></label>
      <label class="row check"><input type="checkbox" ${g.input.alwaysRain ? 'checked' : ''} data-c="always"> rain without holding <small>(one-handed / trackpad)</small></label>
      <label class="row check"><input type="checkbox" ${g.lowfx ? 'checked' : ''} data-c="lowfx"> lighter graphics <small>(older laptops · reloads)</small></label>
      <div class="row keys"><b>hold</b> rain · <b>tap</b> plant / splash · <b>right-drag</b> or two fingers to turn · <b>wheel</b> zoom<br><b>Z</b> zen · <b>P</b> photo · <b>J</b> journal · <b>M</b> mute · <b>\`</b> tuning</div>
      <div class="row btnrow"><button data-b="debug">tuning panel</button><button data-b="reset" class="danger">start over</button></div>`;
    this.panel.querySelector('.x')!.addEventListener('click', () => this.closeAll());
    this.panel.querySelectorAll<HTMLInputElement>('input[data-s]').forEach((inp) =>
      inp.addEventListener('input', () => {
        (CFG as any)[inp.dataset.s!] = Number(inp.value);
        g.audio.applyVolumes();
      }));
    this.panel.querySelector<HTMLInputElement>('input[data-c="always"]')!.addEventListener('change', (e) => {
      g.input.alwaysRain = (e.target as HTMLInputElement).checked;
      g.save();
    });
    this.panel.querySelector<HTMLInputElement>('input[data-c="lowfx"]')!.addEventListener('change', (e) => {
      try {
        localStorage.setItem('petrichor-lowfx', (e.target as HTMLInputElement).checked ? '1' : '0');
      } catch {
        /* ignore */
      }
      g.save();
      setTimeout(() => location.reload(), 150);
    });
    this.panel.querySelector('[data-b="debug"]')!.addEventListener('click', () => g.openDebug());
    const reset = this.panel.querySelector('[data-b="reset"]') as HTMLButtonElement;
    reset.addEventListener('click', () => {
      if (reset.dataset.armed) g.resetProgress();
      else {
        reset.dataset.armed = '1';
        reset.textContent = 'tap again to erase everything';
      }
    });
    this.panel.classList.add('show');
  }

  toggleZen() {
    this.g.zen = !this.g.zen;
    document.body.classList.toggle('zen', this.g.zen);
    if (this.g.zen) this.toast('<span><em>zen · press Z to return</em></span>', 'quiet');
  }

  toggleMute() {
    this.g.audio.setMuted(!this.g.audio.muted);
    this.updateMuteIcon();
    this.g.save();
  }

  private updateMuteIcon() {
    this.buttons.querySelector('[data-a="sound"]')?.classList.toggle('off', this.g.audio.muted);
  }

  // ------------------------------------------------------------- photo
  togglePhoto() {
    const g = this.g;
    g.photo = !g.photo;
    document.body.classList.toggle('photo', g.photo);
    this.panel.classList.remove('show');
    this.panel.dataset.kind = '';
    g.input.enabled = !g.photo;
    if (g.photo) {
      const tod = this.photoBar.querySelector<HTMLInputElement>('[data-p="tod"]')!;
      tod.value = String(((g.env.tod % 1) + 1) % 1);
      this.photoFocus = 0.5;
      this.photoTiltOverride = 1;
    } else {
      this.photoTodOverride = false;
      this.photoGradeOverride = false;
      this.photoTiltOverride = null;
      this.photoFocus = null;
      g.post.u.uFilter.value = 0;
    }
  }

  private setupPhotoBar() {
    const bar = this.photoBar;
    bar.addEventListener('pointerdown', (e) => e.stopPropagation());
    bar.querySelectorAll<HTMLInputElement>('input').forEach((inp) =>
      inp.addEventListener('input', () => {
        const v = Number(inp.value);
        if (inp.dataset.p === 'focus') this.photoFocus = v;
        if (inp.dataset.p === 'blur') this.photoTiltOverride = v;
        if (inp.dataset.p === 'tod') {
          this.photoTodOverride = true;
          this.g.env.tod = v;
        }
      }));
    bar.querySelectorAll<HTMLButtonElement>('[data-f]').forEach((b) =>
      b.addEventListener('click', () => {
        bar.querySelectorAll('[data-f]').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        this.g.post.u.uFilter.value = Number(b.dataset.f);
        this.g.sfx.ui(1.2);
      }));
    bar.querySelector('[data-p="shot"]')!.addEventListener('click', () => this.capture());
    bar.querySelector('[data-p="exit"]')!.addEventListener('click', () => this.togglePhoto());
    // in photo mode, left-drag orbits the camera
    let drag = false;
    this.g.canvas.addEventListener('pointerdown', (e) => {
      if (this.g.photo) drag = true;
      void e;
    });
    window.addEventListener('pointerup', () => (drag = false));
    window.addEventListener('pointermove', (e) => {
      if (drag && this.g.photo) this.g.rig.orbit(e.movementX, e.movementY);
    });
  }

  capture() {
    const g = this.g;
    g.sfx.shutter();
    g.post.render();
    const url = g.canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `petrichor-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    a.click();
    g.post.u.uFlash.value = 0.35;
    document.body.classList.add('flash');
    setTimeout(() => document.body.classList.remove('flash'), 200);
  }

  // ------------------------------------------------------------- per-frame
  update(dt: number) {
    const g = this.g;
    // fade HUD when idle (but keep it if the mouse is near)
    const moving = performance.now() - this.lastMouse < 2500;
    this.idle = moving ? 0 : this.idle + dt;
    const show = g.started && !g.zen && !g.photo && (this.idle < 1 || this.panel.classList.contains('show'));
    this.hud.classList.toggle('vis', g.started && !g.zen && !g.photo);
    this.buttons.classList.toggle('vis', show);
    this.buttons.classList.toggle('dim', g.started && !show && !g.zen && !g.photo);
    if (g.started) this.updateProgress();
    // place the onboarding hint over its tile
    if (this.hintKind && this.hintTarget) {
      const isl = g.islands[this.hintTarget.isl];
      const p = isl.worldPos(this.hintTarget.tile, new THREE.Vector3()).project(g.rig.camera);
      const x = (p.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-p.y * 0.5 + 0.5) * window.innerHeight;
      this.hintEl.style.transform = `translate(${x}px, ${y}px)`;
    }
  }
}

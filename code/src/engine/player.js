// Player: owns the stage, navigation (slide, step), slide transitions,
// the render loop and the WebGL renderer pool.
//
// Two modes (like PowerPoint):
//   run   presenting: click / → / space advance, ← back, Esc leaves.
//         Entering a slide plays its `enter` animations. 3D slides can be
//         looked at freely: drag = turn, scroll = zoom, shift-drag = pan
//         (a drag is not a click); R = back to the animated camera. The
//         next camera animation starts from wherever the view is.
//   edit  embedded in the editor: no click-to-advance; 3D slides get a free
//         orbit camera (authoring only, to pick poses); the editor drives
//         navigation through goto()/next()/prev().

import * as THREE from 'three';
import { SlideInstance, pagesOf } from './slide.js';
import { tweenTask, Scheduler } from './tween.js';
import { poseToJSON } from './camera_rig.js';

export class Player {
  constructor(root, deck, { baseUrl, mode = 'run', dev = false, startAt = null, onExit = null, onChange = null, onCamera = null } = {}) {
    this.root = root;
    this.deck = deck;
    this.baseUrl = baseUrl;
    this.mode = mode;
    this.editing = mode === 'edit';
    this.dev = dev;                 // HUD (?dev)
    this.freeCamera = true;          // edit / dev: to pick poses; run: to look around while presenting
    this.startAt = startAt;
    this.onExit = onExit;
    this.onChange = onChange;
    this.onCamera = onCamera;       // the viewer turned the 3D view by hand (pose) or sent it back (R: 'reset')
    this.size = deck.size || [1920, 1080];
    this.slides = deck.slides;
    this.current = null;
    this.outgoing = null;           // slide fading out during a transition
    this.transitions = new Scheduler();
    this.rendererPool = [];
    this.allRenderers = [];
    this.now = performance.now() / 1000;
    this.queue = Promise.resolve(); // serialises navigation
    this.scale = 1;
    this.listeners = [];

    this.stage = document.createElement('div');
    this.stage.className = 'stage';
    this.stage.style.width = `${this.size[0]}px`;
    this.stage.style.height = `${this.size[1]}px`;
    root.appendChild(this.stage);

    this.counter = document.createElement('div');
    this.counter.className = 'slide-counter';
    if (deck.slideNumbers !== false && !this.editing) this.stage.appendChild(this.counter);

    if (dev) {
      this.hud = document.createElement('div');
      this.hud.className = 'dev-hud';
      root.appendChild(this.hud);
    }

    this.applyTheme(deck.theme || {});
    this.bindInput();
    this.resizeObserver = new ResizeObserver(() => this.layout());
    this.resizeObserver.observe(root);
    this.layout();
  }

  applyTheme(t) {
    const s = document.documentElement.style;
    if (t.background) s.setProperty('--bg', t.background);
    if (t.color) s.setProperty('--fg', t.color);
    if (t.accent) s.setProperty('--accent', t.accent);
    if (t.font) s.setProperty('--font', t.font);
    if (t.monoFont) s.setProperty('--mono', t.monoFont);
  }

  // ------------------------------------------------------------ renderer pool
  acquireRenderer() {
    let r = this.rendererPool.pop();
    if (!r) {
      r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.PCFSoftShadowMap;
      this.allRenderers.push(r);
    }
    this.sizeRenderer(r);
    return r;
  }
  releaseRenderer(r) { r.domElement.remove(); this.rendererPool.push(r); }
  sizeRenderer(r) {
    const pr = Math.min(2, (window.devicePixelRatio || 1) * this.scale);
    r.setPixelRatio(pr);
    r.setSize(this.size[0], this.size[1], false);
  }

  layout() {
    const [W, H] = this.size;
    const w = this.root.clientWidth || window.innerWidth, h = this.root.clientHeight || window.innerHeight;
    this.scale = Math.min(w / W, h / H);
    this.stage.style.transform = `translate(-50%, -50%) scale(${this.scale})`;
    for (const s of [this.current, this.outgoing]) if (s?.renderer) { this.sizeRenderer(s.renderer); s.renderNow(); }
  }

  // ------------------------------------------------------------ navigation
  start() {
    const [i, k] = this.startAt || this.parseHash();
    this.enqueue(() => this.goto(i, k, { live: k === 0 && !this.editing, transition: false }));
    let last = performance.now();
    const loop = (t) => {
      if (this.destroyed) return;
      const dt = (t - last) / 1000; last = t;
      this.now = t / 1000;
      this.transitions.tick(this.now);
      this.outgoing?.tick(this.now, dt);
      this.current?.tick(this.now, dt);
      this.updateHud();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    return this.queue;
  }

  enqueue(fn) {
    this.queue = this.queue.then(() => (this.destroyed ? null : fn())).catch((e) => { console.error(e); this.showError(e); });
    return this.queue;
  }

  // Go to slide i with k steps already executed.
  //   live:       run the slide's `enter` actions with animation (k must be 0)
  //   transition: cross-fade from the previous slide
  async goto(i, k, { live = false, transition = true } = {}) {
    i = Math.max(0, Math.min(this.slides.length - 1, i));
    const def = this.slides[i];
    const inst = new SlideInstance(def, i, this);
    await inst.build();
    if (this.destroyed) { inst.dispose(); return; }
    const steps = inst.steps.length;
    if (k === Infinity || k > steps) k = steps;
    if (!(live && k === 0)) inst.replayTo(k);
    inst.renderNow();

    this.transitions.finishAll();
    const prev = this.current;
    this.stage.insertBefore(inst.layer, this.counter.parentNode ? this.counter : null);
    this.current = inst;
    this.attachFreeCamera(inst);
    const tr = this.resolveTransition(def, prev, transition);
    if (prev && tr.type === 'fade' && tr.duration > 0) {
      this.outgoing = prev;
      inst.layer.style.opacity = 0;
      const carried = this.carryOver(prev, inst);
      this.transitions.add(tweenTask({
        duration: tr.duration, ease: 'in_out_sine',
        onUpdate: (p) => { inst.layer.style.opacity = p; carried.forEach((c) => c.at(p)); },
        onEnd: () => { inst.layer.style.opacity = ''; carried.forEach((c) => c.end()); prev.dispose(); if (this.outgoing === prev) this.outgoing = null; },
      }), 0, this.now);
    } else if (prev) {
      prev.dispose();
    }
    inst.onActivate();
    if (live && k === 0) inst.runEnter(false);
    this.changed();
  }

  // Elements carried from one scene to the next (2D or 3D alike): the same thing (kind and content: a picture,
  // a text, …) on the page we leave and on the page we arrive at does not fade out and in: it stays, and moves
  // from where it was to where it is now, over the transition (as between two pages of one scene).
  carryOver(prev, inst) {
    const key = (sp) => JSON.stringify([sp.type || 'text', sp.src ?? null, sp.text ?? null, sp.html ?? null, sp.tex ?? null, sp.items ?? null, sp.shape ?? null]);
    const shown = (s) => [...s.elements.values()].filter((x) => x.spec.anchor == null && x.spec.type !== 'model' && x.spec.type !== 'video' && pagesOf(s, x.spec.id).includes(s.stepIndex));
    const olds = shown(prev), used = new Set(), out = [];
    const num = (el, k) => (k === 'rotate' ? parseFloat(el.style.rotate) || 0 : parseFloat(el.style[k]));
    for (const n of shown(inst)) {
      const o = olds.find((x) => !used.has(x) && key(x.spec) === key(n.spec));
      if (!o) continue;
      used.add(o);
      const ghost = n.el.cloneNode(true);                           // above both scenes while they cross-fade
      Object.assign(ghost.style, { opacity: 1, visibility: 'visible', transform: '', clipPath: '', filter: '', zIndex: 5, position: 'absolute' });   // (shown, whatever its entrance)
      const keys = ['left', 'top', 'width', 'height', 'fontSize', 'rotate'].filter((k) => k === 'rotate' || (Number.isFinite(num(o.el, k)) && Number.isFinite(num(n.el, k))));
      const from = keys.map((k) => num(o.el, k)), to = keys.map((k) => num(n.el, k));
      const at = (p) => keys.forEach((k, i) => { const v = from[i] + (to[i] - from[i]) * p; ghost.style[k] = k === 'rotate' ? `${v}deg` : `${v}px`; });
      at(0);
      this.stage.insertBefore(ghost, this.counter.parentNode ? this.counter : null);
      const shown0 = n.el.style.display;                             // (not `visibility`: the entrance animation sets that)
      o.el.style.display = 'none'; n.el.style.display = 'none';
      out.push({ at, end: () => { ghost.remove(); n.el.style.display = shown0; } });
    }
    return out;
  }

  // rebuild the current slide at its current step (after an edit)
  reload() {
    return this.enqueue(async () => {
      const c = this.current;
      if (c) await this.goto(c.index, c.stepIndex, { transition: false });
    });
  }

  resolveTransition(def, prev, enabled) {
    if (!enabled || !prev) return { type: 'none', duration: 0 };
    let t = def.transition ?? this.deck.transition ?? 'fade';
    if (typeof t === 'string') t = { type: t };
    return { type: t.type || 'fade', duration: t.duration ?? 0.6 };
  }

  next() {
    return this.enqueue(async () => {
      this.transitions.finishAll();
      const cur = this.current;
      if (!cur) return;
      // clicking while things animate: snap them to the end, then advance
      cur.skipRunning();
      if (!cur.done) { cur.runStep(false); this.changed(); return; }
      if (cur.index + 1 < this.slides.length) await this.goto(cur.index + 1, 0, { live: true, transition: true });
    });
  }

  prev() {
    return this.enqueue(async () => {
      this.transitions.finishAll();
      const cur = this.current;
      if (!cur) return;
      if (cur.stepIndex > 0) {
        // step back = rebuild this slide and replay one step fewer.
        // Skip back over `auto` steps so we land on a real click boundary.
        let k = cur.stepIndex - 1;
        while (k > 0 && cur.steps[k].auto) k--;
        await this.goto(cur.index, k, { transition: false });
      } else if (cur.index > 0) {
        await this.goto(cur.index - 1, Infinity, { transition: false });
      }
    });
  }

  jump(i, k = 0, live = !this.editing) { return this.enqueue(() => this.goto(i, k, { live, transition: false })); }

  // ------------------------------------------------------------ input
  listen(target, type, fn, opts) { target.addEventListener(type, fn, opts); this.listeners.push([target, type, fn, opts]); }

  bindInput() {
    this.listen(window, 'keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
      switch (e.key) {
        case 'ArrowRight': case 'ArrowDown': case ' ': case 'PageDown': case 'Enter':
          e.preventDefault(); this.next(); break;
        case 'ArrowLeft': case 'ArrowUp': case 'PageUp': case 'Backspace':
          if (this.editing && e.key === 'Backspace') break;     // the editor's delete key (⌫ on a Mac), not "back"
          e.preventDefault(); this.prev(); break;
        case 'Home': this.jump(0); break;
        case 'End': this.jump(this.slides.length - 1); break;
        case 'Escape':
          if (!this.editing && this.onExit) { e.preventDefault(); this.exit(); }
          break;
        case 'f': case 'F':
          if (this.editing) break;
          if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.();
          break;
        case 'c': case 'C':
          if (this.dev) this.copyPose(); break;
        case 'r': case 'R':                       // back to the camera the animations put there
          if (!this.editing) this.resetView(); break;
      }
    });
    if (this.editing) return;
    // click anywhere advances, right click goes back; a drag (turning the 3D view) is not a click
    let down = null, dragged = false;
    this.listen(this.root, 'pointerdown', (e) => { down = [e.clientX, e.clientY]; dragged = false; }, true);
    this.listen(this.root, 'pointermove', (e) => {
      if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) dragged = true;
    }, true);
    this.listen(this.root, 'click', (e) => {
      if (this.dev) return;
      if (dragged) { dragged = false; return; }
      if (e.target.closest('a, video[controls], button')) return;
      this.next();
    });
    this.listen(this.root, 'contextmenu', (e) => { if (!this.dev) { e.preventDefault(); this.prev(); } });
  }

  exit() {
    const c = this.current;
    this.onExit?.(c ? c.index : 0, c ? c.stepIndex : 0);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    for (const [t, type, fn, opts] of this.listeners) t.removeEventListener(type, fn, opts);
    this.resizeObserver.disconnect();
    this.transitions.finishAll();
    this.outgoing?.dispose(); this.current?.dispose();
    this.current = this.outgoing = null;
    for (const r of this.allRenderers) { r.dispose(); r.forceContextLoss?.(); }
    this.stage.remove(); this.hud?.remove();
  }

  // ------------------------------------------------------------ hash / change
  parseHash() {
    const m = location.hash.match(/^#(\d+)(?:\.(\d+))?/);
    if (!m) return [0, 0];
    return [Math.max(0, +m[1] - 1), +(m[2] || 0)];
  }
  changed() {
    const c = this.current;
    if (!c) return;
    history.replaceState(null, '', `${location.pathname}${location.search}#${c.index + 1}.${c.stepIndex}`);
    this.counter.textContent = `${c.index + 1} / ${this.slides.length}`;
    this.onChange?.(c);
  }

  // ------------------------------------------------------------ free camera (authoring only)
  async attachFreeCamera(inst) {
    if (!this.freeCamera || !inst.is3D) return;
    const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
    if (inst.disposed) return;
    const c = new OrbitControls(inst.camera, inst.renderer.domElement);
    c.target = inst.rig.target; // share the vector so animations and controls agree
    c.zoomSpeed = 0.6;
    if (!this.editing && !this.dev) {
      // presenting: right click stays "back" (macOS fires contextmenu on press), so pan is shift/ctrl + drag
      c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: null };
    }
    c.update();
    c.addEventListener('change', () => { this.onChange?.(inst); this.onCamera?.(inst, 'pose'); });
    inst.devControls = c;
  }

  // R: back to the camera the animations put there
  resetView() {
    const c = this.current;
    if (!c?.is3D) return;
    c.resetView();
    this.onCamera?.(c, 'reset');
  }

  // the other window of the talk turned its view (sync.js): turn this one the same way. Set straight on the
  // camera (not through the controls: no 'change' event, so it is not sent back); the controls share rig.target.
  setView({ position, target, fov }) {
    const c = this.current;
    if (!c?.is3D || c.disposed) return;
    c.camera.position.fromArray(position);
    c.rig.target.fromArray(target);
    if (fov != null) c.camera.fov = fov;
    c.rig.apply();
  }

  currentPose() {
    const c = this.current;
    return c?.is3D ? poseToJSON(c.camera, c.rig.target) : null;
  }

  copyPose() {
    const pose = this.currentPose();
    if (!pose) return;
    const json = JSON.stringify(pose);
    console.log('camera pose:', json);
    navigator.clipboard?.writeText(json).catch(() => {});
    this.flashMsg = `pose copied: ${json}`; this.flashUntil = this.now + 3;
  }

  updateHud() {
    if (!this.hud || !this.current) return;
    const c = this.current;
    let s = `slide ${c.index + 1}/${this.slides.length} (${c.def.type || '2d'})  ·  step ${c.stepIndex}/${c.steps.length}`;
    if (c.is3D) s += `  ·  sim t=${c.sim.time.toFixed(2)}s${c.sim.free ? ' ▶' : c.sim.budget > 0 ? ' ▶|' : ''}`;
    s += '\n[→/space] next  [←] prev  [C] copy camera pose  [F] fullscreen  · mouse = free camera (dev only)';
    if (this.flashMsg && this.now < this.flashUntil) s += `\n${this.flashMsg}`;
    this.hud.textContent = s;
  }

  showError(e) {
    const d = document.createElement('pre');
    d.className = 'error-box';
    d.textContent = String(e?.stack || e);
    this.root.appendChild(d);
  }
}

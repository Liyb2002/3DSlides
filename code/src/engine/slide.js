// SlideInstance: the live, mutable state of one slide (2D or 3D).
//
// A slide definition (plain data from the deck) is turned into an instance
// with build(). State is advanced only through steps, so the instance at
// (slide i, step k) can always be rebuilt by replaying steps instantly.

import { mountModelView, placeModels, setModelsPage } from './model_view.js';
import { placeLights, setLightPage, setAmbientPage } from './lights.js';
import * as THREE from 'three';
import { Scheduler, resolveEase, runInstant } from './tween.js';
import { createElement, applyAnim } from './elements.js';
import { makeTask, isAction } from './actions.js';
import { CameraRig, normalizePose, poseToJSON } from './camera_rig.js';
import { SimClock } from './sim_clock.js';

export function normalizeSteps(steps) {
  return (steps || []).map((s) => {
    if (Array.isArray(s)) return { actions: s, auto: false };
    if (isAction(s)) return { actions: [s], auto: !!s.auto };
    return { actions: s.actions || [], auto: !!s.auto };
  });
}

// Pages: page 0 is the slide after its `enter`, page k after k clicks (steps).
// An element with `on: [from, to]` is on pages from..to (to: null = to the end):
// it is shown when page `from` begins and hidden when page `to + 1` begins
// (`anim`: its entrance, default fade). Elements without `on` are shown and
// hidden by the slide's own show / hide actions.
export function addPageActions(def, enter, steps) {
  for (const spec of def.elements || []) {
    if (!Array.isArray(spec.on) || spec.id == null) continue;
    const from = Math.max(0, spec.on[0] ?? 0), to = spec.on[1] ?? Infinity;
    const show = { show: spec.id, anim: spec.anim || 'fade', duration: 0.6, delay: spec.delay ?? 0.2 };
    if (from === 0) enter.actions.push(show);
    else if (steps[from - 1]) steps[from - 1].actions.push(show);
    else continue;                                  // a page the slide does not have
    if (to + 1 <= steps.length && to >= from) steps[to].actions.push({ hide: spec.id, duration: 0.3 });
  }
}

// the pages (0..steps) an element is visible on, from the slide's actions
export function pagesOf(inst, id) {
  const lists = [inst.enter.actions, ...inst.steps.map((st) => st.actions)];
  const first = lists.flat().find((a) => a.show === id || a.hide === id);
  let visible = !(first && first.show === id);
  const out = [];
  lists.forEach((acts, k) => {
    for (const a of acts) { if (a.show === id) visible = true; if (a.hide === id) visible = false; }
    if (visible) out.push(k);
  });
  return out;
}

export class SlideInstance {
  constructor(def, index, player) {
    this.def = def;
    this.index = index;
    this.player = player;
    this.is3D = def.type === '3d';
    // copies: element pages (below) add actions without touching the deck
    this.steps = normalizeSteps(def.steps).map((st) => ({ ...st, actions: [...st.actions] }));
    const enter = normalizeSteps(def.enter ? [def.enter] : [])[0] || { actions: [] };
    this.enter = { ...enter, actions: [...enter.actions] };
    addPageActions(def, this.enter, this.steps);
    this.applyPageCameras();
    this.stepIndex = 0;          // number of steps already executed
    this.scheduler = new Scheduler();
    this.elements = new Map();   // id -> { el, spec }
    this.replaying = false;
    this.autoArmed = false;
    this.ease = resolveEase;
  }

  // def.pageCameras { k: pose }: the camera page k ends on (the editor's "set as
  // this page's camera"). It takes the place of the page's last camera move
  // (keeping its timing), or is added as one; page 0 without a camera move in
  // `enter` starts there (the start camera).
  applyPageCameras() {
    for (const [k, pose] of Object.entries(this.def.pageCameras || {})) {
      const page = +k;
      if (!pose) continue;
      const actions = page === 0 ? this.enter.actions : this.steps[page - 1]?.actions;
      if (!actions) continue;
      const at = actions.map((a) => a && typeof a === 'object' && 'camera' in a).lastIndexOf(true);
      if (at >= 0) actions[at] = { ...actions[at], camera: pose };
      else if (page === 0) this.pageStart = pose;
      else actions.push({ camera: pose, duration: 1.5 });
    }
  }

  // ---------------------------------------------------------------- build
  async build() {
    const { def, player } = this;
    const layer = (this.layer = document.createElement('div'));
    layer.className = `slide slide-${this.is3D ? '3d' : '2d'}`;
    if (def.className) layer.classList.add(...def.className.split(/\s+/));
    if (def.background) layer.style.background = def.background;

    if (this.is3D) await this.build3D();

    const overlay = (this.overlay = document.createElement('div'));
    overlay.className = 'slide-overlay';
    layer.appendChild(overlay);
    for (const spec of def.elements || []) {
      if (!spec.id) spec.id = `_el${this.elements.size}`;
      const el = createElement(spec, player.baseUrl);
      overlay.appendChild(el);
      this.elements.set(spec.id, { el, spec });
      if (spec.type === 'model') mountModelView(el, spec, player.baseUrl);          // (its own lights: spec.lights)
    }
    this.initVisibility();
  }

  // re-render one element from its spec in place (editor live edits): content
  // and box change, its animation state (visibility, opacity, transform) stays
  refreshElement(id) {
    const entry = this.elements.get(id);
    if (!entry) return;
    const { el, spec } = entry;
    const fresh = createElement(spec, this.player.baseUrl);
    if (el.tagName !== 'IMG' && el.tagName !== 'VIDEO' && spec.type !== 'model') el.innerHTML = fresh.innerHTML;
    const look = ['width', 'height', 'rotate', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'color', 'background', 'padding', 'borderRadius', 'boxShadow', 'zIndex'];
    const keys = spec.anchor ? look : ['left', 'top', ...look];   // anchors place themselves every frame
    for (const k of keys) el.style[k] = fresh.style[k];
    if (spec.type === 'model') el._modelView?.render();               // the new box size
    if (this.is3D) this.updateAnchors?.();
  }

  async build3D() {
    const { def, player } = this;
    const [W, H] = player.size;
    this.renderer = player.acquireRenderer();
    this.renderer.domElement.className = 'slide-canvas';
    // renderers are pooled: reset per-scene settings a previous slide may have changed
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.layer.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    if (def.background) this.scene.background = new THREE.Color(def.background);
    this.camera = new THREE.PerspectiveCamera(45, W / H, def.near ?? 0.01, def.far ?? 1000);
    // lensShift [sx, sy]: shift the image (fraction of width/height) so the
    // 3D content sits off-centre and leaves room for text, for every pose
    if (def.lensShift) this.camera.setViewOffset(W, H, -def.lensShift[0] * W, def.lensShift[1] * H, W, H);
    this.rig = new CameraRig(this.camera);
    // a slide with just a model file (the editor's "+ New 3D slide") uses the model scene
    let factory = def.scene;
    if (typeof factory !== 'function' && def.model) factory = (await import('../scenes/model_scene.js')).default;
    if (typeof factory !== 'function') throw new Error(`3D slide ${this.index} needs a scene factory (or a model file)`);
    this.sceneApi = (await factory({
      THREE, scene: this.scene, camera: this.camera, renderer: this.renderer,
      options: def.model ? { model: def.model, ...(def.sceneOptions || {}) } : def.sceneOptions || {}, baseUrl: player.baseUrl,
    })) || {};
    this.models = await placeModels(this.scene, def.models, player.baseUrl);   // 3D shapes uploaded into the scene
    this.sim = new SimClock(this.sceneApi, def.sim || {});
    // the start camera: a pose, or the name of a deck / scene pose
    this.startPose = this.pageStart ? normalizePose(this.pageStart)
      : typeof def.camera === 'string' ? this.getPose(def.camera) : normalizePose(def.camera);
    this.rig.set(this.startPose);
    this.lights = placeLights(this.scene, def.lights, new Map(), this.startPose.target, this.renderer.domElement);   // lights added in the editor
    setLightPage(this.scene, this.lights, def.lights, 0, false);                         // those of the first page
    if (def.ambient) setAmbientPage(this.scene, def, 0, false);                          // the first page's ambient level
  }

  // An element starts hidden iff the first show/hide action touching it
  // is a `show` (PowerPoint "entrance animation" semantics).
  initVisibility() {
    const first = new Map();
    const all = [...this.enter.actions, ...this.steps.flatMap((s) => s.actions)];
    for (const a of all) {
      const id = 'show' in a ? a.show : 'hide' in a ? a.hide : null;
      if (id != null && !first.has(id)) first.set(id, a);
    }
    for (const [id, a] of first) {
      if (!('show' in a)) continue;
      const { el } = this.getEntry(id);
      if (a.stagger != null) for (const c of el.children) applyAnim(c, 'fade', 0);
      else applyAnim(el, 'fade', 0);
    }
  }

  // ------------------------------------------------------ context for actions
  getEntry(id) {
    const e = this.elements.get(id);
    if (!e) throw new Error(`Slide ${this.index + 1}: no element with id "${id}"`);
    return e;
  }
  getElement(id) { return this.getEntry(id).el; }
  getPose(name) {
    if (name === 'start') return this.startPose;
    // deck poses (and editor overrides) win over poses the scene computes
    const p = this.def.poses?.[name] ?? this.sceneApi?.poses?.[name];
    if (!p) throw new Error(`Slide ${this.index + 1}: no camera pose "${name}"`);
    return normalizePose(p, this.rigPoseArrays());
  }
  rigPoseArrays() { return poseToJSON(this.camera, this.rig.target); }
  // back to the camera the animations put there (after the viewer turned it by hand)
  resetView(duration = 0.7) {
    if (!this.is3D || !this.rig.authored) return;
    const to = this.rig.authored, upd = this.rig.interpolator(to, 'orbit'), t0 = performance.now();
    const step = () => {
      if (this.disposed) return;
      const p = Math.min(1, (performance.now() - t0) / 1000 / duration);
      upd(p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
      if (p < 1) requestAnimationFrame(step);
    };
    step();
  }
  allPoseNames() { return [...new Set([...Object.keys(this.sceneApi?.poses || {}), ...Object.keys(this.def.poses || {})])]; }
  require3D(what) {
    if (!this.is3D) throw new Error(`Slide ${this.index + 1}: action "${what}" needs a 3D slide`);
  }
  markShown() {}

  // ------------------------------------------------------------- stepping
  runActions(actions, instant) {
    for (const a of actions) {
      const task = makeTask(a, this);
      if (instant) runInstant(task);
      else this.scheduler.add(task, a.delay, this.player.now);
    }
  }

  runEnter(instant) {
    this.replaying = instant;
    this.runActions(this.enter.actions, instant);
    this.replaying = false;
    if (!instant) this.autoArmed = true;
  }

  runStep(instant = false) {
    if (this.stepIndex >= this.steps.length) return false;
    const before = instant ? null : this.modelPoses();            // the 3D views on the page we leave
    const hand = instant ? new Map() : this.handoffs();              // the same element on the next page: new id -> old id
    const step = this.steps[this.stepIndex++];
    // an element handing over to the same one on the next page: no fade out / in, the new one is just there
    const olds = new Set(hand.values());
    const acts = hand.size ? step.actions.map((a) => (hand.has(a.show) || olds.has(a.hide) ? { ...a, anim: 'none', duration: 0, delay: 0 } : a)) : step.actions;
    this.replaying = instant;
    this.runActions(acts, instant);
    this.replaying = false;
    if (!instant) this.autoArmed = true;
    this.pageChanged(!instant, before);
    for (const [nid, oid] of hand) this.morphBox(nid, oid);
    return true;
  }

  // An element that ends on this page and the same element (a copy: the same kind and content: the same
  // text / picture / video / model / symbol) that begins on the next: they hand over as one object.
  handoffs() {
    const out = new Map(), k = this.stepIndex, all = [...this.elements.values()].filter((x) => x.spec.anchor == null);
    const on = (id, p) => pagesOf(this, id).includes(p);
    const key = (sp) => JSON.stringify([sp.type || 'text', sp.src ?? null, sp.text ?? null, sp.html ?? null, sp.tex ?? null, sp.items ?? null, sp.shape ?? null]);
    const used = new Set();
    for (const n of all) {
      if (on(n.spec.id, k) || !on(n.spec.id, k + 1)) continue;
      const o = all.find((x) => !used.has(x.spec.id) && key(x.spec) === key(n.spec) && on(x.spec.id, k) && !on(x.spec.id, k + 1));
      if (o) { out.set(n.spec.id, o.spec.id); used.add(o.spec.id); }
    }
    return out;
  }

  // the new element moves and resizes from where the old one was (1 s): it reads as one object moving
  morphBox(nid, oid) {
    const n = this.elements.get(nid), o = this.elements.get(oid);
    if (!n || !o) return;
    const num = (el, k) => (k === 'rotate' ? parseFloat(el.style.rotate) || 0 : parseFloat(el.style[k]));
    const keys = ['left', 'top', 'width', 'height', 'fontSize', 'rotate'].filter((k) => k === 'rotate' || (Number.isFinite(num(o.el, k)) && Number.isFinite(num(n.el, k))));
    const from = keys.map((k) => num(o.el, k)), to = keys.map((k) => num(n.el, k));
    if (from.every((v, i) => Math.abs(v - to[i]) < 0.5)) return;
    const t0 = performance.now(), D = 1000;
    const step = () => {
      if (this.disposed) return;
      const u = Math.min(1, (performance.now() - t0) / D), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      keys.forEach((k, i) => { const v = from[i] + (to[i] - from[i]) * e; n.el.style[k] = k === 'rotate' ? `${v}deg` : `${v}px`; });
      n.el._modelView?.render();
      if (u < 1) requestAnimationFrame(step);
    };
    step();
  }


  // 3D views on a 2D scene (model_view.js): the camera of each, by model file, on the page shown now
  modelPoses() {
    const out = new Map();
    for (const { el, spec } of this.elements.values()) {
      if (!el._modelView || !pagesOf(this, spec.id).includes(this.stepIndex)) continue;
      out.set(spec.src, el._modelView.pose());
    }
    return out;
  }

  // each 3D view turns to its camera for the page now; one showing the same model as a view on the page
  // before (the same element or another one, wherever it is) starts from that view's camera: 1 s
  pageChanged(animate, before = null) {
    if (this.is3D && this.lights?.size) setLightPage(this.scene, this.lights, this.def.lights, this.stepIndex, animate);
    if (this.is3D && this.models?.size) setModelsPage(this.models, this.def.models, this.stepIndex, animate);   // shapes that move between pages
    if (this.is3D && (this.def.ambient || this.scene.userData.ambientLevel != null)) setAmbientPage(this.scene, this.def, this.stepIndex, animate);
    for (const { el, spec } of this.elements.values()) {
      if (!el._modelView) continue;
      el._modelView.setPage(this.stepIndex, animate, before?.get(spec.src) ?? null);
    }
  }

  // reconstruct state "after k steps" without animation
  replayTo(k) {
    this.runEnter(true);
    while (this.stepIndex < k && this.runStep(true));
    this.autoArmed = false;
  }

  skipRunning() {
    this.scheduler.finishAll();
    this.sim?.flushBudget();
  }

  get done() { return this.stepIndex >= this.steps.length; }

  // ------------------------------------------------------------ per frame
  tick(now, dt) {
    this.scheduler.tick(now);
    if (this.autoArmed && !this.scheduler.busy) {
      this.autoArmed = false;
      if (this.steps[this.stepIndex]?.auto) this.runStep(false);
    }
    if (this.is3D) {
      this.sim.tick(dt);
      this.sceneApi.frame?.(now, dt, this);
      this.updateAnchors();
      this.draw();
    }
  }

  renderNow() {
    if (!this.is3D) return;
    this.sceneApi.frame?.(this.player.now, 0, this);
    this.updateAnchors();
    this.draw();
  }

  // a scene may draw itself (its own passes: reflections, a painted look, …): sceneApi.render(renderer, scene, camera)
  draw() {
    if (this.sceneApi.render) this.sceneApi.render(this.renderer, this.scene, this.camera);
    else this.renderer.render(this.scene, this.camera);
  }

  updateAnchors() {
    const [W, H] = this.player.size;
    const v = new THREE.Vector3();
    for (const { el, spec } of this.elements.values()) {
      if (spec.anchor == null) continue;
      let a = spec.anchor;
      if (typeof a === 'string') {
        a = this.sceneApi.anchors?.[a];
        if (typeof a === 'function') a = a();
        if (!a) continue;
      }
      if (Array.isArray(a)) v.set(...a); else v.copy(a);
      v.project(this.camera);
      const behind = v.z > 1;
      el.style.left = `${(v.x * 0.5 + 0.5) * W + (spec.x || 0)}px`;
      el.style.top = `${(-v.y * 0.5 + 0.5) * H + (spec.y || 0)}px`;
      el.style.display = behind ? 'none' : '';
    }
  }

  onActivate() {
    for (const { el, spec } of this.elements.values()) {
      if (spec.type === 'video' && spec.autoplay) el.play().catch(() => {});
    }
  }

  dispose() {
    this.disposed = true;
    this.scheduler.tasks = [];
    for (const { el, spec } of this.elements.values()) {
      if (spec.type === 'video') { el.pause(); el.removeAttribute('src'); el.load(); }
      el._modelView?.dispose();
    }
    this.devControls?.dispose();
    if (this.is3D) {
      this.sceneApi.dispose?.();
      this.scene.traverse((o) => {
        o.geometry?.dispose?.();
        const m = o.material;
        (Array.isArray(m) ? m : m ? [m] : []).forEach((mm) => mm.dispose?.());
      });
      this.player.releaseRenderer(this.renderer);
    }
    this.layer.remove();
  }
}

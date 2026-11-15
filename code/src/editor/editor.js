// Editor ("normal view" in PowerPoint terms).
//
//  ┌ toolbar: ▶ Run from this slide · ▶ Run from start · save status ┐
//  │ slide list │          slide (edit-mode Player)           │ inspector │
//
// - Pick a slide in the list; pick a step in the inspector (the slide is
//   rebuilt and replayed instantly to that step).
// - 3D slides: drag to orbit / scroll to zoom (authoring only), then save the
//   view as the start camera or as a named pose used by `{ camera: name }`.
// - 2D elements: drag on the slide to move; edit x / y / w / text in the
//   inspector; ✕ in the element list (or Delete) removes one.
// - Several at once: shift- / ⌘-click (on the slide or in the list) adds to the
//   selection; dragging any of them moves them all; ⌘G makes them a group
//   (`group` on each: a click on one selects the whole group), ⇧⌘G ungroups;
//   ⌘C / ⌘V / Delete work on the whole selection; Esc clears it.
//   In a 2D scene a drag on blank space draws a box: what it touches is selected (shift / ⌘: added);
//   ⌘A selects everything on the page.
// - Every edit is saved through code/serve.py: text / position of plain element
//   literals straight into deck.js, the rest into <deck folder>/overrides.json.
// - Live: edits saved in any tab (or deck.js changed by hand) show up in every
//   open editor / presenter at once (live.js).
// - Run (P / Shift+P) presents fullscreen from the selected slide (or the
//   first); Esc comes back to the editor at the slide you stopped on.

import * as THREE from 'three';
import { AgentPanel } from './agent_panel.js';
import { t, langButton } from '../i18n.js';
import { Player } from '../engine/player.js';
import { normalizePose } from '../engine/camera_rig.js';
import { SHAPES, shapeSVG, FONTS } from '../engine/elements.js';
import { placeModels, setModel, modelAt } from '../engine/model_view.js';
import { ModelHandles } from './model_handles.js';
import { placeLights, setLight, lightOn, applyAmbient, ambientOf } from '../engine/lights.js';
import { slideOverride, saveOverrides, mergeOverrides, removeElement, stripActions, cloneDef } from './overrides.js';
import { pagesOf, normalizeSteps } from '../engine/slide.js';
import { loadDeck, watchDeck, swapDeck } from '../live.js';

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) el.append(c);
  return el;
};

// "p0", "p1–3", "p2–end", "all", "hidden"
function pageLabel(pages, last) {
  if (!pages.length) return 'hidden';
  const a = pages[0], b = pages.at(-1);        // the pages, plainly: p0–p4
  void last;
  return a === b ? `p${a + 1}` : `p${a + 1}–p${b + 1}`;      // shown from 1
}

const THREE_DEG = Math.PI / 180;
// an element in the list: its kind (text, media, symbol, shape, …) and a name: a text's first word, a symbol's shape
const KINDS = { text: 'text', math: 'math', bullets: 'text', image: 'media', video: 'media', shape: 'symbol', model: 'shape', html: 'html' };
const kindOf = (spec) => KINDS[spec.type || 'text'] || spec.type;
function nameOf(spec) {
  if (spec.type === 'shape') return spec.shape || 'square';
  const t = spec.type || 'text';
  if (t !== 'text' && t !== 'bullets') return '';
  const raw = t === 'bullets' ? (spec.items || []).join(' ') : spec.text ?? (spec.html || '').replace(/<[^>]+>/g, ' ');
  const plain = String(raw).replace(/\$[^$]*\$/g, ' ').replace(/[*_`#]/g, '').trim();
  return plain.split(/\s+/)[0] || '';
}
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [1, 0], [0, 1], [-1, 0]];   // resize handles: corners, then edge middles (x, y sides)
// the colour swatches (the talk's colours); "more" opens the full picker
const SWATCHES = ['#333b46', '#000000', '#2f6fb3', '#41a65d', '#e03f45', '#ff95d3', '#f2c94c', '#9aa3ad'];
// a line-drawn eye (shown) / the same eye struck through (hidden)
const EYE = '<svg width="18" height="12" viewBox="0 0 18 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1 6c2.2-3.3 4.9-5 8-5s5.8 1.7 8 5c-2.2 3.3-4.9 5-8 5s-5.8-1.7-8-5z"/><circle cx="9" cy="6" r="2.2"/></svg>';
const EYE_OFF = '<svg width="18" height="12" viewBox="0 0 18 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1 6c2.2-3.3 4.9-5 8-5s5.8 1.7 8 5c-2.2 3.3-4.9 5-8 5s-5.8-1.7-8-5z"/><path d="M2.5 11.2 15.5 0.8"/></svg>';
const eyeBtn = (hidden, b) => { b.innerHTML = hidden ? EYE_OFF : EYE; return b; };
const LIGHT_COLORS = ['#ffffff', '#fff4e0', '#ffe2b8', '#ffd08a', '#e6f0ff', '#cfe0ff', '#ffd6ec', '#d9f5df'];   // white, warm, cool, tints
// a 2D scene's background: white, light greys / tints, paper, then dark ones
const BACKGROUNDS = ['#ffffff', '#f5f5f7', '#f6f1e6', '#eef3f9', '#e8f5ec', '#fdf6dd', '#333b46', '#000000'];
const BOXES = ['none', '#ffffff', '#eef3f9', '#e8f5ec', '#fdecee', '#fff0f8', '#fdf6dd', '#333b46'];   // text boxes: none, then light tints
const poseToJSONish = (p) => ({ position: p.position.toArray(), target: p.target.toArray(), fov: p.fov });

// which field holds an element's editable text, and its plain-text form
function textKeyOf(spec) {
  if (spec.type === 'math') return 'tex';
  if (spec.type === 'bullets') return 'items';
  if ((spec.type || 'text') === 'text') return 'text';
  return null;
}
function rawText(spec) {
  const k = textKeyOf(spec);
  if (k === 'items') return (spec.items || []).join('\n');
  if (k === 'text' && spec.text == null && spec.html != null) return spec.html.replace(/<br\s*\/?>/g, '\n').replace(/<b>(.*?)<\/b>/g, '**$1**').replace(/<i>(.*?)<\/i>/g, '*$1*').replace(/<[^>]+>/g, '');
  return spec[k] ?? '';
}
function fromRaw(spec, value) {
  const k = textKeyOf(spec);
  if (k === 'items') return { items: value.split('\n').filter((s) => s.trim()) };
  if (k === 'text') return { text: value, html: null };   // edited text is markup from now on
  return { [k]: value };
}

function slideTitle(def) {
  const t = (def.elements || []).find((e) => e.id === 'title') || (def.elements || []).find((e) => e.type === 'text');
  const raw = t?.text ?? t?.html ?? def.id ?? '';
  return raw.replace(/<[^>]+>/g, '').replace(/\$/g, '');
}

export class Editor {
  // the selection: `selectedEl` is the one shown in the form, `selection` all
  // selected (setting selectedEl selects it with its group)
  get selectedEl() { return this._sel ?? null; }
  set selectedEl(id) { this._sel = id; this.selection = new Set(id ? this.withGroup([id]) : []); }
  withGroup(ids) {
    const els = this.player?.current?.def.elements || [], out = new Set(ids);
    for (const id of ids) {
      const g = els.find((e) => e.id === id)?.group;
      if (g) for (const e of els) if (e.group === g) out.add(e.id);
    }
    return [...out];
  }
  toggleSelect(id) {
    const ids = this.withGroup([id]);
    if (this.selection?.has(id)) { ids.forEach((x) => this.selection.delete(x)); this._sel = [...this.selection].at(-1) ?? null; }
    else { if (!this.selection) this.selection = new Set(); ids.forEach((x) => this.selection.add(x)); this._sel = id; }
  }
  selectedSpecs(inst) { return (inst?.def.elements || []).filter((e) => this.selection?.has(e.id)); }

  constructor(root, deck, { deckName, deckFile, baseUrl, overrides, deckUrl }) {
    Object.assign(this, { root, deck, deckName, deckFile, baseUrl, deckUrl, ov: overrides });
    this.selectedEl = null;
    this.pending = { slides: {} };          // edits not yet sent (the server merges them)
    this.ownStamps = new Set();             // file stamps our own saves produced
    this.buildShell();
    const m = location.hash.match(/^#(\d+)(?:\.(\d+))?/);
    this.openPlayer(m ? +m[1] - 1 : 0, m ? +(m[2] || 0) : Infinity);
    this.bindKeys();
    this.watch = watchDeck({
      deckName, deckFile,
      onDeck: (s) => this.externalChange(s),
      onCode: () => location.reload(),
    });
  }

  // the deck changed on disk (another tab saved, or deck.js edited by hand)
  async externalChange(s) {
    const typing = document.activeElement?.isContentEditable || this.inspector.contains(document.activeElement);
    if (typing || this.saveTimer || this.saving) {                     // mid-edit: try again shortly
      setTimeout(() => this.externalChange(s), 500); return;
    }
    if (!this.deckUrl || this.ownStamps.has(s.deck)) return;           // our own save
    const { deck, overrides } = await loadDeck(this.deckUrl, this.baseUrl, s.deck);
    this.deck = deck; this.ov = overrides;
    swapDeck(this.player, deck);
    swapDeck(this.runner, deck);
    this.renderList();
    this.flash('updated from disk');
  }

  // ------------------------------------------------------------ layout
  buildShell() {
    this.status = h('span', { class: 'ed-status' }, '');
    const agentSlot = h('span', { class: 'ed-agent-slot' });
    const bar = h('header', { class: 'ed-bar' },
      h('span', { class: 'ed-title' }, this.deck.title || this.deckName),
      h('button', { class: 'ed-run', title: 'P: present from the page shown', onclick: () => this.run(this.player?.current?.index ?? 0, this.player?.current?.stepIndex ?? 0) }, '▶ Run from this slide'),
      h('button', { title: 'Shift+P', onclick: () => this.run(0) }, 'Run from start'),
      h('span', { class: 'ed-sep' }),
      h('button', { title: '←', onclick: () => this.player?.prev() }, '◀ step'),
      h('button', { title: '→ (plays the animation)', onclick: () => this.player?.next() }, 'step ▶'),
      h('span', { class: 'ed-sep' }),
      h('button', { title: 'undo (⌘Z)', onclick: () => this.undo('undo') }, '↶ undo'),
      h('button', { title: 'redo (⌘⇧Z)', onclick: () => this.undo('redo') }, '↷ redo'),
      h('span', { class: 'ed-sep' }),
      agentSlot,
      h('span', { class: 'ed-grow' }),
      this.status,
      langButton());                                       // 中 | EN (i18n.js)
    this.list = h('aside', { class: 'ed-slides' });
    this.host = h('div', { class: 'ed-stage-host editing' });
    this.inspector = h('aside', { class: 'ed-inspector' });
    const canvas = h('main', { class: 'ed-canvas' }, this.host);
    this.shell = h('div', { class: 'editor' }, bar, h('div', { class: 'ed-body' }, this.list, canvas, this.inspector));
    this.root.append(this.shell);
    this.agent = new AgentPanel(this, canvas);               // the agent (agent_panel.js)
    agentSlot.append(this.agent.button);
    this.renderList();
    this.bindDrag();
    this.bindInlineEdit();
    this.bindFileDrop();
  }

  // a scene in the list can be dragged onto another place in it (every scene needs an id: they are saved by id)
  renderList() {
    const movable = this.deck.slides.every((d) => d.id);
    this.list.replaceChildren(...this.deck.slides.map((def, i) => h('div', {
      class: `ed-slide ${this.player?.current?.index === i ? 'active' : ''}`,
      draggable: movable ? 'true' : null,
      onclick: () => this.player.jump(i, Infinity, false),
      ondblclick: () => this.run(i),
      ondragstart: (e) => { e.dataTransfer.setData('text/slide', String(i)); e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('dragging'); },
      ondragend: (e) => e.currentTarget.classList.remove('dragging'),
      ondragover: (e) => {
        if (!e.dataTransfer.types.includes('text/slide')) return;
        e.preventDefault(); e.dataTransfer.dropEffect = 'move';
        const r = e.currentTarget.getBoundingClientRect(), below = e.clientY > r.top + r.height / 2;
        e.currentTarget.classList.toggle('drop-above', !below); e.currentTarget.classList.toggle('drop-below', below);
      },
      ondragleave: (e) => e.currentTarget.classList.remove('drop-above', 'drop-below'),
      ondrop: (e) => {
        if (!e.dataTransfer.types.includes('text/slide')) return;
        e.preventDefault();
        const below = e.currentTarget.classList.contains('drop-below');
        e.currentTarget.classList.remove('drop-above', 'drop-below');
        const from = +e.dataTransfer.getData('text/slide');
        let to = i + (below ? 1 : 0); if (from < to) to--;              // the place it takes once out of the list
        if (from !== to) this.moveSlide(from, to);
      },
      title: movable ? 'click: edit · double-click: run from here · drag: move it' : 'click: edit · double-click: run from here',
    },
    h('span', { class: 'ed-num' }, String(i + 1)),
    h('span', { class: `ed-badge ed-${def.type || '2d'}` }, (def.type || '2d').toUpperCase()),
    h('span', { class: 'ed-name' }, slideTitle(def)),
    def.id ? h('button', {
      class: 'ed-slide-del', title: 'duplicate this scene (2D or 3D)',
      onclick: (e) => { e.stopPropagation(); this.duplicateSlide(i); },
    }, '⧉') : null,
    def.id ? h('button', {
      class: 'ed-slide-del', title: 'delete this scene',
      onclick: (e) => { e.stopPropagation(); this.deleteSlide(i); },
    }, '✕') : null)),
    h('button', { class: 'ed-new-slide', title: 'a new 2D scene (fixed camera) after the current one', onclick: () => this.addSlide() }, '+ New 2D scene'),
    h('button', { class: 'ed-new-slide', title: 'a new 3D scene: from a model file you upload, or generated by the agent',
      onclick: () => this.newScene3D() }, '+ New 3D scene'));
  }

  // ------------------------------------------------------------ slides
  recordSlide(def, i, fn) {
    fn(slideOverride(this.ov, def, i));
    fn(slideOverride(this.pending, def, i));
  }

  // + New 3D scene: a model file to upload (pickModel), or Generate: the agent makes it (agent_panel.js generateScene)
  newScene3D() {
    const close = () => { veil.remove(); window.removeEventListener('keydown', esc, true); };
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const box = h('div', { class: 'ed-agent-ask ed-new3d' },
      h('h3', {}, 'New 3D scene'),
      h('p', {}, 'Upload a model file (stl, obj, ply, glb, gltf, 3mf): a 3D scene showing it, centred, isometric camera. ',
        'Or let the agent generate the scene from what you describe.'),
      h('div', { class: 'ed-agent-pick' },
        h('button', { onclick: close }, 'Cancel'),
        h('button', { onclick: () => { close(); this.pickModel(); } }, 'Upload…'),
        h('button', { class: 'primary', title: 'the agent makes it (you will be asked to approve one first if none is connected)',
          onclick: () => { close(); this.agent.generateScene(); } }, 'Generate')));
    const veil = h('div', { class: 'ed-agent-veil', onclick: (e) => { if (e.target === veil) close(); } }, box);
    window.addEventListener('keydown', esc, true);
    document.body.append(veil);
  }

  // + New 3D scene → Upload: pick a model file, upload it (serve.py /api/upload), a 3D slide showing it
  pickModel() { this.pickUpload((path, f) => this.addSlide({ type: '3d', model: path, title: f.name.replace(/\.[^.]+$/, '') })); }

  // choose a model file, upload it (serve.py /api/upload), then done(path, file)
  pickUpload(done, accept = '.stl,.obj,.ply,.glb,.gltf,.3mf') {
    // the file input lives in the page while the dialog is open: a detached one is not opened by every browser,
    // and Chrome may collect it before its change event (then nothing happens)
    document.querySelectorAll('input.ed-upload').forEach((x) => x.remove());
    const input = h('input', { type: 'file', accept, class: 'ed-upload', style: 'position:fixed;left:-9999px;top:0;opacity:0' });
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      input.remove();
      if (!f) return;
      this.flash(`uploading ${f.name} …`);
      try {
        const r = await fetch(`/api/upload?deck=${encodeURIComponent(this.deckName)}&file=${encodeURIComponent(this.deckFile)}&name=${encodeURIComponent(f.name)}`,
          { method: 'POST', body: f });
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        const { path } = await r.json();
        await done(path, f);
      } catch (e) { this.flash(`upload failed: ${e.message}`); }
    });
    input.click();
  }

  // + Upload 3D shape: into the 3D scene (where the camera looks, about a sixth of the view across), or onto a 2D scene
  // as an isometric 3D view (an element, on this page)
  uploadShape(inst) { this.pickUpload((path, f) => this.addShapeFile(inst, path, f)); }

  // a model file, uploaded: into the 3D scene, or as a 3D view on a 2D one (at: its centre on the stage, if dropped)
  async addShapeFile(inst, path, f, at = null) {
    {
      const base = f.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'shape';
      if (!inst.is3D) {
        const ids = new Set((inst.def.elements || []).map((e) => e.id));
        let n = 1; while (ids.has(`${base}_${n}`)) n++;
        const page = inst.stepIndex;
        this.insertElement(inst, { id: `${base}_${n}`, type: 'model', src: path, x: Math.round((at?.x ?? 960) - 200), y: Math.round((at?.y ?? 540) - 200), w: 400, h: 400, on: [page, page] });
        this.flash(`added the 3D shape “${base}_${n}” on page ${page + 1}`);
        return;
      }
      const ids = new Set(Object.keys(inst.def.models || {}));
      let n = 1; while (ids.has(`${base}_${n}`)) n++;
      const id = `${base}_${n}`, t = inst.rig.target, d = inst.camera.position.distanceTo(t);
      const r = (v) => Math.round(v * 1000) / 1000;
      const m = { src: path, position: t.toArray().map(r), size: r(d * 0.15), turn: 0, ...(inst.stepIndex ? { since: inst.stepIndex } : {}) };
      (inst.def.models ||= {})[id] = m;
      this.record((o) => { (o.models ||= {})[id] = { ...m }; }, inst);
      await placeModels(inst.scene, { [id]: m }, this.baseUrl, inst.models);
      inst.renderNow();
      this.selectedModel = id;
      this.save(); this.renderInspector();
      this.flash(`added the 3D shape “${id}” where the camera looks · move it below`);
    }
  }

  // + Image / video: upload it, an element on this page (a video loops, muted, from the start when it appears)
  uploadMedia(inst) {
    this.pickUpload((path, f) => this.addMediaFile(inst, path, f), 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,video/mp4,video/webm,video/quicktime,.mov,.m4v');
  }

  // another picture in an image element: its place, width and look stay; with a set height (a framed picture),
  // the height follows the new picture's proportions (inside the border, if it has one)
  replaceImage(inst, spec) {
    this.pickUpload((path) => {
      const img = new Image();
      img.onload = () => {
        const props = { src: path };
        const el = inst.elements.get(spec.id)?.el;
        if (spec.h != null && spec.w != null && img.naturalWidth) {
          const b = el ? (parseFloat(getComputedStyle(el).borderLeftWidth) || 0) * 2 : 0;
          props.h = Math.round((spec.w - b) * img.naturalHeight / img.naturalWidth + b);
        }
        this.editLive(inst, spec, props);
        const shown = inst.elements.get(spec.id)?.el;                  // show it at once
        if (shown) (shown.tagName === 'IMG' ? shown : shown.querySelector('img'))?.setAttribute('src', img.src);
        this.renderInspector();
        this.flash(`replaced the picture of “${spec.id}”`);
      };
      img.src = new URL(path, this.baseUrl).href;
    }, 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml');
  }

  // an image / video file, uploaded: an element on this page (at: its centre on the stage, if dropped / pasted there)
  addMediaFile(inst, path, f, at = null) {
    {
      const video = /\.(mp4|webm|mov|m4v)$/i.test(f.name);
      const base = f.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || (video ? 'video' : 'image');
      const ids = new Set((inst.def.elements || []).map((e) => e.id));
      let n = 1; while (ids.has(`${base}_${n}`)) n++;
      const page = inst.stepIndex, id = `${base}_${n}`;
      const w = video ? 800 : 600, cx = at?.x ?? 960, cy = at?.y ?? 540;
      this.insertElement(inst, video
        ? { id, type: 'video', src: path, x: Math.round(cx - w / 2), y: Math.round(cy - w * 0.28), w, loop: true, autoplay: true, on: [page, page] }
        : { id, type: 'image', src: path, x: Math.round(cx - w / 2), y: Math.round(cy - w * 0.4), w, on: [page, page] });
      this.flash(`added “${id}” on page ${page + 1}`);
    }
  }

  // files dropped on the slide or pasted (⌘V): pictures / videos become media, model files 3D shapes
  async addFiles(files, at = null) {
    const inst = this.player?.current;
    if (!inst) return;
    for (const f of files) {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      const model = ['stl', 'obj', 'ply', 'glb', 'gltf', '3mf'].includes(ext);
      const media = /^(image|video)\//.test(f.type) || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'mp4', 'webm', 'mov', 'm4v'].includes(ext);
      if (!model && !media) { this.flash(`${f.name}: not a picture, video or 3D model`); continue; }
      // a pasted screenshot has no useful name: give it one
      const file = f.name && f.name !== 'image.png' ? f : new File([f], `pasted_${Date.now()}.${ext || 'png'}`, { type: f.type });
      try {
        this.flash(`uploading ${file.name} …`);
        const r = await fetch(`/api/upload?deck=${encodeURIComponent(this.deckName)}&file=${encodeURIComponent(this.deckFile)}&name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        const { path } = await r.json();
        if (model) await this.addShapeFile(inst, path, file, at); else this.addMediaFile(inst, path, file, at);
      } catch (e) { this.flash(`upload failed: ${e.message}`); }
    }
  }

  bindFileDrop() {
    const stagePoint = (e) => {
      const stage = this.host.querySelector('.stage'); if (!stage) return null;
      const r = stage.getBoundingClientRect(), s = this.player.scale || 1;
      return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
    };
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    this.host.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; this.host.classList.add('ed-drop'); });
    this.host.addEventListener('dragleave', (e) => { if (e.target === this.host) this.host.classList.remove('ed-drop'); });
    this.host.addEventListener('drop', (e) => {
      this.host.classList.remove('ed-drop');
      if (!hasFiles(e)) return;
      e.preventDefault();
      this.addFiles([...e.dataTransfer.files], stagePoint(e));
    });
    // ⌘V: files on the clipboard are added; otherwise the copied elements are pasted
    document.addEventListener('paste', (e) => {
      if (this.running || e.target.closest?.('input, textarea, select') || e.target.isContentEditable) return;
      const files = [...(e.clipboardData?.files || [])];
      e.preventDefault();
      if (files.length) this.addFiles(files);
      else if (this.clipboard && this.player?.current) this.pasteElement(this.player.current, this.clipboard);
    });
  }

  // 3D shapes in this 3D scene: pick one, move / size / turn it, or delete it
  modelsSection(inst) {
    const models = inst.def.models || {};
    const ids = Object.keys(models);
    if (!inst.is3D || !ids.length) return null;
    const row = (id) => h('div', { class: `el-item ${this.selectedModel === id ? 'on' : ''}`, 'data-el': `model:${id}`, title: id,
      onclick: () => { this.selectedEl = null; this.selectedModel = this.selectedModel === id ? null : id; this.renderInspector(); this.showModelBox(inst); } },
      h('span', { class: 'ed-badge ed-3d el-badge', title: 'a 3D shape in the scene' }, '3D'),
      h('span', { class: 'grow el-desc' }, h('span', { class: 'el-kind' }, 'shape')),
      h('span', { class: 'el-pages', title: 'in the scene on every page' }, 'all'),
      h('button', { class: 'el-del', title: 'delete this 3D shape', onclick: (e) => { e.stopPropagation(); this.deleteModel(inst, id); } }, '✕'));
    const m = models[this.selectedModel] && modelAt(models[this.selectedModel], inst.stepIndex);   // (as it is on the page shown)
    let form = null;
    if (m) {
      const set = (props) => this.editModel(inst, this.selectedModel, props);
      const pos = (k, label) => h('label', {}, label, h('input', { type: 'number', step: 0.01, value: m.position?.[k] ?? 0,
        oninput: (e) => { const p = [...(m.position || [0, 0, 0])]; p[k] = +e.target.value || 0; set({ position: p }); } }));
      form = h('div', { class: 'el-form' },
        h('div', { class: 'row' }, pos(0, 'x'), pos(1, 'y'), pos(2, 'z')),
        h('div', { class: 'row' },
          h('label', {}, 'size', h('input', { type: 'number', step: 0.01, min: 0.001, value: m.size ?? 0.2, oninput: (e) => set({ size: Math.max(0.001, +e.target.value || 0.001) }) })),
          h('button', { class: `ratio-lock ${m.lockRatio ? 'on' : ''}`, title: m.lockRatio ? 'proportions locked: the face dots scale it as a whole' : 'lock the proportions',
            onclick: () => { set({ lockRatio: m.lockRatio ? null : true }); this.renderInspector(); } }, m.lockRatio ? '🔗' : '⛓︎'),
          h('label', {}, 'turn', h('input', { type: 'number', step: 5, value: m.turn ?? 0, oninput: (e) => set({ turn: +e.target.value || 0, quat: null }) }))));
    }
    return { rows: ids.map(row), form };                // the rows go in the element list, the form under it
  }

  editModel(inst, id, props) {
    // on the page it was added on (or before): the shape itself; on a later page: where it is from that page on
    // (it glides there when the page comes)
    const m0 = inst.def.models[id], page = inst.stepIndex;
    if (page > (m0.since ?? 0) && !('lockRatio' in props)) {
      m0.pages = { ...(m0.pages || {}), [page]: { ...(m0.pages?.[page] || {}), ...props } };
      props = { pages: m0.pages };
    } else Object.assign(m0, props);
    const m = modelAt(m0, page);
    this.record((o) => { (o.models ||= {})[id] = { ...((o.models || {})[id] || {}), ...props }; }, inst);
    const holder = inst.models?.get(id);
    if (holder) { setModel(holder, m); this.modelHandles?.place(); inst.renderNow(); }
    this.save();
  }

  deleteModel(inst, id) {
    delete inst.def.models[id];
    this.record((o) => { (o.models ||= {})[id] = null; }, inst);
    const holder = inst.models?.get(id);
    if (holder) { holder.removeFromParent(); inst.models.delete(id); inst.renderNow(); }
    if (this.selectedModel === id) this.selectedModel = null;
    this.save(); this.renderInspector();
    this.flash(`deleted the 3D shape “${id}” · ⌘Z undoes`);
  }

  addSlide({ type = '2d', model = null, title = t('New slide') } = {}) {
    const cur = this.player?.current?.index ?? this.deck.slides.length - 1;
    const ids = new Set(this.deck.slides.map((d) => d.id));
    let n = this.deck.slides.length + 1; while (ids.has(`slide_${n}`)) n++;
    const def = {
      id: `slide_${n}`, type,
      ...(model ? { model, camera: 'iso', background: '#ffffff' } : {}),
      elements: [{ id: 'title', type: 'text', text: title, className: 'heading', x: 110, y: 80, w: 1700, on: [0, null] }],
      steps: [],
    };
    const after = this.deck.slides[cur]?.id ?? null;
    this.deck.slides.splice(cur + 1, 0, def);
    this.recordSlide(def, cur + 1, (o) => Object.assign(o, { added: true, after, def: JSON.parse(JSON.stringify(def)) }));
    this.save();
    this.player.jump(cur + 1, 0, false);
    this.flash(model ? `added 3D scene ${cur + 2} with ${model}` : `added scene ${cur + 2} · double-click its title to edit`);
  }

  // a copy of a slide (2D or 3D: the copy shares the scene code), right after it
  duplicateSlide(i) {
    const src = this.deck.slides[i];
    if (!src?.id) return;
    const ids = new Set(this.deck.slides.map((d) => d.id));
    let n = 2; while (ids.has(`${src.id}_${n}`)) n++;
    const def = { ...cloneDef(src), id: `${src.id}_${n}` };
    this.deck.slides.splice(i + 1, 0, def);
    const own = this.ov.slides?.[src.id] || {};                     // the source's edits kept in overrides come along
    const extra = JSON.parse(JSON.stringify({ elements: own.elements, poses: own.poses, camera: own.camera, pageCameras: own.pageCameras }));
    this.recordSlide(def, i + 1, (o) => Object.assign(o, { added: true, after: src.id, copyOf: src.id },
      Object.fromEntries(Object.entries(extra).filter(([, v]) => v != null))));
    this.save();
    this.player.jump(i + 1, Infinity, false);
    this.flash(`duplicated scene ${i + 1} → ${i + 2}`);
  }

  // a scene dragged in the list from place `from` to place `to`: the deck's order (saved by id, written into deck.js)
  moveSlide(from, to) {
    const slides = this.deck.slides, cur = slides[this.player.current?.index ?? 0];
    slides.splice(to, 0, ...slides.splice(from, 1));               // in place: the players hold this array
    const order = slides.map((d) => d.id);
    this.ov.order = order; this.pending.order = order;
    this.save();
    const k = this.player.current?.stepIndex ?? Infinity;
    this.player.jump(Math.max(0, slides.indexOf(cur)), k, false);
    this.renderList();
    this.flash(`moved scene ${from + 1} → ${to + 1} · ⌘Z undoes`);
  }

  // a 2D scene's background colour (null: the theme's)
  setBackground(inst, color) {
    const def = inst.def;
    if (color) def.background = color; else delete def.background;
    if (inst.layer) inst.layer.style.background = color || '';
    this.record((o) => { o.background = color || null; }, inst);
    this.save();
  }

  backgroundRow(inst) {
    const def = inst.def, theme = this.deck.theme?.background || '#ffffff';
    return h('div', {},
      h('div', { class: 'add-label' }, 'Background'),
      this.colorPicker((def.background || theme).toLowerCase(), (c) => this.setBackground(inst, c), BACKGROUNDS),
      def.background ? h('div', { class: 'row' }, h('span', { class: 'hint grow' }, `theme: ${theme}`),
        h('button', { title: 'back to the talk\'s background (theme)', onclick: () => { this.setBackground(inst, null); this.renderInspector(); } }, 'reset')) : null);
  }

  deleteSlide(i) {
    const def = this.deck.slides[i];
    if (!def?.id || this.deck.slides.length < 2) return;
    this.deck.slides.splice(i, 1);
    this.recordSlide(def, i, (o) => { o.deleted = true; });
    this.save();
    const cur = this.player.current?.index ?? 0;
    this.player.jump(Math.max(0, Math.min(this.deck.slides.length - 1, cur > i ? cur - 1 : cur === i ? i - 1 : cur)), Infinity, false);
    this.renderList();
    this.flash(`deleted scene ${i + 1} · ⌘Z undoes`);
  }

  openPlayer(i, k) {
    this.player = new Player(this.host, this.deck, {
      baseUrl: this.baseUrl, mode: 'edit', startAt: [i, k],
      onChange: (inst) => this.onChange(inst),
    });
    window.player = this.player;
    this.player.start();
  }

  onChange(inst) {
    // camera moves fire often: only refresh the pose readout then
    if (this.lastInst === inst && this.lastStep === inst.stepIndex && this.poseOut) {
      this.poseOut.textContent = JSON.stringify(this.player.currentPose());
      this.modelHandles?.place();
      return;
    }
    if (this.lastInst && this.lastInst.index !== inst.index) this.selectedEl = null;
    if (this.selectAfterJump) { this.selectedEl = this.selectAfterJump; this.selectAfterJump = null; }
    this.lastInst = inst; this.lastStep = inst.stepIndex;
    this.renderList();
    this.renderInspector();
  }

  // ------------------------------------------------------------ inspector
  renderInspector() {
    const inst = this.player.current;
    if (!inst) return;
    const def = inst.def, i = inst.index;
    const sec = (title, ...kids) => h('section', {}, ...kids);          // no headings: the panel speaks for itself
    const parts = [];

    // steps
    // pages are shown from 1 (page 1 = the scene as it enters; inside, page k is step k - 1)
    // drag a page number onto another to move the page there
    const chips = [{ auto: false }, ...inst.steps].map((s, k) => {
      const b = h('button', {
        class: `chip ${inst.stepIndex === k ? 'on' : ''} ${s.auto ? 'auto' : ''}`, draggable: def.id ? 'true' : null,
        title: (k === 0 ? 'page 1: the scene as it enters' : s.auto ? 'runs by itself after the page before' : `page ${k + 1}: after click ${k}`) + ' · drag to reorder',
        onclick: () => this.player.jump(i, k, false),
      }, String(k + 1));
      b.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/page', String(k)); e.dataTransfer.effectAllowed = 'move'; });
      b.addEventListener('dragover', (e) => { e.preventDefault(); b.classList.add('drop'); });
      b.addEventListener('dragleave', () => b.classList.remove('drop'));
      b.addEventListener('drop', (e) => { e.preventDefault(); b.classList.remove('drop'); const from = +e.dataTransfer.getData('text/page'); if (from !== k) this.movePage(inst, from, k); });
      return h('span', { class: 'chip-wrap' }, b);
    });
    if (def.id) chips.push(h('button', { class: 'chip chip-add', title: 'add a page (one more click) at the end', onclick: () => this.addPage(inst) }, '+'));
    parts.push(sec(`Scene ${i + 1} · ${(def.type || '2d').toUpperCase()}${def.id ? ` · ${def.id}` : ''}`,
      h('div', { class: 'chips' }, chips),
      def.id ? h('div', { class: 'row' },
        h('button', { title: 'a copy of the page shown, right after it', onclick: () => this.duplicatePage(inst, inst.stepIndex) }, '⧉ duplicate page'),
        h('button', { class: 'danger', title: 'delete the page shown; the pages after it move up',
          onclick: () => this.deletePage(inst, inst.stepIndex) }, '✕ delete page')) : null));

    // camera
    if (inst.is3D) {
      this.poseOut = h('code', { class: 'pose' }, JSON.stringify(this.player.currentPose()));
      parts.push(sec('Camera',
        this.poseOut,
        h('div', { class: 'row' },
          h('button', { class: 'primary grow', title: 'the view now becomes the camera of the page shown (where its camera move ends)',
            onclick: () => this.savePageCamera(inst) }, 'set as current camera'))));
      parts.push(sec('Lights', this.lightsSection(inst)));
    } else {
      this.poseOut = null;           // (a 2D scene has no lights: each 3D shape on it has its own, in its form below)
      parts.push(sec('Background', this.backgroundRow(inst)));
    }

    // elements, by page: those on this page first, the rest folded
    const els = def.elements || [];
    const page = inst.stepIndex, last = inst.steps.length;
    const pagesById = new Map(els.map((spec) => [spec.id, pagesOf(inst, spec.id)]));
    const row = (spec) => h('div', {
      class: `el-item ${this.selection?.has(spec.id) ? 'on' : ''}`, 'data-el': spec.id, title: spec.id,
      onclick: (e) => { if (e.shiftKey || e.metaKey || e.ctrlKey) { this.toggleSelect(spec.id); this.renderInspector(); } else this.selectElement(spec.id); },
    }, h('span', { class: `ed-badge ed-${spec.type === 'model' ? '3d' : '2d'} el-badge`, title: spec.type === 'model' ? 'a 3D view' : 'a 2D element' }, spec.type === 'model' ? '3D' : '2D'),
    h('span', { class: 'grow el-desc' }, h('span', { class: 'el-kind' }, kindOf(spec)), h('b', {}, nameOf(spec)), spec.group ? h('span', { class: 'el-group' }, `▣${spec.group}`) : null),
    h('span', {
      class: 'el-pages', title: 'pages it is on · click to change',
      onclick: (e) => { e.stopPropagation(); this.editPagesInline(e.currentTarget, inst, spec); },
    }, pageLabel(pagesById.get(spec.id), last)),
    h('button', {
      class: 'el-del el-copy', title: 'duplicate onto this page (or ⌘C, then ⌘V on any page / slide)',
      onclick: (e) => { e.stopPropagation(); this.pasteElement(inst, this.copyOf(inst, spec)); },
    }, '⧉'),
    h('button', {
      class: 'el-del', title: 'delete this element (and its show / hide actions)',
      onclick: (e) => { e.stopPropagation(); this.deleteElement(inst, spec); },
    }, '✕'));
    const here = els.filter((spec) => pagesById.get(spec.id).includes(page));
    const other = els.filter((spec) => !pagesById.get(spec.id).includes(page));
    const shapes3d = this.modelsSection(inst);           // 3D shapes in a 3D scene: listed with the elements
    const hereRows = [...here.map(row), ...(shapes3d?.rows || [])];
    parts.push(sec(`Elements · page ${page + 1}`,
      h('div', { class: 'add-label' }, 'Element'),
      h('div', { class: 'el-list' }, hereRows.length ? hereRows : h('p', { class: 'hint pad' }, 'nothing on this page')),
      other.length ? h('details', { class: 'el-other' }, h('summary', {}, `on other pages (${other.length})`), h('div', { class: 'el-list' }, other.map(row))) : null,
      h('div', { class: 'add-label' }, 'Add'),
      h('div', { class: 'row add-row' },
        h('button', { onclick: () => this.addElement(inst, 'text') }, '+ Text'),
        h('button', { class: this.symbolOpen ? 'on' : '', onclick: () => { this.symbolOpen = !this.symbolOpen; this.renderInspector(); } }, '+ Symbol'),
        h('button', { title: 'a model file (stl, obj, ply, glb, gltf, 3mf): in a 3D scene it goes into the scene (move it below); in a 2D scene it is an isometric 3D view',
          onclick: () => this.uploadShape(inst) }, '+ Shape'),
        h('button', { title: 'an image (png, jpg, gif, webp, svg) or a video (mp4, webm, mov) on this page', onclick: () => this.uploadMedia(inst) }, '+ Media'),
      ),
      this.symbolPicker(inst),
      !this.selectedEl ? shapes3d?.form : null,
      this.groupRow(inst),
      this.selectedEl ? this.elementForm(inst, els.find((e) => e.id === this.selectedEl)) : null));

    this.inspector.replaceChildren(...parts);
    this.highlightSelected();
    if (inst.is3D && this.selectedModel && this.modelHandles?.inst !== inst) this.showModelBox(inst);   // the page was rebuilt
    if (inst.is3D) this.showLightGizmos(inst);
    else { this.lightGizmos = []; if ((def.elements || []).some((e) => e.type === 'model')) this.refreshViews(inst); }
    for (const { el, spec } of inst.elements.values()) if (el._modelView) el.classList.toggle('model-unlocked', this.camUnlocked(spec.id));
    if (!inst.is3D || !this.selectedModel) { this.modelHandles?.dispose(); this.modelHandles = null; }
  }

  // several selected: they move together; make them a group (or undo one)
  groupRow(inst) {
    const sel = this.selectedSpecs(inst);
    if (sel.length < 2 && !sel.some((e) => e.group)) return null;
    const grouped = sel.some((e) => e.group);
    return h('div', { class: 'row wrap' },
      h('span', { class: 'hint' }, `${sel.length} selected · drag moves them together`),
      sel.length > 1 ? h('button', { title: '⌘G', onclick: () => this.groupSelection(inst) }, 'Group') : null,
      grouped ? h('button', { title: '⇧⌘G', onclick: () => this.ungroupSelection(inst) }, 'Ungroup') : null);
  }

  groupSelection(inst) {
    const sel = this.selectedSpecs(inst);
    if (sel.length < 2) return;
    const used = new Set((inst.def.elements || []).map((e) => e.group).filter(Boolean));
    let n = 1; while (used.has(`g${n}`)) n++;
    this.editMany(inst, sel.map((spec) => [spec, { group: `g${n}` }]));
    this.flash(`grouped ${sel.length} elements as g${n} · a click on one selects them all`);
  }

  ungroupSelection(inst) {
    const sel = this.selectedSpecs(inst).filter((e) => e.group);
    if (!sel.length) return;
    this.editMany(inst, sel.map((spec) => [spec, { group: null }]));
    this.flash(`ungrouped ${sel.length} elements`);
  }

  // several element edits at once: one redraw of the inspector, one save
  editMany(inst, edits) {
    for (const [spec, props] of edits) {
      Object.assign(spec, props);
      this.record((o) => { o.elements ||= {}; o.elements[spec.id] = { ...(o.elements[spec.id] || {}), ...props }; }, inst);
      inst.refreshElement(spec.id);
    }
    this.highlightSelected();
    this.renderInspector();
    this.save();
  }

  elementForm(inst, spec) {
    if (!spec) return null;
    const form = this.elementFormBody(inst, spec);
    form?.appendChild(h('div', { class: 'look-line layer-row' }, h('span', { class: 'look-name' }, 'layer'),
      h('button', { class: 'layer-btn', title: 'to the front (⌘])', onclick: () => this.setLayer(inst, [spec], 'front') }, '▲'),
      h('button', { class: 'layer-btn', title: 'to the back (⌘[) — still above the background', onclick: () => this.setLayer(inst, [spec], 'back') }, '▼')));
    return form;
  }

  // front / back: z above / below every other element of the scene (several selected: they keep their order)
  // z stays 0 or more: the back is just above the scene's background (or its 3D view), never under it
  setLayer(inst, specs, where) {
    const others = (inst.def.elements || []).filter((e) => !specs.includes(e));
    const sorted = [...specs].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
    const edits = [];
    if (where === 'front') {
      const top = Math.max(0, ...others.map((e) => e.z ?? 0));
      sorted.forEach((spec, i) => edits.push([spec, { z: top + 1 + i }]));
    } else {
      // the chosen ones take 0, 1, ...; every other element moves up above them (keeping their order)
      const n = sorted.length;
      sorted.forEach((spec, i) => edits.push([spec, { z: i }]));
      for (const e of others) edits.push([e, { z: (e.z ?? 0) + n }]);
    }
    this.editMany(inst, edits);
    this.flash(where === 'front' ? 'to the front' : 'to the back');
  }

  elementFormBody(inst, spec) {
    if (!spec) return null;
    const el = inst.elements.get(spec.id)?.el;
    const num = (key, label) => h('label', {}, label, h('input', {
      type: 'number', value: spec[key] ?? '', step: 1,
      oninput: (e) => {
        const v = e.target.value === '' ? null : +e.target.value, props = { [key]: v };
        // the proportion lock: w and h change together (the box's shape stays)
        if (spec.lockRatio && v && (key === 'w' || key === 'h') && el) {
          const w0 = spec.w ?? el.offsetWidth, h0 = spec.h ?? el.offsetHeight;
          if (key === 'w' && spec.h != null) props.h = Math.round(v * h0 / w0);
          if (key === 'h') props.w = Math.round(v * w0 / h0);
        }
        this.editLive(inst, spec, props);
      },
    }));
    // 🔒 / 🔓 the proportion lock (corners and edges keep the box's shape when it is on)
    const lock = h('button', { class: `ratio-lock ${spec.lockRatio ? 'on' : ''}`, title: spec.lockRatio ? 'proportions locked: click to unlock' : 'lock the proportions',
      onclick: () => { this.editLive(inst, spec, { lockRatio: spec.lockRatio ? null : true }); this.renderInspector(); } }, spec.lockRatio ? '🔗' : '⛓︎');
    const textKey = textKeyOf(spec);
    const area = textKey ? h('textarea', { rows: 4, oninput: (e) => this.editLive(inst, spec, fromRaw(spec, e.target.value)) }, rawText(spec)) : null;
    if (spec.type === 'model') {                         // its camera (locked: a drag moves the shape) and its own lights
      const open = this.camUnlocked(spec.id);
      return h('div', { class: 'el-form' },
        h('div', { class: 'row' }, num('x', 'x'), num('y', 'y'), num('w', 'w'), num('h', 'h'), lock),
        h('div', { class: 'row' }, h('button', { class: `grow ${open ? 'on primary' : ''}`,
          title: open ? 'camera unlocked: drag in it turns it, scroll zooms (saved as this page\'s camera) · click to lock' : 'camera locked: a drag moves the shape · click to unlock and turn its camera',
          onclick: () => { this.camUnlockedId = open ? null : spec.id; this.renderInspector(); } }, open ? '🔓 camera unlocked · click to lock' : '🔒 camera locked · click to adjust')),
        h('p', { class: 'hint' }, open ? 'drag in it: turn its camera (this page) · scroll: zoom' : 'drag: move it'),
        this.lightsSection(inst));
    }
    if (spec.type === 'shape') return h('div', { class: 'el-form' },
      h('div', { class: 'row' }, num('x', 'x'), num('y', 'y'), num('w', 'w'), num('h', 'h'), lock),
      this.shapeRows(inst, spec));
    return h('div', { class: 'el-form' },
      h('div', { class: 'row' }, num('x', 'x'), num('y', 'y'), num('w', 'w'), lock),
      spec.type === 'image' ? h('div', { class: 'row' }, h('button', { class: 'grow', title: 'another picture in this place: same position, width and frame; the height follows the new picture',
        onclick: () => this.replaceImage(inst, spec) }, 'replace image…')) : null,
      textKey && textKey !== 'tex' ? this.textLook(inst, spec, () => area) : null,
      textKey ? h('label', { class: 'block' }, textKey === 'items' ? 'items (one per line)' : textKey, area) : null);
  }

  // text look: B / I (the selected words in the box below, or the whole element), font, size
  textLook(inst, spec, areaOf) {
    const el = inst.elements.get(spec.id)?.el, cs = el ? getComputedStyle(el) : null;
    const ta = areaOf();
    // B / I act on the words selected in the text box: **…** / *…*; lit while the selection is bold / italic
    // (clicking then takes the marks off); greyed when nothing is selected
    const marked = (mark) => {
      if (!ta || ta.selectionEnd <= ta.selectionStart) return null;
      const v = ta.value, a = ta.selectionStart, z = ta.selectionEnd, m = mark.length;
      const single = (i) => mark !== '*' || (v[i - 1] !== '*' && v[i + 1] !== '*');   // a lone * (not part of **)
      if (v.slice(a - m, a) === mark && v.slice(z, z + m) === mark && single(a - 1) && single(z)) return [a - m, a, z, z + m];
      if (v.slice(a, a + m) === mark && v.slice(z - m, z) === mark && z - a > 2 * m && single(a) && single(z - 1)) return [a, a + m, z - m, z];
      return false;
    };
    const toggle = (mark) => {
      const st = marked(mark);
      if (st === null) return;
      const v = ta.value, a = ta.selectionStart, z = ta.selectionEnd;
      if (st) { const [o0, i0, i1, o1] = st; ta.value = v.slice(0, o0) + v.slice(i0, i1) + v.slice(o1); ta.setSelectionRange(o0, o0 + (i1 - i0)); }
      else { ta.value = v.slice(0, a) + mark + v.slice(a, z) + mark + v.slice(z); ta.setSelectionRange(a + mark.length, z + mark.length); }
      this.editLive(inst, spec, fromRaw(spec, ta.value));
      ta.focus(); update();
    };
    const B = h('button', { class: 'look-b', title: 'bold: select words in the text below', onmousedown: (e) => e.preventDefault(), onclick: () => toggle('**') }, 'B');
    const I = h('button', { class: 'look-i', title: 'italic: select words in the text below', onmousedown: (e) => e.preventDefault(), onclick: () => toggle('*') }, 'I');
    const update = () => {
      for (const [btn, mark] of [[B, '**'], [I, '*']]) { const st = marked(mark); btn.disabled = st === null; btn.classList.toggle('on', !!st); }
    };
    if (ta) for (const ev of ['select', 'keyup', 'mouseup', 'input', 'focus', 'blur']) ta.addEventListener(ev, () => setTimeout(update, 0));
    update();
    // the font by name (what the element shows now when it has none of its own)
    const shown = (cs?.fontFamily || '').split(',')[0].replace(/['"]/g, '').trim();
    const names = Object.keys(FONTS);
    const current = spec.font || names.find((f) => FONTS[f].includes(shown)) || names.find((f) => f === shown) || 'Helvetica';
    const font = h('select', { title: 'font' }, ...names.map((f) => h('option', { value: f, style: `font-family:${FONTS[f]}` }, f)));
    font.value = current;
    font.addEventListener('change', () => this.editLive(inst, spec, { font: font.value }));
    const size = h('input', { type: 'number', min: 8, max: 200, step: 1, title: 'font size (px)', class: 'font-size',
      value: spec.fontSize ?? (cs ? Math.round(parseFloat(cs.fontSize)) : ''),
      oninput: (e) => this.editLive(inst, spec, { fontSize: e.target.value === '' ? null : +e.target.value }) });
    // colour of the letters, and a box behind them (a label, as the scene's 3D labels)
    const ink = this.colorPicker(spec.color || '#1f2329', (c) => this.editLive(inst, spec, { color: c }));
    const bg = this.colorPicker(spec.bg || 'none', (c) => this.editLive(inst, spec, { bg: c === 'none' ? null : c }), BOXES);
    return h('div', {}, h('div', { class: 'row text-look' }, B, I, font, size),
      h('div', { class: 'look-line' }, h('span', { class: 'look-name' }, 'color'), ink),
      h('div', { class: 'look-line' }, h('span', { class: 'look-name' }, 'box'), bg));
  }

  // a symbol's look: line colour, line width, turn
  shapeRows(inst, spec) {
    const set = (props) => this.editLive(inst, spec, props);
    const color = this.colorPicker(spec.color || '#333b46', (c) => set({ color: c }));
    const n = (key, label, step, dflt) => h('label', {}, label, h('input', { type: 'number', step, value: spec[key] ?? dflt,
      oninput: (e) => set({ [key]: e.target.value === '' ? null : +e.target.value }) }));
    return h('div', {}, color, h('div', { class: 'row' }, n('strokeWidth', 'line width', 1, 4), n('rotate', 'turn', 5, 0)));
  }

  // a row of big swatches; the last one opens the full colour picker (more colours)
  colorPicker(value, onPick, swatches = SWATCHES) {
    const more = h('input', { type: 'color', value: value === 'none' ? '#ffffff' : value, class: 'swatch-more-input', oninput: (e) => { onPick(e.target.value); mark(e.target.value); } });
    const btns = swatches.map((c) => {
      const b = h('button', { class: `swatch ${c === 'none' ? 'swatch-none' : ''}`, title: c === 'none' ? 'no box' : c, onclick: () => { onPick(c); mark(c); } });
      if (c !== 'none') b.style.background = c; b.dataset.c = c; return b;
    });
    const moreBtn = h('label', { class: 'swatch swatch-more', title: 'more colours' }, '⋯', more);
    const mark = (v) => {
      const known = btns.some((b) => b.dataset.c === v.toLowerCase());
      btns.forEach((b) => b.classList.toggle('on', b.dataset.c === v.toLowerCase()));
      moreBtn.classList.toggle('on', !known); if (!known) moreBtn.style.background = v; else moreBtn.style.background = '';
    };
    mark(value);
    return h('div', { class: 'swatches' }, ...btns, moreBtn);
  }

  // 3D slides: what the element is pinned to. An anchored element follows that
  // 3D point (x / y are pixel offsets from where it shows on screen, so they only
  // look right in one view: keep them small and pick the right anchor instead)
  anchorRow(inst, spec) {
    if (!inst.is3D) return null;
    const names = Object.keys(inst.sceneApi?.anchors || {});
    if (!names.length && !spec.anchor) return null;
    const sel = h('select', {},
      h('option', { value: '' }, '— fixed on the slide'),
      ...names.map((n) => h('option', { value: n }, `⚓ ${n}`)));
    sel.value = typeof spec.anchor === 'string' ? spec.anchor : '';
    sel.addEventListener('change', () => this.setAnchor(inst, spec, sel.value || null));
    return h('div', {},
      h('div', { class: 'row' }, h('label', {}, 'pinned to', sel)),
      spec.anchor ? h('p', { class: 'hint' }, `follows “${spec.anchor}” in 3D · x / y = pixel offset from it (keep small: it is right in one view only)`) : null);
  }

  setAnchor(inst, spec, anchor) {
    let props;
    if (anchor) props = { anchor, x: 0, y: 0 };                      // on the new point
    else {                                                            // stays where it is now, fixed on the slide
      const el = inst.elements.get(spec.id)?.el;
      props = { anchor: null, x: Math.round(parseFloat(el?.style.left) || 0), y: Math.round(parseFloat(el?.style.top) || 0) };
    }
    this.editLive(inst, spec, props);
    this.renderInspector();
  }

  // pages the element is on: from .. to (to = the last page: to the end)
  pagesRow(inst, spec) {
    const pages = pagesOf(inst, spec.id), last = inst.steps.length;
    const from = h('input', { type: 'number', min: 1, max: last + 1, step: 1, value: (pages[0] ?? 0) + 1 });       // shown from 1
    const to = h('input', { type: 'number', min: 1, max: last + 1, step: 1, value: (pages.at(-1) ?? 0) + 1 });
    const apply = () => {
      const a = Math.max(0, Math.min(last, Math.round(+from.value || 1) - 1));
      const b = Math.max(a, Math.min(last, Math.round(+to.value || 1) - 1));
      this.setPages(inst, spec, [a, b >= last ? null : b]);
    };
    from.addEventListener('change', apply); to.addEventListener('change', apply);
    return h('div', { class: 'row' }, h('label', {}, 'pages', from), h('label', {}, 'to', to),
      h('span', { class: 'hint' }, `of 1–${last + 1}`));
  }

  // the page label in the element list turns into  [from]–[to]
  editPagesInline(label, inst, spec) {
    const pages = pagesOf(inst, spec.id), last = inst.steps.length;
    const box = (v) => h('input', { type: 'number', min: 1, max: last + 1, step: 1, value: v + 1, class: 'pg' });    // shown from 1
    const from = box(pages[0] ?? inst.stepIndex), to = box(pages.at(-1) ?? inst.stepIndex);
    const wrap = h('span', { class: 'el-pages editing' }, from, '–', to);
    let done = false;
    const commit = () => {
      if (done) return; done = true;
      const a = Math.max(0, Math.min(last, Math.round(+from.value || 1) - 1));
      const b = Math.max(a, Math.min(last, Math.round(+to.value || 1) - 1));
      if (a === pages[0] && b === pages.at(-1)) { this.renderInspector(); return; }
      this.setPages(inst, spec, [a, b >= last ? null : b]);
    };
    for (const inp of [from, to]) {
      inp.addEventListener('click', (e) => e.stopPropagation());
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { done = true; this.renderInspector(); } });
    }
    wrap.addEventListener('focusout', () => setTimeout(() => { if (!wrap.contains(document.activeElement)) commit(); }, 0));
    label.replaceWith(wrap);
    from.focus(); from.select();
  }

  setPages(inst, spec, on) {
    // keep the entrance it had (fly_up, wipe, ...) when its pages replace its show / hide actions
    const shown = [inst.enter.actions, ...inst.steps.map((st) => st.actions)].flat().find((x) => x.show === spec.id && x.anim);
    const props = { on, ...(shown && !spec.anim ? { anim: shown.anim } : {}), ...(shown && shown.delay != null && spec.delay == null ? { delay: shown.delay } : {}) };
    Object.assign(spec, props);
    stripActions(inst.def, spec.id);
    this.record((o) => { (o.elements ||= {})[spec.id] = { ...(o.elements?.[spec.id] || {}), ...props }; }, inst);
    this.player.reload();
    this.save();
  }

  // a new element on the current page
  // + New symbol: a button like + New text; it opens a row of the shapes (elements.js SHAPES) to pick from
  symbolPicker(inst) {
    if (!this.symbolOpen) return null;
    return h('div', { class: 'symbol-row' }, ...SHAPES.map((k) => {
      const line = ['line', 'arrow', 'dashed'].includes(k);
      const b = h('button', { class: 'symbol-pick', title: k, onclick: () => { this.symbolOpen = false; this.addElement(inst, 'shape', k); } });
      b.innerHTML = shapeSVG({ shape: k, w: line ? 30 : 22, h: line ? 12 : 22, strokeWidth: 2 });
      return b;
    }));
  }

  addElement(inst, type, shape = null) {
    const def = inst.def, page = inst.stepIndex;
    const ids = new Set((def.elements || []).map((e) => e.id));
    const base = shape || type;
    let n = 1; while (ids.has(`${base}_${n}`)) n++;
    const id = `${base}_${n}`;
    const line = ['line', 'arrow', 'dashed'].includes(shape);
    const spec = type === 'shape'
      ? { id, type: 'shape', shape, x: 860, y: line ? 525 : 440, w: line ? 300 : 200, h: line ? 30 : 200, color: '#333b46', strokeWidth: 4, on: [page, page] }
      : { id, type: 'text', text: t('New text'), className: 'caption-strong', x: 160, y: 420, w: 600, on: [page, page] };
    this.insertElement(inst, spec);
    this.flash(type === 'shape' ? `added “${id}” on page ${page + 1}` : `added “${id}” on page ${page + 1} · double-click it to edit`);
  }

  insertElement(inst, spec) {
    (inst.def.elements ||= []).push(spec);
    this.record((o) => { (o.elements ||= {})[spec.id] = { added: true, ...spec }; }, inst);
    this.selectedEl = spec.id;
    this.player.reload();
    this.save();
  }

  // what a copy carries: the element, the pages it is on and how it enters
  copyOf(inst, spec) {
    const show = [inst.enter.actions, ...inst.steps.map((st) => st.actions)].flat().find((x) => x.show === spec.id);
    const el = inst.elements.get(spec.id)?.el;
    return {
      spec: JSON.parse(JSON.stringify(spec)), slide: inst.index, pages: pagesOf(inst, spec.id),
      entrance: show ? { anim: show.anim, delay: show.delay } : {},
      screen: el ? { x: Math.round(parseFloat(el.style.left) || 0), y: Math.round(parseFloat(el.style.top) || 0) } : null,
      view: el?._modelView?.poseData?.() || null,        // a 3D view: the camera it shows now
    };
  }

  // Paste a copy (⌘/Ctrl+C, then ⌘/Ctrl+V): onto the slide and the page shown,
  // from that page on for as many pages as the original spans; same layout
  // (2D or 3D alike); an element pinned to a 3D point goes to a 2D slide fixed
  // where it was on screen; over its original (same slide, same page) a little offset.
  // one copy or several (a copied selection): all onto this slide and page, groups kept as new groups
  pasteElement(inst, clip) {
    const clips = Array.isArray(clip) ? clip : [clip];
    const t = inst.index, def = this.deck.slides[t], regroup = new Map();
    const used = new Set((def.elements || []).map((e) => e.group).filter(Boolean));
    const ids = clips.map((c) => {
      let g = c.spec.group;
      if (g) {
        if (!regroup.has(g)) { let n = 1; while (used.has(`g${n}`)) n++; used.add(`g${n}`); regroup.set(g, `g${n}`); }
        g = regroup.get(g);
      }
      return this.pasteInto(t, c, inst, { quiet: true, group: g ?? null });
    }).filter(Boolean);
    if (!ids.length) return;
    this.save();
    this._sel = ids.at(-1); this.selection = new Set(ids);
    this.player.reload();
    this.flash(`pasted ${ids.length > 1 ? `${ids.length} elements` : `“${ids[0]}”`} on scene ${t + 1}, page ${inst.stepIndex + 1}`);
  }

  pasteInto(t, clip, inst = null, { quiet = false, group } = {}) {
    const def = this.deck.slides[t];
    if (!def) return;
    const { spec: src, pages, entrance } = clip;
    const { id: srcId, on, deleted, added, ...rest } = JSON.parse(JSON.stringify(src));   // eslint-disable-line no-unused-vars
    const base = String(srcId).replace(/_\d+$/, '');
    const ids = new Set((def.elements || []).map((e) => e.id));
    let n = 2; while (ids.has(`${base}_${n}`)) n++;
    const id = ids.has(srcId) ? `${base}_${n}` : srcId;
    const last = inst ? inst.steps.length : normalizeSteps(def.steps).length;
    const span = pages.length ? pages.at(-1) - pages[0] : 0;
    const same = clip.slide === t;
    const page = inst && inst.index === t ? inst.stepIndex : 0;
    const from = page, to = Math.min(last, page + span);
    const spec = { id, ...rest, on: [from, to >= last ? null : to] };
    // a 3D view keeps the view it had: its camera now, as the camera of the page it lands on
    if (clip.view) { spec.cameras = { [from]: clip.view }; delete spec.camera; }
    if (group !== undefined) { if (group) spec.group = group; else delete spec.group; }
    if (entrance.anim && !spec.anim) spec.anim = entrance.anim;
    if (entrance.delay != null && spec.delay == null) spec.delay = entrance.delay;
    if (spec.anchor && def.type !== '3d') { delete spec.anchor; Object.assign(spec, clip.screen || { x: 200, y: 200 }); }
    if (same && pages.includes(page) && !spec.anchor) { spec.x = (spec.x ?? 0) + 30; spec.y = (spec.y ?? 0) + 30; }
    (def.elements ||= []).push(spec);
    this.recordSlide(def, t, (o) => { (o.elements ||= {})[id] = { added: true, ...spec }; });
    if (quiet) return id;
    this.save();
    if (inst && inst.index === t) { this.selectedEl = id; this.player.reload(); }       // stays on this page
    else { this.selectAfterJump = id; this.player.jump(t, 0, false); }
    this.flash(`pasted “${id}” on slide ${t + 1}, pages ${from}–${to >= last ? 'end' : to}`);
  }

  // elements deleted through overrides (made by a helper in deck.js) can come back
  deletedRow(inst) {
    const o = this.ov.slides?.[inst.def.id || String(inst.index)]?.elements || {};
    const gone = Object.keys(o).filter((id) => o[id].deleted);
    if (!gone.length) return null;
    return h('div', { class: 'row wrap' }, h('span', { class: 'hint' }, 'deleted:'),
      ...gone.map((id) => h('button', { title: 'restore it', onclick: () => this.restoreElement(inst, id) }, `↺ ${id}`)));
  }

  async restoreElement(inst, id) {
    this.record((o) => { (o.elements ||= {})[id] = { ...(o.elements?.[id] || {}), deleted: false }; }, inst);
    clearTimeout(this.saveTimer); this.saveTimer = null;
    await this.flush();
    const { deck, overrides } = await loadDeck(this.deckUrl, this.baseUrl, String(Date.now()));
    this.deck = deck; this.ov = overrides; mergeOverrides(this.ov, this.pending);
    swapDeck(this.player, deck);
    this.renderList();
    this.flash(`restored “${id}”`);
  }

  // pick an element; one that is not on this page takes the slide to its first page
  selectElement(id) {
    this.selectedEl = id;
    const inst = this.player.current;
    const pages = inst ? pagesOf(inst, id) : [];
    if (pages.length && !pages.includes(inst.stepIndex)) this.player.jump(inst.index, pages[0], false);
    else this.renderInspector();
  }

  highlightSelected() {
    const inst = this.player.current;
    if (!inst) return;
    for (const { el, spec } of inst.elements.values()) el.classList.toggle('ed-selected', !!this.selection?.has(spec.id));
    this.placeHandle();
    this.revealRow();
  }

  // the selected element's row in the list: lit, and scrolled to the middle of the panel (a folded group opens).
  // Asked for by a click on the slide (this.wantReveal); done after the panel is laid out, at once (a smooth scroll
  // would be cut short when the panel is drawn again).
  revealRow() {
    if (!this.wantReveal) return;
    const id = this.selectedEl || (this.selectedModel ? `model:${this.selectedModel}` : null);
    if (!id) { this.wantReveal = false; return; }
    requestAnimationFrame(() => {
      const rowEl = this.inspector.querySelector(`.el-item[data-el="${CSS.escape(id)}"]`);
      if (!rowEl) return;
      const fold = rowEl.closest('details'); if (fold && !fold.open) fold.open = true;
      const box = this.inspector, r = rowEl.getBoundingClientRect(), b = box.getBoundingClientRect();
      this.wantReveal = false;
      if (r.top >= b.top && r.bottom <= b.bottom) return;                   // in view already
      box.scrollTop += (r.top - b.top) - (b.height - r.height) / 2;
    });
  }


  // Handles on the element shown in the form: four corners resize it (the opposite corner stays; a symbol or
  // an element with a set height: width and height; text: its width, it wraps; an image keeps its shape),
  // the round one above it turns it (`rotate`, degrees; snaps to every 15°, shift: in 15° steps).
  placeHandle() {
    const inst = this.player.current, entry = this.selectedEl && inst?.elements.get(this.selectedEl);
    const hide = () => this.handles?.forEach((x) => x.remove());
    if (!entry || !entry.el.isConnected || entry.el.isContentEditable || entry.spec.anchor) { hide(); return; }
    const parent = entry.el.parentElement, { el, spec } = entry;
    if (!this.handles) {
      this.handles = [...CORNERS, 'turn'].map((k) => {
        const d = h('div', { class: k === 'turn' ? 'ed-rotate' : 'ed-resize', title: k === 'turn' ? 'drag to turn' : 'drag to resize' });
        d.addEventListener('pointerdown', (e) => (k === 'turn' ? this.startTurn(e, d) : this.startResize(e, d, k)));
        if (k !== 'turn') d.style.cursor = !k[0] ? 'ns-resize' : !k[1] ? 'ew-resize' : k[0] * k[1] > 0 ? 'nwse-resize' : 'nesw-resize';
        if (k !== 'turn' && (!k[0] || !k[1])) d.classList.add('edge');
        return d;
      });
    }
    const r = el.getBoundingClientRect(), pr = parent.getBoundingClientRect(), s = this.player.scale || 1;
    const cx = (r.left + r.width / 2 - pr.left) / s, cy = (r.top + r.height / 2 - pr.top) / s;
    const w = el.offsetWidth, hh = el.offsetHeight, th = THREE_DEG * (spec.rotate || 0), c = Math.cos(th), sn = Math.sin(th);
    const at = (u, v) => [cx + c * u - sn * v, cy + sn * u + c * v];
    const vis = el.style.visibility === 'hidden' ? 'none' : '';
    const withH = spec.type === 'shape' || spec.type === 'model' || spec.h != null;
    this.handles.forEach((d, i) => {
      if (d.parentElement !== parent) parent.appendChild(d);
      const k = CORNERS[i], last = i === this.handles.length - 1;
      const [x, y] = last ? at(0, -hh / 2 - 40) : at(k[0] * w / 2, k[1] * hh / 2);
      // top / bottom middles only where the height is the element's own (text and images size themselves)
      const off = !last && !k[0] && !withH;
      Object.assign(d.style, { left: `${x - 10}px`, top: `${y - 10}px`, display: off ? 'none' : vis });
    });
  }

  startResize(e, handle, [sx, sy]) {
    const inst = this.player.current, entry = inst?.elements.get(this.selectedEl);
    if (!entry) return;
    e.preventDefault(); e.stopPropagation();
    const { spec, el } = entry, s = this.player.scale || 1;
    const w0 = el.offsetWidth, h0 = el.offsetHeight, X0 = spec.x ?? 0, Y0 = spec.y ?? 0, px = e.clientX, py = e.clientY;
    const fs0 = spec.fontSize ?? parseFloat(getComputedStyle(el).fontSize) ?? 32;
    const withH = spec.type === 'shape' || spec.type === 'model' || spec.h != null, image = !withH && (spec.type === 'image' || spec.type === 'video');
    const th = THREE_DEG * (spec.rotate || 0), c = Math.cos(th), sn = Math.sin(th);
    const cx0 = X0 + w0 / 2, cy0 = Y0 + h0 / 2;
    handle.setPointerCapture(e.pointerId);
    let props = null;
    const move = (ev) => {
      const dx = (ev.clientX - px) / s, dy = (ev.clientY - py) / s;
      const lu = c * dx + sn * dy, lv = -sn * dx + c * dy;                    // the pull in the element's own frame
      let w, hgt, extra = {};
      if (sx && sy) {
        // a corner: scaled as a whole, along the diagonal (the shape is kept; text grows with its box)
        const L0 = Math.hypot(w0, h0), k = Math.max(0.05, 1 + (sx * lu * w0 + sy * lv * h0) / (L0 * L0));
        w = Math.max(8, Math.round(w0 * k)); hgt = h0 * k;
        if (!withH && !image) extra = { fontSize: Math.max(6, Math.round(fs0 * k)) };
      } else {
        // an edge middle: that side only (a stretch); with the proportion lock the other side follows
        w = sx ? Math.max(8, Math.round(w0 + sx * lu)) : w0;
        hgt = withH ? (sy ? Math.max(4, Math.round(h0 + sy * lv)) : h0) : image ? h0 * w / w0 : h0;
        if (spec.lockRatio && withH) {
          if (sx) hgt = h0 * w / w0;
          else { w = Math.max(8, Math.round(w0 * hgt / h0)); }
        } else if (spec.lockRatio && !withH && !image && sx) extra = { fontSize: Math.max(6, Math.round(fs0 * w / w0)) };
      }
      const dw = w - w0, dh = hgt - h0;
      // the opposite corner stays: the centre moves half the growth, along the element's axes
      const ccx = cx0 + c * (sx * dw / 2) - sn * (sy * dh / 2), ccy = cy0 + sn * (sx * dw / 2) + c * (sy * dh / 2);
      props = { w, x: Math.round(ccx - w / 2), y: Math.round(ccy - hgt / 2), ...(withH ? { h: Math.round(hgt) } : {}), ...extra };
      Object.assign(spec, props); inst.refreshElement(spec.id); this.placeHandle();
    };
    const up = () => {
      handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up);
      if (props) this.editLive(inst, spec, props);
    };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
  }

  startTurn(e, handle) {
    const inst = this.player.current, entry = inst?.elements.get(this.selectedEl);
    if (!entry) return;
    e.preventDefault(); e.stopPropagation();
    const { spec, el } = entry;
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const a0 = Math.atan2(e.clientY - cy, e.clientX - cx), r0 = spec.rotate || 0;
    handle.setPointerCapture(e.pointerId);
    let changed = false;
    const move = (ev) => {
      // the turn follows the pointer at half speed (fine control); it settles on 0 / 90 / 180 within 2°;
      // shift: 15° steps
      let da = Math.atan2(ev.clientY - cy, ev.clientX - cx) - a0;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      let deg = r0 + (da / THREE_DEG) * 0.5;
      deg = ((deg % 360) + 540) % 360 - 180;                                   // -180..180
      const square = Math.round(deg / 90) * 90;
      deg = ev.shiftKey ? Math.round(deg / 15) * 15 : Math.abs(deg - square) < 2 ? square : Math.round(deg);
      spec.rotate = deg || 0; changed = true;
      inst.refreshElement(spec.id); this.placeHandle();
    };
    const up = () => {
      handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up);
      if (changed) this.editLive(inst, spec, { rotate: spec.rotate || null });
    };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
  }

  // Every element edit is live: the spec changes, that one element is redrawn
  // in place (the slide is not rebuilt, so typing keeps its focus and the
  // animation state stays), and the change is queued for saving.
  editLive(inst, spec, props) {
    Object.assign(spec, props);
    this.record((o) => {
      o.elements ||= {};
      o.elements[spec.id] = { ...(o.elements[spec.id] || {}), ...props };
    }, inst);
    inst.refreshElement(spec.id);
    this.highlightSelected();
    if (!this.inspector.contains(document.activeElement)) this.renderInspector();
    if (spec.id === 'title') this.renderList();
    this.save();
  }
  setElementProps(inst, spec, props) { this.editLive(inst, spec, props); }

  // delete an element: from the slide, its show / hide actions too; saved like any edit
  deleteElement(inst, spec) {
    removeElement(inst.def, spec.id);
    this.record((o) => { (o.elements ||= {})[spec.id] = { deleted: true }; }, inst);
    if (this.selectedEl === spec.id) this.selectedEl = null;
    this.player.reload();
    this.renderList();
    this.save();
    this.flash(`deleted “${spec.id}”`);
  }

  deleteElements(inst, specs) {
    if (specs.length === 1) return this.deleteElement(inst, specs[0]);
    for (const spec of specs) {
      removeElement(inst.def, spec.id);
      this.record((o) => { (o.elements ||= {})[spec.id] = { deleted: true }; }, inst);
    }
    this.selectedEl = null;
    this.player.reload(); this.renderList(); this.save();
    this.flash(`deleted ${specs.length} elements`);
  }

  // apply a change to the local overrides and to the queue of unsaved edits
  record(fn, inst) {
    fn(slideOverride(this.ov, inst.def, inst.index));
    fn(slideOverride(this.pending, inst.def, inst.index));
  }

  // ------------------------------------------------------------ camera
  viewPose(pose) {
    const inst = this.player.current;
    if (!inst?.is3D || !pose) return;
    inst.rig.set(normalizePose(pose, this.player.currentPose()));
    inst.devControls?.update();
  }

  // ------------------------------------------------------------ pages
  // a page (one more click, an empty step) at the end
  addPage(inst) {
    const def = inst.def;
    def.steps = [...(def.steps || []), []];
    this.record((o) => { (o.pageOps ||= []).push({ add: true }); }, inst);
    this.save();
    this.player.jump(inst.index, def.steps.length, false);
    this.flash(`added page ${def.steps.length + 1}`);
  }

  // delete page k (its step, k >= 1): the elements only on it go too; later pages, their elements and cameras move up
  deletePage(inst, k) {
    const def = inst.def, n = inst.steps.length;
    if (!n) return this.clearScene(inst);           // its only page: the scene stays, blank
    const only = (def.elements || []).filter((e) => Array.isArray(e.on) && e.on[0] === k && e.on[1] === k);
    def.steps = [...(def.steps || [])];
    if (k === 0) {                                  // the first page: what its click did now happens as the scene enters
      const first = normalizeSteps(def.steps.slice(0, 1))[0]?.actions || [];
      def.enter = [...(normalizeSteps(def.enter ? [def.enter] : [])[0]?.actions || []), ...first];
      def.steps.splice(0, 1);
    } else def.steps.splice(k - 1, 1);
    this.record((o) => { (o.pageOps ||= []).push({ del: k }); }, inst);
    for (const spec of only) {
      removeElement(def, spec.id);
      this.record((o) => { (o.elements ||= {})[spec.id] = { deleted: true }; }, inst);
    }
    for (const spec of def.elements || []) {
      if (!Array.isArray(spec.on)) continue;
      let [a, b] = spec.on;
      const a2 = a > k ? a - 1 : a, b2 = b == null ? null : b >= k ? Math.max(0, b - 1) : b;
      if (a2 === a && b2 === b) continue;
      spec.on = [a2, b2 != null && b2 >= n - 1 ? null : b2];
      this.record((o) => { o.elements ||= {}; o.elements[spec.id] = { ...(o.elements[spec.id] || {}), on: spec.on }; }, inst);
    }
    for (const key of ['pageCameras', 'ambient']) {            // later pages' cameras / ambient levels move up
      if (!def[key] || !Object.keys(def[key]).some((p) => +p >= k)) continue;
      const old = def[key], next = {}, change = {};
      for (const [p, v] of Object.entries(old)) if (+p < k) next[p] = v; else if (+p > k) next[+p - 1] = v;
      for (const p of new Set([...Object.keys(old), ...Object.keys(next)])) change[p] = next[p] ?? null;
      def[key] = next;
      this.record((o) => { o[key] = { ...(o[key] || {}), ...change }; }, inst);
    }
    if (only.some((e) => this.selection?.has(e.id))) this.selectedEl = null;
    this.save();
    this.player.jump(inst.index, Math.max(0, k - 1), false);       // the page before it (the first: the new first page)
    this.renderList();
    this.flash(`deleted page ${k + 1}${only.length ? ` (and ${only.map((e) => e.id).join(', ')})` : ''} · ⌘Z undoes`);
  }

  // Pages renumbered: f(old page) -> the new page(s) it becomes. Elements, lights, page cameras and the
  // cameras of 3D views follow (a range [from, to] becomes the smallest one holding all its new pages).
  remapPages(inst, f, newLast) {
    const def = inst.def, last = inst.steps.length;
    const span = (on) => { const b = on[1] ?? last, out = []; for (let p = on[0]; p <= b; p++) out.push(p); return out; };
    const range = (pages) => { const a = Math.min(...pages), b = Math.max(...pages); return [a, b >= newLast ? null : b]; };
    const remapKeys = (obj) => {
      if (!obj) return null;
      const next = {};
      for (const [p, v] of Object.entries(obj)) for (const q of f(+p)) next[q] = v;
      return next;
    };
    for (const spec of def.elements || []) {
      const props = {};
      if (Array.isArray(spec.on)) { const on = range(span(spec.on).flatMap(f)); if (on[0] !== spec.on[0] || on[1] !== spec.on[1]) props.on = on; }
      if (spec.cameras) props.cameras = remapKeys(spec.cameras);
      if (spec.ambient) props.ambient = remapKeys(spec.ambient);
      if (spec.lights) props.lights = Object.fromEntries(Object.entries(spec.lights).map(([id, L]) => [id, { ...L, on: range(span(L.on || [0, null]).flatMap(f)) }]));
      if (Object.keys(props).length) {
        Object.assign(spec, props);
        this.record((o) => { o.elements ||= {}; o.elements[spec.id] = { ...(o.elements[spec.id] || {}), ...props }; }, inst);
      }
    }
    for (const [id, L] of Object.entries(def.lights || {})) {
      const on = range(span(L.on || [0, null]).flatMap(f));
      L.on = on; this.record((o) => { (o.lights ||= {})[id] = { ...((o.lights || {})[id] || {}), on }; }, inst);
    }
    for (const key of ['pageCameras', 'ambient']) {
      if (!def[key] || !Object.keys(def[key]).length) continue;
      const old = def[key], next = remapKeys(old), change = {};
      for (const p of new Set([...Object.keys(old), ...Object.keys(next)])) change[p] = next[p] ?? null;
      def[key] = next;
      this.record((o) => { o[key] = { ...(o[key] || {}), ...change }; }, inst);
    }
  }

  // a copy of page k right after it: a new empty step (nothing happens on the click), and everything on page k
  // (its elements, lights, cameras) stays on for the new page too
  duplicatePage(inst, k) {
    const def = inst.def, n = inst.steps.length;
    this.remapPages(inst, (p) => (p < k ? [p] : p === k ? [k, k + 1] : [p + 1]), n + 1);
    def.steps = [...(def.steps || [])]; def.steps.splice(k, 0, []);
    this.record((o) => { (o.pageOps ||= []).push({ ins: k }); }, inst);
    this.save(); this.player.jump(inst.index, k + 1, false); this.renderList();
    this.flash(`page ${k + 1} duplicated: page ${k + 2}`);
  }

  // A page without a camera move of its own shows the view the page before it ends on. Before the pages change
  // order, each such page gets that view as its own camera (def.pageCameras), so it looks the same wherever it goes.
  pinCameras(inst) {
    if (!inst?.is3D) return;
    const def = inst.def, acts = (x) => (Array.isArray(x) ? x : x?.actions ? x.actions : x ? [x] : []);
    const json = (c) => { const p = typeof c === 'string' ? inst.getPose(c) : normalizePose(c, inst.rigPoseArrays()); const r = (v) => Math.round(v * 1000) / 1000;
      return { position: p.position.toArray().map(r), target: p.target.toArray().map(r), fov: p.fov }; };
    let pose = def.pageCameras?.[0] || json(def.camera), added = {};
    (def.steps || []).forEach((st, i) => {
      const k = i + 1, own = def.pageCameras?.[k], move = acts(st).filter((x) => x && typeof x === 'object' && 'camera' in x).at(-1);
      if (own) pose = own; else if (move) pose = json(move.camera); else added[k] = pose;
    });
    if (!Object.keys(added).length) return;
    def.pageCameras = { ...(def.pageCameras || {}), ...added };
    this.record((o) => { o.pageCameras = { ...(o.pageCameras || {}), ...added }; }, inst);
  }

  // page `from` moved to where page `to` is (the others shift); page 1's actions are the scene's enter
  movePage(inst, from, to) {
    this.pinCameras(inst);                                          // every page keeps the view it has now
    const def = inst.def, n = inst.steps.length, order = [...Array(n + 1).keys()];
    order.splice(to, 0, ...order.splice(from, 1));                 // order[new page] = old page
    this.remapPages(inst, (p) => [order.indexOf(p)], n);
    const acts = (x) => (Array.isArray(x) ? x : x?.actions ? x.actions : x ? [x] : []);
    const lists = [acts(def.enter), ...(def.steps || []).map(acts)], next = order.map((p) => lists[p]);
    def.enter = next[0]; def.steps = next.slice(1);
    this.record((o) => { (o.pageOps ||= []).push({ perm: order }); }, inst);
    this.save(); this.player.jump(inst.index, to, false); this.renderList();
    this.flash(`page ${from + 1} moved to ${to + 1}`);
  }

  // the last page deleted: the scene stays, with nothing on it
  clearScene(inst) {
    const def = inst.def, gone = [...(def.elements || [])];
    for (const spec of gone) {
      removeElement(def, spec.id);
      this.record((o) => { (o.elements ||= {})[spec.id] = { deleted: true }; }, inst);
    }
    for (const id of Object.keys(def.models || {})) { delete def.models[id]; this.record((o) => { (o.models ||= {})[id] = null; }, inst); }
    this.selectedEl = null;
    this.save(); this.player.jump(inst.index, 0, false); this.renderList();
    this.flash('deleted the last page: the scene is blank · ⌘Z undoes');
  }

  // the view now: page k's camera (slide.js applyPageCameras), saved in overrides
  savePageCamera(inst) {
    const pose = this.player.currentPose();
    if (!inst?.is3D || !pose) return;
    const k = inst.stepIndex;
    (inst.def.pageCameras ||= {})[k] = pose;
    this.record((o) => { (o.pageCameras ||= {})[k] = pose; }, inst);
    this.save();
    this.player.reload();
    this.flash(`camera of page ${k + 1} saved`);
  }

  // dolly toward / away from the target (factor < 1: in)
  zoomCamera(inst, f) {
    if (!inst?.is3D) return;
    const cam = inst.camera, t = inst.rig.target;
    cam.position.sub(t).multiplyScalar(f).add(t);
    inst.rig.apply(); inst.devControls?.update(); inst.renderNow();
    if (this.poseOut) this.poseOut.textContent = JSON.stringify(this.player.currentPose());
  }

  savePose(name) {
    const inst = this.player.current;
    const pose = this.player.currentPose();
    if (!inst || !pose) return;
    if (name == null) { inst.def.camera = pose; this.record((o) => { o.camera = pose; }, inst); }
    else { (inst.def.poses ||= {})[name] = pose; this.record((o) => { (o.poses ||= {})[name] = pose; }, inst); }
    this.save();
    this.renderInspector();
    this.flash(name == null ? 'start camera saved' : `pose “${name}” saved`);
  }

  // ------------------------------------------------------------ drag 2D elements
  bindDrag() {
    let drag = null, wheelTimer = null, box = null;
    this.host.addEventListener('wheel', (e) => {
      const el = e.target.closest('.slide-overlay .el'), inst = this.player?.current;
      if (!el || !inst || inst.is3D || !el._modelView) return;
      const spec = [...inst.elements.values()].find((x) => x.el === el)?.spec;
      if (!spec || !this.camUnlocked(spec.id)) return;                       // locked: its camera stays
      e.preventDefault();
      el._modelView.dolly(Math.exp(e.deltaY * 0.0015));
      clearTimeout(wheelTimer); wheelTimer = setTimeout(() => spec && this.saveViewCamera(inst, spec, el._modelView), 300);
    }, { passive: false });
    this.host.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('.slide-overlay .el');
      const inst = this.player?.current, before = new Set(this.selection || []);
      if (e.target.closest('.ed-resize, .ed-rotate, .ed-delete')) return;     // a handle: its own drag
      if (!el && inst?.is3D && this.pickModel3D(e, inst)) return;            // a 3D shape in the scene: select it, drag it
      if (!el && !e.target.closest('.ed-resize, .ed-rotate') && (this.selectedEl || this.symbolOpen || this.selectedModel)) {
        // a click on blank space: nothing selected, the inspector back to the plain page view
        this.selectedEl = null; this.symbolOpen = false; this.selectedModel = null;
        document.activeElement?.blur?.();
        this.renderInspector(); this.showModelBox(inst);
      }
      if (el && !inst?.is3D && el._modelView && this.pickViewLight(e, inst, el)) return;   // a light mark in a 3D view
      const viewId = el && !inst?.is3D && el._modelView ? [...inst.elements.values()].find((x) => x.el === el)?.spec.id : null;
      if (viewId && this.camUnlocked(viewId) && this.orbitView(e, inst, el)) return;   // its camera unlocked: the drag turns it
      if (!el && inst && !inst.is3D && e.button === 0 && !e.target.closest('.ed-agent, button, input, textarea, select')) {
        // blank space in a 2D scene: a selection box (shift / ⌘: added to what is selected)
        const keep = e.shiftKey || e.metaKey || e.ctrlKey ? before : new Set();
        const div = h('div', { class: 'ed-marquee' });
        document.body.append(div);
        box = { inst, x0: e.clientX, y0: e.clientY, keep, div, moved: false };
        this.host.setPointerCapture(e.pointerId);
        return;
      }
      if (!el || !inst || el.isContentEditable) return;                              // (locked: the drag moves it, as any element)
      const entry = [...inst.elements.values()].find((x) => x.el === el);
      if (!entry) return;
      e.preventDefault(); e.stopPropagation();
      const id = entry.spec.id;
      this.wantReveal = true;                                                 // a click on the slide: show its row
      if (e.shiftKey || e.metaKey || e.ctrlKey) this.toggleSelect(id);         // add to / take out of the selection
      else if (!this.selection?.has(id)) this.selectedEl = id;                  // a new selection (with its group)
      else this._sel = id;                                                       // keep the selection, show this one
      this.renderInspector();
      if (!this.selection.has(id)) return;
      // every selected element on this slide moves by the same amount
      const items = [...inst.elements.values()].filter((x) => this.selection.has(x.spec.id))
        .map((x) => ({ entry: x, sx: x.spec.x || 0, sy: x.spec.y || 0 }));
      drag = { items, inst, x0: e.clientX, y0: e.clientY, moved: false };
      el.setPointerCapture(e.pointerId);
    }, true);
    this.host.addEventListener('pointermove', (e) => {
      if (box) {
        const l = Math.min(box.x0, e.clientX), r = Math.max(box.x0, e.clientX), t = Math.min(box.y0, e.clientY), b = Math.max(box.y0, e.clientY);
        if (!box.moved && r - l + b - t < 4) return;
        box.moved = true;
        Object.assign(box.div.style, { left: `${l}px`, top: `${t}px`, width: `${r - l}px`, height: `${b - t}px`, display: 'block' });
        const hit = new Set(box.keep);
        for (const { el, spec } of box.inst.elements.values()) {
          if (!pagesOf(box.inst, spec.id).includes(box.inst.stepIndex)) continue;     // only what is on the page shown
          const q = el.getBoundingClientRect();
          if (q.width + q.height > 0 && q.right > l && q.left < r && q.bottom > t && q.top < b) this.withGroup([spec.id]).forEach((id) => hit.add(id));
        }
        this.selection = hit; this._sel = [...hit].at(-1) ?? null;
        this.highlightSelected();
        return;
      }
      if (!drag) return;
      const s = this.player.scale;
      let dx = (e.clientX - drag.x0) / s, dy = (e.clientY - drag.y0) / s;
      if (!drag.moved && Math.hypot(dx, dy) < 2) return;
      if (!drag.moved) drag.snap = this.snapTargets(drag.inst, drag.items);
      drag.moved = true;
      if (!e.altKey) [dx, dy] = this.snap(drag, dx, dy);                       // alt: no snapping
      for (const { entry, sx, sy } of drag.items) {
        const x = Math.round(sx + dx), y = Math.round(sy + dy);
        Object.assign(entry.spec, { x, y });
        if (!entry.spec.anchor) { entry.el.style.left = `${x}px`; entry.el.style.top = `${y}px`; }
      }
      this.placeHandle();
    });
    const end = () => {
      if (box) {
        box.div.remove();
        const moved = box.moved; box = null;
        if (moved) { this.renderInspector(); if (this.selection.size > 1) this.flash(`${this.selection.size} selected · drag one to move them all`); }
        return;
      }
      if (!drag) return;
      this.guides?.forEach((g) => g.remove()); this.guides = null;
      if (drag.moved) this.editMany(drag.inst, drag.items.map(({ entry }) => [entry.spec, { x: entry.spec.x, y: entry.spec.y }]));
      drag = null;
    };
    this.host.addEventListener('pointerup', end);
    this.host.addEventListener('pointercancel', end);
  }

  // ------------------------------------------------------------ 3D shapes in a 3D scene
  // A click on one selects it (a box shows it); dragging moves it over the floor (its height stays);
  // shift-drag: up / down. The camera does not turn meanwhile.
  pickModel3D(e, inst) {
    if (e.button !== 0) return false;
    if (this.pickLight(e, inst)) return true;
    if (!inst.models?.size) return false;
    const canvas = inst.renderer.domElement, r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, inst.camera);
    let best = null;
    for (const [id, holder] of inst.models) {
      // the surface, or its box (a ring is picked through its hole too)
      let hit = ray.intersectObject(holder, true)[0];
      if (!hit) {
        const pt = ray.ray.intersectBox(new THREE.Box3().setFromObject(holder), new THREE.Vector3());
        if (pt) hit = { point: pt, distance: pt.distanceTo(ray.ray.origin) + 1e-3 };
      }
      if (hit && (!best || hit.distance < best.hit.distance)) best = { id, holder, hit };
    }
    if (!best) return false;
    e.preventDefault(); e.stopPropagation();
    this.selectedEl = null; this.selectedModel = best.id; this.wantReveal = true; this.renderInspector(); this.showModelBox(inst);
    const ctl = inst.devControls; if (ctl) ctl.enabled = false;
    const p0 = best.holder.position.clone(), h0 = best.hit.point.clone();
    const vertical = e.shiftKey;
    const n = vertical ? inst.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize().negate() : new THREE.Vector3(0, 1, 0);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, h0);
    let moved = false;
    const move = (ev) => {
      const q = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(q, inst.camera);
      const at = ray.ray.intersectPlane(plane, new THREE.Vector3());
      if (!at) return;
      const d = at.sub(h0); if (vertical) d.set(0, d.y, 0);
      best.holder.position.copy(p0).add(d); best.holder.updateMatrixWorld(true);
      this.modelHandles?.place(); inst.renderNow(); moved = true;
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (ctl) ctl.enabled = true;
      if (moved) {
        const rr = (v) => Math.round(v * 1000) / 1000;
        this.editModel(inst, best.id, { position: best.holder.position.toArray().map(rr) });
        this.renderInspector();
      }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    return true;
  }

  // ------------------------------------------------------------ lights (engine/lights.js)
  // Whose lights: a 3D scene's own (def.lights / def.ambient); on a 2D scene there are none of the scene's: each
  // 3D shape has its own (its element's lights / ambient), edited in its form when it is selected.
  // A light belongs to pages (`on`, as elements): added on the page shown, for that page; the list shows this
  // page's lights first (p1–p3 label: click to change its pages, as for elements).
  lightHost(inst, specOrId = this.selectedEl) {
    if (inst.is3D) return { owner: inst.def };
    const spec = typeof specOrId === 'string' ? inst.elements.get(specOrId)?.spec : specOrId;
    return spec?.type === 'model' ? { owner: spec, spec } : null;
  }
  // the 3D view's camera can be turned (the editor's lock button; only while it is the selected element)
  camUnlocked(id) { return !!id && this.camUnlockedId === id && this.selectedEl === id; }
  // a light / ambient change of `host` into the overrides: a 3D scene's per light (null: deleted); a shape's
  // as its element props (its whole lights / ambient)
  recordLights(inst, host, id, props) {
    if (host.spec) {
      const p = { lights: JSON.parse(JSON.stringify(host.spec.lights || {})) };
      if (host.spec.ambient) p.ambient = { ...host.spec.ambient };
      this.record((o) => { o.elements ||= {}; o.elements[host.spec.id] = { ...(o.elements[host.spec.id] || {}), ...p }; }, inst);
    } else if (id === 'ambient') this.record((o) => { o.ambient = { ...(o.ambient || {}), ...props }; }, inst);
    else this.record((o) => { (o.lights ||= {})[id] = props === null ? null : { ...((o.lights || {})[id] || {}), ...props }; }, inst);
  }
  lightsSection(inst) {
    const host = this.lightHost(inst);
    if (!host) return null;
    const lights = host.owner.lights || {}, page = inst.stepIndex, last = inst.steps.length;
    const add = (type, label) => h('button', { onclick: () => this.addLight(inst, type) }, label);
    const pagesL = (L) => { const on = L.on || [0, null], b = on[1] ?? last; return [...Array(b - on[0] + 1)].map((_, i) => on[0] + i); };
    const row = (id) => h('div', { class: `el-item ${this.selectedLight === id ? 'on' : ''}`,
      onclick: () => { this.selectedLight = this.selectedLight === id ? null : id; this.renderInspector(); } },
      h('span', { class: 'grow' }, h('b', {}, id), ` ${lights[id].type}`),
      h('span', { class: 'el-pages', title: 'pages it is on · click to change',
        onclick: (e) => { e.stopPropagation(); this.editLightPages(e.currentTarget, inst, id); } }, pageLabel(pagesL(lights[id]), last)),
      eyeBtn(lights[id].hidden, h('button', { class: `el-eye ${lights[id].hidden ? 'off' : ''}`, title: lights[id].hidden ? 'hidden (off): click to show' : 'click to hide (turn off)',
        onclick: (e) => { e.stopPropagation(); this.editLight(inst, id, { hidden: lights[id].hidden ? null : true }); this.renderInspector(); } }, '')),
      h('button', { class: 'el-del', title: 'delete this light', onclick: (e) => { e.stopPropagation(); this.deleteLight(inst, id); } }, '✕'));
    const ids = Object.keys(lights), here = ids.filter((id) => lightOn(lights[id], page)), other = ids.filter((id) => !lightOn(lights[id], page));
    const L = lights[this.selectedLight];
    let form = null;
    if (L) {
      const set = (props) => this.editLight(inst, this.selectedLight, props);
      const amb = L.type === 'ambient';
      // strength: 0..40 on a square-law slider (fine when weak); ambient level: 0 dark .. 0.5 as is .. 1 white
      const MAX = 40, toU = (v) => (amb ? v : Math.sqrt(v / MAX)), fromU = (u) => (amb ? u : MAX * u * u);
      const cur = L.intensity ?? (amb ? 0.5 : 1.5);
      const slider = h('input', { type: 'range', min: 0, max: 1, step: 0.005, value: toU(cur), class: 'grow',
        oninput: (e) => { const v = +fromU(+e.target.value).toFixed(3); set({ intensity: v }); val.textContent = v.toFixed(2); } });
      const val = h('span', { class: 'light-val' }, cur.toFixed(2));
      const pos = (k, label) => h('label', {}, label, h('input', { type: 'number', step: 0.05, value: L.position?.[k] ?? 0,
        oninput: (e) => { const p = [...(L.position || [0, 0, 0])]; p[k] = +e.target.value || 0; set({ position: p }); } }));
      const aims = L.type === 'spot' || L.type === 'directional';
      // the cone: half its opening in degrees (0.5..89), and how soft its edge is
      const coneVal = h('input', { type: 'number', min: 0.5, max: 89, step: 0.5, value: L.angle ?? 10, class: 'light-num',
        oninput: (e) => { if (e.target.value !== '') { set({ angle: +e.target.value }); cone.value = e.target.value; } } });
      const cone = h('input', { type: 'range', min: 0.5, max: 89, step: 0.5, value: L.angle ?? 10, class: 'grow',
        oninput: (e) => { set({ angle: +e.target.value }); coneVal.value = e.target.value; } });
      const soft = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: L.soft ?? 0.3, class: 'grow', oninput: (e) => set({ soft: +e.target.value }) });
      const aim = (k, label) => h('label', {}, label, h('input', { type: 'number', step: 0.05, value: L.target?.[k] ?? 0,
        oninput: (e) => { const p = [...(L.target || inst.rig?.target.toArray() || [0, 0, 0])]; p[k] = +e.target.value || 0; set({ target: p }); } }));
      form = h('div', { class: 'el-form' },
        h('div', { class: 'look-line' }, h('span', { class: 'look-name', title: amb ? '0 = dark, 0.5 = the scene as it is, 1 = white' : '' }, amb ? 'level' : 'strength'), slider, val),
        h('div', { class: 'look-line' }, h('span', { class: 'look-name' }, 'color'), this.colorPicker(L.color || '#ffffff', (c) => set({ color: c }), LIGHT_COLORS)),
        L.type === 'spot' ? h('div', { class: 'look-line' }, h('span', { class: 'look-name' }, 'angle'), cone, coneVal) : null,
        L.type === 'spot' ? h('div', { class: 'look-line' }, h('span', { class: 'look-name' }, 'soft'), soft) : null,
        !amb ? h('div', { class: 'look-line' }, h('span', { class: 'look-name' }, aims ? 'from' : 'at'), pos(0, 'x'), pos(1, 'y'), pos(2, 'z')) : null,
        aims ? h('div', { class: 'look-line' }, h('span', { class: 'look-name' }, 'to'), aim(0, 'x'), aim(1, 'y'), aim(2, 'z')) : null);
    }
    return h('div', {},
      h('div', { class: 'add-label light-head' }, 'Light', ids.some((id) => lights[id].type !== 'ambient') ? h('button', { class: `markers ${this.hideMarkers ? '' : 'on'}`,
        title: 'the light balls on the scene (editor only)', onclick: () => { this.hideMarkers = !this.hideMarkers; this.showLightGizmos(inst); this.renderInspector(); } }, this.hideMarkers ? 'show markers' : 'hide markers') : null),
      this.ambientRow(inst),
      h('div', { class: 'row add-row' }, add('point', '+ Point'), add('spot', '+ Spot')),
      here.length ? h('div', { class: 'el-list' }, here.map(row)) : null,
      other.length ? h('details', { class: 'el-other' }, h('summary', {}, `lights on other pages (${other.length})`), h('div', { class: 'el-list' }, other.map(row))) : null,
      form);
  }

  // a 2D scene's 3D views take their own lights again (after an edit); the light marks on the selected one only
  refreshViews(inst) {
    for (const { el, spec } of inst.elements.values()) {
      const v = el._modelView; if (!v) continue;
      v.markDefs = this.hideMarkers || spec.id !== this.selectedEl ? null : spec.lights || null; v.markSel = this.selectedLight;   // (editor only)
      v.applyLights();
    }
  }

  // A 2D scene's 3D view, as a 3D scene: a drag in it turns its camera (saved as this page's when let go), the
  // wheel moves it in / out; a light mark is moved instead (pickViewLight); shift-drag moves the element.
  orbitView(e, inst, el) {
    const v = el._modelView, entry = [...inst.elements.values()].find((x) => x.el === el);
    if (!v || !entry) return false;
    e.preventDefault(); e.stopPropagation();
    if (this.selectedEl !== entry.spec.id) { this.selectedEl = entry.spec.id; this.renderInspector(); }
    let x0 = e.clientX, y0 = e.clientY, moved = false;
    const move = (ev) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0; x0 = ev.clientX; y0 = ev.clientY;
      if (!moved && Math.hypot(dx, dy) < 1) return;
      moved = true; v.orbit(dx * 0.008, dy * 0.008);
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (moved) this.saveViewCamera(inst, entry.spec, v);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    return true;
  }

  saveViewCamera(inst, spec, v) {
    const k = inst.stepIndex, pose = v.poseData();
    v.release();
    this.editLive(inst, spec, { cameras: { ...(spec.cameras || {}), [k]: pose } });
  }

  // a light mark in a 2D scene's 3D view: drag it in the view (on the plane facing its camera)
  pickViewLight(e, inst, el) {
    const v = el._modelView, hit = v?.pickMarker(e);
    if (!hit) return false;
    e.preventDefault(); e.stopPropagation();
    const host = this.lightHost(inst, [...inst.elements.values()].find((x) => x.el === el)?.spec);
    const L = host?.owner.lights?.[hit.id]; if (!L) return false;
    const key = hit.end ? 'target' : 'position', p0 = new THREE.Vector3(...L[key]), h0 = hit.point;
    this.selectedLight = hit.id; this.selectedEl = host.spec.id; this.renderInspector(); this.refreshViews(inst);
    const rr = (x) => Math.round(x * 1000) / 1000;
    let moved = null;
    const move = (ev) => {
      const at = v.onPlane(ev, h0); if (!at) return;
      moved = p0.clone().add(at.sub(h0)).toArray().map(rr);
      this.editLight(inst, hit.id, { [key]: moved }, false);
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (moved) { this.editLight(inst, hit.id, { [key]: moved }); this.renderInspector(); }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    return true;
  }

  // the page's own ambient level (every page has one, 0.5 = the scene as it is; it cannot be deleted)
  ambientRow(inst) {
    const host = this.lightHost(inst);
    const k = inst.stepIndex, v = ambientOf(host.owner, k);
    const set = (x) => {
      x = Math.min(1, Math.max(0, Math.round(x * 1000) / 1000));
      slider.value = x; if (document.activeElement !== num) num.value = x.toFixed(2);
      (host.owner.ambient ||= {})[k] = x;
      this.recordLights(inst, host, 'ambient', { [k]: x });
      if (inst.is3D) { applyAmbient(inst.scene, x); inst.renderNow(); } else this.refreshViews(inst);
      this.save();
    };
    const slider = h('input', { type: 'range', min: 0, max: 1, step: 0.001, value: v, class: 'grow', title: '0 = dark · 0.5 = as it is · 1 = white' });
    // dragging moves it at half the pointer's speed (fine control): the native drag is replaced
    slider.addEventListener('pointerdown', (e) => {
      e.preventDefault(); slider.setPointerCapture(e.pointerId);
      const w = slider.getBoundingClientRect().width || 1, x0 = e.clientX, v0 = +slider.value;
      const move = (ev) => set(v0 + ((ev.clientX - x0) / w) * 0.5);
      const up = () => { slider.removeEventListener('pointermove', move); slider.removeEventListener('pointerup', up); };
      slider.addEventListener('pointermove', move); slider.addEventListener('pointerup', up);
    });
    slider.addEventListener('input', () => set(+slider.value));        // keys
    const num = h('input', { type: 'number', min: 0, max: 1, step: 0.01, value: v.toFixed(2), class: 'light-num',
      oninput: (e) => { if (e.target.value !== '') set(+e.target.value); } });
    return h('div', { class: 'look-line' }, h('span', { class: 'look-name', title: `ambient light of page ${k + 1}` }, 'ambient'), slider, num);
  }

  editLightPages(label, inst, id) {
    const L = this.lightHost(inst).owner.lights[id], last = inst.steps.length, on = L.on || [0, null];
    const box = (v) => h('input', { type: 'number', min: 1, max: last + 1, step: 1, value: v + 1, class: 'pg' });
    const from = box(on[0]), to = box(on[1] ?? last);
    const wrap = h('span', { class: 'el-pages editing' }, from, '–', to);
    let done = false;
    const commit = () => {
      if (done) return; done = true;
      const a = Math.max(0, Math.min(last, Math.round(+from.value || 1) - 1)), b = Math.max(a, Math.min(last, Math.round(+to.value || 1) - 1));
      this.editLight(inst, id, { on: [a, b >= last ? null : b] }); this.renderInspector();
    };
    for (const inp of [from, to]) {
      inp.addEventListener('click', (e) => e.stopPropagation());
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { done = true; this.renderInspector(); } });
    }
    wrap.addEventListener('focusout', () => setTimeout(() => { if (!wrap.contains(document.activeElement)) commit(); }, 0));
    label.replaceWith(wrap); from.focus(); from.select();
  }

  addLight(inst, type) {
    const host = this.lightHost(inst); if (!host) return;
    const ids = new Set(Object.keys(host.owner.lights || {}));
    let n = 1; while (ids.has(`${type}_${n}`)) n++;
    const r = (v) => Math.round(v * 1000) / 1000;
    const view2d = host.spec ? inst.elements.get(host.spec.id)?.el._modelView : null;
    const t = inst.is3D ? inst.rig.target : view2d?.target || new THREE.Vector3(), d = inst.is3D ? inst.camera.position.distanceTo(t) : 2.5;   // 2D: the model's frame
    const id = `${type}_${n}`;
    // where it starts: a point light right at the middle of what the camera looks at (its target); a spot above
    // that point, shining down on it: bright and wide enough to show at once (then: move it, tune it)
    const spot = type === 'spot';
    const at = spot ? t.clone().add(new THREE.Vector3(0, d * 0.45, 0)) : t.clone(), aim = t.clone();
    const page = inst.stepIndex;
    const L = { type, intensity: type === 'ambient' ? 0.5 : spot ? 12 : 4, color: '#ffffff', on: [page, page],
      ...(type !== 'ambient' ? { position: at.toArray().map(r) } : {}), ...(spot ? { target: aim.toArray().map(r), angle: 35, soft: 0.4 } : {}) };
    (host.owner.lights ||= {})[id] = L;
    this.recordLights(inst, host, id, { ...L });
    if (inst.is3D) placeLights(inst.scene, { [id]: L }, inst.lights, t); else this.refreshViews(inst);
    this.selectedLight = id; this.save(); this.renderInspector(); inst.renderNow();
    this.flash(`added a ${type} light on page ${page + 1}`);
  }

  editLight(inst, id, props, save = true) {
    const host = this.lightHost(inst); if (!host?.owner.lights?.[id]) return;
    const L = Object.assign(host.owner.lights[id], props);
    if (save) { this.recordLights(inst, host, id, props); this.save(); }
    const obj = inst.lights?.get(id);
    if (obj) setLight(obj, L, inst.scene, lightOn(L, inst.stepIndex) ? 1 : 0);
    if (!inst.is3D) this.refreshViews(inst);
    this.showLightGizmos(inst); inst.renderNow();
  }

  deleteLight(inst, id) {
    const host = this.lightHost(inst); if (!host?.owner.lights?.[id]) return;
    const L = host.owner.lights[id];
    const obj = inst.lights?.get(id);
    if (obj) { setLight(obj, L, inst.scene, 0); obj.target?.removeFromParent?.(); obj.removeFromParent(); inst.lights.delete(id); }
    delete host.owner.lights[id];
    this.recordLights(inst, host, id, null);
    if (!inst.is3D) this.refreshViews(inst);
    if (this.selectedLight === id) this.selectedLight = null;
    if (!inst.is3D) this.refreshViews(inst);
    this.save(); this.renderInspector(); this.showLightGizmos(inst); inst.renderNow();
    this.flash(`deleted the light “${id}” · ⌘Z undoes`);
  }

  // editor-only marks of this page's point / directional lights: a small ball (and, for a directional one, a
  // dashed line to where it shines); drag a ball to move its light (shift: up / down)
  showLightGizmos(inst) {
    (this.lightGizmos || []).forEach((g) => g.removeFromParent());
    this.lightGizmos = [];
    if (!inst?.is3D) return;
    const d = inst.camera.position.distanceTo(inst.rig.target);
    for (const [id, L] of Object.entries(inst.def.lights || {})) {
      if (this.hideMarkers || !L || L.hidden || L.type === 'ambient' || !L.position || !lightOn(L, inst.stepIndex)) continue;
      const on = this.selectedLight === id;
      const ball = new THREE.Mesh(new THREE.SphereGeometry(d * (on ? 0.018 : 0.013), 16, 12),
        new THREE.MeshBasicMaterial({ color: on ? '#2f6fb3' : '#f2b705', depthTest: false, transparent: true }));
      ball.renderOrder = 999; ball.position.set(...L.position); ball.userData.light = id;
      const g = new THREE.Group(); g.add(ball);
      if (L.type === 'spot') {                       // its cone, as lines: the axis and a ring at the target
        const tg = new THREE.Vector3(...(L.target || inst.rig.target.toArray())), axis = tg.clone().sub(ball.position), len = axis.length() || 1;
        const rad = Math.tan(THREE.MathUtils.degToRad(L.angle ?? 10)) * len;
        const ring = [], q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis.clone().normalize());
        for (let i = 0; i <= 48; i++) { const a = (i / 48) * Math.PI * 2; ring.push(new THREE.Vector3(Math.cos(a) * rad, Math.sin(a) * rad, 0).applyQuaternion(q).add(tg)); }
        const mat = new THREE.LineBasicMaterial({ color: on ? '#2f6fb3' : '#c9a227', depthTest: false, transparent: true, opacity: 0.8 });
        const rim = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), mat);
        const sides = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([0, 12, 24, 36].flatMap((i) => [ball.position.clone(), ring[i]])), mat);
        for (const x of [rim, sides]) { x.renderOrder = 998; x.raycast = () => {}; g.add(x); }
        const end = new THREE.Mesh(new THREE.SphereGeometry(d * 0.009, 12, 8), new THREE.MeshBasicMaterial({ color: on ? '#2f6fb3' : '#f2b705', depthTest: false, transparent: true }));
        end.position.copy(tg); end.renderOrder = 999; end.userData.light = id; end.userData.end = true; g.add(end);
      }
      if (L.type === 'directional') {
        const tg = new THREE.Vector3(...(L.target || inst.rig.target.toArray()));
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([ball.position, tg]), new THREE.LineDashedMaterial({ color: '#2f6fb3', dashSize: d * 0.02, gapSize: d * 0.015, depthTest: false }));
        line.computeLineDistances(); line.renderOrder = 998; line.raycast = () => {}; g.add(line);
        // its end: where it shines to (a ring, draggable like the start)
        const end = new THREE.Mesh(new THREE.TorusGeometry(d * 0.011, d * 0.003, 8, 24), new THREE.MeshBasicMaterial({ color: on ? '#2f6fb3' : '#f2b705', depthTest: false, transparent: true }));
        end.position.copy(tg); end.quaternion.copy(inst.camera.quaternion); end.renderOrder = 999; end.userData.light = id; end.userData.end = true;
        const pick = new THREE.Mesh(new THREE.SphereGeometry(d * 0.014, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
        pick.position.copy(tg); pick.userData.light = id; pick.userData.end = true;
        g.add(end, pick);
      }
      inst.scene.add(g); this.lightGizmos.push(g);
    }
    inst.renderNow();
  }

  pickLight(e, inst) {
    if (!this.lightGizmos?.length) return false;
    const canvas = inst.renderer.domElement, r = canvas.getBoundingClientRect();
    const ndc = (ev) => new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc(e), inst.camera);
    const hit = ray.intersectObjects(this.lightGizmos, true)[0];
    if (!hit) return false;
    e.preventDefault(); e.stopPropagation();
    const id = hit.object.userData.light, L = inst.def.lights[id], key = hit.object.userData.end ? 'target' : 'position';
    this.selectedLight = id; this.selectedEl = null; this.renderInspector();
    const ctl = inst.devControls; if (ctl) ctl.enabled = false;
    const p0 = new THREE.Vector3(...(L[key] || inst.rig.target.toArray())), h0 = hit.point.clone();
    const n = e.shiftKey ? inst.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize().negate() : new THREE.Vector3(0, 1, 0);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, h0);
    let moved = null;
    const rr = (v) => Math.round(v * 1000) / 1000;
    const move = (ev) => {
      ray.setFromCamera(ndc(ev), inst.camera);
      const at = ray.ray.intersectPlane(plane, new THREE.Vector3());
      if (!at) return;
      const dd = at.sub(h0); if (e.shiftKey) dd.set(0, dd.y, 0);
      moved = p0.clone().add(dd).toArray().map(rr);
      this.editLight(inst, id, { [key]: moved }, false);
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (ctl) ctl.enabled = true;
      if (moved) { this.editLight(inst, id, { [key]: moved }); this.renderInspector(); }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    return true;
  }

  // the selected 3D shape: its own box drawn round it, and the handles (model_handles.js); editor only
  showModelBox(inst) {
    this.modelBox?.removeFromParent(); this.modelBox = null;
    this.modelHandles?.dispose(); this.modelHandles = null;
    document.querySelectorAll('.ed-3d-dot').forEach((d) => d.remove());      // none left over from an earlier page
    const holder = this.selectedModel && inst?.models?.get(this.selectedModel);
    if (!holder) { inst?.renderNow?.(); return; }
    this.modelHandles = new ModelHandles(this, inst, this.selectedModel);
    this.modelBox = new THREE.Box3Helper(this.modelHandles.box, 0x2f6fb3);
    this.modelBox.raycast = () => {};                 // not something to pick
    holder.add(this.modelBox); inst.renderNow();
  }

  // a model change shown, not yet saved (while a handle is dragged)
  previewModel(inst, id, props) {
    const holder = inst.models?.get(id);
    if (holder) { setModel(holder, { ...modelAt(inst.def.models[id], inst.stepIndex), ...props }); inst.renderNow(); }
  }

  // ------------------------------------------------------------ snapping
  // While dragging, the moved box's left / centre / right (and top / middle / bottom) snap to the scene's
  // centre lines and to those of the other elements on the page (within 10 px); a guide line shows it.
  snapTargets(inst, items) {
    const moving = new Set(items.map((x) => x.entry.spec.id));
    const [W, H] = this.player.size, xs = [W / 2], ys = [H / 2];
    for (const { el, spec } of inst.elements.values()) {
      if (moving.has(spec.id) || spec.anchor || el.style.visibility === 'hidden' || +el.style.opacity === 0) continue;
      const l = el.offsetLeft, t = el.offsetTop, w = el.offsetWidth, h = el.offsetHeight;
      if (!w && !h) continue;
      xs.push(l, l + w / 2, l + w); ys.push(t, t + h / 2, t + h);
    }
    const box = items.filter((x) => !x.entry.spec.anchor).map(({ entry, sx, sy }) => [sx, sy, entry.el.offsetWidth, entry.el.offsetHeight]);
    if (!box.length) return null;
    return { xs, ys, l: Math.min(...box.map((b) => b[0])), t: Math.min(...box.map((b) => b[1])),
      r: Math.max(...box.map((b) => b[0] + b[2])), b: Math.max(...box.map((b) => b[1] + b[3])) };
  }

  snap(drag, dx, dy) {
    const T = drag.snap, tol = 10;
    if (!T) return [dx, dy];
    const best = (edges, lines) => {
      let out = null;
      for (const e of edges) for (const L of lines) { const d = L - e; if (Math.abs(d) <= tol && (!out || Math.abs(d) < Math.abs(out.d))) out = { d, at: L }; }
      return out;
    };
    const sx = best([T.l + dx, (T.l + T.r) / 2 + dx, T.r + dx], T.xs), sy = best([T.t + dy, (T.t + T.b) / 2 + dy, T.b + dy], T.ys);
    this.showGuides(drag.inst, sx?.at, sy?.at);
    return [dx + (sx?.d ?? 0), dy + (sy?.d ?? 0)];
  }

  showGuides(inst, x, y) {
    const parent = inst.overlay || inst.layer;
    if (!this.guides) this.guides = [h('div', { class: 'ed-guide v' }), h('div', { class: 'ed-guide hz' })];
    const [gv, gh] = this.guides;
    for (const g of this.guides) if (g.parentElement !== parent) parent.appendChild(g);
    gv.style.display = x == null ? 'none' : ''; gv.style.left = `${x}px`;
    gh.style.display = y == null ? 'none' : ''; gh.style.top = `${y}px`;
  }

  // ------------------------------------------------------------ edit text in place
  // Double-click a text / bullets / math element: it turns into plain editable
  // text (the markup, not HTML). Click outside or Cmd+Enter commits, Esc cancels.
  bindInlineEdit() {
    this.host.addEventListener('dblclick', (e) => {
      const el = e.target.closest('.slide-overlay .el');
      const inst = this.player?.current;
      if (!el || !inst || el.isContentEditable) return;
      const entry = [...inst.elements.values()].find((x) => x.el === el);
      if (!entry || !textKeyOf(entry.spec)) return;
      const { spec } = entry;
      el.contentEditable = 'plaintext-only';
      el.classList.add('ed-editing');
      el.textContent = rawText(spec);
      el.focus();
      document.getSelection().selectAllChildren(el);
      let cancelled = false;
      const done = () => {
        el.removeEventListener('blur', done); el.removeEventListener('keydown', keys);
        const value = el.innerText.replace(/\n$/, '');      // read before white-space goes back to normal
        el.contentEditable = 'false'; el.classList.remove('ed-editing');
        if (cancelled || value === rawText(spec)) { inst.refreshElement(spec.id); return; }
        this.editLive(inst, spec, fromRaw(spec, value));
      };
      const keys = (k) => {
        k.stopPropagation();
        if (k.key === 'Escape') { cancelled = true; el.blur(); }
        if (k.key === 'Enter' && (k.metaKey || k.ctrlKey)) el.blur();
      };
      el.addEventListener('blur', done); el.addEventListener('keydown', keys);
    });
  }

  // ------------------------------------------------------------ save
  // Saves send only what changed since the last save; the server merges it
  // into overrides.json and writes what it can into deck.js. Several editor
  // tabs therefore never overwrite each other's edits.
  save() {
    clearTimeout(this.saveTimer);
    this.status.textContent = 'saving…';
    this.status.className = 'ed-status';
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.flush(); }, 250);
  }

  async flush() {
    if (this.saving) { this.save(); return; }                        // one request at a time
    if (!Object.keys(this.pending.slides).length && !this.pending.order) return;
    const delta = this.pending;
    this.pending = { slides: {} };
    this.saving = true;
    try {
      const res = await saveOverrides(this.deckName, delta, this.deckFile);
      this.ownStamps.add(res.stamp.deck); this.watch?.known(res.stamp);
      // the server's merged overrides, plus whatever was edited meanwhile
      this.ov = res.overrides;
      mergeOverrides(this.ov, this.pending);
      this.status.textContent = 'saved ✓';
      this.status.className = 'ed-status ok';
    } catch (e) {
      mergeOverrides(delta, this.pending); this.pending = delta;       // keep it for the next try
      this.status.textContent = 'not saved — start the server with: python3 code/serve.py';
      this.status.className = 'ed-status err';
    }
    this.saving = false;
  }

  // ⌘Z / ⌘⇧Z: the server keeps the deck as it was before each save; stepping
  // back restores it and every open page reloads it (text typed in a field is
  // undone by the field itself first)
  async undo(kind) {
    if (this.undoing) return;
    this.undoing = true;
    try {
      clearTimeout(this.saveTimer); this.saveTimer = null;
      while (this.saving) await new Promise((r) => setTimeout(r, 50));
      await this.flush();                                      // the last edit is a step of its own
      const r = await fetch(`/api/${kind}?deck=${encodeURIComponent(this.deckName)}&file=${encodeURIComponent(this.deckFile)}`, { method: 'POST' });
      const res = await r.json();
      if (!res.ok) { this.flash(kind === 'undo' ? 'nothing to undo' : 'nothing to redo'); return; }
      this.ownStamps.add(res.stamp.deck); this.watch?.known(res.stamp);
      const { deck, overrides } = await loadDeck(this.deckUrl, this.baseUrl, res.stamp.deck);
      this.deck = deck; this.ov = overrides; this.pending = { slides: {} };
      swapDeck(this.player, deck);
      this.renderList();
      this.flash(kind === 'undo' ? '↶ undone' : '↷ redone');
    } catch (e) {
      this.status.textContent = `${kind} failed`; this.status.className = 'ed-status err';
    } finally { this.undoing = false; }
  }

  flash(msg) {
    this.status.textContent = msg;
    this.status.className = 'ed-status ok';
  }

  // ------------------------------------------------------------ run mode
  run(i, k = 0) {                                  // k: the page to start on
    if (this.running) return;
    // text still being edited in place: commit it first
    if (document.activeElement?.isContentEditable) document.activeElement.blur();
    this.running = true;
    this.player.destroy();
    const host = h('div', { class: 'run-host' });
    document.body.append(host);
    host.requestFullscreen?.().catch(() => {});
    const runner = new Player(host, this.deck, {
      baseUrl: this.baseUrl, mode: 'run', startAt: [i, k],
      onExit: (si, sk) => stop(si, sk),
    });
    window.player = runner;
    this.runner = runner;
    const stop = (si, sk) => {
      if (!this.running) return;
      this.running = false;
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      runner.destroy(); host.remove(); this.runner = null;
      this.lastInst = null;
      this.openPlayer(si, sk);
    };
    // browsers swallow Esc to leave fullscreen: treat that as leaving the show
    const onFs = () => { if (!document.fullscreenElement) { const c = runner.current; stop(c ? c.index : i, c ? c.stepIndex : 0); } };
    document.addEventListener('fullscreenchange', onFs);
    runner.start();
  }

  bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (this.running || e.altKey) return;
      if (e.target.closest?.('input, textarea, select') || e.target.isContentEditable) return;
      if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'z' || e.key === 'y')) {
        e.preventDefault();
        this.undo(e.shiftKey || e.key === 'y' ? 'redo' : 'undo');
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'v')) {
        const inst = this.player?.current;
        if (e.key === 'c' && this.selectedEl) {
          const specs = this.selectedSpecs(inst);
          if (specs.length && !document.getSelection()?.toString()) {
            this.clipboard = specs.map((spec) => this.copyOf(inst, spec));
            this.flash(`copied ${specs.length > 1 ? `${specs.length} elements` : `“${specs[0].id}”`} · ⌘V on any slide / page`); this.renderInspector();
          }
        }                                              // ⌘V: the paste event (bindFileDrop): files, or the copied elements
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === ']' || e.key === '[')) {
        const inst = this.player?.current, specs = this.selectedSpecs(inst);
        if (specs.length) { e.preventDefault(); this.setLayer(inst, specs, e.key === ']' ? 'front' : 'back'); }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {             // everything on the page shown
        const inst = this.player?.current;
        if (!inst) return;
        e.preventDefault();
        const ids = (inst.def.elements || []).map((x) => x.id).filter((id) => pagesOf(inst, id).includes(inst.stepIndex));
        this.selection = new Set(ids); this._sel = ids.at(-1) ?? null;
        this.renderInspector();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'g') {
        const inst = this.player?.current;
        if (inst) { e.preventDefault(); if (e.shiftKey) this.ungroupSelection(inst); else this.groupSelection(inst); }
        return;
      }
      if (e.metaKey || e.ctrlKey) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && !this.selectedEl && this.selectedModel && this.player?.current?.is3D) {
        e.preventDefault(); this.deleteModel(this.player.current, this.selectedModel); this.showModelBox(this.player.current); return;   // the 3D shape picked in the scene
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedEl) {
        const inst = this.player?.current, specs = this.selectedSpecs(inst);
        if (specs.length) { e.preventDefault(); this.deleteElements(inst, specs); }
        return;
      }
      if (e.key === 'Escape' && this.selectedEl) { this.selectedEl = null; this.renderInspector(); return; }
      if (e.key === 'p' || e.key === 'P' || e.key === 'F5') {
        e.preventDefault();
        this.run(e.shiftKey ? 0 : this.player?.current?.index ?? 0);
      }
    });
  }
}

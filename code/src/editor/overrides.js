// Edits made in the editor are stored as a small JSON "overrides" file next
// to the deck (<deck folder>/overrides.json, e.g. demo.3Dslides/overrides.json) and applied on top of deck.js at
// load time. The server writes text / position edits of plain element
// literals straight back into deck.js; overrides only keep the rest:
//   { "slides": { "<slide id or index>": {
//       "camera": {position, target, fov},            // start pose
//       "poses": { "<name>": {position, target, fov} },
//       "added": true, "after": "<slide id>", "def": {...}   (a 2D slide made in the editor)
//       "added": true, "after": "<slide id>", "copyOf": "<slide id>"   (a copy of a slide)
//       "deleted": true                                     (a slide deleted in the editor)
//       "background": "#rrggbb" | null                      (a 2D slide's background; null: the theme's)
//       "notes": "..." | null                               (the scene's speaker notes: every page of it; null: none)
//       "elements": { "<element id>": { x, y, w, h, text, html, tex, on } | { deleted: true }
//                     | { added: true, type, text, ... } } } },     (on: [from page, to page])
//   "order": ["<slide id>", ...] }    (slides reordered in the editor: until written into deck.js)

export const slideKey = (def, i) => def.id || String(i);

export async function loadOverrides(deckBaseUrl) {
  try {
    const r = await fetch(new URL('overrides.json', deckBaseUrl), { cache: 'no-store' });
    return r.ok ? await r.json() : { slides: {} };
  } catch { return { slides: {} }; }
}

export function applyOverrides(deck, ov) {
  // slides added in the editor (2D) and slides deleted there; in place, so players keep the array
  for (const [key, o] of Object.entries(ov.slides || {})) {
    if (o.added && !o.deleted && !deck.slides.some((d) => d.id === key)) {
      const src = o.copyOf != null ? deck.slides.find((d) => d.id === o.copyOf) : null;
      const def = o.def ? JSON.parse(JSON.stringify(o.def)) : src ? { ...cloneDef(src), id: key } : null;
      const at = deck.slides.findIndex((d) => d.id === o.after);
      if (def) deck.slides.splice(at < 0 ? deck.slides.length : at + 1, 0, def);
    }
    if (o.deleted) {
      const at = deck.slides.findIndex((d) => d.id === key);
      if (at >= 0) deck.slides.splice(at, 1);
    }
  }
  if (ov.order) reorderSlides(deck.slides, ov.order);
  deck.slides.forEach((def, i) => {
    const o = ov.slides?.[slideKey(def, i)];
    if (!o) return;
    if ('background' in o) { if (o.background) def.background = o.background; else delete def.background; }
    if ('notes' in o) { if (o.notes) def.notes = o.notes; else delete def.notes; }
    if (o.camera) def.camera = { ...def.camera, ...o.camera };
    if (o.poses) def.poses = { ...(def.poses || {}), ...o.poses };
    if (o.ambient) {                                           // each page's ambient level
      def.ambient = { ...(def.ambient || {}), ...o.ambient };
      for (const k of Object.keys(def.ambient)) if (def.ambient[k] == null) delete def.ambient[k];
    }
    for (const [id, L] of Object.entries(o.lights || {})) {     // lights added to a 3D scene
      def.lights = { ...(def.lights || {}) };
      if (L === null) delete def.lights[id]; else def.lights[id] = { ...(def.lights[id] || {}), ...L };
    }
    for (const [id, m] of Object.entries(o.models || {})) {     // 3D shapes uploaded into a 3D scene
      def.models = { ...(def.models || {}) };
      if (m === null) delete def.models[id]; else def.models[id] = { ...(def.models[id] || {}), ...m };
    }
    for (const op of o.pageOps || []) {                       // pages added / deleted (not yet in the deck source)
      const steps = (def.steps = [...(def.steps || [])]);
      if (op.add) steps.push([]);
      else if (op.del >= 1) steps.splice(op.del - 1, 1);
      else if (op.ins != null) steps.splice(op.ins, 0, []);      // a new empty page after page `ins`
      else if (op.perm) {                                          // pages reordered (page 0's actions: enter's)
        const acts = (x) => (Array.isArray(x) ? x : x?.actions ? x.actions : x ? [x] : []);
        const lists = [acts(def.enter), ...steps.map(acts)], next = op.perm.map((p) => lists[p]);
        def.enter = next[0]; def.steps = next.slice(1); continue;
      }
      else if (op.del === 0 && steps.length) {           // the first page: its click now happens as the scene enters
        const acts = (x) => (Array.isArray(x) ? x : x?.actions ? x.actions : x ? [x] : []);
        def.enter = [...acts(def.enter), ...acts(steps[0])];
        steps.splice(0, 1);
      }
    }
    if (o.pageCameras) {
      def.pageCameras = { ...(def.pageCameras || {}), ...o.pageCameras };
      for (const k of Object.keys(def.pageCameras)) if (def.pageCameras[k] == null) delete def.pageCameras[k];
    }
    for (const [id, props] of Object.entries(o.elements || {})) {
      if (props.deleted) { removeElement(def, id); continue; }
      let spec = def.elements?.find((e) => e.id === id);
      if (!spec && props.added) { const { added, ...rest } = props; spec = { id, ...rest }; (def.elements ||= []).push(spec); continue; }
      if (spec) Object.assign(spec, props);
      if (spec && props.on) stripActions(def, id);           // its pages replace its show / hide actions
    }
  });
}

// the slides in `order` (ids) take that order, in place, among the places they hold; the others stay where they are
export function reorderSlides(slides, order) {
  const rank = new Map(order.map((id, k) => [id, k]));
  const at = slides.map((d, i) => (rank.has(d.id) ? i : -1)).filter((i) => i >= 0);
  const moved = at.map((i) => slides[i]).sort((a, b) => rank.get(a.id) - rank.get(b.id));
  at.forEach((i, k) => { slides[i] = moved[k]; });
}

// a deep copy of a slide definition that keeps its functions (3D scene factories)
export function cloneDef(x) {
  if (Array.isArray(x)) return x.map(cloneDef);
  if (x && typeof x === 'object' && Object.getPrototypeOf(x) === Object.prototype) {
    return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, cloneDef(v)]));
  }
  return x;
}

// remove an element from a slide definition, with the actions that name it
const NAMES = ['show', 'hide', 'play', 'pause', 'seek'];
const names = (a, id) => a && typeof a === 'object' && !Array.isArray(a) && NAMES.some((k) => a[k] === id);
function strip(x, id) {
  if (Array.isArray(x)) return x.filter((a) => !names(a, id)).map((a) => strip(a, id));
  if (x && typeof x === 'object' && Array.isArray(x.actions)) return { ...x, actions: strip(x.actions, id) };
  return x;
}
export function stripActions(def, id) {
  if (def.enter) def.enter = names(def.enter, id) ? [] : strip(def.enter, id);
  if (def.steps) def.steps = def.steps.map((s) => (names(s, id) ? [] : strip(s, id)));
}
export function removeElement(def, id) {
  def.elements = (def.elements || []).filter((e) => e.id !== id);
  stripActions(def, id);
}

export function slideOverride(ov, def, i) {
  ov.slides ||= {};
  return (ov.slides[slideKey(def, i)] ||= {});
}

// merge a delta (same shape) into overrides, in place
export function mergeOverrides(base, delta) {
  base.slides ||= {};
  if (delta.order) base.order = delta.order;
  for (const [key, o] of Object.entries(delta.slides || {})) {
    const b = (base.slides[key] ||= {});
    for (const k of ['added', 'after', 'def', 'deleted', 'background', 'notes']) if (k in o) b[k] = o[k];
    if (o.camera) b.camera = o.camera;
    if (o.poses) b.poses = { ...(b.poses || {}), ...o.poses };
    if (o.pageCameras) b.pageCameras = { ...(b.pageCameras || {}), ...o.pageCameras };
    if (o.pageOps) b.pageOps = [...(b.pageOps || []), ...o.pageOps];
    for (const [id, m] of Object.entries(o.models || {})) { b.models ||= {}; b.models[id] = m === null ? null : { ...(b.models[id] || {}), ...m }; }
    for (const [id, L] of Object.entries(o.lights || {})) { b.lights ||= {}; b.lights[id] = L === null ? null : { ...(b.lights[id] || {}), ...L }; }
    if (o.ambient) b.ambient = { ...(b.ambient || {}), ...o.ambient };
    for (const [id, props] of Object.entries(o.elements || {})) {
      b.elements ||= {};
      b.elements[id] = { ...(b.elements[id] || {}), ...props };
    }
  }
  return base;
}

// scenes whose notes the server did not keep (a server started before notes existed drops them silently)
export function droppedNotes(delta, merged) {
  return Object.entries(delta.slides || {}).filter(([k, o]) => o.notes && merged?.slides?.[k]?.notes !== o.notes).map(([k]) => k);
}
export const OLD_SERVER = 'notes not saved: the server is older than the editor, restart it (python3 code/serve.py)';

// Saves send a delta; the server merges it into overrides.json, writes
// text / position edits back into deck.js where it can and
// keeps the rest in overrides.json; returns { written, stamp, overrides } (the merged overrides left).
export async function saveOverrides(deckName, ov, deckFile = 'deck') {
  const r = await fetch(`/api/save?deck=${encodeURIComponent(deckName)}&file=${encodeURIComponent(deckFile)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ov),
  });
  if (!r.ok) throw new Error(`save failed (${r.status})`);
  return r.json();
}

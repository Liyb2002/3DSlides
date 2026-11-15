// 3D shapes uploaded into a scene (the editor's "+ Upload 3D shape"):
//
//  - on a 2D scene: an element { type: 'model', src, x, y, w, h, camera? } is a
//    small 3D view of the model on a transparent background (mountModelView: its
//    own WebGL canvas inside the element box); isometric, or its cameras: `cameras`
//    { page: { position, target, fov } } (set in the editor per page: unlock its camera,
//    turn it, lock it again), a page without one keeps the one before; when the page
//    changes the view turns to the new page's camera (`camera`: the camera of its first page);
//    its own lights: `lights` / `ambient` (as a 3D scene's def.lights / def.ambient, lights.js),
//    none until added (a 2D scene has no lights of its own; each shape on it has its own);
//  - on a 3D scene: def.models { id: { src, position: [x, y, z], size, stretch, quat | turn } }
//    are put into the scene itself (placeModels): centred on `position`, the
//    largest side `size` (scene units) times `stretch` [x, y, z] along its own sides,
//    turned by `quat` [x, y, z, w] (or `turn` degrees about the vertical).
//    A shape can move: `pages` { page: { position, size, stretch, quat | turn } } is where it is from that page
//    on (a page without one keeps the one before; before the first: as above); when the page changes it
//    glides there (setModelsPage). `since`: the page it was added on (the editor: edits on later pages go to `pages`).
import * as THREE from 'three';
import { centredModel } from '../scenes/model_scene.js';
import { paperStudio } from '../scenes/gltf_utils.js';
import { placeLights, setLightPage, setAmbientPage, lightMarkers } from './lights.js';

// the view's lights: its own spec.lights / spec.ambient, in the model's own frame (centred on the origin,
// its largest side 1)
export function mountModelView(el, spec, baseUrl) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%';
  el.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
  let ready = false, disposed = false, controls = null, page = 0, anim = null, lights = new Map();
  const target = new THREE.Vector3();
  // the camera of page p: its own, or the latest page before it with one, or `camera`, or isometric
  const poseAt = (p) => {
    const keys = Object.keys(spec.cameras || {}).map(Number).filter((k) => k <= p).sort((a, b) => b - a);
    const c = keys.length ? spec.cameras[keys[0]] : spec.camera;
    if (c) return { position: new THREE.Vector3(...c.position), target: new THREE.Vector3(...(c.target || [0, 0, 0])), fov: c.fov ?? 30 };
    const r = 0.87, half = THREE.MathUtils.degToRad(15), fitH = Math.min(half, Math.atan(Math.tan(half) * camera.aspect));
    return { position: new THREE.Vector3(1, 1, 1).normalize().multiplyScalar((r * 1.05) / Math.sin(fitH)), target: new THREE.Vector3(), fov: 30 };
  };
  const apply = (q) => { camera.position.copy(q.position); target.copy(q.target); camera.fov = q.fov; camera.lookAt(target); camera.updateProjectionMatrix(); };
  const place = () => apply(poseAt(page));
  const view = {
    render() {
      if (disposed || !ready) return;
      const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1) * 1.5);
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
      if (!controls && !anim && !place.held) place();
      renderer.render(scene, camera);
    },
    // the camera now, as vectors
    pose() { return { position: camera.position.clone(), target: target.clone(), fov: camera.fov }; },
    // the page shown changed: turn to its camera (animate: about the target, 1 s; from `start`, the camera of
    // the same model on the page before, else from where this view is), or jump there
    setPage(p, animate, start = null) {
      const from = start ? { position: start.position.clone(), target: start.target.clone(), fov: start.fov }
        : { position: camera.position.clone(), target: target.clone(), fov: camera.fov };
      page = p;
      if (ready) {                                     // its lights to this page's (0.6 s), drawn meanwhile
        setLightPage(scene, lights, spec.lights, p, animate);
        if (spec.ambient || scene.userData.ambientLevel != null) setAmbientPage(scene, spec, p, animate);
        if (animate) { const t0 = performance.now(); const tick = () => { if (disposed) return; if (!anim) renderer.render(scene, camera); if (performance.now() - t0 < 700) requestAnimationFrame(tick); }; tick(); }
      }
      if (disposed || !ready || controls) return;
      const to = poseAt(p);
      if (!animate || (from.position.distanceTo(to.position) < 1e-6 && from.target.distanceTo(to.target) < 1e-6)) { anim = null; view.render(); return; }
      const t0 = performance.now(), D = 1000, a0 = from.position.clone().sub(from.target), a1 = to.position.clone().sub(to.target);
      const r0 = a0.length(), r1 = a1.length(), q = new THREE.Quaternion().setFromUnitVectors(a0.clone().normalize(), a1.clone().normalize());
      const step = () => {
        if (disposed || anim !== step) return;
        const u = Math.min(1, (performance.now() - t0) / D), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
        const dir = a0.clone().normalize().applyQuaternion(new THREE.Quaternion().slerp(q, e));
        const tg = from.target.clone().lerp(to.target, e);
        apply({ position: tg.clone().addScaledVector(dir, r0 + (r1 - r0) * e), target: tg, fov: from.fov + (to.fov - from.fov) * e });
        renderer.render(scene, camera);
        if (u < 1) requestAnimationFrame(step); else { anim = null; view.render(); }
      };
      anim = step; requestAnimationFrame(step);
    },
    get page() { return page; },
    get target() { return target.clone(); },
    // editor: the lights' marks in this view (null: none)
    markers(defs, selected) {
      scene.getObjectByName('editor-markers')?.removeFromParent();
      if (defs && ready) scene.add(lightMarkers(defs, page, selected, 0.035));
      view.render();
    },
    // editor: the light mark under a pointer event, { id, end, point } or null
    pickMarker(e) {
      const g = scene.getObjectByName('editor-markers');
      if (!g) return null;
      const r = canvas.getBoundingClientRect();
      const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = ray.intersectObject(g, true)[0];
      return hit ? { id: hit.object.userData.light, end: !!hit.object.userData.end, point: hit.point.clone() } : null;
    },
    // editor: a pointer position on the plane through `at` facing this view's camera
    onPlane(e, at) {
      const r = canvas.getBoundingClientRect();
      const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()).negate(), at);
      return ray.ray.intersectPlane(plane, new THREE.Vector3());
    },
    get viewDir() { return camera.getWorldDirection(new THREE.Vector3()); },
    // editor: turn the camera about its target (radians: round the vertical, up / down), or move it in / out
    orbit(dTheta, dPhi) {
      if (!ready) return;
      anim = null; place.held = true;
      const off = camera.position.clone().sub(target), sp = new THREE.Spherical().setFromVector3(off);
      sp.theta -= dTheta; sp.phi = Math.min(Math.PI - 0.01, Math.max(0.01, sp.phi - dPhi));
      camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(sp)); camera.lookAt(target); camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    },
    dolly(f) {
      if (!ready) return;
      anim = null; place.held = true;
      camera.position.sub(target).multiplyScalar(f).add(target); camera.lookAt(target); renderer.render(scene, camera);
    },
    // the camera now, as plain data (to save as this page's)
    poseData() {
      if (!ready) return null;                         // (the model not loaded yet: no camera to tell)
      const r = (v) => Math.round(v * 1000) / 1000;
      return { position: camera.position.toArray().map(r), target: target.toArray().map(r), fov: r(camera.fov) };
    },
    release() { place.held = false; },
    get scene() { return scene; },
    get unlocked() { return !!controls; },
    // its own lights for the page shown (built anew: after an edit)
    applyLights() {
      if (!ready) return;
      for (const o of [...scene.children]) if (o.userData.editorLight) { o.target?.removeFromParent?.(); o.removeFromParent(); }
      lights = placeLights(scene, spec.lights, new Map(), new THREE.Vector3(), canvas);
      setLightPage(scene, lights, spec.lights, page, false);
      if (spec.ambient || scene.userData.ambientLevel != null) setAmbientPage(scene, spec, page, false);
      if (view.markDefs !== undefined) view.markers(view.markDefs, view.markSel); else view.render();
    },
    // the editor's camera button: unlocked, drag / scroll in the box turns / zooms its view
    async unlock() {
      if (controls || disposed) return;
      const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
      place();
      controls = new OrbitControls(camera, canvas); controls.target.copy(target); controls.update();
      controls.addEventListener('change', () => renderer.render(scene, camera));
      el.classList.add('model-unlocked');
    },
    // locked again: its camera, as plain data
    lock() {
      if (!controls) return null;
      const r = (v) => Math.round(v * 1000) / 1000;
      const pose = { position: camera.position.toArray().map(r), target: controls.target.toArray().map(r), fov: r(camera.fov) };
      controls.dispose(); controls = null; el.classList.remove('model-unlocked');
      return pose;
    },
    dispose() { disposed = true; controls?.dispose(); renderer.dispose(); renderer.forceContextLoss?.(); },
  };
  el._modelView = view;
  centredModel(spec.src, baseUrl, { fit: 1, color: spec.color }).then((m) => {
    if (disposed) return;
    m.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(m);
    scene.add(m);
    paperStudio(scene, renderer, { groundY: box.min.y, extent: 1.6, center: new THREE.Vector3(), shadowOpacity: 0.12 });
    ready = true; view.applyLights(); view.render();
  }).catch((e) => { el.textContent = `model: ${e.message}`; });
  return view;
}

// def.models into a 3D scene: one holder per model, kept in `out` (id -> holder) for live edits
export async function placeModels(scene, models, baseUrl, out = new Map()) {
  await Promise.all(Object.entries(models || {}).map(async ([id, m]) => {
    if (!m || !m.src) return;
    const holder = await centredModel(m.src, baseUrl, { fit: 1, color: m.color });
    holder.name = `model:${id}`;
    setModel(holder, m);
    scene.add(holder); out.set(id, holder);
  }));
  return out;
}

// where a shape is on a page: its own place, then each `pages` entry up to that page on top
export function modelAt(m, page) {
  const out = { ...m };
  for (const k of Object.keys(m.pages || {}).map(Number).sort((a, b) => a - b)) if (k <= page) Object.assign(out, m.pages[k]);
  return out;
}

// every shape to where it is on `page`; animate: gliding there (0.9 s)
export function setModelsPage(holders, defs, page, animate, redraw = null) {
  for (const [id, holder] of holders || []) {
    const m = defs?.[id];
    if (!m) continue;
    const to = modelAt(m, page);
    if (!animate || !m.pages) { setModel(holder, to); continue; }
    const p0 = holder.position.clone(), s0 = holder.scale.clone(), q0 = holder.quaternion.clone();
    setModel(holder, to);
    const p1 = holder.position.clone(), s1 = holder.scale.clone(), q1 = holder.quaternion.clone();
    if (p0.distanceTo(p1) + s0.distanceTo(s1) + q0.angleTo(q1) < 1e-6) continue;
    const t0 = performance.now(), token = (holder.userData.glide = {});
    const step = () => {
      if (holder.userData.glide !== token || !holder.parent) return;
      const u = Math.min(1, (performance.now() - t0) / 900), k = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      holder.position.lerpVectors(p0, p1, k); holder.scale.lerpVectors(s0, s1, k); holder.quaternion.slerpQuaternions(q0, q1, k);
      holder.updateMatrixWorld(true); redraw?.();
      if (u < 1) requestAnimationFrame(step);
    };
    step();
  }
}

export function setModel(holder, m) {
  holder.position.set(...(m.position || [0, 0, 0]));
  const s = m.size ?? 0.2, st = m.stretch || [1, 1, 1];
  holder.scale.set(s * st[0], s * st[1], s * st[2]);
  if (m.quat) holder.quaternion.set(...m.quat);
  else holder.rotation.set(0, THREE.MathUtils.degToRad(m.turn ?? 0), 0);
  holder.updateMatrixWorld(true);
}

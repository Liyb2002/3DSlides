// Lights added to a 3D scene in the editor (def.lights, saved in overrides.json):
//   { id: { type: 'point' | 'spot' | 'ambient', position: [x, y, z], intensity, color, on: [from, to] } }
// point: shines from `position` every way (no falloff with distance, so it reads the same at any scale);
// spot: a cone of light from `position` toward `target` (or what the start camera looks at), `angle` degrees
// wide (half the cone's opening; default 10), `soft` 0..1 (its edge; default 0.3), casting shadows;
// (directional: parallel light from `position` toward `target`, kept for older data);
// ambient: the scene's own light, as a level from 0 to 1: 0.5 = as the scene is, 0 = a dark room (the
// scene's own lights, its environment light, its background and its unlit / glowing materials to black;
// the lights added here still light what they reach), 1 = all white (white light on top, the picture
// washed out).
// `hidden`: off (the editor's eye), kept in the list.
// Every page also has its own ambient level (def.ambient { page: level }, 0.5 when not set): applyAmbient.
// `on`: the pages it is on (as elements: [from, to], to null = to the end); a light comes on / goes off
// over 0.6 s when the page changes (setLightPage).
import * as THREE from 'three';

export function placeLights(scene, lights, out = new Map(), target = new THREE.Vector3(), canvas = null) {
  if (canvas) { scene.userData.canvas = canvas; canvas.style.filter = ''; }   // (a pooled canvas: no level from a slide before)
  if (scene.userData.env0 == null) {                 // the scene as it is, for the ambient level
    scene.userData.env0 = scene.environmentIntensity ?? 1;
    scene.userData.amb0 = [];                          // all its own lights
    scene.traverse((o) => { if (o.isLight && !o.userData.editorLight) scene.userData.amb0.push([o, o.intensity]); });
    scene.userData.bg0 = scene.background?.isColor ? scene.background.clone() : null;
    // what no light reaches: unlit materials (their colour) and glowing ones (their glow), as they are
    const seen = new Set(); scene.userData.self0 = [];
    scene.traverse((o) => {
      if (!o.isMesh && !o.isLine && !o.isPoints) return;
      for (const m of [o.material].flat()) {
        if (!m || seen.has(m)) continue; seen.add(m);
        if (m.isMeshBasicMaterial || m.isLineBasicMaterial || m.isPointsMaterial) scene.userData.self0.push([m, 'color', m.color.clone()]);
        else if (m.emissive && m.emissiveIntensity > 0 && m.emissive.getHex() !== 0) scene.userData.self0.push([m, 'emissiveIntensity', m.emissiveIntensity]);
      }
    });
  }
  for (const [id, L] of Object.entries(lights || {})) {
    if (!L) continue;
    const obj = L.type === 'ambient' ? new THREE.AmbientLight(0xffffff, 0)
      : L.type === 'spot' ? new THREE.SpotLight(0xffffff, 1, 0, THREE.MathUtils.degToRad(10), 0.3, 0)
        : L.type === 'directional' ? new THREE.DirectionalLight() : new THREE.PointLight(0xffffff, 1, 0, 0);
    obj.name = `light:${id}`;
    obj.userData.editorLight = true;
    if (obj.isSpotLight) { obj.castShadow = true; obj.shadow.mapSize.set(1024, 1024); obj.shadow.bias = -0.0005; obj.shadow.normalBias = 0.002; }
    if (obj.isDirectionalLight || obj.isSpotLight) { obj.target.position.copy(L.target ? new THREE.Vector3(...L.target) : target); scene.add(obj.target); }
    scene.add(obj); out.set(id, obj);
    setLight(obj, L, scene);
  }
  return out;
}

// the light's settings, at `level` of its strength (0 = off: the page it is not on)
export function setLight(obj, L, scene = null, level = obj.userData.level ?? 1) {
  obj.userData.level = level;
  obj.color.set(L.color || '#ffffff');
  if (L.hidden) level = 0;
  if (L.type === 'ambient') {
    const a = L.intensity ?? 0.5, v = 0.5 + (a - 0.5) * level;        // off (level 0): 0.5, the scene as it is
    const k = Math.min(1, v / 0.5), w = Math.max(0, (v - 0.5) / 0.5);  // dim factor; white amount
    const sc = scene || obj.parent;
    if (sc?.userData.env0 != null) {
      sc.environmentIntensity = sc.userData.env0 * k + w ** 3 * 3;
      for (const [o, i] of sc.userData.amb0) o.intensity = i * k;
      if (sc.userData.bg0) sc.background = sc.userData.bg0.clone().multiplyScalar(k).lerp(new THREE.Color(1, 1, 1), w);
      // dimmer: what no light reaches goes dark with it (the added lights are not touched: they light the dark room)
      for (const [m, key, v0] of sc.userData.self0 || []) {
        if (key === 'color') m.color.copy(v0).multiplyScalar(k); else m[key] = v0 * k;
      }
      // whiter: the picture itself washes out toward white
      const cv = sc.userData.canvas;
      if (cv) cv.style.filter = w > 0 ? `brightness(${(1 + 14 * w ** 4).toFixed(3)})` : '';
    }
    obj.intensity = w ** 3 * 8;
  } else obj.intensity = (L.intensity ?? 1.5) * level;
  if (L.position && !obj.isAmbientLight) obj.position.set(...L.position);
  if ((obj.isDirectionalLight || obj.isSpotLight) && L.target) { obj.target.position.set(...L.target); obj.target.updateMatrixWorld(true); }   // where it shines to
  if (obj.isSpotLight) {
    obj.angle = THREE.MathUtils.degToRad(Math.min(89, Math.max(0.5, L.angle ?? 10)));
    obj.penumbra = Math.min(1, Math.max(0, L.soft ?? 0.3));
    const d = obj.position.distanceTo(obj.target.position) || 1;          // shadows sized to the cone
    obj.shadow.camera.near = d / 50; obj.shadow.camera.far = d * 10; obj.shadow.camera.updateProjectionMatrix?.();
  }
  obj.updateMatrixWorld(true);
}

// the page's ambient level on the scene (0 dark .. 0.5 as it is .. 1 white), as an ambient `light`
let pageAmbient = null;
export function applyAmbient(scene, level) {
  let obj = scene.getObjectByName('ambient:page');
  if (!obj) { obj = new THREE.AmbientLight(0xffffff, 0); obj.name = 'ambient:page'; obj.userData.editorLight = true; scene.add(obj); }
  scene.userData.ambientLevel = level;
  setLight(obj, { type: 'ambient', intensity: level }, scene, 1);
}
export const ambientOf = (def, page) => def?.ambient?.[page] ?? 0.5;
// the page changed: to its ambient level (animate: 0.6 s)
export function setAmbientPage(scene, def, page, animate) {
  const from = scene.userData.ambientLevel ?? 0.5, to = ambientOf(def, page);
  if (!animate || from === to) { applyAmbient(scene, to); return; }
  const t0 = performance.now(), run = (pageAmbient = {});
  const step = () => {
    if (pageAmbient !== run) return;
    const u = Math.min(1, (performance.now() - t0) / 600);
    applyAmbient(scene, from + (to - from) * u);
    if (u < 1) requestAnimationFrame(step);
  };
  step();
}

export const lightOn = (L, page) => {
  const on = L.on || [0, null];
  return page >= on[0] && (on[1] == null || page <= on[1]);
};

// the page shown changed: each light to on / off (animate: 0.6 s)
export function setLightPage(scene, lights, defs, page, animate) {
  for (const [id, obj] of lights || []) {
    const L = defs?.[id];
    if (!L) continue;
    const from = obj.userData.level ?? 1, to = lightOn(L, page) ? 1 : 0;
    if (!animate || from === to) { setLight(obj, L, scene, to); continue; }
    const t0 = performance.now();
    const step = () => {
      const u = Math.min(1, (performance.now() - t0) / 600);
      setLight(obj, L, scene, from + (to - from) * u);
      if (u < 1) requestAnimationFrame(step);
    };
    step();
  }
}

// editor-only marks of the point / spot lights on `page`: a ball at each light (a spot: its cone as lines
// and a ball at its end); `size` sets the balls (scene units), `selected` is drawn blue. Balls carry
// userData.light (and .end for a spot's end) for picking.
export function lightMarkers(defs, page, selected, size) {
  const g = new THREE.Group(); g.name = 'editor-markers';
  for (const [id, L] of Object.entries(defs || {})) {
    if (!L || L.hidden || L.type === 'ambient' || !L.position || !lightOn(L, page)) continue;
    const on = selected === id, col = on ? '#2f6fb3' : '#f2b705';
    const ball = new THREE.Mesh(new THREE.SphereGeometry(size * (on ? 1.3 : 1), 16, 12), new THREE.MeshBasicMaterial({ color: col, depthTest: false, transparent: true }));
    ball.renderOrder = 999; ball.position.set(...L.position); ball.userData.light = id; g.add(ball);
    if (L.type === 'spot' && L.target) {
      const tg = new THREE.Vector3(...L.target), axis = tg.clone().sub(ball.position), len = axis.length() || 1;
      const rad = Math.tan(THREE.MathUtils.degToRad(L.angle ?? 10)) * len;
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis.clone().normalize()), ring = [];
      for (let i = 0; i <= 48; i++) { const a = (i / 48) * Math.PI * 2; ring.push(new THREE.Vector3(Math.cos(a) * rad, Math.sin(a) * rad, 0).applyQuaternion(q).add(tg)); }
      const mat = new THREE.LineBasicMaterial({ color: on ? '#2f6fb3' : '#c9a227', depthTest: false, transparent: true, opacity: 0.85 });
      const rim = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), mat);
      const sides = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([0, 12, 24, 36].flatMap((i) => [ball.position.clone(), ring[i]])), mat);
      for (const x of [rim, sides]) { x.renderOrder = 998; x.raycast = () => {}; g.add(x); }
      const end = new THREE.Mesh(new THREE.SphereGeometry(size * 0.75, 12, 8), new THREE.MeshBasicMaterial({ color: col, depthTest: false, transparent: true }));
      end.position.copy(tg); end.renderOrder = 999; end.userData.light = id; end.userData.end = true; g.add(end);
    }
  }
  return g;
}

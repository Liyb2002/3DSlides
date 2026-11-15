// The Starry Night, in 3D: a swirling night sky (stars with pulsing halos, a crescent moon, a shooting star),
// a flame-like cypress, a village with a church steeple and lit windows, and the Yellow House: walk in through
// its door into The Bedroom in Arles (bed, chairs, table, paintings) and look out of its window at the sky.
// Painted with vangogh.js (brush strokes, contours).
//
// Units: metres, y up. The village lies in a valley around z = -10 … -45; the viewer's hill rises toward +z.
// The Yellow House: x 2 … 8, z -8.5 … -3.5, its door facing +z (at x = 5).
//
// sceneOptions: { swirl: 1, painted: true }
// poses:   painting, village, church, cypress, sky, door, bedroom, bed, window
// anchors: moon, star, swirl, cypress, church, village, house, door, bed, chairs, table, window, paintings
// actions: swirl { to }   the sky's turbulence (1 = as painted; 0 calm; 2 wild)
//          lights { to }  the village's windows (0 dark … 1 lit)
import * as THREE from 'three';
import { mulberry32 } from '../../code/src/scenes/common.js';
import { createVanGogh, brushy, NOISE } from './vangogh.js';

const rnd = mulberry32(1889);                       // the year of the painting: the layout never changes
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y, o = 4) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; } return s; };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const C = (hex) => new THREE.Color(hex);

const RZ = 9;                                       // the river (Starry Night Over the Rhône) runs along x at z = RZ
function groundY(x, z) {
  const village = smooth(60, 40, Math.abs(x)) * smooth(-75, -55, z) * smooth(16, 8, z);   // the flat valley floor
  const river = -1.6 * smooth(3.4, 2.0, Math.abs(z - RZ));
  const hill = 5 * smooth(14, 38, z) * (0.8 + 0.4 * fbm(x * 0.03, 3));                     // the viewer's hill
  const back = (12 + 10 * fbm(x * 0.012 + 7, 1)) * smooth(-55, -120, z);                  // hills behind the village
  const far = 30 * smooth(-150, -260, z) * (0.6 + 0.6 * fbm(x * 0.006, 5));               // the Alpilles
  return (1 - village) * (1.4 * fbm(x * 0.05, z * 0.05) - 0.4) + 0.12 * fbm(x * 0.4, z * 0.4) + hill + back + far + river;
}

// ------------------------------------------------------------------ the sky (a shader on a dome that follows the camera)
const SKY_VS = /* glsl */`
  varying vec3 vDir;
  void main() { vDir = position; vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`;
const SKY_FS = /* glsl */`
  uniform float uTime; uniform float uSwirl;
  varying vec3 vDir;
  ${NOISE}
  const int NS = 11;
  vec3 STARS[NS];
  float psiAt(vec2 q) {
    float t = uTime;
    float psi = q.y * 1.6 + 0.06 * sin(q.x * 4.0 + t * 0.15);
    vec2 c1 = vec2(-0.10 + 0.02 * sin(t * 0.1), 0.34), c2 = vec2(0.20, 0.27 + 0.015 * cos(t * 0.12));
    float r1 = length(q - c1), r2 = length(q - c2);
    psi += uSwirl * (0.32 * log(r1 + 0.03) * exp(-r1 * r1 / 0.05) - 0.26 * log(r2 + 0.03) * exp(-r2 * r2 / 0.035));
    psi += uSwirl * 0.05 * sin(q.x * 9.0 - t * 0.3 + q.y * 5.0) * smoothstep(0.1, 0.4, q.y);
    for (int i = 0; i < NS; i++) {
      float d = length(q - STARS[i].xy);
      psi += uSwirl * 0.05 * log(d + 0.015) * exp(-d * d / (STARS[i].z * STARS[i].z * 8.0));
    }
    return psi;
  }
  void main() {
    STARS[0] = vec3(-0.68, 0.40, 0.045); STARS[1] = vec3(-0.42, 0.52, 0.040); STARS[2] = vec3(-0.22, 0.56, 0.030);
    STARS[3] = vec3(0.02, 0.50, 0.032); STARS[4] = vec3(0.32, 0.50, 0.042); STARS[5] = vec3(0.45, 0.30, 0.036);
    STARS[6] = vec3(-0.52, 0.20, 0.032); STARS[7] = vec3(0.10, 0.17, 0.028); STARS[8] = vec3(-0.85, 0.55, 0.030);
    STARS[9] = vec3(-0.30, 0.25, 0.026); STARS[10] = vec3(0.75, 0.62, 0.030);
    vec3 d = normalize(vDir);
    vec2 q = vec2(atan(d.x, -d.z), asin(clamp(d.y, -1.0, 1.0)));
    float e = 0.004;
    float psi = psiAt(q);
    vec2 g = vec2(psiAt(q + vec2(e, 0.0)) - psi, psiAt(q + vec2(0.0, e)) - psi) / e;
    vec2 flow = normalize(vec2(g.y, -g.x) + 1e-5);
    float bands = 0.5 + 0.5 * sin(psi * 40.0 + vgNoise(vec3(q * 6.0, 1.0)) * 2.5);
    float along = dot(q, flow) * 34.0;
    float dash = vgNoise(vec3(along - uTime * 0.9, psi * 26.0, 3.0));
    float h = clamp(q.y / 1.0, 0.0, 1.0);
    vec3 deep = vec3(0.03, 0.08, 0.32), mid = vec3(0.10, 0.24, 0.60), light = vec3(0.38, 0.60, 0.88), pale = vec3(0.78, 0.88, 0.95);
    vec3 c = mix(mix(light * 0.9, mid, smoothstep(0.0, 0.25, h)), deep, smoothstep(0.35, 0.9, h));
    c = mix(c, mid * 1.15, bands * 0.55);
    c = mix(c, light, smoothstep(0.55, 0.85, dash) * (0.35 + 0.4 * bands));
    float swirlZone = exp(-pow(length(q - vec2(-0.1, 0.34)), 2.0) / 0.06) + exp(-pow(length(q - vec2(0.2, 0.27)), 2.0) / 0.04);
    c = mix(c, pale, clamp(swirlZone, 0.0, 1.0) * smoothstep(0.45, 0.85, bands * dash + 0.25) * 0.85 * min(uSwirl, 1.5));
    c = mix(c, vec3(0.55, 0.72, 0.55), smoothstep(0.12, 0.0, q.y) * 0.4);          // the greenish glow along the hills
    vec3 add = vec3(0.0);
    for (int i = 0; i < NS; i++) {                                                   // stars: a hot core, pulsing rings
      float s = STARS[i].z, dd = length(q - STARS[i].xy);
      float ring = 0.5 + 0.5 * sin(dd / s * 9.0 - uTime * 2.2 + float(i));
      float halo = exp(-dd / (s * 1.4)) * (0.35 + 0.65 * ring);
      vec3 hc = mix(vec3(0.95, 0.75, 0.1), vec3(0.85, 0.95, 0.45), ring);
      add += hc * halo * 0.7 + vec3(1.0, 0.85, 0.25) * smoothstep(s * 0.5, 0.0, dd) * 1.1;
    }
    vec2 mc = vec2(0.62, 0.48); float mr = 0.055, md = length(q - mc);                 // the moon: a crescent in an orange sun-like halo
    float disk = smoothstep(mr, mr * 0.9, md);
    float cut = smoothstep(mr * 0.75, mr * 0.95, length(q - mc - vec2(-0.028, 0.02)));
    float mring = 0.5 + 0.5 * sin(md / mr * 7.0 - uTime * 1.5);
    add += vec3(0.95, 0.5, 0.05) * exp(-md / (mr * 1.6)) * (0.5 + 0.5 * mring) * 0.9;
    add += vec3(1.0, 0.7, 0.1) * disk * (0.3 + 0.9 * cut);
    float ph = fract(uTime / 9.0);                                                   // a shooting star every 9 s
    if (ph < 0.12) {
      vec2 a = vec2(-0.6, 0.62), b = vec2(0.05, 0.42), head = mix(a, b, ph / 0.12);
      vec2 ab = normalize(b - a); vec2 r = q - head; float t = dot(r, -ab), n = length(r + ab * t);
      add += vec3(1.0, 0.95, 0.8) * smoothstep(0.004, 0.0, n) * smoothstep(0.18, 0.0, t) * step(0.0, t) * 2.0;
    }
    c += add;
    c = mix(vec3(0.03, 0.06, 0.18), c, smoothstep(-0.05, 0.02, q.y));
    gl_FragColor = vec4(pow(c, vec3(2.2)), 1.0);
  }`;

export default function starryNight({ scene, camera, renderer, options = {} }) {
  const ticks = [];
  const anchors = {};
  const m = (hex, o = {}) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.9, metalness: 0, ...o });
  const shadowy = (o) => { o.castShadow = true; o.receiveShadow = true; return o; };
  const add = (o) => { scene.add(o); return o; };
  const e3 = new THREE.Euler(), qq = new THREE.Quaternion(), mt = new THREE.Matrix4(), v3 = new THREE.Vector3(), one3 = new THREE.Vector3(1, 1, 1);

  // ---------------------------------------------------------------- sky, light
  const skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, depthTest: false,
    uniforms: { uTime: { value: 0 }, uSwirl: { value: options.swirl ?? 1 } } });
  const sky = add(new THREE.Mesh(new THREE.SphereGeometry(500, 64, 32), skyMat));
  sky.renderOrder = -10; sky.frustumCulled = false;
  sky.onBeforeRender = (r, s, cam) => { sky.position.copy(cam.position); sky.updateMatrixWorld(); };

  add(new THREE.HemisphereLight(0x4a6ad0, 0x1a2240, 1.3));
  const moonLight = add(new THREE.DirectionalLight(0xc8d4ff, 1.6));
  moonLight.position.set(60, 70, -90); moonLight.castShadow = true;
  moonLight.shadow.mapSize.set(4096, 4096);
  Object.assign(moonLight.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 300 });
  moonLight.shadow.bias = -0.0005; moonLight.shadow.normalBias = 0.05;
  add(moonLight.target);

  // ---------------------------------------------------------------- the land
  const gGeo = new THREE.PlaneGeometry(700, 700, 280, 280);
  gGeo.rotateX(-Math.PI / 2);
  const gp = gGeo.attributes.position, gCol = new Float32Array(gp.count * 3);
  const LAND = [C('#1f3f6a'), C('#2f5a5a'), C('#3f6a4a'), C('#1a3050'), C('#4a6a3a')];
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i), y = groundY(x, z);
    gp.setY(i, y);
    const n = fbm(x * 0.04 + 9, z * 0.04), k = Math.min(4, Math.floor(n * 6));
    const c = LAND[k].clone().lerp(C('#253a7a'), smooth(10, 40, y));          // the far hills turn blue-violet
    c.lerp(C('#8a7030'), smooth(13.5, 17, z) * smooth(-60, -40, -z) * 0.75);  // the wheat field's earth
    if (Math.abs(x + 9.5) < 4.2 && z < 2 && z > -44) c.lerp(C('#4a5a9a'), 0.8);  // the café's street
    gCol.set([c.r, c.g, c.b], i * 3);
  }
  gGeo.setAttribute('color', new THREE.BufferAttribute(gCol, 3));
  gGeo.computeVertexNormals();
  const ground = add(new THREE.Mesh(gGeo, brushy(m('#ffffff', { vertexColors: true }), { freq: 0.5, along: [1, 0.6, 1], amount: 0.6 })));
  ground.receiveShadow = true;

  // ---------------------------------------------------------------- the village
  const windowMats = [0, 1, 2, 3].map(() => new THREE.MeshStandardMaterial({ color: '#3a2a10', emissive: '#ffc840', emissiveIntensity: 2.2 }));
  const WALLS = ['#8a98c0', '#a0aac8', '#6f80b0', '#b8b098', '#9a8fb0'], ROOFS = ['#2a3a70', '#4a3a6a', '#3a4a6a', '#8a5a3a', '#2f4f5f'];
  const winGeo = new THREE.PlaneGeometry(0.55, 0.75);
  function house(x, z, w, d, h, turn = 0, wall = pick(WALLS), roof = pick(ROOFS)) {
    const g = new THREE.Group();
    const body = shadowy(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), brushy(m(wall), { freq: 3, along: [1, 0.4, 1] })));
    body.position.y = h / 2; g.add(body);
    const tri = new THREE.Shape([new THREE.Vector2(-w / 2 - 0.2, 0), new THREE.Vector2(w / 2 + 0.2, 0), new THREE.Vector2(0, h * 0.45)]);
    const rg = new THREE.ExtrudeGeometry(tri, { depth: d + 0.3, bevelEnabled: false }); rg.translate(0, 0, -(d + 0.3) / 2);
    const r = shadowy(new THREE.Mesh(rg, brushy(m(roof), { freq: 3, along: [1, 1, 0.3] }))); r.position.y = h; g.add(r);
    const wm = pick(windowMats);
    for (const [face, len, nrm] of [[d / 2 + 0.01, w, 'z'], [-d / 2 - 0.01, w, 'z'], [w / 2 + 0.01, d, 'x']]) {
      const n = Math.max(1, Math.floor(len / 1.6));
      for (let k = 0; k < n; k++) {
        if (rnd() < 0.35) continue;
        const win = new THREE.Mesh(winGeo, wm), along = (k + 0.5) / n * len - len / 2;
        if (nrm === 'z') { win.position.set(along, h * (0.4 + 0.25 * rnd()), face); if (face < 0) win.rotation.y = Math.PI; }
        else { win.position.set(face, h * (0.4 + 0.25 * rnd()), along); win.rotation.y = Math.PI / 2; }
        g.add(win);
      }
    }
    g.position.set(x, groundY(x, z) - 0.05, z); g.rotation.y = turn;
    return add(g);
  }
  const taken = [[5, -6, 7], [-2, -32, 9], [-16, -9.5, 8.5], [10.8, -2.2, 4]];   // the Yellow House, the church, the café, the almond tree
  for (const [z, h] of [[-14, 6.2], [-19.5, 5.4], [-25, 6.8], [-30.5, 5.6]]) { house(-4.4, z, 3.2, 5, h, Math.PI, '#5a6aa8'); taken.push([-4.4, z, 3.5]); }   // the café's street
  for (const [z, h] of [[-19.8, 6.5], [-25.6, 7], [-31.5, 6]]) { house(-16.6, z, 4, 5.4, h, 0, '#4a5a98'); taken.push([-16.6, z, 3.8]); }
  for (let i = 0, n = 0; i < 400 && n < 52; i++) {
    const x = (rnd() - 0.5) * 70, z = -12 - rnd() * 40;
    if (taken.some(([tx, tz, r]) => Math.hypot(x - tx, z - tz) < r) || (Math.abs(x - 4) < 9 && z > -34) || (Math.abs(x + 9.5) < 5 && z > -46)) continue;   // the view from the bedroom window stays open
    const w = 3 + rnd() * 3, d = 3 + rnd() * 2.5;
    taken.push([x, z, Math.max(w, d) * 0.75 + 0.6]);
    house(x, z, w, d, 2.6 + rnd() * 2.6, (rnd() - 0.5) * 0.5); n++;
  }
  ticks.push((t) => windowMats.forEach((wm, i) => { wm.emissiveIntensity = lightsOn * (2.0 + 0.5 * Math.sin(t * (1.3 + i * 0.4) + i * 2) * Math.sin(t * 3.1 + i)); }));
  let lightsOn = 1;
  anchors.village = [-6, 9, -28];

  // the church: a nave, a tower, a steeple cutting the sky
  const church = new THREE.Group();
  const stone = brushy(m('#3a4a8a'), { freq: 2.5, along: [1, 0.3, 1] }), slate = brushy(m('#1a2350'), { freq: 3, along: [1, 1, 0.3] });
  const nave = shadowy(new THREE.Mesh(new THREE.BoxGeometry(5, 6, 13), stone)); nave.position.y = 3; church.add(nave);
  const naveRoof = shadowy(new THREE.Mesh(new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-2.8, 0), new THREE.Vector2(2.8, 0), new THREE.Vector2(0, 3)]), { depth: 13.4, bevelEnabled: false }), slate));
  naveRoof.position.set(0, 6, -6.7); church.add(naveRoof);
  const tower = shadowy(new THREE.Mesh(new THREE.BoxGeometry(3, 12, 3), stone)); tower.position.set(0, 6, 7.5); church.add(tower);
  const spire = shadowy(new THREE.Mesh(new THREE.ConeGeometry(2.1, 11, 4), slate)); spire.position.set(0, 17.5, 7.5); spire.rotation.y = Math.PI / 4; church.add(spire);
  for (const y of [3, 8]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.6), windowMats[0]); w.position.set(0, y, 9.02); church.add(w); }
  church.position.set(-2, groundY(-2, -32), -34);
  add(church);
  anchors.church = [-2, 25, -26.5];

  // dark trees among the houses
  const blob = new THREE.IcosahedronGeometry(1, 2);
  { const p = blob.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); v.multiplyScalar(1 + 0.3 * (fbm(v.x * 1.5 + 4, v.y * 1.5 + v.z) - 0.5)); p.setXYZ(i, v.x, v.y, v.z); }
    blob.computeVertexNormals(); }
  const treeMat = brushy(m('#2a5050', { emissive: '#0a1a28', emissiveIntensity: 1 }), { freq: 2, along: [1, 0.5, 1], amount: 0.7 });
  for (let i = 0; i < 40; i++) {
    const x = (rnd() - 0.5) * 90, z = -8 - rnd() * 55;
    if (taken.some(([tx, tz, r]) => Math.hypot(x - tx, z - tz) < r * 0.8) || (Math.abs(x - 4) < 10 && z > -36)) continue;
    const s = 1.5 + rnd() * 2, t = shadowy(new THREE.Mesh(blob, treeMat));
    t.scale.set(s, s * (1 + rnd() * 1.4), s); t.position.set(x, groundY(x, z) + s * 0.9, z);
    add(t);
  }

  // ---------------------------------------------------------------- the cypress: dark flames licking the sky
  const CYP = ['#2a6a42', '#3f7a48', '#557a34', '#80682c', '#2f6078', '#58904a', '#1f4a3a'];
  const prof = [];
  for (let i = 0; i <= 16; i++) { const t = i / 16; prof.push(new THREE.Vector2(Math.sin(Math.PI * Math.pow(t, 0.8)) * (1 - t * 0.6) + 0.02, t)); }
  const tongueGeo = new THREE.LatheGeometry(prof, 10);
  const cypress = new THREE.Group(), tongues = [];
  const CX = -11, CZ = 17, CH = 24;
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2, r = rnd() * 1.6 * (1 - i / 40);
    const h = CH * (0.35 + 0.65 * rnd()) * (i < 4 ? 1.1 : 1), w = 1.0 + rnd() * 1.4;
    const t = shadowy(new THREE.Mesh(tongueGeo, brushy(m(pick(CYP), { roughness: 0.95, emissive: '#10301f', emissiveIntensity: 1 }), { freq: 2.2, along: [1, 0.1, 1], amount: 1.3 })));
    t.scale.set(w, h, w * 0.8);
    t.position.set(Math.cos(a) * r, rnd() * 3, Math.sin(a) * r);
    cypress.add(t); tongues.push({ t, ph: rnd() * 6.28, h, lean: (rnd() - 0.5) * 0.12 });
  }
  cypress.position.set(CX, groundY(CX, CZ) - 0.5, CZ);
  add(cypress);
  anchors.cypress = [CX + 2, groundY(CX, CZ) + 12, CZ];
  ticks.push((t) => tongues.forEach(({ t: o, ph, h, lean }, i) => {
    o.rotation.z = lean + 0.07 * Math.sin(t * 1.4 + ph) + 0.04 * Math.sin(t * 3.3 + ph * 2);
    o.rotation.x = 0.06 * Math.sin(t * 1.1 + ph * 1.7);
    o.rotation.y = t * 0.1 + ph;
    o.scale.y = h * (1 + 0.05 * Math.sin(t * 2.5 + ph));
  }));

  // ---------------------------------------------------------------- the Yellow House, and in it the Bedroom
  const HX = 5, HZ = -6, W = 6, D = 5, H = 3.2, T = 0.2;               // inside: x 2 … 8, z -8.5 … -3.5
  const yellow = brushy(m('#e8b830'), { freq: 3, along: [1, 0.35, 1], amount: 0.5 });
  const violet = brushy(m('#8a98e0'), { freq: 4, along: [1, 0.3, 1], amount: 0.45 });   // the bedroom's pale violet walls
  const greenWood = brushy(m('#2f8a4a'), { freq: 5, along: [1, 0.2, 1] });
  const room = new THREE.Group(); room.position.set(HX, 0, HZ); add(room);
  // a wall: outside yellow, inside violet (two thin slabs), with optional openings (rectangles in its own x/y)
  function wall(len, along, at, holes = []) {
    const g = new THREE.Group();
    const pieces = [];
    const xs = [-len / 2, ...holes.flatMap((h) => [h.x - h.w / 2, h.x + h.w / 2]), len / 2].sort((a, b) => a - b);
    for (let i = 0; i < xs.length - 1; i++) {
      const x0 = xs[i], x1 = xs[i + 1], hole = holes.find((h) => Math.abs(h.x - (x0 + x1) / 2) < h.w / 2);
      if (!hole) pieces.push([x0, x1, 0, H]);
      else { if (hole.y0 > 0) pieces.push([x0, x1, 0, hole.y0]); pieces.push([x0, x1, hole.y1, H]); }
    }
    for (const [x0, x1, y0, y1] of pieces) {
      for (const [mat, off] of [[yellow, T * 0.75], [violet, T * 0.25]]) {
        const s = shadowy(new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, T / 2), mat));
        s.position.set((x0 + x1) / 2, (y0 + y1) / 2, off - T / 2);
        g.add(s);
      }
    }
    if (along === 'x') { g.position.set(0, 0, at); if (at < 0) g.rotation.y = Math.PI; }
    else { g.position.set(at, 0, 0); g.rotation.y = at > 0 ? Math.PI / 2 : -Math.PI / 2; }
    room.add(g);
    return g;
  }
  wall(W, 'x', D / 2, [{ x: 0, w: 1.5, y0: 0, y1: 2.4 }]);                        // front: the door
  wall(W, 'x', -D / 2, [{ x: 1.0, w: 1.3, y0: 1.0, y1: 2.3 }]);                    // back: the window (seen from inside: on the left)
  wall(D, 'z', W / 2); wall(D, 'z', -W / 2);
  const floor = shadowy(new THREE.Mesh(new THREE.BoxGeometry(W, 0.1, D), brushy(m('#b8704a'), { freq: 3.5, along: [0.25, 1, 1], amount: 0.7 })));
  floor.position.y = 0.05; room.add(floor);
  const ceil = new THREE.Mesh(new THREE.BoxGeometry(W, 0.1, D), brushy(m('#c8c8e8'), { freq: 3 })); ceil.position.y = H + 0.05; room.add(ceil);
  const roofTri = new THREE.Shape([new THREE.Vector2(-W / 2 - 0.4, 0), new THREE.Vector2(W / 2 + 0.4, 0), new THREE.Vector2(0, 1.6)]);
  const roof = shadowy(new THREE.Mesh(new THREE.ExtrudeGeometry(roofTri, { depth: D + 0.6, bevelEnabled: false }), brushy(m('#c0503a'), { freq: 3, along: [1, 1, 0.3] })));
  roof.position.set(0, H + 0.1, -(D + 0.6) / 2); room.add(roof);
  // the door (open, swung in against the wall), green shutters by the window
  const door = shadowy(new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.35, 0.06), brushy(m('#5a6ac8'), { freq: 5, along: [1, 0.2, 1] })));
  door.position.set(-0.75 - 0.03, 1.18, D / 2 - 0.75); door.rotation.y = Math.PI / 2; room.add(door);
  for (const s of [-1, 1]) {
    const sh = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.3, 0.05), greenWood));
    sh.position.set(-1.0 + s * 0.95, 1.65, -D / 2 - 0.15); room.add(sh);              // outside the window, open
  }
  // the bed: yellow wood, scarlet cover, pale green pillows
  const wood = brushy(m('#e0a030'), { freq: 6, along: [1, 0.3, 1] });
  const bed = new THREE.Group();
  const frame = (w, h, d, x, y, z, mat = wood) => { const b = shadowy(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)); b.position.set(x, y, z); bed.add(b); return b; };
  frame(1.5, 0.35, 2.0, 0, 0.4, 0);
  frame(1.6, 1.4, 0.1, 0, 0.7, -1.05); frame(1.6, 0.9, 0.1, 0, 0.45, 1.05);
  frame(1.42, 0.22, 1.5, 0, 0.66, 0.2, brushy(m('#d03a24'), { freq: 7, along: [1, 0.3, 0.4], amount: 0.6 }));
  frame(0.55, 0.16, 0.4, -0.35, 0.68, -0.75, brushy(m('#d8e090'), { freq: 8 })); frame(0.55, 0.16, 0.4, 0.35, 0.68, -0.75, brushy(m('#d8e090'), { freq: 8 }));
  frame(1.42, 0.12, 0.45, 0, 0.6, -0.75, brushy(m('#f0e8c0'), { freq: 8 }));
  bed.position.set(2.15, 0.05, -1.35); room.add(bed);
  // two chairs: yellow wood, rush seats
  function chair(x, z, turn) {
    const c = new THREE.Group(), seat = brushy(m('#d8b048'), { freq: 12, along: [1, 1, 0.2] });
    const part = (w, h, d, px, py, pz, mat = wood) => { const b = shadowy(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)); b.position.set(px, py, pz); c.add(b); };
    part(0.48, 0.05, 0.45, 0, 0.47, 0, seat);
    for (const [px, pz] of [[-0.21, -0.19], [0.21, -0.19], [-0.21, 0.19], [0.21, 0.19]]) part(0.05, pz < 0 ? 1.0 : 0.47, 0.05, px, pz < 0 ? 0.5 : 0.235, pz);
    for (const y of [0.7, 0.88]) part(0.44, 0.05, 0.04, 0, y, -0.19);
    c.position.set(x, 0.1, z); c.rotation.y = turn; room.add(c);
    return c;
  }
  const vgChair = chair(-1.9, -0.6, 0.8); chair(0.9, 1.3, -2.6);
  // the little table by the window: a jug, a basin, bottles
  const table = new THREE.Group();
  const tw = brushy(m('#e8c060'), { freq: 6 });
  const tp = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.6), tw)); tp.position.y = 0.72; table.add(tp);
  for (const [x, z] of [[-0.35, -0.25], [0.35, -0.25], [-0.35, 0.25], [0.35, 0.25]]) { const l = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.72, 0.05), tw)); l.position.set(x, 0.36, z); table.add(l); }
  const blue = brushy(m('#3a6ad0', { roughness: 0.4 }), { freq: 10 });
  const jug = shadowy(new THREE.Mesh(new THREE.LatheGeometry([0.02, 0.09, 0.1, 0.07, 0.05, 0.07].map((r, i) => new THREE.Vector2(r, i * 0.06)), 14), blue)); jug.position.set(0.12, 0.75, -0.18); table.add(jug);
  const basin = shadowy(new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), blue)); basin.position.set(0.28, 0.86, 0.14); basin.rotation.x = Math.PI; table.add(basin);
  for (const [x, c] of [[0.3, '#4a8a3a'], [0.24, '#c86a2a']]) { const b = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.22, 10), m(c, { roughness: 0.3 }))); b.position.set(x, 0.86, -0.18); table.add(b); }
  table.position.set(-2.2, 0.05, -2.0); room.add(table);
  // paintings on the walls, a mirror, a towel
  const frames = [];
  function picture(w, h, x, y, z, turn, colors) {
    const g = new THREE.Group();
    g.add(shadowy(new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, h + 0.1, 0.04), m('#7a5a30'))));
    colors.forEach((c, i) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h / colors.length), brushy(m(c), { freq: 14, amount: 0.8 })); p.position.set(0, h / 2 - (i + 0.5) * h / colors.length, 0.025); g.add(p); });
    g.position.set(x, y, z); g.rotation.y = turn; room.add(g); frames.push(g);
  }
  picture(0.55, 0.7, W / 2 - 0.15, 2.15, -1.6, -Math.PI / 2, ['#5a8ad0', '#e8c070', '#3a6a4a']);   // portraits over the bed
  picture(0.55, 0.7, W / 2 - 0.15, 2.15, -0.8, -Math.PI / 2, ['#d8a040', '#c85a3a', '#2a4a8a']);
  picture(0.7, 0.5, W / 2 - 0.15, 1.5, 0.4, -Math.PI / 2, ['#8ab0e0', '#e0c060', '#6a9a5a']);
  picture(0.5, 0.42, 2.0, 2.3, -D / 2 + 0.15, 0, ['#e0b040', '#4a7ad0']);
  picture(0.4, 0.55, -W / 2 + 0.15, 1.7, -1.2, Math.PI / 2, ['#c8d8f0', '#a0b8d8']);                 // the mirror
  const towel = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.6, 0.35), brushy(m('#6aa05a'), { freq: 10, along: [1, 0.2, 1] })));
  towel.position.set(-W / 2 + 0.14, 1.55, -0.3); room.add(towel);
  // warm light in the room; the room's windows glow from outside
  const lamp = new THREE.PointLight(0xffc070, 18, 12, 1.6); lamp.position.set(0, 2.7, -0.5); room.add(lamp);
  const glow = new THREE.PointLight(0xffb040, 6, 9, 1.5); glow.position.set(0, 1.4, D / 2 + 1.2); room.add(glow);
  ticks.push((t) => { lamp.intensity = 18 + 2.5 * Math.sin(t * 2.3) * Math.sin(t * 5.1); });

  const at = (x, y, z) => [HX + x, y, HZ + z];
  Object.assign(anchors, {
    house: at(0, H + 2.2, 0), door: at(0, 2.7, D / 2), bed: at(2.15, 1.5, -1.35), chairs: at(0.9, 1.25, 1.3),
    table: at(-2.2, 1.25, -2.0), window: at(-1.0, 2.55, -D / 2), paintings: at(W / 2 - 0.1, 2.7, -1.2),
  });

  // ================================================================ more of his paintings, in the same world
  const bird = new THREE.BufferGeometry();
  bird.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.12, -0.35, 0.05, -0.05, 0, 0, -0.08, 0, 0, 0.12, 0, 0, -0.08, 0.35, 0.05, -0.05], 3));
  bird.computeVertexNormals();
  function figure(coat, skin = '#e0b890', h = 1.7) {                 // a little painted person
    const g = new THREE.Group();
    const body = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, h * 0.62, 10), brushy(m(coat), { freq: 9, along: [1, 0.25, 1] })));
    body.position.y = h * 0.31 + h * 0.18; g.add(body);
    const legs = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, h * 0.3, 8), m('#1a2040'))); legs.position.y = h * 0.15; g.add(legs);
    const head = shadowy(new THREE.Mesh(new THREE.SphereGeometry(h * 0.075, 12, 10), m(skin))); head.position.y = h * 0.88; g.add(head);
    const hat = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(h * 0.06, h * 0.1, h * 0.05, 12), m('#20203a'))); hat.position.y = h * 0.95; g.add(hat);
    g.userData.body = body;
    return g;
  }

  // ---------------------------------------------------------------- Wheatfield with Crows (1890): the hill is a wheat field
  const wheatTime = { value: 0 };
  const wheatMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, emissive: '#5a4010', emissiveIntensity: 1 });
  wheatMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = wheatTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 base = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float wave = sin(base.x * 0.22 + base.z * 0.17 - uTime * 1.7) + 0.6 * sin(base.x * 0.61 - uTime * 2.6 + base.z * 0.33);
        float k = position.y * position.y;
        transformed.x += wave * 0.22 * k; transformed.z += wave * 0.1 * k;`);
  };
  wheatMat.customProgramCacheKey = () => 'wheat';
  const wheatGeo = new THREE.CylinderGeometry(0.02, 0.006, 1, 3, 2); wheatGeo.translate(0, 0.5, 0);
  const pathX = (z) => 3 + 5 * Math.sin(z * 0.08);
  const NW = 70000, wheat = new THREE.InstancedMesh(wheatGeo, wheatMat, NW);
  const WHEAT = ['#d8a830', '#f0c840', '#c88f20', '#ffe070', '#a87820', '#e8b838', '#f8d858', '#b89030'];
  for (let i = 0, n = 0; n < NW && i < NW * 3; i++) {
    const x = (rnd() - 0.5) * 110, z = 14.8 + rnd() * 50;
    if (Math.hypot(x - CX, z - CZ) < 3.5 || Math.abs(x - pathX(z)) < 1.0) continue;
    if (Math.hypot(x - 5, z - 42) < 7) continue;                    // a clearing where the viewer stands
    const h = 0.8 + rnd() * 0.45;
    e3.set((rnd() - 0.5) * 0.2, rnd() * 6.28, (rnd() - 0.5) * 0.2);
    wheat.setMatrixAt(n, mt.compose(new THREE.Vector3(x, groundY(x, z) - 0.05, z), qq.setFromEuler(e3), new THREE.Vector3(1, h, 1)));
    wheat.setColorAt(n, C(pick(WHEAT)));
    n++;
  }
  wheat.receiveShadow = true;
  add(wheat);
  ticks.push((t) => { wheatTime.value = t; });
  // the crows: a ragged flock wheeling over the field
  const crows = [];
  for (let i = 0; i < 18; i++) {
    const c = add(new THREE.Mesh(bird, m('#07070f', { side: THREE.DoubleSide })));
    c.scale.setScalar(0.9 + rnd() * 0.4);
    crows.push({ c, r: 2 + rnd() * 6, ph: rnd() * 6.28, sp: 0.4 + rnd() * 0.4, dy: rnd() * 2.5 });
  }
  const flock = (t) => new THREE.Vector3(7 * Math.sin(t * 0.11), 12 + Math.sin(t * 0.3), 13 + 5 * Math.cos(t * 0.09));
  ticks.push((t) => crows.forEach(({ c, r, ph, sp, dy }, i) => {
    const at = (tt) => flock(tt).add(new THREE.Vector3(Math.cos(tt * sp + ph) * r, dy + 0.6 * Math.sin(tt * 1.3 + ph), Math.sin(tt * sp * 1.3 + ph) * r * 0.6));
    const p = at(t); c.position.copy(p); c.lookAt(at(t + 0.05));
    c.scale.y = c.scale.x * (0.3 + 0.7 * Math.abs(Math.sin(t * 7 + ph)));
  }));
  anchors.crows = () => flock(skyMat.uniforms.uTime.value).add(new THREE.Vector3(0, 2, 0));

  // ---------------------------------------------------------------- Starry Night Over the Rhône (1888): the river, its gas lamps, a couple
  const LAMPS = [-30, -21, -13, -3, 9, 18, 27];
  const riverMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uLamps: { value: LAMPS } },
    vertexShader: 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float uTime; uniform float uLamps[${LAMPS.length}]; varying vec3 vW;
      ${NOISE}
      void main() {
        float n = vgNoise(vec3(vW.x * 0.7, vW.z * 5.0, uTime * 0.3));
        vec3 c = mix(vec3(0.03, 0.08, 0.30), vec3(0.10, 0.24, 0.58), n);
        c += 0.05 * sin(vW.z * 26.0 + n * 6.0);
        float near = vW.z - ${(RZ - 2.6).toFixed(2)};
        for (int i = 0; i < ${LAMPS.length}; i++) {
          float dx = vW.x - uLamps[i] + 0.22 * sin(vW.z * 8.0 + uTime * 2.6 + float(i)) * near;
          float streak = exp(-abs(dx) / (0.16 + 0.07 * near)) * smoothstep(6.0, 0.0, near);
          float broken = step(0.4, vgNoise(vec3(vW.x * 3.0, vW.z * 9.0 - uTime * 2.2, float(i))));
          c += mix(vec3(1.0, 0.72, 0.2), vec3(0.6, 0.9, 0.3), step(0.8, n)) * streak * (0.35 + 1.1 * broken);
        }
        gl_FragColor = vec4(pow(max(c, 0.0), vec3(2.2)), 1.0);
      }`,
  });
  const river = add(new THREE.Mesh(new THREE.PlaneGeometry(160, 7, 1, 1), riverMat));
  river.rotation.x = -Math.PI / 2; river.position.set(0, -0.35, RZ);
  ticks.push((t) => { riverMat.uniforms.uTime.value = t; });
  const lampGlass = new THREE.MeshStandardMaterial({ color: '#3a2a10', emissive: '#ffd060', emissiveIntensity: 3 });
  for (const x of LAMPS) {
    const z = RZ - 3.3, y = groundY(x, z);
    const post = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 3.2, 8), m('#1a1f3a'))); post.position.set(x, y + 1.6, z); add(post);
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), lampGlass); glass.position.set(x, y + 3.3, z); add(glass);
  }
  const couple = [figure('#2a3a7a'), figure('#d8c8a0', '#e8c8a0', 1.6)];
  couple.forEach((f) => add(f));
  ticks.push((t) => couple.forEach((f, i) => {
    const x = 14 * Math.sin(t * 0.05) + i * 0.55, z = RZ + 3.7;
    f.position.set(x, groundY(x, z), z + i * 0.1);
    f.rotation.y = Math.cos(t * 0.05) > 0 ? Math.PI / 2 : -Math.PI / 2;
    f.userData.body.rotation.z = 0.05 * Math.sin(t * 6 + i * 3);
  }));
  anchors.river = () => couple[0].position.clone().add(new THREE.Vector3(0, 2.4, 0));
  for (const [x, col, turn] of [[-17, '#3a7ad0', 0.2], [-14.2, '#e08a2a', -0.15], [-11.6, '#4a9a5a', 0.1]]) {   // boats pulled up on the bank
    const hull = shadowy(new THREE.Mesh(new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), brushy(m(col, { side: THREE.DoubleSide }), { freq: 6 })));
    hull.scale.set(0.6, 0.35, 1.9); hull.rotation.y = turn; hull.position.set(x, groundY(x, RZ + 3.4) + 0.3, RZ + 3.4); add(hull);
  }

  // ---------------------------------------------------------------- Café Terrace at Night (1888): a street in the village
  const cafe = new THREE.Group(); add(cafe);
  const cafeWall = shadowy(new THREE.Mesh(new THREE.BoxGeometry(4.5, 8, 14), brushy(m('#3a4a8a'), { freq: 2.5, along: [1, 0.3, 1] })));
  cafeWall.position.set(-16.25, 4, -9.5); cafe.add(cafeWall);
  const glowWall = new THREE.Mesh(new THREE.PlaneGeometry(13, 3.4), brushy(m('#3a2a10', { emissive: '#ffb030', emissiveIntensity: 1.3 }), { freq: 4, along: [1, 0.3, 1], amount: 0.7 }));
  glowWall.rotation.y = Math.PI / 2; glowWall.position.set(-13.98, 1.7, -9.5); cafe.add(glowWall);
  for (const z of [-5, -8.5, -12, -15]) {                              // dark doors and windows in the lit wall
    const d = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.2), m('#2a1a10')); d.rotation.y = Math.PI / 2; d.position.set(-13.96, 1.1, z); cafe.add(d);
  }
  for (let k = 0; k < 4; k++) for (const z of [-5, -8.5, -12, -15]) {   // the upper windows
    const w = new THREE.Mesh(winGeo, rnd() < 0.5 ? windowMats[k] : m('#20305a')); w.rotation.y = Math.PI / 2; w.position.set(-13.96, 4.5 + k * 0.9 * 0, z + (k - 1.5) * 0.4 * 0); if (k) continue; cafe.add(w);
  }
  const awning = shadowy(new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 12.5), brushy(m('#f0b020', { emissive: '#ffa010', emissiveIntensity: 0.55 }), { freq: 5, along: [0.3, 1, 1], amount: 0.6 })));
  awning.rotation.z = -0.35; awning.position.set(-12.85, 3.75, -9.5); cafe.add(awning);
  const valance = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.45, 12.5), brushy(m('#e89018', { emissive: '#ff9010', emissiveIntensity: 0.5 }), { freq: 6 })));
  valance.position.set(-11.72, 3.15, -9.5); cafe.add(valance);
  const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.5, 0.35), new THREE.MeshStandardMaterial({ color: '#4a3a10', emissive: '#ffd040', emissiveIntensity: 4 }));
  lantern.position.set(-12.5, 3.0, -5.5); cafe.add(lantern);
  const cafeLight = new THREE.PointLight(0xffb040, 70, 22, 1.4); cafeLight.position.set(-12.3, 2.9, -6.5); cafe.add(cafeLight);
  ticks.push((t) => { cafeLight.intensity = 70 + 8 * Math.sin(t * 4.1) * Math.sin(t * 2.3); });
  const terrace = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.04, 12.5), brushy(m('#d8a040'), { freq: 5, along: [1, 1, 0.35], amount: 0.7 }));
  terrace.position.set(-12.2, 0.03, -9.5); cafe.add(terrace);
  const cobbles = new THREE.Mesh(new THREE.BoxGeometry(8, 0.03, 46), brushy(m('#4a5a9a'), { freq: 4, along: [1, 1, 1], amount: 0.9 }));
  cobbles.position.set(-9.5, 0.01, -21); cobbles.receiveShadow = true; cafe.add(cobbles);
  const linen = m('#f2ead8'), dark = m('#2a2a3a');
  const seated = [];
  for (const [x, z] of [[-12.9, -4.6], [-11.6, -6.6], [-12.9, -8.6], [-11.5, -10.8], [-12.8, -12.8], [-11.7, -14.6]]) {
    const top = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 20), linen)); top.position.set(x, 0.75, z); cafe.add(top);
    const leg = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.75, 8), dark)); leg.position.set(x, 0.37, z); cafe.add(leg);
    if (rnd() < 0.7) {
      const f = figure(pick(['#2a3a6a', '#5a3a2a', '#3a5a4a', '#6a5a8a']), '#e0b890', 1.3);
      f.position.set(x + 0.55, 0.05, z + 0.2); f.rotation.y = -Math.PI / 2; cafe.add(f); seated.push(f);
    }
  }
  const waiter = figure('#f4f0e6', '#e8c8a0', 1.75); cafe.add(waiter);
  ticks.push((t) => {
    const z = -9.5 + 4.8 * Math.sin(t * 0.32);
    waiter.position.set(-11.0, 0.05, z); waiter.rotation.y = Math.cos(t * 0.32) > 0 ? 0 : Math.PI;
    waiter.userData.body.rotation.x = 0.05 * Math.sin(t * 7);
    seated.forEach((f, i) => { f.rotation.y = -Math.PI / 2 + 0.25 * Math.sin(t * 0.5 + i * 2); });
  });
  anchors.cafe = [-12.6, 4.6, -7];

  // ---------------------------------------------------------------- Almond Blossom (1890): a flowering tree by the Yellow House
  const AX = 10.8, AZ = -2.2;
  const bark = brushy(m('#4a3a3a'), { freq: 8, along: [1, 0.2, 1] });
  const blossomPts = [];
  const up = new THREE.Vector3(0, 1, 0);
  function limb(p0, dir, len, r, depth) {
    const p1 = p0.clone().add(dir.clone().multiplyScalar(len));
    const seg = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r, len, 7), bark));
    seg.position.copy(p0).add(p1).multiplyScalar(0.5);
    seg.quaternion.setFromUnitVectors(up, dir.clone().normalize());
    add(seg);
    if (depth >= 2) for (let k = 0; k < 6; k++) blossomPts.push(p0.clone().lerp(p1, 0.3 + 0.7 * rnd()).add(new THREE.Vector3((rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3)));
    if (depth >= 4) return;
    const n = depth === 0 ? 3 : 2 + (rnd() < 0.5 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const d = dir.clone().add(new THREE.Vector3((rnd() - 0.5) * 1.4, (rnd() - 0.2) * 0.8, (rnd() - 0.5) * 1.4)).normalize();
      limb(p1, d, len * (0.6 + rnd() * 0.25), r * 0.62, depth + 1);
    }
  }
  limb(new THREE.Vector3(AX, groundY(AX, AZ), AZ), new THREE.Vector3(0.15, 1, -0.1).normalize(), 2.0, 0.22, 0);
  const blossoms = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.075, 0), m('#ffffff', { emissive: '#b8a8b8', emissiveIntensity: 1 }), blossomPts.length);
  blossomPts.forEach((p, i) => { blossoms.setMatrixAt(i, mt.compose(p, qq.identity(), new THREE.Vector3(1, 0.7, 1).multiplyScalar(0.8 + rnd() * 0.6))); blossoms.setColorAt(i, C(pick(['#fbf6f0', '#f6e8f0', '#ffffff', '#f4d8e4', '#e8f0f6']))); });
  add(blossoms);
  const NPET = 160, petals = add(new THREE.InstancedMesh(new THREE.PlaneGeometry(0.07, 0.05), m('#fbeef4', { side: THREE.DoubleSide, emissive: '#b8a8b8', emissiveIntensity: 1 }), NPET));
  const pet = Array.from({ length: NPET }, () => ({ s: pick(blossomPts), sp: 0.25 + rnd() * 0.3, ph: rnd() * 50 }));
  ticks.push((t) => {
    pet.forEach((p, i) => {
      const fall = (t * p.sp + p.ph) % 5, y = p.s.y - fall;
      const x = p.s.x + 0.5 * Math.sin(t * 0.8 + p.ph) + fall * 0.3, z = p.s.z + 0.3 * Math.cos(t * 0.6 + p.ph);
      e3.set(t * 2 + p.ph, t + p.ph, 0);
      petals.setMatrixAt(i, mt.compose(v3.set(x, Math.max(y, groundY(x, z) + 0.02), z), qq.setFromEuler(e3), one3));
    });
    petals.instanceMatrix.needsUpdate = true;
  });
  anchors.almond = [AX, 5.2, AZ];

  // ---------------------------------------------------------------- Sunflowers (1888): a vase in the bedroom, a patch by the door
  const petalGeo = new THREE.SphereGeometry(1, 8, 6); petalGeo.scale(0.022, 0.006, 0.06); petalGeo.translate(0, 0, 0.09);
  const PET = ['#f2c020', '#e8a818', '#f6d040', '#d89018'].map((c) => brushy(m(c, { emissive: '#3a2800', emissiveIntensity: 1 }), { freq: 30 }));
  const seedMat = brushy(m('#6a4020'), { freq: 40 }), stemMat = brushy(m('#5a8a3a'), { freq: 20, along: [1, 0.2, 1] });
  function sunflower(scale, droop) {
    const head = new THREE.Group();
    const disc = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.03, 16), seedMat)); disc.rotation.x = Math.PI / 2; head.add(disc);
    const n = 16 + Math.floor(rnd() * 6), mat = pick(PET);
    for (let k = 0; k < n; k++) {
      const p = shadowy(new THREE.Mesh(petalGeo, mat));
      p.rotation.set(0, 0, (k / n) * Math.PI * 2); p.rotateX(Math.PI / 2 - 0.2 - droop * rnd()); head.add(p);
    }
    head.scale.setScalar(scale);
    return head;
  }
  const swaying = [];
  // the vase on the bedroom table
  const vase = shadowy(new THREE.Mesh(new THREE.LatheGeometry([0.06, 0.1, 0.11, 0.09, 0.06, 0.08].map((r, i) => new THREE.Vector2(r, i * 0.06)), 16), brushy(m('#e8b020'), { freq: 14 })));
  vase.position.set(-0.22, 0.75, 0.02); table.add(vase);
  for (let k = 0; k < 13; k++) {
    const a = rnd() * Math.PI * 2, tilt = 0.25 + rnd() * 0.8, len = 0.25 + rnd() * 0.3;
    const dir = new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt));
    const base = new THREE.Vector3(-0.22, 1.05, 0.02), tip = base.clone().add(dir.clone().multiplyScalar(len));
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, len, 5), stemMat);
    stem.position.copy(base).add(tip).multiplyScalar(0.5); stem.quaternion.setFromUnitVectors(up, dir); table.add(stem);
    const head = sunflower(0.9 + rnd() * 0.5, k % 3 ? 0.4 : 1.4);
    head.position.copy(tip); head.lookAt(tip.clone().add(dir).add(new THREE.Vector3(0, 0, 0.8))); table.add(head);
  }
  // tall sunflowers in front of the house, left of the door
  for (let k = 0; k < 9; k++) {
    const x = HX - 2.6 + rnd() * 1.4, z = HZ + D / 2 + 0.7 + rnd() * 1.6, h = 1.5 + rnd() * 0.8;
    const stem = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, h, 6), stemMat)); stem.position.set(x, h / 2, z); add(stem);
    const head = sunflower(2.6 + rnd(), 0.5); head.position.set(x, h, z + 0.05); head.rotation.y = 0.3 * (rnd() - 0.5); add(head);
    swaying.push({ head, ph: rnd() * 6, ry: head.rotation.y });
  }
  ticks.push((t) => swaying.forEach(({ head, ph, ry }) => { head.rotation.y = ry + 0.15 * Math.sin(t * 0.9 + ph); head.rotation.x = 0.1 * Math.sin(t * 1.3 + ph); }));
  anchors.sunflowers = at(-2.4, 1.6, -2.0);

  // ---------------------------------------------------------------- Van Gogh's Chair (1888): his pipe and tobacco on the seat
  const pipeMat = m('#3a2418', { roughness: 0.5 });
  const bowl = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.06, 10), pipeMat)); bowl.position.set(0.05, 0.53, 0.02); vgChair.add(bowl);
  const stemP = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 6), pipeMat)); stemP.rotation.z = Math.PI / 2.2; stemP.position.set(-0.04, 0.52, 0.02); vgChair.add(stemP);
  const pouch = shadowy(new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), brushy(m('#d8d0b8'), { freq: 30 }))); pouch.scale.set(1, 0.35, 0.8); pouch.position.set(-0.08, 0.51, -0.08); vgChair.add(pouch);
  anchors.chair = at(-1.9, 1.2, -0.6);

  // ---------------------------------------------------------------- the painter, the api
  const painter = options.painted === false ? null : createVanGogh(renderer);
  const t0 = performance.now() / 1000;
  const pose = (position, target, fov = 50) => ({ position, target, fov });
  return {
    poses: {
      painting: pose([0, 9.5, 34], [3, 16, -40], 55),
      wheat: pose([5, 8.4, 42], [1, 9.0, 4], 56),
      river: pose([-7, 1.9, RZ + 4.6], [-3, 2.6, -8], 58),
      cafe: pose([-8.4, 1.69, 3.18], [-13.58, 3.61, -18.12], 55),    // (looking down the street; what is dropped in the editor lands at the target)
      almond: pose([AX - 2.6, 1.3, AZ + 3.4], [AX + 0.3, 4.6, AZ - 0.6], 58),
      sunflowers: pose([HX - 1.6, 1.4, HZ - 0.5], [HX - 2.45, 1.12, HZ - 2.0], 42),
      chair: pose([HX - 0.8, 1.35, HZ + 0.7], [HX - 1.9, 0.45, HZ - 0.6], 48),
      village: pose([12, 7, 6], [-2, 3, -28], 50),
      church: pose([7, 5, -14], [-2, 13, -32], 50),
      cypress: pose([-1, 7, 30], [CX, 13, CZ], 50),
      sky: pose([0, 6, 22], [0, 40, -40], 65),
      door: pose([HX, 1.7, 1.5], [HX, 1.5, HZ], 55),
      bedroom: pose([HX - 0.2, 1.65, HZ + D / 2 - 0.35], [HX + 1.2, 1.0, HZ - D / 2], 68),
      bed: pose([HX + 0.2, 1.9, HZ + 0.6], [HX + 2.2, 0.6, HZ - 1.6], 55),
      window: pose([HX - 1.0, 1.25, HZ - D / 2 + 1.4], [HX - 1.0, 10, HZ - 30], 62),
    },
    anchors: {
      ...anchors,
      moon: () => skyPoint(0.62, 0.48 + 0.08),
      star: () => skyPoint(0.32, 0.50 + 0.07),
      swirl: () => skyPoint(-0.1, 0.34 + 0.1),
    },
    actions: {
      swirl({ to = 1 }) { const from = skyMat.uniforms.uSwirl.value; return (p) => { skyMat.uniforms.uSwirl.value = from + (to - from) * p; }; },
      lights({ to = 1 }) { const from = lightsOn; return (p) => { lightsOn = from + (to - from) * p; lamp.visible = glow.visible = lightsOn > 0.05; }; },
    },
    frame(now) {
      const t = now - t0;
      skyMat.uniforms.uTime.value = t;
      for (const f of ticks) f(t);
    },
    ...(painter && {
      render: (r, sc, cam) => painter.render(sc, cam, performance.now() / 1000 - t0),
      dispose: () => painter.dispose(),
    }),
  };

  // a point far away in the sky, in the direction (azimuth u, elevation v) seen from the camera
  function skyPoint(u, v) {
    const d = new THREE.Vector3(Math.sin(u) * Math.cos(v), Math.sin(v), -Math.cos(u) * Math.cos(v));
    return camera.position.clone().add(d.multiplyScalar(300));
  }
}

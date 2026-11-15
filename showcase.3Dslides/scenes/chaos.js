// Mechanics: sensitive dependence on initial conditions. 40 double pendulums hang from one pivot, started a
// thousandth of a radian apart (a rainbow, red to violet): for a few seconds they swing as one, then they fan out.
// Beside them, two live figures: the phase space (sin θ1, sin θ2, ω1), where 40 trajectories start as one curve
// and come apart; and the separation log10 |δ(t)| between neighbours, drawn as time goes, with its least-squares
// line: the slope is the Lyapunov exponent. Integrated (RK4) as the frames go. White studio.
// The arms start at 1.5 rad: the energy keeps the bobs below the beam (they never swing over it).
//
// Units: metres, y up; the pivot at (0, 2.2, 0), arms 0.75 m; the phase box centred on (3.4, 1.75, 0), the plot
// centred on (3.4, 0.45, 0).
// sceneOptions: { n: 40, spread: 3e-3 (rad between neighbours), angle: 1.5 (rad) }
// poses: whole, fan, phase, plot; anchors: pivot, fan, first, last, phase, axis1, axis2, axis3, plot, slope,
//          eqPendulum, eqFan, eqPhase, eqPlot (where the equations go)
import * as THREE from 'three';
import { paperStudio } from '../../code/src/scenes/gltf_utils.js';

const G = 9.81, L = 0.75;
function deriv(a, b, w1, w2, out) {                       // equal masses and lengths
  const d = a - b, den = 3 - Math.cos(2 * d);
  out[0] = w1; out[1] = w2;
  out[2] = (-3 * G * Math.sin(a) - G * Math.sin(a - 2 * b) - 2 * Math.sin(d) * (w2 * w2 * L + w1 * w1 * L * Math.cos(d))) / (L * den);
  out[3] = (2 * Math.sin(d) * (2 * w1 * w1 * L + 2 * G * Math.cos(a) + w2 * w2 * L * Math.cos(d))) / (L * den);
}
const k1 = [0, 0, 0, 0], k2 = [0, 0, 0, 0], k3 = [0, 0, 0, 0], k4 = [0, 0, 0, 0];
function rk4(s, h) {
  deriv(s[0], s[1], s[2], s[3], k1);
  deriv(s[0] + k1[0] * h / 2, s[1] + k1[1] * h / 2, s[2] + k1[2] * h / 2, s[3] + k1[3] * h / 2, k2);
  deriv(s[0] + k2[0] * h / 2, s[1] + k2[1] * h / 2, s[2] + k2[2] * h / 2, s[3] + k2[3] * h / 2, k3);
  deriv(s[0] + k3[0] * h, s[1] + k3[1] * h, s[2] + k3[2] * h, s[3] + k3[3] * h, k4);
  for (let i = 0; i < 4; i++) s[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
}

export default function chaos({ scene, renderer, options = {} }) {
  scene.background = new THREE.Color('#ffffff');
  paperStudio(scene, renderer, { extent: 3.2, keyDir: [-0.4, 1.3, 1.0], shadowOpacity: 0.08, center: new THREE.Vector3(1.4, 1.2, 0) });
  const N = options.n ?? 40, spread = options.spread ?? 3e-3, a0 = options.angle ?? 1.5;
  const PIVOT = new THREE.Vector3(0, 2.2, 0);
  const steel = new THREE.MeshStandardMaterial({ color: '#3a3a3c', metalness: 0.6, roughness: 0.35 });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.05, 0.05), steel); beam.position.set(0, 2.25, -0.1); scene.add(beam);
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.25), steel); p.position.set(s * 1.67, 1.12, -0.1); p.castShadow = true; scene.add(p); }
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), steel); hub.position.copy(PIVOT); scene.add(hub);

  const cols = Array.from({ length: N }, (_, i) => new THREE.Color().setHSL(0.83 * i / (N - 1), 0.85, 0.5));
  const st = Array.from({ length: N }, (_, i) => [a0 + i * spread, a0 + i * spread, 0, 0]);
  const rodPos = new Float32Array(N * 4 * 3), rodCol = new Float32Array(N * 4 * 3);
  cols.forEach((c, i) => { for (let k = 0; k < 4; k++) rodCol.set([c.r, c.g, c.b], (i * 4 + k) * 3); });
  const rodGeo = new THREE.BufferGeometry();
  rodGeo.setAttribute('position', new THREE.BufferAttribute(rodPos, 3)); rodGeo.setAttribute('color', new THREE.BufferAttribute(rodCol, 3));
  const rods = new THREE.LineSegments(rodGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 })); rods.frustumCulled = false; scene.add(rods);
  const bobs = [0.035, 0.05].map((r) => { const m = new THREE.InstancedMesh(new THREE.SphereGeometry(r, 16, 12), new THREE.MeshStandardMaterial({ roughness: 0.35 }), N); cols.forEach((c, i) => m.setColorAt(i, c)); m.castShadow = true; scene.add(m); return m; });
  const TR = 70, PH = 300;
  const lineSet = (n, opacity) => Array.from({ length: N }, (_, i) => {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: cols[i], transparent: true, opacity })); l.frustumCulled = false; scene.add(l); return { l, pts: [] };
  });
  const trails = lineSet(TR, 0.3), phase = lineSet(PH, 0.75);
  const frameMat = new THREE.LineBasicMaterial({ color: '#c7c7cc' }), inkMat = new THREE.LineBasicMaterial({ color: '#3a3a3c' });

  // the phase space: a box with three axes
  const PC = new THREE.Vector3(3.4, 1.75, 0), PS = 0.62;
  const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2 * PS, 2 * PS, 2 * PS)), frameMat); box.position.copy(PC); scene.add(box);
  for (const [d, c] of [[[1, 0, 0], '#d1495b'], [[0, 1, 0], '#41a65d'], [[0, 0, 1], '#2f6fb3']]) scene.add(new THREE.ArrowHelper(new THREE.Vector3(...d), PC.clone().sub(new THREE.Vector3(PS, PS, PS)), 2 * PS + 0.15, c, 0.06, 0.035));
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.02, 10, 8), new THREE.MeshBasicMaterial(), N); cols.forEach((c, i) => heads.setColorAt(i, c)); scene.add(heads);
  const toPhase = (s) => new THREE.Vector3(PC.x + PS * Math.sin(s[0]), PC.y + PS * Math.sin(s[1]), PC.z + PS * Math.max(-1, Math.min(1, s[2] / 8)));

  // the plot: log10 |δ| against t, drawn on a white card, with its grid and the fitted line
  const QC = new THREE.Vector3(3.4, 0.45, 0), QW = 1.5, QH = 0.62, TMAX = 13, YMIN = -3.5, YMAX = 0.7;
  const card = new THREE.Mesh(new THREE.PlaneGeometry(QW + 0.16, QH + 0.16), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 })); card.position.copy(QC).add(new THREE.Vector3(0, 0, -0.01)); card.receiveShadow = true; scene.add(card);
  const cardEdge = new THREE.LineSegments(new THREE.EdgesGeometry(card.geometry), frameMat); cardEdge.position.copy(card.position); scene.add(cardEdge);
  const toPlot = (t, y) => new THREE.Vector3(QC.x - QW / 2 + QW * Math.min(1, t / TMAX), QC.y - QH / 2 + QH * (Math.min(YMAX, Math.max(YMIN, y)) - YMIN) / (YMAX - YMIN), QC.z);
  const seg = (a, b, m) => scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), m));
  for (let y = -3; y <= 0; y++) seg(toPlot(0, y), toPlot(TMAX, y), frameMat);
  for (let t = 0; t <= TMAX; t += 2) seg(toPlot(t, YMIN), toPlot(t, YMAX), frameMat);
  seg(toPlot(0, YMIN), toPlot(TMAX, YMIN), inkMat); seg(toPlot(0, YMIN), toPlot(0, YMAX), inkMat);
  const NP = 800, curveGeo = new THREE.BufferGeometry(); curveGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NP * 3), 3)); curveGeo.setDrawRange(0, 0);
  for (const dy of [-0.003, 0, 0.003]) { const c = new THREE.Line(curveGeo, new THREE.LineBasicMaterial({ color: '#d1495b' })); c.position.y = dy; c.frustumCulled = false; scene.add(c); }   // (three lines: a thicker stroke)
  const fitGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const fit = new THREE.Line(fitGeo, new THREE.LineDashedMaterial({ color: '#2f6fb3', dashSize: 0.03, gapSize: 0.02 })); fit.frustumCulled = false; fit.visible = false; scene.add(fit);
  const samples = [];
  let simT = 0, lyap = 0;

  const m4 = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1), q = new THREE.Quaternion();
  const push = (set, i, p, n) => { const s = set[i]; s.pts.push(p); if (s.pts.length > n) s.pts.shift();
    const P = s.l.geometry.attributes.position; for (let k = 0; k < n; k++) { const v = s.pts[Math.max(0, k - (n - s.pts.length))]; P.setXYZ(k, v.x, v.y, v.z); } P.needsUpdate = true; };
  const lower = [];
  function draw() {
    for (let i = 0; i < N; i++) {
      const [a, b] = st[i];
      const j = new THREE.Vector3(PIVOT.x + L * Math.sin(a), PIVOT.y - L * Math.cos(a), 0);
      const e = new THREE.Vector3(j.x + L * Math.sin(b), j.y - L * Math.cos(b), 0);
      rodPos.set([PIVOT.x, PIVOT.y, 0, j.x, j.y, 0, j.x, j.y, 0, e.x, e.y, 0], i * 12);
      bobs[0].setMatrixAt(i, m4.compose(j, q, one)); bobs[1].setMatrixAt(i, m4.compose(e, q, one));
      push(trails, i, e, TR); const ph = toPhase(st[i]); push(phase, i, ph, PH); heads.setMatrixAt(i, m4.compose(ph, q, one));
      lower[i] = e;
    }
    rodGeo.attributes.position.needsUpdate = true;
    for (const m of [...bobs, heads]) m.instanceMatrix.needsUpdate = true;
    // the separation of neighbours (mean over the fan), its log, the fit while it still grows
    let d = 0; for (let i = 1; i < N; i++) d += Math.hypot(st[i][0] - st[i - 1][0], st[i][1] - st[i - 1][1], 0.1 * (st[i][2] - st[i - 1][2]), 0.1 * (st[i][3] - st[i - 1][3]));
    const y = Math.log10(d / (N - 1));
    if (samples.length < NP && (!samples.length || simT - samples.at(-1)[0] > 0.015)) {
      samples.push([simT, y]); const P = curveGeo.attributes.position, v = toPlot(simT, y); P.setXYZ(samples.length - 1, v.x, v.y, v.z + 0.002); P.needsUpdate = true; curveGeo.setDrawRange(0, samples.length);
      const grow = samples.filter(([, yy]) => yy < -0.3);
      if (grow.length > 30) {
        const n = grow.length, sx = grow.reduce((s, [t]) => s + t, 0), sy = grow.reduce((s, [, yy]) => s + yy, 0);
        const sxx = grow.reduce((s, [t]) => s + t * t, 0), sxy = grow.reduce((s, [t, yy]) => s + t * yy, 0);
        const k = (n * sxy - sx * sy) / (n * sxx - sx * sx), c = (sy - k * sx) / n;
        lyap = k * Math.LN10;
        fitGeo.setFromPoints([toPlot(0, c).setZ(QC.z + 0.003), toPlot(TMAX, c + k * TMAX).setZ(QC.z + 0.003)]); fit.computeLineDistances(); fit.visible = true;
      }
    }
  }
  draw();
  let last = null;
  const mid = () => lower.reduce((s, v) => s.add(v), new THREE.Vector3()).multiplyScalar(1 / N);
  return {
    poses: {
      whole: { position: [1.7, 1.45, 6.7], target: [1.7, 1.25, 0], fov: 42 },
      fan: { position: [0.9, 1.45, 3.9], target: [0.25, 1.5, 0], fov: 42 },
      phase: { position: [5.3, 2.5, 3.4], target: [3.75, 1.7, 0], fov: 42 },
      plot: { position: [3.85, 0.62, 2.1], target: [3.8, 0.5, 0], fov: 42 },
    },
    anchors: {
      pivot: [0, 2.38, 0], fan: () => mid().add(new THREE.Vector3(0, 0.2, 0)), first: () => lower[0].clone().add(new THREE.Vector3(0, 0.12, 0)),
      last: () => lower[N - 1].clone().add(new THREE.Vector3(0, 0.12, 0)), phase: [PC.x, PC.y + PS + 0.18, 0],
      axis1: [PC.x + PS + 0.22, PC.y - PS, PC.z - PS], axis2: [PC.x - PS, PC.y + PS + 0.25, PC.z - PS], axis3: [PC.x - PS, PC.y - PS, PC.z + PS + 0.22],
      plot: [QC.x, QC.y + QH / 2 + 0.12, 0], slope: () => toPlot(8.5, -1.0).add(new THREE.Vector3(0, 0.06, 0)),
      // where the equations sit, next to what they describe
      eqPendulum: [0, 0.42, 0.2], eqFan: () => mid().add(new THREE.Vector3(0, -0.32, 0.2)), eqPhase: [PC.x + PS + 0.62, PC.y + 0.25, 0], eqPlot: [QC.x - 0.2, QC.y + QH / 2 - 0.06, 0.05],
    },
    lyapunov: () => lyap,
    frame(now) {
      if (last == null) { last = now; return; }
      const dt = Math.min(0.05, now - last); last = now;
      const n = 12, h = dt / n;
      for (const s of st) for (let k = 0; k < n; k++) rk4(s, h);
      simT += dt;
      draw();
    },
  };
}

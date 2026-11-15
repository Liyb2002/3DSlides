// Architecture: building Notre-Dame de Paris, as a blueprint (white lines on blueprint blue over a drawing grid).
// The floor plan is drawn on the ground; the action `build` raises the cathedral in the order it was built:
//   1  the choir and the apse (1163–1182): piers, walls, the radiating chapels, clerestory windows, the roof
//   2  the nave and the transept (1182–1250): piers, walls, aisles and their windows, ribbed vaults, the
//      transept's rose windows, roofs
//   3  the flying buttresses (13th century): piers outside with their pinnacles, arcs over the aisles
//   4  the west front (1200–1250): three portals (archivolts, tympana, jamb statues), the Gallery of Kings
//      (28 niches), the rose window (its tracery), the great gallery, the towers (belfry lancets, louvres, corner
//      buttresses, balustrades, chimeras)
//   5  the spire (Viollet-le-Duc, 1859): its tiers, pinnacles round it, the apostles coming down the roofs
// Each part rises from the ground in turn (its stage's parts one after the other).
//
// Units: metres (real proportions, roughly: 128 m long, towers 69 m, spire 96 m), y up; the west front faces -x,
// the crossing at x = 10.
// sceneOptions: { built: 0 … 5 }
// poses: plan, choir, nave, front, spire; anchors: choir, apse, chapels, nave, vault, buttresses, pinnacle,
//        clerestory, rose, kings, portal, towers, gallery, spire, apostles, transeptRose
// actions: build { to: 0 … 5 }
import * as THREE from 'three';

const INK = '#ffffff', PAPER = '#163f6c';
const smooth = (u) => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };

export default function cathedral({ scene, options = {} }) {
  scene.background = new THREE.Color(PAPER);
  const grid = new THREE.GridHelper(300, 60, '#4f7fb3', '#2f5f93'); grid.position.y = -0.05; scene.add(grid);
  const fine = new THREE.GridHelper(300, 300, '#24507f', '#24507f'); fine.position.y = -0.1; scene.add(fine);
  const fill = new THREE.MeshBasicMaterial({ color: '#2b6aa8', transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide });
  const ink = new THREE.LineBasicMaterial({ color: INK }), thin = new THREE.LineBasicMaterial({ color: '#cfe2f7', transparent: true, opacity: 0.7 });

  // a part: a group standing on the ground, raised by scaling it up from y = 0
  const parts = [];
  let cur = null;
  const part = (stage) => { const g = new THREE.Group(); scene.add(g); parts.push({ g, stage }); cur = g; return g; };
  const solid = (geo, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(geo, fill); m.position.set(x, y, z); m.rotation.y = ry; cur.add(m);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), ink); e.position.copy(m.position); e.rotation.y = ry; cur.add(e);
  };
  const box = (lx, ly, lz, x, y, z) => solid(new THREE.BoxGeometry(lx, ly, lz), x, y + ly / 2, z);
  const roof = (len, w, h, x, y, z, alongZ = false) => {
    const s = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]);
    const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false }); g.translate(0, 0, -len / 2);
    solid(g, x, y, z, alongZ ? 0 : Math.PI / 2);
  };
  const line = (pts, mat = ink) => cur.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
  const samples = (fn, n = 14) => Array.from({ length: n + 1 }, (_, i) => fn(i / n));
  // drawing on a wall: P(u, v) -> a point (u along the wall, v up)
  const westFace = (u, v) => new THREE.Vector3(XF - 0.05, v, u);
  const wallZ = (z) => (u, v) => new THREE.Vector3(u, v, z);
  // an equilateral pointed arch: jambs from y0 to the springing ys, two arcs to the apex
  const pointed = (P, c, w, y0, ys, mat = ink) => {
    const pts = [P(c - w / 2, y0), P(c - w / 2, ys)];
    for (let i = 0; i <= 8; i++) { const a = Math.PI - (Math.PI / 3) * (i / 8); pts.push(P(c + w / 2 + w * Math.cos(a), ys + w * Math.sin(a))); }
    for (let i = 0; i <= 8; i++) { const a = Math.PI / 3 - (Math.PI / 3) * (i / 8); pts.push(P(c - w / 2 + w * Math.cos(a), ys + w * Math.sin(a))); }
    pts.push(P(c + w / 2, y0)); line(pts, mat);
  };
  const circle = (P, cu, cv, r, n = 40, mat = ink) => line(samples((s) => P(cu + r * Math.cos(s * 2 * Math.PI), cv + r * Math.sin(s * 2 * Math.PI)), n), mat);
  const statue = (p, h = 2.2, r = 0.35) => { const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, h - 2 * r, 3, 8), fill); m.position.copy(p).add(new THREE.Vector3(0, h / 2, 0)); cur.add(m);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 40), thin); e.position.copy(m.position); cur.add(e); };
  // a rose window: rings, spokes, a ring of small circles
  const rose = (P, cu, cv, R) => {
    circle(P, cu, cv, R, 64); circle(P, cu, cv, R * 0.66, 48, thin); circle(P, cu, cv, R * 0.24, 24);
    for (let i = 0; i < 24; i++) { const a = (i / 24) * 2 * Math.PI; line([P(cu + R * 0.24 * Math.cos(a), cv + R * 0.24 * Math.sin(a)), P(cu + R * Math.cos(a), cv + R * Math.sin(a))], i % 2 ? thin : ink); }
    for (let i = 0; i < 12; i++) { const a = ((i + 0.5) / 12) * 2 * Math.PI; circle(P, cu + R * 0.83 * Math.cos(a), cv + R * 0.83 * Math.sin(a), R * 0.12, 16, thin); }
  };

  const XF = -64, X0 = -50, XT0 = 3, XT1 = 17, X1 = 46;
  const BAY = 6.5, bays = (a, b) => { const out = []; for (let x = a + 3; x <= b - 2; x += BAY) out.push(x); return out; };
  const choirBays = bays(XT1, X1), naveBays = bays(X0, XT0);

  // ---- 1: the choir and the apse
  for (const x of choirBays) { part(1); for (const s of [-1, 1]) box(1.8, 33, 1.8, x, 0, s * 6); }
  part(1); box(X1 - XT1, 33, 12, (XT1 + X1) / 2, 0, 0); for (const s of [-1, 1]) box(X1 - XT1, 20, 10, (XT1 + X1) / 2, 0, s * 11);
  part(1); solid(new THREE.CylinderGeometry(17, 17, 33, 18, 1, false, 0, Math.PI), X1, 16.5, 0);
  part(1); for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + (k + 0.5) * Math.PI / 5; solid(new THREE.CylinderGeometry(4, 4, 14, 12, 1, false, a - Math.PI / 2 + Math.PI / 2, Math.PI), X1 + 19.5 * Math.cos(a), 7, 19.5 * Math.sin(a), 0); }
  part(1); for (const x of choirBays) for (const s of [-1, 1]) { pointed(wallZ(s * 6.05), x, 3.2, 22, 26); pointed(wallZ(s * 16.05), x, 3.6, 5, 10, thin); }
  part(1); roof(X1 - XT1, 13, 10, (XT1 + X1) / 2, 33, 0); solid(new THREE.ConeGeometry(17.5, 10, 18, 1, true, 0, Math.PI), X1, 38, 0);
  // ---- 2: the nave and the transept
  for (const x of naveBays) { part(2); for (const s of [-1, 1]) box(1.8, 33, 1.8, x, 0, s * 6); }
  part(2); box(XT0 - X0, 33, 12, (X0 + XT0) / 2, 0, 0); for (const s of [-1, 1]) box(XT0 - X0, 20, 10, (X0 + XT0) / 2, 0, s * 11);
  part(2); for (const x of naveBays) for (const s of [-1, 1]) { pointed(wallZ(s * 6.05), x, 3.2, 22, 26); pointed(wallZ(s * 16.05), x, 3.6, 5, 10, thin); }
  part(2); for (const x of [...naveBays, ...choirBays]) for (const s of [-1, 1]) line(samples((u) => new THREE.Vector3(x + (u - 0.5) * BAY, 26 + 7 * Math.sin(u * Math.PI), s * (u - 0.5) * 12)), thin);
  part(2); box(XT1 - XT0, 33, 48, (XT0 + XT1) / 2, 0, 0);
  part(2); for (const s of [-1, 1]) { const P = wallZ(s * 24.05); rose(P, 10, 23, 5); pointed(P, 10, 4.5, 0, 9); for (let k = -2; k <= 2; k++) pointed(P, 10 + k * 1.2, 0.9, 13, 16, thin); }
  part(2); roof(XT0 - X0, 13, 10, (X0 + XT0) / 2, 33, 0); roof(48, 15, 10, (XT0 + XT1) / 2, 33, 0, true);
  // ---- 3: the flying buttresses, with their pinnacles
  for (const x of [...naveBays, ...choirBays]) {
    part(3);
    for (const s of [-1, 1]) {
      box(2, 24, 2, x, 0, s * 19);
      solid(new THREE.ConeGeometry(1.1, 6, 6), x, 27, s * 19);
      line(samples((u) => new THREE.Vector3(x, 24 + 8 * Math.sin(u * Math.PI / 2), s * (19 - 13 * u))));
      line(samples((u) => new THREE.Vector3(x, 20 + 6 * Math.sin(u * Math.PI / 2), s * (19 - 13 * u))), thin);
    }
  }
  // ---- 4: the west front
  part(4); box(14, 45, 13, XF + 7, 0, 0);
  for (const s of [-1, 1]) { part(4); box(14, 45, 14, XF + 7, 0, s * 13.5); }
  part(4);                                                         // the three portals: archivolts, tympanum, trumeau, jamb statues
  for (const [c, w, h] of [[0, 7, 9], [-13.5, 6, 8], [13.5, 6, 8]]) {
    for (let k = 0; k < 4; k++) pointed(westFace, c, w + k * 1.4, 0, h, k ? thin : ink);
    line([westFace(c - w / 2, h), westFace(c + w / 2, h)]); line([westFace(c, 0), westFace(c, h)], thin);
    for (const sd of [-1, 1]) for (let k = 0; k < 3; k++) statue(westFace(c + sd * (w / 2 + 0.6 + k * 0.7), 1.2).add(new THREE.Vector3(-0.6 - k * 0.3, 0, 0)), 2.6, 0.32);
  }
  part(4);                                                         // the Gallery of Kings: 28 niches
  line([westFace(-20.5, 18.5), westFace(20.5, 18.5)]); line([westFace(-20.5, 24.5), westFace(20.5, 24.5)]);
  for (let k = 0; k < 28; k++) { const c = -19.6 + k * (39.2 / 27); pointed(westFace, c, 1.15, 18.8, 22.4, thin); statue(westFace(c, 18.8).add(new THREE.Vector3(-0.3, 0, 0)), 2.6, 0.3); }
  part(4);                                                         // the rose, the lancets beside it, the great gallery
  rose(westFace, 0, 31, 5.4);
  for (const s of [-1, 1]) for (const k of [-1, 1]) pointed(westFace, s * 13.5 + k * 2.2, 2.6, 27, 33);
  line([westFace(-20.5, 40.5), westFace(20.5, 40.5)]); line([westFace(-20.5, 45), westFace(20.5, 45)]);
  for (let k = 0; k < 34; k++) { const c = -20 + k * (40 / 33); line([westFace(c, 40.5), westFace(c, 43.2)], thin); }
  for (let k = 0; k < 33; k++) { const c = -20 + (k + 0.5) * (40 / 33); line(samples((u) => westFace(c - 0.6 * Math.cos(u * Math.PI), 43.2 + 0.7 * Math.sin(u * Math.PI)), 6), thin); }
  for (const s of [-1, 1]) {                                       // the towers: belfry, louvres, corner buttresses, balustrade, chimeras
    part(4);
    box(14, 24, 14, XF + 7, 45, s * 13.5);
    for (const k of [-1, 1]) { const c = s * 13.5 + k * 2.6; pointed(westFace, c, 2.8, 48, 60); for (let y = 49; y < 60; y += 1.4) line([westFace(c - 1.3, y), westFace(c + 1.3, y)], thin); }
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) box(1.1, 22, 1.1, XF + 7 + sx * 7.2, 45, s * 13.5 + sz * 7.2);
    line([westFace(s * 13.5 - 7, 68.2), westFace(s * 13.5 + 7, 68.2)]);
    for (let k = 0; k <= 14; k++) line([westFace(s * 13.5 - 7 + k, 67), westFace(s * 13.5 - 7 + k, 68.2)], thin);
    for (const sz of [-1, 1]) { const g = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.4, 6), fill); g.rotation.z = Math.PI / 2; g.position.set(XF - 1, 66, s * 13.5 + sz * 7); cur.add(g);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(g.geometry), thin); e.position.copy(g.position); e.rotation.copy(g.rotation); cur.add(e); }
  }
  // ---- 5: the spire: an octagonal base, tiers, the needle; pinnacles round it; the apostles on the roofs
  part(5);
  solid(new THREE.CylinderGeometry(3.4, 3.8, 8, 8), 10, 47, 0);
  solid(new THREE.CylinderGeometry(2.7, 3.2, 6, 8), 10, 54, 0);
  solid(new THREE.ConeGeometry(2.6, 38, 8), 10, 76, 0);
  for (let k = 0; k < 8; k++) { const a = (k / 8) * 2 * Math.PI; solid(new THREE.ConeGeometry(0.5, 6, 6), 10 + 4.6 * Math.cos(a), 46, 4.6 * Math.sin(a)); }
  line([new THREE.Vector3(10, 95, 0), new THREE.Vector3(10, 100, 0)]); line([new THREE.Vector3(10, 98.6, -1.2), new THREE.Vector3(10, 98.6, 1.2)]);
  for (const [sx, sz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) for (let k = 0; k < 3; k++) {
    const d = 6 + k * 2.4;
    statue(new THREE.Vector3(10 + sx * d, 43 - k * 1.7 - (sx ? 0 : 0), sz * d), 2.4, 0.35);
  }

  // the floor plan on the ground, always there
  const plan = new THREE.Group(); scene.add(plan);
  const outline = (pts) => plan.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(([x, z]) => new THREE.Vector3(x, 0.05, z))), ink));
  outline([[XF, -20.5], [X0, -20.5], [X0, -16], [XT0, -16], [XT0, -24], [XT1, -24], [XT1, -16], [X1, -16], [X1, 16], [XT1, 16], [XT1, 24], [XT0, 24], [XT0, 16], [X0, 16], [X0, 20.5], [XF, 20.5], [XF, -20.5]]);
  outline(samples((u) => { const a = -Math.PI / 2 + u * Math.PI; return [X1 + 17 * Math.cos(a), 17 * Math.sin(a)]; }, 24));
  for (const x of [...naveBays, ...choirBays]) for (const s of [-1, 1]) outline([[x - 0.9, s * 6 - 0.9], [x + 0.9, s * 6 - 0.9], [x + 0.9, s * 6 + 0.9], [x - 0.9, s * 6 + 0.9], [x - 0.9, s * 6 - 0.9]]);

  // raising: within a stage the parts go one after the other
  const byStage = {}; parts.forEach((p) => { (byStage[p.stage] ||= []).push(p); });
  for (const list of Object.values(byStage)) list.forEach((p, k) => { p.start = p.stage - 1 + 0.75 * (k / list.length); p.dur = Math.max(0.12, (0.75 / list.length) * 3); });
  let built = options.built ?? 0;
  function setBuilt(b) {
    built = b;
    for (const p of parts) { const u = smooth((b - p.start) / p.dur); p.g.visible = u > 0.002; p.g.scale.y = Math.max(0.002, u); }
  }
  setBuilt(built);
  return {
    poses: {
      plan: { position: [-8, 240, 0.1], target: [-8, 0, 0], fov: 40 },
      choir: { position: [130, 80, -105], target: [30, 14, 0], fov: 40 },
      nave: { position: [-30, 62, -150], target: [-14, 18, 0], fov: 42 },
      front: { position: [-175, 36, -48], target: [-60, 30, 0], fov: 44 },
      spire: { position: [-125, 118, -185], target: [-5, 36, 0], fov: 40 },
    },
    anchors: {
      choir: [30, 48, 0], apse: [X1 + 12, 44, 0], chapels: [X1 + 22, 16, -12], nave: [-24, 46, 0], vault: [-30, 34, -6], buttresses: [-11, 34, -19],
      pinnacle: [-24, 31, -19], clerestory: [-40, 30, -6], rose: [XF, 38, 0], kings: [XF, 26, -8], portal: [XF, 13, 0], towers: [XF + 7, 73, -13.5],
      gallery: [XF, 47, 8], spire: [10, 102, 0], apostles: [16, 46, 0], transeptRose: [10, 30, -24],
    },
    actions: { build({ to = 5 }) { const from = built; return (p) => setBuilt(from + (to - from) * p); } },
  };
}

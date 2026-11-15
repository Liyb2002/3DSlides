// Mechanical engineering: an inline-four, four-stroke engine in a glass block. Crankshaft (throws at 0°, 180°,
// 180°, 0°), four connecting rods and pistons, firing order 1-3-4-2; two overhead camshafts turning at half the
// crank's speed, their lobes opening the intake and exhaust valves at the right moment of each cylinder's
// cycle; a toothed timing belt from the crank pulley to the cam pulleys; a flywheel with its ring gear. Each
// cylinder flashes when it fires. Intake runners from a plenum (with its throttle) and exhaust headers into a
// collector: the charge (blue) flows in while an intake valve is open, the exhaust (orange) out while an exhaust
// valve is; a spark plug in each head sparks just before its cylinder fires.
//
// Units: metres, y up; the crankshaft along x at the origin, cylinders 1 … 4 from -x to +x.
// sceneOptions: { rpm: 60 }
// poses: whole, valves, pistons, flow; anchors: cam, valve, piston, rod, crank, belt, flywheel, flash, intake, exhaust, plug
import * as THREE from 'three';
import { paperStudio } from '../../code/src/scenes/gltf_utils.js';

const R = 0.075, LR = 0.22, BORE = 0.062, PITCH = 0.18;     // crank radius, rod, piston radius, cylinder spacing
const XC = [-1.5, -0.5, 0.5, 1.5].map((k) => k * PITCH);
const OFF = [0, Math.PI, 3 * Math.PI, 2 * Math.PI];          // each cylinder's place in the 720° cycle (1-3-4-2)
const PH = OFF.map((o) => o % (2 * Math.PI));                // its crank throw
const YHEAD = LR + R + 0.07, YCAM = YHEAD + 0.1, ZV = 0.032; // the head's floor, the camshafts, the valves' z
const TAU = Math.PI * 2;

function gear(r, teeth, depth, mat, inner = 0) {
  const s = new THREE.Shape(), n = teeth * 4;
  for (let i = 0; i <= n; i++) { const a = (i / n) * TAU, rr = i % 4 === 1 || i % 4 === 2 ? r : r - 0.012; const p = [Math.cos(a) * rr, Math.sin(a) * rr]; i ? s.lineTo(...p) : s.moveTo(...p); }
  if (inner) { const h = new THREE.Path(); h.absarc(0, 0, inner, 0, TAU, true); s.holes.push(h); }
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false }); g.translate(0, 0, -depth / 2); g.rotateY(Math.PI / 2);
  const m = new THREE.Mesh(g, mat); m.castShadow = true; return m;
}

export default function engineI4({ scene, renderer, options = {} }) {
  scene.background = new THREE.Color('#ffffff');
  paperStudio(scene, renderer, { groundY: -0.16, extent: 0.75, keyDir: [-0.5, 1.4, 0.8], shadowOpacity: 0.12, center: new THREE.Vector3(0, 0.15, 0) });
  const steel = new THREE.MeshStandardMaterial({ color: '#c3c7ce', metalness: 0.8, roughness: 0.25 });
  const dark = new THREE.MeshStandardMaterial({ color: '#2c2c30', metalness: 0.5, roughness: 0.4 });
  const red = new THREE.MeshStandardMaterial({ color: '#c8323e', metalness: 0.35, roughness: 0.4 });
  const brass = new THREE.MeshStandardMaterial({ color: '#d2a24a', metalness: 0.85, roughness: 0.3 });
  const blue = new THREE.MeshStandardMaterial({ color: '#2f6fb3', metalness: 0.3, roughness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: '#cfe4f7', transparent: true, opacity: 0.2, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false });
  const sh = (m, parent = scene) => { m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
  const alongX = (r, len, mat) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 24), mat); m.rotation.z = Math.PI / 2; return m; };

  // the block and head (glass), the oil pan
  const block = new THREE.Mesh(new THREE.BoxGeometry(4 * PITCH + 0.06, YHEAD - R - 0.02, 0.16), glass); block.position.set(0, (YHEAD + R + 0.02) / 2, 0); scene.add(block);
  const head = new THREE.Mesh(new THREE.BoxGeometry(4 * PITCH + 0.06, 0.16, 0.2), glass); head.position.set(0, YHEAD + 0.08, 0); scene.add(head);
  const pan = new THREE.Mesh(new THREE.BoxGeometry(4 * PITCH + 0.04, 0.07, 0.17), glass); pan.position.set(0, -0.12, 0); scene.add(pan);
  for (const x of XC) { const c = new THREE.Mesh(new THREE.CylinderGeometry(BORE + 0.004, BORE + 0.004, YHEAD - (LR - R) + 0.02, 32, 1, true), glass); c.position.set(x, (YHEAD + LR - R) / 2, 0); scene.add(c); }
  for (const x of [...XC.map((v) => v - PITCH / 2), XC[3] + PITCH / 2]) { const cap = sh(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.12), dark)); cap.position.set(x, -0.03, 0); }

  // the crankshaft: main journals, webs, pins, counterweights (a group turning about x)
  const crank = new THREE.Group(); scene.add(crank);
  sh(alongX(0.022, 4 * PITCH + 0.36, steel), crank);
  XC.forEach((x, i) => {
    const throwG = new THREE.Group(); throwG.position.x = x; throwG.rotation.x = PH[i]; crank.add(throwG);
    for (const s of [-1, 1]) {
      const web = sh(new THREE.Mesh(new THREE.BoxGeometry(0.018, R + 0.05, 0.06), dark), throwG); web.position.set(s * 0.032, R / 2, 0);
      const cw = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.018, 24, 1, false, Math.PI * 0.65, Math.PI * 0.7), dark), throwG); cw.rotation.z = Math.PI / 2; cw.position.x = s * 0.032;
    }
    const pin = sh(alongX(0.02, 0.07, steel), throwG); pin.position.y = R;
  });
  // rods, pistons (with rings), the combustion flash in each chamber
  const rods = XC.map(() => sh(new THREE.Mesh(new THREE.BoxGeometry(0.022, LR, 0.014), red)));
  const pistons = XC.map(() => { const g = new THREE.Group(); scene.add(g);
    sh(new THREE.Mesh(new THREE.CylinderGeometry(BORE, BORE, 0.07, 36), steel), g);
    for (const dy of [0.022, 0.012]) { const r = new THREE.Mesh(new THREE.TorusGeometry(BORE + 0.001, 0.003, 6, 36), dark); r.rotation.x = Math.PI / 2; r.position.y = dy; g.add(r); }
    return g; });
  const flashes = XC.map((x) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(BORE * 0.9, 24, 16), new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0, depthWrite: false }));
    m.scale.y = 0.5; m.position.set(x, YHEAD - 0.012, 0); scene.add(m);
    const l = new THREE.PointLight(0xff9a30, 0, 0.6, 1.5); l.position.set(x, YHEAD - 0.01, 0.0); scene.add(l);
    return { m, l };
  });
  // the camshafts (intake z -, exhaust z +), their lobes, the valves under them
  const cams = [-1, 1].map((s) => { const g = new THREE.Group(); g.position.set(0, YCAM, s * ZV); scene.add(g); sh(alongX(0.012, 4 * PITCH + 0.32, steel), g); return g; });
  const lobeAt = (i, intake) => Math.PI - ((intake ? 2.5 : 1.5) * Math.PI - OFF[i]) / 2;           // pointing down when its valve is fully open
  XC.forEach((x, i) => [true, false].forEach((intake) => {
    const lobe = new THREE.Group(); lobe.position.x = x; lobe.rotation.x = lobeAt(i, intake); cams[intake ? 0 : 1].add(lobe);
    const body = sh(alongX(0.02, 0.016, brass), lobe);
    const nose = sh(alongX(0.011, 0.016, brass), lobe); nose.position.y = 0.014;
    void body;
  }));
  const valves = XC.map((x) => [-1, 1].map((s) => {
    const g = new THREE.Group(); g.position.set(x, 0, s * ZV); scene.add(g);
    const headV = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.012, 0.006, 20), steel), g); headV.position.y = YHEAD;
    const stem = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, YCAM - YHEAD - 0.03, 8), steel), g); stem.position.y = (YHEAD + YCAM - 0.03) / 2;
    const spring = new THREE.Mesh(new THREE.TorusKnotGeometry(0.008, 0.0016, 48, 6, 1, 6), dark); spring.rotation.x = Math.PI / 2; spring.scale.z = 3; spring.position.y = YCAM - 0.05; g.add(spring);
    const bucket = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 16), dark), g); bucket.position.y = YCAM - 0.026;
    return g;
  }));
  // the timing belt (front, -x): crank pulley r, cam pulleys 2r; teeth running round it
  const XB = XC[0] - 0.19, RC = 0.03, RK = 0.056;
  const crankPulley = gear(RC + 0.008, 14, 0.026, dark); crankPulley.position.set(XB, 0, 0); scene.add(crankPulley);
  const camPulleys = [-1, 1].map((s) => { const g = gear(RK + 0.008, 28, 0.026, dark); g.position.set(XB, YCAM, s * ZV * 1.9); scene.add(g); return g; });
  camPulleys.forEach((p, k) => { const sh2 = alongX(0.012, 0.19, steel); sh2.position.set(XB + 0.1, YCAM, (k ? 1 : -1) * ZV * 1.9); scene.add(sh2); });
  const pts = [];
  const arc = (cy, cz, r, a0, a1) => { for (let i = 0; i <= 16; i++) { const a = a0 + (a1 - a0) * i / 16; pts.push(new THREE.Vector3(XB, cy + r * Math.sin(a), cz + r * Math.cos(a))); } };
  arc(YCAM, -ZV * 1.9, RK + 0.012, Math.PI, Math.PI / 2);                  // over the intake pulley, from its outer side
  arc(YCAM, ZV * 1.9, RK + 0.012, Math.PI / 2, 0);                         // and the exhaust one
  arc(0, 0, RC + 0.012, 0, -Math.PI);                                       // under the crank pulley
  const belt = new THREE.CatmullRomCurve3(pts, true);
  const beltMesh = new THREE.Mesh(new THREE.TubeGeometry(belt, 160, 0.004, 6, true), new THREE.MeshStandardMaterial({ color: '#1a1a1c', roughness: 0.7 })); beltMesh.scale.set(1, 1, 1); scene.add(beltMesh);
  const NT = 70, teeth = new THREE.InstancedMesh(new THREE.BoxGeometry(0.022, 0.006, 0.006), new THREE.MeshStandardMaterial({ color: '#f2b134', roughness: 0.5 }), NT); scene.add(teeth);
  const beltLen = belt.getLength();
  // the flywheel (back, +x) with its ring gear
  const fly = new THREE.Group(); fly.position.x = XC[3] + 0.2; scene.add(fly);
  const ring = gear(0.15, 60, 0.02, blue, 0.11); fly.add(ring);
  const disc = sh(alongX(0.11, 0.016, dark), fly);
  for (let i = 0; i < 6; i++) { const h = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 12), steel); h.rotation.z = Math.PI / 2; h.position.set(0.001, Math.cos(i * TAU / 6) * 0.07, Math.sin(i * TAU / 6) * 0.07); disc.add(h); }

  // intake: a plenum behind (z -) with its throttle body, a runner to each intake port; exhaust: headers (z +)
  // down into a collector pipe. Each is a curve the gas particles run along.
  const pipe = (curve, r, mat) => sh(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, r, 12), mat));
  const alu = new THREE.MeshStandardMaterial({ color: '#9fa6b2', metalness: 0.7, roughness: 0.35, transparent: true, opacity: 0.55, depthWrite: false });
  const hot = new THREE.MeshStandardMaterial({ color: '#8a6a58', metalness: 0.7, roughness: 0.4, transparent: true, opacity: 0.55, depthWrite: false, emissive: '#ff5a1a', emissiveIntensity: 0 });
  const PLZ = -0.24, PLY = YHEAD + 0.13;
  const plenum = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4 * PITCH + 0.12, 32), alu)); plenum.rotation.z = Math.PI / 2; plenum.position.set(0, PLY, PLZ);
  const throttle = sh(alongX(0.04, 0.08, steel)); throttle.position.set(XC[0] - 0.13, PLY, PLZ);
  const plate = new THREE.Mesh(new THREE.CircleGeometry(0.036, 24), dark); plate.rotation.y = Math.PI / 2; plate.rotation.x = 0.4; plate.position.copy(throttle.position).add(new THREE.Vector3(-0.041, 0, 0)); scene.add(plate);
  const runners = XC.map((x) => new THREE.CatmullRomCurve3([new THREE.Vector3(x, PLY, PLZ + 0.03), new THREE.Vector3(x, PLY + 0.02, -0.15), new THREE.Vector3(x, YHEAD + 0.05, -0.1), new THREE.Vector3(x, YHEAD + 0.015, -ZV)]));
  runners.forEach((c) => pipe(c, 0.018, alu));
  const headers = XC.map((x, i) => new THREE.CatmullRomCurve3([new THREE.Vector3(x, YHEAD + 0.015, ZV), new THREE.Vector3(x, YHEAD + 0.04, 0.11), new THREE.Vector3(x + 0.02, YHEAD - 0.06, 0.2),
    new THREE.Vector3(XC[3] + 0.06 - (3 - i) * 0.015, 0.06, 0.22), new THREE.Vector3(XC[3] + 0.3, 0.03, 0.22)]));
  const headerMats = XC.map(() => hot.clone());
  headers.forEach((c, i) => pipe(c, 0.016, headerMats[i]));
  const tail = sh(alongX(0.03, 0.35, hot)); tail.position.set(XC[3] + 0.4, 0.03, 0.22);
  // spark plugs, through the head between the cams
  const sparks = XC.map((x) => {
    const g = new THREE.Group(); g.position.set(x, 0, 0); scene.add(g);
    const ceramic = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.08, 12), new THREE.MeshStandardMaterial({ color: '#f4f1e8', roughness: 0.3 })), g); ceramic.position.y = YCAM + 0.03;
    const hex = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 6), steel), g); hex.position.y = YCAM - 0.02;
    const spark = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), new THREE.MeshBasicMaterial({ color: '#bfe3ff', transparent: true, opacity: 0, depthWrite: false })); spark.position.y = YHEAD + 0.002; g.add(spark);
    return spark;
  });
  // the gas: particles along each runner / header, shown while its valve is open
  const NPP = 14;
  const gasIn = new THREE.InstancedMesh(new THREE.SphereGeometry(0.007, 8, 6), new THREE.MeshBasicMaterial({ color: '#4fa3ff' }), 4 * NPP); scene.add(gasIn);
  const gasOut = new THREE.InstancedMesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff7a2a' }), 4 * NPP); scene.add(gasOut);
  const heat = [0, 0, 0, 0];

  const w = ((options.rpm ?? 60) / 60) * TAU;
  const up = new THREE.Vector3(0, 1, 0), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  function pose(t) {
    const th = w * t;
    crank.rotation.x = th; crankPulley.rotation.x = th; fly.rotation.x = th;
    cams.forEach((c) => { c.rotation.x = th / 2; }); camPulleys.forEach((p) => { p.rotation.x = th / 2; });
    XC.forEach((x, i) => {
      const a = th + PH[i], py = R * Math.cos(a), pz = R * Math.sin(a);
      const yP = py + Math.sqrt(LR * LR - pz * pz);
      const A = new THREE.Vector3(x, py, pz), B = new THREE.Vector3(x, yP, 0);
      rods[i].position.copy(A).add(B).multiplyScalar(0.5); rods[i].quaternion.setFromUnitVectors(up, B.clone().sub(A).normalize());
      pistons[i].position.set(x, yP + 0.02, 0);
      const c = (((th + OFF[i]) % (2 * TAU)) + 2 * TAU) % (2 * TAU);                         // 0 … 4π: power, exhaust, intake, compression
      const lift = (from) => (c > from && c < from + Math.PI ? 0.011 * Math.sin(c - from) : 0);
      valves[i][0].position.y = -lift(2 * Math.PI); valves[i][1].position.y = -lift(Math.PI);
      const f = c < 0.9 ? (1 - c / 0.9) ** 2 : 0;
      flashes[i].m.material.opacity = 0.85 * f; flashes[i].m.scale.set(1, 0.5 + 0.8 * (1 - f), 1); flashes[i].l.intensity = 6 * f;
      const sp = c > 4 * Math.PI - 0.25 ? 1 : 0;                                              // the spark, just before TDC
      sparks[i].material.opacity = sp; sparks[i].scale.setScalar(sp ? 0.7 + 0.6 * Math.random() : 1);
      const openIn = lift(2 * Math.PI) / 0.011, openOut = lift(Math.PI) / 0.011;
      heat[i] = Math.max(heat[i] * 0.985, openOut);
      headerMats[i].emissiveIntensity = 0.6 * heat[i];
      for (let k = 0; k < NPP; k++) {
        const u = ((t * 0.9 + k / NPP) % 1);
        gasIn.setMatrixAt(i * NPP + k, m4.compose(runners[i].getPointAt(u), q, one.clone().multiplyScalar(openIn > 0.05 ? 0.4 + 0.6 * openIn : 0)));
        gasOut.setMatrixAt(i * NPP + k, m4.compose(headers[i].getPointAt(u), q, one.clone().multiplyScalar(openOut > 0.05 ? 0.4 + 0.6 * openOut : 0)));
      }
    });
    const s0 = (th * (RC + 0.008)) / beltLen;
    for (let k = 0; k < NT; k++) {
      const u = (((k / NT - s0) % 1) + 1) % 1, p = belt.getPointAt(u), tg = belt.getTangentAt(u);
      teeth.setMatrixAt(k, m4.compose(p, q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tg), one));
    }
    teeth.instanceMatrix.needsUpdate = true; gasIn.instanceMatrix.needsUpdate = true; gasOut.instanceMatrix.needsUpdate = true;
  }
  pose(0);
  let t0 = null;
  return {
    poses: {
      whole: { position: [0.95, 0.7, 1.25], target: [-0.02, 0.17, 0], fov: 40 },
      valves: { position: [0.12, 0.78, 0.8], target: [-0.12, YCAM - 0.06, 0], fov: 40 },
      pistons: { position: [0.95, 0.3, 1.25], target: [0.08, 0.15, 0], fov: 40 },
      flow: { position: [0.55, 0.95, 1.05], target: [0.05, YHEAD - 0.02, 0.02], fov: 40 },
    },
    anchors: {
      cam: [XC[1], YCAM + 0.05, -ZV], valve: [XC[0] - 0.02, YHEAD + 0.07, ZV + 0.03], piston: () => pistons[2].position.clone().add(new THREE.Vector3(0, 0.05, BORE)),
      rod: () => rods[1].position.clone().add(new THREE.Vector3(0, 0, 0.03)), crank: [XC[2], -0.07, 0.08], belt: [XB, YCAM + 0.09, 0],
      flywheel: [XC[3] + 0.2, 0.17, 0], flash: [XC[3], YHEAD + 0.05, BORE],
      intake: [XC[0], PLY + 0.08, PLZ], exhaust: [XC[2] + 0.05, YHEAD - 0.06, 0.24], plug: [XC[1], YCAM + 0.09, 0],
    },
    frame(now) { if (t0 == null) t0 = now; pose(now - t0); },
  };
}

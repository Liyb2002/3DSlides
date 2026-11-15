// Robotics: a five-fingered metal robot hand (brushed aluminium shells, rubber pads, chrome hinges) turning a ball in its fingertips by finger gaiting. Palm up, the ball held
// in a precision grasp above the palm (never touching it); the ball turns steadily while the fingers take turns to
// lift off, move to a new spot on the ball and press again. Every finger is posed by inverse kinematics each frame
// so that its fingertip lies exactly on the ball's surface (or a lift-height above it); the fingers wrap the ball
// from outside (knuckles away from it), so no part of the hand goes into the ball. Fingertips light up with
// contact, arrows show the contact forces; each joint can show its frame (action `frames`).
// Joints: 4 fingers × (abduction + 3 flexion; the last coupled) + thumb (rotation + 3) + wrist 2 ≈ 22 DoF.
//
// Units: metres, y up; the palm centred on the origin, fingers toward +x, the thumb on the +z side.
// poses: whole, tips, joints, gait; anchors: ball, index, thumb, middle, knuckle, wrist
// actions: frames { on: true | false }
import * as THREE from 'three';
import { paperStudio } from '../../code/src/scenes/gltf_utils.js';

const smooth = (u) => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };
const BR = 0.034;                                            // the ball's radius
const BALL = new THREE.Vector3(-0.004, 0.064, 0.002);        // its centre, in the palm's frame
const GAIT = 2.8;                                            // one round of lifts (each finger once)

export default function dexterousHand({ scene, renderer }) {
  scene.background = new THREE.Color('#ffffff');
  paperStudio(scene, renderer, { groundY: -0.24, extent: 0.32, keyDir: [-0.5, 1.4, 0.7], shadowOpacity: 0.14, center: new THREE.Vector3(0, -0.05, 0) });
  scene.environmentIntensity = 1.15;                                 // (metal wants something to reflect)
  const alu = new THREE.MeshPhysicalMaterial({ color: '#d9dde4', metalness: 1, roughness: 0.24, clearcoat: 0.35, clearcoatRoughness: 0.2 });
  const dark = new THREE.MeshPhysicalMaterial({ color: '#2a2e35', metalness: 0.85, roughness: 0.32, clearcoat: 0.4 });
  const chrome = new THREE.MeshStandardMaterial({ color: '#f2f4f7', metalness: 1, roughness: 0.07 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#17181b', metalness: 0, roughness: 0.85 });
  const led = new THREE.MeshStandardMaterial({ color: '#0b1a2a', emissive: '#4fa3ff', emissiveIntensity: 2.2 });
  const metal = alu, black = dark;
  const sh = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
  const frames = [];
  const axes = (g) => { const a = new THREE.AxesHelper(0.02); a.material.depthTest = false; a.renderOrder = 3; a.visible = false; g.add(a); frames.push(a); };
  const alongX = (r, len, mat, seg = 24) => { const m = sh(new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat)); m.rotation.z = Math.PI / 2; return m; };
  const alongZ = (r, len, mat, seg = 20) => { const m = sh(new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat)); m.rotation.x = Math.PI / 2; return m; };

  // the stand, the forearm (a tapered housing, chrome bands, a cable loom), the wrist (two axes, an LED ring)
  const hand = new THREE.Group(); scene.add(hand);
  const prof = [[0.0, 0.0], [0.034, 0.0], [0.038, 0.03], [0.036, 0.16], [0.031, 0.21], [0.0, 0.21]].map(([r, y]) => new THREE.Vector2(r, y));
  const fore = sh(new THREE.Mesh(new THREE.LatheGeometry(prof, 40), dark)); fore.rotation.z = -Math.PI / 2; fore.position.x = -0.265; hand.add(fore);
  for (const x of [-0.24, -0.19, -0.1]) { const band = alongX(0.0385, 0.006, chrome, 40); band.position.x = x; hand.add(band); }
  for (let k = 0; k < 3; k++) { const c = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-0.2, -0.03 - k * 0.003, 0.012 * (k - 1)), new THREE.Vector3(-0.23, -0.07, 0.015 * (k - 1)), new THREE.Vector3(-0.235, -0.16, 0.02 * (k - 1))]), 24, 0.0035, 8), rubber); c.castShadow = true; hand.add(c); }
  const post = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.21, 24), chrome)); post.position.set(-0.22, -0.135, 0); scene.add(post);
  const foot = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.072, 0.016, 48), dark)); foot.position.set(-0.22, -0.234, 0); scene.add(foot);
  const clamp = alongX(0.03, 0.03, dark); clamp.position.set(-0.22, -0.035, 0); hand.add(clamp);
  const wrist = new THREE.Group(); wrist.position.x = -0.05; hand.add(wrist); axes(wrist);
  wrist.add(sh(new THREE.Mesh(new THREE.SphereGeometry(0.026, 32, 20), dark)));
  const yoke = sh(new THREE.Mesh(new THREE.TorusGeometry(0.029, 0.0045, 12, 48), chrome)); yoke.rotation.y = Math.PI / 2; wrist.add(yoke);
  const ring = sh(new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.0022, 8, 48), led)); ring.rotation.y = Math.PI / 2; ring.position.x = -0.012; wrist.add(ring);
  for (const s of [-1, 1]) { const pin = alongZ(0.008, 0.012, chrome); pin.position.z = s * 0.03; wrist.add(pin); }

  // the palm: a bevelled aluminium plate shaped like a palm, a rubber pad on it, a thenar block by the thumb
  const palm = new THREE.Group(); palm.position.x = 0.05; wrist.add(palm);
  const outline = new THREE.Shape();
  outline.moveTo(-0.048, -0.034); outline.lineTo(0.044, -0.042); outline.quadraticCurveTo(0.054, -0.042, 0.054, -0.03);
  outline.lineTo(0.054, 0.034); outline.quadraticCurveTo(0.054, 0.046, 0.042, 0.046); outline.lineTo(-0.03, 0.05); outline.quadraticCurveTo(-0.05, 0.05, -0.05, 0.03); outline.lineTo(-0.048, -0.034);
  const plate = new THREE.ExtrudeGeometry(outline, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 4, curveSegments: 16 });
  plate.rotateX(Math.PI / 2); plate.translate(0, 0.007, 0);
  palm.add(sh(new THREE.Mesh(plate, alu)));
  const padShape = new THREE.Shape(); padShape.moveTo(-0.04, -0.028); padShape.lineTo(0.044, -0.034); padShape.lineTo(0.044, 0.034); padShape.lineTo(-0.022, 0.038); padShape.quadraticCurveTo(-0.04, 0.038, -0.04, 0.02); padShape.lineTo(-0.04, -0.028);
  const padGeo = new THREE.ExtrudeGeometry(padShape, { depth: 0.003, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.002, bevelSegments: 3 });
  padGeo.rotateX(Math.PI / 2); padGeo.translate(0, 0.0125, 0);
  palm.add(sh(new THREE.Mesh(padGeo, rubber)));
  const thenar = sh(new THREE.Mesh(new THREE.SphereGeometry(0.022, 24, 16), rubber)); thenar.scale.set(1.1, 0.42, 0.75); thenar.position.set(-0.022, 0.012, 0.03); palm.add(thenar);
  for (const [x, z] of [[-0.04, -0.028], [-0.04, 0.03], [0.045, -0.034], [0.045, 0.036]]) { const screw = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.002, 12), chrome)); screw.position.set(x, -0.0115, z); palm.add(screw); }

  // a finger: a base (its plane) and three flexion joints about the base's z. Each phalanx: an aluminium shell
  // (flattened), a rubber pad on its palm side, a dark tendon strip on its back, a chrome hinge with side caps.
  // The fingertip: a rubber pad (the contact; it glows with contact) under an aluminium nail cap.
  const R_TIP = 0.0088;
  function finger(base, L, r) {
    const joints = []; let parent = base;
    L.forEach((len, k) => {
      const j = new THREE.Group(); if (k) j.position.x = L[k - 1]; parent.add(j); axes(j);
      const hinge = alongZ(r * 0.92, r * 2.5, chrome); j.add(hinge);
      for (const sd of [-1, 1]) { const cap = alongZ(r * 0.55, r * 0.35, dark, 12); cap.position.z = sd * r * 1.35; j.add(cap); }
      const shellLen = len - (k === L.length - 1 ? r * 0.6 : r * 1.4);
      const shell = sh(new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, shellLen - 2 * r), 6, 16), alu)); shell.rotation.z = Math.PI / 2; shell.scale.set(0.8, 1, 1.02); shell.position.set(len / 2 - r * 0.1, -r * 0.08, 0); j.add(shell);
      const padSeg = sh(new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.62, Math.max(0.001, shellLen - 2.6 * r), 4, 12), rubber)); padSeg.rotation.z = Math.PI / 2; padSeg.scale.set(0.7, 1, 1); padSeg.position.set(len / 2, r * 0.48, 0); j.add(padSeg);
      const tendon = sh(new THREE.Mesh(new THREE.BoxGeometry(shellLen * 0.75, r * 0.18, r * 0.45), dark)); tendon.position.set(len / 2, -r * 0.86, 0); j.add(tendon);
      joints.push(j); parent = j;
    });
    const tipMat = new THREE.MeshStandardMaterial({ color: '#202226', emissive: '#ff8a1a', emissiveIntensity: 0, roughness: 0.75 });
    const tip = sh(new THREE.Mesh(new THREE.SphereGeometry(R_TIP, 24, 16), tipMat)); tip.position.x = L.at(-1); parent.add(tip);
    const nail = sh(new THREE.Mesh(new THREE.SphereGeometry(R_TIP * 1.04, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), alu)); nail.rotation.z = Math.PI * 0.62; nail.scale.set(1, 1, 0.92); nail.position.x = L.at(-1) - R_TIP * 0.15; parent.add(nail);
    return { base, joints, tip, tipMat, L, q: [1.2, 0.9] };
  }
  const fingers = [
    { z: 0.03, L: [0.048, 0.03, 0.022], phi: 0.1, lag: 0.0 }, { z: 0.01, L: [0.052, 0.032, 0.023], phi: 0.28, lag: 0.2 },
    { z: -0.01, L: [0.049, 0.03, 0.022], phi: 0.42, lag: 0.4 }, { z: -0.03, L: [0.042, 0.026, 0.02], phi: 0.42, lag: 0.6, liftBy: 0.008 },
  ].map((f) => { const b = new THREE.Group(); b.position.set(0.05, 0.006, f.z); palm.add(b); axes(b);
    const knuckle = sh(new THREE.Mesh(new THREE.SphereGeometry(0.0105, 20, 14), dark)); knuckle.scale.set(1, 0.85, 0.9); knuckle.position.set(-0.004, -0.004, 0); b.add(knuckle);
    return { ...f, ...finger(b, f.L, 0.0082) }; });
  // the thumb: its base turned so that its plane goes through the ball, its knuckles away from it
  const T0 = new THREE.Vector3(-0.028, 0.006, 0.05);
  const thumbBase = new THREE.Group(); thumbBase.position.copy(T0); palm.add(thumbBase); axes(thumbBase);
  {
    const toBall = BALL.clone().sub(T0), up = new THREE.Vector3(0, 1, 0);
    let n = new THREE.Vector3().crossVectors(toBall, up).normalize();
    let y = up.clone().sub(n.clone().multiplyScalar(n.dot(up))).normalize(), x = new THREE.Vector3().crossVectors(y, n);
    if (x.dot(toBall) > 0) { n.negate(); x = new THREE.Vector3().crossVectors(y, n); }   // x away from the ball
    thumbBase.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, n));
  }
  const thumb = { ...finger(thumbBase, [0.04, 0.034, 0.027], 0.009), phi: 0.35, lag: 0.8 };
  { const meta = sh(new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.02, 6, 16), alu)); meta.position.copy(T0).add(new THREE.Vector3(0.006, -0.002, -0.012)); meta.lookAt(new THREE.Vector3(-0.01, 0, 0.01)); meta.rotateX(Math.PI / 2); palm.add(meta); }
  const all = [...fingers, thumb];

  // the ball: eight coloured octants and three great circles (to see it turn)
  const ballGeo = new THREE.SphereGeometry(BR, 48, 32), cols = new Float32Array(ballGeo.attributes.position.count * 3);
  const OCT = ['#d1495b', '#2f6fb3', '#f2b134', '#41a65d', '#8e6c8a', '#f08a24', '#5bc0eb', '#f4f1e8'].map((c) => new THREE.Color(c));
  for (let i = 0; i < ballGeo.attributes.position.count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(ballGeo.attributes.position, i);
    const c = OCT[(p.x > 0 ? 1 : 0) + (p.y > 0 ? 2 : 0) + (p.z > 0 ? 4 : 0)]; cols.set([c.r, c.g, c.b], i * 3);
  }
  ballGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const ball = sh(new THREE.Mesh(ballGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 })));
  ball.position.copy(BALL); palm.add(ball);
  for (const ax of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(BR * 1.002, 0.0008, 6, 96), black);
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...ax)); ball.add(ring);
  }
  const spin = new THREE.Vector3(0.35, 1, 0.25).normalize();
  const arrows = all.map(() => { const a = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 0.03, 0xff8a00, 0.01, 0.007); a.visible = false; scene.add(a); return a; });

  // the fingertip where finger f should be: on the circle where its plane cuts the ball (grown by the tip's radius
  // and the lift), at angle phi from the ball's side that faces the finger
  const tipPoint = (f, q) => {
    const [L1, L2, L3] = f.L, a1 = q[0], a2 = a1 + q[1], a3 = a2 + 0.75 * q[1];
    return [L1 * Math.cos(a1) + L2 * Math.cos(a2) + L3 * Math.cos(a3), L1 * Math.sin(a1) + L2 * Math.sin(a2) + L3 * Math.sin(a3)];
  };
  // the knuckles (PIP, DIP) and the tip, in the finger's plane
  const knuckles = (f, q) => { const [L1, L2] = f.L, a1 = q[0], a2 = a1 + q[1];
    const p1 = [L1 * Math.cos(a1), L1 * Math.sin(a1)], p2 = [p1[0] + L2 * Math.cos(a2), p1[1] + L2 * Math.sin(a2)]; return [p1, p2, tipPoint(f, q)]; };
  // clear of the ball: every knuckle and the middle of every segment outside it (by the finger's radius and 2 mm)
  const clear = (f, q, b) => { const [p1, p2, p3] = knuckles(f, q), pts = [p1, p2, [p1[0] / 2, p1[1] / 2], [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2], [(p2[0] + p3[0]) / 2, (p2[1] + p3[1]) / 2]];
    return pts.every(([x, y]) => Math.hypot(x - b.x, y - b.y, b.z) > BR + 0.0105); };
  function solve(f, tx, ty, b) {                             // damped least squares on (MCP, PIP); DIP coupled to PIP
    const q0 = [...f.q], q = f.q;
    for (let it = 0; it < 16; it++) {
      const [x, y] = tipPoint(f, q), ex = tx - x, ey = ty - y;
      if (ex * ex + ey * ey < 1e-10) break;
      const h = 1e-4, [x1, y1] = tipPoint(f, [q[0] + h, q[1]]), [x2, y2] = tipPoint(f, [q[0], q[1] + h]);
      const a = (x1 - x) / h, bb = (x2 - x) / h, c = (y1 - y) / h, d = (y2 - y) / h, lam = 1e-4;
      // (JᵀJ + λI) dq = Jᵀ e
      const m11 = a * a + c * c + lam, m12 = a * bb + c * d, m22 = bb * bb + d * d + lam, r1 = a * ex + c * ey, r2 = bb * ex + d * ey, det = m11 * m22 - m12 * m12;
      q[0] += (m22 * r1 - m12 * r2) / det; q[1] += (-m12 * r1 + m11 * r2) / det;
      q[0] = Math.min(1.9, Math.max(-0.2, q[0])); q[1] = Math.min(1.9, Math.max(0.35, q[1]));     // (never straight: knuckles stay out)
    }
    if (!clear(f, q, b)) { q[0] = q0[0]; q[1] = q0[1]; }       // a pose that would go into the ball: keep the last one
    f.joints[0].rotation.z = q[0]; f.joints[1].rotation.z = q[1]; f.joints[2].rotation.z = 0.75 * q[1];
  }

  const B = new THREE.Vector3(), Bl = new THREE.Vector3();
  function pose(t) {
    wrist.rotation.set(0.07 * Math.sin(t * 0.6), 0.06 * Math.sin(t * 0.45), -0.06 + 0.04 * Math.sin(t * 0.8));
    ball.quaternion.setFromAxisAngle(spin, t * 1.1);
    scene.updateMatrixWorld(true);
    ball.getWorldPosition(B);
    all.forEach((f, i) => {
      const u = ((t / GAIT - f.lag / 1.0) % 1 + 1) % 1;                     // this finger's place in the gait
      const lift = smooth((u - 0.0) / 0.08) * (1 - smooth((u - 0.16) / 0.08));
      const phi = f.phi + 0.18 * Math.sin(2 * Math.PI * u) * (i === 4 ? 0.6 : 1);
      Bl.copy(B); f.base.worldToLocal(Bl);
      const reach = BR + R_TIP + 0.0012 + (f.liftBy ?? 0.014) * lift;           // (1 mm to spare: no part ever goes into the ball)
      const rho = Math.sqrt(Math.max(1e-6, reach * reach - Bl.z * Bl.z));
      solve(f, Bl.x + rho * Math.cos(phi), Bl.y + rho * Math.sin(phi), Bl);
      f.contact = 1 - lift;
    });
    scene.updateMatrixWorld(true);
    all.forEach((f, i) => {
      const p = f.tip.getWorldPosition(new THREE.Vector3()), a = arrows[i], on = f.contact > 0.6;
      const d = B.clone().sub(p).normalize(), len = 0.014 + 0.02 * f.contact;            // pushing on the fingertip from behind
      a.visible = on; a.position.copy(p).addScaledVector(d, -(R_TIP + len)); a.setDirection(d); a.setLength(len, 0.01, 0.007);
      f.tipMat.emissiveIntensity = 1.5 * smooth((f.contact - 0.5) / 0.5);
    });
  }
  let t0 = null;
  pose(0);
  const at = (o, dy = 0.02) => () => o.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, dy, 0));
  return {
    poses: {
      whole: { position: [0.3, 0.27, 0.36], target: [-0.02, 0.02, 0], fov: 38 },
      tips: { position: [0.22, 0.22, 0.26], target: [0.0, 0.06, 0.0], fov: 38 },
      joints: { position: [0.24, 0.12, -0.24], target: [0.01, 0.04, 0], fov: 40 },
      gait: { position: [0.06, 0.34, 0.16], target: [0.01, 0.05, 0], fov: 40 },
    },
    anchors: { ball: at(ball, 0.05), index: at(fingers[0].tip), middle: at(fingers[1].tip), thumb: at(thumb.tip), knuckle: at(fingers[3].joints[1], 0.022), wrist: at(wrist, 0.045) },
    actions: { frames({ on = true }) { frames.forEach((a) => { a.visible = on; }); } },
    frame(now) { if (t0 == null) t0 = now; pose(now - t0); },
    // (a check: how far into the ball any part of the hand goes, in metres; 0 = never)
    check(detail = false) {
      let worst = 0, who = null; const c = ball.getWorldPosition(new THREE.Vector3()), p = new THREE.Vector3();
      scene.traverse((o) => {
        if (!o.isMesh || o === ball || o.parent === ball || o.parent?.type === 'ArrowHelper') return;
        const g = o.geometry; if (!g?.attributes?.position) return;
        const pos = g.attributes.position;
        for (let i = 0; i < pos.count; i += 3) { p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); const d = BR - p.distanceTo(c); if (d > worst) { worst = d; who = o; } }
      });
      if (!detail) return worst;
      const f = all.findIndex((ff) => { let x = who; while (x) { if (x === ff.base) return true; x = x.parent; } return false; });
      return { worst, finger: f, q: all.map((ff) => ff.q.map((v) => +v.toFixed(2))), what: who?.geometry?.type };
    },
  };
}

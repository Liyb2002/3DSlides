// Dynamic scene: balls dropped into an open box, simple rigid-sphere physics
// (gravity, restitution, sphere-sphere and sphere-wall collisions).
// Deterministic: seeded initial state + fixed-step simStep().
import { addStudio, mulberry32, PALETTE } from '../../src/scenes/common.js';

export default function bouncingBalls({ THREE, scene, options }) {
  const N = options.count ?? 24;
  const R = options.radius ?? 0.22;
  const HALF = options.halfWidth ?? 1.6;   // box half extent in x/z
  const G = -9.8, E = 0.72;                // gravity, restitution

  addStudio(THREE, scene);

  // the box (open top)
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, transparent: true, opacity: 0.35 });
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.6 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(2 * HALF + 0.2, 0.1, 2 * HALF + 0.2), baseMat);
  base.position.y = -0.05; base.receiveShadow = true; scene.add(base);
  const wallH = 0.8;
  for (const [x, z, w, d] of [[HALF + 0.05, 0, 0.1, 2 * HALF], [-HALF - 0.05, 0, 0.1, 2 * HALF], [0, HALF + 0.05, 2 * HALF + 0.2, 0.1], [0, -HALF - 0.05, 2 * HALF + 0.2, 0.1]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
    m.position.set(x, wallH / 2, z); scene.add(m);
  }
  base.position.y = 0.0; // floor of the box sits at y = 0 (on top of studio floor)

  const geo = new THREE.SphereGeometry(R, 32, 16);
  const balls = [];
  for (let i = 0; i < N; i++) {
    const mat = new THREE.MeshStandardMaterial({ color: PALETTE[i % PALETTE.length], roughness: 0.35, metalness: 0.05 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true; scene.add(mesh);
    balls.push({ mesh, mat, p: new THREE.Vector3(), v: new THREE.Vector3(), base: mat.color.clone() });
  }

  function reset() {
    const rnd = mulberry32(options.seed ?? 7);
    balls.forEach((b, i) => {
      b.p.set((rnd() * 2 - 1) * (HALF - R), 1.5 + i * 0.35 + rnd() * 0.3, (rnd() * 2 - 1) * (HALF - R));
      b.v.set((rnd() - 0.5) * 2, 0, (rnd() - 0.5) * 2);
      b.mesh.position.copy(b.p);
    });
  }
  reset();

  const d = new THREE.Vector3(), n = new THREE.Vector3(), rv = new THREE.Vector3();
  function simStep(dt) {
    for (const b of balls) { b.v.y += G * dt; b.p.addScaledVector(b.v, dt); }
    // pairwise collisions
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      const a = balls[i], b = balls[j];
      d.subVectors(b.p, a.p);
      const dist = d.length();
      if (dist > 0 && dist < 2 * R) {
        n.copy(d).divideScalar(dist);
        const overlap = 2 * R - dist;
        a.p.addScaledVector(n, -overlap / 2); b.p.addScaledVector(n, overlap / 2);
        rv.subVectors(b.v, a.v);
        const vn = rv.dot(n);
        if (vn < 0) { const jimp = -(1 + E) * vn / 2; a.v.addScaledVector(n, -jimp); b.v.addScaledVector(n, jimp); }
      }
    }
    // box walls + floor
    for (const b of balls) {
      if (b.p.y < R) { b.p.y = R; if (b.v.y < 0) b.v.y *= -E; b.v.x *= 0.995; b.v.z *= 0.995; }
      for (const k of ['x', 'z']) {
        if (b.p[k] > HALF - R) { b.p[k] = HALF - R; if (b.v[k] > 0) b.v[k] *= -E; }
        if (b.p[k] < -HALF + R) { b.p[k] = -HALF + R; if (b.v[k] < 0) b.v[k] *= -E; }
      }
      b.mesh.position.copy(b.p);
    }
  }

  return {
    simStep,
    reset,
    anchors: {
      box: [0, wallH + 0.15, -HALF],
      first_ball: () => balls[0].p.clone().add(new THREE.Vector3(0, R + 0.05, 0)),
    },
    actions: {
      // { do: 'highlight', args: { index: 0 } } — fade all other balls to grey
      highlight({ index = 0, on = true }) {
        const grey = new THREE.Color(0xc7c7cc);
        const from = balls.map((b) => b.mat.color.clone());
        return (p) => balls.forEach((b, i) => {
          const to = !on || i === index ? b.base : grey;
          b.mat.color.copy(from[i]).lerp(to, p);
        });
      },
    },
  };
}

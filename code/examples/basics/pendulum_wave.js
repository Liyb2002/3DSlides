// Dynamic scene: a pendulum wave. Pendulum n completes (K + n) swings in
// T seconds, so the row drifts in and out of phase. State is a pure
// function of sim time, so replay is exact.
import { addStudio, PALETTE } from '../../src/scenes/common.js';

export default function pendulumWave({ THREE, scene, options }) {
  const N = options.count ?? 15;
  const T = options.period ?? 60, K = options.k ?? 51;
  const AMP = options.amplitude ?? 0.35;    // radians
  const TOP = 3.2, SPACING = 0.32;

  addStudio(THREE, scene);

  const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.5, metalness: 0.3 });
  const width = (N - 1) * SPACING + 0.6;
  const bar = new THREE.Mesh(new THREE.BoxGeometry(width, 0.08, 0.08), frameMat);
  bar.position.y = TOP; bar.castShadow = true; scene.add(bar);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, TOP), frameMat);
    post.position.set(s * width / 2, TOP / 2, 0); post.castShadow = true; scene.add(post);
  }

  const g = 9.8;
  const lineMat = new THREE.LineBasicMaterial({ color: 0x8e8e93 });
  const bobGeo = new THREE.SphereGeometry(0.11, 32, 16);
  const pends = [];
  for (let n = 0; n < N; n++) {
    const omega = (2 * Math.PI * (K + n)) / T;
    // true length g/omega^2 is tiny; scale all lengths so the longest is ~2.4
    const L0 = g / Math.pow((2 * Math.PI * K) / T, 2);
    const L = (g / (omega * omega)) * (2.4 / L0);
    const pivot = new THREE.Group();
    pivot.position.set((n - (N - 1) / 2) * SPACING, TOP, 0);
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, -L, 0)]);
    pivot.add(new THREE.Line(lineGeo, lineMat));
    const mat = new THREE.MeshStandardMaterial({ color: PALETTE[n % PALETTE.length], roughness: 0.3 });
    const bob = new THREE.Mesh(bobGeo, mat);
    bob.position.y = -L; bob.castShadow = true; pivot.add(bob);
    scene.add(pivot);
    pends.push({ pivot, bob, mat, omega, L, base: mat.color.clone() });
  }

  let t = 0;
  function pose() { for (const p of pends) p.pivot.rotation.z = AMP * Math.cos(p.omega * t); }
  pose();

  return {
    simStep(dt) { t += dt; pose(); },
    reset() { t = 0; pose(); },
    anchors: {
      first: () => pends[0].bob.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.18, 0)),
      last: () => pends[N - 1].bob.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.18, 0)),
      bar: [0, TOP + 0.15, 0],
    },
    actions: {
      highlight({ index = 0, on = true }) {
        const grey = new THREE.Color(0xd1d1d6);
        const from = pends.map((p) => p.mat.color.clone());
        return (q) => pends.forEach((p, i) => p.mat.color.copy(from[i]).lerp(!on || i === index ? p.base : grey, q));
      },
    },
  };
}

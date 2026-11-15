// Shared helpers for scene factories.

// Soft studio lighting + a shadow-catching floor.
export function addStudio(THREE, scene, { floor = true, floorColor = 0xf2f2f2, size = 40 } = {}) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9b9c4, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(4, 8, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const s = 6;
  Object.assign(key.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 0.5, far: 30 });
  key.shadow.bias = -0.0005;
  scene.add(key);
  if (floor) {
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({ color: floorColor, roughness: 0.95 }),
    );
    g.rotation.x = -Math.PI / 2;
    g.receiveShadow = true;
    scene.add(g);
  }
  return { key };
}

// Small deterministic PRNG so simulations replay identically.
export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PALETTE = [0xd1495b, 0x00798c, 0xedae49, 0x30638e, 0x66a182, 0x8e6c8a, 0xe07a5f];

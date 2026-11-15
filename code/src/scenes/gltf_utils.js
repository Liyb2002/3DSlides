// Helpers for scenes built from .glb models (paper figures exported with
// code/tools/*). Units are metres; scenes are ~0.3 m across.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const cache = new Map();
const loader = new GLTFLoader();

// Load once per URL; every slide gets its own deep clone (with its own
// materials, so one slide can recolour/fade parts without touching another).
export async function loadGLB(url) {
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url));
  const gltf = await cache.get(url);
  const root = gltf.scene.clone(true);
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return root;
}

// Paper-figure look: white studio, image-based light, one soft key light
// for shadows, and a shadow-catcher ground at y = groundY.
export function paperStudio(scene, renderer, { groundY = 0, extent = 0.4, keyDir = [-0.5, 1.4, 0.6], shadowOpacity = 0.18, ground: withGround = true, center = null } = {}) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.75;
  pmrem.dispose();

  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(...keyDir).normalize().multiplyScalar(extent * 4);
  key.position.y += groundY;
  if (center) { key.position.add(center); key.target.position.copy(center); }
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: extent * 0.5, far: extent * 10 });
  key.shadow.radius = 6;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.002;
  key.shadow.camera.updateProjectionMatrix();
  scene.add(key);
  scene.add(key.target);

  if (!withGround) return { key, ground: null };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(extent * 40, extent * 40), new THREE.ShadowMaterial({ opacity: shadowOpacity }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = groundY;
  ground.receiveShadow = true;
  ground.name = 'ground';
  scene.add(ground);
  return { key, ground };
}

// Collect the top-level nodes whose (sanitised) names pass `test`.
// (searches the whole tree, but does not descend into a match)
export function pick(root, test) {
  const out = [];
  const walk = (o) => { for (const c of o.children) { if (test(c.name)) out.push(c); else walk(c); } };
  walk(root);
  return out;
}

// Every material under the given objects.
export function materialsOf(objs) {
  const out = [];
  for (const o of objs) o.traverse((m) => { if (m.isMesh) out.push(...(Array.isArray(m.material) ? m.material : [m.material])); });
  return out;
}

// Fade a set of materials to opacity a (0..1). Returns an updater p -> void
// suitable for a scene action.
export function fadeTo(materials, a) {
  const from = materials.map((m) => m.opacity);
  return (p) => materials.forEach((m, i) => {
    const v = from[i] + (a - from[i]) * p;
    m.transparent = v < 0.999;
    m.depthWrite = v > 0.5;
    m.opacity = v;
    m.visible = v > 0.001;
  });
}

// Arrow made of a cylinder + cone (looks like the paper's 3D arrows).
export function makeArrow(color, { radius = 0.0015, headLength = 0.012, headRadius = 0.005 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1, transparent: true });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 16), mat);
  const head = new THREE.Mesh(new THREE.ConeGeometry(headRadius, headLength, 24), mat);
  const g = new THREE.Group();
  g.add(shaft, head);
  const up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3();
  g.userData.set = (tail, tip) => {
    d.subVectors(tip, tail);
    const L = d.length();
    const shaftL = Math.max(1e-4, L - headLength);
    shaft.scale.set(1, shaftL, 1);
    shaft.position.set(0, shaftL / 2, 0);
    head.position.set(0, shaftL + headLength / 2, 0);
    g.position.copy(tail);
    g.quaternion.setFromUnitVectors(up, d.normalize());
  };
  g.userData.material = mat;
  return g;
}

export const v3 = (a) => new THREE.Vector3(...a);

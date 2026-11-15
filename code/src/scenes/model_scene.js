// A 3D slide from one model file (the editor's "+ New 3D slide": a file is
// uploaded to <deck>/assets/models/uploads/ and the slide is
//   { type: '3d', model: 'assets/models/uploads/part.stl', camera: 'iso' }
// with no `scene`; slide.js then uses this factory).
//
// Formats: .stl .obj .ply .glb .gltf (self-contained) .3mf
// The model is centred on (0, 0, 0) (its bounding box), scaled so its largest
// side is `fit` (default 0.3; fit: null keeps the file's units), on a shadow
// ground just below it. CAD formats (stl, ply, 3mf) are z-up and turned to
// three.js's y-up; obj / glTF are y-up (override: sceneOptions.up 'y' | 'z').
// Camera poses: iso (isometric: along (1, 1, 1)), front, side, top.
// Anchor: model (just above it).
//
// sceneOptions: { model, up, fit, color, rotate: [x, y, z] degrees }
import * as THREE from 'three';
import { paperStudio } from './gltf_utils.js';

const Z_UP = new Set(['stl', 'ply', '3mf']);

export async function loadModel(url, ext, color) {
  const material = () => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide });
  if (ext === 'stl' || ext === 'ply') {
    const { [ext === 'stl' ? 'STLLoader' : 'PLYLoader']: L } = await import(`three/addons/loaders/${ext === 'stl' ? 'STLLoader' : 'PLYLoader'}.js`);
    const g = await new L().loadAsync(url);
    if (!g.attributes.normal) g.computeVertexNormals();
    const m = material();
    if (g.attributes.color) { m.vertexColors = true; m.color.set('#ffffff'); }
    return new THREE.Mesh(g, m);
  }
  if (ext === 'obj') {
    const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
    const o = await new OBJLoader().loadAsync(url);
    o.traverse((x) => { if (x.isMesh) { x.geometry.attributes.normal || x.geometry.computeVertexNormals(); x.material = material(); } });
    return o;
  }
  if (ext === '3mf') {
    const { ThreeMFLoader } = await import('three/addons/loaders/3MFLoader.js');
    return new ThreeMFLoader().loadAsync(url);
  }
  if (ext === 'glb' || ext === 'gltf') {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    return (await new GLTFLoader().loadAsync(url)).scene;
  }
  throw new Error(`model_scene: cannot read .${ext} (stl, obj, ply, glb, gltf, 3mf)`);
}

// the model of a file, centred on (0, 0, 0), z-up turned to y-up (CAD formats), its largest side `fit`
// (null: the file's units): a Group (the holder), ready to place
export async function centredModel(src, baseUrl, options = {}) {
  const url = new URL(src, baseUrl).href;
  const ext = src.split('?')[0].split('.').pop().toLowerCase();
  const obj = await loadModel(url, ext, options.color ?? '#9fb3c8');
  obj.traverse((x) => { if (x.isMesh) { x.castShadow = true; x.receiveShadow = true; } });
  const holder = new THREE.Group();
  holder.add(obj);
  if ((options.up ?? (Z_UP.has(ext) ? 'z' : 'y')) === 'z') obj.rotation.x = -Math.PI / 2;
  if (options.rotate) holder.rotation.set(...options.rotate.map((d) => THREE.MathUtils.degToRad(d)));
  holder.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(holder);
  const fit = options.fit === undefined ? 0.3 : options.fit;
  const side = Math.max(...box.getSize(new THREE.Vector3()).toArray()) || 1;
  if (fit) holder.scale.setScalar(fit / side);
  holder.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(holder);
  holder.position.sub(box.getCenter(new THREE.Vector3()));
  holder.updateMatrixWorld(true);
  const inner = new THREE.Group(); inner.add(holder);              // the centred model, scale 1 = `fit`
  return inner;
}

export default async function modelScene({ scene, renderer, camera, options, baseUrl }) {
  const holder = await centredModel(options.model, baseUrl, options);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder);
  scene.add(holder);

  const r = box.getBoundingSphere(new THREE.Sphere()).radius || 1;
  paperStudio(scene, renderer, { groundY: box.min.y, extent: r * 2.2, center: new THREE.Vector3() });
  camera.near = r / 200; camera.far = r * 200; camera.updateProjectionMatrix();

  // poses: the whole model in the frame, from these directions
  const fov = 30, dist = (r * 1.15) / Math.sin(THREE.MathUtils.degToRad(fov / 2));
  const at = (d) => ({ position: new THREE.Vector3(...d).normalize().multiplyScalar(dist).toArray(), target: [0, 0, 0], fov });
  return {
    poses: { iso: at([1, 1, 1]), front: at([0, 0.25, 1]), side: at([1, 0.25, 0]), top: at([0, 1, 0.0001]) },
    anchors: { model: () => new THREE.Vector3(0, box.max.y + r * 0.15, 0) },
    object: holder,
  };
}

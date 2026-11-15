// The 3D Slides logo, as a 3D slide: a "3" from the front, a "D" from the side. Click: it turns to the D; click:
// to a view between the two, and the name.
import logoScene from './logo_scene.js';

export default {
  title: '3D Slides',
  size: [1920, 1080],
  theme: { background: '#faf7f0', color: '#1d1d1f', accent: '#c9a227' },
  slides: [
    {
      id: 'logo', type: '3d',
      scene: logoScene,
      camera: 'three',
      near: 0.1, far: 100,
      elements: [
        { id: 'name', type: 'text', text: '3D Slides', font: 'Inter', fontSize: 150, fontWeight: 700, x: 860, y: 380, w: 960, on: [2, null] },
        { id: 'line', type: 'text', text: 'Present in 3D.', font: 'Inter', fontSize: 44, color: '#6b6b70', x: 868, y: 590, w: 960, on: [2, null] },
      ],
      enter: [],
      steps: [
        [{ camera: 'dee', duration: 1.3 }],
        [{ camera: { position: [7.7, 3.6, 6.19], target: [1.1, 0, -1.01], fov: 18 }, duration: 1.3 }],   // (between the two, the logo on the left)
      ],
    },
  ],
};

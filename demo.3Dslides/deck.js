// A walk through Van Gogh: six of his paintings in one 3D world.
// The Starry Night's sky over everything; its hill is the Wheatfield with Crows; in the village, the Café
// Terrace; by the house, an almond tree in blossom;
// inside, the Bedroom, the Sunflowers on the table, his Chair; from the window, the sky again.
// Each page flies to one painting; the original is top right, its card under it. No titles.
import starryNight from './scenes/starry_night.js';

// One exhibit per page, top right: the original painting (public domain images from Wikimedia Commons,
// assets/paintings/) and under it its card: title, year, on off-white with a thin gold edge. A new page like
// these is made by copying the two from another page (⌘C, ⌘V), then "replace image…" and editing the text.
const ASPECT = { starry_night: 1200 / 950, cafe_terrace: 957 / 1200, almond_blossom: 1200 / 948, bedroom: 1200 / 952,
  sunflowers: 951 / 1200, chair: 935 / 1200 };
const CARD = { background: '#fbf8ef', border: '2px solid #c9a227', borderRadius: '6px', padding: '10px 20px', boxShadow: '0 6px 22px rgba(0, 0, 20, 0.35)' };
const exhibit = (id, page, name, title) => [
  { id: `p_${id}`, type: 'image', src: `assets/paintings/${name}.jpg`, x: 1240, y: 80, w: 600, on: [page, page] },
  { id: `c_${id}`, type: 'text', text: title, font: 'Merriweather', fontSize: 30, style: CARD, x: 1240, y: 80 + Math.round(600 / ASPECT[name]) + 16, w: 600, on: [page, page] },
];
// the last page: all of them in a row
const ROW = ['starry_night', 'cafe_terrace', 'almond_blossom', 'bedroom', 'sunflowers', 'chair'];
const thumbs = (() => {
  const H = 160, gap = 18, ws = ROW.map((n) => Math.round(H * ASPECT[n])), total = ws.reduce((s, w) => s + w, 0) + gap * (ROW.length - 1);
  let x = (1920 - total) / 2;
  return ROW.map((n, i) => { const el = { id: `t_${n}`, type: 'image', src: `assets/paintings/${n}.jpg`, x: Math.round(x), y: 830, w: ws[i], h: H, on: [7, null],
    style: { border: '5px solid #9a7a32', boxShadow: '0 8px 24px rgba(0, 0, 20, 0.5)' } }; x += ws[i] + gap; return el; });
})();

export default {
  title: 'Starry Night: a walk through Van Gogh',
  size: [1920, 1080],
  theme: { background: '#f6f1e6', color: '#1d1d1f', accent: '#c9a227' },   // (2D scenes: a museum wall; the 3D scene draws its own sky)
  transition: { type: 'fade', duration: 0.6 },

  slides: [
    {
      id: 'starry_night', type: '3d',
      scene: starryNight,
      sceneOptions: { swirl: 1 },
      camera: 'painting',
      near: 0.1, far: 1200,
      elements: [
        ...exhibit('title', 0, 'starry_night', 'The Starry Night, 1889'),
        ...exhibit('cafe', 1, 'cafe_terrace', 'Café Terrace at Night, 1888'),
        ...exhibit('almond', 2, 'almond_blossom', 'Almond Blossom, 1890'),
        ...exhibit('bedroom', 3, 'bedroom', 'The Bedroom, 1888'),
        ...exhibit('sunflowers', 4, 'sunflowers', 'Sunflowers, 1888'),
        ...exhibit('chair', 5, 'chair', "Van Gogh's Chair, 1888"),
        ...exhibit('window', 6, 'starry_night', 'The Starry Night, 1889'),
        ...thumbs,
      ],
      enter: [],
      steps: [
        [{ camera: 'cafe', duration: 3.0 }],
        [{ camera: 'almond', duration: 2.8 }],
        [{ camera: 'door', duration: 2.2 }, { camera: 'bedroom', duration: 2.0, delay: 2.2 }],   // in through the door
        [{ camera: 'sunflowers', duration: 2.0 }],
        [{ camera: 'chair', duration: 2.0 }],
        [{ camera: 'window', duration: 2.4 }],
        [{ camera: 'painting', duration: 3.4 }, { do: 'swirl', args: { to: 1.8 }, duration: 3.0 }],
      ],
    },
  ],
};

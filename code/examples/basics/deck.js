// Demo deck: 3D -> 2D -> 2D -> 3D -> 2D
//
// A deck is plain data. Each slide is either a 2D page or a 3D space.
// `enter` runs automatically when the slide appears; each entry of `steps`
// runs on one click (all actions in a step run in parallel, `delay` offsets
// them; a step with `auto: true` runs as soon as the previous one finishes).
import bouncingBalls from './bouncing_balls.js';
import pendulumWave from './pendulum_wave.js';

export default {
  title: '3D Slides demo',
  size: [1920, 1080],
  theme: { background: '#ffffff', color: '#1d1d1f', accent: '#d1495b' },
  transition: { type: 'fade', duration: 0.6 },

  slides: [
    // ------------------------------------------------------------ 1: 3D
    {
      type: '3d',
      background: '#e9e9ee',
      scene: bouncingBalls,
      sceneOptions: { count: 24, seed: 7 },
      camera: { position: [0, 7.5, 10], target: [0, 1.5, 0], fov: 40 },  // start pose
      poses: {
        close: { position: [3.6, 2.8, 4.2], target: [0, 0.4, 0], fov: 45 },
        top: { position: [0, 7, 0.01], target: [0, 0, 0], fov: 45 },
      },
      elements: [
        { id: 'title', type: 'text', text: '3D Slides', className: 'title', x: 140, y: 180 },
        { id: 'subtitle', type: 'text', text: 'pages can be spaces', className: 'subtitle', x: 144, y: 300 },
        { id: 'tag', type: 'text', text: 'ball #0', className: 'label', anchor: 'first_ball' },
        { id: 'note', type: 'text', className: 'caption', x: 140, y: 940, w: 1200,
          text: 'the simulation runs **only** when a step tells it to — and replays exactly on ←' },
      ],
      enter: [
        { show: 'title', anim: 'fly_up', duration: 0.8 },
        { show: 'subtitle', anim: 'fly_up', delay: 0.25 },
      ],
      steps: [
        // click 1: titles leave, camera flies in, balls drop for 5 s of sim time
        [
          { hide: 'title' }, { hide: 'subtitle' },
          { camera: 'close', duration: 2.2, delay: 0.2 },
          { sim: 'play', duration: 5, delay: 0.6 },
          { show: 'note', anim: 'fade', delay: 1.0 },
        ],
        // click 2: highlight one ball, label follows it in 3D
        [{ do: 'highlight', args: { index: 0 } }, { show: 'tag', anim: 'pop', delay: 0.3 }],
        // click 3: turntable around the box, then automatically go top-down
        [{ orbit: 140, duration: 4 }],
        { auto: true, actions: [{ camera: 'top', duration: 1.8 }, { hide: 'tag' }] },
      ],
    },

    // ------------------------------------------------------------ 2: 2D
    {
      type: '2d',
      elements: [
        { id: 'h', type: 'text', text: 'The idea', className: 'heading', x: 140, y: 120 },
        { id: 'list', type: 'bullets', x: 140, y: 280, w: 1500, items: [
          'A slide is a **unit**: either a 2D page or a 3D space',
          '2D: text / image / video + entrance animations',
          '3D: a start camera pose; camera moves are **animations**',
          '3D scenes can be **dynamic**: steps can run the simulation',
          'No free camera while presenting',
        ] },
      ],
      enter: [{ show: 'h', anim: 'fly_right' }],
      steps: [
        [{ show: 'list', anim: 'fly_left', stagger: 0.15 }],
      ],
    },

    // ------------------------------------------------------------ 3: 2D
    {
      type: '2d',
      elements: [
        { id: 'h', type: 'text', text: 'Images and video', className: 'heading', x: 140, y: 120 },
        { id: 'img', type: 'image', src: 'assets/diagram.svg', x: 140, y: 300, w: 800, h: 450 },
        { id: 'vid', type: 'video', src: 'assets/sample_clip.mp4', x: 1000, y: 300, w: 800, h: 450, loop: true,
          style: { borderRadius: '24px', background: '#000' } },
        { id: 'cap', type: 'text', className: 'caption', x: 140, y: 800, w: 1660,
          text: 'video playback is just another action: { play: "vid" }' },
      ],
      enter: [{ show: 'h', anim: 'fade' }],
      steps: [
        [{ show: 'img', anim: 'wipe', duration: 0.9 }],
        [{ show: 'vid', anim: 'zoom' }, { play: 'vid', delay: 0.4 }, { show: 'cap', delay: 0.5 }],
      ],
    },

    // ------------------------------------------------------------ 4: 3D
    {
      type: '3d',
      background: '#f4f1ea',
      scene: pendulumWave,
      sceneOptions: { count: 15 },
      camera: { position: [0, 2.2, 7.5], target: [0, 1.7, 0], fov: 45 },
      poses: {
        side: { position: [6.5, 2.0, 2.2], target: [0, 1.4, 0], fov: 40 },
        below: { position: [0.3, 0.25, 3.2], target: [0, 1.6, 0], fov: 60 },
        front: { position: [0, 2.2, 7.5], target: [0, 1.7, 0], fov: 45 },
      },
      elements: [
        { id: 'h', type: 'text', text: 'A scene that keeps running', className: 'heading', x: 120, y: 80 },
        { id: 'l0', type: 'text', text: '51 swings / min', className: 'label', anchor: 'first' },
        { id: 'l1', type: 'text', text: '65 swings / min', className: 'label', anchor: 'last' },
      ],
      enter: [
        { show: 'h', anim: 'fly_up' },
        { sim: 'play' }, // free-running: keeps going until paused
      ],
      steps: [
        [{ hide: 'h' }, { camera: 'side', duration: 2.5 }],
        [{ do: 'highlight', args: { index: 0 } }, { show: 'l0', anim: 'pop' }],
        [{ do: 'highlight', args: { index: 14 } }, { hide: 'l0' }, { show: 'l1', anim: 'pop' }],
        [{ do: 'highlight', args: { on: false } }, { hide: 'l1' }, { camera: 'below', duration: 2.5, path: 'linear' }],
        [{ sim: 'play', speed: 3 }],
        [{ sim: 'pause' }, { camera: 'front', duration: 2 }],
      ],
    },

    // ------------------------------------------------------------ 5: 2D
    {
      type: '2d',
      elements: [
        { id: 't', type: 'text', text: 'Thanks', className: 'title', x: 0, y: 440, w: 1920, style: { textAlign: 'center' } },
      ],
      enter: [{ show: 't', anim: 'zoom', duration: 0.8, ease: 'out_back' }],
    },
  ],
};

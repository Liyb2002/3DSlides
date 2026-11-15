// Four lectures, one 3D scene each (the product video's "it generalizes" part): mechanics, robotics, mechanical
// engineering, architecture. Each has four pages: the whole thing, then the camera flies in to one part after
// another, each page with its own words, equation and labels. The scenes move by themselves all along.
import chaos from './scenes/chaos.js';
import dexterousHand from './scenes/dexterous_hand.js';
import engineI4 from './scenes/engine_i4.js';
import cathedral from './scenes/cathedral.js';

const course = (id, text, color = '#6e6e73') => ({ id, type: 'text', text, font: 'Inter', fontSize: 30, fontWeight: 700, color, x: 110, y: 70, w: 1200, on: [0, null] });
const title = (id, text, color = '#1d1d1f') => ({ id, type: 'text', text, font: 'Inter', fontSize: 68, fontWeight: 700, color, x: 110, y: 112, w: 1300, on: [0, null] });
const eq = (id, page, tex, y = 312) => ({ id, type: 'math', tex, display: false, x: 110, y, w: 900, fontSize: 44, on: [page, page] });
const note = (id, page, text, color = '#3a3a3c', y = 230) => ({ id, type: 'text', text, font: 'Inter', fontSize: 32, color, x: 110, y, w: 820, on: [page, page] });
// an equation on a card next to what it is about (it follows that point of the 3D scene)
const eqAt = (id, page, tex, anchor) => ({ id, type: 'text', text: `$${tex}$`, className: 'label', anchor, fontSize: 36, on: [page, page],
  style: { background: 'rgba(255, 255, 255, 0.94)', border: '1.5px solid #c7c7cc', padding: '10px 18px' } });
const label = (id, page, text, anchor, dark = false) => ({ id, type: 'text', text, className: 'label', anchor, fontSize: 30, on: [page, page],
  ...(dark ? { style: { background: 'rgba(255, 255, 255, 0.92)', color: '#163f6c' } } : {}) });
const fly = (pose, extra = []) => [{ camera: pose, duration: 1.7 }, ...extra];
const BLUE = '#dbe9f8';

export default {
  title: 'Four lectures in 3D',
  size: [1920, 1080],
  theme: { background: '#ffffff', color: '#1d1d1f', accent: '#2f6fb3' },
  transition: { type: 'fade', duration: 0.6 },

  slides: [
    {
      id: 'mechanics', type: '3d', scene: chaos, camera: 'whole', near: 0.05, far: 100, lensShift: [0.2, -0.06],
      elements: [
        course('c1', 'PHYS 201 · Classical Mechanics · Lecture 9'), title('t1', 'Chaos in the double pendulum'),
        note('n1', 0, '40 pendulums, started 0.003 rad apart.'), label('a1', 0, 'phase space', 'phase'), label('a0', 0, 'separation', 'plot'),
        eqAt('e1', 0, '\\mathcal{L} = ml^2\\big(\\dot\\theta_1^2 + \\tfrac{1}{2}\\dot\\theta_2^2 + \\dot\\theta_1\\dot\\theta_2\\cos(\\theta_1-\\theta_2)\\big) + mgl\\,(2\\cos\\theta_1 + \\cos\\theta_2)', 'eqPendulum'),
        note('n2', 1, 'For two seconds they move as one; then they fan out.'), label('a2', 1, 'θ₀', 'first'), label('a3', 1, 'θ₀ + 0.117', 'last'),
        eqAt('e2', 1, '\\Delta\\theta_0 = 3 \\times 10^{-3}\\ \\text{rad}', 'eqFan'),
        note('n3', 2, 'In phase space, one curve becomes forty.'), eqAt('e3', 2, '(\\sin\\theta_1,\\ \\sin\\theta_2,\\ \\dot\\theta_1)', 'eqPhase'),
        label('a4', 2, 'sin θ₁', 'axis1'), label('a5', 2, 'sin θ₂', 'axis2'), label('a6', 2, 'θ̇₁', 'axis3'),
        note('n4', 3, 'The separation grows exponentially: its slope is the Lyapunov exponent.'), eqAt('e4', 3, '|\\delta(t)| \\approx |\\delta_0|\\, e^{\\lambda t}', 'eqPlot'),
        label('a8', 3, 'fit: slope λ', 'slope'),
      ],
      enter: [], steps: [fly('fan'), fly('phase'), fly('plot')],
    },
    {
      id: 'robotics', type: '3d', scene: dexterousHand, camera: 'whole', near: 0.01, far: 20, lensShift: [0.16, 0],
      elements: [
        course('c2', 'ROB 310 · Robot Manipulation · Lecture 8'), title('t2', 'Dexterous in-hand manipulation'),
        note('n5', 0, 'A five-fingered hand turns a ball in its fingertips.'), label('b1', 0, 'ball', 'ball'), label('b2', 0, 'wrist', 'wrist'),
        note('n6', 1, 'Fingertips sense contact; each force stays in its friction cone.'), eq('e6', 1, '\\mathbf{f}_i \\in \\mathcal{FC}_i,\\quad \\textstyle\\sum_i G_i\\,\\mathbf{f}_i = \\mathbf{w}'),
        label('b3', 1, 'index', 'index'), label('b4', 1, 'thumb', 'thumb'),
        note('n7', 2, 'Each finger is posed by inverse kinematics, every frame.'), eq('e7', 2, '\\mathbf{q}_i = \\mathrm{IK}_i(\\mathbf{p}_i),\\quad \\mathbf{q} \\in \\mathbb{R}^{22}'), label('b5', 2, 'PIP joint', 'knuckle'),
        note('n8', 3, 'Finger gaiting: lift, move, press again, one finger at a time.'), label('b6', 3, 'middle', 'middle'), label('b7', 3, 'thumb', 'thumb'),
      ],
      enter: [], steps: [fly('tips'), fly('joints', [{ do: 'frames', args: { on: true } }]), fly('gait', [{ do: 'frames', args: { on: false } }])],
    },
    {
      id: 'engine', type: '3d', scene: engineI4, camera: 'whole', near: 0.01, far: 50, lensShift: [0.2, -0.05],
      elements: [
        course('c3', 'MECH 220 · Machine Design · Lecture 12'), title('t3', 'The inline-four engine'),
        note('n9', 0, 'Four cylinders, firing order 1-3-4-2.'), label('d1', 0, 'timing belt', 'belt'), label('d2', 0, 'flywheel', 'flywheel'), label('d3', 0, 'crankshaft', 'crank'),
        note('n10', 1, 'Overhead cams open each valve once every two turns.'), eq('e10', 1, '\\omega_{\\text{cam}} = \\tfrac{1}{2}\\,\\omega_{\\text{crank}}'),
        label('d4', 1, 'camshaft', 'cam'), label('d5', 1, 'valve', 'valve'), label('d6', 1, 'spark plug', 'plug'),
        note('n11', 2, 'Intake, compression, power, exhaust.'), eq('e11', 2, 'x(\\theta) = r\\cos\\theta + \\sqrt{l^2 - r^2\\sin^2\\theta}'),
        label('d7', 2, 'piston', 'piston'), label('d8', 2, 'connecting rod', 'rod'), label('d9', 2, 'flywheel', 'flywheel'),
        note('n12', 3, 'Fresh charge in through the runners, exhaust out through the headers.'), eq('e12', 3, '\\dot m = \\rho\\, A\\, v'),
        label('d10', 3, 'intake plenum', 'intake'), label('d11', 3, 'exhaust headers', 'exhaust'),
      ],
      enter: [], steps: [fly('valves'), fly('pistons'), fly('flow')],
    },
    {
      id: 'architecture', type: '3d', scene: cathedral, sceneOptions: { built: 0 }, camera: 'plan', near: 1, far: 2000, lensShift: [0.15, -0.1],
      elements: [
        course('c4', 'ARCH 140 · History of Architecture · Lecture 11', '#9fc3ea'), title('t4', 'Building Notre-Dame de Paris', '#ffffff'),
        note('n13', 0, '1163–1182: the choir, the apse and its chapels come first.', BLUE), label('g1', 0, 'choir', 'choir', true), label('g2', 0, 'radiating chapels', 'chapels', true),
        note('n14', 1, '1182–1250: the nave and its ribbed vaults;\nflying buttresses carry their thrust outside.', BLUE), label('g3', 1, 'flying buttress', 'buttresses', true), label('g4', 1, 'pinnacle', 'pinnacle', true), label('g5', 1, 'clerestory', 'clerestory', true),
        note('n15', 2, '1200–1250: the west front: three portals,\nthe Gallery of Kings, the rose window.', BLUE), label('g6', 2, 'rose window · 9.6 m', 'rose', true), label('g7', 2, 'Gallery of Kings · 28', 'kings', true), label('g8', 2, 'portal', 'portal', true),
        note('n16', 3, '1859: Viollet-le-Duc’s spire, 96 m,\nwith the twelve apostles coming down the roofs.', BLUE), label('g9', 3, 'spire', 'spire', true), label('g10', 3, 'towers · 69 m', 'towers', true), label('g11', 3, 'apostles', 'apostles', true),
      ],
      enter: [{ camera: 'choir', duration: 1.8, delay: 0.1 }, { do: 'build', args: { to: 1 }, duration: 2.3, delay: 0.4 }],
      steps: [
        [{ camera: 'nave', duration: 1.7 }, { do: 'build', args: { to: 3 }, duration: 2.4 }],
        [{ camera: 'front', duration: 1.7 }, { do: 'build', args: { to: 4 }, duration: 2.2 }],
        [{ camera: 'spire', duration: 1.7 }, { do: 'build', args: { to: 5 }, duration: 2.0 }],
      ],
    },
  ],
};

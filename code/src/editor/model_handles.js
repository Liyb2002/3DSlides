// Handles on the selected 3D shape of a 3D scene (editor only), drawn as dots over the canvas:
//   8 corners          scale it as a whole
//   6 face middles     stretch it one way only: along that side
//   Both about its centre, by how far the pointer goes along the line from the centre to the dot
//   (on the screen): out = bigger, in = smaller.
//   the round one      turns it about the line from the camera to it (as a 2D element turns on the page)
// The model data (def.models[id]): size (its largest side), stretch [x, y, z] (per side of its own box),
// quat [x, y, z, w] (its turn; `turn` degrees about the vertical is the older, simpler form), position.
import * as THREE from 'three';
import { modelAt } from '../engine/model_view.js';

const h = (cls) => { const d = document.createElement('div'); d.className = cls; return d; };

export class ModelHandles {
  constructor(editor, inst, id) {
    Object.assign(this, { editor, inst, id });
    this.holder = inst.models.get(id);
    // the model's own box (in the holder's frame, before its scale / turn)
    const inner = this.holder.children[0];
    inner.updateMatrix();
    const box = new THREE.Box3();
    inner.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.computeBoundingBox();
      const m = new THREE.Matrix4();
      for (let p = o; p && p !== this.holder; p = p.parent) { p.updateMatrix(); m.premultiply(p.matrix); }
      box.union(o.geometry.boundingBox.clone().applyMatrix4(m));
    });
    this.box = box;
    this.dots = [];
    const S = [-1, 1];
    for (const x of S) for (const y of S) for (const z of S) this.dots.push({ o: [x, y, z], kind: 'corner' });
    for (const a of [0, 1, 2]) for (const u of S) {                                // the middle of each face
      const o = [0, 0, 0]; o[a] = u;
      this.dots.push({ o, kind: 'edge' });
    }
    this.dots.push({ kind: 'turn' });
    for (const d of this.dots) {
      d.el = h(d.kind === 'turn' ? 'ed-rotate ed-3d-dot' : `ed-resize ed-3d-dot ${d.kind === 'edge' ? 'edge' : ''}`);
      d.el.addEventListener('pointerdown', (e) => this.start(e, d));
      inst.overlay.appendChild(d.el);
    }
    this.place();
  }

  get model() { return modelAt(this.inst.def.models[this.id], this.inst.stepIndex); }   // as it is on the page shown

  // a point of the model's own box (o: -1 / 0 / 1 per side) in the world
  world(o) {
    const b = this.box, c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    return new THREE.Vector3(c.x + o[0] * s.x, c.y + o[1] * s.y, c.z + o[2] * s.z).applyMatrix4(this.holder.matrixWorld);
  }

  // a world point on the stage (px)
  screen(p) {
    const v = p.clone().project(this.inst.camera), [W, H] = this.editor.player.size;
    return new THREE.Vector2((v.x + 1) / 2 * W, (1 - v.y) / 2 * H);
  }

  place() {
    if (!this.holder.parent) return this.dispose();
    this.holder.updateMatrixWorld(true);
    const top = this.world([0, 1, 0]), c = this.world([0, 0, 0]);
    for (const d of this.dots) {
      let p;
      if (d.kind === 'turn') {                       // above the box on the screen
        const st = this.screen(top), sc = this.screen(c), up = st.clone().sub(sc);
        const s = up.length() > 1 ? up.normalize() : new THREE.Vector2(0, -1);
        p = st.addScaledVector(s, 40);
      } else p = this.screen(this.world(d.o));
      d.el.style.left = `${p.x - 10}px`; d.el.style.top = `${p.y - 10}px`;
    }
  }

  dispose() { this.dots.forEach((d) => d.el.remove()); this.dots = []; }

  stageXY(e) {
    const r = this.inst.overlay.getBoundingClientRect(), s = this.editor.player.scale || 1;
    return new THREE.Vector2((e.clientX - r.left) / s, (e.clientY - r.top) / s);
  }

  start(e, d) {
    e.preventDefault(); e.stopPropagation();
    const ctl = this.inst.devControls; if (ctl) ctl.enabled = false;
    const m = this.model, holder = this.holder;
    const size0 = m.size ?? 0.2, st0 = [...(m.stretch || [1, 1, 1])], q0 = holder.quaternion.clone();
    const p0 = this.stageXY(e), c0 = this.screen(this.world([0, 0, 0]));
    // the line from the centre to the dot, on the screen, when the drag starts
    const dir = d.o ? this.screen(this.world(d.o)).sub(c0) : new THREE.Vector2(), r0 = dir.length(); dir.normalize();
    let props = null;
    const move = (ev) => {
      const p = this.stageXY(ev), dlt = p.clone().sub(p0);
      if (d.kind !== 'turn') {
        // along the line from the centre to the dot: k = (r0 + the pointer's move along it) / r0
        const k = Math.max(0.05, r0 > 1 ? 1 + dlt.dot(dir) / r0 : 1);
        if (d.kind === 'corner' || m.lockRatio) props = { size: +(size0 * k).toFixed(4) };   // as a whole (corners; or the lock)
        else {
          const st = [...st0];
          for (const a of [0, 1, 2]) if (d.o[a]) st[a] = +(st0[a] * k).toFixed(4);
          props = { stretch: st };
        }
      } else {                                       // turn about the line from the camera to it
        const a0 = Math.atan2(p0.y - c0.y, p0.x - c0.x), a1 = Math.atan2(p.y - c0.y, p.x - c0.x);
        const axis = holder.getWorldPosition(new THREE.Vector3()).sub(this.inst.camera.position).normalize();
        const q = new THREE.Quaternion().setFromAxisAngle(axis, a1 - a0).multiply(q0);
        props = { quat: q.toArray().map((v) => +v.toFixed(5)) };
      }
      this.editor.previewModel(this.inst, this.id, props);
      this.place();
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (ctl) ctl.enabled = true;
      if (props) this.editor.editModel(this.inst, this.id, props);
      this.place();
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
}

// Action vocabulary. An action is a plain object in the deck file; this
// module turns it into a Task (see tween.js). All actions accept `delay`
// (seconds, relative to the start of the step).
//
// 2D + 3D:
//   { show: 'id', anim: 'fade', duration: 0.6, ease, stagger }
//   { hide: 'id', anim: 'fade', duration: 0.4 }
//   { play: 'videoId' } / { pause: 'videoId' } / { seek: 'videoId', time: 0 }
//   { wait: 1.5 }                                   (no-op that takes time)
// 3D only:
//   { camera: 'poseName' | {position,target,fov}, duration: 1.5, path: 'orbit'|'linear', ease }
//   { orbit: 90, duration: 4, axis: [0,1,0] }        (turntable around target)
//   { sim: 'play' | 'pause' | 'reset', duration?, speed? }
//   { sim: 'play', until: 'marker', speed? }        (run to a time the scene names)
//   { do: 'sceneActionName', args: {...}, duration? } (custom scene hook)

import { tweenTask } from './tween.js';
import { applyAnim } from './elements.js';
import { normalizePose } from './camera_rig.js';

export const ACTION_KEYS = ['show', 'hide', 'play', 'pause', 'seek', 'wait', 'camera', 'orbit', 'sim', 'do'];

export function isAction(obj) {
  return obj && typeof obj === 'object' && !Array.isArray(obj) && ACTION_KEYS.some((k) => k in obj);
}

let gifPlays = 0;

function instantTask(fn) {
  return { done: false, start() { fn(); this.done = true; }, update() {}, finish() { this.done = true; } };
}

// ctx = the SlideInstance
export function makeTask(action, ctx) {
  if ('show' in action || 'hide' in action) {
    const showing = 'show' in action;
    const id = showing ? action.show : action.hide;
    const el = ctx.getElement(id);
    const anim = action.anim || 'fade';
    const duration = action.duration ?? (showing ? 0.6 : 0.4);
    const targets = action.stagger != null ? Array.from(el.children) : [el];
    if (action.stagger != null) {
      // container becomes visible immediately; children animate one by one
      el.style.visibility = 'visible'; el.style.opacity = 1;
    }
    const n = targets.length;
    const stagger = action.stagger || 0;
    const total = duration + stagger * (n - 1);
    return tweenTask({
      duration: total,
      ease: 'linear',
      onStart: () => {
        if (action.stagger != null) { el.style.visibility = 'visible'; el.style.opacity = 1; }
        ctx.markShown(id, showing);
        // an animated GIF starts from its first frame when it appears (not wherever its loop is)
        if (showing && !ctx.replaying && el.tagName === 'IMG' && /\.gif(\?|$)/i.test(el.src)) {
          el.src = `${el.src.replace(/[?&]play=\d+/, '')}${el.src.includes('?') ? '&' : '?'}play=${++gifPlays}`;
        }
        // a video with autoplay plays from the start when it appears
        if (showing && !ctx.replaying && el.tagName === 'VIDEO' && el.dataset.autoplay) { el.currentTime = 0; el.play?.().catch(() => {}); }
      },
      onUpdate: (q) => {
        const t = q * total;
        targets.forEach((child, i) => {
          let p = duration > 0 ? (t - i * stagger) / duration : 1;
          p = Math.max(0, Math.min(1, p));
          p = ctx.ease(action.ease || 'out_cubic')(p);
          applyAnim(child, anim, showing ? p : 1 - p);
        });
      },
    });
  }

  if ('play' in action || 'pause' in action || 'seek' in action) {
    const id = action.play ?? action.pause ?? action.seek;
    const v = ctx.getElement(id);
    return instantTask(() => {
      if ('seek' in action) v.currentTime = action.time || 0;
      if ('play' in action && !ctx.replaying) v.play().catch(() => {});
      if ('pause' in action) v.pause();
    });
  }

  if ('wait' in action) {
    return tweenTask({ duration: action.wait });
  }

  if ('camera' in action) {
    ctx.require3D('camera');
    let update;
    return tweenTask({
      duration: action.duration ?? 1.5,
      ease: action.ease || 'in_out_cubic',
      onStart: () => {
        // a partial inline pose (e.g. only fov) keeps the rest of the current pose
        const pose = typeof action.camera === 'string'
          ? ctx.getPose(action.camera)
          : normalizePose(action.camera, ctx.rigPoseArrays());
        update = ctx.rig.interpolator(pose, action.path || 'orbit');
      },
      onUpdate: (p) => update(p),
    });
  }

  if ('orbit' in action) {
    ctx.require3D('orbit');
    let update;
    return tweenTask({
      duration: action.duration ?? 4,
      ease: action.ease || 'in_out_sine',
      onStart: () => { update = ctx.rig.orbitInterpolator(action.orbit, action.axis); },
      onUpdate: (p) => update(p),
    });
  }

  if ('sim' in action) {
    ctx.require3D('sim');
    const sim = ctx.sim;
    const cmd = action.sim;
    if (cmd === 'play' && (action.duration != null || action.until != null)) {
      // deterministic: advance exactly `duration` seconds of sim time, or up to a scene marker
      return {
        done: false,
        start() {
          if (action.speed != null) sim.speed = action.speed;
          let d = action.duration;
          if (action.until != null) {
            const at = ctx.sceneApi?.markers?.[action.until];
            if (at == null) throw new Error(`Scene has no marker "${action.until}"`);
            d = Math.max(0, at - sim.time - sim.budget);
          }
          sim.runFor(d);
        },
        update() { if (sim.budget <= 0) this.done = true; },
        finish() { sim.flushBudget(); this.done = true; },
      };
    }
    return instantTask(() => {
      if (action.speed != null) sim.speed = action.speed;
      if (cmd === 'play') sim.play();
      else if (cmd === 'pause') sim.pause();
      else if (cmd === 'reset') sim.reset();
      else throw new Error(`Unknown sim command: ${cmd}`);
    });
  }

  if ('do' in action) {
    ctx.require3D('do');
    const fn = ctx.sceneApi?.actions?.[action.do];
    if (!fn) throw new Error(`Scene has no action "${action.do}"`);
    let update;
    return tweenTask({
      duration: action.duration ?? 0.8,
      ease: action.ease || 'in_out_cubic',
      // a scene action may return an updater p -> void to animate; or
      // nothing, in which case it is applied immediately.
      onStart: () => { update = fn(action.args || {}, ctx); },
      onUpdate: (p) => { if (typeof update === 'function') update(p); },
    });
  }

  throw new Error(`Unknown action: ${JSON.stringify(action)}`);
}

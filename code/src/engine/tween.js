// Easing functions + a tiny task scheduler.
//
// Every animated thing in a slide (element entrance, camera move, sim run,
// custom scene action) is a Task with the same interface:
//   start(now)   called once when its delay has elapsed
//   update(now)  called every frame after start
//   finish()     jump to the end state immediately (used for skipping and
//                for instant replay when navigating backwards)
//   done         true once finished
// Because every task can be finished instantly, any slide state
// (slide i, step k) can be reconstructed deterministically by replaying
// steps 0..k-1 with instant=true.

export const ease = {
  linear: (t) => t,
  in_cubic: (t) => t * t * t,
  out_cubic: (t) => 1 - Math.pow(1 - t, 3),
  in_out_cubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  in_out_sine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  out_back: (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  out_expo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
};

export function resolveEase(e, fallback = 'in_out_cubic') {
  if (typeof e === 'function') return e;
  return ease[e] || ease[fallback];
}

// A task that maps elapsed time -> eased progress p in [0,1].
export function tweenTask({ duration = 0.6, ease: e, onStart, onUpdate, onEnd }) {
  const f = resolveEase(e);
  return {
    done: false,
    start(now) {
      this.t0 = now;
      onStart?.();
      if (duration <= 0) this.finish();
    },
    update(now) {
      if (this.done) return;
      const p = Math.min(1, (now - this.t0) / duration);
      onUpdate?.(f(p));
      if (p >= 1) { this.done = true; onEnd?.(); }
    },
    finish() {
      if (this.done) return;
      onUpdate?.(1);
      this.done = true;
      onEnd?.();
    },
  };
}

export class Scheduler {
  constructor() { this.tasks = []; }

  add(task, delay, now) {
    task.startAt = now + (delay || 0);
    task.started = false;
    this.tasks.push(task);
  }

  tick(now) {
    for (const t of this.tasks) {
      if (!t.started && now >= t.startAt) { t.started = true; t.start(now); }
      if (t.started && !t.done) t.update(now);
    }
    this.tasks = this.tasks.filter((t) => !t.done);
  }

  // Complete every pending/running task in insertion (= authoring) order.
  finishAll() {
    const tasks = this.tasks.slice().sort((a, b) => a.startAt - b.startAt);
    this.tasks = [];
    for (const t of tasks) {
      if (!t.started) { t.started = true; t.start(t.startAt); }
      t.finish();
    }
  }

  get busy() { return this.tasks.length > 0; }
}

// Run a task synchronously to completion (instant replay).
export function runInstant(task) {
  task.started = true;
  task.start(0);
  task.finish();
}

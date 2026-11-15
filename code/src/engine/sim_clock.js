// Fixed-timestep clock that drives a 3D scene's simulation.
//
// The scene only sees simStep(dt) with a constant dt, so a given amount of
// simulated time always produces the same state. That is what makes
// "go back one step" reproducible: `{ sim: 'play', duration: 3 }` replayed
// instantly advances exactly 3 s of sim time.
//
// Two modes:
//   budget  - `runFor(seconds)`: advance exactly that much sim time at
//             real-time speed (deterministic; counts as a running task)
//   free    - `play()` / `pause()`: run until paused (ambient motion;
//             NOT reproduced exactly when replaying)

export class SimClock {
  constructor(sceneApi, { dt = 1 / 120, speed = 1 } = {}) {
    this.api = sceneApi;
    this.dt = dt;
    this.speed = speed;
    this.time = 0;        // total simulated seconds since reset
    this.free = false;
    this.budget = 0;      // remaining seconds for runFor
    this.acc = 0;
  }

  get hasSim() { return typeof this.api?.simStep === 'function'; }

  reset() {
    this.time = 0; this.acc = 0; this.budget = 0; this.free = false;
    this.api?.reset?.();
  }

  play() { this.free = true; }
  pause() { this.free = false; this.budget = 0; }
  runFor(seconds) { this.budget += seconds; }

  // advance by `seconds` of sim time right now (instant replay / skipping)
  advance(seconds) {
    const n = Math.round(seconds / this.dt);
    for (let i = 0; i < n; i++) this.step();
  }

  flushBudget() {
    // include the un-stepped remainder so the total step count equals
    // round(duration / dt), same as an uninterrupted run
    if (this.budget > 0) { this.advance(this.budget + this.acc); this.budget = 0; this.acc = 0; }
  }

  step() {
    this.api.simStep?.(this.dt, this.time);
    this.time += this.dt;
  }

  // called every rendered frame with wall-clock delta
  tick(realDt) {
    if (!this.hasSim) return;
    if (!this.free && this.budget <= 0) { this.acc = 0; return; }
    let want = Math.min(realDt, 0.1) * this.speed;
    if (!this.free) want = Math.min(want, this.budget);
    this.acc += want;
    if (!this.free) this.budget -= want;
    while (this.acc >= this.dt - 1e-9) { this.step(); this.acc -= this.dt; }
    if (!this.free && this.budget <= 1e-9) {
      // consume the remainder so budget runs are exact
      if (this.acc > this.dt / 2) this.step();
      this.acc = 0; this.budget = 0;
    }
  }
}

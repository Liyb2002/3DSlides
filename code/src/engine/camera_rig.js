import * as THREE from 'three';

// A camera pose is plain data so it can live in the deck file:
//   { position: [x,y,z], target: [x,y,z], fov: 45 }
// The camera is moved by animations; while presenting the viewer may also
// turn it by hand (player.js), and `authored` remembers where the
// animations last put it (R goes back there). Two interpolation paths are supported:
//   'linear' - lerp position and target (dolly / truck / crane moves)
//   'orbit'  - lerp target, and interpolate the camera offset in spherical
//              coordinates around it (keeps distance smooth, arcs around)

export function normalizePose(pose, fallback) {
  const f = fallback || { position: [0, 2, 6], target: [0, 0, 0], fov: 45 };
  return {
    position: new THREE.Vector3(...(pose?.position || f.position)),
    target: new THREE.Vector3(...(pose?.target || f.target)),
    fov: pose?.fov ?? f.fov ?? 45,
  };
}

export function poseToJSON(camera, target) {
  const r = (v) => Math.round(v * 1000) / 1000;
  return {
    position: camera.position.toArray().map(r),
    target: target.toArray().map(r),
    fov: r(camera.fov),
  };
}

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.target = new THREE.Vector3();
  }

  set(pose) {
    this.authored = { position: pose.position.clone(), target: pose.target.clone(), fov: pose.fov };
    this.camera.position.copy(pose.position);
    this.target.copy(pose.target);
    this.camera.fov = pose.fov;
    this.apply();
  }

  apply() {
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
  }

  current() {
    return { position: this.camera.position.clone(), target: this.target.clone(), fov: this.camera.fov };
  }

  // Returns an updater p -> void that interpolates from the current pose
  // (captured when called) to `to`.
  interpolator(to, path = 'orbit') {
    const from = this.current();
    this.authored = { position: to.position.clone(), target: to.target.clone(), fov: to.fov };
    if (path === 'linear') {
      return (p) => {
        this.camera.position.lerpVectors(from.position, to.position, p);
        this.target.lerpVectors(from.target, to.target, p);
        this.camera.fov = THREE.MathUtils.lerp(from.fov, to.fov, p);
        this.apply();
      };
    }
    const s0 = new THREE.Spherical().setFromVector3(from.position.clone().sub(from.target));
    const s1 = new THREE.Spherical().setFromVector3(to.position.clone().sub(to.target));
    // take the short way around in theta
    let dTheta = s1.theta - s0.theta;
    dTheta = ((dTheta + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    const s = new THREE.Spherical();
    const off = new THREE.Vector3();
    return (p) => {
      this.target.lerpVectors(from.target, to.target, p);
      s.set(
        THREE.MathUtils.lerp(s0.radius, s1.radius, p),
        THREE.MathUtils.lerp(s0.phi, s1.phi, p),
        s0.theta + dTheta * p,
      );
      off.setFromSpherical(s);
      this.camera.position.copy(this.target).add(off);
      this.camera.fov = THREE.MathUtils.lerp(from.fov, to.fov, p);
      this.apply();
    };
  }

  // Turntable: rotate the camera around the current target by `degrees`
  // about world-up (or `axis`).
  orbitInterpolator(degrees, axis = [0, 1, 0]) {
    const target = this.target.clone();
    const off0 = this.camera.position.clone().sub(target);
    const ax = new THREE.Vector3(...axis).normalize();
    const rad = THREE.MathUtils.degToRad(degrees);
    const off = new THREE.Vector3();
    this.authored = { position: target.clone().add(off0.clone().applyAxisAngle(ax, rad)), target: target.clone(), fov: this.camera.fov };
    return (p) => {
      off.copy(off0).applyAxisAngle(ax, rad * p);
      this.camera.position.copy(target).add(off);
      this.apply();
    };
  }
}

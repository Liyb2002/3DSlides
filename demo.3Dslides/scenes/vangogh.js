// Van Gogh's look for a scene: visible, thick, short brush strokes that follow the forms, dark blue contours.
//
//   const painter = createVanGogh(renderer)
//   sceneApi.render = (renderer, scene, camera) => painter.render(scene, camera, time)
//   sceneApi.dispose = () => painter.dispose()
//   brushy(material, { freq, along }): stroke texture on a surface, fixed in world space
//
// Passes: the scene (linear, with depth) -> prep (tone map, saturation, contour strength from depth jumps)
// -> strokes: the picture is re-painted as strokes, cell by cell (two staggered layers of cells): each stroke
// takes the colour under its centre, lies across the local luminance gradient (so it follows the forms and the
// sky's swirls), is tapered and slightly curved, and gets an impasto relief (bristle ridges lit from the
// top left). Contours: dark ultramarine where the depth jumps (silhouettes of hills, cypress, houses).
import * as THREE from 'three';

export const NOISE = /* glsl */`
  float vgHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vgNoise(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(vgHash(i), vgHash(i + vec3(1, 0, 0)), f.x), mix(vgHash(i + vec3(0, 1, 0)), vgHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(vgHash(i + vec3(0, 0, 1)), vgHash(i + vec3(1, 0, 1)), f.x), mix(vgHash(i + vec3(0, 1, 1)), vgHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }`;

// stroke texture on a surface: bands of paint, fixed to the object (they do not slide when the camera moves)
export function brushy(material, { freq = 6, along = [1, 0.25, 1], amount = 0.5 } = {}) {
  if (!material?.isMeshStandardMaterial || material.userData.brushy) return material;
  material.userData.brushy = true;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vgWorld;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 vgp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          vgp = instanceMatrix * vgp;
        #endif
        vgWorld = (modelMatrix * vgp).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vgWorld;\n' + NOISE)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 q = vgWorld * ${freq.toFixed(2)} * vec3(${along.map((a) => a.toFixed(3)).join(', ')});
          float band = vgNoise(q + vgNoise(q * 0.35) * 2.0);
          float dab = vgNoise(q * 1.7 + 3.0);
          diffuseColor.rgb *= 1.0 + ${amount.toFixed(2)} * ((band - 0.5) * 1.1 + (dab - 0.5) * 0.5);
          diffuseColor.rgb += vec3(dab - 0.5, 0.0, 0.5 - band) * ${(amount * 0.12).toFixed(3)};
        }`);
  };
  material.customProgramCacheKey = () => 'brushy' + freq + along.join() + amount;
  return material;
}

const QUAD_VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const PREP = /* glsl */`
  uniform sampler2D tIn; uniform sampler2D tDepth; uniform vec2 uTexel; uniform float uNear; uniform float uFar; uniform float uExposure; uniform float uScale;
  varying vec2 vUv;
  vec3 aces(vec3 c) {
    c *= uExposure / 0.6;
    const mat3 i = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
    const mat3 o = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
    c = i * c; c = (c * (c + 0.0245786) - 0.000090537) / (c * (0.983729 * c + 0.4329510) + 0.238081); c = o * c;
    return clamp(c, 0.0, 1.0);
  }
  vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
  float lz(vec2 uv) { float d = texture2D(tDepth, uv).x; return log(uNear * uFar / (uFar - d * (uFar - uNear))); }
  void main() {
    vec3 c = srgb(aces(texture2D(tIn, vUv).rgb));
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = clamp(mix(vec3(l), c, 1.3), 0.0, 1.0);
    vec2 o = uTexel * 1.5 * uScale;
    float z = lz(vUv);
    float e = max(max(abs(lz(vUv + vec2(o.x, 0)) - z), abs(lz(vUv - vec2(o.x, 0)) - z)), max(abs(lz(vUv + vec2(0, o.y)) - z), abs(lz(vUv - vec2(0, o.y)) - z)));
    gl_FragColor = vec4(c, smoothstep(0.06, 0.25, e));
  }`;

const STROKES = /* glsl */`
  uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uScale; uniform float uTime;
  varying vec2 vUv;
  ${NOISE}
  vec2 h2(vec2 c) { return vec2(vgHash(vec3(c, 1.7)), vgHash(vec3(c, 9.1))); }
  float lumAt(vec2 px) { return dot(texture2D(tSrc, px * uTexel).rgb, vec3(0.299, 0.587, 0.114)); }
  void main() {
    vec2 p = vUv / uTexel;
    vec3 col = texture2D(tSrc, vUv).rgb;
    float best = -1.0; vec3 sc = col; vec2 suv = vec2(0.0); float sh = 0.0;
    for (int layer = 0; layer < 2; layer++) {
      float cs = (layer == 0 ? 11.0 : 8.0) * uScale;
      vec2 off = vec2(float(layer) * 0.5 * cs);
      vec2 c0 = floor((p - off) / cs);
      for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
        vec2 cell = c0 + vec2(float(dx), float(dy));
        vec2 h = h2(cell + float(layer) * 71.3);
        vec2 ctr = (cell + 0.5 + (h - 0.5) * 0.7) * cs + off;
        float st = cs * 0.9;
        vec2 g = vec2(lumAt(ctr + vec2(st, 0.0)) - lumAt(ctr - vec2(st, 0.0)), lumAt(ctr + vec2(0.0, st)) - lumAt(ctr - vec2(0.0, st)));
        float a = vgNoise(vec3(ctr / (90.0 * uScale), 2.0)) * 6.2832;
        vec2 dir = mix(vec2(cos(a), sin(a)), vec2(-g.y, g.x) / (length(g) + 1e-5), smoothstep(0.004, 0.03, length(g)));
        dir = normalize(dir + 1e-4);
        vec2 nrm = vec2(-dir.y, dir.x);
        float len = cs * (1.25 + 0.7 * h.x), wid = cs * (0.38 + 0.14 * h.y);
        vec2 d = p - ctr;
        float u = dot(d, dir), v = dot(d, nrm);
        v -= (h.y - 0.5) * 0.9 * u * u / len;                       // a slight curve
        float tu = u / len, tv = v / wid;
        if (abs(tu) < 1.0 && abs(tv) < 1.0 - 0.55 * tu * tu) {      // tapered at both ends
          float pri = vgHash(vec3(cell, float(layer) + 4.0)) + float(layer) * 0.35;
          if (pri > best) { best = pri; sc = texture2D(tSrc, ctr * uTexel).rgb; suv = vec2(tu, tv); sh = h.x; }
        }
      }
    }
    vec3 c = best >= 0.0 ? mix(sc, col, 0.2) : col;
    // impasto: bristle ridges along the stroke, lit from the top left
    float ridge = vgNoise(vec3(suv.y * 4.5 + sh * 20.0, suv.x * 1.2, 5.0));
    float body = 1.0 - suv.y * suv.y;
    float lit = 0.88 + 0.18 * body + 0.14 * (ridge - 0.5) - 0.1 * suv.y;
    c *= lit;
    // contours: dark ultramarine where the depth jumps
    float e = texture2D(tSrc, vUv).a;
    c = mix(c, vec3(0.04, 0.07, 0.22), e * 0.7);
    // canvas
    c *= 0.96 + 0.05 * vgNoise(vec3(p * 0.6, 9.0));
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
  }`;

export function createVanGogh(renderer, { exposure = 1.0 } = {}) {
  const size = new THREE.Vector2();
  const main = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
  main.depthTexture = new THREE.DepthTexture(4, 4, THREE.UnsignedIntType);
  const src = new THREE.WebGLRenderTarget(4, 4, { type: THREE.UnsignedByteType });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); quad.frustumCulled = false;
  const quadScene = new THREE.Scene(); quadScene.add(quad);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prep = new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: PREP, depthTest: false, depthWrite: false,
    uniforms: { tIn: { value: main.texture }, tDepth: { value: main.depthTexture }, uTexel: { value: new THREE.Vector2() }, uNear: { value: 0.1 }, uFar: { value: 100 }, uExposure: { value: exposure }, uScale: { value: 1 } } });
  const strokes = new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: STROKES, depthTest: false, depthWrite: false,
    uniforms: { tSrc: { value: src.texture }, uTexel: { value: new THREE.Vector2() }, uScale: { value: 1 }, uTime: { value: 0 } } });
  return {
    render(scene, camera, time) {
      renderer.getDrawingBufferSize(size);
      const w = Math.max(4, size.x), h = Math.max(4, size.y);
      if (main.width !== w || main.height !== h) { main.setSize(w, h); src.setSize(w, h); }
      const s = h / 1080;
      prep.uniforms.uTexel.value.set(1 / w, 1 / h); prep.uniforms.uScale.value = s;
      prep.uniforms.uNear.value = camera.near; prep.uniforms.uFar.value = camera.far;
      strokes.uniforms.uTexel.value.set(1 / w, 1 / h); strokes.uniforms.uScale.value = Math.max(0.5, s); strokes.uniforms.uTime.value = time;
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(main); renderer.clear(); renderer.render(scene, camera);
      quad.material = prep; renderer.setRenderTarget(src); renderer.render(quadScene, quadCam);
      quad.material = strokes; renderer.setRenderTarget(prev); renderer.render(quadScene, quadCam);
    },
    dispose() { main.dispose(); src.dispose(); prep.dispose(); strokes.dispose(); quad.geometry.dispose(); },
  };
}

// The 3D Slides logo: one solid, drawn in ink on paper, that is a "3" seen from the front and a "D" seen from
// the side (and something else from anywhere between: turn it and the one becomes the other).
// It is the intersection of two extruded letters: the stroke of a 3 pushed through along z, and the stroke of a D
// pushed through along x. Not a mesh: a signed distance field, ray-marched in a shader on a box, so it is smooth
// at any size and from any angle; the lines are its outline and the edges where the two letters cut each other;
// the faces that belong to the 3 are tinted gold, those of the D blue.
//
// Units: the letters are 1.74 high, centred on the origin. poses: three (front), dee (side), iso, top.
// sceneOptions: { paper: '#faf7f0', ink: '#1d1d1f', gold: '#f0c95a', blue: '#8fb0ea', turn: 0 (turns/s, idle spin) }
import * as THREE from 'three';

const FS = /* glsl */`
  uniform vec3 uPaper, uInk, uGold, uBlue; uniform float uAngle;
  varying vec3 vW;
  const float W = 0.13, H = 0.87;
  float arc(vec2 p, float rot, float ra) {            // an arc of 240 degrees, its middle turned to +y by rot
    float c = cos(rot), s = sin(rot); p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    const vec2 sc = vec2(0.8660254, -0.5); p.x = abs(p.x);
    return (sc.y * p.x > sc.x * p.y) ? length(p - sc * ra) : abs(length(p) - ra);
  }
  float sd3(vec2 p) { float r = (H - W) * 0.5; return min(arc(p - vec2(-0.05, r), 1.0471976, r), arc(p - vec2(-0.05, -r), 2.0943951, r)) - W; }
  float sdD(vec2 p) {
    float c = 0.62 - H;
    float f = p.x < c ? max(abs(p.y) - H, -(p.x + 0.62)) : length(p - vec2(c, 0.0)) - H;
    return abs(f + W) - W;
  }
  vec2 both(vec3 p) { float c = cos(uAngle), s = sin(uAngle); p = vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z); return vec2(sd3(p.xy), sdD(vec2(-p.z, p.y))); }
  float map(vec3 p) { vec2 d = both(p); return max(d.x, d.y); }
  void main() {
    vec3 ro = cameraPosition, rd = normalize(vW - cameraPosition);
    float t = max(0.0, distance(cameraPosition, vW) - 0.01), near = 1e3; bool hit = false; vec3 p;
    for (int i = 0; i < 160; i++) {
      p = ro + rd * t; float d = map(p);
      near = min(near, d);
      if (d < 0.0008) { hit = true; break; }
      t += d * 0.7; if (t > 60.0) break;
    }
    vec3 col = uPaper;
    float px = fwidth(t) + 0.004;                                    // (about a pixel, in the scene's units)
    if (hit) {
      vec2 e = vec2(0.002, 0.0);
      vec3 n = normalize(vec3(map(p + e.xyy) - map(p - e.xyy), map(p + e.yxy) - map(p - e.yxy), map(p + e.yyx) - map(p - e.yyx)));
      vec2 d = both(p);
      vec3 tint = d.x > d.y ? uGold : uBlue;                         // whose face: the 3's, the D's
      float lit = 0.80 + 0.20 * clamp(dot(n, normalize(vec3(0.4, 0.8, 0.5))), 0.0, 1.0);
      col = mix(uPaper, tint, 0.62) * lit;
      float crease = 1.0 - smoothstep(0.012, 0.022, abs(d.x - d.y));  // where the two letters cut each other
      float graze = 1.0 - smoothstep(0.10, 0.22, dot(n, -rd));        // the outline, on its own side
      col = mix(col, uInk, max(crease, graze));
    } else col = mix(uInk, uPaper, smoothstep(0.012, 0.024, near));    // the outline, outside
    gl_FragColor = vec4(col, 1.0);
  }`;

export default function logoScene({ scene, options = {} }) {
  const C = (k, d) => new THREE.Color(options[k] || d);
  // (a ShaderMaterial's colours go to the screen as they are: given in sRGB, not converted)
  const raw = (c) => new THREE.Vector3(...c.clone().convertLinearToSRGB().toArray());
  const paper = C('paper', '#faf7f0');
  scene.background = paper;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uPaper: { value: raw(paper) }, uInk: { value: raw(C('ink', '#1d1d1f')) }, uGold: { value: raw(C('gold', '#f0c95a')) }, uBlue: { value: raw(C('blue', '#8fb0ea')) }, uAngle: { value: 0 } },
    vertexShader: 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: FS,
  });
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.4, 3.2), mat));
  const pose = (position, fov = 18) => ({ position, target: [0, 0, 0], fov });
  const spin = options.turn ?? 0;
  return {
    poses: { three: pose([0, 0, 11]), dee: pose([11, 0, 0]), iso: pose([6.6, 3.6, 7.2]), top: pose([0, 11, 0.01]) },
    anchors: { logo: [0, 1.1, 0] },
    frame(now) { if (spin) mat.uniforms.uAngle.value = now * spin * Math.PI * 2; },
  };
}

// 2D elements (text / image / video / bullets / html / shape) and their
// entrance / exit animations. Used by BOTH 2D and 3D slides: on a 3D slide
// they live in an overlay above the WebGL canvas, and can optionally be
// anchored to a 3D point.
//
// Coordinates are in stage pixels (default 1920 x 1080), origin top-left.

// ---- entrance animations: p in [0,1] -> style ---------------------------
// p = 0 is "fully hidden", p = 1 is "fully shown". Exit animations use the
// same functions with p running 1 -> 0.
const D = 60; // fly distance in px

export const anims = {
  none: (p) => ({ opacity: p >= 1 ? 1 : 0, transform: '' }),
  fade: (p) => ({ opacity: p, transform: '' }),
  fly_up: (p) => ({ opacity: p, transform: `translateY(${(1 - p) * D}px)` }),
  fly_down: (p) => ({ opacity: p, transform: `translateY(${-(1 - p) * D}px)` }),
  fly_left: (p) => ({ opacity: p, transform: `translateX(${(1 - p) * D}px)` }),
  fly_right: (p) => ({ opacity: p, transform: `translateX(${-(1 - p) * D}px)` }),
  zoom: (p) => ({ opacity: p, transform: `scale(${0.6 + 0.4 * p})` }),
  pop: (p) => ({ opacity: Math.min(1, p * 2), transform: `scale(${0.6 + 0.4 * p})` }),
  wipe: (p) => ({ opacity: 1, transform: '', clipPath: `inset(0 ${(1 - p) * 100}% 0 0)` }),
  blur: (p) => ({ opacity: p, transform: '', filter: `blur(${(1 - p) * 12}px)` }),
};

export function applyAnim(el, name, p) {
  const s = (anims[name] || anims.fade)(p);
  el.style.opacity = s.opacity;
  el.style.transform = s.transform || '';
  el.style.clipPath = s.clipPath || '';
  el.style.filter = s.filter || '';
  el.style.visibility = p <= 0 ? 'hidden' : 'visible';
}

// ---- construction --------------------------------------------------------
function px(v) { return typeof v === 'number' ? `${v}px` : v; }

// Text look (any element): font (a name in FONTS; vendor/fonts/fonts.css, offline), fontSize (px),
// fontWeight (700 = bold), fontStyle ('italic'). They win over `style` and the class.
export const FONTS = {
  Inter: "'Inter', sans-serif", Roboto: "'Roboto', sans-serif", 'Open Sans': "'Open Sans', sans-serif", Lato: "'Lato', sans-serif",
  'Source Serif 4': "'Source Serif 4', serif", Merriweather: "'Merriweather', serif", 'JetBrains Mono': "'JetBrains Mono', monospace",
  Helvetica: "'Helvetica Neue', Helvetica, Arial, sans-serif",
};

// A symbol: { type: 'shape', shape, x, y, w, h, color, fill, strokeWidth, rotate }
//   shape: square | circle | triangle | line | arrow | dashed   (w x h is its box; a line runs
//   along w, through the middle; rotate: degrees, about the box centre)
//   color: the outline / line colour; fill: a fill colour (square / circle / triangle) or none
export const SHAPES = ['square', 'circle', 'triangle', 'line', 'arrow', 'dashed'];
export function shapeSVG(spec) {
  const w = Math.max(1, spec.w ?? 200), h = Math.max(1, spec.h ?? 200), sw = spec.strokeWidth ?? 4, c = spec.color || '#333b46';
  const fill = spec.fill || 'none', o = sw / 2, m = h / 2;
  const stroke = `stroke="${c}" stroke-width="${sw}" fill="${fill}" stroke-linejoin="round"`;
  let body;
  switch (spec.shape) {
    case 'circle': body = `<ellipse cx="${w / 2}" cy="${m}" rx="${Math.max(0, w / 2 - o)}" ry="${Math.max(0, m - o)}" ${stroke}/>`; break;
    case 'triangle': body = `<polygon points="${w / 2},${o} ${w - o},${h - o} ${o},${h - o}" ${stroke}/>`; break;
    case 'line': body = `<line x1="0" y1="${m}" x2="${w}" y2="${m}" stroke="${c}" stroke-width="${sw}" stroke-linecap="round"/>`; break;
    case 'dashed': body = `<line x1="0" y1="${m}" x2="${w}" y2="${m}" stroke="${c}" stroke-width="${sw}" stroke-dasharray="${sw * 3} ${sw * 2.5}"/>`; break;
    case 'arrow': {
      const hl = Math.min(w * 0.4, sw * 5 + 8), hw = sw * 2.4 + 5;
      body = `<line x1="0" y1="${m}" x2="${w - hl + 1}" y2="${m}" stroke="${c}" stroke-width="${sw}"/>`
        + `<polygon points="${w - hl},${m - hw} ${w},${m} ${w - hl},${m + hw}" fill="${c}"/>`;
      break;
    }
    default: body = `<rect x="${o}" y="${o}" width="${Math.max(0, w - sw)}" height="${Math.max(0, h - sw)}" ${stroke}/>`;
  }
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;overflow:visible">${body}</svg>`;
}

export function createElement(spec, baseUrl) {
  let el;
  switch (spec.type || 'text') {
    case 'text': {
      el = document.createElement('div');
      el.className = 'el el-text';
      // `text` is plain text with light markup (see markup()); `html` is the raw escape hatch
      el.innerHTML = spec.html != null ? renderInlineMath(spec.html) : markup(spec.text ?? '');
      break;
    }
    case 'math': {
      // { type: 'math', tex: '...', display: true }  (KaTeX, vendored)
      el = document.createElement('div');
      el.className = 'el el-math';
      el.innerHTML = tex(spec.tex, spec.display ?? true);
      break;
    }
    case 'bullets': {
      el = document.createElement('ul');
      el.className = 'el el-bullets';
      for (const item of spec.items || []) {
        const li = document.createElement('li');
        li.innerHTML = markup(item);
        el.appendChild(li);
      }
      break;
    }
    case 'model': {                       // a 3D view of a model file (slide.js mounts it: model_view.js)
      el = document.createElement('div');
      el.className = 'el el-model';
      if (spec.h == null) spec.h = spec.w ?? 400;
      break;
    }
    case 'shape': {
      el = document.createElement('div');
      el.className = 'el el-shape';
      el.innerHTML = shapeSVG(spec);
      if (spec.h == null) spec.h = ['line', 'arrow', 'dashed'].includes(spec.shape) ? 30 : spec.w ?? 200;
      break;
    }
    case 'image': {
      el = document.createElement('img');
      el.className = 'el el-image';
      el.src = resolveUrl(spec.src, baseUrl);
      el.draggable = false;
      break;
    }
    case 'video': {
      el = document.createElement('video');
      el.className = 'el el-video';
      el.src = resolveUrl(spec.src, baseUrl);
      el.muted = spec.muted ?? true;
      el.loop = spec.loop ?? false;
      if (spec.autoplay) el.dataset.autoplay = '1';           // plays from the start when shown (actions.js)
      el.playsInline = true;
      el.preload = 'auto';
      break;
    }
    case 'html': {
      el = document.createElement('div');
      el.className = 'el el-html';
      el.innerHTML = spec.html ?? '';
      break;
    }
    default:
      throw new Error(`Unknown element type: ${spec.type}`);
  }
  if (spec.className) el.classList.add(...spec.className.split(/\s+/));
  el.style.position = 'absolute';
  if (spec.x != null) el.style.left = px(spec.x);
  if (spec.y != null) el.style.top = px(spec.y);
  if (spec.w != null) el.style.width = px(spec.w);
  if (spec.h != null) el.style.height = px(spec.h);
  if (spec.style) Object.assign(el.style, spec.style);
  el.style.rotate = spec.rotate ? `${spec.rotate}deg` : '';           // not transform: that is the animations'
  el.style.zIndex = spec.z != null ? String(spec.z) : '';              // front / back (the editor's Front / Back)
  if (spec.type !== 'shape' && spec.color) el.style.color = spec.color;   // the letters (a symbol's `color` is its line)
  if (spec.bg) Object.assign(el.style, { background: spec.bg, padding: '8px 16px', borderRadius: '10px', boxShadow: '0 4px 18px rgba(0,0,0,0.15)' });
  if (spec.font) el.style.fontFamily = FONTS[spec.font] || spec.font;
  if (spec.fontSize) el.style.fontSize = px(spec.fontSize);
  if (spec.fontWeight) el.style.fontWeight = String(spec.fontWeight);
  if (spec.fontStyle) el.style.fontStyle = spec.fontStyle;
  // transform is owned by the animation system; positioning offsets for
  // anchored elements go through a wrapper-free `translate` property.
  return el;
}

// KaTeX helpers. `$...$` inside html strings of text/bullets is typeset inline.
export function tex(src, display = false) {
  if (!window.katex) return src;
  return window.katex.renderToString(src, { displayMode: display, throwOnError: false, output: 'html' });
}
function renderInlineMath(html) {
  return html.replace(/\$([^$]+)\$/g, (_, t) => tex(t, false));
}

// Plain text -> HTML, so slides never need hand-written HTML:
//   **bold**   *italic*   $math$ (KaTeX)   a line break is a line break
export function markup(src) {
  const parts = String(src).split(/(\$[^$]+\$)/g);       // keep math untouched
  return parts.map((s) => {
    if (/^\$[^$]+\$$/.test(s)) return tex(s.slice(1, -1), false);
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.+?)\*/g, '<i>$1</i>')
      .replace(/\n/g, '<br>');
  }).join('');
}

function resolveUrl(src, baseUrl) {
  if (!src || /^(https?:|data:|blob:|\/)/.test(src)) return src;
  return new URL(src, baseUrl).href;
}

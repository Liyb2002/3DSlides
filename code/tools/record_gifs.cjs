// Record a clips deck to GIFs: every slide with a `clip: { name, period }`
// becomes <deck folder>/<deck.clipDir>/<name>.gif (default dir: assets/clips).
//   (start the server first: python3 code/serve.py)
//   node code/tools/record_gifs.cjs <deck file, e.g. pipeline_clips> [--deck demo.3Dslides] [--port 8000] [--only a,b] [--width 480]
// Frames are rendered deterministically (the sim is advanced by exactly 1/FPS
// between screenshots), so a loop of `period` seconds is seamless. The white
// margin around what moves is cropped away (the union over all frames).
// Needs puppeteer-core (NODE_PATH) and ffmpeg; python3 with Pillow for the crop.
const puppeteer = require('puppeteer-core');
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const FILE = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const DECK = opt('deck', 'demo.3Dslides'), PORT = opt('port', '8000'), ONLY = opt('only', '') ? opt('only').split(',') : null;
const WIDTH = +opt('width', 480), FPS = +opt('fps', 20), PAD = 10;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = path.join(__dirname, '../..');

const CROP = `
import sys, glob
from PIL import Image, ImageChops
box = None
for f in sorted(glob.glob(sys.argv[1] + '/*.png')):
    im = Image.open(f).convert('RGB')
    d = ImageChops.difference(im, Image.new('RGB', im.size, (255, 255, 255))).convert('L').point(lambda v: 255 if v > 6 else 0)
    b = d.getbbox()
    if b: box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
W, H = im.size; p = int(sys.argv[2])
x0, y0, x1, y1 = box or (0, 0, W, H)
x0, y0, x1, y1 = max(0, x0 - p), max(0, y0 - p), min(W, x1 + p), min(H, y1 + p)
w, h = (x1 - x0) // 2 * 2, (y1 - y0) // 2 * 2
print(f'{w}:{h}:{x0}:{y0}')
`;

(async () => {
  if (!FILE) { console.error('usage: record_gifs.cjs <deck file> [--deck demo.3Dslides]'); process.exit(1); }
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=metal'] });
  const p = await b.newPage();
  p.on('pageerror', (e) => console.error('PAGEERROR', e.message));
  const base = `http://localhost:${PORT}/code/index.html?deck=${DECK}&file=${FILE}&mode=run&live=0`;
  await p.goto(`${base}#1.0`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.player?.deck);
  const { size, clipDir, clips } = await p.evaluate(() => ({
    size: window.player.deck.size, clipDir: window.player.deck.clipDir || 'assets/clips',
    clips: window.player.deck.slides.map((s) => s.clip || null),
  }));
  await p.setViewport({ width: size[0], height: size[1], deviceScaleFactor: 1 });
  const out = path.join(ROOT, DECK, clipDir);
  fs.mkdirSync(out, { recursive: true });
  for (const [i, clip] of clips.entries()) {
    if (!clip || (ONLY && !ONLY.includes(clip.name))) continue;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `gif_${clip.name}_`));
    await p.goto('about:blank');
    await p.goto(`${base}#${i + 1}.0`, { waitUntil: 'load' });
    await p.waitForFunction((k) => window.player?.current?.index === k && window.player.current.sceneApi?.simStep, { timeout: 60000 }, i);
    await new Promise((r) => setTimeout(r, 600));
    await p.evaluate(() => { const c = window.player.current; c.sceneApi.reset?.(); c.sim.time = 0; c.renderNow(); });
    const n = Math.round(FPS * clip.period);
    for (let f = 0; f < n; f++) {
      await p.evaluate((dt) => { const c = window.player.current; if (dt) c.sim.advance(dt); c.renderNow(); }, f === 0 ? 0 : 1 / FPS);
      await p.screenshot({ path: path.join(tmp, `${String(f).padStart(4, '0')}.png`) });
    }
    const crop = execFileSync('python3', ['-c', CROP, tmp, String(PAD)]).toString().trim();
    const gif = path.join(out, `${clip.name}.gif`);
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', path.join(tmp, '%04d.png'),
      '-vf', `crop=${crop},scale=${WIDTH}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=200:reserve_transparent=0[p];[b][p]paletteuse=dither=sierra2_4a`,
      '-loop', '0', gif]);
    fs.rmSync(tmp, { recursive: true, force: true });
    const [w, h] = crop.split(':').map(Number);
    console.log('wrote', path.relative(ROOT, gif), `${w}x${h} -> ${WIDTH}x${Math.round(WIDTH * h / w / 2) * 2}`, (fs.statSync(gif).size / 1e6).toFixed(2), 'MB');
  }
  await b.close();
})();

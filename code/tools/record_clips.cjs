// Record the Section-3 clips (demo.3Dslides/clips.js) to GIFs in demo.3Dslides/assets/clips/.
//   (start the server first: python3 code/serve.py)
//   NODE_PATH=<dir with puppeteer-core> node tools/record_clips.cjs [port]
// Frames are rendered deterministically: the sim is advanced by exactly
// 1/FPS s between screenshots, so a loop of `period` seconds is seamless.
const puppeteer = require('puppeteer-core');
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');

const PORT = process.argv[2] || 8000, FPS = 20, PERIOD = 4, MODES = ['support', 'exit', 'tool'];
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(__dirname, '../../demo.3Dslides/assets/clips');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=metal', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage();
  await p.setViewport({ width: 900, height: 800, deviceScaleFactor: 1 });
  p.on('pageerror', (e) => console.error('PAGEERROR', e.message));
  for (const [i, mode] of MODES.entries()) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `clip_${mode}_`));
    await p.goto('about:blank');
    await p.goto(`http://localhost:${PORT}/code/index.html?deck=demo.3Dslides&file=clips&mode=run#${i + 1}.0`, { waitUntil: 'networkidle0' });
    await p.waitForFunction((k) => window.player?.current?.index === k && window.player.current.sceneApi, {}, i);
    await new Promise((r) => setTimeout(r, 800));
    const n = FPS * PERIOD;
    for (let f = 0; f < n; f++) {
      await p.evaluate((dt) => { const c = window.player.current; c.sim.advance(dt); c.renderNow(); }, f === 0 ? 0 : 1 / FPS);
      await p.screenshot({ path: path.join(tmp, `${String(f).padStart(4, '0')}.png`) });
    }
    const gif = path.join(OUT, `${mode}.gif`);
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', path.join(tmp, '%04d.png'),
      '-vf', 'scale=600:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=200[p];[b][p]paletteuse=dither=sierra2_4a', '-loop', '0', gif]);
    console.log('wrote', gif, (fs.statSync(gif).size / 1e6).toFixed(2), 'MB');
  }
  await b.close();
})();

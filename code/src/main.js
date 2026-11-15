// Entry point.   code/index.html?deck=<folder>&mode=<edit|run>[&dev]#<slide>.<step>
//   deck  deck folder, relative to the 3DSlides folder (default: demo.3Dslides;
//         the engine's own example is code/examples/basics)
//   file  deck module in that folder without .js (default: deck)
//   mode  edit (default): editor, like PowerPoint's normal view
//         run: present, starting at #<slide>.<step>
//   dev   run mode with a HUD and free camera ([C] copies the pose)
//   live=0  run mode without live sync (recordings: no reload when files change)
import { Player } from './engine/player.js';
import { Editor } from './editor/editor.js';
import { loadDeck, watchDeck, swapDeck } from './live.js';
import { startI18n } from './i18n.js';

const params = new URLSearchParams(location.search);
const deckName = params.get('deck') || 'demo.3Dslides';
const deckFile = params.get('file') || 'deck';
const mode = params.get('mode') || 'edit';
const dev = params.has('dev');
const deckUrl = new URL(`../../${deckName}/${deckFile}.js`, import.meta.url);
const baseUrl = new URL('./', deckUrl).href;

const root = document.getElementById('root');
try {
  const { deck, overrides } = await loadDeck(deckUrl.href, baseUrl);
  document.title = deck.title || document.title;
  if (mode === 'run') {
    const player = new Player(root, deck, {
      baseUrl, mode: 'run', dev,
      onExit: (i, k) => { location.href = `?deck=${deckName}&file=${deckFile}#${i + 1}.${k}`; },
    });
    window.player = player;
    player.start();
    // edits saved from the editor (any tab) show up here live (not with ?live=0: recordings)
    if (params.get('live') !== '0') watchDeck({
      deckName, deckFile,
      onDeck: async (s) => swapDeck(player, (await loadDeck(deckUrl.href, baseUrl, s.deck)).deck),
      onCode: () => location.reload(),
    });
  } else {
    startI18n(document.body);                              // the editor in Chinese, if chosen (i18n.js)
    window.editor = new Editor(root, deck, { deckName, deckFile, baseUrl, overrides, deckUrl: deckUrl.href });
  }
} catch (e) {
  console.error(e);
  root.innerHTML = `<pre class="error-box">${String(e.stack || e)}</pre>`;
}

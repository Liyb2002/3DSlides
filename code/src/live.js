// Live sync: every open page (editor or presenter) polls the server's change
// stamps (code/serve.py, GET /api/stamp). An edit saved anywhere (the editor in
// another tab, or deck.js changed by hand) shows up in place: the deck is
// re-imported, overrides re-applied and the current slide rebuilt at its
// current step. A change to any other script (scenes, engine) reloads the page
// (the #slide.step hash keeps the place).
import { loadOverrides, applyOverrides } from './editor/overrides.js';

export async function loadDeck(deckUrl, baseUrl, version = '') {
  const url = version ? `${deckUrl}?v=${version}` : deckUrl;
  const deck = (await import(url)).default;
  const overrides = await loadOverrides(baseUrl);
  applyOverrides(deck, overrides);
  return { deck, overrides };
}

export function watchDeck({ deckName, deckFile, onDeck, onCode, interval = 500 }) {
  let last = null, timer = null, stopped = false;
  const url = `/api/stamp?deck=${encodeURIComponent(deckName)}&file=${encodeURIComponent(deckFile)}`;
  const tick = async () => {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (r.ok) {
        const s = await r.json();
        if (last && s.code !== last.code) { onCode(s); return; }
        if (last && s.deck !== last.deck) { last = s; await onDeck(s); }
        last = s;
      }
    } catch { /* server gone: keep the page as it is */ }
    if (!stopped) timer = setTimeout(tick, interval);
  };
  tick();
  return {
    // a change this page made itself (its own save): not a reason to reload
    known(s) { if (s) last = s; },
    stop() { stopped = true; clearTimeout(timer); },
  };
}

// swap a player's deck and rebuild its current slide at its current step
export function swapDeck(player, deck) {
  if (!player || player.destroyed) return;
  player.deck = deck;
  player.slides = deck.slides;
  player.reload();
}

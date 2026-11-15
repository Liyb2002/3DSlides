// Two windows of one talk kept on the same page: the audience window (the slide, full screen) and the presenter
// window (notes + a small slide). Each posts its place (scene i, page k) whenever it changes; the other follows:
// one page on is played (next(), with its animation), anything else is jumped to. A click or a key in either window
// moves both (a clicker may be talking to either). Changes made while following are not posted back (no echo).
//
//   const link = linkPlayers(player, channelName(deck, file), { hello: true, onMessage })
//   new Player(..., { onChange: () => link?.send() })

export const channelName = (deck, file) => `3dslides:${deck}:${file}`;

export function linkPlayers(player, name, { hello = false, onMessage = null } = {}) {
  const ch = new BroadcastChannel(name);
  let following = false;
  const place = () => { const c = player.current; return c ? { i: c.index, k: c.stepIndex } : null; };
  const post = (m) => { try { ch.postMessage(m); } catch { /* closed */ } };
  const send = (force = false) => {
    const p = place();
    if (p && (force || !following)) post({ type: 'place', ...p });
  };
  const follow = ({ i, k }) => {
    const c = player.current;
    if (c && c.index === i && c.stepIndex === k) return;
    following = true;
    const oneOn = c && ((c.index === i && k === c.stepIndex + 1) || (i === c.index + 1 && k === 0 && c.done));
    if (oneOn) player.next(); else player.jump(i, k, k === 0);
    player.enqueue(() => { following = false; });
  };
  ch.onmessage = (e) => {
    const m = e.data || {};
    if (m.type === 'hello') send(true);                // a window just opened: here is where we are
    else if (m.type === 'place') follow(m);
    else onMessage?.(m);
  };
  if (hello) post({ type: 'hello' });
  return { send, post, close: () => ch.close() };
}

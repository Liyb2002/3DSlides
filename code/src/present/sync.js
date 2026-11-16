// Two windows of one talk kept on the same page: the audience window (the slide, full screen) and the presenter
// window (notes + a small slide). Each posts its place (scene i, page k) whenever it changes; the other follows:
// one page on is played (next(), with its animation), anything else is jumped to. A click or a key in either window
// moves both (a clicker may be talking to either). Changes made while following are not posted back (no echo).
//
//   const link = linkPlayers(player, channelName(deck, file), { hello: true, onMessage })
//   new Player(..., { onChange: () => link?.send(), onCamera: (inst, what) => link?.sendCamera(what) })
//
// The 3D view turned by hand in either window (drag / scroll, R: back) is turned the same way in the other, when
// both are on the same page. Poses are sent at most once a frame; one received is set without being sent back.

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
  let raf = 0, reset = false;
  const sendCamera = (what = 'pose') => {
    if (following) return;
    if (what === 'reset') { reset = true; cancelAnimationFrame(raf); raf = 0; }
    else if (raf) return;
    const flush = () => {
      raf = 0;
      const c = player.current, p = place();
      if (!c?.is3D || !p) return;
      if (reset) { reset = false; post({ type: 'reset', ...p }); return; }
      post({ type: 'camera', ...p, position: c.camera.position.toArray(), target: c.rig.target.toArray(), fov: c.camera.fov });
    };
    if (what === 'reset') flush(); else raf = requestAnimationFrame(flush);
  };
  const here = ({ i, k }) => { const c = player.current; return c && c.index === i && c.stepIndex === k; };
  const view = (m) => player.enqueue(() => {            // after any page change in progress
    if (!here(m)) return;
    if (m.type === 'reset') player.current.resetView?.(); else player.setView(m);
  });
  ch.onmessage = (e) => {
    const m = e.data || {};
    if (m.type === 'hello') send(true);                // a window just opened: here is where we are
    else if (m.type === 'place') follow(m);
    else if (m.type === 'camera' || m.type === 'reset') view(m);
    else onMessage?.(m);
  };
  if (hello) post({ type: 'hello' });
  return { send, sendCamera, post, close: () => { cancelAnimationFrame(raf); ch.close(); } };
}

// Giving the talk, and rehearsing it (the editor's "Presenter mode" / "Practice mode").
//
//   code/index.html?deck=<folder>&mode=presenter#<slide>.<step>
//     the presenter's window: the scene's notes (large), the slide (small), page, next scene, a timer. The
//     audience window (?mode=run&role=audience, opened by the editor next to it) shows the slide full screen; the
//     two stay on the same page (sync.js), whichever one gets the click / key / clicker.
//   code/index.html?deck=<folder>&mode=practice#<slide>.<step>
//     the slide, large, with the microphone on: what you say is written down (the browser's speech recognition) for
//     the scene shown at the time, into that scene's recording (kept in this browser). The recording goes into the
//     scene's notes as it is (Add to notes) or cleaned up by the agent first (CleanUp: agent.py polish, keeping your
//     own words); Undo takes the last one back. The notes are edited right there too, saved as you type.
//
// Notes belong to a scene (all its pages), not to a page: def.notes, saved in overrides.json (`notes`), written in
// the editor (the "scene notes" button), shown here. Esc goes back to the editor at the page you are on.
import { Player } from '../engine/player.js';
import { loadDeck, watchDeck, swapDeck } from '../live.js';
import { slideKey, saveOverrides, droppedNotes, OLD_SERVER } from '../editor/overrides.js';
import { linkPlayers, channelName } from './sync.js';

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) el.append(c);
  return el;
};
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not kept */ } },
};
export function sceneTitle(def) {
  const t = (def.elements || []).find((e) => e.id === 'title') || (def.elements || []).find((e) => e.type === 'text');
  const raw = t?.text ?? t?.html ?? def.id ?? '';
  return raw.replace(/<[^>]+>/g, '').replace(/[$*]/g, '').split('\n')[0].trim();
}
const clock = (s) => { s = Math.max(0, Math.floor(s)); const m = Math.floor(s / 60); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

class TalkView {
  constructor(root, deck, { deckName, deckFile, baseUrl, deckUrl }) {
    Object.assign(this, { root, deck, deckName, deckFile, baseUrl, deckUrl });
    this.ownStamps = new Set();
    this.place = null;
    document.body.classList.add('talk-body');
  }

  get q() { return `?deck=${encodeURIComponent(this.deckName)}&file=${encodeURIComponent(this.deckFile)}`; }

  startPlayer(box) {
    const m = location.hash.match(/^#(\d+)(?:\.(\d+))?/);
    this.player = new Player(box, this.deck, {
      baseUrl: this.baseUrl, mode: 'run', startAt: [m ? +m[1] - 1 : 0, m ? +(m[2] || 0) : 0],
      onExit: (i, k) => this.exit(i, k),
      onChange: (inst) => {
        this.link?.send();
        const key = `${inst.index}.${inst.stepIndex}`;
        if (key === this.place) return;                 // (a camera move)
        const sceneChanged = !this.place || +this.place.split('.')[0] !== inst.index;
        this.place = key;
        this.update(inst, sceneChanged);
      },
    });
    window.player = this.player;
    this.player.start();
    this.watch = watchDeck({
      deckName: this.deckName, deckFile: this.deckFile,
      onDeck: async (s) => {
        if (this.ownStamps.has(s.deck)) return;
        const { deck } = await loadDeck(this.deckUrl, this.baseUrl, s.deck);
        this.deck = deck; swapDeck(this.player, deck);
        if (this.player.current) this.update(this.player.current, true);
      },
      onCode: () => location.reload(),
    });
  }

  exit(i, k) { location.href = `${this.q}#${i + 1}.${k}`; }

  where(inst) {
    const n = this.deck.slides.length;
    return h('span', { class: 'talk-where' },
      h('b', {}, `Scene ${inst.index + 1} / ${n}`),
      h('span', { class: 'talk-user talk-title' }, sceneTitle(inst.def)),
      h('span', { class: 'talk-page' }, `page ${inst.stepIndex + 1} / ${inst.steps.length + 1}`));
  }

  notesText(def) { return (def.notes || '').trim(); }

  async saveNotes(list) {                              // [[def, index, text]]
    const delta = { slides: {} };
    for (const [def, i, text] of list) {
      const v = (text || '').trim() ? text.replace(/\s+$/, '') : null;
      if (v) def.notes = v; else delete def.notes;
      delta.slides[slideKey(def, i)] = { notes: v };
    }
    const res = await saveOverrides(this.deckName, delta, this.deckFile);
    this.ownStamps.add(res.stamp.deck); this.watch?.known(res.stamp);
    if (droppedNotes(delta, res.overrides).length) throw new Error(OLD_SERVER);
  }
}

// ------------------------------------------------------------------ presenter
export class PresenterView extends TalkView {
  constructor(root, deck, opts) {
    super(root, deck, opts);
    this.size = store.get('3dslides:notesSize', 30);
    this.t0 = performance.now(); this.paused = null;
    this.whereSlot = h('span', { class: 'talk-grow' });
    this.timer = h('button', { class: 'talk-timer', title: 'time since the start · click: pause / go on · double-click: back to 0',
      onclick: () => { if (this.paused != null) { this.t0 += performance.now() - this.paused; this.paused = null; } else this.paused = performance.now(); },
      ondblclick: () => { this.t0 = performance.now(); this.paused = null; } });
    this.clockEl = h('span', { class: 'talk-clock' });
    const bar = h('header', { class: 'talk-bar' },
      h('span', { class: 'talk-mode' }, 'Presenter'),
      this.whereSlot,
      this.timer, this.clockEl,
      h('button', { title: 'smaller notes', onclick: () => this.zoom(-2) }, 'A−'),
      h('button', { title: 'larger notes', onclick: () => this.zoom(2) }, 'A+'),
      h('button', { title: 'open the audience window again (drag it to the projector, then F: full screen)', onclick: () => this.openAudience() }, 'audience window'),
      h('button', { class: 'talk-end', title: 'Esc: end the show and go back to the editor', onclick: () => this.end() }, 'End'));
    this.notes = h('div', { class: 'talk-notes talk-user' });
    this.slideBox = h('div', { class: 'talk-slide' });
    this.slideBox.style.aspectRatio = `${(deck.size || [1920, 1080]).join(' / ')}`;
    this.nextInfo = h('div', { class: 'talk-next' });
    this.root.append(h('div', { class: 'talk talk-presenter' }, bar,
      h('div', { class: 'talk-main' }, this.notes, h('div', { class: 'talk-side' }, this.slideBox, this.nextInfo,
        h('p', { class: 'talk-hint' }, '→ / space / click: next · ←: back · Esc: end · the audience window follows')))));
    this.zoom(0);
    this.link = null;
    this.startPlayer(this.slideBox);
    this.link = linkPlayers(this.player, channelName(this.deckName, this.deckFile));
    this.player.queue.then(() => this.link.send(true));            // the audience window starts where we are
    this.tick = setInterval(() => this.clockTick(), 500); this.clockTick();
  }

  openAudience() {
    const i = this.player.current?.index ?? 0, k = this.player.current?.stepIndex ?? 0;
    window.open(`${this.q}&mode=run&role=audience#${i + 1}.${k}`, '3dslides-audience', 'popup,width=1280,height=760');
  }

  zoom(d) {
    this.size = Math.max(14, Math.min(72, this.size + d)); store.set('3dslides:notesSize', this.size);
    this.notes.style.fontSize = `${this.size}px`;
  }

  clockTick() {
    const now = this.paused ?? performance.now();
    this.timer.textContent = `${clock((now - this.t0) / 1000)}${this.paused != null ? ' (paused)' : ''}`;
    this.clockEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  update(inst, sceneChanged) {
    this.whereSlot.replaceChildren(this.where(inst));
    if (sceneChanged) {
      const text = this.notesText(inst.def);
      this.notes.replaceChildren(text ? h('div', { class: 'talk-notes-text' }, text)
        : h('p', { class: 'talk-empty' }, 'No notes for this scene. Write them in the editor (“scene notes”) or in Practice mode.'));
      this.notes.scrollTop = 0;
      const nx = this.deck.slides[inst.index + 1];
      this.nextInfo.replaceChildren(nx ? h('span', {}, h('span', { class: 'talk-dim' }, 'next scene · '), h('span', { class: 'talk-user' }, `${inst.index + 2}  ${sceneTitle(nx)}`))
        : h('span', { class: 'talk-dim' }, 'last scene'));
    }
  }

  end() { const c = this.player.current; this.exit(c ? c.index : 0, c ? c.stepIndex : 0); }
  exit(i, k) { this.link?.post({ type: 'close' }); super.exit(i, k); }
}

// ------------------------------------------------------------------ practice
const LANGS = [['en-US', 'English'], ['zh-CN', '中文']];

export class PracticeView extends TalkView {
  constructor(root, deck, opts) {
    super(root, deck, opts);
    this.lang = store.get('3dslides:practiceLang', 'en-US');
    this.recording = false; this.interim = '';
    this.rKey = `3dslides:practice:${this.deckName}:${this.deckFile}`;
    const kept = store.get(this.rKey, {});
    this.recs = kept.recordings || kept.transcripts || {};   // scene key -> what was said (kept in this browser)
    this.before = {};                                  // scene key -> [notes, recording] before the last add (undo)
    this.saveTimers = new Map();
    this.SR = window.SpeechRecognition || window.webkitSpeechRecognition;

    this.whereSlot = h('span', { class: 'talk-grow' });
    this.recBtn = h('button', { class: 'talk-rec', onclick: () => (this.recording ? this.stopRec() : this.startRec()) });
    this.langBtns = LANGS.map(([v, n]) => h('button', { title: 'the language you speak (speech recognition)', 'data-lang': v,
      onclick: () => { if (v === this.lang) return; this.lang = v; store.set('3dslides:practiceLang', v); this.renderLang(); if (this.recording) { this.stopRec(); this.startRec(); } } }, n));
    const langSel = h('span', { class: 'talk-seg' }, this.langBtns);
    this.recState = h('span', { class: 'talk-recstate' });
    const bar = h('header', { class: 'talk-bar' },
      h('span', { class: 'talk-mode practice' }, 'Practice'),
      this.whereSlot, this.recBtn, langSel, this.recState,
      h('button', { class: 'talk-end', title: 'Esc: back to the editor', onclick: () => this.end() }, 'End'));
    this.slideBox = h('div', { class: 'talk-slide' });
    this.slideBox.style.aspectRatio = `${(deck.size || [1920, 1080]).join(' / ')}`;
    this.panel = h('aside', { class: 'talk-panel' });
    this.root.append(h('div', { class: 'talk talk-practice' }, bar,
      h('div', { class: 'talk-main' }, h('div', { class: 'talk-stagewrap' }, this.slideBox), this.panel)));
    this.renderRec(); this.renderLang();
    this.startPlayer(this.slideBox);
  }

  renderLang() { this.langBtns.forEach((b) => b.classList.toggle('on', b.dataset.lang === this.lang)); }
  get cur() { return this.player?.current; }
  keyOf(inst) { return slideKey(inst.def, inst.index); }
  sceneOf(key) { const i = this.deck.slides.findIndex((d, j) => slideKey(d, j) === key); return i < 0 ? null : { def: this.deck.slides[i], i }; }

  // ---------------------------------------------------------------- the notes: one text per scene, saved as you go
  setNotes(key, text) {
    const sc = this.sceneOf(key);
    if (!sc) return;
    if (text.trim()) sc.def.notes = text; else delete sc.def.notes;
    clearTimeout(this.saveTimers.get(key));
    this.saveTimers.set(key, setTimeout(() => this.flushNotes(key), 600));
    if (this.cur && this.keyOf(this.cur) === key && this.box && this.box.value !== text) {
      const end = document.activeElement !== this.box || this.box.selectionStart === this.box.value.length;
      this.box.value = text;
      if (end) this.box.scrollTop = this.box.scrollHeight;
    }
  }

  async flushNotes(key) {
    this.saveTimers.delete(key);
    const sc = this.sceneOf(key);
    if (!sc) return;
    try { await this.saveNotes([[sc.def, sc.i, sc.def.notes || '']]); if (this.state?.textContent.startsWith('not saved')) this.say(''); } catch (e) { this.say(`not saved: ${e.message || e}`); }
  }

  say(msg) { if (this.state) this.state.textContent = msg; }

  setRec(key, text) {
    if (text.trim()) this.recs[key] = text; else delete this.recs[key];
    store.set(this.rKey, { recordings: this.recs });
    if (this.cur && this.keyOf(this.cur) === key && this.recBox && this.recBox.value !== text) {
      this.recBox.value = text; this.recBox.scrollTop = this.recBox.scrollHeight;
    }
    this.renderRecButtons();
  }

  // the recording (as it is, or cleaned up by the AI) goes to the end of the notes; the recording is then emptied
  addToNotes(key, text) {
    const sc = this.sceneOf(key);
    if (!sc || !text.trim()) return;
    const notes = (this.cur && this.keyOf(this.cur) === key && this.box) ? this.box.value : (sc.def.notes || '');
    this.before[key] = [notes, this.recs[key] || ''];
    this.setNotes(key, notes.trim() ? `${notes.replace(/\s+$/, '')}\n${text.trim()}` : text.trim());
    this.setRec(key, '');
    if (this.cur && this.keyOf(this.cur) === key) this.renderPanel();
  }

  // ---------------------------------------------------------------- speech → the notes of the scene shown
  startRec() {
    if (!this.SR) { this.recState.textContent = 'speech recognition is not available in this browser: use Chrome'; return; }
    this.recording = true;
    const run = () => {
      const rec = new this.SR();
      rec.lang = this.lang; rec.continuous = true; rec.interimResults = true;
      const owner = new Map();                         // result index -> the scene shown when that phrase began
      rec.onresult = (e) => {
        let interim = '';
        for (let r = e.resultIndex; r < e.results.length; r++) {
          const res = e.results[r];
          if (!owner.has(r)) owner.set(r, this.cur ? this.keyOf(this.cur) : null);
          const text = res[0].transcript.trim();
          if (res.isFinal) { if (text && owner.get(r) != null) this.addText(owner.get(r), text); }
          else interim += `${text} `;
        }
        this.interim = interim.trim();
        this.renderInterim();
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { this.recording = false; this.recState.textContent = 'microphone not allowed'; this.renderRec(); }
        else if (e.error === 'network') this.recState.textContent = 'speech recognition needs the network';
      };
      rec.onend = () => { this.interim = ''; this.renderInterim(); if (this.recording) run(); };   // it stops by itself now and then
      rec.start();
      this.rec = rec;
    };
    run();
    this.renderRec();
  }

  stopRec() { this.recording = false; try { this.rec?.stop(); } catch { /* done */ } this.renderRec(); }

  addText(key, text) {
    const cur = (this.cur && this.keyOf(this.cur) === key && this.recBox) ? this.recBox.value : (this.recs[key] || '');
    const sep = !cur || /\s$/.test(cur) ? '' : this.lang.startsWith('zh') ? '' : ' ';
    this.setRec(key, `${cur}${sep}${text}`);
  }

  renderRec() {
    this.recBtn.textContent = this.recording ? 'Stop recording' : 'Record';
    this.recBtn.classList.toggle('on', this.recording);
    if (this.recording) this.recState.textContent = 'listening…';
    else if (!this.SR) this.recState.textContent = 'speech recognition is not available in this browser: use Chrome';
    else if (this.recState.textContent === 'listening…') this.recState.textContent = '';
  }

  renderInterim() { if (this.interimEl) this.interimEl.textContent = this.interim; }

  // ---------------------------------------------------------------- the panel: this scene's notes
  update(inst, sceneChanged) {
    this.whereSlot.replaceChildren(this.where(inst));
    if (sceneChanged || !this.box) this.renderPanel();
  }

  renderPanel() {
    const inst = this.cur;
    if (!inst) return;
    const key = this.keyOf(inst);
    this.recBox = h('textarea', { class: 'talk-rec-edit talk-user', placeholder: 'press Record and talk through the scene: what you say is written down here' });
    this.recBox.value = this.recs[key] || '';
    this.recBox.addEventListener('input', () => this.setRec(key, this.recBox.value));
    this.interimEl = h('div', { class: 'talk-interim talk-user' });
    this.box = h('textarea', { class: 'talk-notes-edit talk-user', placeholder: 'this scene’s notes (shown in presenter mode)' });
    this.box.value = inst.def.notes || '';
    this.box.addEventListener('input', () => this.setNotes(key, this.box.value));
    this.state = h('p', { class: 'talk-dim talk-state' }, '');
    this.addBtn = h('button', { title: 'put the recording, as it is, at the end of the notes', onclick: () => this.addToNotes(key, this.recBox.value) }, 'Add to notes');
    this.cleanBtn = h('button', { class: 'primary', title: 'AI cleans up the recording (fillers, repeats, misheard words), keeping your own words, and puts it at the end of the notes',
      onclick: () => this.cleanUp(key) }, 'CleanUp');
    this.clearBtn = h('button', { title: 'forget the recording of this scene (to say it again)', onclick: () => this.setRec(key, '') }, 'Clear');
    const undo = this.before[key] ? h('button', { title: 'take back the last add: the notes and the recording as they were',
      onclick: () => { const [n, r] = this.before[key]; delete this.before[key]; this.setNotes(key, n); this.setRec(key, r); this.renderPanel(); } }, 'Undo') : null;
    this.panel.replaceChildren(
      h('section', { class: 'talk-box talk-recbox' },
        h('div', { class: 'talk-boxhead' }, h('span', {}, 'Recording'), h('span', { class: 'talk-grow' }), this.clearBtn, this.addBtn, this.cleanBtn),
        this.recBox, this.interimEl),
      h('section', { class: 'talk-box talk-notesbox' },
        h('div', { class: 'talk-boxhead' }, h('span', {}, 'Notes'), h('span', { class: 'talk-grow' }), undo),
        this.box, this.state));
    this.renderInterim(); this.renderRecButtons();
    this.recBox.scrollTop = this.recBox.scrollHeight;
  }

  renderRecButtons() {
    const empty = !(this.recBox?.value || '').trim();
    for (const b of [this.addBtn, this.cleanBtn, this.clearBtn]) if (b && !this.cleaning) b.disabled = empty;
  }

  // ---------------------------------------------------------------- AI: the recording, cleaned up, into the notes
  async cleanUp(key) {
    const sc = this.sceneOf(key);
    const text = this.recBox?.value ?? this.recs[key] ?? '';
    if (!sc || !text.trim()) return;
    const wasRec = this.recording;
    if (wasRec) this.stopRec();                         // nothing added while the AI works on it
    this.cleaning = true;
    [this.addBtn, this.cleanBtn, this.clearBtn].forEach((b) => { b.disabled = true; });
    this.recBox.readOnly = true; this.say('cleaning up the recording… (a minute or so)');
    try {
      const r = await fetch('/api/notes/polish', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deck: this.deckName, file: this.deckFile, scenes: [{ key, scene: sc.i + 1, text }], lang: LANGS.find(([v]) => v === this.lang)?.[1] }) });
      if (r.status === 404) throw new Error('the server is older than this page: restart it (python3 code/serve.py)');
      if (!r.ok) throw new Error(`the server answered ${r.status}`);
      const res = await r.json();
      if (res.error) throw new Error(res.error);
      const out = res.suggestions?.[key];
      if (out == null) throw new Error('the AI gave nothing back');
      this.cleaning = false;
      this.addToNotes(key, out);
      this.say('cleaned up and added to the notes · Undo takes it back');
    } catch (e) {
      this.cleaning = false;
      if (this.recBox) this.recBox.readOnly = false;
      this.renderRecButtons();
      this.say(`failed: ${e.message || e}`);
    }
    if (wasRec) this.startRec();
  }

  end() { const c = this.cur; this.exit(c ? c.index : 0, c ? c.stepIndex : 0); }
  async exit(i, k) {
    this.stopRec();
    await Promise.all([...this.saveTimers.keys()].map((key) => { clearTimeout(this.saveTimers.get(key)); return this.flushNotes(key); }));
    super.exit(i, k);
  }
}

// the audience window (?mode=run&role=audience): the slide, following the presenter; F for full screen
export function audienceWindow(player, deckName, deckFile) {
  const link = linkPlayers(player, channelName(deckName, deckFile), { hello: true, onMessage: (m) => { if (m.type === 'close') window.close(); } });
  const hint = h('div', { class: 'talk-fshint' }, 'F: full screen · this window follows the presenter window');
  document.body.append(hint);
  setTimeout(() => hint.classList.add('gone'), 6000);
  return link;
}

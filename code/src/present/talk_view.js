// Giving the talk, and rehearsing it (the editor's "Presenter mode" / "Practice mode").
//
//   code/index.html?deck=<folder>&mode=presenter#<slide>.<step>
//     the presenter's window: the scene's notes (large), the slide (small), page, next scene, a timer. The
//     audience window (?mode=run&role=audience, opened by the editor next to it) shows the slide full screen; the
//     two stay on the same page (sync.js), whichever one gets the click / key / clicker.
//   code/index.html?deck=<folder>&mode=practice#<slide>.<step>
//     the slide, large, with the microphone on: what you say is written down (the browser's speech recognition) for
//     the scene shown at the time; then the agent (agent.py polish) tidies each scene's transcript into notes, as
//     close to your own words as it can (existing notes are the base: only changed where you said it differently).
//     Each suggestion shows on its scene, above the notes: edit it if you like, accept it (saved as the notes) or not.
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
    this.tKey = `3dslides:practice:${this.deckName}:${this.deckFile}`;
    this.saved = store.get(this.tKey, { transcripts: {}, suggestions: {} });   // kept in this browser until cleared
    this.lang = store.get('3dslides:practiceLang', 'en-US');
    this.recording = false; this.interim = '';
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

  persist() { store.set(this.tKey, this.saved); }
  renderLang() { this.langBtns.forEach((b) => b.classList.toggle('on', b.dataset.lang === this.lang)); }
  get cur() { return this.player?.current; }
  keyOf(inst) { return slideKey(inst.def, inst.index); }

  // ---------------------------------------------------------------- speech → text, per scene
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
        this.renderTranscript();
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { this.recording = false; this.recState.textContent = 'microphone not allowed'; this.renderRec(); }
        else if (e.error === 'network') this.recState.textContent = 'speech recognition needs the network';
      };
      rec.onend = () => { this.interim = ''; if (this.recording) run(); else this.renderTranscript(); };   // it stops by itself now and then
      rec.start();
      this.rec = rec;
    };
    run();
    this.renderRec();
  }

  stopRec() { this.recording = false; try { this.rec?.stop(); } catch { /* done */ } this.renderRec(); }

  addText(key, text) {
    const T = this.saved.transcripts, sep = this.lang.startsWith('zh') ? '' : ' ';
    T[key] = T[key] ? `${T[key]}${sep}${text}` : text;
    this.persist();
  }

  renderRec() {
    this.recBtn.textContent = this.recording ? 'Stop recording' : 'Record';
    this.recBtn.classList.toggle('on', this.recording);
    if (this.recording) this.recState.textContent = 'listening…';
    else if (!this.SR) this.recState.textContent = 'speech recognition is not available in this browser: use Chrome';
    else if (this.recState.textContent === 'listening…') this.recState.textContent = '';
  }

  // ---------------------------------------------------------------- the panel: this scene
  update(inst) { this.whereSlot.replaceChildren(this.where(inst)); this.renderPanel(); }

  renderTranscript() {
    if (!this.trBox || !this.cur) return;
    const said = this.saved.transcripts[this.keyOf(this.cur)] || '';
    this.trBox.replaceChildren(...[said ? h('span', {}, said) : null, this.interim ? h('span', { class: 'talk-interim' }, ` ${this.interim}`) : null,
      !said && !this.interim ? h('span', { class: 'talk-empty' }, this.recording ? 'speak: it is written down here for this scene' : 'press Record, then talk through the scene') : null].filter(Boolean));
    this.trBox.scrollTop = this.trBox.scrollHeight;
    this.countEl && (this.countEl.textContent = this.countText());
  }

  countText() {
    const n = Object.values(this.saved.transcripts).filter((s) => s.trim()).length;
    return `${n} scene${n === 1 ? '' : 's'} recorded`;
  }

  renderPanel() {
    const inst = this.cur;
    if (!inst) return;
    const key = this.keyOf(inst), sug = this.saved.suggestions[key];
    this.trBox = h('div', { class: 'talk-transcript talk-user' });
    const notes = this.notesText(inst.def);
    let sugBox = null;
    if (sug != null) {
      const ta = h('textarea', { class: 'talk-sug', rows: 8 }); ta.value = sug;
      ta.addEventListener('input', () => { this.saved.suggestions[key] = ta.value; this.persist(); });
      sugBox = h('section', { class: 'talk-box sug' },
        h('div', { class: 'talk-boxhead' }, h('span', {}, 'AI suggestion'), h('span', { class: 'talk-grow' }),
          h('button', { onclick: () => this.discard([key]) }, 'discard'),
          h('button', { class: 'primary', title: 'save it as this scene’s notes', onclick: () => this.accept([key]) }, 'use as notes')),
        ta);
    }
    this.countEl = h('span', { class: 'talk-dim' }, this.countText());
    const pending = Object.keys(this.saved.suggestions).length;
    this.panel.replaceChildren(...[
      h('section', { class: 'talk-box' },
        h('div', { class: 'talk-boxhead' }, h('span', {}, 'What you said · this scene'), h('span', { class: 'talk-grow' }),
          h('button', { title: 'forget what was recorded for this scene (to say it again)', onclick: () => { delete this.saved.transcripts[key]; this.persist(); this.renderPanel(); } }, 'clear')),
        this.trBox),
      sugBox,
      h('section', { class: 'talk-box' },
        h('div', { class: 'talk-boxhead' }, h('span', {}, 'Notes · this scene')),
        notes ? h('div', { class: 'talk-notes-small talk-user' }, notes) : h('p', { class: 'talk-empty' }, 'no notes yet')),
      h('section', { class: 'talk-box talk-actions' },
        h('div', { class: 'row' }, this.countEl, h('span', { class: 'talk-grow' }),
          h('button', { title: 'forget every scene’s recording and suggestion (click twice)', onclick: (e) => {
            if (!e.currentTarget.classList.contains('arm')) { e.currentTarget.classList.add('arm'); e.currentTarget.textContent = 'click again to clear all'; return; }
            this.saved = { transcripts: {}, suggestions: {} }; this.persist(); this.renderPanel(); } }, 'clear all')),
        this.aiBtn = h('button', { class: 'primary wide', title: 'the agent connected in the editor tidies each recorded scene into notes, close to your own words; nothing is saved until you accept it',
          onclick: () => this.polish() }, 'AI: tidy what I said into notes'),
        pending ? h('button', { class: 'wide', title: 'save every scene’s suggestion as its notes', onclick: () => this.accept(Object.keys(this.saved.suggestions)) }, `use all ${pending} suggestions as notes`) : null,
        this.aiState = h('p', { class: 'talk-dim' }, '')),
    ].filter(Boolean));
    this.renderTranscript();
  }

  // ---------------------------------------------------------------- AI: transcripts → notes
  async polish() {
    const scenes = this.deck.slides.map((def, i) => ({ def, i, key: slideKey(def, i) }))
      .filter((s) => (this.saved.transcripts[s.key] || '').trim())
      .map((s) => ({ key: s.key, scene: s.i + 1, notes: this.notesText(s.def), transcript: this.saved.transcripts[s.key] }));
    if (!scenes.length) { this.aiState.textContent = 'nothing recorded yet'; return; }
    if (this.recording) this.stopRec();
    this.aiBtn.disabled = true; this.aiState.textContent = `the agent is tidying ${scenes.length} scene${scenes.length > 1 ? 's' : ''}… (a minute or two)`;
    try {
      const r = await fetch('/api/notes/polish', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deck: this.deckName, file: this.deckFile, scenes, lang: LANGS.find(([v]) => v === this.lang)?.[1] }) });
      if (r.status === 404) throw new Error('the server is older than this page: restart it (python3 code/serve.py)');
      if (!r.ok) throw new Error(`the server answered ${r.status}`);
      const res = await r.json();
      if (res.error) throw new Error(res.error);
      Object.assign(this.saved.suggestions, res.suggestions); this.persist();
      this.aiBtn.disabled = false;
      this.renderPanel();
      const n = Object.keys(res.suggestions).length;
      this.aiState.textContent = `${n} suggestion${n === 1 ? '' : 's'} ready: each shows on its scene, above its notes`;
    } catch (e) {
      this.aiBtn.disabled = false; this.aiState.textContent = `failed: ${e.message || e}`;
    }
  }

  async accept(keys) {
    const list = [];
    for (const key of keys) {
      const i = this.deck.slides.findIndex((d, j) => slideKey(d, j) === key);
      if (i >= 0 && this.saved.suggestions[key] != null) list.push([this.deck.slides[i], i, this.saved.suggestions[key]]);
    }
    if (!list.length) return;
    try { await this.saveNotes(list); } catch (e) {                // kept: the suggestions stay until they are saved
      if (this.aiState) this.aiState.textContent = `failed: ${e.message || e}`;
      return;
    }
    for (const key of keys) { delete this.saved.suggestions[key]; delete this.saved.transcripts[key]; }   // done with: said, and written down
    this.persist();
    this.renderPanel();
  }

  discard(keys) { for (const key of keys) delete this.saved.suggestions[key]; this.persist(); this.renderPanel(); }

  end() { const c = this.cur; this.exit(c ? c.index : 0, c ? c.stepIndex : 0); }
  exit(i, k) {
    this.stopRec();
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

// The agent in the editor: "Connect to agent" (top bar) asks once which one may work on this project
// (Claude Code or Codex, run by code/serve.py on this machine: code/agent.py) and keeps the answer in
// user/agent.json; then a panel under the slide takes what you type and shows the agent at work. It edits
// the deck's files itself; the editor reloads them live. When you close the panel after talking to it, the
// agent lists the design preferences you showed (font, sizes, colours, …): all ticked, untick what is not
// one, and the rest is kept in user/user_skills/preferences.md for every later session.
// Closing the panel (✕) keeps the conversation: the agent's session goes on (user/agent.json) and the log is kept
// (in this browser, per deck: restored when the panel opens again, also after a reload); only /clear starts anew.
// Each time the panel opens, the agent's first line says where you are: scene n, page k.
// "+ New 3D scene → Generate" (generateScene): connect first if none is (the approval), then the panel opens
// and the agent is asked to start: it says it will generate the scene and asks what it should show.

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v != null && v !== false) el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) el.append(c);
  return el;
};

export class AgentPanel {
  constructor(editor, canvas) {
    this.editor = editor; this.canvas = canvas;
    this.button = h('button', { class: 'ed-agent-btn', title: 'let Claude Code or Codex work on this talk with you', onclick: () => this.toggle() }, 'Connect to agent');
    this.panel = h('div', { class: 'ed-agent', hidden: true });
    canvas.append(this.panel);
    this.refresh();
  }

  async refresh() {
    try { this.state = await (await fetch('/api/agent/status')).json(); } catch { this.state = { available: {}, agent: null, names: {} }; }
    this.button.textContent = this.state.agent ? `${this.state.names[this.state.agent]} ▾` : 'Connect to agent';
    this.button.classList.toggle('on', !!this.state.agent && !this.panel.hidden);
  }

  async toggle() {
    await this.refresh();
    if (!this.state.agent) return this.ask();
    this.show(this.panel.hidden);
  }

  show(on) {
    this.panel.hidden = !on;
    this.canvas.classList.toggle('with-agent', on);
    this.button.classList.toggle('on', on);
    window.dispatchEvent(new Event('resize'));          // the slide makes room
    if (on) {
      this.build();
      const c = this.context();
      if (c.scene) this.line('agent', `You are on scene ${c.scene}${c.sceneId ? ` (${c.sceneId}, ${c.type.toUpperCase()})` : ''}, page ${c.page} of ${c.pages}.`, false);
      this.input?.focus();
    }
  }

  // the log, kept per deck in this browser (closing the panel or reloading the page keeps the conversation)
  get logKey() { return `3dslides:agent-log:${this.editor.deckName}`; }
  loadLog() { try { return JSON.parse(localStorage.getItem(this.logKey)) || []; } catch { return []; } }
  saveLog() { try { localStorage.setItem(this.logKey, JSON.stringify(this.history.slice(-400))); } catch { /* not kept */ } }

  // + New 3D scene → Generate: the agent (approved first if none is) starts a new 3D scene after the one shown
  async generateScene() {
    await this.refresh();
    const go = () => {
      this.show(true);
      const c = this.context();
      this.send([
        `The user clicked "+ New 3D scene" in the editor and chose Generate: they want you to generate a new 3D scene, ` +
          `to go right after scene ${c.scene ?? 'the last one'}${c.sceneId ? ` (id '${c.sceneId}')` : ''}.`,
        'Do not change any files yet. Reply briefly: begin with "I will generate this 3D scene for you." (in the language the',
        'user writes to you in), then ask what the scene should show (the objects / models, how they move, the camera),',
        'in one or two short questions. When they answer, build it as user/general_skills/SKILL.md says ("A new 3D scene").',
      ].join(' '), '+ New 3D scene → Generate');
    };
    if (!this.state.agent) return this.ask(go);
    go();
  }

  // once: which agent may work here (an approval, kept in user/agent.json); then `after` (else: the panel opens)
  ask(after = null) {
    const { available = {}, names = {} } = this.state;
    const close = () => veil.remove();
    const pick = async (agent) => {
      const r = await (await fetch('/api/agent/connect', { method: 'POST', body: JSON.stringify({ agent }) })).json();
      if (!r.ok) { note.textContent = r.error || 'could not connect'; return; }
      close(); await this.refresh(); if (after) after(); else this.show(true);
    };
    const note = h('p', { class: 'ed-agent-note' });
    const CMD = { claude: 'claude --dangerously-skip-permissions --model opus', codex: 'codex --dangerously-bypass-approvals-and-sandbox -m gpt-6-luna' };
    const box = h('div', { class: 'ed-agent-ask' },
      h('h3', {}, 'Connect an agent'),
      h('p', {}, 'Approving one runs it in this folder with this command:'),
      ...Object.keys(names).map((k) => h('div', { class: 'ed-agent-option' },
        h('button', {
          class: 'primary', disabled: available[k] ? null : true, title: available[k] ? `approve ${names[k]}` : `${names[k]} is not installed on this computer`,
          onclick: () => pick(k),
        }, `Approve ${names[k]}`),
        h('code', { class: 'ed-agent-cmd' }, CMD[k] || k))),
      h('ul', { class: 'ed-agent-small' },
        h('li', {}, 'It reads, writes and runs things in this folder without asking you each time.'),
        h('li', {}, 'It first reads user/general_skills and user/user_skills.'),
        h('li', {}, 'You approve once; it is kept in user/agent.json. Disconnect (in the panel) takes it back.')),
      note,
      h('button', { onclick: close }, 'Not now'));
    const veil = h('div', { class: 'ed-agent-veil', onclick: (e) => { if (e.target === veil) close(); } }, box);
    document.body.append(veil);
  }

  build() {
    if (this.log) return;
    this.log = h('div', { class: 'ed-agent-log' });
    this.input = h('textarea', { rows: 2, placeholder: 'Tell the agent what to change… (Enter: send · Shift+Enter: new line)' });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send(); }
      e.stopPropagation();                                 // typing here is not an editor shortcut
    });
    this.sendBtn = h('button', { class: 'primary', onclick: () => (this.busy ? this.stop() : this.send()) }, 'Send');
    const head = h('div', { class: 'ed-agent-head' },
      h('span', { class: 'ed-agent-who' }, this.state.names[this.state.agent] || 'agent'),
      h('span', { class: 'ed-grow' }),
      h('button', { title: 'clear: forget this conversation, start a new one (also: type /clear)', onclick: () => this.review(() => this.clear()) }, '/clear'),
      h('button', { title: 'stop using this agent (you will be asked again)', onclick: () => this.review(() => this.disconnect()) }, 'Disconnect'),
      h('button', { title: 'hide', onclick: () => this.review(() => this.show(false)) }, '✕'));
    this.panel.append(head, this.log, h('div', { class: 'ed-agent-input' }, this.input, this.sendBtn));
    this.history = this.loadLog();                       // the conversation so far
    for (const { kind, text } of this.history) this.log.append(h('div', { class: `ed-agent-line ${kind}` }, text));
  }

  // a line in the log (keep: into the kept log; the "you are on …" lines are not kept)
  line(kind, text, keep = true) {
    const d = h('div', { class: `ed-agent-line ${kind}` }, text);
    this.log.append(d); this.log.scrollTop = this.log.scrollHeight;
    if (keep) { this.history.push({ kind, text }); this.saveLog(); }
    return d;
  }

  // what the user is looking at, sent with the message
  context() {
    const ed = this.editor, c = ed.player?.current;
    if (!c) return {};
    return { scene: c.index + 1, sceneId: c.def.id, type: c.def.type || '2d', page: c.stepIndex + 1, pages: c.steps.length + 1,
      selected: [...(ed.selection || [])].concat(ed.selectedModel ? [ed.selectedModel] : [], ed.selectedLight ? [`light ${ed.selectedLight}`] : []) };
  }

  // what is typed, or (from the editor: generateScene) `given`, shown in the log as `shown`
  async send(given = null, shown = null) {
    const text = (given ?? this.input.value).trim();
    if (this.busy && given) { this.line('error', 'the agent is still working: wait for it (or Stop), then try again'); return; }
    if (!text || this.busy) return;
    if (given == null && text === '/clear') { this.input.value = ''; return this.review(() => this.clear()); }
    if (given == null) { this.input.value = ''; this.line('user', text); } else this.line('tool', shown || text);
    this.input?.focus();
    this.talked = true;
    this.busy = true; this.sendBtn.textContent = 'Stop';
    const ed = this.editor;
    try {
      const r = await fetch('/api/agent/send', { method: 'POST', body: JSON.stringify({ deck: ed.deckName, file: ed.deckFile, text, context: this.context() }) });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          if (!chunk.startsWith('data: ')) continue;
          const ev = JSON.parse(chunk.slice(6));
          if (ev.kind === 'text') this.line('agent', ev.text);
          else if (ev.kind === 'tool') this.line('tool', ev.text);
          else if (ev.kind === 'error') this.line('error', ev.text);
        }
      }
    } catch (e) { this.line('error', String(e.message || e)); }
    this.busy = false; this.sendBtn.textContent = 'Send';
  }

  // leaving after a talk: the preferences the agent saw, to keep (all ticked; untick what is not one)
  async review(then) {
    if (!this.talked || this.busy) return then();
    this.talked = false;
    const list = h('div', { class: 'ed-agent-prefs' }, h('p', { class: 'ed-agent-wait' }, 'Looking back over the conversation…'));
    const done = (keep) => async () => {
      if (keep) {
        const items = [...list.querySelectorAll('input[type=checkbox]')].filter((c) => c.checked).map((c) => c.closest('label').querySelector('.pref-text').textContent);
        if (items.length) await fetch('/api/agent/save_preferences', { method: 'POST', body: JSON.stringify({ items }) });
      }
      veil.remove(); then();
    };
    const save = h('button', { class: 'primary', onclick: done(true), disabled: true }, 'Keep these');
    const box = h('div', { class: 'ed-agent-ask' },
      h('h3', {}, 'Remember your preferences?'),
      h('p', {}, 'From this session — kept in user/user_skills/preferences.md, the agent follows them next time. Untick any that are not.'),
      list, h('div', { class: 'ed-agent-pick' }, save, h('button', { onclick: done(false) }, 'Skip')));
    const veil = h('div', { class: 'ed-agent-veil' }, box);
    document.body.append(veil);
    let items = [];
    try { items = (await (await fetch('/api/agent/preferences', { method: 'POST', body: JSON.stringify({ deck: this.editor.deckName }) })).json()).items || []; } catch { /* none */ }
    list.replaceChildren(...(items.length ? items.map((t) => h('label', { class: 'pref' }, h('input', { type: 'checkbox', checked: true }), h('span', { class: 'pref-text' }, t)))
      : [h('p', { class: 'ed-agent-wait' }, 'Nothing new to remember.')]));
    save.disabled = !items.length;
  }

  // a new conversation: the agent forgets this one (its session for this deck)
  async clear() {
    await fetch('/api/agent/clear', { method: 'POST', body: JSON.stringify({ deck: this.editor.deckName }) });
    this.log.replaceChildren(); this.history = []; this.line('tool', 'cleared: a new conversation');
  }

  async stop() { await fetch('/api/agent/stop', { method: 'POST', body: '{}' }); }

  async disconnect() {
    await fetch('/api/agent/disconnect', { method: 'POST', body: '{}' });
    this.panel.replaceChildren(); this.log = null; this.show(false); await this.refresh();
  }
}

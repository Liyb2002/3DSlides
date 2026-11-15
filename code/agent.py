"""The editor's agent: Claude Code, Codex, Kimi Code or Qwen Code, run on this machine (their own command-line
tools, already logged in), working in this folder on what you type in the editor. (The editor offers Claude Code
and Codex in English, and Codex, Kimi Code and Qwen Code in Chinese: the ones that can be used from China.)

    GET  /api/agent/status          -> {available: {claude, codex}, agent: the approved one or null}
    POST /api/agent/connect {agent} -> approves it (once: kept in user/agent.json)
    POST /api/agent/send {deck, file, text, context} -> a text/event-stream of
         {kind: 'text' | 'tool' | 'error' | 'done', text} while the agent works
    POST /api/agent/stop            -> stops the one working

The agent reads user/general_skills/SKILL.md (how this system works) and user/user_skills/ (the user's
own notes) first, edits the deck's files itself, and the editor picks the changes up live (live.js).
Its session is kept per deck (user/agent.json), so a conversation goes on across messages.
"""
import json, os, shutil, subprocess, threading, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))     # 3DSlides/
USER = os.path.join(ROOT, 'user')
STATE = os.path.join(USER, 'agent.json')
AGENTS = {'claude': 'Claude Code', 'codex': 'Codex', 'kimi': 'Kimi Code', 'qwen': 'Qwen Code'}
# the models used here: Claude Code with Opus; Codex with its fast, affordable model (its non-interactive mode, which
# a program has to use, does not take every model a ChatGPT sign-in allows in the interactive app)
MODELS = {'claude': 'opus', 'codex': 'gpt-6-luna'}     # (Kimi Code, Qwen Code: their own default model)
_running = {'proc': None}
_lock = threading.Lock()


def load():
    try: return json.load(open(STATE))
    except Exception: return {}


def save(st):
    os.makedirs(USER, exist_ok=True)
    with open(STATE, 'w') as f: json.dump(st, f, indent=1)


def status():
    st = load()
    return dict(available={k: bool(shutil.which(k)) for k in AGENTS}, agent=st.get('agent'), names=AGENTS)


def connect(agent):
    if agent not in AGENTS or not shutil.which(agent): return dict(ok=False, error=f'{agent} is not installed')
    st = load(); st.update(agent=agent, approved_at=time.strftime('%Y-%m-%d %H:%M:%S'))
    st.setdefault('sessions', {})
    save(st)
    return dict(ok=True, agent=agent)


def clear(deck):
    """forget this deck's conversation (the next message starts a new session)"""
    st = load(); sessions = st.get('sessions') or {}
    for k in [k for k in sessions if k.endswith(f':{deck}')]: del sessions[k]
    save(st); return dict(ok=True)


def disconnect():
    st = load(); st.pop('agent', None); save(st); return dict(ok=True)


GUIDE = """You are working inside "3D Slides", a slide editor, on the user's talk. Before anything else read
user/general_skills/SKILL.md (how the system and its files work) and any files in user/user_skills/ (the user's own
notes and preferences). Then do what the user asks by editing the deck's files in this folder (mostly
<deck>/deck.js and <deck>/overrides.json); the open editor reloads them by itself, so do not start servers or
browsers. Keep the user's own edits; change only what the request needs; check deck.js with `python3 code/tools/check_deck.py <deck>`. Do not write
in user/ (the user's preferences are kept by the editor, after asking, when the session ends). Answer briefly, in the
user's language, saying what you changed."""


def prompt(text, context, deck, file):
    c = context or {}
    where = (f"The user is looking at deck '{deck}' ({deck}/{file}.js), scene {c.get('scene')} (id '{c.get('sceneId')}', "
             f"{c.get('type')}), page {c.get('page')} of {c.get('pages')}")
    if c.get('selected'): where += f"; selected: {', '.join(c['selected'])}"
    return f"{where}.\n\n{text}"


def stream(agent, deck, file, text, context, emit):
    """run the agent on one message; emit(dict) for each thing to show; returns when it is done"""
    st = load(); sessions = st.setdefault('sessions', {}); key = f'{agent}:{deck}'
    cmd = command(agent, prompt(text, context, deck, file), sessions.get(key))
    try:
        proc = subprocess.Popen(cmd, cwd=ROOT, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    except Exception as e:
        emit(dict(kind='error', text=str(e))); return
    with _lock: _running['proc'] = proc
    try:
        for line in proc.stdout:
            line = line.strip()
            if not line: continue
            try: ev = json.loads(line)
            except Exception: continue
            for out in PARSE[agent](ev, sessions, key):
                emit(out)
        proc.wait()
        if agent == 'kimi' and not sessions.get(key) and proc.returncode == 0: sessions[key] = CONTINUE   # (no id seen)
        if proc.returncode not in (0, None):
            # the tool's own complaints, without the noise of its plug-ins (MCP servers that are not signed in, …)
            lines = [l for l in (proc.stderr.read() or '').splitlines() if l.strip() and 'rmcp::' not in l and 'Reading additional input' not in l]
            err = '\n'.join(lines).strip()[-800:]
            if err: emit(dict(kind='error', text=err))
    finally:
        with _lock: _running['proc'] = None
        save(st)
        emit(dict(kind='done', text=''))


CONTINUE = 'continue'          # a Kimi session whose id was not seen: the next message continues the latest one here


def command(agent, msg, sid, read_only=False):
    """the command line that runs `agent` on one message (sid: the session to go on with, or None). Approved once by
    the user, it works without asking each time; read_only: for a question about the session (it changes nothing)."""
    if agent == 'claude':                  # as `claude --dangerously-skip-permissions`
        cmd = ['claude', '-p', msg, '--output-format', 'stream-json', '--verbose', '--model', MODELS['claude']]
        cmd += (['--allowedTools', 'Read', '--disallowedTools', 'Edit', 'Write', 'Bash', 'NotebookEdit'] if read_only
                else ['--append-system-prompt', GUIDE, '--dangerously-skip-permissions'])
        return cmd + (['--resume', sid] if sid else [])
    if agent == 'codex':                   # as `codex --dangerously-bypass-approvals-and-sandbox`
        base = ['codex', 'exec', '--json', '--skip-git-repo-check', '-C', ROOT, '-m', MODELS['codex']]
        base += ['-s', 'read-only'] if read_only else ['--dangerously-bypass-approvals-and-sandbox']
        return base + (['resume', sid, msg] if sid else [GUIDE + '\n\n' + msg])
    if agent == 'kimi':                    # `kimi -p` asks for no approvals (its print mode); no system prompt flag
        cmd = ['kimi', '-p', msg if sid else GUIDE + '\n\n' + msg, '--output-format', 'stream-json']
        return cmd + ((['--continue'] if sid == CONTINUE else ['--session', sid]) if sid else [])
    if agent == 'qwen':                    # as `qwen --yolo`; read only: its plan mode
        cmd = ['qwen', '-p', msg, '--output-format', 'stream-json']
        cmd += ['--approval-mode', 'plan'] if read_only else ['--yolo', '--append-system-prompt', GUIDE]
        return cmd + (['--resume', sid] if sid else [])
    raise ValueError(agent)


def _claude(ev, sessions, key):          # (Qwen Code writes the same events)
    t = ev.get('type')
    if ev.get('session_id'): sessions[key] = ev['session_id']
    if t == 'assistant':
        for c in (ev.get('message') or {}).get('content') or []:
            if c.get('type') == 'text' and c.get('text', '').strip(): yield dict(kind='text', text=c['text'])
            elif c.get('type') == 'tool_use': yield dict(kind='tool', text=_tool(c.get('name'), c.get('input') or {}))
    elif t == 'result' and ev.get('is_error'):
        yield dict(kind='error', text=str(ev.get('result') or 'the agent stopped with an error'))


def _tool(name, inp):
    target = inp.get('file_path') or inp.get('path') or inp.get('pattern') or inp.get('command') or ''
    return f'{name} {os.path.relpath(target, ROOT) if os.path.isabs(str(target)) else target}'.strip()


def _codex(ev, sessions, key):
    if ev.get('thread_id'): sessions[key] = ev['thread_id']
    item = ev.get('item') or {}
    if ev.get('type', '').endswith('completed') and item:
        ty = item.get('type') or item.get('item_type')
        if ty in ('agent_message', 'assistant_message') and item.get('text'): yield dict(kind='text', text=item['text'])
        elif ty in ('command_execution',): yield dict(kind='tool', text=f"run {item.get('command', '')}")
        elif ty in ('file_change',):
            for ch in item.get('changes') or []: yield dict(kind='tool', text=f"edit {ch.get('path', '')}")
    if ev.get('type') == 'error' or ev.get('type') == 'turn.failed':
        yield dict(kind='error', text=str(ev.get('message') or ev.get('error') or 'error'))


def _kimi(ev, sessions, key):
    """Kimi Code's stream-json: one message per line (an assistant reply, an assistant message with tool_calls, a
    tool's result); its session id, where one is given (a resume hint at the end)"""
    sess = ev.get('session')
    sid = ev.get('session_id') or ev.get('sessionId') or (sess.get('id') if isinstance(sess, dict) else None)
    if sid: sessions[key] = sid
    if ev.get('role') != 'assistant': return
    content = ev.get('content')
    text = content if isinstance(content, str) else ''.join(c.get('text', '') for c in content or [] if isinstance(c, dict) and c.get('type') == 'text')
    if text.strip(): yield dict(kind='text', text=text)
    for call in ev.get('tool_calls') or []:
        fn = call.get('function') or call
        try: args = json.loads(fn.get('arguments') or '{}') if isinstance(fn.get('arguments'), str) else fn.get('arguments') or {}
        except Exception: args = {}
        yield dict(kind='tool', text=_tool(fn.get('name', 'tool'), args if isinstance(args, dict) else {}))


PARSE = {'claude': _claude, 'codex': _codex, 'kimi': _kimi, 'qwen': _claude}


def stop():
    with _lock:
        p = _running['proc']
    if p and p.poll() is None: p.terminate(); return dict(ok=True)
    return dict(ok=False)


# ---------------------------------------------------------------- user preferences (user/user_skills)
PREFS = os.path.join(USER, 'user_skills', 'preferences.md')
ASK_PREFS = """Look back over this conversation. List the design preferences the user showed (things to do the same way next
time: font, font sizes, colours, layout, spacing, animation and timing, camera, wording, naming, ...), each one short,
general and in the user's language. Leave out one-off content edits and anything already in
user/user_skills/preferences.md. Do not change any file. Reply with only a JSON array of strings (empty: [])."""


def preferences(deck):
    """the agent's list of the user's design preferences from this deck's conversation (nothing is written)"""
    st = load(); who = st.get('agent'); sid = (st.get('sessions') or {}).get(f'{who}:{deck}')
    if not who or not sid or who not in PARSE: return dict(items=[])
    try: out = subprocess.run(command(who, ASK_PREFS, sid, read_only=True), cwd=ROOT, capture_output=True, text=True, timeout=300).stdout
    except Exception as e: return dict(items=[], error=str(e))
    text, scratch = '', {}                             # the agent's last reply (its events read as while working)
    for line in out.splitlines():
        try: ev = json.loads(line)
        except Exception: continue
        for o in PARSE[who](ev, scratch, 'k'):
            if o['kind'] == 'text': text = o['text']
    i, j = text.find('['), text.rfind(']')
    try: items = [str(x).strip() for x in json.loads(text[i:j + 1]) if str(x).strip()] if i >= 0 < j else []
    except Exception: items = []
    return dict(items=items)


def save_preferences(items):
    """append the kept preferences to user/user_skills/preferences.md (the agent reads it every time)"""
    items = [s.strip() for s in items or [] if s and s.strip()]
    if not items: return dict(ok=True, saved=0)
    os.makedirs(os.path.dirname(PREFS), exist_ok=True)
    have = open(PREFS).read() if os.path.exists(PREFS) else '# The user\'s design preferences\n\nKept from earlier sessions; follow them unless asked otherwise.\n'
    new = [s for s in items if f'- {s}' not in have]
    if new:
        with open(PREFS, 'w') as f:
            f.write(have.rstrip('\n') + f"\n\n## {time.strftime('%Y-%m-%d')}\n" + ''.join(f'- {s}\n' for s in new))
    return dict(ok=True, saved=len(new))


# ---------------------------------------------------------------- practice mode: transcripts -> speaker notes
POLISH = """You help a speaker turn a practice run-through into speaker notes for the talk in {deck}/{file}.js (you may read
that file, and {deck}/overrides.json, to see what each scene shows, e.g. to fix technical terms the recognizer misheard;
change no file). For each scene below you get its key, its number, the speaker's current notes (may be empty) and a
speech-recognition transcript of what the speaker just said while practising that scene.

Write the notes for each scene:
- Stay as close as you can to the speaker's own words and order. Only remove fillers, false starts and repetitions, fix
  words the recognizer obviously got wrong, fix grammar lightly, and break it into short lines.
- If the scene already has notes, they are the base: keep their wording and formatting, change them only where the
  transcript clearly says it differently or adds something. Never rewrite them in your own style; do not shorten them.
- If the transcript is empty or unusable, give the current notes back unchanged.
- Keep the speaker's language{lang}.
Reply with only one JSON object: {{"<scene key>": "<notes>", ...}}, one entry per scene below, nothing else."""


def polish(deck, file, scenes, lang=None):
    """practice mode: each scene's transcript (and its current notes) tidied into notes by the approved agent, read
    only (nothing written; the page saves what the user accepts) -> {suggestions: {key: text}} or {error}"""
    who = load().get('agent')
    if not who or who not in PARSE: return dict(error='no agent connected: connect one in the editor first (the agent button in the top bar)')
    scenes = [dict(key=str(s.get('key')), scene=s.get('scene'), notes=s.get('notes') or '', transcript=s.get('transcript') or '')
              for s in scenes if s.get('key') is not None]
    if not scenes: return dict(suggestions={})
    msg = POLISH.format(deck=deck, file=file, lang=f' (the talk is given in {lang})' if lang else '') + \
        '\n\nScenes:\n' + json.dumps(scenes, ensure_ascii=False, indent=1)
    try: out = subprocess.run(command(who, msg, None, read_only=True), cwd=ROOT, capture_output=True, text=True, timeout=900).stdout
    except Exception as e: return dict(error=str(e))
    text, scratch = '', {}
    for line in out.splitlines():
        try: ev = json.loads(line)
        except Exception: continue
        for o in PARSE[who](ev, scratch, 'k'):
            if o['kind'] == 'text': text = o['text']
    i, j = text.find('{'), text.rfind('}')
    try: got = json.loads(text[i:j + 1]) if i >= 0 < j else None
    except Exception: got = None
    if not isinstance(got, dict): return dict(error='the agent did not answer with notes', raw=text[-600:])
    keys = {s['key'] for s in scenes}
    return dict(suggestions={str(k): str(v) for k, v in got.items() if str(k) in keys})

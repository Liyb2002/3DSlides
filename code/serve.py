#!/usr/bin/env python3
"""Local server for 3D Slides.

    python3 code/serve.py [port] [deck]   ->  http://localhost:8000/

A talk ("deck") is a <name>.3Dslides folder next to code/ (Finder shows it as one file; double-clicking it
opens it here through 3DSlides.app, made by code/tools/make_app.sh). `deck`: which one to open (its name or
path; default: the first *.3Dslides in this folder).
Serves the 3DSlides folder (engine in code/, talks such as demo.3Dslides/ next to it):
  /                      -> the editor for that deck  (code/index.html?deck=demo.3Dslides)
  ?mode=run              -> present directly
  ?deck=<folder>         -> another deck, e.g. code/examples/basics
Editor saves: POST /api/save?deck=<folder>[&file=deck] with what changed (a delta,
merged into what is saved, so several editor tabs never overwrite each other).
Text / position edits of plain element literals are written back into the
deck's source (<folder>/<file>.js, see deck_patch.py); the rest stays in
<folder>/overrides.json. Those two (and uploads, below) are the only files the server writes.
POST /api/upload?deck=<folder>&name=<file name> with a file's bytes (the editor's
"+ New 3D scene", "+ Upload 3D shape", "+ Image / video"): a model (stl obj ply glb
gltf 3mf) goes to <folder>/assets/models/uploads/, an image / video (png jpg gif
webp svg mp4 webm mov) to <folder>/assets/media/uploads/, named in snake_case;
answers {path} relative to the deck folder.
POST /api/undo | /api/redo ?deck=<folder>[&file=deck]: step back / forward
through the saves of this server session (deck source + overrides together;
saves less than 1.5 s apart count as one step).
/api/agent/...: the editor's agent (Claude Code or Codex on this machine), see agent.py.
GET /api/root: the folder served (code/tools/open_deck.sh reuses a server already serving it).
GET /api/stamp?deck=<folder>[&file=deck]: change stamps, polled by open pages
so edits show up live in every editor / presenter tab.
"""
import http.server, json, os, re, sys, time, urllib.parse, webbrowser, threading
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import agent                                                     # noqa: E402
from deck_patch import patch_deck, patch_slides, patch_pages, patch_order                   # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # 3DSlides/
args = [a for a in sys.argv[1:] if not a.startswith('--')]
PORT = int(args.pop(0)) if args and args[0].isdigit() else 8000

def default_deck():
    """the deck to open: the one named on the command line (a name or a path inside this folder), else the
    first <name>.3Dslides here"""
    if args:
        path = os.path.realpath(args[0] if os.path.isabs(args[0]) or os.path.exists(args[0]) else os.path.join(ROOT, args[0]))
        if not path.startswith(ROOT + os.sep):
            sys.exit(f'{args[0]}: a deck must be inside {ROOT} (next to code/)')
        return os.path.relpath(path, ROOT)
    found = sorted(d for d in os.listdir(ROOT) if d.endswith('.3Dslides') and os.path.isdir(os.path.join(ROOT, d)))
    return found[0] if found else 'demo.3Dslides'
DECK = default_deck()

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')   # always serve the latest deck
        super().end_headers()

    def log_message(self, fmt, *a):
        if self.command == 'POST' or (len(a) > 1 and str(a[1])[:1] in '45'): super().log_message(fmt, *a)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path in ('/', '/index.html'):
            self.send_response(302)
            self.send_header('Location', '/code/index.html' + (f'?{u.query}' if u.query else f'?deck={urllib.parse.quote(DECK)}'))
            self.end_headers(); return
        if u.path == '/api/agent/status': return self.send_json(agent.status())
        if u.path == '/api/root': return self.send_json(dict(root=ROOT))   # (open_deck.sh: is this server for this folder)
        if u.path == '/api/stamp':
            q = urllib.parse.parse_qs(u.query)
            folder = self.deck_folder(q.get('deck', [''])[0], q.get('file', ['deck'])[0])
            if not folder: return self.send_error(400, 'bad deck')
            return self.send_json(stamps(folder, q.get('file', ['deck'])[0]))
        if u.path.endswith('/overrides.json') and not os.path.exists(self.translate_path(u.path)):
            body = b'{"slides": {}}'                       # no edits yet
            self.send_response(200); self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body); return
        super().do_GET()

    def deck_folder(self, deck, file='deck'):
        folder = os.path.realpath(os.path.join(ROOT, deck))
        if not deck or not folder.startswith(ROOT + os.sep) or not re.fullmatch(r'[\w-]+', file) \
                or not os.path.isfile(os.path.join(folder, file + '.js')):
            return None
        return folder

    def agent_post(self, what):
        n = int(self.headers.get('Content-Length', 0) or 0)
        body = json.loads(self.rfile.read(n) or b'{}') if n else {}
        if what == 'connect': return self.send_json(agent.connect(body.get('agent')))
        if what == 'disconnect': return self.send_json(agent.disconnect())
        if what == 'stop': return self.send_json(agent.stop())
        if what == 'clear': return self.send_json(agent.clear(body.get('deck', '')))
        if what == 'preferences': return self.send_json(agent.preferences(body.get('deck', '')))   # (the agent's list, nothing written)
        if what == 'save_preferences': return self.send_json(agent.save_preferences(body.get('items')))
        if what != 'send': return self.send_error(404)
        who = agent.load().get('agent')
        if not who: return self.send_error(403, 'no agent approved')
        folder = self.deck_folder(body.get('deck', ''), body.get('file', 'deck'))
        if not folder: return self.send_error(400, 'bad deck')
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream'); self.send_header('Cache-Control', 'no-store'); self.end_headers()
        def emit(ev):
            try: self.wfile.write(f'data: {json.dumps(ev)}\n\n'.encode()); self.wfile.flush()
            except Exception: pass
        agent.stream(who, body.get('deck', ''), body.get('file', 'deck'), body.get('text', ''), body.get('context'), emit)

    MODEL_TYPES = ('stl', 'obj', 'ply', 'glb', 'gltf', '3mf')
    MEDIA_TYPES = ('png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'mp4', 'webm', 'mov', 'm4v')

    def upload(self, q):
        folder = self.deck_folder(q.get('deck', [''])[0], q.get('file', ['deck'])[0])
        if not folder: return self.send_error(400, 'bad deck')
        stem, _, ext = q.get('name', [''])[0].rpartition('.')
        ext = ext.lower()
        if ext not in self.MODEL_TYPES + self.MEDIA_TYPES: return self.send_error(400, f'types: {", ".join(self.MODEL_TYPES + self.MEDIA_TYPES)}')
        n = int(self.headers.get('Content-Length', 0))
        if not 0 < n <= 300 * 2**20: return self.send_error(400, 'empty or over 300 MB')
        data = self.rfile.read(n)
        stem = re.sub(r'[^a-z0-9]+', '_', stem.lower()).strip('_') or 'model'      # snake_case (AGENTS.md)
        kind = 'models' if ext in self.MODEL_TYPES else 'media'
        out = os.path.join(folder, 'assets', kind, 'uploads'); os.makedirs(out, exist_ok=True)
        name, k = f'{stem}.{ext}', 2
        while os.path.exists(os.path.join(out, name)): name, k = f'{stem}_{k}.{ext}', k + 1
        with open(os.path.join(out, name), 'wb') as f: f.write(data)
        return self.send_json(dict(ok=True, path=f'assets/{kind}/uploads/{name}'))

    def send_json(self, obj):
        body = json.dumps(obj).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        if u.path.startswith('/api/agent/'): return self.agent_post(u.path[len('/api/agent/'):])
        if u.path not in ('/api/save', '/api/undo', '/api/redo', '/api/upload'): return self.send_error(404)
        q = urllib.parse.parse_qs(u.query)
        if u.path == '/api/upload': return self.upload(q)
        file = q.get('file', ['deck'])[0]
        folder = self.deck_folder(q.get('deck', [''])[0], file)
        if not folder: return self.send_error(400, 'bad deck')
        if u.path != '/api/save':
            with LOCK:
                ok = HISTORY.step(folder, file, back=u.path == '/api/undo')
                return self.send_json(dict(ok=ok, stamp=stamps(folder, file)))
        delta = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
        path = os.path.join(folder, 'overrides.json')
        with LOCK:                                   # the body is a delta: merged, never a whole file
            HISTORY.before_save(folder, file)
            try: data = json.load(open(path))
            except (OSError, ValueError): data = {'slides': {}}
            merge(data, delta)
            written = write_back(folder, file, data)
            with open(path, 'w') as f:
                json.dump(data, f, indent=1, ensure_ascii=False)
            self.send_json(dict(ok=True, written=written, stamp=stamps(folder, file), overrides=data))


LOCK = threading.Lock()


class History:
    """Undo / redo of editor saves: the deck source and overrides.json as they
    were before each save (saves < 1.5 s apart are one step: typing)."""
    def __init__(self): self.back, self.fwd, self.last = {}, {}, {}

    @staticmethod
    def read(folder, file):
        r = lambda p: open(p, encoding='utf-8').read() if os.path.exists(p) else None
        return (r(os.path.join(folder, file + '.js')), r(os.path.join(folder, 'overrides.json')))

    @staticmethod
    def write(folder, file, state):
        for p, text in zip((os.path.join(folder, file + '.js'), os.path.join(folder, 'overrides.json')), state):
            if text is None:
                if os.path.exists(p) and p.endswith('overrides.json'): os.remove(p)
            else:
                with open(p, 'w', encoding='utf-8') as f: f.write(text)

    def before_save(self, folder, file):
        key, now = (folder, file), time.monotonic()
        if now - self.last.get(key, -1e9) > 1.5:
            self.back.setdefault(key, []).append(self.read(folder, file))
            del self.back[key][:-200]
        self.last[key] = now
        self.fwd[key] = []

    def step(self, folder, file, back=True):
        key = (folder, file)
        src, dst = (self.back, self.fwd) if back else (self.fwd, self.back)
        if not src.get(key): return False
        dst.setdefault(key, []).append(self.read(folder, file))
        self.write(folder, file, src[key].pop())
        self.last[key] = -1e9                        # the next save starts a new step
        return True


HISTORY = History()


def merge(base, delta):
    """an editor delta into the overrides: camera replaced, poses and element props merged."""
    slides = base.setdefault('slides', {})
    if delta.get('order'): base['order'] = delta['order']           # the slides' order (ids), as dragged in the list
    for key, o in (delta.get('slides') or {}).items():
        b = slides.setdefault(key, {})
        for k in ('added', 'after', 'def', 'copyOf', 'deleted', 'background'):      # new / copied / deleted slides; a 2D slide's background
            if k in o: b[k] = o[k]
        if 'camera' in o: b['camera'] = o['camera']
        if o.get('poses'): b.setdefault('poses', {}).update(o['poses'])
        for k, v in (o.get('pageCameras') or {}).items():                  # page k's camera (slide.js); null: none
            if v is None: b.setdefault('pageCameras', {}).pop(k, None)
            else: b.setdefault('pageCameras', {})[k] = v
        if 'pageCameras' in b and not b['pageCameras']: del b['pageCameras']
        if o.get('pageOps'): b.setdefault('pageOps', []).extend(o['pageOps'])  # pages added / deleted, in order
        for mid, m in (o.get('models') or {}).items():                        # 3D shapes in a 3D scene; null: removed
            if m is None: b.setdefault('models', {}).pop(mid, None)
            else: b.setdefault('models', {}).setdefault(mid, {}).update(m)
        if 'models' in b and not b['models']: del b['models']
        for lid, L in (o.get('lights') or {}).items():                        # lights in a 3D scene; null: removed
            if L is None: b.setdefault('lights', {}).pop(lid, None)
            else: b.setdefault('lights', {}).setdefault(lid, {}).update(L)
        if 'lights' in b and not b['lights']: del b['lights']
        for k, v in (o.get('ambient') or {}).items():                         # each page's ambient level; null: 0.5
            if v is None: b.setdefault('ambient', {}).pop(k, None)
            else: b.setdefault('ambient', {})[k] = v
        if 'ambient' in b and not b['ambient']: del b['ambient']
        for eid, props in (o.get('elements') or {}).items():
            b.setdefault('elements', {}).setdefault(eid, {}).update(props)
    return base


def write_back(folder, file, data):
    """slide and element edits into the deck source; the written ones leave `data`."""
    path = os.path.join(folder, file + '.js')
    S = data.get('slides', {})
    added = [(k, o.get('after'), o.get('def') or {'copyOf': o['copyOf']}) for k, o in S.items()
             if o.get('added') and (o.get('def') or o.get('copyOf')) and not o.get('deleted')]
    gone = [k for k, o in S.items() if o.get('deleted')]
    if added or gone:
        try: done_add, done_del = patch_slides(path, added, gone)
        except Exception as e:
            print('write-back failed:', e); done_add, done_del = [], []
        for k in done_add:
            for x in ('added', 'after', 'def', 'copyOf'): S[k].pop(x, None)
        for k in done_del: del S[k]
    if data.get('order'):                                        # slides reordered: the `slides` array of the deck source
        try: ok = patch_order(path, data['order'])
        except Exception as e: print('write-back failed:', e); ok = False
        if ok: del data['order']
    for sid, o in data.get('slides', {}).items():                # pages added / deleted: into the slide's steps
        if o.get('pageOps') and not o.get('deleted') and not o.get('added'):
            try: n = patch_pages(path, sid, o['pageOps'])
            except Exception as e: print('write-back failed:', e); n = 0
            if n: del o['pageOps']
    edits = []
    for sid, o in data.get('slides', {}).items():
        if o.get('deleted') or o.get('added'): continue           # not (yet) in the deck source
        for eid, props in (o.get('elements') or {}).items():
            if props.get('added'):                      # a new element: one edit with all its props
                edits.append((sid, eid, 'added', {k: v for k, v in props.items() if k != 'added'}))
            else: edits += [(sid, eid, prop, val) for prop, val in props.items()]
    if not edits: return []
    try: written = patch_deck(path, edits)
    except Exception as e:
        print('write-back failed:', e); return []
    for sid, eid, prop in written:
        els = data['slides'][sid].get('elements', {})
        if eid not in els: continue
        if prop in ('deleted', 'added'): del els[eid]; continue      # gone from / now in deck.js: nothing left to override
        els[eid].pop(prop, None)
        if not els[eid]: del els[eid]
    for sid in list(data.get('slides', {})):
        o = data['slides'][sid]
        if 'elements' in o and not o['elements']: del o['elements']
        if not o: del data['slides'][sid]
    return [list(w) for w in written]


def stamps(folder, file):
    """deck: the deck source + overrides (a soft reload); code: any other script (a page reload)."""
    m = lambda p: os.stat(p).st_mtime_ns if os.path.exists(p) else 0
    deck = max(m(os.path.join(folder, file + '.js')), m(os.path.join(folder, 'overrides.json')))
    code = 0
    for base in (folder, os.path.join(ROOT, 'code', 'src')):
        for dp, dn, fn in os.walk(base):
            dn[:] = [d for d in dn if d not in ('assets', 'node_modules', 'vendor')]
            for f in fn:
                p = os.path.join(dp, f)
                if f.endswith(('.js', '.css')) and p != os.path.join(folder, file + '.js'): code = max(code, m(p))
    return dict(deck=str(deck), code=str(code))

if __name__ == '__main__':
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    url = f'http://localhost:{PORT}/?deck={urllib.parse.quote(DECK)}'
    print(f'3D Slides  edit: {url}   present: {url}&mode=run   (Ctrl+C to stop)')
    if '--no-open' not in sys.argv: threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    srv.serve_forever()
